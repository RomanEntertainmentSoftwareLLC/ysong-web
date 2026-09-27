// Lightweight proposal audition. This never inserts notes into the DAW project.
export function auditionMidiNotes(notes: Array<{ pitch: number; startBars: number; lengthBars: number; velocity: number }>, bpm: number, sigNum: number, sigDen: number): () => void {
  const context = new AudioContext();
  const voices: OscillatorNode[] = [];
  const barSeconds = 60 / Math.max(20, bpm) * sigNum * 4 / sigDen;
  const start = context.currentTime + 0.05;
  for (const note of notes.slice(0, 256)) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const at = start + Math.max(0, note.startBars) * barSeconds;
    const end = at + Math.max(0.04, note.lengthBars * barSeconds);
    oscillator.type = 'triangle';
    oscillator.frequency.value = 440 * 2 ** ((note.pitch - 69) / 12);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(Math.min(0.12, note.velocity / 127 * 0.12), at + 0.01);
    gain.gain.setValueAtTime(Math.min(0.12, note.velocity / 127 * 0.12), Math.max(at + 0.01, end - 0.03));
    gain.gain.linearRampToValueAtTime(0, end);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(end + 0.01);
    voices.push(oscillator);
  }
  return () => { for (const voice of voices) { try { voice.stop(); } catch { /* already ended */ } } void context.close(); };
}
