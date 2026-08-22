// src/tabs/DAW.tsx
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import type { TabRendererProps } from "./core";
import { YSButton } from "../components/YSButton";
import MidiEditor, { type MidiEditableClip } from "../components/MidiEditor";
import TransportConsole from "../components/TransportConsole";
import OnScreenKeyboard from "../components/OnScreenKeyboard";
import { bridgeApi, type BridgeMidiEvent, type BridgeMidiInputDevice, type BridgePlugin, type Vst3MidiEvent } from "../lib/bridgeApi";
import {
	GM_PROGRAMS,
	gmPreviewProfile,
	interpolateAutomation,
	midiToFrequency,
	normalizeGmProgram,
	type BuiltinInstrument,
	type MidiAutomationPoint,
	type MidiNote,
	type MidiScaleLock,
	type MidiScaleRule,
} from "../lib/midi";

type TrackType = "audio" | "instrument";

type Track = {
	id: string;
	type: TrackType;
	name: string;
	mute: boolean;
	solo: boolean;
	arm: boolean;
	// MIDI-style fader scale. 100 = unity, 0 = silent, 127 = +~2 dB.
	level?: number;
	// Instrument tracks own the sound source; the MIDI clip owns the performance.
	// Legacy built-in synth id is retained so old local projects still load.
	instrument?: BuiltinInstrument;
	// General MIDI program number (0..127). This is the default instrument identity
	// until a YSong Instrument / SoundFont / Bridge-hosted VST overrides the renderer.
	gmProgram?: number;
	// When set, the native YSong Bridge owns this track's instrument renderer.
	vst3PluginPath?: string;
	vst3PluginName?: string;
	vst3PluginVendor?: string;
	// Optional per-track hardware MIDI filter. Undefined means every enabled input.
	midiInputName?: string;
};

type ProjectAsset = {
	id: string;
	kind: "audio";
	name: string;

	// Runtime playable URL (blob: for local imports, or signed URL for cloud)
	url?: string;

	// Local/server object key (preferred for persistence)
	objectKey?: string;
	// Original Asset Drawer upload when this is a project-owned copy.
	sourceObjectKey?: string;
	sizeMB?: number;

	durationSec?: number;
};

type Clip = {
	id: string;
	trackId: string;
	name: string;
	startBar: number;
	lengthBars: number;
	assetId?: string; // <-- set for audio clips created by drop

	// Non-destructive audio edit metadata. The backing asset is never modified.
	// sourceDurationSec is the amount of source audio represented by this clip.
	// Changing lengthBars without changing sourceDurationSec time-stretches the clip.
	sourceOffsetSec?: number;
	sourceDurationSec?: number;
	fadeInBars?: number;
	fadeOutBars?: number;

	// MIDI clip data. Stored as structured musical data, never baked into audio.
	midiNotes?: MidiNote[];
	midiPitchBend?: MidiAutomationPoint[];
	midiModulation?: MidiAutomationPoint[];
	midiBendRange?: number;
	midiScales?: MidiScaleRule[];
	midiScaleLock?: MidiScaleLock;
};

// Include all UI options (triplets + 1/128) so TS doesn't explode
type GridValue =
	| "bar"
	| "1/2"
	| "1/4"
	| "1/8"
	| "1/8T"
	| "1/16"
	| "1/16T"
	| "1/32"
	| "1/32T"
	| "1/64"
	| "1/64T"
	| "1/128";

type GridMode = "absolute" | "relative";

const ROW_H = 136;
const MIN_TRACK_H = 132;
const BASE_BAR_W = 96;
const MIN_ZOOM_PCT = 25;
const MAX_ZOOM_PCT = 400;
const MIN_BARS = 64;
const MAX_BARS = 512;
// Position 65 is the boundary immediately after measure 64.
const DEFAULT_END_BAR = 65;

// Add-track menu sizing (used for viewport clamping)
const MENU_W = 240;
const MENU_H = 112;

// Bottom-center drawer handle(s) sit on top of the app; reserve space so transport text isn't covered.
const BOTTOM_DOCK_SAFE_PX = 56;

const env = (import.meta as any).env || {};
const API_BASE = env.VITE_AUTH_API_URL || env.VITE_API_BASE_URL || "";
const API = (API_BASE || "").replace(/\/+$/, "");

async function fetchSignedUrl(objectKey: string, mode: "play" | "download" = "play") {
	const token = localStorage.getItem("ys_token");
	if (!token) throw new Error("no_token");

	const base = API ? API.replace(/\/+$/, "") + "/api/uploads/signed-url" : "/api/uploads/signed-url";
	const qs = new URLSearchParams({ objectKey, mode }).toString();

	const res = await fetch(`${base}?${qs}`, {
		method: "GET",
		headers: { Authorization: `Bearer ${token}` },
	});

	if (!res.ok) throw new Error(`signed_url_failed_${res.status}`);
	const data = await res.json();

	const url = typeof data?.url === "string" ? data.url : "";
	const expiresAt = typeof data?.expiresAt === "number" ? data.expiresAt : Date.now() + 60 * 60 * 1000;
	if (!url) throw new Error("signed_url_missing");
	return { url, expiresAt };
}

async function uploadFileToCloud(file: File) {
	const token = localStorage.getItem("ys_token");
	if (!token) throw new Error("no_token");
	const form = new FormData();
	form.append("file", file);
	const base = API ? API.replace(/\/+$/, "") + "/api/uploads" : "/api/uploads";
	const res = await fetch(base, {
		method: "POST",
		headers: { Authorization: `Bearer ${token}` },
		body: form,
	});
	if (!res.ok) throw new Error(`upload_failed_${res.status}`);
	return await res.json();
}

function mkTrack(type: TrackType, index: number, id?: string): Track {
	return {
		id: id ?? crypto.randomUUID(),
		type,
		name: type === "audio" ? `Audio ${index}` : `Instrument ${index}`,
		mute: false,
		solo: false,
		arm: false,
		level: 100,
		instrument: type === "instrument" ? "triangle" : undefined,
		gmProgram: type === "instrument" ? 0 : undefined,
	};
}

function clamp(n: number, a: number, b: number) {
	return Math.max(a, Math.min(b, n));
}

function hash32(str: string) {
	let h = 2166136261;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

function stablePositiveInt(str: string) {
	return Math.max(1, hash32(str) & 0x7fffffff);
}

function hashHue(input: string) {
	let h = 0;
	for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0;
	return h % 360;
}

function pseudoWaveHeights(seed: string, count: number) {
	const base = hash32(seed);
	const out: number[] = [];
	let x = base || 1;
	for (let i = 0; i < count; i++) {
		// xorshift
		x ^= x << 13;
		x ^= x >>> 17;
		x ^= x << 5;
		const frac = ((x >>> 0) % 1000) / 999;
		out.push(0.15 + frac * 0.85);
	}
	return out;
}

type StereoPeaks = { top: number[]; bottom: number[] };

function computeStereoPeaks(buffer: AudioBuffer, buckets = 1024): StereoPeaks {
	const ch0 = buffer.getChannelData(0);
	const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;
	const block = Math.max(1, Math.floor(ch0.length / buckets));
	const top: number[] = new Array(buckets).fill(0);
	const bottom: number[] = new Array(buckets).fill(0);
	for (let i = 0; i < buckets; i++) {
		const start = i * block;
		const end = Math.min(ch0.length, start + block);
		let max0 = 0;
		let max1 = 0;
		for (let j = start; j < end; j++) {
			const a = Math.abs(ch0[j]);
			const b = Math.abs(ch1[j]);
			if (a > max0) max0 = a;
			if (b > max1) max1 = b;
		}
		top[i] = max0;
		bottom[i] = max1;
	}
	return { top, bottom };
}

function resamplePeaksRange(arr: number[], count: number, startFrac = 0, endFrac = 1) {
	if (!arr.length || count <= 0) return [] as number[];
	const a = clamp(startFrac, 0, 1);
	const b = clamp(endFrac, a, 1);
	const out: number[] = [];
	for (let i = 0; i < count; i++) {
		const frac = a + ((i + 0.5) / count) * (b - a);
		const idx = Math.min(arr.length - 1, Math.max(0, Math.floor(frac * arr.length)));
		out.push(arr[idx] ?? 0);
	}
	return out;
}

/**
 * Pitch-preserving WSOLA stretcher for the browser pre-alpha editor.
 *
 * The previous fixed overlap/add implementation repeated slices at fixed
 * positions. That is fast, but it produces obvious flam/phasiness on drums and
 * warbling on tonal material even at small changes such as 106%.
 *
 * WSOLA (Waveform Similarity Overlap-Add) searches around each expected source
 * position for the waveform that best matches the already-rendered overlap,
 * then crossfades the two. This keeps transients and phase relationships much
 * more coherent while changing duration without changing pitch.
 *
 * The native YSong Bridge can later replace this with a studio-grade native
 * stretcher, but this is intentionally dependency-free and dramatically better
 * suited to auditioning beats/vocals in the browser.
 */
function renderPitchPreservedStretch(
	ctx: AudioContext,
	input: AudioBuffer,
	startSec: number,
	durationSec: number,
	ratio: number,
) {
	const sampleRate = input.sampleRate;
	const startFrame = clamp(Math.floor(startSec * sampleRate), 0, Math.max(0, input.length - 1));
	const maxFrames = Math.max(1, input.length - startFrame);
	const sourceFrames = clamp(Math.floor(durationSec * sampleRate), 1, maxFrames);
	const stretch = clamp(ratio, 0.25, 4);
	const outputFrames = Math.max(1, Math.floor(sourceFrames * stretch));
	const output = ctx.createBuffer(input.numberOfChannels, outputFrames, sampleRate);

	// Never process an effectively un-stretched clip. Aside from sounding cleaner,
	// this also guarantees that 100% is a bit-identical-ish channel copy.
	if (Math.abs(stretch - 1) < 0.002) {
		for (let ch = 0; ch < input.numberOfChannels; ch++) {
			const src = input.getChannelData(ch);
			const dst = output.getChannelData(ch);
			const slice = src.subarray(startFrame, Math.min(input.length, startFrame + sourceFrames));
			dst.set(slice.subarray(0, Math.min(slice.length, dst.length)));
		}
		return output;
	}

	// WSOLA timing. ~70ms sequences with a ~12ms overlap work well as a general
	// browser audition setting; the search window lets us lock onto nearby
	// transients instead of blindly crossfading unrelated waveform phases.
	const msToFrames = (ms: number) => Math.max(1, Math.round((ms / 1000) * sampleRate));
	let sequenceFrames = msToFrames(72);
	let overlapFrames = msToFrames(12);
	let seekFrames = msToFrames(18);

	// Very short clips need proportionally smaller windows.
	sequenceFrames = Math.min(sequenceFrames, Math.max(128, sourceFrames));
	overlapFrames = Math.min(overlapFrames, Math.max(32, Math.floor(sequenceFrames / 3)));
	if (sequenceFrames <= overlapFrames + 16) overlapFrames = Math.max(16, Math.floor(sequenceFrames / 4));
	seekFrames = Math.min(seekFrames, Math.max(0, Math.floor((sourceFrames - sequenceFrames) / 2)));

	const synthesisHop = Math.max(16, sequenceFrames - overlapFrames);
	const analysisHop = synthesisHop / stretch;
	const channelData = Array.from({ length: input.numberOfChannels }, (_, ch) => input.getChannelData(ch));
	const outData = Array.from({ length: output.numberOfChannels }, (_, ch) => output.getChannelData(ch));

	const maxSourceStart = Math.max(0, sourceFrames - sequenceFrames);
	const clampSourceStart = (frame: number) => clamp(Math.round(frame), 0, maxSourceStart);

	// Use a cheap mono-ish correlation for alignment. We sample the overlap rather
	// than every point so long clips don't lock the UI for ages.
	const correlation = (outPos: number, srcPos: number) => {
		let dot = 0;
		let energyA = 1e-12;
		let energyB = 1e-12;
		const corrStride = 4;
		const channelsForMatch = Math.min(2, input.numberOfChannels);
		for (let i = 0; i < overlapFrames; i += corrStride) {
			let a = 0;
			let b = 0;
			for (let ch = 0; ch < channelsForMatch; ch++) {
				a += outData[ch][outPos + i] ?? 0;
				b += channelData[ch][startFrame + srcPos + i] ?? 0;
			}
			a /= channelsForMatch;
			b /= channelsForMatch;
			dot += a * b;
			energyA += a * a;
			energyB += b * b;
		}
		return dot / Math.sqrt(energyA * energyB);
	};

	const copyFirst = Math.min(sequenceFrames, sourceFrames, outputFrames);
	for (let ch = 0; ch < input.numberOfChannels; ch++) {
		const src = channelData[ch];
		const dst = outData[ch];
		for (let i = 0; i < copyFirst; i++) dst[i] = src[startFrame + i] ?? 0;
	}

	let outPos = synthesisHop;
	while (outPos < outputFrames) {
		const expected = clampSourceStart(outPos / stretch);
		const searchLo = clampSourceStart(expected - seekFrames);
		const searchHi = clampSourceStart(expected + seekFrames);

		let best = expected;
		let bestScore = -Infinity;

		// Coarse pass first, then a small refinement around the best candidate.
		const coarseStep = Math.max(4, Math.floor(sampleRate / 4000));
		for (let cand = searchLo; cand <= searchHi; cand += coarseStep) {
			const score = correlation(outPos, cand);
			if (score > bestScore) {
				bestScore = score;
				best = cand;
			}
		}
		const refineRadius = Math.max(4, coarseStep * 2);
		for (let cand = Math.max(searchLo, best - refineRadius); cand <= Math.min(searchHi, best + refineRadius); cand++) {
			const score = correlation(outPos, cand);
			if (score > bestScore) {
				bestScore = score;
				best = cand;
			}
		}

		const availableSource = sourceFrames - best;
		const availableOutput = outputFrames - outPos;
		const frameLen = Math.min(sequenceFrames, availableSource, availableOutput);
		if (frameLen <= 0) break;

		for (let ch = 0; ch < input.numberOfChannels; ch++) {
			const src = channelData[ch];
			const dst = outData[ch];
			const overlapLen = Math.min(overlapFrames, frameLen);

			// Linear crossfade preserves level when WSOLA has found a highly similar
			// waveform match. Equal-power fades can create a ~3 dB bump here because
			// the two overlap signals are intentionally correlated.
			for (let i = 0; i < overlapLen; i++) {
				const t = overlapLen <= 1 ? 1 : i / (overlapLen - 1);
				const incoming = src[startFrame + best + i] ?? 0;
				dst[outPos + i] = dst[outPos + i] * (1 - t) + incoming * t;
			}

			for (let i = overlapLen; i < frameLen; i++) {
				dst[outPos + i] = src[startFrame + best + i] ?? 0;
			}
		}

		outPos += synthesisHop;
		if (analysisHop <= 0) break;
	}

	return output;
}

/**
 * Apply clip fades to the temporary playback buffer, never to the source asset.
 * Baking the envelope into the per-clip audition buffer makes fades deterministic
 * across normal playback, seek-in-the-middle, loops, and stretched audio.
 */
function applyClipFadesToBuffer(buffer: AudioBuffer, fadeInSec: number, fadeOutSec: number) {
	const sr = buffer.sampleRate;
	const total = buffer.length;
	const fadeInFrames = clamp(Math.round(Math.max(0, fadeInSec) * sr), 0, total);
	const fadeOutFrames = clamp(Math.round(Math.max(0, fadeOutSec) * sr), 0, Math.max(0, total - fadeInFrames));
	if (fadeInFrames <= 0 && fadeOutFrames <= 0) return buffer;

	for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
		const data = buffer.getChannelData(ch);
		for (let i = 0; i < fadeInFrames; i++) {
			const gain = fadeInFrames <= 1 ? 1 : i / (fadeInFrames - 1);
			data[i] *= gain;
		}
		for (let i = 0; i < fadeOutFrames; i++) {
			const idx = total - fadeOutFrames + i;
			const gain = fadeOutFrames <= 1 ? 0 : 1 - i / (fadeOutFrames - 1);
			data[idx] *= gain;
		}
	}
	return buffer;
}

function isEditableTarget(t: EventTarget | null) {
	if (!(t instanceof HTMLElement)) return false;
	const tag = t.tagName.toLowerCase();
	return tag === "input" || tag === "textarea" || t.isContentEditable;
}

type GmPreviewVoiceNodes = {
	sources: OscillatorNode[];
	gain: GainNode;
	lfo?: OscillatorNode;
	release: number;
};

/**
 * Create the dependency-free General MIDI fallback voice. The old renderer used
 * one generic oscillator per GM family, which made a piano, organ and guitar
 * sound like barely-related beeps. This additive voice keeps the preview light
 * enough for the browser while giving each GM family a musically appropriate
 * harmonic spectrum and envelope. Native VSTs still bypass this completely.
 */
function createGmPreviewVoice(
	ctx: AudioContext,
	program: number,
	baseHz: number,
	velocity: number,
	destination: AudioNode,
	startAt: number,
): GmPreviewVoiceNodes {
	const profile = gmPreviewProfile(program);
	const filter = ctx.createBiquadFilter();
	const voiceGain = ctx.createGain();
	filter.type = "lowpass";
	filter.frequency.setValueAtTime(profile.filterHz, startAt);
	filter.Q.setValueAtTime(profile.filterQ, startAt);
	filter.connect(voiceGain);
	voiceGain.connect(destination);

	const partialTotal = Math.max(1, profile.partials.reduce((sum, partial) => sum + Math.max(0, partial.gain), 0));
	const velocityAmp = clamp(velocity / 127, 0.01, 1) * Math.min(0.20, 0.30 / Math.sqrt(partialTotal));
	const attackEnd = startAt + Math.max(0.001, profile.attack);
	voiceGain.gain.setValueAtTime(0.0001, startAt);
	voiceGain.gain.exponentialRampToValueAtTime(Math.max(0.0002, velocityAmp), attackEnd);
	if (profile.decay) {
		const sustainAmp = Math.max(0.0001, velocityAmp * Math.max(0.005, profile.sustain ?? 0.04));
		voiceGain.gain.exponentialRampToValueAtTime(sustainAmp, startAt + Math.max(profile.attack + 0.01, profile.decay));
	}

	const sources: OscillatorNode[] = [];
	for (const partial of profile.partials) {
		const osc = ctx.createOscillator();
		const partialGain = ctx.createGain();
		osc.type = partial.oscillator ?? "sine";
		osc.frequency.setValueAtTime(Math.max(8, baseHz * partial.ratio), startAt);
		osc.detune.setValueAtTime(partial.detuneCents ?? 0, startAt);
		partialGain.gain.setValueAtTime(Math.max(0, partial.gain) / partialTotal, startAt);
		osc.connect(partialGain);
		partialGain.connect(filter);
		osc.start(startAt);
		sources.push(osc);
	}

	let lfo: OscillatorNode | undefined;
	if ((profile.vibratoCents ?? 0) > 0) {
		lfo = ctx.createOscillator();
		const lfoGain = ctx.createGain();
		lfo.type = "sine";
		lfo.frequency.setValueAtTime(profile.vibratoHz ?? 5.2, startAt);
		lfoGain.gain.setValueAtTime(profile.vibratoCents ?? 0, startAt);
		lfo.connect(lfoGain);
		for (const osc of sources) lfoGain.connect(osc.detune);
		lfo.start(startAt);
	}

	return { sources, gain: voiceGain, lfo, release: profile.release };
}

// --- Snap helpers (Absolute snapping only) ---
function parseGridValue(v: GridValue): { kind: "bar" } | { kind: "note"; div: number; triplet: boolean } {
	if (v === "bar") return { kind: "bar" };

	const triplet = v.endsWith("T");
	const base = triplet ? v.slice(0, -1) : v; // e.g. "1/16T" -> "1/16"
	const parts = base.split("/");
	const div = Number(parts[1]);

	if (!Number.isFinite(div) || div <= 0) return { kind: "note", div: 4, triplet: false };

	return { kind: "note", div, triplet };
}

function normalizeProjectAssetForPersist<T extends { objectKey?: string; url?: string }>(asset: T): T {
	if (asset?.objectKey) {
		return { ...asset, url: undefined };
	}
	return asset;
}

/**
 * Converts a GridValue into a step size in "bars" (where 1.0 == one bar).
 * Absolute snap only.
 *
 * 1/N is treated as a note value (relative to a whole note):
 * - 1/16 = sixteenth note = 1/16 whole note
 * Convert to bars using time signature:
 * - bar length in whole notes = sigNum / sigDen
 * - stepBars = stepWholeNotes / barWholeNotes
 */
function gridStepBars(v: GridValue, sigNum: number, sigDen: number) {
	const parsed = parseGridValue(v);
	if (parsed.kind === "bar") return 1;

	const barWholeNotes = Math.max(0.0001, Math.max(1, sigNum) / Math.max(1, sigDen));

	let stepWhole = 1 / parsed.div;
	if (parsed.triplet) stepWhole *= 2 / 3;

	const stepBars = stepWhole / barWholeNotes;

	// clamp sanity
	return clamp(stepBars, 1 / 512, 1);
}

export default function DAW(_props: TabRendererProps) {
	type DawPersistV1 = {
		v: 1;
		tracks: Track[];
		clips: Clip[];
		projectAssets: ProjectAsset[];
		selectedTrackId: string | null;
		selectedClipId: string | null;

		snapEnabled: boolean;
		gridValue: GridValue;
		gridMode: GridMode;

		playheadPosBars: number;
		loopL: number;
		loopR: number;
		endBar: number;
		loopEnabled: boolean;

		bpm: number;
		sigNum: number;
		sigDen: number;
		trackHeights?: Record<string, number>;
		zoomPct?: number;
	};

	function safeParse<T>(raw: string | null): T | null {
		if (!raw) return null;
		try {
			return JSON.parse(raw) as T;
		} catch {
			return null;
		}
	}

	// Try to derive a stable key per project.
	const initialProjectId =
		(_props as any)?.projectId ??
		(_props as any)?.project?.id ??
		localStorage.getItem("ysong:activeProjectId") ??
		"default";

	const [activeProjectId, setActiveProjectId] = useState<string>(() => String(initialProjectId));

	useEffect(() => {
		try {
			localStorage.setItem("ysong:activeProjectId", String(activeProjectId));
		} catch {
			// ignore
		}
	}, [activeProjectId]);

	const DAW_STORAGE_KEY = `ysong:daw:${activeProjectId}`;
	const PROJECT_NAME_KEY = `ysong:projectName:${activeProjectId}`;
	const PROJECTS_KEY = "ysong:projects:v1";

	const [tracks, setTracks] = useState<Track[]>(() => []);
	const [dawHydrated, setDawHydrated] = useState(false);
	const [vst3Plugins, setVst3Plugins] = useState<BridgePlugin[]>([]);
	const [midiInputDevices, setMidiInputDevices] = useState<BridgeMidiInputDevice[]>([]);
	const [vstTrackState, setVstTrackState] = useState<Record<string, { status: "loading" | "ready" | "error"; message?: string }>>({});
	const vstLoadedRef = useRef<Map<string, string>>(new Map());
	const vstMetersRef = useRef<Record<string, number>>({});
	const [trackPanelOpen, setTrackPanelOpen] = useState<boolean>(() => {
		try {
			const saved = sessionStorage.getItem("ysong:daw:trackPanelOpen");
			if (saved != null) return saved === "1";
		} catch {}
		return typeof window === "undefined" ? true : window.innerWidth >= 720;
	});

	useEffect(() => {
		try { sessionStorage.setItem("ysong:daw:trackPanelOpen", trackPanelOpen ? "1" : "0"); } catch {}
	}, [trackPanelOpen]);

	useEffect(() => {
		let cancelled = false;
		const refresh = () => {
			bridgeApi.getPlugins()
				.then((res) => { if (!cancelled) setVst3Plugins(res.plugins ?? []); })
				.catch(() => { /* Bridge can legitimately be offline while editing. */ });
		};
		refresh();
		const timer = window.setInterval(refresh, 5000);
		return () => { cancelled = true; window.clearInterval(timer); };
	}, []);

	useEffect(() => {
		let cancelled = false;
		const refreshMidiInputs = () => {
			bridgeApi.getMidiDevices()
				.then((res) => { if (!cancelled) setMidiInputDevices(res.devices ?? []); })
				.catch(() => { /* Native MIDI is optional while Bridge is offline. */ });
		};
		refreshMidiInputs();
		const timer = window.setInterval(refreshMidiInputs, 4000);
		return () => { cancelled = true; window.clearInterval(timer); };
	}, []);

	// --- Selection + clips (Create & render, no drag/resize yet) ---
	const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
	const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
	const [clips, setClips] = useState<Clip[]>([]);
	const [midiEditorClipId, setMidiEditorClipId] = useState<string | null>(null);
	const [onScreenKeyboardOpen, setOnScreenKeyboardOpen] = useState(false);
	const [hardwareActiveNotes, setHardwareActiveNotes] = useState<Set<number>>(() => new Set());
	type ClipContextMenuState = { x: number; y: number; clipId: string } | null;
	type LaneContextMenuState = { x: number; y: number; trackId: string; startBar: number } | null;
	const [clipContextMenu, setClipContextMenu] = useState<ClipContextMenuState>(null);
	const [laneContextMenu, setLaneContextMenu] = useState<LaneContextMenuState>(null);
	const clipClipboardRef = useRef<Clip | null>(null);

	// --- DAW toolbar state ---
	const [snapEnabled, setSnapEnabled] = useState(true);
	const [gridValue, setGridValue] = useState<GridValue>("bar");
	const [gridMode, setGridMode] = useState<GridMode>("absolute");
	const [zoomPct, setZoomPct] = useState(100);
	const barWidth = BASE_BAR_W * (zoomPct / 100);
	const barToLeftPx = (bar: number) => (bar - 1) * barWidth;

	// Project (autosave-oriented)
	const [projectName, setProjectName] = useState<string>(() => {
		try {
			return localStorage.getItem(PROJECT_NAME_KEY) || "Untitled Project";
		} catch {
			return "Untitled Project";
		}
	});
	const [projectSheetOpen, setProjectSheetOpen] = useState(false);
	const [isSavingUi, setIsSavingUi] = useState(false);
	const projectDirty = false; // placeholder until cloud project persistence

	// --- Markers (bars are 1..BARS) ---
	const [playheadPosBars, setPlayheadPosBars] = useState(1); // float bars (1.0 = bar 1)
	const [loopL, setLoopL] = useState(1);
	const [loopR, setLoopR] = useState(5);
	const [endBar, setEndBar] = useState(DEFAULT_END_BAR);
	const [bars, setBars] = useState(MIN_BARS);

	// --- Transport state ---
	const [isPlaying, setIsPlaying] = useState(false);
	const [isRecording, setIsRecording] = useState(false);
	const [loopEnabled, setLoopEnabled] = useState(false);
	const [bpm, setBpm] = useState(120);
	const [sigNum, setSigNum] = useState(4);
	const [sigDen, setSigDen] = useState(4);

	useEffect(() => {
		const maxClipEnd = clips.reduce((acc, c) => Math.max(acc, c.startBar + c.lengthBars), 1);
		const maxNeed = Math.max(
			MIN_BARS,
			Math.ceil(maxClipEnd + 8),
			Math.ceil(loopR + 8),
			Math.ceil(playheadPosBars + 8),
			Math.ceil(endBar + 8),
		);
		setBars((prev) => Math.min(MAX_BARS, Math.max(prev, maxNeed)));
		// IMPORTANT: clips are allowed to extend past E. Never move E automatically.
	}, [clips, loopR, playheadPosBars, endBar]);

	// Keep name persisted
	useEffect(() => {
		try {
			localStorage.setItem(PROJECT_NAME_KEY, projectName);
		} catch {}
	}, [PROJECT_NAME_KEY, projectName]);

	type ProjectMeta = { id: string; name: string; updatedAt: number };

	const readProjects = (): ProjectMeta[] => {
		try {
			const raw = localStorage.getItem(PROJECTS_KEY);
			const parsed = raw ? (JSON.parse(raw) as ProjectMeta[]) : [];
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	};

	const upsertProjectMeta = (id: string, name: string) => {
		try {
			const list = readProjects();
			const now = Date.now();
			const next = [{ id, name, updatedAt: now }, ...list.filter((p) => p.id !== id)].slice(0, 30);
			localStorage.setItem(PROJECTS_KEY, JSON.stringify(next));
		} catch {}
	};

	useEffect(() => {
		// On project switch, hydrate name from storage (or default)
		try {
			const n = localStorage.getItem(PROJECT_NAME_KEY);
			setProjectName(n || "Untitled Project");
		} catch {
			setProjectName("Untitled Project");
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [PROJECT_NAME_KEY]);

	const createNewProject = () => {
		const id = crypto.randomUUID();
		try {
			localStorage.setItem(`ysong:projectName:${id}`, "Untitled Project");
		} catch {}
		setActiveProjectId(id);
		setProjectSheetOpen(false);
	};

	const clearProject = () => {
		stop();
		bridgeApi.unloadAllVst3().catch(() => {});
		vstLoadedRef.current.clear();
		vstMetersRef.current = {};
		setVstTrackState({});
		setTracks([]);
		setClips([]);
		setProjectAssets([]);
		setTrackHeights({});
		setSelectedTrackId(null);
		setSelectedClipId(null);
		setPlayheadPosBars(1);
		setLoopL(1);
		setLoopR(5);
		setEndBar(DEFAULT_END_BAR);
		setLoopEnabled(false);
	};

	const loadProject = (id: string) => {
		setActiveProjectId(id);
		setProjectSheetOpen(false);
	};

	const [localProjectAssets, setLocalProjectAssets] = useState<ProjectAsset[]>([]);
	const externalProjectAssets = (_props as any)?.projectAssets as ProjectAsset[] | undefined;
	const externalSetProjectAssets = (_props as any)?.setProjectAssets as
		| Dispatch<SetStateAction<ProjectAsset[]>>
		| undefined;
	const projectAssets = externalProjectAssets ?? localProjectAssets;
	const setProjectAssets = externalSetProjectAssets ?? setLocalProjectAssets;
	const [trackHeights, setTrackHeights] = useState<Record<string, number>>({});
	const waveformPeaksRef = useRef<Map<string, StereoPeaks>>(new Map());
	const [waveformVersion, setWaveformVersion] = useState(0);
	const [trackMeters, setTrackMeters] = useState<Record<string, number>>({});
	const [renamingTrackId, setRenamingTrackId] = useState<string | null>(null);
	const [renamingTrackName, setRenamingTrackName] = useState("");

	const getTrackHeight = (trackId: string, _type?: TrackType) =>
		Math.max(MIN_TRACK_H, trackHeights[trackId] ?? ROW_H);

	// WebAudio context (lazy)
	const audioCtxRef = useRef<AudioContext | null>(null);
	const masterGainRef = useRef<GainNode | null>(null);
	type TrackAudioBus = { gain: GainNode; analyser: AnalyserNode };
	const trackAudioBusesRef = useRef<Map<string, TrackAudioBus>>(new Map());
	const audioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
	const stretchedBuffersRef = useRef<Map<string, { key: string; buffer: AudioBuffer }>>(new Map());
	const activeSourcesRef = useRef<AudioScheduledSourceNode[]>([]);
	// Track every scheduled WebAudio source by the clip that created it. This lets
	// destructive clip edits (Delete/Cut) silence the removed clip immediately
	// without restarting the rest of the transport. It also catches loop passes
	// that were pre-scheduled ahead of the playhead.
	const activeClipSourcesRef = useRef<Map<string, Set<AudioScheduledSourceNode>>>(new Map());
	const audioScheduleGenerationRef = useRef(0);
	const gmProgramOverrideRef = useRef<Map<string, number>>(new Map());
	type LiveGmVoice = GmPreviewVoiceNodes & { trackId: string };
	const liveGmVoicesRef = useRef<Map<string, LiveGmVoice>>(new Map());
	const liveVstNoteIdsRef = useRef<Map<string, number>>(new Map());
	type RecordingSession = { clipId: string; trackId: string; startedAtMs: number; startBar: number; active: Map<number, { id: string; startBars: number; velocity: number }> };
	const recordingSessionRef = useRef<RecordingSession | null>(null);
	const signedUrlCacheRef = useRef<Map<string, { url: string; expiresAt: number }>>(new Map());
	const lastPosRef = useRef<number>(1);
	const meterRafRef = useRef<number | null>(null);
	const loopSchedulerTimerRef = useRef<number | null>(null);
	const loopScheduleNextCtxTimeRef = useRef(0);
	const loopSchedulerBusyRef = useRef(false);

	const stopSourcesForClip = (clipId: string) => {
		const sources = activeClipSourcesRef.current.get(clipId);
		if (!sources?.size) return;
		for (const source of Array.from(sources)) {
			try { source.stop(); } catch {}
			const index = activeSourcesRef.current.indexOf(source);
			if (index >= 0) activeSourcesRef.current.splice(index, 1);
		}
		activeClipSourcesRef.current.delete(clipId);
	};

	// Asset Drawer and Project Asset Drawer deletions are destructive project
	// actions: remove both the backing asset and every DAW clip that uses it.
	useEffect(() => {
		const onAssetDeleted = (event: Event) => {
			const detail = (event as CustomEvent<any>).detail || {};
			const explicitIds = new Set<string>(
				(Array.isArray(detail.linkedAssetIds) ? detail.linkedAssetIds : [])
					.map((x: any) => String(x || ""))
					.filter(Boolean),
			);
			if (detail.assetId) explicitIds.add(String(detail.assetId));

			for (const asset of projectAssets) {
				const keyMatch =
					(detail.objectKey && (asset.objectKey === detail.objectKey || asset.sourceObjectKey === detail.objectKey)) ||
					(detail.sourceObjectKey &&
						(asset.objectKey === detail.sourceObjectKey || asset.sourceObjectKey === detail.sourceObjectKey));
				const legacyNameMatch = explicitIds.size === 0 && detail.name && asset.name === detail.name;
				if (keyMatch || legacyNameMatch) explicitIds.add(asset.id);
			}

			if (!explicitIds.size) return;
			for (const clip of clips) {
				if (clip.assetId && explicitIds.has(clip.assetId)) stopSourcesForClip(clip.id);
			}
			setProjectAssets((prev) => prev.filter((a) => !explicitIds.has(a.id)));
			setClips((prev) => prev.filter((c) => !c.assetId || !explicitIds.has(c.assetId)));
			setSelectedClipId((current) => {
				if (!current) return current;
				const hit = clips.find((c) => c.id === current);
				return hit?.assetId && explicitIds.has(hit.assetId) ? null : current;
			});

			for (const id of explicitIds) {
				audioBuffersRef.current.delete(id);
				stretchedBuffersRef.current.clear();
				waveformPeaksRef.current.delete(id);
				signedUrlCacheRef.current.delete(id);
			}
			setWaveformVersion((v) => v + 1);
		};

		window.addEventListener("ysong:asset-deleted", onAssetDeleted as EventListener);
		return () => window.removeEventListener("ysong:asset-deleted", onAssetDeleted as EventListener);
	}, [projectAssets, clips, setProjectAssets]);

	// Keep tempo/sig available for async duration decode
	const bpmRef = useRef(bpm);
	const sigNumRef = useRef(sigNum);
	const sigDenRef = useRef(sigDen);

	const rafRef = useRef<number | null>(null);
	const playStartMsRef = useRef<number>(0);
	const playStartPosRef = useRef<number>(1);
	const lastUiUpdateMsRef = useRef<number>(0);

	// --- Refs for scroll sync + ruler math ---
	const timelineRef = useRef<HTMLDivElement | null>(null);
	const trackScrollRef = useRef<HTMLDivElement | null>(null);
	const rulerInnerRef = useRef<HTMLDivElement | null>(null);
	const syncing = useRef(false);
	const laneResizeRef = useRef<{ trackId: string; pointerId: number; startY: number; startH: number } | null>(null);

	const timelineWidth = bars * barWidth;

	const timelineWideStyle = useMemo(
		() =>
			({
				width: timelineWidth,
				minWidth: "100%",
			}) as React.CSSProperties,
		[timelineWidth],
	);

	// --- Add Track menu ---
	const [addMenuOpen, setAddMenuOpen] = useState(false);
	const [addMenuPos, setAddMenuPos] = useState<{
		top: number;
		left: number;
	} | null>(null);
	const addBtnRef = useRef<HTMLButtonElement | null>(null);
	const addMenuRef = useRef<HTMLDivElement | null>(null);

	const addTrack = (type: TrackType) => {
		const id = crypto.randomUUID();
		setTracks((prev) => {
			const nextIndex = prev.filter((t) => t.type === type).length + 1;
			return [...prev, mkTrack(type, nextIndex, id)];
		});
		setTrackHeights((prev) => ({ ...prev, [id]: ROW_H }));
		setSelectedTrackId(id);
		setSelectedClipId(null);
	};

	const deleteTrack = (id: string) => {
		const deletingTrack = tracks.find((t) => t.id === id);
		if (deletingTrack?.vst3PluginPath) {
			bridgeApi.unloadVst3Instrument(id).catch(() => {});
			vstLoadedRef.current.delete(id);
		}
		// Silence all currently playing/pre-scheduled sources owned by this track
		// before removing its UI/project state.
		for (const clip of clips) {
			if (clip.trackId === id) stopSourcesForClip(clip.id);
		}

		// clear selected clip if it's on this track
		const clipOnTrack = clips.find((c) => c.id === selectedClipId);
		if (clipOnTrack?.trackId === id) setSelectedClipId(null);

		// clear selected track if it's this one
		if (selectedTrackId === id) setSelectedTrackId(null);

		// remove the track
		setTracks((prev) => prev.filter((t) => t.id !== id));

		// remove clips on that track
		setClips((prev) => prev.filter((c) => c.trackId !== id));
		setTrackHeights((prev) => {
			const next = { ...prev };
			delete next[id];
			return next;
		});
		const bus = trackAudioBusesRef.current.get(id);
		if (bus) {
			try { bus.gain.disconnect(); } catch {}
			try { bus.analyser.disconnect(); } catch {}
			trackAudioBusesRef.current.delete(id);
		}
		setTrackMeters((prev) => {
			const next = { ...prev };
			delete next[id];
			return next;
		});
	};

	const toggle = (id: string, key: "mute" | "solo" | "arm") => {
		setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, [key]: !t[key] } : t)));
	};

	const setTrackLevel = (id: string, level: number) => {
		setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, level: clamp(Math.round(level), 0, 127) } : t)));
	};

	const beginTrackRename = (track: Track) => {
		setRenamingTrackId(track.id);
		setRenamingTrackName(track.name);
	};

	const commitTrackRename = () => {
		if (!renamingTrackId) return;
		const nextName = renamingTrackName.trim();
		if (nextName) setTracks((prev) => prev.map((t) => (t.id === renamingTrackId ? { ...t, name: nextName } : t)));
		setRenamingTrackId(null);
		setRenamingTrackName("");
	};

	const ensureVstLoaded = async (track: Track) => {
		if (track.type !== "instrument" || !track.vst3PluginPath) return;
		if (vstLoadedRef.current.get(track.id) === track.vst3PluginPath) return;
		setVstTrackState((prev) => ({ ...prev, [track.id]: { status: "loading" } }));
		try {
			const loaded = await bridgeApi.loadVst3Instrument(track.id, track.vst3PluginPath);
			vstLoadedRef.current.set(track.id, track.vst3PluginPath);
			setVstTrackState((prev) => ({ ...prev, [track.id]: { status: "ready" } }));
			if (loaded.plugin?.name && loaded.plugin.name !== track.vst3PluginName) {
				setTracks((prev) => prev.map((t) => t.id === track.id ? {
					...t,
					vst3PluginName: loaded.plugin.name,
					vst3PluginVendor: loaded.plugin.vendor ?? t.vst3PluginVendor,
				} : t));
			}
		} catch (error) {
			vstLoadedRef.current.delete(track.id);
			const message = error instanceof Error ? error.message : "Could not load VST3 instrument.";
			setVstTrackState((prev) => ({ ...prev, [track.id]: { status: "error", message } }));
			throw error;
		}
	};

	const openVstEditor = async (track: Track) => {
		if (track.type !== "instrument" || !track.vst3PluginPath) return;
		try {
			await ensureVstLoaded(track);
			await bridgeApi.openVst3Editor(track.id);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Could not open the VST3 editor.";
			window.alert(`YSong Bridge could not open ${track.vst3PluginName ?? "that VST3"}.\n\n${message}`);
		}
	};

	const setTrackInstrumentSource = async (track: Track, value: string) => {
		if (value.startsWith("gm:")) {
			const program = normalizeGmProgram(Number(value.slice(3)));
			// Patch changes must hand the native audio device back immediately. ASIO4ALL
			// can be exclusive; leaving a live VST stream open makes the browser GM/WebAudio
			// path appear to wake up seconds later. Panic/stop native output before unload.
			if (track.vst3PluginPath) { try { await bridgeApi.stopVst3(); } catch {} }
			try { await bridgeApi.unloadVst3Instrument(track.id); } catch {}
			vstLoadedRef.current.delete(track.id);
			setVstTrackState((prev) => { const next = { ...prev }; delete next[track.id]; return next; });
			gmProgramOverrideRef.current.set(track.id, program);
			setTracks((prev) => prev.map((t) => t.id === track.id ? {
				...t, gmProgram: program, vst3PluginPath: undefined, vst3PluginName: undefined, vst3PluginVendor: undefined,
			} : t));
			if (isPlaying) { stop(); requestAnimationFrame(() => start(loopEnabled)); }
			return;
		}

		if (!value.startsWith("vst3:")) return;
		const path = value.slice(5);
		const catalog = vst3Plugins.find((plugin) => plugin.path === path);
		const previousTrack = { ...track };
		const nextTrack: Track = {
			...track,
			vst3PluginPath: path,
			vst3PluginName: catalog?.name ?? "VST3",
			vst3PluginVendor: catalog?.vendor ?? undefined,
		};
		setTracks((prev) => prev.map((t) => t.id === track.id ? nextTrack : t));
		vstLoadedRef.current.delete(track.id);
		try {
			await ensureVstLoaded(nextTrack);
			const currentList = tracks.map((t) => t.id === track.id ? nextTrack : t);
			await bridgeApi.setVst3Mixer(track.id, computedTrackGain(nextTrack, currentList) <= 0, nextTrack.level ?? 100);
			if (isPlaying) { stop(); requestAnimationFrame(() => start(loopEnabled)); }
		} catch (error) {
			// A failed native load must not leave the project claiming that the broken
			// plugin is assigned. Restore the exact previous GM/VST assignment.
			setTracks((prev) => prev.map((t) => t.id === track.id ? previousTrack : t));
			vstLoadedRef.current.delete(track.id);
			try {
				if (previousTrack.vst3PluginPath) await ensureVstLoaded(previousTrack);
				else await bridgeApi.unloadVst3Instrument(track.id);
			} catch {}
			const message = error instanceof Error ? error.message : "Could not load VST3 instrument.";
			window.alert(`YSong Bridge could not load ${catalog?.name ?? "that VST3"}.\n\n${message}`);
		}
	};

	const removeClipFromDaw = (clipId: string) => {
		// A clip may already have current and future loop-pass sources scheduled.
		// Stop only that clip's sources now so Delete/Cut is immediately audible
		// while every other track keeps playing.
		stopSourcesForClip(clipId);
		stretchedBuffersRef.current.delete(clipId);
		setClips((prev) => prev.filter((c) => c.id !== clipId));
		setSelectedClipId((current) => (current === clipId ? null : current));
		setMidiEditorClipId((current) => (current === clipId ? null : current));
		setClipContextMenu(null);
	};

	const cloneClipForPaste = (source: Clip, trackId: string, startBar: number): Clip => {
		const cloneNotes = source.midiNotes?.map((n) => ({ ...n, id: crypto.randomUUID() }));
		const cloneAutomation = (list?: MidiAutomationPoint[]) => list?.map((p) => ({ ...p, id: crypto.randomUUID() }));
		const cloneScales = source.midiScales?.map((r) => ({ ...r, id: crypto.randomUUID() }));
		return {
			...source,
			id: crypto.randomUUID(),
			trackId,
			startBar: clamp(startBar, 1, Math.max(1, bars + 1 - source.lengthBars)),
			midiNotes: cloneNotes,
			midiPitchBend: cloneAutomation(source.midiPitchBend),
			midiModulation: cloneAutomation(source.midiModulation),
			midiScales: cloneScales,
		};
	};

	const clipType = (clip: Clip): TrackType => clip.assetId ? "audio" : "instrument";

	const copyClip = (clipId: string) => {
		const source = clips.find((c) => c.id === clipId);
		if (!source) return;
		clipClipboardRef.current = { ...source };
		setSelectedClipId(clipId);
		setClipContextMenu(null);
		setLaneContextMenu(null);
	};

	const cutClip = (clipId: string) => {
		copyClip(clipId);
		removeClipFromDaw(clipId);
	};

	const pasteClipAt = (trackId: string, startBar: number) => {
		const source = clipClipboardRef.current;
		const targetTrack = tracks.find((t) => t.id === trackId);
		if (!source || !targetTrack || targetTrack.type !== clipType(source)) return false;
		const snappedStart = applySnap(startBar);
		const pasted = cloneClipForPaste(source, targetTrack.id, snappedStart);
		setClips((prev) => [...prev, pasted]);
		setSelectedTrackId(targetTrack.id);
		setSelectedClipId(pasted.id);
		setLaneContextMenu(null);
		return true;
	};

	const pasteClip = () => {
		const source = clipClipboardRef.current;
		if (!source) return;
		const wantedType = clipType(source);
		const selectedTrack = tracks.find((t) => t.id === selectedTrackId && t.type === wantedType);
		const sourceTrack = tracks.find((t) => t.id === source.trackId && t.type === wantedType);
		const targetTrack = selectedTrack ?? sourceTrack ?? tracks.find((t) => t.type === wantedType);
		if (!targetTrack) return;
		pasteClipAt(targetTrack.id, playheadPosBars);
	};

	const openClipContextMenu = (clipId: string) => (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setSelectedClipId(clipId);
		const clip = clips.find((c) => c.id === clipId);
		if (clip) setSelectedTrackId(clip.trackId);
		setLaneContextMenu(null);
		setClipContextMenu({ x: e.clientX, y: e.clientY, clipId });
	};

	const openLaneContextMenu = (trackId: string) => (e: React.MouseEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.stopPropagation();
		setSelectedTrackId(trackId);
		setSelectedClipId(null);
		setClipContextMenu(null);
		const startBar = clientXToBarInEl(e.clientX, e.currentTarget, bars);
		setLaneContextMenu({ x: e.clientX, y: e.clientY, trackId, startBar });
	};

	// --- Scroll sync ---
	const onTimelineScroll = () => {
		if (syncing.current) return;
		syncing.current = true;

		const tl = timelineRef.current;
		const tr = trackScrollRef.current;
		if (tl && tr) tr.scrollTop = tl.scrollTop;

		requestAnimationFrame(() => {
			syncing.current = false;
		});
	};

	const onTrackScroll = () => {
		if (syncing.current) return;
		syncing.current = true;

		const tl = timelineRef.current;
		const tr = trackScrollRef.current;
		if (tl && tr) tl.scrollTop = tr.scrollTop;

		requestAnimationFrame(() => {
			syncing.current = false;
		});
	};

	const laneGridStyle: React.CSSProperties = useMemo(
		() => ({
			backgroundImage: `
                linear-gradient(to right, rgba(255,255,255,0.09) 1px, transparent 1px),
                linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px)
            `,
			backgroundSize: `${barWidth}px 100%, ${barWidth / 4}px 100%`,
		}),
		[barWidth],
	);

	// --- Snap math (Absolute only) ---
	const stepBars = gridStepBars(gridValue, sigNum, sigDen);

	const snapBarsAbsolute = (posBars: number) => {
		const bar0 = posBars - 1; // 0-based bars
		const snappedBar0 = Math.round(bar0 / stepBars) * stepBars;
		return snappedBar0 + 1;
	};

	const applySnap = (posBars: number) => {
		if (!snapEnabled) return posBars;
		// Relative mode is disabled; treat as absolute for now
		return snapBarsAbsolute(posBars);
	};

	// --- Convert a clientX to a snapped bar position using a specific element's rect ---
	// NOTE: maxBars lets us support "edges" up to BARS+1 for clip resizing.
	const clientXToBarInEl = (clientX: number, el: HTMLElement | null, maxBars = bars) => {
		if (!el) return 1;

		const rect = el.getBoundingClientRect();
		const x = clientX - rect.left;

		const rawBars = x / barWidth + 1; // float bars
		const snapped = applySnap(rawBars);

		return clamp(snapped, 1, maxBars);
	};

	// Use ruler element for marker drags (flags can be the event target)
	const clientXToBar = (clientX: number) => clientXToBarInEl(clientX, rulerInnerRef.current, bars);

	// Playhead placement should use the element you clicked on (ruler or lanes)
	const setPlayheadFromEvent = (e: React.PointerEvent) => {
		setPlayheadPosBars(clientXToBarInEl(e.clientX, e.currentTarget as HTMLElement, bars));
	};

	// --- RAW (no snap) bar conversion (needed for smooth drag when snap is off) ---
	const clientXToRawBarInEl = (clientX: number, el: HTMLElement | null, maxBars = bars) => {
		if (!el) return 1;
		const rect = el.getBoundingClientRect();
		const x = clientX - rect.left;
		const rawBars = x / barWidth + 1;
		return clamp(rawBars, 1, maxBars);
	};

	// Allow edges up to BARS+1 for clip moves/resizes (end boundary)
	const clientXToRawBar = (clientX: number, maxBars = bars + 1) =>
		clientXToRawBarInEl(clientX, rulerInnerRef.current, maxBars);

	// Clip pointer actions (move + resize-right) ---
	// Add right-edge resizing (snap-aware). Hold ALT to bypass snap.
	type ClipPointerMode = "move" | "resizeR" | "stretchR" | "fadeIn" | "fadeOut";

	type ClipPointerState = {
		clipId: string;
		pointerId: number;
		mode: ClipPointerMode;
		downRawBar: number;
		startClipBar: number;
		clipLenBars: number; // span in bars
		startEndBar: number; // startClipBar + clipLenBars
		startFadeInBars: number;
		startFadeOutBars: number;
		startSourceDurationSec?: number;
	};

	const clipPtrRef = useRef<ClipPointerState | null>(null);
	const [draggingClipId, setDraggingClipId] = useState<string | null>(null);
	type DropPreview = { trackId: string; startBar: number; lengthBars: number; name: string };
	const [dropPreview, setDropPreview] = useState<DropPreview | null>(null);

	const beginClipMove = (clipId: string) => (e: React.PointerEvent) => {
		e.stopPropagation();
		e.preventDefault();

		const clip = clips.find((c) => c.id === clipId);
		if (!clip) return;

		setSelectedTrackId(clip.trackId);
		setSelectedClipId(clip.id);

		const downRawBar = clientXToRawBar(e.clientX, bars + 1);

		clipPtrRef.current = {
			clipId,
			pointerId: e.pointerId,
			mode: "move",
			downRawBar,
			startClipBar: clip.startBar,
			clipLenBars: clip.lengthBars,
			startEndBar: clip.startBar + clip.lengthBars,
			startFadeInBars: clip.fadeInBars ?? 0,
			startFadeOutBars: clip.fadeOutBars ?? 0,
			startSourceDurationSec: clip.sourceDurationSec,
		};

		setDraggingClipId(clipId);
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	};

	const beginClipResizeR = (clipId: string) => (e: React.PointerEvent) => {
		e.stopPropagation();
		e.preventDefault();

		const clip = clips.find((c) => c.id === clipId);
		if (!clip) return;

		setSelectedTrackId(clip.trackId);
		setSelectedClipId(clip.id);

		const downRawBar = clientXToRawBar(e.clientX, bars + 1);

		clipPtrRef.current = {
			clipId,
			pointerId: e.pointerId,
			mode: "resizeR",
			downRawBar,
			startClipBar: clip.startBar,
			clipLenBars: clip.lengthBars,
			startEndBar: clip.startBar + clip.lengthBars,
			startFadeInBars: clip.fadeInBars ?? 0,
			startFadeOutBars: clip.fadeOutBars ?? 0,
			startSourceDurationSec: clip.sourceDurationSec,
		};

		setDraggingClipId(clipId);
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	};

	const beginClipStretchR = (clipId: string) => (e: React.PointerEvent) => {
		e.stopPropagation();
		e.preventDefault();
		const clip = clips.find((c) => c.id === clipId);
		if (!clip?.assetId) return;

		setSelectedTrackId(clip.trackId);
		setSelectedClipId(clip.id);
		const downRawBar = clientXToRawBar(e.clientX, bars + 1);
		const asset = findAssetById(clip.assetId);
		const barSecNow = getBarSeconds();
		const inferredSource = Math.min(
			Math.max(0.001, Number(asset?.durationSec || Number.POSITIVE_INFINITY)),
			Math.max(0.001, clip.lengthBars * barSecNow),
		);

		clipPtrRef.current = {
			clipId, pointerId: e.pointerId, mode: "stretchR", downRawBar,
			startClipBar: clip.startBar, clipLenBars: clip.lengthBars,
			startEndBar: clip.startBar + clip.lengthBars,
			startFadeInBars: clip.fadeInBars ?? 0,
			startFadeOutBars: clip.fadeOutBars ?? 0,
			startSourceDurationSec: clip.sourceDurationSec ?? inferredSource,
		};
		setDraggingClipId(clipId);
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	};

	const beginClipFade = (clipId: string, mode: "fadeIn" | "fadeOut") => (e: React.PointerEvent) => {
		e.stopPropagation();
		e.preventDefault();
		const clip = clips.find((c) => c.id === clipId);
		if (!clip?.assetId) return;
		setSelectedTrackId(clip.trackId);
		setSelectedClipId(clip.id);
		clipPtrRef.current = {
			clipId, pointerId: e.pointerId, mode,
			downRawBar: clientXToRawBar(e.clientX, bars + 1),
			startClipBar: clip.startBar, clipLenBars: clip.lengthBars,
			startEndBar: clip.startBar + clip.lengthBars,
			startFadeInBars: clip.fadeInBars ?? 0,
			startFadeOutBars: clip.fadeOutBars ?? 0,
			startSourceDurationSec: clip.sourceDurationSec,
		};
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	};

	const onClipPointerMove = (e: React.PointerEvent) => {
		const st = clipPtrRef.current;
		if (!st || st.pointerId !== e.pointerId) return;

		e.preventDefault();

		const rawNow = clientXToRawBar(e.clientX, bars + 1);
		const deltaBars = rawNow - st.downRawBar;

		// ALT bypasses snap temporarily
		const doSnap = snapEnabled && !e.altKey;

		if (st.mode === "move") {
			let nextStart = st.startClipBar + deltaBars;

			if (doSnap) nextStart = applySnap(nextStart);

			// keep clip inside song bounds (end boundary can reach BARS+1)
			const maxStart = Math.max(1, bars + 1 - st.clipLenBars);
			nextStart = clamp(nextStart, 1, maxStart);

			setClips((prev) => prev.map((c) => (c.id === st.clipId ? { ...c, startBar: nextStart } : c)));
			return;
		}

		if (st.mode === "fadeIn") {
			let amount = rawNow - st.startClipBar;
			if (doSnap) amount = Math.round(amount / stepBars) * stepBars;
			amount = clamp(amount, 0, Math.max(0, st.clipLenBars - st.startFadeOutBars));
			setClips((prev) => prev.map((c) => (c.id === st.clipId ? { ...c, fadeInBars: amount } : c)));
			return;
		}

		if (st.mode === "fadeOut") {
			let amount = st.startEndBar - rawNow;
			if (doSnap) amount = Math.round(amount / stepBars) * stepBars;
			amount = clamp(amount, 0, Math.max(0, st.clipLenBars - st.startFadeInBars));
			setClips((prev) => prev.map((c) => (c.id === st.clipId ? { ...c, fadeOutBars: amount } : c)));
			return;
		}

		// Right-edge trim or time-stretch. Trim changes the amount of source audio;
		// stretch changes timeline duration while leaving sourceDurationSec intact.
		let nextEnd = st.startEndBar + deltaBars;
		if (doSnap) nextEnd = applySnap(nextEnd);

		const minLen = doSnap ? stepBars : 0.25;
		let nextLen = nextEnd - st.startClipBar;
		const clipNow = clips.find((c) => c.id === st.clipId);
		const assetNow = clipNow?.assetId ? findAssetById(clipNow.assetId) : undefined;
		const barSecNow = getBarSeconds();

		// MIDI clip edge resizing changes only the clip boundary. Notes/automation are
		// preserved even if temporarily outside the shortened clip.
		if (st.mode === "resizeR" && clipNow && !clipNow.assetId) {
			nextLen = clamp(nextLen, minLen, Math.max(minLen, bars + 1 - st.startClipBar));
			setClips((prev) => prev.map((c) => c.id === st.clipId ? { ...c, lengthBars: nextLen } : c));
			return;
		}

		if (st.mode === "stretchR") {
			const sourceSec = Math.max(0.001, st.startSourceDurationSec ?? st.clipLenBars * barSecNow);
			const naturalBars = sourceSec / Math.max(0.0001, barSecNow);
			const minStretchBars = Math.max(minLen, naturalBars * 0.25);
			const maxStretchBars = Math.min(bars + 1 - st.startClipBar, naturalBars * 4);
			nextLen = clamp(nextLen, minStretchBars, Math.max(minStretchBars, maxStretchBars));
			setClips((prev) => prev.map((c) =>
				c.id === st.clipId
					? { ...c, lengthBars: nextLen, sourceDurationSec: sourceSec }
					: c,
			));
			stretchedBuffersRef.current.delete(st.clipId);
			return;
		}

		let maxLen = bars + 1 - st.startClipBar;
		const sourceOffset = Math.max(0, clipNow?.sourceOffsetSec ?? 0);
		const assetRemainingSec = assetNow?.durationSec
			? Math.max(0.001, assetNow.durationSec - sourceOffset)
			: Number.POSITIVE_INFINITY;
		const oldSourceSec = Math.max(0.001, st.startSourceDurationSec ?? Math.min(assetRemainingSec, st.clipLenBars * barSecNow));
		const oldStretchRatio = (st.clipLenBars * barSecNow) / oldSourceSec;
		if (Number.isFinite(assetRemainingSec)) {
			maxLen = Math.min(maxLen, (assetRemainingSec * oldStretchRatio) / Math.max(0.0001, barSecNow));
		}
		nextLen = clamp(nextLen, minLen, Math.max(minLen, maxLen));
		const nextSourceSec = Math.min(assetRemainingSec, (nextLen * barSecNow) / Math.max(0.001, oldStretchRatio));

		setClips((prev) => prev.map((c) => {
			if (c.id !== st.clipId) return c;
			const fadeIn = Math.min(c.fadeInBars ?? 0, nextLen);
			const fadeOut = Math.min(c.fadeOutBars ?? 0, Math.max(0, nextLen - fadeIn));
			return { ...c, lengthBars: nextLen, sourceDurationSec: nextSourceSec, fadeInBars: fadeIn, fadeOutBars: fadeOut };
		}));
		stretchedBuffersRef.current.delete(st.clipId);
	};

	const endClipPointer = (e: React.PointerEvent) => {
		const st = clipPtrRef.current;
		if (!st || st.pointerId !== e.pointerId) return;

		clipPtrRef.current = null;
		setDraggingClipId(null);

		// The loop scheduler may already have audio queued far ahead. When an audio
		// edit changes its rendered buffer, restart at the current transport position
		// so the user hears the new fade/trim/stretch immediately instead of an old
		// pre-scheduled pass.
		if (isPlaying && (st.mode === "fadeIn" || st.mode === "fadeOut" || st.mode === "stretchR" || st.mode === "resizeR")) {
			stop();
			requestAnimationFrame(() => start(loopEnabled));
		}
	};

	const beginLaneResize = (trackId: string) => (e: React.PointerEvent) => {
		e.stopPropagation();
		e.preventDefault();
		const t = tracks.find((x) => x.id === trackId);
		laneResizeRef.current = {
			trackId,
			pointerId: e.pointerId,
			startY: e.clientY,
			startH: getTrackHeight(trackId, t?.type),
		};
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	};

	const onLaneResizeMove = (e: React.PointerEvent) => {
		const st = laneResizeRef.current;
		if (!st || st.pointerId !== e.pointerId) return;
		e.preventDefault();
		const next = clamp(st.startH + (e.clientY - st.startY), MIN_TRACK_H, 260);
		setTrackHeights((prev) => ({ ...prev, [st.trackId]: next }));
	};

	const endLaneResize = (e: React.PointerEvent) => {
		const st = laneResizeRef.current;
		if (!st || st.pointerId !== e.pointerId) return;
		laneResizeRef.current = null;
	};

	// --- Marker dragging ---
	type DragType = "L" | "R" | "E" | null;
	const dragRef = useRef<DragType>(null);

	const beginDrag = (kind: DragType) => (e: React.PointerEvent) => {
		dragRef.current = kind;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		e.preventDefault();
		e.stopPropagation();
	};

	const onDragMove = (e: React.PointerEvent) => {
		if (!dragRef.current) return;

		const bar = dragRef.current === "E"
			? clientXToBarInEl(e.clientX, rulerInnerRef.current, bars + 1)
			: clientXToBar(e.clientX);

		// keep an ordering gap even when snap is off
		const minGap = snapEnabled ? stepBars : 0.0001;

		if (dragRef.current === "L") {
			const nextL = clamp(bar, 1, loopR - minGap);
			setLoopL(nextL);
			if (loopEnabled && playheadPosBars < nextL) setPlayheadPosBars(nextL);
		} else if (dragRef.current === "R") {
			const nextR = clamp(bar, loopL + minGap, bars);
			setLoopR(nextR);
		} else if (dragRef.current === "E") {
			const nextE = clamp(bar, 1 + minGap, bars + 1);
			setEndBar(nextE);
			setLoopR((r) => Math.min(r, nextE));
			setLoopL((l) => Math.min(l, Math.max(1, nextE - minGap)));
			setPlayheadPosBars((p) => Math.min(p, nextE));
		}
	};

	const endDrag = () => {
		dragRef.current = null;
	};

	const loopLeftPx = barToLeftPx(loopL);
	const loopWidthPx = Math.max(0, barToLeftPx(loopR) - barToLeftPx(loopL));
	const playheadLeftPx = barToLeftPx(playheadPosBars);
	const endLeftPx = barToLeftPx(endBar);

	// --- Add Track menu positioning ---
	const computeAddMenuPos = () => {
		const btn = addBtnRef.current;
		if (!btn) return null;

		const r = btn.getBoundingClientRect();
		const margin = 8;

		let left = r.right + margin;
		if (left + MENU_W > window.innerWidth - margin) {
			left = r.left - MENU_W - margin;
		}
		left = clamp(left, margin, window.innerWidth - MENU_W - margin);

		let top = r.top;
		if (top + MENU_H > window.innerHeight - margin) {
			top = window.innerHeight - MENU_H - margin;
		}
		top = clamp(top, margin, window.innerHeight - MENU_H - margin);

		return { top, left };
	};

	const closeAddMenu = () => {
		setAddMenuOpen(false);
		setAddMenuPos(null);
	};

	const toggleAddMenu = () => {
		setAddMenuOpen((v) => {
			const next = !v;
			if (next) requestAnimationFrame(() => setAddMenuPos(computeAddMenuPos()));
			else setAddMenuPos(null);
			return next;
		});
	};

	const isAudioFile = (f: File) => {
		const t = (f.type || "").toLowerCase();
		if (t.startsWith("audio/")) return true;

		// fallback by extension (some OSes/types are blank)
		const n = (f.name || "").toLowerCase();
		return /\.(wav|mp3|m4a|aac|ogg|flac|webm)$/i.test(n);
	};

	const ensureAudioCtx = () => {
		if (audioCtxRef.current) return audioCtxRef.current;
		audioCtxRef.current = new AudioContext();
		try {
			masterGainRef.current = audioCtxRef.current.createGain();
			masterGainRef.current.gain.value = 1.0;
			masterGainRef.current.connect(audioCtxRef.current.destination);
		} catch {
			masterGainRef.current = null;
		}
		return audioCtxRef.current;
	};

	const trackLevelToGain = (level?: number) => clamp((level ?? 100) / 100, 0, 1.27);

	const computedTrackGain = (track: Track, trackList = tracks) => {
		const anySolo = trackList.some((t) => t.solo);
		const audible = !track.mute && (!anySolo || track.solo);
		return audible ? trackLevelToGain(track.level) : 0;
	};

	const ensureTrackAudioBus = (trackId: string) => {
		const existing = trackAudioBusesRef.current.get(trackId);
		if (existing) return existing;

		const ctx = ensureAudioCtx();
		const gain = ctx.createGain();
		const analyser = ctx.createAnalyser();
		analyser.fftSize = 256;
		analyser.smoothingTimeConstant = 0.65;
		const track = tracks.find((t) => t.id === trackId);
		gain.gain.value = track ? computedTrackGain(track) : 1;
		gain.connect(analyser);
		if (masterGainRef.current) analyser.connect(masterGainRef.current);
		else analyser.connect(ctx.destination);
		const bus = { gain, analyser };
		trackAudioBusesRef.current.set(trackId, bus);
		return bus;
	};

	const syncTrackAudioBuses = (trackList = tracks) => {
		const ctx = audioCtxRef.current;
		if (!ctx) return;
		for (const track of trackList) {
			const bus = trackAudioBusesRef.current.get(track.id);
			if (!bus) continue;
			const target = computedTrackGain(track, trackList);
			bus.gain.gain.cancelScheduledValues(ctx.currentTime);
			bus.gain.gain.setTargetAtTime(target, ctx.currentTime, 0.008);
		}
	};

	useEffect(() => {
		syncTrackAudioBuses(tracks);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [tracks]);

	// Persisted VST assignments are part of the DAW project. Once project state is
	// hydrated, reconcile the native Bridge instances with those assignments.
	useEffect(() => {
		if (!dawHydrated) return;
		const wanted = new Map(
			tracks
				.filter((track) => track.type === "instrument" && !!track.vst3PluginPath)
				.map((track) => [track.id, track.vst3PluginPath!] as const),
		);

		for (const [trackId, loadedPath] of Array.from(vstLoadedRef.current.entries())) {
			if (wanted.get(trackId) === loadedPath) continue;
			vstLoadedRef.current.delete(trackId);
			delete vstMetersRef.current[trackId];
			bridgeApi.unloadVst3Instrument(trackId).catch(() => {});
		}

		for (const track of tracks) {
			if (track.type !== "instrument" || !track.vst3PluginPath) continue;
			if (vstLoadedRef.current.get(track.id) === track.vst3PluginPath) continue;
			void ensureVstLoaded(track).catch(() => {});
		}
		// Catalog refresh is included so a Bridge restart/re-scan naturally gives a
		// persisted project another chance to restore its native instances.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [dawHydrated, activeProjectId, tracks, vst3Plugins]);

	// Mute / solo / level remain the source of truth in the DAW. Mirror them into
	// native VST instances so Bridge audio follows the same mixer rules as WebAudio.
	useEffect(() => {
		const anySolo = tracks.some((track) => track.solo);
		for (const track of tracks) {
			if (track.type !== "instrument" || !track.vst3PluginPath) continue;
			const muted = track.mute || (anySolo && !track.solo);
			bridgeApi.setVst3Mixer(track.id, muted, clamp(track.level ?? 100, 0, 127)).catch(() => {});
		}
	}, [tracks]);

	// Pull native meters/status from Bridge. If Bridge was restarted while YSong
	// stayed open, a missing instance is automatically recreated from project state.
	useEffect(() => {
		const assigned = tracks.filter((track) => track.type === "instrument" && !!track.vst3PluginPath);
		if (assigned.length === 0) {
			vstMetersRef.current = {};
			return;
		}
		let cancelled = false;
		const poll = async () => {
			try {
				const response = await bridgeApi.getVst3Status();
				if (cancelled) return;
				const instances = new Map(response.instances.map((instance) => [instance.trackId, instance] as const));
				const meters: Record<string, number> = {};
				for (const track of assigned) {
					const instance = instances.get(track.id);
					if (instance) {
						meters[track.id] = Math.max(0, instance.peak ?? 0);
						vstLoadedRef.current.set(track.id, track.vst3PluginPath!);
						setVstTrackState((prev) => {
							const nextStatus = instance.error ? { status: "error" as const, message: instance.error } : { status: "ready" as const };
							const current = prev[track.id];
							if (current?.status === nextStatus.status && current?.message === nextStatus.message) return prev;
							return { ...prev, [track.id]: nextStatus };
						});
					} else if (vstLoadedRef.current.get(track.id) === track.vst3PluginPath) {
						vstLoadedRef.current.delete(track.id);
					}
				}
				vstMetersRef.current = meters;

			} catch {
				// Native Bridge may be offline while a project is edited. Keep project
				// assignments intact; they will reconnect when Bridge comes back.
			}
		};
		void poll();
		const timer = window.setInterval(() => { void poll(); }, 140);
		return () => { cancelled = true; window.clearInterval(timer); };
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [tracks]);

	useEffect(() => {
		if (meterRafRef.current != null) cancelAnimationFrame(meterRafRef.current);
		meterRafRef.current = null;

		const hasNativeVst = tracks.some((track) => !!track.vst3PluginPath);
		if (!isPlaying && !hasNativeVst) {
			setTrackMeters((prev) => {
				const next = { ...prev };
				for (const track of tracks) next[track.id] = 0;
				return next;
			});
			return;
		}

		const samples = new Float32Array(256);
		let lastPaint = 0;
		const tickMeter = (now: number) => {
			if (now - lastPaint >= 45) {
				lastPaint = now;
				const next: Record<string, number> = {};
				for (const track of tracks) {
					if (track.vst3PluginPath) {
						const peak = Math.max(1e-6, vstMetersRef.current[track.id] ?? 0);
						const db = 20 * Math.log10(peak);
						next[track.id] = clamp((db + 60) / 60, 0, 1);
						continue;
					}
					if (!isPlaying) {
						next[track.id] = 0;
						continue;
					}
					const bus = trackAudioBusesRef.current.get(track.id);
					if (!bus) {
						next[track.id] = 0;
						continue;
					}
					bus.analyser.getFloatTimeDomainData(samples);
					let sum = 0;
					for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
					const rms = Math.sqrt(sum / samples.length);
					const db = 20 * Math.log10(Math.max(1e-6, rms));
					// Visual meter maps -60 dB..0 dB to 0..1.
					next[track.id] = clamp((db + 60) / 60, 0, 1);
				}
				setTrackMeters(next);
			}
			meterRafRef.current = requestAnimationFrame(tickMeter);
		};
		meterRafRef.current = requestAnimationFrame(tickMeter);
		return () => {
			if (meterRafRef.current != null) cancelAnimationFrame(meterRafRef.current);
			meterRafRef.current = null;
		};
	}, [isPlaying, tracks]);

	const recordingElapsedBars = (session: RecordingSession) => {
		const bpmNow = Math.max(1, bpmRef.current);
		const beatsPerBar = Math.max(1, sigNumRef.current);
		const denominator = Math.max(1, sigDenRef.current);
		const barSec = (60 / bpmNow) * (4 / denominator) * beatsPerBar;
		return Math.max(0, (performance.now() - session.startedAtMs) / 1000 / Math.max(0.0001, barSec));
	};

	const captureRecordedMidi = (kind: "on" | "off", pitchRaw: number, velocityRaw: number, target: Track | null) => {
		const session = recordingSessionRef.current;
		if (!session || !target || session.trackId !== target.id) return;
		const pitch = clamp(Math.round(pitchRaw), 0, 127);
		const velocity = clamp(Math.round(velocityRaw), 1, 127);
		const atBars = recordingElapsedBars(session);
		if (kind === "on") {
			// Retriggering the same pitch closes the old held note before starting another.
			const prior = session.active.get(pitch);
			if (prior) {
				const lengthBars = Math.max(1 / 128, atBars - prior.startBars);
				setClips((prev) => prev.map((c) => c.id === session.clipId ? { ...c, midiNotes: [...(c.midiNotes ?? []), { id: prior.id, pitch, startBars: prior.startBars, lengthBars, velocity: prior.velocity }], lengthBars: Math.max(c.lengthBars, atBars + 1 / 32) } : c));
			}
			session.active.set(pitch, { id: crypto.randomUUID(), startBars: atBars, velocity });
			return;
		}
		const held = session.active.get(pitch);
		if (!held) return;
		session.active.delete(pitch);
		const lengthBars = Math.max(1 / 128, atBars - held.startBars);
		setClips((prev) => prev.map((c) => c.id === session.clipId ? { ...c, midiNotes: [...(c.midiNotes ?? []), { id: held.id, pitch, startBars: held.startBars, lengthBars, velocity: held.velocity }], lengthBars: Math.max(c.lengthBars, atBars + 1 / 32) } : c));
	};

	// Live performance follows selection, period. Arm is a recording state, not an
	// excuse to make an unselected synth play. "All Inputs" means every enabled
	// hardware MIDI device may feed THIS selected instrument track.
	const selectedMidiTarget = tracks.find((t) => t.id === selectedTrackId && t.type === "instrument") ?? null;
	const currentMidiTargetTrack = () => selectedMidiTarget;

	const liveNoteKey = (trackId: string, pitch: number) => `${trackId}:${pitch}`;

	const releaseLiveGmVoice = (voice: LiveGmVoice, fast = false) => {
		const now = voice.gain.context.currentTime;
		const release = fast ? 0.045 : Math.max(0.06, Math.min(0.7, voice.release));
		try {
			voice.gain.gain.cancelScheduledValues(now);
			voice.gain.gain.setTargetAtTime(0.0001, now, Math.max(0.008, release / 5));
		} catch {}
		for (const osc of voice.sources) {
			try { osc.stop(now + release + 0.03); } catch {}
		}
		try { voice.lfo?.stop(now + release + 0.03); } catch {}
	};

	const liveMidiNoteOn = (pitch: number, velocity = 96, targetOverride?: Track | null) => {
		const target = targetOverride ?? currentMidiTargetTrack();
		if (!target) return;
		const normalizedPitch = clamp(Math.round(pitch), 0, 127);
		const normalizedVelocity = clamp(Math.round(velocity), 1, 127);
		const key = liveNoteKey(target.id, normalizedPitch);
		captureRecordedMidi("on", normalizedPitch, normalizedVelocity, target);

		if (target.vst3PluginPath) {
			const noteId = stablePositiveInt(`${target.id}:live:${normalizedPitch}:${Date.now()}:${Math.random()}`);
			liveVstNoteIdsRef.current.set(key, noteId);
			void ensureVstLoaded(target)
				.then(() => bridgeApi.scheduleVst3Midi(target.id, [{ kind: "on", note: normalizedPitch, velocity: normalizedVelocity, noteId, whenUnixMs: Date.now() + 4, isLive: true }]))
				.catch(() => {});
			return;
		}

		// Replace an already-held browser voice for the same track/pitch cleanly.
		const existing = liveGmVoicesRef.current.get(key);
		if (existing) {
			releaseLiveGmVoice(existing, true);
			liveGmVoicesRef.current.delete(key);
		}

		const ctx = ensureAudioCtx();
		void ctx.resume().catch(() => {});
		const now = ctx.currentTime;
		const voice = createGmPreviewVoice(
			ctx,
			normalizeGmProgram(target.gmProgram ?? 0),
			midiToFrequency(normalizedPitch),
			normalizedVelocity,
			ensureTrackAudioBus(target.id).gain,
			now,
		);
		liveGmVoicesRef.current.set(key, { ...voice, trackId: target.id });
	};

	const liveMidiNoteOff = (pitch: number, targetOverride?: Track | null) => {
		const target = targetOverride ?? currentMidiTargetTrack();
		if (!target) return;
		const normalizedPitch = clamp(Math.round(pitch), 0, 127);
		const key = liveNoteKey(target.id, normalizedPitch);
		captureRecordedMidi("off", normalizedPitch, 1, target);

		if (target.vst3PluginPath) {
			const noteId = liveVstNoteIdsRef.current.get(key);
			liveVstNoteIdsRef.current.delete(key);
			if (noteId != null) void bridgeApi.scheduleVst3Midi(target.id, [{ kind: "off", note: normalizedPitch, velocity: 0, noteId, whenUnixMs: Date.now() + 2, isLive: true }]).catch(() => {});
			return;
		}

		const voice = liveGmVoicesRef.current.get(key);
		if (!voice) return;
		liveGmVoicesRef.current.delete(key);
		releaseLiveGmVoice(voice, false);
	};

	const panicLiveMidi = () => {
		for (const [key, voice] of liveGmVoicesRef.current) {
			releaseLiveGmVoice(voice, true);
			liveGmVoicesRef.current.delete(key);
		}
		liveVstNoteIdsRef.current.clear();
		setHardwareActiveNotes(new Set());
		void bridgeApi.midiPanic().catch(() => {});
	};

	const previewMidiNote = (pitch: number, velocity = 96) => {
		const target = currentMidiTargetTrack();
		if (!target) return;
		liveMidiNoteOn(pitch, velocity, target);
		window.setTimeout(() => liveMidiNoteOff(pitch, target), 420);
	};

	const previousLiveTargetIdRef = useRef<string | null>(null);
	useEffect(() => {
		const previousId = previousLiveTargetIdRef.current;
		const nextId = selectedMidiTarget?.id ?? null;
		if (previousId && previousId !== nextId) {
			// Release browser-generated GM voices belonging to the track we just left.
			for (const [key, voice] of liveGmVoicesRef.current) {
				if (voice.trackId !== previousId) continue;
				releaseLiveGmVoice(voice, true);
				liveGmVoicesRef.current.delete(key);
			}

			// YSong's on-screen keys schedule VST notes through HTTP rather than the native
			// hardware route, so explicitly release those held notes as selection moves.
			for (const [key, noteId] of liveVstNoteIdsRef.current) {
				if (!key.startsWith(`${previousId}:`)) continue;
				const pitch = Number(key.slice(key.lastIndexOf(":") + 1));
				if (Number.isFinite(pitch)) void bridgeApi.scheduleVst3Midi(previousId, [{ kind: "off", note: clamp(pitch, 0, 127), velocity: 0, noteId, whenUnixMs: Date.now() + 2, isLive: true }]).catch(() => {});
				liveVstNoteIdsRef.current.delete(key);
			}
			setHardwareActiveNotes(new Set());
		}
		previousLiveTargetIdRef.current = nextId;
	}, [selectedMidiTarget?.id]);

	// Tell the native Bridge which ONE YSong instrument track owns hardware MIDI.
	// Selecting an audio track (or no track) clears the native route completely.
	useEffect(() => {
		void bridgeApi.setMidiRoute(selectedMidiTarget?.id ?? null, selectedMidiTarget?.midiInputName ?? null).catch(() => {});
	}, [selectedMidiTarget?.id, selectedMidiTarget?.midiInputName]);

	// Clear the native route only when the DAW itself unmounts. Do not clear/re-add the
	// route on every ordinary track-state render; those tiny gaps can drop live notes.
	useEffect(() => () => { void bridgeApi.setMidiRoute(null, null).catch(() => {}); }, []);

	// Native hardware MIDI arrives as an SSE monitor stream. Bridge routes note events
	// directly into loaded VST3 instances for low latency; browser-GM tracks are played
	// here so the exact same LPK25/LPD8 input can drive either renderer.
	useEffect(() => {
		const target = currentMidiTargetTrack();
		return bridgeApi.subscribeMidiEvents((event: BridgeMidiEvent) => {
			if (event.note == null || (event.kind !== "noteon" && event.kind !== "noteoff")) return;
			if (target?.midiInputName && event.device.toLowerCase() !== target.midiInputName.toLowerCase()) return;
			const note = clamp(event.note, 0, 127);
			setHardwareActiveNotes((prev) => {
				const next = new Set(prev);
				if (event.kind === "noteon") next.add(note); else next.delete(note);
				return next;
			});
			if (!target) return;
			if (target.vst3PluginPath) {
				// Native Bridge already feeds VST3 directly; only mirror the performance
				// into the recorder/UI here so we do not double-trigger the synth.
				captureRecordedMidi(event.kind === "noteon" ? "on" : "off", note, event.velocity ?? 1, target);
				return;
			}
			if (event.kind === "noteon") liveMidiNoteOn(note, event.velocity ?? 96, target);
			else liveMidiNoteOff(note, target);
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selectedMidiTarget?.id, selectedMidiTarget?.midiInputName, selectedMidiTarget?.vst3PluginPath]);

	const finishMidiRecording = () => {
		const session = recordingSessionRef.current;
		if (!session) return;
		const atBars = recordingElapsedBars(session);
		const pending = [...session.active.entries()];
		session.active.clear();
		if (pending.length) {
			setClips((prev) => prev.map((c) => {
				if (c.id !== session.clipId) return c;
				const notes = [...(c.midiNotes ?? [])];
				for (const [pitch, held] of pending) notes.push({ id: held.id, pitch, startBars: held.startBars, lengthBars: Math.max(1 / 128, atBars - held.startBars), velocity: held.velocity });
				return { ...c, midiNotes: notes, lengthBars: Math.max(c.lengthBars, atBars + 1 / 32) };
			}));
		}
		recordingSessionRef.current = null;
		setIsRecording(false);
	};

	const toggleMidiRecording = () => {
		if (recordingSessionRef.current) {
			finishMidiRecording();
			return;
		}
		const target = currentMidiTargetTrack();
		if (!target) {
			window.alert("Select an Instrument Track before recording MIDI.");
			return;
		}
		const clipId = crypto.randomUUID();
		const startBar = playheadPosBars;
		const clip: Clip = {
			id: clipId,
			trackId: target.id,
			name: "MIDI Recording",
			startBar,
			lengthBars: 1 / 4,
			midiNotes: [],
			midiPitchBend: [],
			midiModulation: [],
			midiBendRange: 12,
		};
		recordingSessionRef.current = { clipId, trackId: target.id, startedAtMs: performance.now(), startBar, active: new Map() };
		setClips((prev) => [...prev, clip]);
		setSelectedTrackId(target.id);
		setSelectedClipId(clipId);
		setTracks((prev) => prev.map((t) => t.id === target.id ? { ...t, arm: true } : t));
		setIsRecording(true);
		if (!isPlaying) start(loopEnabled);
	};

	const decodeDurationSec = async (file: File) => {
		const ctx = ensureAudioCtx();
		const ab = await file.arrayBuffer();
		// decodeAudioData can mutate the buffer in some browsers; slice() keeps it safe
		const audioBuf = await ctx.decodeAudioData(ab.slice(0));
		return audioBuf.duration;
	};

	const durationSecToBars = (sec: number) => {
		const bpmNow = Math.max(1, bpmRef.current);
		const n = Math.max(1, sigNumRef.current);
		const d = Math.max(1, sigDenRef.current);

		const beatSec = (60 / bpmNow) * (4 / d);
		const barSec = beatSec * n;

		return sec / Math.max(0.0001, barSec);
	};

	const updateDropPreviewForLane = (trackId: string, e: React.DragEvent<HTMLDivElement>) => {
		const track = tracks.find((t) => t.id === trackId);
		if (track?.type !== "audio") return;

		const types = Array.from(e.dataTransfer.types || []);
		const hasInternal = types.includes("application/x-ysong-asset");
		const hasFiles = types.includes("Files");
		if (!hasInternal && !hasFiles) return;

		e.preventDefault();
		e.stopPropagation();
		e.dataTransfer.dropEffect = hasInternal ? "link" : "copy";

		const laneEl = e.currentTarget as HTMLElement;
		const startBar = clientXToBarInEl(e.clientX, laneEl, bars);
		const payload = hasInternal ? ((window as any).__ysongDragAsset || {}) : {};
		const file = e.dataTransfer.files?.[0];
		const name = String(payload?.name || file?.name || "Audio");

		let lengthBars = 2;
		const dur = Number(payload?.durationSec || 0);
		if (Number.isFinite(dur) && dur > 0) lengthBars = durationSecToBars(dur);
		// SNAP controls placement. It must never silently time-stretch an imported
		// recording just to force its natural end onto the grid.
		lengthBars = clamp(lengthBars, 0.01, Math.max(0.01, bars + 1 - startBar));
		setDropPreview({ trackId, startBar, lengthBars, name });
	};

	const clearDropPreviewOnLeave = (e: React.DragEvent<HTMLDivElement>) => {
		const next = e.relatedTarget as Node | null;
		if (next && e.currentTarget.contains(next)) return;
		setDropPreview(null);
	};

	useEffect(() => {
		const clear = () => setDropPreview(null);
		window.addEventListener("dragend", clear);
		window.addEventListener("ysong:asset-drag-end", clear);
		return () => {
			window.removeEventListener("dragend", clear);
			window.removeEventListener("ysong:asset-drag-end", clear);
		};
	}, []);

	// Drop audio onto an AUDIO track lane → create asset + clip (length from decode)
	const onDropAudioOnTrack = (trackId: string) => async (e: React.DragEvent<HTMLDivElement>) => {
		let track = tracks.find((t) => t.id === trackId);
		if (!track) {
			const audioCount = tracks.filter((t) => t.type === "audio").length + 1;
			const newTrack = mkTrack("audio", audioCount, trackId);
			setTracks((prev) => (prev.some((t) => t.id === trackId) ? prev : [...prev, newTrack]));
			setTrackHeights((prev) => ({ ...prev, [trackId]: prev[trackId] ?? 96 }));
			track = newTrack;
		}
		if (track.type !== "audio") return;

		e.preventDefault();
		e.stopPropagation();
		setDropPreview(null);

		// Internal YSong asset drag (from drawers)
		const raw = e.dataTransfer.getData("application/x-ysong-asset");
		if (raw) {
			try {
				const payload = JSON.parse(raw);
				if (payload && (payload.kind === "audio" || payload.type === "audio")) {
					// capture needed event data BEFORE awaits
					const clientX = e.clientX;
					const laneEl = e.currentTarget as HTMLElement;
					setSelectedTrackId(trackId);
					const cursorStart = clientXToBarInEl(clientX, laneEl, bars);


					// Project Assets reference the SAME backing object as the global Asset Drawer.
					const objectKeyToUse: string | undefined = payload.objectKey;
					const assetId = objectKeyToUse || payload.id || crypto.randomUUID();
					const clipId = crypto.randomUUID();

					// Ensure Project drawer sees it too (best-effort)
					try {
						const setGlobal = (window as any).__ysongSetProjectAssets;
						if (typeof setGlobal === "function") {
							setGlobal((prev: any[]) => {
								if (prev?.some((p) => p.id === assetId || p.objectKey === objectKeyToUse)) return prev;
								return [
									...(prev || []),
									{
										id: assetId,
										kind: "audio",
										name: payload.name || "Audio",
										objectKey: objectKeyToUse,
										sourceObjectKey: objectKeyToUse,
										sizeMB: typeof payload.sizeMB === "number" ? payload.sizeMB : undefined,
										durationSec: typeof payload.durationSec === "number" ? payload.durationSec : undefined,
										url: objectKeyToUse ? undefined : (payload.publicUrl ?? payload.url),
									},
								];
							});
						}
					} catch {}

					// Add locally too
					setProjectAssets((prev) => {
						if (prev.some((a) => a.id === assetId || (objectKeyToUse && a.objectKey === objectKeyToUse)))
							return prev;
						return [
							...prev,
							{
								id: assetId,
								kind: "audio",
								name: payload.name || "Audio",
								objectKey: objectKeyToUse,
								sourceObjectKey: objectKeyToUse,
								url: objectKeyToUse ? undefined : (payload.publicUrl ?? payload.url),
								sizeMB: typeof payload.sizeMB === "number" ? payload.sizeMB : undefined,
								durationSec: typeof payload.durationSec === "number" ? payload.durationSec : undefined,
							},
						];
					});

					const clipStart = cursorStart;
					const knownDur = Number(payload.durationSec || 0);
					const naturalInitBars = Number.isFinite(knownDur) && knownDur > 0 ? durationSecToBars(knownDur) : 2;
					const initLen = clamp(naturalInitBars, 0.01, Math.max(0.01, bars + 1 - cursorStart));
					setClips((prev) => [
						...prev,
						{
							id: clipId,
							trackId,
							assetId,
							name: payload.name || "Audio",
							startBar: clipStart,
							lengthBars: initLen,
							sourceOffsetSec: 0,
							sourceDurationSec: Number(payload.durationSec || 0) > 0 ? Number(payload.durationSec) : undefined,
							fadeInBars: 0,
							fadeOutBars: 0,
						},
					]);
					setSelectedClipId(clipId);

					// Resolve duration if missing
					(async () => {
						let durSec = Number(payload.durationSec || 0);
						if (!Number.isFinite(durSec) || durSec <= 0) {
							try {
								const buf = await ensureBufferForAsset(assetId);
								durSec = buf.duration;
							} catch {}
						}
						if (durSec > 0) {
							setProjectAssets((prev) =>
								prev.map((a) => (a.id === assetId ? { ...a, durationSec: durSec } : a)),
							);
							const rawBarsLen = durationSecToBars(durSec);
							const nextLen = Math.max(0.01, rawBarsLen);
							setBars((prev) => Math.min(MAX_BARS, Math.max(prev, Math.ceil(clipStart + nextLen + 8))));
							setClips((prev) => prev.map((c) => (c.id === clipId ? { ...c, lengthBars: nextLen, sourceDurationSec: durSec } : c)));
						}
					})();

					return; // handled
				}
			} catch {
				// fall through to file drop
			}
		}

		const files = Array.from(e.dataTransfer.files).filter(isAudioFile);
		if (!files.length) return;

		// capture needed event data BEFORE awaits
		const clientX = e.clientX;
		const laneEl = e.currentTarget as HTMLElement;

		setSelectedTrackId(trackId);

		// start position (uses your snap)
		let cursorStart = clientXToBarInEl(clientX, laneEl, bars);


		for (const file of files) {
			const clipId = crypto.randomUUID();
			const sizeMB = file.size / (1024 * 1024);
			let objectKey: string | undefined;
			let url: string | undefined;
			let assetId: string = crypto.randomUUID();

			try {
				const uploaded = await uploadFileToCloud(file);
				objectKey = String(uploaded?.objectKey || "") || undefined;
				if (objectKey) assetId = objectKey;
			} catch {
				// Local-only fallback if the upload API is unavailable.
				url = URL.createObjectURL(file);
			}

			const projectAsset: ProjectAsset = {
				id: assetId,
				kind: "audio",
				name: file.name,
				objectKey,
				sourceObjectKey: objectKey,
				url: objectKey ? undefined : url,
				sizeMB,
			};

			setProjectAssets((prev) => {
				if (prev.some((a) => a.id === assetId || (!!objectKey && a.objectKey === objectKey))) return prev;
				return [...prev, projectAsset];
			});

			// Direct DAW imports are also global assets. The project references the
			// exact same upload instead of creating a second file.
			window.dispatchEvent(
				new CustomEvent("ysong:global-asset-added", {
					detail: {
						id: assetId,
						name: file.name,
						sizeMB,
						type: "audio",
						objectKey,
						publicUrl: objectKey ? undefined : url,
						addedAt: Date.now(),
					},
				}),
			);

			// optimistic initial length (real audio, just unknown duration yet)
			const maxLenInit = bars + 1 - cursorStart;
			const initLen = clamp(2, 0.25, Math.max(0.25, maxLenInit));

			const clipStart = cursorStart;

			setClips((prev) => [
				...prev,
				{
					id: clipId,
					trackId,
					assetId,
					name: file.name,
					startBar: clipStart,
					lengthBars: initLen,
					sourceOffsetSec: 0,
					fadeInBars: 0,
					fadeOutBars: 0,
				},
			]);

			setSelectedClipId(clipId);

			// decode duration → preserve the natural audio duration in bars
			decodeDurationSec(file)
				.then((sec) => {
					setProjectAssets((prev) => prev.map((a) => (a.id === assetId ? { ...a, durationSec: sec } : a)));

					const rawBarsLen = durationSecToBars(sec);
					const nextLen = Math.max(0.01, rawBarsLen);
					setBars((prev) => Math.min(MAX_BARS, Math.max(prev, Math.ceil(clipStart + nextLen + 8))));

					setClips((prev) => prev.map((c) => (c.id === clipId ? { ...c, lengthBars: nextLen, sourceDurationSec: sec } : c)));
				})
				.catch(() => {
					// unsupported decode or browser limitation: keep initLen
				});

			// advance cursor so multi-file drops line up sequentially
			cursorStart = clamp(clipStart + initLen, 1, bars);
		}
	};

	useEffect(() => {
		setDawHydrated(false);
		const data = safeParse<DawPersistV1>(localStorage.getItem(DAW_STORAGE_KEY));
		if (!data || data.v !== 1) {
			// New/empty project: reset to defaults
			if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
			setIsPlaying(false);
			stopScheduledAudio();
			setTracks([]);
			setClips([]);
			setProjectAssets([]);
			setSelectedTrackId(null);
			setSelectedClipId(null);
			setSnapEnabled(true);
			setGridValue("bar");
			setGridMode("absolute");
			setZoomPct(100);
			setPlayheadPosBars(1);
			setLoopL(1);
			setLoopR(5);
			setEndBar(DEFAULT_END_BAR);
			setBars(MIN_BARS);
			setLoopEnabled(false);
			setBpm(120);
			setSigNum(4);
			setSigDen(4);
			setDawHydrated(true);
			return;
		}

		// Never auto-resume playback on restore
		if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
		rafRef.current = null;
		setIsPlaying(false);

		const restoredTracks = (data.tracks ?? []).map((t) => ({ ...t, level: clamp(t.level ?? 100, 0, 127) }));
		setTracks(restoredTracks);
		setClips(data.clips ?? []);
		setProjectAssets((data.projectAssets ?? []).map(normalizeProjectAssetForPersist));
		const restoredHeights: Record<string, number> = {};
		for (const t of restoredTracks) {
			const saved = data.trackHeights?.[t.id];
			restoredHeights[t.id] = Math.max(MIN_TRACK_H, saved ?? ROW_H);
		}
		setTrackHeights(restoredHeights);

		setSelectedTrackId(data.selectedTrackId ?? data.tracks?.[0]?.id ?? null);
		setSelectedClipId(data.selectedClipId ?? null);

		setSnapEnabled(!!data.snapEnabled);
		setGridValue((data.gridValue as GridValue) ?? "bar");
		setGridMode((data.gridMode as GridMode) ?? "absolute");
		setZoomPct(clamp(data.zoomPct ?? 100, MIN_ZOOM_PCT, MAX_ZOOM_PCT));

		setPlayheadPosBars(data.playheadPosBars ?? 1);
		setLoopL(data.loopL ?? 1);
		setLoopR(data.loopR ?? 5);
		setEndBar(data.endBar === 17 ? DEFAULT_END_BAR : (data.endBar ?? DEFAULT_END_BAR));
		setBars(MIN_BARS);
		setLoopEnabled(!!data.loopEnabled);

		setBpm(clamp(data.bpm ?? 120, 20, 400));
		setSigNum(data.sigNum ?? 4);
		setSigDen(data.sigDen ?? 4);
		setDawHydrated(true);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [DAW_STORAGE_KEY]);

	useEffect(() => {
		const payload: DawPersistV1 = {
			v: 1,
			tracks,
			clips,
			projectAssets: projectAssets.map(normalizeProjectAssetForPersist),
			selectedTrackId,
			selectedClipId,

			snapEnabled,
			gridValue,
			gridMode,
			zoomPct,

			playheadPosBars,
			loopL,
			loopR,
			endBar,
			loopEnabled,

			bpm,
			sigNum,
			sigDen,
			trackHeights,
		};

		setIsSavingUi(true);
		const t = window.setTimeout(() => {
			try {
				localStorage.setItem(DAW_STORAGE_KEY, JSON.stringify(payload));
				upsertProjectMeta(activeProjectId, projectName);
			} catch {
				// ignore quota / serialization issues for now
			}
			setIsSavingUi(false);
		}, 150);

		return () => window.clearTimeout(t);
	}, [
		DAW_STORAGE_KEY,
		tracks,
		clips,
		projectAssets,
		trackHeights,
		selectedTrackId,
		selectedClipId,
		snapEnabled,
		gridValue,
		gridMode,
		zoomPct,
		playheadPosBars,
		loopL,
		loopR,
		endBar,
		loopEnabled,
		bpm,
		sigNum,
		sigDen,
	]);


	// ---------------------------------------------------------------------
	// Linear DAW undo/redo history
	// ---------------------------------------------------------------------
	// Pre-alpha implementation stores serializable project snapshots. It is
	// intentionally uncapped so Ctrl+Z can walk back through a long session.
	// Continuous pointer edits are debounced into one history step (dragging a
	// clip/fader should not create hundreds of undo entries). A future command/
	// delta history can reduce memory without changing this user-facing model.
	type DawHistorySnapshot = {
		tracks: Track[];
		clips: Clip[];
		projectAssets: ProjectAsset[];
		projectName: string;
		loopL: number;
		loopR: number;
		endBar: number;
		loopEnabled: boolean;
		bpm: number;
		sigNum: number;
		sigDen: number;
	};
	type DawHistoryEntry = { hash: string; state: DawHistorySnapshot };
	const historyRef = useRef<DawHistoryEntry[]>([]);
	const historyIndexRef = useRef(-1);
	const historyProjectRef = useRef("");
	const historyTimerRef = useRef<number | null>(null);
	const applyingHistoryHashRef = useRef<string | null>(null);
	const [, setHistoryRevision] = useState(0);

	const cloneHistoryState = (state: DawHistorySnapshot): DawHistorySnapshot => {
		try {
			return structuredClone(state);
		} catch {
			return JSON.parse(JSON.stringify(state)) as DawHistorySnapshot;
		}
	};

	const captureHistoryState = (): DawHistorySnapshot => ({
		tracks,
		clips,
		projectAssets,
		projectName,
		loopL,
		loopR,
		endBar,
		loopEnabled,
		bpm,
		sigNum,
		sigDen,
	});

	const historyHash = (state: DawHistorySnapshot) => JSON.stringify(state);

	const pushCurrentHistory = () => {
		if (!dawHydrated) return;
		if (historyTimerRef.current != null) {
			window.clearTimeout(historyTimerRef.current);
			historyTimerRef.current = null;
		}
		const state = cloneHistoryState(captureHistoryState());
		const hash = historyHash(state);
		const current = historyRef.current[historyIndexRef.current];
		if (current?.hash === hash) return;

		// A new action after Undo abandons the old redo branch, matching normal DAWs.
		const next = historyRef.current.slice(0, historyIndexRef.current + 1);
		next.push({ hash, state });
		historyRef.current = next;
		historyIndexRef.current = next.length - 1;
		setHistoryRevision((v) => v + 1);
	};

	useEffect(() => {
		if (!dawHydrated) return;
		const state = cloneHistoryState(captureHistoryState());
		const hash = historyHash(state);

		if (historyProjectRef.current !== activeProjectId || historyRef.current.length === 0) {
			historyProjectRef.current = activeProjectId;
			historyRef.current = [{ hash, state }];
			historyIndexRef.current = 0;
			applyingHistoryHashRef.current = null;
			setHistoryRevision((v) => v + 1);
			return;
		}

		// Undo/redo itself must never be recorded as a brand new action.
		if (applyingHistoryHashRef.current === hash) {
			applyingHistoryHashRef.current = null;
			return;
		}

		if (historyTimerRef.current != null) window.clearTimeout(historyTimerRef.current);
		historyTimerRef.current = window.setTimeout(() => pushCurrentHistory(), 280);
		return () => {
			if (historyTimerRef.current != null) window.clearTimeout(historyTimerRef.current);
		};
		// Selection, zoom, scrolling, snap/grid choice and playhead movement are view/
		// workflow state, not destructive musical edits, so they are not history steps.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [dawHydrated, activeProjectId, tracks, clips, projectAssets, projectName, loopL, loopR, endBar, loopEnabled, bpm, sigNum, sigDen]);

	const applyHistoryEntry = (entry: DawHistoryEntry) => {
		stop();
		applyingHistoryHashRef.current = entry.hash;
		const state = cloneHistoryState(entry.state);
		setTracks(state.tracks);
		setClips(state.clips);
		setProjectAssets(state.projectAssets);
		setProjectName(state.projectName);
		setLoopL(state.loopL);
		setLoopR(state.loopR);
		setEndBar(state.endBar);
		setLoopEnabled(state.loopEnabled);
		setBpm(state.bpm);
		setSigNum(state.sigNum);
		setSigDen(state.sigDen);
		setSelectedTrackId((id) => id && state.tracks.some((t) => t.id === id) ? id : (state.tracks[0]?.id ?? null));
		setSelectedClipId((id) => id && state.clips.some((c) => c.id === id) ? id : null);
		setMidiEditorClipId((id) => id && state.clips.some((c) => c.id === id) ? id : null);
	};

	const undo = () => {
		pushCurrentHistory();
		if (historyIndexRef.current <= 0) return;
		historyIndexRef.current -= 1;
		applyHistoryEntry(historyRef.current[historyIndexRef.current]);
		setHistoryRevision((v) => v + 1);
	};

	const redo = () => {
		pushCurrentHistory();
		if (historyIndexRef.current < 0 || historyIndexRef.current >= historyRef.current.length - 1) return;
		historyIndexRef.current += 1;
		applyHistoryEntry(historyRef.current[historyIndexRef.current]);
		setHistoryRevision((v) => v + 1);
	};

	const canUndo = historyIndexRef.current > 0;
	const canRedo = historyIndexRef.current >= 0 && historyIndexRef.current < historyRef.current.length - 1;

	useEffect(() => {
		if (!addMenuOpen) return;

		const onDown = (e: PointerEvent) => {
			const t = e.target as Node | null;
			if (!t) return;

			if (addBtnRef.current?.contains(t)) return;
			if (addMenuRef.current?.contains(t)) return;

			closeAddMenu();
		};

		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") closeAddMenu();
		};

		const onReposition = () => {
			setAddMenuPos(computeAddMenuPos());
		};

		const closeOnScroll = () => closeAddMenu();

		window.addEventListener("pointerdown", onDown);
		window.addEventListener("keydown", onKey);
		window.addEventListener("resize", onReposition);
		window.addEventListener("scroll", onReposition, true);

		const tr = trackScrollRef.current;
		const tl = timelineRef.current;
		tr?.addEventListener("scroll", closeOnScroll, { passive: true } as any);
		tl?.addEventListener("scroll", closeOnScroll, { passive: true } as any);

		return () => {
			window.removeEventListener("pointerdown", onDown);
			window.removeEventListener("keydown", onKey);
			window.removeEventListener("resize", onReposition);
			window.removeEventListener("scroll", onReposition, true);

			tr?.removeEventListener("scroll", closeOnScroll as any);
			tl?.removeEventListener("scroll", closeOnScroll as any);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [addMenuOpen]);

	useEffect(() => {
		bpmRef.current = bpm;
		sigNumRef.current = sigNum;
		sigDenRef.current = sigDen;
	}, [bpm, sigNum, sigDen]);

	// Keep selection sane if tracks change
	useEffect(() => {
		if (!tracks.length) {
			setSelectedTrackId(null);
			setSelectedClipId(null);
			return;
		}

		if (selectedTrackId && tracks.some((t) => t.id === selectedTrackId)) return;

		setSelectedTrackId(tracks[0]?.id ?? null);
		setSelectedClipId(null);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [tracks]);

	const addClip = (trackId: string, startBar: number) => {
		const track = tracks.find((t) => t.id === trackId);
		const baseName = track?.type === "instrument" ? "MIDI Clip" : "Audio Clip";

		const snappedStart = clamp(Math.round(startBar), 1, bars);
		const desiredLen = 2;
		const safeLen = clamp(desiredLen, 1, bars - snappedStart + 1);

		const id = crypto.randomUUID();
		const nextClip: Clip = {
			id,
			trackId,
			name: baseName,
			startBar: snappedStart,
			lengthBars: safeLen,
			...(track?.type === "instrument"
				? { midiNotes: [], midiPitchBend: [], midiModulation: [], midiBendRange: 12, midiScales: [{ id: crypto.randomUUID(), root: 9, scaleId: "natural-minor" as const }], midiScaleLock: "soft" as MidiScaleLock }
				: {}),
		};
		setClips((prev) => [...prev, nextClip]);
		setSelectedTrackId(trackId);
		setSelectedClipId(id);
		if (track?.type === "instrument") requestAnimationFrame(() => setMidiEditorClipId(id));
	};

	const getBarSeconds = () => {
		const beatSec = (60 / Math.max(1, bpmRef.current)) * (4 / Math.max(1, sigDenRef.current));
		return beatSec * Math.max(1, sigNumRef.current);
	};

	const stopScheduledAudio = () => {
		audioScheduleGenerationRef.current += 1;
		bridgeApi.stopVst3().catch(() => {});
		if (loopSchedulerTimerRef.current != null) {
			window.clearInterval(loopSchedulerTimerRef.current);
			loopSchedulerTimerRef.current = null;
		}
		loopSchedulerBusyRef.current = false;
		try {
			for (const s of activeSourcesRef.current) {
				try {
					s.stop();
				} catch {}
			}
		} finally {
			activeSourcesRef.current = [];
			activeClipSourcesRef.current.clear();
		}
	};

	const registerActiveSource = (source: AudioScheduledSourceNode, clipId?: string) => {
		activeSourcesRef.current.push(source);
		if (clipId) {
			let set = activeClipSourcesRef.current.get(clipId);
			if (!set) {
				set = new Set<AudioScheduledSourceNode>();
				activeClipSourcesRef.current.set(clipId, set);
			}
			set.add(source);
		}
		const cleanup = () => {
			const i = activeSourcesRef.current.indexOf(source);
			if (i >= 0) activeSourcesRef.current.splice(i, 1);
			if (clipId) {
				const set = activeClipSourcesRef.current.get(clipId);
				set?.delete(source);
				if (set && set.size === 0) activeClipSourcesRef.current.delete(clipId);
			}
		};
		try { source.addEventListener("ended", cleanup, { once: true }); } catch {}
	};

	const getSignedPlayUrl = async (objectKey: string) => {
		const now = Date.now();
		const cached = signedUrlCacheRef.current.get(objectKey);
		if (cached && cached.expiresAt > now + 60_000) return cached.url;
		const s = await fetchSignedUrl(objectKey, "play");
		signedUrlCacheRef.current.set(objectKey, s);
		return s.url;
	};

	const findAssetById = (id: string): ProjectAsset | undefined => {
		const local = projectAssets.find((a) => a.id === id);
		if (local) return local;
		try {
			const globalList = (window as any).__ysongProjectAssets as any;
			if (Array.isArray(globalList)) {
				const hit = globalList.find((a: any) => a.id === id || a.objectKey === id);
				if (hit) return hit as ProjectAsset;
			}
		} catch {}
		return undefined;
	};

	const ensureBufferForAsset = async (assetId: string) => {
		const existing = audioBuffersRef.current.get(assetId);
		if (existing) return existing;

		const ctx = ensureAudioCtx();
		await ctx.resume().catch(() => {});

		const asset =
			findAssetById(assetId) || ({ id: assetId, kind: "audio", name: assetId, objectKey: assetId } as any);

		let url = asset.url;
		if (!url && asset.objectKey) {
			url = await getSignedPlayUrl(asset.objectKey);
		}

		if (!url) throw new Error("no_url");

		const ab = await fetch(url).then((r) => r.arrayBuffer());
		const buf = await ctx.decodeAudioData(ab.slice(0));
		audioBuffersRef.current.set(assetId, buf);
		if (!waveformPeaksRef.current.has(assetId)) {
			waveformPeaksRef.current.set(assetId, computeStereoPeaks(buf, 1024));
			setWaveformVersion((v) => v + 1);
		}
		return buf;
	};

	const getClipSourceWindow = (clip: Clip, source: AudioBuffer) => {
		const barSecNow = getBarSeconds();
		const offsetSec = clamp(clip.sourceOffsetSec ?? 0, 0, Math.max(0, source.duration - 0.001));
		const availableSec = Math.max(0.001, source.duration - offsetSec);
		const inferredSec = Math.min(availableSec, Math.max(0.001, clip.lengthBars * barSecNow));
		const durationSec = clamp(clip.sourceDurationSec ?? inferredSec, 0.001, availableSec);
		const outputSec = Math.max(0.001, clip.lengthBars * barSecNow);
		const ratio = clamp(outputSec / durationSec, 0.25, 4);
		return { offsetSec, durationSec, outputSec, ratio };
	};

	const ensurePlaybackBufferForClip = async (clip: Clip) => {
		if (!clip.assetId) throw new Error("clip_has_no_asset");
		const source = await ensureBufferForAsset(clip.assetId);
		const win = getClipSourceWindow(clip, source);
		const barSecNow = getBarSeconds();
		const fadeInSec = clamp(clip.fadeInBars ?? 0, 0, clip.lengthBars) * barSecNow;
		const fadeOutSec = clamp(clip.fadeOutBars ?? 0, 0, Math.max(0, clip.lengthBars - (clip.fadeInBars ?? 0))) * barSecNow;
		const key = [
			clip.assetId,
			win.offsetSec.toFixed(5),
			win.durationSec.toFixed(5),
			win.ratio.toFixed(5),
			fadeInSec.toFixed(5),
			fadeOutSec.toFixed(5),
			source.sampleRate,
		].join("|");
		const cached = stretchedBuffersRef.current.get(clip.id);
		if (cached?.key === key) return cached.buffer;

		const ctx = ensureAudioCtx();
		const rendered = renderPitchPreservedStretch(ctx, source, win.offsetSec, win.durationSec, win.ratio);
		applyClipFadesToBuffer(rendered, fadeInSec, fadeOutSec);
		stretchedBuffersRef.current.set(clip.id, { key, buffer: rendered });
		return rendered;
	};

	useEffect(() => {
		const ids = Array.from(new Set(clips.map((c) => c.assetId).filter(Boolean) as string[]));
		ids.forEach((id) => {
			if (!waveformPeaksRef.current.has(id)) {
				ensureBufferForAsset(id).catch(() => {});
			}
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [clips, projectAssets]);

	const scheduleAudioFromBars = async (
		startBars: number,
		stopBars: number,
		options?: { startAtSec?: number; clearExisting?: boolean },
	) => {
		// Schedule only the requested transport segment. Keeping the schedule
		// bounded is important for true L-R looping: audio beyond R must never leak
		// into the next pass.
		if (options?.clearExisting !== false) stopScheduledAudio();
		const scheduleGeneration = audioScheduleGenerationRef.current;

		const ctx = ensureAudioCtx();
		await ctx.resume().catch(() => {});
		const barSec = getBarSeconds();
		const t0 = options?.startAtSec ?? (ctx.currentTime + 0.035);
		const segmentEnd = Math.max(startBars + 0.0001, stopBars);

		// Schedule every track. Mute/Solo/Level are live mixer controls on the
		// persistent per-track bus, so changing them while playback is running does
		// not require us to destroy and rebuild the song schedule.
		const audioClips = clips.filter((c) => !!c.assetId && tracks.some((t) => t.id === c.trackId && t.type === "audio"));

		for (const c of audioClips) {
			if (scheduleGeneration !== audioScheduleGenerationRef.current) return;
			const clipEndBar = c.startBar + c.lengthBars;
			const playFromBar = Math.max(startBars, c.startBar);
			const playToBar = Math.min(segmentEnd, clipEndBar);
			if (playToBar - playFromBar <= 0.0001) continue;

			let buf: AudioBuffer;
			try {
				buf = await ensurePlaybackBufferForClip(c);
			} catch {
				continue;
			}
			if (scheduleGeneration !== audioScheduleGenerationRef.current) return;

			const timelineOffsetSec = (playFromBar - c.startBar) * barSec;
			const startAt = t0 + Math.max(0, (playFromBar - startBars) * barSec);
			const requestedDuration = Math.max(0, (playToBar - playFromBar) * barSec);
			const playDur = Math.max(0, Math.min(requestedDuration, buf.duration - timelineOffsetSec));
			if (playDur <= 0.005) continue;

			const srcNode = ctx.createBufferSource();
			srcNode.buffer = buf;
			const gain = ctx.createGain();
			const trackBus = ensureTrackAudioBus(c.trackId);
			srcNode.connect(gain);
			gain.connect(trackBus.gain);

			// Clip fades are already baked into this temporary per-clip playback buffer.
			// The original asset is untouched, and seeking into a fade still lands on the
			// correct sample-level envelope. This gain remains available for future
			// clip automation without double-applying the fade.
			gain.gain.setValueAtTime(1, startAt);

			try {
				srcNode.start(startAt, timelineOffsetSec, playDur);
				registerActiveSource(srcNode, c.id);
			} catch {
				// ignore scheduling errors
			}
		}

		// Native VST3 instrument tracks are scheduled into YSong Bridge. The Bridge
		// owns the actual plugin instance and renders it through ASIO/WASAPI; the MIDI
		// clip remains the source of truth in this project.
		const vstTracks = tracks.filter((t) => t.type === "instrument" && !!t.vst3PluginPath);
		const segmentStartUnixMs = Date.now() + Math.max(0, (t0 - ctx.currentTime) * 1000);
		for (const track of vstTracks) {
			try { await ensureVstLoaded(track); } catch { continue; }
			const events: Vst3MidiEvent[] = [];
			const trackClips = clips.filter((c) => c.trackId === track.id && !c.assetId && (c.midiNotes?.length ?? 0) > 0);
			for (const c of trackClips) {
				const clipEndBar = c.startBar + c.lengthBars;
				(c.midiNotes ?? []).forEach((note, noteIndex) => {
					const noteStartBar = c.startBar + note.startBars;
					const noteEndBar = Math.min(clipEndBar, noteStartBar + Math.max(1 / 128, note.lengthBars));
					const playFromBar = Math.max(startBars, noteStartBar);
					const playToBar = Math.min(segmentEnd, noteEndBar);
					if (playToBar - playFromBar <= 0.0001) return;
					const noteId = stablePositiveInt(`${c.id}:${noteIndex}:${note.pitch}`);
					events.push({
						kind: "on", note: note.pitch, velocity: note.velocity, noteId,
						whenUnixMs: Math.round(segmentStartUnixMs + Math.max(0, playFromBar - startBars) * barSec * 1000),
					});
					events.push({
						kind: "off", note: note.pitch, velocity: 0, noteId,
						whenUnixMs: Math.round(segmentStartUnixMs + Math.max(0, playToBar - startBars) * barSec * 1000),
					});
				});
			}
			if (events.length) {
				events.sort((a, b) => a.whenUnixMs - b.whenUnixMs || (a.kind === "off" ? -1 : 1));
				try { await bridgeApi.scheduleVst3Midi(track.id, events); } catch {}
			}
		}

		// Tracks without a native VST3 assignment keep using the lightweight browser
		// General MIDI preview renderer.
		const midiClips = clips.filter((c) => !c.assetId && (c.midiNotes?.length ?? 0) > 0 && tracks.some((t) => t.id === c.trackId && t.type === "instrument"));
		for (const c of midiClips) {
			const track = tracks.find((t) => t.id === c.trackId);
			if (!track || track.vst3PluginPath) continue;
			const gmProgram = normalizeGmProgram(gmProgramOverrideRef.current.get(track.id) ?? track.gmProgram ?? 0);
			const profile = gmPreviewProfile(gmProgram);
			const clipEndBar = c.startBar + c.lengthBars;
			for (const note of c.midiNotes ?? []) {
				const noteStartBar = c.startBar + note.startBars;
				const noteEndBar = Math.min(clipEndBar, noteStartBar + Math.max(1 / 128, note.lengthBars));
				const playFromBar = Math.max(startBars, noteStartBar);
				const playToBar = Math.min(segmentEnd, noteEndBar);
				if (playToBar - playFromBar <= 0.0001) continue;

				const startAt = t0 + Math.max(0, (playFromBar - startBars) * barSec);
				const durationSec = Math.max(0.015, (playToBar - playFromBar) * barSec);
				const localStartBars = playFromBar - c.startBar;
				const localEndBars = playToBar - c.startBar;
				const bendRange = Math.max(1, c.midiBendRange ?? 12);
				const baseHz = midiToFrequency(note.pitch);
				const trackBus = ensureTrackAudioBus(c.trackId);
				const voice = createGmPreviewVoice(ctx, gmProgram, baseHz, note.velocity, trackBus.gain, startAt);

				// Pitch bend is applied in cents so every additive partial bends together and
				// keeps its harmonic ratio. This replaces the old single-oscillator bend.
				const initialBend = clamp(interpolateAutomation(c.midiPitchBend, localStartBars, 0), -bendRange, bendRange);
				voice.sources.forEach((osc, index) => {
					const baseDetune = profile.partials[index]?.detuneCents ?? 0;
					osc.detune.setValueAtTime(baseDetune + initialBend * 100, startAt);
					for (const point of (c.midiPitchBend ?? []).slice().sort((a, b) => a.atBars - b.atBars)) {
						if (point.atBars <= localStartBars || point.atBars > localEndBars) continue;
						const at = startAt + (point.atBars - localStartBars) * barSec;
						osc.detune.linearRampToValueAtTime(baseDetune + clamp(point.value, -bendRange, bendRange) * 100, at);
					}
				});

				// CC1 adds vibrato depth on top of the family voice. Use cents instead of Hz
				// so modulation depth remains musical across the keyboard.
				let ccLfo: OscillatorNode | undefined;
				if ((c.midiModulation?.length ?? 0) > 0) {
					ccLfo = ctx.createOscillator();
					const ccLfoGain = ctx.createGain();
					ccLfo.type = "sine";
					ccLfo.frequency.setValueAtTime(5.2, startAt);
					const depthCents = (cc: number) => 30 * clamp(cc / 127, 0, 1);
					const initialMod = interpolateAutomation(c.midiModulation, localStartBars, 0);
					ccLfoGain.gain.setValueAtTime(depthCents(initialMod), startAt);
					for (const point of (c.midiModulation ?? []).slice().sort((a, b) => a.atBars - b.atBars)) {
						if (point.atBars <= localStartBars || point.atBars > localEndBars) continue;
						const at = startAt + (point.atBars - localStartBars) * barSec;
						ccLfoGain.gain.linearRampToValueAtTime(depthCents(point.value), at);
					}
					ccLfo.connect(ccLfoGain);
					for (const osc of voice.sources) ccLfoGain.connect(osc.detune);
					ccLfo.start(startAt);
				}

				const release = Math.min(voice.release, durationSec * 0.55);
				const releaseAt = startAt + Math.max(0.006, durationSec - release);
				try {
					voice.gain.gain.cancelAndHoldAtTime(releaseAt);
					voice.gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationSec);
				} catch {
					voice.gain.gain.cancelScheduledValues(releaseAt);
					voice.gain.gain.setTargetAtTime(0.0001, releaseAt, Math.max(0.008, release / 5));
				}

				const stopAt = startAt + durationSec + 0.04;
				for (const osc of voice.sources) {
					try { osc.stop(stopAt); registerActiveSource(osc, c.id); } catch {}
				}
				try { voice.lfo?.stop(stopAt); if (voice.lfo) registerActiveSource(voice.lfo, c.id); } catch {}
				try { ccLfo?.stop(stopAt); if (ccLfo) registerActiveSource(ccLfo, c.id); } catch {}
			}
		}
	};

	// --- Transport playback loop (audio + structured MIDI + visual) ---
	const stop = () => {
		if (recordingSessionRef.current) finishMidiRecording();
		if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
		rafRef.current = null;
		stopScheduledAudio();
		setIsPlaying(false);
	};

	const start = (loopOverride?: boolean) => {
		const loopOn = loopOverride ?? loopEnabled;
		const activeLoopLen = Math.max(0.0001, loopR - loopL);
		const startPos = loopOn ? clamp(playheadPosBars, loopL, loopR - 0.0001) : clamp(playheadPosBars, 1, endBar);
		const ctx = ensureAudioCtx();
		ctx.resume().catch(() => {});
		stopScheduledAudio();

		// Give decoding/scheduling a tiny runway. The visual transport uses the same
		// delayed start so the line and the sound begin together.
		const leadSec = 0.12;
		playStartMsRef.current = performance.now() + leadSec * 1000;
		playStartPosRef.current = startPos;
		lastUiUpdateMsRef.current = 0;
		setPlayheadPosBars(startPos);
		setIsPlaying(true);

		const firstBoundary = loopOn ? loopR : endBar;
		const firstStartAt = ctx.currentTime + leadSec;
		scheduleAudioFromBars(startPos, firstBoundary, { startAtSec: firstStartAt, clearExisting: false }).catch(() => {});
		lastPosRef.current = startPos;

		const beatSecNow = (60 / Math.max(1, bpm)) * (4 / Math.max(1, sigDen));
		const barSecNow = beatSecNow * Math.max(1, sigNum);

		// Audio looping cannot depend on requestAnimationFrame: browsers throttle or
		// pause visual frames when YSong is behind another tab. Pre-schedule a rolling
		// WebAudio look-ahead instead. The audio clock keeps running in the background;
		// rAF is now only responsible for painting the playhead.
		if (loopOn) {
			const loopDurationSec = activeLoopLen * barSecNow;
			loopScheduleNextCtxTimeRef.current = firstStartAt + Math.max(0, (firstBoundary - startPos) * barSecNow);
			const scheduleAhead = async () => {
				if (loopSchedulerBusyRef.current) return;
				loopSchedulerBusyRef.current = true;
				try {
					const horizon = ctx.currentTime + 90;
					let passes = 0;
					while (loopScheduleNextCtxTimeRef.current < horizon && passes < 64) {
						const at = loopScheduleNextCtxTimeRef.current;
						await scheduleAudioFromBars(loopL, loopR, { startAtSec: at, clearExisting: false });
						loopScheduleNextCtxTimeRef.current = at + loopDurationSec;
						passes += 1;
					}
				} finally {
					loopSchedulerBusyRef.current = false;
				}
			};
			scheduleAhead().catch(() => {});
			loopSchedulerTimerRef.current = window.setInterval(() => { scheduleAhead().catch(() => {}); }, 4000);
		}

		const tick = () => {
			const now = performance.now();
			const elapsedSec = Math.max(0, (now - playStartMsRef.current) / 1000);
			let pos = playStartPosRef.current + elapsedSec / Math.max(0.0001, barSecNow);

			if (loopOn) {
				const len = Math.max(0.0001, activeLoopLen);
				if (pos < loopL) pos = loopL;
				if (pos >= loopR) pos = loopL + ((pos - loopL) % len);
			} else if (pos >= endBar) {
				pos = endBar;
				setPlayheadPosBars(pos);
				stop();
				return;
			}

			pos = clamp(pos, 1, bars + 0.999);

			// Audio looping is scheduled independently above. This comparison only
			// records the UI wrap; it must never be responsible for keeping sound alive.
			lastPosRef.current = pos;

			const tl = timelineRef.current;
			if (tl) {
				const x = Math.max(0, barToLeftPx(pos));
				const margin = Math.max(80, tl.clientWidth * 0.18);
				const leftEdge = tl.scrollLeft + margin;
				const rightEdge = tl.scrollLeft + tl.clientWidth - margin;
				if (x < leftEdge || x > rightEdge) {
					const target = clamp(x - tl.clientWidth * 0.18, 0, Math.max(0, tl.scrollWidth - tl.clientWidth));
					tl.scrollLeft = target;
				}
			}

			if (now - lastUiUpdateMsRef.current >= 1000 / 30) {
				lastUiUpdateMsRef.current = now;
				setPlayheadPosBars(pos);
			}
			rafRef.current = requestAnimationFrame(tick);
		};

		rafRef.current = requestAnimationFrame(tick);
	};

	const togglePlay = () => {
		if (isPlaying) stop();
		else start();
	};

	const toggleLoopPlayback = () => {
		const next = !loopEnabled;
		if (!isPlaying) {
			setLoopEnabled(next);
			return;
		}
		// Restart the transport immediately with the new loop mode. This fixes the
		// old stale-closure bug where enabling Loop while already playing only lit
		// the button but the running transport never adopted it.
		stop();
		setLoopEnabled(next);
		requestAnimationFrame(() => start(next));
	};

	// Spacebar toggles play/stop (unless you're typing)
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (isEditableTarget(e.target)) return;

			if (e.code === "Space") {
				e.preventDefault();
				togglePlay();
			} else if (e.key === "Home") {
				e.preventDefault();
				setPlayheadPosBars(loopEnabled ? loopL : 1);
			} else if (e.key === "End") {
				e.preventDefault();
				setPlayheadPosBars(endBar);
			}
		};

		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isPlaying, bpm, sigNum, sigDen, loopEnabled, loopL, endBar]);

	useEffect(() => {
		return () => {
			if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
			if (meterRafRef.current != null) cancelAnimationFrame(meterRafRef.current);
			if (loopSchedulerTimerRef.current != null) window.clearInterval(loopSchedulerTimerRef.current);
			for (const bus of trackAudioBusesRef.current.values()) {
				try { bus.gain.disconnect(); } catch {}
				try { bus.analyser.disconnect(); } catch {}
			}
			trackAudioBusesRef.current.clear();
		};
	}, []);


	const durationToBars = (sec: number) => {
		const beatSecNow = (60 / Math.max(1, bpm)) * (4 / Math.max(1, sigDen));
		const barSecNow = beatSecNow * Math.max(1, sigNum);
		return sec / Math.max(0.0001, barSecNow);
	};

	void waveformVersion;
	const loopableByAssetId = useMemo(() => {
		const m = new Map<string, boolean>();
		for (const a of projectAssets) {
			const d = Number(a.durationSec || 0);
			if (!Number.isFinite(d) || d <= 0) continue;
			const bars = durationToBars(d);
			const nearest = Math.round(bars);
			if (nearest <= 0) continue;
			if (nearest <= 8 && Math.abs(bars - nearest) < 0.03) m.set(a.id, true);
		}
		return m;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [projectAssets, bpm, sigNum, sigDen]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const mod = e.ctrlKey || e.metaKey;
			const key = e.key.toLowerCase();
			const editable = isEditableTarget(e.target);

			// Project history works in the main DAW and while the MIDI editor is open.
			// Text inputs keep their native browser undo so Ctrl+Z can still fix typing.
			if (!editable && mod && key === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
			if (!editable && mod && (key === "y" || (key === "z" && e.shiftKey))) { e.preventDefault(); redo(); return; }

			if (editable || midiEditorClipId) return;
			if (mod && key === "c" && selectedClipId) { e.preventDefault(); copyClip(selectedClipId); }
			else if (mod && key === "x" && selectedClipId) { e.preventDefault(); cutClip(selectedClipId); }
			else if (mod && key === "v") { e.preventDefault(); pasteClip(); }
			else if ((e.key === "Delete" || e.key === "Backspace") && selectedClipId) { e.preventDefault(); removeClipFromDaw(selectedClipId); }
			else if (e.key === "Escape") { setClipContextMenu(null); setLaneContextMenu(null); }
		};
		const closeMenu = () => { setClipContextMenu(null); setLaneContextMenu(null); };
		window.addEventListener("keydown", onKey);
		window.addEventListener("pointerdown", closeMenu);
		return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("pointerdown", closeMenu); };
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selectedClipId, selectedTrackId, playheadPosBars, clips, tracks, midiEditorClipId]);

	const midiEditorClip = midiEditorClipId ? clips.find((c) => c.id === midiEditorClipId) ?? null : null;
	const midiGhostClips = midiEditorClip
		? clips
			.filter((c) => c.id !== midiEditorClip.id && c.trackId === midiEditorClip.trackId && !c.assetId && (c.midiNotes?.length ?? 0) > 0)
			.map((c) => ({
				id: c.id,
				name: c.name,
				offsetBars: c.startBar - midiEditorClip.startBar,
				lengthBars: c.lengthBars,
				midiNotes: c.midiNotes,
			}))
		: [];
	const updateMidiEditorClip = (patch: Partial<MidiEditableClip>) => {
		if (!midiEditorClipId) return;
		setClips((prev) => prev.map((c) => c.id === midiEditorClipId ? { ...c, ...patch } : c));
	};

	const keyboardTarget = currentMidiTargetTrack();
	const keyboardInstrumentName = keyboardTarget?.vst3PluginPath
		? (keyboardTarget.vst3PluginName ?? "VST3")
		: keyboardTarget ? `${String(normalizeGmProgram(keyboardTarget.gmProgram ?? 0) + 1).padStart(3, "0")} · ${GM_PROGRAMS[normalizeGmProgram(keyboardTarget.gmProgram ?? 0)]?.label ?? "General MIDI"}` : undefined;

	const applyZoomPct = (nextRaw: number) => {
		const next = clamp(Math.round(nextRaw), MIN_ZOOM_PCT, MAX_ZOOM_PCT);
		if (next === zoomPct) return;
		const tl = timelineRef.current;
		const oldWidth = barWidth;
		const newWidth = BASE_BAR_W * (next / 100);
		const playheadOldX = (playheadPosBars - 1) * oldWidth;
		const viewportAnchor = tl ? playheadOldX - tl.scrollLeft : 0;
		setZoomPct(next);
		requestAnimationFrame(() => {
			if (!tl) return;
			const playheadNewX = (playheadPosBars - 1) * newWidth;
			tl.scrollLeft = clamp(playheadNewX - viewportAnchor, 0, Math.max(0, tl.scrollWidth - tl.clientWidth));
		});
	};

	return (
		<div className="h-full min-h-0 flex flex-col">
			{/* Main split */}
			<div className="flex-1 min-h-0 flex overflow-hidden border-t border-neutral-200/20 dark:border-neutral-800">
				{/* Left: independently collapsible DAW track panel. On phones this defaults
				    to a narrow rail so the timeline keeps the majority of the screen. */}
				<div
					className={`${trackPanelOpen ? "w-[min(300px,72vw)] md:w-[300px]" : "w-10"} shrink-0 border-r border-neutral-200/20 dark:border-neutral-800 bg-neutral-950/30 flex flex-col min-h-0 transition-[width] duration-200`}
				>
					<div className="flex flex-col border-b border-neutral-200/20 dark:border-neutral-800">
						<div className={`h-12 flex items-center bg-neutral-950/40 border-b border-neutral-200/10 dark:border-neutral-800 ${trackPanelOpen ? "px-2 gap-2" : "justify-center"}`}>
							{trackPanelOpen && (
								<>
									<div
										className={`w-2 h-2 rounded-full ${projectDirty ? "bg-amber-400" : "bg-emerald-400/60"}`}
										title={isSavingUi ? "Saving…" : projectDirty ? "Unsaved" : "Saved"}
									/>
									<button
										type="button"
										className="min-w-0 flex-1 text-left text-xs opacity-90 truncate px-1 py-1 rounded-md hover:bg-neutral-100/5 active:bg-neutral-100/10"
										onClick={() => setProjectSheetOpen(true)}
										title="Project"
									>
										{projectName}<span className="ml-1 opacity-60">▾</span>
									</button>
								</>
							)}
							<YSButton
								type="button"
								onClick={() => setTrackPanelOpen((v) => !v)}
								className="h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-md border"
								title={trackPanelOpen ? "Collapse track list" : "Expand track list"}
							>
								<span className="text-base leading-none">{trackPanelOpen ? "‹" : "›"}</span>
							</YSButton>
						</div>

						{trackPanelOpen && (
							<div className="h-10 px-3 flex items-center justify-between">
								<div className="text-xs uppercase tracking-wide opacity-70">Tracks</div>
								<div className="text-[11px] opacity-60">{tracks.length} track{tracks.length === 1 ? "" : "s"}</div>
							</div>
						)}
						{!trackPanelOpen && <div className="h-10" aria-hidden="true" />}
					</div>

					<div
						ref={trackScrollRef}
						onScroll={onTrackScroll}
						className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
						style={{ scrollbarGutter: "stable" } as any}
					>
						{tracks.map((t, trackIndex) => {
							const selected = t.id === selectedTrackId;
							const trackH = getTrackHeight(t.id, t.type);
							const meter = trackMeters[t.id] ?? 0;
							if (!trackPanelOpen) {
								return (
									<button
										key={t.id}
										type="button"
										className={`w-full border-b border-neutral-200/10 dark:border-neutral-800 flex items-center justify-center text-[10px] font-mono ${selected ? "bg-amber-300/10 text-amber-100" : "opacity-65 hover:opacity-100"}`}
										style={{ height: trackH }}
										onClick={() => { setSelectedTrackId(t.id); setSelectedClipId(null); }}
										title={t.name}
									>
										<div className="flex flex-col items-center justify-center gap-1 w-full h-full">
											<span>{t.type === "audio" ? "A" : "I"}{trackIndex + 1}</span>
											<div className="w-1.5 h-7 rounded-full bg-white/10 overflow-hidden flex items-end">
												<div className="w-full rounded-full bg-emerald-300/90 transition-[height] duration-75" style={{ height: `${Math.round(meter * 100)}%` }} />
											</div>
										</div>
									</button>
								);
							}

							return (
								<div
									key={t.id}
									className={`relative flex flex-col justify-start px-2 py-1.5 border-b border-neutral-200/10 dark:border-neutral-800 ${selected ? "bg-neutral-100/5" : ""}`}
									style={{ height: trackH }}
									onPointerDown={() => { setSelectedTrackId(t.id); setSelectedClipId(null); }}
								>
									<div className="w-full flex items-center gap-1.5 min-w-0">
										<div className="min-w-0 flex-1 flex items-center gap-1">
											{renamingTrackId === t.id ? (
												<input
													autoFocus
													value={renamingTrackName}
													onChange={(e) => setRenamingTrackName(e.target.value)}
													onPointerDown={(e) => e.stopPropagation()}
													onBlur={commitTrackRename}
													onKeyDown={(e) => {
														if (e.key === "Enter") { e.preventDefault(); commitTrackRename(); }
														if (e.key === "Escape") { e.preventDefault(); setRenamingTrackId(null); setRenamingTrackName(""); }
													}}
													className="w-full min-w-0 h-6 rounded border border-white/20 bg-black/30 px-1.5 text-xs outline-none focus:border-cyan-300/60"
												/>
											) : (
												<button
													type="button"
													className="truncate text-sm font-medium text-left hover:underline decoration-dotted underline-offset-2"
													onPointerDown={(e) => e.stopPropagation()}
													onDoubleClick={(e) => { e.stopPropagation(); beginTrackRename(t); }}
													title="Double-click to rename track"
												>{t.name}</button>
											)}
											<YSButton className="w-6 h-6 p-0 rounded-md justify-center text-[10px] opacity-55 hover:opacity-100" onClick={(e) => { e.stopPropagation(); beginTrackRename(t); }} title="Rename track">✎</YSButton>
										</div>
										<div className="flex items-center gap-1 shrink-0">
										<YSButton className={`text-[11px] px-2 py-1 rounded-md transition ${t.mute ? "!bg-amber-300 !text-black !border-amber-100 shadow-[0_0_10px_rgba(252,211,77,0.55)] opacity-100" : ""}`} onClick={() => toggle(t.id, "mute")} aria-pressed={t.mute} title={t.mute ? "Muted — click to unmute" : "Mute"}>M</YSButton>
										<YSButton className={`text-[11px] px-2 py-1 rounded-md transition ${t.solo ? "!bg-cyan-300 !text-black !border-cyan-100 shadow-[0_0_10px_rgba(103,232,249,0.55)] opacity-100" : ""}`} onClick={() => toggle(t.id, "solo")} aria-pressed={t.solo} title={t.solo ? "Solo active — click to clear" : "Solo"}>S</YSButton>
										<YSButton className={`text-[11px] px-2 py-1 rounded-md transition ${t.arm ? "!bg-rose-400 !text-black !border-rose-200 shadow-[0_0_10px_rgba(251,113,133,0.5)] opacity-100" : ""}`} onClick={() => toggle(t.id, "arm")} aria-pressed={t.arm} title={t.arm ? "Record armed — click to disarm" : "Arm"}>●</YSButton>
										<YSButton className="text-[11px] px-2 py-1 rounded-md opacity-60 hover:opacity-100" title="Delete track" onClick={() => deleteTrack(t.id)}>✕</YSButton>
										</div>
									</div>

									<div className="w-full mt-1 flex items-center gap-1 min-w-0">
										{t.type === "audio" ? (
											<div className="h-7 flex-1 rounded-md border border-white/5 bg-black/10 px-2 flex items-center text-[10px] opacity-55">Audio track</div>
										) : (
											<>
												<select
													className="h-7 min-w-0 flex-1 bg-neutral-950/50 border border-white/10 rounded-md px-1.5 text-[9px]"
													value={t.vst3PluginPath ? `vst3:${t.vst3PluginPath}` : `gm:${normalizeGmProgram(t.gmProgram ?? 0)}`}
													onPointerDown={(e) => { e.stopPropagation(); setSelectedTrackId(t.id); setSelectedClipId(null); }}
													onChange={(e) => { void setTrackInstrumentSource(t, e.target.value); }}
													title={t.vst3PluginPath ? `${t.vst3PluginVendor ? `${t.vst3PluginVendor} · ` : ""}${t.vst3PluginName ?? "VST3"}` : "YSong General MIDI preview instrument"}
												>
													<optgroup label="YSong / General MIDI">
														{GM_PROGRAMS.map((inst) => <option key={`gm:${inst.program}`} value={`gm:${inst.program}`}>{String(inst.number).padStart(3, "0")} · {inst.label}</option>)}
													</optgroup>
													<optgroup label="VST3 Instruments">
														{vst3Plugins.filter((plugin) => plugin.kind === "instrument" && plugin.loadable !== false).length === 0 ? (
															<option disabled value="">Scan VST3 in Settings first</option>
														) : vst3Plugins.filter((plugin) => plugin.kind === "instrument" && plugin.loadable !== false).map((plugin) => <option key={plugin.path} value={`vst3:${plugin.path}`}>{plugin.vendor ? `${plugin.vendor} · ` : ""}{plugin.name}</option>)}
													</optgroup>
												</select>
												{t.vst3PluginPath && (
													<>
														<span className={`w-5 text-center text-[8px] font-semibold shrink-0 ${vstTrackState[t.id]?.status === "error" ? "text-rose-300" : vstTrackState[t.id]?.status === "loading" ? "text-amber-200" : "text-emerald-300"}`} title={vstTrackState[t.id]?.message ?? "Bridge-hosted VST3"}>{vstTrackState[t.id]?.status === "loading" ? "…" : vstTrackState[t.id]?.status === "error" ? "!" : "VST"}</span>
														<YSButton className="h-7 px-2 py-0 rounded-md text-[9px] shrink-0" onClick={(e) => { e.stopPropagation(); void openVstEditor(t); }} title={`Open ${t.vst3PluginName ?? "VST3"} editor`}>Open</YSButton>
													</>
												)}
											</>
										)}
									</div>

									{t.type === "instrument" ? (
										<div className="w-full mt-1 flex items-center gap-1.5 min-w-0">
											<span className="text-[9px] opacity-55 shrink-0">Device</span>
											<select
												className="h-6 min-w-0 flex-1 bg-neutral-950/50 border border-white/10 rounded-md px-1.5 text-[9px]"
												value={t.midiInputName ?? ""}
												onPointerDown={(e) => { e.stopPropagation(); setSelectedTrackId(t.id); setSelectedClipId(null); }}
												onChange={(e) => setTracks((prev) => prev.map((track) => track.id === t.id ? { ...track, midiInputName: e.target.value || undefined } : track))}
												title="Hardware MIDI input for this track"
											>
												<option value="">All Inputs</option>
												{midiInputDevices.filter((device) => device.enabled).map((device) => <option key={`${device.index}:${device.name}`} value={device.name}>{device.name}</option>)}
												{t.midiInputName && !midiInputDevices.some((device) => device.enabled && device.name.toLowerCase() === t.midiInputName!.toLowerCase()) && <option value={t.midiInputName}>{t.midiInputName} (offline)</option>}
											</select>
										</div>
									) : (
										<div className="w-full mt-1 h-6 flex items-center text-[9px] opacity-35">Native MIDI routing applies to instrument tracks</div>
									)}

									<div className="w-full mt-1 flex items-center gap-2 min-w-0">
										<span className="text-[9px] opacity-55 shrink-0">Vol</span>
										<input type="range" min={0} max={127} step={1} value={clamp(t.level ?? 100, 0, 127)} onPointerDown={(e) => { e.stopPropagation(); setSelectedTrackId(t.id); setSelectedClipId(null); }} onChange={(e) => setTrackLevel(t.id, Number(e.target.value))} className="min-w-0 flex-1 h-3 accent-cyan-300 cursor-ew-resize" aria-label={`${t.name} level`} />
										<span className="w-7 text-right text-[9px] font-mono opacity-75 shrink-0">{clamp(t.level ?? 100, 0, 127)}</span>
									</div>

									<div className="w-full mt-1 h-1.5 rounded-full bg-white/10 overflow-hidden" title="Live track level">
										<div className="h-full rounded-full transition-[width] duration-75" style={{ width: `${Math.round(meter * 100)}%`, background: "linear-gradient(90deg, #34d399 0%, #facc15 72%, #fb7185 100%)" }} />
									</div>
									<div className="absolute left-0 right-0 bottom-0 h-[8px] cursor-ns-resize" onPointerDown={beginLaneResize(t.id)} onPointerMove={onLaneResizeMove} onPointerUp={endLaneResize} onPointerCancel={endLaneResize} title="Resize track height" />
								</div>
							);
						})}

						<div className={trackPanelOpen ? "p-3" : "p-1.5"}>
							<YSButton
								ref={addBtnRef}
								className={`${trackPanelOpen ? "w-full py-2 text-sm" : "w-7 h-7 p-0"} rounded-lg justify-center opacity-90`}
								onClick={toggleAddMenu}
								title="Add Track"
							>
								{trackPanelOpen ? "+ Add Track" : "+"}
							</YSButton>
						</div>
						<div style={{ height: 12 }} />
					</div>
				</div>

				{/* Right: Timeline */}
				{/* ✅ FIX: toolbar is OUTSIDE the horizontal scroller, so it never scrolls */}
				<div className="flex-1 min-w-0 bg-neutral-950/10 flex flex-col min-h-0">
					{/* Toolbar (locked horizontally) */}
					<div className="shrink-0 z-30 bg-neutral-950/70 backdrop-blur border-b border-neutral-200/20 dark:border-neutral-800">
						<div className="h-12 px-2 py-1 flex items-center gap-2 overflow-x-auto whitespace-nowrap">
							<div className="flex items-center gap-1 pr-2 border-r border-white/10">
								<YSButton disabled={!canUndo} onClick={undo} className="w-8 h-7 p-0 rounded-md justify-center disabled:opacity-25" title="Undo (Ctrl+Z)">↶</YSButton>
								<YSButton disabled={!canRedo} onClick={redo} className="w-8 h-7 p-0 rounded-md justify-center disabled:opacity-25" title="Redo (Ctrl+Y / Ctrl+Shift+Z)">↷</YSButton>
							</div>
							<YSButton
								aria-pressed={snapEnabled}
								className={`px-3 py-1 text-[11px] rounded-md font-semibold tracking-wide border border-neutral-200/10 dark:border-neutral-800 ${
									snapEnabled
										? "!bg-neutral-100 dark:!bg-neutral-100 !text-neutral-950 dark:!text-neutral-950 !opacity-100"
										: "!bg-neutral-950/20 dark:!bg-neutral-950/30 !text-neutral-50 dark:!text-neutral-50 !opacity-70"
								}`}
								onClick={() => setSnapEnabled((v) => !v)}
								title="Snap"
							>
								SNAP
							</YSButton>

							<div className="text-[11px] opacity-70">Grid</div>
							<select
								className="px-2 py-1 rounded-md bg-neutral-950/40 border border-neutral-200/10 dark:border-neutral-800 text-[12px]"
								value={gridValue}
								onChange={(e) => setGridValue(e.target.value as GridValue)}
								title="Grid resolution"
							>
								<option value="bar">Bar</option>
								<option value="1/2">1/2</option>
								<option value="1/4">1/4</option>
								<option value="1/8">1/8</option>
								<option value="1/8T">1/8T</option>
								<option value="1/16">1/16</option>
								<option value="1/16T">1/16T</option>
								<option value="1/32">1/32</option>
								<option value="1/32T">1/32T</option>
								<option value="1/64">1/64</option>
								<option value="1/64T">1/64T</option>
								<option value="1/128">1/128</option>
							</select>

							<div className="flex items-center gap-1 ml-2">
								<div className="text-[11px] opacity-70">Mode</div>
								<YSButton
									className={`px-2 py-1 text-[11px] rounded-md ${
										gridMode === "absolute" ? "bg-neutral-100 dark:bg-neutral-900" : "opacity-70"
									}`}
									onClick={() => setGridMode("absolute")}
									title="Absolute (enabled)"
								>
									Absolute
								</YSButton>
								<YSButton
									className="px-2 py-1 text-[11px] rounded-md opacity-40 cursor-not-allowed"
									onClick={() => {
										/* disabled */
									}}
									title="Relative (coming later)"
								>
									Relative
								</YSButton>
							</div>

							<div className="ml-auto shrink-0 min-w-[170px] px-2 py-1 rounded-lg border border-neutral-200/10 dark:border-neutral-800 bg-neutral-950/25">
								<div className="flex items-center justify-center gap-1.5">
									<span className="text-[13px] opacity-70" title="Timeline zoom">🔍</span>
									<YSButton className="w-7 h-6 p-0 rounded-md justify-center text-sm" onClick={() => applyZoomPct(zoomPct - 10)} title="Zoom out">−</YSButton>
									<button type="button" className="w-[54px] text-center text-[11px] font-mono opacity-90 hover:opacity-100" onDoubleClick={() => applyZoomPct(100)} title="Double-click to reset zoom">{zoomPct}%</button>
									<YSButton className="w-7 h-6 p-0 rounded-md justify-center text-sm" onClick={() => applyZoomPct(zoomPct + 10)} title="Zoom in">+</YSButton>
								</div>
								<input
									type="range" min={MIN_ZOOM_PCT} max={MAX_ZOOM_PCT} step={5}
									value={zoomPct}
									onChange={(e) => applyZoomPct(Number(e.target.value))}
									className="block w-full h-3 accent-neutral-100 cursor-ew-resize"
									aria-label="Timeline zoom percentage"
								/>
							</div>
						</div>
					</div>

					{/* Scrollable timeline area (x + y) */}
					<div
						ref={timelineRef}
						onScroll={onTimelineScroll}
						className="flex-1 min-h-0 overflow-auto"
						style={{ scrollbarGutter: "stable" } as any}
					>
						{/* Ruler row (sticky vertically, scrolls horizontally with content) */}
						<div
							className="sticky top-0 z-20 bg-neutral-950/70 backdrop-blur border-b border-neutral-200/20 dark:border-neutral-800"
							style={timelineWideStyle}
						>
							<div className="h-10">
								<div
									ref={rulerInnerRef}
									className="relative h-full"
									style={
										{
											...timelineWideStyle,
											touchAction: "none",
										} as any
									}
									onPointerDown={(e) => setPlayheadFromEvent(e)}
									onPointerMove={onDragMove}
									onPointerUp={endDrag}
									onPointerCancel={endDrag}
								>
									<div className="absolute inset-0 flex">
										{Array.from({ length: bars }, (_, i) => {
											const n = i + 1;
											return (
												<div
													key={n}
													className="h-full flex items-center justify-start px-2 text-xs opacity-70 border-r border-neutral-200/10 dark:border-neutral-800"
													style={{ width: barWidth }}
												>
													{n}
												</div>
											);
										})}
									</div>

									{/* E is a real composition boundary. Hide measure graphics after it. */}
									<div
										className="absolute top-0 bottom-0 right-0 pointer-events-none bg-neutral-950/95"
										style={{ left: endLeftPx, zIndex: 5 }}
									/>

									<div
										className="absolute top-0 bottom-0 pointer-events-none"
										style={{
											left: loopLeftPx,
											width: loopWidthPx,
											background: loopEnabled
												? "rgba(120,200,255,0.06)"
												: "rgba(255,255,255,0.03)",
										}}
									/>

									<div
										className="absolute top-0 bottom-0 pointer-events-none"
										style={{
											left: playheadLeftPx,
											width: 2,
											background: "rgba(255,255,255,0.55)",
										}}
									/>

									<div
										className="absolute top-0 bottom-0 pointer-events-none"
										style={{
											left: endLeftPx,
											width: 2,
											background: "rgba(255,200,80,0.6)",
										}}
									/>

									<div
										className="absolute top-[6px] z-30"
										style={{
											left: loopLeftPx - 10,
											touchAction: "none",
											cursor: "ew-resize",
										}}
										onPointerDown={beginDrag("L")}
										onPointerMove={onDragMove}
										onPointerUp={endDrag}
										onPointerCancel={endDrag}
										title="Loop start (L)"
									>
										<div className="px-2 py-1 rounded-md text-[11px] font-semibold bg-neutral-900/90 border border-neutral-700 text-white">
											L
										</div>
									</div>

									<div
										className="absolute top-[6px] z-30"
										style={{
											left: barToLeftPx(loopR) - 10,
											touchAction: "none",
											cursor: "ew-resize",
										}}
										onPointerDown={beginDrag("R")}
										onPointerMove={onDragMove}
										onPointerUp={endDrag}
										onPointerCancel={endDrag}
										title="Loop end (R)"
									>
										<div className="px-2 py-1 rounded-md text-[11px] font-semibold bg-neutral-900/90 border border-neutral-700 text-white">
											R
										</div>
									</div>

									<div
										className="absolute top-[6px] z-30"
										style={{
											left: endLeftPx - 10,
											touchAction: "none",
											cursor: "ew-resize",
										}}
										onPointerDown={beginDrag("E")}
										onPointerMove={onDragMove}
										onPointerUp={endDrag}
										onPointerCancel={endDrag}
										title="Song end (E)"
									>
										<div className="px-2 py-1 rounded-md text-[11px] font-semibold bg-neutral-900/90 border border-neutral-700 text-white">
											E
										</div>
									</div>
								</div>
							</div>
						</div>

						{/* Lanes */}
						<div
							className="relative"
							style={timelineWideStyle}
							onDragOver={(e) => {
								const types = Array.from(e.dataTransfer.types || []);
								const hasInternal = types.includes("application/x-ysong-asset");
								const hasFiles = e.dataTransfer.files && e.dataTransfer.files.length > 0;
								if (hasInternal || hasFiles) {
									e.preventDefault();
									e.dataTransfer.dropEffect = "copy";
								}
							}}
							onDrop={(e) => {
								// Child lanes stopPropagation(), so this only fires when dropping into empty timeline space.
								e.preventDefault();
								e.stopPropagation();
								const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
								const y = e.clientY - rect.top + (timelineRef.current?.scrollTop || 0);
								const totalTrackHeight = tracks.reduce(
									(acc, t) => acc + getTrackHeight(t.id, t.type),
									0,
								);
								if (tracks.length === 0 || y > totalTrackHeight) {
									const newId = crypto.randomUUID();
									onDropAudioOnTrack(newId)(e as any);
									return;
								}
								const sel = selectedTrackId ? tracks.find((t) => t.id === selectedTrackId) : null;
								const targetAudio =
									sel && sel.type === "audio" ? sel.id : tracks.find((t) => t.type === "audio")?.id;
								if (targetAudio) {
									onDropAudioOnTrack(targetAudio)(e as any);
									return;
								}
								const newId = crypto.randomUUID();
								onDropAudioOnTrack(newId)(e as any);
							}}
							onPointerDown={(e) => setPlayheadFromEvent(e)}
						>
							{/* Past E is outside the active composition: no grid, but clips remain non-destructively visible above it. */}
							<div
								className="absolute top-0 bottom-0 right-0 pointer-events-none bg-neutral-950/95"
								style={{ left: endLeftPx, zIndex: 5 }}
							/>

							<div
								className="absolute pointer-events-none"
								style={{
									left: loopLeftPx,
									width: loopWidthPx,
									top: 0,
									bottom: 0,
									background: loopEnabled ? "rgba(120,200,255,0.04)" : "rgba(255,255,255,0.02)",
									zIndex: 10,
								}}
							/>

							<div
								className="absolute pointer-events-none"
								style={{
									left: playheadLeftPx,
									width: 2,
									top: 0,
									bottom: 0,
									background: "rgba(255,255,255,0.45)",
									zIndex: 50,
								}}
							/>

							<div
								className="absolute pointer-events-none"
								style={{
									left: endLeftPx,
									width: 2,
									top: 0,
									bottom: 0,
									background: "rgba(255,200,80,0.45)",
									zIndex: 50,
								}}
							/>

							{tracks.map((t, idx) => {
								const laneSelected = t.id === selectedTrackId;
								const laneBg = idx % 2 === 0 ? "bg-neutral-950/10" : "bg-neutral-950/5";
								const trackClips = clips.filter((c) => c.trackId === t.id);
								const trackH = getTrackHeight(t.id, t.type);

								return (
									<div
										key={t.id}
										onDragOver={(e) => {
											if (t.type !== "audio") {
												e.dataTransfer.dropEffect = "none";
												return;
											}
											updateDropPreviewForLane(t.id, e);
										}}
										onDragLeave={clearDropPreviewOnLeave}
										onDrop={(e) => {
											e.preventDefault();
											e.stopPropagation();
											if (t.type !== "audio") return;
											onDropAudioOnTrack(t.id)(e);
										}}
										className={`relative border-b border-neutral-200/10 dark:border-neutral-800 ${laneBg} ${
											laneSelected ? "outline outline-neutral-200/15" : ""
										}`}
										style={{
											height: trackH,
											...laneGridStyle,
										}}
										onPointerDown={() => {
											setSelectedTrackId(t.id);
											setSelectedClipId(null);
										}}
										onContextMenu={openLaneContextMenu(t.id)}
										onDoubleClick={(e) => {
											if (t.type !== "instrument") return;
											e.stopPropagation();
											e.preventDefault();
											addClip(t.id, clientXToBarInEl(e.clientX, e.currentTarget as HTMLElement));
										}}
										title={
											t.type === "instrument"
												? "Double-click to add a MIDI clip"
												: "Audio clips come from recording or dragging audio in"
										}
									>
										{dropPreview?.trackId === t.id && (
											<div
												className="absolute z-[60] pointer-events-none rounded-xl border border-dashed border-amber-200/80 bg-amber-300/15 backdrop-blur-[1px] px-2 flex items-center overflow-hidden"
												style={{
													left: barToLeftPx(dropPreview.startBar),
													width: Math.max(28, dropPreview.lengthBars * barWidth),
													top: 4,
													height: Math.max(32, trackH - 8),
												}}
											>
												<div className="min-w-0 text-[11px] font-medium truncate opacity-90">
													{dropPreview.name}
												</div>
											</div>
										)}
										{trackClips.map((c) => {
											const isSelected = c.id === selectedClipId;
											const isMidiClip = t.type === "instrument" && !c.assetId;
											const left = barToLeftPx(c.startBar);
											const width = Math.max(24, c.lengthBars * barWidth);
											const clipEnd = c.startBar + c.lengthBars;
											const pastE = clipEnd > endBar;
											const pastEStartPct = pastE
												? clamp(((endBar - c.startBar) / Math.max(0.0001, c.lengthBars)) * 100, 0, 100)
												: 100;
											const loopable = !!(c.assetId && loopableByAssetId.get(c.assetId));
											const hue = hashHue(String(c.assetId || c.name || c.id));
											const stereo = c.assetId
												? waveformPeaksRef.current.get(c.assetId)
												: undefined;
											const assetNow = c.assetId
												? projectAssets.find((a) => a.id === c.assetId)
												: undefined;
											const clipBarSec = getBarSeconds();
											const outputDurationSec = Math.max(0.001, c.lengthBars * clipBarSec);
											const sourceDurationSec = c.assetId
												? Math.max(0.001, c.sourceDurationSec ?? Math.min(assetNow?.durationSec ?? outputDurationSec, outputDurationSec))
												: outputDurationSec;
											const visibleFrac = c.assetId && assetNow?.durationSec
												? clamp(sourceDurationSec / assetNow.durationSec, 0.001, 1)
												: 1;
											const stretchPct = Math.round((outputDurationSec / sourceDurationSec) * 100);
											const fadeInBars = clamp(c.fadeInBars ?? 0, 0, c.lengthBars);
											const fadeOutBars = clamp(c.fadeOutBars ?? 0, 0, Math.max(0, c.lengthBars - fadeInBars));
											const fadeInPct = clamp((fadeInBars / Math.max(0.0001, c.lengthBars)) * 100, 0, 100);
											const fadeOutPct = clamp((fadeOutBars / Math.max(0.0001, c.lengthBars)) * 100, 0, 100);
											const columns = Math.max(24, Math.floor(Math.max(8, width - 8) / 2));
											const topWave = stereo
												? resamplePeaksRange(stereo.top, columns, 0, visibleFrac)
												: pseudoWaveHeights((c.assetId || c.id) + ":t", columns);
											const bottomWave = stereo
												? resamplePeaksRange(stereo.bottom, columns, 0, visibleFrac)
												: pseudoWaveHeights((c.assetId || c.id) + ":b", columns);
											return (
												<div
													key={c.id}
													className={`group absolute border px-2 flex items-start min-w-[24px] overflow-hidden ${
														isSelected
															? "border-sky-300/50 ring-2 ring-sky-300/20"
															: "border-white/18"
													} ${draggingClipId === c.id ? "cursor-grabbing" : "cursor-grab"}`}
													style={{
														left,
														width,
														top: 0,
														height: trackH,
														zIndex: 20,
														borderRadius: loopable ? 14 : 0,
														background: `linear-gradient(135deg, hsla(${hue}, 82%, 42%, 0.98), hsla(${(hue + 26) % 360}, 82%, 28%, 0.98))`,
														boxShadow:
															"inset 0 1px 0 rgba(255,255,255,0.10), inset 0 -14px 24px rgba(0,0,0,0.14)",
													}}
													onPointerDown={beginClipMove(c.id)}
													onPointerMove={onClipPointerMove}
													onPointerUp={endClipPointer}
													onPointerCancel={endClipPointer}
													onContextMenu={openClipContextMenu(c.id)}
													onDoubleClick={(e) => { if (isMidiClip) { e.stopPropagation(); setMidiEditorClipId(c.id); } }}
													title={isMidiClip ? `${c.name} — double-click to edit MIDI` : c.name}
												>
													{isMidiClip ? (
														<div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
															<div className="absolute inset-0 bg-gradient-to-b from-violet-200/10 via-transparent to-black/15" />
															{(c.midiNotes ?? []).map((n) => {
																const pitches = (c.midiNotes ?? []).map((x) => x.pitch);
																const minP = pitches.length ? Math.min(...pitches) : 48;
																const maxP = pitches.length ? Math.max(...pitches) : 72;
																const rangeP = Math.max(12, maxP - minP + 6);
																const bottomPct = clamp(((n.pitch - (minP - 3)) / rangeP) * 72 + 12, 8, 86);
																const noteLight = 25 + (clamp(n.velocity, 1, 127) / 127) * 50;
																return (
																	<div
																		key={n.id}
																		className="absolute h-[5px] rounded-sm border border-black/25"
																		style={{
																			left: `${(n.startBars / Math.max(0.0001, c.lengthBars)) * 100}%`,
																			width: `${Math.max(1.2, (n.lengthBars / Math.max(0.0001, c.lengthBars)) * 100)}%`,
																			bottom: `${bottomPct}%`,
																			background: `hsl(28 92% ${noteLight}%)`,
																		}}
																	/>
																);
															})}
															{(c.midiNotes?.length ?? 0) === 0 && (
																<div className="absolute inset-0 flex items-center justify-center text-[10px] text-white/35">Double-click to edit MIDI</div>
															)}
														</div>
													) : (
														<div className="absolute inset-0 pointer-events-none" aria-hidden="true">
															<div className="absolute inset-x-0 top-0 bottom-1/2 flex items-end gap-px px-1 pt-2 opacity-40">
																{topWave.map((h, i) => (
																	<div key={i} style={{ height: `${Math.max(6, Math.round(h * (trackH * 0.42)))}px`, width: 2, background: "rgba(8,12,28,0.34)" }} />
																))}
															</div>
															<div className="absolute left-0 right-0 top-1/2 h-px bg-white/18" />
															<div className="absolute inset-x-0 top-1/2 bottom-0 flex items-start gap-px px-1 pb-2 opacity-40">
																{bottomWave.map((h, i) => (
																	<div key={i} style={{ height: `${Math.max(6, Math.round(h * (trackH * 0.42)))}px`, width: 2, background: "rgba(8,12,28,0.34)" }} />
																))}
															</div>
															<div className="absolute inset-0 bg-gradient-to-b from-white/6 via-transparent to-black/10" />
														</div>
													)}
													{(fadeInBars > 0 || fadeOutBars > 0) && (
														<svg className="absolute inset-0 w-full h-full pointer-events-none z-[21]" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
															{fadeInBars > 0 && (
																<>
																	<polygon points={`0,0 0,100 ${fadeInPct},0`} fill="rgba(0,0,0,0.28)" />
																	<line x1="0" y1="100" x2={fadeInPct} y2="0" stroke="rgba(255,255,255,0.7)" strokeWidth="0.9" vectorEffect="non-scaling-stroke" />
																</>
															)}
															{fadeOutBars > 0 && (
																<>
																	<polygon points={`${100 - fadeOutPct},0 100,0 100,100`} fill="rgba(0,0,0,0.28)" />
																	<line x1={100 - fadeOutPct} y1="0" x2="100" y2="100" stroke="rgba(255,255,255,0.7)" strokeWidth="0.9" vectorEffect="non-scaling-stroke" />
																</>
															)}
														</svg>
													)}

													<div className="text-[11px] opacity-95 truncate relative z-30 pt-2 pr-12 drop-shadow-[0_1px_1px_rgba(0,0,0,0.55)]">
														{c.name}
													</div>
													{c.assetId && draggingClipId === c.id && clipPtrRef.current?.mode === "stretchR" && (
                                                        <div className="absolute top-1 right-3 z-40 px-1.5 py-0.5 rounded bg-black/60 border border-fuchsia-200/40 text-[9px] font-mono pointer-events-none">
                                                            Stretch {stretchPct}%
                                                        </div>
                                                    )}
                                                    {c.assetId && draggingClipId === c.id && clipPtrRef.current?.mode === "resizeR" && (
                                                        <div className="absolute top-1 right-3 z-40 px-1.5 py-0.5 rounded bg-black/60 border border-white/25 text-[9px] font-mono pointer-events-none">
                                                            Trim
                                                        </div>
                                                    )}
													{pastE && (
														<div
															className="absolute top-0 bottom-0 right-0 pointer-events-none bg-neutral-950/70 border-l border-amber-200/25"
															style={{ left: `${pastEStartPct}%`, zIndex: 25 }}
														/>
													)}
													{c.assetId && (
														<>
															{/* Fade handles follow their current fade boundaries. */}
															<div
																className="absolute top-0 z-50 w-3 h-3 -translate-x-1/2 rounded-b bg-white/85 shadow cursor-ew-resize opacity-0 group-hover:opacity-100"
																style={{ left: `${fadeInPct}%` }}
																onPointerDown={beginClipFade(c.id, "fadeIn")}
																title="Fade in (drag; ALT bypasses snap)"
															/>
															<div
																className="absolute top-0 z-50 w-3 h-3 translate-x-1/2 rounded-b bg-white/85 shadow cursor-ew-resize opacity-0 group-hover:opacity-100"
																style={{ right: `${fadeOutPct}%` }}
																onPointerDown={beginClipFade(c.id, "fadeOut")}
																title="Fade out (drag; ALT bypasses snap)"
															/>

															{/* Thin full-height right edge = trim. */}
															<div
																className={`absolute top-0 right-0 h-full w-[9px] z-40 cursor-ew-resize transition-opacity ${isSelected ? "opacity-70" : "opacity-0 group-hover:opacity-70"}`}
																onPointerDown={beginClipResizeR(c.id)}
																title="Trim source boundary (does NOT change stretch ratio; ALT bypasses snap)"
																style={{ background: "linear-gradient(to left, rgba(255,255,255,0.30), rgba(255,255,255,0))" }}
															/>

															{/* Bottom-right grip = time stretch, preserving pitch. */}
															<div
																className={`absolute bottom-1 right-1 z-[60] h-5 min-w-5 px-1 rounded bg-fuchsia-950/90 border border-fuchsia-200/60 text-fuchsia-50 text-[10px] leading-[18px] text-center cursor-ew-resize transition-opacity ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
																onPointerDown={beginClipStretchR(c.id)}
																title="Time stretch / preserve pitch (25%-400%). Use this ↔ grip; the thin right edge is Trim."
															>↔</div>
														</>
													)}
													{isMidiClip && (
														<>
															<div
																className="absolute top-0 right-0 h-full w-[8px] z-40 cursor-ew-resize opacity-0 group-hover:opacity-100"
																onPointerDown={beginClipResizeR(c.id)}
																title="Resize MIDI clip"
																style={{ background: "linear-gradient(to left, rgba(255,255,255,0.18), rgba(255,255,255,0))" }}
															/>
															<button
																type="button"
																className="absolute bottom-1 right-2 z-[60] h-5 px-1.5 rounded bg-violet-950/85 border border-violet-200/40 text-violet-50 text-[10px] opacity-0 group-hover:opacity-100"
																onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
																onClick={(e) => { e.stopPropagation(); setMidiEditorClipId(c.id); }}
																title="Open MIDI editor"
															>♬</button>
														</>
													)}
												</div>
											);
										})}
										{t.type === "audio" && (
											<div
												className="absolute left-0 right-0 bottom-0 h-[8px] cursor-ns-resize z-20"
												onPointerDown={beginLaneResize(t.id)}
												onPointerMove={onLaneResizeMove}
												onPointerUp={endLaneResize}
												onPointerCancel={endLaneResize}
												title="Resize track height"
											/>
										)}
									</div>
								);
							})}

							<div style={{ height: 80 }} />
						</div>
					</div>
				</div>
			</div>

			{/* Shared transport console. The MIDI editor reuses this exact component. */}
			<div
				className="shrink-0 border-t border-neutral-200/20 dark:border-neutral-800 bg-neutral-950/60 backdrop-blur px-2 pt-2 flex justify-center"
				style={{ paddingBottom: BOTTOM_DOCK_SAFE_PX }}
			>
				<TransportConsole
					playheadPosBars={playheadPosBars}
					isPlaying={isPlaying}
					loopEnabled={loopEnabled}
					bpm={bpm}
					sigNum={sigNum}
					sigDen={sigDen}
					onReturnStart={() => setPlayheadPosBars(1)}
					onStop={() => { finishMidiRecording(); stop(); setPlayheadPosBars(1); }}
					onTogglePlay={togglePlay}
					onRecord={toggleMidiRecording}
					recording={isRecording}
					onToggleKeyboard={() => setOnScreenKeyboardOpen((v) => !v)}
					keyboardOpen={onScreenKeyboardOpen}
					onToggleLoop={toggleLoopPlayback}
					onJumpEnd={() => setPlayheadPosBars(endBar)}
					onBpmChange={setBpm}
					onSignatureChange={(n, d) => { setSigNum(n); setSigDen(d); }}
				/>
			</div>

			<OnScreenKeyboard
				open={onScreenKeyboardOpen}
				trackName={keyboardTarget?.name}
				instrumentName={keyboardInstrumentName}
				externalActiveNotes={hardwareActiveNotes}
				onNoteOn={(pitch, velocity) => liveMidiNoteOn(pitch, velocity, keyboardTarget)}
				onNoteOff={(pitch) => liveMidiNoteOff(pitch, keyboardTarget)}
				onPanic={panicLiveMidi}
				onClose={() => setOnScreenKeyboardOpen(false)}
			/>

			{/* Add-track menu portal */}
			{addMenuOpen &&
				addMenuPos &&
				typeof document !== "undefined" &&
				createPortal(
					<div
						ref={addMenuRef}
						className="rounded-lg border border-neutral-200/20 dark:border-neutral-800 bg-neutral-950/95 backdrop-blur shadow-lg overflow-hidden"
						style={{
							position: "fixed",
							top: addMenuPos.top,
							left: addMenuPos.left,
							width: MENU_W,
							zIndex: 9999,
						}}
					>
						<div className="px-3 py-2 text-xs opacity-60 border-b border-neutral-200/10 dark:border-neutral-800">
							Add track
						</div>

						<button
							type="button"
							className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-100/10"
							onClick={() => {
								addTrack("audio");
								closeAddMenu();
							}}
						>
							Create Audio Track
						</button>

						<button
							type="button"
							className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-100/10"
							onClick={() => {
								addTrack("instrument");
								closeAddMenu();
							}}
						>
							Create MIDI Track
						</button>
					</div>,
					document.body,
				)}

			{laneContextMenu && (() => {
				const targetTrack = tracks.find((t) => t.id === laneContextMenu.trackId);
				const source = clipClipboardRef.current;
				const canPaste = !!(targetTrack && source && targetTrack.type === clipType(source));
				const left = Math.min(laneContextMenu.x, Math.max(8, window.innerWidth - 190));
				const top = Math.min(laneContextMenu.y, Math.max(8, window.innerHeight - 110));
				return createPortal(
					<div
						className="fixed w-[180px] rounded-xl border border-white/15 bg-neutral-950/95 shadow-2xl backdrop-blur overflow-hidden text-sm"
						style={{ left, top, zIndex: 10000 }}
						onPointerDown={(e) => e.stopPropagation()}
					>
						<button
							type="button"
							disabled={!canPaste}
							className={`w-full text-left px-3 py-2 flex justify-between ${canPaste ? "hover:bg-white/10 text-white" : "text-white/30 cursor-not-allowed"}`}
							onClick={() => { if (canPaste) pasteClipAt(laneContextMenu.trackId, laneContextMenu.startBar); }}
							title={canPaste ? `Paste at snapped position ${laneContextMenu.startBar.toFixed(3)}` : source ? `Clipboard contains ${clipType(source)} data; this is a ${targetTrack?.type ?? "different"} lane` : "Clipboard is empty"}
						>
							<span>Paste</span><span className="opacity-45 text-xs">Ctrl+V</span>
						</button>
					</div>,
					document.body,
				);
			})()}

			{clipContextMenu && (() => {
				const menuClip = clips.find((c) => c.id === clipContextMenu.clipId);
				const menuTrack = menuClip ? tracks.find((t) => t.id === menuClip.trackId) : null;
				const left = Math.min(clipContextMenu.x, Math.max(8, window.innerWidth - 190));
				const top = Math.min(clipContextMenu.y, Math.max(8, window.innerHeight - 190));
				return createPortal(
					<div
						className="fixed w-[180px] rounded-xl border border-white/15 bg-neutral-950/95 shadow-2xl backdrop-blur overflow-hidden text-sm"
						style={{ left, top, zIndex: 10000 }}
						onPointerDown={(e) => e.stopPropagation()}
					>
						{menuTrack?.type === "instrument" && (
							<button className="w-full text-left px-3 py-2 hover:bg-violet-400/10" onClick={() => { setMidiEditorClipId(clipContextMenu.clipId); setClipContextMenu(null); }}>♬ Edit MIDI</button>
						)}
						<button className="w-full text-left px-3 py-2 hover:bg-white/10 flex justify-between" onClick={() => cutClip(clipContextMenu.clipId)}><span>Cut</span><span className="opacity-45 text-xs">Ctrl+X</span></button>
						<button className="w-full text-left px-3 py-2 hover:bg-white/10 flex justify-between" onClick={() => copyClip(clipContextMenu.clipId)}><span>Copy</span><span className="opacity-45 text-xs">Ctrl+C</span></button>
						<div className="h-px bg-white/10" />
						<button className="w-full text-left px-3 py-2 hover:bg-rose-500/15 text-rose-200 flex justify-between" onClick={() => removeClipFromDaw(clipContextMenu.clipId)}><span>Delete</span><span className="opacity-45 text-xs">Del</span></button>
					</div>,
					document.body,
				);
			})()}

			{midiEditorClip && (
				<MidiEditor
					clip={midiEditorClip as MidiEditableClip}
					clipStartBar={midiEditorClip.startBar}
					projectPlayheadBars={playheadPosBars}
					isPlaying={isPlaying}
					loopEnabled={loopEnabled}
					bpm={bpm}
					snapEnabled={snapEnabled}
					sigNum={sigNum}
					sigDen={sigDen}
					ghostClips={midiGhostClips}
					onChange={updateMidiEditorClip}
					onPreview={previewMidiNote}
					onSeekProjectBar={(bar) => { if (isPlaying) stop(); setPlayheadPosBars(clamp(bar, 1, endBar)); }}
					onReturnStart={() => setPlayheadPosBars(1)}
					onStop={() => { stop(); setPlayheadPosBars(1); }}
					onTogglePlay={togglePlay}
					onToggleLoop={toggleLoopPlayback}
					onJumpEnd={() => setPlayheadPosBars(endBar)}
					onBpmChange={setBpm}
					onSignatureChange={(n, d) => { setSigNum(n); setSigDen(d); }}
					onClose={() => setMidiEditorClipId(null)}
				/>
			)}

			{projectSheetOpen &&
				createPortal(
					<div
						className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center"
						role="dialog"
						aria-modal="true"
						onMouseDown={(e) => {
							if (e.target === e.currentTarget) setProjectSheetOpen(false);
						}}
					>
						<div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
						<div className="relative w-full sm:w-[560px] max-w-[95vw] bg-neutral-950/80 border border-neutral-200/15 dark:border-neutral-800 rounded-2xl shadow-2xl p-4 sm:p-5">
							<div className="flex items-center justify-between gap-3">
								<div className="text-sm font-semibold tracking-wide">Project</div>
								<YSButton className="px-2 py-1 rounded-md" onClick={() => setProjectSheetOpen(false)}>
									Close
								</YSButton>
							</div>

							<div className="mt-3">
								<label className="text-[11px] uppercase tracking-wide opacity-60">Name</label>
								<input
									value={projectName}
									onChange={(e) => setProjectName(e.target.value)}
									className="mt-1 w-full bg-neutral-950/60 border border-neutral-200/15 dark:border-neutral-800 rounded-xl px-3 py-2 text-sm outline-none focus:border-sky-300/40"
									placeholder="Untitled Project"
								/>
								<div className="mt-1 text-[11px] opacity-60 flex items-center gap-2">
									<span>{isSavingUi ? "Saving…" : "Autosaved"}</span>
									<span className="opacity-40">•</span>
									<span className="opacity-60">{activeProjectId.slice(0, 8)}</span>
								</div>
							</div>

							<div className="mt-4 flex flex-wrap gap-2">
								<YSButton
									className="px-3 py-2 rounded-xl"
									onClick={createNewProject}
									title="Start fresh"
								>
									New
								</YSButton>
								<YSButton
									className="px-3 py-2 rounded-xl"
									onClick={() => {
										clearProject();
										setProjectSheetOpen(false);
									}}
									title="Clear tracks, clips, and project assets"
								>
									Clear
								</YSButton>
							</div>

							<div className="mt-5">
								<div className="text-[11px] uppercase tracking-wide opacity-60 mb-2">Recent</div>
								<div className="max-h-[260px] overflow-auto rounded-xl border border-neutral-200/10 dark:border-neutral-800 bg-neutral-950/40">
									{readProjects().length === 0 ? (
										<div className="p-3 text-[12px] opacity-60">No recent projects yet.</div>
									) : (
										readProjects()
											.sort((a, b) => b.updatedAt - a.updatedAt)
											.slice(0, 12)
											.map((p) => (
												<button
													key={p.id}
													type="button"
													className={`w-full text-left px-3 py-2 flex items-center justify-between gap-3 hover:bg-neutral-100/5 ${
														p.id === activeProjectId ? "bg-neutral-100/5" : ""
													}`}
													onClick={() => loadProject(p.id)}
													title="Load project"
												>
													<div className="min-w-0">
														<div className="text-sm truncate">
															{p.name || "Untitled Project"}
														</div>
														<div className="text-[11px] opacity-50 truncate">
															{p.id.slice(0, 12)}
														</div>
													</div>
													<div className="text-[11px] opacity-50 shrink-0">
														{new Date(p.updatedAt).toLocaleString()}
													</div>
												</button>
											))
									)}
								</div>
							</div>
						</div>
					</div>,
					document.body,
				)}
		</div>
	);
}
