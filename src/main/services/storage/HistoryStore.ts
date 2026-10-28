import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { SessionRecordSchema } from '@shared/schemas';
import type { SessionRecord, SessionSummary } from '@shared/types';
import type { Cipher } from './cipher';
import { JsonFileStore } from './jsonFileStore';

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Opt-in local session history. One (optionally encrypted) file per session. */
export class HistoryStore {
  private readonly dir: string;

  constructor(
    dataDir: string,
    private readonly cipher: Cipher,
  ) {
    this.dir = join(dataDir, 'sessions');
  }

  private storeFor(id: string): JsonFileStore<typeof SessionRecordSchema> {
    if (!SAFE_ID.test(id)) throw new Error('Invalid session id');
    return new JsonFileStore(join(this.dir, `${id}.json`), SessionRecordSchema, this.cipher);
  }

  async save(session: SessionRecord): Promise<void> {
    await this.storeFor(session.id).write(session);
  }

  async get(id: string): Promise<SessionRecord | null> {
    return this.storeFor(id).read();
  }

  async list(query = ''): Promise<SessionSummary[]> {
    let files: string[];
    try {
      files = (await fs.readdir(this.dir)).filter((f) => f.endsWith('.json'));
    } catch {
      return [];
    }
    const needle = query.trim().toLowerCase();
    const summaries: SessionSummary[] = [];
    for (const file of files) {
      const id = file.slice(0, -'.json'.length);
      if (!SAFE_ID.test(id)) continue;
      const session = await this.get(id);
      if (!session) continue;
      if (needle && !sessionMatches(session, needle)) continue;
      const firstQuestion = session.questions[0]?.text ?? session.segments.find((s) => s.text.trim())?.text ?? '';
      summaries.push({
        id: session.id,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        mode: session.mode,
        isDemo: session.isDemo,
        title: session.title,
        questionCount: session.questions.length,
        answerCount: session.answers.length,
        preview: firstQuestion.slice(0, 160),
      });
    }
    return summaries.sort((a, b) => b.startedAt - a.startedAt);
  }

  async delete(id: string): Promise<void> {
    await this.storeFor(id).delete();
  }

  async deleteAll(): Promise<void> {
    await fs.rm(this.dir, { recursive: true, force: true });
  }

  /** Delete sessions older than the retention period. Returns the number removed. */
  async prune(retentionDays: number, now = Date.now()): Promise<number> {
    const cutoff = now - retentionDays * 24 * 60 * 60 * 1_000;
    const sessions = await this.list();
    let removed = 0;
    for (const session of sessions) {
      if ((session.endedAt ?? session.startedAt) < cutoff) {
        await this.delete(session.id);
        removed += 1;
      }
    }
    return removed;
  }
}

function sessionMatches(session: SessionRecord, needle: string): boolean {
  if (session.title.toLowerCase().includes(needle)) return true;
  if (session.segments.some((s) => s.text.toLowerCase().includes(needle))) return true;
  if (session.questions.some((q) => q.text.toLowerCase().includes(needle))) return true;
  return session.answers.some((a) => a.answer.toLowerCase().includes(needle));
}
