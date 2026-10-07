export type LyricWord = { id: string; text: string; startMs: number | null; endMs: number | null };
export type LyricLine = { id: string; text: string; words: LyricWord[]; startMs: number | null; endMs: number | null };
export type LyricSection = { id: string; name: string; lines: LyricLine[]; startMs: number | null; endMs: number | null };
export type LyricVersion = { id: string; label: string; createdAt: string; sections: LyricSection[] };
export type LyricsDocument = { id: string; sections: LyricSection[]; versions: LyricVersion[] };

const id = () => crypto.randomUUID();
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
  return next.map((word, index) => matches.get(index) ?? { id: id(), text: word, startMs: null, endMs: null });
};

export const lineText = (line: LyricLine) => line.text ?? line.words.map((word) => word.text).join(" ");
export const makeLine = (text = ""): LyricLine => ({ id: id(), text, words: wordsOf(text), startMs: null, endMs: null });
export const makeSection = (name = "Verse 1"): LyricSection => ({ id: id(), name, lines: [makeLine()], startMs: null, endMs: null });
export const emptyLyricsDocument = (): LyricsDocument => ({ id: id(), sections: [makeSection()], versions: [] });

export function updateLineText(line: LyricLine, text: string): LyricLine {
  return { ...line, text, words: wordsOf(text, line.words) };
}

export function lyricsToPlainText(document: LyricsDocument): string {
  return document.sections.map((section) => [
    `[${section.name}]`,
    ...section.lines.map(lineText),
  ].join("\n")).join("\n\n");
}

export function importPlainLyrics(text: string, previous?: LyricsDocument): LyricsDocument {
  const sections: LyricSection[] = [];
  let current: LyricSection | null = null;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = raw.trim().match(/^\[([^\]\n]+)\]$/);
    if (heading) {
      current = { id: id(), name: heading[1].trim(), lines: [], startMs: null, endMs: null };
      sections.push(current);
    } else if (raw.trim()) {
      if (!current) {
        current = { id: id(), name: "Verse 1", lines: [], startMs: null, endMs: null };
        sections.push(current);
      }
      current.lines.push(makeLine(raw.trim()));
    }
  }
  if (!sections.length) sections.push(makeSection());
  return { id: previous?.id ?? id(), sections, versions: previous?.versions ?? [] };
}

export function saveLyricsVersion(document: LyricsDocument, label: string): LyricsDocument {
  const version: LyricVersion = {
    id: id(), label: label.trim() || `Version ${document.versions.length + 1}`,
    createdAt: new Date().toISOString(), sections: structuredClone(document.sections),
  };
  return { ...document, versions: [...document.versions, version] };
}

export function restoreLyricsVersion(document: LyricsDocument, versionId: string): LyricsDocument {
  const version = document.versions.find((item) => item.id === versionId);
  return version ? { ...document, sections: structuredClone(version.sections) } : document;
}
