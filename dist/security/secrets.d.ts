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
interface TauriCore {
    invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}
export declare class SecureSecretManager implements SecureSecretStore {
    private readonly providers;
    constructor(providers?: SecureSecretStore[]);
    readSecret(descriptor: SecretDescriptor): Promise<string | undefined>;
    writeSecret(descriptor: SecretDescriptor, secret: string): Promise<void>;
    deleteSecret(descriptor: SecretDescriptor): Promise<void>;
    private resolveProvider;
}
export declare class KeytarSecretStore implements SecureSecretStore {
    private keytarPromise;
    readSecret(descriptor: SecretDescriptor): Promise<string | undefined>;
    writeSecret(descriptor: SecretDescriptor, secret: string): Promise<void>;
    deleteSecret(descriptor: SecretDescriptor): Promise<void>;
    private requireKeytar;
    private loadKeytar;
}
export declare class TauriSecretStore implements SecureSecretStore {
    private readonly core;
    constructor(core?: TauriCore | undefined);
    readSecret(descriptor: SecretDescriptor): Promise<string | undefined>;
    writeSecret(descriptor: SecretDescriptor, secret: string): Promise<void>;
    deleteSecret(descriptor: SecretDescriptor): Promise<void>;
}
export declare function redactSecret(value: string | undefined): string | undefined;
export {};
