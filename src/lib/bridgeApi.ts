// In local Vite development, route Bridge calls through the same-origin
// /bridge proxy. That avoids browser CORS/Local Network Access restrictions
// around direct cross-origin loopback fetches. A production build still talks
// directly to the user's native Bridge unless VITE_BRIDGE_URL overrides it.
const configuredBridgeBase = (import.meta.env.VITE_BRIDGE_URL as string | undefined)?.trim();
const BRIDGE_BASE = configuredBridgeBase || (import.meta.env.DEV ? "/bridge" : "http://127.0.0.1:39451");

export type BridgeHealth = {
	ok: boolean;
	name: string;
	version: string;
	machineName: string;
	pluginPathCount: number;
	audioDriverType?: "ASIO" | "WASAPI" | "DirectSound" | "MME";
	selectedAudioDevice?: string | null;
	trayApp?: boolean;
	vst3ProbeReady?: boolean;
	vst3ProbeHelperPath?: string;
	midiInputCount?: number;
	enabledMidiInputCount?: number;
	midiRouteTrackId?: string | null;
	midiRouteInputName?: string | null;
	instrumentCapabilityApi?: boolean;
	instrumentCount?: number;
	instrumentSnapshotCount?: number;
};

export type BridgePlugin = {
	name: string;
	path: string;
	format: "VST3";
	kind?: "instrument" | "effect" | "unknown" | "failed" | "crashed" | "probe-missing";
	vendor?: string | null;
	version?: string | null;
	category?: string | null;
	subCategories?: string | null;
	loadable?: boolean;
	error?: string | null;
};

export type InstrumentCatalogEntry = {
	id: string;
	name: string;
	path: string;
	format: string;
	kind: string;
	vendor?: string | null;
	version?: string | null;
	category?: string | null;
	subCategories?: string | null;
	tags: string[];
	loadable: boolean;
	error?: string | null;
	savedPresetCount: number;
	discoveredPresetCount: number;
};

export type InstrumentPresetEntry = {
	id: string;
	instrumentId: string;
	name: string;
	source: "ysong-snapshot" | "external-vstpreset" | string;
	format: string;
	path?: string | null;
	loadable: boolean;
	tags: string[];
	detail?: string | null;
	updatedAt?: string | null;
};

export type InstrumentParameterEntry = {
	id: number;
	name: string;
	minValue: number;
	maxValue: number;
	defaultValue: number;
	currentValue: number;
	group: string;
	tags: string[];
};

export type InstrumentSnapshotRecord = {
	id: string;
	name: string;
	instrumentId: string;
	pluginPath: string;
	pluginName: string;
	vendor?: string | null;
	tags: string[];
	createdAt: string;
	updatedAt: string;
	hasFullState: boolean;
	parameterCount: number;
};

export type InstrumentMatchResult = {
	instrument: InstrumentCatalogEntry;
	score: number;
	matchedTerms: string[];
	bestPresets: InstrumentPresetEntry[];
};

export type Vst3MidiEvent = {
	kind: "on" | "off";
	note: number;
	velocity: number;
	whenUnixMs: number;
	noteId: number;
	channel?: number;
};



export type Vst3OfflineRenderEvent = {
	kind: "on" | "off";
	note: number;
	velocity: number;
	atSeconds: number;
	noteId: number;
	channel?: number;
};

export type Vst3OfflineRenderTrack = {
	trackId: string;
	events: Vst3OfflineRenderEvent[];
};


export type Vst3TrackEffect = {
	id: string;
	type: "compressor";
	enabled: boolean;
	inputGainDb: number;
	thresholdDb: number;
	ratio: number;
	attackMs: number;
	releaseMs: number;
	kneeDb: number;
	outputGainDb: number;
};

export type BridgeMidiInputDevice = {
	index: number;
	name: string;
	enabled: boolean;
	master: boolean;
};

export type BridgeMidiEvent = {
	kind: "noteon" | "noteoff" | "cc";
	device: string;
	deviceIndex: number;
	channel: number;
	note?: number | null;
	velocity?: number | null;
	controller?: number | null;
	value?: number | null;
	whenUnixMs: number;
};

export type BridgeMidiSettings = {
	devices: BridgeMidiInputDevice[];
	enabledInputs: string[];
	masterMode: "SelectedTrack" | "Separate";
	masterInputName?: string | null;
	routeTrackId?: string | null;
	routeInputName?: string | null;
};

export type Vst3InstanceStatus = {
	trackId: string;
	pluginName: string;
	pluginPath: string;
	peak: number;
	muted: boolean;
	level: number;
	gainReductionDb?: number;
	error?: string | null;
};


export type VisualAudioFrame = {
	sequence: number;
	timestampUnixMs: number;
	source: "browser" | "native" | "browser+native" | "idle" | string;
	rms: number;
	peak: number;
	bass: number;
	mids: number;
	highs: number;
	energy: number;
	kick: number;
	spectrum: number[];
};

export type BrowserVisualAudioFrame = Omit<VisualAudioFrame, "sequence" | "source">;


export type VisualTransportState = {
	source: "daw" | "world" | "idle" | string;
	playing: boolean;
	positionSeconds: number;
	durationSeconds: number;
	bpm?: number;
	sigNum?: number;
	sigDen?: number;
	trackId?: string;
	title?: string;
	artist?: string;
	album?: string;
	playlistId?: string;
	playlistName?: string;
	broadcastProgramId?: string;
	broadcastProgramName?: string;
	broadcastKind?: "playlist" | "radio" | "ad-hoc";
	broadcastBranding?: VisualBroadcastBranding;
	broadcastTiming?: VisualBroadcastTiming;
	transitionMode?: "regular" | "gapless" | "crossfade";
	audioTransitionProgress?: number;
	transitionProgress?: number;
	transitionSequence?: number;
	visualTransition?: "cut" | "fade" | "black" | "flash";
	visualTransitionSeconds?: number;
	visualSceneId?: string;
	visualSceneName?: string;
	nextTrackId?: string;
	nextTitle?: string;
	nextArtist?: string;
	nextAlbum?: string;
	adBreakActive?: boolean;
	adPresentationEnabled?: boolean;
	adShowSponsor?: boolean;
	adCreativeId?: string;
	adProviderId?: string;
	adTitle?: string;
	adSponsor?: string;
	adPositionSeconds?: number;
	adDurationSeconds?: number;
	updatedAt: number;
};

export type VisualRoomAudienceEffectId = "applause" | "hearts" | "confetti" | "lightning" | "fire" | "snow" | "camera-shake" | "strobe";
export type VisualRoomAudienceEffect = {
	roomId: string;
	eventId: string;
	effectId: VisualRoomAudienceEffectId;
	actorName?: string;
	timestampUnixMs: number;
};


export type VisualScenePreset<T = unknown> = {
	id: string;
	name: string;
	updatedAt: number;
	scene: T;
};

export type VisualBroadcastAssignment = {
	sceneIds: string[];
	visualTransition?: "cut" | "fade" | "black" | "flash";
	visualTransitionSeconds?: number;
	audioTransition?: "regular" | "gapless" | "crossfade";
	crossfadeSeconds?: number;
};

export type VisualBroadcastBranding = {
	enabled: boolean;
	showStationBug: boolean;
	stationLabel: string;
	showNowPlaying: boolean;
	showNextUp: boolean;
	showQueueLabel: boolean;
	bugPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
};

export type VisualBroadcastTiming = {
	nowPlayingDelaySeconds: number;
	nowPlayingHoldSeconds: number;
	nextUpLeadSeconds: number;
};

export type VisualBroadcastProgram = {
	version: 3;
	programId: string;
	playlistId: string;
	stationId?: string;
	kind: "playlist" | "radio" | "ad-hoc";
	name: string;
	defaultSceneIds: string[];
	albumDefaults: Record<string, string[]>;
	trackAssignments: Record<string, VisualBroadcastAssignment>;
	audioTransition: "regular" | "gapless" | "crossfade";
	crossfadeSeconds: number;
	visualTransition: "cut" | "fade" | "black" | "flash";
	visualTransitionSeconds: number;
	shuffle: boolean;
	avoidRecent: number;
	visualAvoidRecent: number;
	repeatMode: "off" | "all" | "one";
	branding: VisualBroadcastBranding;
	timing: VisualBroadcastTiming;
};

export type VisualBroadcastGlobals = {
	version: 1;
	defaultSceneIds: string[];
	visualAvoidRecent: number;
	branding: VisualBroadcastBranding;
	timing: VisualBroadcastTiming;
};

export type VisualAdCreative = {
	id: string;
	title: string;
	sponsor: string;
	audioUrl: string;
	audioFileName: string;
	durationSeconds: number;
	weight: number;
	enabled: boolean;
};

export type VisualVideoPrerollCreative = {
	id: string;
	title: string;
	sponsor: string;
	videoUrl: string;
	videoFileName: string;
	durationSeconds: number;
	weight: number;
	enabled: boolean;
	mutedByDefault: boolean;
};

export type VisualAdvertisingSchedule = {
	initialGraceSongs: number;
	initialGraceMinutes: number;
	minSongsBetweenAds: number;
	minMinutesBetweenAds: number;
	maxAdsPerHour: number;
	recentCreativeWindow: number;
};

export type VisualAdBreakPresentation = {
	enabled: boolean;
	sceneId: string;
	label: string;
	showSponsor: boolean;
	visualTransition: "cut" | "fade" | "black" | "flash";
	visualTransitionSeconds: number;
};

export type VisualAdvertisingProgramOverride = {
	mode: "inherit" | "enabled" | "disabled";
	minSongsBetweenAds?: number;
	minMinutesBetweenAds?: number;
	maxAdsPerHour?: number;
};

export type VisualAdvertisingPlacements = {
	radio: boolean;
	liveRoomPreroll: boolean;
};

export type VisualAdvertisingSettings = {
	version: 2;
	enabled: boolean;
	placements: VisualAdvertisingPlacements;
	providerId: string;
	fallbackProviderId: string;
	schedule: VisualAdvertisingSchedule;
	presentation: VisualAdBreakPresentation;
	houseCreatives: VisualAdCreative[];
	liveRoomPrerollCreatives: VisualVideoPrerollCreative[];
	programOverrides: Record<string, VisualAdvertisingProgramOverride>;
};


const DEFAULT_BROADCAST_BRANDING: VisualBroadcastBranding = {
	enabled: true,
	showStationBug: false,
	stationLabel: "YSong Radio",
	showNowPlaying: true,
	showNextUp: true,
	showQueueLabel: true,
	bugPosition: "top-right",
};

const DEFAULT_BROADCAST_TIMING: VisualBroadcastTiming = {
	nowPlayingDelaySeconds: 0,
	nowPlayingHoldSeconds: 12,
	nextUpLeadSeconds: 10,
};

function normalizeBroadcastBranding(raw?: Partial<VisualBroadcastBranding> | null, fallbackLabel = "YSong Radio"): VisualBroadcastBranding {
	const position = raw?.bugPosition;
	return {
		enabled: raw?.enabled !== false,
		showStationBug: !!raw?.showStationBug,
		stationLabel: String(raw?.stationLabel || fallbackLabel || DEFAULT_BROADCAST_BRANDING.stationLabel).slice(0, 80),
		showNowPlaying: raw?.showNowPlaying !== false,
		showNextUp: raw?.showNextUp !== false,
		showQueueLabel: raw?.showQueueLabel !== false,
		bugPosition: position === "top-left" || position === "bottom-left" || position === "bottom-right" ? position : "top-right",
	};
}

function normalizeBroadcastTiming(raw?: Partial<VisualBroadcastTiming> | null): VisualBroadcastTiming {
	const delay = Number(raw?.nowPlayingDelaySeconds);
	const hold = Number(raw?.nowPlayingHoldSeconds);
	const nextLead = Number(raw?.nextUpLeadSeconds);
	return {
		nowPlayingDelaySeconds: Number.isFinite(delay) ? Math.max(0, Math.min(30, delay)) : 0,
		// Zero is meaningful here: it means keep Now Playing visible for the song.
		nowPlayingHoldSeconds: Number.isFinite(hold) ? Math.max(0, Math.min(120, hold)) : DEFAULT_BROADCAST_TIMING.nowPlayingHoldSeconds,
		// Zero intentionally disables the Up Next overlay.
		nextUpLeadSeconds: Number.isFinite(nextLead) ? Math.max(0, Math.min(60, nextLead)) : DEFAULT_BROADCAST_TIMING.nextUpLeadSeconds,
	};
}

export function normalizeVisualBroadcastGlobals(globals?: Partial<VisualBroadcastGlobals> | null): VisualBroadcastGlobals {
	return {
		version: 1,
		defaultSceneIds: Array.isArray(globals?.defaultSceneIds) ? globals!.defaultSceneIds!.filter(Boolean) : [],
		visualAvoidRecent: Number.isFinite(Number(globals?.visualAvoidRecent)) ? Math.max(0, Math.min(50, Number(globals?.visualAvoidRecent))) : 3,
		branding: normalizeBroadcastBranding(globals?.branding, "YSong Radio"),
		timing: normalizeBroadcastTiming(globals?.timing),
	};
}

export function normalizeVisualAdvertisingSettings(raw?: Partial<VisualAdvertisingSettings> | null): VisualAdvertisingSettings {
	const schedule = raw?.schedule;
	const presentation = raw?.presentation;
	const creatives = Array.isArray(raw?.houseCreatives) ? raw!.houseCreatives! : [];
	const roomPrerolls = Array.isArray(raw?.liveRoomPrerollCreatives) ? raw!.liveRoomPrerollCreatives! : [];
	const programOverrides: Record<string, VisualAdvertisingProgramOverride> = {};
	for (const [programId, override] of Object.entries(raw?.programOverrides || {})) {
		if (!programId || !override) continue;
		programOverrides[programId] = {
			mode: override.mode === "enabled" || override.mode === "disabled" ? override.mode : "inherit",
			...(Number.isFinite(Number(override.minSongsBetweenAds)) ? { minSongsBetweenAds: Math.max(0, Math.min(100, Number(override.minSongsBetweenAds))) } : {}),
			...(Number.isFinite(Number(override.minMinutesBetweenAds)) ? { minMinutesBetweenAds: Math.max(0, Math.min(180, Number(override.minMinutesBetweenAds))) } : {}),
			...(Number.isFinite(Number(override.maxAdsPerHour)) ? { maxAdsPerHour: Math.max(0, Math.min(60, Number(override.maxAdsPerHour))) } : {}),
		};
	}
	return {
		version: 2,
		enabled: !!raw?.enabled,
		placements: {
			radio: raw?.placements?.radio !== false,
			liveRoomPreroll: raw?.placements?.liveRoomPreroll !== false,
		},
		providerId: String(raw?.providerId || "house").slice(0, 80),
		fallbackProviderId: String(raw?.fallbackProviderId || "house").slice(0, 80),
		schedule: {
			initialGraceSongs: Number.isFinite(Number(schedule?.initialGraceSongs)) ? Math.max(0, Math.min(100, Number(schedule?.initialGraceSongs))) : 3,
			initialGraceMinutes: Number.isFinite(Number(schedule?.initialGraceMinutes)) ? Math.max(0, Math.min(180, Number(schedule?.initialGraceMinutes))) : 8,
			minSongsBetweenAds: Number.isFinite(Number(schedule?.minSongsBetweenAds)) ? Math.max(0, Math.min(100, Number(schedule?.minSongsBetweenAds))) : 4,
			minMinutesBetweenAds: Number.isFinite(Number(schedule?.minMinutesBetweenAds)) ? Math.max(0, Math.min(180, Number(schedule?.minMinutesBetweenAds))) : 10,
			maxAdsPerHour: Number.isFinite(Number(schedule?.maxAdsPerHour)) ? Math.max(0, Math.min(60, Number(schedule?.maxAdsPerHour))) : 4,
			recentCreativeWindow: Number.isFinite(Number(schedule?.recentCreativeWindow)) ? Math.max(0, Math.min(50, Number(schedule?.recentCreativeWindow))) : 4,
		},
		presentation: {
			enabled: !!presentation?.enabled,
			sceneId: String(presentation?.sceneId || ""),
			label: String(presentation?.label || "Ad Break").slice(0, 80),
			showSponsor: presentation?.showSponsor !== false,
			visualTransition: presentation?.visualTransition === "cut" || presentation?.visualTransition === "black" || presentation?.visualTransition === "flash" ? presentation.visualTransition : "fade",
			visualTransitionSeconds: Number.isFinite(Number(presentation?.visualTransitionSeconds)) ? Math.max(0.1, Math.min(12, Number(presentation?.visualTransitionSeconds))) : 0.8,
		},
		houseCreatives: creatives.map((creative, index) => ({
			id: String(creative?.id || `house-ad-${index + 1}`).replace(/[^a-z0-9_-]+/gi, "-").slice(0, 120),
			title: String(creative?.title || "House Ad").slice(0, 120),
			sponsor: String(creative?.sponsor || "YSong").slice(0, 120),
			audioUrl: String(creative?.audioUrl || ""),
			audioFileName: String(creative?.audioFileName || "").slice(0, 240),
			durationSeconds: Number.isFinite(Number(creative?.durationSeconds)) ? Math.max(0, Math.min(600, Number(creative?.durationSeconds))) : 0,
			weight: Number.isFinite(Number(creative?.weight)) ? Math.max(0.01, Math.min(100, Number(creative?.weight))) : 1,
			enabled: creative?.enabled !== false,
		})).filter((creative) => creative.id && creative.audioUrl),
		liveRoomPrerollCreatives: roomPrerolls.map((creative, index) => ({
			id: String(creative?.id || `room-preroll-${index + 1}`).replace(/[^a-z0-9_-]+/gi, "-").slice(0, 120),
			title: String(creative?.title || "Live Room Sponsor").slice(0, 120),
			sponsor: String(creative?.sponsor || "YSong").slice(0, 120),
			videoUrl: String(creative?.videoUrl || ""),
			videoFileName: String(creative?.videoFileName || "").slice(0, 240),
			durationSeconds: Number.isFinite(Number(creative?.durationSeconds)) ? Math.max(0, Math.min(300, Number(creative?.durationSeconds))) : 0,
			weight: Number.isFinite(Number(creative?.weight)) ? Math.max(0.01, Math.min(100, Number(creative?.weight))) : 1,
			enabled: creative?.enabled !== false,
			mutedByDefault: creative?.mutedByDefault === true,
		})).filter((creative) => creative.id && creative.videoUrl),
		programOverrides,
	};
}

export function normalizeVisualBroadcastProgram(
	program: Partial<VisualBroadcastProgram> | null | undefined,
	programId: string,
	identity?: { playlistId?: string; stationId?: string; kind?: VisualBroadcastProgram["kind"]; name?: string },
): VisualBroadcastProgram {
	const bridgeDefault = !!(program as (Partial<VisualBroadcastProgram> & { isDefault?: boolean }) | null | undefined)?.isDefault;
	const assignments: Record<string, VisualBroadcastAssignment> = {};
	for (const [trackId, raw] of Object.entries(program?.trackAssignments || {})) {
		const assignment = raw as VisualBroadcastAssignment;
		assignments[trackId] = {
			sceneIds: Array.isArray(assignment?.sceneIds) ? assignment.sceneIds.filter(Boolean) : [],
			...(assignment?.visualTransition ? { visualTransition: assignment.visualTransition } : {}),
			...(Number.isFinite(assignment?.visualTransitionSeconds) ? { visualTransitionSeconds: Math.max(0.1, Math.min(12, Number(assignment.visualTransitionSeconds))) } : {}),
			...(assignment?.audioTransition ? { audioTransition: assignment.audioTransition } : {}),
			...(Number.isFinite(assignment?.crossfadeSeconds) ? { crossfadeSeconds: Math.max(0.5, Math.min(20, Number(assignment.crossfadeSeconds))) } : {}),
		};
	}
	const albumDefaults: Record<string, string[]> = {};
	for (const [album, ids] of Object.entries(program?.albumDefaults || {})) albumDefaults[album] = Array.isArray(ids) ? ids.filter(Boolean) : [];
	const legacyPlaylistId = String(program?.playlistId || identity?.playlistId || "");
	const stationId = String(program?.stationId || identity?.stationId || "");
	const inferredKind: VisualBroadcastProgram["kind"] = identity?.kind || program?.kind || (stationId || programId.startsWith("ysong-radio-" ) ? "radio" : legacyPlaylistId ? "playlist" : "ad-hoc");
	const name = String((bridgeDefault ? identity?.name : program?.name) || program?.name || identity?.name || (inferredKind === "radio" ? "YSong Radio" : "Broadcast Program")).slice(0, 120);
	const radioDefaults = inferredKind === "radio";
	const brandingInput = bridgeDefault && identity?.name && program?.branding
		? { ...program.branding, stationLabel: identity.name }
		: program?.branding;
	return {
		version: 3,
		programId: String(program?.programId || programId),
		playlistId: legacyPlaylistId,
		...(stationId ? { stationId } : {}),
		kind: inferredKind,
		name,
		defaultSceneIds: Array.isArray(program?.defaultSceneIds) ? program!.defaultSceneIds!.filter(Boolean) : [],
		albumDefaults,
		trackAssignments: assignments,
		audioTransition: program?.audioTransition || (radioDefaults ? "crossfade" : "regular"),
		crossfadeSeconds: Math.max(0.5, Math.min(20, Number(program?.crossfadeSeconds) || 5)),
		visualTransition: program?.visualTransition || "fade",
		visualTransitionSeconds: Math.max(0.1, Math.min(12, Number(program?.visualTransitionSeconds) || 1.4)),
		shuffle: program?.shuffle == null ? radioDefaults : !!program.shuffle,
		avoidRecent: Number.isFinite(Number(program?.avoidRecent)) ? Math.max(0, Math.min(100, Number(program?.avoidRecent))) : (radioDefaults ? 18 : 12),
		visualAvoidRecent: Number.isFinite(Number(program?.visualAvoidRecent)) ? Math.max(0, Math.min(50, Number(program?.visualAvoidRecent))) : 3,
		repeatMode: program?.repeatMode === "one" || program?.repeatMode === "off" ? program.repeatMode : "all",
		branding: normalizeBroadcastBranding(brandingInput, inferredKind === "radio" ? (name || "YSong Radio") : name),
		timing: normalizeBroadcastTiming(program?.timing),
	};
}

export type VisualMediaUpload = {
	ok: true;
	id: string;
	fileName: string;
	contentType: string;
	bytes: number;
	path: string;
	url: string;
};

export class BridgeRequestError extends Error {
	status?: number;
	constructor(message: string, status?: number) {
		super(message);
		this.name = "BridgeRequestError";
		this.status = status;
	}
}

async function bridgeFetch<T>(path: string, init?: RequestInit, timeoutMs = 1800): Promise<T> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(`${BRIDGE_BASE}${path}`, {
			...init,
			signal: controller.signal,
			headers: {
				// Do not force application/json onto bodyless GET requests. Besides
				// being unnecessary, that turns a simple GET into a CORS preflight.
				...(init?.body != null ? { "Content-Type": "application/json" } : {}),
				...(init?.headers || {}),
			},
		});
		if (!res.ok) {
			let detail = "";
			try {
				const body = await res.json() as { detail?: string; title?: string };
				detail = body.detail || body.title || "";
			} catch {
				try { detail = await res.text(); } catch { /* ignore */ }
			}
			throw new BridgeRequestError(detail || `YSong Bridge returned HTTP ${res.status}.`, res.status);
		}
		return (await res.json()) as T;
	} catch (error) {
		if (error instanceof BridgeRequestError) throw error;
		if (error instanceof DOMException && error.name === "AbortError") {
			throw new BridgeRequestError(`YSong Bridge request timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
		}
		throw new BridgeRequestError(error instanceof Error ? error.message : "Could not reach YSong Bridge.");
	} finally {
		clearTimeout(timer);
	}
}


async function bridgeFetchArrayBuffer(path: string, init?: RequestInit, timeoutMs = 120000): Promise<ArrayBuffer> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(`${BRIDGE_BASE}${path}`, { ...init, signal: controller.signal });
		if (!res.ok) {
			let detail = "";
			try {
				const body = await res.json() as { detail?: string; title?: string };
				detail = body.detail || body.title || "";
			} catch {
				try { detail = await res.text(); } catch { /* ignore */ }
			}
			throw new BridgeRequestError(detail || `YSong Bridge returned HTTP ${res.status}.`, res.status);
		}
		return await res.arrayBuffer();
	} catch (error) {
		if (error instanceof BridgeRequestError) throw error;
		if (error instanceof DOMException && error.name === "AbortError") throw new BridgeRequestError("YSong Bridge export request timed out.");
		throw new BridgeRequestError(error instanceof Error ? error.message : "Could not reach YSong Bridge.");
	} finally {
		clearTimeout(timer);
	}
}

async function bridgePostAudioForEncode(wav: Blob, format: "flac" | "mp3", bitrateKbps?: number): Promise<Blob> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 300000);
	try {
		const qs = new URLSearchParams({ format });
		if (format === "mp3" && bitrateKbps) qs.set("bitrateKbps", String(bitrateKbps));
		const res = await fetch(`${BRIDGE_BASE}/audio/encode?${qs.toString()}`, {
			method: "POST",
			body: wav,
			headers: { "Content-Type": "audio/wav" },
			signal: controller.signal,
		});
		if (!res.ok) {
			let detail = "";
			try {
				const body = await res.json() as { detail?: string; title?: string };
				detail = body.detail || body.title || "";
			} catch { try { detail = await res.text(); } catch { /* ignore */ } }
			throw new BridgeRequestError(detail || `YSong Bridge returned HTTP ${res.status}.`, res.status);
		}
		return await res.blob();
	} catch (error) {
		if (error instanceof BridgeRequestError) throw error;
		if (error instanceof DOMException && error.name === "AbortError") throw new BridgeRequestError("YSong Bridge encoder timed out.");
		throw new BridgeRequestError(error instanceof Error ? error.message : "Could not reach YSong Bridge encoder.");
	} finally {
		clearTimeout(timer);
	}
}


async function bridgeUploadVisualMedia(file: File): Promise<VisualMediaUpload> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 300000);
	try {
		const qs = new URLSearchParams({ fileName: file.name });
		const res = await fetch(`${BRIDGE_BASE}/visuals/media?${qs.toString()}`, {
			method: "POST",
			body: file,
			headers: { "Content-Type": file.type || "application/octet-stream" },
			signal: controller.signal,
		});
		if (!res.ok) {
			let detail = "";
			try { const body = await res.json() as { detail?: string }; detail = body.detail || ""; } catch { try { detail = await res.text(); } catch { /* ignore */ } }
			throw new BridgeRequestError(detail || `YSong Bridge returned HTTP ${res.status}.`, res.status);
		}
		const body = await res.json() as Omit<VisualMediaUpload, "url">;
		return { ...body, url: `${BRIDGE_BASE}${body.path}` };
	} catch (error) {
		if (error instanceof BridgeRequestError) throw error;
		if (error instanceof DOMException && error.name === "AbortError") throw new BridgeRequestError("Visual media import timed out.");
		throw new BridgeRequestError(error instanceof Error ? error.message : "Could not import visual media.");
	} finally {
		clearTimeout(timer);
	}
}

function bridgeEventSource<T>(path: string, onEvent: (event: T) => void, onConnection?: (connected: boolean) => void) {
	const source = new EventSource(`${BRIDGE_BASE}${path}`);
	source.onopen = () => onConnection?.(true);
	source.onerror = () => onConnection?.(false);
	source.onmessage = (message) => {
		try { onEvent(JSON.parse(message.data) as T); } catch { /* malformed native event */ }
	};
	return () => source.close();
}

export const bridgeApi = {
	health: () => bridgeFetch<BridgeHealth>("/health"),
	getVisualAudio: () => bridgeFetch<VisualAudioFrame>("/visuals/audio", undefined, 5000),
	pushVisualBrowserAudio: (frame: BrowserVisualAudioFrame) =>
		bridgeFetch<{ ok: true }>("/visuals/audio/browser", { method: "POST", body: JSON.stringify(frame) }, 3000),
	subscribeVisualAudio: (onEvent: (frame: VisualAudioFrame) => void, onConnection?: (connected: boolean) => void) =>
		bridgeEventSource<VisualAudioFrame>("/visuals/audio/events", onEvent, onConnection),
	getVisualScene: <T = unknown>() => bridgeFetch<{ sequence: number; scene: T }>("/visuals/state", undefined, 5000),
	setVisualScene: (scene: unknown) => bridgeFetch<{ ok: true; sequence: number }>("/visuals/state", { method: "POST", body: JSON.stringify(scene) }, 5000),
	subscribeVisualScene: <T = unknown>(onEvent: (payload: { sequence: number; scene: T }) => void, onConnection?: (connected: boolean) => void) =>
		bridgeEventSource<{ sequence: number; scene: T }>("/visuals/state/events", onEvent, onConnection),
	uploadVisualMedia: (file: File) => bridgeUploadVisualMedia(file),
	getVisualTransport: () => bridgeFetch<VisualTransportState>("/visuals/transport", undefined, 5000),
	setVisualTransport: (state: VisualTransportState) => bridgeFetch<{ ok: true; sequence: number }>("/visuals/transport", { method: "POST", body: JSON.stringify(state) }, 5000),
	subscribeVisualTransport: (onEvent: (state: VisualTransportState) => void, onConnection?: (connected: boolean) => void) =>
		bridgeEventSource<VisualTransportState>("/visuals/transport/events", onEvent, onConnection),
	pushVisualRoomEffect: (effect: VisualRoomAudienceEffect) =>
		bridgeFetch<{ ok: true; sequence: number }>("/visuals/room-effect", { method: "POST", body: JSON.stringify(effect) }, 3000),
	subscribeVisualRoomEffects: (onEvent: (payload: { sequence: number; effect: VisualRoomAudienceEffect }) => void, onConnection?: (connected: boolean) => void) =>
		bridgeEventSource<{ sequence: number; effect: VisualRoomAudienceEffect }>("/visuals/room-effect/events", onEvent, onConnection),
	getVisualLibrary: <T = unknown>() => bridgeFetch<{ presets: VisualScenePreset<T>[] }>("/visuals/library", undefined, 5000),
	saveVisualPreset: <T = unknown>(name: string, scene: T, id?: string) => bridgeFetch<{ ok: true; preset: VisualScenePreset<T> }>("/visuals/library", { method: "POST", body: JSON.stringify({ id, name, scene }) }, 5000),
	deleteVisualPreset: (id: string) => bridgeFetch<{ ok: true }>(`/visuals/library/${encodeURIComponent(id)}`, { method: "DELETE" }, 5000),
	getVisualProgram: (programId: string) => bridgeFetch<VisualBroadcastProgram>(`/visuals/programs/${encodeURIComponent(programId)}`, undefined, 5000),
	setVisualProgram: (programId: string, program: VisualBroadcastProgram) => bridgeFetch<{ ok: true }>(`/visuals/programs/${encodeURIComponent(programId)}`, { method: "POST", body: JSON.stringify(program) }, 5000),
	getVisualBroadcastGlobals: () => bridgeFetch<VisualBroadcastGlobals>("/visuals/broadcast/globals", undefined, 5000),
	setVisualBroadcastGlobals: (globals: VisualBroadcastGlobals) => bridgeFetch<{ ok: true }>("/visuals/broadcast/globals", { method: "POST", body: JSON.stringify(globals) }, 5000),
	getVisualAdvertisingSettings: () => bridgeFetch<VisualAdvertisingSettings>("/visuals/broadcast/advertising", undefined, 5000),
	setVisualAdvertisingSettings: (settings: VisualAdvertisingSettings) => bridgeFetch<{ ok: true }>("/visuals/broadcast/advertising", { method: "POST", body: JSON.stringify(settings) }, 5000),
	getPluginPaths: () => bridgeFetch<{ paths: string[] }>("/settings/plugin-paths"),
	setPluginPaths: (paths: string[]) =>
		bridgeFetch<{ ok: true; paths: string[] }>("/settings/plugin-paths", {
			method: "PUT",
			body: JSON.stringify({ paths }),
		}, 10000),
	addPluginPath: (path: string) =>
		bridgeFetch<{ ok: true; paths: string[] }>("/settings/plugin-paths/add", {
			method: "POST",
			body: JSON.stringify({ path }),
		}, 10000),
	removePluginPath: (path: string) =>
		bridgeFetch<{ ok: true; paths: string[] }>("/settings/plugin-paths/remove", {
			method: "POST",
			body: JSON.stringify({ path }),
		}, 10000),
	scanPlugins: () =>
		bridgeFetch<{ ok: true; plugins: BridgePlugin[]; scannedPaths: string[] }>(
			"/plugins/scan",
			{ method: "POST", body: "{}" },
			300000
		),
	getPlugins: () => bridgeFetch<{ ok: true; plugins: BridgePlugin[] }>("/plugins", undefined, 10000),
	getInstruments: () => bridgeFetch<{ ok: true; engine: string; instruments: InstrumentCatalogEntry[] }>("/instruments", undefined, 20000),
	matchInstruments: (desired: string[], limit = 12) => bridgeFetch<{ ok: true; learnedModel: false; strategy: string; desired: string[]; matches: InstrumentMatchResult[] }>("/instruments/match", { method: "POST", body: JSON.stringify({ desired, limit }) }, 20000),
	getInstrumentPresets: (instrumentId: string) => bridgeFetch<{ ok: true; instrument: InstrumentCatalogEntry; presets: InstrumentPresetEntry[] }>(`/instruments/${encodeURIComponent(instrumentId)}/presets`, undefined, 20000),
	getInstrumentParameters: (instrumentId: string, trackId?: string | null) => bridgeFetch<{ ok: true; instrumentId: string; trackId: string; parameters: InstrumentParameterEntry[] }>(`/plugins/${encodeURIComponent(instrumentId)}/parameters${trackId ? `?trackId=${encodeURIComponent(trackId)}` : ""}`, undefined, 20000),
	loadInstrumentCapability: (trackId: string, instrumentId: string) => bridgeFetch<{ ok: true; instrument: InstrumentCatalogEntry; loaded: unknown }>("/instrument/load", { method: "POST", body: JSON.stringify({ trackId, instrumentId }) }, 30000),
	loadInstrumentPreset: (trackId: string, presetId: string) => bridgeFetch<{ ok: true; trackId: string; preset: InstrumentSnapshotRecord }>("/preset/load", { method: "POST", body: JSON.stringify({ trackId, presetId }) }, 20000),
	setInstrumentParameter: (trackId: string, parameterId: number, value: number) => bridgeFetch<{ ok: true; trackId: string; parameterId: number; value: number }>("/parameter/set", { method: "POST", body: JSON.stringify({ trackId, parameterId, value }) }, 10000),
	getInstrumentSnapshots: (trackId?: string | null) => bridgeFetch<{ ok: true; snapshots: InstrumentSnapshotRecord[] }>(`/snapshots${trackId ? `?trackId=${encodeURIComponent(trackId)}` : ""}`, undefined, 10000),
	captureInstrumentSnapshot: (trackId: string, name: string, tags: string[] = []) => bridgeFetch<{ ok: true; snapshot: InstrumentSnapshotRecord }>("/snapshot", { method: "POST", body: JSON.stringify({ trackId, name, tags }) }, 30000),
	restoreInstrumentSnapshot: (trackId: string, snapshotId: string) => bridgeFetch<{ ok: true; snapshot: InstrumentSnapshotRecord }>("/snapshot/restore", { method: "POST", body: JSON.stringify({ trackId, snapshotId }) }, 30000),
	deleteInstrumentSnapshot: (snapshotId: string) => bridgeFetch<{ ok: true; removed: boolean }>(`/snapshots/${encodeURIComponent(snapshotId)}`, { method: "DELETE" }, 10000),
	renderInstrumentAudition: (trackId: string, durationSeconds = 3, notes?: Array<{ note: number; velocity?: number; startSeconds?: number; durationSeconds?: number; channel?: number }>) => bridgeFetchArrayBuffer("/audition", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trackId, durationSeconds, notes: notes ?? [] }) }, 120000),
	loadVst3Instrument: (trackId: string, path: string) =>
		bridgeFetch<{ ok: true; trackId: string; plugin: { name: string; path: string; vendor?: string | null; version?: string | null; hasEditor?: boolean }; sampleRate: number; blockSize: number }>(
			"/vst3/load",
			{ method: "POST", body: JSON.stringify({ trackId, path }) },
			30000,
		),
	unloadVst3Instrument: (trackId: string) =>
		bridgeFetch<{ ok: true; removed: boolean }>("/vst3/unload", { method: "POST", body: JSON.stringify({ trackId }) }, 10000),
	unloadAllVst3: () => bridgeFetch<{ ok: true }>("/vst3/unload-all", { method: "POST", body: "{}" }, 10000),
	scheduleVst3Midi: (trackId: string, events: Vst3MidiEvent[]) =>
		bridgeFetch<{ ok: true; queued: number; loaded?: boolean }>("/vst3/schedule", { method: "POST", body: JSON.stringify({ trackId, events }) }, 10000),
	setVst3Mixer: (trackId: string, muted: boolean, level: number, channel?: {
		inputGainDb?: number; phaseInvert?: boolean; hpfEnabled?: boolean; hpfHz?: number; lpfEnabled?: boolean; lpfHz?: number;
		eqEnabled?: boolean; lowGainDb?: number; lowFreqHz?: number; lowMidGainDb?: number; lowMidFreqHz?: number; lowMidQ?: number;
		highMidGainDb?: number; highMidFreqHz?: number; highMidQ?: number; highGainDb?: number; highFreqHz?: number;
		compressorEnabled?: boolean; compressorThresholdDb?: number; compressorRatio?: number; compressorAttackMs?: number; compressorReleaseMs?: number;
		pan?: number; width?: number;
	}) =>
		bridgeFetch<{ ok: true; loaded?: boolean }>("/vst3/mixer", { method: "POST", body: JSON.stringify({ trackId, muted, level, ...(channel ?? {}) }) }, 5000),
	setVst3Master: (level: number) =>
		bridgeFetch<{ ok: true }>("/vst3/master", { method: "POST", body: JSON.stringify({ level }) }, 5000),
	setVst3Effects: (trackId: string, effects: Vst3TrackEffect[]) =>
		bridgeFetch<{ ok: true; loaded?: boolean }>("/vst3/effects", { method: "POST", body: JSON.stringify({ trackId, effects }) }, 5000),
	stopVst3: () => bridgeFetch<{ ok: true }>("/vst3/stop", { method: "POST", body: "{}" }, 5000),
	getVst3Status: () => bridgeFetch<{ ok: true; instances: Vst3InstanceStatus[] }>("/vst3/status", undefined, 5000),
	renderVst3Mix: (durationSeconds: number, tracks: Vst3OfflineRenderTrack[]) =>
		bridgeFetchArrayBuffer("/vst3/render-mix", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ durationSeconds, tracks }),
		}, 300000),
	encodeAudio: (wav: Blob, format: "flac" | "mp3", bitrateKbps?: number) => bridgePostAudioForEncode(wav, format, bitrateKbps),
	openVst3Editor: (trackId: string) =>
		bridgeFetch<{ ok: true; trackId: string; pluginName: string; opened: boolean }>("/vst3/editor/open", { method: "POST", body: JSON.stringify({ trackId }) }, 10000),
	getMidiDevices: () => bridgeFetch<{ ok: true } & BridgeMidiSettings>("/midi/devices", undefined, 5000),
	autoDetectMidi: () => bridgeFetch<{ ok: true } & BridgeMidiSettings>("/midi/autodetect", { method: "POST", body: "{}" }, 10000),
	setMidiSettings: (settings: { enabledInputs: string[]; masterMode: "SelectedTrack" | "Separate"; masterInputName?: string | null }) =>
		bridgeFetch<{ ok: true } & BridgeMidiSettings>("/midi/settings", { method: "PUT", body: JSON.stringify(settings) }, 10000),
	setMidiRoute: (trackId: string | null, inputName?: string | null) => bridgeFetch<{ ok: true; trackId?: string | null; inputName?: string | null }>("/midi/route", { method: "POST", body: JSON.stringify({ trackId, inputName }) }, 5000),
	midiPanic: () => bridgeFetch<{ ok: true }>("/midi/panic", { method: "POST", body: "{}" }, 5000),
	subscribeMidiEvents: (onEvent: (event: BridgeMidiEvent) => void, onConnection?: (connected: boolean) => void) => {
		const source = new EventSource(`${BRIDGE_BASE}/midi/events`);
		source.onopen = () => onConnection?.(true);
		source.onerror = () => onConnection?.(false);
		source.onmessage = (message) => {
			try { onEvent(JSON.parse(message.data) as BridgeMidiEvent); } catch { /* malformed native event */ }
		};
		return () => source.close();
	},
	openBridgeUi: () => bridgeFetch<{ ok: true }>("/ui/open", { method: "POST", body: "{}" }, 5000),
	openAsioControlPanel: () => bridgeFetch<{ ok: true }>("/audio/asio/control-panel", { method: "POST", body: "{}" }, 10000),
	getAudioStatus: () => bridgeFetch<{
		ok: true;
		driverType: "ASIO" | "WASAPI" | "DirectSound" | "MME";
		selectedDevice?: string | null;
		sampleRate: number;
		requestedBufferSize: number;
	}>("/audio/status", undefined, 5000),
};
