/** Ads Creative Studio edit data belongs to a reusable creative, not a campaign render. */
export type StudioTimebase = { framesPerSecond: { numerator: number; denominator: number } };
export type StudioTransform = { x: number; y: number; scale: number; rotationDegrees: number; opacity: number };
export type StudioKeyframe = { frame: number; property: keyof StudioTransform | "volume"; value: number; interpolation: "hold" | "linear" };
export type StudioTransition = { kind: "cut" | "fade" | "dissolve"; durationFrames: number };
export type StudioClipBase = {
  id: string;
  startFrame: number;
  durationFrames: number;
  keyframes: StudioKeyframe[];
  transitionIn?: StudioTransition;
  transitionOut?: StudioTransition;
};
export type StudioVisualClip = StudioClipBase & {
  mediaId: string; // Resolves against ReusableAdCreative.backgroundMedia.
  sourceInSeconds: number; sourceOutSeconds: number;
  transform: StudioTransform;
};
export type StudioAudioClip = StudioClipBase & {
  snippetId: string; // Resolves against ReusableAdCreative.audioSnippets.
  sourceInSeconds: number; sourceOutSeconds: number;
  volume: number;
};
export type StudioTextClip = StudioClipBase & {
  text: string; transform: StudioTransform;
  style: { fontFamily?: string; fontSize: number; color: string; fontWeight?: number };
};
export type StudioTrack =
  | { id: string; kind: "visual"; clips: StudioVisualClip[] }
  | { id: string; kind: "audio"; clips: StudioAudioClip[] }
  | { id: string; kind: "text"; clips: StudioTextClip[] };

/** Arrays are ordered bottom-to-top for visuals/text and top-to-bottom for audio. */
export type CreativeStudioProject = {
  schemaVersion: 1;
  revision: number; // Server-assigned, monotonically increasing; 0 for a new project.
  durationFrames: number;
  timebase: StudioTimebase;
  tracks: StudioTrack[];
  render: {
    width: number; height: number; videoCodec: "h264";
    audioCodec: "aac"; backgroundColor: string;
  };
  edit: {
    createdAt: string; updatedAt: string; updatedBy?: string;
    source: "artist" | "template" | "generated" | "import";
    parentRevision?: number; summary?: string;
  };
};

export type StudioMediaRefs = { audioSnippetIds: readonly string[]; backgroundMediaIds: readonly string[] };

/** Validate untrusted persisted/API JSON before opening or saving an edit. Never repair it silently. */
export function validateCreativeStudioProject(value: unknown, refs: StudioMediaRefs): asserts value is CreativeStudioProject {
  const fail = (message: string): never => { throw new Error(`Invalid Ads Creative Studio project: ${message}`); };
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  const record = (v: unknown, path: string): Record<string, unknown> => object(v) ? v : fail(path);
  const array = (v: unknown, path: string): unknown[] => Array.isArray(v) ? v : fail(path);
  const number = (v: unknown, path: string, min: number, integer = false): number =>
    typeof v === "number" && Number.isFinite(v) && v >= min && (!integer || Number.isSafeInteger(v)) ? v : fail(path);
  const string = (v: unknown, path: string): string => typeof v === "string" && v.trim().length > 0 ? v : fail(path);
  const choice = (v: unknown, values: readonly string[], path: string) => values.includes(v as string) || fail(path);
  const project = record(value, "root");
  if (project.schemaVersion !== 1) fail("unsupported schemaVersion");
  number(project.revision, "revision", 0, true);
  const duration = number(project.durationFrames, "durationFrames", 1, true);
  const fps = record(record(project.timebase, "timebase").framesPerSecond, "framesPerSecond");
  number(fps.numerator, "fps numerator", 1, true);
  number(fps.denominator, "fps denominator", 1, true);
  if (Number(fps.numerator) / Number(fps.denominator) > 120) fail("fps above 120");
  if (duration * Number(fps.denominator) / Number(fps.numerator) > 60) fail("duration above 60 seconds");
  const render = record(project.render, "render");
  number(render.width, "render width", 1, true); number(render.height, "render height", 1, true);
  if (Number(render.width) > 4096 || Number(render.height) > 4096) fail("render dimensions");
  choice(render.videoCodec, ["h264"], "videoCodec"); choice(render.audioCodec, ["aac"], "audioCodec");
  string(render.backgroundColor, "backgroundColor");
  const edit = record(project.edit, "edit");
  for (const key of ["createdAt", "updatedAt"] as const) {
    if (typeof edit[key] !== "string" || !Number.isFinite(Date.parse(edit[key]))) fail(`edit.${key}`);
  }
  if (edit.updatedBy !== undefined) string(edit.updatedBy, "updatedBy");
  if (edit.summary !== undefined) string(edit.summary, "summary");
  if (edit.parentRevision !== undefined) number(edit.parentRevision, "parentRevision", 0, true);
  choice(edit.source, ["artist", "template", "generated", "import"], "edit.source");
  const tracks = array(project.tracks, "tracks");
  if (tracks.length > 12) fail("too many tracks");
  const ids = new Set<string>();
  const unique = (id: unknown, path: string) => { const name = string(id, path); if (ids.has(name)) fail(`duplicate ${path}`); ids.add(name); };
  const checkTransform = (v: unknown, path: string) => {
    const t = record(v, path);
    number(t.x, `${path}.x`, -Infinity); number(t.y, `${path}.y`, -Infinity);
    number(t.scale, `${path}.scale`, 0); number(t.rotationDegrees, `${path}.rotationDegrees`, -Infinity);
    const opacity = number(t.opacity, `${path}.opacity`, 0); if (opacity > 1) fail(`${path}.opacity`);
  };
  for (const trackValue of tracks) {
    const track = record(trackValue, "track"); unique(track.id, "track.id");
    choice(track.kind, ["visual", "audio", "text"], "track.kind");
    const clips = array(track.clips, "track.clips");
    if (clips.length > 200) fail("too many clips");
    let previousStart = -1;
    for (const clipValue of clips) {
      const clip = record(clipValue, "clip"); unique(clip.id, "clip.id");
      const start = number(clip.startFrame, "clip.startFrame", 0, true);
      const length = number(clip.durationFrames, "clip.durationFrames", 1, true);
      if (start < previousStart || start + length > duration) fail("clip order or bounds");
      previousStart = start;
      for (const edge of ["transitionIn", "transitionOut"] as const) {
        if (clip[edge] === undefined) continue;
        const transition = record(clip[edge], edge);
        choice(transition.kind, ["cut", "fade", "dissolve"], `${edge}.kind`);
        const frames = number(transition.durationFrames, `${edge}.durationFrames`, 0, true);
        if (frames > length || (transition.kind === "cut" && frames !== 0)) fail(edge);
      }
      const transitionIn = object(clip.transitionIn) ? Number(clip.transitionIn.durationFrames) : 0;
      const transitionOut = object(clip.transitionOut) ? Number(clip.transitionOut.durationFrames) : 0;
      if (transitionIn + transitionOut > length) fail("transitions exceed clip");
      const keyframes = array(clip.keyframes, "clip.keyframes");
      if (keyframes.length > 200) fail("too many keyframes");
      const keyed = new Set<string>();
      for (const entry of keyframes) {
        const key = record(entry, "keyframe");
        if (number(key.frame, "keyframe.frame", 0, true) >= length) fail("keyframe.frame");
        choice(key.property, ["x", "y", "scale", "rotationDegrees", "opacity", "volume"], "keyframe.property");
        choice(key.interpolation, ["hold", "linear"], "keyframe.interpolation");
        number(key.value, "keyframe.value", -Infinity);
        if ((key.property === "opacity" || key.property === "volume") && (Number(key.value) < 0 || Number(key.value) > 1)) fail("keyframe.value");
        if (key.property === "scale" && Number(key.value) < 0) fail("keyframe.value");
        if ((track.kind === "audio") !== (key.property === "volume")) fail("keyframe.property incompatible with track");
        const coordinate = `${key.property}:${key.frame}`;
        if (keyed.has(coordinate)) fail("duplicate keyframe");
        keyed.add(coordinate);
      }
      if (track.kind === "text") {
        string(clip.text, "clip.text"); checkTransform(clip.transform, "clip.transform");
        const style = record(clip.style, "clip.style");
        number(style.fontSize, "fontSize", 1); string(style.color, "color");
        if (style.fontFamily !== undefined) string(style.fontFamily, "fontFamily");
        if (style.fontWeight !== undefined) number(style.fontWeight, "fontWeight", 1);
      } else {
        const idKey = track.kind === "audio" ? "snippetId" : "mediaId";
        const ref = string(clip[idKey], `clip.${idKey}`);
        if (!(track.kind === "audio" ? refs.audioSnippetIds : refs.backgroundMediaIds).includes(ref)) fail(`unknown ${idKey}`);
        const sourceIn = number(clip.sourceInSeconds, "sourceInSeconds", 0);
        if (number(clip.sourceOutSeconds, "sourceOutSeconds", 0) <= sourceIn) fail("source range");
        if (track.kind === "audio") { const volume = number(clip.volume, "volume", 0); if (volume > 1) fail("volume"); }
        else checkTransform(clip.transform, "clip.transform");
      }
    }
  }
}
