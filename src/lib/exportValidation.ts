export type ExportMeasurement = {
  rmsDbfs: number;
  samplePeakDbfs: number;
  truePeakDbtp: number;
  clippedSamples: number;
};

const db = (amplitude: number) => 20 * Math.log10(Math.max(1e-9, amplitude));
const sincWeights = [1, 2, 3].map(phase => Array.from({ length: 24 }, (_, index) => {
  const distance = phase / 4 - (index - 11);
  const sinc = Math.sin(Math.PI * distance) / (Math.PI * distance);
  const window = Math.abs(distance) < 12 ? 0.5 + 0.5 * Math.cos(Math.PI * distance / 12) : 0;
  return sinc * window;
}));

// Four-times oversampled, windowed-sinc reconstruction. The result is an offline
// estimate of the continuous waveform, measured before integer PCM quantization.
export function measureExport(left: Float32Array, right: Float32Array): ExportMeasurement {
  if (!left.length || left.length !== right.length) throw new Error("Export channels must have equal, nonzero length.");
  let energy = 0, samplePeak = 0, truePeak = 0, clippedSamples = 0;
  for (const channel of [left, right]) {
    for (let i = 0; i < channel.length; i++) {
      const value = channel[i];
      if (!Number.isFinite(value)) throw new Error("Export contains a non-finite audio sample.");
      energy += value * value;
      samplePeak = Math.max(samplePeak, Math.abs(value));
      if (Math.abs(value) >= 1) clippedSamples++;
      truePeak = Math.max(truePeak, Math.abs(value));
      for (const phaseWeights of sincWeights) {
        let reconstructed = 0, weights = 0;
        for (let tap = 0; tap < phaseWeights.length; tap++) {
          const index = i + tap - 11;
          if (index < 0 || index >= channel.length) continue;
          const weight = phaseWeights[tap];
          reconstructed += channel[index] * weight;
          weights += weight;
        }
        if (weights) truePeak = Math.max(truePeak, Math.abs(reconstructed / weights));
      }
    }
  }
  return { rmsDbfs: db(Math.sqrt(energy / (left.length * 2))), samplePeakDbfs: db(samplePeak), truePeakDbtp: db(truePeak), clippedSamples };
}

export function validateExportSettings(format: string, sampleRate: number): string | null {
  if (format === "midi") return null;
  if (![44100, 48000, 96000].includes(sampleRate)) return "Choose a supported sample rate.";
  if (!["wav16", "wav24", "flac", "mp3"].includes(format)) return "Choose a supported export format and bit depth.";
  if (format === "mp3" && sampleRate === 96000) return "MP3 supports 44.1 or 48 kHz here. Choose another sample rate.";
  return null;
}
