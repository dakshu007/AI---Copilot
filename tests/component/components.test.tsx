// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CaptureStatusIndicator } from '../../src/renderer/components/CaptureStatusIndicator';
import { LiveTranscript } from '../../src/renderer/components/LiveTranscript';
import { QuestionCard } from '../../src/renderer/components/QuestionCard';
import { SessionControls } from '../../src/renderer/components/SessionControls';
import { SuggestedAnswer } from '../../src/renderer/components/SuggestedAnswer';
import type { AnswerSuggestion, DetectedQuestion } from '../../src/shared/types';

const suggestion: AnswerSuggestion = {
  questionId: 'q1',
  answer: 'I led the Kubernetes migration at Acme.',
  format: 'star',
  evidenceUsed: ['E1: Kubernetes migration'],
  unsupportedClaims: ['Saved $2M per year'],
  followUpQuestion: 'What would you change?',
  createdAt: 1,
  insufficientEvidence: false,
  generalExplanation: 'Generally, migrations are staged.',
  whyThisAnswer: 'E1 matches the question.',
  provider: 'Claude (claude-opus-5-5)',
  isDemo: false,
};

const question: DetectedQuestion = {
  id: 'q1',
  text: 'Tell me about a migration you led.',
  type: 'behavioral',
  confidence: 0.9,
  source: 'detected',
  segmentIds: [],
  detectedAt: 0,
};

describe('CaptureStatusIndicator', () => {
  it('shows a prominent listening state while capturing real audio', () => {
    render(<CaptureStatusIndicator state="listening" isDemo={false} usesAudio />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Listening');
    expect(status).toHaveAttribute('data-state', 'listening');
    expect(status).toHaveTextContent('Microphone or system audio is being captured.');
  });

  it('distinguishes demo, paused, error and idle states', () => {
    const { rerender } = render(<CaptureStatusIndicator state="listening" isDemo usesAudio={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('Demo playing — no audio captured');
    rerender(<CaptureStatusIndicator state="paused" isDemo={false} usesAudio />);
    expect(screen.getByRole('status')).toHaveTextContent('Paused — not transcribing');
    rerender(<CaptureStatusIndicator state="error" isDemo={false} usesAudio />);
    expect(screen.getByRole('status')).toHaveTextContent('Stopped — error');
    rerender(<CaptureStatusIndicator state="idle" isDemo={false} usesAudio />);
    expect(screen.getByRole('status')).toHaveTextContent('Not listening');
    rerender(<CaptureStatusIndicator state="listening" isDemo={false} usesAudio transcriptionStatus="reconnecting" />);
    expect(screen.getByRole('status')).toHaveTextContent('reconnecting');
  });
});

describe('SessionControls', () => {
  const handlers = () => ({ onStart: vi.fn(), onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn() });

  it('offers Start when idle and explains why it is disabled', async () => {
    const h = handlers();
    const { rerender } = render(<SessionControls state="idle" canStart {...h} />);
    await userEvent.click(screen.getByRole('button', { name: /start session/i }));
    expect(h.onStart).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /stop/i })).not.toBeInTheDocument();
    rerender(<SessionControls state="idle" canStart={false} startDisabledReason="Confirm first." {...h} />);
    expect(screen.getByRole('button', { name: /start session/i })).toBeDisabled();
    expect(screen.getByText('Confirm first.')).toBeInTheDocument();
  });

  it('always offers Stop while running, paused, or after an error', async () => {
    const h = handlers();
    const { rerender } = render(<SessionControls state="listening" canStart {...h} />);
    await userEvent.click(screen.getByRole('button', { name: /pause/i }));
    await userEvent.click(screen.getByRole('button', { name: /^stop/i }));
    expect(h.onPause).toHaveBeenCalled();
    expect(h.onStop).toHaveBeenCalledTimes(1);
    rerender(<SessionControls state="paused" canStart {...h} />);
    await userEvent.click(screen.getByRole('button', { name: /resume/i }));
    expect(h.onResume).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^stop/i })).toBeEnabled();
    rerender(<SessionControls state="requesting-permission" canStart {...h} />);
    expect(screen.getByRole('button', { name: /^stop/i })).toBeEnabled();
    rerender(<SessionControls state="error" canStart {...h} />);
    await userEvent.click(screen.getByRole('button', { name: /reset/i }));
    expect(h.onStop).toHaveBeenCalledTimes(2);
  });
});

describe('SuggestedAnswer', () => {
  it('shows the answer, separates general knowledge and warns about unsupported claims', () => {
    render(<SuggestedAnswer suggestion={suggestion} />);
    expect(screen.getByTestId('answer-text')).toHaveTextContent('I led the Kubernetes migration at Acme.');
    expect(screen.getByText('General knowledge — not your experience')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('Saved $2M per year');
    expect(screen.getByText(/Likely follow-up/)).toBeInTheDocument();
  });

  it('copies, rates, and explains "Why this answer?"', async () => {
    const onCopy = vi.fn();
    const onFeedback = vi.fn();
    render(<SuggestedAnswer suggestion={suggestion} onCopy={onCopy} onFeedback={onFeedback} />);
    await userEvent.click(screen.getByRole('button', { name: /copy/i }));
    expect(onCopy).toHaveBeenCalledWith(suggestion.answer);
    expect(await screen.findByText('Copied')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /mark answer as useful/i }));
    expect(onFeedback).toHaveBeenCalledWith('useful');
    expect(screen.getByRole('button', { name: /mark answer as useful/i })).toHaveAttribute('aria-pressed', 'true');
    const why = screen.getByRole('button', { name: /why this answer/i });
    expect(why).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(why);
    expect(screen.getByTestId('why-panel')).toHaveTextContent('E1: Kubernetes migration');
  });

  it('labels demo answers and missing resume detail', () => {
    render(<SuggestedAnswer suggestion={{ ...suggestion, isDemo: true, insufficientEvidence: true, unsupportedClaims: [] }} />);
    expect(screen.getByText('Demo answer')).toBeInTheDocument();
    expect(screen.getByText('Not enough resume detail')).toBeInTheDocument();
  });
});

describe('QuestionCard', () => {
  const props = () => ({ onGenerate: vi.fn(), onCancel: vi.fn(), onFeedback: vi.fn() });

  it('shows loading state with cancellation', async () => {
    const p = props();
    render(<QuestionCard question={question} answers={[]} generating="star" {...p} />);
    expect(screen.getByTestId('generating')).toHaveTextContent('Generating star answer');
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(p.onCancel).toHaveBeenCalled();
  });

  it('offers simpler / technical / STAR variants once an answer exists', async () => {
    const p = props();
    render(<QuestionCard question={question} answers={[suggestion]} {...p} />);
    const group = screen.getByRole('group', { name: /regenerate answer/i });
    await userEvent.click(within(group).getByRole('button', { name: 'More technical' }));
    await userEvent.click(within(group).getByRole('button', { name: 'Simpler' }));
    expect(p.onGenerate.mock.calls).toEqual([['technical'], ['concise']]);
  });

  it('shows errors with a retry action', async () => {
    const p = props();
    const { rerender } = render(<QuestionCard question={question} answers={[]} error={{ message: 'Rate limited', retryable: true }} {...p} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Rate limited');
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(p.onGenerate).toHaveBeenCalledWith();
    rerender(<QuestionCard question={question} answers={[]} error={{ message: 'Bad key', retryable: false }} {...p} />);
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });

  it('lets the user request an answer manually', async () => {
    const p = props();
    render(<QuestionCard question={{ ...question, source: 'manual' }} answers={[]} {...p} />);
    expect(screen.getByText('manual')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /suggest an answer/i }));
    expect(p.onGenerate).toHaveBeenCalled();
  });
});

describe('LiveTranscript', () => {
  it('renders partial and final segments and marks a line as a question', async () => {
    const onMark = vi.fn();
    render(
      <LiveTranscript
        isDemo
        onMarkQuestion={onMark}
        segments={[
          { id: 'a', text: 'Our stack is mostly Go', startMs: 65_000, status: 'final', speaker: 'Interviewer', role: 'interviewer' },
          { id: 'b', text: 'and what', startMs: 70_000, status: 'partial', speaker: 'Interviewer', role: 'interviewer' },
          { id: 'c', text: '', startMs: 71_000, status: 'final' },
        ]}
      />,
    );
    expect(screen.getByText('Demo')).toBeInTheDocument();
    expect(screen.getByText('01:05')).toBeInTheDocument();
    expect(screen.getByText('and what')).toHaveClass('italic');
    expect(screen.getAllByText(/Interviewer/)).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: /mark as question: our stack is mostly go/i }));
    expect(onMark).toHaveBeenCalledWith('Our stack is mostly Go', ['a']);
  });

  it('shows an empty state', () => {
    render(<LiveTranscript isDemo={false} onMarkQuestion={vi.fn()} segments={[]} emptyHint="Nothing yet" />);
    expect(screen.getByText('Nothing yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mark selection/i })).toBeDisabled();
  });
});
