# Platform notes & limitations

**Target platform: macOS 12 Monterey or later** (Apple Silicon and Intel). The app also runs on
Windows and Linux, with the differences noted below.

## Microphone

- macOS asks for microphone permission the first time you start a live session
  (`NSMicrophoneUsageDescription`). If you denied it, enable **Interview Copilot** in
  **System Settings → Privacy & Security → Microphone**. The app links you there when needed.
- Choose a specific input device in **Settings → Audio** (device names appear after permission is
  granted).

## System audio (hearing the interviewer)

macOS does not offer a simple "capture what the speakers play" API to apps. Options, best first:

1. **Built-in capture (macOS 13+; best on macOS 14.2+).** Choose *System audio* or
   *Microphone + system audio* as the source. The app uses Chromium's macOS loopback capture
   (ScreenCaptureKit / Core Audio taps). macOS asks for **Screen & System Audio Recording**
   permission (`NSAudioCaptureUsageDescription`). The screen video that macOS requires for this is
   discarded immediately and never recorded. This path depends on Chromium/Electron features that
   Apple and Google change frequently; if it fails on your macOS version, use option 2.
2. **Virtual audio device (works on all macOS versions).** Install a loopback driver such as
   [BlackHole](https://existential.audio/blackhole/), create a *Multi-Output Device* in
   **Audio MIDI Setup** (your speakers + BlackHole) so you still hear the call, then select
   BlackHole as the microphone in **Settings → Audio**.
3. **Microphone only.** Works anywhere, but will also pick up your own voice; Deepgram's
   diarization then labels speakers as "Speaker 1/2".

With *Microphone + system audio*, the two sources are kept on separate channels, so the
transcript reliably labels **You** and **Interviewer** and your own answers are never mistaken
for questions.

**Other platforms:** Windows supports system-audio loopback natively. On Linux, select your
PulseAudio/PipeWire *Monitor* source as the microphone.

> Built-in system-audio capture could not be exercised in this project's automated tests (they
> run on Linux in CI-style containers). Microphone capture, the audio pipeline and transcription
> are covered end to end with Chromium's fake audio device.

## Screen sharing (Teams, Zoom, Meet)

- Interview Copilot is a **normal window**. If you share your **entire screen** or this
  window, other participants **can see it**. Share a specific window or tab instead if you do not
  want it shown — and only use live assistance where the organizer permits it.
- *Always on top* is off by default; turning it on does not hide the window from sharing.
- The app never uses content protection, invisible overlays, process hiding or any other
  screen-capture evasion, and never interacts with or modifies the meeting app.
- Tips: put the compact window (**Settings → Compact window**) on a second display, or beside the
  meeting window.

### Separate answer window & background mode

- **Answer window** (button on the Session page) opens a second, read-only window that mirrors the
  suggested answers. Move it to another monitor, or minimize the dashboard — the app disables
  background throttling (`backgroundThrottling: false`) so capture, transcription and answer
  generation keep running while the dashboard is not in the foreground.
- The answer window is a **normal OS window**. It is kept out of a screen share only by what you
  choose to share — a single application window, or a display you are not sharing. The app does
  **not** use content protection, window hiding, or any screen-capture evasion, and does not claim
  to be invisible to capture. If you share your whole desktop, the window is visible.
- `always-on-top` is used for the answer window so it floats above a full-screen meeting app on
  your own screen; this has no effect on what the other participants see.
- This could not be verified against a real macOS screen share or `minimize()` in this project's
  Linux test containers; the broadcast of answers to the second window and background event flow
  are covered by the automated end-to-end test.

## Keyboard shortcuts

Shortcuts are **window-local**: they only work while Interview Copilot is focused, so they never
override Teams (`⌘⇧M` mute, `⌘⇧O` camera, `⌘⇧E` share…), Zoom or Meet controls. Global hotkeys
were deliberately not implemented.

## Transcription providers

| Provider | Latency | Speaker labels | Notes |
| --- | --- | --- | --- |
| Deepgram streaming | ~300 ms interim results | Per channel, or diarized | Recommended. Auto-reconnects up to 5 times, buffering ~5 s of audio. |
| OpenAI-compatible Whisper | ~1–3 s after each utterance | Per channel | Uploads only detected speech. Works with OpenAI, Groq, or a local server. |
| Demo | — | Scripted | Clearly labelled; no audio is captured. |

## Answer quality

- Question detection is a fast local heuristic. It favours precision; you can always mark any
  transcript line (hover → `?`) or selected text (`⌘⇧Q`) as a question.
- Answers use only facts you confirmed on the Profile page. Unconfirmed profiles are not used.
- Models can still make mistakes. Claims not backed by your profile are flagged in the UI; read
  before you speak.

## Packaging & signing

- `npm run dist:mac` must run **on a Mac** (DMG creation and code signing need macOS tools). It
  produces DMG and ZIP builds for `arm64` and `x64`.
- Without an Apple Developer ID the app is unsigned; Gatekeeper will require
  **right-click → Open** the first time. To sign and notarize, set the variables listed in
  `.env.example` and enable `notarize` in `electron-builder.yml`.
- The app has no native Node modules, so the same source builds cleanly for both architectures.

## Known limitations

- Scanned (image-only) PDFs have no text layer; paste the resume text instead (OCR is not
  included).
- Profile extraction from resumes is heuristic; always review the extracted facts before
  confirming.
- No auto-update mechanism is included.
