import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "../styles/file-pill.css";

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

type PlayState = "stopped" | "playing" | "paused";

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

    // ---- Audio playback
    const [playState, setPlayState] = useState<PlayState>("stopped");
    const [playheadPct, setPlayheadPct] = useState(0);
    const [curSec, setCurSec] = useState(0);
    const [durSec, setDurSec] = useState<number | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const queuedSeekFracRef = useRef<number | null>(null);

    // signed-url cache
    const playUrlRef = useRef<{ url: string; expiresAt: number } | null>(null);

    const canDelete = !!objectKey && !!onDelete;
    const canPlay = isAudio && (!!objectKey || !!publicUrl);

    const displaySize = Number.isFinite(sizeMB) ? sizeMB.toFixed(1) : "0.0";

    const ensureAudio = (url: string) => {
        if (audioRef.current && (audioRef.current as any).__ys_src === url) {
            return audioRef.current;
        }

        // cleanup old one if src changed
        if (audioRef.current) {
            try {
                audioRef.current.pause();
            } catch {}
            audioRef.current = null;
        }

        const a = new Audio(url);
        (a as any).__ys_src = url;
        a.preload = "metadata";

        const onEnded = () => {
            queuedSeekFracRef.current = null;
            setPlayState("stopped");
            setPlayheadPct(0);
            setCurSec(0);
        };

        const onTime = () => {
            if (!a.duration || !isFinite(a.duration)) return;
            const pct =
                Math.max(0, Math.min(1, a.currentTime / a.duration)) * 100;
            setPlayheadPct(pct);
            setCurSec(a.currentTime);
            if (!durSec) setDurSec(a.duration);
        };

        const onMeta = () => {
            if (!a.duration || !isFinite(a.duration)) return;
            setDurSec(a.duration);
        };

        a.addEventListener("ended", onEnded);
        a.addEventListener("timeupdate", onTime);
        a.addEventListener("loadedmetadata", onMeta);
        a.addEventListener("durationchange", onMeta);
        (a as any).__ys_onEnded = onEnded;
        (a as any).__ys_onTime = onTime;
        (a as any).__ys_onMeta = onMeta;

        audioRef.current = a;
        return a;
    };

    const getPlayUrl = async (): Promise<string | null> => {
        // Prefer signed URL from objectKey
        if (objectKey) {
            const cached = playUrlRef.current;
            const freshEnough =
                cached &&
                cached.expiresAt &&
                cached.expiresAt > Date.now() + 60_000; // 60s safety

            if (freshEnough) return cached!.url;

            const signed = await fetchSignedUrl(objectKey, "play");
            playUrlRef.current = signed;
            return signed.url;
        }

        // Fallback (dev or legacy)
        return publicUrl || null;
    };

    useEffect(() => {
        // if object changes, reset state
        playUrlRef.current = null;
        queuedSeekFracRef.current = null;
        setPlayState("stopped");
        setPlayheadPct(0);
        setCurSec(0);
        setDurSec(null);

        const a = audioRef.current;
        if (a) {
            try {
                a.pause();
                a.currentTime = 0;
            } catch {}
            const onEnded = (a as any).__ys_onEnded;
            const onTime = (a as any).__ys_onTime;
            const onMeta = (a as any).__ys_onMeta;
            if (onEnded) a.removeEventListener("ended", onEnded);
            if (onTime) a.removeEventListener("timeupdate", onTime);
            if (onMeta) {
                a.removeEventListener("loadedmetadata", onMeta);
                a.removeEventListener("durationchange", onMeta);
            }
        }
        audioRef.current = null;
    }, [publicUrl, objectKey]);

    const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

    const waitForMetadata = (a: HTMLAudioElement) =>
        new Promise<void>((resolve) => {
            if (a.readyState >= 1) return resolve();
            const done = () => resolve();
            a.addEventListener("loadedmetadata", done, { once: true } as any);
            a.addEventListener("durationchange", done, { once: true } as any);
        });

    const seekToFraction = (frac: number) => {
        const f = clamp01(frac);

        // Always remember the target so Play starts here even if we haven't loaded yet.
        queuedSeekFracRef.current = f;

        // Move the visual bar immediately (works while stopped).
        setPlayheadPct(f * 100);

        const a = audioRef.current;
        if (!a) return;

        const apply = () => {
            if (!a.duration || !isFinite(a.duration)) return;
            a.currentTime = f * a.duration;
            setCurSec(a.currentTime);
            setDurSec(a.duration);
        };

        if (a.duration && isFinite(a.duration)) apply();
        else a.addEventListener("loadedmetadata", apply, { once: true } as any);
    };

    const onPlayStop = async () => {
        if (!canPlay) return;

        if (playState === "playing" || playState === "paused") {
            const a = audioRef.current;
            if (a) {
                a.pause();
                a.currentTime = 0;
            }
            queuedSeekFracRef.current = null;
            setPlayState("stopped");
            setPlayheadPct(0);
            setCurSec(0);
            return;
        }

        try {
            const url = await getPlayUrl();
            if (!url) return;

            const a = ensureAudio(url);

            const pending = queuedSeekFracRef.current;
            if (pending != null) {
                await waitForMetadata(a);
                if (a.duration && isFinite(a.duration)) {
                    a.currentTime = pending * a.duration;
                }
            }

            await a.play(); // user gesture → should be allowed
            setPlayState("playing");
        } catch (e) {
            console.warn("Audio play failed:", e);
            setPlayState("stopped");
            setPlayheadPct(0);
            setCurSec(0);
        }
    };

    const onPauseResume = async () => {
        if (!canPlay) return;

        const a = audioRef.current;
        if (!a) return;

        if (playState === "playing") {
            a.pause();
            setPlayState("paused");
            return;
        }

        if (playState === "paused") {
            try {
                await a.play();
                setPlayState("playing");
            } catch (e) {
                console.warn("Audio resume failed:", e);
            }
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
