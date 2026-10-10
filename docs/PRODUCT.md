# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The portable app is Electron with a React renderer on Linux, macOS, and
Windows. The native Swift app in `apps/macos/` is a separate, older client.

## Users

The first user is the maintainer, who dictates many times a day into editors,
chat, and terminals. The app serves daily use first: start dictation, get the
text into the field, and recover recent text fast. Open-source users who build
the app themselves come second. Setup guidance appears only when something is
missing.

## Product Purpose

einsager is a dictation app that uses an existing Codex ChatGPT login for
transcription. Hold or press a shortcut, speak, and the transcript reaches the
field you were typing in, or the clipboard when that is not safe.

## Positioning

A Wispr Flow alternative that runs on your own computer and reuses the Codex
login you already have. There is no separate account or subscription. It is
independent of OpenAI and Wispr.

## Operating Context

- A floating pill docks to a screen edge and shows recording, processing, and
  short result messages.
- A tray or menu-bar icon gives access to actions and settings.
- Transcription goes to ChatGPT's internal transcription endpoint through the
  bundled Rust helper. Audio leaves the computer; credentials stay in the helper.

## Capabilities and Constraints

- Portable app: hands-free recording, Retry, Copy last, docking, Codex folder
  selection. Automatic paste works only on Linux X11 with `xdotool`.
  macOS and Windows use manual paste for now.
- Transcript history keeps text, time, length, and a coarse loudness shape.
  Audio is deleted after a successful transcription, as before.
- Clipboard behavior is a setting: always keep the transcript, keep it only if
  paste fails (default), or never. Where the app cannot paste, "only if paste
  fails" keeps the transcript on the clipboard.
- The shortcut is fixed at Ctrl+Alt+Space in the portable app.

## Brand Commitments

- Name: einsager, always lowercase.
- The floating pill follows Wispr Flow's look on the maintainer's request:
  dark pill `#1a1a1a`, cream ink `#ffffeb`, pink accent `#f29be6`.
- Menu-bar icon: the "breath e" template in `assets/icons/`.
- The maintainer asked that the menu and settings look more distinctive than a
  stock system menu, while staying fast to use.

## Evidence on Hand

- Wispr Flow reference captures in `.agents/artifacts/design/wispr-reference/`
  (local, not in Git).
- No user counts, testimonials, or benchmarks exist. Do not invent them.

## Product Principles

1. Speed first: the common path is one shortcut or one click.
2. Never lose text: every transcript stays recoverable until the user deletes it.
3. Respect the clipboard: the user decides when einsager may replace it.
4. Explain only what is missing: setup and errors appear when they apply.
5. Stay local and honest: say where audio goes and what each platform cannot do.
