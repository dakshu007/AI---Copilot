export interface DemoLine {
  speaker: 'Interviewer' | 'You';
  text: string;
  /** Delay before this line starts, in ms (scaled by the demo speed). */
  delayMs: number;
}

/**
 * Scripted interview used by the clearly-labelled demo mode. It never pretends to be a real
 * transcript: every demo segment is shown under a DEMO banner.
 */
export const DEMO_SCRIPT: DemoLine[] = [
  { speaker: 'Interviewer', text: 'Hi, thanks for joining today. Can you hear me okay?', delayMs: 600 },
  { speaker: 'You', text: 'Yes, I can hear you clearly. Thanks for having me.', delayMs: 2_000 },
  { speaker: 'Interviewer', text: 'Great. To start, tell me about yourself and what you are working on right now.', delayMs: 2_000 },
  { speaker: 'You', text: 'Sure. I have been focusing on backend services and developer tooling.', delayMs: 6_500 },
  { speaker: 'Interviewer', text: 'Tell me about a time you had to deal with a production incident under pressure.', delayMs: 3_000 },
  { speaker: 'You', text: 'One example that comes to mind is a payments outage.', delayMs: 7_000 },
  { speaker: 'Interviewer', text: 'Interesting. How would you design a rate limiter for a public API?', delayMs: 3_500 },
  { speaker: 'You', text: 'I would start by clarifying the limits and the scale.', delayMs: 7_000 },
  { speaker: 'Interviewer', text: 'Thanks. Last one: why are you interested in this role?', delayMs: 3_000 },
];
