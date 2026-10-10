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

Copy last can copy an earlier transcript while a failed recording stays available
for Retry. A failure to create or write the temporary recording discards any
partial file and disables Retry; fix the storage problem and start a new dictation.

Portable recording is 16 kHz, 16-bit mono WAV, capped at 10 minutes so it stays
below the helper's 25 MiB upload limit. Native Mac recording retains the verified
20-minute AAC path. Global hold/release, Fn double/triple taps, automatic paste,
and equivalent input/permission behavior remain migration work. Wayland
compositors can refuse global shortcuts or window placement; clicking the pill
and manual paste remain the fallback. Microphone access requires OS permission.

## Boundaries and choice

The [architecture guide](architecture.md) maps each app, language, runtime,
platform, and CPU target. `apps/desktop/src/renderer/` owns audio capture and the
visible session. `src/main/` owns Electron host operations; `src/preload.ts`
exposes only the typed operations in `src/shared/contract.ts`. The renderer has
sandboxing and context isolation enabled, no Node access, and no external
navigation. `src/main/platform.ts` holds the actual OS differences and is used
by the host and packager. Paths in this paragraph are relative to `apps/desktop/`.

`src/main/transcription.ts` owns one temporary WAV and child process. Session
generations reject completions after cancellation or a newer recording.
`crates/transcription/` owns credential lookup, upload, and JSON output for both
apps. `apps/macos/` owns the active Swift/AppKit client and its native checks.

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
Filesystem fault tests verify partial-file cleanup and prevent Retry from
launching the helper after a save failure. Smoke also checks that Copy preserves
recovery and that nonretryable errors disable Retry.
Tests with injected fixture helpers verify transcription delivery without
reading real credentials. Mac and Windows live acceptance must run on those OSes.

Menu-highlight lag in the earlier native Mac app remains unresolved.

Current build, review, and merge evidence is recorded in the pull request.
