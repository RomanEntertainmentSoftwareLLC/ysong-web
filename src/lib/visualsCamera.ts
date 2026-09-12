import type {
	VisualCameraKeyframe,
	VisualCameraSegmentEasing,
	VisualProgramCamera,
	VisualSceneState,
} from "./visualsScene";

export type VisualCameraSample = {
	positionX: number;
	positionY: number;
	positionZ: number;
	rotationX: number;
	rotationY: number;
	rotationZ: number;
	targetX: number;
	targetY: number;
	targetZ: number;
	targetOffsetX: number;
	targetOffsetY: number;
	targetOffsetZ: number;
	fov: number;
	focusDistance: number;
	aperture: number;
	dofAmount: number;
	dofBalance: number;
	focusRange: number;
	maxBlur: number;
	bokehSize: number;
	bokehBlades: number;
	bokehRotation: number;
	bokehThreshold: number;
	bokehGain: number;
	bokehAnamorphic: number;
	exposure: number;
	shakeAmount: number;
	shakeFrequency: number;
	shakeRotation: number;
};

export type VisualCameraShot = {
	id: string;
	cameraId: string;
	start: number;
	end: number;
	cutId?: string;
};

function clamp01(value: number) {
	return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function lerp(a: number, b: number, t: number) {
	return a + (b - a) * t;
}

function wrapAngle(value: number) {
	let result = value;
	while (result > Math.PI) result -= Math.PI * 2;
	while (result < -Math.PI) result += Math.PI * 2;
	return result;
}

function lerpAngle(a: number, b: number, t: number) {
	return a + wrapAngle(b - a) * t;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number) {
	const t2 = t * t;
	const t3 = t2 * t;
	return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function easingForSegment(camera: VisualProgramCamera, left: VisualCameraKeyframe): VisualCameraSegmentEasing {
	if (left.easing && left.easing !== "inherit") return left.easing;
	if (camera.pathInterpolation === "linear") return "linear";
	return "easeInOut";
}

function applyEasing(value: number, easing: VisualCameraSegmentEasing) {
	const t = clamp01(value);
	if (easing === "hold") return 0;
	if (easing === "easeIn") return t * t;
	if (easing === "easeOut") return 1 - (1 - t) * (1 - t);
	if (easing === "easeInOut") return t * t * (3 - 2 * t);
	return t;
}

function normalizedFrame(camera: VisualProgramCamera, frame: VisualCameraKeyframe): VisualCameraSample {
	return {
		positionX: frame.positionX,
		positionY: frame.positionY,
		positionZ: frame.positionZ,
		rotationX: frame.rotationX ?? camera.rotationX,
		rotationY: frame.rotationY ?? camera.rotationY,
		rotationZ: frame.rotationZ ?? camera.rotationZ,
		targetX: frame.targetX,
		targetY: frame.targetY,
		targetZ: frame.targetZ,
		targetOffsetX: frame.targetOffsetX ?? camera.targetOffsetX,
		targetOffsetY: frame.targetOffsetY ?? camera.targetOffsetY,
		targetOffsetZ: frame.targetOffsetZ ?? camera.targetOffsetZ,
		fov: frame.fov,
		focusDistance: frame.focusDistance ?? camera.focusDistance,
		aperture: frame.aperture ?? camera.aperture,
		dofAmount: frame.dofAmount ?? camera.dofAmount,
		dofBalance: frame.dofBalance ?? camera.dofBalance,
		focusRange: frame.focusRange ?? camera.focusRange,
		maxBlur: frame.maxBlur ?? camera.maxBlur,
		bokehSize: frame.bokehSize ?? camera.bokehSize,
		bokehBlades: camera.bokehBlades,
		bokehRotation: camera.bokehRotation,
		bokehThreshold: camera.bokehThreshold,
		bokehGain: camera.bokehGain,
		bokehAnamorphic: camera.bokehAnamorphic,
		exposure: frame.exposure ?? camera.exposure,
		shakeAmount: frame.shakeAmount ?? camera.shakeAmount,
		shakeFrequency: frame.shakeFrequency ?? camera.shakeFrequency,
		shakeRotation: frame.shakeRotation ?? camera.shakeRotation,
	};
}

function baseCameraSample(camera: VisualProgramCamera): VisualCameraSample {
	return {
		positionX: camera.positionX,
		positionY: camera.positionY,
		positionZ: camera.positionZ,
		rotationX: camera.rotationX,
		rotationY: camera.rotationY,
		rotationZ: camera.rotationZ,
		targetX: camera.targetX,
		targetY: camera.targetY,
		targetZ: camera.targetZ,
		targetOffsetX: camera.targetOffsetX,
		targetOffsetY: camera.targetOffsetY,
		targetOffsetZ: camera.targetOffsetZ,
		fov: camera.fov,
		focusDistance: camera.focusDistance,
		aperture: camera.aperture,
		dofAmount: camera.dofAmount,
		dofBalance: camera.dofBalance,
		focusRange: camera.focusRange,
		maxBlur: camera.maxBlur,
		bokehSize: camera.bokehSize,
		bokehBlades: camera.bokehBlades,
		bokehRotation: camera.bokehRotation,
		bokehThreshold: camera.bokehThreshold,
		bokehGain: camera.bokehGain,
		bokehAnamorphic: camera.bokehAnamorphic,
		exposure: camera.exposure,
		shakeAmount: camera.shakeAmount,
		shakeFrequency: camera.shakeFrequency,
		shakeRotation: camera.shakeRotation,
	};
}

function pathTime(camera: VisualProgramCamera, frames: VisualCameraKeyframe[], positionSeconds: number) {
	if (!frames.length) return 0;
	const first = frames[0].time;
	const last = frames[frames.length - 1].time;
	const position = Math.max(0, positionSeconds);
	if (!camera.loop || last <= first) return position;
	// A loop begins at its first authored key. Before that moment the camera holds
	// the first pose instead of wrapping backward into a later point in the path.
	if (position <= first) return first;
	const span = Math.max(0.0001, last - first);
	return first + ((position - first) % span);
}

function neighborFrame(frames: VisualCameraKeyframe[], index: number, closed: boolean) {
	if (closed && frames.length > 2) {
		const wrapped = ((index % frames.length) + frames.length) % frames.length;
		return frames[wrapped];
	}
	return frames[Math.max(0, Math.min(frames.length - 1, index))];
}

export function sampleVisualProgramCamera(camera: VisualProgramCamera, positionSeconds: number): VisualCameraSample {
	const frames = [...camera.keyframes].sort((a, b) => a.time - b.time);
	if (!frames.length) return baseCameraSample(camera);
	if (frames.length === 1) return normalizedFrame(camera, frames[0]);

	const t = pathTime(camera, frames, positionSeconds);
	const firstTime = frames[0].time;
	const lastTime = frames[frames.length - 1].time;
	if (!camera.loop && t <= firstTime) return normalizedFrame(camera, frames[0]);
	if (!camera.loop && t >= lastTime) return normalizedFrame(camera, frames[frames.length - 1]);

	let rightIndex = frames.findIndex(frame => frame.time >= t);
	if (rightIndex <= 0) rightIndex = 1;
	if (rightIndex < 0) rightIndex = frames.length - 1;
	const leftIndex = Math.max(0, rightIndex - 1);
	const leftFrame = frames[leftIndex];
	const rightFrame = frames[rightIndex];
	const left = normalizedFrame(camera, leftFrame);
	const right = normalizedFrame(camera, rightFrame);
	const span = Math.max(0.0001, rightFrame.time - leftFrame.time);
	const rawAlpha = clamp01((t - leftFrame.time) / span);
	const easing = easingForSegment(camera, leftFrame);
	const alpha = applyEasing(rawAlpha, easing);

	let positionX = lerp(left.positionX, right.positionX, alpha);
	let positionY = lerp(left.positionY, right.positionY, alpha);
	let positionZ = lerp(left.positionZ, right.positionZ, alpha);
	let targetX = lerp(left.targetX, right.targetX, alpha);
	let targetY = lerp(left.targetY, right.targetY, alpha);
	let targetZ = lerp(left.targetZ, right.targetZ, alpha);

	if (camera.pathInterpolation === "catmullRom" && easing !== "hold" && frames.length >= 3) {
		const p0 = normalizedFrame(camera, neighborFrame(frames, leftIndex - 1, camera.pathClosed));
		const p3 = normalizedFrame(camera, neighborFrame(frames, rightIndex + 1, camera.pathClosed));
		positionX = catmullRom(p0.positionX, left.positionX, right.positionX, p3.positionX, alpha);
		positionY = catmullRom(p0.positionY, left.positionY, right.positionY, p3.positionY, alpha);
		positionZ = catmullRom(p0.positionZ, left.positionZ, right.positionZ, p3.positionZ, alpha);
		targetX = catmullRom(p0.targetX, left.targetX, right.targetX, p3.targetX, alpha);
		targetY = catmullRom(p0.targetY, left.targetY, right.targetY, p3.targetY, alpha);
		targetZ = catmullRom(p0.targetZ, left.targetZ, right.targetZ, p3.targetZ, alpha);
	}

	return {
		positionX,
		positionY,
		positionZ,
		rotationX: lerpAngle(left.rotationX, right.rotationX, alpha),
		rotationY: lerpAngle(left.rotationY, right.rotationY, alpha),
		rotationZ: lerpAngle(left.rotationZ, right.rotationZ, alpha),
		targetX,
		targetY,
		targetZ,
		targetOffsetX: lerp(left.targetOffsetX, right.targetOffsetX, alpha),
		targetOffsetY: lerp(left.targetOffsetY, right.targetOffsetY, alpha),
		targetOffsetZ: lerp(left.targetOffsetZ, right.targetOffsetZ, alpha),
		fov: lerp(left.fov, right.fov, alpha),
		focusDistance: lerp(left.focusDistance, right.focusDistance, alpha),
		aperture: lerp(left.aperture, right.aperture, alpha),
		dofAmount: lerp(left.dofAmount, right.dofAmount, alpha),
		dofBalance: lerp(left.dofBalance, right.dofBalance, alpha),
		focusRange: lerp(left.focusRange, right.focusRange, alpha),
		maxBlur: lerp(left.maxBlur, right.maxBlur, alpha),
		bokehSize: lerp(left.bokehSize, right.bokehSize, alpha),
		bokehBlades: camera.bokehBlades,
		bokehRotation: camera.bokehRotation,
		bokehThreshold: camera.bokehThreshold,
		bokehGain: camera.bokehGain,
		bokehAnamorphic: camera.bokehAnamorphic,
		exposure: lerp(left.exposure, right.exposure, alpha),
		shakeAmount: lerp(left.shakeAmount, right.shakeAmount, alpha),
		shakeFrequency: lerp(left.shakeFrequency, right.shakeFrequency, alpha),
		shakeRotation: lerp(left.shakeRotation, right.shakeRotation, alpha),
	};
}

export function resolveVisualProgramCamera(scene: VisualSceneState, positionSeconds: number, forcedCameraId = "") {
	if (forcedCameraId) return scene.cameras.find(candidate => candidate.id === forcedCameraId) || scene.cameras[0];
	let cameraId = scene.activeCameraId || scene.cameras[0]?.id || "";
	for (const cut of [...scene.cameraCuts].sort((a, b) => a.time - b.time)) {
		if (cut.time <= positionSeconds + 0.0001) cameraId = cut.cameraId;
		else break;
	}
	return scene.cameras.find(candidate => candidate.id === cameraId && candidate.enabled)
		|| scene.cameras.find(candidate => candidate.enabled)
		|| scene.cameras[0];
}

export function buildVisualCameraShots(scene: VisualSceneState, durationSeconds: number): VisualCameraShot[] {
	const duration = Math.max(0.05, durationSeconds);
	const cuts = [...scene.cameraCuts]
		.filter(cut => cut.time >= 0 && cut.time <= duration)
		.sort((a, b) => a.time - b.time);
	const shots: VisualCameraShot[] = [];
	let cameraId = scene.activeCameraId || scene.cameras[0]?.id || "";
	let start = 0;
	for (const cut of cuts) {
		if (cut.time > start + 0.0001) shots.push({ id: `shot:${start.toFixed(4)}:${cameraId}`, cameraId, start, end: cut.time });
		cameraId = cut.cameraId;
		start = cut.time;
	}
	if (start < duration) shots.push({ id: `shot:${start.toFixed(4)}:${cameraId}`, cameraId, start, end: duration, cutId: cuts.at(-1)?.id });
	return shots;
}

export function deterministicCameraShake(timeSeconds: number, seed: number, frequency: number) {
	const t = Math.max(0, timeSeconds) * Math.max(0.01, frequency);
	const s = Number.isFinite(seed) ? seed : 1;
	return {
		x: Math.sin(t * 6.173 + s * 1.913) * 0.62 + Math.sin(t * 13.41 + s * 0.417) * 0.38,
		y: Math.sin(t * 7.731 + s * 3.117) * 0.58 + Math.cos(t * 15.27 + s * 1.311) * 0.42,
		z: Math.cos(t * 5.349 + s * 0.811) * 0.55 + Math.sin(t * 11.83 + s * 2.713) * 0.45,
		roll: Math.sin(t * 4.891 + s * 5.019) * 0.7 + Math.sin(t * 9.13 + s * 1.07) * 0.3,
	};
}
