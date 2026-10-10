import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ClipboardMode, DockEdge, HistoryEntry, KeyboardState, PanelBridge, PanelSettings, PanelState, SessionStatus } from '../shared/contract';

declare global { interface Window { einsagerPanel?: PanelBridge } }

/** The panel's tallest height. A shorter work area lowers it, so the lists scroll inside the window. */
const MAX_HEIGHT = 600;
const initial: PanelState = {
  status: { state: 'idle' }, history: [], settings: { edge: 'bottom', clipboard: 'if-paste-fails', keepHistory: true, showPill: true },
  codexFolder: '~/.codex', shortcut: 'Ctrl+Alt+Space', shortcutAvailable: true, canPaste: false, canPositionWindow: true,
};
const clipboardChoices: { mode: ClipboardMode; label: string; detail: string }[] = [
  { mode: 'always', label: 'Always', detail: 'The transcript stays on the clipboard.' },
  { mode: 'if-paste-fails', label: 'If paste fails', detail: 'After a paste, your previous clipboard comes back.' },
  { mode: 'never', label: 'Never', detail: 'When einsager cannot paste, copy the text from history.' },
];
const edges: { edge: DockEdge; label: string }[] = [
  { edge: 'bottom', label: 'Bottom' }, { edge: 'top', label: 'Top' }, { edge: 'left', label: 'Left' }, { edge: 'right', label: 'Right' },
];
const pending: Record<SessionStatus['state'], string> = {
  idle: '', requesting: 'Starting microphone…', recording: 'Listening…', processing: 'Transcribing…', failure: '',
};
const stateLabel: Record<SessionStatus['state'], string> = {
  idle: '', requesting: 'Starting', recording: 'Recording', processing: 'Transcribing', failure: 'Failed',
};

const icons = {
  copy: <><rect x="5.25" y="5.25" width="7.5" height="7.5" rx="1.5" /><path d="M3.25 10.25V4.75a1.5 1.5 0 0 1 1.5-1.5h5.5" /></>,
  check: <path d="M3.5 8.5 6.5 11.5 12.5 5" />,
  trash: <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.6 4.5l.6 8.5h5.6l.6-8.5" />,
  search: <><circle cx="7" cy="7" r="4.25" /><path d="M10.2 10.2 13 13" /></>,
  sliders: <><path d="M3 5h5.5M11.5 5H13M3 11h1.5M7.5 11H13" /><circle cx="10" cy="5" r="1.5" /><circle cx="6" cy="11" r="1.5" /></>,
  back: <path d="M10 3.5 5.5 8l4.5 4.5" />,
  right: <path d="M6.5 4 10.5 8l-4 4" />,
  retry: <><path d="M3.5 8a4.5 4.5 0 1 0 1.3-3.2" /><path d="M3.5 3v2.5H6" /></>,
};
function Icon({ name }: { name: keyof typeof icons }) {
  return <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">{icons[name]}</svg>;
}

/** "Fn+Space" and "⌃⌥K" become one key cap per key. */
function Keys({ shortcut }: { shortcut: string }) {
  const keys = shortcut.split('+').flatMap(part => [...(part.match(/^[⌃⌥⇧⌘]*/)?.[0] ?? '')].concat(part.replace(/^[⌃⌥⇧⌘]*/, '') || []));
  return <span className="keys">{keys.map((key, index) => <kbd key={index}>{key}</kbd>)}</span>;
}

function ShortcutRows({ keyboard, api }: { keyboard: KeyboardState; api?: PanelBridge }) {
  const row = (target: 'hold' | 'handsFree', label: string) => {
    const capturing = keyboard.capturing === target;
    return <div className="row">
      <span>{label}</span>
      <button className={capturing ? 'keys-button capturing' : 'keys-button'} disabled={!keyboard.trusted} aria-label={`Change the ${label.toLowerCase()} shortcut`}
        onClick={() => api?.shortcut(capturing ? { command: 'stopCapture' } : { command: 'capture', target })}>
        {capturing ? 'Press keys…' : <Keys shortcut={keyboard[target]} />}
      </button>
    </div>;
  };
  return <>
    <div className="group-head">
      <span>Shortcuts</span>
      <button className="quiet" disabled={!keyboard.trusted} onClick={() => api?.shortcut({ command: 'reset' })}>Reset to Fn</button>
    </div>
    {row('hold', 'Hold to talk')}
    {row('handsFree', 'Hands-free')}
    {keyboard.capturing && <p className="note inset">Press the new keys, then release them. Esc cancels.</p>}
    {keyboard.error && <p className="note inset alarm">{keyboard.error}</p>}
    {!keyboard.trusted && <div className="row">
      <span className="wrap">Allow Accessibility so einsager can see Fn. Ctrl+Alt+Space works until then.</span>
      <button className="action" onClick={() => api?.shortcut({ command: 'prompt' })}>Allow…</button>
    </div>}
  </>;
}

/** The pill's resting dots, so the panel's start control reads as the same object as the floating pill. */
function RestingWave() {
  return <span className="wave" aria-hidden="true">{Array.from({ length: 10 }, (_, index) => <i key={index} />)}</span>;
}

function dayLabel(at: number) {
  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(new Date(at))) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return new Date(at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
// A 24-hour clock keeps every time the same width, so the tape's rail stays straight.
const clock = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function length(seconds: number) {
  const whole = Math.max(1, Math.round(seconds));
  return whole < 60 ? `${whole} s` : `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function groupByDay(entries: HistoryEntry[]) {
  const groups: { day: string; entries: HistoryEntry[] }[] = [];
  for (const entry of entries) {
    const day = dayLabel(entry.at);
    const last = groups.at(-1);
    if (last?.day === day) last.entries.push(entry);
    else groups.push({ day, entries: [entry] });
  }
  return groups;
}

export function Panel() {
  const api = window.einsagerPanel;
  const [state, setState] = useState(initial);
  const [view, setView] = useState<'tape' | 'settings'>('tape');
  const [query, setQuery] = useState<string>();
  const [copied, setCopied] = useState<string>();
  const [confirmClear, setConfirmClear] = useState(false);
  const [space, setSpace] = useState(MAX_HEIGHT);
  const root = useRef<HTMLDivElement>(null);
  const tape = useRef<HTMLDivElement>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { status, history, settings } = state;

  useEffect(() => {
    void api?.state().then(setState);
    return api?.onState(setState);
  }, [api]);
  useEffect(() => api?.onSpace(setSpace), [api]);
  const frame = { maxHeight: Math.min(MAX_HEIGHT, space) };

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(() => api?.resize(Math.ceil(element.getBoundingClientRect().height)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [api]);

  // The newest entry sits just above the pill. Keep it in view when the tape grows or the panel opens.
  const showNewest = () => { if (tape.current) tape.current.scrollTop = tape.current.scrollHeight; };
  useLayoutEffect(showNewest, [history.length, status.state, view]);
  useEffect(() => {
    const visibility = () => {
      if (document.visibilityState === 'visible') { showNewest(); return; }
      setQuery(undefined);
      setConfirmClear(false);
    };
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, []);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (query !== undefined) setQuery(undefined);
      else if (view === 'settings') setView('tape');
      else api?.hide();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  });

  async function copy(entry: HistoryEntry) {
    if (!await api?.copy(entry.id)) return;
    clearTimeout(copiedTimer.current);
    setCopied(entry.id);
    copiedTimer.current = setTimeout(() => setCopied(undefined), 1500);
  }
  const update = (change: Partial<PanelSettings>) => { void api?.update(change); };

  if (view === 'settings') {
    return <div ref={root} className="panel" style={frame}>
      <header className="head">
        <button className="back" onClick={() => setView('tape')}><Icon name="back" /><span className="word">Settings</span></button>
      </header>
      <div className="settings">
        <fieldset className="choices">
          <legend>Clipboard after dictation</legend>
          {clipboardChoices.map(choice => <label key={choice.mode} className="choice">
            <input type="radio" name="clipboard" checked={settings.clipboard === choice.mode} onChange={() => update({ clipboard: choice.mode })} />
            <b>{choice.label}</b><span>{choice.detail}</span>
          </label>)}
          {!state.canPaste && <p className="note">einsager cannot paste by itself on this system yet, so “If paste fails” keeps the text copied.</p>}
        </fieldset>
        <div className="row">
          <span id="keep-history">Keep transcript history</span>
          <button className="switch" role="switch" aria-checked={settings.keepHistory} aria-labelledby="keep-history"
            onClick={() => update({ keepHistory: !settings.keepHistory })} />
        </div>
        <div className="row">
          <span id="show-pill">Show pill when idle</span>
          <button className="switch" role="switch" aria-checked={settings.showPill} aria-labelledby="show-pill"
            onClick={() => update({ showPill: !settings.showPill })} />
        </div>
        <label className="row">
          <span>Dock the pill</span>
          <select value={settings.edge} disabled={!state.canPositionWindow} onChange={event => {
            const choice = edges.find(item => item.edge === event.target.value);
            if (choice) update({ edge: choice.edge });
          }}>{edges.map(item => <option key={item.edge} value={item.edge}>{item.label}</option>)}</select>
        </label>
        <button className="row" onClick={() => void api?.chooseCodexHome()}>
          <span>Codex login folder</span><span className="value"><span className="path">{state.codexFolder}</span><Icon name="right" /></span>
        </button>
        {state.keyboard ? <ShortcutRows keyboard={state.keyboard} api={api} /> : <div className="row">
          <span>Shortcut</span>
          <span className="value">{!state.shortcutAvailable && 'In use by another app'}<Keys shortcut={state.shortcut} /></span>
        </div>}
        <div className="row">
          {confirmClear ? <>
            <span>Delete all {history.length} transcripts?</span>
            <span className="value">
              <button className="quiet" onClick={() => setConfirmClear(false)}>Keep</button>
              <button className="danger" onClick={() => { void api?.clear().then(() => setConfirmClear(false)); }}>Delete all</button>
            </span>
          </> : <>
            <button className="danger" disabled={history.length === 0} onClick={() => setConfirmClear(true)}>Clear history…</button>
            <button className="quiet" onClick={() => api?.quit()}>Quit einsager</button>
          </>}
        </div>
        <p className="foot">Audio goes to ChatGPT to transcribe. History stays on this computer.{state.desktopNotice && <><br />{state.desktopNotice}</>}</p>
      </div>
    </div>;
  }

  const filter = query?.trim().toLowerCase();
  const visible = filter ? history.filter(entry => entry.text.toLowerCase().includes(filter)) : history;
  const newest = filter ? undefined : history.at(-1)?.id;
  const busy = status.state !== 'idle';
  const recording = status.state === 'requesting' || status.state === 'recording';
  const keyboard = state.keyboard?.trusted ? state.keyboard : undefined;
  let hint: ReactNode = keyboard ? <>Click or hold <Keys shortcut={keyboard.hold} /></>
    : state.shortcutAvailable ? <>Click or press <Keys shortcut={state.shortcut} /></> : 'Click to start. Another app uses the shortcut.';
  if (status.state === 'requesting') hint = 'Starting microphone…';
  if (status.state === 'recording') hint = 'Finish to transcribe, or cancel';
  if (status.state === 'processing') hint = 'Transcribing…';

  return <div ref={root} className="panel" style={frame}>
    <header className="head">
      <svg className="logo" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13c0-4-2.7-7-6.5-7S5 8 5 12s2.7 7 6.5 7c3 0 4.2-1.8 6.2-1.8 1.1 0 2 .6 2.8 1.4" /></svg>
      <span className="word">einsager</span>
      {busy && <span className={`state ${status.state}`}>{stateLabel[status.state]}</span>}
      <span className="tools">
        <button className="tool" aria-label="Search transcripts" aria-pressed={query !== undefined} onClick={() => setQuery(query === undefined ? '' : undefined)}><Icon name="search" /></button>
        <button className="tool" aria-label="Settings" onClick={() => setView('settings')}><Icon name="sliders" /></button>
      </span>
    </header>
    {query !== undefined && <div className="search">
      <Icon name="search" />
      <input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Search transcripts" aria-label="Search transcripts" />
    </div>}
    <div className="tape" ref={tape}>
      {!settings.keepHistory && <p className="note">History is off. New transcripts are not saved.</p>}
      {settings.keepHistory && !filter && !history.length && !busy && <div className="empty">
        <p>What you say appears here.</p>
        <p>Start below. Each transcript stays until you delete it.</p>
      </div>}
      {filter && !visible.length && <p className="note">No transcript contains “{query?.trim()}”.</p>}
      <div className="rail">
        {groupByDay(visible).map(group => <section key={group.day} aria-label={group.day}>
          <h2 className="day">{group.day}</h2>
          {group.entries.map(entry => <article key={entry.id} className={entry.id === newest ? 'entry newest' : 'entry'}>
            <time dateTime={new Date(entry.at).toISOString()}>{clock(entry.at)}</time>
            <div className="body">
              <p>{entry.text}</p>
              <div className="meta">
                {entry.voiceprint.length > 0 && <span className="voiceprint" aria-hidden="true">
                  {entry.voiceprint.map((level, index) => <i key={index} style={{ height: 2 + level * 10 }} />)}
                </span>}
                {entry.seconds > 0 && <span>{length(entry.seconds)}</span>}
              </div>
              <div className={entry.id === newest ? 'actions' : 'actions overlay'}>
                <button className="action" onClick={() => void copy(entry)}><Icon name={copied === entry.id ? 'check' : 'copy'} />{copied === entry.id ? 'Copied' : 'Copy'}</button>
                <button className="action quiet" onClick={() => void api?.remove(entry.id)}><Icon name="trash" />Delete</button>
              </div>
            </div>
          </article>)}
        </section>)}
        {busy && !filter && <article className={`entry pending ${status.state}`} aria-live="polite">
          <time>now</time>
          <div className="body">
            <p>{status.state === 'failure' ? status.message : pending[status.state]}</p>
            {status.state === 'failure' && <div className="actions">
              {status.retryable && <button className="action" onClick={() => api?.act('retry')}><Icon name="retry" />Retry</button>}
              <button className="action quiet" onClick={() => api?.act('cancel')}><Icon name="trash" />Discard</button>
            </div>}
          </div>
        </article>}
      </div>
    </div>
    <footer className="base">
      {recording ? <div className="pill">
        <button className="circle cancel" aria-label="Cancel dictation" onClick={() => api?.act('cancel')}><svg viewBox="0 0 24 24"><path d="M15.5 8.5l-7 7M8.5 8.5l7 7" /></svg></button>
        <RestingWave />
        {status.state === 'recording' && <button className="circle finish" aria-label="Finish dictation" onClick={() => api?.act('finish')}><svg viewBox="0 0 24 24"><path d="M17 8.5l-6.5 6.5L7 11.5" /></svg></button>}
      </div> : status.state === 'processing' ? <div className="pill" role="img" aria-label="Transcribing">
        <RestingWave /><span className="dots" aria-hidden="true"><i /><i /><i /></span>
      </div> : <button className="pill start" aria-label="Start dictation" onClick={() => api?.act('toggle')}><RestingWave /></button>}
      <p className="hint">{hint}</p>
    </footer>
  </div>;
}
