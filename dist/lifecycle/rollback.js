import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as z from "zod/v4";
import { captureTelemetryError, captureTelemetryMessage } from "../observability/telemetry.js";
import { ConfigurationError, getErrorMessage } from "../utils/errors.js";
const DEFAULT_PROXY_SERVER_NAME = "hybrid-model-switcher";
const DEFAULT_CRASH_THRESHOLD = 3;
const bootLoopStateSchema = z.object({
    consecutiveBootFailures: z.number().int().nonnegative(),
    lastBootStartedAt: z.string().optional(),
    lastHealthyAt: z.string().optional(),
    lastRollbackAt: z.string().optional(),
    lastRollbackReason: z.string().optional(),
});
export class LocalConfigRollbackEngine {
    options;
    stateDirectory;
    crashThreshold;
    notifier;
    constructor(options) {
        this.options = options;
        this.stateDirectory =
            options.stateDirectory ??
                path.join(os.homedir(), ".hybrid-model-switcher", "rollback");
        this.crashThreshold = options.crashThreshold ?? DEFAULT_CRASH_THRESHOLD;
        this.notifier = options.notifier ?? new TauriRollbackNotifier();
    }
    async snapshotHostConfig() {
        const configPath = await this.options.hostConfigManager.locateConfigPath();
        const raw = await fs.readFile(configPath);
        const createdAt = new Date().toISOString();
        const sha256 = await sha256Hex(raw);
        const snapshotDirectory = path.join(this.stateDirectory, "snapshots");
        const snapshotPath = path.join(snapshotDirectory, `${timestampForPath(createdAt)}-${sha256.slice(0, 12)}-claude_desktop_config.json`);
        await fs.mkdir(snapshotDirectory, { recursive: true });
        await atomicWriteFile(snapshotPath, raw);
        await this.writeLatestSnapshot({
            snapshotPath,
            configPath,
            createdAt,
            sha256,
            bytes: raw.byteLength,
        });
        return {
            snapshotPath,
            configPath,
            createdAt,
            sha256,
            bytes: raw.byteLength,
        };
    }
    async installProxyServerBlock(serverConfig, serverName = this.options.proxyServerName || DEFAULT_PROXY_SERVER_NAME) {
        const snapshot = await this.snapshotHostConfig();
        const raw = await fs.readFile(snapshot.configPath, "utf8");
        const parsed = JSON.parse(raw);
        const mcpServers = isPlainObject(parsed.mcpServers)
            ? { ...parsed.mcpServers }
            : {};
        mcpServers[serverName] = serverConfig;
        const next = {
            ...parsed,
            mcpServers,
        };
        await atomicWriteJson(snapshot.configPath, next);
        return snapshot;
    }
    async recordBootStartAndRollbackIfNeeded(reason = "boot_start") {
        const state = await this.readBootState();
        const next = {
            ...state,
            consecutiveBootFailures: state.consecutiveBootFailures + 1,
            lastBootStartedAt: new Date().toISOString(),
        };
        await this.writeBootState(next);
        if (next.consecutiveBootFailures < this.crashThreshold) {
            return {
                rolledBack: false,
                reason: "boot_failure_threshold_not_reached",
                notificationSent: false,
            };
        }
        return this.rollbackToLatestSnapshot(`${reason}: ${next.consecutiveBootFailures} consecutive boot failures`);
    }
    async recordBootHealthy() {
        await this.writeBootState({
            consecutiveBootFailures: 0,
            lastHealthyAt: new Date().toISOString(),
        });
    }
    async rollbackToLatestSnapshot(reason) {
        const latest = await this.readLatestSnapshot();
        if (!latest) {
            await this.purgeProxyBlockOnly(reason);
            return {
                rolledBack: true,
                reason: "purged_proxy_block_without_snapshot",
                notificationSent: await this.notifyRollback(reason),
            };
        }
        try {
            const snapshotBytes = await fs.readFile(latest.snapshotPath);
            await atomicWriteFile(latest.configPath, snapshotBytes);
            await this.writeBootState({
                consecutiveBootFailures: 0,
                lastRollbackAt: new Date().toISOString(),
                lastRollbackReason: reason,
            });
            return {
                rolledBack: true,
                reason,
                restoredSnapshotPath: latest.snapshotPath,
                configPath: latest.configPath,
                notificationSent: await this.notifyRollback(reason),
            };
        }
        catch (error) {
            captureTelemetryError(error, {
                code: "rollback_restore_failed",
                routeKind: "lifecycle:rollback",
            });
            throw new ConfigurationError("Failed to restore Claude Desktop config snapshot.", {
                reason,
                cause: getErrorMessage(error),
            });
        }
    }
    async purgeProxyBlockOnly(reason) {
        const configPath = await this.options.hostConfigManager.locateConfigPath();
        const raw = await fs.readFile(configPath, "utf8");
        const parsed = JSON.parse(raw);
        if (isPlainObject(parsed.mcpServers)) {
            const mcpServers = { ...parsed.mcpServers };
            delete mcpServers[this.options.proxyServerName || DEFAULT_PROXY_SERVER_NAME];
            await atomicWriteJson(configPath, {
                ...parsed,
                mcpServers,
            });
        }
        await this.writeBootState({
            consecutiveBootFailures: 0,
            lastRollbackAt: new Date().toISOString(),
            lastRollbackReason: reason,
        });
    }
    async notifyRollback(reason) {
        try {
            await this.notifier.notify({
                title: "Hybrid Model Switcher recovered Claude Desktop config",
                body: "The proxy detected repeated startup failures, restored the last known-good config, and disabled the newly injected server block.",
                severity: "warning",
            });
            captureTelemetryMessage("rollback.executed", "warning", {
                code: "rollback_executed",
                routeKind: "lifecycle:rollback",
                tags: {
                    reason,
                },
            });
            return true;
        }
        catch (error) {
            captureTelemetryError(error, {
                code: "rollback_notification_failed",
                routeKind: "lifecycle:rollback",
            });
            return false;
        }
    }
    async readBootState() {
        try {
            const raw = await fs.readFile(this.bootStatePath, "utf8");
            return bootLoopStateSchema.parse(JSON.parse(raw));
        }
        catch (error) {
            if (isMissingPathError(error)) {
                return { consecutiveBootFailures: 0 };
            }
            throw new ConfigurationError("Could not read rollback boot-loop state.", error);
        }
    }
    async writeBootState(state) {
        await fs.mkdir(this.stateDirectory, { recursive: true });
        await atomicWriteJson(this.bootStatePath, state);
    }
    async writeLatestSnapshot(snapshot) {
        await fs.mkdir(this.stateDirectory, { recursive: true });
        await atomicWriteJson(this.latestSnapshotPath, snapshot);
    }
    async readLatestSnapshot() {
        try {
            const raw = await fs.readFile(this.latestSnapshotPath, "utf8");
            return JSON.parse(raw);
        }
        catch (error) {
            if (isMissingPathError(error)) {
                return undefined;
            }
            throw new ConfigurationError("Could not read latest rollback snapshot pointer.", error);
        }
    }
    get bootStatePath() {
        return path.join(this.stateDirectory, "boot-loop-state.json");
    }
    get latestSnapshotPath() {
        return path.join(this.stateDirectory, "latest-snapshot.json");
    }
}
export class TauriRollbackNotifier {
    core;
    constructor(core = detectTauriCore()) {
        this.core = core;
    }
    async notify(message) {
        if (!this.core) {
            captureTelemetryMessage(message.title, message.severity, {
                code: "native_notification_unavailable",
                routeKind: "lifecycle:rollback",
            });
            return;
        }
        await this.core.invoke("hybrid_notify", { message });
    }
}
export async function atomicWriteJson(filePath, value) {
    await atomicWriteFile(filePath, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"));
}
export async function atomicWriteFile(filePath, bytes) {
    const directory = path.dirname(filePath);
    await fs.mkdir(directory, { recursive: true });
    const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
    try {
        const handle = await fs.open(temporaryPath, "wx");
        try {
            await handle.writeFile(bytes);
            await handle.sync();
        }
        finally {
            await handle.close();
        }
        await fs.rename(temporaryPath, filePath);
    }
    catch (error) {
        await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
        throw error;
    }
}
async function sha256Hex(bytes) {
    const { createHash } = await import("node:crypto");
    return createHash("sha256").update(bytes).digest("hex");
}
function timestampForPath(value) {
    return value.replace(/[:.]/g, "-");
}
function isPlainObject(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function isMissingPathError(error) {
    return Boolean(error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT");
}
function detectTauriCore() {
    const candidate = globalThis;
    return candidate.__TAURI__?.core;
}
//# sourceMappingURL=rollback.js.map