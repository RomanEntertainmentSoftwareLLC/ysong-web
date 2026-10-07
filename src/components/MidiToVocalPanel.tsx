import { useEffect, useState } from "react";
import { NOTE_NAMES } from "../lib/midi";
import { listSingerCharacters, singerIdentity, type SingerCharacter } from "../lib/singerLibrary";
import { prepareVocalRequest, vocalRequestIsCurrent, type VocalSetup, type VocalSource, type VocalTimebase } from "../lib/midiToVocal";

const pitchName = (pitch: number) => `${NOTE_NAMES[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;

export default function MidiToVocalPanel({ clip, timebase, onChange }: {
  clip: VocalSource & { name: string; vocalSetup?: VocalSetup };
  timebase: VocalTimebase;
  onChange: (setup: VocalSetup) => void;
}) {
  const [singers, setSingers] = useState<SingerCharacter[]>([]);
  const [error, setError] = useState("");
  const [libraryError, setLibraryError] = useState("");
  const setup = clip.vocalSetup ?? { v: 1 as const, lyrics: {} };
  useEffect(() => {
    let alive = true;
    const refresh = () => { void listSingerCharacters().then((items) => {
      if (alive) { setSingers(items); setLibraryError(""); }
    }).catch(() => { if (alive) setLibraryError("Singer library could not be loaded. The saved project snapshot is still available."); }); };
    refresh(); window.addEventListener("ysong:singers-changed", refresh);
    return () => { alive = false; window.removeEventListener("ysong:singers-changed", refresh); };
  }, []);

  const notes = [...(clip.midiNotes ?? [])].sort((a, b) => a.startBars - b.startBars || a.id.localeCompare(b.id));
  const aligned = notes.filter((note) => setup.lyrics[note.id]?.trim()).length;
  const current = vocalRequestIsCurrent(clip, timebase, setup);
  const savedSinger = !!setup.singer && !singers.some((item) => item.id === setup.singer?.id);
  const card = "rounded-lg border border-white/10 bg-white/[0.04] p-3";

  return <details className="shrink-0 border-b border-violet-300/20 bg-neutral-950/90 text-xs text-neutral-200">
    <summary className="cursor-pointer px-3 py-2 font-medium text-violet-100">MIDI to Vocal · {clip.name} · {setup.singer?.displayName ?? "Choose a singer"}</summary>
    <div className="max-h-[min(65vh,560px)] overflow-y-auto border-t border-white/10 p-3">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div><h3 className="text-sm font-semibold text-white">Vocal workspace</h3><p className="mt-1 text-neutral-400">Align a monophonic MIDI melody with one syllable per note. Pitch, timing, velocity, and expression remain editable in the MIDI editor.</p></div>
        <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-2 py-1 text-amber-100">Synthesis unavailable</span>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(210px,1fr)_minmax(280px,2fr)_minmax(210px,1fr)]">
        <section className={card} aria-label="Singer selection">
          <h4 className="font-semibold text-white">1. Singer</h4>
          <label className="mt-3 block text-neutral-300">Saved Singer Studio identity
            <select className="mt-1 w-full rounded border border-white/15 bg-neutral-900 p-2 text-white" value={setup.singer?.id ?? ""} onChange={(event) => {
              const singer = singers.find((item) => item.id === event.target.value);
              onChange({ ...setup, singer: singer ? singerIdentity(singer) : undefined }); setError("");
            }}><option value="">Choose a singer</option>
              {savedSinger && <option value={setup.singer!.id}>{setup.singer!.displayName} (saved snapshot)</option>}
              {singers.map((singer) => <option key={singer.id} value={singer.id}>{singer.displayName}</option>)}
            </select>
          </label>
          {libraryError && <p role="status" className="mt-2 text-amber-200">{libraryError}</p>}
          {setup.singer ? <div className="mt-3 space-y-1 text-neutral-400">
            <p className="font-medium text-neutral-200">{setup.singer.displayName}{savedSinger ? " · saved snapshot" : ""}</p>
            <p>{setup.singer.voiceDescription || "Voice description unspecified"}</p>
            <p>Range: {setup.singer.vocalRange || "unspecified"} · Style: {setup.singer.vocalStyle || "unspecified"}</p>
            <button type="button" className="mt-1 text-violet-200 underline disabled:opacity-40" disabled={savedSinger} onClick={() => {
              const singer = singers.find((item) => item.id === setup.singer?.id);
              if (singer) onChange({ ...setup, singer: singerIdentity(singer) });
            }}>Refresh saved snapshot</button>
            <p>Library edits do not change this project until refreshed.</p>
          </div> : <p className="mt-3 text-neutral-400">Create or select a Singer Studio identity to prepare a request.</p>}
        </section>
        <section className={card} aria-label="MIDI and lyrics alignment">
          <div className="flex items-center justify-between gap-2"><h4 className="font-semibold text-white">2. MIDI + lyrics</h4><span className="text-neutral-400">{aligned}/{notes.length} syllables</span></div>
          <p className="mt-1 text-neutral-400">Clip starts at bar {clip.startBar} · {timebase.bpm} BPM · {timebase.sigNum}/{timebase.sigDen}. Use “ah” for wordless notes.</p>
          {notes.length ? <div className="mt-3 max-h-56 overflow-y-auto rounded border border-white/10">
            <div className="grid grid-cols-[2rem_5rem_1fr] gap-2 border-b border-white/10 bg-white/5 px-2 py-1 text-neutral-400"><span>#</span><span>Pitch</span><span>Position · syllable</span></div>
            {notes.map((note, index) => <label key={note.id} className="grid grid-cols-[2rem_5rem_1fr] items-center gap-2 border-b border-white/5 px-2 py-1.5 last:border-0">
              <span className="text-neutral-500">{index + 1}</span><span>{pitchName(note.pitch)}</span>
              <span className="flex min-w-0 items-center gap-2"><span className="w-24 shrink-0 text-neutral-400">+{note.startBars.toFixed(2)} bar</span>
                <input className="min-w-0 flex-1 rounded border border-white/15 bg-neutral-900 px-2 py-1 text-white" aria-label={`Syllable for note ${note.id}`} placeholder="Syllable" value={setup.lyrics[note.id] ?? ""} onChange={(event) => onChange({ ...setup, lyrics: { ...setup.lyrics, [note.id]: event.target.value } })} /></span>
            </label>)}
          </div> : <p className="mt-3 text-amber-200">This MIDI clip has no notes. Add a melody in the MIDI editor.</p>}
        </section>
        <section className={card} aria-label="Render and preview status">
          <h4 className="font-semibold text-white">3. Request + preview</h4>
          <dl className="mt-3 space-y-2 text-neutral-300">
            <div><dt className="text-neutral-400">Capability</dt><dd>No singing provider or voice model is connected. Singer identity is not a trained model.</dd></div>
            <div><dt className="text-neutral-400">Render job</dt><dd>{setup.request ? current ? "Request prepared · no job submitted" : "Saved request stale · no job submitted" : "No request prepared · no job submitted"}</dd></div>
            <div><dt className="text-neutral-400">Preview artifacts</dt><dd>No vocal audio is available. DAW MIDI playback is instrumental only.</dd></div>
          </dl>
          <button type="button" className="mt-3 rounded border border-violet-300/40 bg-violet-400/15 px-3 py-1.5 font-medium text-violet-100 hover:bg-violet-400/25" onClick={() => {
            try { onChange({ ...setup, request: prepareVocalRequest(clip, timebase, setup) }); setError(""); }
            catch (cause) { setError(cause instanceof Error ? cause.message : "Could not prepare request."); }
          }}>{setup.request ? "Update vocal request" : "Prepare vocal request"}</button>
          <p role="status" className={`mt-2 ${error ? "text-amber-200" : "text-neutral-400"}`}>{error || (setup.request ? current ? "Current request is saved with the project." : "Inputs changed. Prepare again to update the saved request." : "Preparation validates singer, syllables, and MIDI alignment.")}</p>
        </section>
      </div>
    </div>
  </details>;
}
