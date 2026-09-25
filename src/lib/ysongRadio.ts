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

export function radioStationArtworkUrl(station: YSongRadioStation) {
	const palettes: Record<string,[string,string,string]> = {
		"world-mix":["#6d28d9","#0f172a","#22d3ee"],
		"fresh-releases":["#0891b2","#082f49","#67e8f9"],
		"trending":["#ea580c","#431407","#fbbf24"],
		"deep-discovery":["#1d4ed8","#0f172a","#a78bfa"],
	};
	let hash=0; for(const ch of station.id) hash=(hash*31+ch.charCodeAt(0))>>>0;
	const hue=hash%360;
	const [a,b,c]=palettes[station.id] || [`hsl(${hue} 72% 44%)`,`hsl(${(hue+42)%360} 58% 13%)`,`hsl(${(hue+118)%360} 82% 68%)`];
	const safe=(station.name||"YSong Radio").replace(/[<&>]/g,"");
	const motif=station.id==="world-mix"
		? '<circle cx="400" cy="350" r="170" fill="none" stroke="white" stroke-width="11" opacity=".32"/><path d="M230 350h340M400 180c-72 76-72 264 0 340M400 180c72 76 72 264 0 340" fill="none" stroke="white" stroke-width="9" opacity=".32"/>'
		: station.id==="fresh-releases"
		? '<path d="M400 175l30 112 110-44-65 98 103 52-121 6 20 117-77-91-77 91 20-117-121-6 103-52-65-98 110 44z" fill="white" opacity=".18"/><path d="M260 430h280" stroke="white" stroke-width="24" stroke-linecap="round" opacity=".8"/>'
		: station.id==="trending"
		? '<path d="M205 520l115-135 85 70 165-210" fill="none" stroke="white" stroke-width="28" stroke-linecap="round" stroke-linejoin="round" opacity=".88"/><path d="M510 245h60v60" fill="none" stroke="white" stroke-width="28" opacity=".88"/>'
		: station.id==="deep-discovery"
		? '<circle cx="400" cy="360" r="62" fill="none" stroke="white" stroke-width="16" opacity=".85"/><circle cx="400" cy="360" r="138" fill="none" stroke="white" stroke-width="9" opacity=".34"/><circle cx="400" cy="360" r="215" fill="none" stroke="white" stroke-width="6" opacity=".18"/><path d="M400 145v430M185 360h430" stroke="white" stroke-width="5" opacity=".16"/>'
		: '<path d="M175 390h40l30-105 48 210 55-280 55 260 55-180 48 125 45-80 74 50" fill="none" stroke="white" stroke-width="18" stroke-linecap="round" stroke-linejoin="round" opacity=".86"/>';
	const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${a}"/><stop offset=".65" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient><radialGradient id="r"><stop stop-color="white" stop-opacity=".14"/><stop offset="1" stop-color="white" stop-opacity="0"/></radialGradient></defs><rect width="800" height="800" fill="url(#g)"/><circle cx="625" cy="150" r="270" fill="url(#r)"/>${motif}<text x="55" y="78" fill="white" font-family="Arial,sans-serif" font-size="28" font-weight="700" letter-spacing="8" opacity=".9">YSONG RADIO</text><text x="55" y="690" fill="white" font-family="Arial,sans-serif" font-size="48" font-weight="800">${safe}</text><text x="55" y="735" fill="white" font-family="Arial,sans-serif" font-size="19" font-weight="600" letter-spacing="5" opacity=".58">STATION · LIVE CATALOG</text></svg>`;
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
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
