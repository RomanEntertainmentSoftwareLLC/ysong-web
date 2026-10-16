export type ProcessingLoadSample = {
	trackId: string;
	loadPercent?: number;
	processingMs?: number;
	updatedAt: number;
};

export type SchedulingLoadSample = { delayMs: number; updatedAt: number };
export type NativeTrackLoadSample = ProcessingLoadSample;
export type SustainedLoadState = "normal" | "elevated" | "overload";

const OVERLOAD_THRESHOLD = 35;
const ELEVATED_THRESHOLD = 20;
const SUSTAINED_SAMPLES = 5;

export function normalizeNativeLoad(value: unknown): number | undefined {
	const load = Number(value);
	return Number.isFinite(load) && load >= 0 ? Math.min(load, 100) : undefined;
}

export function classifySustainedLoad(samples: number[]): SustainedLoadState {
	const recent = samples.slice(-SUSTAINED_SAMPLES);
	if (recent.length < SUSTAINED_SAMPLES) return "normal";
	const average = recent.reduce((sum, sample) => sum + sample, 0) / recent.length;
	if (average >= OVERLOAD_THRESHOLD) return "overload";
	if (average >= ELEVATED_THRESHOLD) return "elevated";
	return "normal";
}

export function averageSchedulingDelay(samples: SchedulingLoadSample[], windowSize = 10): number | null {
	const recent = samples.slice(-windowSize);
	return recent.length ? recent.reduce((sum, sample) => sum + sample.delayMs, 0) / recent.length : null;
}

export function classifySchedulingPressure(samples: SchedulingLoadSample[]): SustainedLoadState {
	const recent = samples.slice(-SUSTAINED_SAMPLES);
	if (recent.length < SUSTAINED_SAMPLES) return "normal";
	const average = recent.reduce((sum, sample) => sum + sample.delayMs, 0) / recent.length;
	if (average >= 250) return "overload";
	if (average >= 100) return "elevated";
	return "normal";
}

export function classifyNativeTrackLoad(samples: NativeTrackLoadSample[], trackId: string): SustainedLoadState {
	const recent = samples.filter((sample) => sample.trackId === trackId && sample.loadPercent != null).slice(-SUSTAINED_SAMPLES);
	return recent.length < SUSTAINED_SAMPLES ? "normal" : classifySustainedLoad(recent.map((sample) => sample.loadPercent!));
}
