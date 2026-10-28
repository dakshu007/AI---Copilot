import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type { z } from 'zod';
import type { Cipher } from './cipher';

const ENCRYPTED_MAGIC = 'ICENC1\n';

/** Atomically write a file (write to a temp file, then rename). */
export async function atomicWrite(path: string, data: string | Buffer): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, data, { mode: 0o600 });
  await fs.rename(temp, path);
}

/**
 * A validated JSON document on disk. When the cipher is available the file is encrypted with
 * the OS credential store; otherwise it is stored as plain JSON inside the app's private data
 * directory (documented in docs/PRIVACY.md).
 */
export class JsonFileStore<Schema extends z.ZodType> {
  constructor(
    private readonly path: string,
    private readonly schema: Schema,
    private readonly cipher: Cipher,
  ) {}

  get filePath(): string {
    return this.path;
  }

  async read(): Promise<z.infer<Schema> | null> {
    let raw: Buffer;
    try {
      raw = await fs.readFile(this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    let text: string;
    const header = raw.subarray(0, ENCRYPTED_MAGIC.length).toString('utf8');
    if (header === ENCRYPTED_MAGIC) {
      if (!this.cipher.available) return null;
      try {
        text = this.cipher.decrypt(Buffer.from(raw.subarray(ENCRYPTED_MAGIC.length).toString('utf8'), 'base64'));
      } catch {
        return null;
      }
    } else {
      text = raw.toString('utf8');
    }
    try {
      const parsed = this.schema.safeParse(JSON.parse(text));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async write(value: z.infer<Schema>): Promise<z.infer<Schema>> {
    const validated = this.schema.parse(value);
    const json = JSON.stringify(validated);
    const payload = this.cipher.available
      ? ENCRYPTED_MAGIC + this.cipher.encrypt(json).toString('base64')
      : json;
    await atomicWrite(this.path, payload);
    return validated;
  }

  async delete(): Promise<void> {
    await fs.rm(this.path, { force: true });
  }
}
