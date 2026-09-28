export type VocalPitchFrame = {
  timeSec: number;
  frequencyHz: number | null;
  confidence: number;
  rms: number;
};

export type VocalMidiNote = {
  pitch: number;
  startSeconds: number;
  durationSeconds: number;
  velocity: number;
};

export type VocalPitchBendPoint = { atSeconds: number; value: number };
export type VocalTranscription = { notes: VocalMidiNote[]; pitchBend: VocalPitchBendPoint[]; frames: VocalPitchFrame[] };

export type VocalTranscriptionOptions = {
  minFrequencyHz?: number;
  maxFrequencyHz?: number;
  silenceRms?: number;
  confidenceThreshold?: number;
  minimumNoteSeconds?: number;
  maximumGapSeconds?: number;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const hzToMidi = (frequency: number) => 69 + 12 * Math.log2(frequency / 440);

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function downsample(samples: Float32Array, sourceRate: number, targetRate = 8000) {
  if (sourceRate <= targetRate) return { samples, sampleRate: sourceRate };
  const ratio = sourceRate / targetRate;
  const output = new Float32Array(Math.floor(samples.length / ratio));
  for (let index = 0; index < output.length; index++) {
    const start = Math.floor(index * ratio);
    const end = Math.max(start + 1, Math.min(samples.length, Math.floor((index + 1) * ratio)));
    let sum = 0;
    for (let source = start; source < end; source++) sum += samples[source];
    output[index] = sum / (end - start);
  }
  return { samples: output, sampleRate: targetRate };
}

export function detectVocalPitchFrames(input: Float32Array, inputSampleRate: number, options: VocalTranscriptionOptions = {}): VocalPitchFrame[] {
  const minHz = options.minFrequencyHz ?? 70;
  const maxHz = options.maxFrequencyHz ?? 1000;
  const silenceRms = options.silenceRms ?? 0.012;
  const { samples, sampleRate } = downsample(input, inputSampleRate);
  const frameSize = 1024;
  const hopSize = Math.max(1, Math.round(sampleRate * 0.02));
  const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
  const maxLag = Math.min(frameSize - 2, Math.ceil(sampleRate / minHz));
  const frames: VocalPitchFrame[] = [];

  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    let mean = 0;
    for (let index = 0; index < frameSize; index++) mean += samples[start + index];
    mean /= frameSize;
    let energy = 0;
    for (let index = 0; index < frameSize; index++) {
      const value = samples[start + index] - mean;
      energy += value * value;
    }
    const rms = Math.sqrt(energy / frameSize);
    const timeSec = (start + frameSize / 2) / sampleRate;
    if (rms < silenceRms) {
      frames.push({ timeSec, frequencyHz: null, confidence: 0, rms });
      continue;
    }

    const difference = new Float64Array(maxLag + 1);
    for (let lag = 1; lag <= maxLag; lag++) {
      let sum = 0;
      for (let index = 0; index < frameSize - lag; index++) {
        const delta = (samples[start + index] - mean) - (samples[start + index + lag] - mean);
        sum += delta * delta;
      }
      difference[lag] = sum;
    }
    const normalized = new Float64Array(maxLag + 1);
    let running = 0;
    normalized[0] = 1;
    for (let lag = 1; lag <= maxLag; lag++) {
      running += difference[lag];
      normalized[lag] = running > 0 ? difference[lag] * lag / running : 1;
    }

    let bestLag = -1;
    for (let lag = minLag; lag <= maxLag; lag++) {
      if (normalized[lag] < 0.18) {
        while (lag + 1 <= maxLag && normalized[lag + 1] < normalized[lag]) lag++;
        bestLag = lag;
        break;
      }
    }
    if (bestLag < 0) {
      let best = 1;
      for (let lag = minLag; lag <= maxLag; lag++) if (normalized[lag] < best) { best = normalized[lag]; bestLag = lag; }
    }
    const confidence = bestLag > 0 ? clamp(1 - normalized[bestLag], 0, 1) : 0;
    let refinedLag = bestLag;
    if (bestLag > minLag && bestLag < maxLag) {
      const left = normalized[bestLag - 1], center = normalized[bestLag], right = normalized[bestLag + 1];
      const denominator = left - 2 * center + right;
      if (Math.abs(denominator) > 1e-9) refinedLag += 0.5 * (left - right) / denominator;
    }
    const frequencyHz = refinedLag > 0 && confidence >= (options.confidenceThreshold ?? 0.72) ? sampleRate / refinedLag : null;
    frames.push({ timeSec, frequencyHz, confidence, rms });
  }
  return frames;
}

export function pitchFramesToNotes(frames: VocalPitchFrame[], options: VocalTranscriptionOptions = {}): Pick<VocalTranscription, "notes" | "pitchBend"> {
  if (!frames.length) return { notes: [], pitchBend: [] };
  const hopSeconds = frames.length > 1 ? Math.max(0.001, median(frames.slice(1).map((frame, index) => frame.timeSec - frames[index].timeSec))) : 0.02;
  const minimumFrames = Math.max(2, Math.ceil((options.minimumNoteSeconds ?? 0.09) / hopSeconds));
  const gapFrames = Math.max(0, Math.round((options.maximumGapSeconds ?? 0.06) / hopSeconds));
  const midi = frames.map((frame) => frame.frequencyHz && frame.confidence >= (options.confidenceThreshold ?? 0.72) ? hzToMidi(frame.frequencyHz) : null);
  const smoothed = midi.map((value, index) => {
    if (value == null) return null;
    const neighbors = midi.slice(Math.max(0, index - 2), index + 3).filter((candidate): candidate is number => candidate != null);
    return neighbors.length >= 2 ? median(neighbors) : value;
  });
  const labels = smoothed.map((value) => value == null ? null : clamp(Math.round(value), 0, 127));

  // Fill only tiny unvoiced gaps surrounded by the same pitch.
  for (let index = 0; index < labels.length;) {
    if (labels[index] != null) { index++; continue; }
    const start = index;
    while (index < labels.length && labels[index] == null) index++;
    if (index - start <= gapFrames && start > 0 && index < labels.length && labels[start - 1] === labels[index]) {
      for (let fill = start; fill < index; fill++) labels[fill] = labels[start - 1];
    }
  }

  type Run = { start: number; end: number; pitch: number | null };
  const buildRuns = () => {
    const runs: Run[] = [];
    for (let index = 0; index < labels.length;) {
      const start = index, pitch = labels[index];
      while (index < labels.length && labels[index] === pitch) index++;
      runs.push({ start, end: index, pitch });
    }
    return runs;
  };

  // Natural vibrato and one-frame pitch mistakes should not become new notes.
  for (const run of buildRuns()) {
    if (run.pitch == null || run.end - run.start >= minimumFrames) continue;
    const before = run.start > 0 ? labels[run.start - 1] : null;
    const after = run.end < labels.length ? labels[run.end] : null;
    let replacement: number | null = null;
    if (before != null && before === after) replacement = before;
    else if (before != null && after != null) replacement = Math.abs(run.pitch - before) <= Math.abs(run.pitch - after) ? before : after;
    else replacement = before ?? after;
    for (let index = run.start; index < run.end; index++) labels[index] = replacement;
  }

  const notes: VocalMidiNote[] = [];
  const pitchBend: VocalPitchBendPoint[] = [];
  for (const run of buildRuns()) {
    if (run.pitch == null || run.end - run.start < minimumFrames) continue;
    const startSeconds = Math.max(0, frames[run.start].timeSec - hopSeconds / 2);
    const endSeconds = frames[Math.min(frames.length - 1, run.end - 1)].timeSec + hopSeconds / 2;
    const rmsValues = frames.slice(run.start, run.end).map((frame) => frame.rms);
    notes.push({
      pitch: run.pitch,
      startSeconds,
      durationSeconds: Math.max(hopSeconds, endSeconds - startSeconds),
      velocity: Math.round(clamp(58 + median(rmsValues) * 360, 48, 118)),
    });
    pitchBend.push({ atSeconds: startSeconds, value: 0 });
    for (let index = run.start; index < run.end; index += 4) {
      const value = smoothed[index];
      if (value != null) pitchBend.push({ atSeconds: frames[index].timeSec, value: clamp(value - run.pitch, -2, 2) });
    }
    pitchBend.push({ atSeconds: endSeconds, value: 0 });
  }
  return { notes, pitchBend };
}

export function transcribeMonophonicVocal(samples: Float32Array, sampleRate: number, options: VocalTranscriptionOptions = {}): VocalTranscription {
  const frames = detectVocalPitchFrames(samples, sampleRate, options);
  return { ...pitchFramesToNotes(frames, options), frames };
}
