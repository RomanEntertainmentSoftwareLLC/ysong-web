import { useState } from "react";
import MusicSeoApp from "../tools/musicseo/MusicSeoApp";
import StemRestoreApp from "../tools/stemrestore/StemRestoreApp";
import CritiqueApp from "../tools/critique/CritiqueApp";
import HumanizeApp from "../tools/humanize/HumanizeApp";
import MasteringApp from "../tools/mastering/MasteringApp";
import AudioIntelligenceApp from "../tools/audiointelligence/AudioIntelligenceApp";
import PromotionCenterApp from "../tools/promotion/PromotionCenterApp";
import CuratorMarketplaceApp from "../tools/curators/CuratorMarketplaceApp";
import type { AudioIntelligenceReport } from "../tools/audiointelligence/api";
import type { UploadResult } from "../tools/stemrestore/api";

type ToolId = "seo" | "stem-restore" | "critique" | "humanize" | "mastering" | "audio-intelligence" | "promotion" | "curators";

export default function ToolsPane() {
  const [activeTool, setActiveTool] = useState<ToolId | null>(null);
  const [handoffAsset, setHandoffAsset] = useState<UploadResult | null>(null);
  const [curatorIntelligence, setCuratorIntelligence] = useState<AudioIntelligenceReport | null>(null);

  if (activeTool === "seo") {
    return <MusicSeoApp onBack={() => setActiveTool(null)} />;
  }
  if (activeTool === "stem-restore") {
    return <StemRestoreApp onBack={() => { setActiveTool(null); setHandoffAsset(null); }} initialUpload={handoffAsset} onOpenHumanize={(asset) => { setHandoffAsset(asset); setActiveTool("humanize"); }} />;
  }
  if (activeTool === "critique") {
    return <CritiqueApp onBack={() => setActiveTool(null)} onOpenStemRestore={(asset) => { setHandoffAsset(asset); setActiveTool("stem-restore"); }} onOpenHumanize={(asset) => { setHandoffAsset(asset); setActiveTool("humanize"); }} onOpenMastering={(asset) => { setHandoffAsset(asset); setActiveTool("mastering"); }} onOpenAudioIntelligence={(asset) => { setHandoffAsset(asset); setActiveTool("audio-intelligence"); }} />;
  }
  if (activeTool === "humanize") {
    return <HumanizeApp onBack={() => { setActiveTool(null); setHandoffAsset(null); }} initialUpload={handoffAsset} />;
  }
  if (activeTool === "mastering") {
    return <MasteringApp onBack={() => { setActiveTool(null); setHandoffAsset(null); }} initialUpload={handoffAsset} />;
  }
  if (activeTool === "audio-intelligence") {
    return <AudioIntelligenceApp onBack={() => { setActiveTool(null); setHandoffAsset(null); }} initialUpload={handoffAsset} onOpenCritique={(asset) => { setHandoffAsset(asset); setActiveTool("critique"); }} onOpenMastering={(asset) => { setHandoffAsset(asset); setActiveTool("mastering"); }} onOpenCurators={(report) => { setCuratorIntelligence(report); setActiveTool("curators"); }} />;
  }
  if (activeTool === "promotion") {
    return <PromotionCenterApp onBack={() => setActiveTool(null)} />;
  }
  if (activeTool === "curators") {
    return <CuratorMarketplaceApp onBack={() => { setActiveTool(null); setCuratorIntelligence(null); }} initialIntelligence={curatorIntelligence} />;
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      <div className="mx-auto max-w-6xl px-5 py-7 md:px-8 md:py-9">
        <div className="flex flex-col gap-2">
          <div className="text-[11px] uppercase tracking-[.24em] text-violet-500">YSong Tools</div>
          <h1 className="!text-3xl md:!text-4xl !font-semibold !leading-tight tracking-tight">Utility bench</h1>
          <p className="max-w-2xl text-sm text-neutral-500 dark:text-neutral-400">
            Standalone tools analyze, transform, repair, or research music without silently changing a DAW project.
          </p>
        </div>

        <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <button type="button" onClick={() => { setHandoffAsset(null); setActiveTool("critique"); }} className="group rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-900/55 p-5 text-left hover:border-violet-500/60 hover:bg-violet-500/[.04] transition">
            <div className="flex items-start justify-between gap-4"><div className="h-11 w-11 rounded-xl border border-violet-500/25 bg-violet-500/10 grid place-items-center text-violet-500 text-xl">◉</div><span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[10px] uppercase tracking-wide text-emerald-500">Available</span></div>
            <div className="mt-5 text-base font-semibold">Critique · YSong Ears</div>
            <div className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Technical second opinion for clicks, dropouts, clipping, cutoffs, stereo phase, spectral discontinuities, dynamics, and tempo evidence.</div>
            <div className="mt-5 text-xs text-violet-500 group-hover:text-violet-400">Analyze track →</div>
          </button>


          <button type="button" onClick={() => { setHandoffAsset(null); setActiveTool("audio-intelligence"); }} className="group rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-900/55 p-5 text-left hover:border-violet-500/60 hover:bg-violet-500/[.04] transition">
            <div className="flex items-start justify-between gap-4"><div className="h-11 w-11 rounded-xl border border-violet-500/25 bg-violet-500/10 grid place-items-center text-violet-500 text-xl">◇</div><span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[10px] uppercase tracking-wide text-emerald-500">Phase 22</span></div>
            <div className="mt-5 text-base font-semibold">Audio Intelligence</div>
            <div className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">CLAP genre/subgenre, mood, energy, sonic fingerprint cues, vocal/instrument presence, BPM/key cross-check, metadata helpers, and uncertainty-aware AI-likelihood.</div>
            <div className="mt-5 text-xs text-violet-500 group-hover:text-violet-400">Analyze once →</div>
          </button>

          <button type="button" onClick={() => { setHandoffAsset(null); setActiveTool("stem-restore"); }} className="group rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-900/55 p-5 text-left hover:border-violet-500/60 hover:bg-violet-500/[.04] transition">
            <div className="flex items-start justify-between gap-4"><div className="h-11 w-11 rounded-xl border border-violet-500/25 bg-violet-500/10 grid place-items-center text-violet-500 text-xl">≈</div><span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[10px] uppercase tracking-wide text-emerald-500">Available</span></div>
            <div className="mt-5 text-base font-semibold">Stem Restore</div>
            <div className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Split vocals/instrumental, reconstruct cross-stem spectral holes, run a conservative artifact cleanser, and verify mixture consistency.</div>
            <div className="mt-5 text-xs text-violet-500 group-hover:text-violet-400">Open Audio Lab →</div>
          </button>

          <button type="button" onClick={() => { setHandoffAsset(null); setActiveTool("humanize"); }} className="group rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-900/55 p-5 text-left hover:border-violet-500/60 hover:bg-violet-500/[.04] transition">
            <div className="flex items-start justify-between gap-4"><div className="h-11 w-11 rounded-xl border border-violet-500/25 bg-violet-500/10 grid place-items-center text-violet-500 text-xl">✦</div><span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[10px] uppercase tracking-wide text-emerald-500">Available</span></div>
            <div className="mt-5 text-base font-semibold">Humanize + Cleanse</div>
            <div className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Surgical de-click, micro-gap repair, sparse spectral artifact cleanup, and conservative mix-safe naturalization with A/B and difference monitoring.</div>
            <div className="mt-5 text-xs text-violet-500 group-hover:text-violet-400">Open cleanser →</div>
          </button>


          <button type="button" onClick={() => { setHandoffAsset(null); setActiveTool("mastering"); }} className="group rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-900/55 p-5 text-left hover:border-violet-500/60 hover:bg-violet-500/[.04] transition">
            <div className="flex items-start justify-between gap-4"><div className="h-11 w-11 rounded-xl border border-violet-500/25 bg-violet-500/10 grid place-items-center text-violet-500 text-xl">◫</div><span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[10px] uppercase tracking-wide text-emerald-500">Available</span></div>
            <div className="mt-5 text-base font-semibold">Master / Remaster</div>
            <div className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Quick Remaster, Mastering Assistant, LUFS/true-peak analysis, localized dynamic correction, Reference Match, stereo/transient controls, limiter strategy, and A/B difference monitoring.</div>
            <div className="mt-5 text-xs text-violet-500 group-hover:text-violet-400">Open mastering →</div>
          </button>


          <button type="button" onClick={() => setActiveTool("promotion")} className="group rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-900/55 p-5 text-left hover:border-violet-500/60 hover:bg-violet-500/[.04] transition">
            <div className="flex items-start justify-between gap-4"><div className="h-11 w-11 rounded-xl border border-violet-500/25 bg-violet-500/10 grid place-items-center text-violet-500 text-xl">↗</div><span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[10px] uppercase tracking-wide text-emerald-500">Phase 23</span></div>
            <div className="mt-5 text-base font-semibold">Promotion Center</div>
            <div className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Smart Links, pre-save/release pages, fan capture, QR codes, funnels, SEO Intelligence, and Meta Business publishing.</div>
            <div className="mt-5 text-xs text-violet-500 group-hover:text-violet-400">Build campaign →</div>
          </button>

          <button type="button" onClick={() => { setCuratorIntelligence(null); setActiveTool("curators"); }} className="group rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-900/55 p-5 text-left hover:border-violet-500/60 hover:bg-violet-500/[.04] transition">
            <div className="flex items-start justify-between gap-4"><div className="h-11 w-11 rounded-xl border border-violet-500/25 bg-violet-500/10 grid place-items-center text-violet-500 text-xl">◎</div><span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[10px] uppercase tracking-wide text-emerald-500">Phase 24</span></div>
            <div className="mt-5 text-base font-semibold">Curator Marketplace</div>
            <div className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Find independent playlists, blogs, radio, YouTube, influencers and music media by Audio Intelligence + SEO fit. Credits buy review consideration, never guaranteed placement.</div>
            <div className="mt-5 text-xs text-violet-500 group-hover:text-violet-400">Find curators →</div>
          </button>

          <button type="button" onClick={() => setActiveTool("seo")} className="group rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-900/55 p-5 text-left hover:border-violet-500/60 hover:bg-violet-500/[.04] transition">
            <div className="flex items-start justify-between gap-4"><div className="h-11 w-11 rounded-xl border border-violet-500/25 bg-violet-500/10 grid place-items-center text-violet-500 text-xl">⌕</div><span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[10px] uppercase tracking-wide text-emerald-500">Available</span></div>
            <div className="mt-5 text-base font-semibold">SEO Intelligence</div>
            <div className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">The full Localized MusicSEO engine: Niche Intel, Genre Radar, 6,000+ genre Atlas, Keyword Intel, provider analytics, exports, and outcome learning.</div>
            <div className="mt-5 text-xs text-violet-500 group-hover:text-violet-400">Open tool →</div>
          </button>
        </div>

        <div className="mt-8 rounded-2xl border border-dashed border-neutral-300 dark:border-neutral-800 p-5 text-sm text-neutral-500 dark:text-neutral-500">New tools appear here only when they are implemented. Empty projects stay empty, and standalone utilities do not auto-create DAW content.</div>
      </div>
    </div>
  );
}
