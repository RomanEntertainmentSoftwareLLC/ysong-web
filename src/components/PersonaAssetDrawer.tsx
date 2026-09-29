import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import "../styles/asset-drawer.css";
import { YSButton } from "./YSButton";
import {
  DEFAULT_PERSONA_ID,
  createCustomPersona,
  getChatPersona,
  listPersonas,
  personaImage,
  setChatPersona,
  updateCustomPersona,
  type Persona,
} from "../lib/personaApi";
import { addRoomPersona, getRoom } from "../lib/roomApi";

type Props = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideHandle?: boolean;
  embedded?: boolean;
  activeContext?: "chat" | "room" | "daw" | null;
  activeChatId?: string;
};

const PERSONA_ART_OPTIONS = [
  { label: "No portrait", path: "" },
  { label: "Surfer Dude portrait", path: "/ai-personas/surfer-dude.png" },
  { label: "Goth Girl portrait", path: "/ai-personas/goth-girl.png" },
  { label: "Pop Princess portrait", path: "/ai-personas/pop-princess.png" },
];

function CustomPersonaModal({ persona, onClose, onSaved }: { persona?: Persona; onClose: () => void; onSaved: (p: Persona) => void }) {
  const [name, setName] = useState(persona?.name || "");
  const [description, setDescription] = useState(persona?.description || "");
  const [specialty, setSpecialty] = useState(persona?.specialty || "");
  const [humorStyle, setHumorStyle] = useState(persona?.humorStyle || "");
  const [instructions, setInstructions] = useState(String(persona?.metadata?.instructions || ""));
  const [socialEnergy, setSocialEnergy] = useState(Math.round((persona?.socialEnergy ?? 0.6) * 100));
  const [critiqueLevel, setCritiqueLevel] = useState(Math.round((persona?.critiqueLevel ?? 0.6) * 100));
  const [voiceReference, setVoiceReference] = useState(String(persona?.metadata?.voiceReference || ""));
  const [modelReference, setModelReference] = useState(String(persona?.metadata?.modelReference || ""));
  const [avatarPath, setAvatarPath] = useState(persona?.avatarPath || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!name.trim() || !instructions.trim()) { setError("Give the persona a name and some creator instructions."); return; }
    setSaving(true); setError("");
    try {
      const input = { name: name.trim(), description: description.trim(), specialty: specialty.trim(), humorStyle: humorStyle.trim(), instructions: instructions.trim(), socialEnergy: socialEnergy / 100, critiqueLevel: critiqueLevel / 100, voiceReference: voiceReference.trim(), modelReference: modelReference.trim(), avatarPath };
      const saved = persona ? updateCustomPersona(persona, input) : (await createCustomPersona(input)).persona;
      onSaved(saved);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Could not save persona."); }
    finally { setSaving(false); }
  }

  return createPortal(
    <div className="fixed inset-0 z-[140] bg-black/65 backdrop-blur-sm grid place-items-center p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-2xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 bg-white/95 dark:bg-neutral-950/95 backdrop-blur">
          <div><h2 className="text-lg font-semibold">{persona ? "Edit AI Persona" : "Create AI Persona"}</h2><p className="text-xs opacity-60">Set a name, role, personality, and available references.</p></div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-black/5 dark:hover:bg-white/10" aria-label="Close">Close</button>
        </div>
        <div className="p-5 grid gap-4">
          <label className="text-xs font-medium">Name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Example: Synth Wizard" className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2 text-sm" /></label>
          <label className="text-xs font-medium">Role / short description<input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} placeholder="What role does this persona play?" className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2 text-sm" /></label>
          <label className="text-xs font-medium">Specialty<input value={specialty} onChange={(e) => setSpecialty(e.target.value)} maxLength={500} placeholder="Genres, instruments, production strengths..." className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2 text-sm" /></label>
          <label className="text-xs font-medium">Humor style<input value={humorStyle} onChange={(e) => setHumorStyle(e.target.value)} maxLength={300} placeholder="Dry, chaotic, wholesome, sarcastic..." className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2 text-sm" /></label>
          <label className="text-xs font-medium">Identity & vibe<textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={8000} rows={7} placeholder="Describe how this persona talks, thinks, behaves, what they know, what they like, and what makes them distinct." className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2 text-sm resize-y" /></label>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-xs font-medium">Voice reference (optional)<input value={voiceReference} onChange={(e) => setVoiceReference(e.target.value)} maxLength={200} placeholder="Available voice ID or reference" className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2 text-sm" /></label>
            <label className="text-xs font-medium">Model reference (optional)<input value={modelReference} onChange={(e) => setModelReference(e.target.value)} maxLength={200} placeholder="Available model ID or reference" className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2 text-sm" /></label>
          </div>
          <label className="text-xs font-medium">Portrait<select value={avatarPath} onChange={(e) => setAvatarPath(e.target.value)} className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2 text-sm">{PERSONA_ART_OPTIONS.map((option) => <option key={option.path} value={option.path}>{option.label}</option>)}</select><span className="block mt-1 opacity-60">Choose an existing YSong portrait or leave artwork unset. Custom artwork is not generated here.</span></label>
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="text-xs font-medium">Social energy <span className="opacity-60">{socialEnergy}%</span><input type="range" min="0" max="100" value={socialEnergy} onChange={(e) => setSocialEnergy(Number(e.target.value))} className="mt-2 w-full" /></label>
            <label className="text-xs font-medium">Critique intensity <span className="opacity-60">{critiqueLevel}%</span><input type="range" min="0" max="100" value={critiqueLevel} onChange={(e) => setCritiqueLevel(Number(e.target.value))} className="mt-2 w-full" /></label>
          </div>
          {error && <div className="text-sm text-red-500" role="alert">{error}</div>}
          <div className="flex justify-end gap-2"><button className="px-4 py-2 rounded-xl border" onClick={onClose}>Cancel</button><button className="px-4 py-2 rounded-xl bg-violet-600 text-white disabled:opacity-50" disabled={saving} onClick={save}>{saving ? "Saving..." : persona ? "Save Changes" : "Create Persona"}</button></div>
        </div>
      </div>
    </div>, document.body
  );
}
export default function PersonaAssetDrawer(props: Props) {
  const { open: controlledOpen, onOpenChange, hideHandle = false, embedded = false, activeContext = null, activeChatId } = props;
  const [openUncontrolled, setOpenUncontrolled] = useState(false);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedId, setSelectedId] = useState(DEFAULT_PERSONA_ID);
  const [roomPersonaIds, setRoomPersonaIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [customOpen, setCustomOpen] = useState(false);
  const [editingPersona, setEditingPersona] = useState<Persona | undefined>();
  const isControlled = typeof controlledOpen === "boolean";
  const open = isControlled ? controlledOpen : openUncontrolled;
  const [unavailableArt, setUnavailableArt] = useState<Set<string>>(new Set());

  const setOpen = (next: boolean | ((prev: boolean) => boolean)) => {
    const value = typeof next === "function" ? next(open) : next;
    if (isControlled) onOpenChange?.(value); else setOpenUncontrolled(value);
  };

  async function refresh() {
    setLoading(true); setError("");
    try {
      const items = await listPersonas();
      setPersonas(items);
      if (activeContext === "chat" && activeChatId) {
        try { setSelectedId((await getChatPersona(activeChatId)).personaId || DEFAULT_PERSONA_ID); } catch { /* Keep the default selection when chat state is unavailable. */ }
      }
      if (activeContext === "room") {
        const roomId = localStorage.getItem("ysong:activeRoomId") || "";
        if (roomId) {
          try { setRoomPersonaIds(new Set((await getRoom(roomId)).personas.map((p) => p.id))); } catch { /* The drawer still works when room state is unavailable. */ }
        }
      }
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Could not load personas."); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (open) void refresh(); }, [open, activeContext, activeChatId]);
  useEffect(() => {
    const f = () => { if (open && activeContext === "room") void refresh(); };
    window.addEventListener("ysong:active-room-changed", f);
    window.addEventListener("ysong:room-personas-changed", f);
    return () => { window.removeEventListener("ysong:active-room-changed", f); window.removeEventListener("ysong:room-personas-changed", f); };
  }, [open, activeContext]);

  const hint = useMemo(() => activeContext === "room" ? "Add personas to the active room" : activeContext === "chat" ? "Choose who you are chatting with" : "YSong AI cast", [activeContext]);

  async function choose(persona: Persona) {
    setError("");
    try {
      if (activeContext === "room") {
        const roomId = localStorage.getItem("ysong:activeRoomId") || "";
        if (!roomId) { setError("Open a room first."); return; }
        if (!roomPersonaIds.has(persona.id)) await addRoomPersona(roomId, persona.id, "active");
        setRoomPersonaIds((prev) => new Set(prev).add(persona.id));
        window.dispatchEvent(new CustomEvent("ysong:room-personas-changed", { detail: { roomId, personaId: persona.id } }));
        return;
      }
      if (activeContext === "chat" && activeChatId) {
        await setChatPersona(activeChatId, persona.id);
        setSelectedId(persona.id);
        try { localStorage.setItem(`ysong:chatPersona:${activeChatId}`, persona.id); } catch { /* The server remains the source of truth when storage is blocked. */ }
        window.dispatchEvent(new CustomEvent("ysong:persona-selected", { detail: { chatId: activeChatId, persona } }));
      }
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Could not select persona."); }
  }

  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    const directions = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
    if (!directions.includes(event.key)) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-persona-card]"));
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    const columns = getComputedStyle(event.currentTarget).gridTemplateColumns.split(" ").length;
    const delta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" ? -columns : columns;
    const next = buttons[Math.max(0, Math.min(buttons.length - 1, current + delta))];
    if (next) { event.preventDefault(); next.focus(); }
  }

  const panel = <div id="persona-asset-drawer-panel" className={`asset-drawer-panel ${open ? "asset-drawer-panel-open" : "asset-drawer-panel-closed"}`}>
    <div className="asset-drawer-header"><div><div className="asset-drawer-title">AI PERSONAS</div><div className="text-[10px] opacity-55 mt-0.5">{hint}</div></div><div className="asset-drawer-actions"><YSButton type="button" onClick={() => setOpen(false)} className="asset-drawer-close-btn">Close</YSButton></div></div>
    <div className="asset-drawer-scroll"><div className="asset-drawer-inner">
      {loading && !personas.length ? <div className="text-xs opacity-60 p-2">Loading personas...</div> : <div className="persona-drawer-grid" role="group" aria-label="AI personas" onKeyDown={moveFocus}>
        {personas.map((p) => {
          const selected = activeContext === "chat" && p.id === selectedId;
          const inRoom = activeContext === "room" && roomPersonaIds.has(p.id);
          const image = personaImage(p);
          const missingArt = !image || unavailableArt.has(p.id);
          return <button key={p.id} data-persona-card type="button" onClick={() => void choose(p)} aria-pressed={selected || inRoom} className={`persona-drawer-tile ${selected ? "persona-drawer-tile-selected" : ""} ${inRoom ? "persona-drawer-tile-in-room" : ""}`} title={`${p.name}${p.specialty ? ` · ${p.specialty}` : ""}`}>
            <span className={`persona-drawer-art ${missingArt ? "persona-drawer-art-missing" : ""}`}>
              {missingArt ? <><span aria-hidden="true">✦</span><small>ARTWORK<br />IN PROGRESS</small></> : <img src={image} alt={`${p.name} portrait`} onError={() => setUnavailableArt((prev) => new Set(prev).add(p.id))} />}
            </span>
            <span className="persona-drawer-name">{p.name}</span>
            <span className="persona-drawer-sub">{inRoom ? "In room" : selected ? "Selected" : p.description}</span>
            {p.specialty && <span className="persona-drawer-specialty">{p.specialty}</span>}
            {p.isCustom && <span role="button" tabIndex={0} className="persona-drawer-specialty" onClick={(event) => { event.stopPropagation(); setEditingPersona(p); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.stopPropagation(); setEditingPersona(p); } }}>Edit</span>}
          </button>;
        })}
        <button type="button" data-persona-card className="persona-drawer-tile persona-drawer-custom" onClick={() => setCustomOpen(true)} title="Create a custom AI persona"><span className="persona-drawer-plus">+</span><span className="persona-drawer-name">Create your own</span><span className="persona-drawer-sub">Custom persona</span></button>
      </div>}
      {error && <div className="text-xs text-red-500 mt-2 px-1">{error}</div>}
    </div></div>
  </div>;

  return <>{!embedded ? <div className="asset-drawer-shell"><div className="asset-drawer-container">{!hideHandle && <YSButton type="button" onClick={() => setOpen((v) => !v)} className="asset-drawer-handle" aria-expanded={open} aria-controls="persona-asset-drawer-panel" title="Personas">/=====\</YSButton>}{panel}</div></div> : panel}
    {customOpen && <CustomPersonaModal onClose={() => setCustomOpen(false)} onSaved={(p) => { setPersonas((prev) => [...prev, p]); setCustomOpen(false); void choose(p); }} />}
    {editingPersona && <CustomPersonaModal persona={editingPersona} onClose={() => setEditingPersona(undefined)} onSaved={(p) => { setPersonas((prev) => prev.map((item) => item.id === p.id ? p : item)); setEditingPersona(undefined); }} />}
  </>;
}
