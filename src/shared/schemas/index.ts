import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Transcript                                                          */
/* ------------------------------------------------------------------ */

export const SpeakerRoleSchema = z.enum(['interviewer', 'candidate', 'unknown']);

export const TranscriptSegmentSchema = z.object({
  id: z.string().min(1).max(128),
  text: z.string().max(10_000),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative().optional(),
  speaker: z.string().max(64).optional(),
  role: SpeakerRoleSchema.optional(),
  status: z.enum(['partial', 'final']),
});

/* ------------------------------------------------------------------ */
/* Questions and answers                                               */
/* ------------------------------------------------------------------ */

export const AnswerFormatSchema = z.enum(['concise', 'conversational', 'technical', 'star', 'diplomatic']);

export const QuestionTypeSchema = z.enum([
  'behavioral',
  'technical',
  'situational',
  'role-fit',
  'follow-up',
  'general',
]);

export const DetectedQuestionSchema = z.object({
  id: z.string().min(1).max(128),
  text: z.string().min(1).max(4_000),
  type: QuestionTypeSchema,
  confidence: z.number().min(0).max(1),
  source: z.enum(['detected', 'manual', 'practice']),
  segmentIds: z.array(z.string()).default([]),
  detectedAt: z.number(),
});

export const AnswerSuggestionSchema = z.object({
  questionId: z.string(),
  answer: z.string(),
  format: AnswerFormatSchema,
  evidenceUsed: z.array(z.string()),
  unsupportedClaims: z.array(z.string()),
  followUpQuestion: z.string().optional(),
  createdAt: z.number(),
  // Extensions beyond the minimal contract:
  insufficientEvidence: z.boolean().default(false),
  generalExplanation: z.string().optional(),
  whyThisAnswer: z.string().default(''),
  provider: z.string().default(''),
  isDemo: z.boolean().default(false),
  feedback: z.enum(['useful', 'not-useful']).optional(),
});

/**
 * The exact JSON shape we ask language models to return. Every field is required (nullable
 * where optional) so it works with strict structured-output modes.
 */
export const ModelAnswerSchema = z.object({
  answer: z.string().min(1),
  evidenceUsed: z.array(z.string()),
  unsupportedClaims: z.array(z.string()),
  insufficientResumeEvidence: z.boolean(),
  generalExplanation: z.string().nullable(),
  followUpQuestion: z.string().nullable(),
  whyThisAnswer: z.string(),
});

export const SessionStateSchema = z.enum([
  'idle',
  'requesting-permission',
  'listening',
  'paused',
  'stopping',
  'error',
]);

/**
 * practice — mock questions / demo; assist — permitted interview assistance;
 * meeting — team meetings where you want clearer, better-structured responses.
 */
export const SessionModeSchema = z.enum(['practice', 'assist', 'meeting']);

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export const LlmProviderIdSchema = z.enum(['anthropic', 'openai-compatible', 'demo']);
export const TranscriptionProviderIdSchema = z.enum(['deepgram', 'openai-whisper', 'demo']);
export const AudioSourceSchema = z.enum(['microphone', 'system', 'both']);
export const ThemeSchema = z.enum(['system', 'light', 'dark']);

const httpsUrl = z
  .string()
  .max(512)
  .refine((value) => {
    try {
      const url = new URL(value);
      // Plain http is only allowed for local model servers (Ollama, LM Studio, etc).
      return (
        url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      );
    } catch {
      return false;
    }
  }, 'Must be an https:// URL (http:// is allowed only for localhost)');

export const SettingsSchema = z.object({
  version: z.literal(1).default(1),
  llm: z
    .object({
      provider: LlmProviderIdSchema.default('demo'),
      model: z.string().min(1).max(128).default('claude-opus-5-5'),
      baseUrl: httpsUrl.default('https://api.openai.com/v1'),
      effort: z.enum(['low', 'medium', 'high']).default('low'),
      timeoutMs: z.number().int().min(5_000).max(120_000).default(45_000),
    })
    .prefault({}),
  transcription: z
    .object({
      provider: TranscriptionProviderIdSchema.default('demo'),
      model: z.string().min(1).max(128).default('nova-3'),
      baseUrl: httpsUrl.default('https://api.openai.com/v1'),
      language: z.string().min(2).max(16).default('en'),
    })
    .prefault({}),
  audio: z
    .object({
      source: AudioSourceSchema.default('microphone'),
      microphoneDeviceId: z.string().max(256).optional(),
    })
    .prefault({}),
  answers: z
    .object({
      defaultFormat: AnswerFormatSchema.default('concise'),
      /** Pick STAR for behavioral and technical for technical questions automatically. */
      autoStyle: z.boolean().default(true),
      maxWords: z.number().int().min(40).max(400).default(120),
      autoGenerate: z.boolean().default(true),
    })
    .prefault({}),
  privacy: z
    .object({
      historyEnabled: z.boolean().default(false),
      retentionDays: z.number().int().min(1).max(365).default(30),
      consentLlm: z.boolean().default(false),
      consentTranscription: z.boolean().default(false),
    })
    .prefault({}),
  ui: z
    .object({
      theme: ThemeSchema.default('system'),
      alwaysOnTop: z.boolean().default(false),
      compact: z.boolean().default(false),
      hotkeysEnabled: z.boolean().default(true),
      onboardingDone: z.boolean().default(false),
    })
    .prefault({}),
});

/**
 * Make every field optional *without* applying defaults. (`.partial()` keeps inner defaults in
 * Zod 4, which would silently reset fields the caller did not send.)
 */
function patchOf<Shape extends z.ZodRawShape>(section: z.ZodObject<Shape>) {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(section.shape)) {
    const inner = field instanceof z.ZodDefault ? field.unwrap() : field;
    shape[key] = (inner as z.ZodType).optional();
  }
  return z.object(shape).strict();
}

/** Deep-partial update payload accepted from the renderer. */
export const SettingsUpdateSchema = z
  .object({
    llm: patchOf(SettingsSchema.shape.llm.unwrap()).optional(),
    transcription: patchOf(SettingsSchema.shape.transcription.unwrap()).optional(),
    audio: patchOf(SettingsSchema.shape.audio.unwrap()).optional(),
    answers: patchOf(SettingsSchema.shape.answers.unwrap()).optional(),
    privacy: patchOf(SettingsSchema.shape.privacy.unwrap()).optional(),
    ui: patchOf(SettingsSchema.shape.ui.unwrap()).optional(),
  })
  .strict();

export const SecretKindSchema = z.enum(['llm', 'transcription']);

export const ApiKeySchema = z
  .string()
  .trim()
  .min(8, 'API key looks too short')
  .max(512, 'API key looks too long')
  .regex(/^[\x21-\x7e]+$/, 'API key contains unexpected characters');

/* ------------------------------------------------------------------ */
/* Candidate profile and job description                               */
/* ------------------------------------------------------------------ */

const shortText = z.string().max(2_000);

export const ExperienceSchema = z.object({
  title: shortText,
  company: shortText.default(''),
  period: shortText.default(''),
  highlights: z.array(shortText).max(50).default([]),
});

export const ProjectSchema = z.object({
  name: shortText,
  description: shortText.default(''),
  highlights: z.array(shortText).max(50).default([]),
});

export const CandidateProfileSchema = z.object({
  name: shortText.default(''),
  headline: shortText.default(''),
  summary: z.string().max(5_000).default(''),
  skills: z.array(z.string().max(200)).max(300).default([]),
  experience: z.array(ExperienceSchema).max(50).default([]),
  projects: z.array(ProjectSchema).max(50).default([]),
  achievements: z.array(shortText).max(100).default([]),
  education: z.array(shortText).max(30).default([]),
  additionalFacts: z.array(shortText).max(100).default([]),
  resumeText: z.string().max(200_000).default(''),
  resumeFileName: z.string().max(256).default(''),
  verified: z.boolean().default(false),
  updatedAt: z.number().default(0),
});

export const JobContextSchema = z.object({
  title: shortText.default(''),
  company: shortText.default(''),
  text: z.string().max(100_000).default(''),
  requirements: z.array(shortText).max(100).default([]),
  skills: z.array(z.string().max(200)).max(200).default([]),
  updatedAt: z.number().default(0),
});

/* ------------------------------------------------------------------ */
/* Session history                                                     */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Meeting summary and communication insights                          */
/* ------------------------------------------------------------------ */

export const ActionItemSchema = z.object({
  task: z.string().max(1_000),
  owner: z.string().max(200).nullable(),
  due: z.string().max(200).nullable(),
});

/** Shape requested from language models (every key required, nullable where optional). */
export const ModelSummarySchema = z.object({
  summary: z.string(),
  decisions: z.array(z.string()),
  actionItems: z.array(ActionItemSchema),
  openQuestions: z.array(z.string()),
});

export const MeetingSummarySchema = ModelSummarySchema.extend({
  createdAt: z.number(),
  provider: z.string().default(''),
  isDemo: z.boolean().default(false),
});

export const CommunicationInsightsSchema = z.object({
  yourTalkMs: z.number(),
  othersTalkMs: z.number(),
  yourShare: z.number(),
  yourWords: z.number(),
  wordsPerMinute: z.number().nullable(),
  fillerCount: z.number(),
  fillersPerHundredWords: z.number(),
  topFillers: z.array(z.object({ word: z.string(), count: z.number() })),
  longestMonologueMs: z.number(),
  questionsAsked: z.number(),
  turns: z.number(),
  hasSpeakerSeparation: z.boolean(),
});

export const SessionRecordSchema = z.object({
  id: z.string().min(1).max(128),
  startedAt: z.number(),
  endedAt: z.number().optional(),
  mode: SessionModeSchema,
  isDemo: z.boolean(),
  title: z.string().max(256).default(''),
  segments: z.array(TranscriptSegmentSchema).default([]),
  questions: z.array(DetectedQuestionSchema).default([]),
  answers: z.array(AnswerSuggestionSchema).default([]),
  summary: MeetingSummarySchema.optional(),
  insights: CommunicationInsightsSchema.optional(),
});

export const SessionSummarySchema = z.object({
  id: z.string(),
  startedAt: z.number(),
  endedAt: z.number().optional(),
  mode: SessionModeSchema,
  isDemo: z.boolean(),
  title: z.string(),
  questionCount: z.number(),
  answerCount: z.number(),
  preview: z.string(),
});
