// src/tabs/DAW.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TabRendererProps } from "./core";
import { YSButton } from "../components/YSButton";

type TrackType = "audio" | "instrument";

type Track = {
    id: string;
    type: TrackType;
    name: string;
    mute: boolean;
    solo: boolean;
    arm: boolean;
};

const ROW_H = 44;
const BAR_W = 96;
const BARS = 64;

// Add-track menu sizing (used for viewport clamping)
const MENU_W = 240;
const MENU_H = 112;

// Transport
const TICKS_PER_BEAT = 96;

// Bottom-center drawer handle(s) sit on top of the app; reserve space so transport text isn't covered.
const BOTTOM_DOCK_SAFE_PX = 28;

function mkTrack(type: TrackType, index: number): Track {
    return {
        id: crypto.randomUUID(),
        type,
        name: type === "audio" ? `Audio ${index}` : `Instrument ${index}`,
        mute: false,
        solo: false,
        arm: false,
    };
}

function clamp(n: number, a: number, b: number) {
    return Math.max(a, Math.min(b, n));
}

// bar is 1-indexed for display
function barToLeftPx(bar: number) {
    return (bar - 1) * BAR_W;
}

function isEditableTarget(t: EventTarget | null) {
    if (!(t instanceof HTMLElement)) return false;
    const tag = t.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || t.isContentEditable;
}

export default function DAW(_props: TabRendererProps) {
    const [tracks, setTracks] = useState<Track[]>(() => [mkTrack("audio", 1)]);

    // --- Markers (bars are 1..BARS) ---
    const [playheadPosBars, setPlayheadPosBars] = useState(1); // float bars (1.0 = bar 1)
    const [loopL, setLoopL] = useState(1);
    const [loopR, setLoopR] = useState(5);
    const [endBar, setEndBar] = useState(17);

    // --- Transport state ---
    const [isPlaying, setIsPlaying] = useState(false);
    const [loopEnabled, setLoopEnabled] = useState(false);
    const [bpm, setBpm] = useState(120);
    const [sigNum, setSigNum] = useState(4);
    const [sigDen, setSigDen] = useState(4);

    const rafRef = useRef<number | null>(null);
    const playStartMsRef = useRef<number>(0);
    const playStartPosRef = useRef<number>(1);

    // --- Refs for scroll sync + ruler math ---
    const timelineRef = useRef<HTMLDivElement | null>(null);
    const trackScrollRef = useRef<HTMLDivElement | null>(null);
    const rulerInnerRef = useRef<HTMLDivElement | null>(null);
    const syncing = useRef(false);

    const timelineWidth = BARS * BAR_W;

    // --- Add Track menu (portal, so it can't be clipped by overflow containers) ---
    const [addMenuOpen, setAddMenuOpen] = useState(false);
    const [addMenuPos, setAddMenuPos] = useState<{
        top: number;
        left: number;
    } | null>(null);
    const addBtnRef = useRef<HTMLButtonElement | null>(null);
    const addMenuRef = useRef<HTMLDivElement | null>(null);

    const addTrack = (type: TrackType) => {
        setTracks((prev) => {
            const nextIndex = prev.filter((t) => t.type === type).length + 1;
            return [...prev, mkTrack(type, nextIndex)];
        });
    };

    const toggle = (id: string, key: "mute" | "solo" | "arm") => {
        setTracks((prev) =>
            prev.map((t) => (t.id === id ? { ...t, [key]: !t[key] } : t))
        );
    };

    // --- Scroll sync (timeline includes ruler height) ---
    const onTimelineScroll = () => {
        if (syncing.current) return;
        syncing.current = true;

        const tl = timelineRef.current;
        const tr = trackScrollRef.current;
        if (tl && tr) {
            tr.scrollTop = tl.scrollTop;
        }

        requestAnimationFrame(() => {
            syncing.current = false;
        });
    };

    const onTrackScroll = () => {
        if (syncing.current) return;
        syncing.current = true;

        const tl = timelineRef.current;
        const tr = trackScrollRef.current;
        if (tl && tr) {
            tl.scrollTop = tr.scrollTop;
        }

        requestAnimationFrame(() => {
            syncing.current = false;
        });
    };

    const laneGridStyle: React.CSSProperties = useMemo(
        () => ({
            backgroundImage: `
                linear-gradient(to right, rgba(255,255,255,0.09) 1px, transparent 1px),
                linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px)
            `,
            backgroundSize: `${BAR_W}px 100%, ${BAR_W / 4}px 100%`,
        }),
        []
    );

    // --- Convert a clientX to a snapped bar number (1..BARS) ---
    const clientXToBar = (clientX: number) => {
        const tl = timelineRef.current;
        const inner = rulerInnerRef.current;
        if (!tl || !inner) return 1;

        const rect = inner.getBoundingClientRect();
        const xInInner = clientX - rect.left + tl.scrollLeft;

        // snap to whole bars for now
        const bar0 = Math.round(xInInner / BAR_W);
        return clamp(bar0 + 1, 1, BARS);
    };

    const setPlayheadFromEvent = (e: React.PointerEvent) => {
        setPlayheadPosBars(clientXToBar(e.clientX));
    };

    // --- Marker dragging ---
    type DragType = "L" | "R" | "E" | null;
    const dragRef = useRef<DragType>(null);

    const beginDrag = (kind: DragType) => (e: React.PointerEvent) => {
        dragRef.current = kind;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        e.preventDefault();
        e.stopPropagation();
    };

    const onDragMove = (e: React.PointerEvent) => {
        if (!dragRef.current) return;

        const bar = clientXToBar(e.clientX);

        if (dragRef.current === "L") {
            const nextL = clamp(bar, 1, loopR - 1);
            setLoopL(nextL);
            if (loopEnabled && playheadPosBars < nextL)
                setPlayheadPosBars(nextL);
        } else if (dragRef.current === "R") {
            const nextR = clamp(bar, loopL + 1, BARS);
            setLoopR(nextR);
        } else if (dragRef.current === "E") {
            setEndBar(clamp(bar, 1, BARS));
        }
    };

    const endDrag = () => {
        dragRef.current = null;
    };

    const loopLeftPx = barToLeftPx(loopL);
    const loopWidthPx = Math.max(0, barToLeftPx(loopR) - barToLeftPx(loopL));
    const playheadLeftPx = barToLeftPx(playheadPosBars);
    const endLeftPx = barToLeftPx(endBar);

    // --- Add Track menu positioning (open to the right of the button; clamp to viewport) ---
    const computeAddMenuPos = () => {
        const btn = addBtnRef.current;
        if (!btn) return null;

        const r = btn.getBoundingClientRect();
        const margin = 8;

        // Prefer opening to the RIGHT
        let left = r.right + margin;
        if (left + MENU_W > window.innerWidth - margin) {
            left = r.left - MENU_W - margin; // fallback to left
        }
        left = clamp(left, margin, window.innerWidth - MENU_W - margin);

        // Align vertically with the button (clamped to viewport)
        let top = r.top;
        if (top + MENU_H > window.innerHeight - margin) {
            top = window.innerHeight - MENU_H - margin;
        }
        top = clamp(top, margin, window.innerHeight - MENU_H - margin);

        return { top, left };
    };

    const closeAddMenu = () => {
        setAddMenuOpen(false);
        setAddMenuPos(null);
    };

    const toggleAddMenu = () => {
        setAddMenuOpen((v) => {
            const next = !v;
            if (next)
                requestAnimationFrame(() => setAddMenuPos(computeAddMenuPos()));
            else setAddMenuPos(null);
            return next;
        });
    };

    // click outside / esc closes the add menu, and also close on scroll
    useEffect(() => {
        if (!addMenuOpen) return;

        const onDown = (e: PointerEvent) => {
            const t = e.target as Node | null;
            if (!t) return;

            if (addBtnRef.current?.contains(t)) return;
            if (addMenuRef.current?.contains(t)) return;

            closeAddMenu();
        };

        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") closeAddMenu();
        };

        const onReposition = () => {
            setAddMenuPos(computeAddMenuPos());
        };

        const closeOnScroll = () => closeAddMenu();

        window.addEventListener("pointerdown", onDown);
        window.addEventListener("keydown", onKey);
        window.addEventListener("resize", onReposition);
        window.addEventListener("scroll", onReposition, true);

        const tr = trackScrollRef.current;
        const tl = timelineRef.current;
        tr?.addEventListener("scroll", closeOnScroll, { passive: true } as any);
        tl?.addEventListener("scroll", closeOnScroll, { passive: true } as any);

        return () => {
            window.removeEventListener("pointerdown", onDown);
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("resize", onReposition);
            window.removeEventListener("scroll", onReposition, true);

            tr?.removeEventListener("scroll", closeOnScroll as any);
            tl?.removeEventListener("scroll", closeOnScroll as any);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [addMenuOpen]);

    // --- Transport playback loop (visual playhead only, no audio yet) ---
    const stop = () => {
        if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        setIsPlaying(false);
    };

    const start = () => {
        // If loop is enabled, ensure we start inside the loop range.
        const loopLen = Math.max(0.0001, loopR - loopL);
        const startPos = loopEnabled
            ? clamp(playheadPosBars, loopL, loopR - 0.0001)
            : playheadPosBars;

        playStartMsRef.current = performance.now();
        playStartPosRef.current = startPos;
        setPlayheadPosBars(startPos);
        setIsPlaying(true);

        const beatSec = (60 / Math.max(1, bpm)) * (4 / Math.max(1, sigDen));
        const barSec = beatSec * Math.max(1, sigNum);

        const tick = () => {
            const now = performance.now();
            const elapsedSec = (now - playStartMsRef.current) / 1000;
            let pos =
                playStartPosRef.current + elapsedSec / Math.max(0.0001, barSec);

            if (loopEnabled) {
                // treat loopR as exclusive end boundary
                const len = Math.max(0.0001, loopLen);
                if (pos < loopL) pos = loopL;
                if (pos >= loopR) {
                    pos = loopL + ((pos - loopL) % len);
                }
            } else {
                if (pos >= endBar) {
                    pos = endBar;
                    setPlayheadPosBars(pos);
                    stop();
                    return;
                }
            }

            // keep within timeline
            pos = clamp(pos, 1, BARS + 0.999);
            setPlayheadPosBars(pos);
            rafRef.current = requestAnimationFrame(tick);
        };

        rafRef.current = requestAnimationFrame(tick);
    };

    const togglePlay = () => {
        if (isPlaying) stop();
        else start();
    };

    // Spacebar toggles play/stop (unless you're typing)
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (isEditableTarget(e.target)) return;

            if (e.code === "Space") {
                e.preventDefault();
                togglePlay();
            } else if (e.key === "Home") {
                e.preventDefault();
                setPlayheadPosBars(loopEnabled ? loopL : 1);
            } else if (e.key === "End") {
                e.preventDefault();
                setPlayheadPosBars(endBar);
            }
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isPlaying, bpm, sigNum, sigDen, loopEnabled, loopL, endBar]);

    // Ensure we cleanup rAF if tab unmounts
    useEffect(() => {
        return () => {
            if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
        };
    }, []);

    // --- Transport display ---
    const beatsPerBar = Math.max(1, sigNum);
    const denom = Math.max(1, sigDen);
    const qnPerBeat = 4 / denom; // quarter-notes per beat unit
    const beatSec = (60 / Math.max(1, bpm)) * qnPerBeat;
    const barSec = beatSec * beatsPerBar;

    const pos0 = Math.max(0, playheadPosBars - 1); // zero-based bars
    const barIndex = Math.floor(pos0); // 0-based
    const barNumber = barIndex + 1;

    const fracBar = pos0 - barIndex;
    const beatFloat = fracBar * beatsPerBar;
    const beatIndex = Math.floor(beatFloat);
    const beatNumber = beatIndex + 1;

    const fracBeat = beatFloat - beatIndex;
    const tickNumber = Math.floor(fracBeat * TICKS_PER_BEAT);

    const timeSec = pos0 * barSec;
    const mins = Math.floor(timeSec / 60);
    const secs = Math.floor(timeSec % 60);
    const ms = Math.floor((timeSec - Math.floor(timeSec)) * 1000);

    const timeString = `${mins}:${String(secs).padStart(2, "0")}.${String(
        ms
    ).padStart(3, "0")}`;
    const posString = `${barNumber}.${beatNumber}.${String(tickNumber).padStart(
        2,
        "0"
    )}`;

    return (
        <div className="h-full min-h-0 flex flex-col">
            {/* Main split */}
            <div className="flex-1 min-h-0 flex overflow-hidden border-t border-neutral-200/20 dark:border-neutral-800">
                {/* Left: Track list */}
                <div className="w-[280px] shrink-0 border-r border-neutral-200/20 dark:border-neutral-800 bg-neutral-950/30 flex flex-col min-h-0">
                    {/* Track header (aligned with ruler height) */}
                    <div className="h-10 px-3 flex items-center justify-between border-b border-neutral-200/20 dark:border-neutral-800">
                        <div className="text-xs uppercase tracking-wide opacity-70">
                            Tracks
                        </div>
                        <div className="text-[11px] opacity-60">
                            {tracks.length} track
                            {tracks.length === 1 ? "" : "s"}
                        </div>
                    </div>

                    {/* Track rows + Add Track row */}
                    <div
                        ref={trackScrollRef}
                        onScroll={onTrackScroll}
                        className="flex-1 min-h-0 overflow-y-auto"
                        style={{ scrollbarGutter: "stable both-edges" } as any}
                    >
                        {tracks.map((t) => (
                            <div
                                key={t.id}
                                className="flex items-center gap-2 px-3 border-b border-neutral-200/10 dark:border-neutral-800"
                                style={{ height: ROW_H }}
                            >
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-medium">
                                        {t.name}
                                    </div>
                                    <div className="text-[11px] opacity-60">
                                        {t.type === "audio"
                                            ? "Audio"
                                            : "Instrument (MIDI)"}
                                    </div>
                                </div>

                                <div className="flex items-center gap-1">
                                    <YSButton
                                        className={`text-[11px] px-2 py-1 rounded-md ${
                                            t.mute
                                                ? "bg-neutral-100 dark:bg-neutral-900"
                                                : ""
                                        }`}
                                        onClick={() => toggle(t.id, "mute")}
                                        title="Mute"
                                    >
                                        M
                                    </YSButton>
                                    <YSButton
                                        className={`text-[11px] px-2 py-1 rounded-md ${
                                            t.solo
                                                ? "bg-neutral-100 dark:bg-neutral-900"
                                                : ""
                                        }`}
                                        onClick={() => toggle(t.id, "solo")}
                                        title="Solo"
                                    >
                                        S
                                    </YSButton>
                                    <YSButton
                                        className={`text-[11px] px-2 py-1 rounded-md ${
                                            t.arm
                                                ? "bg-neutral-100 dark:bg-neutral-900"
                                                : ""
                                        }`}
                                        onClick={() => toggle(t.id, "arm")}
                                        title="Arm"
                                    >
                                        ●
                                    </YSButton>
                                </div>
                            </div>
                        ))}

                        {/* + Add Track row (below last track) */}
                        <div className="p-3">
                            <YSButton
                                ref={addBtnRef}
                                className="w-full py-2 text-sm rounded-lg justify-center opacity-90"
                                onClick={toggleAddMenu}
                                title="Add Track"
                            >
                                + Add Track
                            </YSButton>
                        </div>

                        <div style={{ height: 12 }} />
                    </div>
                </div>

                {/* Right: Timeline */}
                <div className="flex-1 min-w-0 bg-neutral-950/10">
                    <div
                        ref={timelineRef}
                        onScroll={onTimelineScroll}
                        className="h-full overflow-auto"
                        style={{ scrollbarGutter: "stable both-edges" } as any}
                    >
                        {/* Ruler (sticky) */}
                        <div className="sticky top-0 z-20 h-10 border-b border-neutral-200/20 dark:border-neutral-800 bg-neutral-950/70 backdrop-blur">
                            <div
                                ref={rulerInnerRef}
                                className="relative h-full"
                                style={{ width: timelineWidth }}
                                onPointerDown={(e) => setPlayheadFromEvent(e)}
                                onPointerMove={onDragMove}
                                onPointerUp={endDrag}
                                onPointerCancel={endDrag}
                                onPointerLeave={endDrag}
                            >
                                {/* Bar numbers */}
                                <div className="absolute inset-0 flex">
                                    {Array.from({ length: BARS }, (_, i) => {
                                        const n = i + 1;
                                        return (
                                            <div
                                                key={n}
                                                className="h-full flex items-center justify-start px-2 text-xs opacity-70 border-r border-neutral-200/10 dark:border-neutral-800"
                                                style={{ width: BAR_W }}
                                            >
                                                {n}
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Loop shading */}
                                <div
                                    className="absolute top-0 bottom-0 pointer-events-none"
                                    style={{
                                        left: loopLeftPx,
                                        width: loopWidthPx,
                                        background: loopEnabled
                                            ? "rgba(120,200,255,0.06)"
                                            : "rgba(255,255,255,0.03)",
                                    }}
                                />

                                {/* Playhead line */}
                                <div
                                    className="absolute top-0 bottom-0 pointer-events-none"
                                    style={{
                                        left: playheadLeftPx,
                                        width: 2,
                                        background: "rgba(255,255,255,0.55)",
                                    }}
                                />

                                {/* End line */}
                                <div
                                    className="absolute top-0 bottom-0 pointer-events-none"
                                    style={{
                                        left: endLeftPx,
                                        width: 2,
                                        background: "rgba(255,200,80,0.6)",
                                    }}
                                />

                                {/* L flag */}
                                <div
                                    className="absolute top-[6px] z-30"
                                    style={{ left: loopLeftPx - 10 }}
                                    onPointerDown={beginDrag("L")}
                                    title="Loop start (L)"
                                >
                                    <div className="px-2 py-1 rounded-md text-[11px] font-semibold bg-neutral-900/90 border border-neutral-700 text-white">
                                        L
                                    </div>
                                </div>

                                {/* R flag */}
                                <div
                                    className="absolute top-[6px] z-30"
                                    style={{ left: barToLeftPx(loopR) - 10 }}
                                    onPointerDown={beginDrag("R")}
                                    title="Loop end (R)"
                                >
                                    <div className="px-2 py-1 rounded-md text-[11px] font-semibold bg-neutral-900/90 border border-neutral-700 text-white">
                                        R
                                    </div>
                                </div>

                                {/* E flag */}
                                <div
                                    className="absolute top-[6px] z-30"
                                    style={{ left: endLeftPx - 10 }}
                                    onPointerDown={beginDrag("E")}
                                    title="Song end (E)"
                                >
                                    <div className="px-2 py-1 rounded-md text-[11px] font-semibold bg-neutral-900/90 border border-neutral-700 text-white">
                                        E
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Lanes */}
                        <div
                            className="relative"
                            style={{ width: timelineWidth }}
                            onPointerDown={(e) => setPlayheadFromEvent(e)}
                        >
                            {/* Loop shading across lanes */}
                            <div
                                className="absolute pointer-events-none"
                                style={{
                                    left: loopLeftPx,
                                    width: loopWidthPx,
                                    top: 0,
                                    bottom: 0,
                                    background: loopEnabled
                                        ? "rgba(120,200,255,0.04)"
                                        : "rgba(255,255,255,0.02)",
                                }}
                            />

                            {/* Playhead line across lanes */}
                            <div
                                className="absolute pointer-events-none"
                                style={{
                                    left: playheadLeftPx,
                                    width: 2,
                                    top: 0,
                                    bottom: 0,
                                    background: "rgba(255,255,255,0.45)",
                                }}
                            />

                            {/* End line across lanes */}
                            <div
                                className="absolute pointer-events-none"
                                style={{
                                    left: endLeftPx,
                                    width: 2,
                                    top: 0,
                                    bottom: 0,
                                    background: "rgba(255,200,80,0.45)",
                                }}
                            />

                            {tracks.map((t, idx) => (
                                <div
                                    key={t.id}
                                    className={`border-b border-neutral-200/10 dark:border-neutral-800 ${
                                        idx % 2 === 0
                                            ? "bg-neutral-950/10"
                                            : "bg-neutral-950/5"
                                    }`}
                                    style={{
                                        height: ROW_H,
                                        ...laneGridStyle,
                                    }}
                                />
                            ))}

                            <div style={{ height: 80 }} />
                        </div>
                    </div>
                </div>
            </div>

            {/* Transport bar (fixed at bottom of DAW tab) */}
            <div
                className="shrink-0 border-t border-neutral-200/20 dark:border-neutral-800 bg-neutral-950/60 backdrop-blur flex items-start px-3 gap-3 pt-2"
                style={{ paddingBottom: BOTTOM_DOCK_SAFE_PX }}
            >
                {/* Left controls */}
                <div className="flex items-center gap-2 mt-[2px]">
                    <YSButton
                        className="px-2 py-1 text-sm rounded-md"
                        onClick={() =>
                            setPlayheadPosBars(loopEnabled ? loopL : 1)
                        }
                        title="Return (Home)"
                    >
                        «
                    </YSButton>

                    <YSButton
                        className="px-2 py-1 text-sm rounded-md"
                        onClick={() => {
                            stop();
                            setPlayheadPosBars(loopEnabled ? loopL : 1);
                        }}
                        title="Stop"
                    >
                        ■
                    </YSButton>

                    <YSButton
                        className="px-3 py-1 text-sm rounded-md"
                        onClick={togglePlay}
                        title="Play/Pause (Space)"
                    >
                        {isPlaying ? "❚❚" : "▶"}
                    </YSButton>

                    <YSButton
                        className="px-2 py-1 text-sm rounded-md opacity-70"
                        onClick={() => {
                            // placeholder for future record functionality
                        }}
                        title="Record (stub)"
                    >
                        ●
                    </YSButton>

                    <YSButton
                        className={`px-2 py-1 text-sm rounded-md ${
                            loopEnabled
                                ? "bg-neutral-100 dark:bg-neutral-900"
                                : ""
                        }`}
                        onClick={() => setLoopEnabled((v) => !v)}
                        title="Loop (L-R)"
                    >
                        ⟲
                    </YSButton>
                </div>

                {/* Center display */}
                <div className="flex-1 min-w-0 flex items-center justify-center gap-6 text-[12px] mt-[2px]">
                    <div className="opacity-70">Pos</div>
                    <div className="font-mono">{posString}</div>
                    <div className="opacity-70">Time</div>
                    <div className="font-mono">{timeString}</div>
                </div>

                {/* Right: tempo + time sig */}
                <div className="flex items-center gap-2 mt-[2px]">
                    <div className="text-[11px] opacity-70">BPM</div>
                    <input
                        className="w-[84px] px-2 py-1 rounded-md bg-neutral-950/40 border border-neutral-200/10 dark:border-neutral-800 text-sm"
                        type="number"
                        min={20}
                        max={400}
                        step={1}
                        value={bpm}
                        onChange={(e) =>
                            setBpm(
                                clamp(Number(e.target.value || 120), 20, 400)
                            )
                        }
                        title="Tempo"
                    />

                    <div className="text-[11px] opacity-70">Sig</div>
                    <select
                        className="px-2 py-1 rounded-md bg-neutral-950/40 border border-neutral-200/10 dark:border-neutral-800 text-sm"
                        value={`${sigNum}/${sigDen}`}
                        onChange={(e) => {
                            const [n, d] = e.target.value
                                .split("/")
                                .map(Number);
                            setSigNum(n);
                            setSigDen(d);
                        }}
                        title="Time signature"
                    >
                        <option value="4/4">4/4</option>
                        <option value="3/4">3/4</option>
                        <option value="6/8">6/8</option>
                        <option value="5/4">5/4</option>
                        <option value="7/8">7/8</option>
                    </select>

                    <YSButton
                        className="px-2 py-1 text-sm rounded-md"
                        onClick={() => setPlayheadPosBars(endBar)}
                        title="Jump to End (End)"
                    >
                        »
                    </YSButton>
                </div>
            </div>

            {/* Add-track menu portal (renders outside scroll containers, so no clipping) */}
            {addMenuOpen &&
                addMenuPos &&
                typeof document !== "undefined" &&
                createPortal(
                    <div
                        ref={addMenuRef}
                        className="rounded-lg border border-neutral-200/20 dark:border-neutral-800 bg-neutral-950/95 backdrop-blur shadow-lg overflow-hidden"
                        style={{
                            position: "fixed",
                            top: addMenuPos.top,
                            left: addMenuPos.left,
                            width: MENU_W,
                            zIndex: 9999,
                        }}
                    >
                        <div className="px-3 py-2 text-xs opacity-60 border-b border-neutral-200/10 dark:border-neutral-800">
                            Add track
                        </div>

                        <button
                            type="button"
                            className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-100/10"
                            onClick={() => {
                                addTrack("audio");
                                closeAddMenu();
                            }}
                        >
                            Create Audio Track
                        </button>

                        <button
                            type="button"
                            className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-100/10"
                            onClick={() => {
                                addTrack("instrument");
                                closeAddMenu();
                            }}
                        >
                            Create MIDI Track
                        </button>
                    </div>,
                    document.body
                )}
        </div>
    );
}
