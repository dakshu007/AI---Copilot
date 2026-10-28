import { JobContextSchema } from '../schemas';
import type { JobContext } from '../types';
import { findKnownSkills } from './skillsDictionary';
import { uniqueStrings } from './text';

const REQUIREMENT_HINT =
  /\b(experience (with|in)|proficien|knowledge of|familiar(ity)? with|ability to|strong|must|required|requirements?|you have|you will|you'll|degree in|years|expertise|understanding of|hands-on|track record|background in)\b/i;
const BULLET = /^\s*(?:[•●▪◦‣∙·*\-–—]|\d+[.)])\s+/;

/** Derive role requirements from a pasted job description, locally. */
export function analyzeJobDescription(text: string, existing?: Partial<JobContext>): JobContext {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const requirements = uniqueStrings(
    lines
      .filter((line) => (BULLET.test(line) || REQUIREMENT_HINT.test(line)) && line.length >= 12 && line.length <= 300)
      .map((line) => line.replace(BULLET, '').trim())
      .filter((line) => REQUIREMENT_HINT.test(line) || findKnownSkills(line).length > 0),
  ).slice(0, 25);

  const titleLine =
    existing?.title ||
    lines.find((l) => /^(job title|title|role|position)\s*:/i.test(l))?.replace(/^[^:]+:\s*/, '') ||
    lines.find((l) => l.length <= 70 && /\b(engineer|developer|manager|analyst|designer|scientist|lead|architect|consultant|specialist|director|intern)\b/i.test(l)) ||
    '';

  const company =
    existing?.company || lines.find((l) => /^company\s*:/i.test(l))?.replace(/^[^:]+:\s*/, '') || '';

  return JobContextSchema.parse({
    title: titleLine.slice(0, 200),
    company: company.slice(0, 200),
    text: text.slice(0, 100_000),
    requirements,
    skills: findKnownSkills(text).slice(0, 60),
    updatedAt: Date.now(),
  });
}
