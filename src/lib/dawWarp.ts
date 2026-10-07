export type WarpMarker = { sourceSec: number; atBar: number };

/** Internal markers are relative to the clip's source window and timeline start. */
export function normalizeWarpMarkers(markers: WarpMarker[] | undefined, sourceSec: number, lengthBars: number): WarpMarker[] {
  if (!Array.isArray(markers)) return [];
  const sorted = markers.filter((m) => Number.isFinite(m?.sourceSec) && Number.isFinite(m?.atBar))
    .sort((a, b) => a.sourceSec - b.sourceSec);
  const result: WarpMarker[] = [];
  for (const marker of sorted) {
    const previous = result[result.length - 1];
    if (marker.sourceSec <= (previous?.sourceSec ?? 0) + 0.001 || marker.sourceSec >= sourceSec - 0.001 ||
      marker.atBar <= (previous?.atBar ?? 0) + 0.001 || marker.atBar >= lengthBars - 0.001) continue;
    result.push({ sourceSec: marker.sourceSec, atBar: marker.atBar });
  }
  return result;
}

/** Detect prominent rises in short-window energy, spaced far enough apart to edit. */
export function detectWarpTransients(channels: Float32Array[], sampleRate: number, offsetSec: number, durationSec: number, maxMarkers = 64): number[] {
  if (!channels.length || !Number.isFinite(sampleRate) || sampleRate <= 0) return [];
  const hop = Math.max(1, Math.round(sampleRate * 0.01));
  const start = Math.max(0, Math.floor(offsetSec * sampleRate));
  const end = Math.min(channels[0].length, Math.floor((offsetSec + durationSec) * sampleRate));
  const energies: number[] = [];
  for (let frame = start; frame + hop < end; frame += hop) {
    let sum = 0;
    for (let i = frame; i < frame + hop; i += 4) for (const channel of channels) sum += Math.abs(channel[i] ?? 0);
    energies.push(sum / Math.max(1, channels.length * Math.ceil(hop / 4)));
  }
  const rises = energies.map((value, index) => Math.max(0, value - (energies[index - 1] ?? value)));
  const strongest = [...rises].sort((a, b) => b - a)[Math.min(rises.length - 1, Math.floor(rises.length * 0.15))] ?? 0;
  const candidates: Array<{ sec: number; strength: number }> = [];
  for (let i = 2; i < rises.length - 2; i++) {
    if (rises[i] > strongest * 0.3 && rises[i] >= rises[i - 1] && rises[i] > rises[i + 1])
      candidates.push({ sec: (i * hop) / sampleRate, strength: rises[i] });
  }
  const selected: typeof candidates = [];
  for (const candidate of candidates.sort((a, b) => b.strength - a.strength)) {
    if (candidate.sec > 0.04 && candidate.sec < durationSec - 0.04 && selected.every((other) => Math.abs(other.sec - candidate.sec) >= 0.08)) selected.push(candidate);
    if (selected.length >= maxMarkers) break;
  }
  return selected.sort((a, b) => a.sec - b.sec).map((candidate) => candidate.sec);
}
