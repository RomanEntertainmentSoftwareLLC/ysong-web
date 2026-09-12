import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Reveal from "./Reveal";
import { YSButton } from "./YSButton";

const productPillars = [
  { eyebrow: "CREATE", title: "A real DAW with an AI co-pilot", body: "Record, edit, arrange, mix, automate and export without leaving YSong. Composer suggestions stay editable and never populate an empty project until you approve them.", tags: ["Audio + MIDI", "VST3 via Bridge", "Undo-safe AI"] },
  { eyebrow: "REFINE", title: "Audio Lab from repair to master", body: "Stem Restore, Critique, Humanize + Cleanse, Audio Intelligence and Master / Remaster share the same source assets instead of duplicating your work.", tags: ["Stem repair", "YSong Ears", "Mastering"] },
  { eyebrow: "BROADCAST", title: "Music-reactive visuals and radio", body: "Build realtime visual scenes, route them to OBS, program YSong Radio stations and keep the global player running while you work anywhere in the app.", tags: ["60 FPS output", "OBS", "YSong Radio"] },
  { eyebrow: "GROW", title: "Promotion built into the release workflow", body: "Smart Links, ad creatives, Meta campaigns, attribution analytics, SEO intelligence and curator matching all reuse the metadata YSong already knows about your music.", tags: ["Smart Links", "Meta Ads", "Curators"] },
];

const workflow = [
  ["01", "Make the song", "DAW, Composer, instruments, MIDI and native audio routing."],
  ["02", "Finish the record", "Critique, cleanup, stem repair and mastering in Audio Lab."],
  ["03", "Build the world", "Artwork, Visual Broadcast, YSong World and Radio."],
  ["04", "Find the audience", "Smart Links, paid campaigns, analytics and curator submissions."],
];

export default function Home() {
  const navigate = useNavigate();
  const [videoFailed, setVideoFailed] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const signedIn = useMemo(() => {
    try { return !!(localStorage.getItem("ys_token") || localStorage.getItem("ysong_auth_token")); } catch { return false; }
  }, []);

  return <div className="overflow-hidden">
    <section className="relative mx-auto max-w-7xl px-4 pb-12 pt-8 sm:px-6 md:pt-14 lg:px-8 lg:pb-20">
      <div className="pointer-events-none absolute -left-40 top-10 h-96 w-96 rounded-full bg-violet-600/15 blur-3xl" />
      <div className="pointer-events-none absolute -right-48 top-0 h-[28rem] w-[28rem] rounded-full bg-cyan-500/10 blur-3xl" />

      <div className="relative grid items-center gap-10 lg:grid-cols-[.88fr_1.12fr] lg:gap-14">
        <Reveal>
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/25 bg-violet-500/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[.18em] text-violet-600 dark:text-violet-300">
            One studio · idea to audience
          </div>
          <h1 className="mt-5 max-w-3xl text-4xl font-black leading-[.98] tracking-[-.045em] sm:text-6xl lg:text-7xl">
            Make the music.<br/><span className="bg-gradient-to-r from-violet-500 via-fuchsia-400 to-cyan-400 bg-clip-text text-transparent">Build everything around it.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-neutral-600 dark:text-neutral-300 sm:text-lg">
            YSong brings production, audio intelligence, visuals, radio, promotion and release tools into one workspace without turning AI into an autopilot you never asked for.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <YSButton onClick={() => navigate(signedIn ? "/app" : "/signup")} className="rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-600/20 hover:bg-violet-500">
              {signedIn ? "Open YSong" : "Create your studio"}
            </YSButton>
            <YSButton onClick={() => navigate("/login")} className="rounded-xl border border-neutral-300 px-5 py-3 text-sm font-semibold dark:border-neutral-700">
              {signedIn ? "Switch account" : "Log in"}
            </YSButton>
          </div>
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-xs text-neutral-500">
            <span>✓ Empty projects stay empty</span><span>✓ Non-destructive AI workflows</span><span>✓ Local VST/audio bridge</span>
          </div>
        </Reveal>

        <Reveal className="relative">
          <div className="absolute -inset-3 rounded-[2rem] bg-gradient-to-br from-violet-500/20 via-transparent to-cyan-500/15 blur-2xl" />
          <div className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-neutral-950 shadow-2xl">
            <img src="/homestudio.png" alt="Producer working in a home studio" className="aspect-[16/10] w-full object-cover" loading="eager" />
            {!videoFailed && <video className="absolute inset-0 h-full w-full object-cover" autoPlay muted loop playsInline poster="/homestudio.png" onCanPlay={() => setVideoReady(true)} onError={() => { setVideoReady(false); setVideoFailed(true); }}>
              <source src="/marketing/ysong-hero.mp4" type="video/mp4" />
            </video>}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/10" />
            <div className="absolute bottom-0 left-0 right-0 flex items-end justify-between gap-4 p-5">
              <div><div className="text-[10px] font-bold uppercase tracking-[.2em] text-violet-200">YSong Studio</div><div className="mt-1 text-lg font-semibold text-white">Production, intelligence and release tools in one session.</div></div>
              {videoReady && <span className="hidden rounded-full border border-white/20 bg-black/40 px-3 py-1 text-[10px] text-white backdrop-blur sm:inline">Motion preview</span>}
            </div>
          </div>
        </Reveal>
      </div>
    </section>

    <section className="border-y border-neutral-200/70 bg-neutral-950/[.025] dark:border-white/8 dark:bg-white/[.015]">
      <div className="mx-auto grid max-w-7xl gap-px px-4 py-2 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-8">
        {workflow.map(([n,title,body]) => <Reveal key={n} className="p-5 lg:p-6"><div className="text-xs font-semibold text-violet-500">{n}</div><div className="mt-1 font-semibold">{title}</div><p className="mt-2 text-xs leading-relaxed text-neutral-500">{body}</p></Reveal>)}
      </div>
    </section>

    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
      <Reveal className="max-w-3xl"><div className="text-xs font-semibold uppercase tracking-[.22em] text-violet-500">The workspace</div><h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-5xl">Not another pile of disconnected music tools.</h2><p className="mt-4 text-neutral-500">The same song metadata, assets and analysis move between production, release and promotion. Analyze once. Reuse it everywhere.</p></Reveal>
      <div className="mt-10 grid gap-5 md:grid-cols-2">
        {productPillars.map((item) => <Reveal key={item.eyebrow} className="group rounded-3xl border border-neutral-200 bg-white/70 p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-xl dark:border-white/10 dark:bg-white/[.025]"><div className="text-[10px] font-bold tracking-[.24em] text-violet-500">{item.eyebrow}</div><h3 className="mt-2 text-xl font-semibold">{item.title}</h3><p className="mt-3 text-sm leading-relaxed text-neutral-500">{item.body}</p><div className="mt-5 flex flex-wrap gap-2">{item.tags.map(tag => <span key={tag} className="rounded-full border border-neutral-200 px-2.5 py-1 text-[10px] text-neutral-500 dark:border-white/10">{tag}</span>)}</div></Reveal>)}
      </div>
    </section>

    <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8 lg:pb-24">
      <div className="grid gap-6 lg:grid-cols-2">
        <Reveal className="overflow-hidden rounded-3xl border border-white/10 bg-neutral-950 shadow-2xl"><img src="/marketing/ysong-world.png" alt="YSong World and Radio interface" className="aspect-[16/9] w-full object-cover object-top" loading="lazy"/><div className="p-6 text-white"><div className="text-[10px] font-bold uppercase tracking-[.2em] text-violet-300">DISCOVER + LISTEN</div><h3 className="mt-2 text-2xl font-semibold">YSong World and searchable Radio</h3><p className="mt-2 text-sm text-neutral-400">Release into your own ecosystem, build catalog-driven stations and keep listening while you move between studio tools.</p></div></Reveal>
        <Reveal className="overflow-hidden rounded-3xl border border-white/10 bg-neutral-950 shadow-2xl"><img src="/marketing/audio-lab.png" alt="YSong Audio Lab interface" className="aspect-[16/9] w-full object-cover object-top" loading="lazy"/><div className="p-6 text-white"><div className="text-[10px] font-bold uppercase tracking-[.2em] text-cyan-300">ANALYZE + FINISH</div><h3 className="mt-2 text-2xl font-semibold">Audio Lab without launching another app</h3><p className="mt-2 text-sm text-neutral-400">Critique, stem work, intelligence, cleanup and mastering run through YSong's integrated local Audio Engine.</p></div></Reveal>
      </div>
    </section>

    <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
      <Reveal className="relative overflow-hidden rounded-[2rem] border border-violet-500/20 bg-gradient-to-br from-violet-600/15 via-fuchsia-500/[.05] to-cyan-400/10 p-8 text-center sm:p-12">
        <div className="text-xs font-semibold uppercase tracking-[.22em] text-violet-500">Your music stays yours</div>
        <h2 className="mx-auto mt-3 max-w-3xl text-3xl font-bold tracking-tight sm:text-5xl">Create the track, finish it, broadcast it and find the audience from the same place.</h2>
        <p className="mx-auto mt-4 max-w-2xl text-sm text-neutral-500">YSong is being built around explicit control: tools propose, artists decide.</p>
        <YSButton onClick={() => navigate(signedIn ? "/app" : "/signup")} className="mt-7 rounded-xl bg-violet-600 px-6 py-3 text-sm font-semibold text-white">{signedIn ? "Return to YSong" : "Get started"}</YSButton>
      </Reveal>
    </section>
  </div>;
}
