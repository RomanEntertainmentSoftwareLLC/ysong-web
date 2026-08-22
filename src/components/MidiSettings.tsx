import { useEffect, useMemo, useState } from "react";
import { bridgeApi, BridgeRequestError, type BridgeMidiEvent, type BridgeMidiInputDevice, type BridgeMidiSettings } from "../lib/bridgeApi";
import { midiToName } from "../lib/midi";
import { YSButton } from "./YSButton";

function messageFor(error: unknown, fallback: string) {
  if (error instanceof BridgeRequestError && error.message) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function classifyDevice(name: string) {
  const n = name.toLowerCase();
  if (/lpd|mpd|launchpad|pad|control|surface|maschine/.test(n)) return "surface" as const;
  return "keyboard" as const;
}

function DeviceGlyph({ name }: { name: string }) {
  const type = classifyDevice(name);
  if (type === "surface") {
    return (
      <div className="w-16 h-10 rounded-md border border-neutral-500/40 bg-neutral-950/70 p-1 flex gap-1" aria-hidden>
        <div className="grid grid-cols-4 gap-[2px] flex-1">
          {Array.from({ length: 8 }).map((_, i) => <span key={i} className="rounded-[2px] border border-amber-300/30 bg-neutral-800" />)}
        </div>
        <div className="w-3 flex flex-col justify-around">{Array.from({ length: 4 }).map((_, i) => <span key={i} className="w-2 h-2 rounded-full border border-cyan-300/30 bg-neutral-800" />)}</div>
      </div>
    );
  }
  return (
    <div className="w-16 h-10 rounded-md border border-neutral-500/40 bg-neutral-950/70 p-1 flex items-end gap-[1px]" aria-hidden>
      {Array.from({ length: 12 }).map((_, i) => {
        const black = [1, 3, 6, 8, 10].includes(i % 12);
        return <span key={i} className={`${black ? "h-6 bg-neutral-800" : "h-8 bg-neutral-200"} flex-1 rounded-[1px]`} />;
      })}
    </div>
  );
}

export default function MidiSettings() {
  const [state, setState] = useState<BridgeMidiSettings>({ devices: [], enabledInputs: [], masterMode: "SelectedTrack" });
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [status, setStatus] = useState("Connect YSong Bridge to detect hardware MIDI.");
  const [lastEvent, setLastEvent] = useState<BridgeMidiEvent | null>(null);
  const [streamConnected, setStreamConnected] = useState(false);

  const refresh = async () => {
    try {
      const data = await bridgeApi.getMidiDevices();
      setState(data);
      setOnline(true);
      setStatus(data.devices.length ? `${data.devices.length} MIDI input${data.devices.length === 1 ? "" : "s"} detected.` : "Bridge is connected, but Windows reports no MIDI inputs.");
    } catch (error) {
      setOnline(false);
      setStatus(messageFor(error, "Could not reach YSong Bridge."));
    }
  };

  useEffect(() => { void refresh(); }, []);
  useEffect(() => bridgeApi.subscribeMidiEvents(setLastEvent, setStreamConnected), []);

  const save = async (next: { enabledInputs: string[]; masterMode: "SelectedTrack" | "Separate"; masterInputName?: string | null }) => {
    setBusy(true);
    try {
      const result = await bridgeApi.setMidiSettings(next);
      setState(result);
      setOnline(true);
      setStatus("MIDI settings saved to YSong Bridge.");
    } catch (error) {
      setStatus(messageFor(error, "Could not save MIDI settings."));
    } finally { setBusy(false); }
  };

  const autoDetect = async () => {
    setBusy(true); setStatus("Auto-detecting Windows MIDI inputs…");
    try {
      const result = await bridgeApi.autoDetectMidi();
      setState(result);
      setOnline(true);
      setStatus(result.devices.length ? `Auto-detected and enabled ${result.devices.length} MIDI input${result.devices.length === 1 ? "" : "s"}. Play a key or pad to test it.` : "No MIDI devices were detected.");
    } catch (error) {
      setStatus(messageFor(error, "MIDI auto-detect failed."));
    } finally { setBusy(false); }
  };

  const toggleDevice = (device: BridgeMidiInputDevice, enabled: boolean) => {
    const current = new Set(state.enabledInputs);
    if (enabled) current.add(device.name);
    else current.delete(device.name);
    const masterInputName = !enabled && state.masterInputName === device.name ? null : state.masterInputName;
    void save({ enabledInputs: [...current], masterMode: state.masterMode, masterInputName });
  };

  const setMaster = (name: string | null) => {
    const current = new Set(state.enabledInputs);
    if (name) current.add(name);
    void save({ enabledInputs: [...current], masterMode: state.masterMode, masterInputName: name });
  };

  const surfaces = useMemo(() => state.devices.filter((d) => classifyDevice(d.name) === "surface"), [state.devices]);
  const keyboards = useMemo(() => state.devices.filter((d) => classifyDevice(d.name) === "keyboard"), [state.devices]);

  const liveText = lastEvent
    ? lastEvent.kind === "noteon" && lastEvent.note != null
      ? `${lastEvent.device} • ${midiToName(lastEvent.note)} • velocity ${lastEvent.velocity ?? 0}`
      : lastEvent.kind === "noteoff" && lastEvent.note != null
        ? `${lastEvent.device} • ${midiToName(lastEvent.note)} released`
        : `${lastEvent.device} • CC ${lastEvent.controller ?? "?"} = ${lastEvent.value ?? "?"}`
    : "Play a key, pad, or knob to verify incoming MIDI.";

  const DeviceRow = ({ device, showMaster = true }: { device: BridgeMidiInputDevice; showMaster?: boolean }) => (
    <div className="grid grid-cols-[72px_minmax(0,1fr)_70px_70px] gap-3 items-center rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-950/40 px-3 py-2">
      <DeviceGlyph name={device.name} />
      <div className="min-w-0">
        <div className="font-medium truncate" title={device.name}>{device.name}</div>
        <div className="text-[11px] text-neutral-500">{classifyDevice(device.name) === "surface" ? "Controller / pad surface" : "MIDI keyboard / input"}</div>
      </div>
      <label className="text-xs flex flex-col items-center gap-1"><span className="text-neutral-500">Enabled</span><input type="checkbox" checked={state.enabledInputs.includes(device.name)} disabled={busy} onChange={(e) => toggleDevice(device, e.target.checked)} /></label>
      {showMaster ? <label className="text-xs flex flex-col items-center gap-1"><span className="text-neutral-500">Master</span><input type="radio" name="ys-midi-master" checked={state.masterInputName === device.name} disabled={busy} onChange={() => setMaster(device.name)} /></label> : <div />}
    </div>
  );

  return (
    <section className="border rounded-2xl p-4 md:p-5 bg-white/80 dark:bg-neutral-900/60 border-neutral-200 dark:border-neutral-800 shadow-sm">
      <header className="flex flex-wrap gap-3 items-start justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">MIDI keyboards & controllers</h2>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">Detect USB MIDI hardware through YSong Bridge and route it to the selected instrument track.</p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs ${online ? "border-emerald-400/40 text-emerald-600 dark:text-emerald-300" : "border-neutral-300 dark:border-neutral-700 text-neutral-500"}`}>● {online ? "Bridge MIDI ready" : "Bridge offline"}</span>
      </header>

      <div className="flex flex-wrap gap-2 mb-4">
        <YSButton disabled={!online || busy} onClick={() => void autoDetect()} className="rounded-lg border px-3 py-1.5">{busy ? "Working…" : "Auto-detect Devices"}</YSButton>
        <YSButton disabled={!online || busy} onClick={() => setManualOpen((v) => !v)} className="rounded-lg border px-3 py-1.5">Add Manually</YSButton>
        <YSButton disabled={busy} onClick={() => void refresh()} className="rounded-lg border px-3 py-1.5">Refresh</YSButton>
      </div>

      {manualOpen && (
        <div className="mb-4 rounded-xl border border-cyan-400/25 bg-cyan-400/5 p-3">
          <div className="font-medium text-sm">Available Windows MIDI ports</div>
          <div className="text-xs text-neutral-500 mt-1 mb-2">Enable only the ports you want YSong Bridge to open.</div>
          <div className="flex flex-wrap gap-2">
            {state.devices.length === 0 ? <span className="text-xs text-neutral-500">No ports detected.</span> : state.devices.map((d) => (
              <button key={d.index} type="button" disabled={busy} onClick={() => toggleDevice(d, !state.enabledInputs.includes(d.name))} className={`rounded-full border px-3 py-1 text-xs ${state.enabledInputs.includes(d.name) ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" : "border-neutral-300 dark:border-neutral-700"}`}>{state.enabledInputs.includes(d.name) ? "✓ " : "+ "}{d.name}</button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-5">
        <div>
          <div className="font-medium mb-2">Remote keyboards and control surfaces</div>
          <div className="space-y-2">
            {surfaces.length ? surfaces.map((d) => <DeviceRow key={d.index} device={d} />) : <div className="text-sm text-neutral-500 rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-3">No pad/control surfaces detected yet.</div>}
          </div>
        </div>

        <div>
          <div className="font-medium mb-1">Easy MIDI Inputs</div>
          <p className="text-xs text-neutral-500 mb-2">Keyboard-style inputs can follow whichever instrument track you select in the DAW.</p>
          <div className="space-y-2">
            {keyboards.length ? keyboards.map((d) => <DeviceRow key={d.index} device={d} />) : <div className="text-sm text-neutral-500 rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-3">No keyboard inputs detected yet.</div>}
          </div>
        </div>

        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3">
          <div className="font-medium mb-2">Master Keyboard Input</div>
          <label className="flex gap-2 items-start text-sm mb-2"><input type="radio" checked={state.masterMode === "SelectedTrack"} onChange={() => void save({ enabledInputs: state.enabledInputs, masterMode: "SelectedTrack", masterInputName: state.masterInputName })} /><span><strong>Standard</strong><span className="block text-xs text-neutral-500">Master keyboard input follows the selected instrument track.</span></span></label>
          <label className="flex gap-2 items-start text-sm"><input type="radio" checked={state.masterMode === "Separate"} onChange={() => void save({ enabledInputs: state.enabledInputs, masterMode: "Separate", masterInputName: state.masterInputName })} /><span><strong>Separated</strong><span className="block text-xs text-neutral-500">Keep the chosen master controller distinct from other enabled MIDI inputs.</span></span></label>
          {state.masterMode === "Separate" && (
            <select value={state.masterInputName ?? ""} onChange={(e) => setMaster(e.target.value || null)} className="mt-3 w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-3 py-2 text-sm">
              <option value="">Choose master input…</option>
              {state.devices.map((d) => <option key={d.index} value={d.name}>{d.name}</option>)}
            </select>
          )}
        </div>

        <div className={`rounded-xl border px-3 py-2 text-sm ${streamConnected ? "border-emerald-400/25 bg-emerald-500/5" : "border-neutral-300 dark:border-neutral-700"}`}>
          <div className="text-[11px] uppercase tracking-wide text-neutral-500 mb-1">Live MIDI monitor</div>
          <div className="font-mono text-xs">{liveText}</div>
        </div>
      </div>

      <div className="mt-3 text-xs text-neutral-500">{status}</div>
    </section>
  );
}
