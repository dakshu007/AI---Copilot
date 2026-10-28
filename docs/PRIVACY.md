# Privacy & data handling

Interview Copilot is local-first. This document lists exactly what is stored, where, and what
is sent to which provider. If anything here is unclear, assume the stricter interpretation.

## Principles

- **Nothing leaves your Mac until you start a session and give consent.** Consent is recorded
  separately for transcription (audio) and for answer generation (text), and can be withdrawn in
  **Settings → Privacy** at any time.
- **No telemetry, analytics or crash reporting.** The app makes no network requests other than
  the ones to the providers you configure.
- **No audio is ever written to disk.**
- **No stealth.** The app is an ordinary window. It does not hide from screen sharing or screen
  recording, does not use content protection, and never tampers with Teams, Zoom or Meet.

## What is stored locally

All files live in the app's data folder:
`~/Library/Application Support/Interview Copilot/` on macOS.

| File | Contents | Protection |
| --- | --- | --- |
| `settings.json` | Preferences (providers, model names, theme, consent flags). No secrets. | Plain JSON, user-only file permissions (0600). |
| `secrets.bin` | Your API keys. | Encrypted with Electron `safeStorage`, which on macOS uses a key held in the **macOS Keychain**. If secure storage is unavailable, keys are kept in memory only and never written. |
| `profile.json` | Resume text and the facts you confirmed. | Encrypted with `safeStorage` when available. |
| `job.json` | The job description you pasted and derived requirements. | Encrypted with `safeStorage` when available. |
| `sessions/<id>.json` | Transcript, questions and answers — **only if you turn on history** (off by default). | Encrypted with `safeStorage` when available. Deleted automatically after the retention period you choose (default 30 days). |

**Deletion is real:** "Delete" removes the corresponding file. **Settings → Privacy → Delete all
local data** removes every file above (keys, profile, job description, history and settings).

API keys never appear in the renderer (the UI only receives "a key is set" and its last four
characters), in logs, in error messages (errors are redacted), or in exported sessions.

## What is sent to each provider

### Transcription (only during a live "Permitted assistance" session)

| Provider | What is sent | Notes |
| --- | --- | --- |
| **Deepgram** (`api.deepgram.com`) | Raw 16 kHz audio from the sources you selected (microphone and/or system audio), streamed while the session is listening. | Not sent while paused. Connection is closed when you stop. Subject to [Deepgram's data policy](https://deepgram.com/privacy). |
| **OpenAI-compatible Whisper** (the base URL you set) | Short WAV clips of detected speech (silence is not uploaded). | If the base URL is `localhost`, audio stays on your machine. |
| **Demo** | Nothing. | Plays a scripted interview; no audio is captured at all. |

> If a cloud transcription provider is selected, **your audio is processed in the cloud**. The app
> never claims otherwise.

### Answer generation

| Provider | What is sent |
| --- | --- |
| **Anthropic Claude** (`api.anthropic.com`) | The detected question, up to ~1,200 characters of recent transcript, the role summary from your job description, and only the **most relevant confirmed profile facts** (a bounded excerpt, not your whole resume). |
| **OpenAI-compatible API** (the base URL you set) | Same as above. Local servers (Ollama, LM Studio) keep everything on your machine. |
| **Demo (offline)** | Nothing. Answers are assembled locally from your own profile facts. |

API keys are sent only in the provider's authentication header, never inside prompts.

### Resume import

PDF, DOCX and TXT parsing happens **entirely on your Mac**. Files are size-limited (10 MB),
type-checked by their contents (not just their extension) and never executed.

## Recording and consent laws

Recording or transcribing a conversation may require the consent of all participants where you
live. You are responsible for following the law and the rules of each interview. Use live
assistance **only where the interview organizer permits it**.
