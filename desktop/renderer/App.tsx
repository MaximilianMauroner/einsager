import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DesktopBridge, DesktopInfo, TranscriptResult } from '../contract';
import { MicrophoneRecording, RECORDING_SECONDS } from './audio';

declare global { interface Window { einsager?: DesktopBridge } }
type State = 'idle' | 'requesting' | 'recording' | 'processing' | 'message' | 'failure';

export function App() {
  const api = window.einsager;
  const [info, setInfo] = useState<DesktopInfo>({ edge: 'bottom', shortcut: 'Ctrl+Alt+Space', shortcutAvailable: true, pasteKey: 'Ctrl+V' });
  const [state, setState] = useState<State>('idle');
  const [message, setMessage] = useState('');
  const [hovered, setHovered] = useState(false);
  const [levels, setLevels] = useState<number[]>(Array(10).fill(0));
  const [secondsLeft, setSecondsLeft] = useState<number>();
  const [canCopy, setCanCopy] = useState(false);
  const [canRetry, setCanRetry] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const recording = useRef<MicrophoneRecording>(null);
  const stateRef = useRef<State>('idle');
  const generation = useRef(0);
  const messageTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const gesture = useRef<{ x: number; y: number; moved: boolean }>(undefined);

  function change(next: State, text = '') {
    clearTimeout(messageTimer.current);
    stateRef.current = next;
    setState(next);
    setMessage(text);
    api?.active(['requesting', 'recording', 'processing', 'failure'].includes(next));
  }
  function feedback(text: string) {
    change('message', text);
    messageTimer.current = setTimeout(() => change('idle'), 6000);
  }
  async function cancel() {
    generation.current++;
    recording.current?.cancel();
    recording.current = null;
    setLevels(Array(10).fill(0));
    setCanRetry(false);
    change('idle');
    await api?.cancel();
  }
  function result(value: TranscriptResult, id: number) {
    if (id !== generation.current || 'cancelled' in value) return;
    if ('error' in value) { setCanRetry(true); change('failure', value.error); return; }
    if (!value.text.trim()) { feedback('No speech detected'); return; }
    setCanCopy(true);
    feedback(value.copied === false ? 'Clipboard unavailable. Use Copy last to retry.' : `Copied. Press ${info.pasteKey} in your text field.`);
  }
  async function finish() {
    if (stateRef.current !== 'recording') return;
    const id = generation.current;
    const wav = recording.current?.stop();
    recording.current = null;
    setLevels(Array(10).fill(0));
    if (!wav) { feedback('No microphone audio. Check your input device.'); return; }
    change('processing');
    try { result(await api!.transcribe(wav), id); }
    catch { if (id === generation.current) change('failure', 'Could not transcribe. Retry or start a new dictation.'); }
  }
  async function toggle() {
    if (stateRef.current === 'recording') { await finish(); return; }
    if (['requesting', 'processing'].includes(stateRef.current)) return;
    if (!api) { feedback('Open the desktop app to record.'); return; }
    const id = ++generation.current;
    await api.cancel();
    if (id !== generation.current) return;
    change('requesting', 'Starting microphone…');
    setCanRetry(false);
    try {
      const microphone = await MicrophoneRecording.start((level, seconds) => {
        setLevels(previous => [...previous.slice(1), level]);
        setSecondsLeft(seconds >= RECORDING_SECONDS - 60 ? Math.ceil(RECORDING_SECONDS - seconds) : undefined);
      }, () => { void finish(); });
      if (id !== generation.current) { microphone.cancel(); return; }
      recording.current = microphone;
      setSecondsLeft(undefined);
      change('recording');
    } catch {
      if (id === generation.current) change('failure', 'Allow microphone access in your system settings, then start again.');
    }
  }
  async function retry() {
    if (!api || stateRef.current !== 'failure') return;
    const id = ++generation.current;
    change('processing');
    try { result(await api.retry(), id); }
    catch { if (id === generation.current) change('failure', 'Could not retry. Start a new dictation.'); }
  }
  async function copy() {
    // Tray actions must not replace the controls for a live recording or upload.
    if (['requesting', 'recording', 'processing'].includes(stateRef.current)) return;
    if (await api?.copyLast()) feedback(`Copied. Press ${info.pasteKey} in your text field.`);
    else feedback('No transcript on the clipboard. Start a new dictation.');
  }

  useEffect(() => {
    void api?.info().then(setInfo);
    const action = api?.onAction(value => {
      if (value === 'toggle') void toggle();
      if (value === 'cancel') void cancel();
      if (value === 'retry') void retry();
      if (value === 'copy') void copy();
    });
    const edge = api?.onEdge(edge => setInfo(previous => ({ ...previous, edge })));
    return () => { action?.(); edge?.(); };
  }, [api, info.pasteKey]);

  useEffect(() => () => {
    generation.current++;
    clearTimeout(messageTimer.current);
    recording.current?.cancel();
    recording.current = null;
  }, []);

  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') void cancel(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  });

  useLayoutEffect(() => {
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      const pillHeight = container.current?.querySelector('.pill')?.getBoundingClientRect().height ?? 8;
      api?.resize(Math.ceil(width), Math.ceil(height), pillHeight);
    });
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, [api]);

  const handle = ['idle', 'message'].includes(state) && !hovered;
  const circles = ['requesting', 'recording', 'failure'].includes(state);
  const label = message || (state === 'idle' && hovered ? `Click or press ${info.shortcut} to dictate` : '')
    || (secondsLeft !== undefined && state === 'recording' ? `Recording stops in ${secondsLeft}s` : '');

  return <div ref={container} className={`surface ${info.edge}`} onContextMenu={event => { event.preventDefault(); api?.menu(); }}>
    {label && <div className="label" role="status"><span>{label}</span>
      {state === 'failure' && <button disabled={!canRetry} onClick={() => void retry()}>Retry</button>}
      {state === 'message' && canCopy && <button onClick={() => void copy()}>Copy last</button>}
    </div>}
    <div className={`pill ${handle ? 'handle' : ''} ${state === 'processing' ? 'processing' : ''}`} role={state === 'idle' ? 'button' : 'group'}
      aria-label={state === 'idle' ? 'Start hands-free dictation' : state} tabIndex={0}
      title={info.shortcutAvailable ? 'Click to dictate. Drag to dock. Right-click for options.' : 'Shortcut unavailable. Click to dictate. Right-click for options.'}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); void toggle(); } }}
      onPointerDown={event => {
        if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button'))) return;
        gesture.current = { x: event.screenX, y: event.screenY, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        const start = gesture.current;
        if (!start) return;
        const dx = event.screenX - start.x, dy = event.screenY - start.y;
        if (Math.hypot(dx, dy) > 4) start.moved = true;
        if (start.moved) api?.drag(dx, dy, false);
      }}
      onPointerUp={event => {
        const start = gesture.current;
        gesture.current = undefined;
        if (!start) return;
        if (start.moved) api?.drag(event.screenX - start.x, event.screenY - start.y, true);
        else if (stateRef.current === 'idle' || stateRef.current === 'message') void toggle();
      }}>
      {circles && <button className="circle cancel" aria-label="Cancel dictation" onClick={() => void cancel()}><svg viewBox="0 0 18 18"><path d="M12 6L6 12M6 6l6 6" /></svg></button>}
      {!handle && <div className="waveform" aria-hidden="true">{levels.map((level, index) => <i key={index} style={{ height: 2.25 + (state === 'recording' ? level : 0) * 13.75 }} />)}</div>}
      {state === 'recording' && <button className="circle finish" aria-label="Finish dictation" onClick={() => void finish()}><svg viewBox="0 0 18 18"><path d="M13 6l-5.5 5.5L5 9" /></svg></button>}
      {state === 'processing' && <div className="processing-dots" aria-label="Transcribing"><i/><i/><i/></div>}
    </div>
  </div>;
}
