import { CandidateProfileSchema, JobContextSchema } from '../../src/shared/schemas';
import type { CandidateProfile, JobContext } from '../../src/shared/types';

export function makeProfile(overrides: Partial<CandidateProfile> = {}): CandidateProfile {
  return CandidateProfileSchema.parse({
    name: 'Jane Doe',
    headline: 'Senior Backend Engineer',
    summary: 'Backend engineer focused on payments and reliability.',
    skills: ['TypeScript', 'PostgreSQL', 'Kubernetes', 'Redis'],
    experience: [
      {
        title: 'Senior Engineer',
        company: 'Acme Payments',
        period: '2020 - Present',
        highlights: [
          'Led the migration of the payments API to Kubernetes, cutting deploy time by 60%',
          'Introduced Redis-based rate limiting for the public API, reducing abuse incidents by 80%',
          'Ran the incident response for a 2022 payments outage and wrote the postmortem',
        ],
      },
    ],
    projects: [{ name: 'Ledger', description: 'Double-entry ledger service', highlights: ['Designed idempotent PostgreSQL transactions'] }],
    achievements: ['Promoted to senior engineer in 18 months'],
    education: ['BSc Computer Science, State University'],
    verified: true,
    ...overrides,
  });
}

export function makeJob(overrides: Partial<JobContext> = {}): JobContext {
  return JobContextSchema.parse({
    title: 'Staff Backend Engineer',
    company: 'Globex',
    text: 'We need strong experience with distributed systems and Kubernetes.',
    requirements: ['Experience with distributed systems', 'Hands-on Kubernetes'],
    skills: ['Kubernetes', 'Go', 'PostgreSQL'],
    ...overrides,
  });
}
