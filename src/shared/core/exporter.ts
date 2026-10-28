import type { SessionRecord } from '../types';

const MODE_LABELS = { practice: 'Practice', assist: 'Permitted assistance', meeting: 'Team meeting' } as const;

function time(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

function offset(ms: number): string {
  const total = Math.floor(ms / 1_000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** Session export never contains credentials: session records do not store any. */
export function sessionToMarkdown(session: SessionRecord): string {
  const lines: string[] = [
    `# ${session.title || 'Interview session'}`,
    '',
    `- Started: ${time(session.startedAt)} UTC`,
    session.endedAt ? `- Ended: ${time(session.endedAt)} UTC` : '- Ended: (in progress)',
    `- Mode: ${MODE_LABELS[session.mode]}${session.isDemo ? ' (DEMO data)' : ''}`,
    '',
  ];
  if (session.summary) {
    const summary = session.summary;
    lines.push('## Meeting summary', '', summary.summary, '');
    if (summary.decisions.length) lines.push('**Decisions**', '', ...summary.decisions.map((d) => `- ${d}`), '');
    if (summary.actionItems.length) {
      lines.push(
        '**Action items**',
        '',
        ...summary.actionItems.map((a) => `- [ ] ${a.task}${a.owner ? ` — ${a.owner}` : ''}${a.due ? ` (due ${a.due})` : ''}`),
        '',
      );
    }
    if (summary.openQuestions.length) lines.push('**Open questions**', '', ...summary.openQuestions.map((q) => `- ${q}`), '');
  }
  if (session.insights?.hasSpeakerSeparation) {
    const i = session.insights;
    lines.push(
      '## Your speaking insights',
      '',
      `- Talk time: ${Math.round(i.yourShare * 100)}% (${Math.round(i.yourTalkMs / 1_000)} s)`,
      `- Pace: ${i.wordsPerMinute ?? '—'} words per minute`,
      `- Filler words: ${i.fillerCount} (${i.fillersPerHundredWords} per 100 words)`,
      `- Questions you asked: ${i.questionsAsked}`,
      '',
    );
  }
  lines.push('## Transcript', '');
  const finals = session.segments.filter((s) => s.status === 'final' && s.text.trim());
  if (finals.length === 0) lines.push('_No transcript._');
  for (const segment of finals) {
    lines.push(`**[${offset(segment.startMs)}] ${segment.speaker ?? 'Speaker'}:** ${segment.text.trim()}`);
    lines.push('');
  }
  lines.push(session.mode === 'meeting' ? '## Questions and suggested replies' : '## Questions and suggested answers', '');
  if (session.questions.length === 0) lines.push('_No questions._');
  for (const question of session.questions) {
    lines.push(`### ${question.text}`, '', `_Type: ${question.type} · Source: ${question.source}_`, '');
    const answers = session.answers.filter((a) => a.questionId === question.id);
    for (const answer of answers) {
      lines.push(`**Suggested answer (${answer.format})${answer.isDemo ? ' — demo' : ''}:**`, '', answer.answer, '');
      if (answer.generalExplanation) lines.push(`_General explanation:_ ${answer.generalExplanation}`, '');
      if (answer.evidenceUsed.length) lines.push(`_Evidence:_ ${answer.evidenceUsed.join('; ')}`, '');
      if (answer.feedback) lines.push(`_Marked ${answer.feedback}_`, '');
    }
  }
  return `${lines.join('\n').trim()}\n`;
}

export function sessionToText(session: SessionRecord): string {
  return sessionToMarkdown(session)
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/(^|\s)_(.*?)_(?=\s|$)/g, '$1$2');
}
