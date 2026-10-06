import BridgeSettings from "../components/BridgeSettings";
import BridgeDownloads from "../components/BridgeDownloads";

export default function BridgePane() {
  return <div className="h-full min-h-0 overflow-y-auto bg-neutral-950 text-neutral-100">
    <div className="mx-auto max-w-6xl p-5 md:p-7 pb-28">
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[.24em] text-cyan-300">Native audio services</div>
          <h1 className="mt-1 text-3xl font-semibold">YSong Bridge</h1>
          <p className="mt-2 max-w-2xl text-sm text-neutral-400">Bridge connects YSong to Windows audio drivers, installed VST3 instruments/effects, MIDI routing, snapshots, auditions and native plugin editors.</p>
        </div>
      </div>
      <BridgeSettings />
      <BridgeDownloads />
    </div>
  </div>;
}
