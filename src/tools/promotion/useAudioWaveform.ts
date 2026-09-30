import { useEffect, useState } from "react";

/** Shared waveform decoding for the Ads snippet picker and Creative Studio timeline. */
export default function useAudioWaveform(audioUrl: string) {
  const [peaks, setPeaks] = useState<number[]>([]);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!audioUrl) { setPeaks([]); setDuration(0); setLoading(false); return; }
    setLoading(true);
    void (async () => {
      let context: AudioContext | undefined;
      try {
        const response = await fetch(audioUrl);
        if (!response.ok) throw new Error("Audio waveform could not be loaded");
        const buffer = await response.arrayBuffer();
        const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextClass) throw new Error("Audio decoding is unavailable");
        context = new AudioContextClass();
        const decoded = await context.decodeAudioData(buffer.slice(0));
        const samples = decoded.getChannelData(0);
        const bucketCount = 420;
        const bucketSize = Math.max(1, Math.floor(samples.length / bucketCount));
        const next = Array.from({ length: bucketCount }, (_, index) => {
          let peak = 0;
          const end = Math.min(samples.length, (index + 1) * bucketSize);
          for (let sample = index * bucketSize; sample < end; sample++) peak = Math.max(peak, Math.abs(samples[sample] || 0));
          return peak;
        });
        if (!cancelled) { setPeaks(next); setDuration(decoded.duration || 0); }
      } catch {
        if (!cancelled) { setPeaks([]); setDuration(0); }
      } finally {
        await context?.close().catch(() => undefined);
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [audioUrl]);
  return { peaks, duration, loading };
}
