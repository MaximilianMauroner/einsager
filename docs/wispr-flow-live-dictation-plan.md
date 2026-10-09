# Implementation plan: match Wispr Flow’s live dictation experience

Blast radius: Einsager’s macOS menu-bar icon, global dictation controls, floating status panel, and insertion feedback. Research checked on 9 October 2026. This records the original plan and icon exploration. Implementation status is recorded below.

**Recommendation:** Keep the native Swift app and reuse its recorder, Python transcription helper, and paste path. Add the Flow-style interface and interaction in working layers. Investigate Wispr’s API separately only if matching its transcription behavior becomes necessary.

Max confirmed that the scope is the live dictation experience only. Keep the existing menu and permission commands. There is currently no main app window or settings screen in this repository. Do not build Wispr’s hub, settings, billing, meeting recorder, or account system.

## What can be reused

| Option | Verified evidence | Recommendation |
| --- | --- | --- |
| Existing Einsager implementation | `Dictation.swift` records WAV audio, runs `transcribe.py`, remembers the starting app, copies text, and sends Command+V with Accessibility permission. | Reuse this path. Change its state and UI around it. |
| Wispr desktop UI or feature implementation | No reusable desktop UI package or licensed desktop source was identified in the official material searched. | Recreate the observable layout and interaction in Swift. Exact visual matching needs captures of the installed version. |
| Official Wispr API | The official [Flow API platform](https://platform.wisprflow.ai/) presents a login page. Public endpoint documentation, access conditions, price, and UI embedding support were not verified. | A possible future transcription provider, not a verified dependency for this plan. An API would not supply the floating desktop UI unless Wispr explicitly documents that capability. |
| Official Wispr MCP connector | Its [documentation](https://docs.wisprflow.ai/articles/9551372685-connect-an-mcp-client-to-wispr-flow-remote-mcp-server) describes read access to meeting and note data, and excludes dictation history. | It does not provide live dictation or an embeddable bar. |

The existing backend calls an internal ChatGPT transcription endpoint. Its documented project limits still apply: it is not a supported public API, and access, latency, and behavior can change. Matching Wispr’s interface does not establish matching accuracy or text cleanup.

## Target experience and gaps

| Surface or behavior | Wispr evidence | Einsager today | Planned result |
| --- | --- | --- | --- |
| Floating bar | [Flow bar guide](https://docs.wisprflow.ai/articles/1790396454-move-and-dock-the-flow-bar-on-desktop): resting, recording, and processing states. | Text changes in the menu bar only. | Compact dark pill at rest; recording controls and audio feedback; a static processing state. Match measured geometry and control order. |
| Hold to talk | [Shortcut guide](https://docs.wisprflow.ai/articles/2612050838-Supported-%26-Unsupported-Keyboard-Hotkey-Shortcuts): Fn on Mac, with Ctrl+Option fallback. | Ctrl+Option+Space toggles recording; only pressed events are handled. | Start on hold, stop on release. Support the fallback pair without disrupting the existing toggle shortcut. |
| Hands-free | [Hands-free guide](https://docs.wisprflow.ai/articles/6391241694-use-flow-hands-free): shortcut, double-tap, or bar click; stop inserts text; X or Escape cancels. | Toggle shortcut provides basic hands-free recording. | Click-to-start, explicit stop and cancel, and double-tap locking with deterministic timing. |
| Placement | [Flow bar guide](https://docs.wisprflow.ai/articles/1790396454-move-and-dock-the-flow-bar-on-desktop): cursor display, screen edges, Dock avoidance, and Spaces behavior. | No floating panel. | Follow the cursor’s screen, snap to bottom/left/right, remember the edge, and stay visible across Spaces without taking text focus. |
| Failed transcription | [Recovery guide](https://docs.wisprflow.ai/articles/2503460374): retry saved audio; use paste recovery when text exists. | Audio is deleted after failure; only last successful text remains in memory. | Keep one failed session temporarily for Retry or Discard. Use Copy/Paste Last for insertion failure. No history screen. |
| Longer recording | Wispr’s [hands-free guide](https://docs.wisprflow.ai/articles/6391241694-use-flow-hands-free) documents a 20-minute stop. | 2-minute timer; helper rejects audio above 25 MB. | Preserve the 2-minute cap in the first working layer. Full duration parity is a separate verification gate described below. |
| Mic/language controls | Wispr’s [release notes](https://wisprflow.ai/whats-new) describe bar pickers. | Default recorder input; no language parameter. | Include them only after their recorder/backend behavior is implemented and verified. No decorative controls. |
| Text cleanup and app context | [Auto Cleanup](https://docs.wisprflow.ai/articles/4283510616-Auto-Cleanup%3A-control-how-much-Flow-edits-your-dictation) edits output; [Context Awareness](https://docs.wisprflow.ai/articles/4678293671-feature-context-awareness) uses nearby text and the active app. | One audio-to-text request; no cleanup or context input. | Separate backend work if requested. These are not achieved by copying the live bar. |

### Visual authority

Use Max’s installed Wispr Flow as the visual reference. Its bundle reports version 1.6.1102. Recheck the version before implementation. Official online material confirms behavior but does not establish exact dimensions, font sizes, waveform geometry, colors, or the current hover layout.

Native inspection found Wispr’s Status window, but the screenshot returned blank white. The online docking demonstration was reachable, but it did not establish every live state. Therefore no mockup in this plan is claimed to be pixel-exact. First capture idle, hover, hold-to-talk, hands-free, processing, cancellation, and failure states on this Mac. Record screen scale and measure them. Max owns the microphone demonstration if automation cannot capture it.

## Build in working layers

### 1. Capture the reference and add the smallest visible result

Capture the states above in a blank test editor with no private text. Document dimensions, spacing, radius, control order, hover expansion, and dismissal timing under `docs/`. Add the chosen menu-bar template icon and a nonactivating AppKit `NSPanel` for idle, recording, processing, and result feedback. Use the existing shortcut, microphone, transcription, and paste behavior first.

Turn on `AVAudioRecorder` metering and drive the bar from real levels only while recording. Stop its timer when recording ends. Use static processing text or a finite transition, with no continuous spinner, pulse, shimmer, or blur animation. At rest, clicking the bar starts hands-free recording. Controls must retain the external editor’s focus.

Proof: the existing toggle shortcut still records and inserts a short phrase; the panel stays visible without receiving text focus; the menu icon is clear at 18 points in both system appearances. Compare the captured reference and app at the same display scale. This is the first useful delivery, not full parity.

### 2. Implement the interaction states

Replace the overlapping `recorder`/`busy` conditions with one explicit session state. Distinguish microphone authorization/startup, recording with hold or hands-free mode, processing, recoverable failure, and idle. Keep UI rendering a consequence of that state. Extract only a small panel owner and shortcut handler if needed; do not introduce a general event bus or provider framework.

Add pressed and released handling for hold-to-talk and modifier tracking where needed. Ignore key repeat. Keep Ctrl+Option+Space as the active hands-free shortcut; propose Ctrl+Option for hold-to-talk. Fn/Fn+Space parity requires testing the hardware, macOS Fn settings, Input Monitoring, and conflicts with Wispr. Never register an overlapping shortcut silently. Test with Wispr’s shortcuts inactive and restore them afterward.

Use Wispr’s documented 500 ms double-tap window as a required behavior. A second quick press locks hands-free; a third quick press cancels. Dropped startup taps must not upload empty audio. A release while microphone permission is pending must not start recording later. Escape and X cancel only the active Einsager session. Stop transcribes once; cancel never pastes. Ignore old process completions and scheduled paste callbacks after cancellation, quit, or a newer session. During processing, disable new recording in the first version.

Proof: meaningful transition tests cover quick tap, hold/release, double/triple tap, repeat, delayed authorization, duplicate stop, processing cancellation, and stale completion. Observe real hotkeys in an external editor; synthetic tests alone do not prove macOS input handling.

### 3. Add placement and recovery

Clamp the panel to the visible screen, account for the Dock, and verify full-screen Spaces and display removal. Dragging must not start recording. Persist only the chosen dock edge and needed placement data. Keep these controls on the bar so the settings surface remains untouched.

Show short status text for success, no speech, startup cancellation, missing microphone access, and insertion fallback. A failed transcription retains only the current session’s temporary file for Retry or Discard. A new session, discard, success, and normal quit delete it. Retry must not change the recorded paste target without a clear action. Preserve last successful text in memory and manual copying.

Restore prior clipboard contents only when safe: snapshot supported contents, confirm the target and paste opportunity, and restore only if the clipboard has not changed. Keep transcript recovery in the menu. If focus cannot be confirmed, copy the transcript and show manual-paste feedback. Do not report successful insertion based only on sending Command+V. Never submit text with Enter.

Proof: repeat the journey with denied permissions, changed focus, a closed target, timeout, retry, cancel during processing, multiple screens, and full-screen apps. Confirm no duplicate insertion and no idle metering timer.

### 4. Close explicit parity gaps

For a mic picker, verify input-device selection with the native audio path before adding the control. For a language picker, first verify an actual helper/backend language contract; its current JSON contract has only text or error.

A 20-minute 16 kHz, 16-bit mono WAV is about 38.4 MB, above the helper’s 25 MB limit. Do not just raise the timer. First test whether the existing endpoint accepts a compact encoding and preserves acceptable accuracy. If that fails, evaluate bounded audio chunks and boundary accuracy. Retain the 2-minute cap until one path passes. Longer audio, retry retention, or a provider change must be stated in updated data-handling documentation. Record a remaining duration gap if no path passes.

If Max wants identical text cleanup or latency, investigate the official Wispr API through authorized account access. Obtain its supported audio formats, streaming behavior, pricing, terms, and cleanup/context contract before proposing an adapter. Do not assume an app subscription covers API calls. This research is optional and does not block the bar work.

Proof: microphone choice changes the captured source; a language choice changes real requests; longer recording stays within request limits and transcribes accurately at boundaries. Otherwise record the gap rather than declaring full parity.

## Menu-bar icon options

Three original generated PNG concepts are saved under `assets/icons/concepts/`. They have alpha transparency but have texture and generous canvas margins. They are visual concepts, not the shipped small-size template files.

Three separately drawn SVG masters are saved beside them:

- **A, Breath e:** `assets/icons/einsager-breath.svg`. Recommended. Connects to Einsager’s name, with a quiet wave ending. The continuous outline can need small-size optical adjustment.
- **B, Songbird:** `assets/icons/einsager-songbird.svg`. More character and a solid silhouette. Less direct as a dictation symbol.
- **C, Voice:** `assets/icons/einsager-voice.svg`. Most explicit about audio, but the speech outline and three bars have more detail at small sizes.

The SVGs are original vector alternatives, not image edits or copied Wispr assets. At integration, export the selected master to a template PDF or 18/36-pixel PNGs supported by AppKit, set `NSImage.isTemplate`, and use an accessible name and tooltip. Keep an icon-sized status change; do not replace it with REC or the full word. Wispr’s layout remains the live-interface reference regardless of which brand icon is chosen.

## Needs Max

Icon preference is nonblocking: A is the recommendation; B and C remain saved alternatives. No choice authorizes implementation in this planning-only task. If no icon is chosen when implementation is requested, use A for the first preview.

Exact visual acceptance requires Max to compare the bar while using dictation. The capture step is required before a pixel-match claim. A full 20-minute or language-control match remains blocked on backend verification, owned by the implementing agent.

## Implementation handoff

Purpose: short and long-form dictation uses a small floating bar while the user continues working in another app. It displays truthful state and inserts once or offers recovery.

Orientation: `Dictation.swift` owns `DictationApp`, `toggle()`, `startRecording()`, `finishRecording()`, `deliver(_:)`, `cleanupRecording()`, and menu state. `transcribe.py` owns `transcribe()` and the JSON output. `build.sh` packages a native accessory app and must include any new Swift sources or icon resources explicitly. `docs/proof-of-concept.md` holds the current commands and limitations. Work from this repository root.

Before starting: inspect Git status and active agents; preserve unrelated changes; recheck code, Wispr version, and permission state. Capture the reference. Confirm baseline toggle recording and paste in a blank editor. A failed baseline requires diagnosis before using it as evidence of a new regression. Missing permission blocks live acceptance, not design preparation.

Boundaries: keep one-way paste and existing bundle identity. Ask before spend, provider/account changes, wider data retention, deployment, or actions outside scope. Do not copy proprietary app files, extract Wispr credentials, add inert feature controls, or promise identical backend output. Do not redesign settings or a hub. Honor the AGENTS.md resource and permission rules.

Checks: run `zsh -n build.sh`; use the `build` skill for `zsh build.sh` with local resource checks and one Swift compiler job. Validate the packaged plist and signature. Run targeted state tests introduced in layer 2 and live editor journeys. There are no existing CI, test runner, or nesting/branching checks; recheck that before implementation and record the available checks. Add a small deterministic session test runner only for the race and gesture cases above. Test PNG/PDF appearance natively; a browser SVG preview does not prove AppKit asset loading.

Recovery: use an isolated worktree or preserve the baseline diff before implementation. Keep original PNG concepts and exploration history. Revert only task changes to return to the original toggle app. Stop timers, unregister shortcuts, and terminate owned helper processes on quit. Never alter the shared authentication file. Retry/Discard and build commands must be safe to repeat.

Log: keep progress, decisions, and failed evidence in `.agents/artifacts/plans/wispr-flow-live-dictation/implementation-log.md`, locally excluded as required for HTML artifacts. Do not commit private dictation captures. Compatibility: none added during planning. The existing Ctrl+Option+Space shortcut remains because it is an active user control; it can remain a permanent accessible fallback, not a temporary migration path.

Acceptance entries start false. Mark them passed only with the stated evidence:

```json
[
  {"id":"reference","check":"Installed Flow live-state reference captured","proof":"Versioned state screenshots, measured geometry and screen scale","passes":false},
  {"id":"visual","check":"Icon and bar match the selected reference","proof":"Same-scale native comparison; light/dark 18-point icon review","passes":false},
  {"id":"gesture","check":"Hold, hands-free, double/triple tap, and cancel work","proof":"Transition tests plus real external-editor shortcut journey","passes":false},
  {"id":"race","check":"Cancelled or old sessions cannot paste later","proof":"Delayed authorization, stale process, and pending-paste tests","passes":false},
  {"id":"placement","check":"Bar stays usable across displays and Spaces","proof":"Dock positions, drag, full-screen and display-disconnect journey","passes":false},
  {"id":"recovery","check":"Failure offers retry or transcript recovery","proof":"Timeout, denied permissions, focus change and cleanup journey","passes":false},
  {"id":"parity-gaps","check":"Duration and pickers work or are explicitly marked incomplete","proof":"Real backend/device tests and recorded unresolved gaps","passes":false},
  {"id":"package","check":"Packaged app builds and loads icon resources","proof":"Resource-controlled build, plist/signature checks and native launch","passes":false},
  {"id":"acceptance","check":"Max accepts the live experience","proof":"Max compares recording and insertion against installed Wispr","passes":false}
]
```

## Evidence from this planning task

Passed: current Swift/Python/build files inspected; official online sources researched; API login page observed; installed Wispr bundle version read; three PNG concepts generated and copied into the project; transparent alpha confirmed; SVG alternatives saved and XML parsed. The HTML plan passed preview checks at 728 and 360 pixels in both themes, with no console errors. Browser checks passed for A/B/C switching, branch navigation, and the expanded brief. The page has no horizontal overflow; one detailed table scrolls within its container on mobile. Standalone theme rendering and transparent outer surfaces were checked. The HTML file is below 512 KB and passed host restriction checks.

Blocked: reliable native screenshot of the installed live bar. Exact geometry and waveform details are unknown until the capture milestone. No authenticated Wispr API contract was inspected.

Omitted: app build, native dictation tests, CI, review, merge, and user acceptance. This task changes documentation and new design assets only; no runtime code or compatibility path was changed. CI did not run. Next action: Max can choose an icon; an implementing agent starts with reference capture when implementation is requested.


## Implementation update, 9 October 2026

Max selected A and authorized implementation. The app now packages A as a native
18-point template PDF and provides the floating idle, recording, processing,
failure, and insertion states. The native panel does not take editor focus.
Hold, hands-free, double/triple-tap timing, cancel, retry, focus checks, and
clipboard ownership are implemented. The later custom-hotkey request adds a
small native shortcut editor: Fn and Fn+Space are defaults, choices persist,
and reset is available. The original Control+Option+Space remains supported.

AAC passed the backend duration check with a 20-minute fixture and markers near
the start, middle, and end, so the recording cap is now 20 minutes. Device and
language pickers remain omitted pending real contracts. The backend is unchanged.

Code checks passed: 70 native logic checks, six Python tests, native state
renders, build, plist/signature, launch, and real shortcut editing/reset.
Microphone permission did not complete, so physical Fn, microphone capture,
and live insertion remain pending user verification after permissions are enabled.
Exact live-bar matching and multi-display/full-screen acceptance also remain
unverified. The implementation follows the approved sketch, not a measured
pixel comparison. See [current usage and verification](proof-of-concept.md).
