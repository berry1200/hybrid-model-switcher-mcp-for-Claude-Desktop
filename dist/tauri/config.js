import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as z from "zod/v4";
import { ConfigurationError } from "../utils/errors.js";
const hostMcpServerSchema = z
    .object({
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
})
    .catchall(z.unknown());
const claudeDesktopConfigSchema = z
    .object({
    mcpServers: z.record(z.string(), hostMcpServerSchema).optional(),
})
    .catchall(z.unknown());
const activeLocalModelStateSchema = z.object({
    provider: z.enum(["ollama", "litellm", "client"]),
    model: z.string().min(1).optional(),
    litellmModel: z.string().min(1).optional(),
    fallbackModel: z.string().min(1).optional(),
    autoFallback: z.boolean(),
    revision: z.number().int().nonnegative(),
    updatedAt: z.string().min(1),
});
export class ClaudeDesktopHostConfigManager {
    env;
    platform;
    homeDir;
    explicitConfigPath;
    constructor(options = {}) {
        this.env = options.env ?? process.env;
        this.platform = options.platform ?? process.platform;
        this.homeDir = options.homeDir ?? os.homedir();
        this.explicitConfigPath = options.explicitConfigPath;
    }
    async locateConfigPath() {
        const candidates = this.getCandidatePaths();
        for (const candidate of candidates) {
            const resolved = this.resolveCandidate(candidate);
            try {
                const stats = await fs.stat(resolved);
                if (stats.isFile()) {
                    return resolved;
                }
            }
            catch (error) {
                if (!isMissingPathError(error)) {
                    throw new ConfigurationError(`Could not inspect Claude Desktop config at ${resolved}`, error);
                }
            }
        }
        throw new ConfigurationError("Could not locate claude_desktop_config.json in the native host config paths.", { candidates });
    }
    async readConfig() {
        const configPath = await this.locateConfigPath();
        const raw = await readUtf8File(configPath);
        try {
            return claudeDesktopConfigSchema.parse(JSON.parse(raw));
        }
        catch (error) {
            throw new ConfigurationError(`Claude Desktop config is not valid JSON or does not match the expected MCP config shape: ${configPath}`, error);
        }
    }
    async readMcpServer(name) {
        const config = await this.readConfig();
        return config.mcpServers?.[name];
    }
    getCandidatePaths() {
        const explicit = this.explicitConfigPath ??
            this.env.CLAUDE_DESKTOP_CONFIG_PATH ??
            this.env.ANTHROPIC_DESKTOP_CONFIG_PATH;
        const candidates = explicit ? [explicit] : [];
        if (this.platform === "win32") {
            const appData = this.env.APPDATA;
            if (appData) {
                candidates.push(path.join(appData, "Claude", "claude_desktop_config.json"));
            }
        }
        if (this.platform === "darwin") {
            candidates.push(path.join(this.homeDir, "Library", "Application Support", "Claude", "claude_desktop_config.json"));
        }
        candidates.push(path.join(this.homeDir, ".config", "Claude", "claude_desktop_config.json"));
        return [...new Set(candidates)];
    }
    resolveCandidate(candidate) {
        const resolved = path.resolve(candidate);
        const filename = path.basename(resolved).toLowerCase();
        if (filename !== "claude_desktop_config.json") {
            throw new ConfigurationError("Refusing to read a host config path that is not named claude_desktop_config.json.", { candidate });
        }
        return resolved;
    }
}
export class AtomicActiveModelStateManager {
    options;
    queue = Promise.resolve();
    constructor(options) {
        this.options = options;
    }
    async getSnapshot() {
        return this.runExclusive(async () => Object.freeze(await this.readState()));
    }
    async getRequiredSnapshot() {
        const state = await this.getSnapshot();
        if (!state.model && !state.litellmModel) {
            throw new ConfigurationError("No active local model is configured. Select a model before routing to LiteLLM.", { statePath: this.options.statePath });
        }
        return state;
    }
    async setActiveModel(input) {
        const model = input.model.trim();
        const litellmModel = input.litellmModel?.trim();
        const fallbackModel = input.fallbackModel?.trim();
        if (!model) {
            throw new ConfigurationError("Active local model name cannot be empty.");
        }
        return this.runExclusive(async () => {
            const previous = await this.readState();
            const next = {
                provider: input.provider ?? previous.provider,
                model,
                litellmModel: litellmModel || undefined,
                fallbackModel: fallbackModel || previous.fallbackModel,
                autoFallback: input.autoFallback ?? previous.autoFallback,
                revision: previous.revision + 1,
                updatedAt: new Date().toISOString(),
            };
            await this.writeState(next);
            return Object.freeze(next);
        });
    }
    async setAutoFallback(autoFallback) {
        return this.runExclusive(async () => {
            const previous = await this.readState();
            const next = {
                ...previous,
                autoFallback,
                revision: previous.revision + 1,
                updatedAt: new Date().toISOString(),
            };
            await this.writeState(next);
            return Object.freeze(next);
        });
    }
    async withModelSnapshot(operation) {
        const snapshot = await this.getRequiredSnapshot();
        return operation(snapshot);
    }
    async readState() {
        try {
            const raw = await fs.readFile(this.options.statePath, "utf8");
            return activeLocalModelStateSchema.parse(JSON.parse(raw));
        }
        catch (error) {
            if (isMissingPathError(error)) {
                return createInitialState(this.options);
            }
            throw new ConfigurationError(`Could not read active model state at ${this.options.statePath}`, error);
        }
    }
    async writeState(state) {
        const directory = path.dirname(this.options.statePath);
        await fs.mkdir(directory, { recursive: true });
        const temporaryPath = path.join(directory, `.${path.basename(this.options.statePath)}.${process.pid}.${Date.now()}.tmp`);
        try {
            const handle = await fs.open(temporaryPath, "wx");
            try {
                await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, "utf8");
                await handle.sync();
            }
            finally {
                await handle.close();
            }
            await fs.rename(temporaryPath, this.options.statePath);
        }
        catch (error) {
            await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
            throw new ConfigurationError(`Could not atomically write active model state at ${this.options.statePath}`, error);
        }
    }
    async runExclusive(operation) {
        const previous = this.queue;
        let release = () => undefined;
        this.queue = new Promise((resolve) => {
            release = resolve;
        });
        await previous;
        try {
            return await operation();
        }
        finally {
            release();
        }
    }
}
function createInitialState(options) {
    return {
        provider: "litellm",
        model: options.defaultModel,
        litellmModel: options.defaultLiteLlmModel,
        autoFallback: true,
        revision: 0,
        updatedAt: new Date().toISOString(),
    };
}
async function readUtf8File(filePath) {
    try {
        return await fs.readFile(filePath, "utf8");
    }
    catch (error) {
        throw new ConfigurationError(`Could not read file: ${filePath}`, error);
    }
}
function isMissingPathError(error) {
    return Boolean(error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT");
}
//# sourceMappingURL=config.js.map