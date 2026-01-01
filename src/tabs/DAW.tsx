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

type ProjectAsset = {
    id: string;
    kind: "audio";
    name: string; // display name (file.name)
    url: string; // object URL for now
    durationSec?: number;
};

type Clip = {
    id: string;
    trackId: string;
    name: string;
    startBar: number;
    lengthBars: number;
    assetId?: string; // <-- set for audio clips created by drop
};

// ✅ Baby Step 5: include all UI options (triplets + 1/128) so TS doesn't explode
type GridValue =
    | "bar"
    | "1/2"
    | "1/4"
    | "1/8"
    | "1/8T"
    | "1/16"
    | "1/16T"
    | "1/32"
    | "1/32T"
    | "1/64"
    | "1/64T"
    | "1/128";

type GridMode = "absolute" | "relative";

const ROW_H = 44;
const BAR_W = 96;
const BARS = 64;

// Add-track menu sizing (used for viewport clamping)
const MENU_W = 240;
const MENU_H = 112;

// Transport
const TICKS_PER_BEAT = 96;

// Bottom-center drawer handle(s) sit on top of the app; reserve space so transport text isn't covered.
const BOTTOM_DOCK_SAFE_PX = 56;

function mkTrack(type: TrackType, index: number, id?: string): Track {
    return {
        id: id ?? crypto.randomUUID(),
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

// --- Snap helpers (Baby Step 5: Absolute snapping only) ---
function parseGridValue(
    v: GridValue
): { kind: "bar" } | { kind: "note"; div: number; triplet: boolean } {
    if (v === "bar") return { kind: "bar" };

    const triplet = v.endsWith("T");
    const base = triplet ? v.slice(0, -1) : v; // e.g. "1/16T" -> "1/16"
    const parts = base.split("/");
    const div = Number(parts[1]);

    if (!Number.isFinite(div) || div <= 0)
        return { kind: "note", div: 4, triplet: false };

    return { kind: "note", div, triplet };
}

/**
 * Converts a GridValue into a step size in "bars" (where 1.0 == one bar).
 * Absolute snap only.
 *
 * 1/N is treated as a note value (relative to a whole note):
 * - 1/16 = sixteenth note = 1/16 whole note
 * Convert to bars using time signature:
 * - bar length in whole notes = sigNum / sigDen
 * - stepBars = stepWholeNotes / barWholeNotes
 */
function gridStepBars(v: GridValue, sigNum: number, sigDen: number) {
    const parsed = parseGridValue(v);
    if (parsed.kind === "bar") return 1;

    const barWholeNotes = Math.max(
        0.0001,
        Math.max(1, sigNum) / Math.max(1, sigDen)
    );

    let stepWhole = 1 / parsed.div;
    if (parsed.triplet) stepWhole *= 2 / 3;

    const stepBars = stepWhole / barWholeNotes;

    // clamp sanity
    return clamp(stepBars, 1 / 512, 1);
}

export default function DAW(_props: TabRendererProps) {
    const [tracks, setTracks] = useState<Track[]>(() => [mkTrack("audio", 1)]);

    // --- Selection + clips (baby step: create & render, no drag/resize yet) ---
    const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
    const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
    const [clips, setClips] = useState<Clip[]>([]);

    // --- DAW toolbar state ---
    const [snapEnabled, setSnapEnabled] = useState(true);
    const [gridValue, setGridValue] = useState<GridValue>("bar");
    const [gridMode, setGridMode] = useState<GridMode>("absolute");

    // Project placeholders
    const [projectName] = useState("Untitled Project");
    const [projectDirty] = useState(false);

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

    const [projectAssets, setProjectAssets] = useState<ProjectAsset[]>([]);

    // WebAudio context (lazy)
    const audioCtxRef = useRef<AudioContext | null>(null);

    // Keep tempo/sig available for async duration decode
    const bpmRef = useRef(bpm);
    const sigNumRef = useRef(sigNum);
    const sigDenRef = useRef(sigDen);

    const rafRef = useRef<number | null>(null);
    const playStartMsRef = useRef<number>(0);
    const playStartPosRef = useRef<number>(1);

    // --- Refs for scroll sync + ruler math ---
    const timelineRef = useRef<HTMLDivElement | null>(null);
    const trackScrollRef = useRef<HTMLDivElement | null>(null);
    const rulerInnerRef = useRef<HTMLDivElement | null>(null);
    const syncing = useRef(false);

    const timelineWidth = BARS * BAR_W;

    const timelineWideStyle = useMemo(
        () =>
            ({
                width: timelineWidth,
                minWidth: "100%",
            } as React.CSSProperties),
        [timelineWidth]
    );

    // --- Add Track menu ---
    const [addMenuOpen, setAddMenuOpen] = useState(false);
    const [addMenuPos, setAddMenuPos] = useState<{
        top: number;
        left: number;
    } | null>(null);
    const addBtnRef = useRef<HTMLButtonElement | null>(null);
    const addMenuRef = useRef<HTMLDivElement | null>(null);

    const addTrack = (type: TrackType) => {
        const id = crypto.randomUUID();
        setTracks((prev) => {
            const nextIndex = prev.filter((t) => t.type === type).length + 1;
            return [...prev, mkTrack(type, nextIndex, id)];
        });
        setSelectedTrackId(id);
        setSelectedClipId(null);
    };

    const toggle = (id: string, key: "mute" | "solo" | "arm") => {
        setTracks((prev) =>
            prev.map((t) => (t.id === id ? { ...t, [key]: !t[key] } : t))
        );
    };

    // --- Scroll sync ---
    const onTimelineScroll = () => {
        if (syncing.current) return;
        syncing.current = true;

        const tl = timelineRef.current;
        const tr = trackScrollRef.current;
        if (tl && tr) tr.scrollTop = tl.scrollTop;

        requestAnimationFrame(() => {
            syncing.current = false;
        });
    };

    const onTrackScroll = () => {
        if (syncing.current) return;
        syncing.current = true;

        const tl = timelineRef.current;
        const tr = trackScrollRef.current;
        if (tl && tr) tl.scrollTop = tr.scrollTop;

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

    // --- Snap math (Baby Step 5: Absolute only) ---
    const stepBars = gridStepBars(gridValue, sigNum, sigDen);

    const snapBarsAbsolute = (posBars: number) => {
        const bar0 = posBars - 1; // 0-based bars
        const snappedBar0 = Math.round(bar0 / stepBars) * stepBars;
        return snappedBar0 + 1;
    };

    const applySnap = (posBars: number) => {
        if (!snapEnabled) return posBars;
        // Relative mode is disabled; treat as absolute for now
        return snapBarsAbsolute(posBars);
    };

    // --- Convert a clientX to a snapped bar position using a specific element's rect ---
    // NOTE: maxBars lets us support "edges" up to BARS+1 for clip resizing.
    const clientXToBarInEl = (
        clientX: number,
        el: HTMLElement | null,
        maxBars = BARS
    ) => {
        if (!el) return 1;

        const rect = el.getBoundingClientRect();
        const x = clientX - rect.left;

        const rawBars = x / BAR_W + 1; // float bars
        const snapped = applySnap(rawBars);

        return clamp(snapped, 1, maxBars);
    };

    // Use ruler element for marker drags (flags can be the event target)
    const clientXToBar = (clientX: number) =>
        clientXToBarInEl(clientX, rulerInnerRef.current, BARS);

    // Playhead placement should use the element you clicked on (ruler or lanes)
    const setPlayheadFromEvent = (e: React.PointerEvent) => {
        setPlayheadPosBars(
            clientXToBarInEl(e.clientX, e.currentTarget as HTMLElement, BARS)
        );
    };

    // --- RAW (no snap) bar conversion (needed for smooth drag when snap is off) ---
    const clientXToRawBarInEl = (
        clientX: number,
        el: HTMLElement | null,
        maxBars = BARS
    ) => {
        if (!el) return 1;
        const rect = el.getBoundingClientRect();
        const x = clientX - rect.left;
        const rawBars = x / BAR_W + 1;
        return clamp(rawBars, 1, maxBars);
    };

    // Allow edges up to BARS+1 for clip moves/resizes (end boundary)
    const clientXToRawBar = (clientX: number, maxBars = BARS + 1) =>
        clientXToRawBarInEl(clientX, rulerInnerRef.current, maxBars);

    // Clip pointer actions (move + resize-right) ---
    // Add right-edge resizing (snap-aware). Hold ALT to bypass snap.
    type ClipPointerMode = "move" | "resizeR";

    type ClipPointerState = {
        clipId: string;
        pointerId: number;
        mode: ClipPointerMode;
        downRawBar: number;
        startClipBar: number;
        clipLenBars: number; // span in bars
        startEndBar: number; // startClipBar + clipLenBars
    };

    const clipPtrRef = useRef<ClipPointerState | null>(null);
    const [draggingClipId, setDraggingClipId] = useState<string | null>(null);

    const beginClipMove = (clipId: string) => (e: React.PointerEvent) => {
        e.stopPropagation();
        e.preventDefault();

        const clip = clips.find((c) => c.id === clipId);
        if (!clip) return;

        setSelectedTrackId(clip.trackId);
        setSelectedClipId(clip.id);

        const downRawBar = clientXToRawBar(e.clientX, BARS + 1);

        clipPtrRef.current = {
            clipId,
            pointerId: e.pointerId,
            mode: "move",
            downRawBar,
            startClipBar: clip.startBar,
            clipLenBars: clip.lengthBars,
            startEndBar: clip.startBar + clip.lengthBars,
        };

        setDraggingClipId(clipId);
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };

    const beginClipResizeR = (clipId: string) => (e: React.PointerEvent) => {
        e.stopPropagation();
        e.preventDefault();

        const clip = clips.find((c) => c.id === clipId);
        if (!clip) return;

        setSelectedTrackId(clip.trackId);
        setSelectedClipId(clip.id);

        const downRawBar = clientXToRawBar(e.clientX, BARS + 1);

        clipPtrRef.current = {
            clipId,
            pointerId: e.pointerId,
            mode: "resizeR",
            downRawBar,
            startClipBar: clip.startBar,
            clipLenBars: clip.lengthBars,
            startEndBar: clip.startBar + clip.lengthBars,
        };

        setDraggingClipId(clipId);
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };

    const onClipPointerMove = (e: React.PointerEvent) => {
        const st = clipPtrRef.current;
        if (!st || st.pointerId !== e.pointerId) return;

        e.preventDefault();

        const rawNow = clientXToRawBar(e.clientX, BARS + 1);
        const deltaBars = rawNow - st.downRawBar;

        // ALT bypasses snap temporarily
        const doSnap = snapEnabled && !e.altKey;

        if (st.mode === "move") {
            let nextStart = st.startClipBar + deltaBars;

            if (doSnap) nextStart = applySnap(nextStart);

            // keep clip inside song bounds (end boundary can reach BARS+1)
            const maxStart = Math.max(1, BARS + 1 - st.clipLenBars);
            nextStart = clamp(nextStart, 1, maxStart);

            setClips((prev) =>
                prev.map((c) =>
                    c.id === st.clipId ? { ...c, startBar: nextStart } : c
                )
            );
            return;
        }

        // resize right edge
        let nextEnd = st.startEndBar + deltaBars; // end boundary in bars (can go to BARS+1)
        if (doSnap) nextEnd = applySnap(nextEnd);

        const minLen = doSnap ? stepBars : 0.25; // small-but-usable minimum when snap is off
        let nextLen = nextEnd - st.startClipBar;

        // clamp so the end boundary never exceeds BARS+1
        const maxLen = BARS + 1 - st.startClipBar;
        nextLen = clamp(nextLen, minLen, Math.max(minLen, maxLen));

        setClips((prev) =>
            prev.map((c) =>
                c.id === st.clipId ? { ...c, lengthBars: nextLen } : c
            )
        );
    };

    const endClipPointer = (e: React.PointerEvent) => {
        const st = clipPtrRef.current;
        if (!st || st.pointerId !== e.pointerId) return;

        clipPtrRef.current = null;
        setDraggingClipId(null);
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

        // keep an ordering gap even when snap is off
        const minGap = snapEnabled ? stepBars : 0.0001;

        if (dragRef.current === "L") {
            const nextL = clamp(bar, 1, loopR - minGap);
            setLoopL(nextL);
            if (loopEnabled && playheadPosBars < nextL)
                setPlayheadPosBars(nextL);
        } else if (dragRef.current === "R") {
            const nextR = clamp(bar, loopL + minGap, BARS);
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

    // --- Add Track menu positioning ---
    const computeAddMenuPos = () => {
        const btn = addBtnRef.current;
        if (!btn) return null;

        const r = btn.getBoundingClientRect();
        const margin = 8;

        let left = r.right + margin;
        if (left + MENU_W > window.innerWidth - margin) {
            left = r.left - MENU_W - margin;
        }
        left = clamp(left, margin, window.innerWidth - MENU_W - margin);

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

    const isAudioFile = (f: File) => {
        const t = (f.type || "").toLowerCase();
        if (t.startsWith("audio/")) return true;

        // fallback by extension (some OSes/types are blank)
        const n = (f.name || "").toLowerCase();
        return /\.(wav|mp3|m4a|aac|ogg|flac|webm)$/i.test(n);
    };

    const ensureAudioCtx = () => {
        if (audioCtxRef.current) return audioCtxRef.current;
        audioCtxRef.current = new AudioContext();
        return audioCtxRef.current;
    };

    const decodeDurationSec = async (file: File) => {
        const ctx = ensureAudioCtx();
        const ab = await file.arrayBuffer();
        // decodeAudioData can mutate the buffer in some browsers; slice() keeps it safe
        const audioBuf = await ctx.decodeAudioData(ab.slice(0));
        return audioBuf.duration;
    };

    const durationSecToBars = (sec: number) => {
        const bpmNow = Math.max(1, bpmRef.current);
        const n = Math.max(1, sigNumRef.current);
        const d = Math.max(1, sigDenRef.current);

        const beatSec = (60 / bpmNow) * (4 / d);
        const barSec = beatSec * n;

        return sec / Math.max(0.0001, barSec);
    };

    // Drop audio onto an AUDIO track lane → create asset + clip (length from decode)
    const onDropAudioOnTrack =
        (trackId: string) => async (e: React.DragEvent<HTMLDivElement>) => {
            const track = tracks.find((t) => t.id === trackId);
            if (!track || track.type !== "audio") return;

            e.preventDefault();
            e.stopPropagation();

            const files = Array.from(e.dataTransfer.files).filter(isAudioFile);
            if (!files.length) return;

            // capture needed event data BEFORE awaits
            const clientX = e.clientX;
            const laneEl = e.currentTarget as HTMLElement;

            setSelectedTrackId(trackId);

            // start position (uses your snap)
            let cursorStart = clientXToBarInEl(clientX, laneEl, BARS);

            // Freeze snap/grid at drop time (don’t change mid-decode)
            const snapOnDrop = snapEnabled;
            const stepOnDrop = stepBars;

            const snapEnd = (endBars: number) => {
                if (!snapOnDrop) return endBars;
                const bar0 = endBars - 1;
                return Math.round(bar0 / stepOnDrop) * stepOnDrop + 1;
            };

            for (const file of files) {
                const assetId = crypto.randomUUID();
                const clipId = crypto.randomUUID();
                const url = URL.createObjectURL(file);

                setProjectAssets((prev) => [
                    ...prev,
                    { id: assetId, kind: "audio", name: file.name, url },
                ]);

                // optimistic initial length (real audio, just unknown duration yet)
                const maxLenInit = BARS + 1 - cursorStart;
                const initLen = clamp(2, 0.25, Math.max(0.25, maxLenInit));

                const clipStart = cursorStart;

                setClips((prev) => [
                    ...prev,
                    {
                        id: clipId,
                        trackId,
                        assetId,
                        name: file.name,
                        startBar: clipStart,
                        lengthBars: initLen,
                    },
                ]);

                setSelectedClipId(clipId);

                // decode duration → bars → snap end boundary (optional) → clamp
                decodeDurationSec(file)
                    .then((sec) => {
                        setProjectAssets((prev) =>
                            prev.map((a) =>
                                a.id === assetId
                                    ? { ...a, durationSec: sec }
                                    : a
                            )
                        );

                        const rawBarsLen = durationSecToBars(sec);
                        const desiredEnd = clipStart + rawBarsLen;
                        const endSnapped = snapEnd(desiredEnd);
                        let nextLen = endSnapped - clipStart;

                        const minLen = snapOnDrop ? stepOnDrop : 0.25;
                        const maxLen = BARS + 1 - clipStart;
                        nextLen = clamp(
                            nextLen,
                            minLen,
                            Math.max(minLen, maxLen)
                        );

                        setClips((prev) =>
                            prev.map((c) =>
                                c.id === clipId
                                    ? { ...c, lengthBars: nextLen }
                                    : c
                            )
                        );
                    })
                    .catch(() => {
                        // unsupported decode or browser limitation: keep initLen
                    });

                // advance cursor so multi-file drops line up sequentially
                cursorStart = clamp(clipStart + initLen, 1, BARS);
            }
        };

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

    useEffect(() => {
        bpmRef.current = bpm;
        sigNumRef.current = sigNum;
        sigDenRef.current = sigDen;
    }, [bpm, sigNum, sigDen]);

    // Keep selection sane if tracks change
    useEffect(() => {
        if (selectedTrackId && tracks.some((t) => t.id === selectedTrackId))
            return;
        setSelectedTrackId(tracks[0]?.id ?? null);
        setSelectedClipId(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tracks]);

    const addClip = (trackId: string, startBar: number) => {
        const track = tracks.find((t) => t.id === trackId);
        const baseName =
            track?.type === "instrument" ? "MIDI Clip" : "Audio Clip";

        const snappedStart = clamp(Math.round(startBar), 1, BARS);
        const desiredLen = 2;
        const safeLen = clamp(desiredLen, 1, BARS - snappedStart + 1);

        const id = crypto.randomUUID();
        setClips((prev) => [
            ...prev,
            {
                id,
                trackId,
                name: baseName,
                startBar: snappedStart,
                lengthBars: safeLen,
            },
        ]);
        setSelectedTrackId(trackId);
        setSelectedClipId(id);
    };

    // --- Transport playback loop (visual playhead only, no audio yet) ---
    const stop = () => {
        if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        setIsPlaying(false);
    };

    const start = () => {
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
                const len = Math.max(0.0001, loopLen);
                if (pos < loopL) pos = loopL;
                if (pos >= loopR) pos = loopL + ((pos - loopL) % len);
            } else {
                if (pos >= endBar) {
                    pos = endBar;
                    setPlayheadPosBars(pos);
                    stop();
                    return;
                }
            }

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

    useEffect(() => {
        return () => {
            if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
        };
    }, []);

    // --- Transport display ---
    const beatsPerBar = Math.max(1, sigNum);
    const denom = Math.max(1, sigDen);
    const qnPerBeat = 4 / denom;
    const beatSec = (60 / Math.max(1, bpm)) * qnPerBeat;
    const barSec = beatSec * beatsPerBar;

    const pos0 = Math.max(0, playheadPosBars - 1);
    const barIndex = Math.floor(pos0);
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
                    {/* Track header */}
                    <div className="flex flex-col border-b border-neutral-200/20 dark:border-neutral-800">
                        <div className="h-9 px-3 flex items-center gap-2 bg-neutral-950/40 border-b border-neutral-200/10 dark:border-neutral-800">
                            <div
                                className={`w-2 h-2 rounded-full ${
                                    projectDirty
                                        ? "bg-amber-400"
                                        : "bg-emerald-400/60"
                                }`}
                                title={
                                    projectDirty
                                        ? "Unsaved (placeholder)"
                                        : "Saved (placeholder)"
                                }
                            />
                            <div className="min-w-0 text-xs opacity-80 truncate">
                                {projectName}
                            </div>
                        </div>

                        <div className="h-10 px-3 flex items-center justify-between">
                            <div className="text-xs uppercase tracking-wide opacity-70">
                                Tracks
                            </div>
                            <div className="text-[11px] opacity-60">
                                {tracks.length} track
                                {tracks.length === 1 ? "" : "s"}
                            </div>
                        </div>
                    </div>

                    <div
                        ref={trackScrollRef}
                        onScroll={onTrackScroll}
                        className="flex-1 min-h-0 overflow-y-auto"
                        style={{ scrollbarGutter: "stable" } as any}
                    >
                        {tracks.map((t) => {
                            const selected = t.id === selectedTrackId;
                            return (
                                <div
                                    key={t.id}
                                    className={`flex items-center gap-2 px-3 border-b border-neutral-200/10 dark:border-neutral-800 ${
                                        selected ? "bg-neutral-100/5" : ""
                                    }`}
                                    style={{ height: ROW_H }}
                                    onPointerDown={() => {
                                        setSelectedTrackId(t.id);
                                        setSelectedClipId(null);
                                    }}
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
                            );
                        })}

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
                {/* ✅ FIX: toolbar is OUTSIDE the horizontal scroller, so it never scrolls */}
                <div className="flex-1 min-w-0 bg-neutral-950/10 flex flex-col min-h-0">
                    {/* Toolbar (locked horizontally) */}
                    <div className="shrink-0 z-30 bg-neutral-950/70 backdrop-blur border-b border-neutral-200/20 dark:border-neutral-800">
                        <div className="h-9 px-2 flex items-center gap-2">
                            <YSButton
                                aria-pressed={snapEnabled}
                                className={`px-3 py-1 text-[11px] rounded-md font-semibold tracking-wide border border-neutral-200/10 dark:border-neutral-800 ${
                                    snapEnabled
                                        ? "!bg-neutral-100 dark:!bg-neutral-100 !text-neutral-950 dark:!text-neutral-950 !opacity-100"
                                        : "!bg-neutral-950/20 dark:!bg-neutral-950/30 !text-neutral-50 dark:!text-neutral-50 !opacity-70"
                                }`}
                                onClick={() => setSnapEnabled((v) => !v)}
                                title="Snap"
                            >
                                SNAP
                            </YSButton>

                            <div className="text-[11px] opacity-70">Grid</div>
                            <select
                                className="px-2 py-1 rounded-md bg-neutral-950/40 border border-neutral-200/10 dark:border-neutral-800 text-[12px]"
                                value={gridValue}
                                onChange={(e) =>
                                    setGridValue(e.target.value as GridValue)
                                }
                                title="Grid resolution"
                            >
                                <option value="bar">Bar</option>
                                <option value="1/2">1/2</option>
                                <option value="1/4">1/4</option>
                                <option value="1/8">1/8</option>
                                <option value="1/8T">1/8T</option>
                                <option value="1/16">1/16</option>
                                <option value="1/16T">1/16T</option>
                                <option value="1/32">1/32</option>
                                <option value="1/32T">1/32T</option>
                                <option value="1/64">1/64</option>
                                <option value="1/64T">1/64T</option>
                                <option value="1/128">1/128</option>
                            </select>

                            <div className="flex items-center gap-1 ml-2">
                                <div className="text-[11px] opacity-70">
                                    Mode
                                </div>
                                <YSButton
                                    className={`px-2 py-1 text-[11px] rounded-md ${
                                        gridMode === "absolute"
                                            ? "bg-neutral-100 dark:bg-neutral-900"
                                            : "opacity-70"
                                    }`}
                                    onClick={() => setGridMode("absolute")}
                                    title="Absolute (enabled)"
                                >
                                    Absolute
                                </YSButton>
                                <YSButton
                                    className="px-2 py-1 text-[11px] rounded-md opacity-40 cursor-not-allowed"
                                    onClick={() => {
                                        /* disabled */
                                    }}
                                    title="Relative (coming later)"
                                >
                                    Relative
                                </YSButton>
                            </div>
                        </div>
                    </div>

                    {/* Scrollable timeline area (x + y) */}
                    <div
                        ref={timelineRef}
                        onScroll={onTimelineScroll}
                        className="flex-1 min-h-0 overflow-auto"
                        style={{ scrollbarGutter: "stable" } as any}
                    >
                        {/* Ruler row (sticky vertically, scrolls horizontally with content) */}
                        <div
                            className="sticky top-0 z-20 bg-neutral-950/70 backdrop-blur border-b border-neutral-200/20 dark:border-neutral-800"
                            style={timelineWideStyle}
                        >
                            <div className="h-10">
                                <div
                                    ref={rulerInnerRef}
                                    className="relative h-full"
                                    style={
                                        {
                                            ...timelineWideStyle,
                                            touchAction: "none",
                                        } as any
                                    }
                                    onPointerDown={(e) =>
                                        setPlayheadFromEvent(e)
                                    }
                                    onPointerMove={onDragMove}
                                    onPointerUp={endDrag}
                                    onPointerCancel={endDrag}
                                >
                                    <div className="absolute inset-0 flex">
                                        {Array.from(
                                            { length: BARS },
                                            (_, i) => {
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
                                            }
                                        )}
                                    </div>

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

                                    <div
                                        className="absolute top-0 bottom-0 pointer-events-none"
                                        style={{
                                            left: playheadLeftPx,
                                            width: 2,
                                            background:
                                                "rgba(255,255,255,0.55)",
                                        }}
                                    />

                                    <div
                                        className="absolute top-0 bottom-0 pointer-events-none"
                                        style={{
                                            left: endLeftPx,
                                            width: 2,
                                            background: "rgba(255,200,80,0.6)",
                                        }}
                                    />

                                    <div
                                        className="absolute top-[6px] z-30"
                                        style={{
                                            left: loopLeftPx - 10,
                                            touchAction: "none",
                                            cursor: "ew-resize",
                                        }}
                                        onPointerDown={beginDrag("L")}
                                        onPointerMove={onDragMove}
                                        onPointerUp={endDrag}
                                        onPointerCancel={endDrag}
                                        title="Loop start (L)"
                                    >
                                        <div className="px-2 py-1 rounded-md text-[11px] font-semibold bg-neutral-900/90 border border-neutral-700 text-white">
                                            L
                                        </div>
                                    </div>

                                    <div
                                        className="absolute top-[6px] z-30"
                                        style={{
                                            left: barToLeftPx(loopR) - 10,
                                            touchAction: "none",
                                            cursor: "ew-resize",
                                        }}
                                        onPointerDown={beginDrag("R")}
                                        onPointerMove={onDragMove}
                                        onPointerUp={endDrag}
                                        onPointerCancel={endDrag}
                                        title="Loop end (R)"
                                    >
                                        <div className="px-2 py-1 rounded-md text-[11px] font-semibold bg-neutral-900/90 border border-neutral-700 text-white">
                                            R
                                        </div>
                                    </div>

                                    <div
                                        className="absolute top-[6px] z-30"
                                        style={{
                                            left: endLeftPx - 10,
                                            touchAction: "none",
                                            cursor: "ew-resize",
                                        }}
                                        onPointerDown={beginDrag("E")}
                                        onPointerMove={onDragMove}
                                        onPointerUp={endDrag}
                                        onPointerCancel={endDrag}
                                        title="Song end (E)"
                                    >
                                        <div className="px-2 py-1 rounded-md text-[11px] font-semibold bg-neutral-900/90 border border-neutral-700 text-white">
                                            E
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Lanes */}
                        <div
                            className="relative"
                            style={timelineWideStyle}
                            onPointerDown={(e) => setPlayheadFromEvent(e)}
                        >
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
                                    zIndex: 10,
                                }}
                            />

                            <div
                                className="absolute pointer-events-none"
                                style={{
                                    left: playheadLeftPx,
                                    width: 2,
                                    top: 0,
                                    bottom: 0,
                                    background: "rgba(255,255,255,0.45)",
                                    zIndex: 50,
                                }}
                            />

                            <div
                                className="absolute pointer-events-none"
                                style={{
                                    left: endLeftPx,
                                    width: 2,
                                    top: 0,
                                    bottom: 0,
                                    background: "rgba(255,200,80,0.45)",
                                    zIndex: 50,
                                }}
                            />

                            {tracks.map((t, idx) => {
                                const laneSelected = t.id === selectedTrackId;
                                const laneBg =
                                    idx % 2 === 0
                                        ? "bg-neutral-950/10"
                                        : "bg-neutral-950/5";
                                const trackClips = clips.filter(
                                    (c) => c.trackId === t.id
                                );

                                return (
                                    <div
                                        key={t.id}
                                        onDragOver={(e) => {
                                            e.preventDefault();
                                            e.dataTransfer.dropEffect =
                                                t.type === "audio"
                                                    ? "copy"
                                                    : "none";
                                        }}
                                        onDrop={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            if (t.type !== "audio") return;
                                            onDropAudioOnTrack(t.id)(e);
                                        }}
                                        className={`relative border-b border-neutral-200/10 dark:border-neutral-800 ${laneBg} ${
                                            laneSelected
                                                ? "outline outline-neutral-200/15"
                                                : ""
                                        }`}
                                        style={{
                                            height: ROW_H,
                                            ...laneGridStyle,
                                        }}
                                        onPointerDown={() => {
                                            setSelectedTrackId(t.id);
                                            setSelectedClipId(null);
                                        }}
                                        onDoubleClick={(e) => {
                                            if (t.type !== "instrument") return;
                                            e.stopPropagation();
                                            e.preventDefault();
                                            addClip(
                                                t.id,
                                                clientXToBarInEl(
                                                    e.clientX,
                                                    e.currentTarget as HTMLElement
                                                )
                                            );
                                        }}
                                        title={
                                            t.type === "instrument"
                                                ? "Double-click to add a MIDI clip"
                                                : "Audio clips come from recording or dragging audio in"
                                        }
                                    >
                                        {trackClips.map((c) => {
                                            const isSelected =
                                                c.id === selectedClipId;
                                            const left = barToLeftPx(
                                                c.startBar
                                            );
                                            const width = Math.max(
                                                24,
                                                c.lengthBars * BAR_W - 10
                                            );
                                            return (
                                                <div
                                                    key={c.id}
                                                    className={`absolute top-[6px] h-[32px] rounded-md border bg-neutral-950/60 backdrop-blur px-2 flex items-center min-w-[24px] ${
                                                        isSelected
                                                            ? "border-sky-300/40 ring-2 ring-sky-300/20"
                                                            : "border-neutral-200/15 dark:border-neutral-800/60"
                                                    } ${
                                                        draggingClipId === c.id
                                                            ? "cursor-grabbing"
                                                            : "cursor-grab"
                                                    }`}
                                                    style={{
                                                        left: left + 5,
                                                        width,
                                                    }}
                                                    onPointerDown={beginClipMove(
                                                        c.id
                                                    )}
                                                    onPointerMove={
                                                        onClipPointerMove
                                                    }
                                                    onPointerUp={endClipPointer}
                                                    onPointerCancel={
                                                        endClipPointer
                                                    }
                                                    title={c.name}
                                                >
                                                    <div className="text-[11px] opacity-90 truncate">
                                                        {c.name}
                                                    </div>
                                                    {/* Right-edge resize handle */}
                                                    <div
                                                        className="absolute top-0 right-0 h-full w-[10px] cursor-ew-resize"
                                                        onPointerDown={beginClipResizeR(
                                                            c.id
                                                        )}
                                                        title="Resize (hold ALT to bypass snap)"
                                                        style={{
                                                            // subtle visual grip
                                                            background:
                                                                "linear-gradient(to left, rgba(255,255,255,0.08), rgba(255,255,255,0))",
                                                        }}
                                                    />
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })}

                            <div style={{ height: 80 }} />
                        </div>
                    </div>
                </div>
            </div>

            {/* Transport */}
            <div
                className="shrink-0 border-t border-neutral-200/20 dark:border-neutral-800 bg-neutral-950/60 backdrop-blur flex items-start px-3 gap-3 pt-2"
                style={{ paddingBottom: BOTTOM_DOCK_SAFE_PX }}
            >
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
                                ? "!bg-neutral-100 dark:bg-neutral-100 !text-neutral-950 dark:text-neutral-950 opacity-100"
                                : "!bg-neutral-950 dark:bg-neutral-950 !text-neutral-50 dark:text-neutral-50 opacity-70"
                        }`}
                        onClick={() => setLoopEnabled((v) => !v)}
                        title="Loop (L-R)"
                    >
                        ⟲
                    </YSButton>
                </div>

                <div className="flex-1 min-w-0 flex items-center justify-center gap-6 text-[12px] mt-[2px]">
                    <div className="opacity-70">Pos</div>
                    <div className="font-mono">{posString}</div>
                    <div className="opacity-70">Time</div>
                    <div className="font-mono">{timeString}</div>
                </div>

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

            {/* Add-track menu portal */}
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
