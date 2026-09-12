import BridgeSettings from "../components/BridgeSettings";

export default function BridgePane() {
  return <div className="h-full min-h-0 overflow-y-auto bg-neutral-950 text-neutral-100">
    <div className="mx-auto max-w-6xl p-5 md:p-7 pb-28">
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[.24em] text-cyan-300">Native audio services</div>
          <h1 className="mt-1 text-3xl font-semibold">YSong Bridge</h1>
          <p className="mt-2 max-w-2xl text-sm text-neutral-400">Bridge connects YSong to Windows audio drivers, installed VST3 instruments/effects, MIDI routing, snapshots, auditions and native plugin editors.</p>
        </div>
        <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1.5 text-xs text-amber-200">Installer wizard coming next</span>
      </div>

      <BridgeSettings />

      <section className="mt-5 rounded-2xl border border-white/10 bg-white/[.025] p-5">
        <h2 className="text-lg font-semibold">Desktop installation</h2>
        <p className="mt-2 text-sm text-neutral-400">Today the development launcher builds/starts Bridge automatically when the .NET SDK is installed. The production installer will bundle the signed Bridge executable, prerequisites, Start Menu/Desktop shortcuts, optional startup-at-login, updater support and clean uninstall.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {["Install prerequisites","Install YSong Bridge","Create shortcuts","Configure updates"].map((step, index) => <div key={step} className="rounded-xl border border-white/8 bg-black/20 p-3"><div className="text-[10px] uppercase tracking-widest text-cyan-300">Step {index + 1}</div><div className="mt-1 text-sm font-medium">{step}</div></div>)}
        </div>
        <p className="mt-4 text-xs text-neutral-500">This screen intentionally does not pretend an installer exists yet. The installer becomes the next native packaging milestone.</p>
      </section>
    </div>
  </div>;
}
