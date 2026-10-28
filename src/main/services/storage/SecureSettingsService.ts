import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ApiKeySchema, SettingsSchema, SettingsUpdateSchema } from '@shared/schemas';
import type { PublicSettings, SecretKind, SecretStatus, Settings, SettingsUpdate } from '@shared/types';
import type { Cipher } from './cipher';
import { atomicWrite } from './jsonFileStore';

const SecretsFileSchema = z.record(z.string(), z.string());

/**
 * Stores non-secret preferences as JSON and API keys encrypted with the OS keychain
 * (Electron safeStorage). API keys never leave the main process: the renderer only sees
 * whether a key is set and its last four characters.
 */
export class SecureSettingsService {
  private settings: Settings = SettingsSchema.parse({});
  private readonly memorySecrets = new Map<SecretKind, string>();
  private readonly settingsPath: string;
  private readonly secretsPath: string;
  private listeners = new Set<(settings: Settings) => void>();

  constructor(
    private readonly dataDir: string,
    private readonly cipher: Cipher,
  ) {
    this.settingsPath = join(dataDir, 'settings.json');
    this.secretsPath = join(dataDir, 'secrets.bin');
  }

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(this.settingsPath, 'utf8'));
      const parsed = SettingsSchema.safeParse(raw);
      this.settings = parsed.success ? parsed.data : SettingsSchema.parse({});
    } catch {
      this.settings = SettingsSchema.parse({});
    }
    if (this.cipher.available) {
      try {
        const raw = await fs.readFile(this.secretsPath, 'utf8');
        const record = SecretsFileSchema.parse(JSON.parse(raw));
        for (const [kind, value] of Object.entries(record)) {
          if (kind === 'llm' || kind === 'transcription') {
            this.memorySecrets.set(kind, this.cipher.decrypt(Buffer.from(value, 'base64')));
          }
        }
      } catch {
        // Missing or unreadable secrets file: start without keys.
      }
    }
  }

  get(): Settings {
    return structuredClone(this.settings);
  }

  onChange(listener: (settings: Settings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async update(update: SettingsUpdate | unknown): Promise<Settings> {
    const patch = SettingsUpdateSchema.parse(update) as SettingsUpdate;
    const merged = {
      ...this.settings,
      llm: { ...this.settings.llm, ...patch.llm },
      transcription: { ...this.settings.transcription, ...patch.transcription },
      audio: { ...this.settings.audio, ...patch.audio },
      answers: { ...this.settings.answers, ...patch.answers },
      privacy: { ...this.settings.privacy, ...patch.privacy },
      ui: { ...this.settings.ui, ...patch.ui },
    };
    this.settings = SettingsSchema.parse(merged);
    await atomicWrite(this.settingsPath, JSON.stringify(this.settings, null, 2));
    for (const listener of this.listeners) listener(this.get());
    return this.get();
  }

  getSecret(kind: SecretKind): string | undefined {
    return this.memorySecrets.get(kind);
  }

  async setSecret(kind: SecretKind, value: unknown): Promise<SecretStatus> {
    const key = ApiKeySchema.parse(value);
    this.memorySecrets.set(kind, key);
    await this.persistSecrets();
    return this.secretStatus(kind);
  }

  async clearSecret(kind: SecretKind): Promise<SecretStatus> {
    this.memorySecrets.delete(kind);
    await this.persistSecrets();
    return this.secretStatus(kind);
  }

  secretStatus(kind: SecretKind): SecretStatus {
    const value = this.memorySecrets.get(kind);
    if (!value) return { set: false, hint: '', storage: 'none' };
    return {
      set: true,
      hint: value.length > 8 ? value.slice(-4) : '',
      storage: this.cipher.available ? 'persisted' : 'memory',
    };
  }

  getPublic(): PublicSettings {
    return {
      settings: this.get(),
      secrets: { llm: this.secretStatus('llm'), transcription: this.secretStatus('transcription') },
      secureStorage: { available: this.cipher.available, backend: this.cipher.backend },
    };
  }

  /** Remove every stored key and reset preferences. */
  async deleteAll(): Promise<void> {
    this.memorySecrets.clear();
    this.settings = SettingsSchema.parse({});
    await fs.rm(this.secretsPath, { force: true });
    await fs.rm(this.settingsPath, { force: true });
    for (const listener of this.listeners) listener(this.get());
  }

  private async persistSecrets(): Promise<void> {
    if (!this.cipher.available) {
      // Never write keys in plain text. They stay in memory until the app quits.
      await fs.rm(this.secretsPath, { force: true });
      return;
    }
    const record: Record<string, string> = {};
    for (const [kind, value] of this.memorySecrets) {
      record[kind] = this.cipher.encrypt(value).toString('base64');
    }
    if (Object.keys(record).length === 0) {
      await fs.rm(this.secretsPath, { force: true });
      return;
    }
    await atomicWrite(this.secretsPath, JSON.stringify(record));
  }
}
