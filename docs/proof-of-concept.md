# einsager live dictation

A native macOS menu-bar app that sends recorded speech to ChatGPT using the
existing local Codex login. Version 0.2.0 adds the approved Breath e icon,
a small floating dictation bar, hold-to-talk, hands-free, and custom shortcuts.
The bundle identifier remains `local.max.codexdictation.poc` to keep its identity.

## Build and run

```sh
zsh build.sh
open dist/einsager.app
```

Requires macOS, Xcode Command Line Tools, Python 3.10+, and uv. The build creates
an ad-hoc signed app and a project-local Python environment. Keep the project at
its current path because the app references that environment.

## Use

1. Open the app. The menu bar shows the Breath e icon. The floating bar rests
   near the bottom of the display containing the pointer.
2. Click the floating bar for hands-free dictation. Allow Microphone access
   when macOS asks. If authorization is pending, the bar says so and permits cancellation.
3. Choose **Enable hold-to-talk…** from the icon menu or the bar's right-click
   menu. In **System Settings → Privacy & Security → Accessibility**, enable
   einsager. Then choose **Enable hold-to-talk…** again. If macOS requests
   Input Monitoring, enable einsager there too. The keyboard event tap must
   be available for Fn shortcuts and global Escape cancellation.
4. Focus the text field you want to use. **Hold Fn** while speaking, then
   release it to transcribe. A hold shorter than half a second is discarded.
   **Fn+Space** starts or stops hands-free. Clicking the bar also starts it;
   its square stop button finishes it.
5. **Double-tap Fn** within half a second to lock hands-free. A third quick
   press cancels. **Escape** or the cross button cancels an active session.
6. Choose **Customize shortcuts…** from either menu to change hold-to-talk or
   hands-free. Click a shortcut, then press and release your combination.
   Choices save immediately and persist across launches. Hold supports modifiers
   alone or a modified key; hands-free requires a modified key. **Reset to Fn**
   restores Fn and Fn+Space. Shortcut capture suspends runtime dictation keys.
   Plain **Command+V** is reserved for pasting dictated text and cannot be assigned.
   Reconfiguring keyboard access finishes an active hold and transcribes its audio.
   A hold waiting for microphone permission is cancelled; hands-free remains active.
7. Speak. The waveform follows microphone levels. Recording stops at 20 minutes.
   The bar displays processing, a recoverable failure, or insertion feedback.

**Control+Option+Space** remains a permanent hands-free fallback for existing
users. It can work without the keyboard event tap. Ordinary modified key
shortcuts also use Carbon registration when keyboard permission is absent;
modifier-only and Fn combinations need the event tap. If a fallback registration
is already in use, the app reports it. Choose another shortcut or enable keyboard
access. If Wispr or macOS Dictation uses Fn at the same time, choose a custom
Einsager shortcut or change the other app's binding.

Drag the floating bar to dock at the bottom, left, or right. The right-click
menu also offers these positions. The selected edge persists. The bar appears
across Spaces and permits full-screen use without taking text-field focus.

## Insertion and recovery

Automatic paste requires Accessibility access. The app checks the exact focused
application and accessibility element captured when recording began. If either
changes, it keeps the result available for manual paste instead of changing focus.
Choose **Copy last transcript** or the bar's **Copy last** button to recover it.
The app never submits the text field.

“Paste sent” means Command+V was dispatched, not that the receiving app confirmed
insertion. Supported text, HTML, and RTF clipboard data is restored after a short
delay only if the app still owns the clipboard. Unsupported clipboard formats
are not restored; the transcript remains for manual recovery. A clipboard change
made by the user is never overwritten by delayed restoration.

A transcription failure retains one recording for **Retry**. Cancel, a new
recording, successful transcription, or normal quit deletes it. Cancellation
invalidates pending permission, helper, and paste callbacks. **Quit** is in the
icon menu.

## Backend-only check

```sh
uv run python transcribe.py recording.m4a
# WAV files are also accepted.
```

The command prints JSON with `text` or `error`. It reads `$CODEX_HOME/auth.json`,
or `~/.codex/auth.json`, on each request. It never changes or refreshes that file.
If authentication expires, use `codex login`.

Audio is recorded as mono 16 kHz AAC at 32 kbit/s. Twenty minutes is about 4.8 MB
before container overhead at that target bitrate, below the helper's 25 MiB
limit. The request timeout is 90 seconds. Input uses the system's default microphone;
language detection follows the existing backend. Device and language pickers
are not included because their backend/device contracts were not verified.

## Backend and data limits

This uses `https://chatgpt.com/backend-api/transcribe`, an internal endpoint,
not a supported public transcription API. Availability, quotas, and behavior
can change. Successful access does not establish an unlimited allowance or a
pricing guarantee. The interface follows the approved live dictation design;
accuracy, cleanup, and latency are supplied by this backend, not Wispr.

Audio is sent to ChatGPT. Force-killing the app can leave an `einsager-*.m4a`
file in the temporary directory. The earlier backend response included an audio
asset with `asset_ttl` of `30d`; this is not a zero-retention path. The app keeps
only its last transcript in memory. Retry retention ends as described above.

`curl-cffi` supplies Chrome-compatible TLS transport. Requests use a fixed HTTPS
destination and do not follow redirects, so the login token is not forwarded.

## Verification on this Mac, 9 October 2026

- **Passed:** native suite: 90 shortcut, session, placement, and clipboard
  checks; six Python backend tests; native renders of all bar states;
  nonactivating panel and template PDF checks.
- **Passed:** native shortcut editor saved Control+Option+K for hold and
  Control+Shift+Space for hands-free. Reset restored Fn and Fn+Space. Native
  screenshot confirmed labels and controls. The updated packaged app launched.
- **Passed:** generated AAC speech transcribed through the existing backend. A
  20-minute AAC test with speech at 0, 600, and 1190 seconds returned all three
  markers: sunrise, mountain, and river. This checks duration and distant speech
  positions; it does not establish accuracy for dense 20-minute speech.
- **Passed:** controlled build, shell syntax, property list, ad-hoc code signature,
  and whitespace checks. One Swift compiler job ran at a time. Memory free was
  51% before and 55% after the final compile; retained swap stayed near 2.1 GiB;
  disk had 50 GiB available. No owned compiler remained.
- **Blocked:** macOS microphone authorization did not complete during the native
  recording journey. Cancellation returned to idle and kept the external editor
  focused. Physical Fn handling, live recording, and automatic insertion still
  need a user check after Microphone and Accessibility access are enabled.
- **Not verified:** exact pixel matching against Wispr's installed live bar,
  multi-display/full-screen journeys, dense long-form accuracy, and user acceptance.
- **CI, independent review, and merge:** not run. This project has no existing CI
  or nesting/branching checks. None were waived. No PR was requested.

## Compatibility

`Control+Option+Space` is preserved in `KeyBinding.legacyHandsFree` and in the
runtime event tap and Carbon fallback. It remains a permanent user control;
there is no planned removal. The original bundle identifier and WAV helper input
remain supported. There are no stored-data migrations.
