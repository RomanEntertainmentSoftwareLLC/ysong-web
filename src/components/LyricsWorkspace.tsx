import { useState } from "react";
import {
  importPlainLyrics, lineText, lyricsToPlainText, makeLine, makeSection,
  restoreLyricsVersion, saveLyricsVersion, updateLineText,
  type LyricsDocument, type LyricLine,
} from "../lib/lyricsDocument";

type Props = { document: LyricsDocument; onChange: (document: LyricsDocument) => void };
const timing = (value: number | null) => value == null ? "" : String(value);
const parseTiming = (value: string) => value.trim() === "" ? null : Math.max(0, Math.round(Number(value) || 0));

export default function LyricsWorkspace({ document, onChange }: Props) {
  const [plainOpen, setPlainOpen] = useState(false);
  const [plain, setPlain] = useState("");
  const [versionLabel, setVersionLabel] = useState("");
  const changeSection = (sectionId: string, update: (section: LyricsDocument["sections"][number]) => LyricsDocument["sections"][number]) =>
    onChange({ ...document, sections: document.sections.map((section) => section.id === sectionId ? update(section) : section) });
  const changeLine = (sectionId: string, lineId: string, update: (line: LyricLine) => LyricLine) =>
    changeSection(sectionId, (section) => ({ ...section, lines: section.lines.map((line) => line.id === lineId ? update(line) : line) }));

  return <div className="rounded-xl border border-white/10 bg-white/[.025] p-3 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><div className="text-sm font-medium">Lyrics workspace</div><p className="text-xs text-neutral-400">Section, line, and word IDs stay stable as you edit. Timing is optional and measured in milliseconds.</p></div>
      <button type="button" className="rounded-lg border border-white/15 px-2 py-1 text-xs" onClick={() => { setPlain(lyricsToPlainText(document)); setPlainOpen(!plainOpen); }}>{plainOpen ? "Close plain text" : "Import / export text"}</button>
    </div>
    {plainOpen && <div className="space-y-2"><textarea className="input min-h-36 font-mono text-sm" aria-label="Plain lyrics" value={plain} onChange={(event) => setPlain(event.target.value)} /><div className="flex gap-2"><button type="button" className="rounded-lg border border-indigo-400/30 px-2 py-1 text-xs" onClick={() => { onChange(importPlainLyrics(plain, document)); setPlainOpen(false); }}>Import text</button><button type="button" className="rounded-lg border border-white/15 px-2 py-1 text-xs" onClick={() => void navigator.clipboard.writeText(lyricsToPlainText(document))}>Copy export</button></div><p className="text-xs text-neutral-500">Use [Verse 1] style headings. Import creates new IDs; save a version first if you want to keep the current alignment.</p></div>}
    {document.sections.map((section) => <div key={section.id} className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-2">
      <div className="flex gap-2"><input className="input text-sm" aria-label="Section name" value={section.name} onChange={(event) => changeSection(section.id, (item) => ({ ...item, name: event.target.value }))} /><button type="button" aria-label={`Remove ${section.name} section`} className="rounded-lg border border-white/10 px-2 text-xs" disabled={document.sections.length === 1} onClick={() => onChange({ ...document, sections: document.sections.filter((item) => item.id !== section.id) })}>Remove</button></div>
      {section.lines.map((line) => <div key={line.id} className="space-y-1"><div className="flex gap-2"><input className="input text-sm" aria-label="Lyric line" value={lineText(line)} onChange={(event) => changeLine(section.id, line.id, (item) => updateLineText(item, event.target.value))} placeholder="Write a line…" /><button type="button" aria-label="Remove line" className="rounded-lg border border-white/10 px-2 text-xs" onClick={() => changeSection(section.id, (item) => ({ ...item, lines: item.lines.filter((entry) => entry.id !== line.id) }))}>×</button></div><div className="flex items-center gap-2 text-[11px] text-neutral-500"><span>Timing</span><input className="w-20 rounded border border-white/10 bg-black/20 px-1" type="number" min="0" aria-label="Line start milliseconds" placeholder="Start ms" value={timing(line.startMs)} onChange={(event) => changeLine(section.id, line.id, (item) => ({ ...item, startMs: parseTiming(event.target.value) }))} /><span>to</span><input className="w-20 rounded border border-white/10 bg-black/20 px-1" type="number" min="0" aria-label="Line end milliseconds" placeholder="End ms" value={timing(line.endMs)} onChange={(event) => changeLine(section.id, line.id, (item) => ({ ...item, endMs: parseTiming(event.target.value) }))} /><span>{line.words.length} words</span></div></div>)}
      <button type="button" className="rounded-lg border border-white/10 px-2 py-1 text-xs" onClick={() => changeSection(section.id, (item) => ({ ...item, lines: [...item.lines, makeLine()] }))}>+ Line</button>
    </div>)}
    <button type="button" className="rounded-lg border border-indigo-400/30 px-2 py-1 text-xs" onClick={() => onChange({ ...document, sections: [...document.sections, makeSection(`Verse ${document.sections.length + 1}`)] })}>+ Section</button>
    <div className="border-t border-white/10 pt-3 space-y-2"><div className="text-xs font-medium">Version history</div><div className="flex gap-2"><input className="input text-sm" aria-label="Version label" placeholder="Version label" value={versionLabel} onChange={(event) => setVersionLabel(event.target.value)} /><button type="button" className="rounded-lg border border-white/15 px-2 text-xs whitespace-nowrap" onClick={() => { onChange(saveLyricsVersion(document, versionLabel)); setVersionLabel(""); }}>Save version</button></div>{document.versions.map((version) => <div key={version.id} className="flex items-center justify-between gap-2 text-xs"><span>{version.label} · {new Date(version.createdAt).toLocaleString()}</span><button type="button" className="rounded-lg border border-white/15 px-2 py-1" onClick={() => onChange(restoreLyricsVersion(document, version.id))}>Restore</button></div>)}</div>
  </div>;
}
