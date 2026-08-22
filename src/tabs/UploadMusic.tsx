import { useEffect, useState } from "react";
import { useTabManager } from "./core";
import { YSButton } from "../components/YSButton";
import { publishWorldTrack, uploadWorldAsset } from "../lib/worldApi";

export default function UploadMusicPane() {
	const { tabs, openTab, activateTab } = useTabManager();
	const [audio, setAudio] = useState<File | null>(null);
	const [art, setArt] = useState<File | null>(null);
	const [artPreview, setArtPreview] = useState("");
	const [title, setTitle] = useState("");
	const [artistName, setArtistName] = useState("");
	const [releaseType, setReleaseType] = useState<"single" | "album">("single");
	const [albumTitle, setAlbumTitle] = useState("");
	const [genre, setGenre] = useState("");
	const [tags, setTags] = useState("");
	const [description, setDescription] = useState("");
	const [explicit, setExplicit] = useState(false);
	const [previouslyReleased, setPreviouslyReleased] = useState(false);
	const [isrc, setIsrc] = useState("");
	const [rightsConfirmed, setRightsConfirmed] = useState(false);
	const [trackNumber, setTrackNumber] = useState(1);
	const [durationSeconds, setDurationSeconds] = useState<number | null>(null);
	const [busy, setBusy] = useState(false);
	const [status, setStatus] = useState("");
	const [error, setError] = useState("");

	useEffect(() => {
		if (!art) { setArtPreview(""); return; }
		const url = URL.createObjectURL(art);
		setArtPreview(url);
		return () => URL.revokeObjectURL(url);
	}, [art]);

	useEffect(() => {
		if (!audio) { setDurationSeconds(null); return; }
		const url = URL.createObjectURL(audio);
		const el = document.createElement("audio");
		el.preload = "metadata";
		el.src = url;
		el.onloadedmetadata = () => { setDurationSeconds(Number.isFinite(el.duration) ? el.duration : null); URL.revokeObjectURL(url); };
		el.onerror = () => URL.revokeObjectURL(url);
		return () => URL.revokeObjectURL(url);
	}, [audio]);

	const goWorld = () => {
		const existing = tabs.find((t) => t.type === "world");
		if (existing) activateTab(existing.id);
		else openTab({ type: "world", title: "YSong World", pinned: true });
	};

	const publish = async () => {
		setError("");
		if (!audio) return setError("Choose an audio file first.");
		if (!title.trim()) return setError("Song title is required.");
		if (!artistName.trim()) return setError("Artist name is required.");
		if (releaseType === "album" && !albumTitle.trim()) return setError("Album title is required for an album track.");
		if (previouslyReleased && !isrc.trim()) return setError("An ISRC is required for a previously released recording.");
		if (!rightsConfirmed) return setError("Confirm that you own or control the rights needed to publish this recording.");
		setBusy(true);
		try {
			setStatus("Uploading audio…");
			const audioUpload = await uploadWorldAsset(audio);
			let artUpload: Awaited<ReturnType<typeof uploadWorldAsset>> | null = null;
			if (art) {
				setStatus("Uploading artwork…");
				artUpload = await uploadWorldAsset(art);
			}
			setStatus("Publishing to YSong World…");
			await publishWorldTrack({
				title: title.trim(),
				artistName: artistName.trim(),
				releaseType,
				albumTitle: releaseType === "album" ? albumTitle.trim() : title.trim(),
				genre: genre.trim() || "Other",
				tags: tags.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 20),
				description: description.trim(),
				explicit,
				trackNumber: Math.max(1, trackNumber || 1),
				durationSeconds,
				isrc: isrc.trim(),
				previouslyReleased,
				rightsConfirmed,
				audioObjectKey: audioUpload.objectKey,
				artworkObjectKey: artUpload?.objectKey || null,
			});
			setStatus("Published! Opening YSong World…");
			setTimeout(goWorld, 500);
		} catch (e: any) {
			setError(e?.message || "Publish failed");
			setStatus("");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="h-full min-h-0 overflow-y-auto bg-neutral-950 text-neutral-100">
			<div className="max-w-5xl mx-auto p-4 md:p-7 pb-28">
				<div className="mb-6"><div className="text-xs uppercase tracking-[0.2em] text-indigo-300">Creator upload</div><h1 className="text-3xl font-semibold mt-1">Publish Music</h1><p className="text-neutral-400 mt-1">Upload a finished track made in YSong, Suno, another DAW, or anywhere else.</p></div>
				{error && <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-200 text-sm">{error}</div>}
				<div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-6">
					<div className="space-y-5">
						<div>
							<label className="block text-sm font-medium mb-2">Album / Single Artwork</label>
							<label onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f?.type.startsWith("image/")) setArt(f); }} className="aspect-square rounded-2xl border-2 border-dashed border-neutral-700 bg-neutral-800/70 hover:bg-neutral-800 cursor-pointer grid place-items-center overflow-hidden relative transition">
								<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => setArt(e.target.files?.[0] || null)} />
								{artPreview ? <img src={artPreview} alt="Artwork preview" className="absolute inset-0 w-full h-full object-cover" /> : <div className="text-center"><div className="text-5xl text-neutral-400">+</div><div className="text-sm text-neutral-300 mt-2">Drag artwork here or click to upload</div><div className="text-xs text-neutral-500 mt-1">Recommended 3000 × 3000 • JPG/PNG</div></div>}
								{artPreview && <div className="absolute bottom-2 right-2 rounded-lg bg-black/75 px-2 py-1 text-xs">Click to replace</div>}
							</label>
							{art && <div className="flex items-center justify-between mt-2 text-xs text-neutral-400"><span className="truncate">{art.name}</span><button onClick={() => setArt(null)} className="text-red-300">Remove</button></div>}
						</div>
						<div>
							<label className="block text-sm font-medium mb-2">Audio Master</label>
							<label onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f?.type.startsWith("audio/") || /\.(wav|flac|mp3|m4a|aac|ogg)$/i.test(f?.name || "")) setAudio(f); }} className="rounded-2xl border-2 border-dashed border-neutral-700 bg-neutral-900 p-5 cursor-pointer block hover:bg-neutral-800/70">
								<input type="file" accept="audio/*,.wav,.flac,.mp3,.m4a,.aac,.ogg" className="hidden" onChange={(e) => setAudio(e.target.files?.[0] || null)} />
								<div className="font-medium">{audio ? audio.name : "+ Drag audio here or click to upload"}</div>
								<div className="text-xs text-neutral-500 mt-1">WAV, FLAC, MP3, M4A, AAC or OGG • pre-alpha max follows server upload limit</div>
							</label>
						</div>
					</div>

					<div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4 md:p-5 space-y-4">
						<Field label="Song Title"><input value={title} onChange={(e) => setTitle(e.target.value)} className="input" placeholder="Song title" /></Field>
						<Field label="Artist Name"><input value={artistName} onChange={(e) => setArtistName(e.target.value)} className="input" placeholder="Artist name" /></Field>
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
							<Field label="Release Type"><select value={releaseType} onChange={(e) => setReleaseType(e.target.value as any)} className="input"><option value="single">Single</option><option value="album">Album track</option></select></Field>
							{releaseType === "album" ? <Field label="Album Name"><input value={albumTitle} onChange={(e) => setAlbumTitle(e.target.value)} className="input" placeholder="Album title" /></Field> : <Field label="Release"><div className="input text-neutral-500">Single release</div></Field>}
						</div>
						<div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_120px] gap-4"><Field label="Genre"><input value={genre} onChange={(e) => setGenre(e.target.value)} className="input" placeholder="Genre" /></Field><Field label="Track #"><input type="number" min={1} value={trackNumber} onChange={(e) => setTrackNumber(Number(e.target.value))} className="input" /></Field></div>
						<Field label="Tags" hint="Comma separated"><input value={tags} onChange={(e) => setTags(e.target.value)} className="input" placeholder="e.g. indie rock, ambient, electronic" /></Field>
						<Field label="Description"><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className="input resize-y" placeholder="Tell listeners about the track…" /></Field>
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
							<Field label="Release History"><select value={previouslyReleased ? "released" : "unreleased"} onChange={(e) => setPreviouslyReleased(e.target.value === "released")} className="input"><option value="unreleased">Unreleased original</option><option value="released">Previously released</option></select></Field>
							<Field label={`ISRC${previouslyReleased ? " *" : ""}`} hint={previouslyReleased ? "Required" : "Optional"}><input value={isrc} onChange={(e) => setIsrc(e.target.value.toUpperCase())} className="input font-mono" placeholder="US-ABC-26-12345" /></Field>
						</div>
						<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={explicit} onChange={(e) => setExplicit(e.target.checked)} /> Explicit content</label>
						<label className="flex items-start gap-2 text-sm rounded-xl border border-neutral-800 bg-neutral-950/40 p-3"><input className="mt-1" type="checkbox" checked={rightsConfirmed} onChange={(e) => setRightsConfirmed(e.target.checked)} /><span>I own or control the rights necessary to publish this recording on YSong World. <span className="text-neutral-500">Copyright/fingerprint screening will be added to the publishing gate.</span></span></label>
						<div className="pt-2 flex flex-wrap items-center gap-3">
							<YSButton disabled={busy} onClick={publish} className="rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-5 py-2.5 font-medium">{busy ? "Publishing…" : "Publish to YSong World"}</YSButton>
							<YSButton disabled={busy} onClick={goWorld} className="rounded-xl border border-neutral-700 px-4 py-2.5">Cancel</YSButton>
							{status && <span className="text-sm text-neutral-400">{status}</span>}
						</div>
					</div>
				</div>
			</div>
			<style>{`.input{width:100%;border:1px solid rgb(64 64 64);background:rgb(23 23 23);border-radius:.75rem;padding:.65rem .75rem;outline:none}.input:focus{border-color:rgb(129 140 248);box-shadow:0 0 0 2px rgb(99 102 241 / .15)}`}</style>
		</div>
	);
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
	return <label className="block"><div className="flex justify-between gap-2 mb-1.5"><span className="text-sm font-medium">{label}</span>{hint && <span className="text-xs text-neutral-500">{hint}</span>}</div>{children}</label>;
}
