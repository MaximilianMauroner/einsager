# Using einsager

This guide covers daily use, settings, API keys, the optional Codex login, data handling, and
platform limits. To install einsager, see the [README](../README.md#install).
On Linux, also read [Linux setup and limits](linux.md).

## Dictate

| Action | How |
|---|---|
| Start or finish | Click the pill, or press **Ctrl+Alt+Space** |
| Hold to talk (macOS) | Hold **Fn** and speak; release to transcribe |
| Hands-free (macOS) | Press **Fn+Space**, or double-tap **Fn** |
| Cancel | Press **Escape**, or click the cross on the pill |

On macOS, a third quick tap of Fn cancels. The Fn shortcuts need Accessibility
access; see [macOS permissions](#macos-permissions). A recording stops at
10 minutes, which keeps the upload below the service's 25 MiB limit.

When the transcript is ready, einsager pastes it into the text field where you
started, if that field still has focus. This works on macOS with Accessibility
access and on Linux X11 with `xdotool`. Otherwise the transcript stays on the
clipboard: paste it with **⌘V** on macOS or **Ctrl+V** on Linux and Windows.
Windows does not paste automatically yet. einsager never presses Enter.

"Paste shortcut sent" means that einsager sent the keys. Some apps ignore them. If
the text does not appear, use **Copy last** or copy it from the history.

If transcription fails, the pill offers **Retry**. einsager keeps only the
current recording for Retry. Cancel, a new dictation, success, and Quit delete it.

## Tray panel and menu

Click the tray or menu-bar icon to open the tray panel. On Linux the icon opens
a menu, because many trays send no clicks; choose **History and settings…**.

The panel lists past transcripts, newest at the bottom, with search, **Copy**,
and **Delete**. A recording in progress or a failed one appears at the end, with
**Retry** and **Discard**. The sliders button opens Settings. Escape closes the
search, Settings, or the panel.

Right-click the tray icon or the pill for a short menu: **Start / finish
dictation**, **Cancel dictation**, **Retry transcription**, **Copy last
transcript**, **History and settings…**, and **Quit einsager**.

## Settings

- **Transcription** selects the service. **OpenAI API key** is the default for
  new profiles. The secondary **Codex login · unofficial** option opens a
  warning before you can use it. See [Transcription setup](#transcription-setup).
- **Shortcut** (Linux and Windows) or **Fallback** (macOS): the hands-free
  shortcut, **Ctrl+Alt+Space** by default. Click it and press a key with Ctrl,
  Alt, Cmd, or Super, or a function key alone. Esc cancels.
- **Hold to talk** and **Hands-free** (macOS): click one, press the new keys,
  and release them. Esc cancels. **Reset to Fn** restores Fn and Fn+Space.
- **Microphone**: **System default** follows the system's choice. If the input
  you chose is not connected, einsager records from the default and Settings
  shows it as not connected. A change applies to the next recording.
- **Clipboard after dictation** decides what stays on the clipboard:
  - **If paste fails** (default): after einsager sends a paste, your previous
    clipboard comes back 1 second later, unless you copy something else first.
    If einsager cannot paste, the transcript stays copied.
  - **Always**: the transcript stays on the clipboard.
  - **Never**: the transcript is copied only for a paste. If einsager cannot
    paste, the clipboard does not change. Copy the text from the history.
- **Keep transcript history**: keeps the newest 500 transcripts. **Clear
  history…** deletes all of them and also clears Copy last.
- **Show pill when idle**: turn this off to hide the pill between dictations.
  It still appears for a recording or a result.
- **Dock the pill**: bottom, top, left, or right. You can also drag the pill to
  an edge. Wayland does not allow this.
- **Codex login folder** appears only when Codex login is selected. See [Codex login](#codex-login). **Reset to
  default** selects your normal `.codex` folder, including when the app inherited
  a different `CODEX_HOME`. It is disabled only while that normal folder is
  already selected. The reset persists across app restarts.

## Transcription setup

### Add an OpenAI API key

1. Create a key on the [OpenAI API keys page](https://platform.openai.com/api-keys).
2. Open einsager's **Settings**.
3. On native macOS, click **Add API key…** and paste the key into the secure dialog.
   Click **Save and use API key**.
4. On Windows, Linux, or the macOS Electron fallback, copy the key first.
   Click **Add from clipboard…**, then **Save and use API key** to confirm.
   einsager clears the clipboard after it saves the key.

Saving a key selects the official API. Use **Replace API key…** on native macOS
or **Replace from clipboard…** in Electron to change it. **Remove API key**
deletes the saved key. It does not revoke the key at OpenAI. Revoke an exposed
key on the API keys page.

API use has separate billing. Eligible ChatGPT Pro and Business owners can
[claim subscription API credits](https://developers.openai.com/api/docs/guides/chatgpt-api-credits).
The paid subscription must be at least seven days old. You must own the
subscription and the receiving API organization, with the same email for both.
Use a project key from that organization. Credit amounts depend on the plan.
Unused credits expire at the end of the billing cycle. Plus, Go, and Free do
not qualify. Requests use purchased API credits after free credits run out. If you enable
auto recharge, OpenAI can charge your payment method for more credits.

If the app reports HTTP 401 or 403, check the key and its project permissions.
For HTTP 429, check the organization's credit balance and rate limits.
On Linux, einsager refuses to save a key if system encryption is unavailable
or uses the unencrypted `basic_text` backend. Unlock or configure your system
key store, then restart einsager.

### Change the service

Select **OpenAI API key** to use a saved key. Select **Codex login · unofficial**
to open the warning. **Cancel** leaves the current service selected.
**Continue with Codex login** accepts the warning and selects Codex.
Changing the service or its credentials cancels an active recording or upload.
A failed key or login never causes an automatic switch to another service.

Existing profiles keep Codex selected. Their first dictation requires explicit
warning acceptance. On native macOS, if a held shortcut opens the warning,
accept it and start dictation again.

## Codex login

> [!WARNING]
> This optional path uses an unofficial ChatGPT endpoint. It may violate
> [OpenAI's terms of use](https://openai.com/policies/eu-terms-of-use/) and put
> your account at risk. Use the API key option for the official API.

After you accept the warning, einsager uses the ChatGPT login that Codex keeps in a file. It looks for:

- `$CODEX_HOME/auth.json`, when `CODEX_HOME` is set and not empty.
- `~/.codex/auth.json` on macOS and Linux.
- `%USERPROFILE%\.codex\auth.json` on Windows.

Run `codex login` if you have no login. If Codex keeps the login in the system
keychain, einsager reports a login error. To use a file, add this line to
Codex's `config.toml`, then run `codex login` again:

```toml
cli_auth_credentials_store = "file"
```

The [Codex authentication documentation](https://learn.chatgpt.com/docs/auth#credential-storage)
explains these options.

If the login is in another folder, or the app does not receive `CODEX_HOME`
from your shell, choose the folder under **Codex login folder** in Settings.

einsager reads the login for each transcription. It does not copy, change, or
refresh it. If the login expires, run `codex login` again. Only the bundled
helper reads the login; the app's windows never receive it.

## macOS permissions

einsager asks for microphone access when recording starts. Settings shows
whether Accessibility access is available:

- **Microphone**: needed to record.
- **Accessibility**: needed for the Fn shortcuts and for automatic paste. Click
  **Allow…** in Settings to open the Accessibility list in System Settings, then
  turn on einsager. Until then, use the **Fallback** shortcut to start dictation
  and paste by hand.

On macOS, `pnpm start` prepares and opens the native app bundle, so its own
microphone permission applies. The temporary Electron fallback uses the
terminal app's access when started with `pnpm start --electron`.

After you install a new version, the Fn shortcuts and automatic paste can stop
working while the Accessibility list still shows einsager as allowed. The release is not signed
with an Apple Developer ID, so macOS treats each version as a new app. To fix
this, select einsager in the Accessibility list and remove it with the minus
button. Then add `/Applications/einsager.app` with the plus button and turn it
on. Turning the switch off and on again is not enough.

### Local macOS updates

When building on your Mac, use `pnpm install:macos`. It builds and installs the
app at `/Applications/einsager.app` and opens it. The first run creates a local
code-signing certificate. Later builds, including `pnpm package`, reuse it for
the app and its bundled helpers. Their signing identities stay the same even
when their code changes, so macOS can keep the permissions you approved.

After switching from an ad-hoc signed build, remove the old Accessibility
entry and add `/Applications/einsager.app` once. Allow the microphone again if
macOS asks. This approval cannot carry over from the old signing identity.

Keep `~/Library/Application Support/einsager-signing`. It holds the private
signing key in a dedicated keychain and its unlock password in a file readable
only by your user. Deleting this folder loses the signing identity and requires
new approvals. The certificate lasts ten years. A new certificate or a downloaded
release uses a different identity and also requires new approvals.

The local certificate does not make public releases Apple-signed or notarized.
The installer replaces the app at the same path and does not keep renamed
`.app` backups in `/Applications`, where they can confuse macOS's app name.

## Data and privacy

- **Audio leaves your computer.** With an API key, the helper sends audio to
  `https://api.openai.com/v1/audio/transcriptions`. With Codex login, it sends
  audio to `https://chatgpt.com/backend-api/transcribe`. The Codex endpoint is
  internal and can change without notice. OpenAI's service data rules apply.
  Do not assume that OpenAI deletes audio when einsager deletes its local copy.
- **API keys** stay in macOS Keychain for the native app. Electron saves keys
  with system encryption in the app's data folder. The stores are separate.
  If you switch between native macOS and Electron, add the key in each host.
  Keys reach the helper through stdin. They do not appear in command arguments,
  renderer state, or `settings.json`. Codex login tokens remain in the helper.
- **Recordings** are 16 kHz mono WAV files in an `einsager-*` temporary folder.
  einsager deletes a recording after success, cancel, a new dictation, or Quit.
  A failed transcription keeps it for Retry. A force-quit can leave it behind.
- **History and settings** stay on your computer, readable only by your user
  account, in `history.json` and `settings.json` in the app's data folder:
  `~/Library/Application Support/einsager` on macOS, `~/.config/einsager` on
  Linux, and `%APPDATA%\einsager` on Windows. History keeps the text, time,
  length, and a coarse loudness shape. It never keeps audio.
- **Nothing else** goes over the network. einsager has no account, analytics,
  or update check.

## Platform support

| Feature | macOS | Windows | Linux X11 | Linux Wayland |
|---|---|---|---|---|
| Click or shortcut to dictate | Yes | Yes | Yes | Yes, if the desktop's shortcut portal allows it |
| Hold to talk | Fn or custom keys | No | No | No |
| Automatic paste | With Accessibility | No | With `xdotool` | No |
| Dock and drag the pill | Yes | Yes | Yes | No |

Release downloads exist for macOS on Apple silicon, Windows x64, and Linux x64.
On other systems, [build from source](../README.md#build-from-source).
