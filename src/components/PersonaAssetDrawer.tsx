import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "../styles/asset-drawer.css";
import { YSButton } from "./YSButton";
import Avatar from "./Avatar";
import {
  DEFAULT_PERSONA_ID,
  createCustomPersona,
  getChatPersona,
  listPersonas,
  personaImage,
  setChatPersona,
  uploadPersonaAvatar,
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

function CustomPersonaModal({ onClose, onCreated }: { onClose: () => void; onCreated: (p: Persona) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [humorStyle, setHumorStyle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [socialEnergy, setSocialEnergy] = useState(60);
  const [critiqueLevel, setCritiqueLevel] = useState(60);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!name.trim() || !instructions.trim()) {
      setError("Give the persona a name and some creator instructions.");
      return;
    }
    setSaving(true); setError("");
    try {
      let avatarObjectKey = "";
      if (avatarFile) avatarObjectKey = (await uploadPersonaAvatar(avatarFile)).objectKey;
      const result = await createCustomPersona({
        name: name.trim(), description: description.trim(), specialty: specialty.trim(), humorStyle: humorStyle.trim(),
        instructions: instructions.trim(), socialEnergy: socialEnergy / 100, critiqueLevel: critiqueLevel / 100,
        avatarObjectKey: avatarObjectKey || undefined,
      });
      onCreated(result.persona);
    } catch (e: any) {
      setError(e?.message || "Could not create persona.");
    } finally { setSaving(false); }
  }

  return createPortal(
    <div className="fixed inset-0 z-[140] bg-black/65 backdrop-blur-sm grid place-items-center p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-2xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 bg-white/95 dark:bg-neutral-950/95 backdrop-blur">
          <div><h2 className="text-lg font-semibold">Create AI Persona</h2><p className="text-xs opacity-60">Same YSong universal rules, your own identity and behavior.</p></div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-black/5 dark:hover:bg-white/10" aria-label="Close">×</button>
        </div>
        <div className="p-5 grid gap-4">
          <div className="grid sm:grid-cols-[120px_1fr] gap-4 items-start">
            <label className="rounded-2xl border border-dashed border-neutral-300 dark:border-neutral-700 min-h-[120px] grid place-items-center text-center p-3 cursor-pointer hover:bg-black/[.03] dark:hover:bg-white/[.04]">
              <input type="file" accept="image/*" className="hidden" onChange={(e) => setAvatarFile(e.target.files?.[0] || null)} />
              {avatarFile ? <><div className="text-3xl">✓</div><div className="text-xs mt-1 break-all">{avatarFile.name}</div></> : <><div className="text-3xl">+</div><div className="text-xs mt-1">Avatar</div><div className="text-[10px] opacity-50">optional</div></>}
            </label>
            <div className="grid gap-3">
              <label className="text-xs font-medium">Name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Example: Synth Wizard" className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2 text-sm" /></label>
              <label className="text-xs font-medium">Short description<input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} placeholder="What kind of character are they?" className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2 text-sm" /></label>
              <label className="text-xs font-medium">Musical specialty<input value={specialty} onChange={(e) => setSpecialty(e.target.value)} maxLength={500} placeholder="Genres, instruments, production strengths..." className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2 text-sm" /></label>
            </div>
          </div>
          <label className="text-xs font-medium">Humor style<input value={humorStyle} onChange={(e) => setHumorStyle(e.target.value)} maxLength={300} placeholder="Dry, chaotic, wholesome, sarcastic..." className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2 text-sm" /></label>
          <label className="text-xs font-medium">Identity & vibe<textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={8000} rows={7} placeholder="Describe how this persona talks, thinks, behaves, what they know, what they like, and what makes them distinct." className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2 text-sm resize-y" /></label>
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="text-xs font-medium">Social energy <span className="opacity-60">{socialEnergy}%</span><input type="range" min="0" max="100" value={socialEnergy} onChange={(e) => setSocialEnergy(Number(e.target.value))} className="mt-2 w-full" /></label>
            <label className="text-xs font-medium">Critique intensity <span className="opacity-60">{critiqueLevel}%</span><input type="range" min="0" max="100" value={critiqueLevel} onChange={(e) => setCritiqueLevel(Number(e.target.value))} className="mt-2 w-full" /></label>
          </div>
          {error && <div className="text-sm text-red-500">{error}</div>}
          <div className="flex justify-end gap-2"><button className="px-4 py-2 rounded-xl border" onClick={onClose}>Cancel</button><button className="px-4 py-2 rounded-xl bg-violet-600 text-white disabled:opacity-50" disabled={saving} onClick={save}>{saving ? "Creating..." : "Create Persona"}</button></div>
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
  const isControlled = typeof controlledOpen === "boolean";
  const open = isControlled ? controlledOpen : openUncontrolled;
  const handleRef = useRef<HTMLButtonElement | null>(null);

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
        try { setSelectedId((await getChatPersona(activeChatId)).personaId || DEFAULT_PERSONA_ID); } catch {}
      }
      if (activeContext === "room") {
        const roomId = localStorage.getItem("ysong:activeRoomId") || "";
        if (roomId) {
          try { setRoomPersonaIds(new Set((await getRoom(roomId)).personas.map((p) => p.id))); } catch {}
        }
      }
    } catch (e: any) { setError(e?.message || "Could not load personas."); }
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
        try { localStorage.setItem(`ysong:chatPersona:${activeChatId}`, persona.id); } catch {}
        window.dispatchEvent(new CustomEvent("ysong:persona-selected", { detail: { chatId: activeChatId, persona } }));
      }
    } catch (e: any) { setError(e?.message || "Could not select persona."); }
  }

  const panel = <div id="persona-asset-drawer-panel" className={`asset-drawer-panel ${open ? "asset-drawer-panel-open" : "asset-drawer-panel-closed"}`}>
    <div className="asset-drawer-header"><div><div className="asset-drawer-title">AI PERSONAS</div><div className="text-[10px] opacity-55 mt-0.5">{hint}</div></div><div className="asset-drawer-actions"><YSButton type="button" onClick={() => setOpen(false)} className="asset-drawer-close-btn">Close</YSButton></div></div>
    <div className="asset-drawer-scroll"><div className="asset-drawer-inner">
      {loading && !personas.length ? <div className="text-xs opacity-60 p-2">Loading personas...</div> : <div className="persona-drawer-grid">
        {personas.map((p) => {
          const selected = activeContext === "chat" && p.id === selectedId;
          const inRoom = activeContext === "room" && roomPersonaIds.has(p.id);
          return <button key={p.id} type="button" onClick={() => void choose(p)} className={`persona-drawer-tile ${selected ? "persona-drawer-tile-selected" : ""} ${inRoom ? "persona-drawer-tile-in-room" : ""}`} title={`${p.name}${p.specialty ? ` · ${p.specialty}` : ""}`}>
            <Avatar src={personaImage(p)} name={p.name} size={58} />
            <span className="persona-drawer-name">{p.name}</span>
            <span className="persona-drawer-sub">{inRoom ? "In room" : selected ? "Selected" : p.isCustom ? "Custom" : p.description}</span>
          </button>;
        })}
        <button type="button" className="persona-drawer-tile persona-drawer-custom" onClick={() => setCustomOpen(true)} title="Create a custom AI persona"><span className="persona-drawer-plus">+</span><span className="persona-drawer-name">Custom</span><span className="persona-drawer-sub">Create persona</span></button>
      </div>}
      {error && <div className="text-xs text-red-500 mt-2 px-1">{error}</div>}
    </div></div>
  </div>;

  return <>{!embedded ? <div className="asset-drawer-shell"><div className="asset-drawer-container">{!hideHandle && <YSButton ref={handleRef} type="button" onClick={() => setOpen((v) => !v)} className="asset-drawer-handle" aria-expanded={open} aria-controls="persona-asset-drawer-panel" title="Personas">/=====\</YSButton>}{panel}</div></div> : panel}
    {customOpen && <CustomPersonaModal onClose={() => setCustomOpen(false)} onCreated={(p) => { setPersonas((prev) => [...prev, p]); setCustomOpen(false); void choose(p); }} />}
  </>;
}
