import { ConfigurationError } from "../utils/errors.js";
const SERVICE_PREFIX = "hybrid-model-switcher";
const DEFAULT_ACCOUNT = "default";
export class SecureSecretManager {
    providers;
    constructor(providers = createDefaultProviders()) {
        this.providers = providers;
    }
    async readSecret(descriptor) {
        const provider = await this.resolveProvider();
        return provider.readSecret(normalizeDescriptor(descriptor));
    }
    async writeSecret(descriptor, secret) {
        const trimmed = secret.trim();
        if (!trimmed) {
            throw new ConfigurationError("Refusing to store an empty API secret.");
        }
        const provider = await this.resolveProvider();
        await provider.writeSecret(normalizeDescriptor(descriptor), trimmed);
    }
    async deleteSecret(descriptor) {
        const provider = await this.resolveProvider();
        await provider.deleteSecret(normalizeDescriptor(descriptor));
    }
    async resolveProvider() {
        for (const provider of this.providers) {
            if (await isProviderAvailable(provider)) {
                return provider;
            }
        }
        throw new ConfigurationError("No secure native secret provider is available. Install keytar in Node or expose Tauri keychain IPC commands.");
    }
}
export class KeytarSecretStore {
    keytarPromise;
    async readSecret(descriptor) {
        const keytar = await this.loadKeytar();
        if (!keytar) {
            return undefined;
        }
        return ((await keytar.getPassword(serviceName(descriptor.scope), accountName(descriptor))) ?? undefined);
    }
    async writeSecret(descriptor, secret) {
        const keytar = await this.requireKeytar();
        await keytar.setPassword(serviceName(descriptor.scope), accountName(descriptor), secret);
    }
    async deleteSecret(descriptor) {
        const keytar = await this.requireKeytar();
        await keytar.deletePassword(serviceName(descriptor.scope), accountName(descriptor));
    }
    async requireKeytar() {
        const keytar = await this.loadKeytar();
        if (!keytar) {
            throw new ConfigurationError("keytar is not available; cannot access native OS credential storage from Node.");
        }
        return keytar;
    }
    async loadKeytar() {
        this.keytarPromise ??= importOptionalKeytar();
        return this.keytarPromise;
    }
}
export class TauriSecretStore {
    core;
    constructor(core = detectTauriCore()) {
        this.core = core;
    }
    async readSecret(descriptor) {
        if (!this.core) {
            return undefined;
        }
        const value = await this.core.invoke("hybrid_read_secret", {
            scope: descriptor.scope,
            account: accountName(descriptor),
        });
        return value ?? undefined;
    }
    async writeSecret(descriptor, secret) {
        if (!this.core) {
            throw new ConfigurationError("Tauri IPC is unavailable; cannot write secret through native bridge.");
        }
        await this.core.invoke("hybrid_write_secret", {
            scope: descriptor.scope,
            account: accountName(descriptor),
            secret,
        });
    }
    async deleteSecret(descriptor) {
        if (!this.core) {
            throw new ConfigurationError("Tauri IPC is unavailable; cannot delete secret through native bridge.");
        }
        await this.core.invoke("hybrid_delete_secret", {
            scope: descriptor.scope,
            account: accountName(descriptor),
        });
    }
}
export function redactSecret(value) {
    if (!value) {
        return undefined;
    }
    if (value.length <= 8) {
        return "********";
    }
    return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
function createDefaultProviders() {
    return [new TauriSecretStore(), new KeytarSecretStore()];
}
async function isProviderAvailable(provider) {
    try {
        await provider.readSecret({ scope: "litellm", account: "__availability_probe__" });
        return true;
    }
    catch {
        return false;
    }
}
function normalizeDescriptor(descriptor) {
    return {
        scope: descriptor.scope,
        account: descriptor.account?.trim() || DEFAULT_ACCOUNT,
    };
}
function serviceName(scope) {
    return `${SERVICE_PREFIX}.${scope}`;
}
function accountName(descriptor) {
    return descriptor.account?.trim() || DEFAULT_ACCOUNT;
}
function detectTauriCore() {
    const candidate = globalThis;
    return candidate.__TAURI__?.core;
}
async function importOptionalKeytar() {
    try {
        const imported = await import("key" + "tar");
        const candidate = imported && typeof imported === "object" && "default" in imported
            ? imported.default
            : imported;
        if (isKeytarModule(candidate)) {
            return candidate;
        }
        return undefined;
    }
    catch {
        return undefined;
    }
}
function isKeytarModule(value) {
    return Boolean(value &&
        typeof value === "object" &&
        "getPassword" in value &&
        "setPassword" in value &&
        "deletePassword" in value);
}
//# sourceMappingURL=secrets.js.map