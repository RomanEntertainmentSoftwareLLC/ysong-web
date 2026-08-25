import { useMemo, useState } from "react";
import type { TabRendererProps } from "./core";

type Category = "All" | "Effects" | "Instruments" | "Samples" | "MIDI" | "Presets" | "Artwork" | "Themes";
type MarketItem = { id: string; title: string; creator: string; category: Exclude<Category, "All">; price: string; description: string; tag: string };

const ITEMS: MarketItem[] = [
  { id: "c1-presets", title: "Dynamics C•1 Vocal Presets", creator: "YSong Audio", category: "Presets", price: "Free", description: "Starter vocal, drum-bus and gentle-mastering settings for YSong's native compressor.", tag: "Native" },
  { id: "night-drums", title: "Midnight Drum Toolkit", creator: "Demo Creator", category: "Samples", price: "$9", description: "A storefront-preview pack for kicks, snares, hats and percussion. Commerce/download delivery is not connected yet.", tag: "24-bit" },
  { id: "analog-midi", title: "Analog Motion MIDI Pack", creator: "Demo Creator", category: "MIDI", price: "$6", description: "Arps, bass patterns and chord progressions designed for synth instrument tracks.", tag: "MIDI" },
  { id: "cover-kit", title: "Neon Cover Layout Kit", creator: "Demo Creator", category: "Artwork", price: "$12", description: "Layered artwork-layout concept intended for the new Artwork Studio workflow.", tag: "Layers" },
  { id: "dark-console", title: "YC-9000 Night Theme", creator: "YSong Audio", category: "Themes", price: "Free", description: "A future visual theme slot for YSong's console and studio surfaces.", tag: "Theme" },
  { id: "future-fx", title: "YSong Native FX Collection", creator: "YSong Audio", category: "Effects", price: "Coming soon", description: "Future home for Echo, Reverb, Chorus, Flanger, Phaser, EQ, Limiter and the rest of the native rack.", tag: "Roadmap" },
];

export default function MarketplacePane(_props: TabRendererProps) {
  const [category, setCategory] = useState<Category>("All");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"browse" | "owned">("browse");
  const filtered = useMemo(() => ITEMS.filter((item) => (category === "All" || item.category === category) && `${item.title} ${item.creator} ${item.description}`.toLowerCase().includes(query.trim().toLowerCase())), [category, query]);
  return <div className="h-full overflow-y-auto bg-neutral-950 text-neutral-100">
    <div className="max-w-7xl mx-auto p-5 md:p-7 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-4"><div><div className="text-xs uppercase tracking-[.22em] text-emerald-300">YSong creators</div><h1 className="text-3xl font-semibold mt-1">Marketplace</h1><p className="text-sm text-neutral-400 mt-2">VSTs, YSong devices, samples, MIDI, presets, themes and artwork assets. Music-production goods only. 😭</p></div><div className="flex gap-2"><button onClick={() => setView("browse")} className={`rounded-xl px-3 py-2 text-sm border ${view === "browse" ? "bg-white text-black border-white" : "border-white/10"}`}>Browse</button><button onClick={() => setView("owned")} className={`rounded-xl px-3 py-2 text-sm border ${view === "owned" ? "bg-white text-black border-white" : "border-white/10"}`}>Owned</button></div></div>
      <div className="mt-6 rounded-2xl border border-emerald-400/20 bg-gradient-to-r from-emerald-400/10 via-cyan-400/5 to-indigo-400/10 p-5"><div className="text-sm text-emerald-200">Storefront foundation is open</div><div className="text-2xl font-semibold mt-1">The catalog UI is live; checkout and creator uploads come with the commerce backend.</div><p className="text-sm text-neutral-400 mt-2 max-w-3xl">Nothing here will pretend to charge, install or download before those systems exist. This gives us the real Marketplace surface now instead of a dead button.</p></div>
      {view === "owned" ? <div className="mt-6 rounded-2xl border border-dashed border-white/15 p-12 text-center text-neutral-400"><div className="text-xl text-neutral-200">Owned Library</div><p className="text-sm mt-2">Purchases, free claims and creator downloads will appear here when the marketplace account backend is connected.</p></div> : <>
        <div className="mt-6 grid md:grid-cols-[minmax(0,1fr)_auto] gap-3"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search effects, samples, MIDI, presets…" className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 outline-none focus:border-emerald-300/40" /><div className="flex gap-2 overflow-x-auto">{(["All","Effects","Instruments","Samples","MIDI","Presets","Artwork","Themes"] as Category[]).map((c) => <button key={c} onClick={() => setCategory(c)} className={`shrink-0 rounded-xl px-3 py-2 text-xs border ${category === c ? "border-emerald-300/40 bg-emerald-300/10 text-emerald-100" : "border-white/10 text-neutral-400"}`}>{c}</button>)}</div></div>
        <div className="mt-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">{filtered.map((item) => <article key={item.id} className="rounded-2xl border border-white/10 bg-white/[.025] overflow-hidden"><div className="aspect-[16/9] bg-gradient-to-br from-neutral-800 via-neutral-900 to-black p-4 flex items-end"><span className="rounded-full border border-white/15 bg-black/40 px-2 py-1 text-[10px] uppercase tracking-wider">{item.tag}</span></div><div className="p-4"><div className="text-[10px] uppercase tracking-widest text-emerald-300/70">{item.category}</div><h2 className="font-semibold mt-1">{item.title}</h2><div className="text-xs text-neutral-500 mt-1">by {item.creator}</div><p className="text-sm text-neutral-400 mt-3 min-h-16">{item.description}</p><div className="mt-4 flex items-center justify-between gap-3"><span className="font-semibold">{item.price}</span><button disabled title="Marketplace checkout/download backend is not connected yet" className="rounded-xl border border-white/10 px-3 py-2 text-xs opacity-35 cursor-not-allowed">{item.price === "Free" ? "Get" : "Buy"}</button></div></div></article>)}</div>
        {!filtered.length && <div className="mt-8 rounded-2xl border border-dashed border-white/10 p-10 text-center text-neutral-500">No marketplace items match that search.</div>}
      </>}
    </div>
  </div>;
}
