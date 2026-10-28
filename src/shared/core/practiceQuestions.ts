import type { JobContext, QuestionType } from '../types';

export interface PracticeQuestion {
  text: string;
  type: QuestionType;
}

export const GENERAL_PRACTICE_QUESTIONS: PracticeQuestion[] = [
  { text: 'Tell me about yourself.', type: 'role-fit' },
  { text: 'Why are you interested in this role?', type: 'role-fit' },
  { text: 'Tell me about a time you had a conflict with a teammate. How did you resolve it?', type: 'behavioral' },
  { text: 'Describe a project you are most proud of and your specific contribution.', type: 'behavioral' },
  { text: 'Tell me about a time you made a mistake. What did you learn?', type: 'behavioral' },
  { text: 'Give me an example of when you had to meet a tight deadline.', type: 'behavioral' },
  { text: 'How do you prioritize when everything seems urgent?', type: 'situational' },
  { text: 'What would you do if you disagreed with your manager about a technical decision?', type: 'situational' },
  { text: 'What is your greatest strength, and how has it helped your team?', type: 'role-fit' },
  { text: 'How would you design a URL shortener that handles millions of requests per day?', type: 'technical' },
  { text: 'Explain the difference between a process and a thread.', type: 'technical' },
  { text: 'How would you find and fix a memory leak in a production service?', type: 'technical' },
  { text: 'What are the trade-offs between SQL and NoSQL databases?', type: 'technical' },
  { text: 'Where do you see yourself in three years?', type: 'role-fit' },
];

/** Questions tailored to the job description's skills and requirements. */
export function practiceQuestionsForJob(job: JobContext | null): PracticeQuestion[] {
  if (!job) return [];
  const questions: PracticeQuestion[] = [];
  for (const skill of job.skills.slice(0, 5)) {
    questions.push({ text: `Can you walk me through how you've used ${skill} in a real project?`, type: 'technical' });
  }
  for (const requirement of job.requirements.slice(0, 4)) {
    const short = requirement.replace(/\.$/, '');
    questions.push({ text: `This role asks for: "${short}". How does your experience match that?`, type: 'role-fit' });
  }
  if (job.title) questions.unshift({ text: `Why do you think you'd be a strong ${job.title}?`, type: 'role-fit' });
  return questions;
}
