import { extractProfile } from '../../src/shared/core/profileExtractor';

const RESUME = `Jane Doe
Senior Backend Engineer
jane@example.com | +1 555 123 4567 | linkedin.com/in/janedoe

Summary
Backend engineer with 7 years building payment systems.

Experience
Senior Engineer at Acme Payments   Jan 2020 – Present
• Led migration of the payments API to Kubernetes, cutting deploy time by 60%
• Mentored 4 engineers
Software Engineer | Initech | 2016 - 2019
- Built billing services in Java and PostgreSQL

Projects
Ledger — double-entry ledger service
• Designed idempotent transactions

Skills
TypeScript, Go, PostgreSQL; Redis | Docker

Education
BSc Computer Science, State University

Awards
Engineering Excellence Award 2022
`;

describe('extractProfile', () => {
  const { profile, warnings } = extractProfile(RESUME, 'jane.pdf');

  it('extracts name and headline but not contact details', () => {
    expect(profile.name).toBe('Jane Doe');
    expect(profile.headline).toBe('Senior Backend Engineer');
    expect(JSON.stringify(profile.headline)).not.toContain('@');
  });

  it('extracts experience entries with highlights', () => {
    expect(profile.experience).toHaveLength(2);
    expect(profile.experience[0]).toMatchObject({ title: 'Senior Engineer', company: 'Acme Payments', period: 'Jan 2020 – Present' });
    expect(profile.experience[0]!.highlights).toHaveLength(2);
    expect(profile.experience[1]).toMatchObject({ title: 'Software Engineer', company: 'Initech', period: '2016 - 2019' });
  });

  it('extracts skills from the list and known skills elsewhere', () => {
    expect(profile.skills).toEqual(expect.arrayContaining(['TypeScript', 'Go', 'PostgreSQL', 'Redis', 'Docker', 'Java', 'Kubernetes']));
  });

  it('extracts projects, education, achievements and summary', () => {
    expect(profile.projects[0]).toMatchObject({ name: 'Ledger', description: 'double-entry ledger service' });
    expect(profile.projects[0]!.highlights).toEqual(['Designed idempotent transactions']);
    expect(profile.education).toEqual(['BSc Computer Science, State University']);
    expect(profile.achievements).toEqual(['Engineering Excellence Award 2022']);
    expect(profile.summary).toMatch(/payment systems/);
  });

  it('is unverified until the user confirms it', () => {
    expect(profile.verified).toBe(false);
    expect(profile.resumeFileName).toBe('jane.pdf');
    expect(warnings).toEqual([]);
  });

  it('warns when the structure cannot be detected', () => {
    const result = extractProfile('Just a paragraph about me without any headings at all, really.');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.profile.experience).toEqual([]);
  });
});
