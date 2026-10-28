import { ApiKeySchema, SettingsSchema, SettingsUpdateSchema } from '../../src/shared/schemas';

describe('settings schema', () => {
  it('provides safe defaults (privacy off, demo providers)', () => {
    const settings = SettingsSchema.parse({});
    expect(settings.llm.provider).toBe('demo');
    expect(settings.transcription.provider).toBe('demo');
    expect(settings.privacy).toMatchObject({ historyEnabled: false, consentLlm: false, consentTranscription: false });
    expect(settings.ui.alwaysOnTop).toBe(false);
  });

  it('only accepts https base URLs (http only for localhost)', () => {
    expect(SettingsUpdateSchema.safeParse({ llm: { baseUrl: 'https://api.example.com/v1' } }).success).toBe(true);
    expect(SettingsUpdateSchema.safeParse({ llm: { baseUrl: 'http://localhost:11434/v1' } }).success).toBe(true);
    expect(SettingsUpdateSchema.safeParse({ llm: { baseUrl: 'http://evil.example.com' } }).success).toBe(false);
    expect(SettingsUpdateSchema.safeParse({ llm: { baseUrl: 'file:///etc/passwd' } }).success).toBe(false);
  });

  it('rejects unknown enum values', () => {
    expect(SettingsUpdateSchema.safeParse({ llm: { provider: 'shady' } }).success).toBe(false);
    expect(SettingsUpdateSchema.safeParse({ answers: { maxWords: 5 } }).success).toBe(false);
  });

  it('validates API key shape', () => {
    expect(ApiKeySchema.safeParse('  sk-valid-key-123  ').success).toBe(true);
    expect(ApiKeySchema.safeParse('short').success).toBe(false);
    expect(ApiKeySchema.safeParse('has spaces in it').success).toBe(false);
  });
});
