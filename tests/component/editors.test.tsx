// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JobDescriptionEditor } from '../../src/renderer/components/JobDescriptionEditor';
import { ProviderSettings } from '../../src/renderer/components/ProviderSettings';
import { ResumeProfileEditor } from '../../src/renderer/components/ResumeProfileEditor';
import { SettingsSchema } from '../../src/shared/schemas';
import type { PublicSettings } from '../../src/shared/types';
import { makeJob, makeProfile } from '../fixtures/profiles';

function publicSettings(overrides: Partial<PublicSettings> = {}): PublicSettings {
  return {
    settings: SettingsSchema.parse({ llm: { provider: 'anthropic' }, transcription: { provider: 'deepgram' } }),
    secrets: {
      llm: { set: true, hint: 'WXYZ', storage: 'persisted' },
      transcription: { set: false, hint: '', storage: 'none' },
    },
    secureStorage: { available: true, backend: 'macOS Keychain' },
    ...overrides,
  };
}

describe('ProviderSettings', () => {
  const handlers = () => ({
    onUpdate: vi.fn().mockResolvedValue(undefined),
    onSetSecret: vi.fn().mockResolvedValue(undefined),
    onClearSecret: vi.fn().mockResolvedValue(undefined),
    onTest: vi.fn().mockResolvedValue({ ok: true, message: 'Connected.', latencyMs: 42 }),
  });

  it('never displays a stored key, only its last four characters', () => {
    render(<ProviderSettings value={publicSettings()} {...handlers()} />);
    const input = screen.getByTestId('llm-key-input');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveValue('');
    expect(screen.getByTestId('llm-key-status')).toHaveTextContent('Key saved (…WXYZ), encrypted with your system keychain.');
  });

  it('saves a key, clears the field, and tests the connection', async () => {
    const h = handlers();
    render(<ProviderSettings value={publicSettings()} {...h} />);
    await userEvent.type(screen.getByTestId('transcription-key-input'), '  dg-key-1234567890  ');
    await userEvent.click(screen.getByTestId('transcription-key-save'));
    expect(h.onSetSecret).toHaveBeenCalledWith('transcription', 'dg-key-1234567890');
    expect(screen.getByTestId('transcription-key-input')).toHaveValue('');
    await userEvent.click(screen.getByTestId('llm-key-test'));
    expect(await screen.findByText('Connected.')).toBeInTheDocument();
    expect(screen.getByText('(42 ms)')).toBeInTheDocument();
  });

  it('switches provider with a sensible default model', async () => {
    const h = handlers();
    render(<ProviderSettings value={publicSettings()} {...h} />);
    await userEvent.selectOptions(screen.getByTestId('llm-provider'), 'openai-compatible');
    expect(h.onUpdate).toHaveBeenCalledWith({ llm: { provider: 'openai-compatible', model: 'gpt-4.1-mini' } });
  });

  it('warns when keys can only be kept in memory', () => {
    render(
      <ProviderSettings
        value={publicSettings({
          secureStorage: { available: false, backend: 'basic_text' },
          secrets: { llm: { set: true, hint: 'ABCD', storage: 'memory' }, transcription: { set: false, hint: '', storage: 'none' } },
        })}
        {...handlers()}
      />,
    );
    expect(screen.getByText(/kept in memory only and must be re-entered/)).toBeInTheDocument();
    expect(screen.getByTestId('llm-key-status')).toHaveTextContent('forgotten when the app quits');
  });

  it('surfaces validation errors from the main process', async () => {
    const h = handlers();
    h.onSetSecret.mockRejectedValue(new Error('API key looks too short'));
    render(<ProviderSettings value={publicSettings()} {...h} />);
    await userEvent.type(screen.getByTestId('llm-key-input'), 'abc');
    await userEvent.click(screen.getByTestId('llm-key-save'));
    expect(await screen.findByRole('alert')).toHaveTextContent('API key looks too short');
  });
});

describe('ResumeProfileEditor', () => {
  const handlers = () => ({
    onImportFile: vi.fn().mockResolvedValue({ fileName: 'cv.pdf', text: 'Jane Doe resume text', profile: makeProfile({ verified: false }), warnings: ['No skills were detected.'] }),
    onImportBytes: vi.fn(),
    onExtractText: vi.fn().mockResolvedValue({ fileName: 'Pasted text', text: 'x', profile: makeProfile({ verified: false, name: 'Pasted Name' }), warnings: [] }),
    onSave: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
  });

  it('imports a file, shows warnings, lets the user edit, and confirms', async () => {
    const h = handlers();
    render(<ResumeProfileEditor profile={null} {...h} />);
    expect(screen.getByTestId('profile-status')).toHaveTextContent('Not confirmed');
    await userEvent.click(screen.getByTestId('import-resume'));
    expect(await screen.findByText(/No skills were detected/)).toBeInTheDocument();
    expect(screen.getByLabelText('Extracted resume text')).toHaveValue('Jane Doe resume text');

    const name = screen.getByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Jane Q. Doe');
    await userEvent.type(screen.getByLabelText('Add to Skills'), 'Terraform{enter}');
    await userEvent.click(screen.getByTestId('confirm-profile'));
    const saved = h.onSave.mock.calls[0]![0];
    expect(saved.verified).toBe(true);
    expect(saved.name).toBe('Jane Q. Doe');
    expect(saved.skills).toContain('Terraform');
    expect(screen.getByTestId('profile-status')).toHaveTextContent('Confirmed');
  });

  it('extracts from pasted text', async () => {
    const h = handlers();
    render(<ResumeProfileEditor profile={null} {...h} />);
    await userEvent.click(screen.getByText('Or paste resume text'));
    await userEvent.type(screen.getByTestId('paste-resume'), 'A long enough pasted resume text for extraction');
    await userEvent.click(screen.getByTestId('extract-resume'));
    expect(await screen.findByDisplayValue('Pasted Name')).toBeInTheDocument();
  });

  it('shows import errors', async () => {
    const h = handlers();
    h.onImportFile.mockRejectedValue(new Error('This file does not look like a valid PDF.'));
    render(<ResumeProfileEditor profile={null} {...h} />);
    await userEvent.click(screen.getByTestId('import-resume'));
    expect(await screen.findByRole('alert')).toHaveTextContent('valid PDF');
  });

  it('marks edits of a confirmed profile as unconfirmed until saved again', async () => {
    render(<ResumeProfileEditor profile={makeProfile()} {...handlers()} />);
    expect(screen.getByTestId('profile-status')).toHaveTextContent('Confirmed');
    await userEvent.type(screen.getByLabelText('Headline'), '!');
    expect(screen.getByTestId('profile-status')).toHaveTextContent('Not confirmed');
  });
});

describe('JobDescriptionEditor', () => {
  it('derives requirements and saves edits', async () => {
    const onAnalyze = vi.fn().mockResolvedValue(makeJob({ text: 'pasted' }));
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<JobDescriptionEditor job={null} onAnalyze={onAnalyze} onSave={onSave} onDelete={vi.fn()} />);
    await userEvent.type(screen.getByTestId('job-text'), 'We need strong Kubernetes and distributed systems experience.');
    await userEvent.click(screen.getByTestId('analyze-job'));
    expect(await screen.findByDisplayValue('Hands-on Kubernetes')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('save-job'));
    expect(onSave.mock.calls[0]![0].requirements).toContain('Experience with distributed systems');
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });
});
