# Portable desktop app

The first portable layer uses Electron, React, and the existing Rust helper.
It records mono audio, draws the approved pill, supports hands-free dictation,
and copies the transcript. Linux X11 can also attempt automatic paste through
its desktop adapter. Retry retains one temporary
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
On macOS, packaging also renders the app icon from
`assets/icons/einsager-breath.pdf` with the native app's
`apps/macos/scripts/make-app-icon.swift`, so it needs Swift.
This first layer does not create installers, sign Windows releases, or notarize
Mac releases. Start builds separately for each architecture.

## Codex login

The Rust helper finds the file-based ChatGPT login at:

- `$CODEX_HOME/auth.json` when `CODEX_HOME` is set and nonempty.
- `~/.codex/auth.json` on macOS and Linux.
- The OS user-profile folder on Windows, normally `%USERPROFILE%\.codex\auth.json`.

Use **Codex login folder** in the tray panel's Settings for a custom location,
including when the desktop launcher does not inherit your shell environment.
**Reset to default** removes the custom folder, so the lookup above applies again.
The app stores that folder path and its settings in `settings.json`, and
transcript history in `history.json`, in its user-data folder with owner-only
permissions. It does not locate a Codex executable, copy the login, or change
Codex settings.
Only the helper reads credentials at runtime; no tokens reach the renderer.

[Codex authentication documentation](https://learn.chatgpt.com/docs/auth#credential-storage)
also describes keyring and ephemeral logins. This layer supports file storage.
A keychain-only login produces a clear login error; keychain integration is a
remaining migration task. The app does not change credential storage for you.
Audio still goes to ChatGPT's internal transcription endpoint, not a local model.

## Controls and current limits

Click the pill or press **Ctrl+Alt+Space** to start or finish hands-free
recording. To change this shortcut, click it in Settings and press a key with
Ctrl, Alt, Cmd, or Super, or a function key alone; Esc cancels. On macOS, hold **Fn** to talk and release it to transcribe, press
**Fn+Space** for hands-free, or double-tap **Fn** to keep recording without the
key; a third quick tap cancels. These Fn shortcuts need Accessibility access for
einsager: **Allow…** in Settings opens the Accessibility list in System
Settings. Until then, the Fn shortcut buttons stay disabled and the
**Fallback** shortcut, Ctrl+Alt+Space by default, starts dictation. At each
launch, einsager asks for missing microphone and Accessibility access, so a
missing permission does not first show up as a failed recording. Local builds
are ad-hoc signed, so after an update macOS can show einsager as allowed and
still block it. Then remove einsager from the list with the minus button and add
`/Applications/einsager.app` again with the plus button. The native Mac app has its own entry with the same name, so its access
does not count for this app. When you run `pnpm start` from a terminal, macOS
checks the terminal app's access instead. Change either macOS shortcut in
Settings: click it, press the new keys, and release them. Esc cancels the
change, and **Reset to Fn** restores the defaults. Click the check to finish;
the cross cancels. Escape is registered
only during a session. While the tray panel has focus, Escape closes its search,
its Settings, or the panel instead. Dock at top, bottom, left, or right in
Settings, or drag the pill to an edge. Turn off **Show pill when idle** to hide
the pill between dictations; it still appears for a recording or a result.

Click the tray icon to open the tray panel. It shows past transcripts, newest at
the bottom, with Copy, Delete, and search. A recording in progress or a failed
one appears at the end, with Retry and Discard. The sliders button turns the
panel to Settings: clipboard behavior, transcript history, docking, the Codex
folder, Clear history, and Quit. Right-click the tray icon or the pill for a
short menu: Start/finish, Cancel, Retry, Copy last, History and settings, and
Quit. On Linux, the tray icon opens this menu, because many trays send no clicks.

After transcription, press **⌘V** on macOS or **Ctrl+V** on Windows/Linux in your
editor. Linux X11 with `xdotool` can send the paste shortcut when the recording's
original window still has focus. Other portable platforms use manual paste. See
[Linux setup and limits](linux.md). A failed transcription offers Retry and
retains only the current temporary recording. There is no background recording.

**Clipboard after dictation** decides what stays on the clipboard:

- **If paste fails** (default): after a sent paste, the previous clipboard comes
  back 1 second later, unless you copy something meanwhile, including with Copy
  last. Otherwise the transcript stays copied.
- **Always**: the transcript stays on the clipboard.
- **Never**: the transcript is copied only for a paste. If the paste cannot be
  sent, the previous clipboard comes back at once.

Restoring uses every type that Electron's clipboard reports, except the macOS
Find pasteboard, which a transcript never changes. If the previous contents cannot
be read, **If paste fails** keeps the transcript copied, and **Never** does not
copy or paste it. On macOS and Windows the portable app cannot paste yet, so
**If paste fails** keeps the transcript copied and **Never** leaves the clipboard
unchanged. Copy last and the panel's history work in every mode.

Transcript history keeps the text, time, length, and a coarse loudness shape of
the newest 500 transcripts. It never keeps audio. Turn it off or clear it in
Settings. Clearing history also clears Copy last. Deleting any entry with the same
text as the last transcript clears it too.

Copy last can copy an earlier transcript while a failed recording stays available
for Retry. A failure to create or write the temporary recording discards any
partial file and disables Retry; fix the storage problem and start a new dictation.

Choose the input under **Microphone** in Settings. **System default** follows the
OS choice. A chosen input that is not connected records from the system default,
and Settings shows it as not connected. The choice applies to the next recording.

Portable recording is 16 kHz, 16-bit mono WAV, capped at 10 minutes so it stays
below the helper's 25 MiB upload limit. Native Mac recording retains the verified
20-minute AAC path. On macOS, `apps/desktop/native/macos/KeyboardHelper.swift`
runs the native app's shortcut logic in an event tap, because Electron cannot see
Fn or key releases. It stores custom shortcuts in its own `local.max.einsager.keys`
defaults. Hold-to-talk on Linux and Windows, automatic paste on macOS and Windows,
and equivalent permission behavior remain migration work.
On Wayland, shortcuts use Electron's portal integration when the desktop supports
it. The compositor owns window placement, so docking and dragging are disabled;
the pill still resizes for its controls and labels. Clicking the pill and manual
paste remain available. Microphone access requires OS permission.

## Boundaries and choice

The [architecture guide](architecture.md) maps each app, language, runtime,
platform, and CPU target. `apps/desktop/src/renderer/` owns audio capture and the
visible session. `src/main/` owns Electron host operations; `src/preload.ts`
exposes only the typed operations in `src/shared/contract.ts`. The renderer has
sandboxing and context isolation enabled, no Node access, and no external
navigation. `src/main/platform.ts` holds the actual OS differences and is used
by the host and packager. Paths in this paragraph are relative to `apps/desktop/`.

`src/main/panel.ts` owns the tray panel window and its placement. Its page is
`src/renderer/Panel.tsx`, behind the separate bridge in `src/panel-preload.ts`.
`src/main/history.ts` owns the history file and loudness shapes, and
`src/main/settings.ts` validates stored and panel-supplied settings.

`src/main/linux/desktop.ts` owns Linux session detection, optional `xdotool`,
focus snapshots, and targeted X11 keyboard delivery. `src/main/delivery.ts` owns
clipboard recovery, the recording's target, and cancellation across asynchronous
clipboard/input operations. The renderer calls `begin()` before recording and
receives only capability notices and delivery results, never window IDs.

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
# Linux with xdotool installed, under Xvfb or a test desktop:
xvfb-run -a pnpm test:linux
```

The desktop smoke test uses a fake microphone and an empty Codex folder. It
checks development and packaged launch, recording, the helper's missing-login
error, Retry, cancel, safe tray Copy, a delayed Mac settings response, and side
docking through renderer sizing and IPC
without a real login or network transcription. It also drives the tray panel:
failure with Retry, the empty history, saved settings, and starting dictation
from the panel. Unit tests verify PCM/WAV output, the upload-size bound, docking,
panel placement, process cancellation, retained-audio Retry, each clipboard mode
and its restore guard, history storage and limits, and settings validation.
Filesystem fault tests verify partial-file cleanup and prevent Retry from
launching the helper after a save failure. Smoke also checks that Copy preserves
recovery and that nonretryable errors disable Retry.
Linux unit tests cover missing tools, Wayland/Xwayland detection, focus and window
owner changes, clipboard replacement/failure, and cancellation during pending
focus/clipboard reads. The Linux runtime test sends targeted paste keys to a
separate blank Electron editor, checks Unicode/newlines without Enter, and
checks focus-change recovery. A second smoke run exercises Wayland policy on
Xvfb, including resizing without placement requests; this is not a real Wayland
compositor test. Tests with injected fixture helpers verify transcription delivery
without reading real credentials. Physical Linux, Mac, and Windows acceptance
must run in the target desktop sessions.

Menu-highlight lag in the earlier native Mac app remains unresolved.

Current build, review, and merge evidence is recorded in the pull request.
