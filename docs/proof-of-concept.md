# einsager live dictation

A native macOS menu-bar app that sends recorded speech to ChatGPT using the
existing local Codex login. Version 0.2.0 adds the approved Breath e icon,
a small floating dictation bar, hold-to-talk, hands-free, and custom shortcuts.
The bundle identifier remains `local.max.codexdictation.poc` to keep its identity.

## Native docking repair, 10 October 2026

The surface now receives the selected dock edge. Left and right placement align
the pill and label to that edge; top and bottom retain their centered layout.
This keeps the original handle point inside the expanded pill during hover.
The native probe checks a release at that screen point on all four docks and
saves their hover renders.

Source/caller review and whitespace checks passed. Compilation, native probe,
and renders of this repair remain pending: this VM is Linux, and GitHub Actions
cannot start because of account billing or spending-limit settings. Max must
resolve that block before the implementing agent can verify and merge PR #3.
Earlier native results below cover the code before this repair. Live acceptance
and menu-highlight lag remain unresolved. No compatibility code was added.

## Wispr bar update, 10 October 2026

The bar now uses the classic Wispr pill: a 40×8 pt idle handle, a dotted hover
state, a waveform for hold-to-talk, and gray cancel and white check circles for
hands-free. The hands-free geometry and colors come from the published Wispr
SVG. Screenshot references guide the other states; a pixel match to the current
installed Wispr app is not verified. Processing uses three static pale dots.
Messages, Copy last, and Retry appear in a separate black capsule. Top docking
is available, with the message below the pill. Microphone levels scale to the
recent recording range so quiet speech remains visible.

The README includes a GitHub Mermaid flowchart. The MIT license is included,
and unused icon alternatives and obsolete Python files have been removed.

Passed: Rust formatting, Clippy, 10 Rust tests, 102 native logic checks, native
panel focus/visibility checks, all bar-state renders, packaged build, plist,
code signature, and whitespace checks. The build used one compiler job at a
time. Available memory was 46–50%; swap stayed near 1.6 GiB; disk had 44 GiB
available. No owned compiler remained after completion.

The updated bundle is in `dist/einsager.app`. The running installed copy was
not replaced. Live dictation and design acceptance remain for Max to check.
Menu highlight lag remains unresolved: the earlier profile did not establish
an Einsager cause, and no performance fix is claimed. A reproducible case is
needed for the next diagnosis. CI, independent review, and merge did not run.
No existing nesting or branching check was found, and no checks were waived.
No compatibility code was added; the existing fallback shortcut remains.

## Coding VM handoff, 9 October 2026 UTC

The source payload checksum matched. The VM worktree started clean on the
earlier main version. The available Rust base change and the transferred polish
patch both passed `git apply --check` and were applied without conflicts. The
six named unused icon files were removed after checking source references; the
shipped `assets/icons/einsager-breath.pdf` remains. No old Mac backup folders
were deleted on this VM.

Passed on the VM: `cargo fmt --check`, `git diff --check`, and parsing/rendering
the updated README flowchart with Mermaid 11. The README now includes clipboard
write failure, Copy last, empty transcripts, and the delayed focus/clipboard
recheck. The older plan is marked as history.

Rust tests initially failed because `/home/codex/.fleet/bin/cc` runs Claude,
not a C compiler. The VM verification command selects `/usr/bin/cc` through
per-command Cargo linker and C compiler variables. The retry and Clippy were
blocked by another owner's shared `fleet-build.service`; a bounded two-minute
wait did not obtain the slot. No unprotected compile was attempted. The first
guarded attempt enforced 3 GiB memory and zero build swap, used one Cargo job,
and left no owned compiler running. The guard sampled a peak of about 267 MiB.

The build, 102 native checks, and rendered states described above are evidence
from the Mac handoff. The Mac bundle and old screenshots were not transferred.
Linux has no AppKit or macOS permission/input path, so the native build and live
journeys were omitted here. No checks were waived; no nesting or branching
check exists. CI, independent review, PR, merge, install, and user acceptance
did not run for this handoff. No compatibility code was added.

Next: the implementing agent runs guarded Rust tests and Clippy when the shared
build slot is free. Max checks live dictation, top docking, quiet speech, and
paste recovery with the new Mac bundle. Menu-highlight lag still needs a
reproducible Mac case before a fix can be verified.

## Build and run

```sh
zsh build.sh
ditto dist/einsager.app /Applications/einsager.app
open /Applications/einsager.app
```

Requires macOS, Xcode Command Line Tools, and Rust/Cargo. The build creates an
ad-hoc signed app with a compiled Rust transcription helper in `Contents/MacOS`.
No Python interpreter, uv environment, or repository is needed at runtime.
Run the installed copy in Applications; a development copy inside Documents
can still trigger protected-folder prompts. The approved logo PDF is a checked-in
asset; packaging renders its application icon with Swift.

Dictation needs Microphone access for recording and Accessibility (called
Device Control and Data Access on this Mac) for Fn and automatic paste. It does
not need Documents, Desktop, Downloads, or Full Disk Access. Previously, the
runtime inside this repository caused an unnecessary Documents access request.
That dependency has been removed; Documents permission can stay disabled.

## Use

1. Open the app. The menu bar shows the Breath e icon. The floating bar rests
   near the bottom of the display containing the pointer.
2. Click the floating bar for hands-free dictation. Allow Microphone access
   when macOS asks. If authorization is pending, the bar says so and permits cancellation.
3. Choose **Enable hold-to-talk…** from the icon menu or the bar's right-click
   menu. In **System Settings → Privacy & Security → Accessibility**, enable
   einsager. Return to your editor; Einsager reconnects keyboard access when
   the active application changes. **Enable hold-to-talk…** also retries
   immediately. If macOS requests
   Input Monitoring, enable einsager there too. The keyboard event tap must
   be available for Fn shortcuts and global Escape cancellation.
   Without a listener, the bar says **Click to talk** and its right-click menu
   offers keyboard setup. **Keyboard shortcuts enabled** confirms a listener
   is installed. Local builds use ad-hoc signing, so rebuilding changes their
   code identity. macOS can display permission as enabled while rejecting the
   new build. On this Mac, switching it off and on did not replace the old code
   requirement. Select einsager in the permission list, remove it with the minus
   button, then add `/Applications/einsager.app` with the plus button. Approve
   the macOS authentication prompts, enable the entry, and return to your editor.
   If the listener is still unavailable, quit and reopen Einsager.
4. Focus the text field you want to use. **Hold Fn** while speaking, then
   release it to transcribe. A hold shorter than half a second is discarded.
   **Fn+Space** starts or stops hands-free. Clicking the bar also starts it;
   its check button finishes it.
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

Drag the floating bar to dock at the bottom, top, left, or right. The right-click
menu also offers these positions. The selected edge persists. The bar appears
across Spaces and permits full-screen use without taking text-field focus.

Turn off **Show bar at all times** in the icon menu or the bar's right-click
menu to hide it while idle. The choice persists across launches. Recording,
microphone startup, processing, and recovery feedback remain visible; the bar
hides again when ready. Switching Spaces or displays does not reveal a hidden
idle bar. The icon menu remains available to restore it or start hands-free.
This follows the resting-bar visibility behavior in Wispr's
[Flow bar guide](https://docs.wisprflow.ai/articles/1790396454-move-and-dock-the-flow-bar-on-desktop).
Einsager places this setting in its menus rather than a separate settings page.

## Insertion and recovery

Automatic paste requires Accessibility access. The app checks the exact focused
application and accessibility element captured when recording began. If either
changes, it keeps the result available for manual paste instead of changing focus.
Choose **Copy last transcript** or the bar's **Copy last** button to recover it.
The app never submits the text field.

“Paste sent” means Command+V was dispatched, not that the receiving app confirmed
insertion. Each transcript is copied before insertion and remains on the clipboard,
including when a field rejects paste. The previous clipboard is no longer restored:
that could remove the recovery text when insertion failed. Press Command+V for
manual recovery. If focus changes before insertion, the app copies the transcript
without pasting into a different field. If you copy something else while insertion
is pending, it skips the paste and preserves your new clipboard; **Copy last
transcript** remains available. A clipboard write failure is reported explicitly.

A transcription failure retains one recording for **Retry**. Cancel, a new
recording, successful transcription, or normal quit deletes it. Cancellation
invalidates pending permission, helper, and paste callbacks. **Quit** is in the
icon menu.

## Backend-only check

```sh
./target/release/einsager-transcribe recording.m4a
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

The Rust helper uses `reqwest` with `rustls` for HTTPS and multipart upload.
Requests use a fixed HTTPS destination and do not follow redirects, so the login
token is not forwarded. It sends `originator: Codex Desktop` and the account ID
when present. It returns the same one-line JSON contract to the Swift app.
It reads at most 25 MiB plus one byte before it rejects oversized input; network
errors and service response bodies do not expose credentials in user feedback.

## Verification on this Mac, 9 October 2026

- **Current live acceptance passed:** Max held Fn, dictated into a text field,
  and confirmed insertion without a Documents access request after the runtime
  and permission fixes below. Earlier blocked entries describe prior builds.
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

## Fn connection fix, 9 October 2026

The running app had no keyboard event tap despite the enabled permission switch.
The macOS TCC log reported a failure to match the stored code requirement for
`local.max.codexdictation.poc` and denied Accessibility access. This establishes
that the permission referred to an earlier ad-hoc signed build. Physical key
handling cannot be verified until the user refreshes that permission.

Einsager now retries a missing listener when the active application changes,
so returning from System Settings connects newly granted access. The observer
is removed on quit and does not poll or log keyboard events. The idle bar and
its right-click menu report whether a listener is installed.

Passed: 90 native logic checks, six Python tests, three keyboard-availability
UI assertions, all existing native state renders, shell syntax, build, plist,
installed code signature, and whitespace checks. The updated app was installed
and launched locally. One Swift compiler job ran at a time; available memory
stayed at 51–52%, swap remained near 1.5 GiB, and disk had 48 GiB available.
No owned compiler remained.

Blocked: physical Fn and live dictation acceptance, pending the user's permission
refresh. CI, independent review, PR, and merge did not run. No nesting or branching
check exists in this project, and no checks were waived. No compatibility code
was added. The permanent Control+Option+Space fallback remains supported.

## Idle visibility and paste recovery, 9 October 2026

The persistent **Show bar at all times** control is available from the icon and
bar menus. Native checks cover hidden startup, recording and processing visibility,
return to hidden idle, saved preferences, display and Space changes, immediate
restoration from settings, and cleanup on quit. The running app's new right-click
control was used to turn the setting off, and its saved value was verified.

The old clipboard snapshot and delayed restoration path were removed. A small
`TranscriptClipboard` owns writing and detecting later clipboard changes. The
exact original field is still checked before Command+V is sent; failed or rejected
insertion leaves the transcript available for manual paste.

Passed: 93 native logic checks, six Python tests, native visibility/keyboard
assertions and state renders, shell syntax, build, installed plist/signature,
and whitespace checks. The updated local app launched and hide-at-idle was enabled.
Build controls: one Swift compiler job, 52% available memory, about 1.5 GiB swap,
48 GiB disk available, and no compiler left running.

Blocked: physical Fn, microphone capture, and live insertion acceptance remain
pending refreshed macOS permissions and a user dictation journey. Full Wispr
parity is not claimed: this change matches its documented resting-bar behavior,
with the visibility control in Einsager's menus. CI, independent review, PR, and
merge did not run. No nesting/branching checks exist; none were waived. No
compatibility code was added. Max owns the final permission and live dictation check.

## Permission record repair, 9 October 2026

The enabled switch still failed after the earlier off/on advice. The current
macOS TCC log confirmed that the stored Accessibility code requirement belonged
to an older build; the running app had no keyboard event tap. No app rebuild or
runtime code change was made during this repair.

The stale Einsager entry was removed from Device Control and Data Access using
the system UI. Max approved Touch ID, and the current app was added again with
its existing permission scope. The enabled entry was observed, and a direct
`CGGetEventTapList` check then confirmed an enabled session-level Einsager tap
subscribed to modifier changes, key down, and key up. This is the first verified
active listener in this troubleshooting session. Switching the old entry off
and on was insufficient on this Mac.

Passed: current macOS denial diagnosed, stale entry replaced, live keyboard
listener verified, physical Fn confirmed by Max to reveal the recording bar,
and documentation whitespace check. Runtime tests and builds
were not repeated because the executable was unchanged. CI, review, PR, and
merge did not run. Speech capture, transcription, and live insertion were not
verified during this repair. No compatibility code was added.

## Remove Documents access, 9 October 2026

The installed app's `DictationPython` value pointed into the repository's
`.venv` under Documents. Reading that interpreter and its dependencies caused
an unnecessary protected-folder permission request. The build now installs the
locked Python dependencies in `~/Library/Application Support/einsager/python`.
The helper runs in Python isolated mode with the app's Resources directory as
its working directory. Developer tests can still use the repository environment;
the installed app no longer uses it.

Passed: controlled build, six backend tests, shell syntax, plist, installed
signature, whitespace, and runtime import checks. The runtime check deliberately
set Python environment variables to the repository; isolated mode still imported
the standard library and `curl_cffi` outside Documents, Desktop, and Downloads.
A generated speech fixture in a temporary directory transcribed through the
installed helper with the expected blue-balloon and green-house phrase. Its
interpreter, script, working directory, imports, and audio were outside Documents.

The previous Documents approval was cleared for Einsager only. Its existing
Accessibility approval was refreshed for the new build, and an enabled live
keyboard listener was verified. No Full Disk Access or wider folder permission
was granted. One Swift compiler job ran; available memory was 52–54%, swap stayed
near 1.5 GiB, disk had 47 GiB available, and no compiler/helper remained.

CI, independent review, PR, and merge did not run. The unchanged native gesture
and visibility suite was not repeated; the generated speech check exercises the
changed helper-launch path. No nesting/branching checks exist, and none were
waived. No compatibility code was added. Max confirmed that holding Fn and
dictating into a selected field inserts the text without a Documents access
request. The backend remains ChatGPT;
its transcript wording and latency can differ from Wispr Flow.

## Application icon and reinstall, 9 October 2026

The approved Breath e mark now appears as a white logo on a dark rounded square
in Applications. `scripts/make-app-icon.swift` renders the existing vector PDF
at all ten standard and Retina icon sizes and packages them with `iconutil`.
The build copies the resulting `einsager.icns` into Resources and declares it
in `CFBundleIconFile`.

The app was rebuilt and replaced at `/Applications/einsager.app`, with the
previous installation retained in `.agents/tmp/einsager-before-app-icon.app`.
Finder's Get Info window visibly displayed the new logo. Passed: build, shell
syntax, plist validation, built and installed signatures, all ten icon dimensions,
and whitespace checks. The existing Accessibility scope was renewed for this
build, then the app was restarted. A live event-tap query confirmed an enabled
session keyboard listener for the installed process, with event mask 7168.

Build controls: one Swift compiler job, 53–54% available memory, about 1.5 GiB
swap, 47 GiB disk available, and no compiler left running. CI, independent
review, PR, and merge did not run. The unchanged dictation suites and physical
dictation journey were not repeated for this packaging change; Max's preceding
live insertion acceptance is recorded above. No nesting/branching checks exist,
and none were waived. No compatibility code was added. No blockers remain for
the icon and reinstall request.

## Rust transcription migration, 9 October 2026

The Python transcription helper, its dependency manifests, Python tests, and
Python icon generator were removed. The native Swift interface now starts the
bundled `einsager-transcribe` Rust executable. The helper uses `reqwest`, `rustls`,
and Serde; Cargo dependencies are locked. Packaging and checks need no Python.
The existing vector PDF is the icon source, and Swift renders its application
icon. Existing Python environments were left on disk because this app no longer
uses them and removing shared interpreters is outside this migration.

The OpenAI destination remains `https://chatgpt.com/backend-api/transcribe`,
with the existing Codex login, multipart `file`, `originator: Codex Desktop`, and
optional account header. There is no new public API key, model selection, or
Python fallback. The helper preserves the active WAV/M4A inputs and Swift JSON
contract. Login reads do not modify or refresh Codex credentials. The service
remains internal; official OpenAI documentation does not establish a public
contract for this endpoint. The
[official authentication reference](https://learn.chatgpt.com/docs/config-file/environment-variables#authentication-and-network)
describes Codex access-token authentication separately from public API keys.

Passed: `zsh scripts/check.sh`, including nine Rust tests, formatting, Clippy
with warnings denied, 93 native logic checks, and native bar/visibility renders.
Rust tests check real loopback multipart requests, redirect rejection, WAV/M4A,
Unicode transcripts, missing login, malformed responses, input limits, HTTP and
connection errors, and CLI JSON failures. The first checks failed because `cc`
resolved to Claude Code on this Mac. `.cargo/config.toml` now selects Apple's
Clang for Rust linking and native C dependencies on supported Mac architectures;
the full checks passed after that repair. No nesting/branching checks exist,
and none were waived.

Passed: `zsh build.sh`, built and installed code signatures, plist, and installed
helper artifact comparison. The new app replaced `/Applications/einsager.app`;
the prior app is retained at `.agents/tmp/einsager-before-rust.app`. The obsolete
installed Python script was moved to `.agents/tmp/transcribe-before-rust.py`.
The installed helper links only macOS system libraries. A Swift probe resolved
the helper from the installed bundle and launched it with temporary audio and
the app's Resources working directory, both outside Documents. Its generated
speech transcript matched the audio-format and editor-focus fixture.

The same existing Accessibility scope was renewed, and the installed app was
restarted. An enabled session keyboard tap with event mask 7168 was verified.
The saved hide-at-idle setting remains off for **Show bar at all times**.
Build controls: one Cargo/Swift compiler job, 52–53% available memory, swap near
1.5 GiB, 47 GiB available disk, and no owned compiler left running.

The status view is saved at `.agents/artifacts/current-status.html`. It shows
the runtime path, features, evidence, limitations, and four interactive scenarios.
CI, independent review, PR, and merge did not run. Max's earlier Fn and insertion
acceptance applies to the preceding build; a physical dictation journey after
the Rust migration has not been repeated. Max owns that remaining acceptance
check: focus a field, hold Fn, speak, and release. No implementation blockers
remain. No temporary compatibility code was added.

### Review fixes

A code review of the migration led to these changes:

- Keyboard state comes from whether the event tap is enabled, not only whether
  it exists. When the user switches apps, einsager re-enables a disabled tap or
  returns to the Carbon fallback. It does this only while no dictation is active
  and the shortcut editor is closed, so an Accessibility change cannot end a
  recording.
- A bar hidden at idle while the pointer is over it no longer comes back
  expanded.
- The helper sends an `einsager/<version>` User-Agent. It treats an empty
  `CODEX_HOME` as unset, like Codex. The app no longer sets the helper's
  working directory, because the helper does not use it.
- `build.sh` rebuilds the bundle from empty, so the line that removed the old
  Python script is gone. `scripts/check.sh` now also generates the app icon.

`.cargo/config.toml` stays. einsager builds only on macOS, and on Fleet Macs a
tool named `cc` comes before Apple's compiler in `PATH`.

Passed: `zsh scripts/check.sh` (ten Rust tests, Clippy, 93 native checks, the
bar probe with a hover-reset check, and icon generation), `zsh build.sh`, and
the bundle signature. The rebuilt helper transcribed the generated-speech
fixture through the live endpoint with the new User-Agent. The installed app
was not replaced. The Accessibility revocation path was not tested live.

## Compatibility

`Control+Option+Space` is preserved in `KeyBinding.legacyHandsFree` and in the
runtime event tap and Carbon fallback. It remains a permanent user control;
there is no planned removal. The original bundle identifier and WAV helper input
remain supported. There are no stored-data migrations.
