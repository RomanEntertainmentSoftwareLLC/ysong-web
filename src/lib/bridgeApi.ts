// In local Vite development, route Bridge calls through the same-origin
// /bridge proxy. That avoids browser CORS/Local Network Access restrictions
// around direct cross-origin loopback fetches. A production build still talks
// directly to the user's native Bridge unless VITE_BRIDGE_URL overrides it.
const configuredBridgeBase = (import.meta.env.VITE_BRIDGE_URL as string | undefined)?.trim();
const BRIDGE_BASE = configuredBridgeBase || (import.meta.env.DEV ? "/bridge" : "http://127.0.0.1:39451");

export type BridgeHealth = {
	ok: boolean;
	name: string;
	version: string;
	machineName: string;
	pluginPathCount: number;
	audioDriverType?: "ASIO" | "WASAPI" | "DirectSound" | "MME";
	selectedAudioDevice?: string | null;
	trayApp?: boolean;
	vst3ProbeReady?: boolean;
	vst3ProbeHelperPath?: string;
	midiInputCount?: number;
	enabledMidiInputCount?: number;
	midiRouteTrackId?: string | null;
	midiRouteInputName?: string | null;
};

export type BridgePlugin = {
	name: string;
	path: string;
	format: "VST3";
	kind?: "instrument" | "effect" | "unknown" | "failed" | "crashed" | "probe-missing";
	vendor?: string | null;
	version?: string | null;
	category?: string | null;
	subCategories?: string | null;
	loadable?: boolean;
	error?: string | null;
};

export type Vst3MidiEvent = {
	kind: "on" | "off";
	note: number;
	velocity: number;
	whenUnixMs: number;
	noteId: number;
	channel?: number;
};



export type Vst3OfflineRenderEvent = {
	kind: "on" | "off";
	note: number;
	velocity: number;
	atSeconds: number;
	noteId: number;
	channel?: number;
};

export type Vst3OfflineRenderTrack = {
	trackId: string;
	events: Vst3OfflineRenderEvent[];
};


export type Vst3TrackEffect = {
	id: string;
	type: "compressor";
	enabled: boolean;
	inputGainDb: number;
	thresholdDb: number;
	ratio: number;
	attackMs: number;
	releaseMs: number;
	kneeDb: number;
	outputGainDb: number;
};

export type BridgeMidiInputDevice = {
	index: number;
	name: string;
	enabled: boolean;
	master: boolean;
};

export type BridgeMidiEvent = {
	kind: "noteon" | "noteoff" | "cc";
	device: string;
	deviceIndex: number;
	channel: number;
	note?: number | null;
	velocity?: number | null;
	controller?: number | null;
	value?: number | null;
	whenUnixMs: number;
};

export type BridgeMidiSettings = {
	devices: BridgeMidiInputDevice[];
	enabledInputs: string[];
	masterMode: "SelectedTrack" | "Separate";
	masterInputName?: string | null;
	routeTrackId?: string | null;
	routeInputName?: string | null;
};

export type Vst3InstanceStatus = {
	trackId: string;
	pluginName: string;
	pluginPath: string;
	peak: number;
	muted: boolean;
	level: number;
	gainReductionDb?: number;
	error?: string | null;
};

export class BridgeRequestError extends Error {
	status?: number;
	constructor(message: string, status?: number) {
		super(message);
		this.name = "BridgeRequestError";
		this.status = status;
	}
}

async function bridgeFetch<T>(path: string, init?: RequestInit, timeoutMs = 1800): Promise<T> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(`${BRIDGE_BASE}${path}`, {
			...init,
			signal: controller.signal,
			headers: {
				// Do not force application/json onto bodyless GET requests. Besides
				// being unnecessary, that turns a simple GET into a CORS preflight.
				...(init?.body != null ? { "Content-Type": "application/json" } : {}),
				...(init?.headers || {}),
			},
		});
		if (!res.ok) {
			let detail = "";
			try {
				const body = await res.json() as { detail?: string; title?: string };
				detail = body.detail || body.title || "";
			} catch {
				try { detail = await res.text(); } catch { /* ignore */ }
			}
			throw new BridgeRequestError(detail || `YSong Bridge returned HTTP ${res.status}.`, res.status);
		}
		return (await res.json()) as T;
	} catch (error) {
		if (error instanceof BridgeRequestError) throw error;
		if (error instanceof DOMException && error.name === "AbortError") {
			throw new BridgeRequestError(`YSong Bridge request timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
		}
		throw new BridgeRequestError(error instanceof Error ? error.message : "Could not reach YSong Bridge.");
	} finally {
		clearTimeout(timer);
	}
}


async function bridgeFetchArrayBuffer(path: string, init?: RequestInit, timeoutMs = 120000): Promise<ArrayBuffer> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(`${BRIDGE_BASE}${path}`, { ...init, signal: controller.signal });
		if (!res.ok) {
			let detail = "";
			try {
				const body = await res.json() as { detail?: string; title?: string };
				detail = body.detail || body.title || "";
			} catch {
				try { detail = await res.text(); } catch { /* ignore */ }
			}
			throw new BridgeRequestError(detail || `YSong Bridge returned HTTP ${res.status}.`, res.status);
		}
		return await res.arrayBuffer();
	} catch (error) {
		if (error instanceof BridgeRequestError) throw error;
		if (error instanceof DOMException && error.name === "AbortError") throw new BridgeRequestError("YSong Bridge export request timed out.");
		throw new BridgeRequestError(error instanceof Error ? error.message : "Could not reach YSong Bridge.");
	} finally {
		clearTimeout(timer);
	}
}

async function bridgePostAudioForEncode(wav: Blob, format: "flac" | "mp3", bitrateKbps?: number): Promise<Blob> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 300000);
	try {
		const qs = new URLSearchParams({ format });
		if (format === "mp3" && bitrateKbps) qs.set("bitrateKbps", String(bitrateKbps));
		const res = await fetch(`${BRIDGE_BASE}/audio/encode?${qs.toString()}`, {
			method: "POST",
			body: wav,
			headers: { "Content-Type": "audio/wav" },
			signal: controller.signal,
		});
		if (!res.ok) {
			let detail = "";
			try {
				const body = await res.json() as { detail?: string; title?: string };
				detail = body.detail || body.title || "";
			} catch { try { detail = await res.text(); } catch { /* ignore */ } }
			throw new BridgeRequestError(detail || `YSong Bridge returned HTTP ${res.status}.`, res.status);
		}
		return await res.blob();
	} catch (error) {
		if (error instanceof BridgeRequestError) throw error;
		if (error instanceof DOMException && error.name === "AbortError") throw new BridgeRequestError("YSong Bridge encoder timed out.");
		throw new BridgeRequestError(error instanceof Error ? error.message : "Could not reach YSong Bridge encoder.");
	} finally {
		clearTimeout(timer);
	}
}

export const bridgeApi = {
	health: () => bridgeFetch<BridgeHealth>("/health"),
	getPluginPaths: () => bridgeFetch<{ paths: string[] }>("/settings/plugin-paths"),
	setPluginPaths: (paths: string[]) =>
		bridgeFetch<{ ok: true; paths: string[] }>("/settings/plugin-paths", {
			method: "PUT",
			body: JSON.stringify({ paths }),
		}, 10000),
	addPluginPath: (path: string) =>
		bridgeFetch<{ ok: true; paths: string[] }>("/settings/plugin-paths/add", {
			method: "POST",
			body: JSON.stringify({ path }),
		}, 10000),
	removePluginPath: (path: string) =>
		bridgeFetch<{ ok: true; paths: string[] }>("/settings/plugin-paths/remove", {
			method: "POST",
			body: JSON.stringify({ path }),
		}, 10000),
	scanPlugins: () =>
		bridgeFetch<{ ok: true; plugins: BridgePlugin[]; scannedPaths: string[] }>(
			"/plugins/scan",
			{ method: "POST", body: "{}" },
			300000
		),
	getPlugins: () => bridgeFetch<{ ok: true; plugins: BridgePlugin[] }>("/plugins", undefined, 10000),
	loadVst3Instrument: (trackId: string, path: string) =>
		bridgeFetch<{ ok: true; trackId: string; plugin: { name: string; path: string; vendor?: string | null; version?: string | null; hasEditor?: boolean }; sampleRate: number; blockSize: number }>(
			"/vst3/load",
			{ method: "POST", body: JSON.stringify({ trackId, path }) },
			30000,
		),
	unloadVst3Instrument: (trackId: string) =>
		bridgeFetch<{ ok: true; removed: boolean }>("/vst3/unload", { method: "POST", body: JSON.stringify({ trackId }) }, 10000),
	unloadAllVst3: () => bridgeFetch<{ ok: true }>("/vst3/unload-all", { method: "POST", body: "{}" }, 10000),
	scheduleVst3Midi: (trackId: string, events: Vst3MidiEvent[]) =>
		bridgeFetch<{ ok: true; queued: number; loaded?: boolean }>("/vst3/schedule", { method: "POST", body: JSON.stringify({ trackId, events }) }, 10000),
	setVst3Mixer: (trackId: string, muted: boolean, level: number, channel?: {
		inputGainDb?: number; phaseInvert?: boolean; hpfEnabled?: boolean; hpfHz?: number; lpfEnabled?: boolean; lpfHz?: number;
		eqEnabled?: boolean; lowGainDb?: number; lowFreqHz?: number; lowMidGainDb?: number; lowMidFreqHz?: number; lowMidQ?: number;
		highMidGainDb?: number; highMidFreqHz?: number; highMidQ?: number; highGainDb?: number; highFreqHz?: number;
		compressorEnabled?: boolean; compressorThresholdDb?: number; compressorRatio?: number; compressorAttackMs?: number; compressorReleaseMs?: number;
		pan?: number; width?: number;
	}) =>
		bridgeFetch<{ ok: true; loaded?: boolean }>("/vst3/mixer", { method: "POST", body: JSON.stringify({ trackId, muted, level, ...(channel ?? {}) }) }, 5000),
	setVst3Master: (level: number) =>
		bridgeFetch<{ ok: true }>("/vst3/master", { method: "POST", body: JSON.stringify({ level }) }, 5000),
	setVst3Effects: (trackId: string, effects: Vst3TrackEffect[]) =>
		bridgeFetch<{ ok: true; loaded?: boolean }>("/vst3/effects", { method: "POST", body: JSON.stringify({ trackId, effects }) }, 5000),
	stopVst3: () => bridgeFetch<{ ok: true }>("/vst3/stop", { method: "POST", body: "{}" }, 5000),
	getVst3Status: () => bridgeFetch<{ ok: true; instances: Vst3InstanceStatus[] }>("/vst3/status", undefined, 5000),
	renderVst3Mix: (durationSeconds: number, tracks: Vst3OfflineRenderTrack[]) =>
		bridgeFetchArrayBuffer("/vst3/render-mix", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ durationSeconds, tracks }),
		}, 300000),
	encodeAudio: (wav: Blob, format: "flac" | "mp3", bitrateKbps?: number) => bridgePostAudioForEncode(wav, format, bitrateKbps),
	openVst3Editor: (trackId: string) =>
		bridgeFetch<{ ok: true; trackId: string; pluginName: string; opened: boolean }>("/vst3/editor/open", { method: "POST", body: JSON.stringify({ trackId }) }, 10000),
	getMidiDevices: () => bridgeFetch<{ ok: true } & BridgeMidiSettings>("/midi/devices", undefined, 5000),
	autoDetectMidi: () => bridgeFetch<{ ok: true } & BridgeMidiSettings>("/midi/autodetect", { method: "POST", body: "{}" }, 10000),
	setMidiSettings: (settings: { enabledInputs: string[]; masterMode: "SelectedTrack" | "Separate"; masterInputName?: string | null }) =>
		bridgeFetch<{ ok: true } & BridgeMidiSettings>("/midi/settings", { method: "PUT", body: JSON.stringify(settings) }, 10000),
	setMidiRoute: (trackId: string | null, inputName?: string | null) => bridgeFetch<{ ok: true; trackId?: string | null; inputName?: string | null }>("/midi/route", { method: "POST", body: JSON.stringify({ trackId, inputName }) }, 5000),
	midiPanic: () => bridgeFetch<{ ok: true }>("/midi/panic", { method: "POST", body: "{}" }, 5000),
	subscribeMidiEvents: (onEvent: (event: BridgeMidiEvent) => void, onConnection?: (connected: boolean) => void) => {
		const source = new EventSource(`${BRIDGE_BASE}/midi/events`);
		source.onopen = () => onConnection?.(true);
		source.onerror = () => onConnection?.(false);
		source.onmessage = (message) => {
			try { onEvent(JSON.parse(message.data) as BridgeMidiEvent); } catch { /* malformed native event */ }
		};
		return () => source.close();
	},
	openBridgeUi: () => bridgeFetch<{ ok: true }>("/ui/open", { method: "POST", body: "{}" }, 5000),
	openAsioControlPanel: () => bridgeFetch<{ ok: true }>("/audio/asio/control-panel", { method: "POST", body: "{}" }, 10000),
	getAudioStatus: () => bridgeFetch<{
		ok: true;
		driverType: "ASIO" | "WASAPI" | "DirectSound" | "MME";
		selectedDevice?: string | null;
		sampleRate: number;
		requestedBufferSize: number;
	}>("/audio/status", undefined, 5000),
};
