import { parseModelSummary } from '../../src/shared/core/answerParser';
import { computeInsights, countFillers, insightTips } from '../../src/shared/core/communicationInsights';
import { buildContext } from '../../src/shared/core/contextBuilder';
import { generateDemoAnswer } from '../../src/shared/core/demoAnswer';
import { DEMO_MEETING_SCRIPT } from '../../src/shared/core/demoScript';
import { sessionToMarkdown } from '../../src/shared/core/exporter';
import { generateLocalSummary } from '../../src/shared/core/localSummary';
import { INSUFFICIENT_CONTEXT_SENTENCE, MEETING_SYSTEM_PROMPT, buildUserPrompt, systemPromptFor } from '../../src/shared/core/prompt';
import { SessionRecordSchema } from '../../src/shared/schemas';
import type { TranscriptSegment } from '../../src/shared/types';
import { makeJob, makeProfile } from '../fixtures/profiles';

let n = 0;
function seg(text: string, you: boolean, startMs = 0, endMs?: number, speaker?: string): TranscriptSegment {
  n += 1;
  return { id: `s${n}`, text, startMs, endMs, status: 'final', role: you ? 'candidate' : 'interviewer', speaker: speaker ?? (you ? 'You' : 'Priya') };
}

describe('countFillers', () => {
  it('counts filler words and phrases but not their literal uses', () => {
    const counts = countFillers('Um, I think, you know, it is basically done. Uh, I like it. You know what I mean?');
    expect(counts.get('um')).toBe(1);
    expect(counts.get('uh')).toBe(1);
    expect(counts.get('basically')).toBe(1);
    expect(counts.get('you know')).toBe(1); // "you know what" is not a filler
    expect(counts.get('like')).toBeUndefined(); // "I like it" is not a filler
  });
});

describe('computeInsights', () => {
  it('measures talk share, pace, fillers, monologues and questions for "You"', () => {
    const insights = computeInsights([
      seg('Can we push the release?', false, 0, 3_000),
      seg('Um, I think we can, basically, if QA agrees.', true, 3_000, 9_000),
      seg('What does QA need from us?', true, 9_000, 20_000),
      seg('Two more days.', false, 20_000, 22_000),
      { id: 'p', text: 'ignored partial', startMs: 0, status: 'partial', role: 'candidate' },
    ]);
    expect(insights.hasSpeakerSeparation).toBe(true);
    expect(insights.yourTalkMs).toBe(17_000);
    expect(insights.othersTalkMs).toBe(5_000);
    expect(insights.yourShare).toBeCloseTo(0.773, 2);
    expect(insights.yourWords).toBe(15);
    expect(insights.wordsPerMinute).toBe(53);
    expect(insights.fillerCount).toBe(2);
    expect(insights.questionsAsked).toBe(1);
    expect(insights.turns).toBe(1);
    expect(insights.longestMonologueMs).toBe(17_000);
  });

  it('estimates duration when timing is missing and reports no separation without your speech', () => {
    const insights = computeInsights([seg('one two three four five six seven eight nine ten', false)]);
    expect(insights.othersTalkMs).toBe(4_000);
    expect(insights.hasSpeakerSeparation).toBe(false);
    expect(insightTips(insights)).toEqual([]);
    expect(computeInsights([]).yourShare).toBe(0);
  });

  it('gives balanced, actionable tips', () => {
    const dominating = computeInsights([
      seg('word '.repeat(400).trim(), true, 0, 150_000),
      seg('Okay.', false, 150_000, 151_000),
      seg('um um um so yeah um', true, 151_000, 155_000),
    ]);
    const messages = insightTips(dominating).map((t) => t.message);
    expect(messages.some((m) => m.includes('most of the talking'))).toBe(true);
    expect(messages.some((m) => m.includes('over two minutes'))).toBe(true);

    const balanced = computeInsights([seg('Here is the plan for the week ahead.', true, 0, 20_000), seg('Sounds good to me.', false, 20_000, 40_000)]);
    expect(insightTips(balanced)[0]).toMatchObject({ level: 'good' });
  });
});

describe('generateLocalSummary', () => {
  it('extracts decisions, action items with owners and due dates, and open questions', () => {
    const segments = DEMO_MEETING_SCRIPT.map((line, i) => seg(line.text, line.speaker === 'You', i * 1_000, undefined, line.speaker));
    const summary = generateLocalSummary(segments);
    expect(summary.decisions.join(' ')).toMatch(/two-person rotation/);
    expect(summary.actionItems).toEqual(
      expect.arrayContaining([expect.objectContaining({ task: "I'll chase the platform team for the credentials today.", owner: 'You', due: 'today' })]),
    );
    expect(summary.openQuestions.join(' ')).toMatch(/priority between/);
    expect(summary.summary).toMatch(/3 speakers/);
  });

  it('handles an empty transcript', () => {
    expect(generateLocalSummary([]).summary).toBe('Nothing was transcribed yet.');
  });
});

describe('parseModelSummary', () => {
  it('validates and cleans model output', () => {
    const result = parseModelSummary(
      JSON.stringify({
        summary: ' Release moved. ',
        decisions: ['Ship Friday', '', 3],
        actionItems: [{ task: 'Email QA', owner: 'Alex', due: '' }, { task: '' }, 'junk'],
        openQuestions: null,
      }),
    );
    expect(result).toEqual({
      ok: true,
      value: { summary: 'Release moved.', decisions: ['Ship Friday'], actionItems: [{ task: 'Email QA', owner: 'Alex', due: null }], openQuestions: [] },
    });
    expect(parseModelSummary('nope').ok).toBe(false);
    expect(parseModelSummary({ summary: '' }).ok).toBe(false);
  });
});

describe('meeting prompts and context', () => {
  const notes = 'Release moved to Friday 14 Nov.\n- Checkout migration is blocked on database credentials';

  it('uses a lead-focused system prompt and labels the teammate request', () => {
    expect(systemPromptFor('meeting')).toBe(MEETING_SYSTEM_PROMPT);
    expect(systemPromptFor('assist')).not.toBe(MEETING_SYSTEM_PROMPT);
    expect(MEETING_SYSTEM_PROMPT).toContain('Never invent facts');
    const context = buildContext({ profile: null, job: null, question: 'When do we release?', mode: 'meeting', meetingContext: notes });
    const prompt = buildUserPrompt({ question: 'When do we release?', questionType: 'general', format: 'diplomatic', maxWords: 80, context, mode: 'meeting' });
    expect(prompt).toContain('WHAT THE TEAMMATE SAID');
    expect(prompt).toContain('Format: diplomatic');
  });

  it('turns meeting notes into citable evidence and ignores the job description', () => {
    const context = buildContext({ profile: makeProfile(), job: makeJob(), question: 'Why is checkout blocked?', mode: 'meeting', meetingContext: notes });
    expect(context.hasProfile).toBe(true);
    expect(context.evidence[0]!.text).toBe('Meeting note: Checkout migration is blocked on database credentials');
    expect(context.text).toContain('YOU (THE LEAD)');
    expect(context.text).not.toContain('TARGET ROLE');
    expect(context.text).not.toContain('Staff Backend Engineer');
  });

  it('demo replies use notes, support the diplomatic style, and never guess', () => {
    const context = buildContext({ profile: null, job: null, question: 'Why is checkout blocked?', mode: 'meeting', meetingContext: notes });
    const reply = generateDemoAnswer({ question: 'Why is checkout blocked?', questionType: 'general', format: 'diplomatic', context, mode: 'meeting' });
    expect(reply.answer).toMatch(/^I hear you/);
    expect(reply.answer).toContain('database credentials');

    const empty = buildContext({ profile: null, job: null, question: 'What is the budget for Q3?', mode: 'meeting' });
    const holding = generateDemoAnswer({ question: 'What is the budget for Q3?', questionType: 'general', format: 'concise', context: empty, mode: 'meeting' });
    expect(holding.insufficientResumeEvidence).toBe(true);
    expect(holding.answer.startsWith(INSUFFICIENT_CONTEXT_SENTENCE)).toBe(true);
  });
});

describe('meeting export', () => {
  it('includes the summary, action items and speaking insights', () => {
    const segments = [seg('Can you send the plan?', false, 0, 2_000), seg('Yes, um, today.', true, 2_000, 4_000)];
    const md = sessionToMarkdown(
      SessionRecordSchema.parse({
        id: 'm1',
        startedAt: 0,
        mode: 'meeting',
        isDemo: false,
        title: 'Weekly sync',
        segments,
        summary: {
          summary: 'Plan agreed.',
          decisions: ['Ship Friday'],
          actionItems: [{ task: 'Send the plan', owner: 'You', due: 'today' }],
          openQuestions: ['Who owns QA?'],
          createdAt: 1,
        },
        insights: computeInsights(segments),
      }),
    );
    expect(md).toContain('- Mode: Team meeting');
    expect(md).toContain('## Meeting summary');
    expect(md).toContain('- [ ] Send the plan — You (due today)');
    expect(md).toContain('## Your speaking insights');
    expect(md).toContain('Filler words: 1');
    expect(md).toContain('## Questions and suggested replies');
  });
});
