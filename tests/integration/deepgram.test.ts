import { DeepgramProvider, type WebSocketLike } from '../../src/main/services/transcription/DeepgramProvider';
import type { ChannelInfo, TranscriptionCallbacks } from '../../src/main/services/transcription/types';
import type { TranscriptSegment, TranscriptionStatus } from '../../src/shared/types';

class FakeSocket implements WebSocketLike {
  static instances: FakeSocket[] = [];
  readyState = 0;
  binaryType = 'blob';
  sent: unknown[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  closedWith: number | null = null;
  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {
    FakeSocket.instances.push(this);
  }
  send(data: unknown) {
    this.sent.push(data);
  }
  close(code?: number) {
    this.closedWith = code ?? 1000;
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  serverClose(code: number, reason = '') {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
  result(text: string, options: { final?: boolean; channel?: number; start?: number; speaker?: number } = {}) {
    this.onmessage?.({
      data: JSON.stringify({
        type: 'Results',
        channel_index: [options.channel ?? 0, 2],
        is_final: options.final ?? false,
        start: options.start ?? 1.5,
        duration: 1,
        channel: { alternatives: [{ transcript: text, words: options.speaker !== undefined ? [{ speaker: options.speaker }] : [] }] },
      }),
    });
  }
}

function callbacks() {
  const segments: TranscriptSegment[] = [];
  const statuses: TranscriptionStatus[] = [];
  const errors: Array<{ message: string; fatal: boolean }> = [];
  const cb: TranscriptionCallbacks = {
    onSegment: (s) => segments.push(s),
    onStatus: (s) => statuses.push(s),
    onError: (e, fatal) => errors.push({ message: e.message, fatal }),
  };
  return { cb, segments, statuses, errors };
}

const KEY = 'dg-secret-key-123456';

function provider(extra: Partial<ConstructorParameters<typeof DeepgramProvider>[0]> = {}) {
  return new DeepgramProvider({
    apiKey: KEY,
    model: 'nova-3',
    createWebSocket: (url, protocols) => new FakeSocket(url, protocols),
    keepAliveMs: 1_000,
    ...extra,
  });
}

async function startSession(
  channels: ChannelInfo[] = [
    { label: 'You', role: 'candidate' },
    { label: 'Interviewer', role: 'interviewer' },
  ],
) {
  const c = callbacks();
  const promise = provider().start({ sampleRate: 16_000, channels, language: 'en' }, c.cb);
  const socket = FakeSocket.instances.at(-1)!;
  socket.open();
  const session = await promise;
  return { ...c, socket, session };
}

describe('DeepgramProvider', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
  });
  afterEach(() => vi.useRealTimers());

  it('authenticates with a sub-protocol and never puts the key in the URL', async () => {
    const { socket } = await startSession();
    expect(socket.protocols).toEqual(['token', KEY]);
    expect(socket.url).not.toContain(KEY);
    const url = new URL(socket.url);
    expect(url.searchParams.get('multichannel')).toBe('true');
    expect(url.searchParams.get('channels')).toBe('2');
    expect(url.searchParams.get('encoding')).toBe('linear16');
    expect(url.searchParams.get('interim_results')).toBe('true');
  });

  it('uses diarization for a single channel', () => {
    const url = new URL(provider().buildUrl({ sampleRate: 16_000, channels: [{ label: 'Mic', role: 'unknown' }], language: 'en' }));
    expect(url.searchParams.get('diarize')).toBe('true');
    expect(url.searchParams.has('multichannel')).toBe(false);
  });

  it('maps interim and final results to partial and final segments per channel', async () => {
    const { socket, segments } = await startSession();
    socket.result('Tell me', { channel: 1 });
    socket.result('Tell me about yourself.', { channel: 1, final: true });
    socket.result('Sure', { channel: 0, final: true, start: 3 });
    expect(segments[0]).toMatchObject({ text: 'Tell me', status: 'partial', speaker: 'Interviewer', role: 'interviewer' });
    expect(segments[1]).toMatchObject({ id: segments[0]!.id, text: 'Tell me about yourself.', status: 'final', startMs: 1_500, endMs: 2_500 });
    expect(segments[2]).toMatchObject({ speaker: 'You', role: 'candidate', status: 'final', startMs: 3_000 });
    expect(segments[2]!.id).not.toBe(segments[0]!.id);
  });

  it('labels diarized speakers for single-channel audio', async () => {
    const { socket, segments } = await startSession([{ label: 'Mic', role: 'unknown' }]);
    socket.result('Hello there', { final: true, speaker: 1 });
    expect(segments[0]).toMatchObject({ speaker: 'Speaker 2', role: 'unknown' });
  });

  it('sends audio, drops it while paused, and ignores junk messages', async () => {
    const { socket, session } = await startSession();
    session.sendAudio(new Int16Array([1, 2, 3, 4]));
    session.pause();
    session.sendAudio(new Int16Array([5, 6]));
    session.resume();
    session.sendAudio(new Int16Array([7, 8]));
    expect(socket.sent.filter((d) => d instanceof ArrayBuffer)).toHaveLength(2);
    expect(() => socket.onmessage?.({ data: 'not json' })).not.toThrow();
  });

  it('sends KeepAlive messages', async () => {
    vi.useFakeTimers();
    const { socket, session } = await startSession();
    vi.advanceTimersByTime(2_100);
    expect(socket.sent.filter((d) => d === JSON.stringify({ type: 'KeepAlive' }))).toHaveLength(2);
    session.close();
  });

  it('reconnects after an unexpected drop and replays buffered audio', async () => {
    vi.useFakeTimers();
    const { socket, statuses, session } = await startSession();
    socket.serverClose(1011, 'server restart');
    expect(statuses).toContain('reconnecting');
    session.sendAudio(new Int16Array([9, 9, 9]));
    vi.advanceTimersByTime(600);
    const second = FakeSocket.instances.at(-1)!;
    expect(second).not.toBe(socket);
    second.open();
    expect(statuses.at(-1)).toBe('connected');
    expect(second.sent.some((d) => d instanceof ArrayBuffer)).toBe(true);
    session.close();
  });

  it('gives up after the maximum number of reconnect attempts', async () => {
    vi.useFakeTimers();
    const c = callbacks();
    const promise = provider({ maxReconnectAttempts: 2 }).start({ sampleRate: 16_000, channels: [], language: 'en' }, c.cb);
    FakeSocket.instances.at(-1)!.open();
    await promise;
    for (let i = 0; i < 3; i += 1) {
      FakeSocket.instances.at(-1)!.serverClose(1006);
      await vi.advanceTimersByTimeAsync(10_000);
    }
    expect(c.errors.at(-1)).toMatchObject({ fatal: true });
    expect(c.errors.at(-1)!.message).toMatch(/could not reconnect/);
    expect(FakeSocket.instances.length).toBe(3);
  });

  it('reports an authentication failure when the connection is refused', async () => {
    const c = callbacks();
    const promise = provider().start({ sampleRate: 16_000, channels: [], language: 'en' }, c.cb);
    FakeSocket.instances.at(-1)!.serverClose(1008, 'Unauthorized');
    await expect(promise).rejects.toMatchObject({ options: { code: 'auth' } });
  });

  it('finishes by sending CloseStream and closing', async () => {
    const { socket, session, statuses } = await startSession();
    const finished = session.finish();
    expect(socket.sent).toContain(JSON.stringify({ type: 'CloseStream' }));
    socket.serverClose(1000);
    await finished;
    expect(statuses.at(-1)).toBe('closed');
    expect(socket.closedWith).toBe(null); // server closed it; we did not need to
  });

  it('close() is idempotent and stops everything', async () => {
    const { socket, session, statuses } = await startSession();
    session.close();
    session.close();
    expect(statuses.filter((s) => s === 'closed')).toHaveLength(1);
    expect(socket.closedWith).toBe(1000);
    session.sendAudio(new Int16Array([1]));
    expect(socket.sent.filter((d) => d instanceof ArrayBuffer)).toHaveLength(0);
  });

  it('tests the key without leaking it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    const result = await provider({ fetchImpl }).testConnection();
    expect(result).toEqual({ ok: false, message: 'Deepgram rejected the API key.' });
    expect(fetchImpl.mock.calls[0]![1].headers.Authorization).toBe(`Token ${KEY}`);
    const failing = vi.fn().mockRejectedValue(new Error(`network down for ${KEY}`));
    expect((await provider({ fetchImpl: failing }).testConnection()).message).not.toContain(KEY);
  });
});
