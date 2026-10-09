# einsager proof of concept

The project folder and visible app name are lowercase `einsager`. The bundle
identifier stays `local.max.codexdictation.poc` to retain the app's identity
across the rename.

A native macOS menu-bar app for one-way dictation using the local Codex ChatGPT
login. No OpenAI Platform API key is used.

## Run

```sh
zsh build.sh
open "dist/einsager.app"
```

Requires macOS, Xcode Command Line Tools, Python 3.10+, and uv. The build creates
an ad-hoc signed app and a project-local Python environment. Keep the project at
its current path: the app references that environment.

1. Open the app. Its menu-bar label is **einsager**.
2. Focus the input field where you want the text.
3. Press **Control + Option + Space** to start. Allow the macOS microphone prompt.
4. Speak. Press the same shortcut to stop.
5. The app transcribes the recording and copies the result to the clipboard.
6. Choose **Allow automatic paste…** in the menu and grant Accessibility access
   in macOS settings to enable automatic paste. Without that permission, use
   Command+V. The app does not submit the pasted text.

The label changes to **● REC** during recording and **einsager …** during transcription.
Recording stops after two minutes. The shortcut has no effect during transcription.
Use **Copy last transcript** to recover the latest result if insertion fails.
Quit through the menu.

## Backend-only check

```sh
uv run python transcribe.py recording.wav
```

Use a WAV recording. The command prints JSON with `text` or `error`. It reads
`$CODEX_HOME/auth.json`, or `~/.codex/auth.json`, on each request. It never writes
or refreshes that file. If authentication expires, use `codex login`.

## Limits and data handling

This uses `https://chatgpt.com/backend-api/transcribe`, an internal endpoint,
not a supported public transcription API. Availability, quotas, and behavior
can change. Successful access does not establish an unlimited allowance or a
pricing guarantee.

Audio is sent to ChatGPT. Temporary microphone recordings are deleted after the
request, on error, or on a normal quit. Force-killing the app can leave a temporary
WAV file. The tested backend response included an audio asset with `asset_ttl`
of `30d`; this is not a zero-retention path. The app retains only the last
transcript in memory, and overwrites the clipboard when text arrives.

The app restores the application focused when recording began, checks focus,
then sends Command+V. It cannot guarantee insertion into the same input field
if you change windows or fields during transcription. Clipboard content remains
available for manual paste.

`curl-cffi` supplies the request transport. Standard-library urllib encountered
a Cloudflare challenge on this Mac; a Chrome-compatible TLS transport returned
the expected transcript. Requests use a fixed HTTPS destination and do not
follow redirects, so the login token is not forwarded to another destination.

## Existing projects

- [Wangnov/codex-asr](https://github.com/Wangnov/codex-asr): Rust CLI and local
  Whisper-compatible REST bridge using the Codex login.
- [nakasyou/codex-transcribe](https://github.com/nakasyou/codex-transcribe):
  recorded-file transcription using Codex authentication.
- [OpenWhispr OAuth request](https://github.com/OpenWhispr/openwhispr/issues/1319):
  native subscription sign-in request; its initial scope concerns text cleanup
  rather than a stable speech API.

This proof of concept implements the requested hotkey and paste workflow without
requiring OpenWhispr configuration. The Python backend can be reused in a future
OpenWhispr adapter. No backward compatibility code was added.

## Verification on this Mac

- Rename verification: rebuilt from the `einsager/` folder with one Swift
  compiler job. Shell and Python syntax, dependency import, bundle name,
  relocated Python path, property list, and code signature passed. Launch
  Services started `dist/einsager.app`; the new process remained running.
  Memory free percentage stayed at 37%; no compiler process remained.
  Live microphone, hotkey, and paste were not rechecked after this rename.

- Passed: generated speech uploaded through the packaged Python environment and
  the existing ChatGPT login, with HTTP 200 and the expected text:
  “This is a test of Codex dictation. The quick brown fox jumps over the lazy dog.”
- Passed: missing login and empty recordings produce clear errors.
- Passed: Swift build, Python syntax, shell syntax, property-list validation,
  and ad-hoc code-signature validation.
- Passed: Launch Services started the packaged app and its process remained running.
- Blocked: native UI inspection timed out twice. Live microphone recording,
  global hotkey handling, and paste into another app still need a manual check
  with the microphone and Accessibility permissions enabled.
- CI and code review did not run; this scratch project has no CI, review process,
  or existing nesting/branching checks. No separate nesting check was added.
- Build controls: one Swift compiler job; local memory, load, disk, and compiler
  process checks before/during build. Reported memory free percentage was 44%
  before and 57% afterward; available disk space was 59 GiB. No compiler process
  remained after the build.
