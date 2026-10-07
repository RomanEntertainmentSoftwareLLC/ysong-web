type Stream = { currentTime: number; readyState: number };

// The original stream is the transport clock for every A/B mode.
export function syncABStreams(original: Stream, followers: Stream[], tolerance = 0.02): void {
  const clock = original.currentTime;
  if (!Number.isFinite(clock)) return;
  for (const stream of followers) {
    if (stream.readyState >= 2 && Math.abs(stream.currentTime - clock) > tolerance) stream.currentTime = clock;
  }
}
