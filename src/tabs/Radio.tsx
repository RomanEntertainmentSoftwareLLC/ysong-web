import { useEffect, useMemo, useState } from "react";
import { useWorldPlayer } from "../components/WorldPlayer";
import { fetchWorldTracks, worldArtworkUrl, type WorldTrack } from "../lib/worldApi";
import { radioProgramId, tracksForRadioStation, ysongRadioStationsForCatalog, type YSongRadioStation } from "../lib/ysongRadio";

function fallbackCover(station: YSongRadioStation) {
  const palette: Record<string, [string,string]> = {
    "world-mix": ["#7c3aed","#111827"],
    "fresh-releases": ["#06b6d4","#0f172a"],
    trending: ["#f97316","#3f0d12"],
    "deep-discovery": ["#2563eb","#111827"],
  };
  const [a,b] = palette[station.id] || ["#8b5cf6","#111827"];
  const label = station.name.replace(/[<&>]/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="800" height="800" fill="url(#g)"/><circle cx="640" cy="130" r="170" fill="white" opacity=".08"/><circle cx="150" cy="670" r="240" fill="white" opacity=".05"/><path d="M180 420h70l55-180 95 330 78-250 60 160 58-100h100" fill="none" stroke="white" stroke-width="26" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/><text x="58" y="90" fill="white" font-family="Arial,sans-serif" font-size="34" font-weight="700" letter-spacing="8">YSONG RADIO</text><text x="58" y="730" fill="white" font-family="Arial,sans-serif" font-size="56" font-weight="700">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function stationCover(station: YSongRadioStation, eligible: WorldTrack[]) {
  const candidate = eligible.find((track) => !!track?.id);
  return candidate ? worldArtworkUrl(candidate.id) : fallbackCover(station);
}

export default function RadioPane() {
  const { startQueue, current, playing } = useWorldPlayer();
  const [tracks, setTracks] = useState<WorldTrack[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const result = await fetchWorldTracks({ sort: "algorithm" });
        if (alive) setTracks(result.tracks || []);
      } catch (e: unknown) {
        if (alive) setError(e instanceof Error ? e.message : "Could not load YSong Radio.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const stations = useMemo(() => {
    const all = ysongRadioStationsForCatalog(tracks, 24).map((station) => ({ station, eligible: tracksForRadioStation(station, tracks) }));
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(({ station, eligible }) => `${station.name} ${station.description} ${eligible.map(t => `${t.genre} ${t.artistName}`).join(" ")}`.toLowerCase().includes(q));
  }, [tracks, query]);

  const play = (station: YSongRadioStation, eligible: WorldTrack[]) => {
    if (!eligible.length) return;
    startQueue(eligible, `YSong Radio · ${station.name}`, undefined, "", radioProgramId(station.id), "radio");
  };

  return <div className="h-full min-h-0 overflow-y-auto bg-neutral-950 text-neutral-100">
    <div className="mx-auto max-w-7xl p-5 md:p-7 pb-28">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[.24em] text-violet-300">Listen without leaving the studio</div>
          <h1 className="mt-1 text-3xl font-semibold">YSong Radio</h1>
          <p className="mt-2 max-w-2xl text-sm text-neutral-400">Search catalog-driven stations by genre, mood, artist or station name. Radio keeps playing in the global player while you work anywhere else in YSong.</p>
        </div>
        <div className="text-xs text-neutral-500">{tracks.length} catalog song{tracks.length === 1 ? "" : "s"}</div>
      </div>

      <div className="mt-6 rounded-2xl border border-white/10 bg-white/[.025] p-3">
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-3">
          <span className="text-neutral-500">⌕</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search YSong Radio…" className="w-full bg-transparent py-3 text-sm outline-none" />
          {query && <button onClick={() => setQuery("")} className="text-xs text-neutral-500 hover:text-white">Clear</button>}
        </div>
      </div>

      {error && <div className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
      {loading ? <div className="mt-8 text-neutral-500">Loading stations…</div> :
      <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {stations.map(({ station, eligible }) => {
          const live = current && eligible.some(t => t.id === current.id);
          return <article key={station.id} className="group overflow-hidden rounded-2xl border border-white/10 bg-neutral-900/70 shadow-xl">
            <div className="relative aspect-square overflow-hidden bg-neutral-900">
              <img src={stationCover(station, eligible)} alt={`${station.name} station cover`} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.025]" loading="lazy" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-4">
                <div className="text-[10px] font-semibold uppercase tracking-[.22em] text-violet-200">YSong Radio</div>
                <h2 className="mt-1 text-xl font-semibold">{station.name}</h2>
              </div>
              {live && <span className="absolute right-3 top-3 rounded-full border border-violet-300/30 bg-violet-500/30 px-2 py-1 text-[10px] font-semibold text-violet-100 backdrop-blur">{playing ? "PLAYING" : "QUEUED"}</span>}
            </div>
            <div className="p-4">
              <p className="min-h-10 text-xs leading-relaxed text-neutral-400">{station.description}</p>
              <div className="mt-4 flex items-center justify-between gap-3">
                <span className="text-[10px] uppercase tracking-wider text-neutral-500">{eligible.length} eligible song{eligible.length === 1 ? "" : "s"}</span>
                <button disabled={!eligible.length} onClick={() => play(station, eligible)} className="rounded-xl bg-violet-500 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-30">▶ Listen</button>
              </div>
            </div>
          </article>;
        })}
      </div>}
      {!loading && stations.length === 0 && <div className="mt-8 rounded-2xl border border-dashed border-white/10 p-10 text-center text-sm text-neutral-500">No stations match “{query}”.</div>}
    </div>
  </div>;
}
