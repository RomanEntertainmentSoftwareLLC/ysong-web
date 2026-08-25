import { useEffect, useMemo, useState } from "react";
import type { TabRendererProps } from "./core";
import { useTabManager } from "./core";
import {
  deleteBandProfile,
  duplicateBandProfile,
  getActiveBandId,
  getBandProfile,
  listBandProfiles,
  saveBandProfile,
  setActiveBandId,
  type BandProfile,
} from "../lib/bandLibrary";

type BandDraft = Omit<BandProfile, "createdAt" | "updatedAt">;
const blank = (): BandDraft => ({
  id: crypto.randomUUID(),
  name: "",
  genre: "",
  bio: "",
  members: "",
  symbol: "",
  primary: "#171717",
  accent: "#a78bfa",
  image: null,
  imageName: "",
});

export default function BandCreationPane(_props: TabRendererProps) {
  const { tabs, openTab, activateTab } = useTabManager();
  const [band, setBand] = useState<BandDraft>(() => blank());
  const [bands, setBands] = useState<BandProfile[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");

  const refreshBands = async () => {
    try { setBands(await listBandProfiles()); } catch {}
  };

  const loadBand = async (id: string | null) => {
    if (!id) return;
    const found = await getBandProfile(id).catch(() => null);
    if (!found) return;
    setBand({
      id: found.id,
      name: found.name,
      genre: found.genre,
      bio: found.bio,
      members: found.members,
      symbol: found.symbol,
      primary: found.primary,
      accent: found.accent,
      image: found.image ?? null,
      imageName: found.imageName ?? "",
    });
    setActiveBandId(found.id);
    setSaved(true);
  };

  useEffect(() => {
    void refreshBands().then(() => {
      const active = getActiveBandId();
      if (active) void loadBand(active);
      else {
        // One-time migration from the original single localStorage band profile.
        try {
          const legacy = JSON.parse(localStorage.getItem("ysong:band-profile:v1") || "{}");
          if (legacy?.name || legacy?.genre || legacy?.bio || legacy?.members || legacy?.symbol) {
            const migrated: BandDraft = { ...blank(), ...legacy, id: crypto.randomUUID(), image: null, imageName: "" };
            setBand(migrated);
          }
        } catch {}
      }
    });
  }, []);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const id = String((event as CustomEvent<any>).detail?.id || getActiveBandId() || "");
      if (id) void loadBand(id);
    };
    const onChanged = () => void refreshBands();
    const onNew = () => { setBand(blank()); setSaved(false); setError(""); setActiveBandId(null); };
    window.addEventListener("ysong:band-open", onOpen as EventListener);
    window.addEventListener("ysong:band-new", onNew);
    window.addEventListener("ysong:bands-changed", onChanged);
    return () => {
      window.removeEventListener("ysong:band-open", onOpen as EventListener);
      window.removeEventListener("ysong:band-new", onNew);
      window.removeEventListener("ysong:bands-changed", onChanged);
    };
  }, []);

  useEffect(() => { setSaved(false); }, [band.name, band.genre, band.bio, band.members, band.symbol, band.primary, band.accent, band.image, band.imageName]);

  useEffect(() => {
    if (!band.image) { setPreviewUrl(""); return; }
    const url = URL.createObjectURL(band.image);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [band.image]);

  const patch = (p: Partial<BandDraft>) => setBand((b) => ({ ...b, ...p }));
  const initials = useMemo(() => band.name.trim().split(/\s+/).filter(Boolean).slice(0, 3).map((x) => x[0]?.toUpperCase()).join("") || "YS", [band.name]);

  const acceptImage = (file: File | null | undefined) => {
    setError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("That file is not an image."); return; }
    patch({ image: file, imageName: file.name });
  };

  const save = async () => {
    setBusy(true); setError("");
    try {
      const next = await saveBandProfile({
        ...band,
        name: band.name.trim() || "Untitled Band",
      });
      setBand({ ...next, image: next.image ?? null, imageName: next.imageName ?? "" });
      setSaved(true);
      await refreshBands();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save this band."); }
    finally { setBusy(false); }
  };

  const makeNew = () => { setBand(blank()); setActiveBandId(null); setSaved(false); setError(""); };

  const remove = async () => {
    if (!bands.some((b) => b.id === band.id)) { makeNew(); return; }
    if (!window.confirm(`Delete “${band.name || "Untitled Band"}” from your YSong Band Library?`)) return;
    await deleteBandProfile(band.id);
    makeNew();
    await refreshBands();
  };

  const duplicate = async () => {
    if (!bands.some((b) => b.id === band.id)) return;
    const next = await duplicateBandProfile(band.id);
    if (next) { await refreshBands(); await loadBand(next.id); }
  };

  const openArtwork = () => {
    setActiveBandId(band.id);
    const existing = tabs.find((t) => t.type === "artwork");
    const tabId = existing?.id ?? openTab({ type: "artwork", title: "Artwork Studio", pinned: true });
    activateTab(tabId);
    window.setTimeout(() => window.dispatchEvent(new CustomEvent("ysong:artwork-use-band", { detail: { id: band.id } })), 60);
  };

  return <div className="h-full overflow-y-auto bg-neutral-950 text-white">
    <div className="max-w-[1420px] mx-auto p-5 lg:p-8 grid xl:grid-cols-[minmax(0,1fr)_390px] gap-6">
      <section className="space-y-4 min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><div className="text-xs uppercase tracking-[.22em] text-fuchsia-300">Identity workshop</div><h1 className="text-3xl font-semibold mt-1">Band Creation</h1><p className="text-sm text-neutral-400 mt-2">Build real reusable artist identities. Saved bands live in <b>My Library → Bands</b>.</p></div>
          <button type="button" onClick={makeNew} className="rounded-xl px-3 py-2 border border-white/10 hover:bg-white/5">+ New Band</button>
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_260px] gap-5">
          <div className="space-y-4 min-w-0">
            <Field label="Band / artist name"><input className="input" value={band.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Band name" /></Field>
            <Field label="Sound / genre"><input className="input" value={band.genre} onChange={(e) => patch({ genre: e.target.value })} placeholder="Dark synthpop, orchestral metal, house…" /></Field>
            <Field label="Band image / logo / symbol">
              <label
                onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDragActive(true); }}
                onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
                onDrop={(e) => { e.preventDefault(); setDragActive(false); acceptImage(e.dataTransfer.files?.[0]); }}
                className={`block rounded-2xl border-2 border-dashed p-4 cursor-pointer transition ${dragActive ? "border-fuchsia-300 bg-fuchsia-400/10" : "border-white/15 bg-white/[.025] hover:border-white/30"}`}
              >
                <input type="file" accept="image/*" className="hidden" onChange={(e) => { acceptImage(e.target.files?.[0]); e.currentTarget.value = ""; }} />
                <div className="flex items-center gap-3"><div className="h-20 w-20 rounded-xl overflow-hidden border border-white/10 bg-black/30 grid place-items-center shrink-0">{previewUrl ? <img src={previewUrl} className="h-full w-full object-cover" alt="Band identity" /> : <span className="text-2xl opacity-40">+</span>}</div><div className="min-w-0"><div className="text-sm font-medium">{band.image ? "Image loaded" : "Drag an image here or click to browse"}</div><div className="text-xs text-neutral-500 truncate mt-1">{band.imageName || "Logo, symbol, band photo, character art…"}</div></div></div>
              </label>
              {band.image && <div className="mt-2 text-right"><button type="button" onClick={() => patch({ image: null, imageName: "" })} className="text-xs text-red-300">Remove image</button></div>}
            </Field>
            <Field label="Members"><textarea className="input min-h-[130px]" value={band.members} onChange={(e) => patch({ members: e.target.value })} placeholder={'One per line, e.g.\nIsa — lead vocals\nFrey — alto vocals'} /></Field>
            <Field label="Band story / bio"><textarea className="input min-h-[150px]" value={band.bio} onChange={(e) => patch({ bio: e.target.value })} placeholder="Identity, lore, attitude, visual language…" /></Field>
            <Field label="Logo / symbol direction"><textarea className="input min-h-[100px]" value={band.symbol} onChange={(e) => patch({ symbol: e.target.value })} placeholder="Describe the mark, icon, crest, symbol, typography…" /></Field>
            <div className="flex gap-4"><Field label="Primary"><input type="color" value={band.primary} onChange={(e) => patch({ primary: e.target.value })} className="h-11 w-20 rounded-lg bg-transparent" /></Field><Field label="Accent"><input type="color" value={band.accent} onChange={(e) => patch({ accent: e.target.value })} className="h-11 w-20 rounded-lg bg-transparent" /></Field></div>
            {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>}
            <div className="flex flex-wrap gap-2"><button onClick={() => void save()} disabled={busy} className="rounded-xl px-4 py-2 bg-fuchsia-500/20 border border-fuchsia-400/30 disabled:opacity-40">{busy ? "Saving…" : saved ? "Saved to My Library" : "Save Band"}</button><button onClick={openArtwork} className="rounded-xl px-4 py-2 border border-white/10">Open in Artwork Studio</button><button onClick={() => void duplicate()} disabled={!bands.some((b) => b.id === band.id)} className="rounded-xl px-3 py-2 border border-white/10 disabled:opacity-30">Duplicate</button><button onClick={() => void remove()} className="rounded-xl px-3 py-2 border border-red-400/20 text-red-300">Delete</button></div>
          </div>

          <aside className="rounded-2xl border border-white/10 bg-white/[.025] p-3 self-start">
            <div className="text-xs uppercase tracking-widest text-neutral-500 mb-2">Saved bands</div>
            <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
              {bands.length ? bands.map((b) => <BandMini key={b.id} band={b} active={b.id === band.id} onClick={() => void loadBand(b.id)} />) : <div className="text-xs text-neutral-500 p-3 border border-dashed border-white/10 rounded-xl">No saved bands yet.</div>}
            </div>
          </aside>
        </div>
      </section>

      <aside className="rounded-2xl border border-white/10 overflow-hidden self-start xl:sticky xl:top-5">
        <div className="aspect-square grid place-items-center relative overflow-hidden" style={{ background: `radial-gradient(circle at 35% 30%, ${band.accent}55, transparent 34%), ${band.primary}` }}>
          {previewUrl ? <img src={previewUrl} alt="Band preview" className="absolute inset-0 h-full w-full object-cover" /> : <div className="w-44 h-44 rounded-full border-[10px] grid place-items-center text-5xl font-black tracking-tight" style={{ borderColor: band.accent, color: band.accent }}>{initials}</div>}
        </div>
        <div className="p-4 bg-white/[.035]"><div className="text-xl font-semibold">{band.name || "Untitled Band"}</div><div className="text-sm text-neutral-400">{band.genre || "Define the sound"}</div><p className="text-xs text-neutral-500 mt-3">This identity is reusable by Create Song, Artwork Studio, and later YSong releases. The uploaded image is stored locally with the band rather than disappearing into a mystery browser key.</p></div>
      </aside>
    </div>
    <style>{`.input{width:100%;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.28);border-radius:.75rem;padding:.65rem .75rem;outline:none}.input:focus{border-color:rgba(232,121,249,.5)}`}</style>
  </div>;
}

function BandMini({ band, active, onClick }: { band: BandProfile; active: boolean; onClick: () => void }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!band.image) { setUrl(""); return; }
    const next = URL.createObjectURL(band.image);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [band.image]);
  return <button type="button" onClick={onClick} className={`w-full rounded-xl border p-2 flex items-center gap-2 text-left ${active ? "border-fuchsia-400/50 bg-fuchsia-400/10" : "border-white/10 hover:bg-white/5"}`}><div className="h-10 w-10 rounded-lg overflow-hidden grid place-items-center bg-black/30 shrink-0">{url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <span className="text-xs font-bold" style={{ color: band.accent }}>{band.name.slice(0, 2).toUpperCase() || "YS"}</span>}</div><div className="min-w-0"><div className="text-sm truncate">{band.name || "Untitled Band"}</div><div className="text-[11px] text-neutral-500 truncate">{band.genre || "No genre yet"}</div></div></button>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="block text-[11px] uppercase tracking-wider text-neutral-500 mb-1.5">{label}</span>{children}</label>; }
