import { CandidateProfileSchema } from '../schemas';
import type { CandidateProfile, Experience, Project } from '../types';
import { findKnownSkills } from './skillsDictionary';
import { uniqueStrings } from './text';

type Section = 'header' | 'summary' | 'experience' | 'projects' | 'skills' | 'education' | 'achievements' | 'other';

const HEADINGS: Array<[Section, RegExp]> = [
  ['summary', /^(professional )?(summary|profile|about( me)?|objective|overview)$/i],
  ['experience', /^((professional|work|relevant) )?(experience|employment( history)?|work history|career history)$/i],
  ['projects', /^((personal|selected|key|academic|side) )?projects$/i],
  ['skills', /^((technical|core|key) )?(skills|competencies|technologies|tech stack|tools( (&|and) technologies)?|expertise)$/i],
  ['education', /^(education|academics?|qualifications)$/i],
  ['achievements', /^(achievements|accomplishments|awards( (&|and) honou?rs)?|honou?rs|certifications?|publications)$/i],
  ['other', /^(interests|hobbies|languages|references|volunteer(ing)?( experience)?|activities)$/i],
];

const BULLET = /^\s*(?:[•●▪◦‣∙·*\-–—]|\d+[.)])\s+/;
const DATE_RANGE =
  /\b((jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(19|20)\d{2}\s*(?:-|–|—|to)\s*((jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?((19|20)\d{2}|present|current|now|today)\b/i;
const CONTACT = /(@|https?:\/\/|linkedin|github\.com|\+?\d[\d\s().-]{7,}\d)/i;

function headingFor(line: string): Section | null {
  const cleaned = line.replace(/[:|_=#*]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned.length > 40) return null;
  for (const [section, pattern] of HEADINGS) if (pattern.test(cleaned)) return section;
  return null;
}

function stripBullet(line: string): string {
  return line.replace(BULLET, '').trim();
}

function parseRoleLine(line: string): Pick<Experience, 'title' | 'company' | 'period'> {
  const periodMatch = line.match(DATE_RANGE);
  const period = periodMatch ? periodMatch[0].trim() : '';
  const rest = line
    .replace(DATE_RANGE, '')
    .replace(/[()[\]]/g, ' ')
    .replace(/\s+[|,–—-]\s*$/, '')
    .trim();
  const parts = rest
    .split(/\s+(?:at|@)\s+|\s*[|•·]\s*|\s+[–—-]\s+|,\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
  return { title: parts[0] ?? rest, company: parts[1] ?? '', period };
}

/**
 * Local, heuristic resume parser. It extracts a first draft of the profile which the user
 * then reviews and corrects; nothing here is sent anywhere.
 */
export function extractProfile(resumeText: string, fileName = ''): { profile: CandidateProfile; warnings: string[] } {
  const warnings: string[] = [];
  const lines = resumeText
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim());

  const sections: Record<Section, string[]> = {
    header: [], summary: [], experience: [], projects: [], skills: [], education: [], achievements: [], other: [],
  };
  let current: Section = 'header';
  let foundHeading = false;
  for (const line of lines) {
    if (!line) continue;
    const heading = headingFor(line);
    if (heading) {
      current = heading;
      foundHeading = true;
      continue;
    }
    sections[current].push(line);
  }
  if (!foundHeading) warnings.push('No resume section headings were detected. Please review the extracted facts carefully.');

  // Name and headline from the header block.
  const headerLines = sections.header.filter((l) => !CONTACT.test(l));
  const nameCandidate = headerLines[0] ?? '';
  const name =
    nameCandidate && nameCandidate.split(' ').length <= 5 && !/\d/.test(nameCandidate) ? nameCandidate : '';
  const headline = headerLines.find((l) => l !== name && l.length <= 120 && !DATE_RANGE.test(l)) ?? '';
  if (!foundHeading && sections.header.length > 2) {
    // Without headings everything lands in the header; treat the remainder as summary text.
    sections.summary.push(...sections.header.filter((l) => l !== name && l !== headline));
  }

  // Experience entries.
  const experience: Experience[] = [];
  for (const line of sections.experience) {
    const isBullet = BULLET.test(line);
    const looksLikeRole = !isBullet && (DATE_RANGE.test(line) || line.length <= 90);
    const last = experience[experience.length - 1];
    if (looksLikeRole && (!last || last.highlights.length > 0 || DATE_RANGE.test(line) || !last.period)) {
      // A date-only line directly after a role line belongs to that role.
      if (last && last.highlights.length === 0 && !last.period && DATE_RANGE.test(line) && parseRoleLine(line).title.length < 3) {
        last.period = parseRoleLine(line).period;
        continue;
      }
      experience.push({ ...parseRoleLine(line), highlights: [] });
    } else if (last) {
      last.highlights.push(stripBullet(line));
    } else {
      experience.push({ title: stripBullet(line), company: '', period: '', highlights: [] });
    }
  }

  // Projects.
  const projects: Project[] = [];
  for (const line of sections.projects) {
    const last = projects[projects.length - 1];
    if (!BULLET.test(line) && line.length <= 100 && (!last || last.highlights.length > 0 || last.description)) {
      const [projectName, ...description] = line.split(/\s+[–—-]\s+|:\s+/);
      projects.push({ name: (projectName ?? line).trim(), description: description.join(' — ').trim(), highlights: [] });
    } else if (last) {
      if (!last.description && !BULLET.test(line)) last.description = line;
      else last.highlights.push(stripBullet(line));
    }
  }

  // Skills: explicit list items plus known skills found anywhere.
  const listedSkills = sections.skills
    .flatMap((line) => stripBullet(line).replace(/^[^:]{1,30}:\s*/, '').split(/\s*[,;|•·/]\s*/))
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 40);
  const skills = uniqueStrings([...listedSkills, ...findKnownSkills(resumeText)]).slice(0, 120);

  const achievements = uniqueStrings(sections.achievements.map(stripBullet));
  const education = uniqueStrings(sections.education.map(stripBullet));
  const summary = sections.summary.map(stripBullet).join(' ').slice(0, 2_000);

  if (experience.length === 0) warnings.push('No work experience entries were detected.');
  if (skills.length === 0) warnings.push('No skills were detected.');

  const profile = CandidateProfileSchema.parse({
    name,
    headline,
    summary,
    skills,
    experience: experience.slice(0, 50).map((e) => ({ ...e, highlights: e.highlights.slice(0, 50) })),
    projects: projects.slice(0, 50),
    achievements: achievements.slice(0, 100),
    education: education.slice(0, 30),
    additionalFacts: [],
    resumeText: resumeText.slice(0, 200_000),
    resumeFileName: fileName.slice(0, 256),
    verified: false,
    updatedAt: Date.now(),
  });
  return { profile, warnings };
}
