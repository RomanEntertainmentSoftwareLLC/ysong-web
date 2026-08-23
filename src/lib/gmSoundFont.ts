import { normalizeGmProgram } from "./midi";

type SpessaSynth = {
  soundBankManager: { addSoundBank(data: ArrayBuffer, id: string): Promise<unknown> };
  isReady: Promise<unknown>;
  connect(destination: AudioNode): void;
  programChange(channel: number, program: number): void;
  noteOn(channel: number, note: number, velocity: number): void;
  noteOff(channel: number, note: number): void;
  destroy?: () => void;
};

const MELODIC_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15] as const;
const trackChannels = new Map<string, number>();
const activeNotes = new Map<string, number>();
const scheduledTimers = new Set<number>();
let nextChannelIndex = 0;
let synth: SpessaSynth | null = null;
let synthContext: AudioContext | null = null;
let initPromise: Promise<SpessaSynth> | null = null;
let workletLoadedForContext: AudioContext | null = null;

function channelForTrack(trackId: string) {
  const existing = trackChannels.get(trackId);
  if (existing != null) return existing;
  const channel = MELODIC_CHANNELS[nextChannelIndex % MELODIC_CHANNELS.length];
  nextChannelIndex += 1;
  trackChannels.set(trackId, channel);
  return channel;
}

function activeKey(channel: number, pitch: number) {
  return `${channel}:${pitch}`;
}

function velocityWithLevel(velocity: number, level: number, muted = false) {
  if (muted) return 0;
  const scaled = Math.round(Math.max(0, Math.min(127, velocity)) * Math.max(0, Math.min(127, level)) / 100);
  return Math.max(1, Math.min(127, scaled));
}

export async function prepareGmSoundFont(context: AudioContext): Promise<SpessaSynth> {
  if (synth && synthContext === context) return synth;
  if (initPromise && synthContext === context) return initPromise;

  if (synth && synthContext !== context) {
    try { synth.destroy?.(); } catch {}
    synth = null;
  }
  synthContext = context;

  initPromise = (async () => {
    if (workletLoadedForContext !== context) {
      await context.audioWorklet.addModule("/spessasynth_processor.min.js");
      workletLoadedForContext = context;
    }

    const modulePromise = import(
      // @ts-ignore -- v31 setup installs this package before the normal YSong build.
      "spessasynth_lib"
    );
    const [{ WorkletSynthesizer }, response] = await Promise.all([
      modulePromise,
      fetch("/soundfonts/GeneralUser-GS.sf2"),
    ]);
    if (!response.ok)
      throw new Error(`YSong General MIDI SoundFont is missing (HTTP ${response.status}). Run npm install in ysong-web/ysong to prepare GM assets.`);

    const bank = await response.arrayBuffer();

    // Use SpessaSynth's normal multi-output stereo layout. `oneOutput: true`
    // creates a single 34-channel worklet output, which is not the normal
    // stereo destination path YSong needs for bundled General MIDI playback.
    const next = new WorkletSynthesizer(context) as unknown as SpessaSynth;
    await next.soundBankManager.addSoundBank(bank, "GeneralUser-GS");
    await next.isReady;

    // A WorkletSynthesizer is not audible until its outputs are actually
    // connected into the WebAudio graph. This was the missing v31 GM hop.
    next.connect(context.destination);
    synth = next;
    return next;
  })();

  try {
    return await initPromise;
  } catch (error) {
    initPromise = null;
    throw error;
  }
}

export async function gmSoundFontNoteOn(
  context: AudioContext,
  trackId: string,
  program: number,
  pitch: number,
  velocity: number,
  level = 100,
  muted = false,
) {
  if (context.state !== "running") await context.resume();
  const engine = await prepareGmSoundFont(context);
  if (muted) return;
  const channel = channelForTrack(trackId);
  const note = Math.max(0, Math.min(127, Math.round(pitch)));
  const vel = velocityWithLevel(velocity, level, muted);
  engine.programChange(channel, normalizeGmProgram(program));
  engine.noteOn(channel, note, vel);
  const key = activeKey(channel, note);
  activeNotes.set(key, (activeNotes.get(key) ?? 0) + 1);
}

export async function gmSoundFontNoteOff(context: AudioContext, trackId: string, pitch: number) {
  const engine = await prepareGmSoundFont(context);
  const channel = channelForTrack(trackId);
  const note = Math.max(0, Math.min(127, Math.round(pitch)));
  engine.noteOff(channel, note);
  const key = activeKey(channel, note);
  const remaining = (activeNotes.get(key) ?? 1) - 1;
  if (remaining <= 0) activeNotes.delete(key);
  else activeNotes.set(key, remaining);
}

export function scheduleGmSoundFontNote(
  context: AudioContext,
  trackId: string,
  program: number,
  pitch: number,
  velocity: number,
  level: number,
  muted: boolean,
  startAtContextTime: number,
  durationSeconds: number,
) {
  const startDelayMs = Math.max(0, (startAtContextTime - context.currentTime) * 1000);
  const startTimer = window.setTimeout(() => {
    scheduledTimers.delete(startTimer);
    void gmSoundFontNoteOn(context, trackId, program, pitch, velocity, level, muted);
  }, startDelayMs);
  scheduledTimers.add(startTimer);

  const stopTimer = window.setTimeout(() => {
    scheduledTimers.delete(stopTimer);
    void gmSoundFontNoteOff(context, trackId, pitch);
  }, startDelayMs + Math.max(15, durationSeconds * 1000));
  scheduledTimers.add(stopTimer);
}

export function stopGmSoundFontPlayback() {
  for (const timer of scheduledTimers) window.clearTimeout(timer);
  scheduledTimers.clear();
  if (!synth) {
    activeNotes.clear();
    return;
  }
  for (const key of activeNotes.keys()) {
    const [channelRaw, pitchRaw] = key.split(":");
    const channel = Number(channelRaw);
    const pitch = Number(pitchRaw);
    if (Number.isFinite(channel) && Number.isFinite(pitch)) {
      try { synth.noteOff(channel, pitch); } catch {}
    }
  }
  activeNotes.clear();
}
