# Portable desktop app

The first portable layer uses Electron, React, and the existing Rust helper.
It records mono audio, draws the approved pill, supports hands-free dictation,
and copies the transcript for manual paste. Retry retains one temporary
recording. Cancel, a new session, success, and quit remove that recording.

## Build and run

Install Node.js 22.18 or later, pnpm, and Rust on the target OS. From the repository:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

On the coding VM, run installation and builds through the Build skill guard.
If a Fleet command named `cc` precedes the system compiler on Linux, select
`CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=/usr/bin/cc` and
`CC_x86_64_unknown_linux_gnu=/usr/bin/cc` for that command.

`pnpm package` creates a runnable application folder in `release/` for the
current OS and CPU. It bundles that system's Rust helper. Build and package
on macOS for the `.app`, Windows for the `.exe`, and Linux for the Linux binary.
This first layer does not create installers, sign Windows releases, or notarize
Mac releases. Start builds separately for each architecture.

## Codex login

The Rust helper finds the file-based ChatGPT login at:

- `$CODEX_HOME/auth.json` when `CODEX_HOME` is set and nonempty.
- `~/.codex/auth.json` on macOS and Linux.
- The OS user-profile folder on Windows, normally `%USERPROFILE%\.codex\auth.json`.

Use **Select Codex folder…** in the tray or pill context menu for a custom
location, including when the desktop launcher does not inherit your shell
environment. The app stores only that folder path and the docking edge.
It does not locate a Codex executable, copy the login, or change Codex settings.
Only the helper reads credentials at runtime; no tokens reach the renderer.

[Codex authentication documentation](https://learn.chatgpt.com/docs/auth#credential-storage)
also describes keyring and ephemeral logins. This layer supports file storage.
A keychain-only login produces a clear login error; keychain integration is a
remaining migration task. The app does not change credential storage for you.
Audio still goes to ChatGPT's internal transcription endpoint, not a local model.

## Controls and current limits

Click the pill or press **Ctrl+Alt+Space** to start or finish hands-free
recording. Click the check to finish; the cross cancels. Escape is registered
only during a session. Right-click the pill or use the tray menu for docking,
Retry, Copy last, the Codex folder, and Quit. Dock at top, bottom, left, or right,
or drag the pill to an edge.

After transcription, press **⌘V** on macOS or **Ctrl+V** on Windows/Linux in your
editor. This layer does not send a paste to another app. A failed transcription
offers Retry and retains only the current temporary recording. There is no
transcript history or background recording.

Portable recording is 16 kHz, 16-bit mono WAV, capped at 10 minutes so it stays
below the helper's 25 MiB upload limit. Native Mac recording retains the verified
20-minute AAC path. Global hold/release, Fn double/triple taps, automatic paste,
and equivalent input/permission behavior remain migration work. Wayland
compositors can refuse global shortcuts or window placement; clicking the pill
and manual paste remain the fallback. Microphone access requires OS permission.

## Boundaries and choice

`desktop/renderer/` owns audio capture and the visible session. `desktop/main.ts`
owns the window, tray, shortcuts, clipboard, and trusted IPC. Its preload exposes
only the typed operations in `desktop/contract.ts`. The renderer has sandboxing
and context isolation enabled, no Node access, and no external navigation.
`desktop/transcription.ts` owns one temporary WAV and child process. Session
generations reject completions after cancellation or a newer recording.
The Rust helper owns credential lookup, upload, and JSON output.

Keeping AppKit alone would need two new native UIs. Tauri would use less memory
but requires a separate native/webview/audio integration and Linux build
libraries. Electron provides one working recording and UI path with the
existing helper at the cost of a larger download and memory footprint. The
approved look carries over; no new design alternatives are required.

AppKit remains an active Mac client during the staged migration. Remove its UI,
shortcut, packaging, and native test paths only after the portable app passes
Mac recording and recovery acceptance plus the hold/paste parity decisions.
The helper's JSON and WAV/M4A inputs remain active contracts for both callers.

## Checks

```sh
pnpm check
cargo fmt --check
cargo test --locked -j 1
cargo clippy --locked -j 1 --all-targets -- -D warnings
pnpm build
# Run with a desktop session; Linux CI may use xvfb-run -a:
pnpm test:desktop
pnpm package
pnpm test:packaged
```

The desktop smoke test uses a fake microphone and an empty Codex folder. It
checks development and packaged launch, recording, the helper's missing-login
error, Retry, cancel, safe tray Copy, a delayed Mac settings response, and side
docking through renderer sizing and IPC
without a real login or network transcription. Unit tests verify PCM/WAV output,
the upload-size bound, docking, process cancellation, and retained-audio Retry.
Tests with injected fixture helpers verify transcription delivery without
reading real credentials. Mac and Windows live acceptance must run on those OSes.

Menu-highlight lag in the earlier native Mac app remains unresolved.

## First-slice verification, 10 October 2026

Passed on the coding VM: seven portable unit tests, Rust formatting, Git
whitespace checks, README links, and both comparison layouts. The comparison
state buttons and 2× control passed Chromium checks with no page overflow.
The page was previewed in dark mode at 728 px and light mode at 360 px, then
published inline in T3. It is a source reconstruction; native Mac PNGs were not
transferred. The desktop tray PNG derives from the selected Breath e geometry.

Merge preparation also passed dependency installation, strict TypeScript
checking, nine Rust unit tests, two CLI tests, and Clippy with warnings denied.
The guarded run used one compiler job, a 3 GiB group limit, and zero build swap;
peak group memory was 1.65 GiB. A later install step failed because of Electron's
build permission. The explicit runtime installer and allowed dependency build
are now configured together. A later guarded Linux release and desktop build
passed. The first CI run also passed Linux and Mac builds, then found an obsolete
Packager default import. Fixing that reached pnpm's dependency-tree incompatibility
in a local packaging run. Packaging now stages only compiled bundles, the MIT
license, and a minimal runtime manifest; development dependencies are bundled
at build time. The next CI run passed Linux and Windows packaging and both launch
checks. Mac packaging and development launch passed; packaged launch reached
recording, Retry, and cancel, then failed a waveform-height assertion. The
delayed-info check now verifies continuing audio callbacks and a live microphone
track directly, because a steady fake signal can leave the adaptive waveform
flat. Side docking now anchors the pill's center and aligns it to the selected
edge when labels expand. Unit and smoke regressions cover these changes. The
next run passed Mac packaging, both launch checks, all 102 native checks, native
build, plist lint, and code-signature verification. Linux smoke then exposed a
native resize race: reading bounds immediately after `setSize` can retain the
previous size and write it back during docking. Resize now applies the requested
size and dock position in one `setBounds` call. Smoke also waits for renderer and
native dimensions to agree before measuring side placement. The updated
three-OS CI still needs completion.
No live Codex credentials were read or changed, and no
transcription request was made in this work.

Review corrected a tray Copy action that could hide live recording controls,
cancel completion that could reset a newer session, and audio startup from
global shortcuts. Recording teardown now runs only on unmount, so late Mac
settings cannot stop a live microphone. The smoke test covers these interleavings.
Windows
home fallback is tested with an injected path; only Unix CLI tests override
`HOME`, so Windows tests never use a real login to test fallback.

The Checks workflow runs types, unit tests, Rust tests/Clippy, build, packaging,
and a fake-microphone smoke test on Linux, macOS, and Windows. It also runs native
checks, builds, plist lint, and signature verification on macOS. Current CI,
review, and merge results belong to the pull request. Review stays in one agent
under Max's explicit limit; no independent review is claimed. No existing nesting
or branching check was found and no check was waived.

The previous native Mac checks remain separate evidence. This Linux VM cannot
verify physical Mac/Windows microphone permissions, compositor behavior, Fn,
native insertion, or live dictation. Max owns those acceptance checks. The
implementing agent owns build and smoke completion. Next migration decisions
are keychain login support, the recording-duration format, hold/release keys,
and safe automatic insertion. The portable app remains a development slice.
