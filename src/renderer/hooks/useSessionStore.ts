import type {
  AnswerFormat,
  AnswerSuggestion,
  DetectedQuestion,
  SessionEvent,
  SessionMode,
  SessionState,
  TranscriptSegment,
  TranscriptionStatus,
} from '@shared/types';

export interface Notice {
  id: number;
  level: 'info' | 'warning' | 'error';
  message: string;
}

export interface SessionStore {
  state: SessionState;
  mode: SessionMode | null;
  isDemo: boolean;
  sessionId: string | null;
  message?: string;
  segments: TranscriptSegment[];
  questions: DetectedQuestion[];
  answers: Record<string, AnswerSuggestion[]>;
  generating: Record<string, AnswerFormat>;
  answerErrors: Record<string, { message: string; retryable: boolean }>;
  transcriptionStatus: TranscriptionStatus;
  notices: Notice[];
  levels: number[];
}

export const initialSessionStore: SessionStore = {
  state: 'idle',
  mode: null,
  isDemo: false,
  sessionId: null,
  segments: [],
  questions: [],
  answers: {},
  generating: {},
  answerErrors: {},
  transcriptionStatus: 'idle',
  notices: [],
  levels: [],
};

export type SessionAction =
  | { type: 'event'; event: SessionEvent }
  | { type: 'local-state'; state: SessionState; message?: string }
  | { type: 'levels'; levels: number[] }
  | { type: 'dismiss-notice'; id: number }
  | { type: 'notice'; level: Notice['level']; message: string }
  | { type: 'hydrate'; snapshot: Partial<SessionStore> & { answersList?: AnswerSuggestion[] } };

let noticeId = 0;

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

function addNotice(store: SessionStore, level: Notice['level'], message: string): SessionStore {
  // Avoid stacking identical notices.
  if (store.notices.some((n) => n.message === message)) return store;
  noticeId += 1;
  return { ...store, notices: [...store.notices.slice(-3), { id: noticeId, level, message }] };
}

export function sessionReducer(store: SessionStore, action: SessionAction): SessionStore {
  switch (action.type) {
    case 'local-state':
      return { ...store, state: action.state, message: action.message };
    case 'levels':
      return { ...store, levels: action.levels };
    case 'dismiss-notice':
      return { ...store, notices: store.notices.filter((n) => n.id !== action.id) };
    case 'notice':
      return addNotice(store, action.level, action.message);
    case 'hydrate': {
      const answers: Record<string, AnswerSuggestion[]> = {};
      for (const answer of action.snapshot.answersList ?? []) {
        (answers[answer.questionId] ??= []).push(answer);
      }
      const { answersList: _ignored, ...rest } = action.snapshot;
      return { ...store, ...rest, answers: { ...store.answers, ...answers } };
    }
    case 'event':
      return applyEvent(store, action.event);
    default:
      return store;
  }
}

function applyEvent(store: SessionStore, event: SessionEvent): SessionStore {
  switch (event.type) {
    case 'state': {
      const isNewSession = event.sessionId !== null && event.sessionId !== store.sessionId && event.state === 'listening';
      const base = isNewSession
        ? { ...store, segments: [], questions: [], answers: {}, generating: {}, answerErrors: {} }
        : store;
      return {
        ...base,
        state: event.state,
        mode: event.mode,
        isDemo: event.isDemo,
        sessionId: event.sessionId,
        message: event.message,
        levels: event.state === 'listening' ? base.levels : [],
        transcriptionStatus: event.state === 'idle' ? 'idle' : base.transcriptionStatus,
      };
    }
    case 'segment': {
      const index = store.segments.findIndex((s) => s.id === event.segment.id);
      const segments = [...store.segments];
      if (index >= 0) segments[index] = event.segment;
      else segments.push(event.segment);
      return { ...store, segments: segments.slice(-1_000) };
    }
    case 'question':
      if (store.questions.some((q) => q.id === event.question.id)) return store;
      return { ...store, questions: [event.question, ...store.questions] };
    case 'answer-start':
      return {
        ...store,
        generating: { ...store.generating, [event.questionId]: event.format },
        answerErrors: withoutKey(store.answerErrors, event.questionId),
      };
    case 'answer': {
      const id = event.suggestion.questionId;
      return {
        ...store,
        generating: withoutKey(store.generating, id),
        answers: { ...store.answers, [id]: [...(store.answers[id] ?? []), event.suggestion].slice(-5) },
      };
    }
    case 'answer-error':
      return {
        ...store,
        generating: withoutKey(store.generating, event.questionId),
        answerErrors: { ...store.answerErrors, [event.questionId]: { message: event.message, retryable: event.retryable } },
      };
    case 'answer-cancelled':
      return { ...store, generating: withoutKey(store.generating, event.questionId) };
    case 'transcription-status': {
      const next = { ...store, transcriptionStatus: event.status };
      return event.status === 'reconnecting' && event.message ? addNotice(next, 'warning', event.message) : next;
    }
    case 'notice':
      return addNotice(store, event.level, event.message);
    default:
      return store;
  }
}
