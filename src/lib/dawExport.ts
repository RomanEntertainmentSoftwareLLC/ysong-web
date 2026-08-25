export type DawExportNote = {
  pitch: number;
  startBars: number;
  lengthBars: number;
  velocity: number;
};

export type DawExportAutomationPoint = {
  atBars: number;
  value: number;
};

export type DawExportMidiTrack = {
  name: string;
  program?: number;
  notes: DawExportNote[];
  pitchBend?: DawExportAutomationPoint[];
  modulation?: DawExportAutomationPoint[];
};

export type DawMidiBuildOptions = {
  bpm: number;
  sigNum: number;
  sigDen: number;
  endBar: number;
  tracks: DawExportMidiTrack[];
};

const PPQ = 480;
const MELODIC_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15] as const;

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function asciiBytes(text: string) {
  return new TextEncoder().encode(text);
}

function pushU16BE(out: number[], value: number) {
  out.push((value >>> 8) & 0xff, value & 0xff);
}

function pushU32BE(out: number[], value: number) {
  out.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

function variableLength(valueRaw: number) {
  let value = Math.max(0, Math.floor(valueRaw));
  let buffer = value & 0x7f;
  const bytes: number[] = [];
  while ((value >>= 7) > 0) {
    buffer <<= 8;
    buffer |= (value & 0x7f) | 0x80;
  }
  while (true) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) buffer >>= 8;
    else break;
  }
  return bytes;
}

type MidiEvent = { tick: number; order: number; bytes: number[] };

function buildTrackChunk(events: MidiEvent[]) {
  const body: number[] = [];
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  let previousTick = 0;
  for (const event of events) {
    body.push(...variableLength(Math.max(0, event.tick - previousTick)), ...event.bytes);
    previousTick = event.tick;
  }
  body.push(0x00, 0xff, 0x2f, 0x00);
  const chunk: number[] = [...asciiBytes("MTrk")];
  pushU32BE(chunk, body.length);
  chunk.push(...body);
  return chunk;
}

function ticksPerBar(sigNum: number, sigDen: number) {
  return PPQ * Math.max(1, sigNum) * (4 / Math.max(1, sigDen));
}

function barPositionToTick(barPosition: number, sigNum: number, sigDen: number) {
  return Math.max(0, Math.round(barPosition * ticksPerBar(sigNum, sigDen)));
}

/**
 * Build a standards-compliant Type-1 Standard MIDI File from YSong's structured
 * MIDI clips. Audio tracks are intentionally absent. VST tracks export the MIDI
 * performance only; the plugin sound itself is not embedded in .mid.
 */
export function buildStandardMidiFile(options: DawMidiBuildOptions) {
  const bpm = Math.max(1, Number(options.bpm) || 120);
  const sigNum = clampInt(options.sigNum || 4, 1, 32);
  const sigDen = Math.max(1, options.sigDen || 4);
  const maxBarPosition = Math.max(0, options.endBar - 1);

  const tempoEvents: MidiEvent[] = [];
  const tempoUs = clampInt(60_000_000 / bpm, 1, 0xffffff);
  tempoEvents.push({ tick: 0, order: 0, bytes: [0xff, 0x51, 0x03, (tempoUs >>> 16) & 0xff, (tempoUs >>> 8) & 0xff, tempoUs & 0xff] });
  const denominatorPower = clampInt(Math.log2(sigDen), 0, 7);
  tempoEvents.push({ tick: 0, order: 1, bytes: [0xff, 0x58, 0x04, sigNum & 0xff, denominatorPower & 0xff, 24, 8] });
  const sequenceName = asciiBytes("YSong Export");
  tempoEvents.push({ tick: 0, order: 2, bytes: [0xff, 0x03, ...variableLength(sequenceName.length), ...sequenceName] });

  const chunks: number[][] = [buildTrackChunk(tempoEvents)];

  options.tracks.forEach((track, index) => {
    const channel = MELODIC_CHANNELS[index % MELODIC_CHANNELS.length];
    const port = Math.floor(index / MELODIC_CHANNELS.length);
    const events: MidiEvent[] = [];
    const nameBytes = asciiBytes(track.name || `Instrument ${index + 1}`);
    events.push({ tick: 0, order: 0, bytes: [0xff, 0x03, ...variableLength(nameBytes.length), ...nameBytes] });
    if (port > 0) events.push({ tick: 0, order: 1, bytes: [0xff, 0x21, 0x01, port & 0x7f] });
    if (track.program != null) events.push({ tick: 0, order: 2, bytes: [0xc0 | channel, clampInt(track.program, 0, 127)] });

    for (const note of track.notes) {
      const startBars = Math.max(0, note.startBars);
      if (startBars >= maxBarPosition) continue;
      const endBars = Math.min(maxBarPosition, startBars + Math.max(1 / 128, note.lengthBars));
      if (endBars <= startBars) continue;
      const startTick = barPositionToTick(startBars, sigNum, sigDen);
      const endTick = Math.max(startTick + 1, barPositionToTick(endBars, sigNum, sigDen));
      const pitch = clampInt(note.pitch, 0, 127);
      const velocity = clampInt(note.velocity, 1, 127);
      events.push({ tick: startTick, order: 20, bytes: [0x90 | channel, pitch, velocity] });
      // Note-offs sort before note-ons at the same tick so repeated notes retrigger cleanly.
      events.push({ tick: endTick, order: 10, bytes: [0x80 | channel, pitch, 0] });
    }

    for (const point of track.modulation ?? []) {
      const atBars = Math.max(0, point.atBars);
      if (atBars > maxBarPosition) continue;
      events.push({
        tick: barPositionToTick(atBars, sigNum, sigDen),
        order: 5,
        bytes: [0xb0 | channel, 1, clampInt(point.value, 0, 127)],
      });
    }

    for (const point of track.pitchBend ?? []) {
      const atBars = Math.max(0, point.atBars);
      if (atBars > maxBarPosition) continue;
      // YSong stores pitch automation in semitones. The editor's default bend range is
      // 12 semitones, so map the visible value into the standard 14-bit MIDI wheel.
      const normalized = Math.max(-1, Math.min(1, Number(point.value || 0) / 12));
      const bend = clampInt(8192 + normalized * 8191, 0, 16383);
      events.push({
        tick: barPositionToTick(atBars, sigNum, sigDen),
        order: 5,
        bytes: [0xe0 | channel, bend & 0x7f, (bend >>> 7) & 0x7f],
      });
    }

    chunks.push(buildTrackChunk(events));
  });

  const header: number[] = [...asciiBytes("MThd")];
  pushU32BE(header, 6);
  pushU16BE(header, 1);
  pushU16BE(header, chunks.length);
  pushU16BE(header, PPQ);

  const flat = [...header, ...chunks.flat()];
  return new Uint8Array(flat);
}

export function encodeStereoWav(left: Float32Array, right: Float32Array, sampleRate: number, bitDepth: 16 | 24 | 32) {
  const frames = Math.min(left.length, right.length);
  const bytesPerSample = bitDepth / 8;
  const dataBytes = frames * 2 * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  let offset = 0;
  const writeAscii = (text: string) => { for (let i = 0; i < text.length; i++) view.setUint8(offset++, text.charCodeAt(i)); };
  writeAscii("RIFF"); view.setUint32(offset, 36 + dataBytes, true); offset += 4;
  writeAscii("WAVE"); writeAscii("fmt "); view.setUint32(offset, 16, true); offset += 4;
  view.setUint16(offset, bitDepth === 32 ? 3 : 1, true); offset += 2;
  view.setUint16(offset, 2, true); offset += 2;
  view.setUint32(offset, sampleRate, true); offset += 4;
  view.setUint32(offset, sampleRate * 2 * bytesPerSample, true); offset += 4;
  view.setUint16(offset, 2 * bytesPerSample, true); offset += 2;
  view.setUint16(offset, bitDepth, true); offset += 2;
  writeAscii("data"); view.setUint32(offset, dataBytes, true); offset += 4;

  for (let i = 0; i < frames; i++) {
    const samples = [Math.max(-1, Math.min(1, left[i])), Math.max(-1, Math.min(1, right[i]))];
    for (const sample of samples) {
      if (bitDepth === 16) {
        const value = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
        view.setInt16(offset, value, true); offset += 2;
      } else if (bitDepth === 24) {
        const value = sample < 0 ? Math.round(sample * 8388608) : Math.round(sample * 8388607);
        view.setUint8(offset++, value & 0xff);
        view.setUint8(offset++, (value >>> 8) & 0xff);
        view.setUint8(offset++, (value >>> 16) & 0xff);
      } else {
        view.setFloat32(offset, sample, true); offset += 4;
      }
    }
  }
  return new Uint8Array(buffer);
}

export function decodeStereoFloatWav(data: ArrayBuffer) {
  const view = new DataView(data);
  if (data.byteLength < 44 || String.fromCharCode(...new Uint8Array(data, 0, 4)) !== "RIFF") throw new Error("Bridge returned an invalid WAV render.");
  let channels = 0;
  let sampleRate = 0;
  let format = 0;
  let bits = 0;
  let dataOffset = -1;
  let dataSize = 0;
  let pos = 12;
  while (pos + 8 <= data.byteLength) {
    const id = String.fromCharCode(...new Uint8Array(data, pos, 4));
    const size = view.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === "fmt " && size >= 16) {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
    } else if (id === "data") {
      dataOffset = body;
      dataSize = Math.min(size, data.byteLength - body);
      break;
    }
    pos = body + size + (size & 1);
  }
  if (format !== 3 || channels !== 2 || bits !== 32 || dataOffset < 0) throw new Error("Bridge VST render is not stereo 32-bit float WAV.");
  const frames = Math.floor(dataSize / 8);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  let p = dataOffset;
  for (let i = 0; i < frames; i++) {
    left[i] = view.getFloat32(p, true); p += 4;
    right[i] = view.getFloat32(p, true); p += 4;
  }
  return { left, right, sampleRate };
}

export function safeExportFileName(projectName: string) {
  const cleaned = projectName.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/[. ]+$/g, "");
  return cleaned || "YSong Export";
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
