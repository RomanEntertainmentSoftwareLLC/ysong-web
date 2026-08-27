import { useEffect, useMemo, useRef, useState } from "react";
import { getLatestDawSessionSnapshot, sendDawSessionCommand, subscribeDawSessionSnapshot, type DawSessionSnapshot } from "../lib/dawSessionBus";
import { localAiChat } from "../lib/localAiApi";

type AgentMessage = { role: "user" | "assistant"; text: string };

type ParsedAction = { name: string; attrs: Record<string, string> };

function parseAttrs(raw: string) {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z0-9_-]+)\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) attrs[match[1]] = match[2];
  return attrs;
}

function extractActions(raw: string) {
  const actions: ParsedAction[] = [];
  const cleaned = raw.replace(/\[\[ys:daw\.([a-zA-Z0-9_.-]+)([^\]]*)\]\]/g, (_all, name: string, attrs: string) => {
    actions.push({ name, attrs: parseAttrs(attrs || "") });
    return "";
  });
  return { cleaned: cleaned.replace(/\n{3,}/g, "\n\n").trim(), actions };
}

function num(raw: string | undefined, fallback: number) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function bool(raw: string | undefined, fallback = false) {
  if (raw == null) return fallback;
  return /^(1|true|yes|on)$/i.test(raw);
}

function resolveTrack(snapshot: DawSessionSnapshot | null, ref: string | undefined) {
  if (!snapshot) return null;
  const wanted = (ref || "").trim();
  if (!wanted || wanted.toLowerCase() === "selected") {
    return snapshot.tracks.find((t) => t.id === snapshot.selectedTrackId) ?? null;
  }
  const direct = snapshot.tracks.find((t) => t.id === wanted);
  if (direct) return direct;
  const lower = wanted.toLowerCase();
  return snapshot.tracks.find((t) => t.name.toLowerCase() === lower)
    ?? snapshot.tracks.find((t) => t.name.toLowerCase().includes(lower))
    ?? null;
}

function compactSnapshot(snapshot: DawSessionSnapshot | null) {
  if (!snapshot) return "No DAW session is mounted yet.";
  const lines = snapshot.tracks.map((t, index) => {
    const selected = t.id === snapshot.selectedTrackId ? " SELECTED" : "";
    const fx = t.effects.length ? t.effects.map((e) => `${e.name}${e.enabled ? "" : " (bypassed)"}`).join(", ") : "none";
    return `${index + 1}. id=${t.id} name=${JSON.stringify(t.name)} type=${t.type}${selected} level=${t.level} mute=${t.mute} solo=${t.solo} pan=${t.mixer.pan.toFixed(2)} instrument=${JSON.stringify(t.instrumentLabel || "")} presetHint=${JSON.stringify(t.presetHint || "")} fx=${JSON.stringify(fx)}`;
  });
  return [
    `Project: ${snapshot.projectName}`,
    `Transport: ${snapshot.playing ? "playing" : "stopped"}, bar ${snapshot.playheadBar.toFixed(2)}, ${snapshot.bpm} BPM, ${snapshot.sigNum}/${snapshot.sigDen}`,
    `Master level: ${snapshot.masterLevel}`,
    `Bridge: ${snapshot.bridgeAvailable === false ? "offline" : snapshot.bridgeAvailable === true ? "online" : "unknown"}`,
    "Tracks:",
    ...(lines.length ? lines : ["(none)"]),
  ].join("\n");
}

function buildAgentPrompt(snapshot: DawSessionSnapshot | null) {
  return `DAW AGENT MODE\nYou are the assistant embedded in YSong's DAW. You can inspect the project summary below and may operate the DAW with tool tags. Never show internal track ids in the natural-language reply. If the user asks you to change the project, make a brief natural reply and put tool tags after it. Do not claim an action happened unless you emit the matching tag. Prefer the selected track when the user says "this track" or similar.\n\nSupported tool tags:\n[[ys:daw.play]]\n[[ys:daw.stop]]\n[[ys:daw.tempo bpm="128"]]\n[[ys:daw.track.select track="selected-or-name-or-id"]]\n[[ys:daw.track.level track="..." value="0-127"]]\n[[ys:daw.track.pan track="..." value="-1..1"]]\n[[ys:daw.track.mute track="..." value="true|false"]]\n[[ys:daw.track.solo track="..." value="true|false"]]\n[[ys:daw.track.rename track="..." name="New name"]]\n[[ys:daw.track.create kind="audio|instrument" name="Optional name"]]\n[[ys:daw.fx.add-c1 track="..."]]\n[[ys:daw.fx.open track="..."]]\n[[ys:daw.send track="..." index="1-8" level="0-100"]]\n[[ys:daw.master.level value="0-127"]]\n\nDo not invent unsupported DAW tools. If the user requests something not exposed yet, explain that the agent cannot execute that specific edit yet, but you can still discuss it.\n\nCURRENT DAW STATE\n${compactSnapshot(snapshot)}`;
}

function executeActions(actions: ParsedAction[], snapshot: DawSessionSnapshot | null) {
  let count = 0;
  for (const action of actions) {
    const track = resolveTrack(snapshot, action.attrs.track);
    if (action.name === "play") { if (!snapshot?.playing) sendDawSessionCommand({ type: "transport-toggle" }); count++; }
    else if (action.name === "stop") { sendDawSessionCommand({ type: "transport-stop" }); count++; }
    else if (action.name === "tempo") { sendDawSessionCommand({ type: "set-bpm", value: Math.max(20, Math.min(400, Math.round(num(action.attrs.bpm, snapshot?.bpm ?? 120)))) }); count++; }
    else if (action.name === "track.select" && track) { sendDawSessionCommand({ type: "select-track", trackId: track.id }); count++; }
    else if (action.name === "track.level" && track) { sendDawSessionCommand({ type: "set-level", trackId: track.id, value: Math.max(0, Math.min(127, Math.round(num(action.attrs.value, track.level)))) }); count++; }
    else if (action.name === "track.pan" && track) { sendDawSessionCommand({ type: "set-mixer", trackId: track.id, patch: { pan: Math.max(-1, Math.min(1, num(action.attrs.value, track.mixer.pan))) } }); count++; }
    else if (action.name === "track.mute" && track) { sendDawSessionCommand({ type: "set-mute", trackId: track.id, value: bool(action.attrs.value) }); count++; }
    else if (action.name === "track.solo" && track) { sendDawSessionCommand({ type: "set-solo", trackId: track.id, value: bool(action.attrs.value) }); count++; }
    else if (action.name === "track.rename" && track && action.attrs.name?.trim()) { sendDawSessionCommand({ type: "rename-track", trackId: track.id, name: action.attrs.name.trim().slice(0, 80) }); count++; }
    else if (action.name === "track.create") {
      const kind = action.attrs.kind === "audio" ? "audio" : "instrument";
      sendDawSessionCommand({ type: "create-track", kind, name: action.attrs.name?.trim().slice(0, 80) || undefined }); count++;
    }
    else if (action.name === "fx.add-c1" && track) { sendDawSessionCommand({ type: "add-c1", trackId: track.id }); count++; }
    else if (action.name === "fx.open" && track) { sendDawSessionCommand({ type: "open-track-fx", trackId: track.id }); count++; }
    else if (action.name === "send" && track) {
      const index = Math.max(1, Math.min(8, Math.round(num(action.attrs.index, 1)))) - 1;
      const level = Math.max(0, Math.min(100, num(action.attrs.level, track.mixer.sends[index]?.level ?? 0)));
      sendDawSessionCommand({ type: "set-send", trackId: track.id, index, level }); count++;
    }
    else if (action.name === "master.level") { sendDawSessionCommand({ type: "set-master-level", value: Math.max(0, Math.min(127, Math.round(num(action.attrs.value, snapshot?.masterLevel ?? 100)))) }); count++; }
  }
  return count;
}

export default function DawAgentPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [snapshot, setSnapshot] = useState<DawSessionSnapshot | null>(() => getLatestDawSessionSnapshot());
  const [messages, setMessages] = useState<AgentMessage[]>([{ role: "assistant", text: "I'm in the session. Ask me about the song, or tell me to make a supported DAW change." }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => subscribeDawSessionSnapshot(setSnapshot), []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages, busy]);

  const selected = useMemo(() => snapshot?.tracks.find((t) => t.id === snapshot.selectedTrackId) ?? null, [snapshot]);

  useEffect(() => {
    if (!open) return;
    try {
      const draft = localStorage.getItem("ysong:daw-agent:brief");
      if (draft) {
        setInput(draft);
        localStorage.removeItem("ysong:daw-agent:brief");
      }
    } catch {}
  }, [open]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const nextHistory = [...messages, { role: "user", text } as AgentMessage];
    setMessages(nextHistory);
    setInput("");
    setBusy(true);
    setStatus("");
    try {
      const reply = await localAiChat([
        { role: "system", content: buildAgentPrompt(snapshot) },
        ...nextHistory.slice(-12).map((m) => ({ role: m.role, content: m.text })),
      ]);
      const { cleaned, actions } = extractActions(reply);
      const actionCount = executeActions(actions, snapshot);
      setMessages((prev) => [...prev, { role: "assistant", text: cleaned || (actionCount ? "Done." : "I couldn't complete that request.") }]);
      if (actionCount) setStatus(`${actionCount} DAW action${actionCount === 1 ? "" : "s"} applied`);
    } catch (error) {
      setMessages((prev) => [...prev, { role: "assistant", text: `I couldn't reach YSong AI. ${error instanceof Error ? error.message : ""}`.trim() }]);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  return (
    <aside className="absolute right-0 top-0 bottom-0 z-[75] w-[min(410px,92vw)] border-l border-white/10 bg-neutral-950/95 backdrop-blur-xl shadow-2xl flex flex-col">
      <div className="h-12 shrink-0 px-4 flex items-center gap-3 border-b border-white/10">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">YSong AI</div>
          <div className="text-[10px] opacity-55 truncate">{selected ? `Focused on ${selected.name}` : snapshot ? `${snapshot.projectName} · Project` : "Waiting for DAW session"}</div>
        </div>
        <button type="button" onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-white/10" aria-label="Close YSong AI">×</button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`max-w-[92%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${m.role === "user" ? "ml-auto bg-indigo-500/20 border border-indigo-400/20" : "bg-white/[0.055] border border-white/10"}`}>{m.text}</div>
        ))}
        {busy && <div className="text-sm opacity-60 px-2">Thinking…</div>}
        <div ref={endRef} />
      </div>
      <div className="shrink-0 border-t border-white/10 p-3">
        {status && <div className="mb-2 text-[10px] text-emerald-300/80">{status}</div>}
        <div className="rounded-2xl border border-white/15 bg-black/30 p-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
            placeholder="Ask about the song or control the DAW…"
            className="w-full min-h-[72px] resize-none bg-transparent text-sm outline-none placeholder:text-white/30"
          />
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] opacity-40">Enter sends · Shift+Enter adds a line</div>
            <button type="button" disabled={busy || !input.trim()} onClick={() => void send()} className="rounded-xl px-3 py-1.5 text-xs bg-indigo-500/25 border border-indigo-400/30 disabled:opacity-35">Send</button>
          </div>
        </div>
      </div>
    </aside>
  );
}
