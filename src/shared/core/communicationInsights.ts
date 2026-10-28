import type { CommunicationInsights, TranscriptSegment } from '../types';
import { wordCount } from './text';

/** Spoken filler words and phrases worth noticing (multi-word phrases first). */
const FILLERS: Array<[string, RegExp]> = [
  ['you know', /\byou know\b(?! (how|what|why|when|where|that|if|the|about))/g],
  ['i mean', /\bi mean\b/g],
  ['sort of', /\bsort of\b/g],
  ['kind of', /\bkind of\b/g],
  ['basically', /\bbasically\b/g],
  ['literally', /\bliterally\b/g],
  ['actually', /\bactually\b/g],
  ['like', /\blike,/g],
  ['um', /\b(um+|umm+)\b/g],
  ['uh', /\b(uh+|uhm+)\b/g],
  ['er', /\b(er+|erm+)\b/g],
  ['so yeah', /\bso yeah\b/g],
];

/** Words per minute assumed when a segment has no timing (typical conversational pace). */
const ASSUMED_WPM = 150;

function durationMs(segment: TranscriptSegment): number {
  if (segment.endMs !== undefined && segment.endMs > segment.startMs) return segment.endMs - segment.startMs;
  return (wordCount(segment.text) / ASSUMED_WPM) * 60_000;
}

export function countFillers(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  const normalized = ` ${text.toLowerCase().replace(/[’]/g, "'")} `;
  for (const [label, pattern] of FILLERS) {
    const matches = normalized.match(pattern);
    if (matches?.length) counts.set(label, (counts.get(label) ?? 0) + matches.length);
  }
  return counts;
}

/**
 * Local, private speaking metrics for "You" (no AI involved). Needs speaker separation —
 * "Microphone + system audio" — to tell your speech from everyone else's.
 */
export function computeInsights(segments: TranscriptSegment[]): CommunicationInsights {
  const finals = segments.filter((s) => s.status === 'final' && s.text.trim());
  const isYou = (s: TranscriptSegment) => s.role === 'candidate';
  const yours = finals.filter(isYou);
  const others = finals.filter((s) => !isYou(s));

  const yourTalkMs = yours.reduce((sum, s) => sum + durationMs(s), 0);
  const othersTalkMs = others.reduce((sum, s) => sum + durationMs(s), 0);
  const yourWords = yours.reduce((sum, s) => sum + wordCount(s.text), 0);

  const fillerTotals = new Map<string, number>();
  for (const segment of yours) {
    for (const [word, count] of countFillers(segment.text)) fillerTotals.set(word, (fillerTotals.get(word) ?? 0) + count);
  }
  const fillerCount = [...fillerTotals.values()].reduce((a, b) => a + b, 0);

  let longestMonologueMs = 0;
  let current = 0;
  let turns = 0;
  let previousWasYou = false;
  for (const segment of finals) {
    if (isYou(segment)) {
      if (!previousWasYou) turns += 1;
      current += durationMs(segment);
      longestMonologueMs = Math.max(longestMonologueMs, current);
      previousWasYou = true;
    } else {
      current = 0;
      previousWasYou = false;
    }
  }

  const total = yourTalkMs + othersTalkMs;
  return {
    yourTalkMs: Math.round(yourTalkMs),
    othersTalkMs: Math.round(othersTalkMs),
    yourShare: total > 0 ? Number((yourTalkMs / total).toFixed(3)) : 0,
    yourWords,
    // Pace is only meaningful once you have spoken for a little while.
    wordsPerMinute: yourTalkMs >= 15_000 ? Math.round(yourWords / (yourTalkMs / 60_000)) : null,
    fillerCount,
    fillersPerHundredWords: yourWords > 0 ? Number(((fillerCount / yourWords) * 100).toFixed(1)) : 0,
    topFillers: [...fillerTotals.entries()]
      .map(([word, count]) => ({ word, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
    longestMonologueMs: Math.round(longestMonologueMs),
    questionsAsked: yours.filter((s) => s.text.includes('?')).length,
    turns,
    hasSpeakerSeparation: yours.length > 0 && others.length > 0,
  };
}

export interface InsightTip {
  level: 'good' | 'tip';
  message: string;
}

/** Friendly, non-judgemental coaching tips derived from the metrics. */
export function insightTips(insights: CommunicationInsights): InsightTip[] {
  const tips: InsightTip[] = [];
  if (!insights.hasSpeakerSeparation) return tips;
  if (insights.yourShare > 0.6) {
    tips.push({ level: 'tip', message: 'You are doing most of the talking. Try pausing to invite input: "What do you all think?"' });
  } else if (insights.yourShare < 0.15 && insights.othersTalkMs > 60_000) {
    tips.push({ level: 'tip', message: 'You have been quiet. A short summary or a clear decision can help the team move forward.' });
  } else {
    tips.push({ level: 'good', message: 'Balanced conversation: the team is getting room to speak.' });
  }
  if (insights.wordsPerMinute !== null) {
    if (insights.wordsPerMinute > 175) tips.push({ level: 'tip', message: 'You are speaking quickly. Slowing down slightly makes key points land.' });
    else if (insights.wordsPerMinute < 105) tips.push({ level: 'tip', message: 'Your pace is slow. Lead with the main point, then add detail.' });
    else tips.push({ level: 'good', message: 'Your speaking pace is easy to follow.' });
  }
  if (insights.fillersPerHundredWords > 3) {
    const top = insights.topFillers[0]?.word;
    tips.push({ level: 'tip', message: `Watch filler words${top ? ` (mostly "${top}")` : ''}. A short pause sounds more confident.` });
  }
  if (insights.longestMonologueMs > 120_000) {
    tips.push({ level: 'tip', message: 'One of your turns ran over two minutes. Check for understanding before going on.' });
  }
  if (insights.questionsAsked === 0 && insights.turns >= 3) {
    tips.push({ level: 'tip', message: 'Ask an open question to draw out concerns and ideas.' });
  }
  return tips;
}
