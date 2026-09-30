import type { AdOverlaySettings } from "./AdOverlayEditor";
import type { EditTiming } from "./shortAdEditPlan";

export const REEL_EXPORT = { width: 720, height: 1280, frameRate: 30, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 192_000 } as const;

export function reelExportFormat() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const [mimeType, extension] of [
    ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "mp4"],
    ["video/webm;codecs=vp9,opus", "webm"],
    ["video/webm;codecs=vp8,opus", "webm"],
  ] as const) if (MediaRecorder.isTypeSupported(mimeType)) return { mimeType, extension };
  return null;
}

function drawText(ctx: CanvasRenderingContext2D, text: string, y: number, size: number, weight: number) {
  if (!text) return y;
  ctx.font = `${weight} ${size}px system-ui, sans-serif`;
  const maxWidth = REEL_EXPORT.width * .78;
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  for (const value of lines.slice(0, 4)) {
    ctx.fillText(value, REEL_EXPORT.width / 2, y, maxWidth);
    y += size * 1.25;
  }
  return y;
}

function paint(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, overlay: AdOverlaySettings, cuts: EditTiming[], seconds: number) {
  const { width, height } = REEL_EXPORT;
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, width, height);
  const scale = Math.max(width / video.videoWidth, height / video.videoHeight);
  const w = video.videoWidth * scale, h = video.videoHeight * scale;
  ctx.drawImage(video, (width - w) / 2, (height - h) / 2, w, h);
  // Brief black dip marks a cut without changing the selected recording's timing.
  const fade = cuts.reduce((value, cut) => {
    const half = Math.min(.5, Math.max(0, cut.transitionSeconds)) / 2;
    return half && Math.abs(seconds - cut.cutSeconds) < half ? Math.max(value, 1 - Math.abs(seconds - cut.cutSeconds) / half) : value;
  }, 0);
  if (fade) { ctx.fillStyle = `rgba(0,0,0,${fade})`; ctx.fillRect(0, 0, width, height); }
  if (!overlay.headline && !overlay.caption && !overlay.cta) return;
  const y = overlay.position === "top" ? height * .2 : overlay.position === "center" ? height * .46 : height * .67;
  ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillStyle = "#fff";
  ctx.shadowColor = "rgba(0,0,0,.9)"; ctx.shadowBlur = 12;
  let next = drawText(ctx, overlay.headline, y, 52, 700);
  next = drawText(ctx, overlay.caption, next + 12, 32, 500);
  if (overlay.cta) {
    ctx.shadowBlur = 0; ctx.font = "700 30px system-ui, sans-serif";
    const buttonWidth = Math.min(width * .78, ctx.measureText(overlay.cta).width + 72);
    ctx.fillStyle = "#fff"; ctx.fillRect((width - buttonWidth) / 2, next + 24, buttonWidth, 64);
    ctx.fillStyle = "#171717"; ctx.fillText(overlay.cta, width / 2, next + 40, buttonWidth - 24);
  }
  ctx.shadowBlur = 0;
}

/** Records the already rendered 9:16 source in real time; errors are surfaced to the caller. */
export async function exportReel(url: string, overlay: AdOverlaySettings, cuts: EditTiming[], expectedSeconds: number): Promise<{ blob: Blob; mimeType: string; extension: string }> {
  const format = reelExportFormat();
  if (!format) throw new Error("This browser cannot record H.264 MP4 or WebM with audio. Use a browser with MediaRecorder support.");
  if (!Number.isFinite(expectedSeconds) || expectedSeconds < 1 || expectedSeconds > 60) throw new Error("The rendered creative has an invalid duration.");
  const video = document.createElement("video"); video.crossOrigin = "anonymous"; video.preload = "auto"; video.src = url; video.playsInline = true;
  const canvas = document.createElement("canvas"); canvas.width = REEL_EXPORT.width; canvas.height = REEL_EXPORT.height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas recording is unavailable.");
  const audio = new AudioContext();
  let recorder: MediaRecorder | undefined;
  let animation = 0;
  let timeout = 0;
  let stream: MediaStream | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("The rendered video could not be loaded for export. Check media access and try again."));
    });
    if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration) || Math.abs(video.duration - expectedSeconds) > 2) throw new Error("Rendered video dimensions or duration do not match the creative. Export stopped.");
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("The rendered video could not be decoded for export."));
    });
    const source = audio.createMediaElementSource(video);
    const destination = audio.createMediaStreamDestination(); source.connect(destination);
    stream = canvas.captureStream(REEL_EXPORT.frameRate);
    for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
    recorder = new MediaRecorder(stream, { mimeType: format.mimeType, videoBitsPerSecond: REEL_EXPORT.videoBitsPerSecond, audioBitsPerSecond: REEL_EXPORT.audioBitsPerSecond });
    const chunks: Blob[] = [];
    const recording = new Promise<Blob>((resolve, reject) => {
      recorder!.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder!.onerror = () => reject(new Error("The browser recorder failed while exporting the reel."));
      recorder!.onstop = () => { const blob = new Blob(chunks, { type: recorder!.mimeType }); if (blob.size > 1024) resolve(blob); else reject(new Error("The browser produced an empty reel.")); };
    });
    const started = performance.now();
    const frame = () => {
      paint(ctx, video, overlay, cuts, video.currentTime);
      if (!video.ended && recorder?.state === "recording") animation = requestAnimationFrame(frame);
    };
    paint(ctx, video, overlay, cuts, 0);
    // A signed video URL without canvas CORS would otherwise yield an unusable recording.
    try { ctx.getImageData(0, 0, 1, 1); } catch { throw new Error("This rendered video does not allow browser export. Check media CORS settings and try again."); }
    await audio.resume(); recorder.start(1000);
    await video.play(); frame();
    const finished = new Promise<void>((resolve, reject) => {
      video.onended = () => resolve();
      video.onerror = () => reject(new Error("Video decoding failed during export."));
      timeout = window.setTimeout(() => reject(new Error("Reel export timed out.")), (expectedSeconds + 10) * 1000);
    });
    await finished;
    if (performance.now() - started < (expectedSeconds - 1) * 1000) throw new Error("The recorder ended before the video finished.");
    recorder.stop(); const blob = await recording;
    return { blob, mimeType: recorder.mimeType, extension: format.extension };
  } finally {
    window.clearTimeout(timeout); cancelAnimationFrame(animation); video.pause(); video.removeAttribute("src"); video.load();
    if (recorder?.state === "recording") recorder.stop();
    stream?.getTracks().forEach(track => track.stop()); await audio.close();
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
