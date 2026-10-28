import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NO_CIPHER } from '../../src/main/services/storage/cipher';
import { HistoryStore } from '../../src/main/services/storage/HistoryStore';
import { JsonFileStore } from '../../src/main/services/storage/jsonFileStore';
import { PrivacyController } from '../../src/main/services/storage/PrivacyController';
import { ProfileStore } from '../../src/main/services/storage/ProfileStore';
import { SecureSettingsService } from '../../src/main/services/storage/SecureSettingsService';
import { CandidateProfileSchema, SessionRecordSchema } from '../../src/shared/schemas';
import type { SessionRecord } from '../../src/shared/types';
import { fakeCipher } from '../fixtures/fakeCipher';
import { makeJob, makeProfile } from '../fixtures/profiles';

function session(id: string, startedAt: number, text = 'How would you design a cache?'): SessionRecord {
  return SessionRecordSchema.parse({
    id,
    startedAt,
    endedAt: startedAt + 1_000,
    mode: 'practice',
    isDemo: false,
    title: `Session ${id}`,
    segments: [{ id: `${id}-s`, text, startMs: 0, status: 'final', speaker: 'Interviewer' }],
    questions: [{ id: `${id}-q`, text, type: 'technical', confidence: 1, source: 'manual', detectedAt: startedAt }],
  });
}

describe('local storage', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'copilot-store-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('encrypts documents at rest when the keychain is available', async () => {
    const store = new JsonFileStore(join(dir, 'p.json'), CandidateProfileSchema, fakeCipher);
    await store.write(makeProfile());
    const raw = readFileSync(join(dir, 'p.json'), 'utf8');
    expect(raw.startsWith('ICENC1\n')).toBe(true);
    expect(raw).not.toContain('Acme Payments');
    expect((await store.read())!.name).toBe('Jane Doe');
  });

  it('returns null for corrupted or unreadable documents', async () => {
    writeFileSync(join(dir, 'p.json'), 'ICENC1\n!!!not-base64');
    expect(await new JsonFileStore(join(dir, 'p.json'), CandidateProfileSchema, NO_CIPHER).read()).toBeNull();
    writeFileSync(join(dir, 'q.json'), '{"name": 42}');
    expect(await new JsonFileStore(join(dir, 'q.json'), CandidateProfileSchema, fakeCipher).read()).toBeNull();
    expect(await new JsonFileStore(join(dir, 'missing.json'), CandidateProfileSchema, fakeCipher).read()).toBeNull();
  });

  it('stores profile and job and deletes the files', async () => {
    const profiles = new ProfileStore(dir, fakeCipher);
    await profiles.saveProfile(makeProfile());
    await profiles.saveJob(makeJob());
    expect((await new ProfileStore(dir, fakeCipher).getProfile())!.skills).toContain('Redis');
    await profiles.deleteProfile();
    await profiles.deleteJob();
    expect(existsSync(join(dir, 'profile.json'))).toBe(false);
    expect(existsSync(join(dir, 'job.json'))).toBe(false);
    expect(await profiles.getProfile()).toBeNull();
  });

  it('lists, searches, deletes and prunes session history', async () => {
    const history = new HistoryStore(dir, fakeCipher);
    const day = 24 * 60 * 60 * 1_000;
    const now = Date.UTC(2026, 5, 1);
    await history.save(session('old', now - 40 * day, 'Tell me about Kafka'));
    await history.save(session('new', now - day));
    expect((await history.list()).map((s) => s.id)).toEqual(['new', 'old']);
    expect((await history.list('kafka')).map((s) => s.id)).toEqual(['old']);
    expect((await history.list('nothing-matches')).length).toBe(0);

    expect(await history.prune(30, now)).toBe(1);
    expect(existsSync(join(dir, 'sessions', 'old.json'))).toBe(false);

    await history.delete('new');
    expect(readdirSync(join(dir, 'sessions'))).toEqual([]);
  });

  it('rejects path traversal in session ids', async () => {
    const history = new HistoryStore(dir, fakeCipher);
    await expect(history.get('../../etc/passwd')).rejects.toThrow('Invalid session id');
    await expect(history.delete('..')).rejects.toThrow();
  });

  it('deletes every kind of local data', async () => {
    const settings = new SecureSettingsService(dir, fakeCipher);
    await settings.load();
    await settings.setSecret('llm', 'sk-test-1234567890');
    await settings.update({ privacy: { historyEnabled: true } });
    const profiles = new ProfileStore(dir, fakeCipher);
    await profiles.saveProfile(makeProfile());
    await profiles.saveJob(makeJob());
    const history = new HistoryStore(dir, fakeCipher);
    await history.save(session('a', Date.now()));

    await new PrivacyController(settings, profiles, history).deleteAllData();
    expect(readdirSync(dir)).toEqual([]);
    expect(settings.getSecret('llm')).toBeUndefined();
    expect(await profiles.getProfile()).toBeNull();
  });
});
