import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTabManager } from "./core";
import { YSButton } from "../components/YSButton";
import EmojiPickerButton from "../components/EmojiPicker";
import worldWordmark from "../../../assets/ysong-world.png";
import { useWorldPlayer } from "../components/WorldPlayer";
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

	const startArtistRadio = (seed: WorldTrack) => {
		const sameArtist = tracks.filter((t) => t.ownerUserId === seed.ownerUserId && t.artistName === seed.artistName);
		const related = tracks.filter((t) => t.genre === seed.genre && t.artistName !== seed.artistName).sort((a,b) => trackScore(b)-trackScore(a));
		const rest = tracks.filter((t) => t.genre !== seed.genre).sort((a,b) => trackScore(b)-trackScore(a));
		startQueue(uniqueTracks([seed, ...sameArtist, ...related, ...rest]), `${seed.artistName} Radio`, seed.id);
	};
	const startGenreRadio = (genreName: string, seed?: WorldTrack) => {
		const inGenre = tracks.filter((t) => t.genre === genreName).sort((a,b) => trackScore(b)-trackScore(a));
		if (!inGenre.length) return;
		const start = seed && inGenre.some((t) => t.id === seed.id) ? seed : inGenre[0];
		startQueue(uniqueTracks([start, ...inGenre]), `${genreName} Radio`, start.id);
	};
	const startSongRadio = (seed: WorldTrack) => {
		const related = tracks.filter((t) => t.id !== seed.id).sort((a,b) => {
			const aRel = (a.genre === seed.genre ? 10000 : 0) + a.tags.filter((x) => seed.tags.includes(x)).length * 2000 + trackScore(a);
			const bRel = (b.genre === seed.genre ? 10000 : 0) + b.tags.filter((x) => seed.tags.includes(x)).length * 2000 + trackScore(b);
			return bRel - aRel;
		});
		startQueue([seed, ...related], `${seed.title} Radio`, seed.id);
	};

	const saveTrackEdit = async (draft: WorldTrack) => {
		const result = await updateWorldTrack(draft.id, { title: draft.title, genre: draft.genre, tags: draft.tags, description: draft.description || "", explicit: draft.explicit, trackNumber: draft.trackNumber, isrc: draft.isrc || "", previouslyReleased: !!draft.previouslyReleased });
		patchTrackEverywhere(result.track.id, result.track); if (release?.id === result.track.releaseId) setRelease(await fetchWorldRelease(release.id)); setEditingTrack(null);
	};
	const saveReleaseEdit = async (draft: WorldRelease) => {
		await updateWorldRelease(draft.id, { artistName: draft.artistName, title: draft.title, genre: draft.genre });
		setRelease(await fetchWorldRelease(draft.id)); setEditingRelease(null); await load();
	};

	const released = useMemo(() => releaseSeeds(tracks).sort((a,b) => +new Date(b.publishedAt) - +new Date(a.publishedAt)), [tracks]);
	const oneWeekAgo = Date.now() - 7 * 86400_000;
	const releasedThisWeek = released.filter((t) => +new Date(t.publishedAt) >= oneWeekAgo).slice(0, 30);
	const albumPicks = useMemo(() => releaseSeeds(tracks).filter((t) => t.releaseType === "album").sort((a,b) => trackScore(b)-trackScore(a)).slice(0, 40), [tracks]);
	const trending = useMemo(() => [...tracks].sort((a,b) => trackScore(b)-trackScore(a)).slice(0, 12), [tracks]);
	const filteredMode = !!search.trim() || genre !== "all" || sort !== "algorithm";

	return <div className="h-full min-h-0 flex flex-col bg-neutral-950 text-neutral-100"><div className="flex-1 min-h-0 overflow-y-auto"><div className="p-4 md:p-6 pb-24">
		{detailTrack ? <TrackDetailView track={detailTrack} onBack={() => setDetailTrack(null)} onPlay={(track) => startQueue(tracks, "YSong World", track.id)} onReact={react} onSave={toggleTrackSave} onSaveRelease={() => toggleReleaseSave(detailTrack.releaseId)} onFollow={() => toggleArtist(detailTrack)} onOpenRelease={() => openRelease(detailTrack.releaseId)} onArtistRadio={() => startArtistRadio(detailTrack)} onSongRadio={() => startSongRadio(detailTrack)} />
		: playlistDetail ? <PlaylistView detail={playlistDetail} onBack={() => setPlaylistDetail(null)} onPlay={(track) => startQueue(playlistDetail.tracks, playlistDetail.playlist.title, track.id)} onOpenTrack={openTrack} onSavePlaylist={async () => { const r=await toggleWorldPlaylistSave(playlistDetail.playlist.id); setPlaylistDetail((p)=>p?{...p,playlist:{...p.playlist,isSaved:r.saved}}:p); setPlaylists((prev)=>prev.map((p)=>p.id===playlistDetail.playlist.id?{...p,isSaved:r.saved}:p)); }} onPlayAll={() => startQueue(playlistDetail.tracks, playlistDetail.playlist.title)} onRemove={async (trackId) => { await removeTrackFromWorldPlaylist(playlistDetail.playlist.id,trackId); setPlaylistDetail(await fetchWorldPlaylist(playlistDetail.playlist.id)); }} onMove={async (trackId,dir) => { if(!playlistDetail.playlist.isOwner)return; const ids=playlistDetail.tracks.map((t)=>t.id); const i=ids.indexOf(trackId), j=i+dir; if(i<0||j<0||j>=ids.length)return; [ids[i],ids[j]]=[ids[j],ids[i]]; await reorderWorldPlaylist(playlistDetail.playlist.id,ids); setPlaylistDetail(await fetchWorldPlaylist(playlistDetail.playlist.id)); }} />
		: release ? <ReleaseView release={release} onBack={() => setRelease(null)} onPlay={(track) => startQueue(release.tracks, release.title, track.id)} onReact={react} onOpenTrack={openTrack} onEditTrack={setEditingTrack} onEditRelease={() => setEditingRelease(release)} onSaveRelease={() => toggleReleaseSave(release.id)} onFollowArtist={() => release.tracks[0] && toggleArtist(release.tracks[0])} onArtistRadio={() => release.tracks[0] && startArtistRadio(release.tracks[0])} onSaveTrack={toggleTrackSave} onSongRadio={startSongRadio} currentId={current?.id} playing={playing} />
		: <>
			<div className="flex flex-col lg:flex-row lg:items-end gap-4 justify-between mb-5"><div className="min-w-0"><div className="text-xs uppercase tracking-[0.22em] text-indigo-300">Independent music lives here</div><img src={worldWordmark} alt="YSong World" className="mt-2 h-[72px] w-[min(78vw,300px)] md:h-[86px] md:w-[360px] max-w-full object-cover object-center" /><p className="text-sm text-neutral-400 mt-2">Discover releases, songs, playlists and artists without turning your phone into a tiny desktop grid.</p></div><YSButton onClick={openUpload} className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 border border-indigo-400/40 font-medium">+ Upload Music</YSButton></div>
			<div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_180px_180px] gap-3 mb-4"><div className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 flex items-center gap-2"><span className="text-neutral-500">⌕</span><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search songs, artists, albums or tags" className="w-full bg-transparent outline-none py-2.5 text-sm" /></div><select value={genre} onChange={(e)=>setGenre(e.target.value)} className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-sm"><option value="all">All genres</option>{genres.map((g)=><option key={g} value={g}>{g}</option>)}</select><select value={sort} onChange={(e)=>setSort(e.target.value)} className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-sm"><option value="algorithm">For You</option><option value="newest">Newest</option><option value="popular">Most Played</option></select></div>
			{genres.length>0 && <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2 mb-2"><button onClick={()=>setGenre("all")} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs ${genre==="all"?"bg-white text-black border-white":"border-neutral-700"}`}>All</button>{genres.slice(0,18).map((g)=><button key={g} onClick={()=>setGenre(g)} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs ${genre===g?"bg-white text-black border-white":"border-neutral-700 hover:bg-neutral-900"}`}>{g}</button>)}</div>}{genre!=="all"&&<div className="mb-5"><button onClick={()=>startGenreRadio(genre)} className="text-xs text-indigo-300 hover:text-indigo-200">📻 Start {genre} Radio</button></div>}
			{error && <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>}
			{loading ? <div className="text-neutral-400">Loading YSong World…</div> : tracks.length===0 ? <div className="rounded-2xl border border-dashed border-neutral-700 bg-neutral-900/50 p-10 text-center"><div className="text-5xl mb-3">🌎</div><h2 className="text-xl font-semibold">YSong World is empty.</h2><p className="text-neutral-400 mt-1 mb-4">Be the first artist to ruin the silence.</p><YSButton onClick={openUpload} className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2">Upload Music</YSButton></div>
			: filteredMode ? <div><SectionTitle title="Results" subtitle={`${tracks.length} songs`} /> <div className="rounded-2xl border border-neutral-800 overflow-hidden">{tracks.map((t)=><TrackRow key={t.id} track={t} current={current?.id===t.id} playing={playing} onPlay={(track)=>startQueue(tracks,"Search Results",track.id)} onOpen={openTrack} onOpenRelease={openRelease} onReact={react} onSave={toggleTrackSave} onRadio={startSongRadio} onEdit={setEditingTrack} />)}</div></div>
			: <div className="space-y-8">
				<ReleaseShelf title="Released This Week" subtitle="Fresh releases from YSong artists" items={(releasedThisWeek.length?releasedThisWeek:released).slice(0,30)} onOpen={openRelease} />
				{albumPicks.length>0 && <ReleaseShelf title="Album Picks" subtitle="Albums worth opening up" items={albumPicks} onOpen={openRelease} />}
				<div><SectionTitle title="Trending Songs" subtitle="One song per row — play, react, save or open the menu" action={<button onClick={()=>startQueue(trending,"Trending Radio")} className="text-xs text-indigo-300">▶ Play as Radio</button>} /><div className="rounded-2xl border border-neutral-800 overflow-hidden">{trending.slice(0,8).map((t)=><TrackRow key={t.id} track={t} current={current?.id===t.id} playing={playing} onPlay={(track)=>startQueue(trending,"Trending",track.id)} onOpen={openTrack} onOpenRelease={openRelease} onReact={react} onSave={toggleTrackSave} onRadio={startSongRadio} onEdit={setEditingTrack} />)}</div></div>
				{playlists.length>0 && <PlaylistShelf title="Playlists" subtitle="Made and saved by the YSong community" items={playlists} onOpen={openPlaylist} />}
				<ReleaseShelf title="Fresh Finds" subtitle="Keep swiping — the shelf can hold the whole catalog" items={released.slice(0,60)} onOpen={openRelease} />
			</div>}
		</>}
	</div></div>{editingTrack && <TrackEditModal track={editingTrack} onCancel={()=>setEditingTrack(null)} onSave={saveTrackEdit} />}{editingRelease && <ReleaseEditModal release={editingRelease} onCancel={()=>setEditingRelease(null)} onSave={saveReleaseEdit} />}</div>;
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

function TrackRow({ track, onPlay, onOpen, onOpenRelease, onReact, onSave, onRadio, onEdit, current, playing }: { track:WorldTrack; onPlay:(t:WorldTrack)=>void; onOpen:(t:WorldTrack)=>void; onOpenRelease?:(id:string)=>void; onReact:(t:WorldTrack,r:-1|1)=>void; onSave:(t:WorldTrack)=>void; onRadio:(t:WorldTrack)=>void; onEdit:(t:WorldTrack)=>void; current:boolean; playing:boolean }) {
	return <div className="grid grid-cols-[44px_minmax(0,1fr)_auto] md:grid-cols-[44px_minmax(0,1fr)_auto_auto] items-center gap-2 md:gap-3 px-2.5 py-2.5 border-b last:border-b-0 border-neutral-800 hover:bg-neutral-900/60"><button onClick={()=>onPlay(track)} className="relative h-11 w-11 rounded-lg overflow-hidden group"><Artwork track={track} className="h-full w-full" /><span className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 grid place-items-center text-white">{current&&playing?"Ⅱ":"▶"}</span></button><button onClick={()=>onOpen(track)} className="min-w-0 text-left"><div className="font-medium text-sm truncate">{track.title}</div><div className="text-xs text-neutral-500 truncate">{track.artistName} • {track.albumName}</div></button><div className="hidden md:flex items-center gap-2 text-xs text-neutral-500"><button onClick={()=>onReact(track,1)} className={track.myReaction===1?"text-indigo-300":"hover:text-white"}>♥ {prettyCount(track.likes)}</button><span>💬 {prettyCount(track.commentCount)}</span><span>▶ {prettyCount(track.playCount)}</span>{durationLabel(track.durationSeconds)&&<span>{durationLabel(track.durationSeconds)}</span>}</div><TrackMenu track={track} onOpenRelease={onOpenRelease} onSave={onSave} onRadio={onRadio} onEdit={onEdit} /></div>;
}

function TrackMenu({ track, onOpenRelease, onSave, onRadio, onEdit }: { track:WorldTrack; onOpenRelease?:(id:string)=>void; onSave:(t:WorldTrack)=>void; onRadio:(t:WorldTrack)=>void; onEdit:(t:WorldTrack)=>void }) {
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

	const menu=open&&typeof document!=="undefined"?createPortal(<><button className="fixed inset-0 z-[77] cursor-default" onClick={()=>{setOpen(false);setShowLists(false)}} aria-label="Close menu"/><div className="fixed z-[78] rounded-xl border border-neutral-700 bg-neutral-950 shadow-2xl p-1 text-sm overflow-y-auto" style={{left:menuPos.left,top:menuPos.top,bottom:menuPos.bottom,width:menuPos.width,maxHeight:menuPos.maxHeight}}>{!showLists?<><MenuButton onClick={()=>{onSave(track);setOpen(false)}}>{track.isSaved?"✓ Saved to Library":"♡ Save Song"}</MenuButton><MenuButton onClick={()=>{onRadio(track);setOpen(false)}}>📻 Start Song Radio</MenuButton>{onOpenRelease&&<MenuButton onClick={()=>{onOpenRelease(track.releaseId);setOpen(false)}}>💿 Open Release</MenuButton>}<MenuButton onClick={loadLists}>＋ Add to Playlist…</MenuButton>{track.isOwner&&<MenuButton onClick={()=>{onEdit(track);setOpen(false)}}>✎ Edit Track</MenuButton>}</>:<><div className="px-2 py-1.5 text-xs text-neutral-500">Add to playlist</div>{lists.length===0?<div className="px-2 py-3 text-xs text-neutral-500">Create a playlist from My Library first.</div>:lists.map((p)=><MenuButton key={p.id} onClick={async()=>{await addTrackToWorldPlaylist(p.id,track.id);setOpen(false);setShowLists(false)}}>{p.title}</MenuButton>)}<MenuButton onClick={()=>setShowLists(false)}>← Back</MenuButton></>}</div></>,document.body):null;
	return <div className="relative"><button ref={buttonRef} onClick={()=>setOpen(v=>!v)} className="h-8 w-8 rounded-lg hover:bg-neutral-800 text-neutral-400 text-xl leading-none" aria-label="Song actions">⋮</button>{menu}</div>;
}
function MenuButton({children,onClick}:{children:React.ReactNode;onClick:()=>void}){return <button onClick={onClick} className="w-full text-left rounded-lg px-2.5 py-2 hover:bg-neutral-800">{children}</button>}

function ReleaseView({ release,onBack,onPlay,onReact,onOpenTrack,onEditTrack,onEditRelease,onSaveRelease,onFollowArtist,onArtistRadio,onSaveTrack,onSongRadio,currentId,playing }:{ release:WorldRelease;onBack:()=>void;onPlay:(t:WorldTrack)=>void;onReact:(t:WorldTrack,r:-1|1)=>void;onOpenTrack:(t:WorldTrack)=>void;onEditTrack:(t:WorldTrack)=>void;onEditRelease:()=>void;onSaveRelease:()=>void;onFollowArtist:()=>void;onArtistRadio:()=>void;onSaveTrack:(t:WorldTrack)=>void;onSongRadio:(t:WorldTrack)=>void;currentId?:string;playing:boolean }) {
	const coverTrack=release.tracks.find(x=>x.hasArtwork)||release.tracks[0];
	return <div><div className="flex items-center justify-between gap-3 mb-5"><button onClick={onBack} className="text-sm text-neutral-400 hover:text-white">← Back to World</button>{release.isOwner&&<YSButton onClick={onEditRelease} className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm">Edit Release</YSButton>}</div><div className="grid grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)] gap-6 items-end mb-6">{coverTrack?<Artwork track={coverTrack} className="w-full max-w-[240px] aspect-square rounded-2xl shadow-2xl"/>:<div className="aspect-square rounded-2xl bg-neutral-900"/>}<div><div className="uppercase tracking-[0.2em] text-xs text-neutral-500">{release.releaseType}</div><h1 className="text-3xl md:text-4xl font-bold mt-1">{release.title}</h1><div className="text-lg text-neutral-300 mt-2">{release.artistName}</div><div className="text-sm text-neutral-500 mt-1">{release.genre}</div><div className="flex flex-wrap gap-2 mt-4"><YSButton onClick={onSaveRelease} className={`rounded-full px-4 py-2 text-sm border ${release.isSaved?"border-indigo-400 bg-indigo-500/15 text-indigo-200":"border-neutral-700"}`}>{release.isSaved?"✓ Saved Album":"＋ Save Album"}</YSButton><YSButton onClick={onFollowArtist} className={`rounded-full px-4 py-2 text-sm border ${release.isArtistFollowed?"border-amber-400 bg-amber-500/10 text-amber-200":"border-neutral-700"}`}>{release.isArtistFollowed?"★ Favorite Artist":"☆ Favorite Artist"}</YSButton><YSButton onClick={onArtistRadio} className="rounded-full px-4 py-2 text-sm border border-neutral-700">📻 Artist Radio</YSButton></div></div></div><div className="rounded-2xl border border-neutral-800 overflow-hidden">{release.tracks.map((track)=><TrackRow key={track.id} track={track} current={currentId===track.id} playing={playing} onPlay={onPlay} onOpen={onOpenTrack} onReact={onReact} onSave={onSaveTrack} onRadio={onSongRadio} onEdit={onEditTrack}/>)}</div></div>;
}

function TrackDetailView({track,onBack,onPlay,onReact,onSave,onSaveRelease,onFollow,onOpenRelease,onArtistRadio,onSongRadio}:{track:WorldTrack;onBack:()=>void;onPlay:(t:WorldTrack)=>void;onReact:(t:WorldTrack,r:-1|1)=>void;onSave:(t:WorldTrack)=>void;onSaveRelease:()=>void;onFollow:()=>void;onOpenRelease:()=>void;onArtistRadio:()=>void;onSongRadio:()=>void}) {
	return <div className="max-w-5xl mx-auto"><button onClick={onBack} className="text-sm text-neutral-400 hover:text-white mb-5">← Back</button><div className="grid grid-cols-1 md:grid-cols-[280px_minmax(0,1fr)] gap-6 items-end"><Artwork track={track} className="w-full max-w-[280px] aspect-square rounded-2xl shadow-2xl"/><div><div className="text-xs uppercase tracking-[.2em] text-indigo-300">Song</div><h1 className="text-3xl md:text-4xl font-bold mt-1">{track.title}</h1><button onClick={onOpenRelease} className="text-lg text-neutral-300 mt-2 hover:text-white">{track.artistName} • {track.albumName}</button><div className="text-sm text-neutral-500 mt-1">{track.genre} {track.explicit?"• Explicit":""}</div><div className="flex flex-wrap gap-2 mt-5"><YSButton onClick={()=>onPlay(track)} className="rounded-full bg-white text-black px-5 py-2">▶ Play</YSButton><YSButton onClick={()=>onReact(track,1)} className={`rounded-full border px-4 py-2 ${track.myReaction===1?"border-indigo-400 bg-indigo-500/15":"border-neutral-700"}`}>♥ {prettyCount(track.likes)}</YSButton><YSButton onClick={()=>onSave(track)} className={`rounded-full border px-4 py-2 ${track.isSaved?"border-indigo-400 bg-indigo-500/15":"border-neutral-700"}`}>{track.isSaved?"✓ Saved":"＋ Save Song"}</YSButton><YSButton onClick={onSaveRelease} className="rounded-full border border-neutral-700 px-4 py-2">{track.isReleaseSaved?"✓ Album Saved":"＋ Save Album"}</YSButton><YSButton onClick={onFollow} className="rounded-full border border-neutral-700 px-4 py-2">{track.isArtistFollowed?"★ Artist":"☆ Artist"}</YSButton><YSButton onClick={onSongRadio} className="rounded-full border border-neutral-700 px-4 py-2">📻 Song Radio</YSButton><YSButton onClick={onArtistRadio} className="rounded-full border border-neutral-700 px-4 py-2">📻 Artist Radio</YSButton></div>{track.description&&<p className="text-sm text-neutral-400 mt-5 max-w-2xl whitespace-pre-wrap">{track.description}</p>}</div></div><div className="mt-8"><CommentThread track={track}/></div></div>;
}

function PlaylistView({detail,onBack,onPlay,onOpenTrack,onSavePlaylist,onPlayAll,onRemove,onMove}:{detail:WorldPlaylistDetail;onBack:()=>void;onPlay:(t:WorldTrack)=>void;onOpenTrack:(t:WorldTrack)=>void;onSavePlaylist:()=>void;onPlayAll:()=>void;onRemove:(id:string)=>void;onMove:(id:string,dir:-1|1)=>void}) {
	const {playlist,tracks}=detail; const cover=playlist.coverTrackId;
	return <div className="max-w-5xl mx-auto"><button onClick={onBack} className="text-sm text-neutral-400 hover:text-white mb-5">← Back to World</button><div className="grid grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)] gap-6 items-end mb-6">{cover?<img src={worldArtworkUrl(cover)} alt="" className="w-full max-w-[240px] aspect-square rounded-2xl object-cover"/>:<div className="w-full max-w-[240px] aspect-square rounded-2xl bg-gradient-to-br from-indigo-500/30 to-neutral-950 grid place-items-center text-6xl">♫</div>}<div><div className="uppercase tracking-[.2em] text-xs text-neutral-500">Playlist</div><h1 className="text-3xl md:text-4xl font-bold mt-1">{playlist.title}</h1><div className="text-neutral-400 mt-2">by {playlist.ownerName} • {tracks.length} songs</div>{playlist.description&&<p className="text-sm text-neutral-500 mt-2">{playlist.description}</p>}<div className="flex gap-2 mt-4"><YSButton disabled={!tracks.length} onClick={onPlayAll} className="rounded-full bg-white text-black px-5 py-2">▶ Play All</YSButton>{!playlist.isOwner&&<YSButton onClick={onSavePlaylist} className="rounded-full border border-neutral-700 px-4 py-2">{playlist.isSaved?"✓ Saved":"＋ Save Playlist"}</YSButton>}</div></div></div><div className="rounded-2xl border border-neutral-800 overflow-hidden">{tracks.length===0?<div className="p-8 text-center text-neutral-500">This playlist is empty.</div>:tracks.map((t,i)=><div key={t.id} className="grid grid-cols-[40px_minmax(0,1fr)_auto] gap-3 items-center p-2.5 border-b last:border-0 border-neutral-800"><button onClick={()=>onPlay(t)} className="h-9 w-9 rounded-full border border-neutral-700">▶</button><button onClick={()=>onOpenTrack(t)} className="text-left min-w-0"><div className="font-medium truncate">{i+1}. {t.title}</div><div className="text-xs text-neutral-500 truncate">{t.artistName}</div></button>{playlist.isOwner&&<div className="flex gap-1"><button disabled={i===0} onClick={()=>onMove(t.id,-1)} className="px-2 py-1 rounded hover:bg-neutral-800 disabled:opacity-25">↑</button><button disabled={i===tracks.length-1} onClick={()=>onMove(t.id,1)} className="px-2 py-1 rounded hover:bg-neutral-800 disabled:opacity-25">↓</button><button onClick={()=>onRemove(t.id)} className="px-2 py-1 rounded hover:bg-red-500/10 text-red-300">✕</button></div>}</div>)}</div></div>;
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
