// src/tabs/DAW.tsx
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import "./daw-tablet.css";
import { createPortal } from "react-dom";
import type { TabRendererProps } from "./core";
import { YSButton } from "../components/YSButton";
import MidiEditor, { type MidiEditableClip } from "../components/MidiEditor";
import MidiToVocalPanel from "../components/MidiToVocalPanel";
import { copyVocalSetup, type VocalSetup } from "../lib/midiToVocal";
import TransportConsole from "../components/TransportConsole";
import OnScreenKeyboard from "../components/OnScreenKeyboard";
import FxChainPanel from "../components/FxChainPanel";
import DynamicsC1Editor from "../components/DynamicsC1Editor";
import BrowserEffectEditor from "../components/BrowserEffectEditor";
import DawAgentPanel from "../components/DawAgentPanel";
import type { DawAgentProposal } from "../lib/dawAgentContract";
import AiComposerPanel from "../components/AiComposerPanel";
import InstrumentCatalogPanel from "../components/InstrumentCatalogPanel";
import AiSoundDesignerPanel from "../components/AiSoundDesignerPanel";
import ProgressiveStemComposerPanel from "../components/ProgressiveStemComposerPanel";
import { bridgeApi, type BridgeMidiEvent, type BridgeMidiInputDevice, type BridgePlugin, type InstrumentCatalogEntry, type Vst3MidiEvent, type Vst3OfflineRenderTrack, type Vst3TrackEffect } from "../lib/bridgeApi";
import { clearGmSoundFontTrackDestination, gmSoundFontNoteOff, gmSoundFontNoteOn, prepareGmSoundFont, scheduleGmSoundFontNote, setGmSoundFontTrackDestination, stopGmSoundFontPlayback } from "../lib/gmSoundFont";
import {
	buildStandardMidiFile,
	decodeStereoFloatWav,
	downloadBlob,
	encodeStereoWav,
	safeExportFileName,
	type DawExportMidiTrack,
} from "../lib/dawExport";
import { connectWebAudioEffects, createDynamicsC1Effect, createBrowserEffect, normalizeTrackEffects, dbToGain, type DawTrackEffect, type DynamicsC1Effect, type BrowserEffect, type BrowserEffectType, type WebAudioEffectRuntime } from "../lib/dawEffects";
import { createDefaultMixerStrip, normalizeMixerStrip, patchMixerStrip, type DawMixerStripState } from "../lib/dawMixer";
import { publishDawSessionSnapshot, subscribeDawSessionCommands } from "../lib/dawSessionBus";
import { claimPlaybackOwner, getPlaybackOwner } from "../lib/playbackOwner";
import { consumeGeneratedSession, type GeneratedSessionManifest, type GeneratedSessionTrack } from "../lib/generatedSession";
import { parseSongGenerationResult, type SongGenerationResult } from "../lib/songGenerationContract";
import { planSongGenerationImport } from "../lib/songGenerationImport";
import { listGenerations, upsertGeneration, type GenerationRecord } from "../lib/generationLibrary";
import type { ComposerArrangement, ComposerProjectContext, ComposerProposal } from "../lib/aiComposer";
import type { ProgressiveStemState, StemDependency, StemNode, StemProposal, StemRole } from "../lib/progressiveStemComposer";
import { transcribeMonophonicVocal } from "../lib/vocalToMidi";
import { fallbackFxChainPlan, normalizeFxChainPlan, parseFxChainPlanReply, type FxChainPlan } from "../lib/fxChainPlanner";
import { localAiChat } from "../lib/localAiApi";
import { projectEndBar } from "../lib/dawDuration";
import { automationValue, automationValueBounds, normalizeAutomationLanes, type AutomationInterpolation, type AutomationLane, type AutomationParameter } from "../lib/dawAutomation";
import { detectWarpTransients, normalizeWarpMarkers, type WarpMarker } from "../lib/dawWarp";
import { addCompRange, MAX_DAW_TAKES, normalizeCompRanges, type DawTake, type DawCompRange } from "../lib/dawTakes";
import { appendJournal, journalKey, recoverJournal } from "../lib/dawAutosaveJournal";
import {
	GM_PROGRAMS,
	NOTE_NAMES,
	SCALE_DEFINITIONS,
	normalizeGmProgram,
	type BuiltinInstrument,
	type MidiAutomationPoint,
	type MidiNote,
	type MidiScaleLock,
	type MidiScaleRule,
} from "../lib/midi";

type TrackType = "audio" | "instrument";
type PartGeneration =
	| { origin: "ai-composer" | "progressive-stem"; role: string; requestId: string; createdAt: string; replacedClipId?: string; parentRequestId?: string }
	| { origin: "create-song"; role: string; vocalRole?: GeneratedSessionTrack["vocalRole"]; singerId?: string; singerName?: string; singerAvatarRef?: string; sourceTrackId: string; sessionId: string; createdAt: string; failure?: { code: "generation_failed" | "upload_failed"; message: string } }
	| { origin: "generation-library"; role: string; sourcePartId: string; generationId: string; artifactId?: string; createdAt: string }
	| { origin: "vocal-transcription"; role: "vocal melody"; sourceClipId: string; sourceAssetId: string; algorithm: "ysong-yin-v1"; createdAt: string };

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
	// AI/session-generation target. Bridge preset enumeration is not universal yet,
	// so preserve the producer hint without pretending it was loaded.
	vstPresetHint?: string;
	// Bridge owns the payload; the project retains only its local snapshot identity.
	vstSnapshot?: { id: string; pluginPath: string; capturedAt: string; hasFullState: boolean; parameterCount: number };
	// Additive Create Song provenance. A user reassignment clears the old match.
	instrumentIntent?: GeneratedSessionTrack["instrumentIntent"];
	desiredInstrument?: string;
	instrumentResolution?: GeneratedSessionTrack["instrumentResolution"];
	// Optional per-track hardware MIDI filter. Undefined means every enabled input.
	midiInputName?: string;
	// Ordered insert chain. Audio flows through this array from first to last.
	effects?: DawTrackEffect[];
	automation?: AutomationLane[];
	// Full console channel-strip state shared by the DAW and YC-9000 mixer.
	mixer?: DawMixerStripState;
	partGeneration?: PartGeneration;
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
	vocalSetup?: VocalSetup;
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
	warpMarkers?: WarpMarker[];
	// Alternate source lanes and non-destructive selections within this clip.
	takes?: DawTake[];
	compRanges?: DawCompRange[];
	// Semitones relative to the original asset; rendered per clip, never into the asset.
	pitchSemitones?: number;
	timePitchMode?: "independent" | "linked";
	fadeInBars?: number;
	fadeOutBars?: number;

	// MIDI clip data. Stored as structured musical data, never baked into audio.
	midiNotes?: MidiNote[];
	midiPitchBend?: MidiAutomationPoint[];
	midiModulation?: MidiAutomationPoint[];
	midiBendRange?: number;
	midiScales?: MidiScaleRule[];
	midiScaleLock?: MidiScaleLock;
	// Phase 25/28 structured provenance. These fields persist with the project and remain editable/non-destructive.
	composerRole?: string;
	composerChords?: Array<{ atBar: number; symbol: string; durationBars: number }>;
	stemNodeId?: string;
	stemVersion?: number;
	stemUniverseHash?: string;
	stemGenerationFamily?: string;
	partGeneration?: PartGeneration;
	// Prior committed content lives with its canonical clip and persists in DawPersistV1.
	partAlternatives?: Array<Omit<Clip, "partAlternatives">>;
	partStemNode?: StemNode;
};

type VocalMidiPreview = {
	sourceClipId: string;
	sourceAssetId: string;
	name: string;
	startBar: number;
	lengthBars: number;
	notes: MidiNote[];
	pitchBend: MidiAutomationPoint[];
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
const DEFAULT_END_BAR = 2;
const GM_EXPORT_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15] as const;

// Add-track menu sizing (used for viewport clamping)
const MENU_W = 240;
const MENU_H = 112;

// Bottom-center drawer handle(s) sit on top of the app; reserve space so transport text isn't covered.
const BOTTOM_DOCK_SAFE_PX = 56;

// The DAW can be mounted under React StrictMode in development. StrictMode intentionally
// runs an extra setup -> cleanup -> setup cycle for Effects on first mount. A cleanup-only
// Effect that immediately cleared the Bridge MIDI route therefore looked like a real DAW
// unmount and could erase the freshly-restored selected-instrument route on cold startup.
// Keep a tiny module-level ownership count and defer the final clear by one task. A real
// unmount still clears the native route, while StrictMode's probe (or a fast DAW remount)
// reclaims ownership before the clear is allowed to fire.
let dawMidiRouteOwnerCount = 0;
let dawMidiRouteClearTimer: number | null = null;

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
		mixer: createDefaultMixerStrip(),
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

// Resampling changes pitch and duration together. WSOLA above compensates for
// that duration change when a clip requests independent pitch and time.
function resampleForPitch(ctx: AudioContext, input: AudioBuffer, pitchRate: number, outputFrames: number) {
	const output = ctx.createBuffer(input.numberOfChannels, outputFrames, input.sampleRate);
	for (let channel = 0; channel < input.numberOfChannels; channel++) {
		const src = input.getChannelData(channel);
		const dst = output.getChannelData(channel);
		for (let frame = 0; frame < outputFrames; frame++) {
			const position = Math.min(src.length - 1, frame * pitchRate);
			const left = Math.floor(position);
			const fraction = position - left;
			dst[frame] = (src[left] ?? 0) * (1 - fraction) + (src[Math.min(left + 1, src.length - 1)] ?? 0) * fraction;
		}
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
	type GeneratedProjectProvenance = {
		origin: "create-song" | "generation-library";
		sessionId?: string;
		generationId?: string;
		artifactIds?: string[];
		createdAt: number;
		title: string;
		singers?: NonNullable<GeneratedSessionManifest["singerRoster"]>;
		songResult?: SongGenerationResult;
	};
	type DawPersistV1 = {
		v: 1;
		generation?: GeneratedProjectProvenance;
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
		endMarkerMode?: "auto" | "manual";
		loopEnabled: boolean;

		bpm: number;
		sigNum: number;
		sigDen: number;
		trackHeights?: Record<string, number>;
		zoomPct?: number;
		masterLevel?: number;
		approvedComposerArrangement?: ComposerArrangement | null;
		progressiveStemState?: ProgressiveStemState;
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
	const [automationTrackId, setAutomationTrackId] = useState<string | null>(null);
	const [automationParameter, setAutomationParameter] = useState<AutomationParameter>("track:level");
	const [selectedAutomationPointIds, setSelectedAutomationPointIds] = useState<string[]>([]);
	const automationClipboardRef = useRef<Array<{ offset: number; value: number; mode?: AutomationInterpolation }> | null>(null);
	const [dawHydrated, setDawHydrated] = useState(false);
	const [vst3Plugins, setVst3Plugins] = useState<BridgePlugin[]>([]);
	const [bridgeAvailable, setBridgeAvailable] = useState<boolean | null>(null);
	const [midiInputDevices, setMidiInputDevices] = useState<BridgeMidiInputDevice[]>([]);
	const [vstTrackState, setVstTrackState] = useState<Record<string, { status: "loading" | "ready" | "error"; message?: string }>>({});
	const vstLoadedRef = useRef<Map<string, string>>(new Map());
	const vstLoadingRef = useRef<Map<string, Promise<void>>>(new Map());
	const vstRestoredRef = useRef<Set<string>>(new Set());
	const vstAssignmentVersionRef = useRef<Map<string, number>>(new Map());
	const [vstSoundState, setVstSoundState] = useState<Record<string, string>>({});
	const capturePendingRef = useRef<Set<string>>(new Set());
	const [capturePending, setCapturePending] = useState<Record<string, boolean>>({});
	const vstMetersRef = useRef<Record<string, number>>({});
	const vstGainReductionRef = useRef<Record<string, number>>({});
	const [trackPanelOpen, setTrackPanelOpen] = useState<boolean>(() => {
		try {
			const saved = sessionStorage.getItem("ysong:daw:trackPanelOpen");
			if (saved != null) return saved === "1";
		} catch {}
		return typeof window === "undefined" ? true : window.innerWidth >= 720;
	});
	const [touchEditMode, setTouchEditMode] = useState(false);

	useEffect(() => {
		try { sessionStorage.setItem("ysong:daw:trackPanelOpen", trackPanelOpen ? "1" : "0"); } catch {}
	}, [trackPanelOpen]);

	useEffect(() => {
		let cancelled = false;
		const refresh = () => {
			bridgeApi.getPlugins()
				.then((res) => { if (!cancelled) { setVst3Plugins(res.plugins ?? []); setBridgeAvailable(true); } })
				.catch(() => { if (!cancelled) setBridgeAvailable(false); });
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
	const [vocalMidiPreview, setVocalMidiPreview] = useState<VocalMidiPreview | null>(null);
	const [vocalMidiStatus, setVocalMidiStatus] = useState("");
	const [vocalMidiBusy, setVocalMidiBusy] = useState(false);
	const [vocalConfidence, setVocalConfidence] = useState(72);
	const [vocalMinimumNoteMs, setVocalMinimumNoteMs] = useState(90);
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
	const [projectGeneration, setProjectGeneration] = useState<GeneratedProjectProvenance | undefined>();
	const [projectSheetOpen, setProjectSheetOpen] = useState(false);
	const [fileMenuOpen, setFileMenuOpen] = useState(false);
	const fileMenuRef = useRef<HTMLDivElement | null>(null);
	const projectFileHandleRef = useRef<any>(null);
	const [fxChainTrackId, setFxChainTrackId] = useState<string | null>(null);
	const [fxEditorEffectId, setFxEditorEffectId] = useState<string | null>(null);
	const [exportOpen, setExportOpen] = useState(false);
	type ExportFormat = "wav16" | "wav24" | "flac" | "mp3" | "midi";
	const [exportFormat, setExportFormat] = useState<ExportFormat>("wav24");
	const [exportMp3Bitrate, setExportMp3Bitrate] = useState(320);
	const [exporting, setExporting] = useState(false);
	const [exportStatus, setExportStatus] = useState("");
	const [dawAgentOpen, setDawAgentOpen] = useState(false);
	const [agentFxPlan, setAgentFxPlan] = useState<{ trackId: string; plan: FxChainPlan } | null>(null);
	const [agentArrangement, setAgentArrangement] = useState<{ summary: string; suggestion: string } | null>(null);
	const [agentSoundIntent, setAgentSoundIntent] = useState("");
	const [aiComposerOpen, setAiComposerOpen] = useState(false);
	const [instrumentCatalogOpen, setInstrumentCatalogOpen] = useState(false);
	const [soundDesignerOpen, setSoundDesignerOpen] = useState(false);
	const [progressiveStemOpen, setProgressiveStemOpen] = useState(false);
	const [approvedComposerArrangement, setApprovedComposerArrangement] = useState<ComposerArrangement | null>(null);
	const [progressiveStemState, setProgressiveStemState] = useState<ProgressiveStemState>({ universe: null, nodes: [], activeByRole: {} });
	const generatedSessionPendingRef = useRef<GeneratedSessionManifest | null>(null);
	const generatedSessionTargetProjectRef = useRef<string | null>(null);
	const [generatedSessionRevision, setGeneratedSessionRevision] = useState(0);
	const generationImportPendingRef = useRef<GenerationRecord | null>(null);
	const generationImportTargetRef = useRef<string | null>(null);
	const handledGenerationImportRef = useRef<string | null>(null);
	const exportSampleRate = 48000;
	const [isSavingUi, setIsSavingUi] = useState(false);
	const [persistedSnapshot, setPersistedSnapshot] = useState<{ id: string; fingerprint: string } | null>(null);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [hydratedProjectId, setHydratedProjectId] = useState<string | null>(null);
	const [pendingProjectId, setPendingProjectId] = useState<string | null>(null);
	const [switchError, setSwitchError] = useState<string | null>(null);
	const handledLocalOpenRequestRef = useRef<string | null>(null);
	const autosaveTimerRef = useRef<number | null>(null);
	const activeProjectRef = useRef(activeProjectId);
	const tracksRef = useRef(tracks);
	activeProjectRef.current = activeProjectId;
	tracksRef.current = tracks;

	// --- Markers (bars are 1..BARS) ---
	const [playheadPosBars, setPlayheadPosBars] = useState(1); // float bars (1.0 = bar 1)
	const [loopL, setLoopL] = useState(1);
	const [loopR, setLoopR] = useState(5);
	const [endBar, setEndBar] = useState(DEFAULT_END_BAR);
	const [endMarkerMode, setEndMarkerMode] = useState<"auto" | "manual">("auto");
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
	}, [clips, loopR, playheadPosBars, endBar]);
	useEffect(() => {
		if (!dawHydrated || endMarkerMode !== "auto") return;
		setEndBar(projectEndBar(clips, { maxBars: MAX_BARS }));
	}, [dawHydrated, clips, endMarkerMode]);

	type ProjectMeta = { id: string; name: string; updatedAt: number; generation?: GeneratedProjectProvenance };

	const readProjects = (): ProjectMeta[] => {
		try {
			const raw = localStorage.getItem(PROJECTS_KEY);
			const parsed = raw ? (JSON.parse(raw) as ProjectMeta[]) : [];
			return Array.isArray(parsed) ? parsed.filter((item): item is ProjectMeta =>
				!!item && typeof item.id === "string" && item.id.length > 0 && typeof item.name === "string" && typeof item.updatedAt === "number") : [];
		} catch {
			return [];
		}
	};

	const upsertProjectMeta = (id: string, name: string, generation?: GeneratedProjectProvenance) => {
		const list = readProjects();
		const now = Date.now();
		const next = [{ id, name, updatedAt: now, ...(generation ? { generation } : {}) }, ...list.filter((p) => p.id !== id)].slice(0, 30);
		localStorage.setItem(PROJECTS_KEY, JSON.stringify(next));
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
		activeProjectRef.current = id;
		vstLoadedRef.current.clear();
		vstRestoredRef.current.clear();
		try {
			localStorage.setItem(`ysong:projectName:${id}`, "Untitled Project");
		} catch {}
		projectFileHandleRef.current = null;
		setFxChainTrackId(null);
		setFxEditorEffectId(null);
		setActiveProjectId(id);
		setProjectSheetOpen(false);
		setFileMenuOpen(false);
	};

	const clearProject = () => {
		stop();
		bridgeApi.unloadAllVst3().catch(() => {});
		vstLoadedRef.current.clear();
		vstRestoredRef.current.clear();
		setVstSoundState({});
		tracksRef.current = [];
		vstMetersRef.current = {};
		setVstTrackState({});
		setTracks([]);
		setClips([]);
		setProjectAssets([]);
		setApprovedComposerArrangement(null);
		setProgressiveStemState({ universe: null, nodes: [], activeByRole: {} });
		setTrackHeights({});
		setSelectedTrackId(null);
		setSelectedClipId(null);
		setPlayheadPosBars(1);
		setLoopL(1);
		setLoopR(5);
		setEndBar(DEFAULT_END_BAR);
		setEndMarkerMode("auto");
		setLoopEnabled(false);
		setMasterLevel(100);
		setFxChainTrackId(null);
		setFxEditorEffectId(null);
		setFileMenuOpen(false);
	};

	const loadProject = (id: string) => {
		activeProjectRef.current = id;
		vstLoadedRef.current.clear();
		vstRestoredRef.current.clear();
		setVstSoundState({});
		if (autosaveTimerRef.current != null) window.clearTimeout(autosaveTimerRef.current);
		autosaveTimerRef.current = null;
		setHydratedProjectId(null);
		setPersistedSnapshot(null);
		setSaveError(null);
		setPendingProjectId(null);
		setSwitchError(null);
		projectFileHandleRef.current = null;
		setFxChainTrackId(null);
		setFxEditorEffectId(null);
		setActiveProjectId(id);
		setProjectSheetOpen(false);
		setFileMenuOpen(false);
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
	const [masterLevel, setMasterLevel] = useState(100);
	const [renamingTrackId, setRenamingTrackId] = useState<string | null>(null);
	const [renamingTrackName, setRenamingTrackName] = useState("");

	const getTrackHeight = (trackId: string, _type?: TrackType) =>
		Math.max(MIN_TRACK_H, trackHeights[trackId] ?? ROW_H);

	useEffect(() => {
		const staged = () => setGeneratedSessionRevision((v) => v + 1);
		window.addEventListener("ysong:generated-session-staged", staged);
		return () => window.removeEventListener("ysong:generated-session-staged", staged);
	}, []);

	// WebAudio context (lazy)
	const audioCtxRef = useRef<AudioContext | null>(null);
	const masterGainRef = useRef<GainNode | null>(null);
	const masterVisualAnalyserRef = useRef<AnalyserNode | null>(null);
	type TrackAudioBus = {
		input: GainNode; trim: GainNode; hpf: BiquadFilterNode; lpf: BiquadFilterNode; low: BiquadFilterNode; lowMid: BiquadFilterNode; highMid: BiquadFilterNode; high: BiquadFilterNode; compressor: DynamicsCompressorNode;
		gain: GainNode; widthInput: GainNode; splitter: ChannelSplitterNode; widthLL: GainNode; widthLR: GainNode; widthRL: GainNode; widthRR: GainNode; merger: ChannelMergerNode; panner: StereoPannerNode; analyser: AnalyserNode;
		effectSignature: string; effectRuntimes: Map<string, WebAudioEffectRuntime>;
	};
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
	const liveGmNoteKeysRef = useRef<Set<string>>(new Set());
	const liveVstNoteIdsRef = useRef<Map<string, number>>(new Map());
	type RecordingSession = { clipId: string; trackId: string; startedAtMs: number; startBar: number; active: Map<number, { id: string; startBars: number; velocity: number }> };
	const recordingSessionRef = useRef<RecordingSession | null>(null);
	const signedUrlCacheRef = useRef<Map<string, { url: string; expiresAt: number }>>(new Map());
	const lastPosRef = useRef<number>(1);
	const meterRafRef = useRef<number | null>(null);
	const loopSchedulerTimerRef = useRef<number | null>(null);
	const loopScheduleNextCtxTimeRef = useRef(0);
	const loopSchedulerBusyRef = useRef(false);
	const transportPrimedRef = useRef(false);
	const transportStartGenerationRef = useRef(0);
	const transportStartPendingRef = useRef(false);
	const lastVisualTransportPushRef = useRef(0);

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
			setClips((prev) => prev.filter((c) => !c.assetId || !explicitIds.has(c.assetId)).map((clip) => {
				const takes = clip.takes?.filter((take) => !explicitIds.has(take.assetId));
				return { ...clip, takes, compRanges: clip.compRanges?.filter((range) => takes?.some((take) => take.id === range.takeId)) };
			}));
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
	const playStartCtxTimeRef = useRef<number>(0);
	const transportBarSecRef = useRef<number>(2);
	const transportClockUnixOffsetMsRef = useRef<number>(0);
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
		vstAssignmentVersionRef.current.set(id, (vstAssignmentVersionRef.current.get(id) ?? 0) + 1);
		tracksRef.current = tracksRef.current.filter((track) => track.id !== id);
		const deletingTrack = tracks.find((t) => t.id === id);
		if (deletingTrack?.vst3PluginPath) {
			bridgeApi.unloadVst3Instrument(id).catch(() => {});
			vstLoadedRef.current.delete(id);
			vstRestoredRef.current.clear();
		}
		// Silence all currently playing/pre-scheduled sources owned by this track
		// before removing its UI/project state.
		for (const clip of clips) {
			if (clip.trackId === id) stopSourcesForClip(clip.id);
		}

		// clear selected clip if it's on this track
		const clipOnTrack = clips.find((c) => c.id === selectedClipId);
		if (clipOnTrack?.trackId === id) setSelectedClipId(null);

		// clear selected track / effect UI if it belongs to this track
		if (selectedTrackId === id) setSelectedTrackId(null);
		if (fxChainTrackId === id) {
			setFxChainTrackId(null);
			setFxEditorEffectId(null);
		}

		// remove the track
		setTracks((prev) => prev.filter((t) => t.id !== id));

		// remove clips on that track
		setClips((prev) => prev.filter((c) => c.trackId !== id));
		setTrackHeights((prev) => {
			const next = { ...prev };
			delete next[id];
			return next;
		});
		clearGmSoundFontTrackDestination(id);
		const bus = trackAudioBusesRef.current.get(id);
		if (bus) {
			try { bus.input.disconnect(); } catch {}
			for (const runtime of bus.effectRuntimes.values()) {
				try { runtime.stop?.(); } catch {}
				for (const node of runtime.nodes) { try { node.disconnect(); } catch {} }
			}
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

	const updateAutomationLane = (trackId: string, parameter: AutomationParameter, update: (lane: AutomationLane) => AutomationLane) => {
		setTracks((previous) => previous.map((track) => {
			if (track.id !== trackId) return track;
			const lanes = normalizeAutomationLanes(track.automation);
			const lane = lanes.find((item) => item.parameter === parameter) ?? { parameter, enabled: true, interpolation: "linear" as const, points: [] };
			return { ...track, automation: [...lanes.filter((item) => item.parameter !== parameter), update(lane)] };
		}));
	};

	const copyAutomationPoints = (lane: AutomationLane) => {
		const points = lane.points.filter((point) => selectedAutomationPointIds.includes(point.id));
		if (!points.length) return;
		const firstBar = Math.min(...points.map((point) => point.bar));
		automationClipboardRef.current = points.map((point) => ({ offset: point.bar - firstBar, value: point.value, mode: lane.segmentModes?.[point.id] ?? lane.interpolation }));
	};
	const pasteAutomationPoints = (trackId: string, parameter: AutomationParameter, bar: number) => {
		const copied = automationClipboardRef.current;
		if (!copied?.length) return;
		const [min, max] = automationValueBounds(parameter);
		const ids = copied.map(() => crypto.randomUUID());
		updateAutomationLane(trackId, parameter, (lane) => {
			const points = copied.map((point, index) => ({ id: ids[index], bar: Math.max(1, bar + point.offset), value: clamp(point.value, min, max) }));
			const segmentModes = { ...lane.segmentModes };
			points.forEach((point, index) => { const mode = copied[index].mode; if (mode) segmentModes[point.id] = mode; });
			return { ...lane, points: [...lane.points.filter((point) => !points.some((added) => Math.abs(added.bar - point.bar) < 0.0001)), ...points].sort((a, b) => a.bar - b.bar), segmentModes };
		});
		setSelectedAutomationPointIds(ids);
	};

	const setTrackLevel = (id: string, level: number) => {
		setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, level: clamp(Math.round(level), 0, 127) } : t)));
	};

	const setTrackMixer = (id: string, patch: Partial<DawMixerStripState>) => {
		setTracks((prev) => prev.map((track) => track.id === id ? { ...track, mixer: patchMixerStrip(track.mixer, patch) } : track));
	};

	const setTrackSend = (id: string, index: number, update: { level?: number; pre?: boolean }) => {
		setTracks((prev) => prev.map((track) => {
			if (track.id !== id) return track;
			const mixer = normalizeMixerStrip(track.mixer);
			if (index < 0 || index >= mixer.sends.length) return track;
			const sends = mixer.sends.map((send, i) => i === index ? { ...send, ...(update.level == null ? {} : { level: clamp(update.level, 0, 100) }), ...(update.pre == null ? {} : { pre: update.pre }) } : send);
			return { ...track, mixer: { ...mixer, sends } };
		}));
	};

	const toVstTrackEffects = (effects: DawTrackEffect[] = []): Vst3TrackEffect[] => effects.filter((effect): effect is DynamicsC1Effect => effect.type === "compressor").map((effect) => ({
		id: effect.id, type: "compressor", enabled: effect.enabled, inputGainDb: effect.inputGainDb, thresholdDb: effect.thresholdDb,
		ratio: effect.ratio, attackMs: effect.attackMs, releaseMs: effect.releaseMs, kneeDb: effect.kneeDb, outputGainDb: effect.outputGainDb,
	}));

	const addDynamicsC1 = (trackId: string) => {
		const effect = createDynamicsC1Effect();
		setTracks((prev) => prev.map((track) => track.id === trackId ? { ...track, effects: [...(track.effects ?? []), effect] } : track));
		setFxEditorEffectId(effect.id);
	};

	const addBrowserEffect = (trackId: string, type: BrowserEffectType) => {
		const effect = createBrowserEffect(type);
		setTracks((prev) => prev.map((track) => track.id === trackId ? { ...track, effects: [...(track.effects ?? []), effect] } : track));
		setFxEditorEffectId(effect.id);
	};

	const updateTrackEffect = (trackId: string, effectId: string, patch: Partial<DynamicsC1Effect> | Partial<BrowserEffect>) => {
		setTracks((prev) => prev.map((track) => track.id === trackId ? {
			...track,
			effects: (track.effects ?? []).map((effect) => effect.id === effectId ? { ...effect, ...patch, id: effect.id, type: effect.type, name: effect.name } as DawTrackEffect : effect),
		} : track));
	};

	const toggleTrackEffect = (trackId: string, effectId: string) => {
		setTracks((prev) => prev.map((track) => track.id === trackId ? { ...track, effects: (track.effects ?? []).map((effect) => effect.id === effectId ? { ...effect, enabled: !effect.enabled } : effect) } : track));
	};

	const removeTrackEffect = (trackId: string, effectId: string) => {
		setTracks((prev) => prev.map((track) => track.id === trackId ? { ...track, effects: (track.effects ?? []).filter((effect) => effect.id !== effectId) } : track));
		setFxEditorEffectId((current) => current === effectId ? null : current);
	};

	const reorderTrackEffect = (trackId: string, from: number, to: number) => {
		setTracks((prev) => prev.map((track) => {
			if (track.id !== trackId) return track;
			const effects = [...(track.effects ?? [])];
			if (from < 0 || from >= effects.length || to < 0 || to >= effects.length) return track;
			const [moved] = effects.splice(from, 1);
			effects.splice(to, 0, moved);
			return { ...track, effects };
		}));
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
		const projectId = activeProjectRef.current;
		const path = track.vst3PluginPath;
		const assignmentVersion = vstAssignmentVersionRef.current.get(track.id) ?? 0;
		const currentTrack = () => activeProjectRef.current === projectId &&
			(vstAssignmentVersionRef.current.get(track.id) ?? 0) === assignmentVersion &&
			tracksRef.current.some((current) => current.id === track.id && current.type === "instrument" && current.vst3PluginPath === path);
		const pendingKey = `${projectId}\0${track.id}\0${path}\0${assignmentVersion}`;
		const pending = vstLoadingRef.current.get(pendingKey);
		if (pending) return pending;
		if (!currentTrack()) return;
		const work = async () => {
		// A prior project or assignment may use the same Bridge track ID. Let its
		// in-flight load/restore finish before this assignment can own that ID.
		const earlier = Array.from(vstLoadingRef.current.entries())
			.filter(([key]) => key !== pendingKey && key.split("\0")[1] === track.id)
			.map(([, operation]) => operation);
		if (earlier.length) await Promise.allSettled(earlier);
		if (!currentTrack()) return;
		if (vstLoadedRef.current.get(track.id) !== path) {
		setVstTrackState((prev) => ({ ...prev, [track.id]: { status: "loading" } }));
		try {
			const loaded = await bridgeApi.loadVst3Instrument(track.id, path);
			if (!currentTrack()) return;
			if (loaded.plugin?.path !== path) throw new Error("Bridge loaded a different plugin path.");
			vstLoadedRef.current.set(track.id, path);
			for (const key of vstRestoredRef.current) if (key.startsWith(`${projectId}\0${track.id}\0`)) vstRestoredRef.current.delete(key);
			await bridgeApi.setVst3Effects(track.id, toVstTrackEffects(track.effects));
			if (!currentTrack()) return;
			await bridgeApi.setVst3Mixer(track.id, computedTrackGain(track) <= 0, clamp(track.level ?? 100, 0, 127), nativeMixerForTrack(track));
			if (!currentTrack()) return;

			// Selection owns live hardware MIDI. On a cold YSong launch the selection
			// effect can run before Bridge is ready and its one-shot /midi/route request
			// is lost. Successful native load is a reliable convergence point, so reassert
			// the route here for the currently-selected VST instrument.
			if (selectedTrackId === track.id) {
				await bridgeApi.setMidiRoute(track.id, track.midiInputName ?? null);
				if (!currentTrack()) return;
			}

			setVstTrackState((prev) => ({ ...prev, [track.id]: { status: "ready" } }));
			if (loaded.plugin?.name && loaded.plugin.name !== track.vst3PluginName) {
				setTracks((prev) => prev.map((t) => t.id === track.id && t.vst3PluginPath === path && activeProjectRef.current === projectId ? {
					...t,
					vst3PluginName: loaded.plugin.name,
					vst3PluginVendor: loaded.plugin.vendor ?? t.vst3PluginVendor,
				} : t));
			}
		} catch (error) {
			if (!currentTrack()) return;
			vstLoadedRef.current.delete(track.id);
			const message = error instanceof Error ? error.message : "Could not load VST3 instrument.";
			setVstTrackState((prev) => ({ ...prev, [track.id]: { status: "error", message } }));
			setVstSoundState((prev) => ({ ...prev, [track.id]: `Instrument load failed; saved state was not restored: ${message}` }));
			throw error;
		}
		}
		if (!currentTrack()) return;
		const snapshot = tracksRef.current.find((current) => current.id === track.id)?.vstSnapshot;
		if (!snapshot) return;
		if (snapshot.pluginPath !== path) {
			setVstSoundState((prev) => ({ ...prev, [track.id]: "Saved instrument state belongs to another plugin path; restore skipped." }));
			return;
		}
		const restoreKey = `${pendingKey}\0${snapshot.id}`;
		if (vstRestoredRef.current.has(restoreKey)) return;
		setVstSoundState((prev) => ({ ...prev, [track.id]: "Restoring saved instrument state…" }));
		try {
			if (!currentTrack() || tracksRef.current.find((current) => current.id === track.id)?.vstSnapshot?.id !== snapshot.id) return;
			const result = await bridgeApi.restoreInstrumentSnapshot(track.id, snapshot.id);
			if (!currentTrack() || tracksRef.current.find((current) => current.id === track.id)?.vstSnapshot?.id !== snapshot.id) return;
			if (result.snapshot.id !== snapshot.id || result.snapshot.pluginPath !== path) throw new Error("Bridge returned a different snapshot or plugin path.");
			vstRestoredRef.current.add(restoreKey);
			setVstSoundState((prev) => ({ ...prev, [track.id]: result.snapshot.hasFullState ? "Bridge restored the saved snapshot; it may have used parameter fallback. Sound equivalence is unverified." : "Saved parameters restored; native plugin state was unavailable." }));
		} catch (error) {
			if (currentTrack() && tracksRef.current.find((current) => current.id === track.id)?.vstSnapshot?.id === snapshot.id) {
				setVstSoundState((prev) => ({ ...prev, [track.id]: `Saved instrument state was not restored: ${error instanceof Error ? error.message : "Bridge restore failed."}` }));
			}
		}
		};
		const promise = work().finally(() => { vstLoadingRef.current.delete(pendingKey); });
		vstLoadingRef.current.set(pendingKey, promise);
		return promise;
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

	const setTrackInstrumentSource = async (track: Track, value: string): Promise<boolean> => {
		const newPath = value.startsWith("vst3:") ? value.slice(5) : undefined;
		if (newPath === track.vst3PluginPath) return true;
		vstAssignmentVersionRef.current.set(track.id, (vstAssignmentVersionRef.current.get(track.id) ?? 0) + 1);
		tracksRef.current = tracksRef.current.map((current) => current.id === track.id ? { ...current, vst3PluginPath: newPath, vstSnapshot: undefined } : current);
		vstRestoredRef.current.clear();
		setVstSoundState((prev) => { const next = { ...prev }; delete next[track.id]; return next; });
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
				vstPresetHint: undefined, instrumentResolution: undefined, vstSnapshot: undefined,
			} : t));
			if (isPlaying) { stop(); requestAnimationFrame(() => start(loopEnabled)); }
			return true;
		}

		if (!value.startsWith("vst3:")) return false;
		const path = value.slice(5);
		const catalog = vst3Plugins.find((plugin) => plugin.path === path);
		const previousTrack = { ...track };
		const nextTrack: Track = {
			...track,
			vst3PluginPath: path,
			vst3PluginName: catalog?.name ?? "VST3",
			vst3PluginVendor: catalog?.vendor ?? undefined,
			vstPresetHint: undefined,
			instrumentResolution: undefined,
			vstSnapshot: undefined,
		};
		setTracks((prev) => prev.map((t) => t.id === track.id ? nextTrack : t));
		vstLoadedRef.current.delete(track.id);
		try {
			await ensureVstLoaded(nextTrack);
			const currentList = tracks.map((t) => t.id === track.id ? nextTrack : t);
			await bridgeApi.setVst3Mixer(track.id, computedTrackGain(nextTrack, currentList) <= 0, nextTrack.level ?? 100, nativeMixerForTrack(nextTrack));
			if (isPlaying) { stop(); requestAnimationFrame(() => start(loopEnabled)); }
			return true;
		} catch (error) {
			// A failed native load must not leave the project claiming that the broken
			// plugin is assigned. Restore the exact previous GM/VST assignment.
			setTracks((prev) => prev.map((t) => t.id === track.id ? previousTrack : t));
			tracksRef.current = tracksRef.current.map((t) => t.id === track.id ? previousTrack : t);
			vstLoadedRef.current.delete(track.id);
			try {
				if (previousTrack.vst3PluginPath) await ensureVstLoaded(previousTrack);
				else await bridgeApi.unloadVst3Instrument(track.id);
			} catch {}
			const message = error instanceof Error ? error.message : "Could not load VST3 instrument.";
			window.alert(`YSong Bridge could not load ${catalog?.name ?? "that VST3"}.\n\n${message}`);
			return false;
		}
	};

	const assignInstrumentFromCatalog = async (instrument: InstrumentCatalogEntry): Promise<string | null> => {
		const target = selectedTrackId ? tracks.find((track) => track.id === selectedTrackId && track.type === "instrument") ?? null : null;
		if (!target) return null;
		const loaded = await setTrackInstrumentSource(target, `vst3:${instrument.path}`);
		return loaded ? target.id : null;
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
			vocalSetup: copyVocalSetup(source.vocalSetup, source.midiNotes ?? [], cloneNotes ?? []),
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

	const crossfadeIntoNextClip = (clipId: string) => {
		const left = clips.find((clip) => clip.id === clipId);
		if (!left?.assetId) return;
		const right = clips.filter((clip) => clip.assetId && clip.trackId === left.trackId && clip.id !== left.id && clip.startBar >= left.startBar)
			.sort((a, b) => a.startBar - b.startBar)[0];
		if (!right) return;
		const leftEnd = left.startBar + left.lengthBars;
		const gap = right.startBar - leftEnd;
		if (gap > 0.001 || gap < -left.lengthBars) return;
		const barSec = getBarSeconds();
		const overlap = Math.max(0, leftEnd - right.startBar);
		const leftAsset = findAssetById(left.assetId);
		const sourceOffset = Math.max(0, left.sourceOffsetSec ?? 0);
		const sourceDuration = Math.max(0.001, left.sourceDurationSec ?? left.lengthBars * barSec);
		const sourcePerBar = sourceDuration / left.lengthBars;
		const availableTail = leftAsset?.durationSec == null ? 0 : Math.max(0, (leftAsset.durationSec - sourceOffset - sourceDuration) / sourcePerBar);
		const extension = overlap > 0 ? 0 : Math.min(0.25, availableTail, right.lengthBars, bars + 1 - leftEnd);
		const fadeBars = Math.min(overlap || extension, right.lengthBars, left.lengthBars + extension);
		if (fadeBars <= 0.001) return;
		setClips((current) => current.map((clip) => {
			if (clip.id === left.id) return {
				...clip,
				lengthBars: clip.lengthBars + extension,
				sourceDurationSec: extension > 0 ? sourceDuration + extension * sourcePerBar : clip.sourceDurationSec,
				fadeOutBars: fadeBars,
				fadeInBars: Math.min(clip.fadeInBars ?? 0, clip.lengthBars + extension - fadeBars),
			};
			if (clip.id === right.id) return { ...clip, fadeInBars: fadeBars, fadeOutBars: Math.min(clip.fadeOutBars ?? 0, clip.lengthBars - fadeBars) };
			return clip;
		}));
		setClipContextMenu(null);
		if (isPlaying) { stop(); requestAnimationFrame(() => start(loopEnabled)); }
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
		if (e.pointerType === "touch" && !touchEditMode) return;
		seekTransport(clientXToBarInEl(e.clientX, e.currentTarget as HTMLElement, bars));
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
		if (e.pointerType === "touch" && !touchEditMode) {
			const clip = clips.find((c) => c.id === clipId);
			if (clip) { setSelectedTrackId(clip.trackId); setSelectedClipId(clip.id); }
			return;
		}
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
			const pitchRate = clipNow?.timePitchMode === "linked" ? 1 : 2 ** (clamp(Number(clipNow?.pitchSemitones) || 0, -12, 12) / 12);
			const minStretchBars = Math.max(minLen, naturalBars * 0.25 / pitchRate);
			const maxStretchBars = Math.min(bars + 1 - st.startClipBar, naturalBars * 4 / pitchRate);
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
		if (e.pointerType === "touch" && !touchEditMode) return;
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
			setEndMarkerMode("manual");
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
			masterGainRef.current.gain.value = clamp(masterLevel / 100, 0, 1.27);
			masterGainRef.current.connect(audioCtxRef.current.destination);
			const visualAnalyser = audioCtxRef.current.createAnalyser();
			visualAnalyser.fftSize = 2048;
			visualAnalyser.smoothingTimeConstant = 0.72;
			visualAnalyser.minDecibels = -90;
			visualAnalyser.maxDecibels = -10;
			masterGainRef.current.connect(visualAnalyser);
			masterVisualAnalyserRef.current = visualAnalyser;
		} catch {
			masterGainRef.current = null;
		}
		return audioCtxRef.current;
	};

	const trackLevelToGain = (level?: number) => clamp((level ?? 100) / 100, 0, 1.27);

	useEffect(() => {
		const ctx = audioCtxRef.current;
		const master = masterGainRef.current;
		if (!ctx || !master) return;
		master.gain.cancelScheduledValues(ctx.currentTime);
		master.gain.setTargetAtTime(clamp(masterLevel / 100, 0, 1.27), ctx.currentTime, 0.008);
	}, [masterLevel]);

	useEffect(() => {
		if (bridgeAvailable === false) return;
		bridgeApi.setVst3Master(masterLevel).catch(() => {});
	}, [masterLevel, bridgeAvailable]);

	const computedTrackGain = (track: Track, trackList = tracks) => {
		const anySolo = trackList.some((t) => t.solo);
		const audible = !track.mute && (!anySolo || track.solo);
		return audible ? trackLevelToGain(automationValue(track.automation?.find((lane) => lane.parameter === "track:level"), playheadPosBars, track.level ?? 100)) : 0;
	};

	const trackUsesNativeVst = (track: Track | null | undefined) => !!track?.vst3PluginPath && bridgeAvailable !== false;
	const mixerForTrack = (track: Track) => normalizeMixerStrip(track.mixer);
	const nativeMixerForTrack = (track: Track) => {
		const mixer = mixerForTrack(track);
		return {
			inputGainDb: mixer.inputGainDb, phaseInvert: mixer.phaseInvert,
			hpfEnabled: mixer.hpfEnabled, hpfHz: mixer.hpfHz, lpfEnabled: mixer.lpfEnabled, lpfHz: mixer.lpfHz,
			eqEnabled: mixer.eqEnabled, lowGainDb: mixer.lowGainDb, lowFreqHz: mixer.lowFreqHz,
			lowMidGainDb: mixer.lowMidGainDb, lowMidFreqHz: mixer.lowMidFreqHz, lowMidQ: mixer.lowMidQ,
			highMidGainDb: mixer.highMidGainDb, highMidFreqHz: mixer.highMidFreqHz, highMidQ: mixer.highMidQ,
			highGainDb: mixer.highGainDb, highFreqHz: mixer.highFreqHz,
			compressorEnabled: mixer.compressorEnabled, compressorThresholdDb: mixer.compressorThresholdDb, compressorRatio: mixer.compressorRatio,
			compressorAttackMs: mixer.compressorAttackMs, compressorReleaseMs: mixer.compressorReleaseMs,
			pan: mixer.pan, width: mixer.width,
		};
	};

	const effectSignatureForTrack = (track: Track) => JSON.stringify(track.effects ?? []);

	const configureTrackAudioBus = (track: Track, bus: TrackAudioBus) => {
		const ctx = ensureAudioCtx();
		const mixer = mixerForTrack(track);
		const trimGain = dbToGain(mixer.inputGainDb) * (mixer.phaseInvert ? -1 : 1);
		bus.trim.gain.setTargetAtTime(trimGain, ctx.currentTime, 0.008);
		bus.hpf.type = "highpass";
		bus.hpf.frequency.setTargetAtTime(mixer.hpfEnabled ? mixer.hpfHz : 10, ctx.currentTime, 0.008);
		bus.hpf.Q.value = 0.707;
		bus.lpf.type = "lowpass";
		bus.lpf.frequency.setTargetAtTime(mixer.lpfEnabled ? mixer.lpfHz : Math.min(22000, ctx.sampleRate * 0.49), ctx.currentTime, 0.008);
		bus.lpf.Q.value = 0.707;
		bus.low.type = "lowshelf";
		bus.low.frequency.setTargetAtTime(mixer.lowFreqHz, ctx.currentTime, 0.008);
		bus.low.gain.setTargetAtTime(mixer.eqEnabled ? mixer.lowGainDb : 0, ctx.currentTime, 0.008);
		bus.lowMid.type = "peaking";
		bus.lowMid.frequency.setTargetAtTime(mixer.lowMidFreqHz, ctx.currentTime, 0.008);
		bus.lowMid.Q.setTargetAtTime(mixer.lowMidQ, ctx.currentTime, 0.008);
		bus.lowMid.gain.setTargetAtTime(mixer.eqEnabled ? mixer.lowMidGainDb : 0, ctx.currentTime, 0.008);
		bus.highMid.type = "peaking";
		bus.highMid.frequency.setTargetAtTime(mixer.highMidFreqHz, ctx.currentTime, 0.008);
		bus.highMid.Q.setTargetAtTime(mixer.highMidQ, ctx.currentTime, 0.008);
		bus.highMid.gain.setTargetAtTime(mixer.eqEnabled ? mixer.highMidGainDb : 0, ctx.currentTime, 0.008);
		bus.high.type = "highshelf";
		bus.high.frequency.setTargetAtTime(mixer.highFreqHz, ctx.currentTime, 0.008);
		bus.high.gain.setTargetAtTime(mixer.eqEnabled ? mixer.highGainDb : 0, ctx.currentTime, 0.008);
		bus.compressor.threshold.setTargetAtTime(mixer.compressorEnabled ? mixer.compressorThresholdDb : 0, ctx.currentTime, 0.008);
		bus.compressor.ratio.setTargetAtTime(mixer.compressorEnabled ? mixer.compressorRatio : 1, ctx.currentTime, 0.008);
		bus.compressor.attack.setTargetAtTime(mixer.compressorAttackMs / 1000, ctx.currentTime, 0.008);
		bus.compressor.release.setTargetAtTime(mixer.compressorReleaseMs / 1000, ctx.currentTime, 0.008);
		bus.compressor.knee.setTargetAtTime(mixer.compressorEnabled ? 12 : 0, ctx.currentTime, 0.008);
		const w = clamp(mixer.width / 100, 0, 2);
		const same = (1 + w) * 0.5;
		const cross = (1 - w) * 0.5;
		bus.widthLL.gain.setTargetAtTime(same, ctx.currentTime, 0.008);
		bus.widthRR.gain.setTargetAtTime(same, ctx.currentTime, 0.008);
		bus.widthLR.gain.setTargetAtTime(cross, ctx.currentTime, 0.008);
		bus.widthRL.gain.setTargetAtTime(cross, ctx.currentTime, 0.008);
		bus.panner.pan.setTargetAtTime(automationValue(track.automation?.find((lane) => lane.parameter === "track:pan"), playheadPosBars, mixer.pan), ctx.currentTime, 0.008);
	};

	const rebuildTrackAudioEffects = (track: Track, bus: TrackAudioBus) => {
		const signature = effectSignatureForTrack(track);
		if (signature === bus.effectSignature) return;
		try { bus.compressor.disconnect(); } catch {}
		for (const runtime of bus.effectRuntimes.values()) {
			try { runtime.stop?.(); } catch {}
			for (const node of runtime.nodes) { try { node.disconnect(); } catch {} }
		}
		bus.effectRuntimes = connectWebAudioEffects(ensureAudioCtx(), bus.compressor, track.effects ?? [], bus.gain);
		bus.effectSignature = signature;
	};

	const ensureTrackAudioBus = (trackId: string) => {
		const track = tracks.find((t) => t.id === trackId);
		const existing = trackAudioBusesRef.current.get(trackId);
		if (existing) {
			if (track) { configureTrackAudioBus(track, existing); rebuildTrackAudioEffects(track, existing); }
			if (track?.type === "instrument" && !trackUsesNativeVst(track)) setGmSoundFontTrackDestination(ensureAudioCtx(), track.id, existing.input);
			return existing;
		}

		const ctx = ensureAudioCtx();
		const input = ctx.createGain();
		const trim = ctx.createGain();
		const hpf = ctx.createBiquadFilter();
		const lpf = ctx.createBiquadFilter();
		const low = ctx.createBiquadFilter();
		const lowMid = ctx.createBiquadFilter();
		const highMid = ctx.createBiquadFilter();
		const high = ctx.createBiquadFilter();
		const compressor = ctx.createDynamicsCompressor();
		const gain = ctx.createGain();
		const widthInput = ctx.createGain();
		const splitter = ctx.createChannelSplitter(2);
		const widthLL = ctx.createGain();
		const widthLR = ctx.createGain();
		const widthRL = ctx.createGain();
		const widthRR = ctx.createGain();
		const merger = ctx.createChannelMerger(2);
		const panner = ctx.createStereoPanner();
		const analyser = ctx.createAnalyser();
		analyser.fftSize = 256;
		analyser.smoothingTimeConstant = 0.65;
		input.connect(trim); trim.connect(hpf); hpf.connect(lpf); lpf.connect(low); low.connect(lowMid); lowMid.connect(highMid); highMid.connect(high); high.connect(compressor);
		gain.connect(widthInput); widthInput.connect(splitter);
		splitter.connect(widthLL, 0); splitter.connect(widthRL, 0); splitter.connect(widthLR, 1); splitter.connect(widthRR, 1);
		widthLL.connect(merger, 0, 0); widthLR.connect(merger, 0, 0); widthRL.connect(merger, 0, 1); widthRR.connect(merger, 0, 1);
		merger.connect(panner); panner.connect(analyser);
		if (masterGainRef.current) analyser.connect(masterGainRef.current); else analyser.connect(ctx.destination);
		const bus: TrackAudioBus = { input, trim, hpf, lpf, low, lowMid, highMid, high, compressor, gain, widthInput, splitter, widthLL, widthLR, widthRL, widthRR, merger, panner, analyser, effectSignature: "", effectRuntimes: new Map() };
		if (track) { configureTrackAudioBus(track, bus); rebuildTrackAudioEffects(track, bus); }
		else compressor.connect(gain);
		gain.gain.value = track ? computedTrackGain(track) : 1;
		trackAudioBusesRef.current.set(trackId, bus);
		if (track?.type === "instrument" && !trackUsesNativeVst(track)) setGmSoundFontTrackDestination(ctx, track.id, input);
		return bus;
	};

	const syncTrackAudioBuses = (trackList = tracks) => {
		const ctx = audioCtxRef.current;
		if (!ctx) return;
		for (const track of trackList) {
			const bus = trackAudioBusesRef.current.get(track.id);
			if (!bus) continue;
			configureTrackAudioBus(track, bus);
			rebuildTrackAudioEffects(track, bus);
			if (track.type === "instrument" && !trackUsesNativeVst(track)) setGmSoundFontTrackDestination(ctx, track.id, bus.input);
			else clearGmSoundFontTrackDestination(track.id);
			const target = computedTrackGain(track, trackList);
			bus.gain.gain.cancelScheduledValues(ctx.currentTime);
			bus.gain.gain.setTargetAtTime(target, ctx.currentTime, 0.008);
			for (const effect of track.effects ?? []) {
				if (effect.type !== "compressor") continue;
				const runtime = bus.effectRuntimes.get(effect.id)?.compressor;
				if (!runtime) continue;
				const lane = track.automation?.find((item) => item.parameter === `effect:${effect.id}:thresholdDb`);
				runtime.threshold.setTargetAtTime(automationValue(lane, playheadPosBars, effect.thresholdDb), ctx.currentTime, 0.008);
			}
		}
	};

	useEffect(() => {
		syncTrackAudioBuses(tracks);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [dawHydrated, tracks, playheadPosBars]);

	// Persisted VST assignments are part of the DAW project. Once project state is
	// hydrated, reconcile the native Bridge instances with those assignments.
	useEffect(() => {
		if (bridgeAvailable === false) {
			vstLoadedRef.current.clear();
			vstRestoredRef.current.clear();
			return;
		}
		if (!dawHydrated) return;
		const wanted = new Map(
			tracks
				.filter((track) => track.type === "instrument" && !!track.vst3PluginPath)
				.map((track) => [track.id, track.vst3PluginPath!] as const),
		);

		for (const [trackId, loadedPath] of Array.from(vstLoadedRef.current.entries())) {
			if (wanted.get(trackId) === loadedPath) continue;
			vstLoadedRef.current.delete(trackId);
			vstRestoredRef.current.clear();
			delete vstMetersRef.current[trackId];
			bridgeApi.unloadVst3Instrument(trackId).catch(() => {});
		}

		for (const track of tracks) {
			if (track.type !== "instrument" || !track.vst3PluginPath) continue;
			const snapshot = track.vstSnapshot;
			const restoreKey = `${activeProjectId}\0${track.id}\0${track.vst3PluginPath}\0${vstAssignmentVersionRef.current.get(track.id) ?? 0}\0${snapshot?.id}`;
			if (vstLoadedRef.current.get(track.id) === track.vst3PluginPath && (!snapshot || vstRestoredRef.current.has(restoreKey))) continue;
			void ensureVstLoaded(track).catch(() => {});
		}
		// Catalog refresh is included so a Bridge restart/re-scan naturally gives a
		// persisted project another chance to restore its native instances.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [dawHydrated, activeProjectId, tracks, vst3Plugins, bridgeAvailable]);

	// Mute / solo / level remain the source of truth in the DAW. Mirror them into
	// native VST instances so Bridge audio follows the same mixer rules as WebAudio.
	useEffect(() => {
		const anySolo = tracks.some((track) => track.solo);
		for (const track of tracks) {
			if (track.type !== "instrument" || !trackUsesNativeVst(track)) continue;
			const muted = track.mute || (anySolo && !track.solo);
			bridgeApi.setVst3Mixer(track.id, muted, clamp(track.level ?? 100, 0, 127), nativeMixerForTrack(track)).catch(() => {});
		}
	}, [tracks, bridgeAvailable]);

	useEffect(() => {
		if (!dawHydrated || bridgeAvailable === false) return;
		for (const track of tracks) {
			if (track.type !== "instrument" || !trackUsesNativeVst(track)) continue;
			bridgeApi.setVst3Effects(track.id, toVstTrackEffects(track.effects)).catch(() => {});
		}
	}, [dawHydrated, tracks, bridgeAvailable]);

	// Pull native meters/status from Bridge. If Bridge was restarted while YSong
	// stayed open, a missing instance is automatically recreated from project state.
	useEffect(() => {
		const projectId = activeProjectId;
		const assigned = bridgeAvailable === false ? [] : tracks.filter((track) => track.type === "instrument" && !!track.vst3PluginPath);
		if (assigned.length === 0) {
			vstMetersRef.current = {};
			vstGainReductionRef.current = {};
			return;
		}
		let cancelled = false;
		const poll = async () => {
			try {
				const response = await bridgeApi.getVst3Status();
				if (cancelled || activeProjectRef.current !== projectId) return;
				const instances = new Map(response.instances.map((instance) => [instance.trackId, instance] as const));
				const meters: Record<string, number> = {};
				for (const track of assigned) {
					const instance = instances.get(track.id);
					if (instance && instance.pluginPath === track.vst3PluginPath) {
						meters[track.id] = Math.max(0, instance.peak ?? 0);
						vstGainReductionRef.current[track.id] = Math.max(0, instance.gainReductionDb ?? 0);
						setVstTrackState((prev) => {
							const nextStatus = instance.error ? { status: "error" as const, message: instance.error } : { status: "ready" as const };
							const current = prev[track.id];
							if (current?.status === nextStatus.status && current?.message === nextStatus.message) return prev;
							return { ...prev, [track.id]: nextStatus };
						});
					} else if (vstLoadedRef.current.get(track.id) === track.vst3PluginPath) {
						vstLoadedRef.current.delete(track.id);
						vstRestoredRef.current.clear();
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
	}, [tracks, bridgeAvailable, activeProjectId]);

	useEffect(() => {
		if (meterRafRef.current != null) cancelAnimationFrame(meterRafRef.current);
		meterRafRef.current = null;

		const hasNativeVst = tracks.some((track) => trackUsesNativeVst(track));
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
					if (trackUsesNativeVst(track)) {
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
	// Keep a live ref so Bridge reconnect callbacks never capture a stale pre-hydration
	// selection. This matters on cold startup where the MIDI SSE connection can open
	// while persisted DAW state is still being restored.
	const selectedMidiTargetRef = useRef<Track | null>(null);
	selectedMidiTargetRef.current = selectedMidiTarget;
	const currentMidiTargetTrack = () => selectedMidiTargetRef.current;

	// Warm the real GM engine as soon as a GM track is selected. The SoundFont is
	// ~31 MB, so doing the parse before the first actual key press keeps live MIDI
	// from feeling like the first note was swallowed. AudioContext resume still occurs
	// on the user's performance gesture.
	useEffect(() => {
		if (!selectedMidiTarget || trackUsesNativeVst(selectedMidiTarget)) return;
		const ctx = ensureAudioCtx();
		ensureTrackAudioBus(selectedMidiTarget.id);
		void prepareGmSoundFont(ctx).catch((error) => console.error("YSong General MIDI SoundFont preload failed", error));
	}, [selectedMidiTarget?.id, selectedMidiTarget?.vst3PluginPath, bridgeAvailable]);

	const liveNoteKey = (trackId: string, pitch: number) => `${trackId}:${pitch}`;

	const liveMidiNoteOn = (pitch: number, velocity = 96, targetOverride?: Track | null) => {
		const target = targetOverride ?? currentMidiTargetTrack();
		if (!target) return;
		const normalizedPitch = clamp(Math.round(pitch), 0, 127);
		const normalizedVelocity = clamp(Math.round(velocity), 1, 127);
		const key = liveNoteKey(target.id, normalizedPitch);
		captureRecordedMidi("on", normalizedPitch, normalizedVelocity, target);

		if (trackUsesNativeVst(target)) {
			const noteId = stablePositiveInt(`${target.id}:live:${normalizedPitch}:${Date.now()}:${Math.random()}`);
			liveVstNoteIdsRef.current.set(key, noteId);
			void ensureVstLoaded(target)
				.then(() => bridgeApi.scheduleVst3Midi(target.id, [{ kind: "on", note: normalizedPitch, velocity: normalizedVelocity, noteId, whenUnixMs: Date.now() + 4 }]))
				.catch(() => {});
			return;
		}

		// v31: real General MIDI playback. One GeneralUser GS SoundFont engine is
		// shared across melodic channels; the selected track owns this live note.
		const ctx = ensureAudioCtx();
		ensureTrackAudioBus(target.id);
		void ctx.resume().catch(() => {});
		liveGmNoteKeysRef.current.add(key);
		const gmAudible = computedTrackGain(target) > 0;
		void gmSoundFontNoteOn(
			ctx,
			target.id,
			normalizeGmProgram(target.vst3PluginPath && bridgeAvailable === false ? 0 : (gmProgramOverrideRef.current.get(target.id) ?? target.gmProgram ?? 0)),
			normalizedPitch,
			normalizedVelocity,
			target.level ?? 100,
			!gmAudible,
		).catch((error) => console.error("YSong General MIDI SoundFont note-on failed", error));
	};

	const liveMidiNoteOff = (pitch: number, targetOverride?: Track | null) => {
		const target = targetOverride ?? currentMidiTargetTrack();
		if (!target) return;
		const normalizedPitch = clamp(Math.round(pitch), 0, 127);
		const key = liveNoteKey(target.id, normalizedPitch);
		captureRecordedMidi("off", normalizedPitch, 1, target);

		if (trackUsesNativeVst(target)) {
			const noteId = liveVstNoteIdsRef.current.get(key);
			liveVstNoteIdsRef.current.delete(key);
			if (noteId != null) void bridgeApi.scheduleVst3Midi(target.id, [{ kind: "off", note: normalizedPitch, velocity: 0, noteId, whenUnixMs: Date.now() + 2 }]).catch(() => {});
			return;
		}

		liveGmNoteKeysRef.current.delete(key);
		const ctx = ensureAudioCtx();
		void gmSoundFontNoteOff(ctx, target.id, normalizedPitch).catch(() => {});
	};

	const panicLiveMidi = () => {
		liveGmNoteKeysRef.current.clear();
		stopGmSoundFontPlayback();
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
			// Selection owns live performance. Release any SoundFont notes still held
			// by the track we just left so another instrument never plays accidentally.
			const ctx = ensureAudioCtx();
			for (const key of [...liveGmNoteKeysRef.current]) {
				if (!key.startsWith(`${previousId}:`)) continue;
				const pitch = Number(key.slice(key.lastIndexOf(":") + 1));
				liveGmNoteKeysRef.current.delete(key);
				if (Number.isFinite(pitch)) void gmSoundFontNoteOff(ctx, previousId, clamp(pitch, 0, 127)).catch(() => {});
			}

			// YSong's on-screen keys schedule VST notes through HTTP rather than the native
			// hardware route, so explicitly release those held notes as selection moves.
			for (const [key, noteId] of liveVstNoteIdsRef.current) {
				if (!key.startsWith(`${previousId}:`)) continue;
				const pitch = Number(key.slice(key.lastIndexOf(":") + 1));
				if (Number.isFinite(pitch)) void bridgeApi.scheduleVst3Midi(previousId, [{ kind: "off", note: clamp(pitch, 0, 127), velocity: 0, noteId, whenUnixMs: Date.now() + 2 }]).catch(() => {});
				liveVstNoteIdsRef.current.delete(key);
			}
			setHardwareActiveNotes(new Set());
		}
		previousLiveTargetIdRef.current = nextId;
	}, [selectedMidiTarget?.id]);

	// Only Bridge-hosted VST3 tracks need a native low-latency MIDI route.
	// General MIDI stays in the browser and consumes the same hardware events from
	// the SSE monitor stream, so do not point Bridge at a GM track and spam false
	// "VST not loaded" drops. Selection still owns both paths.
	useEffect(() => {
		// Do not clear/rewrite the Bridge route from the empty pre-hydration render.
		// Once the saved project selection exists, converge the Bridge toward that route.
		if (!dawHydrated) return;
		let cancelled = false;
		const syncRoute = async () => {
			// Startup ordering is intentionally loose (Bridge, Vite and the DAW restore in
			// parallel). If Bridge is not listening on the first attempt, retry briefly
			// instead of leaving hardware MIDI dead until the user clicks the track.
			for (let attempt = 0; attempt < 20 && !cancelled; attempt += 1) {
				const current = selectedMidiTargetRef.current;
				const nativeTrackId = trackUsesNativeVst(current) ? current!.id : null;
				try {
					await bridgeApi.setMidiRoute(nativeTrackId, current?.midiInputName ?? null);
					return;
				} catch {
					if (attempt < 19) await new Promise<void>((resolve) => window.setTimeout(resolve, 500));
				}
			}
		};
		void syncRoute();
		return () => { cancelled = true; };
	}, [dawHydrated, selectedMidiTarget?.id, selectedMidiTarget?.midiInputName, selectedMidiTarget?.vst3PluginPath, bridgeAvailable]);

	// Own the native route for the lifetime of a mounted DAW. React StrictMode deliberately
	// probes Effects with setup -> cleanup -> setup on the initial development mount. The old
	// cleanup-only Effect posted route=null during that probe and could win the startup race
	// after the saved instrument route had already been restored. Defer the final clear by one
	// macrotask and cancel it as soon as any DAW instance owns the route again.
	useEffect(() => {
		dawMidiRouteOwnerCount += 1;
		if (dawMidiRouteClearTimer != null) {
			window.clearTimeout(dawMidiRouteClearTimer);
			dawMidiRouteClearTimer = null;
		}

		return () => {
			dawMidiRouteOwnerCount = Math.max(0, dawMidiRouteOwnerCount - 1);
			if (dawMidiRouteClearTimer != null) window.clearTimeout(dawMidiRouteClearTimer);
			dawMidiRouteClearTimer = window.setTimeout(() => {
			dawMidiRouteClearTimer = null;
			if (dawMidiRouteOwnerCount !== 0) return;
			void bridgeApi.setMidiRoute(null, null).catch(() => {});
		}, 0);
		};
	}, []);

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
			if (trackUsesNativeVst(target)) {
				// Native Bridge already feeds VST3 directly; only mirror the performance
				// into the recorder/UI here so we do not double-trigger the synth.
				captureRecordedMidi(event.kind === "noteon" ? "on" : "off", note, event.velocity ?? 1, target);
				return;
			}
			if (event.kind === "noteon") liveMidiNoteOn(note, event.velocity ?? 96, target);
			else liveMidiNoteOff(note, target);
		}, (connected) => {
			if (!connected || !dawHydrated) return;
			// SSE onopen is the authoritative "Bridge is alive now" signal. Read the live
			// selection ref (not the render that created this EventSource) and reassert the
			// route after cold startup or any later Bridge restart.
			const current = selectedMidiTargetRef.current;
			const nativeTrackId = trackUsesNativeVst(current) ? current!.id : null;
			void bridgeApi.setMidiRoute(nativeTrackId, current?.midiInputName ?? null).catch(() => {});
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [dawHydrated, selectedMidiTarget?.id, selectedMidiTarget?.midiInputName, selectedMidiTarget?.vst3PluginPath, bridgeAvailable]);

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
		setHydratedProjectId(null);
		setPersistedSnapshot(null);
		setSaveError(null);
		let stored: string | null = null;
		let storedName = "Untitled Project";
		let journalRaw: string | null = null;
		try {
			stored = localStorage.getItem(DAW_STORAGE_KEY);
			storedName = localStorage.getItem(PROJECT_NAME_KEY) || storedName;
			journalRaw = localStorage.getItem(journalKey(activeProjectId));
		} catch (error) {
			setSaveError(error instanceof Error ? error.message : "Could not read local project storage.");
		}
		const recovered = recoverJournal(safeParse<DawPersistV1>(stored), stored, journalRaw);
		const data = recovered?.state ?? safeParse<DawPersistV1>(stored);
		if (recovered) storedName = recovered.name;
		setProjectName(storedName);
		if (!data || data.v !== 1) {
			// New/empty project: reset to defaults
			setProjectGeneration(undefined);
			if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
			setIsPlaying(false);
			stopScheduledAudio();
			setTracks([]);
			setClips([]);
			setProjectAssets([]);
			setApprovedComposerArrangement(null);
			setProgressiveStemState({ universe: null, nodes: [], activeByRole: {} });
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
			setEndMarkerMode("auto");
			setBars(MIN_BARS);
			setLoopEnabled(false);
			setBpm(120);
			setSigNum(4);
			setSigDen(4);
			setMasterLevel(100);
			setHydratedProjectId(activeProjectId);
			setDawHydrated(true);
			return;
		}

		// Never auto-resume playback on restore
		if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
		rafRef.current = null;
		setIsPlaying(false);

		const restoredTracks = (data.tracks ?? []).map((t) => ({ ...t, level: clamp(t.level ?? 100, 0, 127), effects: normalizeTrackEffects(t.effects), automation: normalizeAutomationLanes(t.automation), mixer: normalizeMixerStrip(t.mixer) }));
		const savedGeneration = parseSongGenerationResult(data.generation?.songResult);
		if (data.generation?.origin === "create-song" && savedGeneration) {
			for (const part of savedGeneration.parts) {
				if (part.status !== "failed" || restoredTracks.some((track) => track.partGeneration?.origin === "create-song" && track.partGeneration.sourceTrackId === part.id)) continue;
				const track = mkTrack(part.kind === "audio" ? "audio" : "instrument", restoredTracks.length + 1, crypto.randomUUID());
				track.name = part.name;
				track.partGeneration = { origin: "create-song", role: part.role, sourceTrackId: part.id, sessionId: savedGeneration.id,
					createdAt: new Date(savedGeneration.createdAt).toISOString(), failure: part.failure };
				restoredTracks.push({ ...track, level: track.level ?? 100, effects: normalizeTrackEffects(track.effects), automation: normalizeAutomationLanes(track.automation), mixer: normalizeMixerStrip(track.mixer) });
			}
		}
		setProjectGeneration(data.generation && (data.generation.origin === "create-song" || data.generation.origin === "generation-library") ? data.generation : undefined);
		setTracks(restoredTracks);
		setClips(data.clips ?? []);
		setProjectAssets((data.projectAssets ?? []).map(normalizeProjectAssetForPersist));
		setApprovedComposerArrangement(data.approvedComposerArrangement ?? null);
		setProgressiveStemState(data.progressiveStemState ?? { universe: null, nodes: [], activeByRole: {} });
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
		setEndBar(data.endBar ?? DEFAULT_END_BAR);
		// Preserve deliberate legacy endpoints; retire the old fixed default of 65.
		setEndMarkerMode(data.endMarkerMode ?? (data.endBar != null && data.endBar !== 65 ? "manual" : "auto"));
		setBars(MIN_BARS);
		setLoopEnabled(!!data.loopEnabled);

		setBpm(clamp(data.bpm ?? 120, 20, 400));
		setSigNum(data.sigNum ?? 4);
		setSigDen(data.sigDen ?? 4);
		setMasterLevel(clamp(data.masterLevel ?? 100, 0, 127));
		setPersistedSnapshot({ id: activeProjectId, fingerprint: JSON.stringify({ name: storedName, state: data }) });
		setHydratedProjectId(activeProjectId);
		setDawHydrated(true);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [DAW_STORAGE_KEY]);

	const buildDawPersistPayload = (): DawPersistV1 => ({
		v: 1,
		...(projectGeneration ? { generation: projectGeneration } : {}),
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
		endMarkerMode,
		loopEnabled,
		bpm,
		sigNum,
		sigDen,
		trackHeights,
		masterLevel,
		approvedComposerArrangement,
		progressiveStemState,
	});
	const currentFingerprint = JSON.stringify({ name: projectName, state: buildDawPersistPayload() });
	const currentPayloadRef = useRef<{ name: string; payload: DawPersistV1 }>({ name: projectName, payload: buildDawPersistPayload() });
	currentPayloadRef.current = { name: projectName, payload: buildDawPersistPayload() };
	const projectDirty = hydratedProjectId !== activeProjectId ||
		persistedSnapshot?.id !== activeProjectId || persistedSnapshot.fingerprint !== currentFingerprint;
	const saveState = saveError ? "Save failed" : projectDirty ? (isSavingUi ? "Saving…" : "Unsaved changes") : "Saved locally";

	const persistCurrentProject = (): boolean => {
		if (!dawHydrated || hydratedProjectId !== activeProjectId) {
			setSaveError("The project is still opening. Try saving again in a moment.");
			return false;
		}
		try {
			localStorage.setItem(DAW_STORAGE_KEY, JSON.stringify(buildDawPersistPayload()));
			localStorage.setItem(PROJECT_NAME_KEY, projectName);
			upsertProjectMeta(activeProjectId, projectName, projectGeneration);
			localStorage.removeItem(journalKey(activeProjectId));
			setPersistedSnapshot({ id: activeProjectId, fingerprint: currentFingerprint });
			setSaveError(null);
			return true;
		} catch (error) {
			setSaveError(error instanceof Error ? error.message : "Could not save to local project storage.");
			return false;
		}
	};

	const captureVstSound = async (track: Track) => {
		const projectId = activeProjectRef.current;
		const trackId = track.id;
		const path = track.vst3PluginPath;
		const assignmentVersion = vstAssignmentVersionRef.current.get(trackId) ?? 0;
		if (!dawHydrated || hydratedProjectId !== projectId || !projectId || track.type !== "instrument" || !path || capturePendingRef.current.has(trackId)) return;
		const matches = () => activeProjectRef.current === projectId &&
			(vstAssignmentVersionRef.current.get(trackId) ?? 0) === assignmentVersion &&
			tracksRef.current.some((current) => current.id === trackId && current.type === "instrument" && current.vst3PluginPath === path);
		capturePendingRef.current.add(trackId);
		setCapturePending((prev) => ({ ...prev, [trackId]: true }));
		setVstSoundState((prev) => ({ ...prev, [trackId]: "Capturing current instrument state…" }));
		try {
			await ensureVstLoaded(track);
			if (!matches()) return;
			if (vstLoadedRef.current.get(trackId) !== path) throw new Error("The matching instrument is not loaded.");
			const response = await bridgeApi.captureInstrumentSnapshot(trackId, `${track.name} instrument state`);
			if (!matches()) return;
			const snapshot = response.snapshot;
			if (!snapshot.id || snapshot.pluginPath !== path) throw new Error("Bridge captured a different plugin path.");
			if (!snapshot.hasFullState && snapshot.parameterCount <= 0) throw new Error("Bridge captured no restorable native state or parameters.");
			const previousTracks = currentPayloadRef.current.payload.tracks;
			const nextTracks = previousTracks.map((current) => current.id === trackId ? { ...current, vstSnapshot: {
				id: snapshot.id, pluginPath: snapshot.pluginPath, capturedAt: snapshot.createdAt,
				hasFullState: snapshot.hasFullState, parameterCount: snapshot.parameterCount,
			} } : current);
			const nextPayload = { ...currentPayloadRef.current.payload, tracks: nextTracks };
			const name = currentPayloadRef.current.name;
			const projectKey = `ysong:daw:${projectId}`;
			const nameKey = `ysong:projectName:${projectId}`;
			const oldProject = localStorage.getItem(projectKey);
			const oldName = localStorage.getItem(nameKey);
			try {
				localStorage.setItem(projectKey, JSON.stringify(nextPayload));
				localStorage.setItem(nameKey, name);
				upsertProjectMeta(projectId, name, projectGeneration);
			} catch (error) {
				try {
					if (oldProject === null) localStorage.removeItem(projectKey); else localStorage.setItem(projectKey, oldProject);
					if (oldName === null) localStorage.removeItem(nameKey); else localStorage.setItem(nameKey, oldName);
				} catch { /* The prior reference remains in memory if storage itself is unavailable. */ }
				throw error;
			}
			if (!matches()) return;
			tracksRef.current = nextTracks;
			setTracks(nextTracks);
			currentPayloadRef.current = { name, payload: nextPayload };
			setPersistedSnapshot({ id: projectId, fingerprint: JSON.stringify({ name, state: nextPayload }) });
			setSaveError(null);
			for (const key of vstRestoredRef.current) if (key.startsWith(`${projectId}\0${trackId}\0`)) vstRestoredRef.current.delete(key);
			vstRestoredRef.current.add(`${projectId}\0${trackId}\0${path}\0${assignmentVersion}\0${snapshot.id}`);
			setVstSoundState((prev) => ({ ...prev, [trackId]: snapshot.hasFullState
				? "Instrument state captured and saved locally in Bridge; native state was included."
				: "Instrument state captured and saved locally in Bridge; parameters only, so the sound may differ on reopen." }));
		} catch (error) {
			if (matches()) setVstSoundState((prev) => ({ ...prev, [trackId]: `Instrument state was not saved: ${error instanceof Error ? error.message : "Capture or local project save failed."}` }));
		} finally {
			capturePendingRef.current.delete(trackId);
			setCapturePending((prev) => ({ ...prev, [trackId]: false }));
		}
	};

	const requestOpenLocalProject = (id: string) => {
		if (id === activeProjectId) { setProjectSheetOpen(false); return; }
		const known = readProjects().some((project) => project.id === id);
		let stored: DawPersistV1 | null = null;
		try { stored = safeParse<DawPersistV1>(localStorage.getItem(`ysong:daw:${id}`)); } catch { /* Missing or inaccessible storage is an invalid target. */ }
		if (!known || stored?.v !== 1) {
			setSwitchError("That local project is missing or cannot be opened.");
			setProjectSheetOpen(true);
			return;
		}
		if (autosaveTimerRef.current != null) window.clearTimeout(autosaveTimerRef.current);
		autosaveTimerRef.current = null;
		setIsSavingUi(false);
		setSwitchError(null);
		if (projectDirty || saveError) setPendingProjectId(id);
		else loadProject(id);
	};

	const localOpenRequest = _props.tab.payload?.localProjectOpenRequest as { id?: unknown; requestId?: unknown } | undefined;
	useEffect(() => {
		if (!dawHydrated || hydratedProjectId !== activeProjectId ||
			typeof localOpenRequest?.requestId !== "string" ||
			handledLocalOpenRequestRef.current === localOpenRequest.requestId) return;
		handledLocalOpenRequestRef.current = localOpenRequest.requestId;
		if (typeof localOpenRequest.id !== "string" || !localOpenRequest.id) {
			setSwitchError("That local project is missing or cannot be opened.");
			setProjectSheetOpen(true);
			return;
		}
		requestOpenLocalProject(localOpenRequest.id);
	// The request token is the event identity. State changes while a switch is pending must not replay it.
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [localOpenRequest?.requestId, dawHydrated, hydratedProjectId, activeProjectId]);

	const confirmOpenLocalProject = (saveFirst: boolean) => {
		const id = pendingProjectId;
		if (!id) return;
		if (saveFirst && !persistCurrentProject()) return;
		// Recheck the target because browser storage can change while the dialog is open.
		let stored: DawPersistV1 | null = null;
		try { stored = safeParse<DawPersistV1>(localStorage.getItem(`ysong:daw:${id}`)); } catch { /* Missing or inaccessible storage is an invalid target. */ }
		if (!readProjects().some((project) => project.id === id) || stored?.v !== 1) {
			setSwitchError("That local project is missing or cannot be opened.");
			setPendingProjectId(null);
			setProjectSheetOpen(true);
			return;
		}
		if (!saveFirst) {
			try { localStorage.removeItem(journalKey(activeProjectId)); } catch { /* Storage errors are shown on the next open. */ }
		}
		loadProject(id);
	};

	type YSongProjectFileV1 = {
		format: "YSong Project";
		version: 1;
		name: string;
		savedAt: string;
		state: DawPersistV1;
	};

	const projectFileText = () => JSON.stringify({
		format: "YSong Project",
		version: 1,
		name: projectName.trim() || "Untitled Project",
		savedAt: new Date().toISOString(),
		state: buildDawPersistPayload(),
	} satisfies YSongProjectFileV1, null, 2);

	const writeProjectHandle = async (handle: any) => {
		const writable = await handle.createWritable();
		await writable.write(projectFileText());
		await writable.close();
	};

	const saveProjectAsFile = async () => {
		setFileMenuOpen(false);
		try {
			setIsSavingUi(true);
			const picker = (window as any).showSaveFilePicker as undefined | ((options: any) => Promise<any>);
			if (picker) {
				const handle = await picker({
					suggestedName: `${safeExportFileName(projectName)}.ysong`,
					types: [{ description: "YSong Project", accept: { "application/json": [".ysong"] } }],
				});
				await writeProjectHandle(handle);
				projectFileHandleRef.current = handle;
			} else {
				downloadBlob(new Blob([projectFileText()], { type: "application/json" }), `${safeExportFileName(projectName)}.ysong`);
			}
		} catch (error) {
			if (!(error instanceof DOMException && error.name === "AbortError")) window.alert(error instanceof Error ? error.message : "Could not save the YSong project.");
		} finally {
			setIsSavingUi(false);
		}
	};

	const saveProjectFile = async () => {
		setFileMenuOpen(false);
		const handle = projectFileHandleRef.current;
		if (!handle) { await saveProjectAsFile(); return; }
		try {
			setIsSavingUi(true);
			await writeProjectHandle(handle);
		} catch (error) {
			window.alert(error instanceof Error ? error.message : "Could not save the YSong project.");
		} finally {
			setIsSavingUi(false);
		}
	};

	const importProjectFile = async (file: File, handle?: any) => {
		const parsed = JSON.parse(await file.text()) as Partial<YSongProjectFileV1>;
		if (parsed.format !== "YSong Project" || parsed.version !== 1 || !parsed.state || parsed.state.v !== 1) throw new Error("That file is not a supported YSong project.");
		const id = crypto.randomUUID();
		const name = String(parsed.name || file.name.replace(/\.ysong$/i, "") || "Untitled Project");
		const state: DawPersistV1 = {
			...parsed.state,
			tracks: (parsed.state.tracks ?? []).map((track) => ({ ...track, level: clamp(track.level ?? 100, 0, 127), effects: normalizeTrackEffects(track.effects), automation: normalizeAutomationLanes(track.automation), mixer: normalizeMixerStrip(track.mixer) })),
			projectAssets: (parsed.state.projectAssets ?? []).map(normalizeProjectAssetForPersist),
		};
		localStorage.setItem(`ysong:daw:${id}`, JSON.stringify(state));
		localStorage.setItem(`ysong:projectName:${id}`, name);
		upsertProjectMeta(id, name, state.generation ? state.generation : undefined);
		projectFileHandleRef.current = handle ?? null;
		setFxChainTrackId(null);
		setFxEditorEffectId(null);
		activeProjectRef.current = id;
		vstLoadedRef.current.clear();
		vstRestoredRef.current.clear();
		setVstSoundState({});
		setActiveProjectId(id);
	};

	const openProjectFile = async () => {
		setFileMenuOpen(false);
		try {
			const picker = (window as any).showOpenFilePicker as undefined | ((options: any) => Promise<any[]>);
			if (picker) {
				const [handle] = await picker({ multiple: false, types: [{ description: "YSong Project", accept: { "application/json": [".ysong"] } }] });
				if (!handle) return;
				await importProjectFile(await handle.getFile(), handle);
				return;
			}

			const input = document.createElement("input");
			input.type = "file";
			input.accept = ".ysong,application/json";
			input.style.display = "none";
			document.body.appendChild(input);
			input.onchange = () => {
				const file = input.files?.[0];
				input.remove();
				if (file) void importProjectFile(file).catch((error) => window.alert(error instanceof Error ? error.message : "Could not open the YSong project."));
			};
			input.click();
		} catch (error) {
			if (!(error instanceof DOMException && error.name === "AbortError")) window.alert(error instanceof Error ? error.message : "Could not open the YSong project.");
		}
	};

	useEffect(() => {
		if (!fileMenuOpen) return;
		const onPointerDown = (event: PointerEvent) => {
			const menu = fileMenuRef.current;
			if (menu && event.target instanceof Node && !menu.contains(event.target)) setFileMenuOpen(false);
		};
		const onEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setFileMenuOpen(false); };
		window.addEventListener("pointerdown", onPointerDown);
		window.addEventListener("keydown", onEscape);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("keydown", onEscape);
		};
	}, [fileMenuOpen]);

	useEffect(() => {
		const onProjectShortcut = (event: KeyboardEvent) => {
			if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
			const key = event.key.toLowerCase();
			if (key === "s") {
				event.preventDefault();
				if (event.shiftKey) void saveProjectAsFile();
				else void saveProjectFile();
			} else if (key === "o") {
				event.preventDefault();
				void openProjectFile();
			} else if (key === "n") {
				event.preventDefault();
				createNewProject();
			}
		};
		window.addEventListener("keydown", onProjectShortcut);
		return () => window.removeEventListener("keydown", onProjectShortcut);
		// These are intentionally the same project-state inputs used by projectFileText().
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [projectName, projectGeneration, tracks, clips, projectAssets, trackHeights, selectedTrackId, selectedClipId, snapEnabled, gridValue, gridMode, zoomPct, playheadPosBars, loopL, loopR, endBar, endMarkerMode, loopEnabled, bpm, sigNum, sigDen, masterLevel, approvedComposerArrangement, progressiveStemState]);

	useEffect(() => {
		// Never autosave the component's empty pre-hydration render. On cold start,
		// the restore Effect and other mount Effects run from the same initial commit;
		// persisting before hydration can overwrite the saved selection/project with
		// transient defaults before React has committed the restored state.
		if (!dawHydrated || hydratedProjectId !== activeProjectId || pendingProjectId) return;
		if (!projectDirty && !saveError) return;
		setIsSavingUi(true);
		autosaveTimerRef.current = window.setTimeout(() => {
			autosaveTimerRef.current = null;
			try {
				const baseText = localStorage.getItem(DAW_STORAGE_KEY);
				const next = appendJournal(localStorage.getItem(journalKey(activeProjectId)),
					safeParse<DawPersistV1>(baseText), baseText, buildDawPersistPayload(), projectName);
				localStorage.setItem(journalKey(activeProjectId), next);
				setPersistedSnapshot({ id: activeProjectId, fingerprint: currentFingerprint });
				setSaveError(null);
			} catch (error) {
				setSaveError(error instanceof Error ? error.message : "Could not autosave the project journal.");
			}
			setIsSavingUi(false);
		}, 150);

		return () => {
			if (autosaveTimerRef.current != null) window.clearTimeout(autosaveTimerRef.current);
			autosaveTimerRef.current = null;
		};
		// A failed write stays failed until another edit or an explicit save; retrying on saveError would loop.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		dawHydrated,
		hydratedProjectId,
		activeProjectId,
		pendingProjectId,
		DAW_STORAGE_KEY,
		projectGeneration,
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
		endMarkerMode,
		loopEnabled,
		bpm,
		sigNum,
		sigDen,
		masterLevel,
		approvedComposerArrangement,
		progressiveStemState,
	]);


	// ---------------------------------------------------------------------
	// Linear DAW undo/redo history
	// ---------------------------------------------------------------------
	// Keep a small, size-limited tail of serializable project snapshots across
	// reloads. Runtime asset URLs are deliberately excluded from storage.
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
		endMarkerMode: "auto" | "manual";
		loopEnabled: boolean;
		bpm: number;
		sigNum: number;
		sigDen: number;
		masterLevel: number;
		approvedComposerArrangement: ComposerArrangement | null;
		progressiveStemState: ProgressiveStemState;
	};
	type DawHistoryEntry = { hash: string; state: DawHistorySnapshot };
	const historyRef = useRef<DawHistoryEntry[]>([]);
	const historyStorageKey = `ysong:daw:history:v1:${activeProjectId}`;
	const HISTORY_LIMIT = 12;
	const HISTORY_BYTES = 750_000;
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
		endMarkerMode,
		loopEnabled,
		bpm,
		sigNum,
		sigDen,
		masterLevel,
		approvedComposerArrangement,
		progressiveStemState,
	});

	const historyHash = (state: DawHistorySnapshot) => JSON.stringify(state);
	const persistentHistoryState = (state: DawHistorySnapshot): DawHistorySnapshot => ({
		...state,
		projectAssets: state.projectAssets.map((asset) => {
			const copy = { ...asset };
			delete copy.url;
			return copy;
		}),
	});
	const persistentHistoryHash = (state: DawHistorySnapshot) => historyHash(persistentHistoryState(state));
	const saveHistory = () => {
		try {
			const start = Math.max(0, Math.min(historyIndexRef.current, historyRef.current.length - HISTORY_LIMIT));
			const entries = historyRef.current.slice(start, start + HISTORY_LIMIT).map(({ state }) => persistentHistoryState(state));
			let index = historyIndexRef.current - start;
			while (entries.length) {
				const selected = entries[index];
				if (!selected) break;
				const raw = JSON.stringify({ v: 1, current: persistentHistoryHash(selected), index, entries });
				if (raw.length <= HISTORY_BYTES) {
					localStorage.setItem(historyStorageKey, raw);
					return;
				}
				if (index < entries.length - 1) entries.pop();
				else { entries.shift(); index--; }
			}
			localStorage.removeItem(historyStorageKey);
		} catch { /* History persistence is optional when storage is unavailable. */ }
	};

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
		saveHistory();
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
			try {
				const raw = localStorage.getItem(historyStorageKey);
				const saved = raw && raw.length <= HISTORY_BYTES
					? safeParse<{ v: number; current: string; index: number; entries: DawHistorySnapshot[] }>(raw)
					: null;
				if (saved?.v === 1 && saved.current === persistentHistoryHash(state) &&
					Array.isArray(saved.entries) && saved.entries.length <= HISTORY_LIMIT &&
					saved.entries.every((entry) => entry && Array.isArray(entry.tracks) && Array.isArray(entry.clips) && Array.isArray(entry.projectAssets)) &&
					Number.isInteger(saved.index) && saved.index >= 0 && saved.index < saved.entries.length &&
					persistentHistoryHash(saved.entries[saved.index]) === saved.current) {
					historyRef.current = saved.entries.map((entry) => ({ state: entry, hash: historyHash(entry) }));
					// The live snapshot retains runtime URLs needed by this browser session.
					historyRef.current[saved.index] = { hash, state };
					historyIndexRef.current = saved.index;
				} else localStorage.removeItem(historyStorageKey);
			} catch { /* Corrupt or inaccessible history starts fresh. */ }
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
	}, [dawHydrated, activeProjectId, tracks, clips, projectAssets, projectName, loopL, loopR, endBar, endMarkerMode, loopEnabled, bpm, sigNum, sigDen, masterLevel, approvedComposerArrangement, progressiveStemState]);

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
		setEndMarkerMode(state.endMarkerMode);
		setLoopEnabled(state.loopEnabled);
		setBpm(state.bpm);
		setSigNum(state.sigNum);
		setSigDen(state.sigDen);
		setMasterLevel(state.masterLevel);
		setApprovedComposerArrangement(state.approvedComposerArrangement);
		setProgressiveStemState(state.progressiveStemState);
		setSelectedTrackId((id) => id && state.tracks.some((t) => t.id === id) ? id : (state.tracks[0]?.id ?? null));
		setSelectedClipId((id) => id && state.clips.some((c) => c.id === id) ? id : null);
		setMidiEditorClipId((id) => id && state.clips.some((c) => c.id === id) ? id : null);
	};

	const undo = () => {
		pushCurrentHistory();
		if (historyIndexRef.current <= 0) return;
		historyIndexRef.current -= 1;
		applyHistoryEntry(historyRef.current[historyIndexRef.current]);
		saveHistory();
		setHistoryRevision((v) => v + 1);
	};

	const redo = () => {
		pushCurrentHistory();
		if (historyIndexRef.current < 0 || historyIndexRef.current >= historyRef.current.length - 1) return;
		historyIndexRef.current += 1;
		applyHistoryEntry(historyRef.current[historyIndexRef.current]);
		saveHistory();
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

	// Keep selection sane if tracks change, but only after project hydration.
	// On the initial mount the closure still sees tracks=[] even though the earlier
	// hydration Effect has just queued restored tracks + selectedTrackId. Without this
	// guard, this Effect queues selectedTrackId=null in the same mount pass; the next
	// render then falls back to tracks[0] (usually Audio 1), which intentionally clears
	// the Bridge MIDI route and makes the LPK25 silent until Instrument 1 is clicked.
	useEffect(() => {
		if (!dawHydrated) return;
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

	// Create Song stages a generated session outside the DAW. Import it into a NEW
	// project so generation never destroys the user's current song. Audio tracks
	// reference YSong's saved local objects; MIDI tracks remain real editable clips
	// and carry the exact VST path selected from Bridge's installed catalog.
	useEffect(() => {
		if (!dawHydrated) return;
		if (!generatedSessionPendingRef.current) {
			const staged = consumeGeneratedSession();
			if (!staged) return;
			const nextProjectId = crypto.randomUUID();
			generatedSessionPendingRef.current = staged;
			generatedSessionTargetProjectRef.current = nextProjectId;
			try { localStorage.setItem(`ysong:projectName:${nextProjectId}`, staged.projectName || "Generated Song"); } catch {}
			activeProjectRef.current = nextProjectId;
			vstLoadedRef.current.clear();
			vstRestoredRef.current.clear();
			setVstSoundState({});
			setActiveProjectId(nextProjectId);
			return;
		}
		if (activeProjectId !== generatedSessionTargetProjectRef.current) return;
		const manifest = generatedSessionPendingRef.current;
		if (!manifest) return;
		const songResult = parseSongGenerationResult(manifest.result);

		stop();
		bridgeApi.unloadAllVst3().catch(() => {});
		vstLoadedRef.current.clear();
		vstRestoredRef.current.clear();
		vstMetersRef.current = {};
		setVstTrackState({});
		const nextTracks: Track[] = [];
		const nextClips: Clip[] = [];
		const nextAssets: ProjectAsset[] = [];
		const nextHeights: Record<string, number> = {};
		const sessionId = manifest.sessionId || crypto.randomUUID();
		const barSec = (60 / Math.max(1, manifest.bpm)) * (4 / Math.max(1, manifest.sigDen)) * Math.max(1, manifest.sigNum);
		for (let index = 0; index < manifest.tracks.length; index++) {
			const source = manifest.tracks[index];
			const resultPart = songResult?.parts.find((part) => part.id === source.id);
			const partGeneration: PartGeneration = {
				origin: "create-song", role: source.role, vocalRole: source.vocalRole,
				singerId: source.singer?.id, singerName: source.singer?.displayName, singerAvatarRef: source.singer?.avatarRef,
				sourceTrackId: source.id, sessionId, createdAt: new Date(manifest.createdAt).toISOString(),
				...(resultPart?.status === "failed" ? { failure: resultPart.failure } : {}),
			};
			const trackId = crypto.randomUUID();
			const track = mkTrack(source.mode === "midi" ? "instrument" : "audio", index + 1, trackId);
			track.name = source.name || `${source.mode === "midi" ? "Instrument" : "Audio"} ${index + 1}`;
			track.partGeneration = partGeneration;
			if (source.mode === "midi" && source.vst?.path) {
				track.vst3PluginPath = source.vst.path;
				track.vst3PluginName = source.vst.name || "VST3";
				track.vst3PluginVendor = source.vst.vendor;
				track.vstPresetHint = source.vst.presetHint;
			}
			track.instrumentIntent = source.instrumentIntent;
			track.desiredInstrument = source.desiredInstrument;
			track.instrumentResolution = source.instrumentResolution;
			nextTracks.push(track);
			nextHeights[trackId] = ROW_H;
			if (resultPart?.status === "failed") continue;

			if (source.mode === "audio" && source.objectKey) {
				const assetId = source.objectKey;
				nextAssets.push({ id: assetId, kind: "audio", name: `${source.name}.wav`, objectKey: source.objectKey, sourceObjectKey: source.objectKey, durationSec: source.durationSec });
				const lengthBars = songResult ? manifest.totalBars : source.durationSec && source.durationSec > 0 ? Math.max(0.01, source.durationSec / Math.max(0.0001, barSec)) : Math.max(1, manifest.totalBars);
				nextClips.push({ id: crypto.randomUUID(), trackId, assetId, name: source.name, startBar: 1, lengthBars, sourceOffsetSec: 0, sourceDurationSec: source.durationSec, fadeInBars: 0, fadeOutBars: 0, partGeneration });
			}
			if (source.mode === "midi") {
				for (const region of source.midiRegions ?? []) {
					const repeatCount = Math.max(1, Math.min(64, Math.round(region.repeatCount ?? 1)));
					for (let repeat = 0; repeat < repeatCount; repeat++) {
						const startBar = region.startBar + repeat * region.lengthBars;
						if (startBar > manifest.totalBars) break;
						nextClips.push({
							id: crypto.randomUUID(), trackId, name: source.name, startBar,
							lengthBars: Math.min(region.lengthBars, Math.max(0.01, manifest.totalBars - startBar + 1)),
							midiNotes: (region.notes ?? []).map((note) => ({ id: crypto.randomUUID(), pitch: clamp(Math.round(note.pitch), 0, 127), startBars: Math.max(0, note.startBars), lengthBars: Math.max(1 / 128, note.lengthBars), velocity: clamp(Math.round(note.velocity), 1, 127) })),
							midiPitchBend: [], midiModulation: [], midiBendRange: 12,
							midiScales: [{ id: crypto.randomUUID(), root: manifest.keyRoot, scaleId: manifest.scaleId }], midiScaleLock: "strict",
							partGeneration,
						});
					}
				}
			}
		}

		bpmRef.current = manifest.bpm; sigNumRef.current = manifest.sigNum; sigDenRef.current = manifest.sigDen;
		setBpm(manifest.bpm); setSigNum(manifest.sigNum); setSigDen(manifest.sigDen);
		setProjectName(manifest.projectName || "Generated Song");
		setProjectGeneration({
			origin: "create-song",
			sessionId,
			createdAt: manifest.createdAt,
			title: manifest.projectName || "Generated Song",
			singers: manifest.singerRoster,
			...(songResult ? { songResult } : {}),
		});
		upsertGeneration({
			id: sessionId,
			status: songResult?.status === "partial" ? "partial" : "succeeded",
			title: manifest.projectName || "Generated Song",
			createdAt: manifest.createdAt,
			source: { prompt: manifest.structuredCaption || "", origin: "create-song" },
			artifacts: [{ id: `project:${activeProjectId}`, kind: "project", label: "Editable YSong project", projectId: activeProjectId }],
			...(songResult ? { songResult } : {}),
		});
		setTracks(nextTracks); setClips(nextClips); setProjectAssets(nextAssets); setTrackHeights(nextHeights);
		setBars(Math.min(MAX_BARS, Math.max(MIN_BARS, manifest.totalBars + 8)));
		setEndBar(Math.min(MAX_BARS, Math.max(2, manifest.totalBars + 1)));
		setEndMarkerMode("auto");
		setLoopL(1); setLoopR(Math.min(5, Math.max(2, manifest.totalBars + 1))); setLoopEnabled(false);
		setPlayheadPosBars(1); setSelectedTrackId(nextTracks[0]?.id ?? null); setSelectedClipId(null);
		generatedSessionPendingRef.current = null;
		generatedSessionTargetProjectRef.current = null;
		transportPrimedRef.current = false;
		window.dispatchEvent(new CustomEvent("ysong:generated-session-imported", { detail: { projectName: manifest.projectName, tracks: nextTracks.length } }));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [dawHydrated, activeProjectId, generatedSessionRevision]);

	const generationImportRequest = _props.tab.payload?.generationImportRequest as { id?: unknown; requestId?: unknown } | undefined;
	useEffect(() => {
		if (!dawHydrated || hydratedProjectId !== activeProjectId || typeof generationImportRequest?.requestId !== "string" ||
			handledGenerationImportRef.current === generationImportRequest.requestId) return;
		handledGenerationImportRef.current = generationImportRequest.requestId;
		const record = typeof generationImportRequest.id === "string" ? listGenerations().find((item) => item.id === generationImportRequest.id) : undefined;
		if (!record || (record.status !== "succeeded" && record.status !== "partial")) {
			setSwitchError("This generation is no longer available to import."); setProjectSheetOpen(true); return;
		}
		const bundle = record.songResult ? planSongGenerationImport(record.songResult) : null;
		const artifacts = record.artifacts.filter((artifact) => artifact.kind === "audio" && (artifact.objectKey || artifact.url));
		if (!bundle && (record.songResult || !artifacts.length)) {
			setSwitchError("This generation has no valid, ready parts to import."); setProjectSheetOpen(true); return;
		}
		generationImportPendingRef.current = record;
		const targetId = crypto.randomUUID();
		generationImportTargetRef.current = targetId;
		try { localStorage.setItem(`ysong:projectName:${targetId}`, record.title || "Imported Generation"); } catch { /* Project hydration reports inaccessible storage. */ }
		activeProjectRef.current = targetId;
		vstLoadedRef.current.clear(); vstRestoredRef.current.clear(); setVstSoundState({});
		setActiveProjectId(targetId);
	}, [generationImportRequest?.requestId, generationImportRequest?.id, dawHydrated, hydratedProjectId, activeProjectId]);

	useEffect(() => {
		const record = generationImportPendingRef.current;
		if (!record || !dawHydrated || hydratedProjectId !== activeProjectId || generationImportTargetRef.current !== activeProjectId) return;
		stop();
		const bundle = record.songResult ? planSongGenerationImport(record.songResult) : null;
		const artifacts = record.artifacts.filter((artifact) => artifact.kind === "audio" && (artifact.objectKey || artifact.url));
		const importedAt = Date.now();
		const nextAssets: ProjectAsset[] = [];
		const nextTracks: Track[] = [];
		const nextClips: Clip[] = [];
		const nextHeights: Record<string, number> = {};
		const barSeconds = 2;
		if (bundle) for (const [index, part] of bundle.parts.entries()) {
			const trackId = crypto.randomUUID();
			const artifact = part.audio ? artifacts.find((item) => item.objectKey === part.audio?.objectKey) : undefined;
			const partGeneration: PartGeneration = { origin: "generation-library", generationId: record.id, sourcePartId: part.id,
				role: part.role, ...(artifact ? { artifactId: artifact.id } : {}), createdAt: new Date(importedAt).toISOString() };
			const track = mkTrack(part.kind === "midi" ? "instrument" : "audio", index + 1, trackId);
			track.name = part.name; track.partGeneration = partGeneration;
			nextTracks.push(track); nextHeights[trackId] = ROW_H;
			if (part.audio) {
				const assetId = `generation:${record.id}:${part.id}`;
				nextAssets.push({ id: assetId, kind: "audio", name: part.name, objectKey: part.audio.objectKey,
					sourceObjectKey: part.audio.objectKey, durationSec: part.audio.durationSec });
				nextClips.push({ id: crypto.randomUUID(), trackId, assetId, name: part.name, startBar: part.audio.startBar,
					lengthBars: part.audio.lengthBars, sourceOffsetSec: 0, sourceDurationSec: part.audio.durationSec,
					fadeInBars: 0, fadeOutBars: 0, partGeneration });
			}
			for (const midi of part.midiClips ?? []) {
				nextClips.push({ id: crypto.randomUUID(), trackId, name: part.name, startBar: midi.startBar, lengthBars: midi.lengthBars,
					midiNotes: midi.notes.map((note) => ({ ...note, id: crypto.randomUUID() })),
					midiPitchBend: [], midiModulation: [], midiBendRange: 12, partGeneration });
			}
		} else for (const [index, artifact] of artifacts.entries()) {
			const assetId = `generation:${record.id}:${artifact.id}`;
			const trackId = crypto.randomUUID();
			const name = artifact.label || `${record.title} ${index + 1}`;
			const track = mkTrack("audio", index + 1, trackId);
			track.name = name;
			nextTracks.push(track); nextHeights[trackId] = ROW_H;
			nextAssets.push({ id: assetId, kind: "audio", name, objectKey: artifact.objectKey, url: artifact.url, durationSec: artifact.durationSec });
			nextClips.push({ id: crypto.randomUUID(), trackId, assetId, name, startBar: 1, lengthBars: artifact.durationSec ? Math.max(0.01, artifact.durationSec / barSeconds) : 4, sourceOffsetSec: 0, sourceDurationSec: artifact.durationSec, fadeInBars: 0, fadeOutBars: 0 });
		}
		const provenance: GeneratedProjectProvenance = { origin: "generation-library", generationId: record.id,
			artifactIds: record.artifacts.map((artifact) => artifact.id), createdAt: importedAt, title: record.title,
			...(bundle ? { songResult: bundle.result } : {}) };
		setProjectName(record.title || "Imported Generation"); setProjectGeneration(provenance);
		setTracks(nextTracks); setClips(nextClips); setProjectAssets(nextAssets); setTrackHeights(nextHeights);
		setSelectedTrackId(nextTracks[0]?.id ?? null); setSelectedClipId(null); setPlayheadPosBars(1);
		const timebase = bundle?.result.timebase;
		setBpm(timebase?.bpm ?? 120); bpmRef.current = timebase?.bpm ?? 120;
		setSigNum(timebase?.sigNum ?? 4); setSigDen(timebase?.sigDen ?? 4);
		sigNumRef.current = timebase?.sigNum ?? 4; sigDenRef.current = timebase?.sigDen ?? 4;
		setEndBar(projectEndBar(nextClips, { maxBars: MAX_BARS }));
		setEndMarkerMode("auto");
		setBars(timebase ? Math.min(MAX_BARS, Math.max(MIN_BARS, timebase.totalBars + 8)) : MIN_BARS);
		setLoopL(1); setLoopR(timebase ? Math.min(5, timebase.totalBars + 1) : 5); setLoopEnabled(false);
		generationImportPendingRef.current = null; generationImportTargetRef.current = null;
		window.dispatchEvent(new CustomEvent("ysong:generation-imported", { detail: { generationId: record.id, artifactIds: provenance.artifactIds, projectId: activeProjectId } }));
	// stop and the project asset setter are stable DAW operations used by this staged import.
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [dawHydrated, hydratedProjectId, activeProjectId]);

	const getBarSeconds = () => {
		const beatSec = (60 / Math.max(1, bpmRef.current)) * (4 / Math.max(1, sigDenRef.current));
		return beatSec * Math.max(1, sigNumRef.current);
	};

	const stopScheduledAudio = () => {
		audioScheduleGenerationRef.current += 1;
		bridgeApi.stopVst3().catch(() => {});
		stopGmSoundFontPlayback();
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
		const pitchSemitones = clamp(Number(clip.pitchSemitones) || 0, -12, 12);
		const pitchRate = 2 ** (pitchSemitones / 12);
		return { offsetSec, durationSec, outputSec, ratio, pitchRate };
	};

	const analyzeSelectedVocal = async () => {
		const sourceClip = selectedClipId ? clips.find((clip) => clip.id === selectedClipId && !!clip.assetId) : undefined;
		if (!sourceClip?.assetId) { setVocalMidiStatus("Select an audio clip first."); return; }
		setVocalMidiBusy(true);
		setVocalMidiPreview(null);
		setVocalMidiStatus("Analyzing monophonic pitch…");
		try {
			const source = await ensureBufferForAsset(sourceClip.assetId);
			const sourceWindow = getClipSourceWindow(sourceClip, source);
			const firstFrame = Math.floor(sourceWindow.offsetSec * source.sampleRate);
			const frameCount = Math.max(1, Math.min(source.length - firstFrame, Math.ceil(sourceWindow.durationSec * source.sampleRate)));
			const mono = new Float32Array(frameCount);
			for (let channel = 0; channel < source.numberOfChannels; channel++) {
				const data = source.getChannelData(channel);
				for (let index = 0; index < frameCount; index++) mono[index] += (data[firstFrame + index] ?? 0) / source.numberOfChannels;
			}
			await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
			const transcription = transcribeMonophonicVocal(mono, source.sampleRate, {
				confidenceThreshold: vocalConfidence / 100,
				minimumNoteSeconds: vocalMinimumNoteMs / 1000,
			});
			if (!transcription.notes.length) throw new Error("No stable monophonic vocal melody was detected. Try a cleaner solo vocal or humming phrase.");
			const secondsToBars = sourceClip.lengthBars / Math.max(0.001, sourceWindow.durationSec);
			const notes: MidiNote[] = transcription.notes.map((note) => {
				const startBars = clamp(note.startSeconds * secondsToBars, 0, sourceClip.lengthBars);
				return {
					id: crypto.randomUUID(),
					pitch: note.pitch,
					startBars,
					lengthBars: clamp(note.durationSeconds * secondsToBars, 1 / 128, Math.max(1 / 128, sourceClip.lengthBars - startBars)),
					velocity: note.velocity,
				};
			}).filter((note) => note.startBars < sourceClip.lengthBars);
			const pitchBend: MidiAutomationPoint[] = transcription.pitchBend
				.filter((point) => point.atSeconds <= sourceWindow.durationSec)
				.map((point) => ({ id: crypto.randomUUID(), atBars: point.atSeconds * secondsToBars, value: point.value }));
			setVocalMidiPreview({
				sourceClipId: sourceClip.id,
				sourceAssetId: sourceClip.assetId,
				name: `${sourceClip.name} Melody`,
				startBar: sourceClip.startBar,
				lengthBars: sourceClip.lengthBars,
				notes,
				pitchBend,
			});
			setVocalMidiStatus(`Detected ${notes.length} editable MIDI note${notes.length === 1 ? "" : "s"}. The original audio remains unchanged.`);
		} catch (error) {
			setVocalMidiStatus(error instanceof Error ? error.message : "Vocal transcription failed.");
		} finally {
			setVocalMidiBusy(false);
		}
	};

	const acceptVocalMidi = () => {
		const preview = vocalMidiPreview;
		if (!preview) return;
		const trackId = crypto.randomUUID();
		const clipId = crypto.randomUUID();
		const generation: PartGeneration = {
			origin: "vocal-transcription",
			role: "vocal melody",
			sourceClipId: preview.sourceClipId,
			sourceAssetId: preview.sourceAssetId,
			algorithm: "ysong-yin-v1",
			createdAt: new Date().toISOString(),
		};
		const track = mkTrack("instrument", tracks.filter((item) => item.type === "instrument").length + 1, trackId);
		track.name = preview.name;
		track.partGeneration = generation;
		const midiClip: Clip = {
			id: clipId,
			trackId,
			name: preview.name,
			startBar: preview.startBar,
			lengthBars: preview.lengthBars,
			midiNotes: preview.notes,
			midiPitchBend: preview.pitchBend,
			midiModulation: [],
			midiBendRange: 2,
			midiScales: [{ id: crypto.randomUUID(), root: 0, scaleId: "chromatic" }],
			midiScaleLock: "soft",
			partGeneration: generation,
		};
		setTracks((current) => [...current, track]);
		setTrackHeights((current) => ({ ...current, [trackId]: ROW_H }));
		setClips((current) => [...current, midiClip]);
		setSelectedTrackId(trackId);
		setSelectedClipId(clipId);
		setMidiEditorClipId(clipId);
		setVocalMidiPreview(null);
		setVocalMidiStatus("Vocal melody added as an editable MIDI track.");
	};

	const ensurePlaybackBufferForClip = async (clip: Clip) => {
		if (!clip.assetId) throw new Error("clip_has_no_asset");
		const takes = (clip.takes ?? []).slice(0, MAX_DAW_TAKES);
		const ranges = normalizeCompRanges(clip.compRanges, clip.lengthBars, takes);
		if (ranges.length) {
			const base = await ensurePlaybackBufferForClip({ ...clip, id: `${clip.id}:base`, takes: undefined, compRanges: undefined });
			const key = `comp|${JSON.stringify(ranges)}|${JSON.stringify(takes)}|${JSON.stringify({ assetId: clip.assetId, lengthBars: clip.lengthBars, sourceOffsetSec: clip.sourceOffsetSec, sourceDurationSec: clip.sourceDurationSec, warpMarkers: clip.warpMarkers, pitchSemitones: clip.pitchSemitones, timePitchMode: clip.timePitchMode, fadeInBars: clip.fadeInBars, fadeOutBars: clip.fadeOutBars })}|${getBarSeconds()}`;
			const cached = stretchedBuffersRef.current.get(clip.id);
			if (cached?.key === key) return cached.buffer;
			const ctx = ensureAudioCtx();
			const result = ctx.createBuffer(base.numberOfChannels, base.length, base.sampleRate);
			for (let channel = 0; channel < result.numberOfChannels; channel++) result.getChannelData(channel).set(base.getChannelData(channel));
			for (const range of ranges) {
				const take = takes.find((item) => item.id === range.takeId);
				if (!take) continue;
				try {
					const alternate = await ensurePlaybackBufferForClip({ ...clip, id: `${clip.id}:${take.id}`, assetId: take.assetId, sourceOffsetSec: take.sourceOffsetSec, sourceDurationSec: take.sourceDurationSec, takes: undefined, compRanges: undefined });
					const from = Math.floor(range.startBar / clip.lengthBars * result.length);
					const to = Math.min(result.length, Math.ceil(range.endBar / clip.lengthBars * result.length));
					for (let channel = 0; channel < result.numberOfChannels; channel++) {
						const target = result.getChannelData(channel);
						const source = alternate.getChannelData(Math.min(channel, alternate.numberOfChannels - 1));
						for (let frame = from; frame < to; frame++) target[frame] = source[Math.min(source.length - 1, Math.floor(frame * source.length / result.length))] ?? 0;
					}
				} catch { /* An unavailable alternate leaves the preserved source audible. */ }
			}
			stretchedBuffersRef.current.set(clip.id, { key, buffer: result });
			return result;
		}
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
			win.pitchRate.toFixed(5),
			clip.timePitchMode ?? "independent",
			JSON.stringify(clip.warpMarkers ?? []),
			fadeInSec.toFixed(5),
			fadeOutSec.toFixed(5),
			source.sampleRate,
		].join("|");
		const cached = stretchedBuffersRef.current.get(clip.id);
		if (cached?.key === key) return cached.buffer;

		const ctx = ensureAudioCtx();
		const linked = clip.timePitchMode === "linked";
		const markers = normalizeWarpMarkers(clip.warpMarkers, win.durationSec, clip.lengthBars);
		const boundaries = [{ sourceSec: 0, atBar: 0 }, ...markers, { sourceSec: win.durationSec, atBar: clip.lengthBars }];
		const rendered = ctx.createBuffer(source.numberOfChannels, Math.max(1, Math.floor(win.outputSec * source.sampleRate)), source.sampleRate);
		for (let index = 0; index < boundaries.length - 1; index++) {
			const from = boundaries[index];
			const to = boundaries[index + 1];
			const segmentSourceSec = to.sourceSec - from.sourceSec;
			const segmentOutputSec = (to.atBar - from.atBar) * barSecNow;
			const segmentRatio = segmentOutputSec / segmentSourceSec;
			const segmentPitchRate = linked ? 1 / segmentRatio : win.pitchRate;
			const intermediate = renderPitchPreservedStretch(ctx, source, win.offsetSec + from.sourceSec, segmentSourceSec, linked ? 1 : segmentRatio * segmentPitchRate);
			const segment = segmentPitchRate === 1 ? intermediate : resampleForPitch(ctx, intermediate, segmentPitchRate, Math.max(1, Math.floor(segmentOutputSec * source.sampleRate)));
			const outputFrame = Math.floor((from.atBar / clip.lengthBars) * rendered.length);
			for (let channel = 0; channel < rendered.numberOfChannels; channel++) {
				const target = rendered.getChannelData(channel);
				const data = segment.getChannelData(channel);
				target.set(data.subarray(0, Math.max(0, Math.min(data.length, target.length - outputFrame))), outputFrame);
			}
		}
		applyClipFadesToBuffer(rendered, fadeInSec, fadeOutSec);
		stretchedBuffersRef.current.set(clip.id, { key, buffer: rendered });
		return rendered;
	};

	const detectClipWarpMarkers = async (clip: Clip) => {
		if (!clip.assetId) return;
		const source = await ensureBufferForAsset(clip.assetId);
		const win = getClipSourceWindow(clip, source);
		const channels = Array.from({ length: source.numberOfChannels }, (_, channel) => source.getChannelData(channel));
		const markers = detectWarpTransients(channels, source.sampleRate, win.offsetSec, win.durationSec)
			.map((sourceSec) => ({ sourceSec, atBar: applySnap(clip.startBar + sourceSec / win.durationSec * clip.lengthBars) - clip.startBar }));
		setClips((current) => current.map((item) => item.id === clip.id ? { ...item, warpMarkers: normalizeWarpMarkers(markers, win.durationSec, clip.lengthBars) } : item));
		stretchedBuffersRef.current.delete(clip.id);
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
		options?: { startAtSec?: number; startUnixMs?: number; clearExisting?: boolean },
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
			gain.connect(trackBus.input);

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
		const vstTracks = tracks.filter((t) => t.type === "instrument" && trackUsesNativeVst(t));
		const segmentStartUnixMs = options?.startUnixMs ?? Math.round(transportClockUnixOffsetMsRef.current + t0 * 1000);
		// Schedule native instruments in parallel. With 20-30 VST tracks, serial HTTP
		// calls can consume the entire lead-in and make later tracks arrive after the
		// shared transport epoch. Every track receives timestamps from the same clock.
		await Promise.allSettled(vstTracks.map(async (track) => {
			try { await ensureVstLoaded(track); } catch { return; }
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
					events.push({ kind: "on", note: note.pitch, velocity: note.velocity, noteId, whenUnixMs: Math.round(segmentStartUnixMs + Math.max(0, playFromBar - startBars) * barSec * 1000) });
					events.push({ kind: "off", note: note.pitch, velocity: 0, noteId, whenUnixMs: Math.round(segmentStartUnixMs + Math.max(0, playToBar - startBars) * barSec * 1000) });
				});
			}
			if (!events.length) return;
			events.sort((a, b) => a.whenUnixMs - b.whenUnixMs || (a.kind === "off" ? -1 : 1));
			await bridgeApi.scheduleVst3Midi(track.id, events);
		}));

		// Tracks without a native VST3 assignment now use a real SoundFont-backed
		// General MIDI renderer. Program numbers 0..127 map directly to GeneralUser GS.
		const midiClips = clips.filter((c) => !c.assetId && (c.midiNotes?.length ?? 0) > 0 && tracks.some((t) => t.id === c.trackId && t.type === "instrument"));
		const gmClips = midiClips.filter((c) => !trackUsesNativeVst(tracks.find((t) => t.id === c.trackId)));
		if (gmClips.length) {
			try {
				await prepareGmSoundFont(ctx);
				for (const c of gmClips) {
					const track = tracks.find((t) => t.id === c.trackId);
					if (!track || trackUsesNativeVst(track)) continue;
					ensureTrackAudioBus(track.id);
					const gmProgram = normalizeGmProgram(track.vst3PluginPath && bridgeAvailable === false ? 0 : (gmProgramOverrideRef.current.get(track.id) ?? track.gmProgram ?? 0));
					const clipEndBar = c.startBar + c.lengthBars;
					for (const note of c.midiNotes ?? []) {
						const noteStartBar = c.startBar + note.startBars;
						const noteEndBar = Math.min(clipEndBar, noteStartBar + Math.max(1 / 128, note.lengthBars));
						const playFromBar = Math.max(startBars, noteStartBar);
						const playToBar = Math.min(segmentEnd, noteEndBar);
						if (playToBar - playFromBar <= 0.0001) continue;
						const startAt = t0 + Math.max(0, (playFromBar - startBars) * barSec);
						const durationSec = Math.max(0.015, (playToBar - playFromBar) * barSec);
						const gmAudible = computedTrackGain(track) > 0;
						scheduleGmSoundFontNote(ctx, track.id, gmProgram, note.pitch, note.velocity, track.level ?? 100, !gmAudible, startAt, durationSec);
					}
				}
			} catch (error) {
				console.error("YSong General MIDI SoundFont renderer could not start", error);
			}
		}

	};

	// --- Transport playback loop (audio + structured MIDI + visual) ---
	const currentTransportPosition = () => {
		if (!isPlaying) return playheadPosBars;
		const ctx = audioCtxRef.current;
		const elapsedSec = ctx
			? Math.max(0, ctx.currentTime - playStartCtxTimeRef.current)
			: Math.max(0, (performance.now() - playStartMsRef.current) / 1000);
		let pos = playStartPosRef.current + elapsedSec / Math.max(0.0001, transportBarSecRef.current);
		if (loopEnabled) {
			const len = Math.max(0.0001, loopR - loopL);
			if (pos < loopL) pos = loopL;
			if (pos >= loopR) pos = loopL + ((pos - loopL) % len);
			return clamp(pos, loopL, Math.max(loopL, loopR - 0.000001));
		}
		return clamp(pos, 1, endBar);
	};

	const stop = () => {
		transportStartGenerationRef.current += 1;
		transportStartPendingRef.current = false;
		if (recordingSessionRef.current) finishMidiRecording();
		if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
		rafRef.current = null;
		stopScheduledAudio();
		setIsPlaying(false);
	};

	const start = async (loopOverride?: boolean, positionOverride?: number, leadOverride?: number) => {
		const startGeneration = ++transportStartGenerationRef.current;
		transportStartPendingRef.current = true;
		window.dispatchEvent(new Event("ysong:daw-play-request"));
		const loopOn = loopOverride ?? loopEnabled;
		const activeLoopLen = Math.max(0.0001, loopR - loopL);
		const rawStart = positionOverride ?? playheadPosBars;
		// Play from E is a restart, not an almost-zero-length transport pass. Likewise,
		// starting at R while looping begins cleanly at L. This prevents the old
		// end-of-song -> immediate wrap race that could offset audio vs MIDI/VST tracks.
		const startPos = loopOn
			? (rawStart >= loopR - 0.0005 || rawStart < loopL ? loopL : clamp(rawStart, loopL, loopR - 0.0005))
			: (rawStart >= endBar - 0.0005 ? 1 : clamp(rawStart, 1, endBar));
		const ctx = ensureAudioCtx();
		await ctx.resume().catch(() => {});
		if (startGeneration !== transportStartGenerationRef.current) return;
		stopScheduledAudio();

		// Cold-start preparation must finish BEFORE establishing the shared epoch.
		// Warm all native VSTs concurrently so large 20-30 track sessions don't make
		// the last instrument wait behind every previous Bridge request.
		const vstTracksToWarm = tracks.filter((t) => t.type === "instrument" && trackUsesNativeVst(t));
		await Promise.allSettled(vstTracksToWarm.map((track) => ensureVstLoaded(track)));
		if (startGeneration !== transportStartGenerationRef.current) return;
		const hasGmMidi = clips.some((c) => !c.assetId && (c.midiNotes?.length ?? 0) > 0 && !!tracks.find((t) => t.id === c.trackId && t.type === "instrument" && !trackUsesNativeVst(t)));
		if (hasGmMidi) {
			try { await prepareGmSoundFont(ctx); } catch { /* scheduler reports/skips below */ }
		}
		if (startGeneration !== transportStartGenerationRef.current) return;
		const audioClipsToWarm = clips.filter((c) => !!c.assetId && tracks.some((t) => t.id === c.trackId && t.type === "audio"));
		await Promise.allSettled(audioClipsToWarm.map((clip) => ensurePlaybackBufferForClip(clip)));
		if (startGeneration !== transportStartGenerationRef.current) return;

		// The first ever play after cold project hydration can finish plugin/audio
		// initialization on different device threads a few milliseconds apart. Give
		// those engines one short settle window BEFORE defining the shared epoch.
		// Subsequent rewind/play operations skip this delay.
		if (!transportPrimedRef.current) {
			await new Promise<void>((resolve) => window.setTimeout(resolve, 90));
			transportPrimedRef.current = true;
		}
		if (startGeneration !== transportStartGenerationRef.current) return;

		const bpmNow = Math.max(1, bpmRef.current);
		const denNow = Math.max(1, sigDenRef.current);
		const numNow = Math.max(1, sigNumRef.current);
		const beatSecNow = (60 / bpmNow) * (4 / denNow);
		const barSecNow = beatSecNow * numNow;
		transportBarSecRef.current = barSecNow;

		// Bridge MIDI is timestamped in wall-clock milliseconds while browser audio uses
		// AudioContext time. Establish a single conversion once and reuse it for every
		// track and every loop pass so the two clocks cannot acquire per-pass drift.
		const defaultLead = clamp(0.32 + vstTracksToWarm.length * 0.025, 0.36, 1.15);
		const leadSec = leadOverride ?? defaultLead;
		const firstBoundary = loopOn ? loopR : endBar;
		const anchorCtxTime = ctx.currentTime;
		const anchorUnixMs = Date.now();
		const firstStartAt = anchorCtxTime + leadSec;
		const firstStartUnixMs = anchorUnixMs + leadSec * 1000;
		transportClockUnixOffsetMsRef.current = firstStartUnixMs - firstStartAt * 1000;
		playStartMsRef.current = performance.now() + leadSec * 1000;
		playStartCtxTimeRef.current = firstStartAt;
		playStartPosRef.current = startPos;
		lastUiUpdateMsRef.current = 0;
		setPlayheadPosBars(startPos);

		await scheduleAudioFromBars(startPos, firstBoundary, { startAtSec: firstStartAt, startUnixMs: firstStartUnixMs, clearExisting: false }).catch(() => {});
		if (startGeneration !== transportStartGenerationRef.current) return;
		transportStartPendingRef.current = false;
		setIsPlaying(true);
		lastPosRef.current = startPos;

		// Keep only a modest look-ahead. The previous 90-second pre-schedule made live
		// tempo changes expensive and left a huge amount of stale loop data to cancel.
		// 18 seconds is still far beyond any normal Bridge/network scheduling jitter.
		if (loopOn) {
			const loopDurationSec = activeLoopLen * barSecNow;
			loopScheduleNextCtxTimeRef.current = firstStartAt + Math.max(0, (firstBoundary - startPos) * barSecNow);
			const scheduleAhead = async () => {
				if (loopSchedulerBusyRef.current) return;
				loopSchedulerBusyRef.current = true;
				try {
					const horizon = ctx.currentTime + 18;
					let passes = 0;
					while (loopScheduleNextCtxTimeRef.current < horizon && passes < 32) {
						const at = loopScheduleNextCtxTimeRef.current;
						const atUnix = Math.round(transportClockUnixOffsetMsRef.current + at * 1000);
						await scheduleAudioFromBars(loopL, loopR, { startAtSec: at, startUnixMs: atUnix, clearExisting: false });
						loopScheduleNextCtxTimeRef.current = at + loopDurationSec;
						passes += 1;
					}
				} finally { loopSchedulerBusyRef.current = false; }
			};
			scheduleAhead().catch(() => {});
			loopSchedulerTimerRef.current = window.setInterval(() => { scheduleAhead().catch(() => {}); }, 1500);
		}

		const tick = () => {
			const now = performance.now();
			const elapsedSec = Math.max(0, ctx.currentTime - playStartCtxTimeRef.current);
			let pos = playStartPosRef.current + elapsedSec / Math.max(0.0001, transportBarSecRef.current);

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

	const changeBpm = (raw: number) => {
		const next = clamp(Math.round(raw), 20, 400);
		if (next === bpmRef.current) return;
		if (!isPlaying) {
			bpmRef.current = next;
			setBpm(next);
			return;
		}
		const pos = currentTransportPosition();
		stop();
		bpmRef.current = next;
		setBpm(next);
		setPlayheadPosBars(pos);
		// Warm restart from the exact musical position. Audio, GM, native VSTs and
		// the visual transport all adopt the new tempo together.
		requestAnimationFrame(() => { void start(loopEnabled, pos, 0.16); });
	};

	const changeSignature = (n: number, d: number) => {
		const nextN = Math.max(1, Math.round(n));
		const nextD = Math.max(1, Math.round(d));
		if (!isPlaying) {
			sigNumRef.current = nextN; sigDenRef.current = nextD;
			setSigNum(nextN); setSigDen(nextD);
			return;
		}
		const pos = currentTransportPosition();
		stop();
		sigNumRef.current = nextN; sigDenRef.current = nextD;
		setSigNum(nextN); setSigDen(nextD); setPlayheadPosBars(pos);
		requestAnimationFrame(() => { void start(loopEnabled, pos, 0.16); });
	};

	const togglePlay = () => {
		if (isPlaying || transportStartPendingRef.current) stop();
		else start();
	};

	const seekTransport = (position: number) => {
		const next = clamp(position, 1, endBar);
		setPlayheadPosBars(next);
		lastPosRef.current = next;
		if (isPlaying || transportStartPendingRef.current) void start(loopEnabled, next, 0.16);
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


	useEffect(() => {
		const openAgent = () => setDawAgentOpen(true);
		window.addEventListener("ysong:daw-agent-open", openAgent);
		return () => window.removeEventListener("ysong:daw-agent-open", openAgent);
	}, []);

	// YSong has one major playback owner at a time. A World song takes ownership
	// from the project, while simply navigating between DAW/Mixer/Chat/etc. does not.
	useEffect(() => {
		const onWorldPlay = () => { if (isPlaying) stop(); };
		window.addEventListener("ysong:world-play-request", onWorldPlay);
		return () => window.removeEventListener("ysong:world-play-request", onWorldPlay);
	}, [isPlaying]);

	// Claim the shared transport only after the DAW really entered playback.
	// Pausing/stopping keeps the last source selected so Visuals restores it on reopen.
	useEffect(() => { if (isPlaying) claimPlaybackOwner("daw"); }, [isPlaying]);

	// The Mixer is a second control surface for this exact DAW state, not a duplicate
	// mixer engine. Commands from YC-9000 modify the same track objects used here.
	useEffect(() => subscribeDawSessionCommands((command) => {
		if (command.type === "set-level") setTrackLevel(command.trackId, command.value);
		else if (command.type === "set-mute") setTracks((prev) => prev.map((track) => track.id === command.trackId ? { ...track, mute: command.value } : track));
		else if (command.type === "set-solo") setTracks((prev) => prev.map((track) => track.id === command.trackId ? { ...track, solo: command.value } : track));
		else if (command.type === "set-mixer") setTrackMixer(command.trackId, command.patch);
		else if (command.type === "set-send") setTrackSend(command.trackId, command.index, { level: command.level, pre: command.pre });
		else if (command.type === "set-master-level") setMasterLevel(clamp(Math.round(command.value), 0, 127));
		else if (command.type === "transport-toggle") togglePlay();
		else if (command.type === "transport-stop") stop();
		else if (command.type === "transport-seek-seconds") {
			const beatSeconds = (60 / Math.max(1, bpm)) * (4 / Math.max(1, sigDen));
			const barSeconds = beatSeconds * Math.max(1, sigNum);
			const nextBar = clamp(1 + Math.max(0, command.value) / Math.max(0.001, barSeconds), 1, endBar);
			seekTransport(nextBar);
		}
		else if (command.type === "set-bpm") changeBpm(command.value);
		else if (command.type === "select-track") { setSelectedTrackId(command.trackId); setSelectedClipId(null); }
		else if (command.type === "rename-track") setTracks((prev) => prev.map((track) => track.id === command.trackId ? { ...track, name: command.name } : track));
		else if (command.type === "create-track") {
			const id = crypto.randomUUID();
			setTracks((prev) => {
				const nextIndex = prev.filter((track) => track.type === command.kind).length + 1;
				const created = mkTrack(command.kind, nextIndex, id);
				if (command.name?.trim()) created.name = command.name.trim();
				return [...prev, created];
			});
			setTrackHeights((prev) => ({ ...prev, [id]: ROW_H }));
			setSelectedTrackId(id); setSelectedClipId(null);
		}
		else if (command.type === "add-c1") addDynamicsC1(command.trackId);
		else if (command.type === "open-track-fx") {
			setSelectedTrackId(command.trackId);
			setSelectedClipId(null);
			setFxChainTrackId(command.trackId);
			setFxEditorEffectId(null);
		}
	}), [isPlaying, loopEnabled, loopL, loopR, endBar, playheadPosBars, bpm, sigNum, sigDen, tracks]);

	useEffect(() => {
		if (!dawHydrated) return;
		const maxMeter = tracks.reduce((peak, track) => Math.max(peak, trackMeters[track.id] ?? 0), 0);
		const clipCounts = new Map<string, number>();
		for (const clip of clips) clipCounts.set(clip.trackId, (clipCounts.get(clip.trackId) ?? 0) + 1);
		publishDawSessionSnapshot({
			projectId: activeProjectId,
			projectName,
			playing: isPlaying,
			playheadBar: playheadPosBars,
			endBar,
			bpm,
			sigNum,
			sigDen,
			bridgeAvailable,
			selectedTrackId,
			masterLevel,
			masterMeter: maxMeter * clamp(masterLevel / 100, 0, 1.27),
			tracks: tracks.map((track) => {
				const gm = GM_PROGRAMS.find((program) => program.program === normalizeGmProgram(track.gmProgram ?? 0));
				return {
					id: track.id,
					type: track.type,
					name: track.name,
					mute: track.mute,
					solo: track.solo,
					arm: track.arm,
					level: clamp(track.level ?? 100, 0, 127),
					meter: trackMeters[track.id] ?? 0,
					instrumentLabel: track.type === "instrument" ? (track.vst3PluginName ?? gm?.label ?? "Acoustic Grand Piano") : undefined,
					presetHint: track.vstPresetHint,
					desktopVstUnavailable: !!track.vst3PluginPath && bridgeAvailable === false,
					nativeVst: trackUsesNativeVst(track),
					clipCount: clipCounts.get(track.id) ?? 0,
					effects: (track.effects ?? []).map((effect) => ({ id: effect.id, name: effect.name, type: effect.type, enabled: effect.enabled, parameters: Object.fromEntries(Object.entries(effect).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))) })),
					mixer: normalizeMixerStrip(track.mixer),
				};
			}),
		});
		const now = Date.now();
		if (getPlaybackOwner() === "daw" && now - lastVisualTransportPushRef.current >= 100) {
			lastVisualTransportPushRef.current = now;
			const beatSeconds = (60 / Math.max(1, bpm)) * (4 / Math.max(1, sigDen));
			const barSeconds = beatSeconds * Math.max(1, sigNum);
			void bridgeApi.setVisualTransport({
				source: "daw", playing: isPlaying, positionSeconds: Math.max(0, playheadPosBars - 1) * barSeconds,
				durationSeconds: Math.max(0, endBar - 1) * barSeconds, bpm, sigNum, sigDen, title: projectName, artist: "", album: "", updatedAt: now,
			}).catch(() => {});
		}
	}, [dawHydrated, activeProjectId, projectName, isPlaying, playheadPosBars, endBar, bpm, sigNum, sigDen, bridgeAvailable, selectedTrackId, masterLevel, tracks, clips, trackMeters]);

	// Feed browser/WebAudio master analysis into the native Bridge. Native VST3
	// instruments are analyzed inside Bridge itself, then both paths are merged there.
	// Keeping the Bridge as the rendezvous point also lets OBS Browser Source receive
	// the exact same visual state even though OBS runs a different Chromium process.
	useEffect(() => {
		if (!dawHydrated) return;
		let slowBass = 0;
		let kickEnvelope = 0;
		let busy = false;
		const timer = window.setInterval(() => {
			const analyser = masterVisualAnalyserRef.current;
			const ctx = audioCtxRef.current;
			if (!analyser || !ctx || busy) return;
			busy = true;
			try {
				const time = new Float32Array(analyser.fftSize);
				const freq = new Float32Array(analyser.frequencyBinCount);
				analyser.getFloatTimeDomainData(time);
				analyser.getFloatFrequencyData(freq);

				let sumSq = 0;
				let peak = 0;
				for (const sample of time) {
					sumSq += sample * sample;
					peak = Math.max(peak, Math.abs(sample));
				}
				const rms = clamp(Math.sqrt(sumSq / Math.max(1, time.length)) * 2.1, 0, 1);
				const nyquist = ctx.sampleRate / 2;
				const hzPerBin = nyquist / Math.max(1, freq.length);
				const normalizedDb = (db: number) => clamp((db + 78) / 68, 0, 1);
				let bassSum = 0, bassN = 0, midsSum = 0, midsN = 0, highsSum = 0, highsN = 0;
				for (let i = 1; i < freq.length; i++) {
					const hz = i * hzPerBin;
					const value = normalizedDb(freq[i]);
					if (hz >= 25 && hz < 250) { bassSum += value; bassN++; }
					else if (hz >= 250 && hz < 2200) { midsSum += value; midsN++; }
					else if (hz >= 2200 && hz <= Math.min(16000, nyquist)) { highsSum += value; highsN++; }
				}
				const bass = bassN ? bassSum / bassN : 0;
				const mids = midsN ? midsSum / midsN : 0;
				const highs = highsN ? highsSum / highsN : 0;
				const energy = clamp(bass * 0.38 + mids * 0.40 + highs * 0.22, 0, 1);
				slowBass = slowBass * 0.94 + bass * 0.06;
				const transient = clamp((bass - slowBass * 1.12) * 5.5, 0, 1);
				kickEnvelope = Math.max(transient, kickEnvelope * 0.74);

				const spectrum = Array.from({ length: 64 }, (_, displayBin) => {
					const minHz = 30;
					const maxHz = Math.max(minHz + 1, Math.min(16000, nyquist));
					const f0 = minHz * Math.pow(maxHz / minHz, displayBin / 64);
					const f1 = minHz * Math.pow(maxHz / minHz, (displayBin + 1) / 64);
					const first = Math.max(1, Math.floor(f0 / hzPerBin));
					const last = Math.min(freq.length - 1, Math.max(first, Math.ceil(f1 / hzPerBin)));
					let total = 0;
					for (let i = first; i <= last; i++) total += normalizedDb(freq[i]);
					return total / Math.max(1, last - first + 1);
				});

				void bridgeApi.pushVisualBrowserAudio({
					timestampUnixMs: Date.now(), rms, peak: clamp(peak, 0, 1), bass, mids, highs, energy, kick: kickEnvelope, spectrum,
				}).catch(() => {});
			} finally {
				busy = false;
			}
		}, 50);
		return () => window.clearInterval(timer);
	}, [dawHydrated]);

	// Spacebar toggles play/stop (unless you're typing)
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (isEditableTarget(e.target)) return;

			if (e.code === "Space") {
				e.preventDefault();
				togglePlay();
			} else if (e.key === "Home") {
				e.preventDefault();
				seekTransport(loopEnabled ? loopL : 1);
			} else if (e.key === "End") {
				e.preventDefault();
				seekTransport(endBar);
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
			for (const [trackId, bus] of trackAudioBusesRef.current.entries()) {
				clearGmSoundFontTrackDestination(trackId);
				try { bus.input.disconnect(); } catch {}
			for (const runtime of bus.effectRuntimes.values()) {
				try { runtime.stop?.(); } catch {}
				for (const node of runtime.nodes) { try { node.disconnect(); } catch {} }
			}
				try { bus.gain.disconnect(); } catch {}
				try { bus.analyser.disconnect(); } catch {}
			}
			trackAudioBusesRef.current.clear();
			try { masterVisualAnalyserRef.current?.disconnect(); } catch {}
			masterVisualAnalyserRef.current = null;
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
		? (bridgeAvailable === false ? `${keyboardTarget.vst3PluginName ?? "Desktop VST3"} · Acoustic Grand Piano preview` : (keyboardTarget.vst3PluginName ?? "VST3"))
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


	const collectMidiExportTracks = (onlyGm = false): DawExportMidiTrack[] => {
		return tracks
			.filter((track) => track.type === "instrument" && (!onlyGm || !trackUsesNativeVst(track)))
			.map((track) => {
				const notes: DawExportMidiTrack["notes"] = [];
				const pitchBend: NonNullable<DawExportMidiTrack["pitchBend"]> = [];
				const modulation: NonNullable<DawExportMidiTrack["modulation"]> = [];
				for (const clip of clips.filter((c) => c.trackId === track.id && !c.assetId)) {
					const clipStart = Math.max(0, clip.startBar - 1);
					const clipLength = Math.max(0, Math.min(clip.lengthBars, endBar - clip.startBar));
					if (clipLength <= 0) continue;
					for (const note of clip.midiNotes ?? []) {
						const start = clipStart + Math.max(0, note.startBars);
						const clipEnd = clipStart + clipLength;
						if (start >= clipEnd || start >= endBar - 1) continue;
						notes.push({
							pitch: note.pitch,
							startBars: start,
							lengthBars: Math.max(1 / 128, Math.min(note.lengthBars, clipEnd - start, (endBar - 1) - start)),
							velocity: note.velocity,
						});
					}
					for (const point of clip.midiPitchBend ?? []) {
						const at = clipStart + Math.max(0, point.atBars);
						if (at <= clipStart + clipLength && at <= endBar - 1) pitchBend.push({ atBars: at, value: point.value });
					}
					for (const point of clip.midiModulation ?? []) {
						const at = clipStart + Math.max(0, point.atBars);
						if (at <= clipStart + clipLength && at <= endBar - 1) modulation.push({ atBars: at, value: point.value });
					}
				}
				return {
					name: track.name,
					program: trackUsesNativeVst(track) ? undefined : normalizeGmProgram(track.vst3PluginPath ? 0 : (gmProgramOverrideRef.current.get(track.id) ?? track.gmProgram ?? 0)),
					notes,
					pitchBend,
					modulation,
				};
			});
	};

	const buildOfflineVstTracks = (barSec: number): Vst3OfflineRenderTrack[] => {
		return tracks
			.filter((track) => track.type === "instrument" && trackUsesNativeVst(track))
			.map((track) => {
				const events: Vst3OfflineRenderTrack["events"] = [];
				for (const clip of clips.filter((c) => c.trackId === track.id && !c.assetId)) {
					const clipStartBar = Math.max(1, clip.startBar);
					const clipEndBar = Math.min(endBar, clip.startBar + clip.lengthBars);
					for (let noteIndex = 0; noteIndex < (clip.midiNotes ?? []).length; noteIndex++) {
						const note = (clip.midiNotes ?? [])[noteIndex];
						const noteStartBar = clip.startBar + note.startBars;
						const noteEndBar = Math.min(clipEndBar, noteStartBar + Math.max(1 / 128, note.lengthBars));
						const from = Math.max(clipStartBar, noteStartBar);
						const to = Math.min(endBar, noteEndBar);
						if (to <= from) continue;
						const noteId = stablePositiveInt(`export:${clip.id}:${noteIndex}:${note.pitch}`);
						events.push({ kind: "on", note: note.pitch, velocity: note.velocity, noteId, channel: 0, atSeconds: Math.max(0, (from - 1) * barSec) });
						events.push({ kind: "off", note: note.pitch, velocity: 0, noteId, channel: 0, atSeconds: Math.max(0, (to - 1) * barSec) });
					}
				}
				events.sort((a, b) => a.atSeconds - b.atSeconds || (a.kind === "off" ? -1 : 1));
				return { trackId: track.id, events };
			});
	};

	const buildOfflineTrackInput = (context: BaseAudioContext, track: Track, destination: AudioNode) => {
		const mixer = mixerForTrack(track);
		const input = context.createGain();
		const trim = context.createGain();
		trim.gain.value = dbToGain(mixer.inputGainDb) * (mixer.phaseInvert ? -1 : 1);

		const hpf = context.createBiquadFilter();
		hpf.type = "highpass"; hpf.frequency.value = mixer.hpfEnabled ? mixer.hpfHz : 10; hpf.Q.value = 0.707;
		const lpf = context.createBiquadFilter();
		lpf.type = "lowpass"; lpf.frequency.value = mixer.lpfEnabled ? mixer.lpfHz : Math.min(22000, context.sampleRate * 0.49); lpf.Q.value = 0.707;
		const low = context.createBiquadFilter();
		low.type = "lowshelf"; low.frequency.value = mixer.lowFreqHz; low.gain.value = mixer.eqEnabled ? mixer.lowGainDb : 0;
		const lowMid = context.createBiquadFilter();
		lowMid.type = "peaking"; lowMid.frequency.value = mixer.lowMidFreqHz; lowMid.Q.value = mixer.lowMidQ; lowMid.gain.value = mixer.eqEnabled ? mixer.lowMidGainDb : 0;
		const highMid = context.createBiquadFilter();
		highMid.type = "peaking"; highMid.frequency.value = mixer.highMidFreqHz; highMid.Q.value = mixer.highMidQ; highMid.gain.value = mixer.eqEnabled ? mixer.highMidGainDb : 0;
		const high = context.createBiquadFilter();
		high.type = "highshelf"; high.frequency.value = mixer.highFreqHz; high.gain.value = mixer.eqEnabled ? mixer.highGainDb : 0;
		const compressor = context.createDynamicsCompressor();
		compressor.threshold.value = mixer.compressorEnabled ? mixer.compressorThresholdDb : 0;
		compressor.ratio.value = mixer.compressorEnabled ? mixer.compressorRatio : 1;
		compressor.attack.value = mixer.compressorAttackMs / 1000;
		compressor.release.value = mixer.compressorReleaseMs / 1000;
		compressor.knee.value = mixer.compressorEnabled ? 12 : 0;

		input.connect(trim); trim.connect(hpf); hpf.connect(lpf); lpf.connect(low); low.connect(lowMid); lowMid.connect(highMid); highMid.connect(high); high.connect(compressor);
		const fader = context.createGain();
		fader.gain.value = computedTrackGain(track);
		connectWebAudioEffects(context, compressor, track.effects ?? [], fader);

		const widthInput = context.createGain();
		const splitter = context.createChannelSplitter(2);
		const widthLL = context.createGain(); const widthLR = context.createGain(); const widthRL = context.createGain(); const widthRR = context.createGain();
		const width = clamp(mixer.width / 100, 0, 2);
		const same = (1 + width) * 0.5; const cross = (1 - width) * 0.5;
		widthLL.gain.value = same; widthRR.gain.value = same; widthLR.gain.value = cross; widthRL.gain.value = cross;
		const merger = context.createChannelMerger(2);
		const panner = context.createStereoPanner(); panner.pan.value = mixer.pan;
		fader.connect(widthInput); widthInput.connect(splitter);
		splitter.connect(widthLL, 0); splitter.connect(widthRL, 0); splitter.connect(widthLR, 1); splitter.connect(widthRR, 1);
		widthLL.connect(merger, 0, 0); widthLR.connect(merger, 0, 0); widthRL.connect(merger, 0, 1); widthRR.connect(merger, 0, 1);
		merger.connect(panner); panner.connect(destination);
		return input;
	};

	const renderAudioClipsForExport = async (durationSeconds: number, sampleRate: number) => {
		const frames = Math.max(1, Math.ceil(durationSeconds * sampleRate));
		const offline = new OfflineAudioContext(2, frames, sampleRate);
		const trackInputs = new Map<string, AudioNode>();
		let scheduled = 0;
		for (const clip of clips.filter((c) => !!c.assetId)) {
			const track = tracks.find((t) => t.id === clip.trackId && t.type === "audio");
			if (!track || computedTrackGain(track) <= 0) continue;
			const startSeconds = Math.max(0, (clip.startBar - 1) * getBarSeconds());
			if (startSeconds >= durationSeconds) continue;
			const buffer = await ensurePlaybackBufferForClip(clip);
			const playSeconds = Math.min(buffer.duration, durationSeconds - startSeconds);
			if (playSeconds <= 0) continue;
			const source = offline.createBufferSource();
			source.buffer = buffer;
			let input = trackInputs.get(track.id);
			if (!input) {
				input = buildOfflineTrackInput(offline, track, offline.destination);
				trackInputs.set(track.id, input);
			}
			source.connect(input);
			source.start(startSeconds, 0, playSeconds);
			scheduled += 1;
		}
		if (!scheduled) return { left: new Float32Array(frames), right: new Float32Array(frames), sampleRate };
		const rendered = await offline.startRendering();
		return {
			left: new Float32Array(rendered.getChannelData(0)),
			right: new Float32Array(rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : rendered.getChannelData(0)),
			sampleRate: rendered.sampleRate,
		};
	};

	const renderGmForExport = async (durationSeconds: number, sampleRate: number) => {
		const frames = Math.max(1, Math.ceil(durationSeconds * sampleRate));
		const anySolo = tracks.some((track) => track.solo);
		const gmTracks = tracks.filter((track) => track.type === "instrument" && !trackUsesNativeVst(track) && !track.mute && (!anySolo || track.solo));
		if (!gmTracks.length) return { left: new Float32Array(frames), right: new Float32Array(frames), sampleRate };

		const gmExportTracks = collectMidiExportTracks(true);
		const gmTrackIndex = tracks.filter((track) => track.type === "instrument" && !trackUsesNativeVst(track));
		const midiTracks: DawExportMidiTrack[] = gmTracks.map((track) => {
			const sourceIndex = gmTrackIndex.findIndex((candidate) => candidate.id === track.id);
			const source = gmExportTracks[sourceIndex] ?? { name: track.name, notes: [] };
			return {
				...source,
				program: normalizeGmProgram(track.vst3PluginPath ? 0 : (gmProgramOverrideRef.current.get(track.id) ?? track.gmProgram ?? 0)),
			};
		});
		if (!midiTracks.some((track) => track.notes.length > 0)) return { left: new Float32Array(frames), right: new Float32Array(frames), sampleRate };

		const midiBytes = buildStandardMidiFile({ bpm, sigNum, sigDen, endBar, tracks: midiTracks });
		const [{ WorkletSynthesizer }, { BasicMIDI }] = await Promise.all([
			import("spessasynth_lib"),
			import("spessasynth_core"),
		]);
		const sfResponse = await fetch("/soundfonts/GeneralUser-GS.sf2");
		if (!sfResponse.ok) throw new Error(`YSong General MIDI SoundFont is missing (HTTP ${sfResponse.status}).`);
		const soundBankBuffer = await sfResponse.arrayBuffer();
		const offline = new OfflineAudioContext(2, frames, sampleRate);
		await offline.audioWorklet.addModule("/spessasynth_processor.min.js");
		const synth = new WorkletSynthesizer(offline);
		gmTracks.forEach((track, index) => {
			const input = buildOfflineTrackInput(offline, track, offline.destination);
			synth.connectChannel(input, GM_EXPORT_CHANNELS[index % GM_EXPORT_CHANNELS.length]);
		});
		const midiSequence = BasicMIDI.fromArrayBuffer(midiBytes.buffer.slice(midiBytes.byteOffset, midiBytes.byteOffset + midiBytes.byteLength));
		await synth.startOfflineRender({
			midiSequence,
			loopCount: 0,
			soundBankList: [{ bankOffset: 0, soundBankBuffer }],
			sequencerOptions: { skipToFirstNoteOn: false },
		});
		try {
			const rendered = await offline.startRendering();
			return {
				left: new Float32Array(rendered.getChannelData(0)),
				right: new Float32Array(rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : rendered.getChannelData(0)),
				sampleRate: rendered.sampleRate,
			};
		} finally {
			try { synth.destroy(); } catch {}
		}
	};

	const runMasterExport = async () => {
		if (exporting) return;
		const unavailableDesktopVsts = tracks.filter((track) => track.type === "instrument" && !!track.vst3PluginPath && !trackUsesNativeVst(track));
		if (exportFormat !== "midi" && unavailableDesktopVsts.length > 0) {
			const names = unavailableDesktopVsts.slice(0, 4).map((track) => track.vst3PluginName ?? track.name);
			const more = unavailableDesktopVsts.length > names.length ? `\n…and ${unavailableDesktopVsts.length - names.length} more.` : "";
			const okay = window.confirm(`Some desktop VST instruments are unavailable on this device.\n\nYSong is previewing these tracks with Acoustic Grand Piano:\n• ${names.join("\n• ")}${more}\n\nIf you export here, the exported audio will use the preview sound and will not match the intended desktop VST sound.\n\nExport anyway?`);
			if (!okay) return;
		}
		setExporting(true);
		setExportStatus("");
		try {
			if (isPlaying) stop();
			const baseName = safeExportFileName(projectName);
			if (exportFormat === "midi") {
				setExportStatus("Writing MIDI…");
				const midi = buildStandardMidiFile({ bpm, sigNum, sigDen, endBar, tracks: collectMidiExportTracks(false) });
				downloadBlob(new Blob([midi], { type: "audio/midi" }), `${baseName}.mid`);
				setExportStatus("MIDI exported.");
				return;
			}

			const sampleRate = exportSampleRate;
			const barSec = getBarSeconds();
			const durationSeconds = Math.max(0.001, (endBar - 1) * barSec);
			const frames = Math.max(1, Math.ceil(durationSeconds * sampleRate));
			const masterL = new Float32Array(frames);
			const masterR = new Float32Array(frames);
			const addToMaster = (left: Float32Array, right: Float32Array) => {
				const count = Math.min(frames, left.length, right.length);
				for (let i = 0; i < count; i++) { masterL[i] += left[i]; masterR[i] += right[i]; }
			};

			setExportStatus(`Rendering audio 001 → ${Math.max(1, Math.ceil(endBar - 1))}…`);
			const audioMix = await renderAudioClipsForExport(durationSeconds, sampleRate);
			addToMaster(audioMix.left, audioMix.right);

			setExportStatus("Rendering General MIDI…");
			const gmMix = await renderGmForExport(durationSeconds, sampleRate);
			addToMaster(gmMix.left, gmMix.right);

			const vstTracks = tracks.filter((track) => track.type === "instrument" && trackUsesNativeVst(track));
			if (vstTracks.length) {
				setExportStatus("Preparing exact VST3 instrument states…");
				for (const track of vstTracks) await ensureVstLoaded(track);
				const anySolo = tracks.some((track) => track.solo);
				await Promise.all(vstTracks.map(async (track) => {
					await bridgeApi.setVst3Effects(track.id, toVstTrackEffects(track.effects));
					await bridgeApi.setVst3Mixer(track.id, track.mute || (anySolo && !track.solo), clamp(track.level ?? 100, 0, 127), nativeMixerForTrack(track));
				}));
				setExportStatus(`Rendering VST3 master 001 → ${Math.max(1, Math.ceil(endBar - 1))}…`);
				await bridgeApi.setVst3Master(100);
				let vstWav: ArrayBuffer;
				try { vstWav = await bridgeApi.renderVst3Mix(durationSeconds, buildOfflineVstTracks(barSec)); }
				finally { bridgeApi.setVst3Master(masterLevel).catch(() => {}); }
				const vstMix = decodeStereoFloatWav(vstWav);
				if (vstMix.sampleRate !== sampleRate) throw new Error(`Bridge rendered VST3 audio at ${vstMix.sampleRate} Hz; YSong export is ${sampleRate} Hz. Match the Bridge sample rate before exporting.`);
				addToMaster(vstMix.left, vstMix.right);
			}

			const exportMasterGain = clamp(masterLevel / 100, 0, 1.27);
			if (exportMasterGain !== 1) {
				for (let i = 0; i < frames; i++) { masterL[i] *= exportMasterGain; masterR[i] *= exportMasterGain; }
			}

			setExportStatus("Writing master file…");
			const floatWav = new Blob([encodeStereoWav(masterL, masterR, sampleRate, 32)], { type: "audio/wav" });
			if (exportFormat === "wav16" || exportFormat === "wav24") {
				const bits = exportFormat === "wav16" ? 16 : 24;
				const wav = new Blob([encodeStereoWav(masterL, masterR, sampleRate, bits)], { type: "audio/wav" });
				downloadBlob(wav, `${baseName}.wav`);
			} else if (exportFormat === "flac") {
				setExportStatus("Encoding lossless FLAC…");
				const encoded = await bridgeApi.encodeAudio(floatWav, "flac");
				downloadBlob(encoded, `${baseName}.flac`);
			} else {
				setExportStatus(`Encoding MP3 ${exportMp3Bitrate} kbps…`);
				const encoded = await bridgeApi.encodeAudio(floatWav, "mp3", exportMp3Bitrate);
				downloadBlob(encoded, `${baseName}.mp3`);
			}
			setExportStatus("Export complete.");
		} catch (error) {
			console.error("YSong export failed", error);
			setExportStatus(error instanceof Error ? error.message : "Export failed.");
		} finally {
			setExporting(false);
		}
	};

	const fxChainTrack = fxChainTrackId ? tracks.find((track) => track.id === fxChainTrackId) ?? null : null;
	const fxEditorEffect = fxChainTrack && fxEditorEffectId
		? (fxChainTrack.effects ?? []).find((effect) => effect.id === fxEditorEffectId) ?? null
		: null;
	const fxEditorGainReductionDb = (() => {
		if (!fxChainTrack || !fxEditorEffect || fxEditorEffect.type !== "compressor") return null;
		if (fxChainTrack.type === "instrument" && trackUsesNativeVst(fxChainTrack)) {
			const reduction = vstGainReductionRef.current[fxChainTrack.id];
			return typeof reduction === "number" && Number.isFinite(reduction) ? Math.max(0, reduction) : null;
		}
		const compressor = trackAudioBusesRef.current.get(fxChainTrack.id)?.effectRuntimes.get(fxEditorEffect.id)?.compressor;
		return compressor && Number.isFinite(compressor.reduction) ? Math.max(0, -compressor.reduction) : null;
	})();

	const requestFxChainPlan = async (track: Track, intent: string): Promise<FxChainPlan> => {
		const browserEffectsAvailable = !trackUsesNativeVst(track);
		const allowed = browserEffectsAvailable
			? "compressor, delay, chorus, flanger, phaser, bitcrusher, reverb"
			: "compressor only";
		try {
			const reply = await localAiChat([
				{
					role: "system",
					content: `You are YSong's FX-chain planner. Propose an ordered chain using ONLY these exact effect types: ${allowed}. Return JSON only, never code. Shape: {"summary":"concise","devices":[{"type":"compressor","enabled":true,"thresholdDb":-18,"ratio":4,"attackMs":12,"releaseMs":180,"kneeDb":18,"inputGainDb":0,"outputGainDb":0,"reason":"..."},{"type":"reverb","enabled":true,"mix":0.2,"decaySeconds":2.2,"reason":"..."}]}. Browser-effect fields, where relevant: mix 0..1, rateHz 0.05..8, depth 0..1, timeMs 1..1000, feedback 0..0.85, bits 2..16, cutoffHz 100..5000, decaySeconds 0.2..8. Compressor ranges: input/output gain -24..24 dB, threshold -60..0 dB, ratio 1..20, attack 0.1..200 ms, release 10..2000 ms, knee 0..40 dB. Use no more than 6 devices. YSong validates every value and ignores every unknown field.`,
				},
				{
					role: "user",
					content: `Track: ${track.name}\nTrack type: ${track.type}\nProcessing intention: ${intent}\nCurrent ordered chain: ${(track.effects ?? []).map((effect) => effect.type).join(", ") || "none"}\nPropose a complete replacement chain for review.`,
				},
			]);
			const plan = normalizeFxChainPlan(parseFxChainPlanReply(reply), intent, { browserEffectsAvailable, source: "ai" });
			if (plan.devices.length) return plan;
		} catch { /* The local deterministic proposal remains available offline. */ }
		return fallbackFxChainPlan(intent, { browserEffectsAvailable });
	};

	const applyFxChainPlan = (track: Track, plan: FxChainPlan) => {
		const validated = normalizeFxChainPlan({ summary: plan.summary, devices: plan.devices }, plan.intent, {
			browserEffectsAvailable: !trackUsesNativeVst(track),
			source: plan.source,
		});
		if (!validated.devices.length) return;
		setTracks((current) => current.map((item) => item.id === track.id ? { ...item, effects: validated.devices.map((device) => device.effect) } : item));
		setFxEditorEffectId(null);
	};

	const composerProjectContext = useMemo<ComposerProjectContext>(() => {
		const selectedMidi = selectedClipId ? clips.find((clip) => clip.id === selectedClipId && (clip.midiNotes?.length ?? 0) > 0) ?? null : null;
		const sourceTrack = selectedMidi ? tracks.find((track) => track.id === selectedMidi.trackId) ?? null : null;
		return {
			projectName,
			playheadBar: playheadPosBars,
			tracks: tracks.map((track) => ({ name: track.name, type: track.type, clipCount: clips.filter((clip) => clip.trackId === track.id).length })),
			source: selectedMidi ? {
				trackId: sourceTrack?.id,
				trackName: sourceTrack?.name ?? "Selected MIDI",
				startBar: selectedMidi.startBar,
				lengthBars: selectedMidi.lengthBars,
				notes: (selectedMidi.midiNotes ?? []).map(({ pitch, startBars, lengthBars, velocity }) => ({ pitch, startBars, lengthBars, velocity })),
			} : null,
		};
	}, [projectName, playheadPosBars, tracks, clips, selectedClipId]);

	const soundDesignerKeyLabel = useMemo(() => {
		const selected = selectedClipId ? clips.find((clip) => clip.id === selectedClipId) ?? null : null;
		const rule = selected?.midiScales?.[0];
		if (!rule) return "";
		const scale = SCALE_DEFINITIONS.find((item) => item.id === rule.scaleId);
		return `${NOTE_NAMES[((rule.root % 12) + 12) % 12]} ${scale?.friendlyLabel ?? scale?.label ?? rule.scaleId}`;
	}, [clips, selectedClipId]);

	const soundDesignerProjectSummary = useMemo(() => {
		const parts = tracks.slice(0, 24).map((track) => {
			const clipCount = clips.filter((clip) => clip.trackId === track.id).length;
			return `${track.name} (${track.type}, ${clipCount} clip${clipCount === 1 ? "" : "s"})`;
		});
		return `${projectName || "Untitled project"} · ${bpm} BPM · ${sigNum}/${sigDen} · ${parts.join("; ")}`.slice(0, 1400);
	}, [projectName, bpm, sigNum, sigDen, tracks, clips]);

	const progressiveStemSeed = useMemo(() => {
		const selected = selectedClipId ? clips.find((clip) => clip.id === selectedClipId) ?? null : null;
		const selectedRule = selected?.midiScales?.[0];
		const chordClips = clips.filter((clip) => (clip.composerChords?.length ?? 0) > 0);
		const preferredChordClips = chordClips.filter((clip) => clip.composerRole === "chords");
		const chordSource = preferredChordClips.length ? preferredChordClips : chordClips;
		const chordMap = chordSource.flatMap((clip) => clip.composerChords ?? [])
			.filter((chord, index, all) => all.findIndex((other) => other.atBar === chord.atBar && other.symbol === chord.symbol) === index)
			.sort((a, b) => a.atBar - b.atBar);
		return {
			projectId: activeProjectId,
			projectName,
			bpm,
			sigNum,
			sigDen,
			totalBars: Math.max(1, Math.round(endBar - 1)),
			keyRoot: selectedRule?.root ?? 0,
			scaleId: selectedRule?.scaleId ?? "natural-minor" as const,
			sectionMap: (approvedComposerArrangement?.sections ?? []).map((section) => ({ name: section.name, startBar: section.startBar, endBar: section.endBar })),
			chordMap,
		};
	}, [activeProjectId, projectName, bpm, sigNum, sigDen, endBar, clips, selectedClipId, approvedComposerArrangement]);

	const progressiveDependencySources = useMemo<Record<string, Partial<StemDependency>>>(() => {
		const out: Record<string, Partial<StemDependency>> = {};
		for (const node of progressiveStemState.nodes) {
			const clip = node.clipId ? clips.find((item) => item.id === node.clipId) ?? null : null;
			out[node.nodeId] = {
				assetId: node.assetId ?? clip?.assetId,
				notes: (clip?.midiNotes ?? []).map(({ pitch, startBars, lengthBars, velocity }) => ({ pitch, startBars, lengthBars, velocity })),
				summary: node.summary,
			};
		}
		return out;
	}, [progressiveStemState.nodes, clips]);
	const selectedPart = useMemo(() => {
		const clip = clips.find((item) => item.id === selectedClipId);
		const track = clip && tracks.find((item) => item.id === clip.trackId);
		return clip && track ? { clipId: clip.id, name: clip.name, type: track.type } : null;
	}, [clips, tracks, selectedClipId]);
	const partStateRef = useRef({ clips, tracks, progressiveStemState });
	partStateRef.current = { clips, tracks, progressiveStemState };
	const restorePartAlternative = (clipId: string, index: number) => {
		const current = clips.find((clip) => clip.id === clipId);
		const alternative = current?.partAlternatives?.[index];
		if (!current || !alternative || !tracks.some((track) => track.id === current.trackId)) return;
		const { partAlternatives: _unused, ...activeSnapshot } = current;
		if (current.stemNodeId) activeSnapshot.partStemNode = progressiveStemState.nodes.find((node) => node.nodeId === current.stemNodeId);
		const alternatives = current.partAlternatives!.filter((_, i) => i !== index);
		const restored: Clip = { ...alternative, id: current.id, partAlternatives: [...alternatives, activeSnapshot] };
		const track = tracks.find((item) => item.id === restored.trackId);
		if (!track) return;
		if ((track.type === "audio") !== Boolean(restored.assetId)) return;
		setClips((previous) => previous.map((clip) => clip.id === clipId ? restored : clip));
		setSelectedTrackId(restored.trackId);
		if (current.stemNodeId) setProgressiveStemState((previous) => {
			const restoredNode = restored.partStemNode;
			const nodes = previous.nodes.flatMap((node) => node.nodeId === current.stemNodeId
				? restoredNode ? [{ ...restoredNode, clipId, trackId: restored.trackId, status: "active" as const }] : []
				: [node.dependsOn.some((dependency) => dependency.nodeId === current.stemNodeId) ? { ...node, status: "stale" as const } : node]);
			const activeByRole = { ...previous.activeByRole };
			const currentNode = previous.nodes.find((node) => node.nodeId === current.stemNodeId);
			if (!restoredNode && currentNode) delete activeByRole[currentNode.role];
			return { ...previous, nodes, activeByRole };
		});
	};

	const acceptProgressiveStemProposal = async (proposal: StemProposal, previous: StemNode | null, targetClipId: string | null, desiredInstrument: string) => {
		const projectId = activeProjectId;
		const targetClip = targetClipId ? clips.find((clip) => clip.id === targetClipId) : null;
		if (targetClipId && !targetClip) throw new Error("The selected part changed. Select it again before replacing.");
		const targetTrack = targetClip ? tracks.find((track) => track.id === targetClip.trackId) : null;
		if (targetClip && !targetTrack) throw new Error("The selected track is missing.");
		const universe = progressiveStemState.universe;
		if (!universe || universe.universeHash !== proposal.universeHash) throw new Error("The stem universe changed. Generate the part again.");
		if (universe.songId !== projectId || universe.bpm !== bpm || universe.sigNum !== sigNum || universe.sigDen !== sigDen || universe.totalBars !== Math.max(1, Math.round(endBar - 1))) throw new Error("The project timeline no longer matches this stem. The original part was kept.");
		if (proposal.mode === "audio" && (!proposal.objectKey || !proposal.assetId)) throw new Error("Generated audio is not available. The original part was kept.");
		const expectedType: TrackType = proposal.mode === "midi" ? "instrument" : "audio";
		const keepTrack = targetTrack?.type === expectedType;
		const trackId = keepTrack ? targetTrack.id : crypto.randomUUID();
		const next = keepTrack ? targetTrack : mkTrack(expectedType, tracks.filter((track) => track.type === expectedType).length + 1, trackId);
		const generation: PartGeneration = { origin: "progressive-stem", role: proposal.role, requestId: proposal.id, createdAt: new Date().toISOString(), ...(targetClip ? { replacedClipId: targetClip.id, ...(targetClip.partGeneration && "requestId" in targetClip.partGeneration ? { parentRequestId: targetClip.partGeneration.requestId } : {}) } : {}) };
		if (!keepTrack) { next.name = `${proposal.label || proposal.role} v${proposal.version}`; next.partGeneration = generation; }
		if (proposal.mode === "midi") {
			const roleProgram: Record<StemRole, number> = { drums: 118, bass: 38, piano: 0, strings: 48, lead: 81, vocals: 52, guitar: 29, choir: 52, atmosphere: 89, percussion: 115, fx: 103 };
			if (!keepTrack) {
				next.gmProgram = roleProgram[proposal.role];
				if (desiredInstrument.trim()) {
					next.desiredInstrument = desiredInstrument.trim();
					try {
						const result = await bridgeApi.matchInstruments([desiredInstrument.trim()], 12, { role: proposal.role });
						const candidates = result.matches.filter((item) => item.instrument.loadable && !!item.instrument.path);
						const match = candidates[0];
						if (match && match.score > 0 && match.weakEvidence === false && Array.isArray(match.evidence) && candidates[1]?.score !== match.score) {
							next.vst3PluginPath = match.instrument.path;
							next.vst3PluginName = match.instrument.name;
							next.vst3PluginVendor = match.instrument.vendor ?? undefined;
							next.instrumentResolution = { status: "resolved", source: "bridge-match", instrumentId: match.instrument.id, score: match.score, evidence: match.evidence, reasons: match.reasons, weakEvidence: false };
						}
					} catch { /* Keep the explicit GM fallback when Bridge matching is unavailable. */ }
				}
			}
		}
		if (activeProjectRef.current !== projectId) throw new Error("The project changed while preparing this part. Nothing was replaced.");
		if (partStateRef.current.progressiveStemState !== progressiveStemState || (targetClip && JSON.stringify(partStateRef.current.clips.find((clip) => clip.id === targetClip.id)) !== JSON.stringify(targetClip)) || (targetTrack && JSON.stringify(partStateRef.current.tracks.find((track) => track.id === targetTrack.id)) !== JSON.stringify(targetTrack))) throw new Error("The part or stem graph changed while preparing the result. Nothing was replaced.");
		const clipId = crypto.randomUUID();
		const stableNodeId = previous?.nodeId ?? crypto.randomUUID();
		let nextClip: Clip;
		if (proposal.mode === "midi") {
			nextClip = {
				id: clipId, trackId, name: `${proposal.label || proposal.role} v${proposal.version}`, startBar: 1, lengthBars: universe.totalBars,
				midiNotes: proposal.notes.map((note) => ({ id: crypto.randomUUID(), pitch: clamp(Math.round(note.pitch), 0, 127), startBars: Math.max(0, note.startBars), lengthBars: Math.max(1 / 128, note.lengthBars), velocity: clamp(Math.round(note.velocity), 1, 127) })),
				midiPitchBend: [], midiModulation: [], midiBendRange: 12,
				midiScales: ["drums", "percussion", "fx"].includes(proposal.role) ? [] : [{ id: crypto.randomUUID(), root: universe.keyRoot, scaleId: universe.scaleId }],
				midiScaleLock: ["drums", "percussion", "fx"].includes(proposal.role) ? "off" : "strict",
				composerRole: proposal.role, composerChords: proposal.chords,
				stemNodeId: stableNodeId, stemVersion: proposal.version, stemUniverseHash: proposal.universeHash, stemGenerationFamily: proposal.generationFamily, partGeneration: generation,
			};
		} else {
			const assetId = proposal.assetId || proposal.objectKey;
			setProjectAssets((prev) => prev.some((asset) => asset.id === assetId || asset.objectKey === proposal.objectKey) ? prev : [...prev, { id: assetId, kind: "audio", name: `${proposal.label} v${proposal.version}.wav`, objectKey: proposal.objectKey, durationSec: proposal.exactDurationSec, sizeMB: proposal.sizeBytes / (1024 * 1024) }]);
			nextClip = { id: clipId, trackId, assetId, name: `${proposal.label || proposal.role} v${proposal.version}`, startBar: 1, lengthBars: proposal.lengthBars, sourceOffsetSec: 0, sourceDurationSec: proposal.exactDurationSec, fadeInBars: 0, fadeOutBars: 0, composerRole: proposal.role, stemNodeId: stableNodeId, stemVersion: proposal.version, stemUniverseHash: proposal.universeHash, stemGenerationFamily: proposal.generationFamily, partGeneration: generation };
		}
		if (targetClip) {
			const { partAlternatives: _unused, ...oldVersion } = targetClip;
			oldVersion.partStemNode = progressiveStemState.nodes.find((node) => node.clipId === targetClip.id);
			nextClip.partAlternatives = [...(targetClip.partAlternatives ?? []), oldVersion];
		}
		if (!keepTrack) { setTracks((prev) => [...prev, next]); setTrackHeights((prev) => ({ ...prev, [trackId]: prev[trackId] ?? ROW_H })); }
		setClips((prev) => [...prev.filter((clip) => clip.id !== targetClipId), nextClip]);
		setBars((prev) => Math.min(MAX_BARS, Math.max(prev, Math.ceil(proposal.lengthBars + 8))));
		setSelectedTrackId(trackId);
		setSelectedClipId(clipId);
		if (targetClipId) setMidiEditorClipId((id) => id === targetClipId ? clipId : id);
		return { clipId, trackId, assetId: proposal.mode === "audio" ? proposal.assetId : undefined, stemNodeId: stableNodeId };
	};

	const acceptComposerProposal = (proposal: ComposerProposal, targetTrackId?: string | null, targetClipId?: string | null) => {
		const targetClip = targetClipId ? clips.find((clip) => clip.id === targetClipId) : null;
		if (targetClipId && (!targetClip || !tracks.some((track) => track.id === targetClip.trackId && track.type === "instrument"))) throw new Error("Selected MIDI part changed. The original was kept.");
		if (targetClip?.stemNodeId) throw new Error("This clip belongs to a stem dependency graph. Replace it in Stem Composer.");
		const usableTarget = targetClip ? tracks.find((track) => track.id === targetClip.trackId) : targetTrackId ? tracks.find((track) => track.id === targetTrackId && track.type === "instrument") ?? null : null;
		const roleProgram: Record<ComposerProposal["role"], number> = {
			melody: 81, chords: 0, bassline: 38, arpeggio: 81, countermelody: 80, drums: 118, strings: 48, piano: 0, atmosphere: 89, harmony: 52,
		};
		const trackId = usableTarget?.id ?? crypto.randomUUID();
		if (!usableTarget) {
			const next = mkTrack("instrument", tracks.filter((track) => track.type === "instrument").length + 1, trackId);
			next.name = proposal.label || proposal.role;
			next.gmProgram = roleProgram[proposal.role];
			next.partGeneration = { origin: "ai-composer", role: proposal.role, requestId: proposal.id, createdAt: new Date().toISOString() };
			setTracks((prev) => [...prev, next]);
			setTrackHeights((prev) => ({ ...prev, [trackId]: prev[trackId] ?? ROW_H }));
		}
		const clipId = crypto.randomUUID();
		const generation: PartGeneration = { origin: "ai-composer", role: proposal.role, requestId: proposal.id, createdAt: new Date().toISOString(), ...(targetClip ? { replacedClipId: targetClip.id, ...(targetClip.partGeneration && "requestId" in targetClip.partGeneration ? { parentRequestId: targetClip.partGeneration.requestId } : {}) } : {}) };
		const nextClip: Clip = {
			id: clipId, trackId, name: proposal.label || proposal.role, startBar: proposal.startBar, lengthBars: proposal.lengthBars,
			midiNotes: proposal.notes.map((note) => ({ id: crypto.randomUUID(), pitch: clamp(Math.round(note.pitch), 0, 127), startBars: Math.max(0, note.startBars), lengthBars: Math.max(1 / 128, note.lengthBars), velocity: clamp(Math.round(note.velocity), 1, 127) })),
			midiPitchBend: [], midiModulation: [], midiBendRange: 12,
			midiScales: proposal.role === "drums" ? [] : [{ id: crypto.randomUUID(), root: proposal.keyRoot, scaleId: proposal.scaleId }],
			midiScaleLock: proposal.role === "drums" ? "off" : "strict",
			composerRole: proposal.role,
			composerChords: proposal.chords.map((chord) => ({ atBar: proposal.startBar + chord.atBars, symbol: chord.symbol, durationBars: chord.durationBars })),
			partGeneration: generation,
		};
		if (targetClip) {
			const { partAlternatives: _unused, ...oldVersion } = targetClip;
			nextClip.partAlternatives = [...(targetClip.partAlternatives ?? []), oldVersion];
		}
		setClips((prev) => [...prev.filter((clip) => clip.id !== targetClipId), nextClip]);
		setSelectedTrackId(trackId);
		setSelectedClipId(clipId);
		if (targetClipId) setMidiEditorClipId((id) => id === targetClipId ? clipId : id);
		return trackId;
	};

	const openExportPanel = () => { setFileMenuOpen(false); setExportStatus(""); setExportOpen(true); };
	return (
		<div className={`daw-workspace h-full min-h-0 flex flex-col relative ${touchEditMode ? "daw-touch-edit" : ""}`}>
			{/* App-style menu bar. Project file commands live here instead of consuming transport space. */}
			<div className="daw-menu-bar relative z-50 h-8 shrink-0 px-1 flex items-center gap-1 border-t border-b border-neutral-200/15 dark:border-neutral-800 bg-neutral-950/65 select-none">
				<div className="relative h-full flex items-center" ref={fileMenuRef}>
					<button
						type="button"
						className={`h-7 px-3 rounded-md text-[12px] ${fileMenuOpen ? "bg-white/10" : "hover:bg-white/[0.07]"}`}
						onClick={() => setFileMenuOpen((open) => !open)}
						aria-haspopup="menu"
						aria-expanded={fileMenuOpen}
					>
						File
					</button>
					{fileMenuOpen && (
						<div className="absolute left-0 top-[30px] z-[500] w-[250px] overflow-hidden rounded-xl border border-white/15 bg-neutral-950/98 shadow-2xl backdrop-blur-xl py-1" role="menu">
							<button type="button" role="menuitem" className="w-full px-3 py-2 text-left text-[12px] hover:bg-white/10 flex items-center justify-between gap-3" onClick={createNewProject}><span>New Project</span><span className="text-[10px] opacity-40">Ctrl+N</span></button>
							<button type="button" role="menuitem" className="w-full px-3 py-2 text-left text-[12px] hover:bg-white/10 flex items-center justify-between gap-3" onClick={() => void openProjectFile()}><span>Open Project…</span><span className="text-[10px] opacity-40">Ctrl+O</span></button>
							<div className="my-1 h-px bg-white/10" />
							<button type="button" role="menuitem" disabled={isSavingUi} className="w-full px-3 py-2 text-left text-[12px] hover:bg-white/10 disabled:opacity-35 flex items-center justify-between gap-3" onClick={() => void saveProjectFile()}><span>Save Project</span><span className="text-[10px] opacity-40">Ctrl+S</span></button>
							<button type="button" role="menuitem" disabled={isSavingUi} className="w-full px-3 py-2 text-left text-[12px] hover:bg-white/10 disabled:opacity-35 flex items-center justify-between gap-3" onClick={() => void saveProjectAsFile()}><span>Save Project As…</span><span className="text-[10px] opacity-40">Ctrl+Shift+S</span></button>
							<div className="my-1 h-px bg-white/10" />
							<button type="button" role="menuitem" className="w-full px-3 py-2 text-left text-[12px] hover:bg-white/10" onClick={openExportPanel}>Export…</button>
						</div>
					)}
				</div>
				<button type="button" onClick={openExportPanel} disabled={exporting} className="h-7 px-3 rounded-md text-[12px] border border-white/15 hover:bg-white/10 disabled:opacity-35">Export</button>
				{endMarkerMode === "manual" && <button type="button" onClick={() => setEndMarkerMode("auto")} className="h-7 px-2 rounded-md text-[11px] hover:bg-white/10" title="Follow the last musical event or audio clip">Auto E</button>}
				<div className="min-w-0 text-[10px] opacity-35 truncate px-1" title={projectName}>{projectName}</div>
				<div className="ml-auto flex items-center gap-1">
					<button type="button" onClick={() => { setAiComposerOpen((open) => !open); setDawAgentOpen(false); setInstrumentCatalogOpen(false); setSoundDesignerOpen(false); setProgressiveStemOpen(false); }} className={`h-7 px-3 rounded-md text-[11px] border ${aiComposerOpen ? "border-fuchsia-400/40 bg-fuchsia-500/20 text-fuchsia-100" : "border-white/10 hover:bg-white/[0.07]"}`} title="Open AI Composer — structured musical proposals">Composer</button>
					<button type="button" onClick={() => { setInstrumentCatalogOpen((open) => !open); setAiComposerOpen(false); setDawAgentOpen(false); setSoundDesignerOpen(false); setProgressiveStemOpen(false); }} className={`h-7 px-3 rounded-md text-[11px] border ${instrumentCatalogOpen ? "border-cyan-400/40 bg-cyan-500/20 text-cyan-100" : "border-white/10 hover:bg-white/[0.07]"}`} title="Open Bridge Instrument Catalog">Instruments</button>
					<button type="button" onClick={() => { setSoundDesignerOpen((open) => !open); setInstrumentCatalogOpen(false); setAiComposerOpen(false); setDawAgentOpen(false); setProgressiveStemOpen(false); }} className={`h-7 px-3 rounded-md text-[11px] border ${soundDesignerOpen ? "border-violet-400/40 bg-violet-500/20 text-violet-100" : "border-white/10 hover:bg-white/[0.07]"}`} title="Open AI Sound Designer — snapshot-first iterative VST parameter design">Sound Designer</button>
					<button type="button" onClick={() => { setProgressiveStemOpen((open) => !open); setAiComposerOpen(false); setInstrumentCatalogOpen(false); setSoundDesignerOpen(false); setDawAgentOpen(false); }} className={`h-7 px-3 rounded-md text-[11px] border ${progressiveStemOpen ? "border-emerald-400/40 bg-emerald-500/20 text-emerald-100" : "border-white/10 hover:bg-white/[0.07]"}`} title="Open Progressive AI Stem Composer — one target stem at a time">Stem Composer</button>
					<button type="button" onClick={() => { setDawAgentOpen((open) => !open); setAiComposerOpen(false); setInstrumentCatalogOpen(false); setSoundDesignerOpen(false); setProgressiveStemOpen(false); }} className={`h-7 px-3 rounded-md text-[11px] border ${dawAgentOpen ? "border-indigo-400/40 bg-indigo-500/20 text-indigo-100" : "border-white/10 hover:bg-white/[0.07]"}`} title="Open YSong AI inside the DAW">YSong AI</button>
				</div>
			</div>
			{selectedClipId && clips.find((clip) => clip.id === selectedClipId)?.partAlternatives?.length ? (
				<div className="shrink-0 flex items-center gap-2 overflow-x-auto border-b border-white/10 bg-fuchsia-500/[0.05] px-3 py-1 text-[10px]">
					<span className="shrink-0 opacity-65">Saved part versions:</span>
					{clips.find((clip) => clip.id === selectedClipId)!.partAlternatives!.map((version, index) => (
						<button key={`${version.id}-${index}`} type="button" className="shrink-0 rounded border border-fuchsia-400/25 px-2 py-1 hover:bg-fuchsia-500/15" onClick={() => restorePartAlternative(selectedClipId, index)} title="Use this saved part version; the current version remains available">
							Use {version.name} {version.partGeneration && "requestId" in version.partGeneration ? `(${version.partGeneration.requestId.slice(0, 8)})` : "(original)"}
						</button>
					))}
				</div>
			) : null}
			{clips.filter((clip) => clip.id === selectedClipId && !clip.assetId && clip.midiNotes).map((clip) => (
				<MidiToVocalPanel key={`${activeProjectId}:${clip.id}`} clip={clip} timebase={{ bpm, sigNum, sigDen }} onChange={(vocalSetup) => setClips((previous) => previous.map((item) => item.id === clip.id ? { ...item, vocalSetup } : item))} />
			))}
			{vocalMidiStatus && (
				<div className="shrink-0 flex items-center gap-2 border-b border-cyan-300/15 bg-cyan-400/[0.06] px-3 py-1.5 text-[11px] text-cyan-50">
					<div className="min-w-0 flex-1">
						<div className="truncate">{vocalMidiStatus}</div>
						{vocalMidiPreview && <div className="mt-1 flex h-7 items-end gap-px overflow-hidden rounded bg-black/20 px-1" role="img" aria-label={`Preview of ${vocalMidiPreview.notes.length} detected MIDI notes`}>
							{vocalMidiPreview.notes.map((note) => <span key={note.id} title={`${NOTE_NAMES[note.pitch % 12]}${Math.floor(note.pitch / 12) - 1}`} className="min-w-[2px] rounded-t bg-cyan-300/80" style={{ height: `${Math.max(18, (note.pitch - Math.min(...vocalMidiPreview.notes.map((n) => n.pitch)) + 1) / Math.max(1, Math.max(...vocalMidiPreview.notes.map((n) => n.pitch)) - Math.min(...vocalMidiPreview.notes.map((n) => n.pitch)) + 1) * 80)}%`, flex: `${Math.max(0.15, note.lengthBars)}` }} />)}
						</div>}
					</div>
					{vocalMidiPreview && <YSButton className="px-3 py-1 rounded-md text-[11px]" onClick={acceptVocalMidi}>Add editable MIDI</YSButton>}
					{vocalMidiPreview && <button type="button" className="px-2 py-1 opacity-65 hover:opacity-100" onClick={() => { setVocalMidiPreview(null); setVocalMidiStatus(""); }}>Cancel</button>}
				</div>
			)}
			{/* Main split */}
			<div className="daw-main-split flex-1 min-h-0 flex overflow-hidden border-t border-neutral-200/20 dark:border-neutral-800">
				{/* Left: independently collapsible DAW track panel. On smaller/mobile displays this defaults
				    to a narrow rail so the timeline keeps the majority of the screen. */}
				<div
					className={`daw-track-panel ${trackPanelOpen ? "daw-track-panel-open w-[min(300px,72vw)] md:w-[300px]" : "w-10"} shrink-0 border-r border-neutral-200/20 dark:border-neutral-800 bg-neutral-950/30 flex flex-col min-h-0 transition-[width] duration-200`}
				>
					<div className="flex flex-col border-b border-neutral-200/20 dark:border-neutral-800">
						<div className={`h-12 flex items-center bg-neutral-950/40 border-b border-neutral-200/10 dark:border-neutral-800 ${trackPanelOpen ? "px-2 gap-2" : "justify-center"}`}>
							{trackPanelOpen && (
								<>
									<div
										className={`w-2 h-2 rounded-full ${saveError ? "bg-red-400" : projectDirty ? "bg-amber-400" : "bg-emerald-400/60"}`}
										title={saveState}
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
								className="daw-panel-toggle h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-md border"
								aria-label={trackPanelOpen ? "Collapse track list" : "Expand track list"}
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
									className={`daw-track-header relative flex flex-col justify-start px-2 py-1.5 border-b border-neutral-200/10 dark:border-neutral-800 ${selected ? "bg-neutral-100/5" : ""}`}
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
										<button type="button" className="text-[10px] px-1 text-cyan-200" onClick={(event) => { event.stopPropagation(); setAutomationTrackId(automationTrackId === t.id ? null : t.id); setSelectedTrackId(t.id); }} title="Edit automation">AUTO</button>
										<YSButton
											className={`text-[10px] px-1.5 py-1 rounded-md transition ${(t.effects?.length ?? 0) > 0 ? "!border-amber-200/25 !text-amber-100" : "opacity-65 hover:opacity-100"}`}
											onClick={(e) => { e.stopPropagation(); setSelectedTrackId(t.id); setSelectedClipId(null); setFxChainTrackId(t.id); setFxEditorEffectId(null); }}
											title={`Effects chain${(t.effects?.length ?? 0) ? ` (${t.effects!.length})` : ""}`}
										>FX{(t.effects?.length ?? 0) > 0 ? ` ${t.effects!.length}` : ""}</YSButton>
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
													{t.vst3PluginPath && !vst3Plugins.some((plugin) => plugin.path === t.vst3PluginPath) && (
														<option value={`vst3:${t.vst3PluginPath}`}>{t.vst3PluginVendor ? `${t.vst3PluginVendor} · ` : ""}{t.vst3PluginName ?? "Desktop VST3"}{bridgeAvailable === false ? " · Mobile preview: Acoustic Grand Piano" : " · unavailable"}</option>
													)}
													<optgroup label="VST3 Instruments">
														{vst3Plugins.filter((plugin) => plugin.kind === "instrument" && plugin.loadable !== false).length === 0 ? (
															<option disabled value="">{bridgeAvailable === false ? "Desktop VST3 unavailable on this device" : "Scan VST3 in Settings first"}</option>
														) : vst3Plugins.filter((plugin) => plugin.kind === "instrument" && plugin.loadable !== false).map((plugin) => <option key={plugin.path} value={`vst3:${plugin.path}`}>{plugin.vendor ? `${plugin.vendor} · ` : ""}{plugin.name}</option>)}
													</optgroup>
												</select>
												{t.vst3PluginPath && (
													<>
														<span className={`w-7 h-5 flex items-center justify-center text-[8px] font-semibold shrink-0 ${bridgeAvailable === false ? "text-amber-200" : vstTrackState[t.id]?.status === "error" ? "text-rose-300" : vstTrackState[t.id]?.status === "loading" ? "text-amber-200" : "text-emerald-300"}`} title={bridgeAvailable === false ? `${t.vst3PluginName ?? "Desktop VST3"} is preserved but unavailable on this mobile device. YSong is previewing the MIDI with Acoustic Grand Piano.` : vstTrackState[t.id]?.status === "loading" ? `Loading ${t.vst3PluginName ?? "VST3"}…` : vstTrackState[t.id]?.message ?? "Bridge-hosted VST3"}>
															{vstTrackState[t.id]?.status === "loading" ? (
																<span className="inline-block h-3 w-3 rounded-full border border-amber-200/40 border-t-amber-200 animate-spin" aria-label={`Loading ${t.vst3PluginName ?? "VST3"}`} />
															) : bridgeAvailable === false ? "PREV" : vstTrackState[t.id]?.status === "error" ? "!" : "VST"}
														</span>
												<YSButton disabled={bridgeAvailable === false} className="h-7 px-2 py-0 rounded-md text-[9px] shrink-0 disabled:opacity-35" onClick={(e) => { e.stopPropagation(); void openVstEditor(t); }} title={bridgeAvailable === false ? "Desktop VST3 editors are unavailable on this mobile device" : `Open ${t.vst3PluginName ?? "VST3"} editor`}>Open</YSButton>
												<YSButton disabled={bridgeAvailable === false || !!capturePending[t.id] || !dawHydrated || hydratedProjectId !== activeProjectId} className="h-7 px-2 py-0 rounded-md text-[9px] shrink-0 disabled:opacity-35" onClick={(e) => { e.stopPropagation(); void captureVstSound(t); }} title="Capture this track's current Bridge instrument sound into a local YSong snapshot and save its reference in the project">{capturePending[t.id] ? "Saving…" : "Save Instrument State"}</YSButton>
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
								{t.partGeneration?.origin === "create-song" && t.partGeneration.failure && (
									<div className="mt-1 text-[9px] text-amber-200 truncate" role="status" title={t.partGeneration.failure.message}>Needs retry: {t.partGeneration.failure.message}</div>
								)}
								{t.type === "instrument" && t.vst3PluginPath && (
									<div className="mt-1 text-[9px] opacity-75 truncate" role="status" title={vstSoundState[t.id]}>
										{bridgeAvailable === false ? "Bridge offline; saved instrument state cannot be restored or captured here." : vstSoundState[t.id] ?? (t.vstSnapshot
											? `Bridge snapshot ${t.vstSnapshot.id} referenced locally; current sound is unconfirmed.`
											: "No saved instrument state. Project saves do not capture VST changes.")}
									</div>
								)}

									<div className="w-full mt-1 flex items-center gap-2 min-w-0">
										<span className="text-[9px] opacity-55 shrink-0">Vol</span>
										<input type="range" min={0} max={127} step={1} value={clamp(t.level ?? 100, 0, 127)} onPointerDown={(e) => { e.stopPropagation(); setSelectedTrackId(t.id); setSelectedClipId(null); }} onChange={(e) => setTrackLevel(t.id, Number(e.target.value))} className="min-w-0 flex-1 h-3 accent-cyan-300 cursor-ew-resize" aria-label={`${t.name} level`} />
										<span className="w-7 text-right text-[9px] font-mono opacity-75 shrink-0">{clamp(t.level ?? 100, 0, 127)}</span>
									</div>

									<div className="w-full mt-1 h-1.5 rounded-full bg-white/10 overflow-hidden" title="Live track level">
										<div className="h-full rounded-full transition-[width] duration-75" style={{ width: `${Math.round(meter * 100)}%`, background: "linear-gradient(90deg, #34d399 0%, #facc15 72%, #fb7185 100%)" }} />
									</div>
									<div className="daw-lane-resize absolute left-0 right-0 bottom-0 h-[8px] cursor-ns-resize" onPointerDown={beginLaneResize(t.id)} onPointerMove={onLaneResizeMove} onPointerUp={endLaneResize} onPointerCancel={endLaneResize} title="Resize track height" />
								</div>
							);
						})}

						{trackPanelOpen && automationTrackId && tracks.some((track) => track.id === automationTrackId) && (() => {
							const track = tracks.find((item) => item.id === automationTrackId)!;
							const lane = track.automation?.find((item) => item.parameter === automationParameter);
							const currentValue = automationParameter === "track:level" ? track.level ?? 100 : automationParameter === "track:pan" ? normalizeMixerStrip(track.mixer).pan : track.effects?.find((effect) => `effect:${effect.id}:thresholdDb` === automationParameter && effect.type === "compressor")?.type === "compressor" ? (track.effects.find((effect) => `effect:${effect.id}:thresholdDb` === automationParameter) as DynamicsC1Effect).thresholdDb : -18;
							return <div className="p-2 border-b border-white/10 text-[11px] space-y-2" onPointerDown={(event) => event.stopPropagation()}>
							<div className="font-semibold truncate">Automation: {track.name}</div>
							<select aria-label="Automation parameter" className="w-full bg-neutral-900 border border-white/20 rounded p-1" value={automationParameter} onChange={(event) => setAutomationParameter(event.target.value as AutomationParameter)}>
								<option value="track:level">Track level</option><option value="track:pan">Track pan</option>{track.effects?.filter((effect) => effect.type === "compressor").map((effect) => <option key={effect.id} value={`effect:${effect.id}:thresholdDb`}>{effect.name} threshold</option>)}
							</select>
							<div className="flex gap-2 items-center">
								<label><input type="checkbox" checked={lane?.enabled ?? true} onChange={(event) => updateAutomationLane(track.id, automationParameter, (old) => ({ ...old, enabled: event.target.checked }))} /> Enabled</label>
								<select aria-label="Default automation interpolation" className="bg-neutral-900 border border-white/20 rounded" value={lane?.interpolation ?? "linear"} onChange={(event) => updateAutomationLane(track.id, automationParameter, (old) => ({ ...old, interpolation: event.target.value as "linear" | "step" }))}><option value="linear">Linear</option><option value="step">Hold</option><option value="curve">Curved</option></select>
							</div>
							<div className="flex gap-1">
								<button type="button" className="rounded border border-white/20 px-2 py-1" onClick={() => updateAutomationLane(track.id, automationParameter, (old) => ({ ...old, points: [...old.points.filter((point) => Math.abs(point.bar - playheadPosBars) > 0.0001), { id: crypto.randomUUID(), bar: playheadPosBars, value: clamp(automationValue(old, playheadPosBars, currentValue), ...automationValueBounds(automationParameter)) }].sort((a, b) => a.bar - b.bar) }))}>+ Point at playhead</button>
								<button type="button" className="rounded border border-white/20 px-2 py-1 disabled:opacity-40" disabled={!selectedAutomationPointIds.length} onClick={() => lane && copyAutomationPoints(lane)}>Copy selected</button>
								<button type="button" className="rounded border border-white/20 px-2 py-1 disabled:opacity-40" disabled={!automationClipboardRef.current?.length} onClick={() => pasteAutomationPoints(track.id, automationParameter, playheadPosBars)}>Paste at playhead</button>
							</div>
							{lane?.points.map((point) => { const [min, max] = automationValueBounds(automationParameter); return <div key={point.id} className={`flex gap-1 items-center ${selectedAutomationPointIds.includes(point.id) ? "bg-cyan-950/60" : ""}`}><input aria-label="Select automation point" type="checkbox" checked={selectedAutomationPointIds.includes(point.id)} onChange={(event) => setSelectedAutomationPointIds((selected) => event.target.checked ? [...selected, point.id] : selected.filter((id) => id !== point.id))} /><label>Bar <input aria-label="Point bar" type="number" min="1" step="0.01" className="w-14 bg-neutral-900 border border-white/20 rounded px-1" value={point.bar} onChange={(event) => updateAutomationLane(track.id, automationParameter, (old) => ({ ...old, points: old.points.map((item) => item.id === point.id ? { ...item, bar: Math.max(1, Number(event.target.value) || 1) } : item).sort((a, b) => a.bar - b.bar) }))} /></label><label>Value <input aria-label="Point value" type="number" min={min} max={max} step={automationParameter === "track:pan" ? 0.01 : 1} className="w-14 bg-neutral-900 border border-white/20 rounded px-1" value={point.value} onChange={(event) => { const value = Number(event.target.value); if (!Number.isFinite(value)) return; updateAutomationLane(track.id, automationParameter, (old) => ({ ...old, points: old.points.map((item) => item.id === point.id ? { ...item, value: clamp(value, min, max) } : item) })); }} /></label>{lane.points.findIndex((item) => item.id === point.id) > 0 && <select aria-label="Segment interpolation" className="bg-neutral-900 border border-white/20 rounded" value={lane.segmentModes?.[point.id] ?? lane.interpolation} onChange={(event) => updateAutomationLane(track.id, automationParameter, (old) => ({ ...old, segmentModes: { ...old.segmentModes, [point.id]: event.target.value as AutomationInterpolation } }))}><option value="linear">Linear</option><option value="step">Hold</option><option value="curve">Curved</option></select>}<button type="button" aria-label="Delete automation point" onClick={() => { updateAutomationLane(track.id, automationParameter, (old) => ({ ...old, points: old.points.filter((item) => item.id !== point.id) })); setSelectedAutomationPointIds((selected) => selected.filter((id) => id !== point.id)); }}>Delete</button></div>; })}
						</div>;
						})()}

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
						<div className="daw-timeline-toolbar h-12 px-2 py-1 flex items-center gap-2 overflow-x-auto whitespace-nowrap">
							<button type="button" className="daw-touch-mode" aria-pressed={touchEditMode} onClick={() => setTouchEditMode((value) => !value)} title="Switch between touch scrolling and clip editing">{touchEditMode ? "Edit clips" : "Scroll timeline"}</button>
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

							<YSButton
								disabled={vocalMidiBusy || !clips.some((clip) => clip.id === selectedClipId && !!clip.assetId)}
								className="ml-2 px-3 py-1 text-[11px] rounded-md disabled:opacity-30"
								onClick={() => void analyzeSelectedVocal()}
								title="Analyze the selected monophonic vocal clip and preview editable MIDI"
							>
								{vocalMidiBusy ? "Analyzing…" : "Vocal → MIDI"}
							</YSButton>
							<div className="ml-2 flex items-center gap-2 text-[10px] text-neutral-400" title="Adjust local pitch detection before analyzing">
								<label className="flex items-center gap-1">Sensitivity <input aria-label="Pitch sensitivity" type="range" min="50" max="95" step="1" value={vocalConfidence} onChange={(event) => setVocalConfidence(Number(event.target.value))} className="w-14 accent-cyan-400" /><span className="w-7 text-right">{vocalConfidence}%</span></label>
								<label className="flex items-center gap-1">Min note <select aria-label="Minimum note duration" value={vocalMinimumNoteMs} onChange={(event) => setVocalMinimumNoteMs(Number(event.target.value))} className="rounded border border-white/10 bg-neutral-900 px-1 py-0.5 text-neutral-200"><option value={50}>50 ms</option><option value={90}>90 ms</option><option value={140}>140 ms</option><option value={200}>200 ms</option></select></label>
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
						className="daw-timeline-scroll flex-1 min-h-0 overflow-auto"
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
										touchAction: touchEditMode ? "none" : "pan-x",
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
									touchAction: touchEditMode ? "none" : "pan-x",
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
									touchAction: touchEditMode ? "none" : "pan-x",
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
									touchAction: touchEditMode ? "none" : "pan-x",
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
										{automationTrackId === t.id && (() => {
											const lane = t.automation?.find((item) => item.parameter === automationParameter);
											if (!lane?.points.length) return null;
											const minimum = automationParameter === "track:level" ? 0 : automationParameter === "track:pan" ? -1 : -60;
											const range = automationParameter === "track:level" ? 127 : automationParameter === "track:pan" ? 2 : 60;
											const line = [{ bar: 1, value: lane.points[0].value }, ...lane.points, { bar: bars, value: lane.points[lane.points.length - 1].value }];
																			const y = (value: number) => (1 - (value - minimum) / range) * (trackH - 12) + 6;
																			const coordinates: string[] = [`${barToLeftPx(line[0].bar)},${y(line[0].value)}`];
																			for (let index = 1; index < line.length; index++) {
																				const previous = line[index - 1], point = line[index];
																				const mode = lane.segmentModes?.[lane.points.find((item) => Math.abs(item.bar - point.bar) < 0.0001)?.id ?? ""] ?? lane.interpolation;
																				if (mode === "step") coordinates.push(`${barToLeftPx(point.bar)},${y(previous.value)}`, `${barToLeftPx(point.bar)},${y(point.value)}`);
																				else if (mode === "curve") for (let step = 1; step <= 12; step++) { const t = step / 12, eased = t * t * (3 - 2 * t); coordinates.push(`${barToLeftPx(previous.bar + (point.bar - previous.bar) * t)},${y(previous.value + (point.value - previous.value) * eased)}`); }
																				else coordinates.push(`${barToLeftPx(point.bar)},${y(point.value)}`);
																			}
																			const selected = new Set(selectedAutomationPointIds);
																			return <svg aria-label={`${t.name} ${automationParameter} automation lane`} className={`absolute inset-0 z-30 pointer-events-none ${lane.enabled ? "opacity-90" : "opacity-35"}`} width={Math.max(1, bars * barWidth)} height={trackH}>
																			<polyline points={coordinates.join(" ")} fill="none" stroke="#67e8f9" strokeWidth="2" />
																			{lane.points.map((point) => <circle key={point.id} cx={barToLeftPx(point.bar)} cy={y(point.value)} r={selected.has(point.id) ? "5" : "4"} fill={selected.has(point.id) ? "#facc15" : "#67e8f9"} stroke="#082f49" strokeWidth="1" />)}
										</svg>;
										})()}
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
														touchAction: touchEditMode ? "none" : "pan-x pan-y",
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
											{c.assetId && normalizeWarpMarkers(c.warpMarkers, sourceDurationSec, c.lengthBars).map((marker, index) => (
												<div key={`${marker.sourceSec}:${index}`} className="absolute top-0 bottom-0 border-l border-amber-200/90 pointer-events-none z-[22]" style={{ left: `${marker.atBar / c.lengthBars * 100}%` }} title={`Warp ${marker.sourceSec.toFixed(2)}s → ${marker.atBar.toFixed(2)} bars`} />
											))}
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
													className="daw-clip-handle absolute top-0 z-50 w-6 h-6 -translate-x-1/2 rounded-b bg-white/85 shadow cursor-ew-resize opacity-80 group-hover:opacity-100"
																style={{ left: `${fadeInPct}%` }}
																onPointerDown={beginClipFade(c.id, "fadeIn")}
																title="Fade in (drag; ALT bypasses snap)"
															/>
															<div
													className="daw-clip-handle absolute top-0 z-50 w-6 h-6 translate-x-1/2 rounded-b bg-white/85 shadow cursor-ew-resize opacity-80 group-hover:opacity-100"
																style={{ right: `${fadeOutPct}%` }}
																onPointerDown={beginClipFade(c.id, "fadeOut")}
																title="Fade out (drag; ALT bypasses snap)"
															/>

															{/* Thin full-height right edge = trim. */}
															<div
													className={`daw-clip-handle absolute top-0 right-0 h-full w-[9px] z-40 cursor-ew-resize transition-opacity ${isSelected ? "opacity-70" : "opacity-0 group-hover:opacity-70"}`}
																onPointerDown={beginClipResizeR(c.id)}
																title="Trim source boundary (does NOT change stretch ratio; ALT bypasses snap)"
																style={{ background: "linear-gradient(to left, rgba(255,255,255,0.30), rgba(255,255,255,0))" }}
															/>

															{/* Bottom-right grip = time stretch, preserving pitch. */}
															<div
													className={`daw-clip-handle absolute bottom-1 right-1 z-[60] h-5 min-w-5 px-1 rounded bg-fuchsia-950/90 border border-fuchsia-200/60 text-fuchsia-50 text-[10px] leading-[18px] text-center cursor-ew-resize transition-opacity ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
																onPointerDown={beginClipStretchR(c.id)}
																title="Time stretch / preserve pitch (25%-400%). Use this ↔ grip; the thin right edge is Trim."
															>↔</div>
														</>
													)}
													{isMidiClip && (
														<>
															<div
													className="daw-clip-handle absolute top-0 right-0 h-full w-[8px] z-40 cursor-ew-resize opacity-0 group-hover:opacity-100"
																onPointerDown={beginClipResizeR(c.id)}
																title="Resize MIDI clip"
																style={{ background: "linear-gradient(to left, rgba(255,255,255,0.18), rgba(255,255,255,0))" }}
															/>
															<button
																type="button"
													className="daw-clip-handle absolute bottom-1 right-2 z-[60] h-5 px-1.5 rounded bg-violet-950/85 border border-violet-200/40 text-violet-50 text-[10px] opacity-0 group-hover:opacity-100"
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
											className="daw-lane-resize absolute left-0 right-0 bottom-0 h-[8px] cursor-ns-resize z-20"
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
				<DawAgentPanel open={dawAgentOpen} onClose={() => setDawAgentOpen(false)} onReviewProposal={(proposal: DawAgentProposal) => {
					setDawAgentOpen(false);
					setAiComposerOpen(false); setSoundDesignerOpen(false); setInstrumentCatalogOpen(false); setProgressiveStemOpen(false);
					if (proposal.kind === "fx-plan") {
						const track = tracks.find((item) => item.id === proposal.trackId);
						if (!track) return;
						const plan = normalizeFxChainPlan(proposal.plan, proposal.plan.intent, { browserEffectsAvailable: !trackUsesNativeVst(track), source: "ai" });
						if (!plan.devices.length) return;
						setAgentFxPlan({ trackId: track.id, plan }); setFxChainTrackId(track.id); setFxEditorEffectId(null);
					} else if (proposal.kind === "arrangement") {
						setAgentArrangement({ summary: proposal.summary, suggestion: proposal.suggestion }); setAiComposerOpen(true);
					} else {
						setSelectedTrackId(proposal.trackId); setAgentSoundIntent(proposal.intent); setSoundDesignerOpen(true);
					}
				}} />
			</div>
			</div>

			<InstrumentCatalogPanel
				open={instrumentCatalogOpen}
				onClose={() => setInstrumentCatalogOpen(false)}
				selectedTrack={selectedTrackId ? tracks.find((track) => track.id === selectedTrackId) ?? null : null}
				transportPlaying={isPlaying}
				onAssignInstrument={assignInstrumentFromCatalog}
			/>

			<AiSoundDesignerPanel
				open={soundDesignerOpen}
				onClose={() => { setSoundDesignerOpen(false); setAgentSoundIntent(""); }}
				selectedTrack={selectedTrackId ? tracks.find((track) => track.id === selectedTrackId) ?? null : null}
				transportPlaying={isPlaying}
				bpm={bpm}
				sigNum={sigNum}
				sigDen={sigDen}
				projectSummary={soundDesignerProjectSummary}
				initialIntent={agentSoundIntent}
				initialKeyLabel={soundDesignerKeyLabel}
				midiSource={composerProjectContext.source ?? null}
				onAssignInstrument={assignInstrumentFromCatalog}
			/>

			<ProgressiveStemComposerPanel
				key={activeProjectId}
				open={progressiveStemOpen}
				onClose={() => setProgressiveStemOpen(false)}
				seed={progressiveStemSeed}
				state={progressiveStemState}
				onStateChange={setProgressiveStemState}
				dependencySources={progressiveDependencySources}
				selectedPart={selectedPart}
				onAccept={acceptProgressiveStemProposal}
			/>

			<AiComposerPanel
				key={activeProjectId}
				open={aiComposerOpen}
				onClose={() => { setAiComposerOpen(false); setAgentArrangement(null); }}
				project={composerProjectContext}
				bpm={bpm}
				sigNum={sigNum}
				sigDen={sigDen}
				totalBars={Math.max(4, Math.round(endBar - 1))}
				playheadBar={playheadPosBars}
				selectedPart={selectedPart}
				onAccept={acceptComposerProposal}
				onArrangementApproved={setApprovedComposerArrangement}
				initialSuggestion={agentArrangement}
			/>

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
					onBpmChange={changeBpm}
					onSignatureChange={changeSignature}
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
				const top = Math.min(clipContextMenu.y, Math.max(8, window.innerHeight - 290));
				return createPortal(
					<div
						className="fixed w-[220px] rounded-xl border border-white/15 bg-neutral-950/95 shadow-2xl backdrop-blur overflow-hidden text-sm"
						style={{ left, top, zIndex: 10000 }}
						onPointerDown={(e) => e.stopPropagation()}
					>
						{menuTrack?.type === "instrument" && (
							<button className="w-full text-left px-3 py-2 hover:bg-violet-400/10" onClick={() => { setMidiEditorClipId(clipContextMenu.clipId); setClipContextMenu(null); }}>♬ Edit MIDI</button>
						)}
						{menuClip?.assetId && <button className="w-full text-left px-3 py-2 hover:bg-white/10" onClick={() => crossfadeIntoNextClip(menuClip.id)}>Crossfade into next clip</button>}
						{menuClip?.assetId && <div className="px-3 py-2 border-y border-white/10 text-xs space-y-2">
							<div>Takes ({(menuClip.takes ?? []).length + 1}/{MAX_DAW_TAKES + 1})</div>
							<select aria-label="Add project audio as take" className="w-full bg-neutral-900" value="" disabled={(menuClip.takes ?? []).length >= MAX_DAW_TAKES} onChange={(event) => {
								const asset = projectAssets.find((item) => item.id === event.target.value);
								if (!asset) return;
								setClips((current) => current.map((clip) => clip.id === menuClip.id && (clip.takes ?? []).length < MAX_DAW_TAKES ? { ...clip, takes: [...(clip.takes ?? []), { id: crypto.randomUUID(), name: asset.name, assetId: asset.id }] } : clip));
							}}><option value="">Add project audio as take…</option>{projectAssets.filter((asset) => asset.kind === "audio" && asset.id !== menuClip.assetId).map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select>
							{(menuClip.takes ?? []).map((take) => <div key={take.id} className="flex gap-1 items-center"><span className="truncate flex-1">{take.name}</span><button aria-label={`Comp loop range from ${take.name}`} onClick={() => {
								const startBar = Math.max(0, loopL - menuClip.startBar);
								const endBar = Math.min(menuClip.lengthBars, loopR - menuClip.startBar);
								if (endBar <= startBar) return;
								setClips((current) => current.map((clip) => clip.id === menuClip.id ? { ...clip, compRanges: addCompRange(clip.compRanges, { startBar, endBar, takeId: take.id }, clip.lengthBars, clip.takes ?? []) } : clip));
								stretchedBuffersRef.current.delete(menuClip.id);
							}}>Use L–R</button><button aria-label={`Remove take ${take.name}`} onClick={() => setClips((current) => current.map((clip) => clip.id === menuClip.id ? { ...clip, takes: clip.takes?.filter((item) => item.id !== take.id), compRanges: clip.compRanges?.filter((range) => range.takeId !== take.id) } : clip))}>×</button></div>)}
							{normalizeCompRanges(menuClip.compRanges, menuClip.lengthBars, menuClip.takes ?? []).map((range, index) => <div key={index} className="flex gap-1"><span className="flex-1">{range.startBar.toFixed(2)}–{range.endBar.toFixed(2)}: {menuClip.takes?.find((take) => take.id === range.takeId)?.name}</span><button aria-label={`Remove comp range ${index + 1}`} onClick={() => setClips((current) => current.map((clip) => clip.id === menuClip.id ? { ...clip, compRanges: clip.compRanges?.filter((_, at) => at !== index) } : clip))}>×</button></div>)}
						</div>}
						{menuClip?.assetId && <button className="w-full text-left px-3 py-2 hover:bg-white/10" onClick={() => { void detectClipWarpMarkers(menuClip); setClipContextMenu(null); }}>Detect warp markers</button>}
						{menuClip?.assetId && <button className="w-full text-left px-3 py-2 hover:bg-white/10" onClick={() => {
							const sourceSec = Math.max(0.001, menuClip.sourceDurationSec ?? menuClip.lengthBars * getBarSeconds());
							const atBar = applySnap(menuClip.startBar + menuClip.lengthBars / 2) - menuClip.startBar;
							setClips((current) => current.map((clip) => clip.id === menuClip.id ? { ...clip, warpMarkers: normalizeWarpMarkers([...(clip.warpMarkers ?? []), { sourceSec: sourceSec / 2, atBar }], sourceSec, clip.lengthBars) } : clip));
							setClipContextMenu(null);
						}}>Add warp marker at midpoint</button>}
						{menuClip?.assetId && (menuClip.warpMarkers?.length ?? 0) > 0 && <div className="px-3 py-1 max-h-40 overflow-y-auto text-xs">{menuClip.warpMarkers?.map((marker, index) => <label key={index} className="flex items-center gap-1 py-1">{marker.sourceSec.toFixed(2)}s →
							<input aria-label={`Warp marker ${index + 1} bar`} type="number" step={stepBars} min="0" max={menuClip.lengthBars} className="w-16 bg-neutral-900 border border-white/20 rounded" value={marker.atBar} onChange={(event) => {
								const sourceSec = Math.max(0.001, menuClip.sourceDurationSec ?? menuClip.lengthBars * getBarSeconds());
								const next = [...(menuClip.warpMarkers ?? [])]; next[index] = { ...marker, atBar: applySnap(menuClip.startBar + Number(event.target.value)) - menuClip.startBar };
								setClips((current) => current.map((clip) => clip.id === menuClip.id ? { ...clip, warpMarkers: normalizeWarpMarkers(next, sourceSec, clip.lengthBars) } : clip));
							}} /> bars <button aria-label={`Remove warp marker ${index + 1}`} onClick={() => setClips((current) => current.map((clip) => clip.id === menuClip.id ? { ...clip, warpMarkers: clip.warpMarkers?.filter((_, i) => i !== index) } : clip))}>×</button></label>)}</div>}
						{menuClip?.assetId && (() => {
							const sourceSec = Math.max(0.001, menuClip.sourceDurationSec ?? menuClip.lengthBars * getBarSeconds());
							const timeRatio = menuClip.lengthBars * getBarSeconds() / sourceSec;
							return <div className="px-3 py-2 border-y border-white/10 text-xs space-y-1">
								<div>Audio clip · source: {findAssetById(menuClip.assetId)?.name ?? menuClip.name}</div>
								<div>Time: {Math.round(timeRatio * 100)}%</div>
								<label className="flex items-center justify-between gap-2">Time / pitch
									<select aria-label="Clip time and pitch mode" className="bg-neutral-900 border border-white/20 rounded px-1 py-0.5" value={menuClip.timePitchMode ?? "independent"} onChange={(event) => {
										setClips((current) => current.map((clip) => clip.id === menuClip.id ? { ...clip, timePitchMode: event.target.value as "linked" | "independent" } : clip));
										stretchedBuffersRef.current.delete(menuClip.id);
										if (isPlaying) { stop(); requestAnimationFrame(() => start(loopEnabled)); }
									}}><option value="independent">Independent</option><option value="linked">Linked</option></select>
								</label>
								<div className="opacity-60">{menuClip.timePitchMode === "linked" ? "Speed changes pitch with time." : "Time stretch preserves pitch; shift pitch separately."}</div>
								{menuClip.timePitchMode !== "linked" && <>
								<label className="flex items-center justify-between gap-2">Pitch (independent)
									<select aria-label="Clip pitch semitones" className="bg-neutral-900 border border-white/20 rounded px-1 py-0.5" value={menuClip.pitchSemitones ?? 0} onChange={(event) => {
										const pitchSemitones = Number(event.target.value);
										setClips((current) => current.map((clip) => clip.id === menuClip.id ? { ...clip, pitchSemitones } : clip));
										stretchedBuffersRef.current.delete(menuClip.id);
										if (isPlaying) { stop(); requestAnimationFrame(() => start(loopEnabled)); }
									}}>
										{Array.from({ length: 25 }, (_, index) => index - 12).filter((semitones) => {
											const combined = timeRatio * 2 ** (semitones / 12);
											return combined >= 0.25 && combined <= 4;
										}).map((semitones) => <option key={semitones} value={semitones}>{semitones > 0 ? `+${semitones}` : semitones} st</option>)}
									</select>
								</label>
								</>}
							</div>;
						})()}
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
					onSeekProjectBar={(bar) => seekTransport(bar)}
					onReturnStart={() => seekTransport(1)}
					onStop={() => { stop(); setPlayheadPosBars(1); }}
					onTogglePlay={togglePlay}
					onToggleLoop={toggleLoopPlayback}
					onJumpEnd={() => seekTransport(endBar)}
					onBpmChange={changeBpm}
					onSignatureChange={changeSignature}
					onClose={() => setMidiEditorClipId(null)}
				/>
			)}


			{fxChainTrack && createPortal(
				<FxChainPanel
					key={fxChainTrack.id}
					trackName={fxChainTrack.name}
					instrument={fxChainTrack.type === "instrument" ? {
						name: fxChainTrack.vst3PluginName ?? GM_PROGRAMS.find((program) => program.program === normalizeGmProgram(fxChainTrack.gmProgram ?? 0))?.label ?? "General MIDI instrument",
						vendor: fxChainTrack.vst3PluginVendor,
						presetHint: fxChainTrack.vstPresetHint,
						hasSnapshot: !!fxChainTrack.vstSnapshot,
						stateStatus: fxChainTrack.vst3PluginPath ? (vstSoundState[fxChainTrack.id] ?? undefined) : "General MIDI patch · state follows the project instrument assignment",
						canCapture: !!fxChainTrack.vst3PluginPath && bridgeAvailable !== false && dawHydrated && hydratedProjectId === activeProjectId,
						capturePending: !!capturePending[fxChainTrack.id],
						onCapture: () => void captureVstSound(fxChainTrack),
					} : undefined}
					effects={fxChainTrack.effects ?? []}
					browserEffectsAvailable={!trackUsesNativeVst(fxChainTrack)}
					initialPlan={agentFxPlan?.trackId === fxChainTrack.id ? agentFxPlan.plan : null}
					onAddCompressor={() => addDynamicsC1(fxChainTrack.id)}
					onAddBrowserEffect={(type) => addBrowserEffect(fxChainTrack.id, type)}
					onToggle={(effectId) => toggleTrackEffect(fxChainTrack.id, effectId)}
					onRemove={(effectId) => removeTrackEffect(fxChainTrack.id, effectId)}
					onOpen={(effectId) => setFxEditorEffectId(effectId)}
					onReorder={(from, to) => reorderTrackEffect(fxChainTrack.id, from, to)}
					onPlan={(intent) => requestFxChainPlan(fxChainTrack, intent)}
					onApplyPlan={(plan) => applyFxChainPlan(fxChainTrack, plan)}
					onClose={() => { setFxChainTrackId(null); setFxEditorEffectId(null); setAgentFxPlan(null); }}
				/>,
				document.body,
			)}

			{fxChainTrack && fxEditorEffect?.type === "compressor" && createPortal(
				<DynamicsC1Editor
					effect={fxEditorEffect}
					signal={trackMeters[fxChainTrack.id] ?? 0}
					gainReductionDb={fxEditorGainReductionDb}
					onChange={(patch) => updateTrackEffect(fxChainTrack.id, fxEditorEffect.id, patch)}
					onClose={() => setFxEditorEffectId(null)}
				/>,
				document.body,
			)}

			{fxChainTrack && fxEditorEffect && fxEditorEffect.type !== "compressor" && !trackUsesNativeVst(fxChainTrack) && createPortal(
				<BrowserEffectEditor
					effect={fxEditorEffect}
					onChange={(patch) => updateTrackEffect(fxChainTrack.id, fxEditorEffect.id, patch)}
					onClose={() => setFxEditorEffectId(null)}
				/>,
				document.body,
			)}

			{exportOpen &&
				createPortal(
					<div
						className="fixed inset-0 z-[220] flex items-end sm:items-center justify-center"
						role="dialog"
						aria-modal="true"
						onMouseDown={(e) => { if (!exporting && e.target === e.currentTarget) setExportOpen(false); }}
					>
						<div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
						<div className="relative w-full sm:w-[520px] max-w-[95vw] bg-neutral-950/95 border border-neutral-200/15 dark:border-neutral-800 rounded-2xl shadow-2xl p-4 sm:p-5">
							<div className="flex items-center justify-between gap-3">
								<div>
									<div className="text-sm font-semibold tracking-wide">Export Song</div>
									<div className="text-[11px] opacity-55 mt-0.5">Full composition • measure 001 → E</div>
								</div>
								<YSButton disabled={exporting} className="px-2 py-1 rounded-md disabled:opacity-40" onClick={() => setExportOpen(false)}>Close</YSButton>
							</div>

							<div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
								<label className="text-[11px] uppercase tracking-wide opacity-70">
									Format
									<select
										value={exportFormat}
										disabled={exporting}
										onChange={(e) => { setExportFormat(e.target.value as ExportFormat); setExportStatus(""); }}
										className="mt-1 w-full h-9 bg-neutral-950/70 border border-white/15 rounded-lg px-2 text-sm normal-case tracking-normal"
									>
										<option value="wav16">WAV • 16-bit PCM</option>
										<option value="wav24">WAV • 24-bit PCM</option>
										<option value="flac">FLAC • Lossless</option>
										<option value="mp3">MP3</option>
										<option value="midi">MIDI (.mid)</option>
									</select>
								</label>

								{exportFormat === "mp3" ? (
									<label className="text-[11px] uppercase tracking-wide opacity-70">
										Bitrate
										<select
											value={exportMp3Bitrate}
											disabled={exporting}
											onChange={(e) => setExportMp3Bitrate(Number(e.target.value))}
											className="mt-1 w-full h-9 bg-neutral-950/70 border border-white/15 rounded-lg px-2 text-sm normal-case tracking-normal"
										>
											{[64, 96, 128, 160, 192, 256, 320].map((rate) => <option key={rate} value={rate}>{rate} kbps</option>)}
										</select>
									</label>
								) : exportFormat !== "midi" ? (
									<div className="text-[11px] uppercase tracking-wide opacity-70">
										Sample Rate
										<div className="mt-1 h-9 flex items-center px-3 rounded-lg border border-white/10 bg-neutral-950/40 text-sm normal-case tracking-normal opacity-80">48 kHz</div>
									</div>
								) : (
									<div className="text-[11px] uppercase tracking-wide opacity-70">
										Contents
										<div className="mt-1 h-9 flex items-center px-3 rounded-lg border border-white/10 bg-neutral-950/40 text-sm normal-case tracking-normal opacity-80">MIDI tracks only</div>
									</div>
								)}
							</div>

							<div className="mt-4 rounded-xl border border-white/10 bg-white/[0.025] p-3 text-[12px] leading-relaxed opacity-75">
								{exportFormat === "midi"
									? "Exports notes, velocity, tempo, time signature, modulation and pitch bend. Audio clips and VST audio are skipped."
									: "YSong renders the complete timeline from 001 to E: audio clips, General MIDI, active VST3 instruments, and each track’s ordered effects chain mixed into one master."}
							</div>

							{exportStatus && (
								<div className={`mt-3 rounded-lg border px-3 py-2 text-[12px] ${/failed|error|missing|cannot|could not/i.test(exportStatus) ? "border-rose-400/30 bg-rose-400/10 text-rose-100" : "border-cyan-300/20 bg-cyan-300/5"}`}>
									<div className="flex items-center gap-2">
										{exporting && <span className="inline-block h-3.5 w-3.5 rounded-full border border-cyan-200/30 border-t-cyan-200 animate-spin shrink-0" />}
										<span>{exportStatus}</span>
									</div>
								</div>
							)}

							<div className="mt-5 flex items-center justify-end gap-2">
								<YSButton disabled={exporting} className="px-3 py-2 rounded-xl disabled:opacity-40" onClick={() => setExportOpen(false)}>Cancel</YSButton>
								<YSButton disabled={exporting} className="px-4 py-2 rounded-xl font-semibold disabled:opacity-50" onClick={() => void runMasterExport()}>
									{exporting ? "Rendering…" : "Export"}
								</YSButton>
							</div>
						</div>
					</div>,
					document.body,
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
									<span className={saveError ? "text-red-300" : ""} title={saveError || undefined}>{saveState}</span>
									<span className="opacity-40">•</span>
									<span className="opacity-60">{activeProjectId.slice(0, 8)}</span>
								</div>
								{saveError && <div className="mt-1 text-xs text-red-300">Local save failed: {saveError}</div>}
								<YSButton className="mt-2 px-3 py-1 rounded-lg text-xs" disabled={!dawHydrated || hydratedProjectId !== activeProjectId} onClick={() => { setIsSavingUi(true); persistCurrentProject(); setIsSavingUi(false); }}>Save locally</YSButton>
								<p className="mt-2 text-[11px] opacity-65">Save locally stores the project only. Use Save Instrument State on each VST track to capture its live sound. Snapshot payloads stay in Bridge on this machine and user profile; .ysong files carry only their references.</p>
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
													onClick={() => requestOpenLocalProject(p.id)}
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
								{switchError && <div className="mt-2 text-xs text-red-300" role="alert">{switchError}</div>}
							</div>
						</div>
					</div>,
					document.body,
				)}
			{pendingProjectId && createPortal(
				<div className="fixed inset-0 z-[210] flex items-end sm:items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Open local project">
					<div className="w-full max-w-md rounded-2xl border border-white/20 bg-neutral-950 p-5 shadow-2xl">
						<div className="text-base font-semibold">Open another project?</div>
						<p className="mt-2 text-sm opacity-80">Current changes are not confirmed saved locally. Earlier autosaves may already be stored. Opening without saving skips only the final save.</p>
						{saveError && <p className="mt-2 text-xs text-red-300" role="alert">Local save failed: {saveError}</p>}
						<div className="mt-5 flex flex-wrap justify-end gap-2">
							<YSButton className="px-3 py-2 rounded-lg" onClick={() => { setPendingProjectId(null); setSwitchError(null); }}>Cancel</YSButton>
							<YSButton className="px-3 py-2 rounded-lg" onClick={() => confirmOpenLocalProject(false)}>Open Without Saving</YSButton>
							<YSButton className="px-3 py-2 rounded-lg" onClick={() => confirmOpenLocalProject(true)}>Save and Open</YSButton>
						</div>
					</div>
				</div>, document.body)}
		</div>
	);
}
