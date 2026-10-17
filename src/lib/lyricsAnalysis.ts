import { lineText, type LyricsDocument, type LyricLine } from "./lyricsDocument.ts";

export type AnalyzedLine = { section: string; line: number; text: string; syllables: number; ending: string };
export type LyricsAnalysis = {
  lines: AnalyzedLine[];
  rhymeGroups: Array<{ ending: string; lines: AnalyzedLine[] }>;
  repeatedWords: Array<{ word: string; count: number }>;
  duplicateLines: Array<{ text: string; occurrences: Array<{ section: string; line: number }> }>;
  sections: Array<{ name: string; lines: number; words: number; syllables: number; share: number }>;
  meter: { totalLines: number; repeatedCount: number | null; counts: Array<{ syllables: number; lines: number }> };
};

const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
const normalized = (text: string) => words(text).join(" ");

// A simple English vowel-group estimate; it does not analyze pronunciation.
export function estimateWordSyllables(word: string): number {
  const cleaned = word.toLowerCase().replace(/[^\p{L}]/gu, "");
  if (!cleaned) return 0;
  let groups = cleaned.match(/[aeiouy]+/g)?.length ?? 1;
  if (/e$/.test(cleaned) && !/(le|ye)$/.test(cleaned) && groups > 1) groups--;
  if (/[^aeiouy]le$/.test(cleaned)) groups++;
  return Math.max(1, groups);
}

function syllableCount(line: LyricLine, text: string): number {
  if (line.words.length) return line.words.reduce((sum, word) => sum + (word.syllables?.length ? word.syllables.length : estimateWordSyllables(word.text)), 0);
  return words(text).reduce((sum, word) => sum + estimateWordSyllables(word), 0);
}

function rhymeEnding(text: string): string {
  const last = words(text).at(-1) ?? "";
  const groups = [...last.matchAll(/[aeiouy]+/g)];
  return groups.length ? last.slice(groups.at(-1)!.index ?? 0) : last;
}

export function analyzeLyrics(document: LyricsDocument): LyricsAnalysis {
  const lines: AnalyzedLine[] = [];
  const sections = document.sections.map((section) => {
    let wordCount = 0;
    let sectionSyllables = 0;
    section.lines.forEach((line, index) => {
      const text = lineText(line);
      if (!text.trim()) return;
      const count = syllableCount(line, text);
      wordCount += words(text).length;
      sectionSyllables += count;
      lines.push({ section: section.name, line: index + 1, text, syllables: count, ending: rhymeEnding(text) });
    });
    return { name: section.name, lines: section.lines.filter((line) => lineText(line).trim()).length, words: wordCount, syllables: sectionSyllables, share: 0 };
  });

  const rhymeMap = new Map<string, AnalyzedLine[]>();
  lines.forEach((line) => { if (line.ending.length >= 2) rhymeMap.set(line.ending, [...(rhymeMap.get(line.ending) ?? []), line]); });
  const repeated = new Map<string, number>();
  lines.forEach((line) => words(line.text).forEach((word) => repeated.set(word, (repeated.get(word) ?? 0) + 1)));
  const duplicateMap = new Map<string, Array<{ section: string; line: number }>>();
  lines.forEach((line) => { const key = normalized(line.text); if (key) duplicateMap.set(key, [...(duplicateMap.get(key) ?? []), { section: line.section, line: line.line }]); });
  const counts = new Map<number, number>();
  lines.forEach((line) => counts.set(line.syllables, (counts.get(line.syllables) ?? 0) + 1));
  const mostCommon = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  const totalSyllables = sections.reduce((sum, section) => sum + section.syllables, 0);
  sections.forEach((section) => { section.share = totalSyllables ? Math.round(section.syllables / totalSyllables * 100) : 0; });

  return {
    lines,
    rhymeGroups: [...rhymeMap.entries()].filter(([, group]) => group.length > 1).map(([ending, group]) => ({ ending, lines: group })),
    repeatedWords: [...repeated.entries()].filter(([, count]) => count > 1).map(([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count || a.word.localeCompare(b.word)),
    duplicateLines: [...duplicateMap.entries()].filter(([, occurrences]) => occurrences.length > 1).map(([text, occurrences]) => ({ text, occurrences })),
    sections,
    meter: { totalLines: lines.length, repeatedCount: mostCommon && mostCommon[1] > 1 ? mostCommon[0] : null, counts: [...counts.entries()].map(([syllables, count]) => ({ syllables, lines: count })).sort((a, b) => a.syllables - b.syllables) },
  };
}
