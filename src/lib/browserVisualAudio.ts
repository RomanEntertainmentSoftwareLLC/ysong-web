import { bridgeApi } from "./bridgeApi";

type AudioTap = {
	context: AudioContext;
	analyser: AnalyserNode;
	disconnect: () => void;
};

type BrowserVisualFrame = {
	timestampUnixMs: number;
	rms: number;
	peak: number;
	bass: number;
	mids: number;
	highs: number;
	energy: number;
	kick: number;
	spectrum: number[];
};

const taps = new WeakMap<HTMLMediaElement, AudioTap>();
const latestFrames = new Map<HTMLMediaElement, BrowserVisualFrame>();
let publishTimer = 0;
let lastPublishAt = 0;

function clamp01(value: number) {
	return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function createTap(element: HTMLMediaElement) {
	const existing = taps.get(element);
	if (existing) return existing;
	const Context = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
	if (!Context) throw new Error("Web Audio is unavailable in this browser.");
	const context = new Context();
	const source = context.createMediaElementSource(element);
	const analyser = context.createAnalyser();
	analyser.fftSize = 2048;
	analyser.smoothingTimeConstant = 0.72;
	source.connect(analyser);
	analyser.connect(context.destination);
	const tap: AudioTap = {
		context,
		analyser,
		disconnect: () => {
			try { source.disconnect(); } catch { /* already disconnected */ }
			try { analyser.disconnect(); } catch { /* already disconnected */ }
		},
	};
	taps.set(element, tap);
	return tap;
}

function publishMergedFrames() {
	publishTimer = 0;
	const now = Date.now();
	const active = [...latestFrames.entries()].filter(([element, frame]) => !element.paused && now - frame.timestampUnixMs < 350);
	if (!active.length) return;
	const merged: BrowserVisualFrame = {
		timestampUnixMs: now,
		rms: 0,
		peak: 0,
		bass: 0,
		mids: 0,
		highs: 0,
		energy: 0,
		kick: 0,
		spectrum: Array.from({ length: 64 }, () => 0),
	};
	for (const [, frame] of active) {
		merged.rms = Math.max(merged.rms, frame.rms);
		merged.peak = Math.max(merged.peak, frame.peak);
		merged.bass = Math.max(merged.bass, frame.bass);
		merged.mids = Math.max(merged.mids, frame.mids);
		merged.highs = Math.max(merged.highs, frame.highs);
		merged.energy = Math.max(merged.energy, frame.energy);
		merged.kick = Math.max(merged.kick, frame.kick);
		for (let i = 0; i < merged.spectrum.length; i++) merged.spectrum[i] = Math.max(merged.spectrum[i], frame.spectrum[i] ?? 0);
	}
	lastPublishAt = performance.now();
	void bridgeApi.pushVisualBrowserAudio(merged).catch(() => {});
}

function queuePublish() {
	if (publishTimer) return;
	const elapsed = performance.now() - lastPublishAt;
	const delay = Math.max(0, 45 - elapsed);
	publishTimer = window.setTimeout(publishMergedFrames, delay);
}

export function startVisualAnalysisForMediaElement(element: HTMLMediaElement) {
	const tap = createTap(element);
	let slowBass = 0;
	let kickEnvelope = 0;
	let stopped = false;
	let busy = false;
	const time = new Float32Array(tap.analyser.fftSize);
	const freq = new Float32Array(tap.analyser.frequencyBinCount);

	const resume = () => { if (tap.context.state !== "running") void tap.context.resume().catch(() => {}); };
	element.addEventListener("play", resume);
	resume();

	const timer = window.setInterval(() => {
		if (stopped || busy || element.paused) return;
		busy = true;
		try {
			tap.analyser.getFloatTimeDomainData(time);
			tap.analyser.getFloatFrequencyData(freq);
			let sumSq = 0;
			let peak = 0;
			for (const sample of time) { sumSq += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
			const rms = clamp01(Math.sqrt(sumSq / Math.max(1, time.length)) * 2.1);
			const nyquist = tap.context.sampleRate / 2;
			const hzPerBin = nyquist / Math.max(1, freq.length);
			const normalizedDb = (db: number) => clamp01((db + 78) / 68);
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
			const energy = clamp01(bass * 0.38 + mids * 0.40 + highs * 0.22);
			slowBass = slowBass * 0.94 + bass * 0.06;
			const transient = clamp01((bass - slowBass * 1.12) * 5.5);
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
			latestFrames.set(element, { timestampUnixMs: Date.now(), rms, peak: clamp01(peak), bass, mids, highs, energy, kick: kickEnvelope, spectrum });
			queuePublish();
		} finally {
			busy = false;
		}
	}, 50);

	return () => {
		stopped = true;
		window.clearInterval(timer);
		element.removeEventListener("play", resume);
		latestFrames.delete(element);
	};
}
