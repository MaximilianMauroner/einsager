# Architecture

einsager uses a native AppKit host on macOS and an Electron host on Windows
and Linux. Both call the same Rust transcription helper. Start in
`apps/desktop/native/macos/` for macOS, `apps/desktop/src/` for Electron, or
`crates/transcription/` for login and upload changes.

## Source map

| Directory | Language and runtime | Platforms | Owns |
|---|---|---|---|
| [`apps/desktop/src/main/`](../apps/desktop/src/main/) | TypeScript, Electron main process | All | Windows, tray, shortcuts, settings, history, clipboard delivery, trusted IPC, and the helper processes |
| [`apps/desktop/src/main/linux/`](../apps/desktop/src/main/linux/) | TypeScript, optional xdotool | Linux | X11/Wayland detection, focused window capture, targeted paste |
| [`apps/desktop/src/renderer/`](../apps/desktop/src/renderer/) | TypeScript, React, Chromium | All | Pill and tray panel UI, visible session, microphone capture, WAV encoding |
| [`apps/desktop/src/preload.ts`](../apps/desktop/src/preload.ts), [`panel-preload.ts`](../apps/desktop/src/panel-preload.ts) | TypeScript, sandboxed preloads | All | Narrow bridges from the pill and the tray panel to the main process |
| [`apps/desktop/src/shared/`](../apps/desktop/src/shared/) | TypeScript | All | Bridge contract, result types, and shortcut parsing; no privileged code |
| [`apps/desktop/native/macos/`](../apps/desktop/native/macos/) | Swift, AppKit, AudioQueue, Carbon, Accessibility | macOS | Native host, pill, panel, recording, shortcuts, clipboard, and helper lifecycle |
| [`apps/desktop/scripts/`](../apps/desktop/scripts/) | Node.js, Swift | All | Build, package, and the macOS app icon |
| [`apps/desktop/tests/`](../apps/desktop/tests/) | Node test runner, Playwright | All | Unit tests and desktop smoke tests |
| [`crates/transcription/`](../crates/transcription/) | Rust executable | All | Codex login discovery, audio validation, ChatGPT upload, JSON output |
| [`assets/icons/`](../assets/icons/) | PDF, PNG | All | Vector logo for the macOS app icon, and the tray icon |

Root files hold dependency locks, compiler settings, CI, and the license.

## Process and data flow

```mermaid
flowchart LR
    renderer["UI<br/>React + browser audio"] -->|"typed bridge"| preload["Sandboxed preload"]
    preload -->|"IPC"| host["Host<br/>Electron + Node.js"]
    host <-->|"JSON lines"| keys["macOS keyboard helper<br/>Swift"]
    host -->|"temporary WAV; child process"| helper["Transcription helper<br/>Rust"]
    helper -->|"audio upload"| chatgpt["ChatGPT transcription"]
    helper -->|"JSON result"| host
    host -->|"clipboard"| editor["Text field"]
    host -->|"recording target; cancellation"| linux["Linux desktop adapter"]
    linux -->|"X11 targeted paste"| editor
    keys -->|"checked ⌘V"| editor
```

The renderer owns audio capture and the visible session. It may use browser APIs
and shared types. It must not import `src/main/`, Electron, or Node.js. It runs
with sandboxing and context isolation, no Node access, and no external
navigation. Each preload exposes only the typed operations in
`src/shared/contract.ts`, not raw IPC. Main-process handlers check the sender
before they do privileged work. Main code does not import React or renderer
code. Paths in this section are relative to `apps/desktop/`.

In Electron, `src/main/transcription.ts` owns one temporary WAV and one helper process.
Session generations reject results that arrive after a cancel or a newer
recording. The Rust helper reads credentials in its own process; no window
receives them. Its JSON output and WAV input are its contract with the host.

`src/main/delivery.ts` owns one recording's paste target, clipboard writes,
clipboard recovery, and cancellation. A paste target captures the focused window
or field when recording begins and sends the paste keys only if the same target
still has focus and the clipboard still holds the transcript. Two adapters
provide targets: `src/main/linux/desktop.ts` with xdotool on X11, and
`src/main/keyboard.ts` with the Swift helper on macOS. The helper compares the
frontmost app and its focused Accessibility element before it posts ⌘V. The
renderer never receives window IDs.

In the macOS Electron fallback, Electron cannot see Fn or key releases. `native/macos/KeyboardHelper.swift`
runs the shortcut logic in `KeyboardShortcuts.swift` in an event tap and stores
custom shortcuts in its own `local.max.einsager.keys` defaults. It needs
Accessibility access; without it, the Electron fallback shortcut works and the
user pastes by hand.

## Find the behavior

| Change | Start here |
|---|---|
| Pill and visible session | `src/renderer/App.tsx` |
| Microphone and WAV encoding | `src/renderer/audio.ts` |
| Hold-key timing | `src/renderer/gesture.ts` |
| Windows, tray, settings, and IPC | `src/main/index.ts` |
| Tray panel: history, settings, session view | `src/renderer/Panel.tsx`, window in `src/main/panel.ts` |
| Transcript history and stored settings | `src/main/history.ts`, `src/main/settings.ts` |
| macOS shortcuts and paste | `native/macos/KeyboardHelper.swift`, `native/macos/KeyboardShortcuts.swift`, owner in `src/main/keyboard.ts` |
| Docking coordinates | `src/main/placement.ts` |
| Temporary audio, helper cancellation, Retry | `src/main/transcription.ts` |
| Clipboard modes, restore, paste targets | `src/main/delivery.ts` |
| OS differences | `src/main/platform.ts` |
| Linux capabilities and X11 paste | `src/main/linux/desktop.ts` |
| Packaging and the macOS icon | `scripts/package.mjs`, `scripts/make-app-icon.swift` |
| Login discovery, upload, CLI JSON | `crates/transcription/src/main.rs` |
| Release builds | `.github/workflows/release.yml` |

Add a new module when it can own a complete responsibility behind a smaller
interface. A new OS branch alone does not need a new module.

## OS differences

The host and the packager read `src/main/platform.ts`:

| Electron OS name | Paste hint | Helper filename | Keyboard helper | Template tray icon |
|---|---|---|---|---|
| `darwin` | `⌘V` | `einsager-transcribe` | `einsager-keys` | Yes |
| `linux` | `Ctrl+V` | `einsager-transcribe` | None | No |
| `win32` | `Ctrl+V` | `einsager-transcribe.exe` | None | No |

Electron provides the other window, clipboard, shortcut, and permission APIs.
The Linux adapter detects X11 or Wayland and optional `xdotool`; the host uses
its capabilities to turn off placement under Wayland. See [Linux](linux.md).

## Desktop runtimes

Electron provides the Windows and Linux recording and UI path. Its fixed
Chromium and Node memory cost cannot meet the macOS background target of
30 MB. macOS therefore uses AppKit with no
Chromium, WebKit, or SwiftUI runtime. This requires a separate macOS host;
the transcription protocol and stored data formats remain shared.

The native host has these owners:

| File | Responsibility |
|---|---|
| `NativeApp.swift` | Startup, one instance per profile, service composition, input-device changes |
| `NativeSession.swift` | Session phase, hold gestures, permission and stale-result guards |
| `NativeAudio.swift` | Three fixed input buffers, streamed private WAV, meter, 10-minute limit, streamed voiceprint |
| `NativeTranscription.swift` | One helper process, timeout, cancellation, Retry, temporary-file cleanup |
| `NativeDelivery.swift` | Checked paste, all clipboard types, guarded restoration |
| `NativeStore.swift` | Existing settings and history formats, private atomic writes, 500-entry limit |
| `NativeHotKeys.swift` | Carbon fallback shortcut and active-session Escape without Accessibility |
| `KeyboardMonitor.swift`, `KeyboardShortcuts.swift` | Fn, custom shortcuts, focused-field capture and paste |
| `NativePill.swift`, `NativeUI.swift` | Views and actions; no audio or helper ownership |
| `NativeStyle.swift` | Shared native color, type, icon, and control primitives matching the React UI |

AudioQueue converts input to 16 kHz mono PCM. Each callback writes to disk;
recording duration does not grow a retained audio buffer. After stop, the
voiceprint reader uses a fixed 16 KB buffer. The Rust helper streams the
opened audio file into the multipart upload and caps reads at the validated
file length. Credentials remain inside that helper.

The macOS UI follows the existing `panel.css` and `style.css` design. Small
`NSControl` subclasses draw buttons, switches, and radio choices. System button
renderers on recent macOS versions add SwiftUI hosting trees and a larger
footprint. History uses cached full-paragraph heights and reusable table cells.
Read-only TextKit views keep transcripts selectable without a shared field
editor changing the layout. They disable writing tools and text completion.
Accessibility uses lightweight model rows for both the modern getters and
the public ranged array methods. Full hierarchy clients use the ranged path;
AppKit's default implementation creates offscreen text views through mock cells.

### Staged macOS fallback

The Electron macOS host and JSON-lines keyboard adapter remain available for
the transition. `pnpm start --electron` runs it; packaging with
`node apps/desktop/scripts/package.mjs --electron` writes under
`release/electron/`. Remove this macOS path after Max accepts the native
microphone, Fn gestures, paste, tray, and docking behavior. Windows and Linux
continue to use Electron. The native keyboard monitor and shortcut logic
remain after the adapter is removed.

The native host reads the existing macOS profile and shortcut defaults. It
preserves unknown settings. The Electron fallback also keeps the original
stored fields in its main process and merges validated settings into them on
save. These extra fields never become panel-editable. `nativeMicrophone` stores
a Core Audio UID; `microphone` remains the Chromium device ID for the fallback. The separate
namespaces are required while both hosts can read this stored profile.

Both macOS hosts take an exclusive `flock` on the profile's `.instance.lock`
before reading settings or history. Electron holds it through a separate
`einsager-keys --profile-lock <directory>` process. This mode starts no keyboard
monitor and exits when its stdin closes. A missing, busy, or failed lock helper
stops Electron before it loads the profile. Losing ownership after startup exits
without flushing queued writes. Normal quit keeps the lock until startup,
clipboard restoration, transcription cleanup, and profile writes settle.
Kernel ownership ends when either host dies; the lock file is never removed.

On macOS, `pnpm start` packages the compiled binaries and launches the bundle
through Launch Services. This gives microphone requests the app's own usage
description and identity. It quits an existing einsager instance before
replacing build output. Interrupting the development command asks einsager
to quit by bundle ID; the installed copy shares this ID.

See [memory verification](memory.md) for measurements and test boundaries.

## CPU architectures and build outputs

The source is the same for every CPU. Swift, Rust, and Electron build for the
host system and CPU. The scripts do not cross-compile or create universal
binaries, so build on each system and CPU you want to ship.

| Component | Command from the repository root | Output |
|---|---|---|
| Transcription helper | `cargo build --locked --release -j 1` | `target/release/einsager-transcribe` (`.exe` on Windows) |
| App and helpers | `pnpm build` | Helpers plus `apps/desktop/dist/`; macOS also builds `target/release/einsager` |
| Runnable app | `pnpm package` | `release/einsager-<Electron OS>-<CPU>/` |

Electron calls an Intel/AMD 64-bit CPU `x64` and Apple silicon `arm64`. The
release workflow builds Linux x64, macOS arm64, and Windows x64, because those
are the GitHub runner CPUs. See [Releasing](releasing.md).

On a Linux machine where a non-compiler command named `cc` comes first in
`PATH`, set `CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=/usr/bin/cc` and
`CC_x86_64_unknown_linux_gnu=/usr/bin/cc` for Cargo. `.cargo/config.toml`
already selects Apple's Clang on macOS.

## Checks

| Area | Command |
|---|---|
| Types and unit behavior | `pnpm check` |
| Rust helper | `cargo fmt --check`, `cargo test --locked -j 1`, `cargo clippy --locked -j 1 --all-targets -- -D warnings` |
| App from source | `pnpm test:desktop` after `pnpm build`; Linux uses `xvfb-run -a` |
| Packaged app | `pnpm test:packaged` after `pnpm package` |
| Linux paste and Wayland policy | `xvfb-run -a pnpm test:linux`, with xdotool installed |
| macOS shortcut logic | `pnpm test:macos` |
| Native macOS logic and memory | `pnpm test:native` |
| macOS bundle signature | `codesign --verify --deep --strict release/einsager-darwin-*/einsager.app` |

CI runs all of these on Linux, macOS, and Windows in `.github/workflows/check.yml`
for non-draft PRs and pushes to `main`. Draft PRs run types, unit behavior and the
Rust source checks on Linux. Marking a PR ready starts the desktop matrix;
returning it to draft or pushing a new revision cancels its older Checks run.
**Actions → Checks → Run workflow** runs the full matrix on the selected ref.
Every path retains this coverage, including installation and release guides.
A draft-skipped desktop job does not prove desktop acceptance.

pnpm caches its store by OS, architecture and dependency files. GitHub scopes PR
caches to the PR merge ref, so trusted branch and release jobs cannot restore
them. Rust dependency caches also include the compiler version/host, Cargo
manifests, lockfiles and configuration. Only successful `main` pushes save Rust
caches; PRs and releases can restore them. Project binaries and signing data are
not cached. Transient desktop smoke evidence expires after seven days; release
archive retention is unchanged.

Unit tests cover PCM/WAV output, the upload-size limit, docking and panel
placement, process cancellation, Retry with retained audio, each clipboard mode
and its restore guard, history storage and limits, settings validation, Linux
capability and focus cases, and the macOS paste protocol with a fake helper.
Rust tests use fixture credentials and a local test server.

The Electron smoke tests use Chromium's fake microphone and an empty Codex folder, so they
send no transcription request. They drive recording, the missing-login error,
Retry, cancel, Copy, the tray panel and its settings, microphone choice, and side
docking, in both the source and the packaged app. The Linux test sends targeted
paste keys to a separate test editor, and a second run checks the Wayland policy
under Xvfb, which is not a real compositor. The test harness skips Chromium's
Linux sandbox check, so it does not catch a misconfigured `chrome-sandbox`.

Real microphones, Fn gestures, macOS paste, compositor behavior, and insertion in
daily-use apps need a person on the target system. Builds and automated tests do
not prove them.

On macOS, the packaged check uses the native test binary: synthetic PCM,
private pasteboards, hidden AppKit views, and an isolated production launch.
It records memory without taking focus or using a real microphone. Its hidden
integration process has a 50 MB regression ceiling; the production background
target is 30 MB and also needs a settled measurement after live use.
The test driver is compiled with `NATIVE_TESTS` and is absent from the shipped
binary. The shipped app accepts a helper override only together with a
separate profile, and that isolated mode installs no global input handlers.
