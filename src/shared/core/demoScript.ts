export interface DemoLine {
  /** "You" is the user; any other name is another participant. */
  speaker: string;
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

/** Scripted team meeting for the demo in Team meeting mode. */
export const DEMO_MEETING_SCRIPT: DemoLine[] = [
  {
    speaker: 'Priya',
    text: 'Morning everyone. Quick update: the checkout API migration is about eighty percent done, but we are blocked on the database credentials.',
    delayMs: 600,
  },
  { speaker: 'You', text: "Thanks Priya. I'll chase the platform team for the credentials today.", delayMs: 2_500 },
  { speaker: 'Alex', text: 'Can we push the release to next Friday? QA needs two more days for regression testing.', delayMs: 2_500 },
  { speaker: 'You', text: "Um, I think that's, you know, probably fine, but let me check with product first.", delayMs: 6_000 },
  { speaker: 'Priya', text: 'Also, how should we handle the on-call rotation while Sam is on leave?', delayMs: 3_000 },
  { speaker: 'You', text: "Let's go with a two-person rotation for the next two weeks. Alex and I will cover it.", delayMs: 6_000 },
  { speaker: 'Alex', text: "What's the priority between the reporting dashboard and the performance fixes?", delayMs: 3_000 },
  {
    speaker: 'You',
    text: 'Basically, performance first. We agreed last week that customers are feeling the latency, so the dashboard moves to the next sprint.',
    delayMs: 6_000,
  },
  { speaker: 'Priya', text: 'Sounds good. Could you send the updated plan to the team by end of day?', delayMs: 3_000 },
];
