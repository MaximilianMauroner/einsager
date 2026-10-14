# Linux setup and limits

einsager uses Chromium for microphone recording and Electron for its clipboard,
pill, tray, and shortcuts. Linux-specific code is in
[`apps/desktop/src/main/linux/desktop.ts`](../apps/desktop/src/main/linux/desktop.ts).
The [usage guide](usage.md) covers the Codex login, settings, and data handling.

## Install

The release build needs an x64 system with glibc 2.34 or later, for example
Ubuntu 22.04, Debian 12, or Fedora 35 and later. On other systems, build from
source.

Ubuntu 23.10 and later, and other distributions with similar AppArmor rules,
block the user namespaces that Chromium's sandbox otherwise uses. Chromium then
needs its sandbox helper, `chrome-sandbox`, to belong to root and have the
setuid bit. Without it, einsager stops at once with "The SUID sandbox helper
binary was found, but is not configured correctly".

A setuid helper runs with root rights, so only root may be able to change it,
the archive that it comes from, or a folder above it. For this reason, the
commands below do every step as root in `/opt/einsager`. They stop at the
first error, before they make the helper setuid. They need `curl`; on Debian
and Ubuntu, install it with `sudo apt-get install curl`.

`/opt` and `/opt/einsager` must be real folders, not symbolic links. The block
stops at a link, also one that root owns, because the start and removal
commands use the path as written. This install does not support systems that
link `/opt`, for example Fedora Atomic desktops such as Silverblue, where
`/opt` leads to `/var/opt`.

The first release with a Linux file is v0.1.1, which is not released yet.
Until then, [build from source](../README.md#build-from-source).

Set `version` to a version number from the
[releases page](https://github.com/MaximilianMauroner/einsager/releases),
without the leading `v`. Then paste the block into a Bash or Zsh terminal:

```sh
sudo sh -eu <<'EOF'
version=0.1.1
archive="einsager-$version-linux-x64.tar.gz"
url="https://github.com/MaximilianMauroner/einsager/releases/download/v$version"

# Stop unless /opt/einsager and every folder above it are real folders, not
# symbolic links, that root owns and no group or other user can write to.
# The start and removal commands below use this path as written.
mkdir -p -m 755 /opt/einsager
cd /opt/einsager
path=$(pwd -P)
[ "$path" = /opt/einsager ] ||
  { echo "Symbolic link in path: /opt/einsager leads to $path" >&2; exit 1; }
while :; do
  [ -n "$(find "$path" -maxdepth 0 -user root ! -perm /022)" ] ||
    { echo "Unsafe owner or permissions: $path" >&2; exit 1; }
  [ "$path" = / ] && break
  path=$(dirname "$path")
done

# Work in a new folder that only root can open. Stop if it exists.
mkdir -m 700 "$version"
cd "$version"
# -q ignores curl config files, such as one in your home folder.
curl -q -fL --proto '=https' -o "$archive" "$url/$archive"
curl -q -fL --proto '=https' -o SHA256SUMS.txt "$url/SHA256SUMS.txt"

# Check the archive against its own line. A missing line also stops here.
awk -v name="$archive" '$2 == name' SHA256SUMS.txt > "$archive.sha256"
sha256sum --check --strict "$archive.sha256"

tar -xzf "$archive"
rm "$archive" "$archive.sha256" SHA256SUMS.txt
chown -R root:root einsager-linux-x64
chmod -R go-w einsager-linux-x64
chmod 4755 einsager-linux-x64/chrome-sandbox
chmod 755 .
EOF
```

Start einsager as your user. Use your version in the path:

```sh
/opt/einsager/0.1.1/einsager-linux-x64/einsager
```

Do not start einsager with `sudo` or `--no-sandbox`. `sudo` runs the whole app
as root, and `--no-sandbox` turns off Chromium's protection for the app's web
content.

The checksum finds a damaged download or an archive that does not match the
release's checksum list. It does not prove who built the release, because the
list comes from the same GitHub release over HTTPS.

If the block stops, read the error. When the version folder already exists, the
block checks the path and then stops without changing the folder: that version
is installed, or an earlier attempt stopped. After this stop, remove an
incomplete folder with `sudo rm -r /opt/einsager/0.1.1`, using your version,
and try again. To update, run the block with the new version. It installs
beside the old version, which you can then remove the same way.

## X11

Install your distribution's `xdotool` package to enable automatic paste. For
Debian/Ubuntu:

```sh
sudo apt-get install xdotool
```

Restart einsager after you install it. The app uses no other elevated permission.
Without this optional tool, dictation still records. The transcript is copied
unless the clipboard setting is **Never**.
The tray menu, the pill's context menu, and the tray panel's Settings explain
whether automatic paste is available. On Linux the tray icon opens a menu;
choose **History and settings…** for the tray panel.

Before recording, the app captures the focused X11 window and its process ID.
After transcription it writes the clipboard, checks that the same window/process
still has focus and the clipboard still holds this transcript, and sends Ctrl+V
directly to that window. It does not activate another window or send Enter.
Cancel, a new recording, changing the Codex folder, and quit invalidate the old
target and abort pending command work. Retry retains the original target; it
does not select a new application for insertion.

X11 focus identifies a window, not an individual field inside a browser or editor.
Changing fields inside the same window may not change this identity. Some clients
reject targeted XSendEvent keyboard input. The app reports that the paste shortcut
was sent, which does not confirm insertion. With the default clipboard setting,
the previous clipboard comes back 1 second after the paste is sent. If the text
did not arrive, use Copy last or copy it from the tray panel's history. Choose
**Always** in Settings to keep the transcript on the clipboard instead.
Use your editor's paste shortcut if necessary, commonly Ctrl+V or Ctrl+Shift+V
in a terminal. The app does not detect terminal-specific paste bindings.

Docking and dragging use Electron's X11 window APIs. Window-manager rules can
still affect placement and visibility across workspaces.

## Wayland

`XDG_SESSION_TYPE=wayland` or `WAYLAND_DISPLAY` selects the Wayland policy even
when `DISPLAY` also exists for Xwayland. An X11 tool cannot safely control native
Wayland applications, so the app does not use `xdotool` in this mode. Transcripts
are copied for manual paste; automatic Wayland insertion remains future work.
This version does not request RemoteDesktop control or use privileged input tools.

Electron's GlobalShortcutsPortal feature is enabled before startup. The shortcut,
Ctrl+Alt+Space by default, depends on the desktop's shortcut portal and permission. If the shortcut is
unavailable, click the pill. The compositor owns window placement, so the
**Dock the pill** setting and drag requests are disabled. Recording controls and
labels still resize the window. Always-on-top/fullscreen visibility depends on
the compositor.

## Tray and microphone

Tray visibility depends on the desktop shell. Some GNOME setups need an
AppIndicator extension. The pill's right-click menu has the same controls,
including Quit and **History and settings…**, so recording does not require a
visible tray icon. **History and settings…** opens the tray panel. Set docking,
the microphone, and the Codex folder in its Settings. No desktop-shell extension
is installed by the app.

Enable the microphone in the system's sound settings. **System default** in
Settings follows the system's choice; pick another input there. Chromium uses
the available Linux audio stack; the app does not add a second recording backend.
If recording fails, check the input device, its mute state, and microphone access.
Only the bundled local renderer can request microphone permission.

## Verification

`pnpm check` covers Linux capabilities and delivery failure cases. With `xdotool`
installed, `xvfb-run -a pnpm test:linux` exercises actual X11 paste in a separate
blank editor and the Wayland fallback policy under Xvfb. The latter verifies code
paths, not a real Wayland compositor. Both use test text and no Codex credentials.
The same command checks that quitting before startup completes exits the process.

Real microphone capture, ChatGPT transcription, keyboard portal permission,
desktop-shell tray behavior, compositor placement, and insertion in daily-use
Linux applications still need acceptance in those desktop sessions. Build and
virtual-display checks do not establish full distribution or compositor coverage.
