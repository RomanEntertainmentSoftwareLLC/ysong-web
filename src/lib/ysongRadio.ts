import type { WorldTrack } from "./worldApi";
import type { VisualBroadcastProgram } from "./bridgeApi";

export type YSongRadioStationMode = "mix" | "match" | "fresh" | "discovery" | "trending";

export type YSongRadioStation = {
	id: string;
	name: string;
	description: string;
	mode: YSongRadioStationMode;
	genreTerms?: string[];
	tagTerms?: string[];
	exactGenres?: string[];
	shuffle: boolean;
	avoidRecent: number;
	visualAvoidRecent: number;
	crossfadeSeconds: number;
	generatedFromCatalog?: boolean;
};

// YSong Radio's permanent defaults are deliberately catalog-agnostic. Genre
// stations are generated from the genres actually present in YSong World rather
// than hard-coding the tastes/catalog used while the feature was being built.
export const YSONG_RADIO_STATIONS: YSongRadioStation[] = [
	{
		id: "world-mix",
		name: "World Mix",
		description: "A broad shuffle across YSong World with recent-song avoidance.",
		mode: "mix",
		shuffle: true,
		avoidRecent: 20,
		visualAvoidRecent: 4,
		crossfadeSeconds: 5,
	},
	{
		id: "fresh-releases",
		name: "Fresh Releases",
		description: "Newest releases first, regardless of artist or genre.",
		mode: "fresh",
		shuffle: false,
		avoidRecent: 24,
		visualAvoidRecent: 4,
		crossfadeSeconds: 4,
	},
	{
		id: "trending",
		name: "Trending",
		description: "Tracks with the strongest current play-and-reaction signals rise to the front.",
		mode: "trending",
		shuffle: false,
		avoidRecent: 12,
		visualAvoidRecent: 4,
		crossfadeSeconds: 4,
	},
	{
		id: "deep-discovery",
		name: "Deep Discovery",
		description: "Lower-played tracks are deliberately surfaced ahead of obvious hits.",
		mode: "discovery",
		shuffle: false,
		avoidRecent: 24,
		visualAvoidRecent: 5,
		crossfadeSeconds: 5,
	},
];

function normalize(value: string) {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function slug(value: string) {
	return normalize(value).replace(/\s+/g, "-").replace(/^-+|-+$/g, "") || "genre";
}

function trackText(track: WorldTrack) {
	return [track.genre, ...(track.tags || [])].map(normalize).join(" | ");
}

function matchesTerms(track: WorldTrack, genreTerms: string[] = [], tagTerms: string[] = [], exactGenres: string[] = []) {
	const genre = normalize(track.genre || "");
	const tags = (track.tags || []).map(normalize);
	const all = trackText(track);
	if (exactGenres.some((term) => genre === normalize(term))) return true;
	return genreTerms.some((term) => genre.includes(normalize(term))) || tagTerms.some((term) => {
		const normalized = normalize(term);
		return tags.some((tag) => tag.includes(normalized)) || all.includes(normalized);
	});
}

function popularity(track: WorldTrack) {
	return Math.max(0, track.playCount || 0) + Math.max(0, track.likes || 0) * 12 - Math.max(0, track.dislikes || 0) * 4;
}

export function catalogGenreRadioStations(tracks: WorldTrack[], maxStations = 8): YSongRadioStation[] {
	const counts = new Map<string, { label: string; count: number }>();
	for (const track of tracks) {
		const label = String(track.genre || "").trim();
		const key = normalize(label);
		if (!key) continue;
		const current = counts.get(key);
		counts.set(key, { label: current?.label || label, count: (current?.count || 0) + 1 });
	}
	return [...counts.entries()]
		.sort((a, b) => b[1].count - a[1].count || a[1].label.localeCompare(b[1].label))
		.slice(0, Math.max(0, maxStations))
		.map(([normalizedGenre, entry]) => ({
			id: `genre-${slug(normalizedGenre)}`,
			name: `${entry.label} Radio`,
			description: `${entry.label} from the music actually available in YSong World.`,
			mode: "match" as const,
			exactGenres: [entry.label],
			shuffle: true,
			avoidRecent: 18,
			visualAvoidRecent: 4,
			crossfadeSeconds: 5,
			generatedFromCatalog: true,
		}));
}

export function ysongRadioStationsForCatalog(tracks: WorldTrack[], maxGenreStations = 8) {
	return [...YSONG_RADIO_STATIONS, ...catalogGenreRadioStations(tracks, maxGenreStations)];
}

export function radioProgramId(stationId: string) {
	return `ysong-radio-${stationId.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()}`;
}

export function radioStationById(stationId: string | null | undefined) {
	if (!stationId) return undefined;
	return YSONG_RADIO_STATIONS.find((station) => station.id === stationId);
}

export function applyRadioStationDefaults(
	program: Partial<VisualBroadcastProgram> & { isDefault?: boolean },
	station: YSongRadioStation | undefined,
) : Partial<VisualBroadcastProgram> & { isDefault?: boolean } {
	if (!program?.isDefault || !station) return program;
	const next: Partial<VisualBroadcastProgram> & { isDefault?: boolean } = {
		...program,
		name: `YSong Radio · ${station.name}`,
		stationId: station.id,
		kind: "radio" as const,
		audioTransition: "crossfade" as const,
		crossfadeSeconds: station.crossfadeSeconds,
		shuffle: station.shuffle,
		avoidRecent: station.avoidRecent,
		visualAvoidRecent: station.visualAvoidRecent,
	};
	if (program.branding) {
		next.branding = {
			...program.branding,
			enabled: true,
			showStationBug: true,
			stationLabel: station.name,
		};
	}
	return next;
}

export function tracksForRadioStation(station: YSongRadioStation, tracks: WorldTrack[]) {
	const unique = [...new Map(tracks.filter((track) => !!track?.id).map((track) => [track.id, track])).values()];
	if (station.mode === "match") {
		return unique.filter((track) => matchesTerms(track, station.genreTerms, station.tagTerms, station.exactGenres));
	}
	if (station.mode === "fresh") {
		return [...unique].sort((a, b) => +new Date(b.publishedAt || 0) - +new Date(a.publishedAt || 0));
	}
	if (station.mode === "discovery") {
		return [...unique].sort((a, b) => {
			const playDelta = popularity(a) - popularity(b);
			if (playDelta !== 0) return playDelta;
			return +new Date(b.publishedAt || 0) - +new Date(a.publishedAt || 0);
		});
	}
	if (station.mode === "trending") return [...unique].sort((a, b) => popularity(b) - popularity(a));
	return unique;
}

export function stationTrackCount(station: YSongRadioStation, tracks: WorldTrack[]) {
	return tracksForRadioStation(station, tracks).length;
}
