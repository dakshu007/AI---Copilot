import type { SecureSettingsService } from './storage/SecureSettingsService';
import { AnthropicProvider } from './llm/AnthropicProvider';
import { DemoAnswerProvider } from './llm/DemoAnswerProvider';
import { OpenAICompatibleProvider } from './llm/OpenAICompatibleProvider';
import type { AnswerProvider } from './llm/types';
import { DeepgramProvider } from './transcription/DeepgramProvider';
import { DemoTranscriptionProvider } from './transcription/DemoTranscriptionProvider';
import { WhisperChunkedProvider } from './transcription/WhisperChunkedProvider';
import type { TranscriptionProvider } from './transcription/types';
import { ProviderError } from '@shared/core/retry';

export class MissingKeyError extends ProviderError {
  constructor(what: string) {
    super(`Add your ${what} API key in Settings first.`, { code: 'config' });
  }
}

export function createAnswerProvider(settings: SecureSettingsService): AnswerProvider {
  const { llm } = settings.get();
  if (llm.provider === 'demo') return new DemoAnswerProvider();
  const apiKey = settings.getSecret('llm');
  if (!apiKey) throw new MissingKeyError(llm.provider === 'anthropic' ? 'Anthropic' : 'AI provider');
  if (llm.provider === 'anthropic') {
    return new AnthropicProvider({ apiKey, model: llm.model, effort: llm.effort, timeoutMs: llm.timeoutMs });
  }
  return new OpenAICompatibleProvider({ apiKey, baseUrl: llm.baseUrl, model: llm.model, timeoutMs: llm.timeoutMs });
}

export function createTranscriptionProvider(
  settings: SecureSettingsService,
  options: { forceDemo?: boolean; demoSpeed?: number } = {},
): TranscriptionProvider {
  const { transcription } = settings.get();
  if (options.forceDemo || transcription.provider === 'demo') {
    return new DemoTranscriptionProvider({ speed: options.demoSpeed });
  }
  const apiKey = settings.getSecret('transcription');
  if (!apiKey) throw new MissingKeyError(transcription.provider === 'deepgram' ? 'Deepgram' : 'transcription');
  if (transcription.provider === 'deepgram') return new DeepgramProvider({ apiKey, model: transcription.model });
  return new WhisperChunkedProvider({ apiKey, baseUrl: transcription.baseUrl, model: transcription.model });
}
