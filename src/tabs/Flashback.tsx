import { useEffect, useMemo, useState } from "react";
import type { TabRendererProps } from "./core";
import { useWorldPlayer } from "../components/WorldPlayer";
import { fetchWorldTrack, worldArtworkUrl } from "../lib/worldApi";
import { fetchFlashback, formatListeningTime, type FlashbackData, type FlashbackPeriod } from "../lib/flashback";
import { renderFlashbackVideo, type FlashbackTheme } from "../lib/flashbackVideo";

const themeNames: Record<FlashbackTheme, string> = { midnight: "Midnight", aurora: "Aurora", ember: "Ember", mono: "Monochrome" };
const themeGradients: Record<FlashbackTheme, string> = {
	midnight: "from-[#08091a] via-[#17102d] to-[#381a63]",
	aurora: "from-[#041817] via-[#07343a] to-[#0c5360]",
	ember: "from-[#180705] via-[#351009] to-[#681f0b]",
	mono: "from-black via-neutral-900 to-neutral-700",
};

function pct(value: number) { return `${Math.max(0, Math.min(100, Math.round(value * 100)))}%`; }
function number(value: number) { return Math.max(0, Number(value) || 0).toLocaleString(); }
function downloadBlob(blob: Blob, name: string) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
	window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
	return <div className="rounded-2xl border border-white/10 bg-white/[.035] p-4 min-w-0">
		<div className="text-[10px] uppercase tracking-[.18em] text-neutral-500">{label}</div>
		<div className="mt-2 text-2xl md:text-3xl font-semibold tracking-tight truncate">{value}</div>
		{detail ? <div className="mt-1 text-xs text-neutral-500">{detail}</div> : null}
	</div>;
}

function RankedList({ title, rows, empty }: { title: string; rows: { name: string; plays: number }[]; empty: string }) {
	const max = Math.max(1, ...rows.map((row) => row.plays));
	return <section className="rounded-2xl border border-white/10 bg-white/[.025] p-5">
		<h2 className="font-semibold">{title}</h2>
		<div className="mt-4 space-y-3">
			{rows.length ? rows.slice(0, 5).map((row, index) => <div key={`${row.name}-${index}`}>
				<div className="flex items-center gap-3 text-sm"><span className="w-5 text-right text-neutral-600 tabular-nums">{index + 1}</span><span className="min-w-0 flex-1 truncate font-medium">{row.name}</span><span className="text-xs text-neutral-500 tabular-nums">{number(row.plays)} plays</span></div>
				<div className="ml-8 mt-1.5 h-1.5 rounded-full bg-white/5 overflow-hidden"><div className="h-full rounded-full bg-white/25" style={{ width: `${Math.max(4, (row.plays / max) * 100)}%` }} /></div>
			</div>) : <div className="text-sm text-neutral-500">{empty}</div>}
		</div>
	</section>;
}

function StoryCard({ data, index, theme }: { data: FlashbackData; index: number; theme: FlashbackTheme }) {
	const topTrack = data.topTracks[0];
	const slide = Math.max(0, Math.min(6, index));
	return <div className={`relative overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-br ${themeGradients[theme]} min-h-[430px] p-7 md:p-10 flex flex-col`}>
		<div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-3xl" />
		<div className="absolute -left-20 bottom-0 h-48 w-48 rounded-full bg-white/5 blur-3xl" />
		<div className="relative flex items-center justify-between text-[10px] uppercase tracking-[.22em] text-white/55"><span>YSong Flashback</span><span>{data.label}</span></div>
		<div className="relative flex-1 grid place-items-center text-center py-8">
			{slide === 0 && <div><div className="text-sm uppercase tracking-[.22em] text-white/55">Your listening story</div><div className="mt-4 text-4xl md:text-6xl font-semibold tracking-tight">{data.period === "year" ? `${data.year} was yours.` : "This is what you played."}</div><div className="mt-4 text-white/60">One recap. Zero filler.</div></div>}
			{slide === 1 && <div><div className="text-6xl md:text-8xl font-semibold tracking-tight">{number(Math.round(data.totals.listenSeconds / 60))}</div><div className="mt-3 text-2xl font-medium">minutes with music</div><div className="mt-3 text-white/55">{number(data.totals.plays)} plays across {number(data.totals.listeningDays)} listening days</div></div>}
			{slide === 2 && <div className="max-w-xl"><div className="text-xs uppercase tracking-[.2em] text-white/50">Your top song</div><div className="mt-5 text-4xl md:text-6xl font-semibold tracking-tight">{topTrack?.title || "Keep listening"}</div><div className="mt-4 text-xl text-white/65">{topTrack ? `${topTrack.artistName} · ${number(topTrack.plays)} plays` : "YSong World will build this as you listen."}</div></div>}
			{slide === 3 && <div className="w-full max-w-xl"><div className="text-xs uppercase tracking-[.2em] text-white/50">Your artists</div><div className="mt-5 space-y-3 text-left">{data.topArtists.slice(0, 5).map((row, i) => <div key={row.name} className="flex items-center gap-4"><span className="text-white/35 tabular-nums">0{i + 1}</span><span className={`truncate ${i === 0 ? "text-3xl font-semibold" : "text-xl text-white/75"}`}>{row.name}</span></div>)}</div></div>}
			{slide === 4 && <div className="w-full max-w-xl"><div className="text-xs uppercase tracking-[.2em] text-white/50">Your genres</div><div className="mt-5 flex flex-wrap justify-center gap-3">{data.topGenres.slice(0, 6).map((row, i) => <span key={row.name} className={`rounded-full border border-white/15 bg-white/[.08] px-4 py-2 ${i === 0 ? "text-2xl font-semibold" : "text-sm text-white/75"}`}>{row.name}</span>)}</div></div>}
			{slide === 5 && <div><div className="text-6xl md:text-8xl font-semibold tracking-tight">{number(data.discoveries.artists)}</div><div className="mt-3 text-2xl font-medium">new artists discovered</div><div className="mt-3 text-white/55">and {number(data.discoveries.tracks)} new songs entered your orbit</div></div>}
			{slide === 6 && <div><div className="text-6xl md:text-8xl font-semibold tracking-tight">{number(data.totals.longestStreakDays)}</div><div className="mt-3 text-2xl font-medium">day listening streak</div><div className="mt-3 text-white/55">{number(data.totals.uniqueTracks)} songs · {number(data.totals.uniqueArtists)} artists</div><div className="mt-8 text-sm uppercase tracking-[.22em] text-white/50">See you in the next Flashback.</div></div>}
		</div>
		<div className="relative grid grid-cols-7 gap-1">{Array.from({ length: 7 }, (_, i) => <div key={i} className={`h-1 rounded-full ${i <= slide ? "bg-white/75" : "bg-white/15"}`} />)}</div>
	</div>;
}

export default function FlashbackPane(_props: TabRendererProps) {
	const player = useWorldPlayer();
	const currentYear = new Date().getFullYear();
	const [period, setPeriod] = useState<FlashbackPeriod>("year");
	const [year, setYear] = useState(currentYear);
	const [data, setData] = useState<FlashbackData | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [theme, setTheme] = useState<FlashbackTheme>("midnight");
	const [storyIndex, setStoryIndex] = useState(0);
	const [storyPlaying, setStoryPlaying] = useState(false);
	const [exporting, setExporting] = useState(false);
	const [exportProgress, setExportProgress] = useState(0);
	const [exportMessage, setExportMessage] = useState("");

	useEffect(() => {
		let cancelled = false;
		setLoading(true); setError(""); setStoryIndex(0); setStoryPlaying(false);
		fetchFlashback(period, year).then((next) => { if (!cancelled) { setData(next); if (next.period === "year") setYear(next.year); } }).catch((err: any) => { if (!cancelled) setError(err?.message || "Could not load Flashback."); }).finally(() => { if (!cancelled) setLoading(false); });
		return () => { cancelled = true; };
	}, [period, year]);

	useEffect(() => {
		if (!storyPlaying) return;
		const timer = window.setInterval(() => setStoryIndex((value) => value >= 6 ? 0 : value + 1), 2600);
		return () => window.clearInterval(timer);
	}, [storyPlaying]);

	const years = useMemo(() => {
		const values = new Set<number>([currentYear, ...(data?.availableYears || [])]);
		return Array.from(values).sort((a, b) => b - a);
	}, [currentYear, data?.availableYears]);

	const playTopSong = async () => {
		const top = data?.topTracks?.[0];
		if (!top) return;
		try { const result = await fetchWorldTrack(top.id); player.playTrack(result.track); } catch { setExportMessage("Could not load the top song right now."); }
	};

	const exportVideo = async () => {
		if (!data || !data.totals.plays || exporting) return;
		setExporting(true); setExportProgress(0); setExportMessage("Rendering your recap in real time…");
		try {
			const blob = await renderFlashbackVideo(data, theme, setExportProgress);
			downloadBlob(blob, `YSong-Flashback-${data.period === "year" ? data.year : data.period}.webm`);
			setExportMessage("Flashback video exported. Your top song is used as the soundtrack when available.");
		} catch (err: any) { setExportMessage(err?.message || "Video export failed."); }
		finally { setExporting(false); }
	};

	return <div className="h-full overflow-y-auto bg-neutral-950 text-white">
		<div className="max-w-7xl mx-auto p-5 lg:p-8 space-y-6">
			<header className="flex flex-wrap items-end gap-4">
				<div className="mr-auto"><div className="text-xs uppercase tracking-[.22em] text-violet-300">Your listening story</div><h1 className="mt-1 text-3xl md:text-4xl font-semibold tracking-tight">YSong Flashback</h1><p className="mt-2 max-w-2xl text-sm text-neutral-400">Weekly, monthly and yearly recaps built from what you actually play in YSong World.</p></div>
				<div className="flex flex-wrap gap-2">
					<select value={period} onChange={(event) => setPeriod(event.target.value as FlashbackPeriod)} className="rounded-xl border border-white/10 bg-neutral-900 px-3 py-2 text-sm"><option value="week">Last 7 days</option><option value="month">Last 30 days</option><option value="year">Yearly</option></select>
					{period === "year" ? <select value={year} onChange={(event) => setYear(Number(event.target.value))} className="rounded-xl border border-white/10 bg-neutral-900 px-3 py-2 text-sm">{years.map((value) => <option key={value} value={value}>{value}</option>)}</select> : null}
				</div>
			</header>

			{loading ? <div className="rounded-2xl border border-white/10 bg-white/[.025] p-8 text-sm text-neutral-400">Building your Flashback…</div> : error ? <div className="rounded-2xl border border-red-400/20 bg-red-400/[.06] p-5 text-sm text-red-200">{error}</div> : data ? <>
				{!data.totals.plays ? <div className="rounded-2xl border border-violet-400/20 bg-violet-400/[.06] p-6"><div className="font-semibold">Your Flashback is empty for this period.</div><div className="mt-1 text-sm text-neutral-400">Play music in YSong World and the recap will build itself. Empty really means empty here too. 😂</div></div> : <>
					<div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
						<Stat label="Listening time" value={formatListeningTime(data.totals.listenSeconds)} detail={data.totals.trackingCoverage < .95 ? `${pct(data.totals.trackingCoverage)} directly tracked · older plays estimated` : "Direct listening-time tracking"} />
						<Stat label="Plays" value={number(data.totals.plays)} />
						<Stat label="Songs" value={number(data.totals.uniqueTracks)} />
						<Stat label="Artists" value={number(data.totals.uniqueArtists)} />
						<Stat label="Longest streak" value={`${number(data.totals.longestStreakDays)} days`} />
					</div>

					<section className="grid lg:grid-cols-[1.15fr_.85fr] gap-5">
						<div className="rounded-2xl border border-white/10 bg-white/[.025] overflow-hidden">
							<div className="grid sm:grid-cols-[220px_1fr] min-h-[220px]">
								<div className="bg-black/30 min-h-[220px]">{data.topTracks[0] ? <img src={worldArtworkUrl(data.topTracks[0].id)} alt="" className="w-full h-full object-cover" /> : null}</div>
								<div className="p-6 flex flex-col justify-center"><div className="text-[10px] uppercase tracking-[.2em] text-neutral-500">Your #1 song</div><div className="mt-2 text-3xl font-semibold tracking-tight">{data.topTracks[0]?.title}</div><div className="mt-2 text-neutral-400">{data.topTracks[0]?.artistName}</div><div className="mt-5 flex flex-wrap gap-2 text-xs"><span className="rounded-full border border-white/10 px-3 py-1.5">{number(data.topTracks[0]?.plays || 0)} plays</span><span className="rounded-full border border-white/10 px-3 py-1.5">{data.topTracks[0]?.genre}</span></div><button type="button" onClick={() => void playTopSong()} className="mt-5 self-start rounded-xl border border-violet-400/30 bg-violet-500/10 px-4 py-2 text-sm hover:bg-violet-500/15">Play top song</button></div>
							</div>
						</div>
						<div className="rounded-2xl border border-white/10 bg-white/[.025] p-5"><div className="text-[10px] uppercase tracking-[.2em] text-neutral-500">Discovery</div><div className="mt-4 grid grid-cols-2 gap-3"><Stat label="New artists" value={number(data.discoveries.artists)} /><Stat label="New songs" value={number(data.discoveries.tracks)} /></div><div className="mt-4 text-xs leading-relaxed text-neutral-500">A discovery is counted when YSong sees your first-ever play of that artist or song inside this recap period.</div></div>
					</section>

					<div className="grid lg:grid-cols-2 gap-5"><RankedList title="Top artists" rows={data.topArtists} empty="No artist ranking yet." /><RankedList title="Top genres" rows={data.topGenres} empty="No genre ranking yet." /></div>

					<section className="rounded-2xl border border-white/10 bg-white/[.025] p-5 md:p-6">
						<div className="flex flex-wrap items-start gap-4 mb-5"><div className="mr-auto"><h2 className="font-semibold">Cinematic story</h2><div className="mt-1 text-xs text-neutral-500">Preview the shareable recap, choose a theme, then export a vertical WebM with your top song as soundtrack when available.</div></div><div className="flex flex-wrap gap-2">{(Object.keys(themeNames) as FlashbackTheme[]).map((key) => <button key={key} type="button" onClick={() => setTheme(key)} className={`rounded-lg border px-3 py-1.5 text-xs ${theme === key ? "border-white/40 bg-white/10" : "border-white/10 text-neutral-400 hover:text-white"}`}>{themeNames[key]}</button>)}</div></div>
						<div className="max-w-3xl mx-auto"><StoryCard data={data} index={storyIndex} theme={theme} /></div>
						<div className="mt-4 flex flex-wrap justify-center gap-2"><button type="button" onClick={() => setStoryIndex((value) => value <= 0 ? 6 : value - 1)} className="rounded-xl border border-white/10 px-4 py-2 text-sm">Previous</button><button type="button" onClick={() => setStoryPlaying((value) => !value)} className="rounded-xl border border-white/10 px-4 py-2 text-sm">{storyPlaying ? "Pause preview" : "Play preview"}</button><button type="button" onClick={() => setStoryIndex((value) => value >= 6 ? 0 : value + 1)} className="rounded-xl border border-white/10 px-4 py-2 text-sm">Next</button><button type="button" disabled={exporting} onClick={() => void exportVideo()} className="rounded-xl border border-violet-400/30 bg-violet-500/10 px-4 py-2 text-sm disabled:opacity-40">{exporting ? `Rendering ${Math.round(exportProgress * 100)}%` : "Export recap video"}</button></div>
						{exportMessage ? <div className="mt-3 text-center text-xs text-neutral-400">{exportMessage}</div> : null}
					</section>
				</>}
			</> : null}
		</div>
	</div>;
}
