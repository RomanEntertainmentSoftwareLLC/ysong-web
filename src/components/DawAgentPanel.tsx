import { useEffect, useMemo, useRef, useState } from "react";
import { getLatestDawSessionSnapshot, sendDawSessionCommand, subscribeDawSessionSnapshot, type DawSessionCommand, type DawSessionSnapshot } from "../lib/dawSessionBus";
import { localAiChat } from "../lib/localAiApi";

type AgentMessage = { role: "user" | "assistant"; text: string };
type Proposal = { id: number; label: string; command: DawSessionCommand; projectName: string };
type ParsedAction = { name: string; attrs: Record<string, string> };

function extractActions(raw: string) {
	const actions: ParsedAction[] = [];
	const cleaned = raw.replace(/\[\[ys:daw\.([a-zA-Z0-9_.-]+)([^\]]*)\]\]/g, (_all, name: string, attrs: string) => {
		const values: Record<string, string> = {};
		for (const match of (attrs || "").matchAll(/([a-zA-Z0-9_-]+)\s*=\s*"([^"]*)"/g)) values[match[1]] = match[2];
		actions.push({ name, attrs: values });
		return "";
	});
	return { cleaned: cleaned.replace(/\n{3,}/g, "\n\n").trim(), actions };
}

function resolveTrack(snapshot: DawSessionSnapshot, ref?: string) {
	const wanted = (ref || "selected").trim().toLowerCase();
	return snapshot.tracks.find((track) => track.id.toLowerCase() === wanted)
		?? snapshot.tracks.find((track) => track.name.toLowerCase() === wanted)
		?? (wanted === "selected" ? snapshot.tracks.find((track) => track.id === snapshot.selectedTrackId) : null);
}

function makeProposal(action: ParsedAction, snapshot: DawSessionSnapshot): Omit<Proposal, "id" | "projectName"> | null {
	const { name, attrs } = action;
	const track = resolveTrack(snapshot, attrs.track);
	const value = Number(attrs.value);
	if (name === "tempo" && Number.isFinite(Number(attrs.bpm))) return { label: `Set tempo to ${Math.round(Math.max(20, Math.min(400, Number(attrs.bpm))))} BPM`, command: { type: "set-bpm", value: Math.round(Math.max(20, Math.min(400, Number(attrs.bpm)))) } };
	if (name === "play") return { label: "Start playback", command: { type: "transport-toggle" } };
	if (name === "stop") return { label: "Stop playback", command: { type: "transport-stop" } };
	if (name === "master.level" && Number.isFinite(value)) return { label: `Set master level to ${Math.round(Math.max(0, Math.min(127, value)))}`, command: { type: "set-master-level", value: Math.round(Math.max(0, Math.min(127, value))) } };
	if (!track) return null;
	if (name === "track.level" && Number.isFinite(value)) return { label: `Set ${track.name} level to ${Math.round(Math.max(0, Math.min(127, value)))}`, command: { type: "set-level", trackId: track.id, value: Math.round(Math.max(0, Math.min(127, value))) } };
	if (name === "track.pan" && Number.isFinite(value)) return { label: `Pan ${track.name} to ${Math.max(-1, Math.min(1, value)).toFixed(2)}`, command: { type: "set-mixer", trackId: track.id, patch: { pan: Math.max(-1, Math.min(1, value)) } } };
	if (name === "track.mute" && /^(true|false)$/i.test(attrs.value || "")) return { label: `${attrs.value.toLowerCase() === "true" ? "Mute" : "Unmute"} ${track.name}`, command: { type: "set-mute", trackId: track.id, value: attrs.value.toLowerCase() === "true" } };
	if (name === "track.solo" && /^(true|false)$/i.test(attrs.value || "")) return { label: `${attrs.value.toLowerCase() === "true" ? "Solo" : "Unsolo"} ${track.name}`, command: { type: "set-solo", trackId: track.id, value: attrs.value.toLowerCase() === "true" } };
	if (name === "track.rename" && attrs.name?.trim()) return { label: `Rename ${track.name} to ${attrs.name.trim().slice(0, 80)}`, command: { type: "rename-track", trackId: track.id, name: attrs.name.trim().slice(0, 80) } };
	if (name === "track.select") return { label: `Select ${track.name}`, command: { type: "select-track", trackId: track.id } };
	if (name === "fx.add-c1") return { label: `Add Dynamics C1 to ${track.name}`, command: { type: "add-c1", trackId: track.id } };
	if (name === "fx.open") return { label: `Open effects for ${track.name}`, command: { type: "open-track-fx", trackId: track.id } };
	if (name === "send" && Number.isFinite(Number(attrs.index)) && Number.isFinite(Number(attrs.level))) {
		const index = Math.round(Math.max(1, Math.min(8, Number(attrs.index)))) - 1;
		const level = Math.max(0, Math.min(100, Number(attrs.level)));
		return { label: `Set ${track.name} send ${index + 1} to ${level}%`, command: { type: "set-send", trackId: track.id, index, level } };
	}
	return null;
}

function compactSnapshot(snapshot: DawSessionSnapshot | null) {
	if (!snapshot) return "No DAW session is mounted yet.";
	const selected = snapshot.tracks.find((track) => track.id === snapshot.selectedTrackId);
	return `Project: ${snapshot.projectName}\nTransport: ${snapshot.playing ? "playing" : "stopped"}, bar ${snapshot.playheadBar.toFixed(2)}, ${snapshot.bpm} BPM, ${snapshot.sigNum}/${snapshot.sigDen}\nSelected track: ${selected?.name || "none"}\nTracks: ${snapshot.tracks.map((track) => `${track.name} (${track.type}, level ${track.level}, ${track.mute ? "muted" : "unmuted"}, pan ${track.mixer.pan.toFixed(2)}, effects: ${track.effects.map((effect) => effect.name).join(", ") || "none"})`).join("; ") || "none"}`;
}

export default function DawAgentPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
	const [snapshot, setSnapshot] = useState<DawSessionSnapshot | null>(() => getLatestDawSessionSnapshot());
	const [messages, setMessages] = useState<AgentMessage[]>([{ role: "assistant", text: "I can inspect this session and suggest supported changes. You choose which proposals to apply." }]);
	const [proposals, setProposals] = useState<Proposal[]>([]);
	const [input, setInput] = useState("");
	const [busy, setBusy] = useState(false);
	const [docked, setDocked] = useState(true);
	const [width, setWidth] = useState(() => { try { return Number(localStorage.getItem("ysong:daw-agent:width")) || 390; } catch { return 390; } });
	const endRef = useRef<HTMLDivElement | null>(null);
	const proposalId = useRef(0);
	const selected = useMemo(() => snapshot?.tracks.find((track) => track.id === snapshot.selectedTrackId) ?? null, [snapshot]);
	useEffect(() => subscribeDawSessionSnapshot(setSnapshot), []);
	useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages, proposals, busy]);

	useEffect(() => {
		if (!open) return;
		try { const draft = localStorage.getItem("ysong:daw-agent:brief"); if (draft) { setInput(draft); localStorage.removeItem("ysong:daw-agent:brief"); } } catch { /* storage is optional */ }
	}, [open]);

	function startResize(event: React.PointerEvent<HTMLDivElement>) {
		event.preventDefault();
		const startX = event.clientX;
		const startWidth = width;
		const move = (moveEvent: PointerEvent) => {
			const next = Math.max(300, Math.min(640, startWidth + startX - moveEvent.clientX));
			setWidth(next);
			try { localStorage.setItem("ysong:daw-agent:width", String(next)); } catch { /* storage is optional */ }
		};
		const done = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", done); };
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", done);
	}

	async function send() {
		const text = input.trim();
		if (!text || busy) return;
		const nextHistory = [...messages, { role: "user", text } as AgentMessage];
		setMessages(nextHistory); setInput(""); setBusy(true);
		try {
			const reply = await localAiChat([
				{ role: "system", content: `You are YSong's DAW assistant. Inspect the provided project summary and answer helpfully. For requested supported edits, propose them with the listed tags, but never claim they have been applied. Tags are untrusted suggestions and will be reviewed by the user. Supported tags: [[ys:daw.play]], [[ys:daw.stop]], [[ys:daw.tempo bpm="128"]], [[ys:daw.track.select track="selected-or-track-name"]], [[ys:daw.track.level track="..." value="0-127"]], [[ys:daw.track.pan track="..." value="-1..1"]], [[ys:daw.track.mute track="..." value="true|false"]], [[ys:daw.track.solo track="..." value="true|false"]], [[ys:daw.track.rename track="..." name="New name"]], [[ys:daw.fx.add-c1 track="..."]], [[ys:daw.fx.open track="..."]], [[ys:daw.send track="..." index="1-8" level="0-100"]], [[ys:daw.master.level value="0-127"]]. Do not suggest unsupported changes.\n\nCURRENT PROJECT CONTEXT\n${compactSnapshot(snapshot)}` },
				...nextHistory.slice(-12).map((message) => ({ role: message.role, content: message.text })),
			]);
			const parsed = extractActions(reply);
			const additions = parsed.actions.map((action) => snapshot ? makeProposal(action, snapshot) : null).filter((item): item is Omit<Proposal, "id" | "projectName"> => Boolean(item)).map((item) => ({ ...item, projectName: snapshot!.projectName, id: ++proposalId.current }));
			setProposals((current) => [...current, ...additions]);
			setMessages((current) => [...current, { role: "assistant", text: parsed.cleaned || (additions.length ? "I drafted the changes below for your review." : "I couldn't turn that into a supported proposal.") }]);
		} catch (error) {
			setMessages((current) => [...current, { role: "assistant", text: `I couldn't reach YSong AI. ${error instanceof Error ? error.message : ""}`.trim() }]);
		} finally { setBusy(false); }
	}

	if (!open) return null;
	return <aside aria-label="YSong AI assistant" className={`${docked ? "relative shrink-0" : "absolute right-0 top-0 bottom-0 z-[75]"} border-l border-white/10 bg-neutral-950/95 backdrop-blur-xl shadow-2xl flex flex-col`} style={{ width: `min(${width}px, 92vw)` }}>
		<div role="separator" aria-label="Resize AI assistant" aria-orientation="vertical" onPointerDown={startResize} className="absolute left-0 top-0 bottom-0 z-10 w-1.5 cursor-col-resize hover:bg-indigo-400/60" />
		<div className="h-12 shrink-0 px-4 pl-5 flex items-center gap-3 border-b border-white/10">
			<div className="min-w-0 flex-1"><div className="text-sm font-semibold">YSong AI</div><div className="text-[10px] opacity-55 truncate">{selected ? `Focused on ${selected.name}` : snapshot ? `${snapshot.projectName} · Project` : "Waiting for DAW session"}</div></div>
			<button type="button" onClick={() => setDocked((value) => !value)} className="h-8 rounded-lg px-2 text-[10px] opacity-65 hover:bg-white/10 hover:opacity-100" aria-label={docked ? "Float YSong AI" : "Dock YSong AI"}>{docked ? "Float" : "Dock"}</button>
			<button type="button" onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-white/10" aria-label="Close YSong AI">×</button>
		</div>
		<div className="shrink-0 px-3 py-2 border-b border-white/10 bg-white/[0.025]"><div className="text-[10px] uppercase tracking-wide opacity-45 mb-1">Session context</div><div className="text-[11px] opacity-70">{snapshot ? `${snapshot.tracks.length} tracks · ${snapshot.bpm} BPM · bar ${snapshot.playheadBar.toFixed(1)}` : "No active DAW session"}</div></div>
		<div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
			{messages.map((message, index) => <div key={index} className={`max-w-[92%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${message.role === "user" ? "ml-auto bg-indigo-500/20 border border-indigo-400/20" : "bg-white/[0.055] border border-white/10"}`}>{message.text}</div>)}
			{proposals.map((proposal) => <div key={proposal.id} className="rounded-xl border border-amber-300/25 bg-amber-300/[0.06] p-3"><div className="text-[10px] uppercase tracking-wide text-amber-200/65">Proposed change</div><div className="mt-1 text-sm">{proposal.label}</div><div className="mt-3 flex gap-2"><button type="button" className="rounded-lg border border-emerald-300/25 bg-emerald-400/10 px-3 py-1.5 text-xs text-emerald-100" onClick={() => { const latest = getLatestDawSessionSnapshot(); const trackId = "trackId" in proposal.command ? proposal.command.trackId : null; if (!latest || latest.projectName !== proposal.projectName || (trackId && !latest.tracks.some((track) => track.id === trackId))) { setMessages((items) => [...items, { role: "assistant", text: "That proposal is out of date because the session changed. Ask me to review the current project again." }]); setProposals((items) => items.filter((item) => item.id !== proposal.id)); return; } sendDawSessionCommand(proposal.command); setProposals((items) => items.filter((item) => item.id !== proposal.id)); }}>Apply</button><button type="button" className="rounded-lg border border-white/10 px-3 py-1.5 text-xs opacity-70 hover:bg-white/5" onClick={() => setProposals((items) => items.filter((item) => item.id !== proposal.id))}>Dismiss</button></div></div>)}
			{busy && <div className="text-sm opacity-60 px-2">Thinking…</div>}<div ref={endRef} />
		</div>
		<div className="shrink-0 border-t border-white/10 p-3"><div className="rounded-2xl border border-white/15 bg-black/30 p-2"><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Ask about the song or suggest a change…" className="w-full min-h-[72px] resize-none bg-transparent text-sm outline-none placeholder:text-white/30" /><div className="flex items-center justify-between gap-2"><div className="text-[10px] opacity-40">Enter sends · Shift+Enter adds a line</div><button type="button" disabled={busy || !input.trim()} onClick={() => void send()} className="rounded-xl px-3 py-1.5 text-xs bg-indigo-500/25 border border-indigo-400/30 disabled:opacity-35">Send</button></div></div></div>
	</aside>;
}
