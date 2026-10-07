export type TimingSource = "manual" | "audio" | "midi";
export type TimingConfidence = { source: TimingSource; score: number };
export type LyricSyllable = { id: string; text: string; startMs: number | null; endMs: number | null; confidence?: TimingConfidence };
export type LyricWord = { id: string; text: string; startMs: number | null; endMs: number | null; syllables?: LyricSyllable[]; confidence?: TimingConfidence };
export type LyricLine = { id: string; text: string; words: LyricWord[]; startMs: number | null; endMs: number | null; confidence?: TimingConfidence };
export type LyricSection = { id: string; name: string; lines: LyricLine[]; startMs: number | null; endMs: number | null };
export type LyricVersion = { id: string; label: string; createdAt: string; sections: LyricSection[] };
export type LyricsDocument = { id: string; sections: LyricSection[]; versions: LyricVersion[] };

const id = () => crypto.randomUUID();
export const makeSyllables = (text: string, previous: LyricSyllable[] = []): LyricSyllable[] => {
  const parts = text.split(/[-·]/).map((part) => part.trim()).filter(Boolean);
  return parts.map((part, index) => previous[index]?.text === part ? previous[index] : { id: id(), text: part, startMs: null, endMs: null });
};
const wordsOf = (text: string, previous: LyricWord[] = []): LyricWord[] => {
  const next = text.match(/\S+/g) ?? [];
  const scores = Array.from({ length: previous.length + 1 }, () => Array<number>(next.length + 1).fill(0));
  for (let a = previous.length - 1; a >= 0; a--) for (let b = next.length - 1; b >= 0; b--) {
    scores[a][b] = previous[a].text === next[b] ? 1 + scores[a + 1][b + 1] : Math.max(scores[a + 1][b], scores[a][b + 1]);
  }
  const matches = new Map<number, LyricWord>();
  let a = 0; let b = 0;
  while (a < previous.length && b < next.length) {
    if (previous[a].text === next[b]) { matches.set(b, previous[a]); a++; b++; }
    else if (scores[a + 1][b] >= scores[a][b + 1]) a++;
    else b++;
  }
  return next.map((word, index) => matches.get(index) ?? { id: id(), text: word, startMs: null, endMs: null, syllables: makeSyllables(word) });
};

export const lineText = (line: LyricLine) => line.text ?? line.words.map((word) => word.text).join(" ");
export const makeLine = (text = ""): LyricLine => ({ id: id(), text, words: wordsOf(text), startMs: null, endMs: null });
export const makeSection = (name = "Verse 1"): LyricSection => ({ id: id(), name, lines: [makeLine()], startMs: null, endMs: null });
export const emptyLyricsDocument = (): LyricsDocument => ({ id: id(), sections: [makeSection()], versions: [] });
export function updateLineText(line: LyricLine, text: string): LyricLine { return { ...line, text, words: wordsOf(text, line.words) }; }

// The bounds are a user-selected passage in a real recording or MIDI region. These
// subdivisions are suggestions only: no acoustic or phonetic alignment is claimed.
export function suggestTiming(line: LyricLine, startMs: number, endMs: number, source: "audio" | "midi"): LyricLine {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || !line.words.length) return line;
  const weights = line.words.map((word) => (word.syllables?.length || 1));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let position = startMs;
  const words = line.words.map((word, index) => {
    const wordStart = position;
    position = index === line.words.length - 1 ? endMs : startMs + (endMs - startMs) * weights.slice(0, index + 1).reduce((a, b) => a + b, 0) / total;
    const syllables = word.syllables?.length ? word.syllables : makeSyllables(word.text);
    return { ...word, startMs: Math.round(wordStart), endMs: Math.round(position), confidence: { source, score: 0.25 }, syllables: syllables.map((part, partIndex) => ({ ...part, startMs: Math.round(wordStart + (position - wordStart) * partIndex / syllables.length), endMs: Math.round(wordStart + (position - wordStart) * (partIndex + 1) / syllables.length), confidence: { source, score: 0.2 } })) };
  });
  return { ...line, startMs: Math.round(startMs), endMs: Math.round(endMs), confidence: { source, score: 0.4 }, words };
}
export function suggestMidiTiming(line: LyricLine, onsets: number[], startMs: number, endMs: number): LyricLine {
  const notes = onsets.filter((time) => time >= startMs && time < endMs);
  const count = line.words.reduce((sum, word) => sum + (word.syllables?.length || 1), 0);
  if (!count || notes.length < count || endMs <= startMs) return line;
  let index = 0;
  const words = line.words.map((word) => {
    const parts = word.syllables?.length ? word.syllables : makeSyllables(word.text);
    const syllables = parts.map((part) => {
      const start = notes[index++];
      return { ...part, startMs: start, endMs: index < count ? notes[index] : endMs, confidence: { source: "midi" as const, score: 0.55 } };
    });
    return { ...word, startMs: syllables[0].startMs, endMs: syllables[syllables.length - 1].endMs, syllables, confidence: { source: "midi" as const, score: 0.55 } };
  });
  return { ...line, startMs, endMs, words, confidence: { source: "midi", score: 0.55 } };
}
export function lyricsToPlainText(document: LyricsDocument): string { return document.sections.map((section) => [`[${section.name}]`, ...section.lines.map(lineText)].join("\n")).join("\n\n"); }
export function importPlainLyrics(text: string, previous?: LyricsDocument): LyricsDocument {
  const sections: LyricSection[] = []; let current: LyricSection | null = null;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = raw.trim().match(/^\[([^\]\n]+)\]$/);
    if (heading) { current = { id: id(), name: heading[1].trim(), lines: [], startMs: null, endMs: null }; sections.push(current); }
    else if (raw.trim()) { if (!current) { current = { id: id(), name: "Verse 1", lines: [], startMs: null, endMs: null }; sections.push(current); } current.lines.push(makeLine(raw.trim())); }
  }
  if (!sections.length) sections.push(makeSection());
  return { id: previous?.id ?? id(), sections, versions: previous?.versions ?? [] };
}
export function saveLyricsVersion(document: LyricsDocument, label: string): LyricsDocument { const version: LyricVersion = { id: id(), label: label.trim() || `Version ${document.versions.length + 1}`, createdAt: new Date().toISOString(), sections: structuredClone(document.sections) }; return { ...document, versions: [...document.versions, version] }; }
export function restoreLyricsVersion(document: LyricsDocument, versionId: string): LyricsDocument { const version = document.versions.find((item) => item.id === versionId); return version ? { ...document, sections: structuredClone(version.sections) } : document; }
