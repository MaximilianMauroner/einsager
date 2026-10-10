# Linux desktop integration

The portable app uses Chromium for microphone recording and Electron for its
clipboard, pill, tray, and shortcuts. Linux-specific behavior belongs in
[`apps/desktop/src/main/linux/desktop.ts`](../apps/desktop/src/main/linux/desktop.ts).
The shared transcription helper uses `CODEX_HOME` or `~/.codex` for a file-based
Codex login. [Build and login setup](cross-platform.md) applies to Linux too.

## X11

Install your distribution's `xdotool` package to enable automatic paste. For
Debian/Ubuntu:

```sh
sudo apt-get install xdotool
```

Restart Einsager after installing it. No elevated permission is used by the app.
Without this optional tool, dictation still records and copies the transcript.
The tray and pill context menu explain whether automatic paste is available.

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
was sent, which does not confirm insertion; the transcript stays on the clipboard.
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

Electron's GlobalShortcutsPortal feature is enabled before startup. Ctrl+Alt+Space
depends on the desktop's shortcut portal and permission. If the shortcut is
unavailable, click the pill. The compositor owns window placement, so Dock menu
items and drag requests are disabled. Recording controls and labels still resize
the window. Always-on-top/fullscreen visibility depends on the compositor.

## Tray and microphone

Tray visibility depends on the desktop shell. Some GNOME setups need an
AppIndicator extension. The pill's right-click menu has the same controls,
including Quit and Select Codex folder, so recording does not require a visible
tray icon. No desktop-shell extension is installed by the app.

Select and enable the microphone in the system's sound settings. Chromium uses
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
