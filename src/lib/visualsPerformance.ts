import type {
	VisualAnimationCue,
	VisualAnimationLayer,
	VisualIKConstraint,
	VisualSkeletalAnimation,
	VisualSkeletalKeyframe,
} from "./visualsScene";

export type VisualAnimationSpan = {
	id: string;
	start: number;
	end: number;
	cue: VisualAnimationCue;
	animation: VisualSkeletalAnimation;
};

export type VisualActiveAnimationClip = VisualAnimationSpan & {
	localTime: number;
	weight: number;
};

export function visualAnimationCueDuration(cue: VisualAnimationCue, animation?: VisualSkeletalAnimation) {
	if (cue.duration > 0.0001) return cue.duration;
	return Math.max(0.05, (animation?.duration ?? 0.05) / Math.max(0.05, cue.speed));
}

export function visualAnimationSpans(animations: VisualSkeletalAnimation[], cues: VisualAnimationCue[], durationSeconds = Number.POSITIVE_INFINITY): VisualAnimationSpan[] {
	const byId = new Map(animations.map(animation => [animation.id, animation] as const));
	return cues
		.filter(cue => cue.enabled !== false)
		.map(cue => {
			const animation = byId.get(cue.animationId);
			if (!animation) return null;
			const duration = visualAnimationCueDuration(cue, animation);
			const start = Math.max(0, cue.time);
			const end = Math.max(start + 0.01, Math.min(durationSeconds, start + duration));
			return { id: cue.id, start, end, cue, animation };
		})
		.filter((span): span is VisualAnimationSpan => !!span && span.end > span.start)
		.sort((a, b) => a.start - b.start);
}

function smooth01(value: number) {
	const t = Math.max(0, Math.min(1, value));
	return t * t * (3 - 2 * t);
}

export function sampleVisualAnimationCue(cue: VisualAnimationCue, animation: VisualSkeletalAnimation, positionSeconds: number): VisualActiveAnimationClip | null {
	if (cue.enabled === false || positionSeconds < cue.time) return null;
	const spanDuration = visualAnimationCueDuration(cue, animation);
	const elapsed = positionSeconds - cue.time;
	if (elapsed > spanDuration + 0.0001) return null;
	const trimIn = Math.max(0, Math.min(animation.duration, cue.trimIn));
	const sourceAvailable = Math.max(0.0001, animation.duration - trimIn);
	let localTime = trimIn + elapsed * Math.max(0.05, cue.speed);
	if (cue.loop || animation.loop) localTime = trimIn + (((localTime - trimIn) % sourceAvailable) + sourceAvailable) % sourceAvailable;
	else localTime = Math.min(animation.duration, localTime);
	const blendIn = Math.max(0, Math.min(spanDuration * 0.5, cue.blendIn));
	const blendOut = Math.max(0, Math.min(spanDuration * 0.5, cue.blendOut));
	let envelope = 1;
	if (blendIn > 0 && elapsed < blendIn) envelope *= smooth01(elapsed / blendIn);
	const remaining = spanDuration - elapsed;
	if (blendOut > 0 && remaining < blendOut) envelope *= smooth01(remaining / blendOut);
	const weight = Math.max(0, Math.min(1, cue.weight)) * envelope;
	return { id: cue.id, start: cue.time, end: cue.time + spanDuration, cue, animation, localTime, weight };
}

export function activeVisualAnimationClips(animations: VisualSkeletalAnimation[], cues: VisualAnimationCue[], positionSeconds: number) {
	const byId = new Map(animations.map(animation => [animation.id, animation] as const));
	return cues
		.map(cue => {
			const animation = byId.get(cue.animationId);
			return animation ? sampleVisualAnimationCue(cue, animation, positionSeconds) : null;
		})
		.filter((clip): clip is VisualActiveAnimationClip => !!clip && clip.weight > 0.0001)
		.sort((a, b) => animationLayerOrder(a.cue.layer) - animationLayerOrder(b.cue.layer) || a.start - b.start);
}

export function animationLayerOrder(layer: VisualAnimationLayer) {
	switch (layer) {
		case "base": return 0;
		case "lowerBody": return 1;
		case "upperBody": return 2;
		case "arms": return 3;
		case "head": return 4;
	}
}

export function animationLayerAllowsTarget(layer: VisualAnimationLayer, target: VisualSkeletalKeyframe["target"]) {
	const name = target.toLowerCase();
	if (layer === "base") return true;
	const isHead = /head|neck/.test(name);
	const isArm = /shoulder|arm|hand|fore/.test(name);
	const isUpper = /spine|chest|neck|head|shoulder|arm|hand|fore/.test(name);
	const isLower = /root|hips|leg|foot|thigh|calf/.test(name);
	if (layer === "head") return isHead;
	if (layer === "arms") return isArm;
	if (layer === "upperBody") return isUpper;
	return isLower;
}

export function sampleIKWeight(constraint: VisualIKConstraint, positionSeconds: number) {
	const keys = [...constraint.weightKeys].sort((a, b) => a.time - b.time);
	if (!keys.length) return Math.max(0, Math.min(1, constraint.weight));
	if (positionSeconds <= keys[0].time) return keys[0].weight;
	if (positionSeconds >= keys[keys.length - 1].time) return keys[keys.length - 1].weight;
	let left = keys[0], right = keys[keys.length - 1];
	for (let i = 1; i < keys.length; i++) {
		if (keys[i].time >= positionSeconds) { left = keys[i - 1]; right = keys[i]; break; }
	}
	const raw = (positionSeconds - left.time) / Math.max(0.0001, right.time - left.time);
	const t = right.easing === "linear" ? raw : smooth01(raw);
	return left.weight + (right.weight - left.weight) * t;
}
