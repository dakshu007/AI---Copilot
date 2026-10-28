import { join } from 'node:path';
import { CandidateProfileSchema, JobContextSchema } from '@shared/schemas';
import type { CandidateProfile, JobContext } from '@shared/types';
import type { Cipher } from './cipher';
import { JsonFileStore } from './jsonFileStore';

/** Candidate profile and job description, stored locally (encrypted when the OS allows). */
export class ProfileStore {
  private readonly profileStore: JsonFileStore<typeof CandidateProfileSchema>;
  private readonly jobStore: JsonFileStore<typeof JobContextSchema>;
  private profileCache: CandidateProfile | null | undefined;
  private jobCache: JobContext | null | undefined;

  constructor(dataDir: string, cipher: Cipher) {
    this.profileStore = new JsonFileStore(join(dataDir, 'profile.json'), CandidateProfileSchema, cipher);
    this.jobStore = new JsonFileStore(join(dataDir, 'job.json'), JobContextSchema, cipher);
  }

  async getProfile(): Promise<CandidateProfile | null> {
    if (this.profileCache === undefined) this.profileCache = await this.profileStore.read();
    return this.profileCache;
  }

  async saveProfile(profile: unknown): Promise<CandidateProfile> {
    const parsed = CandidateProfileSchema.parse(profile);
    this.profileCache = await this.profileStore.write({ ...parsed, updatedAt: Date.now() });
    return this.profileCache;
  }

  async getJob(): Promise<JobContext | null> {
    if (this.jobCache === undefined) this.jobCache = await this.jobStore.read();
    return this.jobCache;
  }

  async saveJob(job: unknown): Promise<JobContext> {
    const parsed = JobContextSchema.parse(job);
    this.jobCache = await this.jobStore.write({ ...parsed, updatedAt: Date.now() });
    return this.jobCache;
  }

  async deleteProfile(): Promise<void> {
    await this.profileStore.delete();
    this.profileCache = null;
  }

  async deleteJob(): Promise<void> {
    await this.jobStore.delete();
    this.jobCache = null;
  }
}
