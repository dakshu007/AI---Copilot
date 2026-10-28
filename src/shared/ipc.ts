import { z } from 'zod';
import { AnswerFormatSchema, SecretKindSchema, SessionModeSchema } from './schemas';

export { IPC } from './ipcChannels';

export const StartSessionSchema = z.object({
  mode: SessionModeSchema,
  audioChannels: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  sampleRate: z.number().int().min(8_000).max(48_000),
  channelLabels: z.array(z.string().max(32)).max(2).optional(),
  demo: z.boolean(),
  permittedAcknowledged: z.boolean(),
});

export const SecretSetSchema = z.object({ kind: SecretKindSchema, value: z.string().max(1_024) });
export const MarkQuestionSchema = z.object({
  text: z.string().trim().min(3).max(2_000),
  segmentIds: z.array(z.string().max(128)).max(50).default([]),
  source: z.enum(['manual', 'practice']).default('manual'),
});
export const GenerateSchema = z.object({ questionId: z.string().min(1).max(128), format: AnswerFormatSchema.optional() });
export const FeedbackSchema = z.object({
  questionId: z.string().min(1).max(128),
  createdAt: z.number(),
  feedback: z.enum(['useful', 'not-useful']),
});
export const ImportBytesSchema = z.object({
  fileName: z.string().min(1).max(256),
  bytes: z.instanceof(Uint8Array),
});
export const ExportSchema = z.object({ id: z.string().min(1).max(128), format: z.enum(['md', 'txt']) });
export const SessionIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const ExternalUrlSchema = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === 'https:', 'Only https links can be opened');

/** 16-bit PCM audio frames: at most ~1 s of stereo 48 kHz audio per message. */
export const MAX_AUDIO_FRAME_BYTES = 48_000 * 2 * 2;
