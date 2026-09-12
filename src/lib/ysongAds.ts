import {
	normalizeVisualAdvertisingSettings,
	type VisualAdCreative,
	type VisualVideoPrerollCreative,
	type VisualAdvertisingProgramOverride,
	type VisualAdvertisingSettings,
} from "./bridgeApi";

export type YSongAdContext = {
	programId: string;
	programKind: "playlist" | "radio" | "ad-hoc" | "room-preroll";
	queueLabel: string;
	currentTrackId?: string;
	nextTrackId?: string;
	recentCreativeIds: string[];
	nowMs: number;
};

export type YSongAdDecision = {
	providerId: string;
	creative: VisualAdCreative;
};

export type YSongVideoPrerollDecision = {
	providerId: "house-video";
	creative: VisualVideoPrerollCreative;
};

export type YSongAdProvider = {
	id: string;
	requestAd: (context: YSongAdContext, settings: VisualAdvertisingSettings) => Promise<VisualAdCreative | null> | VisualAdCreative | null;
};

export type YSongAdSessionState = {
	sessionStartedAtMs: number;
	songsCompleted: number;
	songsSinceAd: number;
	musicSecondsSinceAd: number;
	adTimestampsMs: number[];
	recentCreativeIds: string[];
};

export type EffectiveAdSchedule = {
	enabled: boolean;
	initialGraceSongs: number;
	initialGraceMinutes: number;
	minSongsBetweenAds: number;
	minMinutesBetweenAds: number;
	maxAdsPerHour: number;
	recentCreativeWindow: number;
};

const providers = new Map<string, YSongAdProvider>();

function weightedPick(creatives: VisualAdCreative[]) {
	const positive = creatives.filter((creative) => creative.enabled && creative.audioUrl && creative.weight > 0);
	if (!positive.length) return null;
	const total = positive.reduce((sum, creative) => sum + creative.weight, 0);
	let needle = Math.random() * total;
	for (const creative of positive) {
		needle -= creative.weight;
		if (needle <= 0) return creative;
	}
	return positive[positive.length - 1] || null;
}

const houseProvider: YSongAdProvider = {
	id: "house",
	requestAd: (context, settings) => {
		const enabled = settings.houseCreatives.filter((creative) => creative.enabled && !!creative.audioUrl);
		if (!enabled.length) return null;
		const recent = new Set(context.recentCreativeIds);
		const preferred = enabled.filter((creative) => !recent.has(creative.id));
		return weightedPick(preferred.length ? preferred : enabled);
	},
};
providers.set(houseProvider.id, houseProvider);

export function registerYSongAdProvider(provider: YSongAdProvider) {
	if (!provider?.id) throw new Error("An ad provider id is required.");
	providers.set(provider.id, provider);
	return () => {
		if (provider.id !== "house" && providers.get(provider.id) === provider) providers.delete(provider.id);
	};
}

export function availableYSongAdProviderIds() {
	return [...providers.keys()];
}

export function createYSongAdSession(nowMs = Date.now()): YSongAdSessionState {
	return {
		sessionStartedAtMs: nowMs,
		songsCompleted: 0,
		songsSinceAd: 0,
		musicSecondsSinceAd: 0,
		adTimestampsMs: [],
		recentCreativeIds: [],
	};
}

export function noteCompletedMusicTrack(state: YSongAdSessionState, durationSeconds: number): YSongAdSessionState {
	return {
		...state,
		songsCompleted: state.songsCompleted + 1,
		songsSinceAd: state.songsSinceAd + 1,
		musicSecondsSinceAd: state.musicSecondsSinceAd + Math.max(0, Number(durationSeconds) || 0),
	};
}

export function notePlayedAd(
	state: YSongAdSessionState,
	creativeId: string,
	recentCreativeWindow: number,
	nowMs = Date.now(),
): YSongAdSessionState {
	const hourAgo = nowMs - 60 * 60 * 1000;
	const adTimestampsMs = [...state.adTimestampsMs.filter((stamp) => stamp >= hourAgo), nowMs];
	const recentCreativeIds = creativeId
		? [creativeId, ...state.recentCreativeIds.filter((id) => id !== creativeId)].slice(0, Math.max(0, recentCreativeWindow))
		: state.recentCreativeIds;
	return {
		...state,
		songsSinceAd: 0,
		musicSecondsSinceAd: 0,
		adTimestampsMs,
		recentCreativeIds,
	};
}

function overrideFor(settings: VisualAdvertisingSettings, programId: string): VisualAdvertisingProgramOverride | undefined {
	return programId ? settings.programOverrides[programId] : undefined;
}

export function effectiveAdSchedule(settingsInput: VisualAdvertisingSettings, programId = ""): EffectiveAdSchedule {
	const settings = normalizeVisualAdvertisingSettings(settingsInput);
	const override = overrideFor(settings, programId);
	const mode = override?.mode || "inherit";
	return {
		enabled: mode === "disabled" ? false : mode === "enabled" ? true : settings.enabled,
		initialGraceSongs: settings.schedule.initialGraceSongs,
		initialGraceMinutes: settings.schedule.initialGraceMinutes,
		minSongsBetweenAds: override?.minSongsBetweenAds ?? settings.schedule.minSongsBetweenAds,
		minMinutesBetweenAds: override?.minMinutesBetweenAds ?? settings.schedule.minMinutesBetweenAds,
		maxAdsPerHour: override?.maxAdsPerHour ?? settings.schedule.maxAdsPerHour,
		recentCreativeWindow: settings.schedule.recentCreativeWindow,
	};
}

export function isAdDue(
	settingsInput: VisualAdvertisingSettings,
	state: YSongAdSessionState,
	programId = "",
	nowMs = Date.now(),
	pendingMusicSeconds = 0,
	pendingSongs = 0,
	programKind: YSongAdContext["programKind"] = "radio",
) {
	const normalized = normalizeVisualAdvertisingSettings(settingsInput);
	if (programKind !== "radio" || !normalized.placements.radio) return false;
	const schedule = effectiveAdSchedule(normalized, programId);
	if (!schedule.enabled || schedule.maxAdsPerHour <= 0) return false;
	const hourAgo = nowMs - 60 * 60 * 1000;
	const adsThisHour = state.adTimestampsMs.filter((stamp) => stamp >= hourAgo).length;
	if (adsThisHour >= schedule.maxAdsPerHour) return false;

	const hasPlayedAd = state.adTimestampsMs.length > 0;
	if (!hasPlayedAd) {
		const graceSongsMet = schedule.initialGraceSongs <= 0 || state.songsCompleted + pendingSongs >= schedule.initialGraceSongs;
		const listenedMinutes = (state.musicSecondsSinceAd + Math.max(0, pendingMusicSeconds)) / 60;
		const graceMinutesMet = schedule.initialGraceMinutes <= 0 || listenedMinutes >= schedule.initialGraceMinutes;
		return graceSongsMet && graceMinutesMet;
	}

	const songsMet = schedule.minSongsBetweenAds <= 0 || state.songsSinceAd + pendingSongs >= schedule.minSongsBetweenAds;
	const minutesMet = schedule.minMinutesBetweenAds <= 0 || (state.musicSecondsSinceAd + Math.max(0, pendingMusicSeconds)) / 60 >= schedule.minMinutesBetweenAds;
	return songsMet && minutesMet;
}

export async function requestYSongRoomPrerollAd(
	settingsInput: VisualAdvertisingSettings,
	roomId: string,
	roomName: string,
): Promise<YSongVideoPrerollDecision | null> {
	void roomId; void roomName;
	const settings = normalizeVisualAdvertisingSettings(settingsInput);
	if (!settings.enabled || !settings.placements.liveRoomPreroll) return null;
	const enabled = settings.liveRoomPrerollCreatives.filter((creative) => creative.enabled && !!creative.videoUrl && creative.weight > 0);
	if (!enabled.length) return null;
	const total = enabled.reduce((sum, creative) => sum + creative.weight, 0);
	let needle = Math.random() * total;
	let selected = enabled[enabled.length - 1];
	for (const creative of enabled) {
		needle -= creative.weight;
		if (needle <= 0) { selected = creative; break; }
	}
	return { providerId: "house-video", creative: selected };
}


export async function requestYSongAd(
	settingsInput: VisualAdvertisingSettings,
	context: YSongAdContext,
): Promise<YSongAdDecision | null> {
	const settings = normalizeVisualAdvertisingSettings(settingsInput);
	const provider = providers.get(settings.providerId);
	const fallback = providers.get(settings.fallbackProviderId) || houseProvider;
	try {
		const creative = provider ? await provider.requestAd(context, settings) : null;
		if (creative?.audioUrl) return { providerId: provider?.id || settings.providerId, creative };
	} catch {
		// Provider errors must never stop World playback; try the fallback below.
	}
	if (fallback && fallback !== provider) {
		try {
			const creative = await fallback.requestAd(context, settings);
			if (creative?.audioUrl) return { providerId: fallback.id, creative };
		} catch {
			// No ad is a valid result. Music continues normally.
		}
	}
	return null;
}
