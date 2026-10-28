import { WhisperChunkedProvider } from '../../src/main/services/transcription/WhisperChunkedProvider';
import { DemoTranscriptionProvider } from '../../src/main/services/transcription/DemoTranscriptionProvider';
import { downmix, extractChannel } from '../../src/main/services/transcription/types';
import { encodeWav, rms } from '../../src/main/services/transcription/wav';
import type { TranscriptSegment } from '../../src/shared/types';

const RATE = 16_000;

function tone(ms: number, amplitude = 8_000): Int16Array {
  const out = new Int16Array((RATE * ms) / 1_000);
  for (let i = 0; i < out.length; i += 1) out[i] = Math.round(Math.sin((2 * Math.PI * 220 * i) / RATE) * amplitude);
  return out;
}
const silence = (ms: number) => new Int16Array((RATE * ms) / 1_000);

function feed(session: { sendAudio(frame: Int16Array): void }, audio: Int16Array) {
  for (let i = 0; i < audio.length; i += 1_600) session.sendAudio(audio.subarray(i, i + 1_600));
}

function okResponse(text: string) {
  return new Response(JSON.stringify({ text }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('wav helpers', () => {
  it('encodes a valid mono 16-bit WAV header', () => {
    const wav = encodeWav(new Int16Array([0, 1000, -1000]), RATE);
    const view = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(wav.subarray(8, 12))).toBe('WAVE');
    expect(view.getUint32(24, true)).toBe(RATE);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(6);
    expect(wav.length).toBe(50);
  });

  it('computes levels and splits channels', () => {
    expect(rms(silence(10))).toBe(0);
    expect(rms(tone(10))).toBeGreaterThan(0.1);
    const stereo = new Int16Array([1, 100, 2, 200]);
    expect(Array.from(extractChannel(stereo, 2, 1))).toEqual([100, 200]);
    expect(Array.from(downmix(stereo, 2))).toEqual([51, 101]);
  });
});

describe('WhisperChunkedProvider', () => {
  it('uploads only speech, one request per utterance, and emits partial then final', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(okResponse('Tell me about yourself.')).mockResolvedValueOnce(okResponse('How do you handle conflict?'));
    const provider = new WhisperChunkedProvider({ apiKey: 'sk-test-12345678', baseUrl: 'https://api.example.com/v1/', model: 'whisper-1', fetchImpl });
    const segments: TranscriptSegment[] = [];
    const session = await provider.start(
      { sampleRate: RATE, channels: [{ label: 'Interviewer', role: 'interviewer' }], language: 'en-US' },
      { onSegment: (s) => segments.push({ ...s }), onStatus: () => undefined, onError: () => undefined },
    );
    feed(session, silence(500));
    feed(session, tone(1_200));
    feed(session, silence(900));
    feed(session, tone(800));
    feed(session, silence(900));
    feed(session, silence(3_000));
    await session.finish();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.example.com/v1/audio/transcriptions');
    expect(init.headers.Authorization).toBe('Bearer sk-test-12345678');
    const form = init.body as FormData;
    expect(form.get('model')).toBe('whisper-1');
    expect(form.get('language')).toBe('en');
    expect((form.get('file') as Blob).size).toBeGreaterThan(30_000);

    const finals = segments.filter((s) => s.status === 'final');
    expect(finals.map((s) => s.text)).toEqual(['Tell me about yourself.', 'How do you handle conflict?']);
    expect(finals[0]).toMatchObject({ speaker: 'Interviewer', role: 'interviewer' });
    expect(finals[0]!.startMs).toBeGreaterThanOrEqual(400);
    expect(segments[0]).toMatchObject({ status: 'partial', text: '' });
  });

  it('filters common hallucinations and ignores very short blips', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse('Thank you.'));
    const provider = new WhisperChunkedProvider({ apiKey: 'sk-test-12345678', baseUrl: 'https://api.example.com/v1', model: 'whisper-1', fetchImpl });
    const segments: TranscriptSegment[] = [];
    const session = await provider.start(
      { sampleRate: RATE, channels: [], language: 'en' },
      { onSegment: (s) => segments.push(s), onStatus: () => undefined, onError: () => undefined },
    );
    feed(session, tone(100));
    feed(session, silence(1_000));
    feed(session, tone(1_000));
    feed(session, silence(1_000));
    await session.finish();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(segments.filter((s) => s.status === 'final').every((s) => s.text === '')).toBe(true);
  });

  it('reports auth failures as fatal and keeps the transcript consistent', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    const provider = new WhisperChunkedProvider({ apiKey: 'sk-test-12345678', baseUrl: 'https://api.example.com/v1', model: 'whisper-1', fetchImpl });
    const errors: Array<[string, boolean]> = [];
    const segments: TranscriptSegment[] = [];
    const session = await provider.start(
      { sampleRate: RATE, channels: [], language: 'en' },
      { onSegment: (s) => segments.push(s), onStatus: () => undefined, onError: (e, fatal) => errors.push([e.message, fatal]) },
    );
    feed(session, tone(1_000));
    feed(session, silence(1_000));
    await session.finish();
    expect(errors[0]![1]).toBe(true);
    expect(errors[0]![0]).toMatch(/API key/);
    expect(segments.at(-1)).toMatchObject({ status: 'final', text: '' });
  });

  it('keeps channels separate when given stereo audio', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse('Interviewer speaking'));
    const provider = new WhisperChunkedProvider({ apiKey: 'sk-test-12345678', baseUrl: 'https://api.example.com/v1', model: 'whisper-1', fetchImpl });
    const segments: TranscriptSegment[] = [];
    const session = await provider.start(
      {
        sampleRate: RATE,
        channels: [
          { label: 'You', role: 'candidate' },
          { label: 'Interviewer', role: 'interviewer' },
        ],
        language: 'en',
      },
      { onSegment: (s) => segments.push(s), onStatus: () => undefined, onError: () => undefined },
    );
    // Channel 0 silent, channel 1 speaking.
    const speech = tone(1_000);
    const stereo = new Int16Array(speech.length * 2);
    for (let i = 0; i < speech.length; i += 1) stereo[i * 2 + 1] = speech[i]!;
    feed(session, stereo);
    feed(session, new Int16Array(RATE * 2));
    await session.finish();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(segments.filter((s) => s.status === 'final')[0]).toMatchObject({ speaker: 'Interviewer', text: 'Interviewer speaking' });
  });

  it('treats localhost endpoints as not leaving the machine', () => {
    expect(new WhisperChunkedProvider({ apiKey: 'x', baseUrl: 'http://localhost:8000/v1', model: 'm' }).sendsAudioToCloud).toBe(false);
    expect(new WhisperChunkedProvider({ apiKey: 'x', baseUrl: 'https://api.openai.com/v1', model: 'm' }).sendsAudioToCloud).toBe(true);
  });
});

describe('DemoTranscriptionProvider', () => {
  it('plays a labelled script, supports pause and ends cleanly', async () => {
    vi.useFakeTimers();
    const segments: TranscriptSegment[] = [];
    const onEnded = vi.fn();
    const provider = new DemoTranscriptionProvider({
      speed: 10,
      script: [
        { speaker: 'Interviewer', text: 'Tell me about a time you failed.', delayMs: 100 },
        { speaker: 'You', text: 'Sure.', delayMs: 100 },
      ],
    });
    expect(provider.isDemo).toBe(true);
    expect(provider.sendsAudioToCloud).toBe(false);
    const session = await provider.start({ sampleRate: RATE, channels: [], language: 'en' }, {
      onSegment: (s) => segments.push(s),
      onStatus: () => undefined,
      onError: () => undefined,
      onEnded,
    });
    session.pause();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(segments).toHaveLength(0);
    session.resume();
    await vi.advanceTimersByTimeAsync(5_000);
    const finals = segments.filter((s) => s.status === 'final');
    expect(finals.map((s) => [s.speaker, s.role, s.text])).toEqual([
      ['Interviewer', 'interviewer', 'Tell me about a time you failed.'],
      ['You', 'candidate', 'Sure.'],
    ]);
    expect(segments.some((s) => s.status === 'partial')).toBe(true);
    expect(onEnded).toHaveBeenCalled();
    await session.finish();
    vi.useRealTimers();
  });
});
