/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { bridgeApi, normalizeVisualAdvertisingSettings, normalizeVisualBroadcastGlobals, normalizeVisualBroadcastProgram, type VisualAdvertisingSettings, type VisualBroadcastGlobals, type VisualBroadcastProgram, type VisualScenePreset } from "../lib/bridgeApi";
import { startVisualAnalysisForMediaElement } from "../lib/browserVisualAudio";
import { claimPlaybackOwner, getPlaybackOwner } from "../lib/playbackOwner";
import { publishLocalVisualTransport } from "../lib/visualsRealtime";
import { normalizeVisualScene, type VisualSceneState } from "../lib/visualsScene";
import { applyRadioStationDefaults, radioStationById } from "../lib/ysongRadio";
import { createYSongAdSession, effectiveAdSchedule, isAdDue, noteCompletedMusicTrack, notePlayedAd, requestYSongAd, type YSongAdDecision, type YSongAdSessionState } from "../lib/ysongAds";
import {
	addTrackToWorldPlaylist,
	countWorldPlay,
	updateWorldPlayProgress,
	createWorldPlaylist,
	fetchWorldLibrary,
	fetchWorldPlaylist,
	fetchWorldTrack,
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
type WorldTransitionMode = "regular" | "gapless" | "crossfade";
type WorldVisualTransition = "cut" | "fade" | "black" | "flash";
export type WorldQueueKind = "playlist" | "radio" | "ad-hoc";

export type WorldTransportCommand =
	| { type: "play" | "pause" | "toggle" | "stop" | "previous" | "next" }
	| { type: "seek"; seconds: number };

const WORLD_TRANSPORT_COMMAND_EVENT = "ysong:world-transport-command";

export function requestWorldTransport(command: WorldTransportCommand) {
	if (typeof window === "undefined") return;
	window.dispatchEvent(new CustomEvent<WorldTransportCommand>(WORLD_TRANSPORT_COMMAND_EVENT, { detail: command }));
}

type WorldPlayerContextValue = {
	current: WorldTrack | null;
	playing: boolean;
	audioRef: RefObject<HTMLAudioElement | null>;
	queue: WorldTrack[];
	queueLabel: string;
	queueId: string;
	programId: string;
	queueKind: WorldQueueKind;
	playTrack: (track: WorldTrack) => void;
	startQueue: (tracks: WorldTrack[], label: string, startTrackId?: string, queueId?: string, broadcastProgramId?: string, queueKind?: WorldQueueKind) => void;
	next: () => void;
	previous: () => void;
	canNext: boolean;
	canPrevious: boolean;
	repeatMode: RepeatMode;
	cycleRepeat: () => void;
	shuffle: boolean;
	toggleShuffle: () => void;
	transitionMode: WorldTransitionMode;
	crossfadeSeconds: number;
	visualTransition: WorldVisualTransition;
	visualTransitionSeconds: number;
	crossfading: boolean;
	pause: () => void;
	stop: () => void;
	seek: (seconds: number) => void;
	toggle: () => void;
	patchCurrent: (patch: Partial<WorldTrack>) => void;
	adBreakActive: boolean;
	adTitle: string;
	adSponsor: string;
};

const WorldPlayerContext = createContext<WorldPlayerContextValue | null>(null);

function storedRepeatMode(): RepeatMode {
	try {
		const value = localStorage.getItem("ysong:world-repeat");
		return value === "all" || value === "one" ? value : "off";
	} catch { return "off"; }
}

function storedShuffle() {
	try { return localStorage.getItem("ysong:world-shuffle") === "1"; } catch { return false; }
}

type StoredWorldPlayerState = {
	current: WorldTrack | null;
	queue: WorldTrack[];
	queueIndex: number;
	queueLabel: string;
	queueId: string;
	programId: string;
	queueKind: WorldQueueKind;
	positionSeconds: number;
};

const WORLD_PLAYER_STATE_KEY = "ysong:world-player-state:v1";

function readStoredWorldPlayerState(): StoredWorldPlayerState | null {
	try {
		const raw = localStorage.getItem(WORLD_PLAYER_STATE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<StoredWorldPlayerState>;
		const current = parsed.current && typeof parsed.current.id === "string" ? parsed.current : null;
		const queue = Array.isArray(parsed.queue) ? parsed.queue.filter((track): track is WorldTrack => !!track && typeof track.id === "string") : [];
		const normalizedQueue = queue.length ? queue : current ? [current] : [];
		const queueIndex = normalizedQueue.length ? Math.max(0, Math.min(normalizedQueue.length - 1, Number.isFinite(parsed.queueIndex) ? Number(parsed.queueIndex) : Math.max(0, normalizedQueue.findIndex((track) => track.id === current?.id)))) : -1;
		return {
			current: current ?? normalizedQueue[queueIndex] ?? null,
			queue: normalizedQueue,
			queueIndex,
			queueLabel: typeof parsed.queueLabel === "string" ? parsed.queueLabel : "",
			queueId: typeof parsed.queueId === "string" ? parsed.queueId : "",
			programId: typeof parsed.programId === "string" ? parsed.programId : (typeof parsed.queueId === "string" ? parsed.queueId : ""),
			queueKind: parsed.queueKind === "radio" || parsed.queueKind === "playlist" ? parsed.queueKind : (parsed.queueId ? "playlist" : "ad-hoc"),
			positionSeconds: Math.max(0, Number(parsed.positionSeconds) || 0),
		};
	} catch { return null; }
}

const DEFAULT_BROADCAST_GLOBALS = normalizeVisualBroadcastGlobals(null);
const DEFAULT_ADVERTISING_SETTINGS = normalizeVisualAdvertisingSettings(null);
const DEFAULT_BROADCAST_PROGRAM = (programId: string, identity?: { playlistId?: string; stationId?: string; kind?: VisualBroadcastProgram["kind"]; name?: string }): VisualBroadcastProgram => normalizeVisualBroadcastProgram(null, programId, identity);

export function WorldPlayerProvider({ children }: { children: ReactNode }) {
	const [restoredState] = useState<StoredWorldPlayerState | null>(() => readStoredWorldPlayerState());
	const [current, setCurrent] = useState<WorldTrack | null>(() => restoredState?.current ?? null);
	const [playing, setPlaying] = useState(false);
	const [queue, setQueue] = useState<WorldTrack[]>(() => restoredState?.queue ?? []);
	const [queueIndex, setQueueIndex] = useState(() => restoredState?.queueIndex ?? -1);
	const [queueLabel, setQueueLabel] = useState(() => restoredState?.queueLabel ?? "");
	const [queueId, setQueueId] = useState(() => restoredState?.queueId ?? "");
	const [programId, setProgramId] = useState(() => restoredState?.programId ?? restoredState?.queueId ?? "");
	const [queueKind, setQueueKind] = useState<WorldQueueKind>(() => restoredState?.queueKind ?? (restoredState?.queueId ? "playlist" : "ad-hoc"));
	const [repeatMode, setRepeatMode] = useState<RepeatMode>(() => storedRepeatMode());
	const [shuffle, setShuffle] = useState(() => storedShuffle());
	const [transitionMode, setTransitionMode] = useState<WorldTransitionMode>("regular");
	const [crossfadeSeconds, setCrossfadeSeconds] = useState(5);
	const [visualTransition, setVisualTransition] = useState<WorldVisualTransition>("fade");
	const [visualTransitionSeconds, setVisualTransitionSeconds] = useState(1.4);
	const [crossfading, setCrossfading] = useState(false);
	const [activeDeck, setActiveDeck] = useState<"a" | "b">("a");
	const [activeAd, setActiveAd] = useState<YSongAdDecision | null>(null);
	const audioARef = useRef<HTMLAudioElement | null>(null);
	const audioBRef = useRef<HTMLAudioElement | null>(null);
	const adAudioRef = useRef<HTMLAudioElement | null>(null);
	const activeDeckRef = useRef<"a" | "b">("a");
	const queueRef = useRef<WorldTrack[]>(queue);
	const queueIndexRef = useRef(queueIndex);
	const currentRef = useRef<WorldTrack | null>(current);
	const queueIdRef = useRef(queueId);
	const programIdRef = useRef(programId);
	const queueKindRef = useRef<WorldQueueKind>(queueKind);
	const restoredPositionRef = useRef(Math.max(0, restoredState?.positionSeconds ?? 0));
	const restoredProgramHydratedRef = useRef(false);
	const transitionModeRef = useRef<WorldTransitionMode>("regular");
	const crossfadeSecondsRef = useRef(5);
	const visualTransitionRef = useRef<WorldVisualTransition>("fade");
	const visualTransitionSecondsRef = useRef(1.4);
	const visualTransitionProgressRef = useRef(0);
	const visualTransitionRafRef = useRef<number | null>(null);
	const shuffleRef = useRef(shuffle);
	const repeatRef = useRef(repeatMode);
	const avoidRecentRef = useRef(12);
	const visualAvoidRecentRef = useRef(3);
	const recentIdsRef = useRef<string[]>([]);
	const recentVisualIdsRef = useRef<string[]>([]);
	const plannedNextIndexRef = useRef(-1);
	const playbackHistoryRef = useRef<number[]>([]);
	const shuffleBagRef = useRef<number[]>([]);
	const shuffleCycleRef = useRef(0);
	const crossfadeBusyRef = useRef(false);
	const crossfadeProgressRef = useRef(0);
	const transitionSequenceRef = useRef(0);
	const activeProgramRef = useRef<VisualBroadcastProgram | null>(null);
	const activeGlobalsRef = useRef<VisualBroadcastGlobals>(DEFAULT_BROADCAST_GLOBALS);
	const advertisingSettingsRef = useRef<VisualAdvertisingSettings>(DEFAULT_ADVERTISING_SETTINGS);
	const adSessionRef = useRef<YSongAdSessionState>(createYSongAdSession());
	const activeAdRef = useRef<YSongAdDecision | null>(null);
	const pendingAfterAdIndexRef = useRef(-1);
	const visualLibraryRef = useRef<VisualScenePreset<VisualSceneState>[]>([]);
	const activeVisualSceneIdRef = useRef("");
	const activeVisualSceneNameRef = useRef("");
	// Phase 16 Flashback uses actual listened time when available instead of
	// treating every click as a full song. The event id comes from the World API;
	// the browser keeps a small wall-clock accumulator while music is really playing.
	const activePlayEventIdRef = useRef("");
	const activePlayTrackIdRef = useRef("");
	const listenedSecondsRef = useRef(0);
	const listenClockStartedAtRef = useRef<number | null>(null);
	const audioRef = activeAd ? adAudioRef : activeDeck === "a" ? audioARef : audioBRef;

	useEffect(() => { activeDeckRef.current = activeDeck; }, [activeDeck]);
	useEffect(() => { queueRef.current = queue; }, [queue]);
	useEffect(() => { queueIndexRef.current = queueIndex; }, [queueIndex]);
	useEffect(() => { currentRef.current = current; }, [current]);
	useEffect(() => { queueIdRef.current = queueId; }, [queueId]);
	useEffect(() => { programIdRef.current = programId; }, [programId]);
	useEffect(() => { queueKindRef.current = queueKind; }, [queueKind]);
	useEffect(() => { transitionModeRef.current = transitionMode; }, [transitionMode]);
	useEffect(() => { crossfadeSecondsRef.current = crossfadeSeconds; }, [crossfadeSeconds]);
	useEffect(() => { visualTransitionRef.current = visualTransition; }, [visualTransition]);
	useEffect(() => { visualTransitionSecondsRef.current = visualTransitionSeconds; }, [visualTransitionSeconds]);
	useEffect(() => { shuffleRef.current = shuffle; try { localStorage.setItem("ysong:world-shuffle", shuffle ? "1" : "0"); } catch {} }, [shuffle]);
	useEffect(() => { repeatRef.current = repeatMode; try { localStorage.setItem("ysong:world-repeat", repeatMode); } catch {} }, [repeatMode]);

	useEffect(() => { activeAdRef.current = activeAd; }, [activeAd]);

	const getDeck = useCallback((deck: "a" | "b") => deck === "a" ? audioARef.current : audioBRef.current, []);
	const otherDeck = (deck: "a" | "b") => deck === "a" ? "b" as const : "a" as const;

	const accrueListenClock = useCallback(() => {
		const started = listenClockStartedAtRef.current;
		if (started != null) {
			listenedSecondsRef.current += Math.max(0, (performance.now() - started) / 1000);
			listenClockStartedAtRef.current = null;
		}
		return listenedSecondsRef.current;
	}, []);

	const startListenClock = useCallback(() => {
		if (!activePlayTrackIdRef.current || activeAdRef.current || listenClockStartedAtRef.current != null) return;
		listenClockStartedAtRef.current = performance.now();
	}, []);

	const flushListenProgress = useCallback((completed = false, reset = false) => {
		const seconds = accrueListenClock();
		const eventId = activePlayEventIdRef.current;
		if (eventId) void updateWorldPlayProgress(eventId, seconds, completed).catch(() => {});
		if (reset) {
			activePlayEventIdRef.current = "";
			activePlayTrackIdRef.current = "";
			listenedSecondsRef.current = 0;
			listenClockStartedAtRef.current = null;
		}
		return seconds;
	}, [accrueListenClock]);

	// Restore the last World track/queue without autoplay. The dock and Visuals transport
	// should still know what the user left off on after a reload/restart.
	// If this is the first run of the persistence fix, recover the last World track
	// from the Bridge transport snapshot so a patch reload does not erase the dock.
	useEffect(() => {
		if (restoredState?.current) return;
		let cancelled = false;
		void bridgeApi.getVisualTransport().then(async snapshot => {
			if (cancelled || snapshot.source !== "world" || !snapshot.trackId) return;
			try {
				let restoredQueue: WorldTrack[] = [];
				let restoredLabel = snapshot.playlistName || "";
				if (snapshot.playlistId) {
					try {
						const detail = await fetchWorldPlaylist(snapshot.playlistId);
						if (!cancelled && detail.tracks?.length) {
							restoredQueue = detail.tracks;
							restoredLabel = detail.playlist?.title || restoredLabel;
						}
					} catch { /* fall through to single-track recovery */ }
				}
				let track = restoredQueue.find(candidate => candidate.id === snapshot.trackId) || null;
				if (!track) {
					const fetched = await fetchWorldTrack(snapshot.trackId);
					track = fetched.track;
				}
				if (cancelled || !track) return;
				if (!restoredQueue.length) restoredQueue = [track];
				const restoredIndex = Math.max(0, restoredQueue.findIndex(candidate => candidate.id === track!.id));
				restoredPositionRef.current = Math.max(0, snapshot.positionSeconds || 0);
				currentRef.current = track; setCurrent(track);
				queueRef.current = restoredQueue; setQueue(restoredQueue);
				queueIndexRef.current = restoredIndex; setQueueIndex(restoredIndex);
				setQueueLabel(restoredLabel); setQueueId(snapshot.playlistId || ""); queueIdRef.current = snapshot.playlistId || "";
				const restoredProgramId = snapshot.broadcastProgramId || snapshot.playlistId || "";
				const restoredKind: WorldQueueKind = snapshot.broadcastKind === "radio" || snapshot.broadcastKind === "playlist" ? snapshot.broadcastKind : (snapshot.playlistId ? "playlist" : "ad-hoc");
				setProgramId(restoredProgramId); programIdRef.current = restoredProgramId;
				setQueueKind(restoredKind); queueKindRef.current = restoredKind;
				const audio = getDeck(activeDeckRef.current);
				if (audio) {
					const url = worldAudioUrl(track.id); audio.src = url; audio.preload = "auto";
					const position = restoredPositionRef.current;
					const restore = () => { try { audio.currentTime = Math.min(position, Number.isFinite(audio.duration) && audio.duration > 0 ? Math.max(0, audio.duration - .01) : position); } catch {} };
					if (audio.readyState >= 1) restore(); else audio.addEventListener("loadedmetadata", restore, { once: true });
				}
			} catch { /* stale Bridge snapshot can be ignored */ }
		}).catch(() => {});
		return () => { cancelled = true; };
	}, [getDeck, restoredState]);

	useEffect(() => {
		const track = currentRef.current;
		const audio = getDeck(activeDeckRef.current);
		if (!track || !audio) return;
		const url = worldAudioUrl(track.id);
		const absolute = new URL(url, window.location.origin).href;
		if (audio.src !== absolute) audio.src = url;
		audio.preload = "auto";
		const restorePosition = () => {
			const limit = Number.isFinite(audio.duration) && audio.duration > 0 ? Math.max(0, audio.duration - 0.01) : restoredPositionRef.current;
			try { audio.currentTime = Math.min(restoredPositionRef.current, limit); } catch { /* metadata can race */ }
		};
		if (audio.readyState >= 1) restorePosition();
		else audio.addEventListener("loadedmetadata", restorePosition, { once: true });
		return () => audio.removeEventListener("loadedmetadata", restorePosition);
	}, [getDeck]);

	useEffect(() => {
		if (!current) return;
		let lastWrite = 0;
		const save = () => {
			const audio = getDeck(activeDeckRef.current);
			const now = performance.now();
			if (now - lastWrite < 400) return;
			lastWrite = now;
			const state: StoredWorldPlayerState = {
				current,
				queue: queue.length ? queue : [current],
				queueIndex: queueIndex >= 0 ? queueIndex : 0,
				queueLabel,
				queueId,
				programId,
				queueKind,
				positionSeconds: Math.max(0, audio?.currentTime || 0),
			};
			try { localStorage.setItem(WORLD_PLAYER_STATE_KEY, JSON.stringify(state)); } catch { /* best effort */ }
		};
		const timer = window.setInterval(save, 500);
		window.addEventListener("beforeunload", save);
		return () => { save(); window.clearInterval(timer); window.removeEventListener("beforeunload", save); };
	}, [current, getDeck, programId, queue, queueId, queueIndex, queueKind, queueLabel]);

	useEffect(() => {
		const stops: Array<() => void> = [];
		if (audioARef.current) stops.push(startVisualAnalysisForMediaElement(audioARef.current));
		if (audioBRef.current) stops.push(startVisualAnalysisForMediaElement(audioBRef.current));
		if (adAudioRef.current) stops.push(startVisualAnalysisForMediaElement(adAudioRef.current));
		return () => stops.forEach((stopAnalysis) => stopAnalysis());
	}, []);

	// Checkpoint active listening so Flashback stays current even during a long
	// uninterrupted song. Pauses, track changes and completions also flush.
	useEffect(() => {
		const timer = window.setInterval(() => {
			if (getPlaybackOwner() !== "world" || activeAdRef.current || listenClockStartedAtRef.current == null) return;
			const seconds = accrueListenClock();
			const eventId = activePlayEventIdRef.current;
			if (eventId) void updateWorldPlayProgress(eventId, seconds, false).catch(() => {});
			startListenClock();
		}, 15000);
		return () => window.clearInterval(timer);
	}, [accrueListenClock, startListenClock]);

	const requestWorldPlayback = useCallback(() => { window.dispatchEvent(new Event("ysong:world-play-request")); }, []);

	useEffect(() => {
		const onDawPlay = () => { audioARef.current?.pause(); audioBRef.current?.pause(); adAudioRef.current?.pause(); };
		window.addEventListener("ysong:daw-play-request", onDawPlay);
		return () => window.removeEventListener("ysong:daw-play-request", onDawPlay);
	}, []);

	const countAndSelect = useCallback((track: WorldTrack) => {
		// Commit any time accumulated for the previous track before the active World
		// item changes. This also handles manual next/previous and crossfades.
		flushListenProgress(false, true);
		activePlayTrackIdRef.current = track.id;
		setCurrent(track);
		currentRef.current = track;
		recentIdsRef.current = [track.id, ...recentIdsRef.current.filter((id) => id !== track.id)].slice(0, Math.max(4, avoidRecentRef.current));
		countWorldPlay(track.id)
			.then((r) => {
				if (activePlayTrackIdRef.current === track.id) activePlayEventIdRef.current = r.playEventId || "";
				setCurrent((cur) => cur?.id === track.id ? { ...cur, playCount: r.playCount } : cur);
				window.dispatchEvent(new CustomEvent("ysong:world-play-count", { detail: { trackId: track.id, playCount: r.playCount } }));
			})
			.catch(() => {});
	}, [flushListenProgress]);

	const runVisualSceneTransition = useCallback((scene: VisualSceneState, mode: WorldVisualTransition, seconds: number, sceneId = "", sceneName = "") => {
		if (visualTransitionRafRef.current != null) cancelAnimationFrame(visualTransitionRafRef.current);
		const safeSeconds = Math.max(0.1, Math.min(12, seconds || 1.4));
		visualTransitionRef.current = mode; setVisualTransition(mode);
		visualTransitionSecondsRef.current = safeSeconds; setVisualTransitionSeconds(safeSeconds);
		transitionSequenceRef.current += 1;
		const commit = () => {
			activeVisualSceneIdRef.current = sceneId;
			activeVisualSceneNameRef.current = sceneName;
			void bridgeApi.setVisualScene(scene).catch(() => {});
		};
		if (mode === "cut") { visualTransitionProgressRef.current = 0; commit(); return; }
		const started = performance.now();
		let swapped = false;
		const step = (now: number) => {
			const t = Math.max(0, Math.min(1, (now - started) / (safeSeconds * 1000)));
			visualTransitionProgressRef.current = t;
			if (!swapped && t >= 0.5) { swapped = true; commit(); }
			if (t < 1) visualTransitionRafRef.current = requestAnimationFrame(step);
			else { visualTransitionProgressRef.current = 0; visualTransitionRafRef.current = null; if (!swapped) commit(); }
		};
		visualTransitionRafRef.current = requestAnimationFrame(step);
	}, []);

	const refreshVisualLibrary = useCallback(async () => {
		try {
			const library = await bridgeApi.getVisualLibrary<VisualSceneState>();
			visualLibraryRef.current = library.presets || [];
			return visualLibraryRef.current;
		} catch { return visualLibraryRef.current; }
	}, []);

	const refreshBroadcastGlobals = useCallback(async () => {
		try {
			const globals = normalizeVisualBroadcastGlobals(await bridgeApi.getVisualBroadcastGlobals());
			activeGlobalsRef.current = globals;
			return globals;
		} catch { return activeGlobalsRef.current; }
	}, []);

	const refreshAdvertisingSettings = useCallback(async () => {
		try {
			const settings = normalizeVisualAdvertisingSettings(await bridgeApi.getVisualAdvertisingSettings());
			advertisingSettingsRef.current = settings;
			return settings;
		} catch { return advertisingSettingsRef.current; }
	}, []);

	// Global broadcast defaults also apply to ad-hoc World queues (song radio,
	// artist radio, search playback), so hydrate them even before a playlist or
	// first-class station program is opened.
	useEffect(() => { void refreshBroadcastGlobals(); void refreshAdvertisingSettings(); }, [refreshAdvertisingSettings, refreshBroadcastGlobals]);

	const effectiveAudioTransitionForTrack = useCallback((track: WorldTrack) => {
		const program = activeProgramRef.current;
		const assignment = program?.trackAssignments?.[track.id];
		return {
			mode: (assignment?.audioTransition || program?.audioTransition || transitionModeRef.current || "regular") as WorldTransitionMode,
			seconds: Math.max(0.5, Math.min(20, Number(assignment?.crossfadeSeconds ?? program?.crossfadeSeconds ?? crossfadeSecondsRef.current) || 5)),
		};
	}, []);

	const applyVisualForTrack = useCallback(async (track: WorldTrack, activeProgramId = programIdRef.current) => {
		try {
			let scene: VisualSceneState | null = null;
			let sceneId = "";
			let sceneName = "";
			let transition: WorldVisualTransition = visualTransitionRef.current;
			let transitionSeconds = visualTransitionSecondsRef.current;
			if (activeProgramId) {
				const rawProgram = activeProgramRef.current?.programId === activeProgramId
					? activeProgramRef.current
					: await bridgeApi.getVisualProgram(activeProgramId).catch(() => DEFAULT_BROADCAST_PROGRAM(activeProgramId, { playlistId: queueIdRef.current, kind: queueKindRef.current, name: queueLabel }));
				const stationId = queueKindRef.current === "radio" ? activeProgramId.replace(/^ysong-radio-/, "") : "";
				const seededProgram = applyRadioStationDefaults(rawProgram as VisualBroadcastProgram & { isDefault?: boolean }, radioStationById(stationId));
				const program = normalizeVisualBroadcastProgram(seededProgram, activeProgramId, { playlistId: queueIdRef.current, stationId: stationId || undefined, kind: queueKindRef.current, name: queueLabel });
				activeProgramRef.current = program;
				const assignment = program.trackAssignments[track.id];
				transition = assignment?.visualTransition || program.visualTransition || "fade";
				transitionSeconds = Math.max(0.1, Math.min(12, Number(assignment?.visualTransitionSeconds ?? program.visualTransitionSeconds) || 1.4));
				const globalIds = activeGlobalsRef.current.defaultSceneIds;
				// New programs key album pools by release id so two artists can both have
				// an album named e.g. "Greatest Hits" without sharing visuals. Album-name
				// lookup remains as a compatibility fallback for older saved programs.
				const albumIds = program.albumDefaults[track.releaseId] || program.albumDefaults[track.albumName] || [];
				const ids = assignment?.sceneIds?.length
					? assignment.sceneIds
					: albumIds.length
						? albumIds
						: program.defaultSceneIds.length
							? program.defaultSceneIds
							: globalIds;
				if (ids?.length) {
					const library = visualLibraryRef.current.length ? visualLibraryRef.current : await refreshVisualLibrary();
					const available = ids.filter((id) => library.some((item) => item.id === id));
					if (available.length) {
						const avoidCount = Math.max(program.visualAvoidRecent, activeGlobalsRef.current.visualAvoidRecent);
						const recent = new Set(recentVisualIdsRef.current.slice(0, avoidCount));
						let candidates = available.filter((id) => !recent.has(id));
						if (!candidates.length) candidates = available.filter((id) => id !== activeVisualSceneIdRef.current);
						if (!candidates.length) candidates = available;
						sceneId = candidates[Math.floor(Math.random() * candidates.length)] || available[0];
						const preset = library.find((item) => item.id === sceneId);
						if (preset) { scene = normalizeVisualScene(preset.scene); sceneName = preset.name; }
						recentVisualIdsRef.current = [sceneId, ...recentVisualIdsRef.current.filter((id) => id !== sceneId)].slice(0, Math.max(4, avoidCount + 2));
					}
				}
			}
			if (!scene && !activeProgramId && activeGlobalsRef.current.defaultSceneIds.length) {
				const library = visualLibraryRef.current.length ? visualLibraryRef.current : await refreshVisualLibrary();
				const available = activeGlobalsRef.current.defaultSceneIds.filter((id) => library.some((item) => item.id === id));
				if (available.length) {
					const avoidCount = activeGlobalsRef.current.visualAvoidRecent;
					const recent = new Set(recentVisualIdsRef.current.slice(0, avoidCount));
					let candidates = available.filter((id) => !recent.has(id));
					if (!candidates.length) candidates = available.filter((id) => id !== activeVisualSceneIdRef.current);
					if (!candidates.length) candidates = available;
					sceneId = candidates[Math.floor(Math.random() * candidates.length)] || available[0];
					const preset = library.find((item) => item.id === sceneId);
					if (preset) { scene = normalizeVisualScene(preset.scene); sceneName = preset.name; }
					recentVisualIdsRef.current = [sceneId, ...recentVisualIdsRef.current.filter((id) => id !== sceneId)].slice(0, Math.max(4, avoidCount + 2));
				}
			}
			if (!scene) {
				const current = await bridgeApi.getVisualScene<VisualSceneState>();
				scene = normalizeVisualScene(current.scene);
				sceneId = activeVisualSceneIdRef.current;
				sceneName = activeVisualSceneNameRef.current || "Current Scene";
			}
			scene.nowPlaying = { ...scene.nowPlaying, title: track.title, artist: track.artistName, album: track.albumName };
			scene.updatedAt = Date.now();
			if (sceneId && sceneId === activeVisualSceneIdRef.current) {
				activeVisualSceneNameRef.current = sceneName;
				void bridgeApi.setVisualScene(scene).catch(() => {});
			} else runVisualSceneTransition(scene, transition, transitionSeconds, sceneId, sceneName);
		} catch { /* Visual assignment must never stop audio playback. */ }
	}, [queueLabel, refreshVisualLibrary, runVisualSceneTransition]);

	const loadProgram = useCallback(async (activeProgramId: string, identity?: { playlistId?: string; stationId?: string; kind?: VisualBroadcastProgram["kind"]; name?: string }): Promise<VisualBroadcastProgram | null> => {
		if (!activeProgramId) {
			activeProgramRef.current = null;
			visualLibraryRef.current = [];
			void refreshBroadcastGlobals();
			return null;
		}
		let program: VisualBroadcastProgram;
		try {
			const raw = await bridgeApi.getVisualProgram(activeProgramId);
			const stationId = identity?.stationId || (activeProgramId.startsWith("ysong-radio-") ? activeProgramId.replace(/^ysong-radio-/, "") : "");
			const seeded = applyRadioStationDefaults(raw as VisualBroadcastProgram & { isDefault?: boolean }, radioStationById(stationId));
			program = normalizeVisualBroadcastProgram(seeded, activeProgramId, identity);
		}
		catch { program = DEFAULT_BROADCAST_PROGRAM(activeProgramId, identity); }
		activeProgramRef.current = program;
		await Promise.all([refreshVisualLibrary(), refreshBroadcastGlobals()]);
		setTransitionMode(program.audioTransition); transitionModeRef.current = program.audioTransition;
		const seconds = Math.max(0.5, Math.min(20, program.crossfadeSeconds || 5)); setCrossfadeSeconds(seconds); crossfadeSecondsRef.current = seconds;
		setVisualTransition(program.visualTransition || "fade"); visualTransitionRef.current = program.visualTransition || "fade";
		setVisualTransitionSeconds(program.visualTransitionSeconds); visualTransitionSecondsRef.current = program.visualTransitionSeconds;
		setShuffle(!!program.shuffle); shuffleRef.current = !!program.shuffle;
		avoidRecentRef.current = Math.max(0, Math.min(100, program.avoidRecent));
		visualAvoidRecentRef.current = Math.max(0, Math.min(50, program.visualAvoidRecent));
		setRepeatMode(program.repeatMode); repeatRef.current = program.repeatMode;
		shuffleBagRef.current = []; shuffleCycleRef.current = 0; plannedNextIndexRef.current = -1;
		return program;
	}, [refreshBroadcastGlobals, refreshVisualLibrary]);

	const applyAdBreakVisual = useCallback(async (decision: YSongAdDecision) => {
		const settings = advertisingSettingsRef.current;
		const presentation = settings.presentation;
		if (!presentation.enabled || !presentation.sceneId) return;
		try {
			const library = visualLibraryRef.current.length ? visualLibraryRef.current : await refreshVisualLibrary();
			const preset = library.find((item) => item.id === presentation.sceneId);
			if (!preset) return;
			const scene = normalizeVisualScene(preset.scene);
			scene.nowPlaying = {
				...scene.nowPlaying,
				title: presentation.label || "Ad Break",
				artist: presentation.showSponsor ? decision.creative.sponsor : "",
				album: "",
			};
			scene.updatedAt = Date.now();
			runVisualSceneTransition(scene, presentation.visualTransition, presentation.visualTransitionSeconds, preset.id, preset.name);
		} catch { /* Ad-break visuals are optional and must never stop audio. */ }
	}, [refreshVisualLibrary, runVisualSceneTransition]);

	const tryBeginAdBreak = useCallback(async (nextIndex: number, completedMusicSeconds: number) => {
		// YSong ads are intentionally narrow: radio interstitials only. Playlists, albums,
		// direct World playback and search queues never receive mid-roll ads. Live Rooms
		// use a separate one-time audio pre-roll before stage entry.
		if (queueKindRef.current !== "radio") {
			adSessionRef.current = noteCompletedMusicTrack(adSessionRef.current, completedMusicSeconds);
			return false;
		}
		const nowMs = Date.now();
		const settings = advertisingSettingsRef.current;
		const stateBefore = adSessionRef.current;
		const due = isAdDue(settings, stateBefore, programIdRef.current, nowMs, completedMusicSeconds, 1, queueKindRef.current);
		adSessionRef.current = noteCompletedMusicTrack(stateBefore, completedMusicSeconds);
		if (!due) return false;

		const currentTrack = currentRef.current;
		const nextTrack = nextIndex >= 0 ? queueRef.current[nextIndex] : undefined;
		const schedule = effectiveAdSchedule(settings, programIdRef.current);
		const decision = await requestYSongAd(settings, {
			programId: programIdRef.current,
			programKind: queueKindRef.current,
			queueLabel,
			currentTrackId: currentTrack?.id,
			nextTrackId: nextTrack?.id,
			recentCreativeIds: adSessionRef.current.recentCreativeIds.slice(0, schedule.recentCreativeWindow),
			nowMs,
		});
		if (!decision) return false;
		const adAudio = adAudioRef.current;
		if (!adAudio) return false;

		for (const deck of ["a", "b"] as const) getDeck(deck)?.pause();
		pendingAfterAdIndexRef.current = nextIndex;
		activeAdRef.current = decision;
		setActiveAd(decision);
		adAudio.src = decision.creative.audioUrl;
		adAudio.currentTime = 0;
		adAudio.volume = storedVolume();
		adAudio.preload = "auto";
		requestWorldPlayback();
		try {
			await adAudio.play();
			adSessionRef.current = notePlayedAd(adSessionRef.current, decision.creative.id, schedule.recentCreativeWindow, Date.now());
			setPlaying(true);
			void applyAdBreakVisual(decision);
			return true;
		} catch {
			pendingAfterAdIndexRef.current = -1;
			activeAdRef.current = null;
			setActiveAd(null);
			return false;
		}
	}, [applyAdBreakVisual, getDeck, queueLabel, requestWorldPlayback]);


	useEffect(() => {
		if (restoredProgramHydratedRef.current || !restoredState?.current || !programIdRef.current) return;
		restoredProgramHydratedRef.current = true;
		void loadProgram(programIdRef.current, { playlistId: queueIdRef.current, kind: queueKindRef.current, name: queueLabel });
	}, [loadProgram, queueLabel, restoredState]);

	const playOnDeck = useCallback((deck: "a" | "b", track: WorldTrack, volume = storedVolume()) => {
		const audio = getDeck(deck);
		if (!audio) return false;
		const url = worldAudioUrl(track.id);
		if (audio.src !== new URL(url, window.location.origin).href) audio.src = url;
		audio.currentTime = 0;
		audio.volume = Math.max(0, Math.min(1, volume));
		requestWorldPlayback();
		void audio.play().catch(() => setPlaying(false));
		return true;
	}, [requestWorldPlayback, getDeck]);

	const chooseNextIndex = useCallback((refresh = false) => {
		const q = queueRef.current;
		const index = queueIndexRef.current;
		if (!q.length) return -1;
		const planned = plannedNextIndexRef.current;
		if (!refresh && planned >= 0 && planned < q.length && planned !== index) return planned;
		let result = -1;
		if (shuffleRef.current && q.length > 1) {
			let bag = shuffleBagRef.current.filter((candidate) => candidate >= 0 && candidate < q.length && candidate !== index);
			if (!bag.length) {
				if (shuffleCycleRef.current > 0 && repeatRef.current !== "all") { plannedNextIndexRef.current = -1; return -1; }
				const recent = new Set(recentIdsRef.current.slice(0, avoidRecentRef.current));
				const candidates = q.map((track, i) => ({ track, i })).filter(({ i }) => i !== index);
				const preferred = candidates.filter(({ track }) => !recent.has(track.id));
				const deferred = candidates.filter(({ track }) => recent.has(track.id));
				const randomize = <T,>(items: T[]) => {
					const next = [...items];
					for (let i = next.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [next[i], next[j]] = [next[j], next[i]]; }
					return next;
				};
				bag = [...randomize(preferred), ...randomize(deferred)].map(({ i }) => i);
				shuffleBagRef.current = bag;
				shuffleCycleRef.current += 1;
			}
			result = bag.shift() ?? -1;
			shuffleBagRef.current = bag;
		} else if (index < q.length - 1) result = index + 1;
		else if (repeatRef.current === "all" && q.length > 1) result = 0;
		plannedNextIndexRef.current = result;
		return result;
	}, []);

	const activateIndex = useCallback((index: number, deck = activeDeckRef.current) => {
		const q = queueRef.current;
		if (index < 0 || index >= q.length) return;
		const track = q[index];
		plannedNextIndexRef.current = -1;
		playbackHistoryRef.current.push(queueIndexRef.current);
		queueIndexRef.current = index; setQueueIndex(index);
		if (deck !== activeDeckRef.current) { activeDeckRef.current = deck; setActiveDeck(deck); }
		countAndSelect(track);
		playOnDeck(deck, track);
		transitionSequenceRef.current += 1;
		void applyVisualForTrack(track);
	}, [applyVisualForTrack, countAndSelect, playOnDeck]);

	const beginCrossfade = useCallback((nextIndex: number, requestedSeconds?: number, completedMusicSeconds?: number) => {
		if (crossfadeBusyRef.current || activeAdRef.current || nextIndex < 0 || nextIndex >= queueRef.current.length) return;
		if (completedMusicSeconds != null) adSessionRef.current = noteCompletedMusicTrack(adSessionRef.current, completedMusicSeconds);
		const fromDeck = activeDeckRef.current;
		const toDeck = otherDeck(fromDeck);
		const fromAudio = getDeck(fromDeck);
		const toAudio = getDeck(toDeck);
		if (!fromAudio || !toAudio) { activateIndex(nextIndex); return; }
		crossfadeBusyRef.current = true; setCrossfading(true);
		const track = queueRef.current[nextIndex];
		const baseVolume = storedVolume();
		const url = worldAudioUrl(track.id);
		if (toAudio.src !== new URL(url, window.location.origin).href) toAudio.src = url;
		toAudio.currentTime = 0; toAudio.volume = 0;
		requestWorldPlayback();
		void toAudio.play().catch(() => { crossfadeBusyRef.current = false; setCrossfading(false); activateIndex(nextIndex, fromDeck); });
		playbackHistoryRef.current.push(queueIndexRef.current);
		queueIndexRef.current = nextIndex; setQueueIndex(nextIndex);
		plannedNextIndexRef.current = -1;
		activeDeckRef.current = toDeck; setActiveDeck(toDeck);
		countAndSelect(track);
		transitionSequenceRef.current += 1;
		void applyVisualForTrack(track);
		const started = performance.now();
		const durationMs = Math.max(500, (requestedSeconds ?? crossfadeSecondsRef.current) * 1000);
		const step = (now: number) => {
			if (!crossfadeBusyRef.current) return;
			const t = Math.max(0, Math.min(1, (now - started) / durationMs));
			crossfadeProgressRef.current = t;
			fromAudio.volume = baseVolume * (1 - t);
			toAudio.volume = baseVolume * t;
			if (t < 1) requestAnimationFrame(step);
			else {
				fromAudio.pause(); fromAudio.currentTime = 0; fromAudio.volume = baseVolume;
				toAudio.volume = baseVolume;
				crossfadeProgressRef.current = 0;
				crossfadeBusyRef.current = false; setCrossfading(false);
			}
		};
		requestAnimationFrame(step);
	}, [activateIndex, applyVisualForTrack, requestWorldPlayback, countAndSelect, getDeck]);

	const cancelAdBreak = useCallback(() => {
		const adAudio = adAudioRef.current;
		if (adAudio) { adAudio.pause(); adAudio.currentTime = 0; }
		activeAdRef.current = null;
		setActiveAd(null);
		pendingAfterAdIndexRef.current = -1;
	}, []);

	const playTrack = useCallback((track: WorldTrack) => {
		cancelAdBreak();
		const audio = getDeck(activeDeckRef.current);
		if (currentRef.current?.id === track.id && audio) {
			if (audio.paused) { requestWorldPlayback(); void audio.play().catch(() => {}); } else audio.pause();
			return;
		}
		setQueue([track]); queueRef.current = [track];
		setQueueIndex(0); queueIndexRef.current = 0;
		setQueueLabel(""); setQueueId(""); queueIdRef.current = "";
		setProgramId(""); programIdRef.current = ""; setQueueKind("ad-hoc"); queueKindRef.current = "ad-hoc"; activeProgramRef.current = null;
		shuffleBagRef.current = []; shuffleCycleRef.current = 0; plannedNextIndexRef.current = -1;
		countAndSelect(track); playOnDeck(activeDeckRef.current, track); transitionSequenceRef.current += 1; void applyVisualForTrack(track, "");
	}, [applyVisualForTrack, cancelAdBreak, requestWorldPlayback, countAndSelect, getDeck, playOnDeck]);

	const startQueue = useCallback((tracks: WorldTrack[], label: string, startTrackId?: string, playlistId = "", broadcastProgramId = playlistId, nextQueueKind?: WorldQueueKind) => {
		cancelAdBreak();
		const seen = new Set<string>();
		const clean = tracks.filter((track) => track?.id && !seen.has(track.id) && seen.add(track.id));
		if (!clean.length) return;
		const resolvedKind: WorldQueueKind = nextQueueKind || (playlistId ? "playlist" : broadcastProgramId ? "radio" : "ad-hoc");
		const resolvedProgramId = broadcastProgramId || playlistId || "";
		setQueue(clean); queueRef.current = clean;
		setQueueLabel(label); setQueueId(playlistId); queueIdRef.current = playlistId;
		setProgramId(resolvedProgramId); programIdRef.current = resolvedProgramId;
		setQueueKind(resolvedKind); queueKindRef.current = resolvedKind;
		plannedNextIndexRef.current = -1;
		shuffleBagRef.current = []; shuffleCycleRef.current = 0;
		playbackHistoryRef.current = []; recentIdsRef.current = []; recentVisualIdsRef.current = [];
		const launch = async () => {
			const program = resolvedProgramId ? await loadProgram(resolvedProgramId, { playlistId, stationId: resolvedKind === "radio" ? resolvedProgramId.replace(/^ysong-radio-/, "") : undefined, kind: resolvedKind, name: label }) : null;
			let index = startTrackId ? clean.findIndex((track) => track.id === startTrackId) : 0;
			if (index < 0) index = 0;
			if (!startTrackId && program?.shuffle && clean.length > 1) index = Math.floor(Math.random() * clean.length);
			setQueueIndex(index); queueIndexRef.current = index;
			const track = clean[index];
			countAndSelect(track); playOnDeck(activeDeckRef.current, track); transitionSequenceRef.current += 1; void applyVisualForTrack(track, resolvedProgramId);
		};
		void launch();
	}, [applyVisualForTrack, cancelAdBreak, countAndSelect, loadProgram, playOnDeck]);

	const next = useCallback(() => {
		if (activeAdRef.current) return;
		const index = chooseNextIndex();
		if (index < 0) return;
		const incoming = queueRef.current[index];
		const transition = effectiveAudioTransitionForTrack(incoming);
		setTransitionMode(transition.mode); transitionModeRef.current = transition.mode;
		setCrossfadeSeconds(transition.seconds); crossfadeSecondsRef.current = transition.seconds;
		if (transition.mode === "crossfade" && !getDeck(activeDeckRef.current)?.paused) beginCrossfade(index, transition.seconds);
		else activateIndex(index);
	}, [activateIndex, beginCrossfade, chooseNextIndex, effectiveAudioTransitionForTrack, getDeck]);

	const previous = useCallback(() => {
		if (activeAdRef.current) return;
		const audio = getDeck(activeDeckRef.current);
		if (audio && audio.currentTime > 3) { audio.currentTime = 0; return; }
		let index = -1;
		while (playbackHistoryRef.current.length && index < 0) {
			const candidate = playbackHistoryRef.current.pop() ?? -1;
			if (candidate >= 0 && candidate < queueRef.current.length) index = candidate;
		}
		if (index < 0 && queueIndexRef.current > 0) index = queueIndexRef.current - 1;
		if (index >= 0) activateIndex(index);
		else if (audio) audio.currentTime = 0;
	}, [activateIndex, getDeck]);

	const canPrevious = !activeAd && (queue.length > 1 || (audioRef.current?.currentTime ?? 0) > 0);
	const canNext = !activeAd && queue.length > 1 && (shuffle || queueIndex < queue.length - 1 || repeatMode === "all");
	const cycleRepeat = useCallback(() => setRepeatMode((mode) => mode === "off" ? "all" : mode === "all" ? "one" : "off"), []);
	const toggleShuffle = useCallback(() => setShuffle((value) => { shuffleBagRef.current = []; shuffleCycleRef.current = 0; plannedNextIndexRef.current = -1; return !value; }), []);
	const patchCurrent = useCallback((patch: Partial<WorldTrack>) => setCurrent((cur) => cur ? { ...cur, ...patch } : cur), []);
	const cancelCrossfade = useCallback((resetActive = false) => {
		crossfadeBusyRef.current = false;
		crossfadeProgressRef.current = 0;
		setCrossfading(false);
		const baseVolume = storedVolume();
		const active = activeDeckRef.current;
		for (const deck of ["a", "b"] as const) {
			const audio = getDeck(deck);
			if (!audio) continue;
			audio.pause();
			audio.volume = baseVolume;
			if (deck !== active || resetActive) audio.currentTime = 0;
		}
	}, [getDeck]);
	const pause = useCallback(() => {
		if (activeAdRef.current) adAudioRef.current?.pause();
		else cancelCrossfade(false);
		setPlaying(false);
	}, [cancelCrossfade]);
	const stop = useCallback(() => {
		if (activeAdRef.current) {
			const adAudio = adAudioRef.current;
			if (adAudio) { adAudio.pause(); adAudio.currentTime = 0; }
			activeAdRef.current = null; setActiveAd(null); pendingAfterAdIndexRef.current = -1;
		}
		cancelCrossfade(true); setPlaying(false);
	}, [cancelCrossfade]);
	const seek = useCallback((seconds: number) => {
		if (activeAdRef.current) return;
		const audio = getDeck(activeDeckRef.current);
		if (audio) audio.currentTime = Math.max(0, Math.min(Number.isFinite(audio.duration) ? audio.duration : seconds, seconds));
	}, [getDeck]);
	const toggle = useCallback(() => {
		const audio = activeAdRef.current ? adAudioRef.current : getDeck(activeDeckRef.current);
		if (!audio || (!activeAdRef.current && !currentRef.current)) return;
		if (audio.paused) { requestWorldPlayback(); void audio.play().catch(() => {}); } else pause();
	}, [requestWorldPlayback, getDeck, pause]);

	// One authoritative World transport command surface. Visuals, the World player UI,
	// and future remote/broadcast controls all drive the same audio elements through here.
	useEffect(() => {
		const onCommand = (event: Event) => {
			const command = (event as CustomEvent<WorldTransportCommand>).detail;
			if (!command) return;
			if (command.type === "previous") { previous(); return; }
			if (command.type === "next") { next(); return; }
			if (command.type === "stop") { stop(); return; }
			if (command.type === "pause") { pause(); return; }
			if (command.type === "seek") { seek(command.seconds); return; }
			if (command.type === "toggle") { toggle(); return; }
			const adAudio = adAudioRef.current;
			if (command.type === "play" && activeAdRef.current && adAudio?.paused) {
				requestWorldPlayback();
				void adAudio.play().catch(() => setPlaying(false));
				return;
			}
			const audio = getDeck(activeDeckRef.current);
			const track = currentRef.current;
			if (command.type === "play" && audio && track && audio.paused) {
				const url = worldAudioUrl(track.id);
				const absolute = new URL(url, window.location.origin).href;
				if (audio.src !== absolute) audio.src = url;
				requestWorldPlayback();
				void audio.play().catch(() => setPlaying(false));
			}
		};
		window.addEventListener(WORLD_TRANSPORT_COMMAND_EVENT, onCommand as EventListener);
		return () => window.removeEventListener(WORLD_TRANSPORT_COMMAND_EVENT, onCommand as EventListener);
	}, [getDeck, next, pause, previous, requestWorldPlayback, seek, stop, toggle]);

	const handleEnded = useCallback((deck: "a" | "b") => {
		if (deck !== activeDeckRef.current || crossfadeBusyRef.current || activeAdRef.current) return;
		const audio = getDeck(deck);
		flushListenProgress(true, false);
		if (repeatRef.current === "one" && audio) {
			// A completed repeat is a new listen event, just like manually replaying it.
			const track = currentRef.current;
			if (track) countAndSelect(track);
			audio.currentTime = 0; void audio.play().catch(() => setPlaying(false)); return;
		}
		const completedSeconds = Math.max(0, Number.isFinite(audio?.duration) ? Number(audio?.duration) : Number(audio?.currentTime) || 0);
		const index = chooseNextIndex();
		if (index < 0) {
			adSessionRef.current = noteCompletedMusicTrack(adSessionRef.current, completedSeconds);
			setPlaying(false);
			return;
		}
		void (async () => {
			const adStarted = await tryBeginAdBreak(index, completedSeconds);
			if (adStarted) return;
			const incoming = queueRef.current[index];
			if (!incoming) return;
			const transition = effectiveAudioTransitionForTrack(incoming);
			setTransitionMode(transition.mode); transitionModeRef.current = transition.mode;
			setCrossfadeSeconds(transition.seconds); crossfadeSecondsRef.current = transition.seconds;
			if (transition.mode === "gapless") {
				const toDeck = otherDeck(deck); const nextAudio = getDeck(toDeck);
				if (nextAudio) {
					const url = worldAudioUrl(incoming.id); if (nextAudio.src !== new URL(url, window.location.origin).href) nextAudio.src = url;
					activateIndex(index, toDeck); return;
				}
			}
			activateIndex(index, deck);
		})();
	}, [activateIndex, chooseNextIndex, countAndSelect, effectiveAudioTransitionForTrack, flushListenProgress, getDeck, tryBeginAdBreak]);

	const handleAdEnded = useCallback(() => {
		const index = pendingAfterAdIndexRef.current;
		pendingAfterAdIndexRef.current = -1;
		activeAdRef.current = null;
		setActiveAd(null);
		const adAudio = adAudioRef.current;
		if (adAudio) { adAudio.pause(); adAudio.currentTime = 0; }
		if (index >= 0 && index < queueRef.current.length) {
			setTransitionMode("regular"); transitionModeRef.current = "regular";
			activateIndex(index);
		} else setPlaying(false);
	}, [activateIndex]);

	useEffect(() => {
		const timer = window.setInterval(() => {
			if (crossfadeBusyRef.current) return;
			const audio = getDeck(activeDeckRef.current);
			if (!audio || audio.paused || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
			const index = chooseNextIndex(); if (index < 0) return;
			const incoming = queueRef.current[index];
			const transition = effectiveAudioTransitionForTrack(incoming);
			if (transition.mode !== "crossfade") return;
			const remaining = audio.duration - audio.currentTime;
			if (remaining <= transition.seconds) {
				const settings = advertisingSettingsRef.current;
				const hasPotentialAd = settings.providerId !== "house" || settings.fallbackProviderId !== "house" || settings.houseCreatives.some((creative) => creative.enabled && !!creative.audioUrl);
				if (queueKindRef.current === "radio" && hasPotentialAd && isAdDue(settings, adSessionRef.current, programIdRef.current, Date.now(), audio.duration, 1, queueKindRef.current)) return;
				setTransitionMode("crossfade"); transitionModeRef.current = "crossfade";
				setCrossfadeSeconds(transition.seconds); crossfadeSecondsRef.current = transition.seconds;
				beginCrossfade(index, transition.seconds, audio.duration);
			}
		}, 100);
		return () => window.clearInterval(timer);
	}, [beginCrossfade, chooseNextIndex, effectiveAudioTransitionForTrack, getDeck]);

	useEffect(() => {
		const timer = window.setInterval(() => {
			if (getPlaybackOwner() !== "world") return;
			const track = currentRef.current;
			const activeProgram = activeProgramRef.current;
			const broadcastBranding = activeProgram?.branding || activeGlobalsRef.current.branding;
			const broadcastTiming = activeProgram?.timing || activeGlobalsRef.current.timing;
			const ad = activeAdRef.current;
			const adAudio = adAudioRef.current;
			if (ad && adAudio) {
				const nextIndex = pendingAfterAdIndexRef.current;
				const nextTrack = nextIndex >= 0 ? queueRef.current[nextIndex] : undefined;
				const presentation = advertisingSettingsRef.current.presentation;
				const visualTransport = {
					source: "world" as const,
					playing: !adAudio.paused,
					positionSeconds: adAudio.currentTime || 0,
					durationSeconds: Number.isFinite(adAudio.duration) ? adAudio.duration : (ad.creative.durationSeconds || 0),
					playlistId: queueIdRef.current || undefined,
					playlistName: queueLabel || undefined,
					broadcastProgramId: programIdRef.current || undefined,
					broadcastProgramName: activeProgram?.name || queueLabel || undefined,
					broadcastKind: queueKindRef.current,
					broadcastBranding,
					broadcastTiming,
					transitionMode: "regular" as const,
					audioTransitionProgress: 0,
					transitionProgress: visualTransitionProgressRef.current,
					transitionSequence: transitionSequenceRef.current,
					visualTransition: visualTransitionRef.current,
					visualTransitionSeconds: visualTransitionSecondsRef.current,
					visualSceneId: activeVisualSceneIdRef.current || undefined,
					visualSceneName: activeVisualSceneNameRef.current || undefined,
					nextTrackId: nextTrack?.id,
					nextTitle: nextTrack?.title,
					nextArtist: nextTrack?.artistName,
					nextAlbum: nextTrack?.albumName,
					adBreakActive: true,
					adPresentationEnabled: presentation.enabled,
					adShowSponsor: presentation.showSponsor,
					adCreativeId: ad.creative.id,
					adProviderId: ad.providerId,
					adTitle: presentation.label || ad.creative.title || "Ad Break",
					adSponsor: presentation.showSponsor ? ad.creative.sponsor : undefined,
					adPositionSeconds: adAudio.currentTime || 0,
					adDurationSeconds: Number.isFinite(adAudio.duration) ? adAudio.duration : (ad.creative.durationSeconds || 0),
					updatedAt: Date.now(),
				};
				publishLocalVisualTransport(visualTransport);
				void bridgeApi.setVisualTransport(visualTransport).catch(() => {});
				return;
			}

			const audio = getDeck(activeDeckRef.current);
			if (!track || !audio) return;
			const nextIndex = chooseNextIndex();
			const nextTrack = nextIndex >= 0 ? queueRef.current[nextIndex] : undefined;
			const visualTransport = {
				source: "world" as const,
				playing: !audio.paused,
				positionSeconds: audio.currentTime || 0,
				durationSeconds: Number.isFinite(audio.duration) ? audio.duration : (track.durationSeconds || 0),
				trackId: track.id,
				title: track.title,
				artist: track.artistName,
				album: track.albumName,
				playlistId: queueIdRef.current || undefined,
				playlistName: queueLabel || undefined,
				broadcastProgramId: programIdRef.current || undefined,
				broadcastProgramName: activeProgram?.name || queueLabel || undefined,
				broadcastKind: queueKindRef.current,
				broadcastBranding,
				broadcastTiming,
				transitionMode: transitionModeRef.current,
				audioTransitionProgress: crossfadeProgressRef.current,
				transitionProgress: visualTransitionProgressRef.current,
				transitionSequence: transitionSequenceRef.current,
				visualTransition: visualTransitionRef.current,
				visualTransitionSeconds: visualTransitionSecondsRef.current,
				visualSceneId: activeVisualSceneIdRef.current || undefined,
				visualSceneName: activeVisualSceneNameRef.current || undefined,
				nextTrackId: nextTrack?.id,
				nextTitle: nextTrack?.title,
				nextArtist: nextTrack?.artistName,
				nextAlbum: nextTrack?.albumName,
				adBreakActive: false,
				updatedAt: Date.now(),
			};
			publishLocalVisualTransport(visualTransport);
			void bridgeApi.setVisualTransport(visualTransport).catch(() => {});
		}, 100);
		return () => window.clearInterval(timer);
	}, [chooseNextIndex, getDeck, queueLabel]);

	useEffect(() => {
		const inactive = getDeck(otherDeck(activeDeckRef.current));
		if (!inactive) return;
		const nextIndex = chooseNextIndex();
		if (nextIndex < 0) return;
		const nextTrack = queue[nextIndex];
		if (!nextTrack) return;
		const transition = effectiveAudioTransitionForTrack(nextTrack);
		if (transition.mode === "regular") return;
		const url = worldAudioUrl(nextTrack.id);
		if (inactive.src !== new URL(url, window.location.origin).href) { inactive.src = url; inactive.preload = "auto"; }
	}, [chooseNextIndex, effectiveAudioTransitionForTrack, getDeck, queue, queueIndex]);

	useEffect(() => {
		const onProgram = (event: Event) => {
			const raw = (event as CustomEvent<VisualBroadcastProgram>).detail;
			const incomingId = raw?.programId || raw?.playlistId || "";
			if (!raw || !incomingId || incomingId !== programIdRef.current) return;
			const detail = normalizeVisualBroadcastProgram(raw, incomingId, { playlistId: queueIdRef.current, kind: queueKindRef.current, name: queueLabel });
			activeProgramRef.current = detail;
			plannedNextIndexRef.current = -1; shuffleBagRef.current = []; shuffleCycleRef.current = 0;
			setTransitionMode(detail.audioTransition); transitionModeRef.current = detail.audioTransition;
			const seconds = Math.max(0.5, Math.min(20, detail.crossfadeSeconds || 5)); setCrossfadeSeconds(seconds); crossfadeSecondsRef.current = seconds;
			setVisualTransition(detail.visualTransition || "fade"); visualTransitionRef.current = detail.visualTransition || "fade";
			setVisualTransitionSeconds(detail.visualTransitionSeconds); visualTransitionSecondsRef.current = detail.visualTransitionSeconds;
			setShuffle(!!detail.shuffle); shuffleRef.current = !!detail.shuffle;
			avoidRecentRef.current = Math.max(0, Math.min(100, detail.avoidRecent || 0));
			visualAvoidRecentRef.current = Math.max(0, Math.min(50, detail.visualAvoidRecent || 0));
			setRepeatMode(detail.repeatMode); repeatRef.current = detail.repeatMode;
			void refreshVisualLibrary().then(() => { if (currentRef.current) void applyVisualForTrack(currentRef.current, detail.programId); });
		};
		window.addEventListener("ysong:world-broadcast-program", onProgram as EventListener);
		return () => window.removeEventListener("ysong:world-broadcast-program", onProgram as EventListener);
	}, [applyVisualForTrack, queueLabel, refreshVisualLibrary]);

	useEffect(() => {
		const onGlobals = (event: Event) => {
			const raw = (event as CustomEvent<VisualBroadcastGlobals>).detail;
			if (!raw) return;
			activeGlobalsRef.current = normalizeVisualBroadcastGlobals(raw);
			if (currentRef.current) void applyVisualForTrack(currentRef.current, programIdRef.current);
		};
		window.addEventListener("ysong:world-broadcast-globals", onGlobals as EventListener);
		return () => window.removeEventListener("ysong:world-broadcast-globals", onGlobals as EventListener);
	}, [applyVisualForTrack]);

	useEffect(() => {
		const onAdvertising = (event: Event) => {
			const raw = (event as CustomEvent<VisualAdvertisingSettings>).detail;
			if (!raw) return;
			advertisingSettingsRef.current = normalizeVisualAdvertisingSettings(raw);
		};
		window.addEventListener("ysong:world-advertising-settings", onAdvertising as EventListener);
		return () => window.removeEventListener("ysong:world-advertising-settings", onAdvertising as EventListener);
	}, []);

	useEffect(() => () => { if (visualTransitionRafRef.current != null) cancelAnimationFrame(visualTransitionRafRef.current); }, []);

	const value = useMemo<WorldPlayerContextValue>(() => ({
		current, playing, audioRef, queue, queueLabel, queueId, programId, queueKind, playTrack, startQueue, next, previous, canNext, canPrevious,
		repeatMode, cycleRepeat, shuffle, toggleShuffle, transitionMode, crossfadeSeconds, visualTransition, visualTransitionSeconds, crossfading, pause, stop, seek, toggle, patchCurrent,
		adBreakActive: !!activeAd, adTitle: advertisingSettingsRef.current.presentation.label || activeAd?.creative.title || "Ad Break", adSponsor: activeAd?.creative.sponsor || "",
	}), [activeAd, current, playing, audioRef, queue, queueLabel, queueId, programId, queueKind, playTrack, startQueue, next, previous, canNext, canPrevious, repeatMode, cycleRepeat, shuffle, toggleShuffle, transitionMode, crossfadeSeconds, visualTransition, visualTransitionSeconds, crossfading, pause, stop, seek, toggle, patchCurrent]);

	const onPlay = (deck: "a" | "b") => {
		if (deck === activeDeckRef.current) { claimPlaybackOwner("world"); setPlaying(true); startListenClock(); }
	};
	const onPause = (deck: "a" | "b") => {
		if (deck === activeDeckRef.current && !crossfadeBusyRef.current) { setPlaying(false); flushListenProgress(false, false); }
	};

	return (
		<WorldPlayerContext.Provider value={value}>
			{children}
			<audio ref={audioARef} onPlay={() => onPlay("a")} onPause={() => onPause("a")} onEnded={() => handleEnded("a")} />
			<audio ref={audioBRef} onPlay={() => onPlay("b")} onPause={() => onPause("b")} onEnded={() => handleEnded("b")} />
			<audio ref={adAudioRef} onPlay={() => { claimPlaybackOwner("world"); setPlaying(true); }} onPause={() => { if (activeAdRef.current && !adAudioRef.current?.ended) setPlaying(false); }} onEnded={handleAdEnded} />
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
	const { current, playing, toggle, audioRef, queueLabel, next, previous, canNext, canPrevious, repeatMode, cycleRepeat, shuffle, toggleShuffle, crossfading, patchCurrent, adBreakActive, adTitle, adSponsor } = useWorldPlayer();
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
		if (!audio || crossfading) return;
		audio.volume = volume;
		audio.muted = muted;
		try { localStorage.setItem("ysong:world-volume", String(volume)); } catch { /* best-effort local UI action */ }
	}, [audio, volume, muted, crossfading]);

	useEffect(() => {
		setSaveMenu(false);
		setPlaylistDialog(null);
	}, [current?.id, adBreakActive]);

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
				<NowPlaying current={current} queueLabel={queueLabel} adBreakActive={adBreakActive} adTitle={adTitle} adSponsor={adSponsor} />
				<div className="min-w-0">
					<div className="flex items-center justify-center gap-2 mb-1">
						<IconButton onClick={previous} disabled={!canPrevious && time <= 3} title="Previous"><PreviousIcon /></IconButton>
						<button onClick={toggle} className="h-9 w-9 rounded-full bg-white text-black grid place-items-center hover:scale-105 transition-transform" title={playing ? "Pause" : "Play"} aria-label={playing ? "Pause" : "Play"}>{playing ? <PauseIcon /> : <PlayIcon />}</button>
						<IconButton onClick={next} disabled={!canNext} title="Next"><NextIcon /></IconButton>
						<IconButton onClick={cycleRepeat} title={repeatTitle} active={repeatMode !== "off"}><RepeatIcon one={repeatMode === "one"} /></IconButton>
						<IconButton onClick={toggleShuffle} title={shuffle ? "Shuffle on" : "Shuffle off"} active={shuffle}><ShuffleIcon /></IconButton>
					</div>
					<SeekBar audio={audio} time={time} duration={duration} disabled={adBreakActive} />
				</div>
				<div className="relative flex items-center justify-end gap-0.5">
					<IconButton disabled={adBreakActive} onClick={() => react(1)} title={current.myReaction === 1 ? "Remove like" : "Like"} active={current.myReaction === 1}><ThumbUpIcon /></IconButton>
					<IconButton disabled={adBreakActive} onClick={() => react(-1)} title={current.myReaction === -1 ? "Remove dislike" : "Dislike"} active={current.myReaction === -1}><ThumbDownIcon /></IconButton>
					<IconButton disabled={adBreakActive} onClick={saveCurrent} title={current.isSaved ? "Remove from saved songs" : "Save song"} active={current.isSaved}><HeartIcon filled={current.isSaved} /></IconButton>
					<IconButton disabled={adBreakActive} onClick={openSaveMenu} title="Save and playlist options" active={saveMenu}><PlusIcon /></IconButton>
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
					<NowPlaying current={current} queueLabel={queueLabel} compact adBreakActive={adBreakActive} adTitle={adTitle} adSponsor={adSponsor} />
					<div className="ml-auto relative flex items-center gap-0.5">
						<IconButton disabled={adBreakActive} onClick={() => react(1)} title="Like" active={current.myReaction === 1}><ThumbUpIcon /></IconButton>
						<IconButton disabled={adBreakActive} onClick={() => react(-1)} title="Dislike" active={current.myReaction === -1}><ThumbDownIcon /></IconButton>
						<IconButton disabled={adBreakActive} onClick={saveCurrent} title="Save song" active={current.isSaved}><HeartIcon filled={current.isSaved} /></IconButton>
						<IconButton disabled={adBreakActive} onClick={openSaveMenu} title="More save options" active={saveMenu}><PlusIcon /></IconButton>
						{saveMenu && <SaveMenu current={current} playlists={playlists} loading={menuLoading} onSaveRelease={saveRelease} onFavoriteArtist={favoriteArtist} onNewPlaylist={openNewPlaylist} onExistingPlaylist={openExistingPlaylist} onClose={() => setSaveMenu(false)} />}
					</div>
				</div>
				<div className="flex items-center justify-center gap-4 -mt-1">
					<IconButton onClick={previous} disabled={!canPrevious && time <= 3} title="Previous"><PreviousIcon /></IconButton>
					<button onClick={toggle} className="h-10 w-10 rounded-full bg-white text-black grid place-items-center" aria-label={playing ? "Pause" : "Play"}>{playing ? <PauseIcon /> : <PlayIcon />}</button>
					<IconButton onClick={next} disabled={!canNext} title="Next"><NextIcon /></IconButton>
					<IconButton onClick={cycleRepeat} title={repeatTitle} active={repeatMode !== "off"}><RepeatIcon one={repeatMode === "one"} /></IconButton>
					<IconButton onClick={toggleShuffle} title={shuffle ? "Shuffle on" : "Shuffle off"} active={shuffle}><ShuffleIcon /></IconButton>
				</div>
				<SeekBar audio={audio} time={time} duration={duration} compact disabled={adBreakActive} />
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

function NowPlaying({ current, queueLabel, compact = false, adBreakActive = false, adTitle = "Ad Break", adSponsor = "" }: { current: WorldTrack; queueLabel: string; compact?: boolean; adBreakActive?: boolean; adTitle?: string; adSponsor?: string }) {
	return <div className={`min-w-0 flex items-center gap-2.5 ${compact ? "flex-1" : ""}`}>
		{adBreakActive
			? <div className={`${compact ? "h-10 w-10" : "h-12 w-12"} shrink-0 rounded-lg border border-amber-400/20 bg-amber-500/10 grid place-items-center text-[10px] font-black tracking-widest text-amber-200`}>AD</div>
			: current.hasArtwork ? <img src={worldArtworkUrl(current.id)} alt="" className={`${compact ? "h-10 w-10" : "h-12 w-12"} shrink-0 rounded-lg object-cover bg-neutral-900`} /> : <div className={`${compact ? "h-10 w-10" : "h-12 w-12"} shrink-0 rounded-lg bg-neutral-900 grid place-items-center text-neutral-600`}>♪</div>}
		<div className="min-w-0"><div className="font-medium text-sm truncate">{adBreakActive ? adTitle : current.title}</div><div className="text-xs text-neutral-500 truncate">{adBreakActive ? (adSponsor || "Sponsored message") : current.artistName}</div>{queueLabel && !compact && <div className="text-[10px] text-neutral-600 truncate">{queueLabel}</div>}</div>
	</div>;
}

function SeekBar({ audio, time, duration, compact = false, disabled = false }: { audio: HTMLAudioElement | null; time: number; duration: number; compact?: boolean; disabled?: boolean }) {
	return <div className={`flex items-center gap-2 ${compact ? "mt-1" : ""}`}>
		<span className="text-[10px] tabular-nums text-neutral-500 w-8 text-right">{durationLabel(time)}</span>
		<input aria-label="Seek" disabled={disabled} type="range" min={0} max={duration || 1} step="0.1" value={Math.min(time, duration || 1)} onChange={(e) => { if (!disabled && audio) audio.currentTime = Number(e.target.value); }} className="ys-player-range min-w-0 flex-1 disabled:opacity-40" />
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
function ShuffleIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 3h5v5"/><path d="m4 20 5-5"/><path d="M21 3l-7 7"/><path d="m15 15 6 6"/><path d="M21 16v5h-5"/><path d="M4 4l5 5"/></svg>; }
function RepeatIcon({ one }: { one: boolean }) { return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>{one && <text x="10" y="15" fontSize="9" fill="currentColor" stroke="none" fontWeight="700">1</text>}</svg>; }
function ThumbUpIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 10v12H3V10h4Zm0 10h10.2a2 2 0 0 0 1.95-1.55l1.55-7A2 2 0 0 0 18.75 9H14l.7-3.5A3 3 0 0 0 11.75 2L7 10Z"/></svg>; }
function ThumbDownIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 14V2h4v12h-4Zm0-10H6.8a2 2 0 0 0-1.95 1.55l-1.55 7A2 2 0 0 0 5.25 15H10l-.7 3.5A3 3 0 0 0 12.25 22L17 14Z"/></svg>; }
function HeartIcon({ filled }: { filled: boolean }) { return <svg width="17" height="17" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/></svg>; }
function PlusIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>; }
function VolumeIcon({ mode }: { mode: "mute" | "low" | "high" }) { return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5Z"/>{mode === "mute" ? <><path d="m19 9-6 6"/><path d="m13 9 6 6"/></> : <><path d="M15.5 8.5a5 5 0 0 1 0 7"/>{mode === "high" && <path d="M18 6a8.5 8.5 0 0 1 0 12"/>}</>}</svg>; }
