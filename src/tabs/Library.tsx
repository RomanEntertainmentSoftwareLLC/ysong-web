import { useEffect, useMemo, useState } from "react";
import { useTabManager } from "./core";
import { YSButton } from "../components/YSButton";
import {
  createWorldPlaylist,
  deleteWorldPlaylist,
  fetchWorldLibrary,
  toggleWorldArtistFollow,
  removeWorldTrack,
  worldArtworkUrl,
  type WorldLibrary,
  type WorldPlaylist,
} from "../lib/worldApi";
import { listBandProfiles, setActiveBandId, type BandProfile } from "../lib/bandLibrary";

const EMPTY: WorldLibrary = { tracks: [], releases: [], artists: [], playlists: [], savedPlaylists: [], uploads: [] };
type Section = "songs" | "albums" | "artists" | "bands" | "playlists" | "uploads";

export default function LibraryPane() {
  const { tabs, openTab, activateTab } = useTabManager();
  const [data, setData] = useState<WorldLibrary>(EMPTY);
  const [bands, setBands] = useState<BandProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [section, setSection] = useState<Section>("songs");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isPublic, setIsPublic] = useState(true);

  const loadWorld = async () => {
    setLoading(true); setError("");
    try { setData(await fetchWorldLibrary()); }
    catch (e: any) { setError(e?.message || "Could not load your online music library"); }
    finally { setLoading(false); }
  };
  const loadBands = async () => { try { setBands(await listBandProfiles()); } catch {} };

  useEffect(() => { void loadWorld(); void loadBands(); }, []);
  useEffect(() => {
    const world = () => void loadWorld(); const local = () => void loadBands();
    window.addEventListener("ysong:library-changed", world);
    window.addEventListener("ysong:bands-changed", local);
    return () => { window.removeEventListener("ysong:library-changed", world); window.removeEventListener("ysong:bands-changed", local); };
  }, []);

  const openWorld = (entityType?: "track" | "release" | "playlist", entityId?: string) => {
    const existing = tabs.find((t) => t.type === "world");
    if (existing) activateTab(existing.id); else openTab({ type: "world", title: "YSong World", pinned: true });
    if (entityType && entityId) setTimeout(() => window.dispatchEvent(new CustomEvent("ysong:open-world-entity", { detail: { entityType, entityId } })), 40);
  };
  const openBand = (id: string) => {
    setActiveBandId(id);
    const existing = tabs.find((t) => t.type === "band");
    if (existing) activateTab(existing.id); else openTab({ type: "band", title: "Band Creation", pinned: true });
    window.setTimeout(() => window.dispatchEvent(new CustomEvent("ysong:band-open", { detail: { id } })), 60);
  };
  const newBand = () => {
    setActiveBandId(null);
    const existing = tabs.find((t) => t.type === "band");
    if (existing) activateTab(existing.id); else openTab({ type: "band", title: "Band Creation", pinned: true });
    window.setTimeout(() => window.dispatchEvent(new CustomEvent("ysong:band-new")), 60);
  };

  const createPlaylist = async () => {
    if (!title.trim()) return;
    try { await createWorldPlaylist({ title: title.trim(), description: description.trim(), isPublic }); setTitle(""); setDescription(""); setIsPublic(true); setCreating(false); setSection("playlists"); await loadWorld(); }
    catch (e: any) { setError(e?.message || "Could not create playlist"); }
  };
  const removePlaylist = async (playlist: WorldPlaylist) => { if (!window.confirm(`Delete playlist “${playlist.title}”?`)) return; await deleteWorldPlaylist(playlist.id); await loadWorld(); };
  const unfollowArtist = async (ownerUserId: string, artistName: string) => {
    const result = await toggleWorldArtistFollow(ownerUserId, artistName);
    if (!result.followed) await loadWorld();
  };
  const removeUpload = async (track: WorldLibrary["uploads"][number]) => {
    if (!window.confirm(`Remove “${track.title}” from YSong World?\n\nThe World listing and its social/analytics records are removed. Your artist identity is kept.`)) return;
    await removeWorldTrack(track.id); await loadWorld();
  };

  const counts = useMemo(() => ({
    songs: data.tracks.length,
    albums: data.releases.length,
    artists: data.artists.length,
    bands: bands.length,
    playlists: data.playlists.length + data.savedPlaylists.length,
    uploads: data.uploads.length,
  }), [data, bands]);

  return <div className="h-full min-h-0 overflow-y-auto bg-neutral-950 text-neutral-100">
    <div className="p-4 md:p-6 pb-28 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6"><div><div className="text-xs uppercase tracking-[.22em] text-indigo-300">Everything you kept</div><h1 className="text-3xl font-semibold mt-1">Your Library</h1><p className="text-sm text-neutral-400 mt-1">Saved music, artists, bands, playlists and your own uploads.</p></div><div className="flex flex-wrap gap-2"><YSButton onClick={newBand} className="rounded-xl border border-fuchsia-400/30 px-4 py-2">+ New Band</YSButton><YSButton onClick={() => setCreating((v) => !v)} className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2">+ New Playlist</YSButton><YSButton onClick={() => openWorld()} className="rounded-xl border border-neutral-700 px-4 py-2">Explore World</YSButton></div></div>

      {creating && <div className="mb-6 rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 grid gap-3"><div className="font-semibold">Create playlist</div><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Playlist title" className="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 outline-none focus:border-indigo-400" /><textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" rows={2} className="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 outline-none focus:border-indigo-400 resize-y" /><label className="text-sm flex items-center gap-2"><input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} /> Public playlist</label><div className="flex gap-2"><YSButton onClick={createPlaylist} className="rounded-lg bg-indigo-600 px-4 py-2">Create</YSButton><YSButton onClick={() => setCreating(false)} className="rounded-lg border border-neutral-700 px-4 py-2">Cancel</YSButton></div></div>}

      <div className="flex gap-2 overflow-x-auto pb-2 mb-5 no-scrollbar">{(["songs","albums","artists","bands","playlists","uploads"] as Section[]).map((key) => <button key={key} onClick={() => setSection(key)} className={`shrink-0 rounded-full px-4 py-2 text-sm border ${section === key ? "bg-white text-black border-white" : "border-neutral-700 hover:bg-neutral-900"}`}>{label(key)} <span className="opacity-60">{counts[key]}</span></button>)}</div>

      {error && <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>}
      {section === "bands" ? <BandsSection bands={bands} onOpen={openBand} onNew={newBand} /> : loading ? <div className="text-neutral-400">Loading your library…</div> : <>
        {section === "songs" && <TrackListEmptyAware tracks={data.tracks} empty="Songs you save in YSong World will appear here." onOpen={(id) => openWorld("track", id)} />}
        {section === "albums" && (data.releases.length ? <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">{data.releases.map((r) => <button key={r.id} onClick={() => openWorld("release", r.id)} className="text-left min-w-0"><Cover trackId={r.coverTrackId} /><div className="font-medium text-sm mt-2 truncate">{r.title}</div><div className="text-xs text-neutral-400 truncate">{r.artistName}</div></button>)}</div> : <Empty text="Albums and releases you save will appear here." />)}
        {section === "artists" && (data.artists.length ? <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{data.artists.map((a) => <div key={`${a.ownerUserId}:${a.artistName}`} className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4 flex items-center gap-3"><div className="h-12 w-12 rounded-full bg-gradient-to-br from-indigo-500/40 to-fuchsia-500/20 grid place-items-center text-xl font-bold">{a.artistName.slice(0,1).toUpperCase()}</div><div className="min-w-0 flex-1"><div className="font-semibold truncate">{a.artistName}</div><div className="text-xs text-neutral-500">Following</div></div><button onClick={() => void unfollowArtist(a.ownerUserId, a.artistName)} className="rounded-lg border border-neutral-700 px-2.5 py-1.5 text-xs text-neutral-300 hover:border-red-400/40 hover:text-red-300">Unfollow</button></div>)}</div> : <Empty text="Artists you follow will appear here." />)}
        {section === "playlists" && <PlaylistSection own={data.playlists} saved={data.savedPlaylists} onOpen={(id) => openWorld("playlist", id)} onDelete={removePlaylist} />}
        {section === "uploads" && <TrackListEmptyAware tracks={data.uploads} empty="Your YSong World uploads will appear here." onOpen={(id) => openWorld("track", id)} onRemove={removeUpload} />}
      </>}
    </div>
  </div>;
}

function label(section: Section) { return ({ songs:"Songs", albums:"Albums", artists:"Artists", bands:"Bands", playlists:"Playlists", uploads:"Your Uploads" } as const)[section]; }
function Cover({ trackId }: { trackId?: string | null }) { return trackId ? <img src={worldArtworkUrl(trackId)} alt="" className="w-full aspect-square rounded-xl object-cover bg-neutral-900" /> : <div className="w-full aspect-square rounded-xl bg-gradient-to-br from-neutral-800 to-neutral-950 grid place-items-center text-neutral-600 text-3xl">♪</div>; }
function Empty({ text }: { text: string }) { return <div className="rounded-2xl border border-dashed border-neutral-700 p-10 text-center text-neutral-400">{text}</div>; }

function BandsSection({ bands, onOpen, onNew }: { bands: BandProfile[]; onOpen: (id: string) => void; onNew: () => void }) {
  if (!bands.length) return <div className="rounded-2xl border border-dashed border-neutral-700 p-10 text-center text-neutral-400"><div>No saved bands yet.</div><button className="mt-4 rounded-xl border border-fuchsia-400/30 px-4 py-2 text-sm text-fuchsia-200" onClick={onNew}>Create your first band</button></div>;
  return <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">{bands.map((band) => <BandCard key={band.id} band={band} onOpen={onOpen} />)}</div>;
}
function BandCard({ band, onOpen }: { band: BandProfile; onOpen: (id: string) => void }) {
  const [url, setUrl] = useState("");
  useEffect(() => { if (!band.image) { setUrl(""); return; } const next = URL.createObjectURL(band.image); setUrl(next); return () => URL.revokeObjectURL(next); }, [band.image]);
  return <button onClick={() => onOpen(band.id)} className="text-left min-w-0 group"><div className="aspect-square rounded-2xl overflow-hidden border border-white/10 grid place-items-center" style={{ background: `radial-gradient(circle at 35% 30%, ${band.accent}55, transparent 34%), ${band.primary}` }}>{url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <div className="h-28 w-28 rounded-full border-8 grid place-items-center text-3xl font-black" style={{ borderColor: band.accent, color: band.accent }}>{band.name.split(/\s+/).slice(0,2).map((v) => v[0]).join("").toUpperCase() || "YS"}</div>}</div><div className="font-medium text-sm mt-2 truncate group-hover:text-fuchsia-200">{band.name || "Untitled Band"}</div><div className="text-xs text-neutral-500 truncate">{band.genre || "Band identity"}</div></button>;
}

function TrackListEmptyAware({ tracks, empty, onOpen, onRemove }: { tracks: WorldLibrary["tracks"]; empty: string; onOpen: (id: string) => void; onRemove?: (track: WorldLibrary["tracks"][number]) => void }) { if (!tracks.length) return <Empty text={empty} />; return <div className="rounded-2xl border border-neutral-800 overflow-hidden">{tracks.map((t) => <div key={t.id} className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3 p-2.5 border-b last:border-0 border-neutral-800 hover:bg-neutral-900"><button onClick={() => onOpen(t.id)} className="contents text-left"><Cover trackId={t.hasArtwork ? t.id : null} /><div className="min-w-0 text-left"><div className="font-medium truncate">{t.title}</div><div className="text-xs text-neutral-500 truncate">{t.artistName} • {t.albumName}</div></div></button><div className="flex items-center gap-3"><span className="text-xs text-neutral-500">▶ {t.playCount.toLocaleString()}</span>{onRemove && <button onClick={() => onRemove(t)} className="text-xs text-red-300 hover:text-red-200">Remove</button>}</div></div>)}</div>; }
function PlaylistSection({ own, saved, onOpen, onDelete }: { own: WorldPlaylist[]; saved: WorldPlaylist[]; onOpen: (id:string)=>void; onDelete:(p:WorldPlaylist)=>void }) { if (!own.length && !saved.length) return <Empty text="Create a playlist or save somebody else's playlist and it will live here." />; return <div className="space-y-7">{own.length > 0 && <div><h2 className="font-semibold mb-3">Your Playlists</h2><div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">{own.map((p) => <PlaylistCard key={p.id} playlist={p} onOpen={onOpen} onDelete={onDelete} />)}</div></div>}{saved.length > 0 && <div><h2 className="font-semibold mb-3">Saved Playlists</h2><div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">{saved.map((p) => <PlaylistCard key={p.id} playlist={p} onOpen={onOpen} />)}</div></div>}</div>; }
function PlaylistCard({ playlist, onOpen, onDelete }: { playlist: WorldPlaylist; onOpen:(id:string)=>void; onDelete?:(p:WorldPlaylist)=>void }) { return <div className="min-w-0"><button onClick={() => onOpen(playlist.id)} className="w-full text-left"><Cover trackId={playlist.coverTrackId} /><div className="font-medium text-sm mt-2 truncate">{playlist.title}</div><div className="text-xs text-neutral-500 truncate">{playlist.ownerName} • {playlist.trackCount} songs</div></button>{onDelete && <button onClick={() => onDelete(playlist)} className="text-[11px] text-neutral-500 hover:text-red-300 mt-1">Delete</button>}</div>; }
