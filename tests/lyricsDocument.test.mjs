import assert from 'node:assert/strict';
import { test } from 'node:test';
import { importPlainLyrics, lineText, lyricsToPlainText, makeSyllables, restoreLyricsVersion, saveLyricsVersion, suggestMidiTiming, suggestTiming, updateLineText } from '../src/lib/lyricsDocument.ts';
import { midiOnsets } from '../src/lib/midiOnsets.ts';
import { analyzeLyrics, estimateWordSyllables } from '../src/lib/lyricsAnalysis.ts';

test('plain text round trip preserves sections and lines', () => {
  const original = '[Verse 1]\nFirst line\nSecond line\n\n[Chorus]\nSing again';
  const document = importPlainLyrics(original);
  assert.equal(lyricsToPlainText(document), original);
  assert.equal(document.sections[1].name, 'Chorus');
  assert.equal(document.sections[0].lines[0].words.length, 2);
  assert.equal(document.sections[0].lines[0].startMs, null);
});

test('syllable timing stays empty without evidence and suggestions mark low confidence', () => {
  const line = importPlainLyrics('hello world').sections[0].lines[0];
  assert.equal(line.words[0].startMs, null);
  const syllables = makeSyllables('hel-lo');
  const prepared = { ...line, words: [{ ...line.words[0], syllables }, line.words[1]] };
  assert.equal(suggestTiming(prepared, 0, 0, 'audio'), prepared);
  const suggested = suggestTiming(prepared, 100, 700, 'audio');
  assert.deepEqual(suggested.words.map((word) => [word.startMs, word.endMs]), [[100, 500], [500, 700]]);
  assert.deepEqual(suggested.words[0].syllables.map((part) => [part.startMs, part.endMs]), [[100, 300], [300, 500]]);
  assert.equal(suggested.words[0].confidence.score, 0.25);
  assert.equal(updateLineText(suggested, 'hello world!').words[0].id, line.words[0].id);
});

test('MIDI notes provide boundaries only when enough onsets exist', () => {
  const midi = Uint8Array.from([77,84,104,100,0,0,0,6,0,0,0,1,1,224,77,84,114,107,0,0,0,13,0,0x90,60,100,0x83,0x60,0x90,62,100,0,0xff,0x2f,0]);
  const onsets = midiOnsets(midi);
  assert.deepEqual(onsets, [0, 500]);
  const line = importPlainLyrics('one two').sections[0].lines[0];
  assert.equal(suggestMidiTiming(line, [0], 0, 1000), line);
  const suggested = suggestMidiTiming(line, onsets, 0, 1000);
  assert.deepEqual(suggested.words.map((word) => [word.startMs, word.endMs]), [[0, 500], [500, 1000]]);
  assert.equal(suggested.confidence.source, 'midi');
});

test('line and unchanged word IDs survive inserting text', () => {
  const line = importPlainLyrics('sing the refrain').sections[0].lines[0];
  const edited = updateLineText(line, 'please sing the refrain ');
  assert.equal(edited.id, line.id);
  assert.equal(lineText(edited), 'please sing the refrain ');
  assert.deepEqual(edited.words.slice(1).map((word) => word.id), line.words.map((word) => word.id));
});

test('versions snapshot sections and restore timing', () => {
  const original = importPlainLyrics('[Verse]\nOne two');
  original.sections[0].lines[0].startMs = 100;
  const saved = saveLyricsVersion(original, 'Take A');
  const changed = { ...saved, sections: [{ ...saved.sections[0], lines: [updateLineText(saved.sections[0].lines[0], 'Three four')] }] };
  const restored = restoreLyricsVersion(changed, saved.versions[0].id);
  assert.equal(lineText(restored.sections[0].lines[0]), 'One two');
  assert.equal(restored.sections[0].lines[0].startMs, 100);
  assert.equal(restored.sections[0].lines[0].id, original.sections[0].lines[0].id);
});

test('lyrics analysis reports deterministic text observations', () => {
  const document = importPlainLyrics('[Verse]\nI see the light\nWe feel the night\nI see the light\n[Chorus]\nSing again');
  const analysis = analyzeLyrics(document);
  assert.equal(analysis.lines.length, 4);
  assert.deepEqual(analysis.rhymeGroups.map((group) => group.ending), ['ight']);
  assert.deepEqual(analysis.duplicateLines, [{ text: 'i see the light', occurrences: [{ section: 'Verse', line: 1 }, { section: 'Verse', line: 3 }] }]);
  assert.deepEqual(analysis.repeatedWords.find((item) => item.word === 'light'), { word: 'light', count: 2 });
  assert.deepEqual(analysis.sections.map(({ name, lines, share }) => ({ name, lines, share })), [{ name: 'Verse', lines: 3, share: 86 }, { name: 'Chorus', lines: 1, share: 14 }]);
  assert.equal(analysis.meter.totalLines, 4);
  assert.equal(estimateWordSyllables('fire'), 1);
});

test('lyrics analysis excludes blank lines and keeps section totals aligned', () => {
  const document = importPlainLyrics('[Verse]\n\n[Chorus]\n');
  const analysis = analyzeLyrics(document);
  assert.equal(analysis.lines.length, 0);
  assert.deepEqual(analysis.sections.map(({ lines, words, syllables, share }) => ({ lines, words, syllables, share })), [
    { lines: 0, words: 0, syllables: 0, share: 0 },
    { lines: 0, words: 0, syllables: 0, share: 0 },
  ]);
  assert.deepEqual(analysis.meter, { totalLines: 0, repeatedCount: null, counts: [] });
});
