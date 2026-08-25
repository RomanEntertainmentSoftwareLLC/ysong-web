/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
	addTrackToWorldPlaylist,
	countWorldPlay,
	createWorldPlaylist,
	fetchWorldLibrary,
	reactToWorldTrack,
	toggleWorldArtistFollow,
	toggleWorldReleaseSave,
	toggleWorldTrackSave,
	uploadWorldAsset,
	worldArtworkUrl,
	worldAudioUrl,
	type WorldPlaylist,
	type WorldTrack,
} from "../lib/worldApi";

type RepeatMode = "off" | "all" | "one";

type WorldPlayerContextValue = {
	current: WorldTrack | null;
	playing: boolean;
	audioRef: RefObject<HTMLAudioElement | null>;
	queue: WorldTrack[];
	queueLabel: string;
	playTrack: (track: WorldTrack) => void;
	startQueue: (tracks: WorldTrack[], label: string, startTrackId?: string) => void;
	next: () => void;
	previous: () => void;
	canNext: boolean;
	canPrevious: boolean;
	repeatMode: RepeatMode;
	cycleRepeat: () => void;
	pause: () => void;
	toggle: () => void;
	patchCurrent: (patch: Partial<WorldTrack>) => void;
};

const WorldPlayerContext = createContext<WorldPlayerContextValue | null>(null);

function storedRepeatMode(): RepeatMode {
	try {
		const value = localStorage.getItem("ysong:world-repeat");
		return value === "all" || value === "one" ? value : "off";
	} catch { return "off"; }
}

export function WorldPlayerProvider({ children }: { children: ReactNode }) {
	const [current, setCurrent] = useState<WorldTrack | null>(null);
	const [playing, setPlaying] = useState(false);
	const [queue, setQueue] = useState<WorldTrack[]>([]);
	const [queueIndex, setQueueIndex] = useState(-1);
	const [queueLabel, setQueueLabel] = useState("");
	const [repeatMode, setRepeatMode] = useState<RepeatMode>(() => storedRepeatMode());
	const audioRef = useRef<HTMLAudioElement | null>(null);

	const currentId = current?.id || "";
	useEffect(() => {
		if (!currentId || !audioRef.current) return;
		const audio = audioRef.current;
		audio.src = worldAudioUrl(currentId);
		audio.play().catch(() => setPlaying(false));
	}, [currentId]);

	useEffect(() => {
		try { localStorage.setItem("ysong:world-repeat", repeatMode); } catch { /* best-effort local UI action */ }
	}, [repeatMode]);

	const claimWorldPlayback = useCallback(() => {
		window.dispatchEvent(new Event("ysong:world-play-request"));
	}, []);

	useEffect(() => {
		const onDawPlay = () => { audioRef.current?.pause(); };
		window.addEventListener("ysong:daw-play-request", onDawPlay);
		return () => window.removeEventListener("ysong:daw-play-request", onDawPlay);
	}, []);

	const countAndSelect = useCallback((track: WorldTrack) => {
		setCurrent(track);
		countWorldPlay(track.id)
			.then((r) => {
				setCurrent((cur) => cur?.id === track.id ? { ...cur, playCount: r.playCount } : cur);
				window.dispatchEvent(new CustomEvent("ysong:world-play-count", { detail: { trackId: track.id, playCount: r.playCount } }));
			})
			.catch(() => {});
	}, []);

	const playTrack = useCallback((track: WorldTrack) => {
		const audio = audioRef.current;
		if (current?.id === track.id && audio) {
			if (audio.paused) { claimWorldPlayback(); audio.play().catch(() => {}); }
			else audio.pause();
			return;
		}
		claimWorldPlayback();
		setQueue([track]);
		setQueueIndex(0);
		setQueueLabel("");
		countAndSelect(track);
	}, [current?.id, countAndSelect, claimWorldPlayback]);

	const startQueue = useCallback((tracks: WorldTrack[], label: string, startTrackId?: string) => {
		const seen = new Set<string>();
		const clean = tracks.filter((t) => t?.id && !seen.has(t.id) && seen.add(t.id));
		if (!clean.length) return;
		claimWorldPlayback();
		let index = startTrackId ? clean.findIndex((t) => t.id === startTrackId) : 0;
		if (index < 0) index = 0;
		setQueue(clean);
		setQueueIndex(index);
		setQueueLabel(label);
		if (current?.id === clean[index].id && audioRef.current) {
			audioRef.current.currentTime = 0;
			audioRef.current.play().catch(() => {});
		} else countAndSelect(clean[index]);
	}, [countAndSelect, current?.id, claimWorldPlayback]);

	const canPrevious = queue.length > 1 && (queueIndex > 0 || repeatMode === "all");
	const canNext = queue.length > 1 && (queueIndex < queue.length - 1 || repeatMode === "all");

	const next = useCallback(() => {
		if (!queue.length) return;
		let index = queueIndex;
		if (index < queue.length - 1) index += 1;
		else if (repeatMode === "all" && queue.length > 1) index = 0;
		else return;
		claimWorldPlayback();
		setQueueIndex(index);
		countAndSelect(queue[index]);
	}, [queue, queueIndex, repeatMode, countAndSelect, claimWorldPlayback]);

	const previous = useCallback(() => {
		const audio = audioRef.current;
		if (audio && audio.currentTime > 3) {
			audio.currentTime = 0;
			return;
		}
		if (!queue.length) return;
		let index = queueIndex;
		if (index > 0) index -= 1;
		else if (repeatMode === "all" && queue.length > 1) index = queue.length - 1;
		else { if (audio) audio.currentTime = 0; return; }
		claimWorldPlayback();
		setQueueIndex(index);
		countAndSelect(queue[index]);
	}, [queue, queueIndex, repeatMode, countAndSelect, claimWorldPlayback]);

	const cycleRepeat = useCallback(() => setRepeatMode((mode) => mode === "off" ? "all" : mode === "all" ? "one" : "off"), []);
	const patchCurrent = useCallback((patch: Partial<WorldTrack>) => setCurrent((cur) => cur ? { ...cur, ...patch } : cur), []);
	const pause = useCallback(() => audioRef.current?.pause(), []);
	const toggle = useCallback(() => {
		const audio = audioRef.current;
		if (!audio || !current) return;
		if (audio.paused) { claimWorldPlayback(); audio.play().catch(() => {}); }
		else audio.pause();
	}, [current, claimWorldPlayback]);

	const handleEnded = useCallback(() => {
		const audio = audioRef.current;
		if (repeatMode === "one" && audio) {
			audio.currentTime = 0;
			audio.play().catch(() => setPlaying(false));
			return;
		}
		if (queueIndex >= 0 && queueIndex < queue.length - 1) { next(); return; }
		if (repeatMode === "all" && queue.length > 0) { setQueueIndex(0); countAndSelect(queue[0]); return; }
		setPlaying(false);
	}, [repeatMode, queueIndex, queue, next, countAndSelect]);

	const value = useMemo<WorldPlayerContextValue>(() => ({ current, playing, audioRef, queue, queueLabel, playTrack, startQueue, next, previous, canNext, canPrevious, repeatMode, cycleRepeat, pause, toggle, patchCurrent }), [current, playing, queue, queueLabel, playTrack, startQueue, next, previous, canNext, canPrevious, repeatMode, cycleRepeat, pause, toggle, patchCurrent]);

	return (
		<WorldPlayerContext.Provider value={value}>
			{children}
			<audio ref={audioRef} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={handleEnded} />
		</WorldPlayerContext.Provider>
	);
}

export function useWorldPlayer() {
	const value = useContext(WorldPlayerContext);
	if (!value) throw new Error("useWorldPlayer must be used inside WorldPlayerProvider");
	return value;
}

function durationLabel(seconds?: number | null) {
	if (!seconds || !Number.isFinite(seconds)) return "0:00";
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60).toString().padStart(2, "0");
	return `${m}:${s}`;
}

function storedVolume() {
	try {
		const raw = localStorage.getItem("ysong:world-volume");
		// Number(null) === 0, which made a brand-new World player silently start muted.
		if (raw == null || raw.trim() === "") return 0.8;
		const value = Number(raw);
		return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.8;
	} catch { return 0.8; }
}

export function WorldPlayerDock({ hidden, workspaceLeftPx }: { hidden?: boolean; workspaceLeftPx: number }) {
	const { current, playing, toggle, audioRef, queueLabel, next, previous, canNext, canPrevious, repeatMode, cycleRepeat, patchCurrent } = useWorldPlayer();
	const audio = audioRef.current;
	const [time, setTime] = useState(0);
	const [duration, setDuration] = useState(0);
	const [volume, setVolume] = useState(() => storedVolume());
	const [muted, setMuted] = useState(false);
	const [saveMenu, setSaveMenu] = useState(false);
	const [playlistDialog, setPlaylistDialog] = useState<"new" | "existing" | null>(null);
	const [playlists, setPlaylists] = useState<WorldPlaylist[]>([]);
	const [menuLoading, setMenuLoading] = useState(false);

	const dockCurrentId = current?.id || "";
	useEffect(() => {
		if (!audio || !dockCurrentId) return;
		const tick = () => {
			setTime(audio.currentTime || 0);
			setDuration(audio.duration || 0);
		};
		tick();
		audio.addEventListener("timeupdate", tick);
		audio.addEventListener("durationchange", tick);
		return () => {
			audio.removeEventListener("timeupdate", tick);
			audio.removeEventListener("durationchange", tick);
		};
	}, [audio, dockCurrentId]);

	useEffect(() => {
		if (!audio) return;
		audio.volume = volume;
		audio.muted = muted;
		try { localStorage.setItem("ysong:world-volume", String(volume)); } catch { /* best-effort local UI action */ }
	}, [audio, volume, muted]);

	useEffect(() => {
		setSaveMenu(false);
		setPlaylistDialog(null);
	}, [current?.id]);

	if (!current || hidden) return null;

	const patchTrack = (patch: Partial<WorldTrack>) => {
		patchCurrent(patch);
		window.dispatchEvent(new CustomEvent("ysong:world-track-patch", { detail: { trackId: current.id, patch } }));
	};
	const react = async (reaction: -1 | 1) => {
		try { const r = await reactToWorldTrack(current.id, reaction); patchTrack({ myReaction: r.reaction, likes: r.likes, dislikes: r.dislikes }); } catch { /* best-effort local UI action */ }
	};
	const saveCurrent = async () => {
		try { const r = await toggleWorldTrackSave(current.id); patchTrack({ isSaved: r.saved }); } catch { /* best-effort local UI action */ }
	};
	const saveRelease = async () => {
		try { const r = await toggleWorldReleaseSave(current.releaseId); patchCurrent({ isReleaseSaved: r.saved }); window.dispatchEvent(new CustomEvent("ysong:world-release-patch", { detail: { releaseId: current.releaseId, saved: r.saved } })); window.dispatchEvent(new Event("ysong:library-changed")); } catch { /* best-effort local UI action */ }
	};
	const favoriteArtist = async () => {
		try {
			const r = await toggleWorldArtistFollow(current.ownerUserId, current.artistName);
			patchCurrent({ isArtistFollowed: r.followed });
			window.dispatchEvent(new CustomEvent("ysong:world-artist-patch", { detail: { ownerUserId: current.ownerUserId, artistName: current.artistName, followed: r.followed } }));
		} catch { /* best-effort local UI action */ }
	};
	const refreshOwnedPlaylists = async () => {
		setMenuLoading(true);
		try {
			const library = await fetchWorldLibrary();
			const owned = (library.playlists || []).filter((playlist) => playlist.isOwner !== false);
			setPlaylists(owned);
			return owned;
		} catch {
			return playlists;
		} finally {
			setMenuLoading(false);
		}
	};
	const openSaveMenu = async () => {
		const nextOpen = !saveMenu;
		setSaveMenu(nextOpen);
		if (nextOpen && playlists.length === 0) void refreshOwnedPlaylists();
	};
	const openNewPlaylist = () => {
		setSaveMenu(false);
		setPlaylistDialog("new");
	};
	const openExistingPlaylist = () => {
		setSaveMenu(false);
		setPlaylistDialog("existing");
		void refreshOwnedPlaylists();
	};
	const addToPlaylist = async (playlistId: string) => {
		try {
			await addTrackToWorldPlaylist(playlistId, current.id);
			setSaveMenu(false);
			setPlaylistDialog(null);
		} catch { /* best-effort local UI action */ }
	};
	const onPlaylistCreated = (playlist: WorldPlaylist) => {
		setPlaylists((prev) => [playlist, ...prev.filter((item) => item.id !== playlist.id)]);
		setPlaylistDialog(null);
		window.dispatchEvent(new Event("ysong:library-changed"));
	};

	const repeatTitle = repeatMode === "off" ? "Repeat off" : repeatMode === "all" ? "Repeat queue" : "Repeat one";
	const volumeIcon = muted || volume === 0 ? "mute" : volume < 0.5 ? "low" : "high";

	return (
		<div className="fixed right-0 bottom-0 z-[65] border-t border-neutral-800 bg-neutral-950/96 backdrop-blur-xl text-neutral-100 shadow-[0_-16px_45px_rgba(0,0,0,.28)]" style={{ left: workspaceLeftPx }}>
			{/* Desktop player */}
			<div className="hidden md:grid min-h-[78px] grid-cols-[minmax(190px,280px)_minmax(320px,1fr)_auto] gap-5 items-center px-4 py-2">
				<NowPlaying current={current} queueLabel={queueLabel} />
				<div className="min-w-0">
					<div className="flex items-center justify-center gap-2 mb-1">
						<IconButton onClick={previous} disabled={!canPrevious && time <= 3} title="Previous"><PreviousIcon /></IconButton>
						<button onClick={toggle} className="h-9 w-9 rounded-full bg-white text-black grid place-items-center hover:scale-105 transition-transform" title={playing ? "Pause" : "Play"} aria-label={playing ? "Pause" : "Play"}>{playing ? <PauseIcon /> : <PlayIcon />}</button>
						<IconButton onClick={next} disabled={!canNext} title="Next"><NextIcon /></IconButton>
						<IconButton onClick={cycleRepeat} title={repeatTitle} active={repeatMode !== "off"}><RepeatIcon one={repeatMode === "one"} /></IconButton>
					</div>
					<SeekBar audio={audio} time={time} duration={duration} />
				</div>
				<div className="relative flex items-center justify-end gap-0.5">
					<IconButton onClick={() => react(1)} title={current.myReaction === 1 ? "Remove like" : "Like"} active={current.myReaction === 1}><ThumbUpIcon /></IconButton>
					<IconButton onClick={() => react(-1)} title={current.myReaction === -1 ? "Remove dislike" : "Dislike"} active={current.myReaction === -1}><ThumbDownIcon /></IconButton>
					<IconButton onClick={saveCurrent} title={current.isSaved ? "Remove from saved songs" : "Save song"} active={current.isSaved}><HeartIcon filled={current.isSaved} /></IconButton>
					<IconButton onClick={openSaveMenu} title="Save and playlist options" active={saveMenu}><PlusIcon /></IconButton>
					<div className="flex items-center gap-1.5 ml-2 min-w-[116px]">
						<IconButton onClick={() => setMuted((v) => !v)} title={muted ? "Unmute" : "Mute"}><VolumeIcon mode={volumeIcon} /></IconButton>
						<input aria-label="Volume" type="range" min={0} max={1} step="0.01" value={volume} onChange={(e) => { setVolume(Number(e.target.value)); if (Number(e.target.value) > 0) setMuted(false); }} className="ys-player-range w-20" />
					</div>
					{saveMenu && <SaveMenu current={current} playlists={playlists} loading={menuLoading} onSaveRelease={saveRelease} onFavoriteArtist={favoriteArtist} onNewPlaylist={openNewPlaylist} onExistingPlaylist={openExistingPlaylist} onClose={() => setSaveMenu(false)} />}
				</div>
			</div>

			{/* Mobile / narrow dev-window player */}
			<div className="md:hidden px-3 pt-2 pb-[max(.5rem,env(safe-area-inset-bottom))]">
				<div className="flex items-center gap-2">
					<NowPlaying current={current} queueLabel={queueLabel} compact />
					<div className="ml-auto relative flex items-center gap-0.5">
						<IconButton onClick={() => react(1)} title="Like" active={current.myReaction === 1}><ThumbUpIcon /></IconButton>
						<IconButton onClick={() => react(-1)} title="Dislike" active={current.myReaction === -1}><ThumbDownIcon /></IconButton>
						<IconButton onClick={saveCurrent} title="Save song" active={current.isSaved}><HeartIcon filled={current.isSaved} /></IconButton>
						<IconButton onClick={openSaveMenu} title="More save options" active={saveMenu}><PlusIcon /></IconButton>
						{saveMenu && <SaveMenu current={current} playlists={playlists} loading={menuLoading} onSaveRelease={saveRelease} onFavoriteArtist={favoriteArtist} onNewPlaylist={openNewPlaylist} onExistingPlaylist={openExistingPlaylist} onClose={() => setSaveMenu(false)} />}
					</div>
				</div>
				<div className="flex items-center justify-center gap-4 -mt-1">
					<IconButton onClick={previous} disabled={!canPrevious && time <= 3} title="Previous"><PreviousIcon /></IconButton>
					<button onClick={toggle} className="h-10 w-10 rounded-full bg-white text-black grid place-items-center" aria-label={playing ? "Pause" : "Play"}>{playing ? <PauseIcon /> : <PlayIcon />}</button>
					<IconButton onClick={next} disabled={!canNext} title="Next"><NextIcon /></IconButton>
					<IconButton onClick={cycleRepeat} title={repeatTitle} active={repeatMode !== "off"}><RepeatIcon one={repeatMode === "one"} /></IconButton>
				</div>
				<SeekBar audio={audio} time={time} duration={duration} compact />
			</div>

			{playlistDialog === "new" && (
				<NewPlaylistModal
					trackId={current.id}
					onCreated={onPlaylistCreated}
					onClose={() => setPlaylistDialog(null)}
				/>
			)}
			{playlistDialog === "existing" && (
				<ExistingPlaylistModal
					playlists={playlists}
					loading={menuLoading}
					onSelect={(playlistId) => void addToPlaylist(playlistId)}
					onNew={() => setPlaylistDialog("new")}
					onClose={() => setPlaylistDialog(null)}
				/>
			)}
		</div>
	);
}

function NowPlaying({ current, queueLabel, compact = false }: { current: WorldTrack; queueLabel: string; compact?: boolean }) {
	return <div className={`min-w-0 flex items-center gap-2.5 ${compact ? "flex-1" : ""}`}>
		{current.hasArtwork ? <img src={worldArtworkUrl(current.id)} alt="" className={`${compact ? "h-10 w-10" : "h-12 w-12"} shrink-0 rounded-lg object-cover bg-neutral-900`} /> : <div className={`${compact ? "h-10 w-10" : "h-12 w-12"} shrink-0 rounded-lg bg-neutral-900 grid place-items-center text-neutral-600`}>♪</div>}
		<div className="min-w-0"><div className="font-medium text-sm truncate">{current.title}</div><div className="text-xs text-neutral-500 truncate">{current.artistName}</div>{queueLabel && !compact && <div className="text-[10px] text-neutral-600 truncate">{queueLabel}</div>}</div>
	</div>;
}

function SeekBar({ audio, time, duration, compact = false }: { audio: HTMLAudioElement | null; time: number; duration: number; compact?: boolean }) {
	return <div className={`flex items-center gap-2 ${compact ? "mt-1" : ""}`}>
		<span className="text-[10px] tabular-nums text-neutral-500 w-8 text-right">{durationLabel(time)}</span>
		<input aria-label="Seek" type="range" min={0} max={duration || 1} step="0.1" value={Math.min(time, duration || 1)} onChange={(e) => { if (audio) audio.currentTime = Number(e.target.value); }} className="ys-player-range min-w-0 flex-1" />
		<span className="text-[10px] tabular-nums text-neutral-500 w-8">{durationLabel(duration)}</span>
	</div>;
}

function SaveMenu({ current, playlists, loading, onSaveRelease, onFavoriteArtist, onNewPlaylist, onExistingPlaylist, onClose }: { current: WorldTrack; playlists: WorldPlaylist[]; loading: boolean; onSaveRelease: () => void; onFavoriteArtist: () => void; onNewPlaylist: () => void; onExistingPlaylist: () => void; onClose: () => void }) {
	return <>
		<button className="fixed inset-0 z-[72] cursor-default" onClick={onClose} aria-label="Close save menu" />
		<div className="absolute z-[73] right-0 bottom-full mb-3 w-[min(320px,88vw)] max-h-[60vh] overflow-y-auto rounded-2xl border border-neutral-700 bg-neutral-950 shadow-2xl p-1.5 text-sm">
			<div className="px-2.5 pt-2 pb-1 text-[10px] uppercase tracking-wider text-neutral-500">Save</div>
			<PlayerMenuButton onClick={onSaveRelease}>{current.isReleaseSaved ? `✓ ${current.releaseType === "album" ? "Album" : "Release"} saved` : `＋ Save ${current.releaseType === "album" ? "album" : "release"}`}</PlayerMenuButton>
			<PlayerMenuButton onClick={onFavoriteArtist}>{current.isArtistFollowed ? "★ Artist favorited" : "☆ Favorite artist"}</PlayerMenuButton>
			<div className="my-1 border-t border-neutral-800" />
			<div className="px-2.5 py-1 text-[10px] uppercase tracking-wider text-neutral-500">Add to playlist</div>
			<PlayerMenuButton onClick={onNewPlaylist}>＋ Add to new playlist</PlayerMenuButton>
			<PlayerMenuButton onClick={onExistingPlaylist}>{loading ? "Loading your playlists…" : `▤ Add to existing playlist${playlists.length ? ` (${playlists.length})` : ""}`}</PlayerMenuButton>
		</div>
	</>;
}

function ModalShell({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
	// WorldPlayer itself is fixed/transformed near the bottom of the viewport. A fixed
	// modal nested under that player can therefore inherit the player's containing
	// block and appear half off-screen. Portal dialogs to document.body so inset-0 is
	// always the real browser viewport.
	if (typeof document === "undefined") return null;
	return createPortal(
		<div className="fixed inset-0 z-[190] grid place-items-center p-4 bg-black/65 backdrop-blur-md" role="dialog" aria-modal="true" aria-label={title}>
			<button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label="Close dialog" />
			<div className="relative z-[1] w-full max-w-lg max-h-[calc(100vh-2rem)] overflow-y-auto rounded-3xl border border-neutral-700 bg-neutral-950 p-5 shadow-2xl">
				<div className="flex items-center gap-3 mb-4"><h3 className="text-xl font-semibold flex-1">{title}</h3><button type="button" onClick={onClose} className="h-9 w-9 rounded-xl hover:bg-neutral-800" aria-label="Close">×</button></div>
				{children}
			</div>
		</div>,
		document.body,
	);
}

function NewPlaylistModal({ trackId, onCreated, onClose }: { trackId: string; onCreated: (playlist: WorldPlaylist) => void; onClose: () => void }) {
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [tags, setTags] = useState("");
	const [artwork, setArtwork] = useState<File | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");

	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		const cleanTitle = title.trim();
		if (!cleanTitle || busy) return;
		setBusy(true); setError("");
		try {
			let artworkObjectKey: string | null = null;
			if (artwork) {
				if (!artwork.type.startsWith("image/")) throw new Error("Playlist artwork must be an image.");
				artworkObjectKey = (await uploadWorldAsset(artwork)).objectKey;
			}
			const cleanTags = Array.from(new Set(tags.split(",").map((tag) => tag.trim()).filter(Boolean))).slice(0, 16);
			const created = await createWorldPlaylist({ title: cleanTitle, description: description.trim(), tags: cleanTags, artworkObjectKey, isPublic: true });
			await addTrackToWorldPlaylist(created.playlist.id, trackId);
			onCreated(created.playlist);
		} catch (err: any) {
			setError(String(err?.message || "Could not create playlist."));
		} finally { setBusy(false); }
	};

	return <ModalShell title="Create playlist" onClose={onClose}>
		<form onSubmit={submit} className="space-y-4">
			<label className="block"><span className="text-sm text-neutral-300">Playlist name *</span><input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2.5 outline-none focus:border-indigo-400" /></label>
			<label className="block"><span className="text-sm text-neutral-300">Description</span><textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={3} className="mt-1 w-full resize-y rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2.5 outline-none focus:border-indigo-400" /></label>
			<label className="block"><span className="text-sm text-neutral-300">Playlist artwork</span><input type="file" accept="image/*" onChange={(e) => setArtwork(e.target.files?.[0] || null)} className="mt-1 block w-full text-sm text-neutral-400 file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-800 file:px-3 file:py-2 file:text-neutral-100" />{artwork && <div className="mt-1 text-xs text-neutral-500 truncate">{artwork.name}</div>}</label>
			<label className="block"><span className="text-sm text-neutral-300">Tags</span><input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="trance, workout, favorites" className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2.5 outline-none focus:border-indigo-400" /><span className="mt-1 block text-xs text-neutral-500">Separate tags with commas.</span></label>
			{error && <div className="rounded-xl border border-rose-800/70 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">{error}</div>}
			<div className="flex justify-end gap-2 pt-1"><button type="button" onClick={onClose} className="rounded-xl px-4 py-2 hover:bg-neutral-800">Cancel</button><button disabled={busy || !title.trim()} className="rounded-xl bg-white px-4 py-2 font-medium text-black disabled:opacity-50">{busy ? "Creating…" : "Create & add song"}</button></div>
		</form>
	</ModalShell>;
}

function ExistingPlaylistModal({ playlists, loading, onSelect, onNew, onClose }: { playlists: WorldPlaylist[]; loading: boolean; onSelect: (id: string) => void; onNew: () => void; onClose: () => void }) {
	const [query, setQuery] = useState("");
	const filtered = playlists.filter((playlist) => playlist.title.toLowerCase().includes(query.trim().toLowerCase()));
	return <ModalShell title="Add to playlist" onClose={onClose}>
		<div className="space-y-3">
			<button type="button" onClick={onNew} className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-3 text-left hover:bg-neutral-800">＋ <span className="font-medium">Add to new playlist</span></button>
			<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your playlists…" className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2.5 outline-none focus:border-indigo-400" />
			<div className="max-h-[45vh] overflow-y-auto rounded-xl border border-neutral-800 divide-y divide-neutral-800">
				{loading ? <div className="p-4 text-sm text-neutral-500">Loading your playlists…</div> : filtered.length === 0 ? <div className="p-4 text-sm text-neutral-500">{playlists.length ? "No playlists match your search." : "You have not created a playlist yet."}</div> : filtered.map((playlist) => <button type="button" key={playlist.id} onClick={() => onSelect(playlist.id)} className="w-full px-4 py-3 text-left hover:bg-neutral-900"><div className="font-medium truncate">{playlist.title}</div><div className="text-xs text-neutral-500">{playlist.trackCount} song{playlist.trackCount === 1 ? "" : "s"}</div></button>)}
			</div>
		</div>
	</ModalShell>;
}

function PlayerMenuButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
	return <button type="button" onClick={onClick} className="w-full text-left rounded-xl px-2.5 py-2 hover:bg-neutral-800">{children}</button>;
}

function IconButton({ children, onClick, title, active = false, disabled = false }: { children: ReactNode; onClick: () => void; title: string; active?: boolean; disabled?: boolean }) {
	return <button type="button" onClick={onClick} disabled={disabled} title={title} aria-label={title} aria-pressed={active || undefined} className={`h-8 w-8 rounded-lg grid place-items-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${active ? "text-indigo-300 bg-indigo-500/12" : "text-neutral-300 hover:text-white hover:bg-neutral-800"} disabled:opacity-25 disabled:pointer-events-none`}>{children}</button>;
}

function PlayIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>; }
function PauseIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>; }
function PreviousIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h2v14H6zm3 7 9-7v14z"/></svg>; }
function NextIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 5h2v14h-2zM6 5l9 7-9 7z"/></svg>; }
function RepeatIcon({ one }: { one: boolean }) { return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>{one && <text x="10" y="15" fontSize="9" fill="currentColor" stroke="none" fontWeight="700">1</text>}</svg>; }
function ThumbUpIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 10v12H3V10h4Zm0 10h10.2a2 2 0 0 0 1.95-1.55l1.55-7A2 2 0 0 0 18.75 9H14l.7-3.5A3 3 0 0 0 11.75 2L7 10Z"/></svg>; }
function ThumbDownIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 14V2h4v12h-4Zm0-10H6.8a2 2 0 0 0-1.95 1.55l-1.55 7A2 2 0 0 0 5.25 15H10l-.7 3.5A3 3 0 0 0 12.25 22L17 14Z"/></svg>; }
function HeartIcon({ filled }: { filled: boolean }) { return <svg width="17" height="17" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/></svg>; }
function PlusIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>; }
function VolumeIcon({ mode }: { mode: "mute" | "low" | "high" }) { return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5Z"/>{mode === "mute" ? <><path d="m19 9-6 6"/><path d="m13 9 6 6"/></> : <><path d="M15.5 8.5a5 5 0 0 1 0 7"/>{mode === "high" && <path d="M18 6a8.5 8.5 0 0 1 0 12"/>}</>}</svg>; }
