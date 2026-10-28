// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommunicationInsights } from '../../src/renderer/components/CommunicationInsights';
import { MeetingSummaryCard, summaryToMarkdown } from '../../src/renderer/components/MeetingSummaryCard';
import { QuestionCard } from '../../src/renderer/components/QuestionCard';
import { initialSessionStore, sessionReducer } from '../../src/renderer/hooks/useSessionStore';
import type { MeetingSummary, TranscriptSegment } from '../../src/shared/types';

const summary: MeetingSummary = {
  summary: 'We agreed the release plan.',
  decisions: ['Ship on Friday'],
  actionItems: [{ task: 'Send the updated plan', owner: 'You', due: 'end of day' }],
  openQuestions: ['Who covers QA?'],
  createdAt: 1,
  provider: 'Claude (claude-opus-5-5)',
  isDemo: false,
};

describe('MeetingSummaryCard', () => {
  it('invites a summary and is disabled without a transcript', async () => {
    const onSummarize = vi.fn();
    const { rerender } = render(<MeetingSummaryCard summarizing={false} canSummarize={false} onSummarize={onSummarize} />);
    expect(screen.getByTestId('summarize')).toBeDisabled();
    rerender(<MeetingSummaryCard summarizing={false} canSummarize onSummarize={onSummarize} />);
    await userEvent.click(screen.getByTestId('summarize'));
    expect(onSummarize).toHaveBeenCalled();
  });

  it('shows decisions, action items with owner and due date, and open questions', () => {
    render(<MeetingSummaryCard summary={summary} summarizing={false} canSummarize onSummarize={vi.fn()} />);
    expect(screen.getByText('We agreed the release plan.')).toBeInTheDocument();
    expect(screen.getByText('Ship on Friday')).toBeInTheDocument();
    expect(within(screen.getByTestId('action-items')).getByText(/You, due end of day/)).toBeInTheDocument();
    expect(screen.getByText('Who covers QA?')).toBeInTheDocument();
    expect(screen.getByTestId('summarize')).toHaveTextContent('Update summary');
  });

  it('shows errors and a loading state', () => {
    render(<MeetingSummaryCard summarizing canSummarize error="Consent needed" onSummarize={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Consent needed');
    expect(screen.getByTestId('summarize')).toBeDisabled();
  });

  it('exports Markdown with checkboxes', () => {
    expect(summaryToMarkdown(summary)).toContain('- [ ] Send the updated plan — You (due end of day)');
  });
});

describe('CommunicationInsights', () => {
  it('explains how to enable insights without speaker separation', () => {
    render(<CommunicationInsights segments={[]} />);
    expect(screen.getByTestId('insights-empty')).toHaveTextContent('Microphone + system audio');
  });

  it('shows talk share, fillers and tips', () => {
    const segments: TranscriptSegment[] = [
      { id: '1', text: 'What is the status?', startMs: 0, endMs: 2_000, status: 'final', role: 'interviewer', speaker: 'Priya' },
      { id: '2', text: 'Um, basically we are on track, um, mostly.', startMs: 2_000, endMs: 8_000, status: 'final', role: 'candidate', speaker: 'You' },
    ];
    render(<CommunicationInsights segments={segments} />);
    expect(screen.getByRole('meter', { name: /your share of talk time/i })).toHaveAttribute('aria-valuenow', '75');
    expect(screen.getByTestId('filler-count')).toHaveTextContent('3');
    expect(screen.getByText('um ×2, basically ×1')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: /coaching tips/i })).toBeInTheDocument();
  });
});

describe('QuestionCard in a team meeting', () => {
  it('offers meeting-appropriate reply styles', async () => {
    const onGenerate = vi.fn();
    render(
      <QuestionCard
        mode="meeting"
        question={{ id: 'q', text: 'Can we push the release?', type: 'general', confidence: 1, source: 'detected', segmentIds: [], detectedAt: 0 }}
        answers={[]}
        onGenerate={onGenerate}
        onCancel={vi.fn()}
        onFeedback={vi.fn()}
        error={{ message: 'Rate limited', retryable: true }}
      />,
    );
    const group = screen.getByRole('group', { name: /regenerate/i });
    expect(within(group).queryByRole('button', { name: 'STAR' })).not.toBeInTheDocument();
    await userEvent.click(within(group).getByRole('button', { name: 'More diplomatic' }));
    expect(onGenerate).toHaveBeenCalledWith('diplomatic');
  });
});

describe('summary reducer events', () => {
  it('tracks summary progress and results', () => {
    let store = sessionReducer(initialSessionStore, { type: 'event', event: { type: 'summary-start' } });
    expect(store.summarizing).toBe(true);
    store = sessionReducer(store, { type: 'event', event: { type: 'summary', summary } });
    expect(store).toMatchObject({ summarizing: false, summary });
    store = sessionReducer(store, { type: 'event', event: { type: 'summary-error', message: 'nope' } });
    expect(store).toMatchObject({ summarizing: false, summaryError: 'nope' });
  });
});
