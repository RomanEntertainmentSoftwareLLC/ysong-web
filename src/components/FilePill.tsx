import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "../styles/file-pill.css";

import {
    audioController,
    useAudioControllerState,
    type AudioAsset,
} from "./AudioController";

export type FileKind = "audio" | "file";

export interface FilePillProps {
    id: string;
    name: string;
    sizeMB: number;
    type: FileKind;

    publicUrl?: string; // legacy / dev fallback
    objectKey?: string; // preferred for private bucket

    onDelete?: () => void | Promise<void>;
    onDownload?: () => void;
}

// Note: "loading" is a transient state while the shared AudioController is
// resolving signed URLs + starting playback.
type PlayState = "stopped" | "playing" | "paused" | "loading";

const env = (import.meta as any).env || {};
const API_BASE = env.VITE_AUTH_API_URL || env.VITE_API_BASE_URL || "";

function hashHue(input: string) {
    let h = 0;
    for (let i = 0; i < input.length; i++)
        h = (h * 31 + input.charCodeAt(i)) >>> 0;
    return h % 360;
}

function safeDomId(input: string) {
    return input.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function fmtTime(seconds: number) {
    if (!Number.isFinite(seconds)) return "--:--";

    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const sec = s % 60;

    // h:mm:ss when needed
    if (m >= 60) {
        const h = Math.floor(m / 60);
        const mm = m % 60;
        return `${h}:${String(mm).padStart(2, "0")}:${String(sec).padStart(
            2,
            "0"
        )}`;
    }

    // m:ss
    return `${m}:${String(sec).padStart(2, "0")}`;
}

async function fetchSignedUrl(objectKey: string, mode: "play" | "download") {
    const token = localStorage.getItem("ys_token");
    if (!token) throw new Error("no_token");

    const url = `${API_BASE}/api/uploads/signed-url?objectKey=${encodeURIComponent(
        objectKey
    )}&mode=${mode}`;

    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) throw new Error(`signed_url_${res.status}`);
    const data = await res.json();
    if (!data?.url) throw new Error("signed_url_missing");
    return { url: String(data.url), expiresAt: Number(data.expiresAt || 0) };
}

export function FilePill({
    id,
    name,
    sizeMB,
    type,
    publicUrl,
    objectKey,
    onDelete,
    onDownload,
}: FilePillProps) {
    const isAudio = type === "audio";

    const hue = useMemo(() => hashHue(name), [name]);
    const menuId = useMemo(() => `asset-pill-menu-${safeDomId(id)}`, [id]);

    const [open, setOpen] = useState(false);
    const moreBtnRef = useRef<HTMLButtonElement | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const [menuPos, setMenuPos] = useState<{
        top: number;
        left: number;
    } | null>(null);

    // ---- Hover toast (portal, so it won't get clipped by drawers/scroll areas)
    const pillRef = useRef<HTMLDivElement | null>(null);
    const [tipOpen, setTipOpen] = useState(false);
    const [tipPos, setTipPos] = useState<{
        top: number;
        left: number;
        placement: "above" | "below";
    } | null>(null);

    // ---- Audio playback (wired to shared AudioController)
    const audioState = useAudioControllerState();
    const isCurrent = isAudio && audioState.currentId === id;

    // If the user scrubs while not playing, remember that seek so the next
    // play starts from the chosen position.
    const [standbySeekFrac, setStandbySeekFrac] = useState<number | null>(null);
    const queuedSeekFracRef = useRef<number | null>(null);

    // Keep the shared controller registry up-to-date so play() can resolve
    // this pill by id.
    useEffect(() => {
        if (!isAudio) return;

        const asset: AudioAsset = {
            id,
            name,
            type: "audio",
            sizeMB: Number.isFinite(sizeMB) ? sizeMB : 0,
            publicUrl,
            objectKey,
        };

        audioController.registerAssets([asset]);
    }, [id, isAudio, name, objectKey, publicUrl, sizeMB]);

    const playState: PlayState = !isAudio
        ? "stopped"
        : isCurrent
        ? audioState.status === "playing"
            ? "playing"
            : audioState.status === "paused"
            ? "paused"
            : audioState.status === "loading"
            ? "loading"
            : "stopped"
        : "stopped";

    const durSec = isCurrent ? audioState.duration ?? null : null;
    const curSec = isCurrent ? audioState.currentTime : 0;

    const playheadPct = useMemo(() => {
        if (isCurrent && durSec && durSec > 0) {
            return Math.max(0, Math.min(1, curSec / durSec)) * 100;
        }
        if (standbySeekFrac != null) {
            return Math.max(0, Math.min(1, standbySeekFrac)) * 100;
        }
        return 0;
    }, [curSec, durSec, isCurrent, standbySeekFrac]);

    const canDelete = !!objectKey && !!onDelete;
    const canPlay = isAudio && (!!objectKey || !!publicUrl);

    const displaySize = Number.isFinite(sizeMB) ? sizeMB.toFixed(1) : "0.0";

    const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

    const seekToFraction = (frac: number) => {
        const f = clamp01(frac);
        queuedSeekFracRef.current = f;
        setStandbySeekFrac(f);

        // If this pill is the currently playing asset, seek immediately.
        if (isCurrent) {
            audioController.seekFrac({ id }, f);
        }
    };

    const onPlayStop = async () => {
        if (!canPlay) return;

        // Stop if this pill is the current playing/paused item.
        if (
            isCurrent &&
            (audioState.status === "playing" ||
                audioState.status === "paused" ||
                audioState.status === "loading")
        ) {
            audioController.stop({ id });
            queuedSeekFracRef.current = null;
            setStandbySeekFrac(null);
            return;
        }

        try {
            const asset: AudioAsset = {
                id,
                name,
                type: "audio",
                sizeMB: Number.isFinite(sizeMB) ? sizeMB : 0,
                publicUrl,
                objectKey,
            };
            audioController.registerAssets([asset]);

            audioController.play({ id }); // user gesture → should be allowed

            const pending = queuedSeekFracRef.current;
            if (pending != null) {
                audioController.seekFrac({ id }, pending);
            }
        } catch (e) {
            console.warn("Audio play failed:", e);
        }
    };

    const onPauseResume = async () => {
        if (!canPlay || !isCurrent) return;

        if (audioState.status === "playing") {
            audioController.pause({ id });
            return;
        }

        if (audioState.status === "paused") {
            audioController.resume({ id });
        }
    };

    // ---- Menu close behavior
    useEffect(() => {
        if (!open) return;

        const onDown = (e: MouseEvent) => {
            const t = e.target as Node;
            if (menuRef.current?.contains(t)) return;
            if (moreBtnRef.current?.contains(t)) return;
            setOpen(false);
        };

        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(false);
        };

        document.addEventListener("mousedown", onDown);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDown);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

    // ---- Menu position (portal so it won't clip)
    useLayoutEffect(() => {
        if (!open) return;

        const update = () => {
            const btn = moreBtnRef.current;
            if (!btn) return;

            const r = btn.getBoundingClientRect();
            const gap = 8;

            const menuW = 176;
            const menuH = menuRef.current?.offsetHeight ?? 128;

            const fitsBelow = r.bottom + gap + menuH <= window.innerHeight - 8;
            const top = fitsBelow
                ? r.bottom + gap
                : Math.max(8, r.top - gap - menuH);

            const leftIdeal = r.right - menuW;
            const left = Math.min(
                Math.max(8, leftIdeal),
                window.innerWidth - menuW - 8
            );

            setMenuPos({ top, left });
        };

        update();

        const onResize = () => update();
        const onScroll = () => update();

        window.addEventListener("resize", onResize);
        document.addEventListener("scroll", onScroll, true);

        return () => {
            window.removeEventListener("resize", onResize);
            document.removeEventListener("scroll", onScroll, true);
        };
    }, [open]);

    // ---- Hover toast position tracking (so it works inside overflow/scroll containers)
    useLayoutEffect(() => {
        if (!tipOpen) {
            setTipPos(null);
            return;
        }

        const update = () => {
            const el = pillRef.current;
            if (!el) return;

            const r = el.getBoundingClientRect();
            const left = r.left + r.width / 2;

            const spaceAbove = r.top;
            const spaceBelow = window.innerHeight - r.bottom;
            const placement: "above" | "below" =
                spaceAbove >= 56 || spaceAbove >= spaceBelow
                    ? "above"
                    : "below";

            const top = placement === "above" ? r.top : r.bottom;
            setTipPos({ top, left, placement });
        };

        update();

        window.addEventListener("resize", update);
        document.addEventListener("scroll", update, true);
        return () => {
            window.removeEventListener("resize", update);
            document.removeEventListener("scroll", update, true);
        };
    }, [tipOpen]);

    const handleDownload = async () => {
        try {
            if (onDownload) {
                onDownload();
                setOpen(false);
                return;
            }

            // Prefer signed download URL if we have objectKey
            if (objectKey) {
                const signed = await fetchSignedUrl(objectKey, "download");
                window.open(signed.url, "_blank", "noopener,noreferrer");
                setOpen(false);
                return;
            }

            // Fallback
            if (publicUrl) {
                window.open(publicUrl, "_blank", "noopener,noreferrer");
                setOpen(false);
            }
        } catch (e) {
            console.warn("Download failed:", e);
        } finally {
            setOpen(false);
        }
    };

    const handleDelete = async () => {
        if (!canDelete) return;
        try {
            await onDelete?.();
        } finally {
            setOpen(false);
        }
    };

    const durationKnown = !!durSec && Number.isFinite(durSec);
    const shownDuration = durationKnown ? (durSec as number) : NaN;

    // If stopped but we've scrubbed visually, prefer the scrub position for display.
    const shownCurrent = (() => {
        if (durationKnown && playState === "stopped" && playheadPct > 0) {
            return (playheadPct / 100) * (durSec as number);
        }
        return curSec;
    })();

    return (
        <div
            ref={pillRef}
            className="asset-pill"
            style={{ ["--fp-hue" as any]: hue }}
            onMouseEnter={() => setTipOpen(true)}
            onMouseLeave={() => setTipOpen(false)}
        >
            <div
                className={`asset-pill-body ${
                    isAudio ? "is-audio" : "is-file"
                }`}
                onPointerDown={(e) => {
                    if (!isAudio || !canPlay) return;

                    // Ignore clicks on buttons (play/pause/menu/etc.)
                    const target = e.target as HTMLElement;
                    if (target.closest("button")) return;

                    // Ignore right-click mouse (touch will be fine)
                    const btn = (e as any).button;
                    if (typeof btn === "number" && btn !== 0) return;

                    const r = (
                        e.currentTarget as HTMLDivElement
                    ).getBoundingClientRect();
                    const frac = (e.clientX - r.left) / r.width;
                    seekToFraction(frac);

                    e.preventDefault();
                }}
            >
                {/* Waveform background placeholder */}
                {isAudio && (
                    <div className="fp-wave" aria-hidden="true">
                        {Array.from({ length: 52 }).map((_, i) => {
                            const h = 20 + ((i * 17) % 60);
                            return (
                                <span
                                    key={i}
                                    className="fp-wave-bar"
                                    style={{ height: `${h}%` }}
                                />
                            );
                        })}
                    </div>
                )}

                {/* playhead */}
                {isAudio && (playState !== "stopped" || playheadPct > 0) && (
                    <div
                        className="fp-playhead"
                        style={{ left: `${playheadPct}%` }}
                        aria-hidden="true"
                    />
                )}

                {/* meta */}
                <div className="fp-meta">
                    <div className="fp-top">
                        <div className="fp-icon" aria-hidden="true">
                            {isAudio ? "🎵" : "📎"}
                        </div>

                        {isAudio && (
                            <div
                                className="fp-time"
                                aria-label="Playback time"
                                style={{
                                    fontSize: 10,
                                    lineHeight: 1,
                                    color: "rgba(255,255,255,0.85)",
                                    fontVariantNumeric: "tabular-nums",
                                    userSelect: "none",
                                }}
                                title={
                                    durationKnown
                                        ? `${fmtTime(shownCurrent)} / ${fmtTime(
                                              shownDuration
                                          )}`
                                        : "Duration will appear after metadata loads"
                                }
                            >
                                {fmtTime(shownCurrent)} /{" "}
                                {fmtTime(shownDuration)}
                            </div>
                        )}

                        <button
                            ref={moreBtnRef}
                            type="button"
                            className="fp-more"
                            aria-label="File options"
                            aria-haspopup="menu"
                            aria-expanded={open}
                            aria-controls={menuId}
                            title="Options"
                            onClick={() => setOpen((v) => !v)}
                        >
                            ⋮
                        </button>
                    </div>

                    <div className="fp-title" title={name}>
                        <span className="fp-name">{name}</span>
                        <span className="fp-size">{displaySize} MB</span>
                    </div>
                </div>

                {/* controls */}
                {isAudio && (
                    <div className="fp-controls" aria-label="Audio controls">
                        <button
                            type="button"
                            className="fp-ctl"
                            onClick={onPlayStop}
                            disabled={!canPlay}
                            aria-label={
                                playState === "stopped" ? "Play" : "Stop"
                            }
                            title={
                                !canPlay
                                    ? objectKey
                                        ? "Missing audio URL"
                                        : "Missing objectKey (old upload)"
                                    : playState === "stopped"
                                    ? "Play"
                                    : "Stop"
                            }
                        >
                            <span className="fp-ctl-icon">
                                {playState === "stopped" ? "▶" : "■"}
                            </span>
                        </button>

                        <button
                            type="button"
                            className="fp-ctl"
                            onClick={onPauseResume}
                            disabled={!canPlay || playState === "stopped"}
                            aria-label={
                                playState === "paused" ? "Resume" : "Pause"
                            }
                            title={
                                !canPlay
                                    ? "No audio URL"
                                    : playState === "stopped"
                                    ? "Play first"
                                    : playState === "paused"
                                    ? "Resume"
                                    : "Pause"
                            }
                        >
                            <span className="fp-ctl-icon">
                                {playState === "paused" ? "▶" : "❚❚"}
                            </span>
                        </button>
                    </div>
                )}
            </div>

            {/* portal menu */}
            {open &&
                createPortal(
                    <div
                        ref={menuRef}
                        id={menuId}
                        className="asset-pill-menu"
                        role="menu"
                        aria-label="File options"
                        style={{
                            top: menuPos?.top ?? 0,
                            left: menuPos?.left ?? 0,
                            position: "fixed",
                        }}
                    >
                        <button
                            type="button"
                            role="menuitem"
                            className="asset-pill-menu-item"
                            onClick={handleDownload}
                            disabled={!objectKey && !publicUrl}
                            title={
                                objectKey || publicUrl
                                    ? "Download"
                                    : "No URL available"
                            }
                        >
                            Download
                        </button>

                        <button
                            type="button"
                            role="menuitem"
                            className="asset-pill-menu-item danger"
                            onClick={handleDelete}
                            disabled={!canDelete}
                            title={
                                canDelete
                                    ? "Delete"
                                    : "Missing objectKey (old upload)"
                            }
                        >
                            Delete
                        </button>
                    </div>,
                    document.body
                )}

            {/* Hover toast (portal) */}
            {tipOpen &&
                tipPos &&
                createPortal(
                    <div
                        className={`fp-toast-portal ${tipPos.placement}`}
                        role="tooltip"
                        style={{
                            position: "fixed",
                            top: tipPos.top,
                            left: tipPos.left,
                        }}
                    >
                        {name}
                    </div>,
                    document.body
                )}
        </div>
    );
}
