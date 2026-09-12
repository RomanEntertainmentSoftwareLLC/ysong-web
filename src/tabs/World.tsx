import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTabManager } from "./core";
import { YSButton } from "../components/YSButton";
import EmojiPickerButton from "../components/EmojiPicker";
import worldWordmark from "../assets/ysong-world.png";
import { useWorldPlayer } from "../components/WorldPlayer";
import { bridgeApi, normalizeVisualAdvertisingSettings, normalizeVisualBroadcastGlobals, normalizeVisualBroadcastProgram, type VisualAdCreative, type VisualVideoPrerollCreative, type VisualAdvertisingSettings, type VisualBroadcastAssignment, type VisualBroadcastGlobals, type VisualBroadcastProgram, type VisualScenePreset } from "../lib/bridgeApi";
import { normalizeVisualScene, type VisualSceneState } from "../lib/visualsScene";
import { applyRadioStationDefaults, radioProgramId, tracksForRadioStation, ysongRadioStationsForCatalog, type YSongRadioStation } from "../lib/ysongRadio";
import {
	addTrackToWorldPlaylist,
	createWorldComment,
	deleteWorldComment,
	fetchPublicPlaylists,
	fetchWorldComments,
	fetchWorldLibrary,
	fetchWorldPlaylist,
	fetchWorldRelease,
	fetchWorldTrack,
	fetchWorldTracks,
	reactToWorldTrack,
	removeWorldTrack,
	removeWorldRelease,
	removeTrackFromWorldPlaylist,
	reorderWorldPlaylist,
	reportWorldComment,
	toggleWorldArtistFollow,
	toggleWorldCommentLike,
	toggleWorldCommentPin,
	toggleWorldPlaylistSave,
	toggleWorldReleaseSave,
	toggleWorldTrackSave,
	updateWorldRelease,
	updateWorldTrack,
	worldArtworkUrl,
	type WorldComment,
	type WorldPlaylist,
	type WorldPlaylistDetail,
	type WorldRelease,
	type WorldTrack,
} from "../lib/worldApi";

function prettyCount(n: number) {
	return Intl.NumberFormat(undefined, { notation: n >= 1000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(n || 0);
}
function durationLabel(seconds?: number | null) {
	if (!seconds || !Number.isFinite(seconds)) return "";
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60).toString().padStart(2, "0");
	return `${m}:${s}`;
}
function trackScore(t: WorldTrack) { return t.playCount + t.likes * 12 - t.dislikes * 4; }
function releaseSeeds(tracks: WorldTrack[]) {
	const map = new Map<string, WorldTrack>();
	for (const track of tracks) if (!map.has(track.releaseId)) map.set(track.releaseId, track);
	return [...map.values()];
}
function uniqueTracks(list: WorldTrack[]) {
	const seen = new Set<string>();
	return list.filter((t) => !seen.has(t.id) && seen.add(t.id));
}
function errorMessage(error: unknown, fallback: string) {
	return error instanceof Error && error.message ? error.message : fallback;
}

export default function WorldPane() {
	const { tabs, openTab, activateTab } = useTabManager();
	const [tracks, setTracks] = useState<WorldTrack[]>([]);
	const [playlists, setPlaylists] = useState<WorldPlaylist[]>([]);
	const [genres, setGenres] = useState<string[]>([]);
	const [search, setSearch] = useState("");
	const [genre, setGenre] = useState("all");
	const [sort, setSort] = useState("algorithm");
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [release, setRelease] = useState<WorldRelease | null>(null);
	const [detailTrack, setDetailTrack] = useState<WorldTrack | null>(null);
	const [playlistDetail, setPlaylistDetail] = useState<WorldPlaylistDetail | null>(null);
	const [editingTrack, setEditingTrack] = useState<WorldTrack | null>(null);
	const [editingRelease, setEditingRelease] = useState<WorldRelease | null>(null);
	const [radioStudio, setRadioStudio] = useState<YSongRadioStation | null>(null);
	const [advertisingStudio, setAdvertisingStudio] = useState(false);
	const { current, playing, startQueue } = useWorldPlayer();

	const patchTrackEverywhere = (trackId: string, patch: Partial<WorldTrack>) => {
		const apply = (x: WorldTrack) => x.id === trackId ? { ...x, ...patch } : x;
		setTracks((prev) => prev.map(apply));
		setRelease((prev) => prev ? { ...prev, tracks: prev.tracks.map(apply) } : prev);
		setDetailTrack((prev) => prev?.id === trackId ? { ...prev, ...patch } : prev);
		setPlaylistDetail((prev) => prev ? { ...prev, tracks: prev.tracks.map(apply) } : prev);
	};

	const patchArtistEverywhere = (ownerUserId: string, artistName: string, followed: boolean) => {
		const apply = (x: WorldTrack) => x.ownerUserId === ownerUserId && x.artistName === artistName ? { ...x, isArtistFollowed: followed } : x;
		setTracks((prev) => prev.map(apply));
		setRelease((prev) => prev ? { ...prev, isArtistFollowed: prev.ownerUserId === ownerUserId && prev.artistName === artistName ? followed : prev.isArtistFollowed, tracks: prev.tracks.map(apply) } : prev);
		setDetailTrack((prev) => prev ? apply(prev) : prev);
		setPlaylistDetail((prev) => prev ? { ...prev, tracks: prev.tracks.map(apply) } : prev);
	};

	const load = async () => {
		setLoading(true); setError("");
		try {
			const [music, publicLists] = await Promise.all([fetchWorldTracks({ search, genre, sort }), fetchPublicPlaylists()]);
			setTracks(music.tracks || []); setGenres(music.genres || []); setPlaylists(publicLists.playlists || []);
		} catch (e: any) { setError(e?.message || "Could not load YSong World"); }
		finally { setLoading(false); }
	};

	useEffect(() => { const t = setTimeout(load, 180); return () => clearTimeout(t); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [search, genre, sort]);

	useEffect(() => {
		const onPlayCount = (event: Event) => {
			const detail = (event as CustomEvent<{ trackId?: string; playCount?: number }>).detail || {};
			if (!detail.trackId || !Number.isFinite(detail.playCount)) return;
			patchTrackEverywhere(detail.trackId, { playCount: Number(detail.playCount) });
		};
		const onTrackPatch = (event: Event) => {
			const detail = (event as CustomEvent<{ trackId?: string; patch?: Partial<WorldTrack> }>).detail || {};
			if (detail.trackId && detail.patch) patchTrackEverywhere(detail.trackId, detail.patch);
		};
		const onArtistPatch = (event: Event) => {
			const detail = (event as CustomEvent<{ ownerUserId?: string; artistName?: string; followed?: boolean }>).detail || {};
			if (detail.ownerUserId && detail.artistName && typeof detail.followed === "boolean") patchArtistEverywhere(detail.ownerUserId, detail.artistName, detail.followed);
		};
		const onReleasePatch = (event: Event) => {
			const detail = (event as CustomEvent<{ releaseId?: string; saved?: boolean }>).detail || {};
			if (!detail.releaseId || typeof detail.saved !== "boolean") return;
			const releaseId = detail.releaseId;
			const saved = detail.saved;
			const apply = (x: WorldTrack) => x.releaseId === releaseId ? { ...x, isReleaseSaved: saved } : x;
			setTracks((prev) => prev.map(apply));
			setRelease((prev) => prev && prev.id === releaseId ? { ...prev, isSaved: saved, tracks: prev.tracks.map(apply) } : prev);
			setDetailTrack((prev) => prev && prev.releaseId === releaseId ? { ...prev, isReleaseSaved: saved } : prev);
			setPlaylistDetail((prev) => prev ? { ...prev, tracks: prev.tracks.map(apply) } : prev);
		};
		window.addEventListener("ysong:world-play-count", onPlayCount as EventListener);
		window.addEventListener("ysong:world-track-patch", onTrackPatch as EventListener);
		window.addEventListener("ysong:world-artist-patch", onArtistPatch as EventListener);
		window.addEventListener("ysong:world-release-patch", onReleasePatch as EventListener);
		return () => { window.removeEventListener("ysong:world-play-count", onPlayCount as EventListener); window.removeEventListener("ysong:world-track-patch", onTrackPatch as EventListener); window.removeEventListener("ysong:world-artist-patch", onArtistPatch as EventListener); window.removeEventListener("ysong:world-release-patch", onReleasePatch as EventListener); };
	}, []);

	useEffect(() => {
		const onOpen = async (event: Event) => {
			const d = (event as CustomEvent<{ entityType?: string; entityId?: string }>).detail || {};
			try {
				if (d.entityType === "track" && d.entityId) { setRelease(null); setPlaylistDetail(null); setDetailTrack((await fetchWorldTrack(d.entityId)).track); }
				if (d.entityType === "release" && d.entityId) { setDetailTrack(null); setPlaylistDetail(null); setRelease(await fetchWorldRelease(d.entityId)); }
				if (d.entityType === "playlist" && d.entityId) { setDetailTrack(null); setRelease(null); setPlaylistDetail(await fetchWorldPlaylist(d.entityId)); }
			} catch (e: any) { setError(e?.message || "Could not open item"); }
		};
		window.addEventListener("ysong:open-world-entity", onOpen as EventListener);
		return () => window.removeEventListener("ysong:open-world-entity", onOpen as EventListener);
	}, []);

	const openUpload = () => {
		const existing = tabs.find((t) => t.type === "upload");
		if (existing) activateTab(existing.id); else openTab({ type: "upload", title: "Upload Music", pinned: true });
	};

	const react = async (track: WorldTrack, value: -1 | 1) => {
		try { const r = await reactToWorldTrack(track.id, value); patchTrackEverywhere(track.id, { myReaction: r.reaction, likes: r.likes, dislikes: r.dislikes }); } catch {}
	};
	const toggleTrackSave = async (track: WorldTrack) => {
		try { const r = await toggleWorldTrackSave(track.id); patchTrackEverywhere(track.id, { isSaved: r.saved }); } catch {}
	};
	const toggleReleaseSave = async (releaseId: string) => {
		try {
			const r = await toggleWorldReleaseSave(releaseId);
			const apply = (x: WorldTrack) => x.releaseId === releaseId ? { ...x, isReleaseSaved: r.saved } : x;
			setTracks((prev) => prev.map(apply));
			setRelease((prev) => prev?.id === releaseId ? { ...prev, isSaved: r.saved, tracks: prev.tracks.map(apply) } : prev);
			setDetailTrack((prev) => prev?.releaseId === releaseId ? { ...prev, isReleaseSaved: r.saved } : prev);
			setPlaylistDetail((prev) => prev ? { ...prev, tracks: prev.tracks.map(apply) } : prev);
		} catch {}
	};
	const toggleArtist = async (track: WorldTrack) => {
		try { const r = await toggleWorldArtistFollow(track.ownerUserId, track.artistName); patchArtistEverywhere(track.ownerUserId, track.artistName, r.followed); } catch {}
	};

	const openRelease = async (releaseId: string) => {
		try { setDetailTrack(null); setPlaylistDetail(null); setRelease(await fetchWorldRelease(releaseId)); }
		catch (e: any) { setError(e?.message || "Could not open release"); }
	};
	const openTrack = async (track: WorldTrack) => { setDetailTrack(track); };
	const openPlaylist = async (id: string) => {
		try { setDetailTrack(null); setRelease(null); setPlaylistDetail(await fetchWorldPlaylist(id)); }
		catch (e: any) { setError(e?.message || "Could not open playlist"); }
	};

	const startBuiltInRadio = (station: YSongRadioStation) => {
		const stationTracks = tracksForRadioStation(station, tracks);
		if (!stationTracks.length) return;
		startQueue(stationTracks, `YSong Radio · ${station.name}`, undefined, "", radioProgramId(station.id), "radio");
	};

	const startArtistRadio = (seed: WorldTrack) => {
		const sameArtist = tracks.filter((t) => t.ownerUserId === seed.ownerUserId && t.artistName === seed.artistName);
		const related = tracks.filter((t) => t.genre === seed.genre && t.artistName !== seed.artistName).sort((a,b) => trackScore(b)-trackScore(a));
		const rest = tracks.filter((t) => t.genre !== seed.genre).sort((a,b) => trackScore(b)-trackScore(a));
		startQueue(uniqueTracks([seed, ...sameArtist, ...related, ...rest]), `${seed.artistName} Radio`, seed.id, "", "", "radio");
	};
	const startGenreRadio = (genreName: string, seed?: WorldTrack) => {
		const inGenre = tracks.filter((t) => t.genre === genreName).sort((a,b) => trackScore(b)-trackScore(a));
		if (!inGenre.length) return;
		const start = seed && inGenre.some((t) => t.id === seed.id) ? seed : inGenre[0];
		startQueue(uniqueTracks([start, ...inGenre]), `${genreName} Radio`, start.id, "", "", "radio");
	};
	const startSongRadio = (seed: WorldTrack) => {
		const related = tracks.filter((t) => t.id !== seed.id).sort((a,b) => {
			const aRel = (a.genre === seed.genre ? 10000 : 0) + a.tags.filter((x) => seed.tags.includes(x)).length * 2000 + trackScore(a);
			const bRel = (b.genre === seed.genre ? 10000 : 0) + b.tags.filter((x) => seed.tags.includes(x)).length * 2000 + trackScore(b);
			return bRel - aRel;
		});
		startQueue([seed, ...related], `${seed.title} Radio`, seed.id, "", "", "radio");
	};

	const saveTrackEdit = async (draft: WorldTrack) => {
		const result = await updateWorldTrack(draft.id, { title: draft.title, genre: draft.genre, tags: draft.tags, description: draft.description || "", explicit: draft.explicit, trackNumber: draft.trackNumber, isrc: draft.isrc || "", previouslyReleased: !!draft.previouslyReleased });
		patchTrackEverywhere(result.track.id, result.track); if (release?.id === result.track.releaseId) setRelease(await fetchWorldRelease(release.id)); setEditingTrack(null);
	};
	const saveReleaseEdit = async (draft: WorldRelease) => {
		await updateWorldRelease(draft.id, { artistName: draft.artistName, title: draft.title, genre: draft.genre });
		setRelease(await fetchWorldRelease(draft.id)); setEditingRelease(null); await load();
	};

	const removeTrackFromWorld = async (track: WorldTrack) => {
		if (!track.isOwner) return;
		if (!window.confirm(`Remove “${track.title}” from YSong World?\n\nThis removes its World listing, comments, reactions and World analytics records. The uploaded source file and artist identity are kept.`)) return;
		try {
			const result = await removeWorldTrack(track.id);
			setTracks((prev) => prev.filter((x) => x.id !== track.id));
			setDetailTrack((prev) => prev?.id === track.id ? null : prev);
			setPlaylistDetail((prev) => prev ? { ...prev, tracks: prev.tracks.filter((x) => x.id !== track.id) } : prev);
			if (release?.id === track.releaseId) {
				if (result.releaseDeleted) setRelease(null);
				else setRelease(await fetchWorldRelease(track.releaseId));
			}
			await load();
		} catch (e: any) { setError(e?.message || "Could not remove song from YSong World"); }
	};

	const removeReleaseFromWorld = async (item: WorldRelease) => {
		if (!item.isOwner) return;
		if (!window.confirm(`Remove the complete release “${item.title}” from YSong World?\n\nAll World tracks in this release and their comments/reactions/World analytics will be removed. The artist identity is kept.`)) return;
		try { await removeWorldRelease(item.id); setRelease(null); setEditingRelease(null); await load(); }
		catch (e: any) { setError(e?.message || "Could not remove release from YSong World"); }
	};

	const released = useMemo(() => releaseSeeds(tracks).sort((a,b) => +new Date(b.publishedAt) - +new Date(a.publishedAt)), [tracks]);
	const oneWeekAgo = Date.now() - 7 * 86400_000;
	const releasedThisWeek = released.filter((t) => +new Date(t.publishedAt) >= oneWeekAgo).slice(0, 30);
	const albumPicks = useMemo(() => releaseSeeds(tracks).filter((t) => t.releaseType === "album").sort((a,b) => trackScore(b)-trackScore(a)).slice(0, 40), [tracks]);
	const trending = useMemo(() => [...tracks].sort((a,b) => trackScore(b)-trackScore(a)).slice(0, 12), [tracks]);
	const filteredMode = !!search.trim() || genre !== "all" || sort !== "algorithm";
	const radioEntries = useMemo(() => ysongRadioStationsForCatalog(tracks).map((station) => ({ station, tracks: tracksForRadioStation(station, tracks) })), [tracks]);

	return <div className="h-full min-h-0 flex flex-col bg-neutral-950 text-neutral-100"><div className="flex-1 min-h-0 overflow-y-auto"><div className="p-4 md:p-6 pb-24">
		{detailTrack ? <TrackDetailView track={detailTrack} onBack={() => setDetailTrack(null)} onPlay={(track) => startQueue(tracks, "YSong World", track.id)} onReact={react} onSave={toggleTrackSave} onSaveRelease={() => toggleReleaseSave(detailTrack.releaseId)} onFollow={() => toggleArtist(detailTrack)} onOpenRelease={() => openRelease(detailTrack.releaseId)} onArtistRadio={() => startArtistRadio(detailTrack)} onSongRadio={() => startSongRadio(detailTrack)} onRemove={() => void removeTrackFromWorld(detailTrack)} />
		: playlistDetail ? <PlaylistView detail={playlistDetail} onBack={() => setPlaylistDetail(null)} onPlay={(track) => startQueue(playlistDetail.tracks, playlistDetail.playlist.title, track.id, playlistDetail.playlist.id)} onOpenTrack={openTrack} onSavePlaylist={async () => { const r=await toggleWorldPlaylistSave(playlistDetail.playlist.id); setPlaylistDetail((p)=>p?{...p,playlist:{...p.playlist,isSaved:r.saved}}:p); setPlaylists((prev)=>prev.map((p)=>p.id===playlistDetail.playlist.id?{...p,isSaved:r.saved}:p)); }} onPlayAll={() => startQueue(playlistDetail.tracks, playlistDetail.playlist.title, undefined, playlistDetail.playlist.id)} onRemove={async (trackId) => { await removeTrackFromWorldPlaylist(playlistDetail.playlist.id,trackId); setPlaylistDetail(await fetchWorldPlaylist(playlistDetail.playlist.id)); }} onMove={async (trackId,dir) => { if(!playlistDetail.playlist.isOwner)return; const ids=playlistDetail.tracks.map((t)=>t.id); const i=ids.indexOf(trackId), j=i+dir; if(i<0||j<0||j>=ids.length)return; [ids[i],ids[j]]=[ids[j],ids[i]]; await reorderWorldPlaylist(playlistDetail.playlist.id,ids); setPlaylistDetail(await fetchWorldPlaylist(playlistDetail.playlist.id)); }} />
		: release ? <ReleaseView release={release} onBack={() => setRelease(null)} onPlay={(track) => startQueue(release.tracks, release.title, track.id)} onReact={react} onOpenTrack={openTrack} onEditTrack={setEditingTrack} onEditRelease={() => setEditingRelease(release)} onSaveRelease={() => toggleReleaseSave(release.id)} onFollowArtist={() => release.tracks[0] && toggleArtist(release.tracks[0])} onArtistRadio={() => release.tracks[0] && startArtistRadio(release.tracks[0])} onSaveTrack={toggleTrackSave} onSongRadio={startSongRadio} onRemoveTrack={removeTrackFromWorld} onRemoveRelease={() => void removeReleaseFromWorld(release)} currentId={current?.id} playing={playing} />
		: <>
			<div className="flex flex-col lg:flex-row lg:items-end gap-4 justify-between mb-5"><div className="min-w-0"><div className="text-xs uppercase tracking-[0.22em] text-indigo-300">Independent music lives here</div><img src={worldWordmark} alt="YSong World" className="mt-2 h-[72px] w-[min(78vw,300px)] md:h-[86px] md:w-[360px] max-w-full object-cover object-center" /><p className="text-sm text-neutral-400 mt-2">Discover releases, songs, playlists and artists without turning your mobile device into a tiny desktop grid.</p></div><YSButton onClick={openUpload} className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 border border-indigo-400/40 font-medium">+ Upload Music</YSButton></div>
			<div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_180px_180px] gap-3 mb-4"><div className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 flex items-center gap-2"><span className="text-neutral-500">⌕</span><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search songs, artists, albums or tags" className="w-full bg-transparent outline-none py-2.5 text-sm" /></div><select value={genre} onChange={(e)=>setGenre(e.target.value)} className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-sm"><option value="all">All genres</option>{genres.map((g)=><option key={g} value={g}>{g}</option>)}</select><select value={sort} onChange={(e)=>setSort(e.target.value)} className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-sm"><option value="algorithm">For You</option><option value="newest">Newest</option><option value="popular">Most Played</option></select></div>
			{genres.length>0 && <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2 mb-2"><button onClick={()=>setGenre("all")} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs ${genre==="all"?"bg-white text-black border-white":"border-neutral-700"}`}>All</button>{genres.slice(0,18).map((g)=><button key={g} onClick={()=>setGenre(g)} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs ${genre===g?"bg-white text-black border-white":"border-neutral-700 hover:bg-neutral-900"}`}>{g}</button>)}</div>}{genre!=="all"&&<div className="mb-5"><button onClick={()=>startGenreRadio(genre)} className="text-xs text-indigo-300 hover:text-indigo-200">📻 Start {genre} Radio</button></div>}
			{error && <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>}
			{loading ? <div className="text-neutral-400">Loading YSong World…</div> : tracks.length===0 ? <div className="rounded-2xl border border-dashed border-neutral-700 bg-neutral-900/50 p-10 text-center"><div className="text-5xl mb-3">🌎</div><h2 className="text-xl font-semibold">YSong World is empty.</h2><p className="text-neutral-400 mt-1 mb-4">Be the first artist to ruin the silence.</p><YSButton onClick={openUpload} className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2">Upload Music</YSButton></div>
			: filteredMode ? <div><SectionTitle title="Results" subtitle={`${tracks.length} songs`} /> <div className="rounded-2xl border border-neutral-800 overflow-hidden">{tracks.map((t)=><TrackRow key={t.id} track={t} current={current?.id===t.id} playing={playing} onPlay={(track)=>startQueue(tracks,"Search Results",track.id)} onOpen={openTrack} onOpenRelease={openRelease} onReact={react} onSave={toggleTrackSave} onRadio={startSongRadio} onEdit={setEditingTrack} onRemove={removeTrackFromWorld} />)}</div></div>
			: <div className="space-y-8">
				<RadioShelf entries={radioEntries} onPlay={startBuiltInRadio} onProgram={setRadioStudio} onAdvertising={()=>setAdvertisingStudio(true)} />
				<ReleaseShelf title="Released This Week" subtitle="Fresh releases from YSong artists" items={(releasedThisWeek.length?releasedThisWeek:released).slice(0,30)} onOpen={openRelease} />
				{albumPicks.length>0 && <ReleaseShelf title="Album Picks" subtitle="Albums worth opening up" items={albumPicks} onOpen={openRelease} />}
				<div><SectionTitle title="Trending Songs" subtitle="One song per row — play, react, save or open the menu" action={<button onClick={()=>startQueue(trending,"Trending Radio",undefined,"","","radio")} className="text-xs text-indigo-300">▶ Play as Radio</button>} /><div className="rounded-2xl border border-neutral-800 overflow-hidden">{trending.slice(0,8).map((t)=><TrackRow key={t.id} track={t} current={current?.id===t.id} playing={playing} onPlay={(track)=>startQueue(trending,"Trending",track.id)} onOpen={openTrack} onOpenRelease={openRelease} onReact={react} onSave={toggleTrackSave} onRadio={startSongRadio} onEdit={setEditingTrack} onRemove={removeTrackFromWorld} />)}</div></div>
				{playlists.length>0 && <PlaylistShelf title="Playlists" subtitle="Made and saved by the YSong community" items={playlists} onOpen={openPlaylist} />}
				<ReleaseShelf title="Fresh Finds" subtitle="Keep swiping — the shelf can hold the whole catalog" items={released.slice(0,60)} onOpen={openRelease} />
			</div>}
		</>}
	</div></div>{editingTrack && <TrackEditModal track={editingTrack} onCancel={()=>setEditingTrack(null)} onSave={saveTrackEdit} />}{editingRelease && <ReleaseEditModal release={editingRelease} onCancel={()=>setEditingRelease(null)} onSave={saveReleaseEdit} />}{radioStudio && <RadioProgramModal station={radioStudio} tracks={tracksForRadioStation(radioStudio,tracks)} onClose={()=>setRadioStudio(null)} onStart={()=>startBuiltInRadio(radioStudio)} />}{advertisingStudio && <AdvertisingStudioModal onClose={()=>setAdvertisingStudio(false)} />}</div>;
}

function RadioShelf({entries,onPlay,onProgram,onAdvertising}:{entries:Array<{station:YSongRadioStation;tracks:WorldTrack[]}>;onPlay:(station:YSongRadioStation)=>void;onProgram:(station:YSongRadioStation)=>void;onAdvertising:()=>void}) {
	return <div>
		<SectionTitle title="YSong Radio" subtitle="Catalog-driven stations with shuffle bags, recent-song avoidance and Visual Broadcast programs." action={<button onClick={onAdvertising} className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-500/10">Advertising Studio</button>} />
		<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
			{entries.map(({station,tracks})=><div key={station.id} className="relative overflow-hidden rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/10 via-neutral-900 to-neutral-950 p-4 shadow-lg">
				<div className="absolute right-3 top-2 text-5xl opacity-[.06]">📻</div>
				<div className="relative"><div className="text-[10px] font-bold uppercase tracking-[.2em] text-violet-300">YSong Radio</div><div className="mt-1 text-lg font-semibold">{station.name}</div><div className="mt-1 min-h-[2.5rem] text-xs leading-relaxed text-neutral-500">{station.description}</div>
					<div className="mt-3 flex items-center justify-between gap-2"><div className="text-[10px] uppercase tracking-wider text-neutral-600">{tracks.length} eligible song{tracks.length===1?"":"s"}</div><div className="flex gap-2"><button onClick={()=>onProgram(station)} className="rounded-lg border border-neutral-700 px-2.5 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800">Program</button><button disabled={!tracks.length} onClick={()=>onPlay(station)} className="rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-30">▶ Listen</button></div></div>
				</div>
			</div>)}
		</div>
	</div>;
}

function RadioProgramModal({station,tracks,onClose,onStart}:{station:YSongRadioStation;tracks:WorldTrack[];onClose:()=>void;onStart:()=>void}) {
	const id=radioProgramId(station.id);
	const [visuals,setVisuals]=useState<VisualScenePreset<VisualSceneState>[]>([]);
	const [program,setProgram]=useState<VisualBroadcastProgram|null>(null);
	const [globals,setGlobals]=useState<VisualBroadcastGlobals|null>(null);
	const [advertising,setAdvertising]=useState<VisualAdvertisingSettings|null>(null);
	const [assignmentSearch,setAssignmentSearch]=useState("");
	const [busy,setBusy]=useState(false);
	const [note,setNote]=useState("Loading broadcast program…");
	const albumEntries=useMemo(()=>[...new Map(tracks.filter(track=>track.albumName).map(track=>[track.releaseId||track.albumName,{key:track.releaseId||track.albumName,label:track.albumName}])).values()].sort((a,b)=>a.label.localeCompare(b.label)),[tracks]);
	const assignmentTracks=useMemo(()=>{
		const q=assignmentSearch.trim().toLowerCase();
		if(!q)return tracks;
		return tracks.filter(track=>`${track.title} ${track.artistName} ${track.albumName}`.toLowerCase().includes(q));
	},[assignmentSearch,tracks]);
	useEffect(()=>{
		let cancelled=false;
		Promise.all([bridgeApi.getVisualLibrary<VisualSceneState>(),bridgeApi.getVisualProgram(id),bridgeApi.getVisualBroadcastGlobals(),bridgeApi.getVisualAdvertisingSettings()]).then(([library,rawProgram,rawGlobals,rawAdvertising])=>{
			if(cancelled)return;
			setVisuals(library.presets||[]);
			setProgram(normalizeVisualBroadcastProgram(applyRadioStationDefaults(rawProgram as VisualBroadcastProgram & {isDefault?:boolean},station),id,{stationId:station.id,kind:"radio",name:`YSong Radio · ${station.name}`}));
			setGlobals(normalizeVisualBroadcastGlobals(rawGlobals));
			setAdvertising(normalizeVisualAdvertisingSettings(rawAdvertising));
			setNote("");
		}).catch((error:unknown)=>{if(!cancelled)setNote(errorMessage(error,"Start YSong Bridge to edit radio programs."))});
		return()=>{cancelled=true};
	},[id,station]);
	const saveProgram=async(next:VisualBroadcastProgram)=>{
		const normalized=normalizeVisualBroadcastProgram({...next,programId:id,stationId:station.id,kind:"radio",name:`YSong Radio · ${station.name}`},id,{stationId:station.id,kind:"radio",name:`YSong Radio · ${station.name}`});
		setProgram(normalized);setBusy(true);setNote("");
		try{await bridgeApi.setVisualProgram(id,normalized);window.dispatchEvent(new CustomEvent("ysong:world-broadcast-program",{detail:normalized}));setNote("Radio program saved.")}
		catch(error:unknown){setNote(errorMessage(error,"Could not save radio program."))}
		finally{setBusy(false)}
	};
	const saveGlobals=async(next:VisualBroadcastGlobals)=>{
		const normalized=normalizeVisualBroadcastGlobals(next);setGlobals(normalized);setBusy(true);setNote("");
		try{await bridgeApi.setVisualBroadcastGlobals(normalized);window.dispatchEvent(new CustomEvent("ysong:world-broadcast-globals",{detail:normalized}));setNote("Global broadcast fallback saved.")}
		catch(error:unknown){setNote(errorMessage(error,"Could not save global fallback."))}
		finally{setBusy(false)}
	};
	const saveAdvertising=async(next:VisualAdvertisingSettings)=>{
		const normalized=normalizeVisualAdvertisingSettings(next);setAdvertising(normalized);setBusy(true);setNote("");
		try{await bridgeApi.setVisualAdvertisingSettings(normalized);window.dispatchEvent(new CustomEvent("ysong:world-advertising-settings",{detail:normalized}));setNote("Station advertising override saved.")}
		catch(error:unknown){setNote(errorMessage(error,"Could not save station advertising override."))}
		finally{setBusy(false)}
	};
	const patchAdvertisingOverride=(patch:Partial<VisualAdvertisingSettings["programOverrides"][string]>)=>{
		if(!advertising)return;
		const current=advertising.programOverrides[id]||{mode:"inherit" as const};
		const nextOverride={...current,...patch};
		const programOverrides={...advertising.programOverrides};
		const hasSpacing=nextOverride.minSongsBetweenAds!=null||nextOverride.minMinutesBetweenAds!=null||nextOverride.maxAdsPerHour!=null;
		if(nextOverride.mode==="inherit"&&!hasSpacing)delete programOverrides[id];else programOverrides[id]=nextOverride;
		void saveAdvertising({...advertising,programOverrides});
	};
	const togglePool=(pool:string[],sceneId:string)=>pool.includes(sceneId)?pool.filter(id=>id!==sceneId):[...pool,sceneId];
	const patch=(patch:Partial<VisualBroadcastProgram>)=>program&&void saveProgram({...program,...patch});
	const patchBranding=(patch:Partial<VisualBroadcastProgram["branding"]>)=>program&&void saveProgram({...program,branding:{...program.branding,...patch}});
	const patchTiming=(patch:Partial<VisualBroadcastProgram["timing"]>)=>program&&void saveProgram({...program,timing:{...program.timing,...patch}});
	const toggleAlbumScene=(albumKey:string,sceneId:string,legacyAlbumName?:string)=>{
		if(!program)return;
		const next={...program.albumDefaults};
		const inherited=next[albumKey]||(legacyAlbumName?next[legacyAlbumName]:undefined)||[];
		const ids=togglePool(inherited,sceneId);
		if(legacyAlbumName&&legacyAlbumName!==albumKey)delete next[legacyAlbumName];
		if(ids.length)next[albumKey]=ids;else delete next[albumKey];
		void saveProgram({...program,albumDefaults:next});
	};
	const toggleSongScene=(trackId:string,sceneId:string)=>{
		if(!program)return;
		const current:VisualBroadcastAssignment=program.trackAssignments[trackId]||{sceneIds:[]};
		const sceneIds=togglePool(current.sceneIds||[],sceneId);
		const nextAssignments={...program.trackAssignments};
		const nextAssignment={...current,sceneIds};
		const hasOverrides=sceneIds.length||nextAssignment.visualTransition||nextAssignment.visualTransitionSeconds!=null||nextAssignment.audioTransition||nextAssignment.crossfadeSeconds!=null;
		if(hasOverrides)nextAssignments[trackId]=nextAssignment;else delete nextAssignments[trackId];
		void saveProgram({...program,trackAssignments:nextAssignments});
	};
	return <ModalShell title={`YSong Radio · ${station.name}`} onCancel={onClose}>
		<div className="space-y-5">
			<div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-3 text-sm"><div className="font-semibold text-violet-200">{tracks.length} eligible songs</div><div className="mt-1 text-xs text-neutral-500">Radio uses a true shuffle bag: songs are exhausted before a new cycle begins, while the recent-song window pushes recently heard tracks to the back of the next bag.</div></div>
			{program?<>
				<div className="grid grid-cols-2 gap-3 md:grid-cols-4">
					<label className="text-xs text-neutral-400">Audio<select value={program.audioTransition} onChange={e=>patch({audioTransition:e.target.value as VisualBroadcastProgram["audioTransition"]})} className="world-edit-input mt-1"><option value="regular">Regular</option><option value="gapless">Gapless</option><option value="crossfade">Crossfade</option></select></label>
					<label className="text-xs text-neutral-400">Crossfade<input type="number" min={.5} max={20} step={.5} value={program.crossfadeSeconds} onChange={e=>patch({crossfadeSeconds:Number(e.target.value)||5})} className="world-edit-input mt-1"/></label>
					<label className="text-xs text-neutral-400">Visual<select value={program.visualTransition} onChange={e=>patch({visualTransition:e.target.value as VisualBroadcastProgram["visualTransition"]})} className="world-edit-input mt-1"><option value="cut">Cut</option><option value="fade">Soft Fade</option><option value="black">Black Fade</option><option value="flash">Flash</option></select></label>
					<label className="text-xs text-neutral-400">Visual seconds<input type="number" min={.1} max={12} step={.1} value={program.visualTransitionSeconds} onChange={e=>patch({visualTransitionSeconds:Number(e.target.value)||1.4})} className="world-edit-input mt-1"/></label>
					<label className="text-xs text-neutral-400">Repeat<select value={program.repeatMode} onChange={e=>patch({repeatMode:e.target.value as VisualBroadcastProgram["repeatMode"]})} className="world-edit-input mt-1"><option value="all">Forever</option><option value="off">One bag</option><option value="one">One song</option></select></label>
					<label className="flex items-center gap-2 self-end rounded-xl border border-neutral-800 p-2.5 text-xs"><input type="checkbox" checked={program.shuffle} onChange={e=>patch({shuffle:e.target.checked})}/> Shuffle bag</label>
					<label className="text-xs text-neutral-400">Avoid songs<input type="number" min={0} max={100} value={program.avoidRecent} onChange={e=>patch({avoidRecent:Number(e.target.value)||0})} className="world-edit-input mt-1"/></label>
					<label className="text-xs text-neutral-400">Avoid visuals<input type="number" min={0} max={50} value={program.visualAvoidRecent} onChange={e=>patch({visualAvoidRecent:Number(e.target.value)||0})} className="world-edit-input mt-1"/></label>
				</div>
				{advertising?<AdProgramOverrideEditor programId={id} settings={advertising} onPatch={patchAdvertisingOverride}/>:null}
				<div><div className="mb-2 text-xs font-bold uppercase tracking-[.18em] text-neutral-500">Station visual pool</div><div className="grid grid-cols-1 gap-1 sm:grid-cols-2">{visuals.length?visuals.map(v=><label key={v.id} className={`flex items-center gap-2 rounded-lg border px-2 py-2 text-xs ${program.defaultSceneIds.includes(v.id)?"border-violet-400/40 bg-violet-500/10":"border-neutral-800"}`}><input type="checkbox" checked={program.defaultSceneIds.includes(v.id)} onChange={()=>saveProgram({...program,defaultSceneIds:togglePool(program.defaultSceneIds,v.id)})}/><span className="truncate">{v.name}</span></label>):<div className="text-xs text-neutral-500">Save Visual scenes first.</div>}</div><div className="mt-2 text-[10px] text-neutral-600">Resolution order: Song override → Album pool → Station pool → Global pool → current scene.</div></div>
				{albumEntries.length?<details className="rounded-xl border border-neutral-800 p-3"><summary className="cursor-pointer text-xs font-semibold text-neutral-300">Station Album Overrides <span className="ml-2 text-[10px] font-normal text-neutral-600">optional</span></summary><div className="mt-2 text-[10px] text-neutral-600">Album pools outrank the station pool but remain below direct song assignments. New assignments use release IDs internally so identical album titles never collide.</div><div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">{albumEntries.map(album=>{const selected=program.albumDefaults[album.key]||program.albumDefaults[album.label]||[];return <details key={album.key} className="rounded-lg border border-neutral-800 bg-neutral-950/50 p-2"><summary className="cursor-pointer text-xs text-neutral-300"><span className="font-medium">{album.label}</span><span className="ml-2 text-[9px] text-violet-300">{selected.length?`${selected.length} visual${selected.length===1?"":"s"}`:"station pool"}</span></summary><div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">{visuals.map(v=><label key={v.id} className={`flex items-center gap-2 rounded border px-2 py-1 text-[10px] ${selected.includes(v.id)?"border-violet-400/30 bg-violet-500/10 text-neutral-200":"border-neutral-800 text-neutral-500"}`}><input type="checkbox" checked={selected.includes(v.id)} onChange={()=>toggleAlbumScene(album.key,v.id,album.label)}/><span className="truncate">{v.name}</span></label>)}</div></details>})}</div></details>:null}
				<details className="rounded-xl border border-neutral-800 p-3"><summary className="cursor-pointer text-xs font-semibold text-neutral-300">Station Song Overrides <span className="ml-2 text-[10px] font-normal text-neutral-600">{Object.keys(program.trackAssignments).length} configured</span></summary><div className="mt-2 text-[10px] text-neutral-600">Direct song pools have the highest visual priority. Search is useful for large radio catalogs.</div><input value={assignmentSearch} onChange={e=>setAssignmentSearch(e.target.value)} placeholder="Search title, artist or album…" className="world-edit-input mt-3"/><div className="mt-3 max-h-72 space-y-1 overflow-y-auto pr-1">{assignmentTracks.length?assignmentTracks.map(track=>{const selected=program.trackAssignments[track.id]?.sceneIds||[];return <details key={track.id} className="rounded-lg border border-neutral-800 bg-neutral-950/40 px-2 py-1.5"><summary className="cursor-pointer text-xs text-neutral-300"><span className="font-medium">{track.title}</span><span className="ml-2 text-[9px] text-neutral-600">{track.artistName} · {track.albumName}</span><span className="ml-2 text-[9px] text-violet-300">{selected.length?`${selected.length} direct`:"inherit"}</span></summary><div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">{visuals.map(v=><label key={v.id} className={`flex items-center gap-2 rounded border px-2 py-1 text-[10px] ${selected.includes(v.id)?"border-violet-400/30 bg-violet-500/10 text-neutral-200":"border-neutral-800 text-neutral-500"}`}><input type="checkbox" checked={selected.includes(v.id)} onChange={()=>toggleSongScene(track.id,v.id)}/><span className="truncate">{v.name}</span></label>)}</div></details>}):<div className="py-3 text-xs text-neutral-600">No matching station songs.</div>}</div></details>
				<div className="rounded-xl border border-neutral-800 p-3"><div className="mb-3 text-xs font-bold uppercase tracking-[.18em] text-neutral-500">Broadcast Branding</div><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={program.branding.enabled} onChange={e=>patchBranding({enabled:e.target.checked})}/> Enable program branding</label><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={program.branding.showStationBug} onChange={e=>patchBranding({showStationBug:e.target.checked})}/> Station bug</label>
					<label className="text-xs text-neutral-400 sm:col-span-2">Station label<input value={program.branding.stationLabel} onChange={e=>patchBranding({stationLabel:e.target.value})} className="world-edit-input mt-1"/></label>
					<label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={program.branding.showNowPlaying} onChange={e=>patchBranding({showNowPlaying:e.target.checked})}/> Now Playing</label><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={program.branding.showNextUp} onChange={e=>patchBranding({showNextUp:e.target.checked})}/> Up Next</label>
					<label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={program.branding.showQueueLabel} onChange={e=>patchBranding({showQueueLabel:e.target.checked})}/> Queue label</label><label className="text-xs text-neutral-400">Bug position<select value={program.branding.bugPosition} onChange={e=>patchBranding({bugPosition:e.target.value as VisualBroadcastProgram["branding"]["bugPosition"]})} className="world-edit-input mt-1"><option value="top-right">Top Right</option><option value="top-left">Top Left</option><option value="bottom-right">Bottom Right</option><option value="bottom-left">Bottom Left</option></select></label>
				</div></div>
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><label className="text-xs text-neutral-400">Now Playing delay<input type="number" min={0} max={30} step={.5} value={program.timing.nowPlayingDelaySeconds} onChange={e=>patchTiming({nowPlayingDelaySeconds:Number(e.target.value)||0})} className="world-edit-input mt-1"/></label><label className="text-xs text-neutral-400">Now Playing hold<input type="number" min={0} max={120} step={.5} value={program.timing.nowPlayingHoldSeconds} onChange={e=>patchTiming({nowPlayingHoldSeconds:Number(e.target.value)||0})} className="world-edit-input mt-1"/><span className="mt-1 block text-[9px] text-neutral-600">0 = whole song</span></label><label className="text-xs text-neutral-400">Up Next lead<input type="number" min={0} max={60} step={.5} value={program.timing.nextUpLeadSeconds} onChange={e=>patchTiming({nextUpLeadSeconds:Number(e.target.value)||0})} className="world-edit-input mt-1"/></label></div>
			</>:<div className="text-sm text-neutral-500">{note}</div>}
			{globals?<GlobalBroadcastEditor globals={globals} visuals={visuals} onChange={next=>void saveGlobals(next)}/>:null}
			<div className="flex items-center justify-between gap-3"><div className="text-xs text-neutral-500">{busy?"Saving…":note}</div><div className="flex gap-2"><YSButton onClick={onClose} className="rounded-lg border border-neutral-700 px-3 py-2">Close</YSButton><YSButton disabled={!tracks.length} onClick={()=>{onStart();onClose()}} className="rounded-lg bg-violet-600 px-4 py-2 disabled:opacity-30">▶ Start Radio</YSButton></div></div>
		</div>
		<style>{`.world-edit-input{width:100%;border:1px solid rgb(64 64 64);background:rgb(23 23 23);border-radius:.7rem;padding:.5rem .65rem;outline:none}.world-edit-input:focus{border-color:rgb(139 92 246);box-shadow:0 0 0 2px rgb(124 58 237 / .14)}`}</style>
	</ModalShell>;
}


function probeAudioDuration(url:string) {
	return new Promise<number>((resolve) => {
		const audio = new Audio();
		const finish = (value:number) => { audio.removeAttribute("src"); audio.load(); resolve(Number.isFinite(value) ? value : 0); };
		audio.preload = "metadata";
		audio.onloadedmetadata = () => finish(audio.duration || 0);
		audio.onerror = () => finish(0);
		audio.src = url;
	});
}

function probeVideoDuration(url:string) {
	return new Promise<number>((resolve) => {
		const video = document.createElement("video");
		const finish = (value:number) => { video.removeAttribute("src"); video.load(); resolve(Number.isFinite(value) ? value : 0); };
		video.preload = "metadata";
		video.onloadedmetadata = () => finish(video.duration || 0);
		video.onerror = () => finish(0);
		video.src = url;
	});
}

function AdvertisingStudioModal({onClose}:{onClose:()=>void}) {
	const [settings,setSettings]=useState<VisualAdvertisingSettings>(()=>normalizeVisualAdvertisingSettings(null));
	const [visuals,setVisuals]=useState<VisualScenePreset<VisualSceneState>[]>([]);
	const [loading,setLoading]=useState(true);
	const [busy,setBusy]=useState(false);
	const [note,setNote]=useState("");
	useEffect(()=>{
		let cancelled=false;
		Promise.all([bridgeApi.getVisualAdvertisingSettings(),bridgeApi.getVisualLibrary<VisualSceneState>()]).then(([raw,library])=>{
			if(cancelled)return;
			setSettings(normalizeVisualAdvertisingSettings(raw));
			setVisuals(library.presets||[]);
		}).catch((error:unknown)=>{if(!cancelled)setNote(errorMessage(error,"Start YSong Bridge to edit advertising."))}).finally(()=>{if(!cancelled)setLoading(false)});
		return()=>{cancelled=true};
	},[]);
	const patch=(next:Partial<VisualAdvertisingSettings>)=>setSettings(prev=>({...prev,...next}));
	const patchSchedule=(next:Partial<VisualAdvertisingSettings["schedule"]>)=>setSettings(prev=>({...prev,schedule:{...prev.schedule,...next}}));
	const patchPlacements=(next:Partial<VisualAdvertisingSettings["placements"]>)=>setSettings(prev=>({...prev,placements:{...prev.placements,...next}}));
	const patchPresentation=(next:Partial<VisualAdvertisingSettings["presentation"]>)=>setSettings(prev=>({...prev,presentation:{...prev.presentation,...next}}));
	const patchCreative=(id:string,next:Partial<VisualAdCreative>)=>setSettings(prev=>({...prev,houseCreatives:prev.houseCreatives.map(creative=>creative.id===id?{...creative,...next}:creative)}));
	const removeCreative=(id:string)=>setSettings(prev=>({...prev,houseCreatives:prev.houseCreatives.filter(creative=>creative.id!==id)}));
	const patchRoomPreroll=(id:string,next:Partial<VisualVideoPrerollCreative>)=>setSettings(prev=>({...prev,liveRoomPrerollCreatives:prev.liveRoomPrerollCreatives.map(creative=>creative.id===id?{...creative,...next}:creative)}));
	const removeRoomPreroll=(id:string)=>setSettings(prev=>({...prev,liveRoomPrerollCreatives:prev.liveRoomPrerollCreatives.filter(creative=>creative.id!==id)}));
	const uploadCreative=async(file:File)=>{
		setBusy(true);setNote(`Importing ${file.name}…`);
		try{
			const uploaded=await bridgeApi.uploadVisualMedia(file);
			const duration=await probeAudioDuration(uploaded.url);
			const stem=file.name.replace(/\.[^.]+$/g,"").trim()||"House Ad";
			const creative:VisualAdCreative={id:`house-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`,title:stem,sponsor:"YSong",audioUrl:uploaded.url,audioFileName:file.name,durationSeconds:duration,weight:1,enabled:true};
			setSettings(prev=>({...prev,houseCreatives:[...prev.houseCreatives,creative]}));
			setNote(`${file.name} added to the House Ad library. Save settings to commit it.`);
		}catch(error:unknown){setNote(errorMessage(error,"Could not import ad audio."))}
		finally{setBusy(false)}
	};
	const uploadRoomPreroll=async(file:File)=>{
		setBusy(true);setNote(`Importing ${file.name}…`);
		try{
			const uploaded=await bridgeApi.uploadVisualMedia(file);
			const duration=await probeVideoDuration(uploaded.url);
			const stem=file.name.replace(/\.[^.]+$/g,"").trim()||"Live Room Sponsor";
			const creative:VisualVideoPrerollCreative={id:`room-preroll-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`,title:stem,sponsor:"YSong",videoUrl:uploaded.url,videoFileName:file.name,durationSeconds:duration,weight:1,enabled:true,mutedByDefault:false};
			setSettings(prev=>({...prev,liveRoomPrerollCreatives:[...prev.liveRoomPrerollCreatives,creative]}));
			setNote(`${file.name} added to the Live Room video pre-roll library. Save settings to commit it.`);
		}catch(error:unknown){setNote(errorMessage(error,"Could not import Room pre-roll video."))}
		finally{setBusy(false)}
	};
	const save=async()=>{
		const normalized=normalizeVisualAdvertisingSettings(settings);
		setSettings(normalized);setBusy(true);setNote("");
		try{
			await bridgeApi.setVisualAdvertisingSettings(normalized);
			window.dispatchEvent(new CustomEvent("ysong:world-advertising-settings",{detail:normalized}));
			setNote("Advertising settings saved.");
		}catch(error:unknown){setNote(errorMessage(error,"Could not save advertising settings."))}
		finally{setBusy(false)}
	};
	const inputClass="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-neutral-100 outline-none focus:border-amber-400/50";
	return <ModalShell title="YSong Advertising Studio" onCancel={onClose}>
		<div className="space-y-5">
			<div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-neutral-300"><div className="font-semibold text-amber-200">Two placements, deliberately limited</div><div className="mt-1 text-xs leading-relaxed text-neutral-500">YSong Radio uses audio-only interstitials between songs. Live video Rooms may use one video pre-roll before entry. There are no video ads in Radio and no mid-roll/post-roll ads inside livestream Rooms.</div></div>
			{loading?<div className="text-sm text-neutral-500">Loading advertising settings…</div>:<>
				<div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto]">
					<label className="flex items-center gap-2 rounded-xl border border-neutral-800 p-3 text-sm"><input type="checkbox" checked={settings.enabled} onChange={e=>patch({enabled:e.target.checked})}/> Enable advertising</label>
					<label className="text-xs text-neutral-400">Primary provider ID<input value={settings.providerId} onChange={e=>patch({providerId:e.target.value})} className={inputClass}/><span className="mt-1 block text-[9px] text-neutral-600">Built-in provider: house. Future adapters register their own provider ID.</span></label>
					<label className="text-xs text-neutral-400">Fallback<select value={settings.fallbackProviderId} onChange={e=>patch({fallbackProviderId:e.target.value})} className={inputClass}><option value="house">House library</option></select></label>
				</div>
				<div className="rounded-xl border border-neutral-800 p-3"><div className="mb-2 text-xs font-bold uppercase tracking-[.18em] text-neutral-500">Placements</div><div className="grid gap-2 sm:grid-cols-2"><label className="flex items-start gap-2 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3 text-xs"><input type="checkbox" checked={settings.placements.radio} onChange={e=>patchPlacements({radio:e.target.checked})}/><span><b className="text-neutral-200">YSong Radio</b><span className="mt-1 block text-neutral-600">Audio spot only after the configured song/minute spacing. Playlists and direct World queues stay ad-free.</span></span></label><label className="flex items-start gap-2 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3 text-xs"><input type="checkbox" checked={settings.placements.liveRoomPreroll} onChange={e=>patchPlacements({liveRoomPreroll:e.target.checked})}/><span><b className="text-neutral-200">Live video Room pre-roll</b><span className="mt-1 block text-neutral-600">One video pre-roll before a viewer enters a Room with an active video livestream. No pre-roll for ordinary chat/listening Rooms and no mid-roll/post-roll Room ads.</span></span></label></div></div>
				<div className="rounded-xl border border-neutral-800 p-3"><div className="mb-3 text-xs font-bold uppercase tracking-[.18em] text-neutral-500">Radio ad spacing</div><div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
					<label className="text-xs text-neutral-400">Initial songs<input type="number" min={0} max={100} value={settings.schedule.initialGraceSongs} onChange={e=>patchSchedule({initialGraceSongs:Number(e.target.value)||0})} className={inputClass}/></label>
					<label className="text-xs text-neutral-400">Initial minutes<input type="number" min={0} max={180} step={.5} value={settings.schedule.initialGraceMinutes} onChange={e=>patchSchedule({initialGraceMinutes:Number(e.target.value)||0})} className={inputClass}/></label>
					<label className="text-xs text-neutral-400">Songs between<input type="number" min={0} max={100} value={settings.schedule.minSongsBetweenAds} onChange={e=>patchSchedule({minSongsBetweenAds:Number(e.target.value)||0})} className={inputClass}/></label>
					<label className="text-xs text-neutral-400">Minutes between<input type="number" min={0} max={180} step={.5} value={settings.schedule.minMinutesBetweenAds} onChange={e=>patchSchedule({minMinutesBetweenAds:Number(e.target.value)||0})} className={inputClass}/></label>
					<label className="text-xs text-neutral-400">Max / hour<input type="number" min={0} max={60} value={settings.schedule.maxAdsPerHour} onChange={e=>patchSchedule({maxAdsPerHour:Number(e.target.value)||0})} className={inputClass}/></label>
					<label className="text-xs text-neutral-400">Avoid recent ads<input type="number" min={0} max={50} value={settings.schedule.recentCreativeWindow} onChange={e=>patchSchedule({recentCreativeWindow:Number(e.target.value)||0})} className={inputClass}/></label>
				</div><div className="mt-2 text-[10px] text-neutral-600">Both song-count and elapsed-music spacing must be satisfied when both are non-zero. Max/hour is a hard cap. 0 disables that individual constraint; Max/hour 0 disables delivery.</div></div>
				<div className="rounded-xl border border-neutral-800 p-3"><div className="mb-3 flex items-center justify-between gap-3"><div><div className="text-xs font-bold uppercase tracking-[.18em] text-neutral-500">Generic radio break visual</div><div className="mt-1 text-[10px] text-neutral-600">Optional YSong visual backdrop while an audio radio ad plays. This is not a video ad creative.</div></div><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={settings.presentation.enabled} onChange={e=>patchPresentation({enabled:e.target.checked})}/> Enable visual</label></div><div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-5">
					<label className="text-xs text-neutral-400 lg:col-span-2">Scene<select value={settings.presentation.sceneId} onChange={e=>patchPresentation({sceneId:e.target.value})} className={inputClass}><option value="">No dedicated scene</option>{visuals.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
					<label className="text-xs text-neutral-400">Label<input value={settings.presentation.label} onChange={e=>patchPresentation({label:e.target.value})} className={inputClass}/></label>
					<label className="text-xs text-neutral-400">Transition<select value={settings.presentation.visualTransition} onChange={e=>patchPresentation({visualTransition:e.target.value as VisualAdvertisingSettings["presentation"]["visualTransition"]})} className={inputClass}><option value="cut">Cut</option><option value="fade">Soft Fade</option><option value="black">Black Fade</option><option value="flash">Flash</option></select></label>
					<label className="text-xs text-neutral-400">Seconds<input type="number" min={.1} max={12} step={.1} value={settings.presentation.visualTransitionSeconds} onChange={e=>patchPresentation({visualTransitionSeconds:Number(e.target.value)||.8})} className={inputClass}/></label>
				</div><label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={settings.presentation.showSponsor} onChange={e=>patchPresentation({showSponsor:e.target.checked})}/> Show sponsor name on generic Ad Break overlay</label></div>
				<div className="rounded-xl border border-neutral-800 p-3"><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><div className="text-xs font-bold uppercase tracking-[.18em] text-neutral-500">House Ad library</div><div className="mt-1 text-[10px] text-neutral-600">Used by the built-in <b>house</b> provider and as the default fallback when an external provider returns no fill.</div></div><label className="cursor-pointer rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200 hover:bg-amber-500/10">+ Import Ad Audio<input type="file" accept="audio/mpeg,audio/wav,audio/flac,audio/ogg,audio/mp4,audio/aac,.mp3,.wav,.flac,.ogg,.m4a,.aac" className="hidden" onChange={e=>{const file=e.target.files?.[0];e.currentTarget.value="";if(file)void uploadCreative(file)}}/></label></div>
					<div className="space-y-2">{settings.houseCreatives.length?settings.houseCreatives.map(creative=><div key={creative.id} className="rounded-lg border border-neutral-800 bg-neutral-950/50 p-3"><div className="grid grid-cols-1 gap-2 md:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_100px_auto] md:items-end"><label className="flex items-center gap-2 self-center text-xs"><input type="checkbox" checked={creative.enabled} onChange={e=>patchCreative(creative.id,{enabled:e.target.checked})}/> Active</label><label className="text-[10px] text-neutral-500">Title<input value={creative.title} onChange={e=>patchCreative(creative.id,{title:e.target.value})} className={inputClass}/></label><label className="text-[10px] text-neutral-500">Sponsor<input value={creative.sponsor} onChange={e=>patchCreative(creative.id,{sponsor:e.target.value})} className={inputClass}/></label><label className="text-[10px] text-neutral-500">Weight<input type="number" min={.01} max={100} step={.25} value={creative.weight} onChange={e=>patchCreative(creative.id,{weight:Number(e.target.value)||1})} className={inputClass}/></label><button onClick={()=>removeCreative(creative.id)} className="rounded-lg border border-red-500/20 px-2 py-2 text-xs text-red-300 hover:bg-red-500/10">Remove</button></div><div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center"><audio controls preload="metadata" src={creative.audioUrl} className="h-8 max-w-full flex-1"/><div className="text-[9px] text-neutral-600">{creative.audioFileName}{creative.durationSeconds>0?` · ${creative.durationSeconds.toFixed(1)}s`:""}</div></div></div>):<div className="rounded-lg border border-dashed border-neutral-800 p-5 text-center text-xs text-neutral-600">No House Ad audio yet. Import an MP3/WAV/FLAC/OGG/M4A/AAC creative. Advertising stays harmlessly silent when no provider returns an ad.</div>}</div>
				</div>
				<div className="rounded-xl border border-neutral-800 p-3"><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><div className="text-xs font-bold uppercase tracking-[.18em] text-neutral-500">Live Room video pre-roll library</div><div className="mt-1 text-[10px] text-neutral-600">Used only before entry to an active video livestream Room. One pre-roll per live session; never used for Radio, listening Rooms, mid-rolls or post-rolls.</div></div><label className="cursor-pointer rounded-lg border border-violet-500/30 bg-violet-500/5 px-3 py-2 text-xs text-violet-200 hover:bg-violet-500/10">+ Import Pre-roll Video<input type="file" accept="video/mp4,video/webm,.mp4,.webm" className="hidden" onChange={e=>{const file=e.target.files?.[0];e.currentTarget.value="";if(file)void uploadRoomPreroll(file)}}/></label></div>
					<div className="space-y-2">{settings.liveRoomPrerollCreatives.length?settings.liveRoomPrerollCreatives.map(creative=><div key={creative.id} className="rounded-lg border border-neutral-800 bg-neutral-950/50 p-3"><div className="grid grid-cols-1 gap-2 md:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_100px_auto] md:items-end"><label className="flex items-center gap-2 self-center text-xs"><input type="checkbox" checked={creative.enabled} onChange={e=>patchRoomPreroll(creative.id,{enabled:e.target.checked})}/> Active</label><label className="text-[10px] text-neutral-500">Title<input value={creative.title} onChange={e=>patchRoomPreroll(creative.id,{title:e.target.value})} className={inputClass}/></label><label className="text-[10px] text-neutral-500">Sponsor<input value={creative.sponsor} onChange={e=>patchRoomPreroll(creative.id,{sponsor:e.target.value})} className={inputClass}/></label><label className="text-[10px] text-neutral-500">Weight<input type="number" min={.01} max={100} step={.25} value={creative.weight} onChange={e=>patchRoomPreroll(creative.id,{weight:Number(e.target.value)||1})} className={inputClass}/></label><button onClick={()=>removeRoomPreroll(creative.id)} className="rounded-lg border border-red-500/20 px-2 py-2 text-xs text-red-300 hover:bg-red-500/10">Remove</button></div><div className="mt-2 grid gap-2 md:grid-cols-[240px_1fr]"><video controls preload="metadata" src={creative.videoUrl} className="aspect-video w-full rounded bg-black object-contain"/><div className="flex flex-col justify-between gap-2"><label className="flex items-center gap-2 text-xs text-neutral-400"><input type="checkbox" checked={creative.mutedByDefault} onChange={e=>patchRoomPreroll(creative.id,{mutedByDefault:e.target.checked})}/> Start muted by default</label><div className="text-[9px] text-neutral-600">{creative.videoFileName}{creative.durationSeconds>0?` · ${creative.durationSeconds.toFixed(1)}s`:""}</div></div></div></div>):<div className="rounded-lg border border-dashed border-neutral-800 p-5 text-center text-xs text-neutral-600">No Live Room video pre-rolls yet. Import MP4 or WebM. If no eligible video creative exists, the viewer enters the livestream immediately.</div>}</div>
				</div>
			</>}
			<div className="flex items-center justify-between gap-3 border-t border-neutral-800 pt-3"><div className="text-xs text-neutral-500">{busy?"Working…":note}</div><div className="flex gap-2"><YSButton onClick={onClose} className="rounded-lg border border-neutral-700 px-3 py-2">Close</YSButton><YSButton disabled={busy||loading} onClick={()=>void save()} className="rounded-lg bg-amber-500 px-4 py-2 font-semibold text-black disabled:opacity-40">Save Advertising</YSButton></div></div>
		</div>
	</ModalShell>;
}

function AdProgramOverrideEditor({programId,settings,onPatch}:{programId:string;settings:VisualAdvertisingSettings;onPatch:(patch:Partial<VisualAdvertisingSettings["programOverrides"][string]>)=>void}) {
	const override=settings.programOverrides[programId]||{mode:"inherit" as const};
	const inputClass="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-neutral-100 outline-none focus:border-amber-400/50";
	const parseOptional=(value:string)=>value.trim()===""?undefined:Math.max(0,Number(value)||0);
	return <details className="rounded-xl border border-amber-500/20 bg-amber-500/[.025] p-3">
		<summary className="cursor-pointer text-xs font-semibold text-amber-200">Advertising <span className="ml-2 text-[10px] font-normal text-neutral-500">{override.mode==="inherit"?"inherits global":override.mode==="enabled"?"forced on":"forced off"}</span></summary>
		<div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
			<label className="text-xs text-neutral-400">Program mode<select value={override.mode} onChange={e=>onPatch({mode:e.target.value as "inherit"|"enabled"|"disabled"})} className={inputClass}><option value="inherit">Inherit global</option><option value="enabled">Force enabled</option><option value="disabled">Force disabled</option></select></label>
			<label className="text-xs text-neutral-400">Songs between<input type="number" min={0} max={100} placeholder={String(settings.schedule.minSongsBetweenAds)} value={override.minSongsBetweenAds??""} onChange={e=>onPatch({minSongsBetweenAds:parseOptional(e.target.value)})} className={inputClass}/><span className="mt-1 block text-[9px] text-neutral-600">Blank = global {settings.schedule.minSongsBetweenAds}</span></label>
			<label className="text-xs text-neutral-400">Minutes between<input type="number" min={0} max={180} step={.5} placeholder={String(settings.schedule.minMinutesBetweenAds)} value={override.minMinutesBetweenAds??""} onChange={e=>onPatch({minMinutesBetweenAds:parseOptional(e.target.value)})} className={inputClass}/><span className="mt-1 block text-[9px] text-neutral-600">Blank = global {settings.schedule.minMinutesBetweenAds}</span></label>
			<label className="text-xs text-neutral-400">Max / hour<input type="number" min={0} max={60} placeholder={String(settings.schedule.maxAdsPerHour)} value={override.maxAdsPerHour??""} onChange={e=>onPatch({maxAdsPerHour:parseOptional(e.target.value)})} className={inputClass}/><span className="mt-1 block text-[9px] text-neutral-600">Blank = global {settings.schedule.maxAdsPerHour}</span></label>
		</div>
		<div className="mt-2 text-[10px] text-neutral-600">Initial grace still comes from the global advertising policy. Program overrides only control whether this program serves ads and its recurring spacing/cap.</div>
	</details>;
}

function GlobalBroadcastEditor({globals,visuals,onChange}:{globals:VisualBroadcastGlobals;visuals:VisualScenePreset<VisualSceneState>[];onChange:(next:VisualBroadcastGlobals)=>void}) {
	const inputClass="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-neutral-100 outline-none focus:border-cyan-400/50";
	const toggleScene=(sceneId:string)=>onChange({...globals,defaultSceneIds:globals.defaultSceneIds.includes(sceneId)?globals.defaultSceneIds.filter(id=>id!==sceneId):[...globals.defaultSceneIds,sceneId]});
	const patchBranding=(patch:Partial<VisualBroadcastGlobals["branding"]>)=>onChange({...globals,branding:{...globals.branding,...patch}});
	const patchTiming=(patch:Partial<VisualBroadcastGlobals["timing"]>)=>onChange({...globals,timing:{...globals.timing,...patch}});
	return <details className="rounded-xl border border-cyan-500/20 bg-cyan-500/[.025] p-3"><summary className="cursor-pointer text-xs font-semibold text-cyan-200">Global Broadcast Fallback <span className="ml-2 text-[10px] font-normal text-neutral-500">{globals.defaultSceneIds.length} visual{globals.defaultSceneIds.length===1?"":"s"}</span></summary>
		<div className="mt-2 text-[10px] leading-relaxed text-neutral-600">The visual pool is the last saved-scene fallback for every playlist and radio program. Overlay defaults below are used by ad-hoc World playback such as Song Radio, Artist Radio, Genre Radio and ordinary World queues when no dedicated program is active.</div>
		<div className="mt-4"><div className="mb-2 text-[10px] font-bold uppercase tracking-[.16em] text-neutral-500">Global visual pool</div><div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-4">{visuals.length?visuals.map(v=><label key={v.id} className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs ${globals.defaultSceneIds.includes(v.id)?"border-cyan-400/30 bg-cyan-500/10":"border-neutral-800 bg-neutral-950"}`}><input type="checkbox" checked={globals.defaultSceneIds.includes(v.id)} onChange={()=>toggleScene(v.id)}/><span className="truncate">{v.name}</span></label>):<div className="text-xs text-neutral-500">Save scenes from Visuals first.</div>}</div><label className="mt-3 block max-w-[220px] text-[11px] text-neutral-400">Avoid recent visuals<input type="number" min={0} max={50} value={globals.visualAvoidRecent} onChange={e=>onChange({...globals,visualAvoidRecent:Math.max(0,Math.min(50,Number(e.target.value)||0))})} className={inputClass}/></label></div>
		<div className="mt-4 grid grid-cols-1 gap-3 border-t border-cyan-400/10 pt-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(260px,.7fr)]"><div><div className="mb-2 text-[10px] font-bold uppercase tracking-[.16em] text-neutral-500">Ad-hoc overlay defaults</div><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={globals.branding.enabled} onChange={e=>patchBranding({enabled:e.target.checked})}/> Enable overlay branding</label><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={globals.branding.showStationBug} onChange={e=>patchBranding({showStationBug:e.target.checked})}/> World / Radio bug</label><label className="text-xs text-neutral-400 sm:col-span-2">Bug label<input value={globals.branding.stationLabel} onChange={e=>patchBranding({stationLabel:e.target.value})} className={inputClass}/></label><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={globals.branding.showNowPlaying} onChange={e=>patchBranding({showNowPlaying:e.target.checked})}/> Now Playing</label><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={globals.branding.showNextUp} onChange={e=>patchBranding({showNextUp:e.target.checked})}/> Up Next</label><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={globals.branding.showQueueLabel} onChange={e=>patchBranding({showQueueLabel:e.target.checked})}/> Queue label</label><label className="text-xs text-neutral-400">Bug position<select value={globals.branding.bugPosition} onChange={e=>patchBranding({bugPosition:e.target.value as VisualBroadcastGlobals["branding"]["bugPosition"]})} className={inputClass}><option value="top-right">Top Right</option><option value="top-left">Top Left</option><option value="bottom-right">Bottom Right</option><option value="bottom-left">Bottom Left</option></select></label></div></div>
		<div><div className="mb-2 text-[10px] font-bold uppercase tracking-[.16em] text-neutral-500">Ad-hoc timing</div><div className="grid grid-cols-1 gap-3"><label className="text-xs text-neutral-400">Now Playing delay<input type="number" min={0} max={30} step={.5} value={globals.timing.nowPlayingDelaySeconds} onChange={e=>patchTiming({nowPlayingDelaySeconds:Math.max(0,Math.min(30,Number(e.target.value)||0))})} className={inputClass}/></label><label className="text-xs text-neutral-400">Now Playing hold<input type="number" min={0} max={120} step={.5} value={globals.timing.nowPlayingHoldSeconds} onChange={e=>patchTiming({nowPlayingHoldSeconds:Math.max(0,Math.min(120,Number(e.target.value)||0))})} className={inputClass}/><span className="mt-1 block text-[9px] text-neutral-600">0 = whole song</span></label><label className="text-xs text-neutral-400">Up Next lead<input type="number" min={0} max={60} step={.5} value={globals.timing.nextUpLeadSeconds} onChange={e=>patchTiming({nextUpLeadSeconds:Math.max(0,Math.min(60,Number(e.target.value)||0))})} className={inputClass}/><span className="mt-1 block text-[9px] text-neutral-600">0 = off</span></label></div></div></div>
	</details>;
}

function SectionTitle({ title, subtitle, action }: { title:string; subtitle?:string; action?:React.ReactNode }) { return <div className="flex items-end justify-between gap-3 mb-3"><div><h2 className="text-xl font-semibold">{title}</h2>{subtitle&&<div className="text-xs text-neutral-500 mt-0.5">{subtitle}</div>}</div>{action}</div>; }
function Artwork({ track, className="" }: { track:WorldTrack; className?:string }) { return track.hasArtwork ? <img src={worldArtworkUrl(track.id)} alt="" className={`object-cover bg-neutral-900 ${className}`} /> : <div className={`bg-gradient-to-br from-neutral-800 to-neutral-950 grid place-items-center text-neutral-600 ${className}`}>♪</div>; }

function HorizontalShelf({ children, ariaLabel }: { children: React.ReactNode; ariaLabel: string }) {
	const shelfRef = useRef<HTMLDivElement | null>(null);
	const [canLeft, setCanLeft] = useState(false);
	const [canRight, setCanRight] = useState(false);
	const drag = useRef({ active: false, startX: 0, scrollLeft: 0, moved: false });
	const suppressClick = useRef(false);

	useEffect(() => {
		const el = shelfRef.current;
		if (!el) return;
		const update = () => {
			setCanLeft(el.scrollLeft > 2);
			setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
		};
		update();
		el.addEventListener("scroll", update, { passive: true });
		window.addEventListener("resize", update);
		const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
		ro?.observe(el);
		return () => { el.removeEventListener("scroll", update); window.removeEventListener("resize", update); ro?.disconnect(); };
	}, [children]);

	const page = (direction: -1 | 1) => {
		const el = shelfRef.current;
		if (!el) return;
		el.scrollBy({ left: direction * Math.max(240, el.clientWidth * 0.82), behavior: "smooth" });
	};

	return <div className="relative group/shelf">
		<div
			ref={shelfRef}
			aria-label={ariaLabel}
			className="flex gap-3 overflow-x-auto no-scrollbar snap-x snap-mandatory scroll-smooth pb-2 -mx-1 px-1 md:cursor-grab md:active:cursor-grabbing"
			onPointerDown={(e) => {
				if (e.pointerType !== "mouse" || e.button !== 0) return;
				const el = shelfRef.current; if (!el) return;
				// Do NOT capture on pointer-down. Capturing here retargets the eventual
				// click to the shelf itself, so album/playlist buttons never receive it.
				drag.current = { active: true, startX: e.clientX, scrollLeft: el.scrollLeft, moved: false };
			}}
			onPointerMove={(e) => {
				if (!drag.current.active || e.pointerType !== "mouse") return;
				const el = shelfRef.current; if (!el) return;
				const delta = e.clientX - drag.current.startX;
				if (!drag.current.moved && Math.abs(delta) > 6) {
					drag.current.moved = true;
					el.setPointerCapture?.(e.pointerId);
				}
				if (drag.current.moved) {
					e.preventDefault();
					el.scrollLeft = drag.current.scrollLeft - delta;
				}
			}}
			onPointerUp={(e) => {
				if (!drag.current.active) return;
				const moved = drag.current.moved;
				drag.current.active = false;
				if (moved) {
					suppressClick.current = true;
					window.setTimeout(() => { suppressClick.current = false; }, 0);
					const el = shelfRef.current;
					if (el?.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
				}
			}}
			onPointerCancel={(e) => {
				drag.current.active = false;
				const el = shelfRef.current;
				if (el?.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
			}}
			onDragStart={(e) => e.preventDefault()}
			onClickCapture={(e) => { if (suppressClick.current) { e.preventDefault(); e.stopPropagation(); } }}
		>
			{children}
		</div>
		{canLeft && <button type="button" onClick={() => page(-1)} className="hidden md:grid absolute left-1 top-[40%] -translate-y-1/2 h-10 w-10 place-items-center rounded-full border border-white/10 bg-black/80 text-white shadow-xl backdrop-blur hover:bg-black focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400" title="Previous" aria-label={`Previous ${ariaLabel}`}>‹</button>}
		{canRight && <button type="button" onClick={() => page(1)} className="hidden md:grid absolute right-1 top-[40%] -translate-y-1/2 h-10 w-10 place-items-center rounded-full border border-white/10 bg-black/80 text-white shadow-xl backdrop-blur hover:bg-black focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400" title="Next" aria-label={`Next ${ariaLabel}`}>›</button>}
	</div>;
}

function ReleaseShelf({ title, subtitle, items, onOpen }: { title:string; subtitle:string; items:WorldTrack[]; onOpen:(id:string)=>void }) {
	return <div><SectionTitle title={title} subtitle={subtitle} /><HorizontalShelf ariaLabel={title}>{items.map((t)=><button key={t.releaseId} onClick={()=>onOpen(t.releaseId)} className="snap-start shrink-0 w-[42vw] min-w-[145px] max-w-[205px] sm:w-[180px] text-left group"><Artwork track={t} className="w-full aspect-square rounded-xl shadow-lg group-hover:scale-[1.015] transition" /><div className="mt-2 text-sm font-semibold truncate">{t.albumName}</div><div className="text-xs text-neutral-400 truncate">{t.artistName}</div><div className="text-[10px] text-neutral-600 truncate">{t.releaseType} • {t.genre}</div></button>)}</HorizontalShelf></div>;
}
function PlaylistShelf({ title, subtitle, items, onOpen }: { title:string; subtitle:string; items:WorldPlaylist[]; onOpen:(id:string)=>void }) {
	return <div><SectionTitle title={title} subtitle={subtitle} /><HorizontalShelf ariaLabel={title}>{items.map((p)=><button key={p.id} onClick={()=>onOpen(p.id)} className="snap-start shrink-0 w-[42vw] min-w-[145px] max-w-[205px] sm:w-[180px] text-left group">{p.coverTrackId?<img src={worldArtworkUrl(p.coverTrackId)} alt="" className="w-full aspect-square rounded-xl object-cover bg-neutral-900 group-hover:scale-[1.015] transition" />:<div className="w-full aspect-square rounded-xl bg-gradient-to-br from-indigo-500/25 to-neutral-950 grid place-items-center text-4xl">♫</div>}<div className="mt-2 text-sm font-semibold truncate">{p.title}</div><div className="text-xs text-neutral-400 truncate">{p.ownerName}</div><div className="text-[10px] text-neutral-600">{p.trackCount} songs • {prettyCount(p.saveCount)} saves</div></button>)}</HorizontalShelf></div>;
}

function TrackRow({ track, onPlay, onOpen, onOpenRelease, onReact, onSave, onRadio, onEdit, onRemove, current, playing }: { track:WorldTrack; onPlay:(t:WorldTrack)=>void; onOpen:(t:WorldTrack)=>void; onOpenRelease?:(id:string)=>void; onReact:(t:WorldTrack,r:-1|1)=>void; onSave:(t:WorldTrack)=>void; onRadio:(t:WorldTrack)=>void; onEdit:(t:WorldTrack)=>void; onRemove?:(t:WorldTrack)=>void; current:boolean; playing:boolean }) {
	return <div className="grid grid-cols-[44px_minmax(0,1fr)_auto] md:grid-cols-[44px_minmax(0,1fr)_auto_auto] items-center gap-2 md:gap-3 px-2.5 py-2.5 border-b last:border-b-0 border-neutral-800 hover:bg-neutral-900/60"><button onClick={()=>onPlay(track)} className="relative h-11 w-11 rounded-lg overflow-hidden group"><Artwork track={track} className="h-full w-full" /><span className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 grid place-items-center text-white">{current&&playing?"Ⅱ":"▶"}</span></button><button onClick={()=>onOpen(track)} className="min-w-0 text-left"><div className="font-medium text-sm truncate">{track.title}</div><div className="text-xs text-neutral-500 truncate">{track.artistName} • {track.albumName}</div></button><div className="hidden md:flex items-center gap-2 text-xs text-neutral-500"><button onClick={()=>onReact(track,1)} className={track.myReaction===1?"text-indigo-300":"hover:text-white"}>♥ {prettyCount(track.likes)}</button><span>💬 {prettyCount(track.commentCount)}</span><span>▶ {prettyCount(track.playCount)}</span>{durationLabel(track.durationSeconds)&&<span>{durationLabel(track.durationSeconds)}</span>}</div><TrackMenu track={track} onOpenRelease={onOpenRelease} onSave={onSave} onRadio={onRadio} onEdit={onEdit} onRemove={onRemove} /></div>;
}

function TrackMenu({ track, onOpenRelease, onSave, onRadio, onEdit, onRemove }: { track:WorldTrack; onOpenRelease?:(id:string)=>void; onSave:(t:WorldTrack)=>void; onRadio:(t:WorldTrack)=>void; onEdit:(t:WorldTrack)=>void; onRemove?:(t:WorldTrack)=>void }) {
	const [open,setOpen]=useState(false); const [lists,setLists]=useState<WorldPlaylist[]>([]); const [showLists,setShowLists]=useState(false);
	const buttonRef=useRef<HTMLButtonElement|null>(null);
	const [menuPos,setMenuPos]=useState<{left:number;top?:number;bottom?:number;width:number;maxHeight:number}>({left:8,top:48,width:224,maxHeight:320});
	const loadLists=async()=>{ try { const lib=await fetchWorldLibrary(); setLists(lib.playlists); setShowLists(true); } catch{} };

	useEffect(()=>{
		if(!open)return;
		const positionMenu=()=>{
			const rect=buttonRef.current?.getBoundingClientRect();
			if(!rect)return;
			const margin=8; const gap=4; const width=Math.min(224,Math.max(160,window.innerWidth-margin*2));
			const left=Math.min(Math.max(margin,rect.right-width),Math.max(margin,window.innerWidth-width-margin));
			const below=Math.max(0,window.innerHeight-rect.bottom-margin-gap);
			const above=Math.max(0,rect.top-margin-gap);
			if(below<220&&above>below)setMenuPos({left,bottom:window.innerHeight-rect.top+gap,width,maxHeight:Math.max(120,above)});
			else setMenuPos({left,top:rect.bottom+gap,width,maxHeight:Math.max(120,below)});
		};
		const onKey=(e:KeyboardEvent)=>{if(e.key==="Escape"){setOpen(false);setShowLists(false)}};
		positionMenu();
		window.addEventListener("resize",positionMenu);
		window.addEventListener("scroll",positionMenu,true);
		window.addEventListener("keydown",onKey);
		return()=>{window.removeEventListener("resize",positionMenu);window.removeEventListener("scroll",positionMenu,true);window.removeEventListener("keydown",onKey)};
	},[open,showLists]);

	const menu=open&&typeof document!=="undefined"?createPortal(<><button className="fixed inset-0 z-[77] cursor-default" onClick={()=>{setOpen(false);setShowLists(false)}} aria-label="Close menu"/><div className="fixed z-[78] rounded-xl border border-neutral-700 bg-neutral-950 shadow-2xl p-1 text-sm overflow-y-auto" style={{left:menuPos.left,top:menuPos.top,bottom:menuPos.bottom,width:menuPos.width,maxHeight:menuPos.maxHeight}}>{!showLists?<><MenuButton onClick={()=>{onSave(track);setOpen(false)}}>{track.isSaved?"✓ Saved to Library":"♡ Save Song"}</MenuButton><MenuButton onClick={()=>{onRadio(track);setOpen(false)}}>📻 Start Song Radio</MenuButton>{onOpenRelease&&<MenuButton onClick={()=>{onOpenRelease(track.releaseId);setOpen(false)}}>💿 Open Release</MenuButton>}<MenuButton onClick={loadLists}>＋ Add to Playlist…</MenuButton>{track.isOwner&&<><MenuButton onClick={()=>{onEdit(track);setOpen(false)}}>✎ Edit Track</MenuButton>{onRemove&&<MenuButton onClick={()=>{setOpen(false);onRemove(track)}}>🗑 Remove from World</MenuButton>}</>}</>:<><div className="px-2 py-1.5 text-xs text-neutral-500">Add to playlist</div>{lists.length===0?<div className="px-2 py-3 text-xs text-neutral-500">Create a playlist from My Library first.</div>:lists.map((p)=><MenuButton key={p.id} onClick={async()=>{await addTrackToWorldPlaylist(p.id,track.id);setOpen(false);setShowLists(false)}}>{p.title}</MenuButton>)}<MenuButton onClick={()=>setShowLists(false)}>← Back</MenuButton></>}</div></>,document.body):null;
	return <div className="relative"><button ref={buttonRef} onClick={()=>setOpen(v=>!v)} className="h-8 w-8 rounded-lg hover:bg-neutral-800 text-neutral-400 text-xl leading-none" aria-label="Song actions">⋮</button>{menu}</div>;
}
function MenuButton({children,onClick}:{children:React.ReactNode;onClick:()=>void}){return <button onClick={onClick} className="w-full text-left rounded-lg px-2.5 py-2 hover:bg-neutral-800">{children}</button>}

function ReleaseView({ release,onBack,onPlay,onReact,onOpenTrack,onEditTrack,onEditRelease,onSaveRelease,onFollowArtist,onArtistRadio,onSaveTrack,onSongRadio,onRemoveTrack,onRemoveRelease,currentId,playing }:{ release:WorldRelease;onBack:()=>void;onPlay:(t:WorldTrack)=>void;onReact:(t:WorldTrack,r:-1|1)=>void;onOpenTrack:(t:WorldTrack)=>void;onEditTrack:(t:WorldTrack)=>void;onEditRelease:()=>void;onSaveRelease:()=>void;onFollowArtist:()=>void;onArtistRadio:()=>void;onSaveTrack:(t:WorldTrack)=>void;onSongRadio:(t:WorldTrack)=>void;onRemoveTrack:(t:WorldTrack)=>void;onRemoveRelease:()=>void;currentId?:string;playing:boolean }) {
	const coverTrack=release.tracks.find(x=>x.hasArtwork)||release.tracks[0];
	return <div><div className="flex items-center justify-between gap-3 mb-5"><button onClick={onBack} className="text-sm text-neutral-400 hover:text-white">← Back to World</button>{release.isOwner&&<div className="flex gap-2"><YSButton onClick={onEditRelease} className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm">Edit Release</YSButton><YSButton onClick={onRemoveRelease} className="rounded-lg border border-red-500/30 px-3 py-1.5 text-sm text-red-300 hover:bg-red-500/10">Remove Release</YSButton></div>}</div><div className="grid grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)] gap-6 items-end mb-6">{coverTrack?<Artwork track={coverTrack} className="w-full max-w-[240px] aspect-square rounded-2xl shadow-2xl"/>:<div className="aspect-square rounded-2xl bg-neutral-900"/>}<div><div className="uppercase tracking-[0.2em] text-xs text-neutral-500">{release.releaseType}</div><h1 className="text-3xl md:text-4xl font-bold mt-1">{release.title}</h1><div className="text-lg text-neutral-300 mt-2">{release.artistName}</div><div className="text-sm text-neutral-500 mt-1">{release.genre}</div><div className="flex flex-wrap gap-2 mt-4"><YSButton onClick={onSaveRelease} className={`rounded-full px-4 py-2 text-sm border ${release.isSaved?"border-indigo-400 bg-indigo-500/15 text-indigo-200":"border-neutral-700"}`}>{release.isSaved?"✓ Saved Album":"＋ Save Album"}</YSButton><YSButton onClick={onFollowArtist} className={`rounded-full px-4 py-2 text-sm border ${release.isArtistFollowed?"border-amber-400 bg-amber-500/10 text-amber-200":"border-neutral-700"}`}>{release.isArtistFollowed?"✓ Following":"＋ Follow Artist"}</YSButton><YSButton onClick={onArtistRadio} className="rounded-full px-4 py-2 text-sm border border-neutral-700">📻 Artist Radio</YSButton></div></div></div><div className="rounded-2xl border border-neutral-800 overflow-hidden">{release.tracks.map((track)=><TrackRow key={track.id} track={track} current={currentId===track.id} playing={playing} onPlay={onPlay} onOpen={onOpenTrack} onReact={onReact} onSave={onSaveTrack} onRadio={onSongRadio} onEdit={onEditTrack} onRemove={onRemoveTrack}/>)}</div></div>;
}

function TrackDetailView({track,onBack,onPlay,onReact,onSave,onSaveRelease,onFollow,onOpenRelease,onArtistRadio,onSongRadio,onRemove}:{track:WorldTrack;onBack:()=>void;onPlay:(t:WorldTrack)=>void;onReact:(t:WorldTrack,r:-1|1)=>void;onSave:(t:WorldTrack)=>void;onSaveRelease:()=>void;onFollow:()=>void;onOpenRelease:()=>void;onArtistRadio:()=>void;onSongRadio:()=>void;onRemove?:()=>void}) {
	return <div className="max-w-5xl mx-auto"><button onClick={onBack} className="text-sm text-neutral-400 hover:text-white mb-5">← Back</button><div className="grid grid-cols-1 md:grid-cols-[280px_minmax(0,1fr)] gap-6 items-end"><Artwork track={track} className="w-full max-w-[280px] aspect-square rounded-2xl shadow-2xl"/><div><div className="text-xs uppercase tracking-[.2em] text-indigo-300">Song</div><h1 className="text-3xl md:text-4xl font-bold mt-1">{track.title}</h1><button onClick={onOpenRelease} className="text-lg text-neutral-300 mt-2 hover:text-white">{track.artistName} • {track.albumName}</button><div className="text-sm text-neutral-500 mt-1">{track.genre} {track.explicit?"• Explicit":""}</div><div className="flex flex-wrap gap-2 mt-5"><YSButton onClick={()=>onPlay(track)} className="rounded-full bg-white text-black px-5 py-2">▶ Play</YSButton><YSButton onClick={()=>onReact(track,1)} className={`rounded-full border px-4 py-2 ${track.myReaction===1?"border-indigo-400 bg-indigo-500/15":"border-neutral-700"}`}>♥ {prettyCount(track.likes)}</YSButton><YSButton onClick={()=>onSave(track)} className={`rounded-full border px-4 py-2 ${track.isSaved?"border-indigo-400 bg-indigo-500/15":"border-neutral-700"}`}>{track.isSaved?"✓ Saved":"＋ Save Song"}</YSButton><YSButton onClick={onSaveRelease} className="rounded-full border border-neutral-700 px-4 py-2">{track.isReleaseSaved?"✓ Album Saved":"＋ Save Album"}</YSButton><YSButton onClick={onFollow} className="rounded-full border border-neutral-700 px-4 py-2">{track.isArtistFollowed?"✓ Following":"＋ Follow Artist"}</YSButton><YSButton onClick={onSongRadio} className="rounded-full border border-neutral-700 px-4 py-2">📻 Song Radio</YSButton><YSButton onClick={onArtistRadio} className="rounded-full border border-neutral-700 px-4 py-2">📻 Artist Radio</YSButton>{track.isOwner&&onRemove&&<YSButton onClick={onRemove} className="rounded-full border border-red-500/30 text-red-300 px-4 py-2 hover:bg-red-500/10">Remove from World</YSButton>}</div>{track.description&&<p className="text-sm text-neutral-400 mt-5 max-w-2xl whitespace-pre-wrap">{track.description}</p>}</div></div><div className="mt-8"><CommentThread track={track}/></div></div>;
}

function PlaylistView({detail,onBack,onPlay,onOpenTrack,onSavePlaylist,onPlayAll,onRemove,onMove}:{detail:WorldPlaylistDetail;onBack:()=>void;onPlay:(t:WorldTrack)=>void;onOpenTrack:(t:WorldTrack)=>void;onSavePlaylist:()=>void;onPlayAll:()=>void;onRemove:(id:string)=>void;onMove:(id:string,dir:-1|1)=>void}) {
	const {playlist,tracks}=detail;
	const cover=playlist.coverTrackId;
	const albumEntries=[...new Map(tracks.filter(t=>t.albumName).map(t=>[t.releaseId||t.albumName,{key:t.releaseId||t.albumName,label:t.albumName}])).values()];
	const [visuals,setVisuals]=useState<VisualScenePreset<VisualSceneState>[]>([]);
	const [program,setProgram]=useState<VisualBroadcastProgram|null>(null);
	const [globals,setGlobals]=useState<VisualBroadcastGlobals|null>(null);
	const [broadcastBusy,setBroadcastBusy]=useState(false);
	const [broadcastNote,setBroadcastNote]=useState("");
	const [previewing,setPreviewing]=useState("");
	useEffect(()=>{
		let cancelled=false;
		Promise.all([bridgeApi.getVisualLibrary<VisualSceneState>(), bridgeApi.getVisualProgram(playlist.id), bridgeApi.getVisualBroadcastGlobals()])
			.then(([library,nextProgram,nextGlobals])=>{if(cancelled)return;setVisuals(library.presets||[]);setProgram(normalizeVisualBroadcastProgram(nextProgram,playlist.id,{kind:"playlist",name:playlist.title}));setGlobals(normalizeVisualBroadcastGlobals(nextGlobals))})
			.catch(()=>{if(!cancelled)setBroadcastNote("Start YSong Bridge to edit broadcast visuals.")});
		return()=>{cancelled=true};
	},[playlist.id,playlist.title]);
	const saveProgram=async(next:VisualBroadcastProgram)=>{
		const normalized=normalizeVisualBroadcastProgram({...next,programId:playlist.id,playlistId:playlist.id,kind:"playlist",name:playlist.title},playlist.id,{kind:"playlist",name:playlist.title});
		setProgram(normalized);setBroadcastBusy(true);setBroadcastNote("");
		try{await bridgeApi.setVisualProgram(playlist.id,normalized);window.dispatchEvent(new CustomEvent("ysong:world-broadcast-program",{detail:normalized}));setBroadcastNote("Broadcast program saved.")}
		catch(e:any){setBroadcastNote(e?.message||"Could not save broadcast program.")}
		finally{setBroadcastBusy(false)}
	};
	const saveGlobals=async(next:VisualBroadcastGlobals)=>{
		const normalized=normalizeVisualBroadcastGlobals(next);setGlobals(normalized);setBroadcastBusy(true);setBroadcastNote("");
		try{await bridgeApi.setVisualBroadcastGlobals(normalized);window.dispatchEvent(new CustomEvent("ysong:world-broadcast-globals",{detail:normalized}));setBroadcastNote("Global broadcast fallback saved.")}
		catch(error:unknown){setBroadcastNote(errorMessage(error,"Could not save global fallback."))}
		finally{setBroadcastBusy(false)}
	};
	const patchProgram=(patch:Partial<VisualBroadcastProgram>)=>{if(program)void saveProgram({...program,...patch})};
	const patchBranding=(patch:Partial<VisualBroadcastProgram["branding"]>)=>{if(program)void saveProgram({...program,branding:{...program.branding,...patch}})};
	const patchTiming=(patch:Partial<VisualBroadcastProgram["timing"]>)=>{if(program)void saveProgram({...program,timing:{...program.timing,...patch}})};
	const togglePool=(current:string[],sceneId:string)=>current.includes(sceneId)?current.filter(id=>id!==sceneId):[...current,sceneId];
	const toggleDefaultScene=(sceneId:string)=>{if(program)void saveProgram({...program,defaultSceneIds:togglePool(program.defaultSceneIds,sceneId)})};
	const toggleAlbumScene=(albumKey:string,sceneId:string,legacyAlbumName?:string)=>{
		if(!program)return;
		const next={...program.albumDefaults};
		const inherited=next[albumKey]||(legacyAlbumName?next[legacyAlbumName]:undefined)||[];
		const ids=togglePool(inherited,sceneId);
		if(legacyAlbumName&&legacyAlbumName!==albumKey)delete next[legacyAlbumName];
		if(ids.length)next[albumKey]=ids;else delete next[albumKey];
		void saveProgram({...program,albumDefaults:next});
	};
	const patchTrackAssignment=(trackId:string,patch:Partial<VisualBroadcastAssignment>)=>{
		if(!program)return;
		const current:VisualBroadcastAssignment=program.trackAssignments[trackId]||{sceneIds:[]};
		const nextAssignment={...current,...patch};
		const hasOverrides=nextAssignment.sceneIds.length||nextAssignment.visualTransition||nextAssignment.visualTransitionSeconds!=null||nextAssignment.audioTransition||nextAssignment.crossfadeSeconds!=null;
		const nextAssignments={...program.trackAssignments};
		if(hasOverrides)nextAssignments[trackId]=nextAssignment;else delete nextAssignments[trackId];
		void saveProgram({...program,trackAssignments:nextAssignments});
	};
	const toggleTrackScene=(trackId:string,sceneId:string)=>{
		if(!program)return;
		const current=program.trackAssignments[trackId]?.sceneIds||[];
		patchTrackAssignment(trackId,{sceneIds:togglePool(current,sceneId)});
	};
	const clearTrackOverrides=(trackId:string)=>{
		if(!program)return;
		const next={...program.trackAssignments};delete next[trackId];void saveProgram({...program,trackAssignments:next});
	};
	const previewScene=async(preset:VisualScenePreset<VisualSceneState>,track?:WorldTrack)=>{
		setPreviewing(preset.id);
		try{
			const base=normalizeVisualScene(preset.scene);
			const next={...base,nowPlaying:{...base.nowPlaying,title:track?.title||base.nowPlaying.title,artist:track?.artistName||base.nowPlaying.artist,album:track?.albumName||base.nowPlaying.album},updatedAt:Date.now()};
			await bridgeApi.setVisualScene(next);setBroadcastNote(`Previewing visual scene “${preset.name}”.`);
		}catch(e:unknown){setBroadcastNote(e instanceof Error?e.message:"Could not preview visual scene.")}
		finally{setPreviewing("")}
	};
	const sceneNames=(ids:string[])=>ids.map(id=>visuals.find(v=>v.id===id)?.name).filter(Boolean) as string[];
	const resolvedVisualLabel=(track:WorldTrack)=>{
		const direct=program?.trackAssignments[track.id]?.sceneIds||[];
		if(direct.length)return `${direct.length} song visual${direct.length===1?"":"s"}`;
		const album=program?.albumDefaults[track.releaseId]||program?.albumDefaults[track.albumName]||[];
		if(album.length)return `${album.length} album visual${album.length===1?"":"s"}`;
		const defaults=program?.defaultSceneIds||[];
		if(defaults.length)return `${defaults.length} playlist visual${defaults.length===1?"":"s"}`;
		const globalDefaults=globals?.defaultSceneIds||[];
		if(globalDefaults.length)return `${globalDefaults.length} global visual${globalDefaults.length===1?"":"s"}`;
		return "current scene fallback";
	};

	return <div className="max-w-6xl mx-auto">
		<button onClick={onBack} className="text-sm text-neutral-400 hover:text-white mb-5">← Back to World</button>
		<div className="grid grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)] gap-6 items-end mb-6">
			{cover?<img src={worldArtworkUrl(cover)} alt="" className="w-full max-w-[240px] aspect-square rounded-2xl object-cover"/>:<div className="w-full max-w-[240px] aspect-square rounded-2xl bg-gradient-to-br from-indigo-500/30 to-neutral-950 grid place-items-center text-6xl">♫</div>}
			<div><div className="uppercase tracking-[.2em] text-xs text-neutral-500">Playlist</div><h1 className="text-3xl md:text-4xl font-bold mt-1">{playlist.title}</h1><div className="text-neutral-400 mt-2">by {playlist.ownerName} • {tracks.length} songs</div>{playlist.description&&<p className="text-sm text-neutral-500 mt-2">{playlist.description}</p>}<div className="flex flex-wrap gap-2 mt-4"><YSButton disabled={!tracks.length} onClick={onPlayAll} className="rounded-full bg-white text-black px-5 py-2">{playlist.isOwner&&program?"▶ Start Broadcast":"▶ Play All"}</YSButton>{!playlist.isOwner&&<YSButton onClick={onSavePlaylist} className="rounded-full border border-neutral-700 px-4 py-2">{playlist.isSaved?"✓ Saved":"＋ Save Playlist"}</YSButton>}</div></div>
		</div>
		{playlist.isOwner&&program?<div className="mb-5 rounded-2xl border border-violet-500/25 bg-violet-500/5 p-4">
			<div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-xs font-bold uppercase tracking-[.18em] text-violet-300">Broadcast Program</div><div className="mt-1 text-sm text-neutral-400">Songs, visual pools, radio rules and scene transitions travel together with this playlist.</div></div><div className="text-right"><div className="text-xs text-neutral-500">{broadcastBusy?"Saving…":broadcastNote}</div><div className="mt-1 text-[10px] text-neutral-600">{visuals.length} saved visual scene{visuals.length===1?"":"s"} available</div></div></div>
			<div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
				<label className="text-xs text-neutral-400">Audio transition<select value={program.audioTransition} onChange={e=>patchProgram({audioTransition:e.target.value as VisualBroadcastProgram["audioTransition"]})} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-neutral-100"><option value="regular">Regular</option><option value="gapless">Gapless</option><option value="crossfade">Crossfade</option></select></label>
				<label className="text-xs text-neutral-400">Crossfade<input type="number" min={0.5} max={20} step={0.5} value={program.crossfadeSeconds} onChange={e=>patchProgram({crossfadeSeconds:Math.max(.5,Math.min(20,Number(e.target.value)||5))})} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-neutral-100"/></label>
				<label className="text-xs text-neutral-400">Visual transition<select value={program.visualTransition} onChange={e=>patchProgram({visualTransition:e.target.value as VisualBroadcastProgram["visualTransition"]})} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-neutral-100"><option value="cut">Cut</option><option value="fade">Soft Fade</option><option value="black">Black Fade</option><option value="flash">Flash</option></select></label>
				<label className="text-xs text-neutral-400">Visual seconds<input type="number" min={0.1} max={12} step={0.1} value={program.visualTransitionSeconds} onChange={e=>patchProgram({visualTransitionSeconds:Math.max(.1,Math.min(12,Number(e.target.value)||1.4))})} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-neutral-100"/></label>
				<label className="text-xs text-neutral-400">Repeat<select value={program.repeatMode} onChange={e=>patchProgram({repeatMode:e.target.value as VisualBroadcastProgram["repeatMode"]})} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-neutral-100"><option value="all">All</option><option value="off">Off</option><option value="one">One</option></select></label>
				<label className="flex items-center gap-2 self-end rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-2.5 text-xs"><input type="checkbox" checked={program.shuffle} onChange={e=>patchProgram({shuffle:e.target.checked})}/> Shuffle</label>
				<label className="text-[11px] text-neutral-400">Avoid songs<input type="number" min={0} max={100} value={program.avoidRecent} onChange={e=>patchProgram({avoidRecent:Math.max(0,Math.min(100,Number(e.target.value)||0))})} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-neutral-100"/></label>
				<label className="text-[11px] text-neutral-400">Avoid visuals<input type="number" min={0} max={50} value={program.visualAvoidRecent} onChange={e=>patchProgram({visualAvoidRecent:Math.max(0,Math.min(50,Number(e.target.value)||0))})} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-neutral-100"/></label>
			</div>

			<div className="mt-4 grid grid-cols-1 gap-3 border-t border-violet-400/10 pt-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,.8fr)]">
				<div className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-3"><div className="mb-3 text-[10px] font-bold uppercase tracking-[.16em] text-neutral-500">Broadcast Branding</div><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={program.branding.enabled} onChange={e=>patchBranding({enabled:e.target.checked})}/> Enable program branding</label><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={program.branding.showStationBug} onChange={e=>patchBranding({showStationBug:e.target.checked})}/> Program bug</label>
					<label className="text-xs text-neutral-400 sm:col-span-2">Program label<input value={program.branding.stationLabel} placeholder={playlist.title} onChange={e=>patchBranding({stationLabel:e.target.value})} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-neutral-100"/></label>
					<label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={program.branding.showNowPlaying} onChange={e=>patchBranding({showNowPlaying:e.target.checked})}/> Now Playing</label><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={program.branding.showNextUp} onChange={e=>patchBranding({showNextUp:e.target.checked})}/> Up Next</label>
					<label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={program.branding.showQueueLabel} onChange={e=>patchBranding({showQueueLabel:e.target.checked})}/> Queue label</label><label className="text-xs text-neutral-400">Bug position<select value={program.branding.bugPosition} onChange={e=>patchBranding({bugPosition:e.target.value as VisualBroadcastProgram["branding"]["bugPosition"]})} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-neutral-100"><option value="top-right">Top Right</option><option value="top-left">Top Left</option><option value="bottom-right">Bottom Right</option><option value="bottom-left">Bottom Left</option></select></label>
				</div></div>
				<div className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-3"><div className="mb-3 text-[10px] font-bold uppercase tracking-[.16em] text-neutral-500">Broadcast Timing</div><div className="grid grid-cols-1 gap-3">
					<label className="text-xs text-neutral-400">Now Playing delay<input type="number" min={0} max={30} step={.5} value={program.timing.nowPlayingDelaySeconds} onChange={e=>patchTiming({nowPlayingDelaySeconds:Math.max(0,Math.min(30,Number(e.target.value)||0))})} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-neutral-100"/></label>
					<label className="text-xs text-neutral-400">Now Playing hold<input type="number" min={0} max={120} step={.5} value={program.timing.nowPlayingHoldSeconds} onChange={e=>patchTiming({nowPlayingHoldSeconds:Math.max(0,Math.min(120,Number(e.target.value)||0))})} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-neutral-100"/><span className="mt-1 block text-[9px] text-neutral-600">0 = whole song</span></label>
					<label className="text-xs text-neutral-400">Up Next lead<input type="number" min={0} max={60} step={.5} value={program.timing.nextUpLeadSeconds} onChange={e=>patchTiming({nextUpLeadSeconds:Math.max(0,Math.min(60,Number(e.target.value)||0))})} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-neutral-100"/></label>
				</div></div>
			</div>


			<div className="mt-3 rounded-xl border border-cyan-500/15 bg-cyan-500/[.03] px-3 py-2 text-[10px] text-neutral-500"><span className="font-semibold text-cyan-300">Visual resolution:</span> Song override → Album pool → Playlist pool → Global pool → current scene. Every pool can contain several scenes; YSong rotates them while honoring the recent-visual window.</div>

			<div className="mt-4 border-t border-violet-400/10 pt-3">
				<div className="mb-2 flex items-center justify-between gap-3"><div><div className="text-[10px] font-bold uppercase tracking-[.16em] text-neutral-500">Playlist visual pool</div><div className="text-[10px] text-neutral-600">Used when a song and album do not override it. Several checked scenes rotate randomly without immediate repeats.</div></div><span className="text-[10px] text-violet-300">{program.defaultSceneIds.length} selected</span></div>
				<div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-4">{visuals.length?visuals.map(v=><div key={v.id} className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs ${program.defaultSceneIds.includes(v.id)?"border-violet-400/30 bg-violet-500/10":"border-neutral-800 bg-neutral-950"}`}><label className="flex min-w-0 flex-1 items-center gap-2"><input type="checkbox" checked={program.defaultSceneIds.includes(v.id)} onChange={()=>toggleDefaultScene(v.id)}/><span className="truncate">{v.name}</span></label><button onClick={()=>void previewScene(v)} disabled={previewing===v.id} className="rounded px-1.5 py-1 text-[10px] text-neutral-500 hover:bg-neutral-800 hover:text-white">{previewing===v.id?"…":"Preview"}</button></div>):<div className="text-xs text-neutral-500">Save scenes from Visuals first.</div>}</div>
			</div>

			{globals?<div className="mt-4"><GlobalBroadcastEditor globals={globals} visuals={visuals} onChange={next=>void saveGlobals(next)}/></div>:null}

			{albumEntries.length?<div className="mt-4 border-t border-violet-400/10 pt-3"><div className="mb-2 text-[10px] font-bold uppercase tracking-[.16em] text-neutral-500">Album visual pools</div><div className="grid grid-cols-1 gap-2 md:grid-cols-2">{albumEntries.map(album=>{const selected=program.albumDefaults[album.key]||program.albumDefaults[album.label]||[];return <details key={album.key} className="rounded-xl border border-neutral-800 bg-neutral-950/70 p-2"><summary className="cursor-pointer text-xs text-neutral-300"><span className="font-semibold">{album.label}</span><span className="ml-2 text-[10px] text-violet-300">{selected.length?`${selected.length} visual${selected.length===1?"":"s"}`:"playlist pool"}</span></summary><div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">{visuals.map(v=><label key={v.id} className="flex items-center gap-2 rounded border border-neutral-800 px-2 py-1 text-[10px] text-neutral-400"><input type="checkbox" checked={selected.includes(v.id)} onChange={()=>toggleAlbumScene(album.key,v.id,album.label)}/><span className="truncate">{v.name}</span></label>)}</div></details>})}</div></div>:null}
		</div>:null}

		<div className="rounded-2xl border border-neutral-800 overflow-hidden">{tracks.length===0?<div className="p-8 text-center text-neutral-500">This playlist is empty.</div>:tracks.map((t,i)=>{
			const assignment=program?.trackAssignments[t.id];
			const assigned=assignment?.sceneIds||[];
			const directNames=sceneNames(assigned);
			return <div key={t.id} className="border-b last:border-0 border-neutral-800"><div className="grid grid-cols-[40px_minmax(0,1fr)_auto] gap-3 items-center p-2.5"><button onClick={()=>onPlay(t)} className="h-9 w-9 rounded-full border border-neutral-700">▶</button><button onClick={()=>onOpenTrack(t)} className="text-left min-w-0"><div className="font-medium truncate">{i+1}. {t.title}</div><div className="text-xs text-neutral-500 truncate">{t.artistName} • {t.albumName}</div>{program?<div className="mt-1 text-[10px] text-violet-300/80">{resolvedVisualLabel(t)}{directNames.length?` • ${directNames.join(" / ")}`:""}</div>:null}</button>{playlist.isOwner&&<div className="flex gap-1"><button disabled={i===0} onClick={()=>onMove(t.id,-1)} className="px-2 py-1 rounded hover:bg-neutral-800 disabled:opacity-25">↑</button><button disabled={i===tracks.length-1} onClick={()=>onMove(t.id,1)} className="px-2 py-1 rounded hover:bg-neutral-800 disabled:opacity-25">↓</button><button onClick={()=>onRemove(t.id)} className="px-2 py-1 rounded hover:bg-red-500/10 text-red-300">✕</button></div>}</div>
			{playlist.isOwner&&program&&<details className="border-t border-neutral-900 bg-neutral-950/70 px-3 py-2"><summary className="cursor-pointer text-xs text-violet-300">Broadcast setup: {resolvedVisualLabel(t)}{assignment?.audioTransition?` • ${assignment.audioTransition}`:""}</summary>
				<div className="mt-3"><div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-neutral-600">Song visual pool</div><div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">{visuals.length?visuals.map(v=><div key={v.id} className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs ${assigned.includes(v.id)?"border-violet-400/30 bg-violet-500/10":"border-neutral-800"}`}><label className="flex min-w-0 flex-1 items-center gap-2 text-neutral-300"><input type="checkbox" checked={assigned.includes(v.id)} onChange={()=>toggleTrackScene(t.id,v.id)}/><span className="truncate">{v.name}</span></label><button onClick={()=>void previewScene(v,t)} className="rounded px-1 text-[9px] text-neutral-600 hover:text-white">Preview</button></div>):<span className="text-xs text-neutral-500">Save scenes from Visuals first.</span>}</div></div>
				<div className="mt-3 grid grid-cols-1 gap-2 border-t border-neutral-900 pt-3 sm:grid-cols-2 lg:grid-cols-5">
					<label className="text-[10px] text-neutral-500">Audio into this track<select value={assignment?.audioTransition||""} onChange={e=>patchTrackAssignment(t.id,{audioTransition:(e.target.value||undefined) as VisualBroadcastAssignment["audioTransition"]})} className="mt-1 w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-neutral-300"><option value="">Program default</option><option value="regular">Regular</option><option value="gapless">Gapless</option><option value="crossfade">Crossfade</option></select></label>
					<label className="text-[10px] text-neutral-500">Track crossfade<input type="number" min={0.5} max={20} step={0.5} value={assignment?.crossfadeSeconds??program.crossfadeSeconds} onChange={e=>patchTrackAssignment(t.id,{crossfadeSeconds:Math.max(.5,Math.min(20,Number(e.target.value)||program.crossfadeSeconds))})} className="mt-1 w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-neutral-300"/></label>
					<label className="text-[10px] text-neutral-500">Visual into this track<select value={assignment?.visualTransition||""} onChange={e=>patchTrackAssignment(t.id,{visualTransition:(e.target.value||undefined) as VisualBroadcastAssignment["visualTransition"]})} className="mt-1 w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-neutral-300"><option value="">Program default</option><option value="cut">Cut</option><option value="fade">Soft Fade</option><option value="black">Black Fade</option><option value="flash">Flash</option></select></label>
					<label className="text-[10px] text-neutral-500">Visual seconds<input type="number" min={0.1} max={12} step={0.1} value={assignment?.visualTransitionSeconds??program.visualTransitionSeconds} onChange={e=>patchTrackAssignment(t.id,{visualTransitionSeconds:Math.max(.1,Math.min(12,Number(e.target.value)||program.visualTransitionSeconds))})} className="mt-1 w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-neutral-300"/></label>
					<div className="flex items-end"><button onClick={()=>clearTrackOverrides(t.id)} className="w-full rounded border border-neutral-800 px-2 py-1.5 text-[10px] text-neutral-500 hover:border-red-400/30 hover:text-red-300">Clear song overrides</button></div>
				</div>
			</details>}
			</div>})}</div>
	</div>;
}

function CommentThread({track}:{track:WorldTrack}) {
	const [comments,setComments]=useState<WorldComment[]>([]);
	const [body,setBody]=useState("");
	const [replyTo,setReplyTo]=useState<WorldComment|null>(null);
	const [loading,setLoading]=useState(true);
	const [busy,setBusy]=useState(false);
	const bodyRef=useRef<HTMLTextAreaElement|null>(null);
	const load=async()=>{setLoading(true);try{setComments((await fetchWorldComments(track.id)).comments||[])}finally{setLoading(false)}};
	useEffect(()=>{load()},[track.id]);
	const roots=comments.filter(c=>!c.parentId); const replies=(id:string)=>comments.filter(c=>c.parentId===id);
	const submit=async()=>{if(!body.trim())return;setBusy(true);try{await createWorldComment(track.id,body.trim(),replyTo ? (replyTo.parentId || replyTo.id) : null);setBody("");setReplyTo(null);await load()}finally{setBusy(false)}};
	const like=async(c:WorldComment)=>{const r=await toggleWorldCommentLike(c.id);setComments(prev=>prev.map(x=>x.id===c.id?{...x,likedByMe:r.liked,likes:r.likes}:x))};
	const pin=async(c:WorldComment)=>{await toggleWorldCommentPin(c.id);await load()}; const del=async(c:WorldComment)=>{if(!window.confirm("Delete this comment?"))return;await deleteWorldComment(c.id);await load()};
	const report=async(c:WorldComment)=>{const reason=window.prompt("Report reason (optional)","")??"";await reportWorldComment(c.id,reason||"reported");window.alert("Comment reported. Thank you.")};
	return <div>
		<SectionTitle title={`Comments${comments.filter((c)=>!c.isDeleted).length?` (${comments.filter((c)=>!c.isDeleted).length})`:""}`} subtitle="Talk about the song, not around it."/>
		<div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-3 mb-4">
			{replyTo&&<div className="text-xs text-indigo-300 mb-2">Replying to @{replyTo.authorName} <button onClick={()=>setReplyTo(null)} className="text-neutral-500 ml-2 hover:text-white">cancel</button></div>}
			<textarea ref={bodyRef} value={body} onChange={(e)=>setBody(e.target.value)} rows={3} maxLength={2000} placeholder="Add a comment…" className="w-full rounded-xl bg-neutral-950 border border-neutral-700 px-3 py-2 outline-none focus:border-indigo-400 resize-y"/>
			<div className="flex justify-between items-center mt-2 text-xs text-neutral-600">
				<div className="flex items-center gap-2"><EmojiPickerButton inputRef={bodyRef} value={body} onChange={setBody} buttonClassName="h-8 w-8 text-lg text-neutral-300"/><span>{body.length}/2000</span></div>
				<YSButton disabled={busy||!body.trim()} onClick={submit} className="rounded-lg bg-indigo-600 disabled:opacity-40 px-4 py-2 text-sm text-white">{busy?"Posting…":"Comment"}</YSButton>
			</div>
		</div>
		{loading?<div className="text-sm text-neutral-500">Loading comments…</div>:roots.length===0?<div className="text-sm text-neutral-500 py-6 text-center">No comments yet. Be the first.</div>:<div className="space-y-3">{roots.map(c=><CommentCard key={c.id} c={c} replies={replies(c.id)} onReply={(comment)=>{setReplyTo(comment);requestAnimationFrame(()=>bodyRef.current?.focus())}} onLike={like} onPin={pin} onDelete={del} onReport={report}/>)}</div>}
	</div>;
}

function CommentCard({c,replies,onReply,onLike,onPin,onDelete,onReport}:{c:WorldComment;replies:WorldComment[];onReply:(c:WorldComment)=>void;onLike:(c:WorldComment)=>void;onPin:(c:WorldComment)=>void;onDelete:(c:WorldComment)=>void;onReport:(c:WorldComment)=>void}) { return <div className={`rounded-2xl border p-3 ${c.isPinned?"border-indigo-400/30 bg-indigo-500/5":"border-neutral-800 bg-neutral-900/45"}`}>{c.isPinned&&<div className="text-[10px] uppercase tracking-wider text-indigo-300 mb-1">📌 Creator pinned</div>}<div className="flex justify-between gap-3"><div><span className="font-semibold text-sm">{c.authorName}</span><span className="text-[10px] text-neutral-600 ml-2">{new Date(c.createdAt).toLocaleString()}</span></div></div><div className={`text-sm mt-1 whitespace-pre-wrap ${c.isDeleted?"italic text-neutral-600":"text-neutral-300"}`}>{c.body}</div><div className="flex flex-wrap gap-3 mt-2 text-xs text-neutral-500"><button onClick={()=>onLike(c)} className={c.likedByMe?"text-indigo-300":"hover:text-white"}>♥ {c.likes||""}</button>{!c.isDeleted&&<button onClick={()=>onReply(c)} className="hover:text-white">Reply</button>}{c.canModerate&&!c.isDeleted&&<button onClick={()=>onPin(c)} className="hover:text-indigo-300">{c.isPinned?"Unpin":"Pin"}</button>}{(c.isMine||c.canModerate)&&!c.isDeleted&&<button onClick={()=>onDelete(c)} className="hover:text-red-300">Delete</button>}{!c.isMine&&!c.isDeleted&&<button onClick={()=>onReport(c)} className="hover:text-amber-300">Report</button>}</div>{replies.length>0&&<div className="mt-3 ml-4 pl-3 border-l border-neutral-800 space-y-3">{replies.map(r=><CommentCard key={r.id} c={r} replies={[]} onReply={onReply} onLike={onLike} onPin={onPin} onDelete={onDelete} onReport={onReport}/>)}</div>}</div> }

function ModalShell({ title, children, onCancel }: { title:string;children:React.ReactNode;onCancel:()=>void }) { return <div className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm grid place-items-center p-4" onMouseDown={(e)=>{if(e.target===e.currentTarget)onCancel()}}><div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border border-neutral-700 bg-neutral-950 shadow-2xl p-5"><div className="flex items-center justify-between gap-3 mb-4"><h2 className="text-xl font-semibold">{title}</h2><button onClick={onCancel} className="text-neutral-400 hover:text-white">✕</button></div>{children}</div></div> }
function TrackEditModal({track,onCancel,onSave}:{track:WorldTrack;onCancel:()=>void;onSave:(track:WorldTrack)=>Promise<void>}) { const [draft,setDraft]=useState<WorldTrack>(()=>({...track,tags:[...track.tags]}));const [tags,setTags]=useState(track.tags.join(", "));const [busy,setBusy]=useState(false);const [error,setError]=useState("");const save=async()=>{setBusy(true);setError("");try{await onSave({...draft,tags:tags.split(",").map(x=>x.trim()).filter(Boolean).slice(0,20)})}catch(e:any){setError(e?.message||"Could not update track")}finally{setBusy(false)}};return <ModalShell title="Edit Track" onCancel={onCancel}><div className="space-y-3"><EditField label="Song title"><input className="world-edit-input" value={draft.title} onChange={(e)=>setDraft({...draft,title:e.target.value})}/></EditField><div className="grid grid-cols-1 sm:grid-cols-[1fr_110px] gap-3"><EditField label="Genre"><input className="world-edit-input" value={draft.genre} onChange={(e)=>setDraft({...draft,genre:e.target.value})}/></EditField><EditField label="Track #"><input className="world-edit-input" type="number" min={1} value={draft.trackNumber} onChange={(e)=>setDraft({...draft,trackNumber:Number(e.target.value)})}/></EditField></div><EditField label="Tags"><input className="world-edit-input" value={tags} onChange={(e)=>setTags(e.target.value)}/></EditField><EditField label="Description"><textarea className="world-edit-input resize-y" rows={4} value={draft.description||""} onChange={(e)=>setDraft({...draft,description:e.target.value})}/></EditField><div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><EditField label="Release history"><select className="world-edit-input" value={draft.previouslyReleased?"released":"unreleased"} onChange={(e)=>setDraft({...draft,previouslyReleased:e.target.value==="released"})}><option value="unreleased">Unreleased original</option><option value="released">Previously released</option></select></EditField><EditField label="ISRC"><input className="world-edit-input font-mono" value={draft.isrc||""} onChange={(e)=>setDraft({...draft,isrc:e.target.value.toUpperCase()})} placeholder="US-ABC-26-12345"/></EditField></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.explicit} onChange={(e)=>setDraft({...draft,explicit:e.target.checked})}/> Explicit content</label>{error&&<div className="text-sm text-red-300">{error}</div>}<div className="flex gap-2 pt-2"><YSButton disabled={busy} onClick={save} className="rounded-lg bg-indigo-600 px-4 py-2">{busy?"Saving…":"Save Changes"}</YSButton><YSButton disabled={busy} onClick={onCancel} className="rounded-lg border border-neutral-700 px-4 py-2">Cancel</YSButton></div></div><style>{`.world-edit-input{width:100%;border:1px solid rgb(64 64 64);background:rgb(23 23 23);border-radius:.75rem;padding:.65rem .75rem;outline:none}.world-edit-input:focus{border-color:rgb(129 140 248);box-shadow:0 0 0 2px rgb(99 102 241 / .15)}`}</style></ModalShell> }
function ReleaseEditModal({release,onCancel,onSave}:{release:WorldRelease;onCancel:()=>void;onSave:(release:WorldRelease)=>Promise<void>}) { const [draft,setDraft]=useState<WorldRelease>(()=>({...release}));const[busy,setBusy]=useState(false);const[error,setError]=useState("");const save=async()=>{setBusy(true);setError("");try{await onSave(draft)}catch(e:any){setError(e?.message||"Could not update release")}finally{setBusy(false)}};return <ModalShell title="Edit Release" onCancel={onCancel}><div className="space-y-3"><EditField label="Artist name"><input className="world-edit-input" value={draft.artistName} onChange={(e)=>setDraft({...draft,artistName:e.target.value})}/></EditField><EditField label={release.releaseType==="album"?"Album name":"Single name"}><input className="world-edit-input" value={draft.title} onChange={(e)=>setDraft({...draft,title:e.target.value})}/></EditField><EditField label="Genre"><input className="world-edit-input" value={draft.genre} onChange={(e)=>setDraft({...draft,genre:e.target.value})}/></EditField>{error&&<div className="text-sm text-red-300">{error}</div>}<div className="flex gap-2 pt-2"><YSButton disabled={busy} onClick={save} className="rounded-lg bg-indigo-600 px-4 py-2">{busy?"Saving…":"Save Changes"}</YSButton><YSButton disabled={busy} onClick={onCancel} className="rounded-lg border border-neutral-700 px-4 py-2">Cancel</YSButton></div></div><style>{`.world-edit-input{width:100%;border:1px solid rgb(64 64 64);background:rgb(23 23 23);border-radius:.75rem;padding:.65rem .75rem;outline:none}.world-edit-input:focus{border-color:rgb(129 140 248);box-shadow:0 0 0 2px rgb(99 102 241 / .15)}`}</style></ModalShell> }
function EditField({label,children}:{label:string;children:React.ReactNode}){return <label className="block"><div className="text-sm font-medium mb-1.5">{label}</div>{children}</label>}
