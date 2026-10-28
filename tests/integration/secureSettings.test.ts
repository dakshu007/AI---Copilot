import { mkdtempSync, promises as fs, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NO_CIPHER, createSafeStorageCipher } from '../../src/main/services/storage/cipher';
import { SecureSettingsService } from '../../src/main/services/storage/SecureSettingsService';
import { fakeCipher } from '../fixtures/fakeCipher';

const KEY = 'sk-test-SUPERSECRET-1234567890';

describe('SecureSettingsService', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'copilot-settings-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function allFileContents(): string {
    return readdirSync(dir)
      .map((file) => readFileSync(join(dir, file)).toString('latin1'))
      .join('\n');
  }

  it('persists encrypted keys that survive a restart, never in plain text', async () => {
    const service = new SecureSettingsService(dir, fakeCipher);
    await service.load();
    const status = await service.setSecret('llm', KEY);
    expect(status).toEqual({ set: true, hint: '7890', storage: 'persisted' });
    expect(allFileContents()).not.toContain(KEY);
    expect(allFileContents()).not.toContain('SUPERSECRET');

    const reloaded = new SecureSettingsService(dir, fakeCipher);
    await reloaded.load();
    expect(reloaded.getSecret('llm')).toBe(KEY);
  });

  it('never exposes key material through the public view', async () => {
    const service = new SecureSettingsService(dir, fakeCipher);
    await service.load();
    await service.setSecret('transcription', KEY);
    const view = JSON.stringify(service.getPublic());
    expect(view).not.toContain(KEY);
    expect(view).toContain('"hint":"7890"');
  });

  it('keeps keys in memory only when secure storage is unavailable', async () => {
    const service = new SecureSettingsService(dir, NO_CIPHER);
    await service.load();
    const status = await service.setSecret('llm', KEY);
    expect(status.storage).toBe('memory');
    expect(service.getSecret('llm')).toBe(KEY);
    await expect(fs.access(join(dir, 'secrets.bin'))).rejects.toThrow();
    const reloaded = new SecureSettingsService(dir, NO_CIPHER);
    await reloaded.load();
    expect(reloaded.getSecret('llm')).toBeUndefined();
  });

  it('rejects invalid keys and settings', async () => {
    const service = new SecureSettingsService(dir, fakeCipher);
    await service.load();
    await expect(service.setSecret('llm', 'bad key with spaces')).rejects.toThrow();
    await expect(service.update({ llm: { baseUrl: 'http://example.com' } })).rejects.toThrow();
    await expect(service.update({ ui: { theme: 'neon' } })).rejects.toThrow();
  });

  it('merges partial updates and notifies listeners', async () => {
    const service = new SecureSettingsService(dir, fakeCipher);
    await service.load();
    const listener = vi.fn();
    service.onChange(listener);
    const updated = await service.update({ llm: { provider: 'anthropic' }, privacy: { historyEnabled: true } });
    expect(updated.llm.provider).toBe('anthropic');
    expect(updated.llm.model).toBe('claude-opus-5-5');
    expect(updated.privacy.historyEnabled).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    const reloaded = new SecureSettingsService(dir, fakeCipher);
    await reloaded.load();
    expect(reloaded.get().privacy.historyEnabled).toBe(true);
  });

  it('only changes the fields that were sent', async () => {
    const service = new SecureSettingsService(dir, fakeCipher);
    await service.load();
    await service.update({ ui: { onboardingDone: true }, transcription: { provider: 'openai-whisper', model: 'whisper-1' } });
    await service.update({ ui: { alwaysOnTop: true } });
    await service.update({ transcription: { baseUrl: 'http://localhost:9000/v1' } });
    const settings = service.get();
    expect(settings.ui).toMatchObject({ onboardingDone: true, alwaysOnTop: true });
    expect(settings.transcription).toMatchObject({ provider: 'openai-whisper', model: 'whisper-1', baseUrl: 'http://localhost:9000/v1' });
  });

  it('recovers from a corrupted settings file', async () => {
    await fs.writeFile(join(dir, 'settings.json'), '{not json');
    const service = new SecureSettingsService(dir, fakeCipher);
    await service.load();
    expect(service.get().llm.provider).toBe('demo');
  });

  it('clears keys and deletes files', async () => {
    const service = new SecureSettingsService(dir, fakeCipher);
    await service.load();
    await service.setSecret('llm', KEY);
    await service.clearSecret('llm');
    expect(service.getSecret('llm')).toBeUndefined();
    await expect(fs.access(join(dir, 'secrets.bin'))).rejects.toThrow();
    await service.setSecret('llm', KEY);
    await service.update({ ui: { compact: true } });
    await service.deleteAll();
    expect(readdirSync(dir)).toEqual([]);
    expect(service.get().ui.compact).toBe(false);
  });
});

describe('createSafeStorageCipher', () => {
  const safeStorage = (backend: string, available = true) => ({
    isEncryptionAvailable: () => available,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
    getSelectedStorageBackend: () => backend,
  });

  it('uses the macOS keychain', () => {
    const cipher = createSafeStorageCipher(safeStorage('unknown'), 'darwin');
    expect(cipher).toMatchObject({ available: true, backend: 'macOS Keychain' });
  });

  it('refuses the insecure Linux basic_text backend', () => {
    expect(createSafeStorageCipher(safeStorage('basic_text'), 'linux').available).toBe(false);
    expect(createSafeStorageCipher(safeStorage('gnome_libsecret'), 'linux').available).toBe(true);
  });

  it('handles unavailable or throwing implementations', () => {
    expect(createSafeStorageCipher(safeStorage('x', false), 'darwin').available).toBe(false);
    const throwing = { ...safeStorage('x'), isEncryptionAvailable: () => { throw new Error('boom'); } };
    expect(createSafeStorageCipher(throwing, 'darwin').available).toBe(false);
  });
});
