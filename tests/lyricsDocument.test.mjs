import assert from 'node:assert/strict';
import { test } from 'node:test';
import { importPlainLyrics, lineText, lyricsToPlainText, restoreLyricsVersion, saveLyricsVersion, updateLineText } from '../src/lib/lyricsDocument.ts';

test('plain text round trip preserves sections and lines', () => {
  const original = '[Verse 1]\nFirst line\nSecond line\n\n[Chorus]\nSing again';
  const document = importPlainLyrics(original);
  assert.equal(lyricsToPlainText(document), original);
  assert.equal(document.sections[1].name, 'Chorus');
  assert.equal(document.sections[0].lines[0].words.length, 2);
  assert.equal(document.sections[0].lines[0].startMs, null);
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
