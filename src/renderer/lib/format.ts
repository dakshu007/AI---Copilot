import type { AnswerFormat, QuestionType } from '@shared/types';

export const FORMAT_LABELS: Record<AnswerFormat, string> = {
  concise: 'Concise',
  conversational: 'Conversational',
  technical: 'Technical',
  star: 'STAR',
  diplomatic: 'Diplomatic',
};

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  behavioral: 'Behavioral',
  technical: 'Technical',
  situational: 'Situational',
  'role-fit': 'Role fit',
  'follow-up': 'Follow-up',
  general: 'General',
};

export function formatOffset(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1_000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent);
export const MOD = isMac ? '⌘' : 'Ctrl';
