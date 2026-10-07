import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeStereoWav } from '../src/lib/dawExport.ts';

test('PCM export declares rate, depth, stereo layout and title metadata', () => {
  for (const bits of [16, 24]) {
    const wav = encodeStereoWav(new Float32Array([0, 0.5]), new Float32Array([0, -0.5]), 44100, bits, 'Mix A');
    const view = new DataView(wav.buffer);
    assert.equal(view.getUint32(4, true) + 8, wav.length);
    assert.equal(view.getUint16(20, true), 1);
    assert.equal(view.getUint16(22, true), 2);
    assert.equal(view.getUint32(24, true), 44100);
    assert.equal(view.getUint16(34, true), bits);
    assert.equal(view.getUint32(40, true), 2 * 2 * bits / 8);
    assert.match(new TextDecoder().decode(wav.subarray(44 + 2 * 2 * bits / 8)), /LIST.*INFO.*INAM.*Mix A.*ISFT.*YSong/s);
  }
});
