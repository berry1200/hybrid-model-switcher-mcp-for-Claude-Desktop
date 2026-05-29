import { ConfigurationError } from "../utils/errors.js";

export type SecretScope = "anthropic" | "openai" | "litellm";

export interface SecretDescriptor {
  scope: SecretScope;
  account?: string;
}

export interface SecureSecretStore {
  readSecret(descriptor: SecretDescriptor): Promise<string | undefined>;
  writeSecret(descriptor: SecretDescriptor, secret: string): Promise<void>;
  deleteSecret(descriptor: SecretDescriptor): Promise<void>;
}

interface KeytarModule {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

interface TauriCore {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}

const SERVICE_PREFIX = "hybrid-model-switcher";
const DEFAULT_ACCOUNT = "default";

export class SecureSecretManager implements SecureSecretStore {
  constructor(private readonly providers = createDefaultProviders()) {}

  async readSecret(descriptor: SecretDescriptor): Promise<string | undefined> {
    const provider = await this.resolveProvider();
    return provider.readSecret(normalizeDescriptor(descriptor));
  }

  async writeSecret(descriptor: SecretDescriptor, secret: string): Promise<void> {
    const trimmed = secret.trim();
    if (!trimmed) {
      throw new ConfigurationError("Refusing to store an empty API secret.");
    }

    const provider = await this.resolveProvider();
    await provider.writeSecret(normalizeDescriptor(descriptor), trimmed);
  }

  async deleteSecret(descriptor: SecretDescriptor): Promise<void> {
    const provider = await this.resolveProvider();
    await provider.deleteSecret(normalizeDescriptor(descriptor));
  }

  private async resolveProvider(): Promise<SecureSecretStore> {
    for (const provider of this.providers) {
      if (await isProviderAvailable(provider)) {
        return provider;
      }
    }

    throw new ConfigurationError(
      "No secure native secret provider is available. Install keytar in Node or expose Tauri keychain IPC commands.",
    );
  }
}

export class KeytarSecretStore implements SecureSecretStore {
  private keytarPromise: Promise<KeytarModule | undefined> | undefined;

  async readSecret(descriptor: SecretDescriptor): Promise<string | undefined> {
    const keytar = await this.loadKeytar();
    if (!keytar) {
      return undefined;
    }

    return (
      (await keytar.getPassword(
        serviceName(descriptor.scope),
        accountName(descriptor),
      )) ?? undefined
    );
  }

  async writeSecret(descriptor: SecretDescriptor, secret: string): Promise<void> {
    const keytar = await this.requireKeytar();
    await keytar.setPassword(
      serviceName(descriptor.scope),
      accountName(descriptor),
      secret,
    );
  }

  async deleteSecret(descriptor: SecretDescriptor): Promise<void> {
    const keytar = await this.requireKeytar();
    await keytar.deletePassword(serviceName(descriptor.scope), accountName(descriptor));
  }

  private async requireKeytar(): Promise<KeytarModule> {
    const keytar = await this.loadKeytar();
    if (!keytar) {
      throw new ConfigurationError(
        "keytar is not available; cannot access native OS credential storage from Node.",
      );
    }

    return keytar;
  }

  private async loadKeytar(): Promise<KeytarModule | undefined> {
    this.keytarPromise ??= importOptionalKeytar();
    return this.keytarPromise;
  }
}

export class TauriSecretStore implements SecureSecretStore {
  constructor(private readonly core: TauriCore | undefined = detectTauriCore()) {}

  async readSecret(descriptor: SecretDescriptor): Promise<string | undefined> {
    if (!this.core) {
      return undefined;
    }

    const value = await this.core.invoke<string | null>("hybrid_read_secret", {
      scope: descriptor.scope,
      account: accountName(descriptor),
    });

    return value ?? undefined;
  }

  async writeSecret(descriptor: SecretDescriptor, secret: string): Promise<void> {
    if (!this.core) {
      throw new ConfigurationError(
        "Tauri IPC is unavailable; cannot write secret through native bridge.",
      );
    }

    await this.core.invoke<void>("hybrid_write_secret", {
      scope: descriptor.scope,
      account: accountName(descriptor),
      secret,
    });
  }

  async deleteSecret(descriptor: SecretDescriptor): Promise<void> {
    if (!this.core) {
      throw new ConfigurationError(
        "Tauri IPC is unavailable; cannot delete secret through native bridge.",
      );
    }

    await this.core.invoke<void>("hybrid_delete_secret", {
      scope: descriptor.scope,
      account: accountName(descriptor),
    });
  }
}

export function redactSecret(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  if (value.length <= 8) {
    return "********";
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function createDefaultProviders(): SecureSecretStore[] {
  return [new TauriSecretStore(), new KeytarSecretStore()];
}

async function isProviderAvailable(provider: SecureSecretStore): Promise<boolean> {
  try {
    await provider.readSecret({ scope: "litellm", account: "__availability_probe__" });
    return true;
  } catch {
    return false;
  }
}

function normalizeDescriptor(descriptor: SecretDescriptor): SecretDescriptor {
  return {
    scope: descriptor.scope,
    account: descriptor.account?.trim() || DEFAULT_ACCOUNT,
  };
}

function serviceName(scope: SecretScope): string {
  return `${SERVICE_PREFIX}.${scope}`;
}

function accountName(descriptor: SecretDescriptor): string {
  return descriptor.account?.trim() || DEFAULT_ACCOUNT;
}

function detectTauriCore(): TauriCore | undefined {
  const candidate = globalThis as typeof globalThis & {
    __TAURI__?: {
      core?: TauriCore;
    };
  };

  return candidate.__TAURI__?.core;
}

async function importOptionalKeytar(): Promise<KeytarModule | undefined> {
  try {
    const imported = await import("key" + "tar");
    const candidate =
      imported && typeof imported === "object" && "default" in imported
        ? (imported as { default: unknown }).default
        : imported;

    if (isKeytarModule(candidate)) {
      return candidate;
    }

    return undefined;
  } catch {
    return undefined;
  }
}

function isKeytarModule(value: unknown): value is KeytarModule {
  return Boolean(
    value &&
      typeof value === "object" &&
      "getPassword" in value &&
      "setPassword" in value &&
      "deletePassword" in value,
  );
}
