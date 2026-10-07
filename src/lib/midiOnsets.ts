// Standard MIDI note-on positions. Tempo events are shared across tracks.
export function midiOnsets(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const read32 = (at: number) => view.getUint32(at);
  if (bytes.length < 14 || String.fromCharCode(...bytes.slice(0, 4)) !== "MThd") throw new Error("Invalid MIDI header");
  const division = view.getUint16(12);
  if (division & 0x8000 || !division) throw new Error("SMPTE MIDI timing is not supported");
  let offset = 8 + read32(4);
  const notes: number[] = [];
  const tempos: Array<{ tick: number; tempo: number }> = [{ tick: 0, tempo: 500000 }];
  const variable = (end: number, position: { value: number }) => {
    let result = 0;
    for (let i = 0; i < 4; i++) {
      if (position.value >= end) throw new Error("Truncated MIDI event");
      const byte = bytes[position.value++]; result = (result << 7) | (byte & 0x7f);
      if (!(byte & 0x80)) return result;
    }
    throw new Error("Invalid MIDI delta");
  };
  while (offset + 8 <= bytes.length) {
    if (String.fromCharCode(...bytes.slice(offset, offset + 4)) !== "MTrk") throw new Error("Invalid MIDI track");
    const end = offset + 8 + read32(offset + 4);
    if (end > bytes.length) throw new Error("Truncated MIDI track");
    const position = { value: offset + 8 };
    let tick = 0; let running = 0;
    while (position.value < end) {
      tick += variable(end, position);
      let status = bytes[position.value];
      if (status & 0x80) { position.value++; if (status < 0xf0) running = status; }
      else { status = running; if (!status) throw new Error("Invalid MIDI running status"); }
      if (status === 0xff) {
        const kind = bytes[position.value++]; const length = variable(end, position);
        if (kind === 0x51 && length === 3) tempos.push({ tick, tempo: (bytes[position.value] << 16) | (bytes[position.value + 1] << 8) | bytes[position.value + 2] });
        position.value += length;
      } else if (status === 0xf0 || status === 0xf7) position.value += variable(end, position);
      else {
        const kind = status & 0xf0;
        const first = bytes[position.value++];
        const second = kind === 0xc0 || kind === 0xd0 ? 0 : bytes[position.value++];
        if (kind === 0x90 && second > 0 && first <= 127) notes.push(tick);
      }
      if (position.value > end) throw new Error("Truncated MIDI event");
    }
    offset = end;
  }
  tempos.sort((a, b) => a.tick - b.tick);
  return [...new Set(notes)].sort((a, b) => a - b).map((tick) => {
    let micros = 0; let from = 0; let tempo = 500000;
    for (const event of tempos) { if (event.tick > tick) break; micros += (event.tick - from) * tempo / division; from = event.tick; tempo = event.tempo; }
    return Math.round((micros + (tick - from) * tempo / division) / 1000);
  });
}
