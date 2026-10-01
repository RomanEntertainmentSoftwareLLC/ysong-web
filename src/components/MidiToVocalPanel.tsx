import { useEffect, useState } from "react";
import { listSingerCharacters, singerIdentity, type SingerCharacter } from "../lib/singerLibrary";
import { prepareVocalRequest, vocalRequestIsCurrent, type VocalSetup, type VocalSource, type VocalTimebase } from "../lib/midiToVocal";

export default function MidiToVocalPanel({ clip, timebase, onChange }: {
  clip: VocalSource & { name: string; vocalSetup?: VocalSetup };
  timebase: VocalTimebase;
  onChange: (setup: VocalSetup) => void;
}) {
  const [singers, setSingers] = useState<SingerCharacter[]>([]);
  const [error, setError] = useState("");
  const setup = clip.vocalSetup ?? { v: 1 as const, lyrics: {} };
  useEffect(() => {
    let alive = true;
    const refresh = () => { void listSingerCharacters().then((items) => { if (alive) setSingers(items); }).catch(() => { if (alive) setError("Could not load singers. Saved project singer details are retained."); }); };
    refresh(); window.addEventListener("ysong:singers-changed", refresh);
    return () => { alive = false; window.removeEventListener("ysong:singers-changed", refresh); };
  }, []);
  const current = vocalRequestIsCurrent(clip, timebase, setup);
  return <details className="shrink-0 border-b border-white/10 px-3 py-2 text-xs">
    <summary className="cursor-pointer">MIDI to Vocal · {clip.name}{setup.singer ? ` · ${setup.singer.displayName}` : " · Choose a singer"}</summary>
    <div className="max-h-64 overflow-y-auto space-y-3 py-3">
      <p>No singing synthesis engine is connected. Prepare and save a vocal request; no audio is generated. DAW playback remains an instrumental MIDI preview.</p>
      <label className="block">Saved singer <select className="rounded bg-neutral-900 text-white p-1" aria-label="Vocal singer" value={setup.singer?.id ?? ""} onChange={(event) => {
        const singer = singers.find((item) => item.id === event.target.value);
        onChange({ ...setup, singer: singer ? singerIdentity(singer) : undefined }); setError("");
      }}><option value="">Choose from Singer Studio</option>
        {setup.singer && !singers.some((item) => item.id === setup.singer!.id) && <option value={setup.singer.id}>{setup.singer.displayName} (saved project snapshot)</option>}
        {singers.map((singer) => <option key={singer.id} value={singer.id}>{singer.displayName}</option>)}
      </select></label>
      {setup.singer && <div><p>Singer snapshot: {setup.singer.displayName} · {setup.singer.voiceDescription || "No voice description"} · {setup.singer.vocalRange || "Range unspecified"}</p>
        <button type="button" className="underline" disabled={!singers.some((s) => s.id === setup.singer?.id)} onClick={() => {
          const singer = singers.find((s) => s.id === setup.singer?.id);
          if (singer) onChange({ ...setup, singer: singerIdentity(singer) });
        }}>Refresh from Singer Studio</button><p>Library changes never silently replace the project snapshot.</p></div>}
      <p>One syllable per note; use “ah” for wordless singing. Edit pitch and timing in the MIDI editor.</p>
      <div className="flex flex-wrap gap-2">{[...(clip.midiNotes ?? [])].sort((a, b) => a.startBars - b.startBars).map((note) => <label key={note.id} className="block">Pitch {note.pitch} · +{note.startBars.toFixed(2)} bars
        <input className="block w-36 rounded bg-neutral-900 text-white p-1" aria-label={`Syllable for note ${note.id}`} value={setup.lyrics[note.id] ?? ""} onChange={(event) => onChange({ ...setup, lyrics: { ...setup.lyrics, [note.id]: event.target.value } })} />
      </label>)}</div>
      <button type="button" className="rounded border px-3 py-1" onClick={() => {
        try { onChange({ ...setup, request: prepareVocalRequest(clip, timebase, setup) }); setError(""); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "Could not prepare request."); }
      }}>Prepare vocal request</button>
      <p role="status">{error || (setup.request ? current ? "Request prepared and included in project saves. Synthesis unavailable." : "Saved request is stale. Prepare again to include current MIDI, lyrics, singer, and timing." : "Singer and lyrics are included in project saves.")}</p>
    </div>
  </details>;
}
