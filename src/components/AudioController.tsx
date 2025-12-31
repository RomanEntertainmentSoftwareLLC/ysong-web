// src/components/AudioController.tsx
import { useSyncExternalStore } from "react";

// Central audio manager used by ChatPane + FilePills.
// - Single audio element (prevents multiple tracks playing at once)
// - Registry for assets by id/objectKey/publicUrl
// - Signed URL support (play + download)

export type FileKind = "audio" | "file";

export interface AudioAsset {
    id: string;
    name: string;
    type: FileKind; // for playback should be "audio"
    sizeMB: number;
    objectKey?: string;
    publicUrl?: string; // may be signed
}

export type AudioStatus = "idle" | "loading" | "playing" | "paused" | "error";

export interface AudioState {
    currentId?: string;
    lastPlayedId?: string;
    status: AudioStatus;
    error?: string;
    duration?: number;
    currentTime: number;
    // Whether the *current* track is looping.
    loop: boolean;
}

export type AudioTargetRef = Partial<
    Pick<AudioAsset, "id" | "objectKey" | "publicUrl" | "name">
>;

type SignedUrlPurpose = "play" | "download";

function isLikelySignedUrl(url?: string) {
    if (!url) return false;
    return /[?&]X-Goog-(Algorithm|Signature|Credential)=/i.test(url);
}

function looksLikeGcsUrl(url?: string) {
    if (!url) return false;
    try {
        const u = new URL(url);
        if (u.hostname === "storage.googleapis.com") return true;
        if (u.hostname.endsWith(".storage.googleapis.com")) return true;
    } catch {
        return false;
    }
    return false;
}

function deriveObjectKeyFromPublicUrl(url?: string): string | undefined {
    if (!url) return;
    try {
        const u = new URL(url);

        // https://storage.googleapis.com/<bucket>/<objectKey>
        if (u.hostname === "storage.googleapis.com") {
            const parts = u.pathname.split("/").filter(Boolean);
            if (parts.length >= 2) {
                return decodeURIComponent(parts.slice(1).join("/"));
            }
        }

        // https://<bucket>.storage.googleapis.com/<objectKey>
        if (u.hostname.endsWith(".storage.googleapis.com")) {
            const key = u.pathname.replace(/^\/+/, "");
            return key ? decodeURIComponent(key) : undefined;
        }
    } catch {
        // ignore
    }
    return;
}

async function fetchSignedUrl(
    objectKey: string,
    purpose: SignedUrlPurpose,
): Promise<string> {
    const API = (import.meta as any).env?.VITE_AUTH_API_URL || "";
    const endpoint = API
        ? `${API}/api/uploads/signed-url`
        : `/api/uploads/signed-url`;

    const token = localStorage.getItem("ys_token");
    if (!token) throw new Error("missing_token");

    const url = `${endpoint}?objectKey=${encodeURIComponent(
        objectKey
    )}&mode=${encodeURIComponent(purpose)}`;

    const res = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
    });

    let data: any = null;
    try {
        data = await res.json();
    } catch {
        // ignore
    }

    if (!res.ok) {
        const msg = data?.error
            ? String(data.error)
            : `signed_url_failed_${res.status}`;
        throw new Error(msg);
    }

    const signed =
        typeof data?.url === "string"
            ? data.url
            : typeof data?.signedUrl === "string"
            ? data.signedUrl
            : "";

    if (!signed) throw new Error("signed_url_missing");
    return signed;
}

function gcsPublicUrlFromObjectKey(objectKey?: string) {
    if (!objectKey) return undefined;
    // If your bucket is private, playback will rely on signed URLs.
    return `https://storage.googleapis.com/ysong-assets/${encodeURI(
        objectKey
    )}`;
}

export class AudioController {
    private assets = new Map<string, AudioAsset>();
    private byObjectKey = new Map<string, string>();
    private byPublicUrl = new Map<string, string>();

    // Per-asset loop toggle (remembered even when switching tracks)
    private loopById = new Map<string, boolean>();

    private audio?: HTMLAudioElement;
    private listeners = new Set<() => void>();

    // If a seek is requested before metadata is loaded, queue it and apply
    // once duration is known.
    private pendingSeek?: { id: string; kind: "seconds" | "frac"; value: number };

    private state: AudioState = {
        currentId: undefined,
        lastPlayedId: undefined,
        status: "idle",
        error: undefined,
        duration: undefined,
        currentTime: 0,
        loop: false,
    };

    // ---- Loop controls
    isLoopEnabled(ref?: AudioTargetRef) {
        const id = ref?.id ?? this.state.currentId;
        if (!id) return false;
        return !!this.loopById.get(id);
    }

    setLoop(ref: AudioTargetRef | undefined, enabled: boolean) {
        const id = ref?.id ?? this.state.currentId;
        if (!id) return;

        const next = !!enabled;
        this.loopById.set(id, next);

        // If this is the current track, apply to the element immediately.
        if (this.state.currentId === id) {
            const audio = this.ensureAudio();
            audio.loop = next;
            this.setState({ loop: next });
        }
    }

    toggleLoop(ref?: AudioTargetRef) {
        const id = ref?.id ?? this.state.currentId;
        if (!id) return;
        const next = !this.isLoopEnabled({ id });
        this.setLoop({ id }, next);
    }

    // Toggle element muting. Used to create a more natural "play after reply" feel
    // while still satisfying browser autoplay policies.
    setMuted(muted: boolean) {
        const audio = this.ensureAudio();
        audio.muted = !!muted;
    }

    getSnapshot = () => this.state;

    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    private emit() {
        for (const l of this.listeners) l();
    }

    private setState(patch: Partial<AudioState>) {
        this.state = { ...this.state, ...patch };
        this.emit();
    }

    registerAssets(list: AudioAsset[]) {
        for (const a of list) {
            if (!a?.id) continue;

            const prev = this.assets.get(a.id);
            const merged: AudioAsset = { ...(prev ?? a), ...a };

            this.assets.set(merged.id, merged);

            if (merged.objectKey)
                this.byObjectKey.set(merged.objectKey, merged.id);
            if (merged.publicUrl)
                this.byPublicUrl.set(merged.publicUrl, merged.id);
        }
    }

    private resolve(ref: AudioTargetRef): AudioAsset | undefined {
        const id = ref.id;
        const objectKey = ref.objectKey;
        const publicUrl = ref.publicUrl;

        if (id && this.assets.has(id)) return this.assets.get(id);
        if (objectKey) {
            const mapped = this.byObjectKey.get(objectKey);
            if (mapped && this.assets.has(mapped))
                return this.assets.get(mapped);
        }
        if (publicUrl) {
            const mapped = this.byPublicUrl.get(publicUrl);
            if (mapped && this.assets.has(mapped))
                return this.assets.get(mapped);
        }

        // last ditch: name match
        if (ref.name) {
            const q = ref.name.toLowerCase();
            for (const a of this.assets.values()) {
                if (a.name.toLowerCase() === q) return a;
            }
        }

        // if ref includes id but we don't know it yet, cache it
        if (id) {
            const adHoc: AudioAsset = {
                id,
                name: ref.name ?? id,
                type: "audio",
                sizeMB: 0,
                objectKey,
                publicUrl,
            };
            this.registerAssets([adHoc]);
            return adHoc;
        }

        // If the caller only provided an objectKey, treat it as a stable id.
        // This helps keep Chat playback and FilePill mini-players in sync.
        if (objectKey) {
            const adHoc: AudioAsset = {
                id: objectKey,
                name: ref.name ?? objectKey,
                type: "audio",
                sizeMB: 0,
                objectKey,
                publicUrl,
            };
            this.registerAssets([adHoc]);
            return adHoc;
        }

        return undefined;
    }

    private ensureAudio() {
        if (this.audio) return this.audio;

        const audio = new Audio();
        audio.preload = "metadata";

        audio.addEventListener("loadedmetadata", () => {
            const dur = Number.isFinite(audio.duration)
                ? audio.duration
                : undefined;

            this.setState({ duration: dur });

            const pending = this.pendingSeek;
            if (
                pending &&
                pending.id &&
                pending.id === this.state.currentId &&
                Number.isFinite(audio.duration) &&
                audio.duration > 0
            ) {
                try {
                    if (pending.kind === "seconds") {
                        audio.currentTime = Math.max(0, pending.value);
                    } else {
                        const clamped = Math.max(0, Math.min(1, pending.value));
                        audio.currentTime = audio.duration * clamped;
                    }
                    this.setState({ currentTime: audio.currentTime });
                } finally {
                    this.pendingSeek = undefined;
                }
            }
        });

        audio.addEventListener("timeupdate", () => {
            this.setState({ currentTime: audio.currentTime });
        });

        audio.addEventListener("play", () => {
            this.setState({ status: "playing", error: undefined });
        });

        audio.addEventListener("pause", () => {
            // pause event also fires on stop() after we set currentId -> undefined.
            if (this.state.currentId) this.setState({ status: "paused" });
        });

        audio.addEventListener("ended", () => {
            this.setState({
                status: "idle",
                currentTime: 0,
                currentId: undefined,
                duration: undefined,
                loop: false,
            });
        });

        audio.addEventListener("error", () => {
            this.setState({ status: "error", error: "Audio error" });
        });

        this.audio = audio;
        return audio;
    }

    private async getPlayableUrl(asset: AudioAsset): Promise<string> {
        // If we already have a URL, only trust it if it looks signed or isn't
        // a private GCS URL.
        if (asset.publicUrl) {
            const url = asset.publicUrl;
            const needsSigned = looksLikeGcsUrl(url) && !isLikelySignedUrl(url);
            if (!needsSigned) return url;

            const key =
                asset.objectKey ?? deriveObjectKeyFromPublicUrl(asset.publicUrl);
            if (key) {
                const signed = await fetchSignedUrl(key, "play");
                const merged: AudioAsset = { ...asset, objectKey: key, publicUrl: signed };
                this.registerAssets([merged]);
                return signed;
            }

            // Fall back to whatever we have (may 403, but better than nothing)
            return url;
        }

        const key = asset.objectKey;
        if (key) {
            // Signed URL is safest for private buckets.
            const signed = await fetchSignedUrl(key, "play");
            const merged: AudioAsset = { ...asset, publicUrl: signed };
            this.registerAssets([merged]);
            return signed;
        }

        const fallback = gcsPublicUrlFromObjectKey(asset.objectKey);
        if (fallback) return fallback;

        throw new Error("No playable URL for this asset");
    }

    async play(ref: AudioTargetRef) {
        const asset = this.resolve(ref);
        if (!asset) {
            this.setState({ status: "error", error: "Unknown audio asset" });
            return;
        }

        // Keep registry fresh if caller provided extra fields.
        this.registerAssets([
            {
                ...asset,
                ...ref,
                id: asset.id,
                name: asset.name,
                type: "audio",
                sizeMB: asset.sizeMB ?? 0,
            } as AudioAsset,
        ]);

        const audio = this.ensureAudio();

        try {
            this.setState({
                status: "loading",
                error: undefined,
                currentId: asset.id,
                currentTime: 0,
                duration: undefined,
            });

            // New track: clear any pending seek from a previous asset.
            this.pendingSeek = undefined;

            const url = await this.getPlayableUrl(asset);

            // Apply per-track loop toggle before playback.
            const loop = !!this.loopById.get(asset.id);
            audio.loop = loop;
            this.setState({ loop });

            // If we are switching tracks, reset the element.
            if (audio.src !== url) {
                audio.pause();
                audio.currentTime = 0;
                audio.src = url;
            }

            await audio.play();

            this.setState({
                status: "playing",
                currentId: asset.id,
                lastPlayedId: asset.id,
            });
        } catch (e: any) {
            this.setState({
                status: "error",
                error: e?.message ? String(e.message) : "Failed to play",
            });
        }
    }

    pause(ref?: AudioTargetRef) {
        const audio = this.ensureAudio();
        const id = ref?.id ?? this.state.currentId;
        if (!id || id !== this.state.currentId) return;
        audio.pause();
        this.setState({ status: "paused" });
    }

    async resume(ref?: AudioTargetRef) {
        const audio = this.ensureAudio();
        const id = ref?.id ?? this.state.currentId;
        if (!id || id !== this.state.currentId) return;

        try {
            await audio.play();
            this.setState({ status: "playing" });
        } catch (e: any) {
            this.setState({
                status: "error",
                error: e?.message ? String(e.message) : "Failed to resume",
            });
        }
    }

    stop(ref?: AudioTargetRef) {
        const audio = this.ensureAudio();
        const id = ref?.id ?? this.state.currentId;
        if (!id || id !== this.state.currentId) return;

        audio.pause();
        audio.currentTime = 0;

        this.pendingSeek = undefined;

        this.setState({
            status: "idle",
            currentId: undefined,
            currentTime: 0,
            duration: undefined,
            error: undefined,
            loop: false,
        });
    }

    seekSeconds(ref: AudioTargetRef | undefined, seconds: number) {
        const audio = this.ensureAudio();
        const id = ref?.id ?? this.state.currentId;
        if (!id || id !== this.state.currentId) return;

        const next = Math.max(0, seconds);

        // If metadata isn't ready yet, queue the seek and apply on loadedmetadata.
        if (audio.readyState < 1) {
            this.pendingSeek = { id, kind: "seconds", value: next };
            return;
        }

        audio.currentTime = next;
        this.setState({ currentTime: audio.currentTime });
    }

    seekFrac(ref: AudioTargetRef | undefined, frac: number) {
        const audio = this.ensureAudio();
        const id = ref?.id ?? this.state.currentId;
        if (!id || id !== this.state.currentId) return;

        const clamped = Math.max(0, Math.min(1, frac));

        const dur = audio.duration;
        if (!Number.isFinite(dur) || dur <= 0) {
            // duration unknown: queue for when metadata arrives
            this.pendingSeek = { id, kind: "frac", value: clamped };
            return;
        }

        audio.currentTime = dur * clamped;
        this.setState({ currentTime: audio.currentTime });
    }

    async download(ref: AudioTargetRef) {
        const asset = this.resolve(ref);
        if (!asset) throw new Error("Unknown audio asset");

        // Prefer signed download URL for private buckets.
        let url: string;
        const key = asset.objectKey ?? deriveObjectKeyFromPublicUrl(asset.publicUrl);
        if (key) {
            url = await fetchSignedUrl(key, "download");
        } else {
            url = asset.publicUrl ?? gcsPublicUrlFromObjectKey(asset.objectKey) ?? "";
        }

        if (!url) throw new Error("No download URL");

        const a = document.createElement("a");
        a.href = url;
        a.download = asset.name || "download";
        a.rel = "noreferrer";
        document.body.appendChild(a);
        a.click();
        a.remove();
    }
}

export const audioController = new AudioController();

export function useAudioControllerState() {
    return useSyncExternalStore(
        audioController.subscribe,
        audioController.getSnapshot,
        audioController.getSnapshot
    );
}
