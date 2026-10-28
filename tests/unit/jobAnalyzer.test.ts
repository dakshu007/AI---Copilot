import { analyzeJobDescription } from '../../src/shared/core/jobAnalyzer';

const JD = `Job title: Staff Backend Engineer
Company: Globex

About the role
You will own our payments platform.

Requirements
• 5+ years of experience with distributed systems
• Hands-on experience with Kubernetes and Terraform
• Strong communication skills
• Free snacks
`;

describe('analyzeJobDescription', () => {
  it('derives title, company, requirements and skills', () => {
    const job = analyzeJobDescription(JD);
    expect(job.title).toBe('Staff Backend Engineer');
    expect(job.company).toBe('Globex');
    expect(job.requirements).toEqual(
      expect.arrayContaining(['5+ years of experience with distributed systems', 'Hands-on experience with Kubernetes and Terraform']),
    );
    expect(job.requirements).not.toContain('Free snacks');
    expect(job.skills).toEqual(expect.arrayContaining(['Kubernetes', 'Terraform', 'Distributed Systems']));
  });

  it('keeps user-provided title and company', () => {
    const job = analyzeJobDescription(JD, { title: 'My title', company: 'My co' });
    expect(job.title).toBe('My title');
    expect(job.company).toBe('My co');
  });
});
