import { AUTH_BASE, apiGet } from "./authApi";

export type FlashbackPeriod = "week" | "month" | "year";

export type FlashbackTrack = {
	id: string;
	title: string;
	artistName: string;
	genre: string;
	plays: number;
	listenSeconds: number;
};

export type FlashbackRanked = {
	name: string;
	plays: number;
	tracks: number;
	listenSeconds: number;
};

export type FlashbackData = {
	period: FlashbackPeriod;
	label: string;
	year: number;
	start: string;
	end: string;
	availableYears: number[];
	totals: {
		plays: number;
		uniqueTracks: number;
		uniqueArtists: number;
		listenSeconds: number;
		trackedEvents: number;
		trackingCoverage: number;
		listeningDays: number;
		longestStreakDays: number;
	};
	discoveries: { tracks: number; artists: number };
	topTracks: FlashbackTrack[];
	topArtists: FlashbackRanked[];
	topGenres: FlashbackRanked[];
	daily: { day: string; plays: number; listenSeconds: number }[];
};

export function fetchFlashback(period: FlashbackPeriod, year?: number) {
	const params = new URLSearchParams({ period });
	if (period === "year" && year) params.set("year", String(year));
	return apiGet<FlashbackData>(`/api/flashback?${params.toString()}`);
}

export function flashbackAudioUrl(trackId: string) {
	return `${AUTH_BASE}/api/world/media/${encodeURIComponent(trackId)}/audio`;
}

export function formatListeningTime(seconds: number) {
	const totalMinutes = Math.max(0, Math.round((Number(seconds) || 0) / 60));
	if (totalMinutes < 60) return `${totalMinutes.toLocaleString()} min`;
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return minutes ? `${hours.toLocaleString()} hr ${minutes} min` : `${hours.toLocaleString()} hr`;
}
