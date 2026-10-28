import type { CandidateProfile, JobContext } from '../types';
import { contentTokens, overlapScore, truncate } from './text';

export interface EvidenceItem {
  /** Stable reference such as "E3", cited by the model in `evidenceUsed`. */
  ref: string;
  kind: 'summary' | 'skill' | 'experience' | 'project' | 'achievement' | 'education' | 'fact';
  text: string;
}

export interface BuiltContext {
  /** Evidence lines, most relevant first, within the character budget. */
  evidence: EvidenceItem[];
  jobSummary: string;
  candidateHeadline: string;
  hasProfile: boolean;
  /** Prompt-ready text block. */
  text: string;
}

export interface BuildContextInput {
  profile: CandidateProfile | null;
  job: JobContext | null;
  question: string;
  recentTranscript?: string;
  maxChars?: number;
}

function collectEvidence(profile: CandidateProfile): Omit<EvidenceItem, 'ref'>[] {
  const items: Omit<EvidenceItem, 'ref'>[] = [];
  if (profile.summary.trim()) items.push({ kind: 'summary', text: profile.summary.trim() });
  for (const exp of profile.experience) {
    const role = [exp.title, exp.company && `at ${exp.company}`, exp.period && `(${exp.period})`]
      .filter(Boolean)
      .join(' ');
    if (exp.highlights.length === 0 && role) items.push({ kind: 'experience', text: role });
    for (const highlight of exp.highlights) {
      if (highlight.trim()) items.push({ kind: 'experience', text: `${role}: ${highlight.trim()}` });
    }
  }
  for (const project of profile.projects) {
    const base = [project.name, project.description].filter(Boolean).join(' — ');
    if (base) items.push({ kind: 'project', text: `Project ${base}` });
    for (const highlight of project.highlights) {
      if (highlight.trim()) items.push({ kind: 'project', text: `Project ${project.name}: ${highlight.trim()}` });
    }
  }
  for (const achievement of profile.achievements) {
    if (achievement.trim()) items.push({ kind: 'achievement', text: achievement.trim() });
  }
  for (const fact of profile.additionalFacts) {
    if (fact.trim()) items.push({ kind: 'fact', text: fact.trim() });
  }
  for (const education of profile.education) {
    if (education.trim()) items.push({ kind: 'education', text: education.trim() });
  }
  return items;
}

/**
 * Build a compact, relevant context for one question. Only the highest-scoring evidence is
 * included, so the prompt stays small (lower latency and cost) and only relevant personal
 * data is sent to the AI provider.
 */
export function buildContext(input: BuildContextInput): BuiltContext {
  const maxChars = input.maxChars ?? 3_600;
  const profile = input.profile;
  const job = input.job;
  const questionTokens = contentTokens(input.question);
  const jobTokens = job ? [...job.skills.map((s) => s.toLowerCase()), ...contentTokens(job.title)] : [];

  const evidence: EvidenceItem[] = [];
  let used = 0;
  const hasProfile = Boolean(
    profile &&
      (profile.skills.length > 0 ||
        profile.experience.length > 0 ||
        profile.projects.length > 0 ||
        profile.achievements.length > 0 ||
        profile.additionalFacts.length > 0 ||
        profile.summary.trim()),
  );

  if (profile && hasProfile) {
    const scored = collectEvidence(profile)
      .map((item, order) => {
        const relevance = overlapScore(questionTokens, item.text);
        const jobRelevance = jobTokens.length ? overlapScore(jobTokens, item.text) * 0.35 : 0;
        const kindBoost = item.kind === 'achievement' || item.kind === 'experience' ? 0.05 : 0;
        return { item, order, score: relevance + jobRelevance + kindBoost };
      })
      .sort((a, b) => b.score - a.score || a.order - b.order);

    const budgetForEvidence = Math.floor(maxChars * 0.7);
    for (const { item } of scored) {
      const text = truncate(item.text, 320);
      if (used + text.length > budgetForEvidence) continue;
      evidence.push({ ...item, text, ref: `E${evidence.length + 1}` });
      used += text.length + 6;
    }

    // Skills are cheap and highly useful: add a single line with relevant skills first.
    if (profile.skills.length > 0) {
      const skills = [...profile.skills].sort(
        (a, b) => overlapScore(questionTokens, b) + overlapScore(jobTokens, b) - (overlapScore(questionTokens, a) + overlapScore(jobTokens, a)),
      );
      const line = truncate(`Skills: ${skills.join(', ')}`, Math.max(120, maxChars - used - 600));
      evidence.push({ kind: 'skill', text: line, ref: `E${evidence.length + 1}` });
      used += line.length;
    }
  }

  const jobSummary = job
    ? truncate(
        [
          job.title && `Role: ${job.title}`,
          job.company && `Company: ${job.company}`,
          job.requirements.length > 0 && `Key requirements: ${job.requirements.slice(0, 8).join('; ')}`,
          job.skills.length > 0 && `Skills sought: ${job.skills.slice(0, 20).join(', ')}`,
        ]
          .filter(Boolean)
          .join('\n'),
        Math.max(200, Math.floor((maxChars - used) * 0.6)),
      )
    : '';

  const candidateHeadline = profile ? [profile.name, profile.headline].filter(Boolean).join(' — ') : '';

  const sections = [
    `CANDIDATE: ${candidateHeadline || '(not provided)'}`,
    hasProfile
      ? `VERIFIED CANDIDATE FACTS (cite by ref):\n${evidence.map((e) => `[${e.ref}] ${e.text}`).join('\n')}`
      : 'VERIFIED CANDIDATE FACTS: none provided. Do not claim any personal experience.',
    `TARGET ROLE:\n${jobSummary || '(no job description provided)'}`,
  ];
  if (input.recentTranscript?.trim()) {
    sections.push(`RECENT CONVERSATION (most recent last):\n${truncate(input.recentTranscript.trim(), 1_200)}`);
  }

  return { evidence, jobSummary, candidateHeadline, hasProfile, text: sections.join('\n\n') };
}
