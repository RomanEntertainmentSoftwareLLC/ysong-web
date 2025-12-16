import { useSyncExternalStore } from "react";

export type AudioAsset = {
    id: string;
    name: string;
    type?: string;
    size?: number;
    publicUrl?: string;
    objectKey?: string;
};

export type AudioTargetRef = {
    id?: string;
    objectKey?: string;
    publicUrl?: string;
    name?: string;
};

export type AudioStatus = "idle" | "loading" | "playing" | "paused" | "error";

export type AudioState = {
    currentId?: string;
    status: AudioStatus;
    error?: string;
    duration?: number;
};

const env = (import.meta as any).env || {};
const GCS_BUCKET =
    env.VITE_GCS_BUCKET_NAME ||
    env.VITE_ASSETS_BUCKET ||
    env.VITE_GCS_BUCKET ||
    "";

function gcsPublicUrlFromObjectKey(objectKey?: string): string | undefined {
    if (!objectKey || !GCS_BUCKET) return;
    const safe = objectKey.split("/").map(encodeURIComponent).join("/");
    return `https://storage.googleapis.com/${GCS_BUCKET}/${safe}`;
}

function shallowEqual(a: any, b: any) {
    if (a === b) return true;
    if (!a || !b) return false;
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    for (const k of ak) if (a[k] !== b[k]) return false;
    return true;
}

class AudioController {
    private assets = new Map<string, AudioAsset>();
    private byObjectKey = new Map<string, string>();
    private byPublicUrl = new Map<string, string>();

    private audio?: HTMLAudioElement;

    private listeners = new Set<() => void>();

    // IMPORTANT: keep this object reference STABLE unless something actually changes.
    private state: AudioState = { status: "idle" };

    // ---- external-store API (safe for useSyncExternalStore) ----
    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    getSnapshot = () => this.state;
    getServerSnapshot = () => this.state;

    private emit() {
        for (const l of this.listeners) l();
    }

    private setState(patch: Partial<AudioState>) {
        const next: AudioState = { ...this.state, ...patch };
        if (shallowEqual(next, this.state)) return;
        this.state = next;
        this.emit();
    }

    // ---- asset registry ----
    registerAssets(list: AudioAsset[]) {
        for (const a of list || []) {
            if (!a?.id) continue;

            // Fill publicUrl from bucket if possible
            const filled: AudioAsset = {
                ...a,
                publicUrl:
                    a.publicUrl || gcsPublicUrlFromObjectKey(a.objectKey),
            };

            this.assets.set(filled.id, filled);
            if (filled.objectKey)
                this.byObjectKey.set(filled.objectKey, filled.id);
            if (filled.publicUrl)
                this.byPublicUrl.set(filled.publicUrl, filled.id);
        }
    }

    private resolve(ref: AudioTargetRef): AudioAsset | undefined {
        if (!ref) return;

        if (ref.id && this.assets.has(ref.id)) return this.assets.get(ref.id);

        if (ref.objectKey) {
            const id = this.byObjectKey.get(ref.objectKey);
            if (id) return this.assets.get(id);
        }

        if (ref.publicUrl) {
            const id = this.byPublicUrl.get(ref.publicUrl);
            if (id) return this.assets.get(id);
        }

        // last resort: try to match by name if unique
        if (ref.name) {
            const hits = Array.from(this.assets.values()).filter(
                (a) => a.name === ref.name
            );
            if (hits.length === 1) return hits[0];
        }

        // allow “ad hoc” playback if caller supplies a URL
        if (ref.publicUrl || ref.objectKey) {
            const url =
                ref.publicUrl || gcsPublicUrlFromObjectKey(ref.objectKey);
            if (url) {
                const id = ref.id || ref.objectKey || url;
                const asset: AudioAsset = {
                    id,
                    name: ref.name || "Audio",
                    publicUrl: url,
                };
                // cache it so future resolves work
                this.registerAssets([asset]);
                return asset;
            }
        }

        return;
    }

    private ensureAudio() {
        if (this.audio) return this.audio;

        const a = new Audio();
        a.preload = "metadata";

        a.addEventListener("loadedmetadata", () => {
            this.setState({
                duration: Number.isFinite(a.duration) ? a.duration : undefined,
            });
        });

        a.addEventListener("playing", () => {
            this.setState({ status: "playing", error: undefined });
        });

        a.addEventListener("pause", () => {
            // pause also fires on stop; status will be overwritten by stop() if needed
            if (this.state.status === "playing")
                this.setState({ status: "paused" });
        });

        a.addEventListener("ended", () => {
            this.setState({ status: "idle" });
        });

        a.addEventListener("waiting", () => {
            if (this.state.status === "playing")
                this.setState({ status: "loading" });
        });

        a.addEventListener("error", () => {
            this.setState({ status: "error", error: "audio_error" });
        });

        this.audio = a;
        return a;
    }

    // ---- controls ----
    async play(ref: AudioTargetRef) {
        const asset = this.resolve(ref);
        if (!asset) throw new Error("asset_not_found");

        const url =
            asset.publicUrl || gcsPublicUrlFromObjectKey(asset.objectKey);
        if (!url) throw new Error("missing_public_url");

        const audio = this.ensureAudio();

        // If switching tracks, update src first
        const switching = audio.src !== url;
        if (switching) {
            this.setState({
                currentId: asset.id,
                status: "loading",
                error: undefined,
            });
            audio.src = url;
        } else {
            this.setState({ currentId: asset.id, error: undefined });
        }

        await audio.play();
        this.setState({ currentId: asset.id, status: "playing" });
    }

    async resume(ref: AudioTargetRef) {
        const audio = this.audio;
        if (!audio) return this.play(ref);

        const asset = this.resolve(ref);
        if (!asset) return this.play(ref);

        const isSame = this.state.currentId === asset.id;
        if (!isSame) return this.play(ref);

        if (audio.paused) {
            await audio.play();
            this.setState({ status: "playing" });
        }
    }

    pause(ref?: AudioTargetRef) {
        if (!this.audio) return;
        if (ref) {
            const asset = this.resolve(ref);
            if (
                asset &&
                this.state.currentId &&
                asset.id !== this.state.currentId
            )
                return;
        }
        this.audio.pause();
        this.setState({ status: "paused" });
    }

    stop(ref?: AudioTargetRef) {
        if (!this.audio) return;
        if (ref) {
            const asset = this.resolve(ref);
            if (
                asset &&
                this.state.currentId &&
                asset.id !== this.state.currentId
            )
                return;
        }
        this.audio.pause();
        this.audio.currentTime = 0;
        this.setState({
            status: "idle",
            currentId: undefined,
            duration: undefined,
        });
    }

    seekSeconds(ref: AudioTargetRef, seconds: number) {
        if (!this.audio) return;
        const asset = this.resolve(ref);
        if (!asset || asset.id !== this.state.currentId) return;

        const dur = Number.isFinite(this.audio.duration)
            ? this.audio.duration
            : 0;
        const t = Math.max(0, Math.min(dur || seconds, seconds));
        this.audio.currentTime = t;
    }

    seekFrac(ref: AudioTargetRef, fraction: number) {
        if (!this.audio) return;
        const asset = this.resolve(ref);
        if (!asset || asset.id !== this.state.currentId) return;

        const dur = Number.isFinite(this.audio.duration)
            ? this.audio.duration
            : 0;
        if (!dur) return;

        const f = Math.max(0, Math.min(1, fraction));
        this.audio.currentTime = dur * f;
    }

    getAsset(ref: AudioTargetRef) {
        return this.resolve(ref);
    }
}

export const audioController = new AudioController();

export function useAudioControllerState() {
    return useSyncExternalStore(
        audioController.subscribe,
        audioController.getSnapshot,
        audioController.getServerSnapshot
    );
}
