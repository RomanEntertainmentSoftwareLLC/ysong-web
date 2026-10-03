type DurationClip = {
  startBar: number;
  lengthBars: number;
  midiNotes?: Array<{ startBars: number; lengthBars: number }>;
  midiPitchBend?: Array<{ atBars: number }>;
  midiModulation?: Array<{ atBars: number }>;
};

/** Bar 1 is time zero; E is the exclusive end. Clip length owns audio edits,
 * including stretch/trim. MIDI notes and automation are clipped to that region.
 * Renderers can supply measured tail time instead of an invented fixed song length. */
export function projectEndBar(clips: DurationClip[], options: { maxBars?: number; tailBars?: number } = {}): number {
  let end = 1;
  for (const clip of clips) {
    if (!Number.isFinite(clip.startBar) || !Number.isFinite(clip.lengthBars) || clip.lengthBars <= 0) continue;
    const boundary = clip.startBar + clip.lengthBars;
    if (clip.midiNotes) {
      for (const note of clip.midiNotes) {
        if (Number.isFinite(note.startBars) && Number.isFinite(note.lengthBars) && note.lengthBars > 0 && note.startBars < clip.lengthBars)
          end = Math.max(end, Math.min(boundary, clip.startBar + note.startBars + note.lengthBars));
      }
      for (const point of [...(clip.midiPitchBend ?? []), ...(clip.midiModulation ?? [])]) {
        if (Number.isFinite(point.atBars) && point.atBars >= 0 && point.atBars <= clip.lengthBars)
          end = Math.max(end, clip.startBar + point.atBars);
      }
    } else end = Math.max(end, boundary);
  }
  const tail = options.tailBars ?? 0;
  return Math.min(options.maxBars ?? 512, Math.max(2, end + (Number.isFinite(tail) ? Math.max(0, tail) : 0)));
}
