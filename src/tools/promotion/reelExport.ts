import type { AdOverlaySettings } from "./AdOverlayEditor";
import type { EditTiming } from "./shortAdEditPlan";
import type { CreativeStudioProject, StudioTransition, StudioVisualClip } from "./creativeStudioProject";
import type { ReusableAdCreative } from "./api";
import { studioPropertyValue, studioTransformAt } from "./creativeStudioKeyframes";
import { studioRenderPlan, type StudioRenderItem } from "./studioRenderPlan";

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

type LoadedItem = { item: StudioRenderItem; element?: HTMLVideoElement | HTMLImageElement | HTMLAudioElement; gain?: GainNode; playing?: boolean };
const within = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function transitionAlpha(clip: StudioVisualClip, frame: number) {
  let alpha = 1;
  for (const [transition, position] of [[clip.transitionIn, frame], [clip.transitionOut, clip.durationFrames - frame - 1]] as [StudioTransition | undefined, number][]) {
    if (transition && (transition.kind === "fade" || transition.kind === "dissolve" || transition.kind === "dip") && transition.durationFrames && position < transition.durationFrames)
      alpha *= within(position / transition.durationFrames, 0, 1);
  }
  return alpha;
}

function paintStudio(ctx: CanvasRenderingContext2D, tracks: LoadedItem[][], frame: number, background: string) {
  const { width, height } = ctx.canvas;
  ctx.fillStyle = background; ctx.fillRect(0, 0, width, height);
  for (const track of tracks) for (const { item, element } of track) {
    if (item.kind === "audio") continue;
    const clip = item.clip;
    if (frame < clip.startFrame || frame >= clip.startFrame + clip.durationFrames) continue;
    const local = frame - clip.startFrame;
    const transform = studioTransformAt(clip, local)!;
    ctx.save();
    ctx.globalAlpha = transform.opacity * (item.kind === "visual" ? transitionAlpha(item.clip, local) : 1);
    if (item.kind === "visual" && element) {
      const visual = item.clip;
      const transition = local < (visual.transitionIn?.durationFrames || 0) ? visual.transitionIn :
        visual.durationFrames - local <= (visual.transitionOut?.durationFrames || 0) ? visual.transitionOut : undefined;
      if (transition?.kind.startsWith("wipe-")) {
        const progress = transition === visual.transitionIn ? local / transition.durationFrames : (visual.durationFrames - local - 1) / transition.durationFrames;
        const p = within(progress, 0, 1);
        const direction = transition.kind;
        ctx.beginPath();
        if (direction === "wipe-left") ctx.rect(0, 0, width * p, height);
        else if (direction === "wipe-right") ctx.rect(width * (1 - p), 0, width * p, height);
        else if (direction === "wipe-up") ctx.rect(0, height * (1 - p), width, height * p);
        else ctx.rect(0, 0, width, height * p);
        ctx.clip();
      }
      const source = element as HTMLVideoElement | HTMLImageElement;
      const sw = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
      const sh = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
      const fit = transform.fit || "cover";
      const sx = fit === "fill" ? width / sw : (fit === "contain" ? Math.min : Math.max)(width / sw, height / sh);
      const sy = fit === "fill" ? height / sh : sx;
      const drawWidth = sw * sx, drawHeight = sh * sy;
      const anchorX = transform.anchorX ?? .5, anchorY = transform.anchorY ?? .5;
      ctx.translate(transform.x * width, transform.y * height);
      ctx.rotate(transform.rotationDegrees * Math.PI / 180); ctx.scale(transform.scale, transform.scale);
      const color = visual.color;
      if (color) ctx.filter = `brightness(${color.brightness}%) contrast(${color.contrast}%) saturate(${color.saturation}%) sepia(${Math.abs(color.temperature) * .0035}) hue-rotate(${color.temperature < 0 ? 210 : 30}deg) hue-rotate(${color.tint * .12}deg)`;
      ctx.drawImage(source, -drawWidth * anchorX, -drawHeight * anchorY, drawWidth, drawHeight);
      ctx.filter = "none";
      if (transition?.kind === "dip") { ctx.globalAlpha = 1 - transitionAlpha(visual, local); ctx.fillStyle = background; ctx.fillRect(-width, -height, width * 2, height * 2); }
    } else if (item.kind === "text") {
      const textClip = item.clip;
      ctx.translate(transform.x * width, transform.y * height);
      ctx.rotate(transform.rotationDegrees * Math.PI / 180); ctx.scale(transform.scale, transform.scale);
      ctx.fillStyle = textClip.style.color; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = `${textClip.style.fontWeight || 500} ${textClip.style.fontSize * width / 1080}px ${textClip.style.fontFamily || "system-ui, sans-serif"}`;
      ctx.shadowColor = "rgba(0,0,0,.8)"; ctx.shadowBlur = 8;
      textClip.text.split("\n").forEach((line, index) => ctx.fillText(line, 0, index * textClip.style.fontSize * width / 1080 * 1.2, width * .9));
    }
    ctx.restore();
  }
}

/** Browser export for a saved 9:16 Studio revision. The project and its source IDs own this render. */
export async function exportStudioReel(project: CreativeStudioProject, creative: Pick<ReusableAdCreative, "audioSnippets" | "backgroundMedia" | "overlays">, urls: Record<string, string>) {
  const format = reelExportFormat();
  if (!format || format.extension !== "mp4") throw new Error("Creative Studio export requires browser H.264/AAC MP4 recording support.");
  if (project.render.width * REEL_EXPORT.height !== project.render.height * REEL_EXPORT.width) throw new Error("Creative Studio reel export supports the 9:16 layout only.");
  const fps = project.timebase.framesPerSecond.numerator / project.timebase.framesPerSecond.denominator;
  const duration = project.durationFrames / fps;
  const plan = studioRenderPlan(project, creative, urls);
  const canvas = document.createElement("canvas"); canvas.width = REEL_EXPORT.width; canvas.height = REEL_EXPORT.height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas recording is unavailable.");
  const audio = new AudioContext();
  const destination = audio.createMediaStreamDestination();
  const loaded: LoadedItem[][] = [];
  let recorder: MediaRecorder | undefined;
  let stream: MediaStream | undefined;
  let animation = 0;
  try {
    for (const track of plan) {
      const loadedTrack: LoadedItem[] = [];
      for (const item of track.items) {
        const entry: LoadedItem = { item };
        if (item.kind === "visual" && item.mediaType === "image") {
          const image = new Image(); image.crossOrigin = "anonymous"; image.src = item.url;
          await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error(`Visual clip ${item.clip.id}: image could not be loaded.`)); });
          entry.element = image;
        } else if (item.kind !== "text") {
          const media = document.createElement(item.kind === "audio" ? "audio" : "video");
          media.crossOrigin = "anonymous"; media.preload = "auto"; media.src = item.url;
          if (item.kind === "visual") media.muted = true;
          await new Promise<void>((resolve, reject) => { media.onloadedmetadata = () => resolve(); media.onerror = () => reject(new Error(`${item.kind} clip ${item.clip.id}: source could not be loaded.`)); });
          if (item.kind === "visual") {
            const video = media as HTMLVideoElement;
            if (item.clip.sourceOutSeconds > video.duration + .05) throw new Error(`Visual clip ${item.clip.id}: trim exceeds video duration.`);
            video.playbackRate = item.clip.speed || 1;
            if (item.clip.sourceInSeconds > 0) {
              video.currentTime = item.clip.sourceInSeconds;
              await new Promise<void>((resolve, reject) => { video.onseeked = () => resolve(); video.onerror = () => reject(new Error(`Visual clip ${item.clip.id}: source trim could not be decoded.`)); });
            } else if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
              await new Promise<void>((resolve, reject) => { video.onloadeddata = () => resolve(); video.onerror = () => reject(new Error(`Visual clip ${item.clip.id}: first frame could not be decoded.`)); });
            }
          } else {
            const audioElement = media as HTMLAudioElement;
            if (item.sourceStart + item.clip.sourceOutSeconds - item.clip.sourceInSeconds > audioElement.duration + .05) throw new Error(`Audio clip ${item.clip.id}: trim exceeds audio duration.`);
            const source = audio.createMediaElementSource(audioElement);
            const gain = audio.createGain(); source.connect(gain).connect(destination); entry.gain = gain;
          }
          entry.element = media;
        }
        loadedTrack.push(entry);
      }
      loaded.push(loadedTrack);
    }
    for (const track of loaded) for (const entry of track) {
      if (entry.item.kind !== "visual" || !entry.element) continue;
      try { ctx.drawImage(entry.element as CanvasImageSource, 0, 0, 1, 1); ctx.getImageData(0, 0, 1, 1); }
      catch { throw new Error(`Visual clip ${entry.item.clip.id}: source blocks browser canvas export. Check media CORS settings.`); }
    }
    paintStudio(ctx, loaded, 0, project.render.backgroundColor);
    stream = canvas.captureStream(REEL_EXPORT.frameRate);
    for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
    recorder = new MediaRecorder(stream, { mimeType: format.mimeType, videoBitsPerSecond: REEL_EXPORT.videoBitsPerSecond, audioBitsPerSecond: REEL_EXPORT.audioBitsPerSecond });
    const chunks: Blob[] = [];
    const recording = new Promise<Blob>((resolve, reject) => {
      recorder!.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder!.onerror = () => reject(new Error("Creative Studio recording failed."));
      recorder!.onstop = () => { const blob = new Blob(chunks, { type: format.mimeType }); if (blob.size > 1024) resolve(blob); else reject(new Error("Creative Studio produced an empty reel.")); };
    });
    await audio.resume(); recorder.start(1000);
    const start = performance.now();
    await new Promise<void>((resolve, reject) => {
      const tick = () => {
        const seconds = (performance.now() - start) / 1000;
        const frame = Math.min(project.durationFrames - 1, Math.floor(seconds * fps));
        for (const track of loaded) for (const entry of track) {
          const item = entry.item;
          if (item.kind === "text" || (item.kind === "visual" && item.mediaType === "image")) continue;
          const clip = item.clip;
          const local = seconds - clip.startFrame / fps;
          const active = local >= 0 && local < clip.durationFrames / fps;
          const media = entry.element as HTMLMediaElement;
          if (!active) { if (entry.playing) { media.pause(); entry.playing = false; } continue; }
          const expected = item.kind === "audio" ? item.sourceStart + local : item.clip.sourceInSeconds + local * (item.clip.speed || 1);
          if (!entry.playing) { media.currentTime = expected; void media.play().catch(() => reject(new Error(`${item.kind} clip ${clip.id}: playback failed.`))); entry.playing = true; }
          else if (Math.abs(media.currentTime - expected) > .25) media.currentTime = expected;
          if (item.kind === "audio") {
            const audioClip = item.clip;
            const fadeIn = audioClip.audioFadeInSeconds || 0, fadeOut = audioClip.audioFadeOutSeconds || 0;
            const envelope = Math.min(fadeIn ? local / fadeIn : 1, fadeOut ? (clip.durationFrames / fps - local) / fadeOut : 1);
            entry.gain!.gain.value = audioClip.muted ? 0 : within(studioPropertyValue(audioClip, "volume", frame - clip.startFrame) * envelope, 0, 1);
          }
        }
        paintStudio(ctx, loaded, frame, project.render.backgroundColor);
        if (seconds >= duration) resolve(); else animation = requestAnimationFrame(tick);
      };
      tick();
    });
    recorder.stop();
    return { blob: await recording, mimeType: format.mimeType, extension: format.extension };
  } finally {
    cancelAnimationFrame(animation);
    for (const track of loaded) for (const entry of track) if (entry.element instanceof HTMLMediaElement) { entry.element.pause(); entry.element.removeAttribute("src"); entry.element.load(); }
    if (recorder?.state === "recording") recorder.stop();
    stream?.getTracks().forEach(track => track.stop());
    await audio.close();
  }
}
