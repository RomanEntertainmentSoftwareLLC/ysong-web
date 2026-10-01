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
import { createGenerationFolder, deleteGeneration, deleteGenerationFolder, listGenerationFolders, listGenerations, moveGenerationToFolder, renameGenerationFolder, type GenerationFolder, type GenerationRecord } from "../lib/generationLibrary";

const EMPTY: WorldLibrary = { tracks: [], releases: [], artists: [], playlists: [], savedPlaylists: [], uploads: [] };
type Section = "all" | "generated" | "generations" | "saved" | "albums" | "artists" | "bands" | "playlists" | "uploads";
type GeneratedProject = { id: string; name: string; updatedAt: number; generation: { origin: "create-song"; sessionId: string; createdAt: number; title: string } };

function readGeneratedProjects(): GeneratedProject[] {
  try {
    const catalog: unknown = JSON.parse(localStorage.getItem("ysong:projects:v1") || "[]");
    if (!Array.isArray(catalog)) return [];
    return catalog.filter((item): item is GeneratedProject =>
      item && typeof item.id === "string" && item.id.length > 0 &&
      typeof item.name === "string" && typeof item.updatedAt === "number" &&
      item.generation?.origin === "create-song" &&
      typeof item.generation.sessionId === "string" &&
      Number.isFinite(item.generation.createdAt) &&
      typeof item.generation.title === "string"
    ).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch { return []; }
}

export default function LibraryPane() {
  const { tabs, openTab, activateTab, updateTab } = useTabManager();
  const [data, setData] = useState<WorldLibrary>(EMPTY);
  const [bands, setBands] = useState<BandProfile[]>([]);
  const [generatedProjects, setGeneratedProjects] = useState(readGeneratedProjects);
  const [generations, setGenerations] = useState<GenerationRecord[]>(listGenerations);
  const [generationFolders, setGenerationFolders] = useState<GenerationFolder[]>(listGenerationFolders);
  const [generationLayout, setGenerationLayout] = useState<"grid" | "list">("grid");
  const [generationQuery, setGenerationQuery] = useState("");
  const [generationStatus, setGenerationStatus] = useState("all");
  const [generationFolder, setGenerationFolder] = useState("all");
  const [selectedGeneratedId, setSelectedGeneratedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [section, setSection] = useState<Section>("all");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isPublic, setIsPublic] = useState(true);

  const loadWorld = async () => {
    setLoading(true); setError("");
    try { setData(await fetchWorldLibrary()); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : "Could not load your online music library"); }
    finally { setLoading(false); }
  };
  const loadBands = async () => { try { setBands(await listBandProfiles()); } catch { /* Band profiles are optional in this view. */ } };

  useEffect(() => { void loadWorld(); void loadBands(); }, []);
  useEffect(() => {
    const refresh = () => setGeneratedProjects(readGeneratedProjects());
    const refreshGenerations = () => { setGenerations(listGenerations()); setGenerationFolders(listGenerationFolders()); };
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refreshGenerations);
    window.addEventListener("storage", refreshGenerations);
    window.addEventListener("ysong:generations-changed", refreshGenerations);
    return () => { window.removeEventListener("focus", refresh); window.removeEventListener("storage", refresh); window.removeEventListener("focus", refreshGenerations); window.removeEventListener("storage", refreshGenerations); window.removeEventListener("ysong:generations-changed", refreshGenerations); };
  }, []);
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
  const viewGeneratedInDaw = (id: string) => {
    const request = { id, requestId: crypto.randomUUID() };
    const existing = tabs.find((t) => t.type === "daw");
    if (existing) {
      updateTab(existing.id, { payload: { ...existing.payload, localProjectOpenRequest: request } });
      activateTab(existing.id);
    } else {
      openTab({ type: "daw", title: "DAW", pinned: true, payload: { localProjectOpenRequest: request } });
    }
  };
  const importGenerationInDaw = (id: string) => {
    const generation = generations.find((record) => record.id === id);
    if (!generation) return;
    if (!generation.songResult && !generation.artifacts.some((artifact) => artifact.kind === "audio" && (artifact.objectKey || artifact.url))) {
      const projectId = generation.artifacts.find((artifact) => artifact.kind === "project" && artifact.projectId)?.projectId;
      if (projectId) viewGeneratedInDaw(projectId);
      return;
    }
    const request = { id, requestId: crypto.randomUUID() };
    const existing = tabs.find((t) => t.type === "daw");
    if (existing) {
      updateTab(existing.id, { payload: { ...existing.payload, generationImportRequest: request } });
      activateTab(existing.id);
    } else {
      openTab({ type: "daw", title: "DAW", pinned: true, payload: { generationImportRequest: request } });
    }
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
    catch (e: unknown) { setError(e instanceof Error ? e.message : "Could not create playlist"); }
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

  const allMusic = useMemo(() => {
    const byId = new Map<string, WorldLibrary["tracks"][number]>();
    for (const track of data.uploads) byId.set(track.id, track);
    for (const track of data.tracks) byId.set(track.id, track);
    return [...byId.values()];
  }, [data.tracks, data.uploads]);

  const counts = useMemo(() => ({
    all: allMusic.length,
    generated: generatedProjects.length,
    generations: generations.length,
    saved: data.tracks.length,
    albums: data.releases.length,
    artists: data.artists.length,
    bands: bands.length,
    playlists: data.playlists.length + data.savedPlaylists.length,
    uploads: data.uploads.length,
  }), [allMusic.length, data, bands, generatedProjects.length, generations.length]);

  const visibleGenerations = generations.filter((record) => (generationStatus === "all" || record.status === generationStatus) && (generationFolder === "all" || (generationFolder === "unfiled" ? !record.folderId : record.folderId === generationFolder)) && `${record.title} ${record.source.prompt} ${record.source.style || ""}`.toLowerCase().includes(generationQuery.toLowerCase().trim()));
  const addGenerationFolder = () => { const name = window.prompt("Name this folder"); if (name?.trim()) createGenerationFolder(name); };
  const renameFolder = (folder: GenerationFolder) => { const name = window.prompt("Rename folder", folder.name); if (name?.trim()) renameGenerationFolder(folder.id, name); };
  const removeFolder = (folder: GenerationFolder) => { const count = generations.filter((record) => record.folderId === folder.id).length; if (!window.confirm(`Delete folder “${folder.name}”? ${count} generation${count === 1 ? "" : "s"} will be kept in Unfiled. Linked projects remain untouched.`)) return; deleteGenerationFolder(folder.id); if (generationFolder === folder.id) setGenerationFolder("all"); };
  const removeGeneration = (record: GenerationRecord) => { if (window.confirm(`Remove “${record.title || "Untitled generation"}” from the generations library? Its linked project and artifacts will remain.`)) deleteGeneration(record.id); };

  return <div className="h-full min-h-0 overflow-y-auto bg-neutral-950 text-neutral-100">
    <div className="p-4 md:p-6 pb-28 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6"><div><div className="text-xs uppercase tracking-[.22em] text-indigo-300">Everything you kept</div><h1 className="text-3xl font-semibold mt-1">Your Library</h1><p className="text-sm text-neutral-400 mt-1">Saved music, local generated sessions, artists, bands, playlists and your own uploads.</p></div><div className="flex flex-wrap gap-2"><YSButton onClick={newBand} className="rounded-xl border border-fuchsia-400/30 px-4 py-2">+ New Band</YSButton><YSButton onClick={() => setCreating((v) => !v)} className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2">+ New Playlist</YSButton><YSButton onClick={() => openWorld()} className="rounded-xl border border-neutral-700 px-4 py-2">Explore World</YSButton></div></div>

      {creating && <div className="mb-6 rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 grid gap-3"><div className="font-semibold">Create playlist</div><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Playlist title" className="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 outline-none focus:border-indigo-400" /><textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" rows={2} className="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 outline-none focus:border-indigo-400 resize-y" /><label className="text-sm flex items-center gap-2"><input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} /> Public playlist</label><div className="flex gap-2"><YSButton onClick={createPlaylist} className="rounded-lg bg-indigo-600 px-4 py-2">Create</YSButton><YSButton onClick={() => setCreating(false)} className="rounded-lg border border-neutral-700 px-4 py-2">Cancel</YSButton></div></div>}

      <div className="flex gap-2 overflow-x-auto pb-2 mb-5 no-scrollbar">{(["all","generations","generated","saved","uploads","albums","artists","bands","playlists"] as Section[]).map((key) => <button key={key} onClick={() => setSection(key)} className={`shrink-0 rounded-full px-4 py-2 text-sm border ${section === key ? "bg-white text-black border-white" : "border-neutral-700 hover:bg-neutral-900"}`}>{label(key)} <span className="opacity-60">{counts[key]}</span></button>)}</div>

      {error && <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>}
      {section === "generations" ? <GenerationLibrary records={visibleGenerations} folders={generationFolders} selectedFolder={generationFolder} onFolder={setGenerationFolder} onCreateFolder={addGenerationFolder} onRenameFolder={renameFolder} onDeleteFolder={removeFolder} onMove={(id, folderId) => moveGenerationToFolder(id, folderId || undefined)} onDelete={removeGeneration} query={generationQuery} onQuery={setGenerationQuery} status={generationStatus} onStatus={setGenerationStatus} layout={generationLayout} onLayout={setGenerationLayout} onOpen={viewGeneratedInDaw} onImport={importGenerationInDaw} /> : section === "generated" ? <GeneratedSessions projects={generatedProjects} selectedId={selectedGeneratedId} onSelect={setSelectedGeneratedId} onView={viewGeneratedInDaw} /> : section === "bands" ? <BandsSection bands={bands} onOpen={openBand} onNew={newBand} /> : loading ? <div className="text-neutral-400">Loading your library…</div> : <>
        {section === "all" && <TrackListEmptyAware tracks={allMusic} empty="Your saved songs and YSong uploads will appear here." onOpen={(id) => openWorld("track", id)} />}
        {section === "saved" && <TrackListEmptyAware tracks={data.tracks} empty="Songs you save in YSong World will appear here." onOpen={(id) => openWorld("track", id)} />}
        {section === "albums" && (data.releases.length ? <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">{data.releases.map((r) => <button key={r.id} onClick={() => openWorld("release", r.id)} className="text-left min-w-0"><Cover trackId={r.coverTrackId} /><div className="font-medium text-sm mt-2 truncate">{r.title}</div><div className="text-xs text-neutral-400 truncate">{r.artistName}</div></button>)}</div> : <Empty text="Albums and releases you save will appear here." />)}
        {section === "artists" && (data.artists.length ? <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{data.artists.map((a) => <div key={`${a.ownerUserId}:${a.artistName}`} className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4 flex items-center gap-3"><div className="h-12 w-12 rounded-full bg-gradient-to-br from-indigo-500/40 to-fuchsia-500/20 grid place-items-center text-xl font-bold">{a.artistName.slice(0,1).toUpperCase()}</div><div className="min-w-0 flex-1"><div className="font-semibold truncate">{a.artistName}</div><div className="text-xs text-neutral-500">Following</div></div><button onClick={() => void unfollowArtist(a.ownerUserId, a.artistName)} className="rounded-lg border border-neutral-700 px-2.5 py-1.5 text-xs text-neutral-300 hover:border-red-400/40 hover:text-red-300">Unfollow</button></div>)}</div> : <Empty text="Artists you follow will appear here." />)}
        {section === "playlists" && <PlaylistSection own={data.playlists} saved={data.savedPlaylists} onOpen={(id) => openWorld("playlist", id)} onDelete={removePlaylist} />}
        {section === "uploads" && <TrackListEmptyAware tracks={data.uploads} empty="Your YSong World uploads will appear here." onOpen={(id) => openWorld("track", id)} onRemove={removeUpload} />}
      </>}
    </div>
  </div>;
}

function label(section: Section) { return ({ all:"All Music", generated:"Local Projects", generations:"Generations", saved:"Saved Songs", albums:"Albums", artists:"Artists", bands:"Bands", playlists:"Playlists", uploads:"Your Uploads" } as const)[section]; }
function GenerationLibrary({ records, folders, selectedFolder, onFolder, onCreateFolder, onRenameFolder, onDeleteFolder, onMove, onDelete, query, onQuery, status, onStatus, layout, onLayout, onOpen, onImport }: { records: GenerationRecord[]; folders: GenerationFolder[]; selectedFolder: string; onFolder: (id: string) => void; onCreateFolder: () => void; onRenameFolder: (folder: GenerationFolder) => void; onDeleteFolder: (folder: GenerationFolder) => void; onMove: (id: string, folderId: string) => void; onDelete: (record: GenerationRecord) => void; query: string; onQuery: (value: string) => void; status: string; onStatus: (value: string) => void; layout: "grid" | "list"; onLayout: (value: "grid" | "list") => void; onOpen: (id: string) => void; onImport: (id: string) => void }) {
  return <section aria-label="Song generations">
    <div className="flex flex-wrap items-center gap-2 mb-3"><input aria-label="Search generations" value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search titles and prompts" className="min-w-48 flex-1 rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" /><select aria-label="Filter by generation status" value={status} onChange={(event) => onStatus(event.target.value)} className="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"><option value="all">All statuses</option><option value="queued">Queued</option><option value="running">In progress</option><option value="succeeded">Complete</option><option value="partial">Partial</option><option value="failed">Failed</option><option value="cancelled">Cancelled</option></select><select aria-label="Filter by folder" value={selectedFolder} onChange={(event) => onFolder(event.target.value)} className="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"><option value="all">All folders</option><option value="unfiled">Unfiled</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select><button onClick={onCreateFolder} className="rounded-xl border border-indigo-400/40 px-3 py-2 text-sm text-indigo-200">+ Folder</button><div className="flex rounded-xl border border-neutral-700 p-1"><button type="button" aria-pressed={layout === "grid"} onClick={() => onLayout("grid")} className={`rounded-lg px-3 py-1 text-xs ${layout === "grid" ? "bg-neutral-700" : "text-neutral-400"}`}>Grid</button><button type="button" aria-pressed={layout === "list"} onClick={() => onLayout("list")} className={`rounded-lg px-3 py-1 text-xs ${layout === "list" ? "bg-neutral-700" : "text-neutral-400"}`}>List</button></div></div>
    {selectedFolder !== "all" && selectedFolder !== "unfiled" && folders.find((folder) => folder.id === selectedFolder) && <div className="flex gap-3 mb-4 text-xs"><button onClick={() => onRenameFolder(folders.find((folder) => folder.id === selectedFolder)!)} className="text-neutral-400 hover:text-white">Rename folder</button><button onClick={() => onDeleteFolder(folders.find((folder) => folder.id === selectedFolder)!)} className="text-red-300 hover:text-red-200">Delete folder</button></div>}
    {!records.length ? <Empty text={query || status !== "all" || selectedFolder !== "all" ? "No generations match these filters." : "Your song generations will appear here. Create Song sessions are saved automatically."} /> : <div className={layout === "grid" ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" : "space-y-2"}>{records.map((record) => { const lineage = record.lineage; const parent = lineage?.parentId ? records.find((item) => item.id === lineage.parentId) : undefined; return <article key={record.id} className={`min-w-0 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4 ${layout === "list" ? "flex flex-wrap items-center gap-4" : ""}`}><div className="flex min-w-0 flex-1 items-start justify-between gap-3"><div className="min-w-0"><h2 className="truncate font-semibold">{record.title || "Untitled generation"}</h2><p className="mt-1 line-clamp-2 text-sm text-neutral-400">{record.source.prompt || "No prompt metadata"}</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${record.status === "succeeded" ? "bg-emerald-500/10 text-emerald-300" : record.status === "failed" ? "bg-red-500/10 text-red-300" : "bg-amber-500/10 text-amber-200"}`}>{record.status === "succeeded" ? "Complete" : record.status === "partial" ? "Partial" : record.status === "running" ? "In progress" : record.status}</span></div><div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500"><span>{new Date(record.createdAt).toLocaleString()}</span><span>{record.source.style || record.source.origin || "Song generation"}</span></div>{lineage && <p className="mt-2 text-[11px] text-indigo-300">Version {lineage.version} · {lineage.operation}{parent ? ` · from ${parent.title}` : " · original"}</p>}<div className="mt-3 flex items-center gap-2"><select aria-label={`Move ${record.title} to folder`} value={record.folderId || ""} onChange={(event) => onMove(record.id, event.target.value)} className="rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs"><option value="">Unfiled</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select><button onClick={() => onImport(record.id)} disabled={(record.status !== "succeeded" && record.status !== "partial") || !(record.songResult?.parts.some((part) => part.status === "ready") || record.artifacts.some((artifact) => (artifact.kind === "audio" && (artifact.objectKey || artifact.url)) || (artifact.kind === "project" && artifact.projectId)))} className="rounded-lg border border-emerald-400/40 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-500/10 disabled:opacity-40">Open in DAW</button><button onClick={() => onDelete(record)} className="rounded-lg px-2 py-1.5 text-xs text-red-300 hover:bg-red-500/10">Remove</button></div>{record.artifacts.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{record.artifacts.map((artifact) => artifact.projectId ? <button key={artifact.id} type="button" onClick={() => onOpen(artifact.projectId!)} className="rounded-lg border border-indigo-400/40 px-3 py-1.5 text-xs text-indigo-200 hover:bg-indigo-500/10">Open {artifact.label}</button> : <span key={artifact.id} className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-400">{artifact.label}</span>)}</div>}{record.error && <p className="mt-3 text-xs text-red-300">{record.error}</p>}{record.songResult?.parts.filter((part) => part.status === "failed").map((part) => <p key={part.id} className="mt-2 text-xs text-amber-200">{part.name}: {part.failure?.message}</p>)}</article>; })}</div>}
  </section>;
}
function GeneratedSessions({ projects, selectedId, onSelect, onView }: { projects: GeneratedProject[]; selectedId: string | null; onSelect: (id: string) => void; onView: (id: string) => void }) {
  if (!projects.length) return <Empty text="Whole-song sessions saved locally from Create Song will appear here." />;
  return <div>
    <p className="mb-3 text-xs text-neutral-500">On this browser only · Recent local projects</p>
    <div className="rounded-2xl border border-neutral-800 overflow-hidden">{projects.map((project) => <div key={project.id} className="border-b last:border-0 border-neutral-800">
      <button type="button" onClick={() => onSelect(project.id)} aria-expanded={selectedId === project.id} className={`w-full text-left p-3 hover:bg-neutral-900 ${selectedId === project.id ? "bg-neutral-900" : ""}`}>
        <div className="flex justify-between gap-3"><span className="font-medium truncate">{project.name || "Untitled Project"}</span><span className="text-xs text-indigo-300 shrink-0">Generated session</span></div>
        <div className="text-xs text-neutral-500 mt-1 truncate">{project.generation.title && project.generation.title !== project.name ? `${project.generation.title} · ` : ""}{new Date(project.generation.createdAt).toLocaleString()}</div>
        <div className="text-[11px] text-neutral-600 mt-1 break-all">Local project ID: {project.id}</div>
      </button>
      {selectedId === project.id && <div className="px-3 pb-3"><button type="button" onClick={() => onView(project.id)} className="rounded-lg border border-indigo-400/50 px-3 py-2 text-sm text-indigo-200 hover:bg-indigo-500/10">View in DAW</button></div>}
    </div>)}</div>
  </div>;
}
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
