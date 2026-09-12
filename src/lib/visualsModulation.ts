import type { VisualAudioFrame, VisualTransportState } from "./bridgeApi";
import type { VisualAudioBinding, VisualAudioCurve, VisualAudioSource, VisualSceneState } from "./visualsScene";

export type VisualModulationRuntime = Map<string, number>;
export type VisualModulationFrame = {
	deltas: Map<string, number>;
	sources: Record<VisualAudioSource, number>;
};

export type VisualModulationTargetOption = {
	id: string;
	label: string;
	group: string;
	amountMin: number;
	amountMax: number;
	amountStep: number;
};

function clamp01(value: number) {
	return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function pulseFromPosition(positionSeconds: number, periodSeconds: number, width = 0.18) {
	if (!(periodSeconds > 0) || !(positionSeconds >= 0)) return 0;
	const phase = ((positionSeconds / periodSeconds) % 1 + 1) % 1;
	if (phase >= width) return 0;
	const t = 1 - phase / width;
	return t * t * (3 - 2 * t);
}

export function visualModulationSourceValues(
	audio: VisualAudioFrame,
	transport: VisualTransportState,
	positionSeconds: number,
): Record<VisualAudioSource, number> {
	const bpm = Math.max(1, Number(transport.bpm) || 0);
	const sigNum = Math.max(1, Math.round(Number(transport.sigNum) || 4));
	const sigDen = Math.max(1, Math.round(Number(transport.sigDen) || 4));
	const hasTempo = Number(transport.bpm) > 0;
	const beatSeconds = hasTempo ? (60 / bpm) * (4 / sigDen) : 0;
	const barSeconds = beatSeconds * sigNum;
	return {
		bass: clamp01(audio.bass),
		mids: clamp01(audio.mids),
		highs: clamp01(audio.highs),
		energy: clamp01(audio.energy),
		kick: clamp01(audio.kick),
		rms: clamp01(audio.rms),
		peak: clamp01(audio.peak),
		// If BPM metadata is unavailable (currently possible for World playback), Kick is
		// the honest fallback for Beat. Bar remains zero rather than inventing a downbeat.
		beat: transport.playing ? (hasTempo ? pulseFromPosition(positionSeconds, beatSeconds) : clamp01(audio.kick)) : 0,
		bar: transport.playing && hasTempo ? pulseFromPosition(positionSeconds, barSeconds, Math.min(0.1, 0.18 / sigNum)) : 0,
	};
}

function applyCurve(value: number, curve: VisualAudioCurve) {
	const v = clamp01(value);
	if (curve === "easeIn") return v * v;
	if (curve === "easeOut") return 1 - (1 - v) * (1 - v);
	if (curve === "smoothstep") return v * v * (3 - 2 * v);
	return v;
}

export function evaluateVisualAudioModulation(
	scene: VisualSceneState,
	audio: VisualAudioFrame,
	transport: VisualTransportState,
	positionSeconds: number,
	dt: number,
	runtime: VisualModulationRuntime,
): VisualModulationFrame {
	const sources = visualModulationSourceValues(audio, transport, positionSeconds);
	const deltas = new Map<string, number>();
	const config = scene.audioModulation;
	if (!config.enabled || config.masterAmount <= 0 || !config.bindings.length) {
		for (const key of runtime.keys()) runtime.set(key, 0);
		return { deltas, sources };
	}

	const liveIds = new Set<string>();
	for (const binding of config.bindings) {
		liveIds.add(binding.id);
		if (!binding.enabled || !binding.target) continue;
		let signal = Math.max(sources[binding.source] ?? 0, clamp01(config.testSignal));
		const threshold = clamp01(binding.threshold);
		signal = signal <= threshold ? 0 : (signal - threshold) / Math.max(0.0001, 1 - threshold);
		signal = applyCurve(binding.invert ? 1 - signal : signal, binding.curve);
		const previous = runtime.get(binding.id) ?? 0;
		const seconds = signal > previous ? Math.max(0.001, binding.attack) : Math.max(0.001, binding.release);
		const alpha = 1 - Math.exp(-Math.max(0.001, dt) / seconds);
		const smoothed = previous + (signal - previous) * alpha;
		runtime.set(binding.id, smoothed);
		const delta = smoothed * binding.amount * config.masterAmount;
		deltas.set(binding.target, (deltas.get(binding.target) ?? 0) + delta);
	}
	for (const id of [...runtime.keys()]) if (!liveIds.has(id)) runtime.delete(id);
	return { deltas, sources };
}

export function modulationValue(frame: VisualModulationFrame, target: string, base: number, min = -Infinity, max = Infinity) {
	return Math.max(min, Math.min(max, base + (frame.deltas.get(target) ?? 0)));
}

export function modulationDelta(frame: VisualModulationFrame, target: string) {
	return frame.deltas.get(target) ?? 0;
}

function target(id: string, label: string, group: string, amountMin: number, amountMax: number, amountStep: number): VisualModulationTargetOption {
	return { id, label, group, amountMin, amountMax, amountStep };
}

export function buildVisualModulationTargets(scene: VisualSceneState): VisualModulationTargetOption[] {
	const options: VisualModulationTargetOption[] = [
		target("object.positionX", "Performer · Position X", "Performer", -5, 5, 0.05),
		target("object.positionY", "Performer · Position Y", "Performer", -5, 5, 0.05),
		target("object.positionZ", "Performer · Position Z", "Performer", -5, 5, 0.05),
		target("object.rotationX", "Performer · Rotation X", "Performer", -3.14, 3.14, 0.02),
		target("object.rotationY", "Performer · Rotation Y", "Performer", -3.14, 3.14, 0.02),
		target("object.rotationZ", "Performer · Rotation Z", "Performer", -3.14, 3.14, 0.02),
		target("object.baseScale", "Performer · Scale", "Performer", -2, 4, 0.02),
		target("object.animationSpeed", "Performer · Animation Speed", "Performer", -3, 5, 0.02),
		target("object.animationWeight", "Performer · Animation Strength", "Performer", -1, 1, 0.01),
		target("object.emissiveIntensity", "Performer · Emissive / Glow", "Performer", -2, 8, 0.05),
		target("particles.size", "Particles · Size", "Particles", -20, 30, 0.1),
		target("particles.speed", "Particles · Velocity", "Particles", -4, 8, 0.05),
		target("particles.gravity", "Particles · Gravity", "Particles", -6, 6, 0.05),
		target("particles.turbulence", "Particles · Turbulence", "Particles", -4, 8, 0.05),
		target("particles.orbit", "Particles · Orbit", "Particles", -6, 6, 0.05),
		target("particles.spread", "Particles · Spread", "Particles", -15, 20, 0.1),
		target("particles.positionX", "Particles · Position X", "Particles", -10, 10, 0.05),
		target("particles.positionY", "Particles · Position Y", "Particles", -10, 10, 0.05),
		target("particles.positionZ", "Particles · Position Z", "Particles", -10, 10, 0.05),
		target("stage.ambientIntensity", "Stage · Ambient Intensity", "Lighting", -4, 8, 0.05),
		target("stage.sunIntensity", "Stage · Sun Intensity", "Lighting", -6, 12, 0.05),
		target("stage.moonIntensity", "Stage · Moon Intensity", "Lighting", -6, 12, 0.05),
		target("stage.keyIntensity", "Stage · Key Light Intensity", "Lighting", -10, 20, 0.1),
		target("stage.rimIntensity", "Stage · Rim Light Intensity", "Lighting", -12, 24, 0.1),
		target("stage.fillIntensity", "Stage · Fill Light Intensity", "Lighting", -10, 20, 0.1),
		target("stage.fogFar", "Stage · Fog Distance", "Atmosphere", -30, 30, 0.25),
		target("stage.exposure", "Stage · Exposure", "Lighting", -2, 3, 0.02),
		target("stage.bloomStrength", "Stage · Bloom Strength", "Post / Light", -3, 6, 0.05),
		target("stage.lensFlareIntensity", "Stage · Lens Flare Intensity", "Post / Light", -3, 6, 0.05),
		target("clouds.coverage", "Clouds · Coverage", "Clouds", -1, 1, 0.01),
		target("clouds.density", "Clouds · Density", "Clouds", -1, 1, 0.01),
		target("clouds.altitude", "Clouds · Altitude", "Clouds", -20, 20, 0.1),
		target("clouds.thickness", "Clouds · Thickness", "Clouds", -15, 20, 0.1),
		target("clouds.windX", "Clouds · Wind X", "Clouds", -4, 4, 0.02),
		target("clouds.windZ", "Clouds · Wind Z", "Clouds", -4, 4, 0.02),
		target("clouds.speed", "Clouds · Wind Speed", "Clouds", -2, 4, 0.02),
		target("clouds.brightness", "Clouds · Brightness", "Clouds", -3, 5, 0.02),
		target("clouds.lightAbsorption", "Clouds · Light Absorption", "Clouds", -1, 1, 0.01),
		target("wind.strength", "World Wind · Strength", "Environment / Weather", -4, 8, 0.05),
		target("wind.directionX", "World Wind · Direction X", "Environment / Weather", -4, 4, 0.02),
		target("wind.directionZ", "World Wind · Direction Z", "Environment / Weather", -4, 4, 0.02),
		target("wind.gustiness", "World Wind · Gustiness", "Environment / Weather", -1, 1, 0.01),
		target("wind.turbulence", "World Wind · Turbulence", "Environment / Weather", -2, 3, 0.02),
		target("weather.intensity", "Weather · Master Intensity", "Environment / Weather", -2, 3, 0.02),
		target("weather.rain", "Weather · Rain", "Environment / Weather", -1, 1, 0.01),
		target("weather.snow", "Weather · Snow", "Environment / Weather", -1, 1, 0.01),
		target("weather.ash", "Weather · Ash", "Environment / Weather", -1, 1, 0.01),
		target("weather.dust", "Weather · Dust", "Environment / Weather", -1, 1, 0.01),
		target("weather.sand", "Weather · Sand", "Environment / Weather", -1, 1, 0.01),
		target("weather.magic", "Weather · Magic", "Environment / Weather", -1, 1, 0.01),
		target("weather.fog", "Weather · Fog", "Environment / Weather", -1, 1, 0.01),
		target("weather.heatHaze", "Weather · Heat Haze", "Environment / Weather", -1, 1, 0.01),
		target("weather.lightning", "Weather · Lightning", "Environment / Weather", -1, 1, 0.01),
		target("weather.fallSpeed", "Weather · Fall Speed", "Environment / Weather", -4, 6, 0.05),
		target("sky.rotationY", "Sky · Rotation Y", "Environment", -6.28, 6.28, 0.02),
		target("sky.brightness", "Sky · Brightness", "Environment", -3, 5, 0.02),
		target("spectrum.height", "Spectrum · Height", "2D / Spectrum", -0.8, 1.5, 0.01),
		target("spectrum.thickness", "Spectrum · Thickness", "2D / Spectrum", -1, 2, 0.01),
		target("spectrum.positionX", "Spectrum · Position X", "2D / Spectrum", -1, 1, 0.01),
		target("spectrum.positionY", "Spectrum · Position Y", "2D / Spectrum", -1, 1, 0.01),
		target("spectrum.scale", "Spectrum · Scale", "2D / Spectrum", -2, 4, 0.02),
		target("spectrum.rotation", "Spectrum · Rotation", "2D / Spectrum", -6.28, 6.28, 0.02),
		target("spectrum.glow", "Spectrum · Glow", "2D / Spectrum", -3, 8, 0.05),
		target("postFx.exposure", "Post FX · Exposure", "Post FX", -2, 4, 0.02),
		target("postFx.brightness", "Post FX · Brightness", "Post FX", -2, 3, 0.02),
		target("postFx.contrast", "Post FX · Contrast", "Post FX", -2, 3, 0.02),
		target("postFx.saturation", "Post FX · Saturation", "Post FX", -3, 4, 0.02),
		target("postFx.temperature", "Post FX · Temperature", "Post FX", -1, 1, 0.01),
		target("postFx.tint", "Post FX · Tint", "Post FX", -1, 1, 0.01),
		target("postFx.lift", "Post FX · Lift", "Post FX", -.5, .5, 0.005),
		target("postFx.gamma", "Post FX · Gamma", "Post FX", -1, 2, 0.01),
		target("postFx.gain", "Post FX · Gain", "Post FX", -2, 4, 0.02),
		target("postFx.ambientOcclusionIntensity", "Post FX · Ambient Occlusion", "Post FX", -2, 4, 0.02),
		target("postFx.lightShaftsIntensity", "Post FX · Light Shafts", "Post FX", -3, 6, 0.02),
		target("postFx.lutIntensity", "Post FX · LUT Intensity", "Post FX", -1, 1, 0.01),
		target("postFx.chromaticAberration", "Post FX · Chromatic Aberration", "Post FX", -2, 5, 0.02),
		target("postFx.lensDistortion", "Post FX · Lens Distortion", "Post FX", -1, 1, 0.01),
		target("postFx.halation", "Post FX · Halation", "Post FX", -2, 4, 0.02),
		target("postFx.filmGrain", "Post FX · Film Grain", "Post FX", -1, 2, 0.01),
		target("postFx.vignette", "Post FX · Vignette", "Post FX", -1, 2, 0.01),
	];

	for (const camera of scene.cameras) {
		const prefix = `camera:${camera.id}`;
		const group = `Camera · ${camera.name}`;
		options.push(
			target(`${prefix}:fov`, `${camera.name} · FOV`, group, -60, 80, 0.25),
			target(`${prefix}:focusDistance`, `${camera.name} · Focus Distance`, group, -40, 60, 0.1),
			target(`${prefix}:focusRange`, `${camera.name} · Focus Range`, group, -10, 20, 0.05),
			target(`${prefix}:maxBlur`, `${camera.name} · DOF Blur`, group, -30, 40, 0.1),
			target(`${prefix}:bokehSize`, `${camera.name} · Bokeh Size`, group, -4, 6, 0.02),
			target(`${prefix}:lensFlare`, `${camera.name} · Lens Response`, group, -3, 6, 0.05),
			target(`${prefix}:exposure`, `${camera.name} · Exposure`, group, -2, 4, 0.02),
			target(`${prefix}:shakeAmount`, `${camera.name} · Handheld Shake`, group, -2, 4, 0.01),
			target(`${prefix}:shakeFrequency`, `${camera.name} · Shake Frequency`, group, -6, 12, 0.05),
			target(`${prefix}:shakeRotation`, `${camera.name} · Rotational Shake`, group, -10, 20, 0.1),
			target(`${prefix}:positionX`, `${camera.name} · Position X`, group, -10, 10, 0.05),
			target(`${prefix}:positionY`, `${camera.name} · Position Y`, group, -10, 10, 0.05),
			target(`${prefix}:positionZ`, `${camera.name} · Position Z`, group, -10, 10, 0.05),
			target(`${prefix}:rotationX`, `${camera.name} · Rotation X`, group, -3.14, 3.14, 0.02),
			target(`${prefix}:rotationY`, `${camera.name} · Rotation Y`, group, -3.14, 3.14, 0.02),
			target(`${prefix}:rotationZ`, `${camera.name} · Rotation Z`, group, -3.14, 3.14, 0.02),
		);
	}

	for (const material of scene.materials) {
		const prefix = `material:${material.id}`;
		const group = `Material · ${material.name}`;
		options.push(
			target(`${prefix}:emissiveIntensity`, `${material.name} · Emissive`, group, -10, 20, 0.05),
			target(`${prefix}:roughness`, `${material.name} · Roughness`, group, -1, 1, 0.01),
			target(`${prefix}:metalness`, `${material.name} · Metalness`, group, -1, 1, 0.01),
			target(`${prefix}:envMapIntensity`, `${material.name} · Reflection / Env`, group, -5, 10, 0.05),
			target(`${prefix}:opacity`, `${material.name} · Opacity`, group, -1, 1, 0.01),
			target(`${prefix}:transmission`, `${material.name} · Transmission`, group, -1, 1, 0.01),
			target(`${prefix}:clearcoat`, `${material.name} · Clearcoat`, group, -1, 1, 0.01),
		);
	}

	for (const name of Object.keys(scene.object.morphTargets)) {
		options.push(target(`morph:${name}`, `Morph · ${name}`, "Performer Morphs", -1, 1, 0.01));
	}

	const boneSlots = ["root","hips","spine","chest","neck","head","leftShoulder","leftUpperArm","leftForeArm","leftHand","rightShoulder","rightUpperArm","rightForeArm","rightHand","leftUpperLeg","leftLowerLeg","leftFoot","rightUpperLeg","rightLowerLeg","rightFoot"];
	for (const slot of boneSlots) {
		const label = slot.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase());
		for (const axis of ["X","Y","Z"]) options.push(target(`bone:${slot}:rotation${axis}`, `${label} · Rotation ${axis}`, "Skeletal Bones", -2.5, 2.5, 0.02));
	}

	for (const primitive of scene.primitives) {
		const prefix=`primitive:${primitive.id}`; const group=`Primitive · ${primitive.name}`;
		options.push(
			target(`${prefix}:positionX`, `${primitive.name} · Position X`, group, -10, 10, .05), target(`${prefix}:positionY`, `${primitive.name} · Position Y`, group, -10, 10, .05), target(`${prefix}:positionZ`, `${primitive.name} · Position Z`, group, -10, 10, .05),
			target(`${prefix}:rotationX`, `${primitive.name} · Rotation X`, group, -3.14, 3.14, .02), target(`${prefix}:rotationY`, `${primitive.name} · Rotation Y`, group, -3.14, 3.14, .02), target(`${prefix}:rotationZ`, `${primitive.name} · Rotation Z`, group, -3.14, 3.14, .02),
			target(`${prefix}:scaleX`, `${primitive.name} · Scale X`, group, -2, 4, .02), target(`${prefix}:scaleY`, `${primitive.name} · Scale Y`, group, -2, 4, .02), target(`${prefix}:scaleZ`, `${primitive.name} · Scale Z`, group, -2, 4, .02),
		);
	}

	for (const secondary of scene.secondaryDynamics) {
		const prefix=`secondary:${secondary.id}`; const group=`Secondary Physics · ${secondary.name}`;
		options.push(
			target(`${prefix}:stiffness`, `${secondary.name} · Stiffness`, group, -1, 1, .01),
			target(`${prefix}:bendStiffness`, `${secondary.name} · Bend Stiffness`, group, -1, 1, .01),
			target(`${prefix}:gravityScale`, `${secondary.name} · Gravity Scale`, group, -3, 3, .02),
			target(`${prefix}:windInfluence`, `${secondary.name} · Wind Influence`, group, -4, 8, .02),
			target(`${prefix}:drag`, `${secondary.name} · Air Drag`, group, -2, 4, .02),
			target(`${prefix}:audioImpulse`, `${secondary.name} · Physical Impulse`, group, -10, 20, .05),
			target(`${prefix}:offsetX`, `${secondary.name} · Anchor Offset X`, group, -5, 5, .02),
			target(`${prefix}:offsetY`, `${secondary.name} · Anchor Offset Y`, group, -5, 5, .02),
			target(`${prefix}:offsetZ`, `${secondary.name} · Anchor Offset Z`, group, -5, 5, .02),
			target(`${prefix}:boneInfluence`, `${secondary.name} · Spring Bone Influence`, group, -1, 1, .01),
		);
	}

	for (const shape of scene.shapes2d) {
		const prefix = `shape:${shape.id}`;
		const group = `2D Shape · ${shape.name}`;
		options.push(
			target(`${prefix}:positionX`, `${shape.name} · Position X`, group, -1, 1, 0.01),
			target(`${prefix}:positionY`, `${shape.name} · Position Y`, group, -1, 1, 0.01),
			target(`${prefix}:width`, `${shape.name} · Width`, group, -1, 1, 0.01),
			target(`${prefix}:height`, `${shape.name} · Height`, group, -1, 1, 0.01),
			target(`${prefix}:rotation`, `${shape.name} · Rotation`, group, -180, 180, 1),
		);
	}

	for (const layer of scene.layers) {
		if (["media","spectrum","particles","nowPlaying","shape2d","clouds","weather"].includes(layer.type)) options.push(target(`layer:${layer.id}:opacity`, `${layer.name} · Opacity`, "Layers", -1, 1, 0.01));
		if (layer.type === "media") options.push(target(`layer:${layer.id}:speed`, `${layer.name} · Playback Speed`, "Layers", -3, 4, 0.02));
	}
	return options;
}

export function makeVisualAudioBinding(targetId = "stage.bloomStrength"): VisualAudioBinding {
	return {
		id: `audio-binding-${crypto.randomUUID()}`,
		enabled: true,
		name: "Audio Mapping",
		source: "energy",
		target: targetId,
		amount: 1,
		attack: 0.08,
		release: 0.24,
		threshold: 0,
		invert: false,
		curve: "smoothstep",
	};
}
