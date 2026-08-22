export default function DevViewportBadge() {
	let mode = "";
	try { mode = new URLSearchParams(window.location.search).get("devDevice") || ""; } catch {}
	if (!mode) return null;
	return (
		<div className="fixed bottom-2 left-2 z-[9999] rounded-md border border-white/20 bg-black/75 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-white pointer-events-none">
			YSong {mode} · {window.innerWidth}×{window.innerHeight}
		</div>
	);
}
