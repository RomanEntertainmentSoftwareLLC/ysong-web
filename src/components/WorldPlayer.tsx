/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { bridgeApi, normalizeVisualBroadcastProgram, type VisualBroadcastProgram, type VisualScenePreset } from "../lib/bridgeApi";
import { startVisualAnalysisForMediaElement } from "../lib/browserVisualAudio";
import { normalizeVisualScene, type VisualSceneState } from "../lib/visualsScene";
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
type WorldTransitionMode = "regular" | "gapless" | "crossfade";
type WorldVisualTransition = "cut" | "fade" | "black" | "flash";

type WorldPlayerContextValue = {
	current: WorldTrack | null;
	playing: boolean;
	audioRef: RefObject<HTMLAudioElement | null>;
	queue: WorldTrack[];
	queueLabel: string;
	queueId: string;
	playTrack: (track: WorldTrack) => void;
	startQueue: (tracks: WorldTrack[], label: string, startTrackId?: string, queueId?: string) => void;
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

const DEFAULT_BROADCAST_PROGRAM = (playlistId: string): VisualBroadcastProgram => normalizeVisualBroadcastProgram(null, playlistId);

export function WorldPlayerProvider({ children }: { children: ReactNode }) {
	const [current, setCurrent] = useState<WorldTrack | null>(null);
	const [playing, setPlaying] = useState(false);
	const [queue, setQueue] = useState<WorldTrack[]>([]);
	const [queueIndex, setQueueIndex] = useState(-1);
	const [queueLabel, setQueueLabel] = useState("");
	const [queueId, setQueueId] = useState("");
	const [repeatMode, setRepeatMode] = useState<RepeatMode>(() => storedRepeatMode());
	const [shuffle, setShuffle] = useState(() => storedShuffle());
	const [transitionMode, setTransitionMode] = useState<WorldTransitionMode>("regular");
	const [crossfadeSeconds, setCrossfadeSeconds] = useState(5);
	const [visualTransition, setVisualTransition] = useState<WorldVisualTransition>("fade");
	const [visualTransitionSeconds, setVisualTransitionSeconds] = useState(1.4);
	const [crossfading, setCrossfading] = useState(false);
	const [activeDeck, setActiveDeck] = useState<"a" | "b">("a");
	const audioARef = useRef<HTMLAudioElement | null>(null);
	const audioBRef = useRef<HTMLAudioElement | null>(null);
	const activeDeckRef = useRef<"a" | "b">("a");
	const queueRef = useRef<WorldTrack[]>([]);
	const queueIndexRef = useRef(-1);
	const currentRef = useRef<WorldTrack | null>(null);
	const queueIdRef = useRef("");
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
	const crossfadeBusyRef = useRef(false);
	const crossfadeProgressRef = useRef(0);
	const transitionSequenceRef = useRef(0);
	const activeProgramRef = useRef<VisualBroadcastProgram | null>(null);
	const visualLibraryRef = useRef<VisualScenePreset<VisualSceneState>[]>([]);
	const activeVisualSceneIdRef = useRef("");
	const activeVisualSceneNameRef = useRef("");
	const audioRef = activeDeck === "a" ? audioARef : audioBRef;

	useEffect(() => { activeDeckRef.current = activeDeck; }, [activeDeck]);
	useEffect(() => { queueRef.current = queue; }, [queue]);
	useEffect(() => { queueIndexRef.current = queueIndex; }, [queueIndex]);
	useEffect(() => { currentRef.current = current; }, [current]);
	useEffect(() => { queueIdRef.current = queueId; }, [queueId]);
	useEffect(() => { transitionModeRef.current = transitionMode; }, [transitionMode]);
	useEffect(() => { crossfadeSecondsRef.current = crossfadeSeconds; }, [crossfadeSeconds]);
	useEffect(() => { visualTransitionRef.current = visualTransition; }, [visualTransition]);
	useEffect(() => { visualTransitionSecondsRef.current = visualTransitionSeconds; }, [visualTransitionSeconds]);
	useEffect(() => { shuffleRef.current = shuffle; try { localStorage.setItem("ysong:world-shuffle", shuffle ? "1" : "0"); } catch {} }, [shuffle]);
	useEffect(() => { repeatRef.current = repeatMode; try { localStorage.setItem("ysong:world-repeat", repeatMode); } catch {} }, [repeatMode]);

	const getDeck = useCallback((deck: "a" | "b") => deck === "a" ? audioARef.current : audioBRef.current, []);
	const otherDeck = (deck: "a" | "b") => deck === "a" ? "b" as const : "a" as const;

	useEffect(() => {
		const stops: Array<() => void> = [];
		if (audioARef.current) stops.push(startVisualAnalysisForMediaElement(audioARef.current));
		if (audioBRef.current) stops.push(startVisualAnalysisForMediaElement(audioBRef.current));
		return () => stops.forEach((stopAnalysis) => stopAnalysis());
	}, []);

	const claimWorldPlayback = useCallback(() => { window.dispatchEvent(new Event("ysong:world-play-request")); }, []);

	useEffect(() => {
		const onDawPlay = () => { audioARef.current?.pause(); audioBRef.current?.pause(); };
		window.addEventListener("ysong:daw-play-request", onDawPlay);
		return () => window.removeEventListener("ysong:daw-play-request", onDawPlay);
	}, []);

	const countAndSelect = useCallback((track: WorldTrack) => {
		setCurrent(track);
		currentRef.current = track;
		recentIdsRef.current = [track.id, ...recentIdsRef.current.filter((id) => id !== track.id)].slice(0, Math.max(4, avoidRecentRef.current));
		countWorldPlay(track.id)
			.then((r) => {
				setCurrent((cur) => cur?.id === track.id ? { ...cur, playCount: r.playCount } : cur);
				window.dispatchEvent(new CustomEvent("ysong:world-play-count", { detail: { trackId: track.id, playCount: r.playCount } }));
			})
			.catch(() => {});
	}, []);

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

	const effectiveAudioTransitionForTrack = useCallback((track: WorldTrack) => {
		const program = activeProgramRef.current;
		const assignment = program?.trackAssignments?.[track.id];
		return {
			mode: (assignment?.audioTransition || program?.audioTransition || transitionModeRef.current || "regular") as WorldTransitionMode,
			seconds: Math.max(0.5, Math.min(20, Number(assignment?.crossfadeSeconds ?? program?.crossfadeSeconds ?? crossfadeSecondsRef.current) || 5)),
		};
	}, []);

	const applyVisualForTrack = useCallback(async (track: WorldTrack, playlistId = queueIdRef.current) => {
		try {
			let scene: VisualSceneState | null = null;
			let sceneId = "";
			let sceneName = "";
			let transition: WorldVisualTransition = visualTransitionRef.current;
			let transitionSeconds = visualTransitionSecondsRef.current;
			if (playlistId) {
				const rawProgram = activeProgramRef.current?.playlistId === playlistId ? activeProgramRef.current : await bridgeApi.getVisualProgram(playlistId).catch(() => DEFAULT_BROADCAST_PROGRAM(playlistId));
				const program = normalizeVisualBroadcastProgram(rawProgram, playlistId);
				activeProgramRef.current = program;
				const assignment = program.trackAssignments[track.id];
				transition = assignment?.visualTransition || program.visualTransition || "fade";
				transitionSeconds = Math.max(0.1, Math.min(12, Number(assignment?.visualTransitionSeconds ?? program.visualTransitionSeconds) || 1.4));
				const ids = assignment?.sceneIds?.length ? assignment.sceneIds : program.albumDefaults[track.albumName]?.length ? program.albumDefaults[track.albumName] : program.defaultSceneIds;
				if (ids?.length) {
					const library = visualLibraryRef.current.length ? visualLibraryRef.current : await refreshVisualLibrary();
					const available = ids.filter((id) => library.some((item) => item.id === id));
					if (available.length) {
						const recent = new Set(recentVisualIdsRef.current.slice(0, visualAvoidRecentRef.current));
						let candidates = available.filter((id) => !recent.has(id));
						if (!candidates.length) candidates = available.filter((id) => id !== activeVisualSceneIdRef.current);
						if (!candidates.length) candidates = available;
						sceneId = candidates[Math.floor(Math.random() * candidates.length)] || available[0];
						const preset = library.find((item) => item.id === sceneId);
						if (preset) { scene = normalizeVisualScene(preset.scene); sceneName = preset.name; }
						recentVisualIdsRef.current = [sceneId, ...recentVisualIdsRef.current.filter((id) => id !== sceneId)].slice(0, Math.max(4, visualAvoidRecentRef.current + 2));
					}
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
	}, [refreshVisualLibrary, runVisualSceneTransition]);

	const loadProgram = useCallback(async (playlistId: string): Promise<VisualBroadcastProgram | null> => {
		if (!playlistId) { activeProgramRef.current = null; visualLibraryRef.current = []; return null; }
		let program: VisualBroadcastProgram;
		try { program = normalizeVisualBroadcastProgram(await bridgeApi.getVisualProgram(playlistId), playlistId); }
		catch { program = DEFAULT_BROADCAST_PROGRAM(playlistId); }
		activeProgramRef.current = program;
		void refreshVisualLibrary();
		setTransitionMode(program.audioTransition); transitionModeRef.current = program.audioTransition;
		const seconds = Math.max(0.5, Math.min(20, program.crossfadeSeconds || 5)); setCrossfadeSeconds(seconds); crossfadeSecondsRef.current = seconds;
		setVisualTransition(program.visualTransition || "fade"); visualTransitionRef.current = program.visualTransition || "fade";
		setVisualTransitionSeconds(program.visualTransitionSeconds); visualTransitionSecondsRef.current = program.visualTransitionSeconds;
		setShuffle(!!program.shuffle); shuffleRef.current = !!program.shuffle;
		avoidRecentRef.current = Math.max(0, Math.min(100, program.avoidRecent));
		visualAvoidRecentRef.current = Math.max(0, Math.min(50, program.visualAvoidRecent));
		setRepeatMode(program.repeatMode); repeatRef.current = program.repeatMode;
		return program;
	}, [refreshVisualLibrary]);

	const playOnDeck = useCallback((deck: "a" | "b", track: WorldTrack, volume = storedVolume()) => {
		const audio = getDeck(deck);
		if (!audio) return false;
		const url = worldAudioUrl(track.id);
		if (audio.src !== new URL(url, window.location.origin).href) audio.src = url;
		audio.currentTime = 0;
		audio.volume = Math.max(0, Math.min(1, volume));
		claimWorldPlayback();
		void audio.play().catch(() => setPlaying(false));
		return true;
	}, [claimWorldPlayback, getDeck]);

	const chooseNextIndex = useCallback((refresh = false) => {
		const q = queueRef.current;
		const index = queueIndexRef.current;
		if (!q.length) return -1;
		const planned = plannedNextIndexRef.current;
		if (!refresh && planned >= 0 && planned < q.length && planned !== index) return planned;
		let result = -1;
		if (shuffleRef.current && q.length > 1) {
			const recent = new Set(recentIdsRef.current.slice(0, avoidRecentRef.current));
			let candidates = q.map((track, i) => ({ track, i })).filter(({ track, i }) => i !== index && !recent.has(track.id));
			if (!candidates.length) candidates = q.map((track, i) => ({ track, i })).filter(({ i }) => i !== index);
			result = candidates[Math.floor(Math.random() * candidates.length)]?.i ?? -1;
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

	const beginCrossfade = useCallback((nextIndex: number, requestedSeconds?: number) => {
		if (crossfadeBusyRef.current || nextIndex < 0 || nextIndex >= queueRef.current.length) return;
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
		claimWorldPlayback();
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
	}, [activateIndex, applyVisualForTrack, claimWorldPlayback, countAndSelect, getDeck]);

	const playTrack = useCallback((track: WorldTrack) => {
		const audio = getDeck(activeDeckRef.current);
		if (currentRef.current?.id === track.id && audio) {
			if (audio.paused) { claimWorldPlayback(); void audio.play().catch(() => {}); } else audio.pause();
			return;
		}
		setQueue([track]); queueRef.current = [track];
		setQueueIndex(0); queueIndexRef.current = 0;
		setQueueLabel(""); setQueueId(""); queueIdRef.current = "";
		countAndSelect(track); playOnDeck(activeDeckRef.current, track); transitionSequenceRef.current += 1; void applyVisualForTrack(track, "");
	}, [applyVisualForTrack, claimWorldPlayback, countAndSelect, getDeck, playOnDeck]);

	const startQueue = useCallback((tracks: WorldTrack[], label: string, startTrackId?: string, playlistId = "") => {
		const seen = new Set<string>();
		const clean = tracks.filter((track) => track?.id && !seen.has(track.id) && seen.add(track.id));
		if (!clean.length) return;
		setQueue(clean); queueRef.current = clean;
		setQueueLabel(label); setQueueId(playlistId); queueIdRef.current = playlistId;
		plannedNextIndexRef.current = -1;
		playbackHistoryRef.current = []; recentIdsRef.current = []; recentVisualIdsRef.current = [];
		const launch = async () => {
			const program = playlistId ? await loadProgram(playlistId) : null;
			let index = startTrackId ? clean.findIndex((track) => track.id === startTrackId) : 0;
			if (index < 0) index = 0;
			if (!startTrackId && program?.shuffle && clean.length > 1) index = Math.floor(Math.random() * clean.length);
			setQueueIndex(index); queueIndexRef.current = index;
			const track = clean[index];
			countAndSelect(track); playOnDeck(activeDeckRef.current, track); transitionSequenceRef.current += 1; void applyVisualForTrack(track, playlistId);
		};
		void launch();
	}, [applyVisualForTrack, countAndSelect, loadProgram, playOnDeck]);

	const next = useCallback(() => {
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

	const canPrevious = queue.length > 1 || (audioRef.current?.currentTime ?? 0) > 0;
	const canNext = queue.length > 1 && (shuffle || queueIndex < queue.length - 1 || repeatMode === "all");
	const cycleRepeat = useCallback(() => setRepeatMode((mode) => mode === "off" ? "all" : mode === "all" ? "one" : "off"), []);
	const toggleShuffle = useCallback(() => setShuffle((value) => !value), []);
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
	const pause = useCallback(() => { cancelCrossfade(false); setPlaying(false); }, [cancelCrossfade]);
	const stop = useCallback(() => { cancelCrossfade(true); setPlaying(false); }, [cancelCrossfade]);
	const seek = useCallback((seconds: number) => { const audio = getDeck(activeDeckRef.current); if (audio) audio.currentTime = Math.max(0, Math.min(Number.isFinite(audio.duration) ? audio.duration : seconds, seconds)); }, [getDeck]);
	const toggle = useCallback(() => {
		const audio = getDeck(activeDeckRef.current);
		if (!audio || !currentRef.current) return;
		if (audio.paused) { claimWorldPlayback(); void audio.play().catch(() => {}); } else pause();
	}, [claimWorldPlayback, getDeck, pause]);

	const handleEnded = useCallback((deck: "a" | "b") => {
		if (deck !== activeDeckRef.current || crossfadeBusyRef.current) return;
		const audio = getDeck(deck);
		if (repeatRef.current === "one" && audio) { audio.currentTime = 0; void audio.play().catch(() => setPlaying(false)); return; }
		const index = chooseNextIndex();
		if (index < 0) { setPlaying(false); return; }
		const incoming = queueRef.current[index];
		const transition = effectiveAudioTransitionForTrack(incoming);
		setTransitionMode(transition.mode); transitionModeRef.current = transition.mode;
		setCrossfadeSeconds(transition.seconds); crossfadeSecondsRef.current = transition.seconds;
		if (transition.mode === "gapless") {
			const toDeck = otherDeck(deck); const nextAudio = getDeck(toDeck); const track = incoming;
			if (nextAudio) {
				const url = worldAudioUrl(track.id); if (nextAudio.src !== new URL(url, window.location.origin).href) nextAudio.src = url;
				activateIndex(index, toDeck); return;
			}
		}
		activateIndex(index, deck);
	}, [activateIndex, chooseNextIndex, effectiveAudioTransitionForTrack, getDeck]);

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
				setTransitionMode("crossfade"); transitionModeRef.current = "crossfade";
				setCrossfadeSeconds(transition.seconds); crossfadeSecondsRef.current = transition.seconds;
				beginCrossfade(index, transition.seconds);
			}
		}, 100);
		return () => window.clearInterval(timer);
	}, [beginCrossfade, chooseNextIndex, effectiveAudioTransitionForTrack, getDeck]);

	useEffect(() => {
		const timer = window.setInterval(() => {
			const track = currentRef.current;
			const audio = getDeck(activeDeckRef.current);
			if (!track || !audio) return;
			const nextIndex = chooseNextIndex();
			const nextTrack = nextIndex >= 0 ? queueRef.current[nextIndex] : undefined;
			void bridgeApi.setVisualTransport({
				source: "world",
				playing: !audio.paused,
				positionSeconds: audio.currentTime || 0,
				durationSeconds: Number.isFinite(audio.duration) ? audio.duration : (track.durationSeconds || 0),
				trackId: track.id,
				title: track.title,
				artist: track.artistName,
				album: track.albumName,
				playlistId: queueIdRef.current || undefined,
				playlistName: queueLabel || undefined,
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
				updatedAt: Date.now(),
			}).catch(() => {});
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
			if (!raw || raw.playlistId !== queueIdRef.current) return;
			const detail = normalizeVisualBroadcastProgram(raw, raw.playlistId);
			activeProgramRef.current = detail;
			plannedNextIndexRef.current = -1;
			setTransitionMode(detail.audioTransition); transitionModeRef.current = detail.audioTransition;
			const seconds = Math.max(0.5, Math.min(20, detail.crossfadeSeconds || 5)); setCrossfadeSeconds(seconds); crossfadeSecondsRef.current = seconds;
			setVisualTransition(detail.visualTransition || "fade"); visualTransitionRef.current = detail.visualTransition || "fade";
			setVisualTransitionSeconds(detail.visualTransitionSeconds); visualTransitionSecondsRef.current = detail.visualTransitionSeconds;
			setShuffle(!!detail.shuffle); shuffleRef.current = !!detail.shuffle;
			avoidRecentRef.current = Math.max(0, Math.min(100, detail.avoidRecent || 0));
			visualAvoidRecentRef.current = Math.max(0, Math.min(50, detail.visualAvoidRecent || 0));
			setRepeatMode(detail.repeatMode); repeatRef.current = detail.repeatMode;
			void refreshVisualLibrary().then(() => { if (currentRef.current) void applyVisualForTrack(currentRef.current, detail.playlistId); });
		};
		window.addEventListener("ysong:world-broadcast-program", onProgram as EventListener);
		return () => window.removeEventListener("ysong:world-broadcast-program", onProgram as EventListener);
	}, [applyVisualForTrack, refreshVisualLibrary]);

	useEffect(() => () => { if (visualTransitionRafRef.current != null) cancelAnimationFrame(visualTransitionRafRef.current); }, []);

	const value = useMemo<WorldPlayerContextValue>(() => ({
		current, playing, audioRef, queue, queueLabel, queueId, playTrack, startQueue, next, previous, canNext, canPrevious,
		repeatMode, cycleRepeat, shuffle, toggleShuffle, transitionMode, crossfadeSeconds, visualTransition, visualTransitionSeconds, crossfading, pause, stop, seek, toggle, patchCurrent,
	}), [current, playing, audioRef, queue, queueLabel, queueId, playTrack, startQueue, next, previous, canNext, canPrevious, repeatMode, cycleRepeat, shuffle, toggleShuffle, transitionMode, crossfadeSeconds, visualTransition, visualTransitionSeconds, crossfading, pause, stop, seek, toggle, patchCurrent]);

	const onPlay = (deck: "a" | "b") => { if (deck === activeDeckRef.current) setPlaying(true); };
	const onPause = (deck: "a" | "b") => { if (deck === activeDeckRef.current && !crossfadeBusyRef.current) setPlaying(false); };

	return (
		<WorldPlayerContext.Provider value={value}>
			{children}
			<audio ref={audioARef} onPlay={() => onPlay("a")} onPause={() => onPause("a")} onEnded={() => handleEnded("a")} />
			<audio ref={audioBRef} onPlay={() => onPlay("b")} onPause={() => onPause("b")} onEnded={() => handleEnded("b")} />
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
	const { current, playing, toggle, audioRef, queueLabel, next, previous, canNext, canPrevious, repeatMode, cycleRepeat, shuffle, toggleShuffle, crossfading, patchCurrent } = useWorldPlayer();
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
						<IconButton onClick={toggleShuffle} title={shuffle ? "Shuffle on" : "Shuffle off"} active={shuffle}><ShuffleIcon /></IconButton>
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
					<IconButton onClick={toggleShuffle} title={shuffle ? "Shuffle on" : "Shuffle off"} active={shuffle}><ShuffleIcon /></IconButton>
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
function ShuffleIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 3h5v5"/><path d="m4 20 5-5"/><path d="M21 3l-7 7"/><path d="m15 15 6 6"/><path d="M21 16v5h-5"/><path d="M4 4l5 5"/></svg>; }
function RepeatIcon({ one }: { one: boolean }) { return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>{one && <text x="10" y="15" fontSize="9" fill="currentColor" stroke="none" fontWeight="700">1</text>}</svg>; }
function ThumbUpIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 10v12H3V10h4Zm0 10h10.2a2 2 0 0 0 1.95-1.55l1.55-7A2 2 0 0 0 18.75 9H14l.7-3.5A3 3 0 0 0 11.75 2L7 10Z"/></svg>; }
function ThumbDownIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 14V2h4v12h-4Zm0-10H6.8a2 2 0 0 0-1.95 1.55l-1.55 7A2 2 0 0 0 5.25 15H10l-.7 3.5A3 3 0 0 0 12.25 22L17 14Z"/></svg>; }
function HeartIcon({ filled }: { filled: boolean }) { return <svg width="17" height="17" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/></svg>; }
function PlusIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>; }
function VolumeIcon({ mode }: { mode: "mute" | "low" | "high" }) { return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5Z"/>{mode === "mute" ? <><path d="m19 9-6 6"/><path d="m13 9 6 6"/></> : <><path d="M15.5 8.5a5 5 0 0 1 0 7"/>{mode === "high" && <path d="M18 6a8.5 8.5 0 0 1 0 12"/>}</>}</svg>; }
