import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  NOTE_NAMES,
  SCALE_DEFINITIONS,
  midiToName,
  nearestAllowedPitch,
  pitchAllowedByScales,
  type MidiAutomationPoint,
  type MidiNote,
  type MidiScaleId,
  type MidiScaleLock,
  type MidiScaleRule,
} from "../lib/midi";
import { YSButton } from "./YSButton";
import TransportConsole from "./TransportConsole";

export type MidiEditableClip = {
  id: string;
  name: string;
  lengthBars: number;
  midiNotes?: MidiNote[];
  midiPitchBend?: MidiAutomationPoint[];
  midiModulation?: MidiAutomationPoint[];
  midiBendRange?: number;
  midiScales?: MidiScaleRule[];
  midiScaleLock?: MidiScaleLock;
};

export type MidiGhostClip = {
  id: string;
  name: string;
  offsetBars: number;
  lengthBars: number;
  midiNotes?: MidiNote[];
};

type ControlLane = "velocity" | "pitch" | "mod";
type ToolMode = "select" | "pencil" | "razor" | "eraser";
type MidiGridValue =
  | "bar"
  | "1/2"
  | "1/2T"
  | "1/4"
  | "1/4T"
  | "1/8"
  | "1/8T"
  | "1/16"
  | "1/16T"
  | "1/32"
  | "1/32T"
  | "1/64"
  | "1/64T";

type Props = {
  clip: MidiEditableClip;
  clipStartBar: number;
  projectPlayheadBars: number;
  isPlaying: boolean;
  loopEnabled: boolean;
  bpm: number;
  snapEnabled: boolean;
  sigNum?: number;
  sigDen?: number;
  ghostClips?: MidiGhostClip[];
  onChange: (patch: Partial<MidiEditableClip>) => void;
  onPreview: (pitch: number, velocity?: number) => void;
  onSeekProjectBar: (bar: number) => void;
  onReturnStart: () => void;
  onStop: () => void;
  onTogglePlay: () => void;
  onToggleLoop: () => void;
  onJumpEnd: () => void;
  onBpmChange: (value: number) => void;
  onSignatureChange: (num: number, den: number) => void;
  onClose: () => void;
};

const ROW_H = 20;
const KEY_W = 92;
const BASE_BAR_W = 132;
const PITCH_LOW = 24; // C1
const PITCH_HIGH = 96; // C7
const MIN_ZOOM = 25;
const MAX_ZOOM = 400;
const DEFAULT_CONTROLLER_H = 138;
const MIN_CONTROLLER_H = 90;
const MAX_CONTROLLER_H = 260;

const DEFAULT_SCALE_RULE: MidiScaleRule = {
  id: "default-a-minor",
  root: 9, // A
  scaleId: "natural-minor",
};

const MIDI_GRID_STORAGE_KEY = "ysong:midi-editor:grid";

const MIDI_GRID_OPTIONS: Array<{ value: MidiGridValue; label: string }> = [
  { value: "bar", label: "Bar" },
  { value: "1/2", label: "1/2" },
  { value: "1/2T", label: "1/2T" },
  { value: "1/4", label: "1/4" },
  { value: "1/4T", label: "1/4T" },
  { value: "1/8", label: "1/8" },
  { value: "1/8T", label: "1/8T" },
  { value: "1/16", label: "1/16" },
  { value: "1/16T", label: "1/16T" },
  { value: "1/32", label: "1/32" },
  { value: "1/32T", label: "1/32T" },
  { value: "1/64", label: "1/64" },
  { value: "1/64T", label: "1/64T" },
];

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function isMidiGridValue(value: string | null): value is MidiGridValue {
  return MIDI_GRID_OPTIONS.some((option) => option.value === value);
}

function loadSavedMidiGrid(): MidiGridValue {
  if (typeof window === "undefined") return "1/16";
  try {
    const saved = window.localStorage.getItem(MIDI_GRID_STORAGE_KEY);
    return isMidiGridValue(saved) ? saved : "1/16";
  } catch {
    return "1/16";
  }
}

function pitchClass(pitch: number) {
  return ((Math.round(pitch) % 12) + 12) % 12;
}

function isBlackKey(pitch: number) {
  return [1, 3, 6, 8, 10].includes(pitchClass(pitch));
}

function noteValueToBars(value: MidiGridValue, sigNum: number, sigDen: number) {
  if (value === "bar") return 1;
  const triplet = value.endsWith("T");
  const base = triplet ? value.slice(0, -1) : value;
  const div = Number(base.split("/")[1] || 4);
  const wholeNoteBars = 1 / Math.max(0.0001, sigNum / sigDen);
  let bars = (1 / div) * wholeNoteBars;
  if (triplet) bars *= 2 / 3;
  return clamp(bars, 1 / 1024, 4);
}

function ScaleLabel({ rule }: { rule: MidiScaleRule }) {
  const scale = SCALE_DEFINITIONS.find((s) => s.id === rule.scaleId);
  return <>{NOTE_NAMES[rule.root]} {scale?.friendlyLabel ?? scale?.label ?? rule.scaleId}</>;
}

function ToolIcon({ tool }: { tool: ToolMode }) {
  if (tool === "select") {
    return <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 3l11 8-5 1.5L14 19l-2.5 1-3-6.5L5 17V3z" /></svg>;
  }
  if (tool === "pencil") {
    return <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 20l4.2-1 10.6-10.6-3.2-3.2L5 15.8 4 20z" /><path d="M14.7 6.1l3.2 3.2" /></svg>;
  }
  if (tool === "razor") {
    return <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 15l10-10 6 6-10 10H4v-6z" /><path d="M8 17h8" /></svg>;
  }
  return <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 16L15 7l4 4-8 8H7l-1-3z" /><path d="M12 19h8" /></svg>;
}

export default function MidiEditor({
  clip,
  clipStartBar,
  projectPlayheadBars,
  isPlaying,
  loopEnabled,
  bpm,
  snapEnabled,
  sigNum = 4,
  sigDen = 4,
  ghostClips = [],
  onChange,
  onPreview,
  onSeekProjectBar,
  onReturnStart,
  onStop,
  onTogglePlay,
  onToggleLoop,
  onJumpEnd,
  onBpmChange,
  onSignatureChange,
  onClose,
}: Props) {
  const notes = useMemo(() => clip.midiNotes ?? [], [clip.midiNotes]);
  const pitchBend = clip.midiPitchBend ?? [];
  const modulation = clip.midiModulation ?? [];
  const bendRange = clip.midiBendRange ?? 12;
  const scaleRules = useMemo(() => clip.midiScales?.length ? clip.midiScales : [DEFAULT_SCALE_RULE], [clip.midiScales]);
  const scaleLock = clip.midiScaleLock ?? "soft";

  const [lane, setLane] = useState<ControlLane>("velocity");
  const [tool, setTool] = useState<ToolMode>("pencil");
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [activeScaleRuleId, setActiveScaleRuleId] = useState<string>(scaleRules[0]?.id ?? DEFAULT_SCALE_RULE.id);
  const [gridValue, setGridValue] = useState<MidiGridValue>(loadSavedMidiGrid);
  const [editorSnap, setEditorSnap] = useState(snapEnabled);
  const [zoomPct, setZoomPct] = useState(100);
  const [controllerH, setControllerH] = useState(DEFAULT_CONTROLLER_H);

  const pianoScrollRef = useRef<HTMLDivElement | null>(null);
  const controllerScrollRef = useRef<HTMLDivElement | null>(null);
  const syncingScrollRef = useRef(false);

  useEffect(() => {
    if ((clip.midiScales?.length ?? 0) === 0 || clip.midiScaleLock == null || clip.midiScaleLock === "off") {
      onChange({
        ...(clip.midiScales?.length ? {} : { midiScales: [{ ...DEFAULT_SCALE_RULE, id: crypto.randomUUID() }] }),
        ...(clip.midiScaleLock == null || clip.midiScaleLock === "off" ? { midiScaleLock: "soft" as MidiScaleLock } : {}),
      });
    }
    // seed once for older pre-alpha clips
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.id]);

  useEffect(() => {
    if (!scaleRules.some((r) => r.id === activeScaleRuleId)) setActiveScaleRuleId(scaleRules[0]?.id ?? "");
  }, [activeScaleRuleId, scaleRules]);

  const activeRule = scaleRules.find((r) => r.id === activeScaleRuleId) ?? scaleRules[0] ?? DEFAULT_SCALE_RULE;

  const pitches = useMemo(() => {
    const out: number[] = [];
    for (let p = PITCH_HIGH; p >= PITCH_LOW; p--) out.push(p);
    return out;
  }, []);

  const barW = BASE_BAR_W * (zoomPct / 100);
  const gridStepBars = noteValueToBars(gridValue, sigNum, sigDen);

  const furthestOwnNote = useMemo(() => notes.reduce((m, n) => Math.max(m, n.startBars + n.lengthBars), 0), [notes]);
  const furthestGhost = useMemo(() => ghostClips.reduce((m, c) => {
    const noteEnd = (c.midiNotes ?? []).reduce((x, n) => Math.max(x, c.offsetBars + n.startBars + n.lengthBars), c.offsetBars + c.lengthBars);
    return Math.max(m, noteEnd);
  }, 0), [ghostClips]);
  const earliestGhost = useMemo(() => ghostClips.reduce((m, c) => Math.min(m, c.offsetBars), 0), [ghostClips]);

  // Keep context visible after the active clip so it can be extended without leaving the editor.
  // Previous ghost clips can appear if they overlap the beginning; the editor still starts at bar 1 of this clip.
  const editorBars = Math.max(8, Math.ceil(clip.lengthBars + 8), Math.ceil(furthestOwnNote + 2), Math.ceil(furthestGhost + 2));
  const width = Math.max(880, editorBars * barW);
  const height = pitches.length * ROW_H;
  const localPlayheadBars = projectPlayheadBars - clipStartBar;
  const playheadVisible = localPlayheadBars >= 0 && localPlayheadBars <= editorBars;
  const playheadX = localPlayheadBars * barW;

  const snap = (bars: number, max = editorBars) => {
    const value = clamp(bars, 0, max);
    if (!editorSnap) return value;
    const step = Math.max(1 / 1024, gridStepBars);
    return clamp(Math.round(value / step) * step, 0, max);
  };

  // Pencil placement is cell-based: clicking anywhere inside a grid cell must
  // place the note at the START of that cell. Math.round() made clicks in the
  // right half jump forward into the next cell, which felt like the editor
  // ignored the bar the user actually clicked. Existing-note moves/resizes can
  // still use nearest-grid snapping via snap().
  const snapPencilStart = (bars: number, max = editorBars) => {
    const value = clamp(bars, 0, max);
    if (!editorSnap) return value;
    const step = Math.max(1 / 1024, gridStepBars);
    return clamp(Math.floor((value + 1e-9) / step) * step, 0, max);
  };

  const enforceScale = (pitch: number) => scaleLock === "strict"
    ? nearestAllowedPitch(pitch, scaleRules)
    : clamp(Math.round(pitch), 0, 127);

  const updateNote = (id: string, patch: Partial<MidiNote>) => {
    onChange({ midiNotes: notes.map((n) => n.id === id ? { ...n, ...patch } : n) });
  };

  const replaceNotes = (next: MidiNote[]) => onChange({ midiNotes: next });

  const removeNote = (id: string) => {
    replaceNotes(notes.filter((n) => n.id !== id));
    if (selectedNoteId === id) setSelectedNoteId(null);
  };

  const addNoteAt = (pitch: number, clientX: number, rect: DOMRect) => {
    const start = snapPencilStart((clientX - rect.left) / barW);
    const length = gridStepBars;
    const actualPitch = enforceScale(pitch);
    const note: MidiNote = {
      id: crypto.randomUUID(),
      pitch: actualPitch,
      startBars: Math.max(0, start),
      lengthBars: Math.max(1 / 1024, length),
      velocity: 96,
    };
    replaceNotes([...notes, note]);
    setSelectedNoteId(note.id);
    onPreview(note.pitch, note.velocity);
  };

  const splitNote = (note: MidiNote, clientX: number, rect: DOMRect) => {
    const absolute = note.startBars + ((clientX - rect.left) / Math.max(1, rect.width)) * note.lengthBars;
    const splitAt = snap(absolute, editorBars);
    const min = Math.max(1 / 1024, gridStepBars / 8);
    if (splitAt <= note.startBars + min || splitAt >= note.startBars + note.lengthBars - min) return;
    const left: MidiNote = { ...note, lengthBars: splitAt - note.startBars };
    const right: MidiNote = {
      ...note,
      id: crypto.randomUUID(),
      startBars: splitAt,
      lengthBars: note.startBars + note.lengthBars - splitAt,
    };
    replaceNotes(notes.flatMap((n) => n.id === note.id ? [left, right] : [n]));
    setSelectedNoteId(right.id);
  };

  type DragState = {
    noteId: string;
    mode: "move" | "resize";
    startX: number;
    startY: number;
    startBars: number;
    lengthBars: number;
    pitch: number;
  };
  const dragRef = useRef<DragState | null>(null);

  const beginNoteDrag = (note: MidiNote, mode: "move" | "resize") => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (tool === "eraser") {
      removeNote(note.id);
      return;
    }
    if (tool === "razor") {
      splitNote(note, e.clientX, (e.currentTarget as HTMLElement).getBoundingClientRect());
      return;
    }
    setSelectedNoteId(note.id);
    if (tool !== "select") {
      onPreview(note.pitch, note.velocity);
      return;
    }
    dragRef.current = {
      noteId: note.id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      startBars: note.startBars,
      lengthBars: note.lengthBars,
      pitch: note.pitch,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onNoteDrag = (e: React.PointerEvent) => {
    const st = dragRef.current;
    if (!st) return;
    e.preventDefault();
    const dxBars = (e.clientX - st.startX) / barW;
    if (st.mode === "resize") {
      const raw = st.lengthBars + dxBars;
      const next = editorSnap ? Math.round(raw / gridStepBars) * gridStepBars : raw;
      updateNote(st.noteId, { lengthBars: Math.max(1 / 1024, next) });
      return;
    }
    const dyRows = Math.round((e.clientY - st.startY) / ROW_H);
    let nextStart = st.startBars + dxBars;
    if (editorSnap) nextStart = snap(nextStart);
    nextStart = Math.max(0, nextStart);
    const nextPitch = enforceScale(st.pitch - dyRows);
    updateNote(st.noteId, { startBars: nextStart, pitch: nextPitch });
  };

  const endNoteDrag = () => { dragRef.current = null; };

  const updateVelocityFromEvent = (note: MidiNote, e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.parentElement?.getBoundingClientRect();
    if (!rect) return;
    const value = clamp(Math.round(((rect.bottom - e.clientY) / rect.height) * 127), 1, 127);
    updateNote(note.id, { velocity: value });
  };

  const addAutomationPoint = (which: "pitch" | "mod", e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const atBars = snap((e.clientX - rect.left) / barW);
    const frac = clamp((rect.bottom - e.clientY) / rect.height, 0, 1);
    if (which === "pitch") {
      const value = (frac * 2 - 1) * bendRange;
      onChange({ midiPitchBend: [...pitchBend, { id: crypto.randomUUID(), atBars, value }].sort((a, b) => a.atBars - b.atBars) });
    } else {
      const value = Math.round(frac * 127);
      onChange({ midiModulation: [...modulation, { id: crypto.randomUUID(), atBars, value }].sort((a, b) => a.atBars - b.atBars) });
    }
  };

  const moveAutomationPoint = (which: "pitch" | "mod", point: MidiAutomationPoint, e: React.PointerEvent<HTMLButtonElement>) => {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
    e.preventDefault();
    e.stopPropagation();
    const laneEl = e.currentTarget.parentElement;
    if (!laneEl) return;
    const rect = laneEl.getBoundingClientRect();
    const atBars = snap((e.clientX - rect.left) / barW);
    const frac = clamp((rect.bottom - e.clientY) / rect.height, 0, 1);
    const list = which === "pitch" ? pitchBend : modulation;
    const value = which === "pitch" ? (frac * 2 - 1) * bendRange : Math.round(frac * 127);
    const next = list.map((p) => p.id === point.id ? { ...p, atBars, value } : p).sort((a, b) => a.atBars - b.atBars);
    onChange(which === "pitch" ? { midiPitchBend: next } : { midiModulation: next });
  };

  const automationSvgPoints = (points: MidiAutomationPoint[], which: "pitch" | "mod") => points
    .slice().sort((a, b) => a.atBars - b.atBars)
    .map((p) => {
      const x = (p.atBars / Math.max(0.0001, editorBars)) * 100;
      const normalized = which === "pitch" ? (p.value / Math.max(1, bendRange) + 1) / 2 : p.value / 127;
      const y = (1 - clamp(normalized, 0, 1)) * 100;
      return `${x},${y}`;
    }).join(" ");

  const updateActiveScale = (patch: Partial<MidiScaleRule>) => {
    const current = scaleRules.find((r) => r.id === activeRule.id) ?? activeRule;
    const next = scaleRules.map((r) => r.id === current.id ? { ...r, ...patch } : r);
    onChange({ midiScales: next.length ? next : [{ ...DEFAULT_SCALE_RULE, id: crypto.randomUUID() }] });
  };

  const addScaleRule = () => {
    const id = crypto.randomUUID();
    onChange({ midiScales: [...scaleRules, { id, root: 0, scaleId: "major" }] });
    setActiveScaleRuleId(id);
  };

  const removeScaleRule = (id: string) => {
    if (scaleRules.length <= 1) return;
    const next = scaleRules.filter((r) => r.id !== id);
    onChange({ midiScales: next });
    if (activeScaleRuleId === id) setActiveScaleRuleId(next[0]?.id ?? "");
  };

  const syncFromPiano = () => {
    if (syncingScrollRef.current) return;
    const p = pianoScrollRef.current;
    const c = controllerScrollRef.current;
    if (!p || !c) return;
    syncingScrollRef.current = true;
    c.scrollLeft = p.scrollLeft;
    requestAnimationFrame(() => { syncingScrollRef.current = false; });
  };

  const syncFromController = () => {
    if (syncingScrollRef.current) return;
    const p = pianoScrollRef.current;
    const c = controllerScrollRef.current;
    if (!p || !c) return;
    syncingScrollRef.current = true;
    p.scrollLeft = c.scrollLeft;
    requestAnimationFrame(() => { syncingScrollRef.current = false; });
  };

  const seekFromRuler = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const local = clamp((e.clientX - rect.left) / Math.max(1, barW), 0, editorBars);
    onSeekProjectBar(clipStartBar + local);
  };

  useEffect(() => {
    if (!isPlaying || !playheadVisible) return;
    const pane = pianoScrollRef.current;
    if (!pane) return;
    const x = KEY_W + playheadX;
    const margin = Math.max(70, pane.clientWidth * 0.14);
    const leftEdge = pane.scrollLeft + margin;
    const rightEdge = pane.scrollLeft + pane.clientWidth - margin;
    if (x < leftEdge || x > rightEdge) {
      pane.scrollLeft = clamp(x - pane.clientWidth * 0.18, 0, Math.max(0, pane.scrollWidth - pane.clientWidth));
      syncFromPiano();
    }
  }, [isPlaying, playheadVisible, playheadX]);

  const resizeClipRef = useRef<{ startX: number; startLength: number } | null>(null);
  const beginClipResize = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    resizeClipRef.current = { startX: e.clientX, startLength: clip.lengthBars };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const moveClipResize = (e: React.PointerEvent<HTMLButtonElement>) => {
    const st = resizeClipRef.current;
    if (!st || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const raw = st.startLength + (e.clientX - st.startX) / barW;
    const next = editorSnap ? Math.round(raw / gridStepBars) * gridStepBars : raw;
    onChange({ lengthBars: clamp(next, Math.max(gridStepBars, 1 / 64), editorBars) });
  };
  const endClipResize = (e: React.PointerEvent<HTMLButtonElement>) => {
    resizeClipRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const handleGridPointerDown = (pitch: number, e: React.PointerEvent<HTMLDivElement>) => {
    if (tool !== "pencil") {
      if (tool === "select") setSelectedNoteId(null);
      return;
    }
    e.preventDefault();
    addNoteAt(pitch, e.clientX, e.currentTarget.getBoundingClientRect());
  };

  const body = (
    <div className="fixed inset-0 z-[500] bg-black/70 backdrop-blur-sm flex items-center justify-center p-1 sm:p-3" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-[99vw] h-[96vh] max-w-[1700px] bg-neutral-950 border border-white/15 rounded-xl shadow-2xl overflow-hidden flex flex-col text-neutral-100">
        <div className="shrink-0 px-3 py-2 border-b border-white/10 flex flex-wrap items-center gap-2">
          <div className="font-semibold mr-2">MIDI Editor · {clip.name}</div>

          <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-black/30 p-1">
            {(["select", "pencil", "razor", "eraser"] as ToolMode[]).map((t) => (
              <button
                key={t}
                type="button"
                className={`w-8 h-8 rounded-md grid place-items-center ${tool === t ? "bg-sky-500/25 text-sky-200 ring-1 ring-sky-300/40" : "hover:bg-white/10 text-white/75"}`}
                onClick={() => setTool(t)}
                title={t === "select" ? "Selection / Move" : t === "pencil" ? "Pencil / Add note" : t === "razor" ? "Razor / Split note" : "Eraser / Delete note"}
              >
                <ToolIcon tool={t} />
              </button>
            ))}
          </div>

          <button type="button" className={`px-2 py-1 rounded text-xs border ${editorSnap ? "bg-white text-black border-white" : "border-white/15 hover:bg-white/10"}`} onClick={() => setEditorSnap((v) => !v)}>SNAP</button>
          <span className="text-[11px] opacity-55">Grid</span>
          <select
            className="bg-neutral-900 border border-white/10 rounded px-2 py-1 text-xs"
            value={gridValue}
            onChange={(e) => {
              const next = e.target.value as MidiGridValue;
              setGridValue(next);
              try { window.localStorage.setItem(MIDI_GRID_STORAGE_KEY, next); } catch { /* localStorage may be unavailable */ }
            }}
          >
            {MIDI_GRID_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-[11px] opacity-55">Scale Lock</span>
            <select className="bg-neutral-900 border border-white/10 rounded px-2 py-1 text-xs" value={scaleLock} onChange={(e) => onChange({ midiScaleLock: e.target.value as MidiScaleLock })}>
              <option value="off">Off</option><option value="soft">Soft</option><option value="strict">Strict</option>
            </select>
            <span className="text-[11px] opacity-55">Scale</span>
            <select className="bg-neutral-900 border border-white/10 rounded px-2 py-1 text-xs" value={activeRule.root} onChange={(e) => updateActiveScale({ root: Number(e.target.value) })}>
              {NOTE_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
            </select>
            <select className="bg-neutral-900 border border-white/10 rounded px-2 py-1 text-xs max-w-48" value={activeRule.scaleId} onChange={(e) => updateActiveScale({ scaleId: e.target.value as MidiScaleId })}>
              {SCALE_DEFINITIONS.map((s) => <option key={s.id} value={s.id}>{s.friendlyLabel ?? s.label}</option>)}
            </select>
            <YSButton className="px-2 py-1 text-xs rounded" onClick={addScaleRule}>+ Scale</YSButton>
            <YSButton className="px-3 py-1 text-xs rounded" onClick={onClose}>Close</YSButton>
          </div>
        </div>

        <div className="shrink-0 px-3 py-1.5 border-b border-white/10 flex gap-1.5 flex-wrap items-center min-h-9">
          {scaleRules.map((r, i) => (
            <button
              key={r.id}
              type="button"
              className={`text-[11px] rounded-full px-2 py-1 border ${r.id === activeRule.id ? "border-amber-200/60 bg-amber-300/20" : "border-amber-300/20 bg-amber-300/8 hover:bg-amber-300/15"}`}
              onClick={() => setActiveScaleRuleId(r.id)}
              title={i === 0 ? "Primary scale" : "Click to edit this allowed scale"}
            >
              <ScaleLabel rule={r} />{scaleRules.length > 1 && <span onClick={(e) => { e.stopPropagation(); removeScaleRule(r.id); }} className="ml-1 opacity-60 hover:opacity-100">×</span>}
            </button>
          ))}
          <span className="text-[11px] opacity-50">{scaleLock === "strict" ? "Strict: out-of-scale notes snap to the nearest allowed pitch." : scaleLock === "soft" ? "Soft: scale tones are highlighted; chromatic notes remain available." : "Chromatic editing."}</span>

          <div className="ml-auto w-[250px] max-w-[42vw]">
            <div className="flex items-center justify-end gap-1 text-[10px]">
              <span className="opacity-60">🔍</span>
              <button type="button" className="px-1.5 py-0.5 rounded border border-white/10 hover:bg-white/10" onClick={() => setZoomPct((z) => clamp(z - 25, MIN_ZOOM, MAX_ZOOM))}>−</button>
              <button type="button" className="min-w-12 px-1.5 py-0.5 rounded hover:bg-white/10" title="Double-click to reset" onDoubleClick={() => setZoomPct(100)}>{zoomPct}%</button>
              <button type="button" className="px-1.5 py-0.5 rounded border border-white/10 hover:bg-white/10" onClick={() => setZoomPct((z) => clamp(z + 25, MIN_ZOOM, MAX_ZOOM))}>+</button>
            </div>
            <input aria-label="MIDI horizontal zoom" className="w-full h-1 accent-sky-300" type="range" min={MIN_ZOOM} max={MAX_ZOOM} step={5} value={zoomPct} onChange={(e) => setZoomPct(Number(e.target.value))} />
          </div>
        </div>

        <div className="shrink-0 border-b border-white/10 bg-neutral-950/75 px-2 py-2 flex justify-center">
          <TransportConsole
            compact
            playheadPosBars={projectPlayheadBars}
            isPlaying={isPlaying}
            loopEnabled={loopEnabled}
            bpm={bpm}
            sigNum={sigNum}
            sigDen={sigDen}
            onReturnStart={onReturnStart}
            onStop={onStop}
            onTogglePlay={onTogglePlay}
            onRecord={() => {}}
            onToggleLoop={onToggleLoop}
            onJumpEnd={onJumpEnd}
            onBpmChange={onBpmChange}
            onSignatureChange={onSignatureChange}
          />
        </div>

        <div className="flex-1 min-h-0 flex flex-col bg-neutral-950">
          <div ref={pianoScrollRef} onScroll={syncFromPiano} className="flex-1 min-h-0 overflow-auto relative">
            <div className="relative" style={{ width: KEY_W + width, minHeight: 29 + height }}>
              <div
                className="sticky top-0 z-50 h-7 border-b border-white/10 bg-neutral-950/98 cursor-pointer"
                style={{ marginLeft: KEY_W, width }}
                onPointerDown={(e) => {
                  if ((e.target as HTMLElement).closest("button")) return;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  seekFromRuler(e);
                }}
                onPointerMove={(e) => {
                  if (e.currentTarget.hasPointerCapture(e.pointerId)) seekFromRuler(e);
                }}
                onPointerUp={(e) => {
                  if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
                }}
                title="Click or drag to move the project playhead"
              >
                {Array.from({ length: Math.ceil(editorBars) + 1 }, (_, i) => (
                  <div key={i} className="absolute top-0 bottom-0 border-l border-white/15 text-[10px] text-white/60 pl-1 pt-1" style={{ left: i * barW }}>{i + 1}</div>
                ))}
                <div className="absolute top-0 bottom-0 bg-neutral-500/10 pointer-events-none" style={{ left: clip.lengthBars * barW, width: Math.max(0, width - clip.lengthBars * barW) }} />
                <div className="absolute top-0 bottom-0 border-l border-amber-200/80 pointer-events-none" style={{ left: clip.lengthBars * barW }} />
                {playheadVisible && <div className="absolute top-0 bottom-0 border-l-2 border-sky-300 pointer-events-none z-30" style={{ left: playheadX }} />}
                <button
                  type="button"
                  className="absolute -translate-x-1/2 top-0 text-amber-100 text-[13px] leading-none hover:text-white cursor-ew-resize z-20"
                  style={{ left: clip.lengthBars * barW }}
                  onPointerDown={beginClipResize}
                  onPointerMove={moveClipResize}
                  onPointerUp={endClipResize}
                  onPointerCancel={endClipResize}
                  title="Drag to extend or shorten MIDI clip"
                >▼</button>
              </div>

              <div className="sticky left-0 z-40 bg-neutral-950 border-r border-white/10" style={{ width: KEY_W, height, marginTop: 0 }}>
                {pitches.filter((p) => !isBlackKey(p)).map((pitch) => {
                  const row = PITCH_HIGH - pitch;
                  const allowed = pitchAllowedByScales(pitch, scaleRules);
                  const keyH = ROW_H * 1.75;
                  return <button
                    key={`w-${pitch}`}
                    type="button"
                    className={`absolute right-0 border border-neutral-500/70 bg-neutral-100 text-neutral-900 text-[9px] text-right pr-1.5 hover:bg-white ${scaleLock === "strict" && !allowed ? "brightness-75" : ""}`}
                    style={{ top: row * ROW_H - keyH / 2 + ROW_H / 2, width: KEY_W, height: keyH, zIndex: 1 }}
                    onPointerDown={() => onPreview(pitch, 96)}
                  >{midiToName(pitch)}</button>;
                })}
                {pitches.filter((p) => isBlackKey(p)).map((pitch) => {
                  const row = PITCH_HIGH - pitch;
                  const allowed = pitchAllowedByScales(pitch, scaleRules);
                  return <button
                    key={`b-${pitch}`}
                    type="button"
                    className={`absolute left-0 border border-black bg-neutral-700 text-white text-[8px] text-right pr-1 hover:bg-neutral-600 shadow-md ${scaleLock === "strict" && !allowed ? "opacity-45" : ""}`}
                    style={{ top: row * ROW_H + 2, width: KEY_W * 0.62, height: ROW_H - 4, zIndex: 3 }}
                    onPointerDown={() => onPreview(pitch, 96)}
                  >{midiToName(pitch)}</button>;
                })}
              </div>

              <div className="absolute" style={{ left: KEY_W, top: 27, width, height }}>
                {playheadVisible && <div className="absolute top-0 bottom-0 border-l-2 border-sky-300/90 pointer-events-none z-40" style={{ left: playheadX }} />}
                {pitches.map((pitch, row) => {
                  const black = isBlackKey(pitch);
                  const allowed = pitchAllowedByScales(pitch, scaleRules);
                  return <div
                    key={pitch}
                    className={`absolute left-0 right-0 border-b border-white/[0.055] ${black ? "bg-white/[0.022]" : ""} ${scaleLock !== "off" && allowed ? "bg-amber-200/[0.055]" : ""} ${scaleLock === "strict" && !allowed ? "bg-black/55" : ""}`}
                    style={{ top: row * ROW_H, height: ROW_H }}
                    onPointerDown={(e) => handleGridPointerDown(pitch, e)}
                  />;
                })}

                {Array.from({ length: Math.ceil(editorBars / Math.max(1 / 1024, gridStepBars)) + 1 }, (_, i) => {
                  const barPos = i * gridStepBars;
                  const nearestBar = Math.round(barPos);
                  const strong = Math.abs(barPos - nearestBar) < 1e-6;
                  return <div key={i} className="absolute top-0 bottom-0 pointer-events-none" style={{ left: barPos * barW, width: 1, background: strong ? "rgba(255,255,255,.18)" : "rgba(255,255,255,.045)" }} />;
                })}

                <div className="absolute top-0 bottom-0 bg-neutral-500/12 pointer-events-none" style={{ left: clip.lengthBars * barW, width: Math.max(0, width - clip.lengthBars * barW) }} />
                <div className="absolute top-0 bottom-0 border-l border-amber-200/80 pointer-events-none" style={{ left: clip.lengthBars * barW }} />

                {ghostClips.flatMap((ghost) => (ghost.midiNotes ?? []).map((note) => {
                  const xBars = ghost.offsetBars + note.startBars;
                  const end = xBars + note.lengthBars;
                  if (end <= 0 || xBars >= editorBars || note.pitch < PITCH_LOW || note.pitch > PITCH_HIGH) return null;
                  const row = PITCH_HIGH - note.pitch;
                  return <div
                    key={`ghost-${ghost.id}-${note.id}`}
                    className="absolute rounded-sm border border-white/10 bg-white/15 pointer-events-none"
                    style={{ left: xBars * barW, top: row * ROW_H + 3, width: Math.max(4, note.lengthBars * barW), height: ROW_H - 6, zIndex: 5 }}
                    title={`${ghost.name} · ${midiToName(note.pitch)}`}
                  />;
                }))}

                {notes.map((note) => {
                  if (note.pitch < PITCH_LOW || note.pitch > PITCH_HIGH) return null;
                  const row = PITCH_HIGH - note.pitch;
                  const selected = selectedNoteId === note.id;
                  const lightness = 16 + (note.velocity / 127) * 56;
                  const solid = `hsl(28 92% ${lightness}%)`;
                  const endBars = note.startBars + note.lengthBars;
                  const inStart = clamp((clip.lengthBars - note.startBars) / Math.max(0.0001, note.lengthBars), 0, 1) * 100;
                  const fullyOutside = note.startBars >= clip.lengthBars;
                  const crossesBoundary = note.startBars < clip.lengthBars && endBars > clip.lengthBars;
                  const background = fullyOutside
                    ? `hsla(28 92% ${lightness}% / .24)`
                    : crossesBoundary
                      ? `linear-gradient(to right, ${solid} 0%, ${solid} ${inStart}%, hsla(28 92% ${lightness}% / .24) ${inStart}%, hsla(28 92% ${lightness}% / .24) 100%)`
                      : solid;
                  return <div
                    key={note.id}
                    className={`absolute rounded-sm border shadow-sm group ${tool === "select" ? "cursor-grab" : tool === "razor" ? "cursor-col-resize" : tool === "eraser" ? "cursor-not-allowed" : "cursor-pointer"} ${selected ? "border-white ring-2 ring-sky-300/45" : "border-black/35"}`}
                    style={{ left: note.startBars * barW, top: row * ROW_H + 2, width: Math.max(7, note.lengthBars * barW), height: ROW_H - 4, background, zIndex: 20 }}
                    onPointerDown={beginNoteDrag(note, "move")}
                    onPointerMove={onNoteDrag}
                    onPointerUp={endNoteDrag}
                    onPointerCancel={endNoteDrag}
                    onDoubleClick={() => onPreview(note.pitch, note.velocity)}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); removeNote(note.id); }}
                    title={`${midiToName(note.pitch)} · velocity ${note.velocity}`}
                  >
                    <span className="absolute left-1 top-0 text-[9px] leading-4 text-black/75 font-medium pointer-events-none">{midiToName(note.pitch)}</span>
                    {tool === "select" && <span className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-black/10 opacity-0 group-hover:opacity-100" onPointerDown={beginNoteDrag(note, "resize")} />}
                  </div>;
                })}
              </div>
            </div>
          </div>

          <div
            className="shrink-0 h-1.5 cursor-ns-resize bg-white/[0.04] hover:bg-sky-300/20 border-y border-white/[0.05]"
            onPointerDown={(e) => {
              e.preventDefault();
              const startY = e.clientY;
              const startH = controllerH;
              const target = e.currentTarget;
              target.setPointerCapture(e.pointerId);
              const move = (ev: PointerEvent) => setControllerH(clamp(startH - (ev.clientY - startY), MIN_CONTROLLER_H, MAX_CONTROLLER_H));
              const up = (ev: PointerEvent) => {
                target.releasePointerCapture(ev.pointerId);
                target.removeEventListener("pointermove", move);
                target.removeEventListener("pointerup", up);
              };
              target.addEventListener("pointermove", move);
              target.addEventListener("pointerup", up);
            }}
            title="Drag to resize controller lane"
          />

          <div className="shrink-0 flex border-t border-white/10 bg-neutral-900/80" style={{ height: controllerH }}>
            <div className="shrink-0 border-r border-white/10 bg-neutral-950 p-1.5 relative" style={{ width: KEY_W }}>
              <select className="w-full bg-neutral-900 border border-white/10 rounded px-1 py-1 text-[10px]" value={lane} onChange={(e) => setLane(e.target.value as ControlLane)}>
                <option value="velocity">Velocity</option><option value="pitch">Pitch Bend</option><option value="mod">Mod Wheel</option>
              </select>
              {lane === "pitch" && <label className="block mt-2 text-[9px] opacity-70">Range ±
                <input className="mt-1 w-full bg-neutral-900 border border-white/10 rounded px-1 py-1 text-[10px]" type="number" min={1} max={48} value={bendRange} onChange={(e) => onChange({ midiBendRange: clamp(Number(e.target.value || 12), 1, 48) })} />
              </label>}
              {lane === "velocity" && <>
                <span className="absolute right-1 top-8 text-[9px] opacity-60">127</span>
                <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[9px] opacity-60">64</span>
                <span className="absolute right-1 bottom-1 text-[9px] opacity-60">0</span>
              </>}
              {lane === "mod" && <>
                <span className="absolute right-1 top-8 text-[9px] opacity-60">127</span>
                <span className="absolute right-1 bottom-1 text-[9px] opacity-60">0</span>
              </>}
              {lane === "pitch" && <>
                <span className="absolute right-1 top-8 text-[9px] opacity-60">+{bendRange}</span>
                <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[9px] opacity-60">0</span>
                <span className="absolute right-1 bottom-1 text-[9px] opacity-60">−{bendRange}</span>
              </>}
            </div>

            <div ref={controllerScrollRef} onScroll={syncFromController} className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden">
              <div className="relative h-full" style={{ width }}>
                <div className="absolute top-0 bottom-0 bg-neutral-500/12 pointer-events-none" style={{ left: clip.lengthBars * barW, width: Math.max(0, width - clip.lengthBars * barW) }} />
                <div className="absolute top-0 bottom-0 border-l border-amber-200/60 pointer-events-none" style={{ left: clip.lengthBars * barW }} />
                {playheadVisible && <div className="absolute top-0 bottom-0 border-l-2 border-sky-300/90 pointer-events-none z-30" style={{ left: playheadX }} />}

                {lane === "velocity" && <div className="absolute inset-0">
                  {[0, 64, 127].map((v) => <div key={v} className="absolute left-0 right-0 border-t border-white/[0.065]" style={{ bottom: `${(v / 127) * 100}%` }} />)}
                  {notes.map((note) => {
                    const x = (note.startBars + note.lengthBars / 2) * barW;
                    const h = Math.max(3, (note.velocity / 127) * (controllerH - 12));
                    const outside = note.startBars >= clip.lengthBars;
                    return <div key={note.id} className={`absolute bottom-1 w-2.5 -translate-x-1/2 border cursor-ns-resize ${outside ? "bg-amber-300/20 border-amber-100/15" : "bg-amber-300/75 border-amber-100/45"}`} style={{ left: x, height: h }} onPointerDown={(e) => { setSelectedNoteId(note.id); updateVelocityFromEvent(note, e); e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) updateVelocityFromEvent(note, e); }} onDoubleClick={() => updateNote(note.id, { velocity: 96 })} title={`Velocity ${note.velocity}`} />;
                  })}
                </div>}

                {(lane === "pitch" || lane === "mod") && (() => {
                  const which = lane === "pitch" ? "pitch" : "mod";
                  const points = which === "pitch" ? pitchBend : modulation;
                  return <div className="absolute inset-0 cursor-crosshair" onPointerDown={(e) => { if (e.target === e.currentTarget) addAutomationPoint(which, e); }}>
                    {which === "pitch" && <div className="absolute left-0 right-0 top-1/2 border-t border-sky-200/20" />}
                    <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points={automationSvgPoints(points, which)} fill="none" stroke="rgba(125,211,252,.85)" strokeWidth="1" vectorEffect="non-scaling-stroke" /></svg>
                    {points.map((p) => {
                      const left = (p.atBars / Math.max(0.0001, editorBars)) * 100;
                      const normalized = which === "pitch" ? (p.value / Math.max(1, bendRange) + 1) / 2 : p.value / 127;
                      const top = (1 - clamp(normalized, 0, 1)) * 100;
                      const outside = p.atBars > clip.lengthBars;
                      return <button key={p.id} type="button" className={`absolute w-3 h-3 -translate-x-1/2 -translate-y-1/2 rounded-full border shadow cursor-move ${outside ? "bg-sky-300/25 border-white/25" : "bg-sky-300 border-white"}`} style={{ left: `${left}%`, top: `${top}%` }} onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={(e) => moveAutomationPoint(which, p, e)} onPointerUp={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }} onContextMenu={(e) => { e.preventDefault(); const next = points.filter((x) => x.id !== p.id); onChange(which === "pitch" ? { midiPitchBend: next } : { midiModulation: next }); }} title={which === "pitch" ? `${p.value.toFixed(2)} semitones` : `CC1 ${Math.round(p.value)}`} />;
                    })}
                  </div>;
                })()}
              </div>
            </div>
          </div>
        </div>

        <div className="shrink-0 px-3 py-1.5 border-t border-white/10 text-[10px] text-white/45 flex flex-wrap gap-x-4 gap-y-1">
          <span>Pencil: single-click to add · Arrow: move/resize · Razor: split · Eraser: delete</span>
          <span>Drag ▼ on the ruler to resize the MIDI clip. Notes beyond it are preserved and ghosted.</span>
          {earliestGhost < 0 && <span>Previous MIDI context may begin before this clip.</span>}
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(body, document.body) : null;
}
