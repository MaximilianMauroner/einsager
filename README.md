# einsager

Hold a key, speak, and the text appears in the field where you were typing.
einsager is a desktop dictation app for macOS, Windows, and Linux. It
transcribes with the ChatGPT login that Codex already keeps on your computer,
so it needs no separate account, subscription, or API key.

> [!WARNING]
> einsager is an **alpha**. Expect bugs and changes between versions, and read
> the [known limits](#known-limits). Please
> [report problems](https://github.com/MaximilianMauroner/einsager/issues/new/choose).

> [!IMPORTANT]
> einsager sends your audio to ChatGPT's internal transcription endpoint, the
> one that Codex uses. It is not a public API and can change or stop working at
> any time. einsager is an independent project, not affiliated with OpenAI or
> Wispr.

## Features

- A small floating pill with a live waveform. Dock it to any screen edge, or
  hide it between dictations.
- Start with a click or a global shortcut (**Ctrl+Alt+Space** by default). On
  macOS, hold **Fn** to talk.
- Automatic paste into the original text field on macOS and Linux X11. The text
  is never sent with Enter, and it stays on the clipboard if paste is not safe.
- A tray panel with searchable transcript history, Retry for failed uploads,
  microphone choice, and clipboard settings.

## Install

You need a ChatGPT login in Codex that is stored in a file, normally
`~/.codex/auth.json`. Run `codex login` if you do not have one. See
[Codex login](docs/usage.md#codex-login) if einsager cannot find it.

Download the file for your system from the
[latest release](https://github.com/MaximilianMauroner/einsager/releases/latest):

| System | File |
|---|---|
| macOS, Apple silicon | `einsager-<version>-macos-arm64.zip` |
| Windows, x64 | `einsager-<version>-windows-x64.zip` |
| Linux, x64 | `einsager-<version>-linux-x64.tar.gz` |

v0.1.0 has the macOS file only. From v0.1.1, each release has all three files.

The macOS build needs macOS 12 or later. The Linux build needs glibc 2.34 or
later, for example Ubuntu 22.04 or Debian 12. For an Intel Mac or an ARM
computer, [build from source](#build-from-source).
`SHA256SUMS.txt` in the release lists the checksum of each file.

The builds are not signed by Apple or Microsoft, so the first start needs one
extra step.

### macOS

1. Unzip the file and move `einsager.app` to **Applications**.
2. Open einsager. macOS says that it cannot check the app. Click **Done**.
3. Open **System Settings → Privacy & Security**, find the message about
   einsager, and click **Open Anyway**. Confirm with your password.
4. Allow the microphone. For Fn shortcuts and automatic paste, turn on einsager
   in the Accessibility list that opens.

einsager runs in the menu bar and has no Dock icon.

### Windows

1. Unzip the file, open the `einsager-win32-x64` folder, and run
   `einsager.exe`.
2. If Windows SmartScreen appears, click **More info → Run anyway**.

### Linux

```sh
tar -xzf einsager-*-linux-x64.tar.gz
cd einsager-linux-x64
# Chromium's sandbox helper must belong to root on most current distributions.
sudo chown root:root chrome-sandbox
sudo chmod 4755 chrome-sandbox
./einsager
```

Install `xdotool` for automatic paste on X11. See
[Linux setup and limits](docs/linux.md) for the sandbox, Wayland, and tray.

## Use

| Action | How |
|---|---|
| Start or finish | Click the pill, or press **Ctrl+Alt+Space** |
| Hold to talk (macOS) | Hold **Fn**, then release it |
| Hands-free (macOS) | Press **Fn+Space**, or double-tap **Fn** |
| Cancel | Press **Escape**, or click the cross |
| History and settings | Click the tray icon; on Linux, choose **History and settings…** |

The [usage guide](docs/usage.md) covers settings, permissions, data handling,
and what each platform supports.

## Known limits

- Transcription depends on an internal ChatGPT endpoint, not a public API. It
  can change or stop working at any time.
- Codex must keep the ChatGPT login in a file. A login in the system keychain
  does not work. See [Codex login](docs/usage.md#codex-login).
- Automatic paste works on macOS and on Linux X11. On Windows and Wayland, the
  transcript goes to the clipboard and you paste it.
- On Wayland, the desktop places the pill, so you cannot drag or dock it.
- macOS treats each unsigned version as a new app, so after an update you allow
  Accessibility again. See [macOS permissions](docs/usage.md#macos-permissions).
- There is no automatic update. Watch the
  [releases](https://github.com/MaximilianMauroner/einsager/releases) for new
  versions.
- A recording stops after 10 minutes.

## Privacy

Audio leaves your computer: the bundled helper uploads each recording to
ChatGPT with your Codex login. The login stays in that helper. History and
settings stay on your computer, and einsager never stores audio after a
successful transcription. einsager has no account, analytics, or update check.
[Details](docs/usage.md#data-and-privacy).

## Feedback

Report bugs and ideas in
[issues](https://github.com/MaximilianMauroner/einsager/issues/new/choose).
Report security problems privately, as [SECURITY.md](SECURITY.md) describes.

## Build from source

Install Node.js 22.18 or later, pnpm, and Rust. On macOS, also install the Xcode
Command Line Tools. Then:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start      # run from the source tree
pnpm package    # runnable app in release/einsager-<os>-<cpu>/
```

`pnpm package` builds for the current system and CPU only.

On macOS, use `pnpm install:macos` to build, install in `/Applications`, and
open the app. This creates a local signing certificate once and reuses it for
later builds, so macOS can retain your permissions across local updates.
The first switch from a release build needs one new permission approval.
See [local updates](docs/usage.md#local-macos-updates).

## Development

```sh
pnpm check                 # types and unit tests
cargo fmt --check
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
pnpm test:desktop          # after pnpm build; on Linux: xvfb-run -a pnpm test:desktop
pnpm test:packaged         # after pnpm package
pnpm test:linux            # Linux, with xdotool, under Xvfb or a desktop
pnpm test:macos            # macOS shortcut logic
```

- [Architecture](docs/architecture.md): source map, boundaries, and checks.
- [Releasing](docs/releasing.md): how to publish a new version.

## License

[MIT](LICENSE)
