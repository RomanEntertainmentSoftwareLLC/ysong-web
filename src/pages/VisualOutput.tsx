import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { TGALoader } from "three/examples/jsm/loaders/TGALoader.js";
import { DDSLoader } from "three/examples/jsm/loaders/DDSLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { LUTPass } from "three/examples/jsm/postprocessing/LUTPass.js";
import { LUTCubeLoader } from "three/examples/jsm/loaders/LUTCubeLoader.js";
import { LUT3dlLoader } from "three/examples/jsm/loaders/LUT3dlLoader.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { FXAAShader } from "three/examples/jsm/shaders/FXAAShader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";
import RAPIER from "@dimforge/rapier3d-compat";
import { YSongDepthOfFieldShader, YSongLightShaftShader, YSongStudioPostShader } from "../lib/visualsPostFx";
import {
	bridgeApi,
	type VisualAudioFrame,
	type VisualTransportState,
	type VisualRoomAudienceEffect,
	type VisualRoomAudienceEffectId,
} from "../lib/bridgeApi";
import {
	extrapolatedTransportPosition,
	subscribeLocalVisualAudio,
	subscribeLocalVisualTransport,
} from "../lib/visualsRealtime";
import { subscribeRoomVenueEvents } from "../lib/roomVenueRealtime";
import {
	DEFAULT_VISUAL_SCENE,
	HUMANOID_SLOTS,
	PERFORMANCE_BEHAVIORS,
	normalizeVisualScene,
	visualAudioValue,
	visualLayerActive,
	visualLayerOpacityAt,
	type VisualLayer,
	type VisualPerformanceCue,
	type VisualProgramCamera,
	type VisualSceneState,
	type VisualMaterialAsset,
	type VisualPrimitiveObject,
	type VisualPrimitiveType,
	type VisualHumanoidSlot,
	type VisualSkeletalAnimation,
	type VisualIKConstraint,
	type VisualPostFxModule,
	type VisualPostFxModuleType,
	type VisualSecondaryDynamic,
} from "../lib/visualsScene";
import { deterministicCameraShake, resolveVisualProgramCamera, sampleVisualProgramCamera } from "../lib/visualsCamera";
import { pickVisibleEditorObject } from "../lib/visualsEditorPicking";
import { applyVisualTransform, selectedVisualTransform, type VisualTransform, type VisualTransformMode, type VisualTransformSpace } from "../lib/visualsTransform";
import { isCurrentVisualMaterialTexture, type MaterialTextureKey } from "../lib/visualMaterialUpload";
import { activeVisualAnimationClips, animationLayerAllowsTarget, sampleIKWeight } from "../lib/visualsPerformance";
import {
	buildSecondaryTopology,
	isSecondarySheet,
	secondaryTopologySignature,
	type SecondaryTopology,
} from "../lib/visualsSecondaryPhysics";
import {
	evaluateVisualAudioModulation,
	modulationDelta,
	modulationValue,
	type VisualModulationFrame,
} from "../lib/visualsModulation";
import {
	fitVisualRenderSize,
	nextAdaptiveQualityScale,
	readVisualRendererCapabilities,
	resolveVisualRuntimeQuality,
	type VisualRuntimeQuality,
} from "../lib/visualsQuality";
import {
	YSONG_VISUAL_OUTPUT_TITLE,
	YSONG_VISUALS_CHANNEL,
	type VisualModelInfo,
	type VisualOutputError,
	type VisualPerformanceState,
	type VisualOutputStats,
} from "../lib/visualsBus";

const PROGRAM_WIDTH = 1920;
const PROGRAM_HEIGHT = 1080;
const PREVIEW_WIDTH = 960;
const PREVIEW_HEIGHT = 540;
const TARGET_FPS = 60;
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;
const MAX_PARTICLES = 7000;
const MAX_WEATHER_PARTICLES = 4200;
const MAX_RAIN_STREAKS = 2200;

type RoomVisualEffectPulse = {
	effectId: VisualRoomAudienceEffectId;
	eventId: string;
	startedAt: number;
	until: number;
};
const ROOM_EFFECT_DURATION_MS: Record<VisualRoomAudienceEffectId, number> = {
	applause: 1700,
	hearts: 2600,
	confetti: 3200,
	lightning: 900,
	fire: 2800,
	snow: 4200,
	"camera-shake": 1200,
	strobe: 1600,
};

function roomEffectStrength(
	pulses: Map<VisualRoomAudienceEffectId, RoomVisualEffectPulse>,
	id: VisualRoomAudienceEffectId,
	now: number,
) {
	const pulse = pulses.get(id);
	if (!pulse || now >= pulse.until) return 0;
	const duration = Math.max(1, pulse.until - pulse.startedAt);
	const t = Math.max(0, Math.min(1, (now - pulse.startedAt) / duration));
	return Math.sin(Math.PI * Math.min(1, t)) * (1 - t * 0.18);
}

function hash01(value: number) {
	const x = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
	return x - Math.floor(x);
}

function drawHeart(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, alpha: number) {
	ctx.save();
	ctx.translate(x, y);
	ctx.scale(size, size);
	ctx.globalAlpha = alpha;
	ctx.beginPath();
	ctx.moveTo(0, 0.28);
	ctx.bezierCurveTo(-0.55, -0.12, -0.42, -0.62, 0, -0.3);
	ctx.bezierCurveTo(0.42, -0.62, 0.55, -0.12, 0, 0.28);
	ctx.closePath();
	ctx.fillStyle = "#d98cff";
	ctx.fill();
	ctx.restore();
}

function drawRoomAudienceEffects(
	ctx: CanvasRenderingContext2D,
	pulses: Map<VisualRoomAudienceEffectId, RoomVisualEffectPulse>,
	now: number,
	width: number,
	height: number,
) {
	const active = [...pulses.values()].filter((pulse) => now < pulse.until);
	if (!active.length) return;
	for (const pulse of active) {
		const duration = Math.max(1, pulse.until - pulse.startedAt);
		const t = Math.max(0, Math.min(1, (now - pulse.startedAt) / duration));
		const fade = Math.sin(Math.PI * Math.min(1, t));
		ctx.save();
		if (pulse.effectId === "hearts") {
			for (let i = 0; i < 22; i++) {
				const seed = hash01(i * 9.1 + 31);
				const x = (0.05 + hash01(i * 4.7) * 0.9) * width;
				const travel = (t * (0.55 + seed * 0.45) + hash01(i * 2.3) * 0.1) % 1;
				const y = height * (1.05 - travel * 1.15);
				const drift = Math.sin(t * 5 + i) * width * 0.018;
				drawHeart(ctx, x + drift, y, 8 + seed * 12, fade * (0.35 + seed * 0.55));
			}
		} else if (pulse.effectId === "confetti") {
			const colors = ["#ffcf5a", "#ff6b9e", "#7ce6ff", "#a98cff", "#7cff9d"];
			for (let i = 0; i < 54; i++) {
				const seed = hash01(i * 7.7 + 19);
				const x = (hash01(i * 3.17) * 1.15 - 0.075) * width + Math.sin(t * 7 + i) * 18;
				const y = (-0.1 + t * (0.8 + seed * 0.75) + hash01(i * 5.3) * 0.28) * height;
				ctx.globalAlpha = fade * (0.45 + seed * 0.5);
				ctx.fillStyle = colors[i % colors.length];
				ctx.save();
				ctx.translate(x, y);
				ctx.rotate(t * 8 + seed * 5);
				ctx.fillRect(-3 - seed * 3, -7, 6 + seed * 5, 14);
				ctx.restore();
			}
		} else if (pulse.effectId === "snow") {
			ctx.fillStyle = "#eef7ff";
			for (let i = 0; i < 46; i++) {
				const seed = hash01(i * 11.2 + 7);
				const x = (hash01(i * 2.9) * 1.1 - 0.05) * width + Math.sin(t * 5 + i) * 22;
				const y = ((hash01(i * 4.1) + t * (0.35 + seed * 0.5)) % 1.15) * height;
				ctx.globalAlpha = fade * (0.25 + seed * 0.65);
				ctx.beginPath();
				ctx.arc(x, y, 1.2 + seed * 3.4, 0, Math.PI * 2);
				ctx.fill();
			}
		} else if (pulse.effectId === "fire") {
			for (let i = 0; i < 30; i++) {
				const seed = hash01(i * 8.8 + 4);
				const x = (0.03 + hash01(i * 3.6) * 0.94) * width;
				const rise = (t * (0.55 + seed * 0.55) + hash01(i * 2.1) * 0.22) % 1;
				const y = height * (1.02 - rise * 0.42);
				const h = (16 + seed * 50) * fade;
				const grad = ctx.createLinearGradient(x, y, x, y - h);
				grad.addColorStop(0, "rgba(255,73,20,.0)");
				grad.addColorStop(0.35, "rgba(255,73,20,.72)");
				grad.addColorStop(1, "rgba(255,224,94,.0)");
				ctx.fillStyle = grad;
				ctx.globalAlpha = 0.8;
				ctx.beginPath();
				ctx.moveTo(x - 5 - seed * 5, y);
				ctx.quadraticCurveTo(x - 12, y - h * 0.45, x + Math.sin(i + t * 10) * 5, y - h);
				ctx.quadraticCurveTo(x + 12, y - h * 0.45, x + 5 + seed * 5, y);
				ctx.closePath();
				ctx.fill();
			}
		} else if (pulse.effectId === "applause") {
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.font = `${Math.max(28, width * 0.022)}px sans-serif`;
			for (let i = 0; i < 12; i++) {
				const seed = hash01(i * 6.2 + 15);
				const x = (0.08 + hash01(i * 2.4) * 0.84) * width;
				const y = height * (0.88 - t * (0.25 + seed * 0.18));
				ctx.globalAlpha = fade * (0.25 + seed * 0.65);
				ctx.fillText("👏", x, y);
			}
		} else if (pulse.effectId === "lightning") {
			ctx.globalAlpha = fade * 0.88;
			ctx.strokeStyle = "#e7e8ff";
			ctx.lineWidth = Math.max(2, width * 0.003);
			ctx.shadowBlur = 20;
			ctx.shadowColor = "#9f8cff";
			ctx.beginPath();
			let x = width * (0.28 + hash01(pulse.eventId.length) * 0.45),
				y = -10;
			ctx.moveTo(x, y);
			for (let i = 1; i <= 8; i++) {
				x += (hash01(i * 7 + pulse.eventId.length) - 0.5) * width * 0.09;
				y = height * (i / 8);
				ctx.lineTo(x, y);
			}
			ctx.stroke();
			ctx.globalAlpha = fade * 0.24;
			ctx.fillStyle = "#c9c7ff";
			ctx.fillRect(0, 0, width, height);
		} else if (pulse.effectId === "strobe") {
			const blink = Math.max(0, Math.sin(t * Math.PI * 14));
			ctx.globalAlpha = blink * fade * 0.5;
			ctx.fillStyle = "#fff";
			ctx.fillRect(0, 0, width, height);
		}
		ctx.restore();
	}
}

const ZERO_AUDIO: VisualAudioFrame = {
	sequence: 0,
	timestampUnixMs: 0,
	source: "idle",
	rms: 0,
	peak: 0,
	bass: 0,
	mids: 0,
	highs: 0,
	energy: 0,
	kick: 0,
	spectrum: Array.from({ length: 64 }, () => 0),
};

const ZERO_TRANSPORT: VisualTransportState = {
	source: "idle",
	playing: false,
	positionSeconds: 0,
	durationSeconds: 0,
	updatedAt: 0,
};

type MannequinRig = {
	root: THREE.Group;
	spine: THREE.Group;
	chest: THREE.Group;
	head: THREE.Group;
	leftShoulder: THREE.Group;
	rightShoulder: THREE.Group;
	leftElbow: THREE.Group;
	rightElbow: THREE.Group;
	leftHand: THREE.Group;
	rightHand: THREE.Group;
	materials: THREE.MeshStandardMaterial[];
};

type RigTargets = {
	spine?: THREE.Object3D;
	chest?: THREE.Object3D;
	head?: THREE.Object3D;
	neck?: THREE.Object3D;
	leftUpperArm?: THREE.Object3D;
	rightUpperArm?: THREE.Object3D;
	leftForeArm?: THREE.Object3D;
	rightForeArm?: THREE.Object3D;
	leftHand?: THREE.Object3D;
	rightHand?: THREE.Object3D;
};

type ImportedMaterialBase = {
	color: THREE.Color;
	metalness: number;
	roughness: number;
	emissive: THREE.Color;
	emissiveIntensity: number;
	map: THREE.Texture | null;
	normalMap: THREE.Texture | null;
	bumpMap: THREE.Texture | null;
	roughnessMap: THREE.Texture | null;
	metalnessMap: THREE.Texture | null;
	aoMap: THREE.Texture | null;
	emissiveMap: THREE.Texture | null;
	alphaMap: THREE.Texture | null;
	displacementMap: THREE.Texture | null;
	opacity: number;
	transparent: boolean;
};

type GlbRuntime = {
	root: THREE.Group | null;
	mixer: THREE.AnimationMixer | null;
	clips: THREE.AnimationClip[];
	activeAction: THREE.AnimationAction | null;
	fileName: string;
	bones: THREE.Bone[];
	boneBase: Map<THREE.Bone, { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }>;
	materials: THREE.MeshStandardMaterial[];
	morphMeshes: THREE.Mesh[];
	materialBase: Map<THREE.MeshStandardMaterial, ImportedMaterialBase>;
	loadingUrl: string;
	targets: RigTargets;
};

type PerformanceRuntime = {
	active: VisualPerformanceCue | null;
	startedAt: number;
	durationMs: number;
	strength: number;
	source: "manual" | "auto" | "timeline" | "idle";
	manualSequence: number;
	manualInitialized: boolean;
	lastAutoAt: number;
	recent: string[];
	lastKick: number;
	lastEnergy: number;
	lastBass: number;
	lastHighs: number;
	lastBroadcastAt: number;
	lastTransportPosition: number;
};

type LightningRuntime = {
	group: THREE.Group;
	left: THREE.Line[];
	right: THREE.Line[];
	leftLight: THREE.PointLight;
	rightLight: THREE.PointLight;
};

const PERFORMANCE_BY_ID = new Map(PERFORMANCE_BEHAVIORS.map((cue) => [cue.id, cue] as const));

const AUTO_POOLS = {
	balanced: [
		"watch-audience",
		"curious-lean",
		"open-arms",
		"reach-camera",
		"recoil",
		"rage-build",
		"energy-gather",
		"lightning-left",
		"lightning-right",
		"predator-stare",
		"head-snap",
		"high-ascension",
	],
	aggressive: [
		"pound-screen",
		"double-pound",
		"grab-camera",
		"rage-release",
		"recoil",
		"stagger",
		"scream",
		"bass-possession",
		"lightning-left",
		"lightning-right",
		"dual-lightning",
		"storm-caller",
	],
	ethereal: [
		"look-up",
		"open-arms",
		"cruciform",
		"raise-hands",
		"high-ascension",
		"angelic-open",
		"energy-gather",
		"energy-release",
		"lightning-left",
		"lightning-right",
		"dual-lightning",
		"slow-sway",
	],
	emotional: [
		"look-down",
		"look-up",
		"curious-lean",
		"sorrow-curl",
		"mourn",
		"proud-stance",
		"protective",
		"laugh",
		"scream",
		"turn-away",
		"return-stare",
		"watch-audience",
	],
} as const;

function findNamedTarget(objects: THREE.Object3D[], patterns: RegExp[]) {
	for (const pattern of patterns) {
		const exact = objects.find((object) => pattern.test(object.name));
		if (exact) return exact;
	}
	return undefined;
}

function discoverRigTargets(bones: THREE.Bone[]): RigTargets {
	const objects: THREE.Object3D[] = bones;
	return {
		spine: findNamedTarget(objects, [/^spine$/i, /spine/i, /hips|pelvis/i]),
		chest: findNamedTarget(objects, [/^chest$/i, /chest|upper.?spine/i]),
		head: findNamedTarget(objects, [/^head$/i, /head/i]),
		neck: findNamedTarget(objects, [/^neck$/i, /neck/i]),
		leftUpperArm: findNamedTarget(objects, [/left.*upper.*arm/i, /upper.*arm.*l/i, /shoulder.*l/i, /left.*arm/i]),
		rightUpperArm: findNamedTarget(objects, [
			/right.*upper.*arm/i,
			/upper.*arm.*r/i,
			/shoulder.*r/i,
			/right.*arm/i,
		]),
		leftForeArm: findNamedTarget(objects, [/left.*fore.*arm/i, /fore.*arm.*l/i, /left.*lower.*arm/i]),
		rightForeArm: findNamedTarget(objects, [/right.*fore.*arm/i, /fore.*arm.*r/i, /right.*lower.*arm/i]),
		leftHand: findNamedTarget(objects, [/^left.*hand$/i, /hand.*l/i, /left.*wrist/i]),
		rightHand: findNamedTarget(objects, [/^right.*hand$/i, /hand.*r/i, /right.*wrist/i]),
	};
}

function makeLightningLine(color: THREE.Color) {
	const positions = new Float32Array(24 * 3);
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
	const material = new THREE.LineBasicMaterial({
		color,
		transparent: true,
		opacity: 0,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
	});
	const line = new THREE.Line(geometry, material);
	line.frustumCulled = false;
	line.renderOrder = 10;
	return line;
}

function createLightningRuntime(): LightningRuntime {
	const group = new THREE.Group();
	group.name = "YSong Performance Lightning";
	const color = new THREE.Color(0x9fdcff);
	const left = Array.from({ length: 4 }, () => makeLightningLine(color));
	const right = Array.from({ length: 4 }, () => makeLightningLine(color));
	for (const line of [...left, ...right]) group.add(line);
	const leftLight = new THREE.PointLight(color, 0, 10, 2);
	const rightLight = new THREE.PointLight(color, 0, 10, 2);
	group.add(leftLight, rightLight);
	return { group, left, right, leftLight, rightLight };
}

function updateLightningLine(
	line: THREE.Line,
	start: THREE.Vector3,
	end: THREE.Vector3,
	branch: number,
	time: number,
	strength: number,
	color: THREE.Color,
) {
	const material = line.material as THREE.LineBasicMaterial;
	material.color.copy(color);
	if (strength <= 0.015) {
		material.opacity = 0;
		line.visible = false;
		return;
	}
	const attr = line.geometry.getAttribute("position") as THREE.BufferAttribute;
	const positions = attr.array as Float32Array;
	const count = attr.count;
	const direction = end.clone().sub(start);
	const length = Math.max(0.001, direction.length());
	const normalA = new THREE.Vector3(0, 1, 0).cross(direction).normalize();
	if (normalA.lengthSq() < 0.01) normalA.set(1, 0, 0);
	const normalB = direction.clone().normalize().cross(normalA).normalize();
	for (let i = 0; i < count; i++) {
		const t = i / (count - 1);
		const envelope = Math.sin(Math.PI * t);
		const jitterScale = length * (0.016 + branch * 0.006) * envelope * strength;
		const noiseA = Math.sin(i * 12.9898 + branch * 4.31 + time * (19 + branch * 2));
		const noiseB = Math.cos(i * 7.233 + branch * 9.17 + time * (15 + branch * 3));
		const point = start
			.clone()
			.addScaledVector(direction, t)
			.addScaledVector(normalA, noiseA * jitterScale)
			.addScaledVector(normalB, noiseB * jitterScale);
		positions[i * 3] = point.x;
		positions[i * 3 + 1] = point.y;
		positions[i * 3 + 2] = point.z;
	}
	attr.needsUpdate = true;
	material.opacity = Math.max(0, Math.min(1, strength * (0.95 - branch * 0.12)));
	line.visible = true;
}

function performanceWeight(now: number, runtime: PerformanceRuntime) {
	if (!runtime.active || runtime.durationMs <= 0) return { progress: 0, weight: 0, impact: 0 };
	const progress = Math.max(0, Math.min(1, (now - runtime.startedAt) / runtime.durationMs));
	const attack = Math.min(1, progress / 0.16);
	const release = Math.min(1, (1 - progress) / 0.24);
	const weight = THREE.MathUtils.smoothstep(Math.min(attack, release), 0, 1);
	const impact = Math.exp(-Math.pow((progress - 0.44) / 0.105, 2));
	return { progress, weight, impact };
}

function chooseAutoCue(scene: VisualSceneState, audio: VisualAudioFrame, runtime: PerformanceRuntime, now: number) {
	const perf = scene.performance;
	if (!perf.autoDirector) return null;
	const minGap = (Math.max(0.55, perf.minimumCooldown) * 1000) / Math.max(0.35, perf.directorIntensity);
	if (now - runtime.lastAutoAt < minGap) return null;
	const kickEdge = audio.kick > 0.55 && runtime.lastKick <= 0.55;
	const energyEdge = audio.energy > 0.68 && runtime.lastEnergy <= 0.58;
	const bassEdge = audio.bass > 0.72 && runtime.lastBass <= 0.62;
	const highsEdge = audio.highs > 0.72 && runtime.lastHighs <= 0.62;
	let preferred: string[] = [];
	if (kickEdge)
		preferred =
			perf.directorMode === "aggressive"
				? ["pound-screen", "recoil", "rage-release", "head-snap", "stagger"]
				: ["recoil", "head-snap", "energy-release", "reach-camera"];
	else if (energyEdge)
		preferred =
			perf.directorMode === "ethereal"
				? ["high-ascension", "angelic-open", "raise-hands", "dual-lightning"]
				: ["open-arms", "rage-build", "dual-lightning", "energy-gather"];
	else if (bassEdge)
		preferred =
			perf.directorMode === "aggressive"
				? ["grab-camera", "bass-possession", "rage-build", "pound-screen"]
				: ["bass-possession", "reach-camera", "curious-lean", "protective"];
	else if (highsEdge) preferred = ["lightning-left", "lightning-right", "wave-left", "wave-right", "look-up"];
	else if (audio.energy < 0.16 && now - runtime.lastAutoAt > minGap * 2.6)
		preferred =
			perf.directorMode === "emotional"
				? ["look-down", "sorrow-curl", "mourn", "watch-audience"]
				: ["breathe", "slow-sway", "watch-audience", "predator-stare"];
	if (!preferred.length) return null;
	const modePool = AUTO_POOLS[perf.directorMode] ?? AUTO_POOLS.balanced;
	const candidates = [...preferred, ...modePool].filter(
		(id, index, all) => all.indexOf(id) === index && !runtime.recent.slice(-4).includes(id),
	);
	const ids = candidates.length ? candidates : preferred;
	const index = Math.abs(Math.floor(audio.sequence * 17 + now * 0.013)) % ids.length;
	return PERFORMANCE_BY_ID.get(ids[index]) ?? null;
}

function triggerPerformance(
	runtime: PerformanceRuntime,
	cue: VisualPerformanceCue,
	strength: number,
	source: "manual" | "auto" | "timeline",
	now: number,
) {
	runtime.active = cue;
	runtime.startedAt = now;
	runtime.durationMs = Math.max(250, cue.duration * 1000);
	runtime.strength = Math.max(0.1, Math.min(2, strength));
	runtime.source = source;
	if (source === "auto") runtime.lastAutoAt = now;
	runtime.recent.push(cue.id);
	if (runtime.recent.length > 12) runtime.recent.splice(0, runtime.recent.length - 12);
}

function applyCueToMannequin(
	rig: MannequinRig,
	cue: VisualPerformanceCue | null,
	weight: number,
	strength: number,
	headTrack: number,
) {
	if (!cue || weight <= 0) return;
	const w = weight * strength;
	rig.spine.rotation.x += (cue.bodyLean ?? 0) * w;
	rig.spine.rotation.y += (cue.bodyTwist ?? 0) * w;
	rig.chest.rotation.y += (cue.bodyTwist ?? 0) * w * 0.55;
	rig.head.rotation.x += (cue.headPitch ?? 0) * w;
	rig.head.rotation.y += ((cue.headYaw ?? 0) - (cue.bodyTwist ?? 0) * headTrack) * w;
	rig.head.rotation.z += (cue.headRoll ?? 0) * w;
	rig.leftShoulder.rotation.x += (cue.leftArmX ?? 0) * w;
	rig.rightShoulder.rotation.x += (cue.rightArmX ?? 0) * w;
	// YSong behavior cues use positive left / negative right values as outward motion.
	// The procedural mannequin local shoulder axes are mirrored, so invert the cue
	// signs here instead of stacking every behavior onto a crossed-arm pose.
	rig.leftShoulder.rotation.z -= (cue.leftArmZ ?? 0) * w;
	rig.rightShoulder.rotation.z -= (cue.rightArmZ ?? 0) * w;
	rig.leftElbow.rotation.z += (cue.leftElbowZ ?? 0) * w;
	rig.rightElbow.rotation.z += (cue.rightElbowZ ?? 0) * w;
}

function applyCueToTargets(
	targets: RigTargets,
	cue: VisualPerformanceCue | null,
	weight: number,
	strength: number,
	headTrack: number,
) {
	if (!cue || weight <= 0) return;
	const w = weight * strength;
	targets.spine?.rotateX((cue.bodyLean ?? 0) * w * 0.7);
	targets.spine?.rotateY((cue.bodyTwist ?? 0) * w * 0.7);
	targets.chest?.rotateY((cue.bodyTwist ?? 0) * w * 0.45);
	targets.head?.rotateX((cue.headPitch ?? 0) * w * 0.72);
	targets.head?.rotateY(((cue.headYaw ?? 0) - (cue.bodyTwist ?? 0) * headTrack) * w * 0.72);
	targets.head?.rotateZ((cue.headRoll ?? 0) * w * 0.72);
	// Most humanoid GLB rigs extend arm bones along +/-X. Y turns them toward the camera,
	// while Z raises/lowers them. The side-aware signs keep both hands moving symmetrically.
	targets.leftUpperArm?.rotateY(-(cue.leftArmX ?? 0) * w * 0.78);
	targets.rightUpperArm?.rotateY((cue.rightArmX ?? 0) * w * 0.78);
	targets.leftUpperArm?.rotateZ(-(cue.leftArmZ ?? 0) * w * 0.78);
	targets.rightUpperArm?.rotateZ(-(cue.rightArmZ ?? 0) * w * 0.78);
	targets.leftForeArm?.rotateZ(-(cue.leftElbowZ ?? 0) * w * 0.72);
	targets.rightForeArm?.rotateZ(-(cue.rightElbowZ ?? 0) * w * 0.72);
}

function getRendererName(renderer: THREE.WebGLRenderer) {
	const gl = renderer.getContext();
	const ext = gl.getExtension("WEBGL_debug_renderer_info");
	if (!ext) return "GPU renderer available";
	const name = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
	return typeof name === "string" && name.trim() ? name : "GPU renderer available";
}

function disposeObject3D(root: THREE.Object3D) {
	root.traverse((object: THREE.Object3D) => {
		const mesh = object as THREE.Mesh;
		if (mesh.geometry) mesh.geometry.dispose();
		const material = mesh.material;
		if (Array.isArray(material)) material.forEach((item) => item.dispose());
		else material?.dispose?.();
	});
}

function makeMaterial(color: number) {
	return new THREE.MeshStandardMaterial({
		color,
		metalness: 0.28,
		roughness: 0.42,
		emissive: new THREE.Color(0x3d176e),
		emissiveIntensity: 0.12,
	});
}

function createMannequin(): MannequinRig {
	const root = new THREE.Group();
	root.name = "YSong Procedural Performer";
	const dark = makeMaterial(0x30457c);
	const accent = makeMaterial(0x7252ba);
	const skin = makeMaterial(0x6674aa);
	const materials = [dark, accent, skin];
	const addBox = (
		parent: THREE.Object3D,
		size: [number, number, number],
		pos: [number, number, number],
		material = dark,
	) => {
		const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
		mesh.position.set(...pos);
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		parent.add(mesh);
		return mesh;
	};
	const addSphere = (parent: THREE.Object3D, radius: number, pos: [number, number, number], material = skin) => {
		const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 20, 14), material);
		mesh.position.set(...pos);
		mesh.castShadow = true;
		parent.add(mesh);
		return mesh;
	};

	const hips = new THREE.Group();
	hips.position.y = -0.65;
	root.add(hips);
	addBox(hips, [1.05, 0.55, 0.55], [0, 0, 0], accent);
	const spine = new THREE.Group();
	spine.position.y = 0.28;
	hips.add(spine);
	addBox(spine, [0.92, 1.25, 0.54], [0, 0.63, 0]);
	const chest = new THREE.Group();
	chest.position.y = 1.15;
	spine.add(chest);
	addBox(chest, [1.46, 1.25, 0.66], [0, 0.45, 0], dark);
	const neck = new THREE.Group();
	neck.position.y = 1.15;
	chest.add(neck);
	addBox(neck, [0.34, 0.34, 0.34], [0, 0.12, 0], accent);
	const head = new THREE.Group();
	head.position.y = 0.55;
	neck.add(head);
	addSphere(head, 0.52, [0, 0.2, 0], skin);

	const makeArm = (side: -1 | 1) => {
		const shoulder = new THREE.Group();
		shoulder.position.set(side * 0.86, 0.72, 0);
		chest.add(shoulder);
		addSphere(shoulder, 0.22, [0, 0, 0], accent);
		addBox(shoulder, [0.34, 1.35, 0.38], [side * 0.04, -0.66, 0], dark);
		const elbow = new THREE.Group();
		elbow.position.set(side * 0.04, -1.32, 0);
		shoulder.add(elbow);
		addSphere(elbow, 0.19, [0, 0, 0], accent);
		addBox(elbow, [0.3, 1.25, 0.34], [0, -0.6, 0], dark);
		const hand = new THREE.Group();
		hand.position.y = -1.2;
		elbow.add(hand);
		addSphere(hand, 0.24, [0, -0.08, 0], skin);
		return { shoulder, elbow, hand };
	};
	const leftArm = makeArm(-1);
	const rightArm = makeArm(1);

	const makeLeg = (side: -1 | 1) => {
		const hip = new THREE.Group();
		hip.position.set(side * 0.34, -0.28, 0);
		hips.add(hip);
		addSphere(hip, 0.21, [0, 0, 0], accent);
		addBox(hip, [0.42, 1.55, 0.48], [0, -0.76, 0], dark);
		const knee = new THREE.Group();
		knee.position.y = -1.5;
		hip.add(knee);
		addSphere(knee, 0.21, [0, 0, 0], accent);
		addBox(knee, [0.37, 1.48, 0.43], [0, -0.72, 0], dark);
		const foot = new THREE.Group();
		foot.position.y = -1.43;
		knee.add(foot);
		addBox(foot, [0.48, 0.28, 0.92], [0, -0.08, 0.22], accent);
	};
	makeLeg(-1);
	makeLeg(1);
	return {
		root,
		spine,
		chest,
		head,
		leftShoulder: leftArm.shoulder,
		rightShoulder: rightArm.shoulder,
		leftElbow: leftArm.elbow,
		rightElbow: rightArm.elbow,
		leftHand: leftArm.hand,
		rightHand: rightArm.hand,
		materials,
	};
}

function createCrystal() {
	const group = new THREE.Group();
	const materials = [makeMaterial(0x5b49cb), makeMaterial(0x9c6de8), makeMaterial(0x2c78d7)];
	for (const [scale, material] of [
		[1, materials[0]],
		[0.58, materials[1]],
		[1.32, materials[2]],
	] as const) {
		const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(scale, 0), material);
		mesh.castShadow = true;
		group.add(mesh);
	}
	return { root: group, materials };
}

function makeParticles() {
	const positions = new Float32Array(MAX_PARTICLES * 3);
	const colors = new Float32Array(MAX_PARTICLES * 3);
	const seeds = new Float32Array(MAX_PARTICLES * 4);
	for (let i = 0; i < MAX_PARTICLES; i++) {
		seeds[i * 4] = Math.random();
		seeds[i * 4 + 1] = Math.random();
		seeds[i * 4 + 2] = Math.random();
		seeds[i * 4 + 3] = Math.random();
		colors[i * 3] = 0.62;
		colors[i * 3 + 1] = 0.55;
		colors[i * 3 + 2] = 1;
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
	const material = new THREE.PointsMaterial({
		color: 0xffffff,
		vertexColors: true,
		size: 0.035,
		transparent: true,
		opacity: 0.72,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		sizeAttenuation: true,
		alphaTest: 0.02,
	});
	const points = new THREE.Points(geometry, material);
	points.frustumCulled = false;
	return { points, geometry, material, positions, colors, seeds };
}

function makeWeatherParticles() {
	const positions = new Float32Array(MAX_WEATHER_PARTICLES * 3);
	const colors = new Float32Array(MAX_WEATHER_PARTICLES * 3);
	const seeds = new Float32Array(MAX_WEATHER_PARTICLES * 4);
	for (let i = 0; i < MAX_WEATHER_PARTICLES; i++) {
		const hash = (n: number) => {
			const v = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
			return v - Math.floor(v);
		};
		seeds[i * 4] = hash(i + 1);
		seeds[i * 4 + 1] = hash(i + 101.7);
		seeds[i * 4 + 2] = hash(i + 907.1);
		seeds[i * 4 + 3] = hash(i + 1907.9);
		colors[i * 3] = 1;
		colors[i * 3 + 1] = 1;
		colors[i * 3 + 2] = 1;
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
	geometry.setDrawRange(0, 0);
	const material = new THREE.PointsMaterial({
		color: 0xffffff,
		vertexColors: true,
		size: 0.065,
		transparent: true,
		opacity: 0.9,
		depthWrite: false,
		sizeAttenuation: true,
		blending: THREE.NormalBlending,
	});
	const points = new THREE.Points(geometry, material);
	points.frustumCulled = false;
	points.renderOrder = 8;
	return { points, geometry, material, positions, colors, seeds };
}

function makeRainStreaks() {
	const positions = new Float32Array(MAX_RAIN_STREAKS * 2 * 3);
	const seeds = new Float32Array(MAX_RAIN_STREAKS * 4);
	for (let i = 0; i < MAX_RAIN_STREAKS; i++) {
		const hash = (n: number) => {
			const v = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
			return v - Math.floor(v);
		};
		seeds[i * 4] = hash(i + 31.1);
		seeds[i * 4 + 1] = hash(i + 231.7);
		seeds[i * 4 + 2] = hash(i + 1187.3);
		seeds[i * 4 + 3] = hash(i + 3301.9);
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
	geometry.setDrawRange(0, 0);
	const material = new THREE.LineBasicMaterial({
		color: 0xb9d9f7,
		transparent: true,
		opacity: 0.68,
		depthWrite: false,
		depthTest: true,
		blending: THREE.NormalBlending,
		toneMapped: false,
	});
	const lines = new THREE.LineSegments(geometry, material);
	lines.frustumCulled = false;
	lines.renderOrder = 8;
	return { lines, geometry, material, positions, seeds };
}

function wrappedWeather(value: number, span: number) {
	const half = span * 0.5;
	return ((((value + half) % span) + span) % span) - half;
}

function makePrimitiveGeometry(primitive: VisualPrimitiveObject) {
	const sx = Math.max(0.01, primitive.sizeX),
		sy = Math.max(0.01, primitive.sizeY),
		sz = Math.max(0.01, primitive.sizeZ);
	const radius = Math.max(0.01, primitive.radius),
		height = Math.max(0.01, primitive.height),
		segments = Math.max(3, Math.min(128, Math.round(primitive.segments)));
	switch (primitive.primitive) {
		case "sphere":
			return new THREE.SphereGeometry(radius, segments, Math.max(2, Math.round(segments / 2)));
		case "icosphere":
			return new THREE.IcosahedronGeometry(radius, Math.max(0, Math.min(5, Math.round(Math.log2(segments / 8)))));
		case "cylinder":
			return new THREE.CylinderGeometry(radius, radius, height, segments, Math.max(1, Math.round(segments / 8)));
		case "cone":
			return new THREE.ConeGeometry(radius, height, segments, Math.max(1, Math.round(segments / 8)));
		case "capsule":
			return new THREE.CapsuleGeometry(
				radius,
				Math.max(0.01, height - radius * 2),
				Math.max(4, Math.round(segments / 4)),
				segments,
			);
		case "plane":
			return new THREE.PlaneGeometry(
				sx,
				sz,
				Math.max(1, Math.round(segments / 8)),
				Math.max(1, Math.round(segments / 8)),
			);
		case "torus":
			return new THREE.TorusGeometry(
				radius,
				Math.max(0.01, primitive.tubeRadius),
				Math.max(3, Math.round(segments / 2)),
				segments,
			);
		case "pyramid":
			return new THREE.ConeGeometry(Math.max(sx, sz) * 0.5, sy, 4, 1);
		default:
			return new THREE.BoxGeometry(
				sx,
				sy,
				sz,
				Math.max(1, Math.round(segments / 16)),
				Math.max(1, Math.round(segments / 16)),
				Math.max(1, Math.round(segments / 16)),
			);
	}
}

function autoHumanoidMap(bones: THREE.Bone[]): Partial<Record<VisualHumanoidSlot, string>> {
	const pick = (patterns: RegExp[]) => findNamedTarget(bones, patterns)?.name;
	return {
		root: pick([/^root$/i, /armature/i]),
		hips: pick([/^hips$/i, /pelvis|hip/i]),
		spine: pick([/^spine$/i, /spine/i]),
		chest: pick([/^chest$/i, /upper.?chest|upper.?spine/i]),
		neck: pick([/^neck$/i, /neck/i]),
		head: pick([/^head$/i, /head/i]),
		leftShoulder: pick([/left.*shoulder/i, /shoulder.*l/i]),
		leftUpperArm: pick([/left.*upper.*arm/i, /upper.*arm.*l/i, /left.*arm/i]),
		leftForeArm: pick([/left.*fore.*arm/i, /fore.*arm.*l/i, /left.*lower.*arm/i]),
		leftHand: pick([/^left.*hand$/i, /hand.*l/i, /left.*wrist/i]),
		rightShoulder: pick([/right.*shoulder/i, /shoulder.*r/i]),
		rightUpperArm: pick([/right.*upper.*arm/i, /upper.*arm.*r/i, /right.*arm/i]),
		rightForeArm: pick([/right.*fore.*arm/i, /fore.*arm.*r/i, /right.*lower.*arm/i]),
		rightHand: pick([/^right.*hand$/i, /hand.*r/i, /right.*wrist/i]),
		leftUpperLeg: pick([/left.*upper.*leg/i, /left.*thigh/i, /thigh.*l/i]),
		leftLowerLeg: pick([/left.*lower.*leg/i, /left.*calf/i, /shin.*l/i]),
		leftFoot: pick([/^left.*foot/i, /foot.*l/i, /left.*ankle/i]),
		rightUpperLeg: pick([/right.*upper.*leg/i, /right.*thigh/i, /thigh.*r/i]),
		rightLowerLeg: pick([/right.*lower.*leg/i, /right.*calf/i, /shin.*r/i]),
		rightFoot: pick([/^right.*foot/i, /foot.*r/i, /right.*ankle/i]),
	};
}

function sampleSkeletalTrack(
	animation: VisualSkeletalAnimation,
	target: string,
	property: "rotation" | "position" | "scale",
	time: number,
) {
	const frames = animation.keyframes
		.filter((key) => key.target === target && key.property === property)
		.sort((a, b) => a.time - b.time);
	if (!frames.length) return null;
	if (frames.length === 1 || time <= frames[0].time) return frames[0];
	if (time >= frames[frames.length - 1].time) return frames[frames.length - 1];
	let left = frames[0],
		right = frames[frames.length - 1];
	for (let i = 1; i < frames.length; i++)
		if (frames[i].time >= time) {
			left = frames[i - 1];
			right = frames[i];
			break;
		}
	const raw = (time - left.time) / Math.max(0.0001, right.time - left.time);
	const t = right.easing === "linear" ? raw : raw * raw * (3 - 2 * raw);
	return {
		...left,
		x: THREE.MathUtils.lerp(left.x, right.x, t),
		y: THREE.MathUtils.lerp(left.y, right.y, t),
		z: THREE.MathUtils.lerp(left.z, right.z, t),
	};
}

function solveCcdIk(
	effector: THREE.Object3D,
	joints: THREE.Object3D[],
	target: THREE.Vector3,
	weight: number,
	iterations: number,
	maxAngleDegrees: number,
) {
	const w = Math.max(0, Math.min(1, weight));
	if (w <= 0.0001 || !joints.length) return;
	const identity = new THREE.Quaternion();
	const effWorld = new THREE.Vector3();
	const localEff = new THREE.Vector3();
	const localTarget = new THREE.Vector3();
	const delta = new THREE.Quaternion();
	const maxAngle = THREE.MathUtils.degToRad(Math.max(1, maxAngleDegrees));
	for (let iteration = 0; iteration < Math.max(1, Math.min(12, iterations)); iteration++) {
		for (const joint of joints) {
			joint.updateWorldMatrix(true, true);
			effector.getWorldPosition(effWorld);
			localEff.copy(effWorld);
			joint.worldToLocal(localEff);
			localTarget.copy(target);
			joint.worldToLocal(localTarget);
			if (localEff.lengthSq() < 1e-8 || localTarget.lengthSq() < 1e-8) continue;
			delta.setFromUnitVectors(localEff.normalize(), localTarget.normalize());
			const angle = identity.angleTo(delta);
			if (angle < 1e-5) continue;
			const fraction = Math.min(1, maxAngle / angle) * w;
			const limited = identity.clone().slerp(delta, fraction);
			joint.quaternion.premultiply(limited).normalize();
			joint.updateMatrixWorld(true);
		}
	}
}

function blendLookAt(object: THREE.Object3D, target: THREE.Vector3, weight: number) {
	const w = Math.max(0, Math.min(1, weight));
	if (w <= 0.0001) return;
	const before = object.quaternion.clone();
	object.lookAt(target);
	const desired = object.quaternion.clone();
	object.quaternion.copy(before).slerp(desired, w).normalize();
}

function setParticlePosition(
	index: number,
	scene: VisualSceneState,
	positions: Float32Array,
	seeds: Float32Array,
	life: number,
	time: number,
	audio: number,
	windX = 0,
	windZ = 0,
	windTurbulence = 0,
) {
	const i3 = index * 3;
	const i4 = index * 4;
	const sx = seeds[i4] * 2 - 1;
	const sy = seeds[i4 + 1] * 2 - 1;
	const sz = seeds[i4 + 2];
	const phase = seeds[i4 + 3] * Math.PI * 2;
	const spread = scene.particles.spread;
	const depth = scene.particles.depth;
	let x = sx * spread * 0.55;
	let y = sy * spread * 0.42;
	let z = -life * depth;
	if (scene.particles.emitter === "sphere") {
		const theta = phase + time * scene.particles.orbit;
		const phi = Math.acos(Math.max(-1, Math.min(1, sy)));
		const r = spread * (0.2 + sz * 0.35);
		x = Math.sin(phi) * Math.cos(theta) * r;
		y = Math.cos(phi) * r;
		z = Math.sin(phi) * Math.sin(theta) * r - depth * 0.45;
	} else if (scene.particles.emitter === "ring") {
		const theta = phase + time * (0.2 + scene.particles.orbit);
		const r = spread * (0.42 + sz * 0.08);
		x = Math.cos(theta) * r;
		y = Math.sin(theta) * r;
		z = -depth * 0.45 + sy * 0.7;
	} else if (scene.particles.emitter === "fountain") {
		const t = life;
		x = sx * spread * 0.18 + Math.sin(phase + time) * scene.particles.turbulence * 0.45;
		y = -2.7 + t * spread * 0.92 - t * t * (2.2 + Math.max(0, scene.particles.gravity) * 2.2);
		z = -depth * 0.5 + sy * spread * 0.22;
	} else if (scene.particles.emitter === "tunnel") {
		const theta = phase + time * scene.particles.orbit;
		const r = spread * (0.12 + sz * 0.5);
		x = Math.cos(theta) * r;
		y = Math.sin(theta) * r;
		z = -1.4 - (1 - life) * depth;
	}
	const turbulence = scene.particles.turbulence * (0.12 + audio * 0.28) + windTurbulence * 0.12;
	x += Math.sin(time * 1.1 + phase * 3) * turbulence;
	y += Math.cos(time * 0.9 + phase * 2) * turbulence;
	y -= scene.particles.gravity * life * life * 0.8;
	x += windX * life * 0.9;
	z += windZ * life * 0.9;
	positions[i3] = x + scene.particles.positionX;
	positions[i3 + 1] = y + scene.particles.positionY;
	positions[i3 + 2] = z + scene.particles.positionZ;
}

function applyPose(
	rig: MannequinRig,
	scene: VisualSceneState,
	body: number,
	arms: number,
	idleTime: number,
	spring: number,
) {
	const idle = scene.object.idleAmount;
	const pose = scene.object.pose;
	const baseArm = pose === "cruciform" ? Math.PI / 2 : pose === "reach" ? 0.34 : 0.12;
	const sway = Math.sin(idleTime * 0.75) * idle * 0.18;
	rig.spine.rotation.z = sway + body * 0.34;
	rig.spine.rotation.x = body * 0.22;
	rig.chest.rotation.y = -sway * 0.7 + body * 0.25;
	rig.head.rotation.z = -sway * 0.65 + spring * 0.18;
	rig.head.rotation.x = body * -0.12 + spring * 0.09;
	// Mirrored shoulder axes: negative Z on the left and positive Z on the right
	// opens the arms. The previous signs crossed them permanently across the chest.
	const armSwing = arms * 0.42;
	rig.leftShoulder.rotation.z = -baseArm - armSwing;
	rig.rightShoulder.rotation.z = baseArm + armSwing;
	rig.leftShoulder.rotation.x = pose === "reach" ? -0.62 - arms * 0.38 : -arms * 0.18;
	rig.rightShoulder.rotation.x = pose === "reach" ? -0.62 - arms * 0.38 : -arms * 0.18;
	rig.leftElbow.rotation.z = pose === "reach" ? -0.28 - arms * 0.22 : -0.1 - arms * 0.18;
	rig.rightElbow.rotation.z = pose === "reach" ? 0.28 + arms * 0.22 : 0.1 + arms * 0.18;
	rig.leftHand.rotation.z = spring * 0.55;
	rig.rightHand.rotation.z = -spring * 0.55;
}

function reactiveValue(raw: number, scene: VisualSceneState) {
	const dead = Math.max(0, Math.min(0.8, scene.object.deadZone));
	if (raw <= dead) return 0;
	return Math.max(0, Math.min(1.5, ((raw - dead) / Math.max(0.001, 1 - dead)) * scene.object.sensitivity));
}

function envelope(current: number, target: number, attack: number, release: number) {
	const amount = target > current ? attack : release;
	return current + (target - current) * Math.max(0.01, Math.min(1, amount));
}

export default function VisualOutput() {
	const threeCanvasRef = useRef<HTMLCanvasElement | null>(null);
	const spectrumRef = useRef<HTMLCanvasElement | null>(null);
	const sceneRef = useRef<VisualSceneState>(structuredClone(DEFAULT_VISUAL_SCENE));
	const audioRef = useRef<VisualAudioFrame>(ZERO_AUDIO);
	const transportRef = useRef<VisualTransportState>(ZERO_TRANSPORT);
	const sceneHydratedRef = useRef(false);
	const roomEffectPulsesRef = useRef(new Map<VisualRoomAudienceEffectId, RoomVisualEffectPulse>());
	const roomEffectSeenRef = useRef(new Set<string>());
	const [scene, setScene] = useState<VisualSceneState>(() => structuredClone(DEFAULT_VISUAL_SCENE));
	const [sceneHydrated, setSceneHydrated] = useState(false);
	const [audioState, setAudioState] = useState<VisualAudioFrame>(ZERO_AUDIO);
	const [transport, setTransport] = useState<VisualTransportState>(ZERO_TRANSPORT);
	const [overlayModulationDeltas, setOverlayModulationDeltas] = useState<Record<string, number>>({});
	const [error, setError] = useState("");
	const query = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
	const embedded = query.get("embedded") === "1";
	const programPreview = embedded && query.get("program") === "1";
	const monitorMode = embedded && query.get("monitor") === "1";
	const editorFreeRoam = embedded && !programPreview;
	const editorFxPreview = editorFreeRoam && query.get("fx") !== "0";
	const obsMode = query.get("obs") === "1";
	const renderWidth = monitorMode ? 480 : embedded ? PREVIEW_WIDTH : PROGRAM_WIDTH;
	const renderHeight = monitorMode ? 270 : embedded ? PREVIEW_HEIGHT : PROGRAM_HEIGHT;
	const qualitySelection = editorFreeRoam ? scene.renderer.editorQuality : scene.renderer.programQuality;
	const antialiasEnabled = editorFreeRoam ? scene.renderer.editorAntialias : scene.renderer.programAntialias;

	// Install scene receipt before WebGL setup. The parent may send its first snapshot
	// on iframe load, while the renderer effect is still constructing its runtime.
	useEffect(() => {
		if (!embedded) return;
		const receiveScene = (event: MessageEvent) => {
			if (event.origin !== window.location.origin || event.source !== window.parent || event.data?.type !== "ysong-scene-sync") return;
			if (!event.data.scene || typeof event.data.scene !== "object") return;
			const next = normalizeVisualScene(event.data.scene as VisualSceneState);
			sceneRef.current = next;
			sceneHydratedRef.current = true;
			setSceneHydrated(true);
			setScene(next);
		};
		window.addEventListener("message", receiveScene);
		return () => window.removeEventListener("message", receiveScene);
	}, [embedded]);

	useEffect(() => {
		let cancelled = false;
		// Embedded renderers receive the editor's current logical scene directly. A Bridge
		// snapshot may lag behind local edits and must not replace that scene during load.
		if (!embedded) void bridgeApi
			.getVisualScene<VisualSceneState>()
			.then((payload) => {
				if (cancelled) return;
				const next = normalizeVisualScene(payload.scene);
				sceneRef.current = next;
				sceneHydratedRef.current = true;
				setSceneHydrated(true);
				setScene(next);
			})
			.catch(() => {});
		void bridgeApi
			.getVisualAudio()
			.then((frame) => {
				if (!cancelled) {
					audioRef.current = frame;
					setAudioState(frame);
				}
			})
			.catch(() => {});
		void bridgeApi
			.getVisualTransport()
			.then((next) => {
				if (!cancelled) {
					transportRef.current = next;
					setTransport(next);
				}
			})
			.catch(() => {});
		const stopScene = embedded ? () => {} : bridgeApi.subscribeVisualScene<VisualSceneState>((payload) => {
			const next = normalizeVisualScene(payload.scene);
			sceneRef.current = next;
			sceneHydratedRef.current = true;
			setSceneHydrated(true);
			setScene(next);
		});
		const setAudioFrame = (frame: VisualAudioFrame) => {
			audioRef.current = frame;
			setAudioState(frame);
		};
		const setTransportFrame = (next: VisualTransportState) => {
			transportRef.current = next;
			setTransport(next);
		};
		// In-editor/program windows use the local realtime bus so multiple SSE streams do not
		// saturate the browser's per-origin connection pool. OBS stays on Bridge SSE.
		const stopAudio = obsMode
			? bridgeApi.subscribeVisualAudio(setAudioFrame)
			: subscribeLocalVisualAudio(setAudioFrame);
		const stopTransport = obsMode
			? bridgeApi.subscribeVisualTransport(setTransportFrame)
			: subscribeLocalVisualTransport(setTransportFrame);
		return () => {
			cancelled = true;
			stopScene();
			stopAudio();
			stopTransport();
		};
	}, [embedded, obsMode]);

	useEffect(() => {
		const trigger = (effect: VisualRoomAudienceEffect) => {
			if (
				!effect?.eventId ||
				roomEffectSeenRef.current.has(effect.eventId) ||
				!(effect.effectId in ROOM_EFFECT_DURATION_MS)
			)
				return;
			roomEffectSeenRef.current.add(effect.eventId);
			if (roomEffectSeenRef.current.size > 256) {
				const first = roomEffectSeenRef.current.values().next().value;
				if (first) roomEffectSeenRef.current.delete(first);
			}
			const startedAt = performance.now();
			roomEffectPulsesRef.current.set(effect.effectId, {
				effectId: effect.effectId,
				eventId: effect.eventId,
				startedAt,
				until: startedAt + ROOM_EFFECT_DURATION_MS[effect.effectId],
			});
		};
		const stopLocal = subscribeRoomVenueEvents((_roomId, event) => {
			if (event.kind !== "effect") return;
			const effectId = String(event.payload?.effectId || "") as VisualRoomAudienceEffectId;
			if (!(effectId in ROOM_EFFECT_DURATION_MS)) return;
			trigger({
				roomId: event.roomId,
				eventId: event.id,
				effectId,
				actorName: event.actorName,
				timestampUnixMs: Date.now(),
			});
		});
		const stopBridge = obsMode
			? bridgeApi.subscribeVisualRoomEffects((payload) => trigger(payload.effect))
			: () => {};
		return () => {
			stopLocal();
			stopBridge();
		};
	}, [obsMode]);

	useEffect(() => {
		const previousTitle = document.title;
		document.title = YSONG_VISUAL_OUTPUT_TITLE;
		document.documentElement.style.background = "#000";
		document.body.style.background = "#000";
		document.body.style.overflow = "hidden";
		return () => {
			document.title = previousTitle;
		};
	}, []);

	useEffect(() => {
		const channel = new BroadcastChannel(YSONG_VISUALS_CHANNEL);
		const canvas = threeCanvasRef.current;
		const spectrumCanvas = spectrumRef.current;
		if (!canvas || !spectrumCanvas) return () => channel.close();
		const spectrum2d = spectrumCanvas.getContext("2d");
		if (!spectrum2d) return () => channel.close();

		let renderer: THREE.WebGLRenderer;
		try {
			renderer = new THREE.WebGLRenderer({
				canvas,
				alpha: true,
				antialias: false,
				powerPreference: "high-performance",
				premultipliedAlpha: false,
			});
		} catch (caught) {
			const message = caught instanceof Error ? caught.message : "WebGL renderer initialization failed.";
			setError(message);
			channel.postMessage({
				type: "visual-output-error",
				timestamp: Date.now(),
				message,
			} satisfies VisualOutputError);
			return () => channel.close();
		}
		const rendererName = getRendererName(renderer);
		const rendererCapabilities = readVisualRendererCapabilities(renderer, rendererName);
		const customQuality = {
			renderScale: scene.renderer.renderScale,
			antialiasMode: scene.renderer.antialiasMode,
			shadowMapSize: scene.stage.shadowMapSize,
			secondarySubsteps: scene.physics.secondarySubsteps,
			secondaryIterations: scene.physics.secondaryIterations,
		};
		let runtimeQuality: VisualRuntimeQuality = resolveVisualRuntimeQuality(
			qualitySelection,
			rendererCapabilities,
			customQuality,
		);
		if (!antialiasEnabled) runtimeQuality = { ...runtimeQuality, antialiasMode: "off" };
		let adaptiveScale = scene.renderer.adaptiveResolution
			? Math.max(scene.renderer.adaptiveMinScale, Math.min(scene.renderer.adaptiveMaxScale, 1))
			: 1;
		const fittedRender = fitVisualRenderSize(
			renderWidth,
			renderHeight,
			runtimeQuality.renderScale * adaptiveScale,
			rendererCapabilities,
		);
		let targetWidth = fittedRender.width;
		let targetHeight = fittedRender.height;
		let effectiveRenderScale = fittedRender.scale;

		renderer.setPixelRatio(1);
		renderer.setSize(targetWidth, targetHeight, false);
		renderer.setClearColor(0x000000, 0);
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		renderer.outputColorSpace = THREE.SRGBColorSpace;
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.toneMappingExposure = 1.05;

		const threeScene = new THREE.Scene();
		const camera = new THREE.PerspectiveCamera(52, renderWidth / renderHeight, 0.1, 250);
		camera.position.set(0, 0.3, 7.4);
		camera.lookAt(0, 0, 0);
		threeScene.add(camera);

		// Background media is rendered in its own orthographic pass. It is not part of the
		// lit/fogged 3D world at all, so Stage visibility, fog, lights, shadows and camera
		// navigation cannot make a video/still disappear. The main 3D scene renders on top
		// without clearing this pass. A Skybox/Sky Sphere is normal background-only geometry
		// in the main scene, so it is the one intentional environment that can cover media.
		const backgroundScene = new THREE.Scene();
		backgroundScene.background = new THREE.Color(editorFreeRoam ? 0x9b9b9b : 0x000000);
		const backgroundCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
		// Sky environments get their own pass. Rendering them in the authored 3D scene
		// made them vulnerable to render-pass clear/depth behavior and could leave the
		// editor workbench visible even though a valid texture was loaded.
		const environmentScene = new THREE.Scene();
		const environmentCamera = new THREE.PerspectiveCamera(52, renderWidth / renderHeight, 0.1, 250);
		environmentCamera.position.set(0, 0, 0);
		const mediaGeometry = new THREE.PlaneGeometry(2, 2);
		const mediaMaterial = new THREE.MeshBasicMaterial({
			color: 0xffffff,
			transparent: false,
			depthTest: false,
			depthWrite: false,
			toneMapped: false,
			fog: false,
		});
		const mediaPlane = new THREE.Mesh(mediaGeometry, mediaMaterial);
		mediaPlane.frustumCulled = false;
		mediaPlane.visible = false;
		backgroundScene.add(mediaPlane);
		const mediaTextureLoader = new THREE.TextureLoader();
		mediaTextureLoader.setCrossOrigin("anonymous");
		let backgroundTexture: THREE.Texture | null = null;
		let backgroundVideo: HTMLVideoElement | null = null;
		let backgroundMediaKey = "";
		let backgroundMediaAspect = 16 / 9;
		let backgroundMediaFailed = "";

		const clearBackgroundMedia = () => {
			if (backgroundVideo) {
				backgroundVideo.pause();
				backgroundVideo.removeAttribute("src");
				backgroundVideo.load();
				backgroundVideo = null;
			}
			if (backgroundTexture) {
				backgroundTexture.dispose();
				backgroundTexture = null;
			}
			mediaMaterial.map = null;
			mediaMaterial.needsUpdate = true;
			mediaPlane.visible = false;
		};

		const reportBackgroundMediaError = (key: string, message: string) => {
			if (backgroundMediaFailed === key) return;
			backgroundMediaFailed = key;
			channel.postMessage({
				type: "visual-output-error",
				timestamp: Date.now(),
				message,
			} satisfies VisualOutputError);
		};

		const assignBackgroundTexture = (key: string, texture: THREE.Texture, aspect: number) => {
			if (backgroundMediaKey !== key) {
				texture.dispose();
				return;
			}
			if (backgroundTexture && backgroundTexture !== texture) backgroundTexture.dispose();
			backgroundTexture = texture;
			backgroundTexture.colorSpace = THREE.SRGBColorSpace;
			backgroundTexture.anisotropy = runtimeQuality.maxAnisotropy;
			backgroundTexture.wrapS = THREE.ClampToEdgeWrapping;
			backgroundTexture.wrapT = THREE.ClampToEdgeWrapping;
			backgroundMediaAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
			mediaMaterial.map = backgroundTexture;
			mediaMaterial.needsUpdate = true;
			backgroundMediaFailed = "";
		};

		const ensureBackgroundMedia = (layer: VisualLayer) => {
			const key = `${layer.id}|${layer.mediaKind}|${layer.mediaUrl ?? ""}`;
			if (backgroundMediaKey === key && (backgroundTexture || backgroundMediaFailed === key)) return;
			clearBackgroundMedia();
			backgroundMediaKey = key;
			backgroundMediaFailed = "";
			if (!layer.mediaUrl) return;
			if (layer.mediaKind === "video") {
				const video = document.createElement("video");
				video.crossOrigin = "anonymous";
				video.muted = true;
				video.playsInline = true;
				video.preload = "auto";
				video.loop = layer.loop !== false;
				video.src = layer.mediaUrl;
				backgroundVideo = video;
				const texture = new THREE.VideoTexture(video);
				texture.minFilter = THREE.LinearFilter;
				texture.magFilter = THREE.LinearFilter;
				texture.generateMipmaps = false;
				assignBackgroundTexture(key, texture, 16 / 9);
				const refreshVideoFrame = () => {
					if (backgroundMediaKey === key) texture.needsUpdate = true;
				};
				video.addEventListener("loadedmetadata", () => {
					if (backgroundMediaKey !== key) return;
					backgroundMediaAspect =
						video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : 16 / 9;
					refreshVideoFrame();
				});
				video.addEventListener("loadeddata", refreshVideoFrame);
				video.addEventListener("seeked", refreshVideoFrame);
				video.addEventListener("error", () =>
					reportBackgroundMediaError(
						key,
						`Could not decode background video: ${layer.fileName || layer.name}. Re-import the file if it was moved or the saved media URL is stale.`,
					),
				);
				video.load();
				video.load();
				return;
			}
			mediaTextureLoader.load(
				layer.mediaUrl,
				(texture) => {
					const image = texture.image as
						| { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number }
						| undefined;
					const width = image?.naturalWidth || image?.width || 16;
					const height = image?.naturalHeight || image?.height || 9;
					assignBackgroundTexture(key, texture, height > 0 ? width / height : 16 / 9);
				},
				undefined,
				() =>
					reportBackgroundMediaError(
						key,
						`Could not load background image: ${layer.fileName || layer.name}. Re-import the file if its saved media URL is stale.`,
					),
			);
		};

		const frameBackgroundMedia = (layer: VisualLayer) => {
			const targetAspect = renderWidth / renderHeight;
			const texture = backgroundTexture;
			if (!texture) return;
			texture.repeat.set(1, 1);
			texture.offset.set(0, 0);
			let widthFactor = 1;
			let heightFactor = 1;
			if ((layer.fit ?? "cover") === "cover") {
				if (backgroundMediaAspect > targetAspect) {
					const repeatX = targetAspect / backgroundMediaAspect;
					texture.repeat.x = repeatX;
					texture.offset.x = (1 - repeatX) / 2;
				} else {
					const repeatY = backgroundMediaAspect / targetAspect;
					texture.repeat.y = repeatY;
					texture.offset.y = (1 - repeatY) / 2;
				}
			} else if (backgroundMediaAspect > targetAspect) heightFactor = targetAspect / backgroundMediaAspect;
			else widthFactor = backgroundMediaAspect / targetAspect;
			mediaPlane.scale.set(widthFactor, heightFactor, 1);
		};

		// Sky environments are deliberately simple and background-only. They stay centered
		// on the camera, do not receive fog/light/shadows, and render after background media
		// but before every normal 3D object. This makes Skybox/Sky Sphere the only scene
		// environment intended to replace a background video or still image.
		const skyTextureLoader = new THREE.TextureLoader();
		skyTextureLoader.setCrossOrigin("anonymous");
		const loadSkyTextureUrl = (url: string, onLoad: (texture: THREE.Texture) => void, onError?: () => void) => {
			const finish = (texture: THREE.Texture) => {
				texture.colorSpace = THREE.SRGBColorSpace;
				texture.anisotropy = runtimeQuality.maxAnisotropy;
				texture.minFilter = THREE.LinearMipmapLinearFilter;
				texture.magFilter = THREE.LinearFilter;
				texture.generateMipmaps = true;
				texture.needsUpdate = true;
				onLoad(texture);
			};
			// Bridge media URLs are local HTTP resources. Fetch + ImageBitmap avoids the
			// intermittent HTMLImage/TextureLoader stalls observed after scene hydration.
			if (typeof createImageBitmap === "function") {
				fetch(url, { cache: "no-store" })
					.then((response) => {
						if (!response.ok) throw new Error(`HTTP ${response.status}`);
						return response.blob();
					})
					.then((blob) => createImageBitmap(blob, { imageOrientation: "flipY" }))
					.then((bitmap) => {
						const texture = new THREE.Texture(bitmap);
						texture.userData.ysongImageBitmap = bitmap;
						finish(texture);
					})
					.catch(() => skyTextureLoader.load(url, finish, undefined, () => onError?.()));
				return;
			}
			skyTextureLoader.load(url, finish, undefined, () => onError?.());
		};
		const skySphereMaterial = new THREE.MeshBasicMaterial({
			color: 0xffffff,
			side: THREE.BackSide,
			fog: false,
			toneMapped: false,
			depthTest: false,
			depthWrite: false,
		});
		let skySphereGeometry = new THREE.SphereGeometry(70, 64, 32);
		const skySphere = new THREE.Mesh(skySphereGeometry, skySphereMaterial);
		skySphere.renderOrder = -9000;
		skySphere.frustumCulled = false;
		skySphere.visible = false;
		environmentScene.add(skySphere);
		const skyBoxMaterials = Array.from(
			{ length: 6 },
			() =>
				new THREE.MeshBasicMaterial({
					color: 0xffffff,
					side: THREE.BackSide,
					fog: false,
					toneMapped: false,
					depthTest: false,
					depthWrite: false,
				}),
		);
		const skyBoxGeometry = new THREE.BoxGeometry(110, 110, 110);
		const skyBox = new THREE.Mesh(skyBoxGeometry, skyBoxMaterials);
		skyBox.renderOrder = -9000;
		skyBox.frustumCulled = false;
		skyBox.visible = false;
		environmentScene.add(skyBox);
		let skySphereUrl = "";
		let skySphereLoadingUrl = "";
		let skySphereTexture: THREE.Texture | null = null;
		let skySpherePolygonTarget = 0;
		const skyBoxUrls = ["", "", "", "", "", ""];
		const skyBoxTextures: Array<THREE.Texture | null> = [null, null, null, null, null, null];
		const prepSkyTexture = (texture: THREE.Texture, equirectangular = false) => {
			texture.colorSpace = THREE.SRGBColorSpace;
			texture.mapping = equirectangular ? THREE.EquirectangularReflectionMapping : THREE.UVMapping;
			texture.anisotropy = runtimeQuality.maxAnisotropy;
			texture.wrapS = THREE.RepeatWrapping;
			texture.wrapT = THREE.ClampToEdgeWrapping;
			texture.minFilter = THREE.LinearMipmapLinearFilter;
			texture.magFilter = THREE.LinearFilter;
			texture.generateMipmaps = true;
			texture.needsUpdate = true;
			return texture;
		};
		const setSkySphereUrl = (url: string) => {
			if (url === skySphereUrl && (!url || !!skySphereTexture || skySphereLoadingUrl === url)) return;
			skySphereUrl = url;
			if (skySphereTexture) {
				skySphereTexture.dispose();
				skySphereTexture = null;
			}
			skySphereMaterial.map = null;
			skySphereMaterial.needsUpdate = true;
			environmentScene.background = null;
			if (!url) {
				skySphereLoadingUrl = "";
				return;
			}
			skySphereLoadingUrl = url;
			loadSkyTextureUrl(
				url,
				(texture) => {
					if (skySphereUrl !== url) {
						texture.dispose();
						return;
					}
					skySphereLoadingUrl = "";
					skySphereTexture = prepSkyTexture(texture, true);
					// Use the environment scene background for equirectangular skies. This is
					// camera-centered by definition and avoids inside-sphere/depth/order failures.
					environmentScene.background = skySphereTexture;
				},
				() => {
					if (skySphereUrl === url) skySphereLoadingUrl = "";
					reportBackgroundMediaError(`sky-sphere|${url}`, "Could not load the Sky Sphere texture.");
				},
			);
		};
		const setSkyBoxFace = (index: number, url: string) => {
			if (skyBoxUrls[index] === url) return;
			skyBoxUrls[index] = url;
			if (skyBoxTextures[index]) {
				skyBoxTextures[index]?.dispose();
				skyBoxTextures[index] = null;
			}
			skyBoxMaterials[index].map = null;
			skyBoxMaterials[index].needsUpdate = true;
			if (!url) return;
			loadSkyTextureUrl(
				url,
				(texture) => {
					if (skyBoxUrls[index] !== url) {
						texture.dispose();
						return;
					}
					skyBoxTextures[index] = prepSkyTexture(texture);
					skyBoxMaterials[index].map = skyBoxTextures[index];
					skyBoxMaterials[index].needsUpdate = true;
				},
				() =>
					reportBackgroundMediaError(`sky-box-${index}|${url}`, "Could not load one of the Skybox textures."),
			);
		};
		const updateSky = (state: VisualSceneState, transportPosition: number) => {
			const layer = state.layers.find((candidate) => candidate.type === "sky");
			const active = !!layer && visualLayerActive(layer, transportPosition);
			if (!active) {
				skySphere.visible = false;
				skyBox.visible = false;
				environmentScene.background = null;
				return;
			}
			environmentCamera.fov = camera.fov;
			environmentCamera.aspect = camera.aspect;
			environmentCamera.near = 0.1;
			environmentCamera.far = 250;
			environmentCamera.updateProjectionMatrix();
			environmentCamera.quaternion.copy(camera.quaternion);
			const brightness =
				Math.max(0, Math.min(3, state.sky.brightness)) * Math.max(0, Math.min(1, layer?.opacity ?? 1));
			if (state.sky.mode === "sphere") {
				const requestedPolygons = Math.max(
					256,
					Math.min(
						runtimeQuality.skyPolygonCap,
						Math.min(65536, Math.round(state.sky.spherePolygons || 4096)),
					),
				);
				if (requestedPolygons !== skySpherePolygonTarget) {
					skySpherePolygonTarget = requestedPolygons;
					const widthSegments = Math.max(8, Math.min(256, Math.round(Math.sqrt(requestedPolygons))));
					const heightSegments = Math.max(4, Math.min(128, Math.round(widthSegments / 2)));
					skySphereGeometry.dispose();
					skySphereGeometry = new THREE.SphereGeometry(70, widthSegments, heightSegments);
					skySphere.geometry = skySphereGeometry;
				}
				setSkySphereUrl(state.sky.sphereUrl || "");
				// Render the equirectangular image on an inside-facing, camera-centered sphere.
				// This is intentionally a real background draw between the editor/media pass
				// and authored 3D geometry. Scene.background was unreliable when the main
				// RenderPass is configured with clear=false, leaving the gray workbench visible.
				skySphere.position.set(0, 0, 0);
				skySphere.rotation.set(0, state.sky.rotationY || 0, 0);
				skySphereMaterial.color.setRGB(brightness, brightness, brightness);
				// Sphere mode is rendered as an equirectangular scene background. Keep the
				// legacy mesh hidden so there is only one authoritative sky path.
				skySphere.visible = false;
				environmentScene.background = skySphereTexture;
				environmentScene.backgroundIntensity = brightness;
				environmentScene.backgroundRotation.set(
					state.sky.rotationX || 0,
					state.sky.rotationY || 0,
					state.sky.rotationZ || 0,
				);
				skyBox.visible = false;
				return;
			}
			environmentScene.background = null;
			const urls = [
				state.sky.boxRightUrl,
				state.sky.boxLeftUrl,
				state.sky.boxTopUrl,
				state.sky.boxBottomUrl,
				state.sky.boxFrontUrl,
				state.sky.boxBackUrl,
			];
			urls.forEach((url, index) => setSkyBoxFace(index, url || ""));
			for (const material of skyBoxMaterials) material.color.setScalar(brightness);
			skyBox.position.set(0, 0, 0);
			skyBox.rotation.set(
				state.sky.rotationX || 0,
				state.sky.rotationY || 0,
				state.sky.rotationZ || 0,
			);
			skyBox.visible = urls.every(Boolean) && skyBoxTextures.every(Boolean);
			skySphere.visible = false;
		};

		// Embedded preview gets an editor-only FPS camera. Program Output/OBS never
		// consumes this state. Empty-space click reliably captures pointer lock.
		const editorKeys = new Set<string>();
		let editorYaw = 0;
		let editorPitch = 0;
		let editorFast = false;
		let editorPanning = false;
		let hoveredSelectableId = "";
		let selectedSelectableId = "";
		let suppressEditorClick = false;
		let modelPlacementActive = false;
		const modelPlacementPreview = new THREE.Vector3();
		let lastEditorCameraPost = 0;
		const editorForward = new THREE.Vector3();
		const editorRight = new THREE.Vector3();
		const editorUp = new THREE.Vector3();
		canvas.tabIndex = 0;
		const updateEditorAxes = () => {
			editorForward
				.set(
					-Math.sin(editorYaw) * Math.cos(editorPitch),
					Math.sin(editorPitch),
					-Math.cos(editorYaw) * Math.cos(editorPitch),
				)
				.normalize();
			editorRight.crossVectors(editorForward, camera.up).normalize();
			editorUp.crossVectors(editorRight, editorForward).normalize();
		};
		const clearEditorInput = () => {
			editorKeys.clear();
			editorFast = false;
			editorPanning = false;
		};
		const resetEditorToProgramCamera = () => {
			if (!editorFreeRoam) return;
			const state = sceneRef.current;
			const active = resolveVisualProgramCamera(
				state,
				extrapolatedTransportPosition(transportRef.current),
			);
			if (!active) return;
			const sampled = sampleVisualProgramCamera(active, extrapolatedTransportPosition(transportRef.current));
			camera.position.set(sampled.positionX, sampled.positionY, sampled.positionZ);
			camera.fov = Math.max(10, Math.min(140, sampled.fov));
			camera.near = Math.max(0.01, active.near);
			camera.far = Math.max(camera.near + 0.1, active.far);
			camera.updateProjectionMatrix();
			const forward = new THREE.Vector3(0, 0, -1);
			if (active.aimMode === "rotation") {
				const q = new THREE.Quaternion().setFromEuler(
					new THREE.Euler(sampled.rotationX, sampled.rotationY, sampled.rotationZ, "XYZ"),
				);
				forward.applyQuaternion(q).normalize();
			} else {
				let tx = sampled.targetX,
					ty = sampled.targetY,
					tz = sampled.targetZ;
				if (active.targetMode === "performer") {
					tx = state.object.positionX + sampled.targetOffsetX;
					ty = state.object.positionY + sampled.targetOffsetY;
					tz = state.object.positionZ + sampled.targetOffsetZ;
				}
				forward.set(tx - sampled.positionX, ty - sampled.positionY, tz - sampled.positionZ).normalize();
			}
			editorPitch = Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1));
			editorYaw = Math.atan2(-forward.x, -forward.z);
			camera.lookAt(camera.position.clone().add(forward));
			if (document.pointerLockElement === canvas) document.exitPointerLock();
		};
		const setEditorOrientation = (view: string) => {
			if (!editorFreeRoam) return;
			switch (view) {
				case "front":
					editorYaw = 0;
					editorPitch = 0;
					break;
				case "back":
					editorYaw = Math.PI;
					editorPitch = 0;
					break;
				case "left":
					editorYaw = Math.PI / 2;
					editorPitch = 0;
					break;
				case "right":
					editorYaw = -Math.PI / 2;
					editorPitch = 0;
					break;
				case "top":
					editorPitch = -1.48;
					break;
				case "bottom":
					editorPitch = 1.48;
					break;
				default:
					editorYaw = -Math.PI / 4;
					editorPitch = -0.42;
					break;
			}
			updateEditorAxes();
			camera.lookAt(camera.position.clone().add(editorForward));
			if (document.pointerLockElement === canvas) document.exitPointerLock();
		};
		const orbitEditorOrientation = (dx: number, dy: number) => {
			if (!editorFreeRoam) return;
			editorYaw -= Number.isFinite(dx) ? dx : 0;
			editorPitch = Math.max(-1.48, Math.min(1.48, editorPitch - (Number.isFinite(dy) ? dy : 0)));
			updateEditorAxes();
			camera.lookAt(camera.position.clone().add(editorForward));
		};
		const moveEditorCamera = (right: number, forward: number, up: number) => {
			if (!editorFreeRoam) return;
			updateEditorAxes();
			camera.position.addScaledVector(editorRight, THREE.MathUtils.clamp(right, -1, 1) * 0.5);
			camera.position.addScaledVector(editorForward, THREE.MathUtils.clamp(forward, -1, 1) * 0.5);
			camera.position.y += THREE.MathUtils.clamp(up, -1, 1) * 0.5;
		};
		const onEditorKeyDown = (event: KeyboardEvent) => {
			if (!editorFreeRoam) return;
			if (event.code === "Home") {
				event.preventDefault();
				resetEditorToProgramCamera();
				return;
			}
			editorKeys.add(event.code);
			if (event.code === "ShiftLeft" || event.code === "ShiftRight") editorFast = true;
		};
		const onEditorKeyUp = (event: KeyboardEvent) => {
			if (!editorFreeRoam) return;
			editorKeys.delete(event.code);
			if (event.code === "ShiftLeft" || event.code === "ShiftRight") editorFast = false;
		};
		const onEditorMouseMove = (event: MouseEvent) => {
			if (!editorFreeRoam) return;
			updateEditorAxes();
			if (editorPanning) {
				const panScale = editorFast ? 0.018 : 0.009;
				camera.position.addScaledVector(editorRight, -event.movementX * panScale);
				camera.position.addScaledVector(editorUp, event.movementY * panScale);
				return;
			}
			if (document.pointerLockElement !== canvas) return;
			editorYaw -= event.movementX * 0.0022;
			editorPitch = Math.max(-1.48, Math.min(1.48, editorPitch - event.movementY * 0.0022));
		};
		const onPointerLockChange = () => {
			if (!editorFreeRoam) return;
			const active = document.pointerLockElement === canvas;
			if (!active) clearEditorInput();
			canvas.style.cursor = active ? "none" : hoveredSelectableId ? "pointer" : "crosshair";
			window.parent.postMessage({ type: "ysong-editor-free-roam", active }, window.location.origin);
		};
		const onPointerLockError = () => {
			clearEditorInput();
			canvas.style.cursor = hoveredSelectableId ? "pointer" : "crosshair";
			window.parent.postMessage(
				{ type: "ysong-editor-free-roam", active: false, error: true },
				window.location.origin,
			);
		};
		const onEditorClick = (event: MouseEvent) => {
			if (suppressEditorClick) {
				suppressEditorClick = false;
				return;
			}
			if (!editorFreeRoam || placementState || modelPlacementActive) return;
			canvas.focus({ preventScroll: true });
			if (document.pointerLockElement === canvas) {
				document.exitPointerLock();
				return;
			}
			updateEditorPick(event);
			if (hoveredSelectableId) {
				window.parent.postMessage(
					{ type: "ysong-visual-select", id: hoveredSelectableId },
					window.location.origin,
				);
				return;
			}
			try {
				const result = canvas.requestPointerLock();
				if (result && typeof (result as Promise<void>).catch === "function")
					void (result as Promise<void>).catch(onPointerLockError);
			} catch {
				onPointerLockError();
			}
		};
		const onEditorContextMenu = (event: MouseEvent) => {
			if (!editorFreeRoam) return;
			event.preventDefault();
			event.stopPropagation();
			if (document.pointerLockElement === canvas) {
				document.exitPointerLock();
				return;
			}
			updateEditorPick(event);
			if (!hoveredSelectableId) return;
			window.parent.postMessage(
				{
					type: "ysong-visual-contextmenu",
					id: hoveredSelectableId,
					kind: hoveredSelectableId.startsWith("program-camera-") ? "camera" : "layer",
					clientX: event.clientX,
					clientY: event.clientY,
				},
				window.location.origin,
			);
		};
		const onEditorWheel = (event: WheelEvent) => {
			if (!editorFreeRoam) return;
			event.preventDefault();
			updateEditorAxes();
			const amount = Math.max(-2.4, Math.min(2.4, -event.deltaY * (editorFast ? 0.018 : 0.009)));
			camera.position.addScaledVector(editorForward, amount);
		};
		const onEditorMouseDown = (event: MouseEvent) => {
			if (editorFreeRoam && !placementState && !modelPlacementActive && event.button === 1) {
				event.preventDefault();
				canvas.focus({ preventScroll: true });
				editorPanning = true;
			}
		};
		const onEditorMouseUp = (event: MouseEvent) => {
			if (event.button === 1) editorPanning = false;
		};
		const onWindowBlur = () => clearEditorInput();
		const onVisibility = () => {
			if (document.hidden) {
				clearEditorInput();
				if (document.pointerLockElement === canvas) document.exitPointerLock();
			}
		};
		if (editorFreeRoam) {
			window.addEventListener("keydown", onEditorKeyDown);
			window.addEventListener("keyup", onEditorKeyUp);
			window.addEventListener("mousemove", onEditorMouseMove);
			window.addEventListener("mouseup", onEditorMouseUp);
			window.addEventListener("blur", onWindowBlur);
			document.addEventListener("visibilitychange", onVisibility);
			document.addEventListener("pointerlockchange", onPointerLockChange);
			document.addEventListener("pointerlockerror", onPointerLockError);
			canvas.addEventListener("mousedown", onEditorMouseDown);
			canvas.addEventListener("wheel", onEditorWheel, { passive: false });
			canvas.addEventListener("click", onEditorClick);
			canvas.addEventListener("contextmenu", onEditorContextMenu);
		}

		// Editor-only scene helpers. They are not part of Program Output or OBS.
		// The frustum is a compact DCC-style truncated pyramid with a real near plane;
		// it deliberately does not extend to the camera's potentially huge far clip.
		const cameraHelperRoot = new THREE.Group();
		cameraHelperRoot.name = "YSong Editor Camera Helpers";
		cameraHelperRoot.visible = false; // hidden until a dedicated Gizmos toggle lands; camera frustums must never block Scene interaction
		threeScene.add(cameraHelperRoot);
		type CameraHelperRuntime = {
			root: THREE.Group;
			frustum: THREE.LineSegments;
			forward: THREE.Line;
			target: THREE.Line;
			path: THREE.Line;
			pathSignature: string;
			fallback: THREE.Group;
			model: THREE.Object3D | null;
			materialCopies: THREE.Material[];
		};
		const cameraHelpers = new Map<string, CameraHelperRuntime>();
		let filmCameraTemplate: THREE.Object3D | null = null;
		let filmCameraRequested = false;
		const fbxLoader = new FBXLoader();
		const makeFallbackCamera = () => {
			const root = new THREE.Group();
			const wire = new THREE.MeshBasicMaterial({
				color: 0x56d6ff,
				wireframe: true,
				transparent: true,
				opacity: 0.9,
				depthTest: true,
			});
			const body = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.32, 0.58), wire);
			body.position.z = 0.18;
			root.add(body);
			const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 0.34, 12), wire);
			lens.rotation.x = Math.PI / 2;
			lens.position.z = -0.28;
			root.add(lens);
			return root;
		};
		const cloneCameraModel = (source: THREE.Object3D) => {
			const model = source.clone(true);
			const materials: THREE.Material[] = [];
			model.traverse((child) => {
				if (!(child instanceof THREE.Mesh)) return;
				const originals = Array.isArray(child.material) ? child.material : [child.material];
				const clones = originals.map((material) => {
					const copy = material.clone();
					copy.transparent = true;
					copy.depthWrite = true;
					materials.push(copy);
					return copy;
				});
				child.material = Array.isArray(child.material) ? clones : clones[0];
			});
			// Imported helper was authored looking +X. YSong Program Cameras look -Z.
			model.rotation.y += Math.PI / 2;
			return { model, materials };
		};
		const requestFilmCamera = () => {
			if (filmCameraRequested || !editorFreeRoam) return;
			filmCameraRequested = true;
			fbxLoader.load(
				"/visuals/filmCamera.fbx",
				(object) => {
					const bounds = new THREE.Box3().setFromObject(object);
					const size = bounds.getSize(new THREE.Vector3());
					const maxDim = Math.max(size.x, size.y, size.z, 0.001);
					object.scale.multiplyScalar(0.8 / maxDim);
					const normalizedBounds = new THREE.Box3().setFromObject(object);
					const center = normalizedBounds.getCenter(new THREE.Vector3());
					object.position.sub(center);
					filmCameraTemplate = object;
					for (const helper of cameraHelpers.values()) {
						if (helper.model) continue;
						helper.fallback.visible = false;
						const cloned = cloneCameraModel(object);
						helper.model = cloned.model;
						helper.materialCopies.push(...cloned.materials);
						helper.root.add(cloned.model);
					}
				},
				undefined,
				() => {
					/* fallback camera stays visible */
				},
			);
		};
		const createFrustum = () => {
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(24 * 3), 3));
			const material = new THREE.LineBasicMaterial({
				color: 0x67e8f9,
				transparent: true,
				opacity: 0.68,
				depthTest: true,
			});
			const lines = new THREE.LineSegments(geometry, material);
			lines.renderOrder = 900;
			return lines;
		};
		const updateFrustumGeometry = (lines: THREE.LineSegments, programCamera: VisualProgramCamera) => {
			const near = Math.max(0.03, Math.min(programCamera.near, programCamera.helperLength * 0.35));
			const far = Math.max(near + 0.05, programCamera.helperLength);
			const halfFov = THREE.MathUtils.degToRad(Math.max(1, Math.min(179, programCamera.fov))) * 0.5;
			const nh = Math.tan(halfFov) * near,
				nw = nh * (renderWidth / renderHeight);
			const fh = Math.tan(halfFov) * far,
				fw = fh * (renderWidth / renderHeight);
			const n = [
				[-nw, -nh, -near],
				[nw, -nh, -near],
				[nw, nh, -near],
				[-nw, nh, -near],
			];
			const f = [
				[-fw, -fh, -far],
				[fw, -fh, -far],
				[fw, fh, -far],
				[-fw, fh, -far],
			];
			const segs: number[][] = [];
			for (let i = 0; i < 4; i++) {
				segs.push(n[i], n[(i + 1) % 4], f[i], f[(i + 1) % 4], n[i], f[i]);
			}
			const attr = lines.geometry.getAttribute("position") as THREE.BufferAttribute;
			let k = 0;
			for (const point of segs) {
				attr.setXYZ(k++, point[0], point[1], point[2]);
			}
			attr.needsUpdate = true;
			lines.geometry.computeBoundingSphere();
		};
		const ensureCameraHelpers = (state: VisualSceneState, timelineSeconds: number) => {
			if (!editorFreeRoam) return;
			requestFilmCamera();
			const valid = new Set(state.cameras.map((programCamera) => programCamera.id));
			for (const [id, helper] of cameraHelpers)
				if (!valid.has(id)) {
					cameraHelperRoot.remove(helper.root);
					cameraHelperRoot.remove(helper.path);
					helper.frustum.geometry.dispose();
					(helper.frustum.material as THREE.Material).dispose();
					helper.forward.geometry.dispose();
					(helper.forward.material as THREE.Material).dispose();
					helper.target.geometry.dispose();
					(helper.target.material as THREE.Material).dispose();
					helper.path.geometry.dispose();
					(helper.path.material as THREE.Material).dispose();
					helper.materialCopies.forEach((material) => material.dispose());
					cameraHelpers.delete(id);
				}
			for (const programCamera of state.cameras) {
				let helper = cameraHelpers.get(programCamera.id);
				if (!helper) {
					const root = new THREE.Group();
					root.name = programCamera.name;
					root.userData.ysongSelectableId = programCamera.id;
					const fallback = makeFallbackCamera();
					root.add(fallback);
					const frustum = createFrustum();
					frustum.userData.ysongSelectableId = programCamera.id;
					root.add(frustum);
					const forwardGeometry = new THREE.BufferGeometry().setFromPoints([
						new THREE.Vector3(),
						new THREE.Vector3(0, 0, -3),
					]);
					const forward = new THREE.Line(
						forwardGeometry,
						new THREE.LineBasicMaterial({ color: 0xfde68a, transparent: true, opacity: 0.8 }),
					);
					root.add(forward);
					const targetGeometry = new THREE.BufferGeometry().setFromPoints([
						new THREE.Vector3(),
						new THREE.Vector3(0, 0, -3),
					]);
					const target = new THREE.Line(
						targetGeometry,
						new THREE.LineDashedMaterial({
							color: 0xc084fc,
							transparent: true,
							opacity: 0.72,
							dashSize: 0.22,
							gapSize: 0.14,
						}),
					);
					root.add(target);
					const path = new THREE.Line(
						new THREE.BufferGeometry(),
						new THREE.LineBasicMaterial({
							color: 0x22d3ee,
							transparent: true,
							opacity: 0.52,
							depthTest: true,
						}),
					);
					path.renderOrder = 880;
					path.visible = false;
					cameraHelperRoot.add(path);
					let model: THREE.Object3D | null = null;
					const materialCopies: THREE.Material[] = [];
					if (filmCameraTemplate) {
						const cloned = cloneCameraModel(filmCameraTemplate);
						model = cloned.model;
						materialCopies.push(...cloned.materials);
						fallback.visible = false;
						root.add(model);
					}
					root.traverse((child) => {
						child.userData.ysongSelectableId = programCamera.id;
					});
					helper = {
						root,
						frustum,
						forward,
						target,
						path,
						pathSignature: "",
						fallback,
						model,
						materialCopies,
					};
					cameraHelpers.set(programCamera.id, helper);
					cameraHelperRoot.add(root);
				}
				const sampled = sampleVisualProgramCamera(programCamera, timelineSeconds);
				helper.root.visible = programCamera.enabled;
				helper.root.position.set(sampled.positionX, sampled.positionY, sampled.positionZ);
				let targetX = sampled.targetX,
					targetY = sampled.targetY,
					targetZ = sampled.targetZ;
				if (programCamera.targetMode === "performer") {
					targetX = performerRoot.position.x + sampled.targetOffsetX;
					targetY = performerRoot.position.y + sampled.targetOffsetY;
					targetZ = performerRoot.position.z + sampled.targetOffsetZ;
				} else if (programCamera.targetMode === "primitive" && programCamera.targetEntityId) {
					const targetRuntime = primitiveRuntime.get(programCamera.targetEntityId);
					if (targetRuntime) {
						const point = new THREE.Vector3();
						targetRuntime.mesh.getWorldPosition(point);
						targetX = point.x + sampled.targetOffsetX;
						targetY = point.y + sampled.targetOffsetY;
						targetZ = point.z + sampled.targetOffsetZ;
					}
				}
				if (programCamera.aimMode === "rotation")
					helper.root.rotation.set(sampled.rotationX, sampled.rotationY, sampled.rotationZ);
				else {
					const proxy = new THREE.PerspectiveCamera();
					proxy.position.copy(helper.root.position);
					proxy.lookAt(targetX, targetY, targetZ);
					helper.root.quaternion.copy(proxy.quaternion);
				}
				updateFrustumGeometry(helper.frustum, { ...programCamera, fov: sampled.fov });
				helper.frustum.visible = programCamera.showFov;
				helper.forward.visible = programCamera.showForward;
				const forwardAttr = helper.forward.geometry.getAttribute("position") as THREE.BufferAttribute;
				forwardAttr.setXYZ(1, 0, 0, -programCamera.helperLength);
				forwardAttr.needsUpdate = true;
				helper.target.visible = programCamera.showTarget;
				helper.root.updateMatrixWorld(true);
				const targetLocal = helper.root.worldToLocal(new THREE.Vector3(targetX, targetY, targetZ));
				const targetAttr = helper.target.geometry.getAttribute("position") as THREE.BufferAttribute;
				targetAttr.setXYZ(1, targetLocal.x, targetLocal.y, targetLocal.z);
				targetAttr.needsUpdate = true;
				helper.target.computeLineDistances();
				const pathSignature = [
					programCamera.showPath,
					programCamera.pathInterpolation,
					programCamera.pathClosed,
					programCamera.loop,
					...programCamera.keyframes.map(
						(k) => `${k.time}:${k.positionX}:${k.positionY}:${k.positionZ}:${k.easing || "inherit"}`,
					),
				].join("|");
				if (pathSignature !== helper.pathSignature) {
					helper.pathSignature = pathSignature;
					helper.path.geometry.dispose();
					const frames = [...programCamera.keyframes].sort((a, b) => a.time - b.time);
					if (programCamera.showPath && frames.length > 1) {
						const first = frames[0].time,
							last = frames[frames.length - 1].time;
						const segments = Math.max(12, Math.min(160, (frames.length - 1) * 18));
						const points: THREE.Vector3[] = [];
						for (let i = 0; i <= segments; i++) {
							const t = THREE.MathUtils.lerp(first, last, i / segments);
							const sample = sampleVisualProgramCamera(programCamera, t);
							points.push(new THREE.Vector3(sample.positionX, sample.positionY, sample.positionZ));
						}
						helper.path.geometry = new THREE.BufferGeometry().setFromPoints(points);
						helper.path.visible = true;
					} else {
						helper.path.geometry = new THREE.BufferGeometry();
						helper.path.visible = false;
					}
				}
				helper.path.visible =
					programCamera.enabled && programCamera.showPath && programCamera.keyframes.length > 1;
				const distance = camera.position.distanceTo(helper.root.position);
				const fade = programCamera.fadeModelWhenNear ? THREE.MathUtils.smoothstep(distance, 0.35, 1.8) : 1;
				const modelVisible = programCamera.showModel && fade > 0.01;
				helper.fallback.visible = !helper.model && modelVisible;
				if (helper.model) helper.model.visible = modelVisible;
				const allMaterials: THREE.Material[] = [...helper.materialCopies];
				helper.fallback.traverse((child) => {
					if (child instanceof THREE.Mesh) {
						const ms = Array.isArray(child.material) ? child.material : [child.material];
						allMaterials.push(...ms);
					}
				});
				for (const material of allMaterials) {
					if ("opacity" in material) {
						const m = material as THREE.Material & { opacity: number };
						m.opacity = Math.max(0.02, fade);
						material.transparent = true;
						material.depthWrite = fade > 0.35;
					}
				}
			}
		};
		// Selection hover uses cursor/hierarchy feedback only. The old purple Box3Helper cage
		// was intentionally removed because it obscured the Scene viewport and intercepted attention.
		const raycaster = new THREE.Raycaster();
		const pointer = new THREE.Vector2();
		const selectableRoots = new Map<string, THREE.Object3D>();
		const transformProxy = new THREE.Object3D();
		threeScene.add(transformProxy);
		const transformControls = editorFreeRoam ? new TransformControls(camera, canvas) : null;
		if (transformControls) {
			transformControls.setSize(1.15);
			threeScene.add(transformControls.getHelper());
			canvas.style.touchAction = "none";
		}
		let transformDragging = false;
		let transformDirty = false;
		let transformStart: VisualTransform | null = null;
		let transformId = "";
		const syncTransformGizmo = () => {
			if (!transformControls || transformDragging || placementState || modelPlacementActive || document.pointerLockElement === canvas) {
				if (!transformDragging) transformControls?.detach();
				return;
			}
			const value = selectedVisualTransform(sceneRef.current, selectedSelectableId);
			if (!value || sceneRef.current.physics.enabled && sceneRef.current.physics.mode === "simulate") {
				transformControls.detach();
				return;
			}
			transformProxy.position.set(value.positionX, value.positionY, value.positionZ);
			transformProxy.rotation.set(value.rotationX, value.rotationY, value.rotationZ);
			transformProxy.scale.set(value.scaleX, value.scaleY, value.scaleZ);
			if (transformControls.object !== transformProxy) transformControls.attach(transformProxy);
		};
		transformControls?.addEventListener("dragging-changed", event => {
			transformDragging = Boolean(event.value);
			if (transformDragging) {
				transformId = selectedSelectableId;
				transformStart = selectedVisualTransform(sceneRef.current, transformId);
				transformDirty = false;
				if (document.pointerLockElement === canvas) document.exitPointerLock();
			} else {
				suppressEditorClick = true;
				if (transformDirty && transformStart)
					window.parent.postMessage({ type: "ysong-visual-transform", id: transformId, transform: selectedVisualTransform(sceneRef.current, transformId) }, window.location.origin);
				transformDirty = false;
				transformStart = null;
			}
		});
		transformControls?.addEventListener("objectChange", () => {
			if (!transformDragging || !transformStart) return;
			const value: VisualTransform = {
				positionX: transformProxy.position.x, positionY: transformProxy.position.y, positionZ: transformProxy.position.z,
				rotationX: transformProxy.rotation.x, rotationY: transformProxy.rotation.y, rotationZ: transformProxy.rotation.z,
				scaleX: transformProxy.scale.x, scaleY: transformProxy.scale.y, scaleZ: transformProxy.scale.z,
			};
			const layer = sceneRef.current.layers.find(item => item.id === transformId);
			if (layer?.type === "object") {
				const axis = transformControls.axis || "X";
				const uniform = axis.includes("Y") ? value.scaleY : axis.includes("Z") ? value.scaleZ : value.scaleX;
				value.scaleX = value.scaleY = value.scaleZ = uniform;
			}
			sceneRef.current = applyVisualTransform(sceneRef.current, transformId, value);
			transformDirty = true;
		});
		type PlacementRuntime = {
			primitive: VisualPrimitiveType;
			color: string;
			phase: "waiting" | "base" | "height";
			anchor: THREE.Vector3 | null;
			current: THREE.Vector3 | null;
			mesh: THREE.Mesh | null;
			height: number;
			heightMouseY: number;
			ignoreNextClick: boolean;
		};
		let placementState: PlacementRuntime | null = null;
		const placementGroundY = -3.15;
		const placementGround = new THREE.Plane(new THREE.Vector3(0, 1, 0), -placementGroundY);
		const placementPoint = (event: MouseEvent) => {
			const rect = canvas.getBoundingClientRect();
			pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
			pointer.y = -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
			raycaster.setFromCamera(pointer, camera);
			return raycaster.ray.intersectPlane(placementGround, new THREE.Vector3());
		};
		const placementGeometry = (type: VisualPrimitiveType) => {
			switch (type) {
				case "sphere":
					return new THREE.SphereGeometry(0.5, 24, 12);
				case "icosphere":
					return new THREE.IcosahedronGeometry(0.5, 2);
				case "cylinder":
					return new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
				case "cone":
					return new THREE.ConeGeometry(0.5, 1, 24);
				case "capsule":
					return new THREE.CapsuleGeometry(0.5, 0.1, 6, 16);
				case "plane":
					return new THREE.PlaneGeometry(1, 1);
				case "torus":
					return new THREE.TorusGeometry(0.5, 0.16, 12, 32);
				case "pyramid":
					return new THREE.ConeGeometry(0.5, 1, 4);
				default:
					return new THREE.BoxGeometry(1, 1, 1);
			}
		};
		const clearPlacement = (notify = false) => {
			const state = placementState;
			if (state?.mesh) {
				state.mesh.removeFromParent();
				state.mesh.geometry.dispose();
				const materials = Array.isArray(state.mesh.material) ? state.mesh.material : [state.mesh.material];
				materials.forEach((material) => material.dispose());
			}
			placementState = null;
			canvas.style.cursor = "crosshair";
			if (notify) window.parent.postMessage({ type: "ysong-primitive-placement-cancel" }, window.location.origin);
		};
		const startPlacement = (primitive: VisualPrimitiveType, color: string) => {
			clearPlacement(false);
			const material = new THREE.MeshStandardMaterial({
				color: new THREE.Color(color),
				roughness: 0.42,
				metalness: 0.08,
				transparent: true,
				opacity: 0.82,
				emissive: new THREE.Color(color).multiplyScalar(0.08),
				depthWrite: true,
			});
			const mesh = new THREE.Mesh(placementGeometry(primitive), material);
			mesh.castShadow = false;
			mesh.receiveShadow = false;
			mesh.renderOrder = 900;
			mesh.visible = false;
			if (primitive === "plane") mesh.rotation.x = -Math.PI / 2;
			threeScene.add(mesh);
			placementState = {
				primitive,
				color,
				phase: "waiting",
				anchor: null,
				current: null,
				mesh,
				height: 0.05,
				heightMouseY: 0,
				ignoreNextClick: false,
			};
			hoveredSelectableId = "";
			canvas.style.cursor = "crosshair";
			if (document.pointerLockElement === canvas) document.exitPointerLock();
		};
		const placementDimensions = (state: PlacementRuntime) => {
			const a = state.anchor ?? new THREE.Vector3(),
				b = state.current ?? a;
			const sx = Math.max(0.05, Math.abs(b.x - a.x)),
				sz = Math.max(0.05, Math.abs(b.z - a.z));
			const cx = (a.x + b.x) * 0.5,
				cz = (a.z + b.z) * 0.5;
			let sy = Math.max(0.05, state.height),
				height = Math.max(0.05, state.height),
				py = placementGroundY + sy * 0.5;
			const radius = Math.max(0.025, Math.max(sx, sz) * 0.5);
			if (state.primitive !== "box") {
				if (state.primitive === "sphere" || state.primitive === "icosphere") {
					height = radius * 2;
					sy = height;
					py = placementGroundY + radius;
				} else if (state.primitive === "plane") {
					sy = 0.02;
					height = 0.02;
					py = placementGroundY + 0.01;
				} else if (state.primitive === "torus") {
					height = Math.max(0.08, radius * 0.32);
					sy = height;
					py = placementGroundY + Math.max(0.04, height * 0.5);
				} else {
					height = Math.max(0.25, Math.max(sx, sz));
					sy = height;
					py = placementGroundY + height * 0.5;
				}
			}
			return { sx, sy, sz, cx, cz, radius, height, py };
		};
		const updatePlacementPreview = () => {
			const state = placementState;
			if (!state?.mesh || !state.anchor || !state.current) return;
			const d = placementDimensions(state);
			state.mesh.visible = true;
			state.mesh.position.set(d.cx, d.py, d.cz);
			if (state.primitive === "sphere" || state.primitive === "icosphere")
				state.mesh.scale.setScalar(d.radius * 2);
			else if (
				state.primitive === "cylinder" ||
				state.primitive === "cone" ||
				state.primitive === "capsule" ||
				state.primitive === "pyramid"
			)
				state.mesh.scale.set(d.radius * 2, d.height, d.radius * 2);
			else if (state.primitive === "torus") state.mesh.scale.setScalar(d.radius * 2);
			else if (state.primitive === "plane") state.mesh.scale.set(d.sx, d.sz, 1);
			else state.mesh.scale.set(d.sx, d.sy, d.sz);
		};
		const finalizePlacement = () => {
			const state = placementState;
			if (!state?.anchor || !state.current) return;
			const d = placementDimensions(state);
			window.parent.postMessage(
				{
					type: "ysong-primitive-placement-finalize",
					primitive: state.primitive,
					color: state.color,
					positionX: d.cx,
					positionY: d.py,
					positionZ: d.cz,
					sizeX: d.sx,
					sizeY: d.sy,
					sizeZ: d.sz,
					radius: d.radius,
					height: d.height,
				},
				window.location.origin,
			);
			clearPlacement(false);
		};
		const onPlacementMessage = (event: MessageEvent) => {
			if (
				event.origin !== window.location.origin ||
				!editorFreeRoam ||
				!event.data ||
				event.data.type !== "ysong-primitive-placement-start"
			)
				return;
			const primitive = event.data.primitive as VisualPrimitiveType;
			if (
				!(
					[
						"box",
						"sphere",
						"icosphere",
						"cylinder",
						"cone",
						"capsule",
						"plane",
						"torus",
						"pyramid",
					] as VisualPrimitiveType[]
				).includes(primitive)
			)
				return;
			startPlacement(primitive, typeof event.data.color === "string" ? event.data.color : "#8d6cff");
		};
		const onPlacementMouseDown = (event: MouseEvent) => {
			const state = placementState;
			if (!state || event.button !== 0 || state.phase === "height") return;
			event.preventDefault();
			event.stopPropagation();
			const point = placementPoint(event);
			if (!point) return;
			state.anchor = point.clone();
			state.current = point.clone();
			state.phase = "base";
			state.height = 0.05;
			updatePlacementPreview();
		};
		const onPlacementMouseMove = (event: MouseEvent) => {
			const state = placementState;
			if (!state) return;
			if (state.phase === "base") {
				const point = placementPoint(event);
				if (point) {
					state.current = point;
					updatePlacementPreview();
				}
			} else if (state.phase === "height") {
				state.height = Math.max(0.05, Math.min(50, (state.heightMouseY - event.clientY) * 0.025 + 0.05));
				updatePlacementPreview();
			}
		};
		const onPlacementMouseUp = (event: MouseEvent) => {
			const state = placementState;
			if (!state || event.button !== 0 || state.phase !== "base") return;
			event.preventDefault();
			event.stopPropagation();
			const point = placementPoint(event);
			if (point) state.current = point;
			updatePlacementPreview();
			if (state.primitive === "box") {
				state.phase = "height";
				state.heightMouseY = event.clientY;
				state.ignoreNextClick = true;
			} else {
				suppressEditorClick = true;
				finalizePlacement();
			}
		};
		const onPlacementClick = (event: MouseEvent) => {
			const state = placementState;
			if (!state || event.button !== 0 || state.phase !== "height") return;
			event.preventDefault();
			event.stopPropagation();
			if (state.ignoreNextClick) {
				state.ignoreNextClick = false;
				return;
			}
			finalizePlacement();
		};
		const onPlacementKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape" && placementState) {
				event.preventDefault();
				clearPlacement(true);
			}
		};

		const beginModelPlacement = (x: number, y: number, z: number) => {
			modelPlacementPreview.set(x, y, z);
			modelPlacementActive = true;
			hoveredSelectableId = "";
			canvas.style.cursor = "crosshair";
			if (document.pointerLockElement === canvas) document.exitPointerLock();
		};
		const onModelPlacementMove = (event: MouseEvent) => {
			if (!modelPlacementActive) return;
			const point = placementPoint(event);
			if (point) modelPlacementPreview.set(point.x, modelPlacementPreview.y, point.z);
		};
		const onModelPlacementClick = (event: MouseEvent) => {
			if (!modelPlacementActive || event.button !== 0) return;
			event.preventDefault();
			event.stopPropagation();
			const point = placementPoint(event);
			if (point) modelPlacementPreview.set(point.x, modelPlacementPreview.y, point.z);
			modelPlacementActive = false;
			suppressEditorClick = true;
			window.parent.postMessage(
				{
					type: "ysong-model-placement-finalize",
					positionX: modelPlacementPreview.x,
					positionY: modelPlacementPreview.y,
					positionZ: modelPlacementPreview.z,
				},
				window.location.origin,
			);
		};
		const onModelPlacementKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || !modelPlacementActive) return;
			event.preventDefault();
			modelPlacementActive = false;
			window.parent.postMessage({ type: "ysong-model-placement-cancel" }, window.location.origin);
		};
		const onViewportCommandMessage = (event: MessageEvent) => {
			if (event.origin !== window.location.origin || !event.data || typeof event.data !== "object") return;
			if (event.data.type === "ysong-scene-sync") {
				const current = sceneRef.current;
				if (!current.layers.some(layer => layer.id === selectedSelectableId) && !current.cameras.some(programCamera => programCamera.id === selectedSelectableId)) selectedSelectableId = "";
				if (!current.layers.some(layer => layer.id === hoveredSelectableId) && !current.cameras.some(programCamera => programCamera.id === hoveredSelectableId)) hoveredSelectableId = "";
				return;
			}
			if (event.data.type === "ysong-scene-replace" && event.data.scene && typeof event.data.scene === "object") {
				const replacement = normalizeVisualScene(event.data.scene as VisualSceneState);
				selectedSelectableId = "";
				hoveredSelectableId = "";
				sceneRef.current = replacement;
				sceneHydratedRef.current = true;
				setSceneHydrated(true);
				setScene(replacement);
				clearGlb();
				resetSceneRuntime();
				modelPlacementActive = false;
				clearPlacement(false);
				hoveredSelectableId = "";
				canvas.style.cursor = "crosshair";
				return;
			}
			if (event.data.type === "ysong-editor-selection" && typeof event.data.id === "string") {
				const id = event.data.id;
				selectedSelectableId = sceneRef.current.layers.some(layer => layer.id === id) || sceneRef.current.cameras.some(programCamera => programCamera.id === id) ? id : "";
				syncTransformGizmo();
				return;
			}
			if (event.data.type === "ysong-editor-transform-tool" && transformControls) {
				const mode = event.data.mode as VisualTransformMode;
				const space = event.data.space as VisualTransformSpace;
				const snap = Number(event.data.snap);
				if (mode === "translate" || mode === "rotate" || mode === "scale") transformControls.setMode(mode);
				if (space === "local" || space === "world") transformControls.setSpace(space);
				transformControls.setTranslationSnap(snap > 0 ? snap : null);
				transformControls.setRotationSnap(snap > 0 ? snap * Math.PI / 180 : null);
				transformControls.setScaleSnap(snap > 0 ? snap : null);
				syncTransformGizmo();
				return;
			}
			if (event.data.type === "ysong-editor-view-program-camera") {
				resetEditorToProgramCamera();
				return;
			}
			if (event.data.type === "ysong-editor-view-orientation") {
				setEditorOrientation(String(event.data.view || "perspective"));
				return;
			}
			if (event.data.type === "ysong-editor-view-orbit") {
				orbitEditorOrientation(Number(event.data.dx) || 0, Number(event.data.dy) || 0);
				return;
			}
			if (event.data.type === "ysong-editor-view-move") {
				moveEditorCamera(Number(event.data.right) || 0, Number(event.data.forward) || 0, Number(event.data.up) || 0);
				return;
			}
			if (event.data.type === "ysong-editor-focus-selection") {
				const id = selectedSelectableId;
				const cameraHelper = cameraHelpers.get(id);
				const root = selectableRoots.get(id) || cameraHelper?.root;
				if (root) {
					const box = new THREE.Box3().setFromObject(root);
					const center = new THREE.Vector3();
					const size = new THREE.Vector3();
					box.getCenter(center);
					box.getSize(size);
					updateEditorAxes();
					const radius = Math.max(0.35, size.length() * 0.5);
					camera.position.copy(center).addScaledVector(editorForward, -Math.max(1.2, radius * 2.4));
					camera.lookAt(center);
					editorPitch = Math.asin(THREE.MathUtils.clamp(editorForward.y, -1, 1));
					editorYaw = Math.atan2(-editorForward.x, -editorForward.z);
					if (document.pointerLockElement === canvas) document.exitPointerLock();
				}
				return;
			}
			if (event.data.type === "ysong-model-placement-start") {
				beginModelPlacement(
					Number(event.data.positionX) || 0,
					Number(event.data.positionY) || placementGroundY,
					Number(event.data.positionZ) || 0,
				);
			}
		};
		const onViewportDragOver = (event: DragEvent) => {
			if (!editorFreeRoam || !event.dataTransfer || !Array.from(event.dataTransfer.types).includes("Files"))
				return;
			event.preventDefault();
			event.stopPropagation();
			event.dataTransfer.dropEffect = "copy";
		};
		const onViewportDrop = (event: DragEvent) => {
			if (!editorFreeRoam || !event.dataTransfer) return;
			const files = Array.from(event.dataTransfer.files || []);
			const modelFiles = files.filter((file) => /\.(fbx|obj|glb|gltf)$/i.test(file.name));
			if (!modelFiles.length) return;
			event.preventDefault();
			event.stopPropagation();
			const point =
				placementPoint(event as unknown as MouseEvent) ??
				new THREE.Vector3(
					sceneRef.current.object.positionX,
					placementGroundY,
					sceneRef.current.object.positionZ,
				);
			window.parent.postMessage(
				{
					type: "ysong-model-files-drop",
					files,
					positionX: point.x,
					positionY: sceneRef.current.object.positionY,
					positionZ: point.z,
				},
				window.location.origin,
			);
		};
		window.addEventListener("message", onPlacementMessage);
		window.addEventListener("message", onViewportCommandMessage);
		if (embedded) window.parent.postMessage({ type: "ysong-viewport-ready" }, window.location.origin);
		window.addEventListener("keydown", onPlacementKeyDown);
		window.addEventListener("keydown", onModelPlacementKeyDown);
		canvas.addEventListener("mousedown", onPlacementMouseDown, true);
		canvas.addEventListener("mousemove", onPlacementMouseMove, true);
		canvas.addEventListener("mousemove", onModelPlacementMove, true);
		canvas.addEventListener("mouseup", onPlacementMouseUp, true);
		canvas.addEventListener("click", onPlacementClick, true);
		canvas.addEventListener("click", onModelPlacementClick, true);
		canvas.addEventListener("dragover", onViewportDragOver);
		canvas.addEventListener("drop", onViewportDrop);
		const updateEditorPick = (event: MouseEvent) => {
			if (!editorFreeRoam || placementState || document.pointerLockElement === canvas) return;
			const rect = canvas.getBoundingClientRect();
			pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
			pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
			raycaster.setFromCamera(pointer, camera);
			const activeLayerIds = new Set(sceneRef.current.layers.map((layer) => layer.id));
			const roots: Array<readonly [string, THREE.Object3D]> = [...selectableRoots].filter(([id]) =>
				activeLayerIds.has(id),
			);
			// Camera gizmos are editor-only and cannot claim hits while their parent is hidden.
			if (cameraHelperRoot.visible) {
				const activeCameraIds = new Set(sceneRef.current.cameras.map((programCamera) => programCamera.id));
				for (const [id, helper] of cameraHelpers)
					if (activeCameraIds.has(id) && camera.position.distanceTo(helper.root.position) > 1.05)
						roots.push([id, helper.root]);
			}
			hoveredSelectableId = pickVisibleEditorObject(raycaster, threeScene, roots);
			canvas.style.cursor = hoveredSelectableId ? "pointer" : "crosshair";
			// No hover bounding box: cursor/hierarchy feedback only.
		};
		if (editorFreeRoam) canvas.addEventListener("mousemove", updateEditorPick);

		const ambient = new THREE.HemisphereLight(0x8d9dff, 0x190d2a, 0.85);
		threeScene.add(ambient);
		const sun = new THREE.DirectionalLight(0x7f91ff, 0.65);
		sun.position.set(-3, 7, 4);
		sun.castShadow = true;
		sun.shadow.mapSize.set(1024, 1024);
		sun.shadow.camera.near = 0.5;
		sun.shadow.camera.far = 80;
		sun.shadow.camera.left = -18;
		sun.shadow.camera.right = 18;
		sun.shadow.camera.top = 18;
		sun.shadow.camera.bottom = -18;
		threeScene.add(sun);
		sun.target.position.set(0, 0, 0);
		threeScene.add(sun.target);
		const moon = new THREE.DirectionalLight(0xb9ccff, 0.35);
		moon.position.set(4, 6, -5);
		moon.castShadow = false;
		moon.shadow.mapSize.set(1024, 1024);
		moon.shadow.camera.near = 0.5;
		moon.shadow.camera.far = 80;
		moon.shadow.camera.left = -18;
		moon.shadow.camera.right = 18;
		moon.shadow.camera.top = 18;
		moon.shadow.camera.bottom = -18;
		threeScene.add(moon);
		moon.target.position.set(0, 0, 0);
		threeScene.add(moon.target);
		let shadowMapSize = 1024;
		const key = new THREE.SpotLight(0xffffff, 2.4, 38, THREE.MathUtils.degToRad(38), 0.38, 1.5);
		key.position.set(-4, 6, 5);
		key.castShadow = true;
		key.shadow.mapSize.set(1024, 1024);
		key.shadow.camera.near = 0.5;
		key.shadow.camera.far = 40;
		threeScene.add(key);
		key.target.position.set(0, 0, 0);
		threeScene.add(key.target);
		const rim = new THREE.PointLight(0x9b54ff, 3.2, 22, 2);
		rim.position.set(4, 3, 2);
		threeScene.add(rim);
		const floorLight = new THREE.PointLight(0x2e75ff, 1.8, 24, 2);
		floorLight.position.set(-3, -1, 2);
		threeScene.add(floorLight);

		// Neutral editor-only workbench lights keep PBR materials readable even in a
		// genuinely blank scene. They never exist as authored scene lighting and are
		// zeroed outside the embedded editor, so Program/OBS remains authoritative.
		const workbenchAmbient = new THREE.HemisphereLight(0xffffff, 0x596477, editorFreeRoam ? 1.05 : 0);
		const workbenchKey = new THREE.DirectionalLight(0xffffff, editorFreeRoam ? 1.15 : 0);
		workbenchKey.position.set(4, 7, 6);
		threeScene.add(workbenchAmbient, workbenchKey);

		const stageFog = new THREE.Fog(0x040613, 7, 26);
		threeScene.fog = stageFog;

		const floorMaterial = new THREE.MeshStandardMaterial({
			color: 0x07101f,
			metalness: 0.18,
			roughness: 0.78,
			transparent: true,
			opacity: 0.24,
		});
		const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), floorMaterial);
		floor.userData.ysongSelectableId = "stage";
		floor.rotation.x = -Math.PI / 2;
		floor.position.y = -3.16;
		floor.receiveShadow = true;
		threeScene.add(floor);

		const msaaRequested =
			runtimeQuality.antialiasMode === "msaa8"
				? 8
				: runtimeQuality.antialiasMode === "msaa4"
					? 4
					: runtimeQuality.antialiasMode === "msaa2"
						? 2
						: 0;
		const renderTarget = new THREE.WebGLRenderTarget(targetWidth, targetHeight, {
			minFilter: THREE.LinearFilter,
			magFilter: THREE.LinearFilter,
			format: THREE.RGBAFormat,
		});
		if (msaaRequested > 0)
			renderTarget.samples = Math.min(msaaRequested, renderer.capabilities.maxSamples || msaaRequested);
		const composer = new EffectComposer(renderer, renderTarget);
		composer.setSize(targetWidth, targetHeight);
		const backgroundPass = new RenderPass(backgroundScene, backgroundCamera);
		const environmentPass = new RenderPass(environmentScene, environmentCamera);
		environmentPass.clear = false;
		environmentPass.clearDepth = false;
		const renderPass = new RenderPass(threeScene, camera);
		// Preserve background media + sky, then clear only depth before drawing authored 3D.
		renderPass.clear = false;
		renderPass.clearDepth = true;
		// Phase 7: Post FX is a real ordered stack. Each module receives its own pass instance
		// so duplicate modules are deterministic and reorder exactly like the inspector shows.
		const depthTarget = new THREE.WebGLRenderTarget(targetWidth, targetHeight, {
			minFilter: THREE.NearestFilter,
			magFilter: THREE.NearestFilter,
			format: THREE.RGBAFormat,
			depthBuffer: true,
			stencilBuffer: false,
		});
		const depthMaterial = new THREE.MeshDepthMaterial({
			depthPacking: THREE.RGBADepthPacking,
			side: THREE.DoubleSide,
			blending: THREE.NoBlending,
		});
		type PostRuntime = {
			module: VisualPostFxModule;
			type: VisualPostFxModuleType;
			pass: { enabled: boolean; dispose?: () => void };
			uniforms?: Record<string, { value: unknown }>;
		};
		let postRuntimes: PostRuntime[] = [];
		let postStackSignature = "";
		let lutTexture: THREE.Data3DTexture | null = null;
		let lutLoadedUrl = "";
		let lutRequestedUrl = "";
		let lutFailedUrl = "";
		const lutCubeLoader = new LUTCubeLoader();
		const lut3dlLoader = new LUT3dlLoader();
		let lastRendererWarning = "";
		const reportRendererWarning = (stage: string, caught: unknown) => {
			const detail = caught instanceof Error ? caught.message : String(caught || "Unknown renderer error");
			const message = stage.startsWith("Depth of Field")
				? `Depth of Field output unavailable (${stage}): ${detail}`
				: `Visual renderer fallback (${stage}): ${detail}`;
			if (message === lastRendererWarning) return;
			lastRendererWarning = message;
			channel.postMessage({
				type: "visual-output-error",
				timestamp: Date.now(),
				message,
			} satisfies VisualOutputError);
		};

		const fxaaPass = new ShaderPass(FXAAShader);
		const fxaaResolution = fxaaPass.material.uniforms.resolution.value as THREE.Vector2;
		fxaaResolution.set(1 / targetWidth, 1 / targetHeight);
		fxaaPass.enabled = runtimeQuality.antialiasMode === "fxaa";
		const smaaPass = new SMAAPass();
		smaaPass.enabled = runtimeQuality.antialiasMode === "smaa";

		const makePostRuntime = (module: VisualPostFxModule): PostRuntime => {
			if (module.type === "ambientOcclusion") {
				const pass = new GTAOPass(threeScene, camera, targetWidth, targetHeight);
				pass.enabled = module.enabled;
				return { module, type: module.type, pass };
			}
			if (module.type === "depthOfField") {
				const pass = new ShaderPass(YSongDepthOfFieldShader);
				const uniforms = pass.uniforms as Record<string, { value: unknown }>;
				uniforms.tDepth.value = depthTarget.texture;
				(uniforms.resolution.value as THREE.Vector2).set(targetWidth, targetHeight);
				pass.enabled = false;
				return { module, type: module.type, pass, uniforms };
			}
			if (module.type === "bloom") {
				const pass = new UnrealBloomPass(new THREE.Vector2(targetWidth, targetHeight), 0.85, 0.35, 0.72);
				pass.enabled = module.enabled;
				return { module, type: module.type, pass };
			}
			if (module.type === "lightShafts") {
				const pass = new ShaderPass(YSongLightShaftShader);
				const uniforms = pass.uniforms as Record<string, { value: unknown }>;
				pass.enabled = false;
				return { module, type: module.type, pass, uniforms };
			}
			if (module.type === "lut") {
				const pass = lutTexture
					? new LUTPass({ lut: lutTexture, intensity: sceneRef.current.postFx.lutIntensity })
					: new LUTPass({ intensity: sceneRef.current.postFx.lutIntensity });
				pass.enabled = module.enabled && !!lutTexture;
				return { module, type: module.type, pass };
			}
			const pass = new ShaderPass(YSongStudioPostShader);
			const uniforms = pass.uniforms as Record<string, { value: unknown }>;
			(uniforms.resolution.value as THREE.Vector2).set(targetWidth, targetHeight);
			pass.enabled = false;
			return { module, type: module.type, pass, uniforms };
		};
		const rebuildPostStack = (stack: VisualPostFxModule[]) => {
			for (const runtime of postRuntimes) runtime.pass.dispose?.();
			postRuntimes = [];
			for (const module of stack) {
				try {
					postRuntimes.push(makePostRuntime(module));
				} catch (caught) {
					reportRendererWarning(module.type === "depthOfField" ? "Depth of Field" : `Post FX · ${module.name || module.type}`, caught);
				}
			}
			composer.passes.length = 0;
			composer.addPass(backgroundPass);
			composer.addPass(environmentPass);
			composer.addPass(renderPass);
			for (const runtime of postRuntimes) composer.addPass(runtime.pass as never);
			composer.addPass(fxaaPass);
			composer.addPass(smaaPass);
		};
		const assignLutTexture = () => {
			for (const runtime of postRuntimes) {
				if (runtime.type !== "lut") continue;
				const pass = runtime.pass as LUTPass;
				if (lutTexture) pass.lut = lutTexture;
				else {
					pass.material.uniforms.lut.value = null;
					pass.material.uniforms.lutSize.value = 0;
				}
				pass.intensity = sceneRef.current.postFx.lutIntensity;
				pass.enabled = runtime.module.enabled && !!lutTexture;
			}
		};
		const requestLut = (url: string, fileName: string) => {
			if (!url) {
				lutRequestedUrl = "";
				lutLoadedUrl = "";
				lutFailedUrl = "";
				lutTexture?.dispose();
				lutTexture = null;
				assignLutTexture();
				return;
			}
			if (url === lutLoadedUrl || url === lutRequestedUrl || url === lutFailedUrl) return;
			lutRequestedUrl = url;
			const requested = url;
			const done = (result: { texture3D: THREE.Data3DTexture }) => {
				if (lutRequestedUrl !== requested) {
					result.texture3D.dispose();
					return;
				}
				lutTexture?.dispose();
				lutTexture = result.texture3D;
				lutLoadedUrl = requested;
				lutFailedUrl = "";
				lutRequestedUrl = "";
				assignLutTexture();
			};
			const fail = () => {
				if (lutRequestedUrl === requested) {
					lutRequestedUrl = "";
					lutFailedUrl = requested;
				}
			};
			if (fileName.toLowerCase().endsWith(".3dl")) lut3dlLoader.load(url, done, undefined, fail);
			else lutCubeLoader.load(url, done, undefined, fail);
		};
		rebuildPostStack(sceneRef.current.postFx.stack);
		postStackSignature = sceneRef.current.postFx.stack
			.map((m: VisualPostFxModule) => `${m.id}:${m.type}:${m.enabled ? 1 : 0}`)
			.join("|");

		const renderCoreFallback = () => {
			// Optional post-processing must never take down the authored scene/editor.
			renderer.setRenderTarget(null);
			renderer.autoClear = true;
			renderer.render(backgroundScene, backgroundCamera);
			renderer.autoClear = false;
			renderer.render(environmentScene, environmentCamera);
			renderer.clearDepth();
			renderer.render(threeScene, camera);
			renderer.autoClear = true;
		};

		const resizeInternalRender = (requestedScale: number) => {
			const next = fitVisualRenderSize(renderWidth, renderHeight, requestedScale, rendererCapabilities);
			if (next.width === targetWidth && next.height === targetHeight) {
				effectiveRenderScale = next.scale;
				return false;
			}
			targetWidth = next.width;
			targetHeight = next.height;
			effectiveRenderScale = next.scale;
			renderer.setSize(targetWidth, targetHeight, false);
			composer.setSize(targetWidth, targetHeight);
			depthTarget.setSize(targetWidth, targetHeight);
			fxaaResolution.set(1 / targetWidth, 1 / targetHeight);
			for (const runtime of postRuntimes) {
				const resolution = runtime.uniforms?.resolution?.value;
				if (resolution instanceof THREE.Vector2) resolution.set(targetWidth, targetHeight);
				const pass = runtime.pass as { setSize?: (width: number, height: number) => void };
				pass.setSize?.(targetWidth, targetHeight);
			}
			return true;
		};
		let adaptiveLowStreak = 0;
		let adaptiveHighStreak = 0;

		const flareCanvas = document.createElement("canvas");
		flareCanvas.width = 128;
		flareCanvas.height = 128;
		const flareCtx = flareCanvas.getContext("2d")!;
		const flareGradient = flareCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
		flareGradient.addColorStop(0, "rgba(255,255,255,1)");
		flareGradient.addColorStop(0.12, "rgba(255,244,210,.9)");
		flareGradient.addColorStop(0.42, "rgba(170,205,255,.24)");
		flareGradient.addColorStop(1, "rgba(255,255,255,0)");
		flareCtx.fillStyle = flareGradient;
		flareCtx.fillRect(0, 0, 128, 128);
		const flareTexture = new THREE.CanvasTexture(flareCanvas);
		const flareMaterial = new THREE.SpriteMaterial({
			map: flareTexture,
			color: 0xffffff,
			transparent: true,
			opacity: 0,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
		});
		const lensFlareSprite = new THREE.Sprite(flareMaterial);
		lensFlareSprite.scale.set(3.6, 3.6, 1);
		lensFlareSprite.visible = false;
		threeScene.add(lensFlareSprite);

		const performerRoot = new THREE.Group();
		performerRoot.userData.ysongSelectableId = "object";
		selectableRoots.set("object", performerRoot);
		selectableRoots.set("stage", floor);
		threeScene.add(performerRoot);
		const mannequin = createMannequin();
		performerRoot.add(mannequin.root);
		const crystal = createCrystal();
		crystal.root.visible = false;
		performerRoot.add(crystal.root);
		const glb: GlbRuntime = {
			root: null,
			mixer: null,
			clips: [],
			activeAction: null,
			fileName: "",
			bones: [],
			boneBase: new Map(),
			materials: [],
			morphMeshes: [],
			materialBase: new Map(),
			loadingUrl: "",
			targets: {},
		};

		const grid = new THREE.GridHelper(28, 28, 0x4c62d9, 0x21305d);
		grid.position.y = -3.15;
		const gridMaterials: THREE.Material[] = Array.isArray(grid.material) ? grid.material : [grid.material];
		for (const material of gridMaterials) {
			material.transparent = true;
			material.opacity = 0.32;
		}
		threeScene.add(grid);

		// DCC-style editor reference grid. This is an editor helper, not an authored Stage,
		// and therefore never appears in Program Output / OBS. It gives an empty scene
		// a stable world horizon/origin like 3ds Max, Blender, and Unity.
		// Keep a useful local ground reference around the normal editing area. The
		// authored Stage grid remains separately controlled by scene.grid.visible.
		const editorReferenceGrid = new THREE.GridHelper(40, 40, 0x9aa9c2, 0x4c586b);
		const editorReferenceMaterials: THREE.Material[] = Array.isArray(editorReferenceGrid.material)
			? editorReferenceGrid.material
			: [editorReferenceGrid.material];
		for (const material of editorReferenceMaterials) {
			material.transparent = true;
			material.opacity = 0.28;
			material.depthWrite = false;
		}
		editorReferenceGrid.renderOrder = -20;
		editorReferenceGrid.visible = editorFreeRoam;
		threeScene.add(editorReferenceGrid);
		const editorAxes = new THREE.AxesHelper(3.5);
		(editorAxes.material as THREE.LineBasicMaterial).transparent = true;
		(editorAxes.material as THREE.LineBasicMaterial).opacity = 0.78;
		editorAxes.visible = editorFreeRoam;
		editorAxes.renderOrder = -19;
		threeScene.add(editorAxes);

		const particleRuntime = makeParticles();
		particleRuntime.points.userData.ysongSelectableId = "particles";
		selectableRoots.set("particles", particleRuntime.points);
		threeScene.add(particleRuntime.points);
		const particleTextureLoader = new THREE.TextureLoader();
		particleTextureLoader.setCrossOrigin("anonymous");
		let particleTexture: THREE.Texture | null = null;
		let particleTextureUrl = "";
		const cloudCanvas = document.createElement("canvas");
		cloudCanvas.width = 128;
		cloudCanvas.height = 128;
		const cloudCtx = cloudCanvas.getContext("2d")!;
		cloudCtx.clearRect(0, 0, 128, 128);
		for (const [x, y, r, a] of [
			[44, 65, 38, 0.52],
			[76, 58, 42, 0.48],
			[63, 78, 44, 0.46],
			[87, 78, 28, 0.34],
			[34, 82, 26, 0.32],
		] as const) {
			const g = cloudCtx.createRadialGradient(x, y, 0, x, y, r);
			g.addColorStop(0, `rgba(255,255,255,${a})`);
			g.addColorStop(0.55, `rgba(255,255,255,${a * 0.55})`);
			g.addColorStop(1, "rgba(255,255,255,0)");
			cloudCtx.fillStyle = g;
			cloudCtx.fillRect(x - r, y - r, r * 2, r * 2);
		}
		const cloudTexture = new THREE.CanvasTexture(cloudCanvas);
		const cloudMaterial = new THREE.SpriteMaterial({
			map: cloudTexture,
			color: 0xffffff,
			transparent: true,
			opacity: 0.45,
			depthWrite: false,
		});
		const cloudGroup = new THREE.Group();
		cloudGroup.userData.ysongSelectableId = "clouds";
		selectableRoots.set("clouds", cloudGroup);
		threeScene.add(cloudGroup);
		const cloudSprites = Array.from({ length: 144 }, (_, i) => {
			const sprite = new THREE.Sprite(cloudMaterial);
			sprite.userData.seedA = (Math.sin(i * 91.17) * 43758.5453) % 1;
			sprite.userData.seedB = (Math.sin(i * 47.31 + 2.1) * 15731.743) % 1;
			sprite.userData.seedC = (Math.sin(i * 13.77 + 4.7) * 951.135) % 1;
			cloudGroup.add(sprite);
			return sprite;
		});
		const weatherRuntime = makeWeatherParticles();
		weatherRuntime.points.userData.ysongSelectableId = "weather";
		selectableRoots.set("weather", weatherRuntime.points);
		threeScene.add(weatherRuntime.points);
		const rainRuntime = makeRainStreaks();
		threeScene.add(rainRuntime.lines);
		const weatherFog = new THREE.FogExp2(0xaab6c8, 0.018);
		const weatherLightning = makeLightningLine(new THREE.Color(0xdcecff));
		weatherLightning.name = "YSong Weather Lightning";
		threeScene.add(weatherLightning);
		const weatherFlashLight = new THREE.DirectionalLight(0xdcecff, 0);
		weatherFlashLight.position.set(-4, 12, 2);
		threeScene.add(weatherFlashLight);
		const lightning = createLightningRuntime();
		threeScene.add(lightning.group);
		const shockwaveMaterial = new THREE.MeshBasicMaterial({
			color: 0xd7ecff,
			transparent: true,
			opacity: 0,
			depthTest: false,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			side: THREE.DoubleSide,
		});
		const shockwave = new THREE.Mesh(new THREE.RingGeometry(0.13, 0.18, 64), shockwaveMaterial);
		shockwave.position.set(0, 0, -0.92);
		shockwave.renderOrder = 20;
		camera.add(shockwave);
		threeScene.add(camera);
		const performanceRuntime: PerformanceRuntime = {
			active: null,
			startedAt: 0,
			durationMs: 0,
			strength: 1,
			source: "idle",
			manualSequence: -1,
			manualInitialized: false,
			lastAutoAt: 0,
			recent: [],
			lastKick: 0,
			lastEnergy: 0,
			lastBass: 0,
			lastHighs: 0,
			lastBroadcastAt: 0,
			lastTransportPosition: 0,
		};
		const smoothedSpectrum = new Float32Array(64);
		let frameCounter = 0;
		let statsStart = performance.now();
		let lastRenderAt = 0;
		let animationFrame = 0;
		let disposed = false;
		let lastTime = performance.now();
		let smoothBody = 0;
		let particleMotionTime = 0;
		let smoothParticleAudio = 0;
		let smoothArms = 0;
		let smoothPulse = 0;
		let springPosition = 0;
		let springVelocity = 0;
		let lastGlbUrl = "";
		let modelLoadGeneration = 0;
		let lastAnimation = "";
		let lastTransitionSequence = -1;

		const clearGlb = (invalidate = true) => {
			if (invalidate) modelLoadGeneration++;
			if (glb.root) {
				performerRoot.remove(glb.root);
				disposeObject3D(glb.root);
			}
			glb.root = null;
			glb.mixer = null;
			glb.clips = [];
			glb.activeAction = null;
			glb.bones = [];
			glb.boneBase.clear();
			glb.materials = [];
			glb.morphMeshes = [];
			glb.materialBase.clear();
			glb.targets = {};
			if (invalidate) {
				glb.loadingUrl = "";
				lastGlbUrl = "";
				lastAnimation = "";
			}
		};

		const normalizeAssetPath = (value: string) => {
			try {
				return decodeURIComponent(value)
					.replace(/\\/g, "/")
					.replace(/[?#].*$/g, "")
					.replace(/^file:\/+/i, "")
					.toLowerCase();
			} catch {
				return value.replace(/\\/g, "/").toLowerCase();
			}
		};
		const makeModelLoadingManager = (
			assetFiles: VisualSceneState["object"]["assetFiles"],
			onMissing: (url: string) => void,
		) => {
			const manager = new THREE.LoadingManager();
			const exact = new Map<string, string>();
			const byName = new Map<string, string>();
			for (const asset of assetFiles) {
				const path = normalizeAssetPath(asset.path || asset.fileName);
				const name =
					normalizeAssetPath(asset.fileName || asset.path)
						.split("/")
						.pop() || "";
				if (path) exact.set(path, asset.url);
				if (name && !byName.has(name)) byName.set(name, asset.url);
			}
			manager.setURLModifier((requested) => {
				if (/^(data:|blob:)/i.test(requested)) return requested;
				const normalized = normalizeAssetPath(requested);
				for (const [path, resolved] of exact) {
					if (normalized === path || normalized.endsWith(`/${path}`) || normalized.endsWith(path))
						return resolved;
				}
				const name = normalized.split("/").pop() || "";
				return byName.get(name) || requested;
			});
			manager.addHandler(/\.tga(?:$|[?#])/i, new TGALoader(manager));
			manager.addHandler(/\.dds(?:$|[?#])/i, new DDSLoader(manager));
			manager.onError = onMissing;
			return manager;
		};

		const textureHasRenderableImage = (texture: THREE.Texture | null | undefined) => {
			if (!texture) return false;
			if ((texture as THREE.CompressedTexture).isCompressedTexture) return true;
			const source = (texture.source as THREE.Source | undefined)?.data as unknown;
			const image = (source ?? texture.image) as
				| {
						complete?: boolean;
						naturalWidth?: number;
						naturalHeight?: number;
						videoWidth?: number;
						videoHeight?: number;
						width?: number;
						height?: number;
						data?: unknown;
				  }
				| null
				| undefined;
			if (!image) return false;
			if (typeof image.complete === "boolean" && !image.complete) return false;
			const width = Number(image.naturalWidth ?? image.videoWidth ?? image.width ?? 0);
			const height = Number(image.naturalHeight ?? image.videoHeight ?? image.height ?? 0);
			return (width > 0 && height > 0) || !!image.data;
		};

		const loadVisualTextureUrl = (
			url: string,
			color: boolean,
			onLoad: (texture: THREE.Texture) => void,
			onError?: () => void,
		) => {
			const finish = (texture: THREE.Texture) => {
				texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
				texture.anisotropy = runtimeQuality.maxAnisotropy;
				if (color) texture.colorSpace = THREE.SRGBColorSpace;
				texture.needsUpdate = true;
				onLoad(texture);
			};
			let pathname = url.toLowerCase();
			try {
				pathname = new URL(url, window.location.href).pathname.toLowerCase();
			} catch {
				/* raw URL */
			}
			if (pathname.endsWith(".tga")) {
				new TGALoader().load(url, finish, undefined, () => onError?.());
				return;
			}
			if (pathname.endsWith(".dds")) {
				new DDSLoader().load(url, finish, undefined, () => onError?.());
				return;
			}
			const elementFallback = () => new THREE.TextureLoader().load(url, finish, undefined, () => onError?.());
			if (typeof createImageBitmap !== "function") {
				elementFallback();
				return;
			}
			fetch(url, { cache: "no-store" })
				.then((response) => {
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					return response.blob();
				})
				.then((blob) => createImageBitmap(blob))
				.then((bitmap) => {
					const texture = new THREE.Texture(bitmap);
					texture.userData.ysongImageBitmap = bitmap;
					finish(texture);
				})
				.catch(() => elementFallback());
		};

		const toPbrMaterial = (material: THREE.Material): THREE.MeshStandardMaterial => {
			if ((material as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
				const existing = material as THREE.MeshStandardMaterial;
				if (existing.map) {
					existing.map.colorSpace = THREE.SRGBColorSpace;
					if (Math.max(existing.color.r, existing.color.g, existing.color.b) < 0.08)
						existing.color.set(0xffffff);
				} else if (Math.max(existing.color.r, existing.color.g, existing.color.b) < 0.08)
					existing.color.set(0x8f949d);
				if (existing.emissiveMap) existing.emissiveMap.colorSpace = THREE.SRGBColorSpace;
				existing.needsUpdate = true;
				return existing;
			}
			const legacy = material as THREE.Material & {
				color?: THREE.Color;
				emissive?: THREE.Color;
				map?: THREE.Texture | null;
				emissiveMap?: THREE.Texture | null;
				normalMap?: THREE.Texture | null;
				bumpMap?: THREE.Texture | null;
				alphaMap?: THREE.Texture | null;
				aoMap?: THREE.Texture | null;
				specularMap?: THREE.Texture | null;
				shininess?: number;
				opacity?: number;
				transparent?: boolean;
				side?: THREE.Side;
				depthTest?: boolean;
				depthWrite?: boolean;
				vertexColors?: boolean;
			};
			const pbr = new THREE.MeshStandardMaterial({
				name: material.name,
				color: legacy.color?.clone() ?? new THREE.Color(0xffffff),
				emissive: legacy.emissive?.clone() ?? new THREE.Color(0x000000),
				map: legacy.map ?? null,
				emissiveMap: legacy.emissiveMap ?? null,
				normalMap: legacy.normalMap ?? null,
				bumpMap: legacy.bumpMap ?? null,
				alphaMap: legacy.alphaMap ?? null,
				aoMap: legacy.aoMap ?? null,
				transparent: legacy.transparent === true,
				opacity: typeof legacy.opacity === "number" ? legacy.opacity : 1,
				side: legacy.side ?? THREE.FrontSide,
				depthTest: legacy.depthTest !== false,
				depthWrite: legacy.depthWrite !== false,
				vertexColors: legacy.vertexColors === true,
				metalness: 0,
				roughness:
					typeof legacy.shininess === "number"
						? THREE.MathUtils.clamp(1 - Math.sqrt(Math.max(0, legacy.shininess)) / 16, 0.12, 0.95)
						: 0.58,
			});
			if (pbr.map) {
				pbr.map.colorSpace = THREE.SRGBColorSpace;
				if (Math.max(pbr.color.r, pbr.color.g, pbr.color.b) < 0.08) pbr.color.set(0xffffff);
			} else if (Math.max(pbr.color.r, pbr.color.g, pbr.color.b) < 0.08) pbr.color.set(0x8f949d);
			if (pbr.emissiveMap) pbr.emissiveMap.colorSpace = THREE.SRGBColorSpace;
			pbr.userData = { ...material.userData, ysongConvertedFrom: material.type };
			return pbr;
		};

		const normalizeImportedMaterials = (root: THREE.Object3D) => {
			root.traverse((object) => {
				const mesh = object as THREE.Mesh;
				if (!mesh.isMesh) return;
				if (mesh.geometry?.isBufferGeometry && !mesh.geometry.getAttribute("normal"))
					mesh.geometry.computeVertexNormals();
				const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
				const converted = (source.length ? source : [undefined]).map((material) =>
					toPbrMaterial(material ?? new THREE.MeshStandardMaterial({ color: 0x9aa0aa })),
				);
				mesh.material = Array.isArray(mesh.material) ? converted : converted[0];
			});
		};

		const attachPackageFallbackColorMaps = (
			root: THREE.Object3D,
			assetFiles: VisualSceneState["object"]["assetFiles"],
			modelFileName: string,
		) => {
			const imageExt = /\.(png|jpe?g|webp|bmp|tga|tiff?|dds)$/i;
			const reject =
				/(^|[_\-.])(normal|norm|nrm|rough|roughness|metal|metallic|spec|specular|ao|occlusion|emit|emissive|alpha|opacity|bump|height|disp|displace)([_\-.]|$)/i;
			const candidates = assetFiles.filter((file) => imageExt.test(file.fileName) && !reject.test(file.fileName));
			const modelBase = modelFileName
				.replace(/\.[^.]+$/, "")
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "");
			const chooseCandidate = (material: THREE.MeshStandardMaterial) => {
				if (!candidates.length) return undefined;
				if (candidates.length === 1) return candidates[0];
				const matBase = (material.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
				let chosen = candidates[0],
					best = -1;
				for (const candidate of candidates) {
					const base = candidate.fileName
						.replace(/\.[^.]+$/, "")
						.toLowerCase()
						.replace(/[^a-z0-9]+/g, "");
					let score = 0;
					if (
						modelBase &&
						(base.startsWith(modelBase) ||
							modelBase.startsWith(base) ||
							base.includes(modelBase) ||
							modelBase.includes(base))
					)
						score += 10;
					if (matBase && (base.includes(matBase) || matBase.includes(base))) score += 14;
					if (/(diff|diffuse|albedo|basecolor|basecolour|color|colour|tex|texture)/i.test(candidate.fileName))
						score += 5;
					if (score > best) {
						best = score;
						chosen = candidate;
					}
				}
				return best > 0 ? chosen : undefined;
			};
			const attach = () => {
				if (glb.root !== root || disposed) return;
				const pending = new Map<string, { url: string; materials: THREE.MeshStandardMaterial[] }>();
				root.traverse((object) => {
					const mesh = object as THREE.Mesh;
					if (!mesh.isMesh) return;
					for (const raw of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
						const material = raw as THREE.MeshStandardMaterial;
						if (!material?.isMeshStandardMaterial) continue;
						if (textureHasRenderableImage(material.map)) continue;
						const chosen = chooseCandidate(material);
						if (chosen) {
							// A failed referenced map must not keep the mesh black while the fallback loads.
							material.map = null;
							material.color.set(0x9aa0aa);
							material.needsUpdate = true;
							const base = glb.materialBase.get(material);
							if (base) {
								base.map = null;
								base.color.set(0x9aa0aa);
							}
							const bucket = pending.get(chosen.url) || { url: chosen.url, materials: [] };
							bucket.materials.push(material);
							pending.set(chosen.url, bucket);
							continue;
						}
						if (!material.map) continue; // keep authored solid-color materials intact
						material.map = null;
						material.color.set(0x9aa0aa);
						material.metalness = Math.min(material.metalness, 0.2);
						material.roughness = Math.max(material.roughness, 0.48);
						material.needsUpdate = true;
						const base = glb.materialBase.get(material);
						if (base) {
							base.map = null;
							base.color.set(0x9aa0aa);
							base.metalness = material.metalness;
							base.roughness = material.roughness;
						}
					}
				});
				for (const bucket of pending.values()) {
					loadVisualTextureUrl(
						bucket.url,
						true,
						(texture) => {
							if (glb.root !== root || disposed) {
								texture.dispose();
								return;
							}
							for (const material of bucket.materials) {
								material.map = texture;
								material.color.set(0xffffff);
								material.needsUpdate = true;
								const base = glb.materialBase.get(material);
								if (base) {
									base.map = texture;
									base.color.set(0xffffff);
								}
							}
						},
						() => {
							if (glb.root !== root || disposed) return;
							for (const material of bucket.materials) {
								material.map = null;
								material.color.set(0x9aa0aa);
								material.needsUpdate = true;
								const base = glb.materialBase.get(material);
								if (base) {
									base.map = null;
									base.color.set(0x9aa0aa);
								}
							}
						},
					);
				}
			};
			attach();
		};

		const finalizeLoadedModel = (
			root: THREE.Group,
			clips: THREE.AnimationClip[],
			loadKey: string,
			fileName: string,
			missingFiles: Set<string>,
		): VisualModelInfo | undefined => {
			if (disposed) {
				disposeObject3D(root);
				return undefined;
			}
			clearGlb(false);
			normalizeImportedMaterials(root);
			const bones: THREE.Bone[] = [];
			const materials: THREE.MeshStandardMaterial[] = [];
			const morphMeshes: THREE.Mesh[] = [];
			const morphNames = new Set<string>();
			const allMaterials = new Set<THREE.Material>();
			let meshes = 0;
			let skinnedMeshes = 0;
			root.traverse((object: THREE.Object3D) => {
				if ((object as THREE.Bone).isBone) bones.push(object as THREE.Bone);
				const mesh = object as THREE.Mesh;
				if (mesh.isMesh) {
					meshes++;
					if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) skinnedMeshes++;
					mesh.castShadow = true;
					mesh.receiveShadow = true;
					if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
						morphMeshes.push(mesh);
						Object.keys(mesh.morphTargetDictionary).forEach((name) => morphNames.add(name));
					}
					const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
					for (const material of list) {
						if (!material) continue;
						allMaterials.add(material);
						const pbr = material as THREE.MeshStandardMaterial;
						if (pbr.isMeshStandardMaterial) materials.push(pbr);
						const colorMaterial = material as THREE.MeshStandardMaterial & {
							map?: THREE.Texture | null;
							emissiveMap?: THREE.Texture | null;
						};
						if (colorMaterial.map) colorMaterial.map.colorSpace = THREE.SRGBColorSpace;
						if (colorMaterial.emissiveMap) colorMaterial.emissiveMap.colorSpace = THREE.SRGBColorSpace;
						material.needsUpdate = true;
					}
				}
			});
			const suggestedRole: VisualModelInfo["suggestedRole"] =
				bones.length > 0 || skinnedMeshes > 0 ? "performer" : meshes >= 12 ? "environment" : "prop";
			const requestedRole = sceneRef.current.object.role;
			const normalizeAsPerformer =
				requestedRole === "performer" || (requestedRole === "auto" && suggestedRole === "performer");
			if (normalizeAsPerformer) {
				const box = new THREE.Box3().setFromObject(root);
				const size = new THREE.Vector3();
				const center = new THREE.Vector3();
				box.getSize(size);
				box.getCenter(center);
				const height = Math.max(0.001, size.y);
				const normalizeScale = 5.6 / height;
				root.scale.setScalar(normalizeScale);
				root.position.sub(center.multiplyScalar(normalizeScale));
				root.position.y -= 0.25;
			}
			glb.root = root;
			glb.clips = clips;
			glb.mixer = clips.length ? new THREE.AnimationMixer(root) : null;
			glb.fileName = fileName;
			glb.bones = bones;
			glb.materials = materials;
			glb.morphMeshes = morphMeshes;
			glb.targets = discoverRigTargets(bones);
			glb.loadingUrl = "";
			for (const material of materials)
				glb.materialBase.set(material, {
					color: material.color.clone(),
					metalness: material.metalness,
					roughness: material.roughness,
					emissive: material.emissive.clone(),
					emissiveIntensity: material.emissiveIntensity,
					map: material.map,
					normalMap: material.normalMap,
					bumpMap: material.bumpMap,
					roughnessMap: material.roughnessMap,
					metalnessMap: material.metalnessMap,
					aoMap: material.aoMap,
					emissiveMap: material.emissiveMap,
					alphaMap: material.alphaMap,
					displacementMap: material.displacementMap,
					opacity: material.opacity,
					transparent: material.transparent,
				});
			for (const bone of bones)
				glb.boneBase.set(bone, {
					position: bone.position.clone(),
					quaternion: bone.quaternion.clone(),
					scale: bone.scale.clone(),
				});
			performerRoot.add(root);
			lastGlbUrl = loadKey;
			lastAnimation = "";
			const animationClips = clips.map((clip, index) => ({
				name: clip.name || `Animation ${index + 1}`,
				duration: Math.max(0.001, clip.duration || 0),
				tracks: clip.tracks.map((track) => {
					const suffix = track.name.split(".").pop()?.toLowerCase() || "";
					const property = suffix.includes("quaternion")
						? "quaternion"
						: suffix.includes("position")
							? "position"
							: suffix.includes("scale")
								? "scale"
								: "other";
					return {
						name: track.name,
						property: property as "position" | "quaternion" | "scale" | "other",
						times: Array.from(track.times as ArrayLike<number>),
						values: Array.from(track.values as ArrayLike<number>),
						valueSize: track.getValueSize(),
					};
				}),
			}));
			const payload: VisualModelInfo = {
				type: "visual-model-info",
				timestamp: Date.now(),
				fileName,
				bones: bones.map((b) => b.name || "Unnamed Bone"),
				animations: clips.map((clip) => clip.name || "Animation"),
				animationClips,
				morphTargets: [...morphNames].sort(),
				meshes,
				materials: allMaterials.size,
				suggestedRole,
				missingFiles: [...missingFiles],
			};
			channel.postMessage(payload);
			return payload;
		};

		const loadVisualModel = (
			url: string,
			fileName: string,
			format: VisualSceneState["object"]["modelFormat"],
			assetFiles: VisualSceneState["object"]["assetFiles"],
			role: VisualSceneState["object"]["role"],
		) => {
			const assetSignature = assetFiles.map((file) => `${file.path}:${file.url}`).join("|");
			const loadKey = `${url}|${role}|${assetSignature}`;
			if (!url || glb.loadingUrl === loadKey || lastGlbUrl === loadKey) return;
			// A replacement starts from a genuinely empty renderer state. Never leave the
			// previous FBX alive while the next async loader is working.
			const generation = ++modelLoadGeneration;
			clearGlb(false);
			glb.loadingUrl = loadKey;
			lastGlbUrl = "";
			const missingFiles = new Set<string>();
			let lastInfo: VisualModelInfo | undefined;
			let loadedRoot: THREE.Group | null = null;
			let assetsSettled = false;
			let fallbackAttached = false;
			const attachSettledFallback = () => {
				if (!assetsSettled || !loadedRoot || fallbackAttached || generation !== modelLoadGeneration || disposed)
					return;
				fallbackAttached = true;
				attachPackageFallbackColorMaps(loadedRoot, assetFiles, fileName);
			};
			const manager = makeModelLoadingManager(assetFiles, (missingUrl) => {
				const normalized = normalizeAssetPath(missingUrl);
				if (normalized === normalizeAssetPath(url)) return;
				missingFiles.add(missingUrl);
				if (lastInfo) {
					lastInfo = { ...lastInfo, timestamp: Date.now(), missingFiles: [...missingFiles] };
					channel.postMessage(lastInfo);
				}
			});
			manager.onLoad = () => {
				assetsSettled = true;
				attachSettledFallback();
			};
			const onLoaded = (root: THREE.Group, clips: THREE.AnimationClip[]) => {
				if (generation !== modelLoadGeneration || disposed) {
					disposeObject3D(root);
					return;
				}
				lastInfo = finalizeLoadedModel(root, clips, loadKey, fileName, missingFiles);
				loadedRoot = root;
				attachSettledFallback();
			};
			const onError = (caught: unknown) => {
				if (generation !== modelLoadGeneration) return;
				glb.loadingUrl = "";
				const message = caught instanceof Error ? caught.message : `Could not load ${fileName || "3D model"}.`;
				channel.postMessage({
					type: "visual-output-error",
					timestamp: Date.now(),
					message,
				} satisfies VisualOutputError);
			};
			if (format === "fbx") {
				new FBXLoader(manager).load(
					url,
					(object) => onLoaded(object, object.animations || []),
					undefined,
					onError,
				);
				return;
			}
			if (format === "obj") {
				const base = fileName.replace(/\.[^.]+$/, "").toLowerCase();
				const mtl =
					assetFiles.find((file) => file.fileName.toLowerCase() === `${base}.mtl`) ||
					assetFiles.find((file) => file.fileName.toLowerCase().endsWith(".mtl"));
				if (mtl) {
					new MTLLoader(manager).load(
						mtl.url,
						(creator) => {
							if (generation !== modelLoadGeneration) return;
							creator.preload();
							const loader = new OBJLoader(manager);
							loader.setMaterials(creator);
							loader.load(url, (object) => onLoaded(object, []), undefined, onError);
						},
						undefined,
						onError,
					);
					return;
				}
				new OBJLoader(manager).load(url, (object) => onLoaded(object, []), undefined, onError);
				return;
			}
			new GLTFLoader(manager).load(
				url,
				(gltf: GLTF) => onLoaded(gltf.scene, gltf.animations || []),
				undefined,
				onError,
			);
		};

		const applyGlbAnimation = (currentScene: VisualSceneState) => {
			if (!glb.mixer || !currentScene.object.animation || currentScene.object.animation === lastAnimation) return;
			const clip = glb.clips.find((candidate) => candidate.name === currentScene.object.animation);
			if (!clip) return;
			glb.activeAction?.fadeOut(0.18);
			const action = glb.mixer.clipAction(clip);
			action.reset();
			action.timeScale = currentScene.object.animationSpeed;
			action.fadeIn(0.18);
			action.play();
			glb.activeAction = action;
			lastAnimation = currentScene.object.animation;
		};

		const resolveBoneForTarget = (currentScene: VisualSceneState, target: string) => {
			if (target.startsWith("bone:")) {
				const name = target.slice(5);
				return glb.bones.find((b) => b.name === name);
			}
			const slot = target as VisualHumanoidSlot;
			const manual = currentScene.object.humanoidMap[slot];
			if (manual) {
				const bone = glb.bones.find((b) => b.name === manual);
				if (bone) return bone;
			}
			const auto = autoHumanoidMap(glb.bones)[slot];
			return auto ? glb.bones.find((b) => b.name === auto) : undefined;
		};
		const applyCustomSkeletalAnimations = (
			currentScene: VisualSceneState,
			positionSeconds: number,
			strength = 1,
		) => {
			if (!glb.root || !glb.bones.length || !currentScene.animationCues.length) return;
			const activeClips = activeVisualAnimationClips(
				currentScene.animations,
				currentScene.animationCues,
				positionSeconds,
			);
			for (const active of activeClips) {
				const animation = active.animation;
				const cue = active.cue;
				const blend = Math.max(0, Math.min(1, active.weight * strength));
				if (blend <= 0.0001) continue;
				const targets = new Set(
					animation.keyframes
						.map((k) => k.target)
						.filter((target) => animationLayerAllowsTarget(cue.layer, target)),
				);
				for (const target of targets) {
					const bone = resolveBoneForTarget(currentScene, target);
					if (!bone) continue;
					const base = glb.boneBase.get(bone);
					const rotation = sampleSkeletalTrack(animation, target, "rotation", active.localTime);
					if (rotation) {
						const delta = new THREE.Quaternion().setFromEuler(
							new THREE.Euler(
								THREE.MathUtils.degToRad(rotation.x),
								THREE.MathUtils.degToRad(rotation.y),
								THREE.MathUtils.degToRad(rotation.z),
								"XYZ",
							),
						);
						if (cue.blendMode === "additive") {
							const weighted = new THREE.Quaternion().slerp(delta, blend);
							bone.quaternion.multiply(weighted);
						} else {
							const targetQuat =
								animation.source === "imported"
									? delta
									: base
										? base.quaternion.clone().multiply(delta)
										: delta;
							bone.quaternion.slerp(targetQuat, blend);
						}
					}
					const position = sampleSkeletalTrack(animation, target, "position", active.localTime);
					if (position) {
						if (cue.blendMode === "additive")
							bone.position.add(
								new THREE.Vector3(position.x, position.y, position.z).multiplyScalar(blend),
							);
						else {
							const targetPos =
								animation.source === "imported"
									? new THREE.Vector3(position.x, position.y, position.z)
									: base
										? base.position
												.clone()
												.add(new THREE.Vector3(position.x, position.y, position.z))
										: new THREE.Vector3(position.x, position.y, position.z);
							bone.position.lerp(targetPos, blend);
						}
					}
					const scale = sampleSkeletalTrack(animation, target, "scale", active.localTime);
					if (scale) {
						const sampled = new THREE.Vector3(
							Math.max(0.01, scale.x),
							Math.max(0.01, scale.y),
							Math.max(0.01, scale.z),
						);
						if (cue.blendMode === "additive")
							bone.scale.multiply(
								new THREE.Vector3(
									THREE.MathUtils.lerp(1, sampled.x, blend),
									THREE.MathUtils.lerp(1, sampled.y, blend),
									THREE.MathUtils.lerp(1, sampled.z, blend),
								),
							);
						else {
							const targetScale =
								animation.source === "imported"
									? sampled
									: base
										? base.scale.clone().multiply(sampled)
										: sampled;
							bone.scale.lerp(targetScale, blend);
						}
					}
				}
			}
		};

		// Phase 4 scene-authoring runtime: parametric primitives, reusable PBR materials,
		// and Rapier rigid bodies. The primitive mesh is always the editor/render object;
		// in Simulate mode dynamic bodies drive its transform.
		const primitiveGroup = new THREE.Group();
		primitiveGroup.name = "YSong Primitives";
		threeScene.add(primitiveGroup);
		type PrimitiveRuntime = {
			mesh: THREE.Mesh;
			geometrySignature: string;
			materialId: string;
			body: RAPIER.RigidBody | null;
			bodySignature: string;
		};
		const primitiveRuntime = new Map<string, PrimitiveRuntime>();
		const resolveIKTarget = (constraint: VisualIKConstraint) => {
			const target = new THREE.Vector3(constraint.targetX, constraint.targetY, constraint.targetZ);
			if (constraint.targetMode === "camera") camera.getWorldPosition(target);
			else if (constraint.targetMode === "primitive" && constraint.targetEntityId) {
				const runtime = primitiveRuntime.get(constraint.targetEntityId);
				if (runtime) runtime.mesh.getWorldPosition(target);
			}
			return target.add(new THREE.Vector3(constraint.offsetX, constraint.offsetY, constraint.offsetZ));
		};
		const applyIKConstraints = (
			currentScene: VisualSceneState,
			positionSeconds: number,
			importedActive: boolean,
		) => {
			for (const constraint of currentScene.ikConstraints) {
				if (!constraint.enabled) continue;
				const weight = sampleIKWeight(constraint, positionSeconds);
				if (weight <= 0.0001) continue;
				const target = resolveIKTarget(constraint);
				if (constraint.effector === "head") {
					const head = importedActive ? resolveBoneForTarget(currentScene, "head") : mannequin.head;
					if (head) blendLookAt(head, target, weight);
					continue;
				}
				const left = constraint.effector === "leftHand";
				if (importedActive) {
					const effector = resolveBoneForTarget(currentScene, left ? "leftHand" : "rightHand");
					const fore = resolveBoneForTarget(currentScene, left ? "leftForeArm" : "rightForeArm");
					const upper = resolveBoneForTarget(currentScene, left ? "leftUpperArm" : "rightUpperArm");
					const shoulder = resolveBoneForTarget(currentScene, left ? "leftShoulder" : "rightShoulder");
					if (effector)
						solveCcdIk(
							effector,
							[fore, upper, shoulder].filter((joint): joint is THREE.Bone => !!joint),
							target,
							weight,
							constraint.iterations,
							constraint.maxAngleDegrees,
						);
				} else {
					const effector = left ? mannequin.leftHand : mannequin.rightHand;
					const joints = left
						? [mannequin.leftElbow, mannequin.leftShoulder]
						: [mannequin.rightElbow, mannequin.rightShoulder];
					solveCcdIk(effector, joints, target, weight, constraint.iterations, constraint.maxAngleDegrees);
				}
			}
		};
		const materialRuntime = new Map<string, THREE.MeshPhysicalMaterial>();
		const materialTextureCache = new Map<string, THREE.Texture>();
		const materialTexturePromises = new Map<string, Promise<THREE.Texture>>();
		const materialEnvironmentCache = new Map<string, THREE.WebGLRenderTarget>();
		const materialTextureLoading = new Set<string>();
		const materialTextureLoader = new THREE.TextureLoader();
		materialTextureLoader.setCrossOrigin("anonymous");
		const rgbeLoader = new RGBELoader();
		rgbeLoader.setCrossOrigin("anonymous");
		const exrLoader = new EXRLoader();
		exrLoader.setCrossOrigin("anonymous");
		const pmremGenerator = new THREE.PMREMGenerator(renderer);
		pmremGenerator.compileEquirectangularShader();
		const requestMaterialTexture = (url: string, color: boolean, assign: (texture: THREE.Texture) => void) => {
			if (!url) return;
			// Color/data uses separate cache entries because the same image cannot safely
			// be shared with two different color-space interpretations. More importantly,
			// every caller subscribes to the in-flight Promise instead of the old behavior
			// where the second caller was silently dropped while a texture was loading.
			const key = `${color ? "color" : "data"}:${url}`;
			const cached = materialTextureCache.get(key);
			if (cached) {
				assign(cached);
				return;
			}
			let pending = materialTexturePromises.get(key);
			if (!pending) {
				pending = new Promise<THREE.Texture>((resolve, reject) =>
					loadVisualTextureUrl(url, color, resolve, reject),
				);
				materialTexturePromises.set(key, pending);
				pending.then(
					(texture) => {
						materialTextureCache.set(key, texture);
						materialTexturePromises.delete(key);
					},
					() => materialTexturePromises.delete(key),
				);
			}
			void pending.then(assign).catch(() => {});
		};
		const requestEnvironmentTexture = (url: string, assign: (texture: THREE.Texture) => void) => {
			if (!url) return;
			const cached = materialEnvironmentCache.get(url);
			if (cached) {
				assign(cached.texture);
				return;
			}
			const loadingKey = `env:${url}`;
			if (materialTextureLoading.has(loadingKey)) return;
			materialTextureLoading.add(loadingKey);
			const done = (texture: THREE.Texture) => {
				materialTextureLoading.delete(loadingKey);
				texture.mapping = THREE.EquirectangularReflectionMapping;
				const target = pmremGenerator.fromEquirectangular(texture);
				texture.dispose();
				materialEnvironmentCache.set(url, target);
				target.texture.userData.ysongUrl = url;
				assign(target.texture);
			};
			const fail = () => materialTextureLoading.delete(loadingKey);
			let pathname = url.toLowerCase();
			try {
				pathname = new URL(url, window.location.href).pathname.toLowerCase();
			} catch {
				/* keep raw URL */
			}
			if (pathname.endsWith(".hdr")) {
				rgbeLoader.load(url, done, undefined, fail);
				return;
			}
			if (pathname.endsWith(".exr")) {
				exrLoader.load(url, done, undefined, fail);
				return;
			}
			materialTextureLoader.load(
				url,
				(texture) => {
					texture.colorSpace = THREE.SRGBColorSpace;
					texture.anisotropy = runtimeQuality.maxAnisotropy;
					done(texture);
				},
				undefined,
				fail,
			);
		};
		const getMaterial = (asset: VisualMaterialAsset, modulation?: VisualModulationFrame) => {
			let material = materialRuntime.get(asset.id);
			if (!material) {
				material = new THREE.MeshPhysicalMaterial();
				materialRuntime.set(asset.id, material);
			}
			const mm = (property: string, base: number, min = -Infinity, max = Infinity) =>
				modulation ? modulationValue(modulation, `material:${asset.id}:${property}`, base, min, max) : base;
			material.color.set(asset.baseColor);
			material.metalness = mm("metalness", asset.metalness, 0, 1);
			material.roughness = mm("roughness", asset.roughness, 0, 1);
			material.emissive.set(asset.emissiveColor);
			material.emissiveIntensity = mm("emissiveIntensity", asset.emissiveIntensity, 0, 30);
			material.opacity = mm("opacity", asset.opacity, 0, 1);
			material.transparent = asset.transparent || material.opacity < 0.999;
			material.side = asset.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
			material.normalScale.setScalar(asset.normalScale);
			material.bumpScale = asset.bumpScale;
			material.displacementScale = asset.displacementScale;
			material.envMapIntensity = mm("envMapIntensity", asset.envMapIntensity, 0, 20);
			material.clearcoat = mm("clearcoat", asset.clearcoat, 0, 1);
			material.clearcoatRoughness = asset.clearcoatRoughness;
			material.transmission = mm("transmission", asset.transmission, 0, 1);
			material.ior = asset.ior;
			const slots: [MaterialTextureKey, keyof THREE.MeshPhysicalMaterial, boolean][] = [
				["baseColorMap", "map", true],
				["normalMap", "normalMap", false],
				["bumpMap", "bumpMap", false],
				["roughnessMap", "roughnessMap", false],
				["metalnessMap", "metalnessMap", false],
				["aoMap", "aoMap", false],
				["emissiveMap", "emissiveMap", true],
				["alphaMap", "alphaMap", false],
				["displacementMap", "displacementMap", false],
			];
			for (const [slotName, materialKey, color] of slots) {
				const slot = asset[slotName] as { url: string };
				const key = materialKey as string;
				const requestUrls = (material.userData.ysongTextureRequestUrls ??= {}) as Record<string, string>;
				const current = (material as unknown as Record<string, unknown>)[key] as THREE.Texture | null;
				if (slot?.url) {
					if (requestUrls[key] !== slot.url) {
						requestUrls[key] = slot.url;
						// The old map is never a preview of the newly assigned slot.
						if (current?.userData.ysongUrl !== slot.url) {
							(material as unknown as Record<string, unknown>)[key] = null;
							material.needsUpdate = true;
						}
						requestMaterialTexture(slot.url, color, (texture) => {
							if (requestUrls[key] !== slot.url || !isCurrentVisualMaterialTexture(sceneRef.current, asset.id, slotName, slot.url)) return;
							texture.userData.ysongUrl = slot.url;
							(material as unknown as Record<string, unknown>)[key] = texture;
							material!.needsUpdate = true;
						});
					}
				} else {
					requestUrls[key] = "";
					if (current) {
						(material as unknown as Record<string, unknown>)[key] = null;
						material.needsUpdate = true;
					}
				}
			}
			const env = asset.envMap?.url || "";
			const requestUrls = (material.userData.ysongTextureRequestUrls ??= {}) as Record<string, string>;
			requestUrls.envMap = env;
			if (env) {
				if (material.envMap?.userData.ysongUrl !== env)
					requestEnvironmentTexture(env, (texture) => {
						if (requestUrls.envMap !== env || !isCurrentVisualMaterialTexture(sceneRef.current, asset.id, "envMap", env)) return;
						material!.envMap = texture;
						material!.needsUpdate = true;
					});
			}
			if (material.envMap && material.envMap.userData.ysongUrl !== env) {
				material.envMap = null;
				material.needsUpdate = true;
			}
			material.needsUpdate = true;
			return material;
		};

		const secondaryGroup = new THREE.Group();
		secondaryGroup.name = "YSong Secondary Physics";
		threeScene.add(secondaryGroup);
		type SecondaryRuntime = {
			group: THREE.Group;
			topology: SecondaryTopology;
			signature: string;
			material: THREE.MeshPhysicalMaterial;
			sheet: THREE.Mesh | null;
			segments: THREE.InstancedMesh | null;
			debugPoints: THREE.Points;
			debugLines: THREE.LineSegments;
			initialized: boolean;
			lastAudio: number;
		};
		const secondaryRuntime = new Map<string, SecondaryRuntime>();
		const secondaryMatrix = new THREE.Matrix4();
		const secondaryOffsetMatrix = new THREE.Matrix4();
		const secondaryTempObject = new THREE.Object3D();
		const secondaryUp = new THREE.Vector3(0, 1, 0);
		const mannequinSecondaryTarget = (target: string): THREE.Object3D | undefined => {
			if (target === "root" || target === "hips") return mannequin.root;
			if (target === "spine") return mannequin.spine;
			if (target === "chest" || target === "neck") return mannequin.chest;
			if (target === "head") return mannequin.head;
			if (target === "leftShoulder" || target === "leftUpperArm") return mannequin.leftShoulder;
			if (target === "leftForeArm") return mannequin.leftElbow;
			if (target === "leftHand") return mannequin.leftHand;
			if (target === "rightShoulder" || target === "rightUpperArm") return mannequin.rightShoulder;
			if (target === "rightForeArm") return mannequin.rightElbow;
			if (target === "rightHand") return mannequin.rightHand;
			return mannequin.root;
		};
		const resolveSecondaryBone = (
			state: VisualSceneState,
			target: string,
			importedActive: boolean,
		): THREE.Object3D | undefined =>
			importedActive
				? resolveBoneForTarget(state, target) || glb.root || performerRoot
				: mannequinSecondaryTarget(target);
		const resolveSecondaryAnchorMatrix = (
			item: VisualSecondaryDynamic,
			state: VisualSceneState,
			importedActive: boolean,
			modulation: VisualModulationFrame,
		) => {
			const prefix = `secondary:${item.id}`;
			const ox = modulationValue(modulation, `${prefix}:offsetX`, item.offsetX, -100, 100),
				oy = modulationValue(modulation, `${prefix}:offsetY`, item.offsetY, -100, 100),
				oz = modulationValue(modulation, `${prefix}:offsetZ`, item.offsetZ, -100, 100);
			secondaryMatrix.identity();
			if (item.anchorMode === "point") secondaryMatrix.makeTranslation(item.anchorX, item.anchorY, item.anchorZ);
			else if (item.anchorMode === "primitive" && item.anchorEntityId) {
				const runtime = primitiveRuntime.get(item.anchorEntityId);
				if (runtime) {
					runtime.mesh.updateWorldMatrix(true, false);
					secondaryMatrix.copy(runtime.mesh.matrixWorld);
				} else secondaryMatrix.makeTranslation(item.anchorX, item.anchorY, item.anchorZ);
			} else {
				const anchor = resolveSecondaryBone(state, String(item.anchorBone), importedActive) || performerRoot;
				anchor.updateWorldMatrix(true, false);
				secondaryMatrix.copy(anchor.matrixWorld);
			}
			secondaryOffsetMatrix.makeTranslation(ox, oy, oz);
			secondaryMatrix.multiply(secondaryOffsetMatrix);
			return secondaryMatrix;
		};
		const disposeSecondaryRuntime = (runtime: SecondaryRuntime) => {
			secondaryGroup.remove(runtime.group);
			selectableRoots.delete(runtime.group.userData.ysongSelectableId as string);
			runtime.sheet?.geometry.dispose();
			runtime.segments?.geometry.dispose();
			runtime.material.dispose();
			runtime.debugPoints.geometry.dispose();
			(runtime.debugPoints.material as THREE.Material).dispose();
			runtime.debugLines.geometry.dispose();
			(runtime.debugLines.material as THREE.Material).dispose();
		};
		const syncSecondaryMaterial = (
			runtime: SecondaryRuntime,
			item: VisualSecondaryDynamic,
			state: VisualSceneState,
			modulation: VisualModulationFrame,
			opacity: number,
		) => {
			const asset = item.materialId ? state.materials.find((m) => m.id === item.materialId) : undefined;
			if (asset) {
				const source = getMaterial(asset, modulation);
				runtime.material.color.copy(source.color);
				runtime.material.metalness = source.metalness;
				runtime.material.roughness = source.roughness;
				runtime.material.emissive.copy(source.emissive);
				runtime.material.emissiveIntensity = source.emissiveIntensity;
				runtime.material.map = source.map;
				runtime.material.normalMap = source.normalMap;
				runtime.material.bumpMap = source.bumpMap;
				runtime.material.roughnessMap = source.roughnessMap;
				runtime.material.metalnessMap = source.metalnessMap;
				runtime.material.aoMap = source.aoMap;
				runtime.material.emissiveMap = source.emissiveMap;
				runtime.material.alphaMap = source.alphaMap;
				runtime.material.envMap = source.envMap;
				runtime.material.envMapIntensity = source.envMapIntensity;
				runtime.material.clearcoat = source.clearcoat;
				runtime.material.clearcoatRoughness = source.clearcoatRoughness;
				runtime.material.transmission = source.transmission;
				runtime.material.ior = source.ior;
				runtime.material.opacity = Math.max(0, Math.min(1, source.opacity * opacity));
				runtime.material.transparent = runtime.material.opacity < 0.999 || source.transparent;
			} else {
				runtime.material.color.set(item.color);
				runtime.material.metalness = item.kind === "chain" ? 0.72 : 0.05;
				runtime.material.roughness = item.kind === "chain" ? 0.34 : 0.65;
				runtime.material.emissive.set(0x000000);
				runtime.material.emissiveIntensity = 0;
				runtime.material.map = null;
				runtime.material.normalMap = null;
				runtime.material.bumpMap = null;
				runtime.material.roughnessMap = null;
				runtime.material.metalnessMap = null;
				runtime.material.aoMap = null;
				runtime.material.emissiveMap = null;
				runtime.material.alphaMap = null;
				runtime.material.envMap = null;
				runtime.material.envMapIntensity = 1;
				runtime.material.clearcoat = 0;
				runtime.material.clearcoatRoughness = 0;
				runtime.material.transmission = 0;
				runtime.material.ior = 1.5;
				runtime.material.opacity = Math.max(0, Math.min(1, opacity));
				runtime.material.transparent = runtime.material.opacity < 0.999;
			}
			runtime.material.side = isSecondarySheet(item) ? THREE.DoubleSide : THREE.FrontSide;
			runtime.material.needsUpdate = true;
		};
		const createSecondaryRuntime = (
			item: VisualSecondaryDynamic,
			layer: VisualLayer,
			state: VisualSceneState,
			modulation: VisualModulationFrame,
		) => {
			const topology = buildSecondaryTopology(item);
			const group = new THREE.Group();
			group.name = item.name;
			group.userData.ysongSelectableId = layer.id;
			secondaryGroup.add(group);
			selectableRoots.set(layer.id, group);
			const material = new THREE.MeshPhysicalMaterial({
				color: item.color,
				roughness: 0.65,
				metalness: item.kind === "chain" ? 0.72 : 0.05,
				side: THREE.DoubleSide,
			});
			let sheet: THREE.Mesh | null = null;
			let segments: THREE.InstancedMesh | null = null;
			if (isSecondarySheet(item)) {
				const geometry = new THREE.BufferGeometry();
				geometry.setAttribute(
					"position",
					new THREE.BufferAttribute(new Float32Array(topology.positions.length * 3), 3),
				);
				if (topology.uvs.length === topology.positions.length * 2)
					geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(topology.uvs), 2));
				geometry.setIndex(topology.triangles);
				geometry.computeVertexNormals();
				sheet = new THREE.Mesh(geometry, material);
				sheet.castShadow = true;
				sheet.receiveShadow = true;
				sheet.frustumCulled = false;
				group.add(sheet);
			} else if (item.kind !== "springBone") {
				const geometry = new THREE.CylinderGeometry(1, 1, 1, item.kind === "chain" ? 6 : 8, 1, false);
				segments = new THREE.InstancedMesh(geometry, material, Math.max(1, topology.positions.length - 1));
				segments.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
				segments.castShadow = true;
				segments.receiveShadow = true;
				segments.frustumCulled = false;
				group.add(segments);
			}
			const debugGeometry = new THREE.BufferGeometry();
			debugGeometry.setAttribute(
				"position",
				new THREE.BufferAttribute(new Float32Array(topology.positions.length * 3), 3),
			);
			const debugPoints = new THREE.Points(
				debugGeometry,
				new THREE.PointsMaterial({
					size: 0.055,
					color: 0x67e8f9,
					depthTest: false,
					transparent: true,
					opacity: 0.9,
				}),
			);
			debugPoints.renderOrder = 50;
			group.add(debugPoints);
			const linePositions = new Float32Array(topology.constraints.length * 2 * 3);
			const lineGeometry = new THREE.BufferGeometry();
			lineGeometry.setAttribute("position", new THREE.BufferAttribute(linePositions, 3));
			const debugLines = new THREE.LineSegments(
				lineGeometry,
				new THREE.LineBasicMaterial({ color: 0xa78bfa, transparent: true, opacity: 0.42, depthTest: false }),
			);
			debugLines.renderOrder = 49;
			group.add(debugLines);
			const runtime: SecondaryRuntime = {
				group,
				topology,
				signature: secondaryTopologySignature(item),
				material,
				sheet,
				segments,
				debugPoints,
				debugLines,
				initialized: false,
				lastAudio: 0,
			};
			syncSecondaryMaterial(runtime, item, state, modulation, layer.opacity);
			secondaryRuntime.set(item.id, runtime);
			return runtime;
		};
		const resetSecondaryRuntime = (
			runtime: SecondaryRuntime,
			item: VisualSecondaryDynamic,
			state: VisualSceneState,
			importedActive: boolean,
			modulation: VisualModulationFrame,
		) => {
			const matrix = resolveSecondaryAnchorMatrix(item, state, importedActive, modulation);
			for (let i = 0; i < runtime.topology.restLocal.length; i++) {
				const world = runtime.topology.restLocal[i].clone().applyMatrix4(matrix);
				runtime.topology.positions[i].copy(world);
				runtime.topology.previous[i].copy(world);
			}
			runtime.initialized = true;
			runtime.lastAudio = 0;
		};
		const pushOutSphere = (point: THREE.Vector3, center: THREE.Vector3, radius: number) => {
			let dx = point.x - center.x,
				dy = point.y - center.y,
				dz = point.z - center.z;
			const d2 = dx * dx + dy * dy + dz * dz;
			if (d2 >= radius * radius) return;
			if (d2 < 1e-9) {
				dx = 0;
				dy = 1;
				dz = 0;
			} else {
				const inv = 1 / Math.sqrt(d2);
				dx *= inv;
				dy *= inv;
				dz *= inv;
			}
			point.set(center.x + dx * radius, center.y + dy * radius, center.z + dz * radius);
		};
		type SecondaryPrimitiveCollider = { id: string; box: THREE.Box3 };
		const collideSecondaryPoint = (
			point: THREE.Vector3,
			item: VisualSecondaryDynamic,
			state: VisualSceneState,
			performerCenters: { center: THREE.Vector3; radius: number }[],
			primitiveColliders: SecondaryPrimitiveCollider[],
		) => {
			const r = Math.max(0.001, item.collisionRadius);
			if (item.collideGround && state.physics.groundEnabled && point.y < state.physics.groundY + r)
				point.y = state.physics.groundY + r;
			if (item.collidePerformer)
				for (const collider of performerCenters) pushOutSphere(point, collider.center, collider.radius + r);
			if (item.collidePrimitives) {
				for (const collider of primitiveColliders) {
					if (item.anchorMode === "primitive" && collider.id === item.anchorEntityId) continue;
					const box = collider.box;
					const minX = box.min.x - r,
						maxX = box.max.x + r,
						minY = box.min.y - r,
						maxY = box.max.y + r,
						minZ = box.min.z - r,
						maxZ = box.max.z + r;
					if (
						point.x < minX ||
						point.x > maxX ||
						point.y < minY ||
						point.y > maxY ||
						point.z < minZ ||
						point.z > maxZ
					)
						continue;
					const distances = [
						Math.abs(point.x - minX),
						Math.abs(maxX - point.x),
						Math.abs(point.y - minY),
						Math.abs(maxY - point.y),
						Math.abs(point.z - minZ),
						Math.abs(maxZ - point.z),
					];
					let axis = 0;
					for (let i = 1; i < 6; i++) if (distances[i] < distances[axis]) axis = i;
					if (axis === 0) point.x = minX;
					else if (axis === 1) point.x = maxX;
					else if (axis === 2) point.y = minY;
					else if (axis === 3) point.y = maxY;
					else if (axis === 4) point.z = minZ;
					else point.z = maxZ;
				}
			}
		};
		const solveSelfCollision = (topology: SecondaryTopology, radius: number, pinned: Set<number>) => {
			if (radius <= 0.001) return;
			const cell = Math.max(0.002, radius * 2),
				target = radius * 2;
			const grid = new Map<string, number[]>();
			const key = (p: THREE.Vector3) =>
				`${Math.floor(p.x / cell)},${Math.floor(p.y / cell)},${Math.floor(p.z / cell)}`;
			for (let i = 0; i < topology.positions.length; i++) {
				const p = topology.positions[i];
				const gx = Math.floor(p.x / cell),
					gy = Math.floor(p.y / cell),
					gz = Math.floor(p.z / cell);
				for (let x = gx - 1; x <= gx + 1; x++)
					for (let y = gy - 1; y <= gy + 1; y++)
						for (let z = gz - 1; z <= gz + 1; z++) {
							const bucket = grid.get(`${x},${y},${z}`);
							if (!bucket) continue;
							for (const j of bucket) {
								if (Math.abs(i - j) <= 1) continue;
								const q = topology.positions[j];
								let dx = p.x - q.x,
									dy = p.y - q.y,
									dz = p.z - q.z;
								const d2 = dx * dx + dy * dy + dz * dz;
								if (d2 >= target * target || d2 < 1e-12) continue;
								const d = Math.sqrt(d2),
									scale = (target - d) / d;
								dx *= scale;
								dy *= scale;
								dz *= scale;
								const ip = pinned.has(i),
									jp = pinned.has(j);
								if (!ip && !jp) {
									p.x += dx * 0.5;
									p.y += dy * 0.5;
									p.z += dz * 0.5;
									q.x -= dx * 0.5;
									q.y -= dy * 0.5;
									q.z -= dz * 0.5;
								} else if (!ip) {
									p.x += dx;
									p.y += dy;
									p.z += dz;
								} else if (!jp) {
									q.x -= dx;
									q.y -= dy;
									q.z -= dz;
								}
							}
						}
				const k = key(p);
				const own = grid.get(k) || [];
				own.push(i);
				grid.set(k, own);
			}
		};
		const updateSecondaryGeometry = (
			runtime: SecondaryRuntime,
			item: VisualSecondaryDynamic,
			state: VisualSceneState,
			layer: VisualLayer,
			modulation: VisualModulationFrame,
			positionSeconds: number,
		) => {
			const positions = runtime.topology.positions;
			syncSecondaryMaterial(runtime, item, state, modulation, visualLayerOpacityAt(layer, positionSeconds));
			if (runtime.sheet) {
				const attr = runtime.sheet.geometry.getAttribute("position") as THREE.BufferAttribute;
				for (let i = 0; i < positions.length; i++) {
					attr.setXYZ(i, positions[i].x, positions[i].y, positions[i].z);
				}
				attr.needsUpdate = true;
				runtime.sheet.geometry.computeVertexNormals();
			}
			if (runtime.segments) {
				for (let i = 0; i < positions.length - 1; i++) {
					const a = positions[i],
						b = positions[i + 1];
					const dir = b.clone().sub(a);
					const length = Math.max(0.001, dir.length());
					const taper =
						item.kind === "tentacle"
							? Math.max(0.22, 1 - (i / Math.max(1, positions.length - 1)) * 0.72)
							: item.kind === "hair"
								? Math.max(0.35, 1 - (i / Math.max(1, positions.length - 1)) * 0.55)
								: 1;
					secondaryTempObject.position.copy(a).add(b).multiplyScalar(0.5);
					secondaryTempObject.quaternion.setFromUnitVectors(secondaryUp, dir.normalize());
					secondaryTempObject.scale.set(item.radius * taper, length, item.radius * taper);
					secondaryTempObject.updateMatrix();
					runtime.segments.setMatrixAt(i, secondaryTempObject.matrix);
				}
				runtime.segments.instanceMatrix.needsUpdate = true;
			}
			const debugAttr = runtime.debugPoints.geometry.getAttribute("position") as THREE.BufferAttribute;
			for (let i = 0; i < positions.length; i++)
				debugAttr.setXYZ(i, positions[i].x, positions[i].y, positions[i].z);
			debugAttr.needsUpdate = true;
			const lineAttr = runtime.debugLines.geometry.getAttribute("position") as THREE.BufferAttribute;
			for (let i = 0; i < runtime.topology.constraints.length; i++) {
				const c = runtime.topology.constraints[i],
					a = positions[c.a],
					b = positions[c.b];
				lineAttr.setXYZ(i * 2, a.x, a.y, a.z);
				lineAttr.setXYZ(i * 2 + 1, b.x, b.y, b.z);
			}
			lineAttr.needsUpdate = true;
			runtime.debugPoints.visible = state.physics.secondaryDebug;
			runtime.debugLines.visible = state.physics.secondaryDebug;
		};
		const applySpringBone = (
			runtime: SecondaryRuntime,
			item: VisualSecondaryDynamic,
			state: VisualSceneState,
			importedActive: boolean,
			modulation: VisualModulationFrame,
		) => {
			if (item.kind !== "springBone" || runtime.topology.positions.length < 2) return;
			const bone = resolveSecondaryBone(state, String(item.targetBone), importedActive);
			if (!bone || !bone.parent) return;
			bone.updateWorldMatrix(true, false);
			const desired = runtime.topology.positions[1].clone().sub(runtime.topology.positions[0]);
			if (desired.lengthSq() < 1e-8) return;
			desired.normalize();
			const currentWorldQuat = new THREE.Quaternion();
			bone.getWorldQuaternion(currentWorldQuat);
			const localRest = new THREE.Vector3(item.restDirectionX, item.restDirectionY, item.restDirectionZ);
			if (localRest.lengthSq() < 1e-8) localRest.set(0, 1, 0);
			localRest.normalize();
			const currentDir = localRest.clone().applyQuaternion(currentWorldQuat).normalize();
			const deltaWorld = new THREE.Quaternion().setFromUnitVectors(currentDir, desired);
			const desiredWorld = deltaWorld.multiply(currentWorldQuat);
			const parentWorld = new THREE.Quaternion();
			bone.parent.getWorldQuaternion(parentWorld);
			const desiredLocal = parentWorld.invert().multiply(desiredWorld);
			const influence = modulationValue(
				modulation,
				`secondary:${item.id}:boneInfluence`,
				item.boneInfluence,
				0,
				1,
			);
			bone.quaternion.slerp(desiredLocal, influence);
			bone.updateMatrixWorld(true);
		};
		let lastSecondaryReset = -1,
			lastSecondaryTransport = 0;
		const updateSecondaryDynamics = (
			state: VisualSceneState,
			positionSeconds: number,
			dt: number,
			modulation: VisualModulationFrame,
			importedActive: boolean,
			worldWindX: number,
			worldWindZ: number,
			windTurbulence: number,
		) => {
			const liveIds = new Set(state.secondaryDynamics.map((item) => item.id));
			for (const [id, runtime] of secondaryRuntime)
				if (!liveIds.has(id)) {
					disposeSecondaryRuntime(runtime);
					secondaryRuntime.delete(id);
				}
			const seekReset =
				state.physics.resetSecondaryOnSeek &&
				(positionSeconds < lastSecondaryTransport - 0.05 ||
					Math.abs(positionSeconds - lastSecondaryTransport) > 0.75);
			const globalReset = state.physics.resetSequence !== lastSecondaryReset;
			lastSecondaryTransport = positionSeconds;
			if (globalReset) lastSecondaryReset = state.physics.resetSequence;
			const imported = importedActive;
			const performerCollisionActive = imported ? !!glb.root?.visible : mannequin.root.visible;
			const performerCenters: { center: THREE.Vector3; radius: number }[] = [];
			const addCenter = (object: THREE.Object3D | undefined, radius: number) => {
				if (!object) return;
				const center = new THREE.Vector3();
				object.getWorldPosition(center);
				performerCenters.push({ center, radius });
			};
			if (performerCollisionActive) {
				addCenter(resolveSecondaryBone(state, "head", imported), 0.48);
				addCenter(resolveSecondaryBone(state, "chest", imported), 0.68);
				addCenter(resolveSecondaryBone(state, "hips", imported), 0.58);
			}
			const primitiveColliders: SecondaryPrimitiveCollider[] = [];
			for (const primitive of state.primitives) {
				const runtime = primitiveRuntime.get(primitive.id);
				if (!runtime?.mesh.visible) continue;
				runtime.mesh.updateWorldMatrix(true, false);
				primitiveColliders.push({ id: primitive.id, box: new THREE.Box3().setFromObject(runtime.mesh) });
			}
			for (const item of state.secondaryDynamics) {
				const layer = state.layers.find((l) => l.type === "secondary" && l.entityId === item.id);
				if (!layer) continue;
				let runtime = secondaryRuntime.get(item.id);
				const sig = secondaryTopologySignature(item);
				if (!runtime || runtime.signature !== sig) {
					if (runtime) disposeSecondaryRuntime(runtime);
					runtime = createSecondaryRuntime(item, layer, state, modulation);
				}
				runtime.group.userData.ysongSelectableId = layer.id;
				const active = state.project.mode !== "2d" && item.enabled && visualLayerActive(layer, positionSeconds);
				runtime.group.visible = active && (item.kind !== "springBone" || state.physics.secondaryDebug);
				if (!active) {
					runtime.initialized = false;
					continue;
				}
				if (
					!runtime.initialized ||
					globalReset ||
					seekReset ||
					state.physics.mode === "edit" ||
					!state.physics.enabled ||
					!state.physics.secondaryEnabled
				)
					resetSecondaryRuntime(runtime, item, state, imported, modulation);
				const topology = runtime.topology;
				const anchorMatrix = resolveSecondaryAnchorMatrix(item, state, imported, modulation);
				const pinned = new Set(topology.pinned);
				for (const index of topology.pinned) {
					const pinnedWorld = topology.restLocal[index].clone().applyMatrix4(anchorMatrix);
					topology.positions[index].copy(pinnedWorld);
					topology.previous[index].copy(pinnedWorld);
				}
				if (state.physics.enabled && state.physics.secondaryEnabled && state.physics.mode === "simulate") {
					const prefix = `secondary:${item.id}`;
					const stiffness = modulationValue(modulation, `${prefix}:stiffness`, item.stiffness, 0, 1),
						bendStiffness = modulationValue(
							modulation,
							`${prefix}:bendStiffness`,
							item.bendStiffness,
							0,
							1,
						),
						gravityScale = modulationValue(modulation, `${prefix}:gravityScale`, item.gravityScale, -5, 5),
						windInfluence = modulationValue(
							modulation,
							`${prefix}:windInfluence`,
							item.windInfluence,
							0,
							12,
						),
						drag = modulationValue(modulation, `${prefix}:drag`, item.drag, 0, 6),
						audioAmount = modulationValue(modulation, `${prefix}:audioImpulse`, item.audioImpulse, -20, 20);
					const source = Math.max(0, Math.min(1, modulation.sources[item.audioSource] ?? 0));
					const transient = Math.max(0, source - runtime.lastAudio);
					runtime.lastAudio = source;
					const musicStrength = audioAmount * (transient * 5 + source * 0.08);
					const musicDir = new THREE.Vector3(
						item.audioDirectionX,
						item.audioDirectionY,
						item.audioDirectionZ,
					);
					if (musicDir.lengthSq() > 1e-6) musicDir.normalize();
					const substeps = Math.max(
						1,
						Math.min(state.physics.secondarySubsteps, runtimeQuality.secondarySubsteps),
					);
					const qualityIterations = Math.max(
						1,
						Math.min(state.physics.secondaryIterations, runtimeQuality.secondaryIterations),
					);
					const subDt = Math.max(1 / 240, Math.min(1 / 30, dt / substeps));
					for (let sub = 0; sub < substeps; sub++) {
						const damping =
							Math.pow(Math.max(0.5, Math.min(0.9999, item.damping)), subDt * 60) *
							Math.exp(-drag * subDt * 0.35);
						for (let i = 0; i < topology.positions.length; i++) {
							if (pinned.has(i)) continue;
							const p = topology.positions[i],
								prev = topology.previous[i];
							const vx = (p.x - prev.x) * damping,
								vy = (p.y - prev.y) * damping,
								vz = (p.z - prev.z) * damping;
							prev.copy(p);
							const flutter =
								Math.sin(positionSeconds * 3.1 + i * 1.731) +
								Math.cos(positionSeconds * 1.7 + i * 0.417);
							const ax =
								worldWindX * windInfluence * (1 + flutter * 0.025 * windTurbulence) +
								musicDir.x * musicStrength * 18;
							const ay = state.physics.gravityY * gravityScale + musicDir.y * musicStrength * 18;
							const az =
								worldWindZ * windInfluence * (1 + flutter * 0.025 * windTurbulence) +
								musicDir.z * musicStrength * 18;
							p.x += vx + ax * subDt * subDt;
							p.y += vy + ay * subDt * subDt;
							p.z += vz + az * subDt * subDt;
						}
						for (let iteration = 0; iteration < qualityIterations; iteration++) {
							for (const c of topology.constraints) {
								const a = topology.positions[c.a],
									b = topology.positions[c.b];
								let dx = b.x - a.x,
									dy = b.y - a.y,
									dz = b.z - a.z;
								const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
								if (dist < 1e-7) continue;
								const effective = c.role === "bend" ? bendStiffness : stiffness;
								const strength =
									1 - Math.pow(1 - Math.max(0, Math.min(1, effective)), 1 / qualityIterations);
								const scale = ((dist - c.rest) / dist) * strength;
								dx *= scale;
								dy *= scale;
								dz *= scale;
								const ap = pinned.has(c.a),
									bp = pinned.has(c.b);
								if (!ap && !bp) {
									a.x += dx * 0.5;
									a.y += dy * 0.5;
									a.z += dz * 0.5;
									b.x -= dx * 0.5;
									b.y -= dy * 0.5;
									b.z -= dz * 0.5;
								} else if (!ap) {
									a.x += dx;
									a.y += dy;
									a.z += dz;
								} else if (!bp) {
									b.x -= dx;
									b.y -= dy;
									b.z -= dz;
								}
							}
							for (let i = 0; i < topology.positions.length; i++)
								if (!pinned.has(i))
									collideSecondaryPoint(
										topology.positions[i],
										item,
										state,
										performerCenters,
										primitiveColliders,
									);
							if (item.selfCollision)
								solveSelfCollision(
									topology,
									Math.max(item.collisionRadius, item.radius * 0.55),
									pinned,
								);
							for (const index of topology.pinned) {
								const world = topology.restLocal[index].clone().applyMatrix4(anchorMatrix);
								topology.positions[index].copy(world);
								topology.previous[index].copy(world);
							}
						}
					}
				}
				applySpringBone(runtime, item, state, imported, modulation);
				updateSecondaryGeometry(runtime, item, state, layer, modulation, positionSeconds);
			}
		};
		const primitiveGeometrySignature = (p: VisualPrimitiveObject) =>
			[p.primitive, p.sizeX, p.sizeY, p.sizeZ, p.radius, p.height, p.segments, p.tubeRadius].join("|");
		const primitiveBodySignature = (p: VisualPrimitiveObject) =>
			[
				p.physics.bodyType,
				p.physics.collider,
				p.sizeX,
				p.sizeY,
				p.sizeZ,
				p.radius,
				p.height,
				p.physics.mass,
				p.physics.friction,
				p.physics.restitution,
				p.physics.linearDamping,
				p.physics.angularDamping,
				p.physics.gravityScale,
			].join("|");

		let physicsWorld: RAPIER.World | null = null;
		let physicsGround: RAPIER.RigidBody | null = null;
		let physicsGroundSignature = "";
		let leftHandBody: RAPIER.RigidBody | null = null;
		let rightHandBody: RAPIER.RigidBody | null = null;
		let lastPhysicsReset = -1;
		void RAPIER.init()
			.then(() => {
				if (disposed) return;
				physicsWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
			})
			.catch(() => {
				channel.postMessage({
					type: "visual-output-error",
					timestamp: Date.now(),
					message: "Rapier physics could not initialize; visual rendering will continue without simulation.",
				} satisfies VisualOutputError);
			});
		const removePhysicsBody = (runtime: PrimitiveRuntime) => {
			if (physicsWorld && runtime.body) {
				physicsWorld.removeRigidBody(runtime.body);
				runtime.body = null;
			}
		};
		const rigidBodyDescFor = (p: VisualPrimitiveObject) =>
			p.physics.bodyType === "dynamic"
				? RAPIER.RigidBodyDesc.dynamic()
				: p.physics.bodyType === "kinematic"
					? RAPIER.RigidBodyDesc.kinematicPositionBased()
					: RAPIER.RigidBodyDesc.fixed();
		const colliderDescFor = (p: VisualPrimitiveObject) => {
			const sx = Math.max(0.01, p.sizeX * p.scaleX),
				sy = Math.max(0.01, p.sizeY * p.scaleY),
				sz = Math.max(0.01, p.sizeZ * p.scaleZ),
				r = Math.max(0.01, p.radius * Math.max(p.scaleX, p.scaleZ)),
				h = Math.max(0.01, p.height * p.scaleY);
			const kind =
				p.physics.collider === "auto"
					? p.primitive === "sphere" || p.primitive === "icosphere"
						? "sphere"
						: p.primitive === "capsule"
							? "capsule"
							: p.primitive === "cylinder" || p.primitive === "cone"
								? "cylinder"
								: "box"
					: p.physics.collider;
			if (kind === "sphere") return RAPIER.ColliderDesc.ball(r);
			if (kind === "capsule") return RAPIER.ColliderDesc.capsule(Math.max(0.01, h * 0.5 - r), r);
			if (kind === "cylinder") return RAPIER.ColliderDesc.cylinder(h * 0.5, r);
			// Convex-hull is intentionally conservative for parametric primitives; a box proxy
			// is deterministic and fast. Imported-mesh convex hull generation comes later.
			return RAPIER.ColliderDesc.cuboid(sx * 0.5, sy * 0.5, sz * 0.5);
		};
		const createPhysicsBody = (p: VisualPrimitiveObject, runtime: PrimitiveRuntime) => {
			if (!physicsWorld) return;
			removePhysicsBody(runtime);
			const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rotationX, p.rotationY, p.rotationZ));
			const desc = rigidBodyDescFor(p)
				.setTranslation(p.positionX, p.positionY, p.positionZ)
				.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
				.setLinearDamping(p.physics.linearDamping)
				.setAngularDamping(p.physics.angularDamping)
				.setGravityScale(p.physics.gravityScale);
			const body = physicsWorld.createRigidBody(desc);
			const colliderDesc = colliderDescFor(p)
				.setFriction(p.physics.friction)
				.setRestitution(p.physics.restitution)
				.setMass(Math.max(0.001, p.physics.mass));
			physicsWorld.createCollider(colliderDesc, body);
			runtime.body = body;
			runtime.bodySignature = primitiveBodySignature(p);
		};
		const ensureGround = (state: VisualSceneState) => {
			if (!physicsWorld) return;
			const signature = `${state.physics.groundEnabled}|${state.physics.groundY}`;
			if (signature === physicsGroundSignature) return;
			physicsGroundSignature = signature;
			if (physicsGround) {
				physicsWorld.removeRigidBody(physicsGround);
				physicsGround = null;
			}
			if (!state.physics.groundEnabled) return;
			physicsGround = physicsWorld.createRigidBody(
				RAPIER.RigidBodyDesc.fixed().setTranslation(0, state.physics.groundY - 0.1, 0),
			);
			physicsWorld.createCollider(RAPIER.ColliderDesc.cuboid(100, 0.1, 100).setFriction(0.8), physicsGround);
		};
		const ensureHandBodies = () => {
			if (!physicsWorld) return;
			if (!leftHandBody) {
				leftHandBody = physicsWorld.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
				physicsWorld.createCollider(
					RAPIER.ColliderDesc.ball(0.22).setFriction(0.7).setRestitution(0.05),
					leftHandBody,
				);
			}
			if (!rightHandBody) {
				rightHandBody = physicsWorld.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
				physicsWorld.createCollider(
					RAPIER.ColliderDesc.ball(0.22).setFriction(0.7).setRestitution(0.05),
					rightHandBody,
				);
			}
		};
		const destroyPrimitiveRuntime = (id: string, runtime: PrimitiveRuntime) => {
			const selectableId = String(runtime.mesh.userData.ysongSelectableId || `layer-${id}`);
			if (hoveredSelectableId === selectableId) {
				hoveredSelectableId = "";
			}
			selectableRoots.delete(selectableId);
			runtime.mesh.visible = false;
			runtime.mesh.userData.ysongSelectableId = undefined;
			runtime.mesh.removeFromParent();
			removePhysicsBody(runtime);
			runtime.mesh.geometry.dispose();
			primitiveRuntime.delete(id);
		};
		const ensurePrimitives = (
			state: VisualSceneState,
			positionSeconds: number,
			modulation: VisualModulationFrame,
		) => {
			const ids = new Set(state.primitives.map((p) => p.id));
			for (const [id, runtime] of [...primitiveRuntime]) if (!ids.has(id)) destroyPrimitiveRuntime(id, runtime);
			for (const p of state.primitives) {
				const layer = state.layers.find((l) => l.type === "primitive" && l.entityId === p.id);
				if (!layer) continue;
				let runtime = primitiveRuntime.get(p.id);
				const geometrySignature = primitiveGeometrySignature(p);
				const materialAsset = state.materials.find((m) => m.id === p.materialId) || state.materials[0];
				if (!materialAsset) continue;
				if (!runtime) {
					const mesh = new THREE.Mesh(makePrimitiveGeometry(p), getMaterial(materialAsset, modulation));
					mesh.userData.ysongSelectableId = layer.id;
					mesh.castShadow = true;
					mesh.receiveShadow = true;
					primitiveGroup.add(mesh);
					selectableRoots.set(layer.id, mesh);
					runtime = { mesh, geometrySignature, materialId: p.materialId, body: null, bodySignature: "" };
					primitiveRuntime.set(p.id, runtime);
				} else {
					const previousSelectableId = String(runtime.mesh.userData.ysongSelectableId || "");
					if (previousSelectableId !== layer.id) {
						selectableRoots.delete(previousSelectableId);
						runtime.mesh.userData.ysongSelectableId = layer.id;
						selectableRoots.set(layer.id, runtime.mesh);
					}
					if (runtime.geometrySignature !== geometrySignature) {
						runtime.mesh.geometry.dispose();
						runtime.mesh.geometry = makePrimitiveGeometry(p);
						runtime.geometrySignature = geometrySignature;
					}
					if (runtime.materialId !== p.materialId) {
						runtime.mesh.material = getMaterial(materialAsset, modulation);
						runtime.materialId = p.materialId;
					} else {
						runtime.mesh.material = getMaterial(materialAsset, modulation);
					}
				}
				const pp = `primitive:${p.id}`;
				const px = modulationValue(modulation, `${pp}:positionX`, p.positionX, -10000, 10000),
					py = modulationValue(modulation, `${pp}:positionY`, p.positionY, -10000, 10000),
					pz = modulationValue(modulation, `${pp}:positionZ`, p.positionZ, -10000, 10000);
				const rx = modulationValue(modulation, `${pp}:rotationX`, p.rotationX, -Math.PI * 20, Math.PI * 20),
					ry = modulationValue(modulation, `${pp}:rotationY`, p.rotationY, -Math.PI * 20, Math.PI * 20),
					rz = modulationValue(modulation, `${pp}:rotationZ`, p.rotationZ, -Math.PI * 20, Math.PI * 20);
				const sx = modulationValue(modulation, `${pp}:scaleX`, p.scaleX, 0.001, 100),
					sy = modulationValue(modulation, `${pp}:scaleY`, p.scaleY, 0.001, 100),
					sz = modulationValue(modulation, `${pp}:scaleZ`, p.scaleZ, 0.001, 100);
				runtime.mesh.visible =
					state.project.mode !== "2d" && p.visible && visualLayerActive(layer, positionSeconds);
				runtime.mesh.scale.set(sx, sy, sz);
				if (physicsWorld && runtime.bodySignature !== primitiveBodySignature(p)) createPhysicsBody(p, runtime);
				const authoredRotation = new THREE.Euler(rx, ry, rz);
				const authoredQuaternion = new THREE.Quaternion().setFromEuler(authoredRotation);
				if (
					!physicsWorld ||
					!runtime.body ||
					state.physics.mode === "edit" ||
					!state.physics.enabled ||
					p.physics.bodyType === "static"
				) {
					runtime.mesh.position.set(px, py, pz);
					runtime.mesh.rotation.copy(authoredRotation);
					if (runtime.body) {
						runtime.body.setTranslation({ x: px, y: py, z: pz }, true);
						runtime.body.setRotation(
							{
								x: authoredQuaternion.x,
								y: authoredQuaternion.y,
								z: authoredQuaternion.z,
								w: authoredQuaternion.w,
							},
							true,
						);
						runtime.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
						runtime.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
					}
				} else if (p.physics.bodyType === "kinematic") {
					runtime.mesh.position.set(px, py, pz);
					runtime.mesh.rotation.copy(authoredRotation);
					runtime.body.setNextKinematicTranslation({ x: px, y: py, z: pz });
					runtime.body.setNextKinematicRotation({
						x: authoredQuaternion.x,
						y: authoredQuaternion.y,
						z: authoredQuaternion.z,
						w: authoredQuaternion.w,
					});
				}
			}
		};

		const modulationRuntime = new Map<string, number>();
		let lastOverlayModulationAt = 0;
		const resetSceneRuntime = () => {
			for (const [id, runtime] of [...primitiveRuntime]) destroyPrimitiveRuntime(id, runtime);
			for (const runtime of secondaryRuntime.values()) disposeSecondaryRuntime(runtime);
			secondaryRuntime.clear();
			for (const material of materialRuntime.values()) material.dispose();
			materialRuntime.clear();
			modulationRuntime.clear();
		};

		const render = (now: number) => {
			if (disposed) return;
			animationFrame = requestAnimationFrame(render);
			const sinceLast = now - lastRenderAt;
			if (lastRenderAt && sinceLast < FRAME_INTERVAL_MS - 0.35) return;
			lastRenderAt = now - (sinceLast % FRAME_INTERVAL_MS);
			const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
			lastTime = now;
			const currentScene = sceneRef.current;
			const nextPostSignature = currentScene.postFx.stack
				.map((m: VisualPostFxModule) => `${m.id}:${m.type}:${m.enabled ? 1 : 0}`)
				.join("|");
			if (nextPostSignature !== postStackSignature) {
				postStackSignature = nextPostSignature;
				rebuildPostStack(currentScene.postFx.stack);
				assignLutTexture();
			}
			if (currentScene.postFx.lutUrl !== lutLoadedUrl && currentScene.postFx.lutUrl !== lutRequestedUrl)
				requestLut(currentScene.postFx.lutUrl, currentScene.postFx.lutFileName);
			const currentAudio = audioRef.current;
			const currentTransport = transportRef.current;
			const currentTransportPosition = extrapolatedTransportPosition(currentTransport);
			for (const [effectId, pulse] of roomEffectPulsesRef.current)
				if (now >= pulse.until) roomEffectPulsesRef.current.delete(effectId);
			const roomCameraShake = roomEffectStrength(roomEffectPulsesRef.current, "camera-shake", now);
			const roomLightning = roomEffectStrength(roomEffectPulsesRef.current, "lightning", now);
			const roomStrobe = roomEffectStrength(roomEffectPulsesRef.current, "strobe", now);
			const modulation = evaluateVisualAudioModulation(
				currentScene,
				currentAudio,
				currentTransport,
				currentTransportPosition,
				dt,
				modulationRuntime,
			);
			const mv = (target: string, base: number, min = -Infinity, max = Infinity) =>
				modulationValue(modulation, target, base, min, max);
			const windEnabled = currentScene.wind.enabled;
			const windStrength = windEnabled ? mv("wind.strength", currentScene.wind.strength, 0, 30) : 0;
			const windDirectionX = mv("wind.directionX", currentScene.wind.directionX, -20, 20);
			const windDirectionZ = mv("wind.directionZ", currentScene.wind.directionZ, -20, 20);
			const windLength = Math.max(0.0001, Math.hypot(windDirectionX, windDirectionZ));
			const windGustiness = mv("wind.gustiness", currentScene.wind.gustiness, 0, 2);
			const windTurbulence = mv("wind.turbulence", currentScene.wind.turbulence, 0, 4);
			const windClock = now / 1000;
			const gustWave =
				(Math.sin(windClock * 0.73) +
					Math.sin(windClock * 1.91 + 1.7) * 0.5 +
					Math.sin(windClock * 0.23 + 4.1) * 0.25) /
				1.75;
			const gustMultiplier = Math.max(0.05, 1 + gustWave * windGustiness);
			const worldWindX = (windDirectionX / windLength) * windStrength * gustMultiplier;
			const worldWindZ = (windDirectionZ / windLength) * windStrength * gustMultiplier;
			if (now - lastOverlayModulationAt >= 33) {
				lastOverlayModulationAt = now;
				const nextOverlay = Object.fromEntries(modulation.deltas.entries());
				setOverlayModulationDeltas((previous) => {
					const previousKeys = Object.keys(previous),
						nextKeys = Object.keys(nextOverlay);
					if (
						previousKeys.length === nextKeys.length &&
						nextKeys.every((key) => Math.abs((previous[key] ?? 0) - (nextOverlay[key] ?? 0)) < 0.0005)
					)
						return previous;
					return nextOverlay;
				});
			}

			// The top-most active media clip is the scene background. It is composited inside
			// WebGL so bloom/post-processing can never black it out. Foreground 3D geometry,
			// spectrum and Now Playing remain above it.
			const backgroundLayer = currentScene.layers.find(
				(layer) =>
					layer.type === "media" &&
					layer.visible &&
					!!layer.mediaUrl &&
					visualLayerActive(layer, currentTransportPosition),
			);
			if (backgroundLayer) {
				ensureBackgroundMedia(backgroundLayer);
				const backgroundOpacity = mv(
					`layer:${backgroundLayer.id}:opacity`,
					visualLayerOpacityAt(backgroundLayer, currentTransportPosition),
					0,
					1,
				);
				// Background fades darken toward black instead of making the media plane transparent.
				// Keeping the plane opaque makes its render ordering deterministic: background media first,
				// optional sky environment second, then the 3D world. Fog and lights cannot touch it.
				mediaMaterial.color.setScalar(Math.max(0, Math.min(1, backgroundOpacity)));
				mediaPlane.visible = !!backgroundTexture && backgroundOpacity > 0.001;
				frameBackgroundMedia(backgroundLayer);
				if (backgroundVideo) {
					const timeline = backgroundLayer.timeline ?? {
						start: 0,
						duration: 0,
						trimIn: 0,
						trimOut: 0,
						fadeIn: 0,
						fadeOut: 0,
					};
					const speed = mv(`layer:${backgroundLayer.id}:speed`, backgroundLayer.speed ?? 1, 0.25, 4);
					backgroundVideo.playbackRate = speed;
					backgroundVideo.loop = backgroundLayer.loop !== false;
					const local = Math.max(0, currentTransportPosition - timeline.start);
					const knownDuration = Math.max(
						0,
						backgroundLayer.sourceDuration ?? 0,
						Number.isFinite(backgroundVideo.duration) ? backgroundVideo.duration : 0,
					);
					const sourceOut =
						timeline.trimOut > timeline.trimIn
							? Math.min(knownDuration || timeline.trimOut, timeline.trimOut)
							: knownDuration;
					const sourceSpan = Math.max(0.01, sourceOut - timeline.trimIn);
					let desired = timeline.trimIn + local * speed;
					if (backgroundLayer.loop !== false && sourceSpan > 0.05)
						desired =
							timeline.trimIn + ((((desired - timeline.trimIn) % sourceSpan) + sourceSpan) % sourceSpan);
					else if (sourceOut > timeline.trimIn) desired = Math.min(sourceOut - 0.001, desired);
					const drift = Math.abs((backgroundVideo.currentTime || 0) - desired);
					if (backgroundVideo.readyState >= 1 && drift > (currentTransport.playing ? 0.55 : 0.035)) {
						try {
							backgroundVideo.currentTime = Math.max(0, desired);
						} catch {
							/* metadata can race */
						}
					}
					if (currentTransport.playing && backgroundVideo.readyState >= 2) {
						if (backgroundVideo.paused) void backgroundVideo.play().catch(() => {});
					} else if (!backgroundVideo.paused) backgroundVideo.pause();
				}
			} else {
				mediaPlane.visible = false;
				if (backgroundVideo && !backgroundVideo.paused) backgroundVideo.pause();
			}

			const objectLayer = currentScene.layers.find((layer) => layer.type === "object");
			for (const [key, value] of selectableRoots)
				if (value === performerRoot && key !== objectLayer?.id) selectableRoots.delete(key);
			if (objectLayer) {
				performerRoot.userData.ysongSelectableId = objectLayer.id;
				selectableRoots.set(objectLayer.id, performerRoot);
			} else performerRoot.userData.ysongSelectableId = "";
			const particlesLayer = currentScene.layers.find((layer) => layer.type === "particles");
			const stageLayer = currentScene.layers.find((layer) => layer.type === "stage");
			const floorSelectableId = String(floor.userData.ysongSelectableId || "");
			if (stageLayer) {
				if (floorSelectableId && floorSelectableId !== stageLayer.id) selectableRoots.delete(floorSelectableId);
				floor.userData.ysongSelectableId = stageLayer.id;
				selectableRoots.set(stageLayer.id, floor);
			} else {
				if (floorSelectableId) selectableRoots.delete(floorSelectableId);
				floor.userData.ysongSelectableId = "";
			}
			const lightingLayer = currentScene.layers.find((layer) => layer.type === "lighting");
			const fogLayer = currentScene.layers.find((layer) => layer.type === "fog");
			const cloudsLayer = currentScene.layers.find((layer) => layer.type === "clouds");
			const weatherLayer = currentScene.layers.find((layer) => layer.type === "weather");
			const stageActive =
				currentScene.project.mode !== "2d" &&
				!!stageLayer &&
				visualLayerActive(stageLayer, currentTransportPosition);
			const lightingActive =
				currentScene.project.mode !== "2d" &&
				!!lightingLayer &&
				visualLayerActive(lightingLayer, currentTransportPosition);
			const fogActive =
				currentScene.project.mode !== "2d" &&
				!!fogLayer &&
				visualLayerActive(fogLayer, currentTransportPosition);
			const weatherActive =
				currentScene.project.mode !== "2d" &&
				!!weatherLayer &&
				visualLayerActive(weatherLayer, currentTransportPosition);
			const weatherLayerOpacity = weatherActive
				? mv(
						`layer:${weatherLayer!.id}:opacity`,
						visualLayerOpacityAt(weatherLayer!, currentTransportPosition),
						0,
						1,
					)
				: 0;
			const weather = {
				...currentScene.weather,
				intensity: mv("weather.intensity", currentScene.weather.intensity, 0, 4),
				rain: mv("weather.rain", currentScene.weather.rain, 0, 1),
				snow: mv("weather.snow", currentScene.weather.snow, 0, 1),
				ash: mv("weather.ash", currentScene.weather.ash, 0, 1),
				dust: mv("weather.dust", currentScene.weather.dust, 0, 1),
				sand: mv("weather.sand", currentScene.weather.sand, 0, 1),
				magic: mv("weather.magic", currentScene.weather.magic, 0, 1),
				fog: mv("weather.fog", currentScene.weather.fog, 0, 1),
				heatHaze: mv("weather.heatHaze", currentScene.weather.heatHaze, 0, 1),
				lightning: mv("weather.lightning", currentScene.weather.lightning, 0, 1),
				fallSpeed: mv("weather.fallSpeed", currentScene.weather.fallSpeed, 0.01, 10),
				rainOpacity: mv("weather.rainOpacity", currentScene.weather.rainOpacity, 0, 1),
				rainVelocity: mv("weather.rainVelocity", currentScene.weather.rainVelocity, 0, 8),
				snowOpacity: mv("weather.snowOpacity", currentScene.weather.snowOpacity, 0, 1),
				snowVelocity: mv("weather.snowVelocity", currentScene.weather.snowVelocity, -8, 8),
				ashOpacity: mv("weather.ashOpacity", currentScene.weather.ashOpacity, 0, 1),
				ashVelocity: mv("weather.ashVelocity", currentScene.weather.ashVelocity, -8, 8),
				dustOpacity: mv("weather.dustOpacity", currentScene.weather.dustOpacity, 0, 1),
				dustVelocity: mv("weather.dustVelocity", currentScene.weather.dustVelocity, -8, 8),
				sandOpacity: mv("weather.sandOpacity", currentScene.weather.sandOpacity, 0, 1),
				sandVelocity: mv("weather.sandVelocity", currentScene.weather.sandVelocity, -8, 8),
				magicOpacity: mv("weather.magicOpacity", currentScene.weather.magicOpacity, 0, 1),
				magicVelocity: mv("weather.magicVelocity", currentScene.weather.magicVelocity, -8, 8),
			};
			const weatherMaster = weatherActive ? weather.intensity * weatherLayerOpacity : 0;
			const strikeRate = Math.max(0, weather.lightningRate);
			const strikePeriod = strikeRate > 0 ? 60 / strikeRate : 999999;
			const strikeClock = Math.max(0, currentTransportPosition);
			const strikeIndex = Math.floor(strikeClock / strikePeriod);
			const strikePhase = strikePeriod < 999999 ? (strikeClock - strikeIndex * strikePeriod) / strikePeriod : 1;
			const strikeSeed = Math.abs(Math.sin((strikeIndex + 1) * 91.713) * 43758.5453) % 1;
			const strikeWindow = 0.045 + 0.035 * strikeSeed;
			const weatherFlash =
				weatherMaster *
				weather.lightning *
				(strikePhase < strikeWindow ? Math.pow(1 - strikePhase / strikeWindow, 2) : 0);
			const perfConfig = currentScene.performance;
			const objectIsPerformer =
				currentScene.object.model === "mannequin" ||
				currentScene.object.role === "performer" ||
				(currentScene.object.role === "auto" && glb.bones.length > 0);
			if (!objectIsPerformer) performanceRuntime.active = null;
			if (performanceRuntime.active && now - performanceRuntime.startedAt >= performanceRuntime.durationMs) {
				performanceRuntime.active = null;
				performanceRuntime.source = "idle";
			}
			if (!sceneHydratedRef.current) {
				// Never interpret DEFAULT_VISUAL_SCENE -> persisted scene hydration as a new cue.
				performanceRuntime.manualInitialized = false;
				performanceRuntime.active = null;
				performanceRuntime.lastTransportPosition = currentTransportPosition;
			} else if (!performanceRuntime.manualInitialized) {
				performanceRuntime.manualSequence = perfConfig.manualCueSequence;
				performanceRuntime.manualInitialized = true;
				performanceRuntime.lastTransportPosition = currentTransportPosition;
			} else if (objectIsPerformer && perfConfig.manualCueSequence !== performanceRuntime.manualSequence) {
				performanceRuntime.manualSequence = perfConfig.manualCueSequence;
				const manualCue = PERFORMANCE_BY_ID.get(perfConfig.manualCueId);
				if (manualCue)
					triggerPerformance(performanceRuntime, manualCue, perfConfig.manualCueStrength, "manual", now);
			}
			const transportDelta = currentTransportPosition - performanceRuntime.lastTransportPosition;
			if (
				objectIsPerformer &&
				sceneHydratedRef.current &&
				currentTransport.playing &&
				transportDelta >= 0 &&
				transportDelta < 0.65
			) {
				const timelineCue = perfConfig.timelineCues
					.filter(
						(cue) =>
							cue.time > performanceRuntime.lastTransportPosition &&
							cue.time <= currentTransportPosition + 0.015,
					)
					.sort((a, b) => a.time - b.time)
					.at(-1);
				if (timelineCue) {
					const cue = PERFORMANCE_BY_ID.get(timelineCue.cueId);
					if (cue) triggerPerformance(performanceRuntime, cue, timelineCue.strength, "timeline", now);
				}
			}
			performanceRuntime.lastTransportPosition = currentTransportPosition;
			if (objectIsPerformer && sceneHydratedRef.current && !performanceRuntime.active) {
				const autoCue = chooseAutoCue(currentScene, currentAudio, performanceRuntime, now);
				if (autoCue)
					triggerPerformance(
						performanceRuntime,
						autoCue,
						Math.max(0.35, perfConfig.directorIntensity),
						"auto",
						now,
					);
			}
			const perfEnvelope = performanceWeight(now, performanceRuntime);
			const activeCue = performanceRuntime.active;
			const cueWeight = objectIsPerformer ? perfEnvelope.weight : 0;
			const cueStrength = performanceRuntime.strength;
			const cueShake =
				(activeCue?.shake ?? 0) * cueWeight * cueStrength * perfConfig.cameraShake +
				(activeCue?.impact ?? 0) * perfEnvelope.impact * perfConfig.impactStrength * 0.45;
			const activeProgramCamera = resolveVisualProgramCamera(
				currentScene,
				currentTransportPosition,
			);
			let cameraLensResponse = activeProgramCamera?.lensFlare ?? 1;
			let cameraExposure = 1;
			if (editorFreeRoam) {
				const moveSpeed = (editorFast ? 8.5 : 3.2) * dt;
				updateEditorAxes();
				if (editorKeys.has("KeyW")) camera.position.addScaledVector(editorForward, moveSpeed);
				if (editorKeys.has("KeyS")) camera.position.addScaledVector(editorForward, -moveSpeed);
				if (editorKeys.has("KeyA")) camera.position.addScaledVector(editorRight, -moveSpeed);
				if (editorKeys.has("KeyD")) camera.position.addScaledVector(editorRight, moveSpeed);
				if (editorKeys.has("Space") || editorKeys.has("KeyE")) camera.position.y += moveSpeed;
				if (
					editorKeys.has("ControlLeft") ||
					editorKeys.has("ControlRight") ||
					editorKeys.has("KeyC") ||
					editorKeys.has("KeyQ")
				)
					camera.position.y -= moveSpeed;
				camera.lookAt(camera.position.clone().add(editorForward));
				ensureCameraHelpers(currentScene, currentTransportPosition);
				if (now - lastEditorCameraPost > 120) {
					lastEditorCameraPost = now;
					window.parent.postMessage(
						{
							type: "ysong-editor-camera",
							position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
							rotation: { x: camera.rotation.x, y: camera.rotation.y, z: camera.rotation.z },
							fov: camera.fov,
						},
						window.location.origin,
					);
				}
			} else if (activeProgramCamera) {
				const programCamera = sampleVisualProgramCamera(activeProgramCamera, currentTransportPosition);
				const cameraPrefix = `camera:${activeProgramCamera.id}`;
				programCamera.positionX = mv(`${cameraPrefix}:positionX`, programCamera.positionX, -10000, 10000);
				programCamera.positionY = mv(`${cameraPrefix}:positionY`, programCamera.positionY, -10000, 10000);
				programCamera.positionZ = mv(`${cameraPrefix}:positionZ`, programCamera.positionZ, -10000, 10000);
				programCamera.rotationX = mv(
					`${cameraPrefix}:rotationX`,
					programCamera.rotationX,
					-Math.PI * 20,
					Math.PI * 20,
				);
				programCamera.rotationY = mv(
					`${cameraPrefix}:rotationY`,
					programCamera.rotationY,
					-Math.PI * 20,
					Math.PI * 20,
				);
				programCamera.rotationZ = mv(
					`${cameraPrefix}:rotationZ`,
					programCamera.rotationZ,
					-Math.PI * 20,
					Math.PI * 20,
				);
				programCamera.fov = mv(`${cameraPrefix}:fov`, programCamera.fov, 10, 140);
				programCamera.focusDistance = mv(
					`${cameraPrefix}:focusDistance`,
					programCamera.focusDistance,
					0.1,
					10000,
				);
				programCamera.focusRange = mv(`${cameraPrefix}:focusRange`, programCamera.focusRange, 0.02, 1000);
				programCamera.maxBlur = mv(`${cameraPrefix}:maxBlur`, programCamera.maxBlur, 0, 40);
				programCamera.bokehSize = mv(`${cameraPrefix}:bokehSize`, programCamera.bokehSize, 0.1, 8);
				programCamera.exposure = mv(`${cameraPrefix}:exposure`, programCamera.exposure, 0.05, 8);
				programCamera.shakeAmount = mv(`${cameraPrefix}:shakeAmount`, programCamera.shakeAmount, 0, 10);
				programCamera.shakeFrequency = mv(
					`${cameraPrefix}:shakeFrequency`,
					programCamera.shakeFrequency,
					0.05,
					30,
				);
				programCamera.shakeRotation = mv(`${cameraPrefix}:shakeRotation`, programCamera.shakeRotation, 0, 45);
				cameraLensResponse = mv(`${cameraPrefix}:lensFlare`, activeProgramCamera.lensFlare, 0, 10);
				cameraExposure = Math.max(0.05, programCamera.exposure);
				const nextFov = Math.max(10, Math.min(140, programCamera.fov));
				const nextNear = Math.max(0.01, activeProgramCamera.near),
					nextFar = Math.max(nextNear + 0.1, activeProgramCamera.far);
				if (
					Math.abs(camera.fov - nextFov) > 0.01 ||
					Math.abs(camera.near - nextNear) > 0.001 ||
					Math.abs(camera.far - nextFar) > 0.01
				) {
					camera.fov = nextFov;
					camera.near = nextNear;
					camera.far = nextFar;
					camera.updateProjectionMatrix();
				}
				const authoredShake = deterministicCameraShake(
					currentTransportPosition,
					activeProgramCamera.shakeSeed,
					programCamera.shakeFrequency,
				);
				camera.position.x =
					programCamera.positionX +
					authoredShake.x * programCamera.shakeAmount +
					Math.sin(now * 0.071) * cueShake * 0.075 +
					Math.sin(now * 0.132) * roomCameraShake * 0.18;
				camera.position.y =
					programCamera.positionY +
					authoredShake.y * programCamera.shakeAmount +
					Math.cos(now * 0.083) * cueShake * 0.052 +
					Math.cos(now * 0.117) * roomCameraShake * 0.12;
				camera.position.z =
					programCamera.positionZ +
					authoredShake.z * programCamera.shakeAmount +
					Math.sin(now * 0.097) * cueShake * 0.035 +
					Math.sin(now * 0.103) * roomCameraShake * 0.09;
				if (activeProgramCamera.aimMode === "rotation")
					camera.rotation.set(programCamera.rotationX, programCamera.rotationY, programCamera.rotationZ);
				else {
					let targetX = programCamera.targetX,
						targetY = programCamera.targetY,
						targetZ = programCamera.targetZ;
					if (activeProgramCamera.targetMode === "performer") {
						targetX = performerRoot.position.x + programCamera.targetOffsetX;
						targetY = performerRoot.position.y + programCamera.targetOffsetY;
						targetZ = performerRoot.position.z + programCamera.targetOffsetZ;
					} else if (activeProgramCamera.targetMode === "primitive" && activeProgramCamera.targetEntityId) {
						const targetRuntime = primitiveRuntime.get(activeProgramCamera.targetEntityId);
						if (targetRuntime) {
							const targetWorld = new THREE.Vector3();
							targetRuntime.mesh.getWorldPosition(targetWorld);
							targetX = targetWorld.x + programCamera.targetOffsetX;
							targetY = targetWorld.y + programCamera.targetOffsetY;
							targetZ = targetWorld.z + programCamera.targetOffsetZ;
						}
					}
					camera.lookAt(targetX, targetY, targetZ);
				}
				const shakeRadians = THREE.MathUtils.degToRad(programCamera.shakeRotation);
				if (shakeRadians > 0.00001) camera.rotateZ(authoredShake.roll * shakeRadians);
				if (roomCameraShake > 0.001) camera.rotateZ(Math.sin(now * 0.151) * roomCameraShake * 0.018);
				for (const runtime of postRuntimes) {
					if (runtime.type !== "depthOfField" || !runtime.uniforms) continue;
					const uniforms = runtime.uniforms;
					runtime.pass.enabled =
						runtime.module.enabled &&
						Math.abs(programCamera.dofBalance) > 0.001 &&
						programCamera.maxBlur > 0.01;
					uniforms.cameraNear.value = nextNear;
					uniforms.cameraFar.value = nextFar;
					uniforms.focusDistance.value = Math.max(0.1, programCamera.focusDistance);
					uniforms.focusRange.value = Math.max(0.02, programCamera.focusRange);
					uniforms.dofBalance.value = Math.max(-1, Math.min(1, programCamera.dofBalance));
					uniforms.maxBlur.value = Math.max(0, programCamera.maxBlur);
					uniforms.aperture.value = Math.max(0.7, programCamera.aperture);
					uniforms.bokehSize.value = Math.max(0.1, programCamera.bokehSize);
					uniforms.bokehBlades.value = Math.max(3, programCamera.bokehBlades);
					uniforms.bokehRotation.value = THREE.MathUtils.degToRad(programCamera.bokehRotation);
					uniforms.bokehThreshold.value = programCamera.bokehThreshold;
					uniforms.bokehGain.value = programCamera.bokehGain;
					uniforms.bokehAnamorphic.value = programCamera.bokehAnamorphic;
				}
			}
			if (editorFreeRoam) {
				if (editorFxPreview && activeProgramCamera) {
					const previewCamera = sampleVisualProgramCamera(activeProgramCamera, currentTransportPosition);
					for (const runtime of postRuntimes) {
						if (runtime.type !== "depthOfField" || !runtime.uniforms) continue;
						const uniforms = runtime.uniforms;
						runtime.pass.enabled =
							runtime.module.enabled &&
							Math.abs(previewCamera.dofBalance) > 0.001 &&
							previewCamera.maxBlur > 0.01;
						uniforms.cameraNear.value = camera.near;
						uniforms.cameraFar.value = camera.far;
						uniforms.focusDistance.value = Math.max(0.1, previewCamera.focusDistance);
						uniforms.focusRange.value = Math.max(0.02, previewCamera.focusRange);
						uniforms.dofBalance.value = Math.max(-1, Math.min(1, previewCamera.dofBalance));
						uniforms.maxBlur.value = Math.max(0, previewCamera.maxBlur);
						uniforms.aperture.value = Math.max(0.7, previewCamera.aperture);
						uniforms.bokehSize.value = Math.max(0.1, previewCamera.bokehSize);
						uniforms.bokehBlades.value = Math.max(3, previewCamera.bokehBlades);
						uniforms.bokehRotation.value = THREE.MathUtils.degToRad(previewCamera.bokehRotation);
						uniforms.bokehThreshold.value = previewCamera.bokehThreshold;
						uniforms.bokehGain.value = previewCamera.bokehGain;
						uniforms.bokehAnamorphic.value = previewCamera.bokehAnamorphic;
					}
				} else
					for (const runtime of postRuntimes)
						if (runtime.type === "depthOfField") runtime.pass.enabled = false;
			}

			const skyScene = {
				...currentScene,
				sky: {
					...currentScene.sky,
					rotationY: mv("sky.rotationY", currentScene.sky.rotationY, -Math.PI * 20, Math.PI * 20),
					brightness: mv("sky.brightness", currentScene.sky.brightness, 0.01, 10),
				},
			};
			updateSky(skyScene, currentTransportPosition);

			const stage = {
				...currentScene.stage,
				ambientIntensity: mv("stage.ambientIntensity", currentScene.stage.ambientIntensity, 0, 20),
				sunIntensity: mv("stage.sunIntensity", currentScene.stage.sunIntensity, 0, 30),
				moonIntensity: mv("stage.moonIntensity", currentScene.stage.moonIntensity, 0, 30),
				keyIntensity: mv("stage.keyIntensity", currentScene.stage.keyIntensity, 0, 40),
				rimIntensity: mv("stage.rimIntensity", currentScene.stage.rimIntensity, 0, 40),
				fillIntensity: mv("stage.fillIntensity", currentScene.stage.fillIntensity, 0, 40),
				fogFar: mv("stage.fogFar", currentScene.stage.fogFar, currentScene.stage.fogNear + 0.5, 500),
				exposure: mv("stage.exposure", currentScene.stage.exposure, 0.05, 10),
				bloomStrength: mv("stage.bloomStrength", currentScene.stage.bloomStrength, 0, 10),
				lensFlareIntensity: mv("stage.lensFlareIntensity", currentScene.stage.lensFlareIntensity, 0, 10),
			};
			const sunReact = visualAudioValue(stage.sunSource, currentAudio) * stage.sunAmount;
			const moonReact = visualAudioValue(stage.moonSource, currentAudio) * stage.moonAmount;
			const keyReact = visualAudioValue(stage.keySource, currentAudio) * stage.keyAmount;
			const rimReact = visualAudioValue(stage.rimSource, currentAudio) * stage.rimAmount;
			const fillReact = visualAudioValue(stage.fillSource, currentAudio) * stage.fillAmount;
			const fogReact = visualAudioValue(stage.fogSource, currentAudio) * stage.fogAmount;
			const cueFog = (activeCue?.fog ?? 0) * cueWeight * cueStrength * perfConfig.fogBurst;
			const cueGlow = (activeCue?.glow ?? 0) * cueWeight * cueStrength;
			const cueFlash = (activeCue?.flash ?? 0) * (0.35 + perfEnvelope.impact * 0.65) * cueWeight * cueStrength;
			ambient.color.set(stage.ambientSkyColor);
			ambient.groundColor.set(stage.ambientGroundColor);
			ambient.intensity = lightingActive
				? stage.ambientIntensity * (1 + cueFlash * 0.75 + roomStrobe * 0.8 + roomLightning * 0.55)
				: 0;
			sun.color.set(stage.sunColor);
			sun.intensity = lightingActive ? stage.sunIntensity * (1 + sunReact) : 0;
			sun.position.set(stage.sunX, stage.sunY, stage.sunZ);
			moon.color.set(stage.moonColor);
			moon.intensity = lightingActive && stage.moonEnabled ? stage.moonIntensity * (1 + moonReact) : 0;
			moon.position.set(stage.moonX, stage.moonY, stage.moonZ);
			key.color.set(stage.keyColor);
			key.intensity = lightingActive
				? stage.keyIntensity * (1 + keyReact + cueFlash * 1.7 + roomStrobe * 2.5 + roomLightning * 2.2)
				: 0;
			key.position.set(stage.keyX, stage.keyY, stage.keyZ);
			key.angle = THREE.MathUtils.degToRad(Math.max(5, Math.min(88, stage.keyAngle)));
			key.penumbra = Math.max(0, Math.min(1, stage.keyPenumbra));
			key.distance = Math.max(0, stage.keyDistance);
			key.target.position.copy(performerRoot.position);
			rim.color.set(stage.rimColor);
			rim.intensity = lightingActive ? stage.rimIntensity * (1 + rimReact) : 0;
			rim.position.set(stage.rimX, stage.rimY, stage.rimZ);
			floorLight.color.set(stage.fillColor);
			floorLight.intensity = lightingActive ? stage.fillIntensity * (1 + fillReact) : 0;
			floorLight.position.set(stage.fillX, stage.fillY, stage.fillZ);
			renderer.toneMappingExposure = Math.max(0.2, lightingActive ? stage.exposure : 1);
			renderer.shadowMap.enabled = lightingActive && stage.shadows;
			sun.castShadow = lightingActive && stage.shadows && stage.sunShadows;
			moon.castShadow = lightingActive && stage.shadows && stage.moonEnabled && stage.moonShadows;
			key.castShadow = lightingActive && stage.shadows && stage.keyShadows;
			sun.shadow.bias = stage.shadowBias;
			moon.shadow.bias = stage.shadowBias;
			key.shadow.bias = stage.shadowBias;
			const authoredShadowMap = [512, 1024, 2048, 4096].includes(Math.round(stage.shadowMapSize))
				? Math.round(stage.shadowMapSize)
				: 1024;
			const requestedShadowMap = Math.min(authoredShadowMap, runtimeQuality.shadowMapSize);
			if (requestedShadowMap !== shadowMapSize) {
				shadowMapSize = requestedShadowMap;
				sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
				moon.shadow.mapSize.set(shadowMapSize, shadowMapSize);
				key.shadow.mapSize.set(shadowMapSize, shadowMapSize);
				sun.shadow.map?.dispose();
				sun.shadow.map = null;
				moon.shadow.map?.dispose();
				moon.shadow.map = null;
				key.shadow.map?.dispose();
				key.shadow.map = null;
			}
			floor.visible = stageActive && stage.floorVisible;
			floor.scale.setScalar(Math.max(0.2, stage.floorSize / 40));
			floorMaterial.color.set(stage.floorColor);
			floorMaterial.opacity = Math.max(0, Math.min(1, stage.floorOpacity));
			floorMaterial.depthWrite = floorMaterial.opacity >= 0.98;
			if (weatherActive && weather.fog * weatherMaster > 0.002) {
				weatherFog.color.set(weather.fogColor);
				weatherFog.density = Math.max(0.0001, Math.min(0.18, 0.002 + weather.fog * weatherMaster * 0.045));
				threeScene.fog = weatherFog;
			} else if (fogActive && stage.fogEnabled) {
				stageFog.color.set(stage.fogColor);
				stageFog.near = Math.max(0.1, stage.fogNear);
				stageFog.far = Math.max(stageFog.near + 0.5, stage.fogFar - fogReact * 6 - cueFog * 8);
				threeScene.fog = stageFog;
			} else {
				threeScene.fog = null;
			}
			weatherFlashLight.color.set(roomLightning > 0.001 ? 0xded8ff : weather.lightningColor);
			weatherFlashLight.intensity = Math.max(0, weatherFlash * 14 + roomLightning * 18 + roomStrobe * 8);
			const bloomStrength =
				(lightingActive ? stage.bloomStrength + cueGlow * 0.55 + cueFlash * 0.35 : 0) +
				weatherFlash * 0.55 +
				roomLightning * 0.65 +
				roomStrobe * 0.35;
			for (const runtime of postRuntimes) {
				if (runtime.type !== "bloom") continue;
				const pass = runtime.pass as UnrealBloomPass;
				pass.enabled = runtime.module.enabled && bloomStrength > 0.001;
				pass.strength = bloomStrength;
				pass.radius = Math.max(0, Math.min(1, stage.bloomRadius));
				pass.threshold = Math.max(0, Math.min(1, stage.bloomThreshold));
			}
			lensFlareSprite.visible = lightingActive && stage.lensFlareEnabled && (!editorFreeRoam || editorFxPreview);
			lensFlareSprite.position.copy(sun.position);
			flareMaterial.color.set(stage.sunColor);
			flareMaterial.opacity = lensFlareSprite.visible
				? Math.max(0, Math.min(1, stage.lensFlareIntensity * (activeProgramCamera ? cameraLensResponse : 1)))
				: 0;

			const cloudsActive =
				currentScene.project.mode !== "2d" &&
				!!cloudsLayer &&
				visualLayerActive(cloudsLayer, currentTransportPosition);
			cloudGroup.visible = cloudsActive;
			if (cloudsActive) {
				const cfg = {
					...currentScene.clouds,
					coverage: mv("clouds.coverage", currentScene.clouds.coverage, 0.01, 1),
					density: mv("clouds.density", currentScene.clouds.density, 0.01, 1),
					altitude: mv("clouds.altitude", currentScene.clouds.altitude, -100, 1000),
					thickness: mv("clouds.thickness", currentScene.clouds.thickness, 0.1, 200),
					windX: mv("clouds.windX", currentScene.clouds.windX, -20, 20),
					windZ: mv("clouds.windZ", currentScene.clouds.windZ, -20, 20),
					speed: mv("clouds.speed", currentScene.clouds.speed, -10, 10),
					brightness: mv("clouds.brightness", currentScene.clouds.brightness, 0.01, 10),
					lightAbsorption: mv("clouds.lightAbsorption", currentScene.clouds.lightAbsorption, 0, 1),
				};
				const qualityCount = cfg.quality === "ultra" ? 144 : cfg.quality === "high" ? 96 : 56;
				const visibleCount = Math.max(
					4,
					Math.min(
						cloudSprites.length,
						Math.round(
							qualityCount * runtimeQuality.cloudMultiplier * Math.max(0.08, Math.min(1, cfg.coverage)),
						),
					),
				);
				const sharedCloudX = currentScene.wind.enabled && currentScene.wind.affectsClouds ? worldWindX : 0;
				const sharedCloudZ = currentScene.wind.enabled && currentScene.wind.affectsClouds ? worldWindZ : 0;
				cloudMaterial.color
					.set(cfg.color)
					.multiplyScalar(Math.max(0.05, cfg.brightness * (1 - cfg.lightAbsorption * 0.48)));
				cloudMaterial.opacity = Math.max(
					0.02,
					Math.min(
						0.92,
						cfg.density * mv(`layer:${cloudsLayer!.id}:opacity`, cloudsLayer?.opacity ?? 1, 0, 1),
					),
				);
				for (let i = 0; i < cloudSprites.length; i++) {
					const sprite = cloudSprites[i];
					sprite.visible = i < visibleCount;
					if (!sprite.visible) continue;
					const a = Math.abs(sprite.userData.seedA as number),
						b = Math.abs(sprite.userData.seedB as number),
						c = Math.abs(sprite.userData.seedC as number);
					const drift = (now / 1000) * cfg.speed;
					const radius = 12 + 20 * a;
					const localX = cfg.windX + sharedCloudX * 0.22,
						localZ = cfg.windZ + sharedCloudZ * 0.22;
					const theta = i * 2.399 + drift * 0.08;
					sprite.position.set(
						Math.cos(theta) * radius + drift * localX * 1.4,
						cfg.altitude + (b - 0.5) * cfg.thickness,
						Math.sin(theta) * radius + drift * localZ * 1.4 - 8,
					);
					const size = (4 + 9 * c) * cfg.scale * (0.75 + cfg.softness * 0.45);
					sprite.scale.set(size * 1.65, size, 1);
				}
			}
			const rainWeight = Math.max(0, weather.rain * weather.rainOpacity * weatherMaster);
			const weatherWeights = [
				[weather.snow, weather.snowOpacity],
				[weather.ash, weather.ashOpacity],
				[weather.dust, weather.dustOpacity],
				[weather.sand, weather.sandOpacity],
				[weather.magic, weather.magicOpacity],
			].map(([amount, opacity]) => Math.max(0, amount * opacity * weatherMaster));
			const weatherWeightTotal = weatherWeights.reduce((sum, value) => sum + value, 0);
			weatherRuntime.points.visible = weatherActive && weatherWeightTotal > 0.002;
			if (weatherRuntime.points.visible) {
				const density = Math.min(1, weatherWeightTotal / 1.45);
				const count = Math.max(
					8,
					Math.min(
						MAX_WEATHER_PARTICLES,
						Math.round(MAX_WEATHER_PARTICLES * density * runtimeQuality.weatherMultiplier),
					),
				);
				weatherRuntime.geometry.setDrawRange(0, count);
				weatherRuntime.material.opacity = Math.max(0.03, Math.min(1, 0.28 + weatherMaster * 0.58));
				weatherRuntime.material.size = Math.max(0.012, weather.precipitationSize * 0.055);
				weatherRuntime.material.blending =
					weather.magic > Math.max(weather.snow, weather.ash, weather.dust, weather.sand)
						? THREE.AdditiveBlending
						: THREE.NormalBlending;
				const wx = currentScene.wind.enabled && currentScene.wind.affectsWeather ? worldWindX : 0,
					wz = currentScene.wind.enabled && currentScene.wind.affectsWeather ? worldWindZ : 0;
				const area = Math.max(2, weather.area),
					height = Math.max(2, weather.height);
				const weatherClock = now / 1000;
				const colors = [
					new THREE.Color(weather.snowColor),
					new THREE.Color(weather.ashColor),
					new THREE.Color(weather.dustColor),
					new THREE.Color(weather.sandColor),
					new THREE.Color(weather.magicColor),
				];
				for (let i = 0; i < count; i++) {
					const i3 = i * 3,
						i4 = i * 4,
						a = weatherRuntime.seeds[i4],
						b = weatherRuntime.seeds[i4 + 1],
						c = weatherRuntime.seeds[i4 + 2],
						d = weatherRuntime.seeds[i4 + 3];
					let pick = d * weatherWeightTotal,
						kind = 0;
					for (let k = 0; k < weatherWeights.length; k++) {
						pick -= weatherWeights[k];
						if (pick <= 0) {
							kind = k;
							break;
						}
					}
					const speeds = [
						weather.snowVelocity,
						weather.ashVelocity,
						weather.dustVelocity,
						weather.sandVelocity,
						weather.magicVelocity,
					];
					const sway = [0.32, 0.45, 0.72, 0.88, 0.65];
					const speed = speeds[kind] * weather.fallSpeed;
					const verticalRaw = b * height + weatherClock * speed;
					const vertical = ((verticalRaw % height) + height) % height;
					const y = height * 0.5 - vertical;
					const turbulence =
						(Math.sin(weatherClock * (0.8 + c * 1.7) + d * 18.2) +
							Math.cos(weatherClock * 0.43 + a * 11.7)) *
						0.5 *
						windTurbulence *
						sway[kind];
					const windAge = (height * 0.5 - y) / height;
					const x = wrappedWeather(
						(a - 0.5) * area + wx * weatherClock * 0.35 + wx * windAge * 1.8 + turbulence,
						area,
					);
					const z = wrappedWeather(
						(c - 0.5) * area +
							wz * weatherClock * 0.35 +
							wz * windAge * 1.8 +
							Math.sin(weatherClock * 0.51 + d * 9.1) * windTurbulence * sway[kind],
						area,
					);
					weatherRuntime.positions[i3] = x;
					weatherRuntime.positions[i3 + 1] = y;
					weatherRuntime.positions[i3 + 2] = z;
					const col = colors[kind];
					weatherRuntime.colors[i3] = col.r;
					weatherRuntime.colors[i3 + 1] = col.g;
					weatherRuntime.colors[i3 + 2] = col.b;
				}
				(weatherRuntime.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
				(weatherRuntime.geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
				weatherRuntime.points.position.set(camera.position.x, camera.position.y, camera.position.z);
			}
			rainRuntime.lines.visible = weatherActive && rainWeight > 0.002;
			if (rainRuntime.lines.visible) {
				const rainDensity = Math.max(0.04, Math.min(1, rainWeight));
				const rainCount = Math.max(
					24,
					Math.min(
						MAX_RAIN_STREAKS,
						Math.round(MAX_RAIN_STREAKS * rainDensity * runtimeQuality.weatherMultiplier),
					),
				);
				rainRuntime.geometry.setDrawRange(0, rainCount * 2);
				rainRuntime.material.color.set(weather.rainColor);
				rainRuntime.material.opacity = Math.max(
					0,
					Math.min(1, weather.rainOpacity * (0.3 + rainDensity * 0.7)),
				);
				const wx = currentScene.wind.enabled && currentScene.wind.affectsWeather ? worldWindX : 0,
					wz = currentScene.wind.enabled && currentScene.wind.affectsWeather ? worldWindZ : 0;
				const area = Math.max(2, weather.area),
					height = Math.max(2, weather.height);
				const weatherClock = now / 1000;
				for (let i = 0; i < rainCount; i++) {
					const i6 = i * 6,
						i4 = i * 4,
						a = rainRuntime.seeds[i4],
						b = rainRuntime.seeds[i4 + 1],
						c = rainRuntime.seeds[i4 + 2],
						d = rainRuntime.seeds[i4 + 3];
					const speed = (9 + c * 8) * weather.fallSpeed * weather.rainVelocity;
					const verticalRaw = b * height + weatherClock * speed;
					const vertical = ((verticalRaw % height) + height) % height;
					const y = height * 0.5 - vertical;
					const windAge = (height * 0.5 - y) / height;
					const turbulence =
						(Math.sin(weatherClock * (1.3 + c * 2.1) + d * 19.7) +
							Math.cos(weatherClock * 0.57 + a * 13.1)) *
						0.5 *
						windTurbulence *
						0.08;
					const x = wrappedWeather(
						(a - 0.5) * area + wx * weatherClock * 0.24 + wx * windAge * 1.25 + turbulence,
						area,
					);
					const z = wrappedWeather(
						(c - 0.5) * area + wz * weatherClock * 0.24 + wz * windAge * 1.25 + turbulence * 0.7,
						area,
					);
					const length = Math.max(
						0.12,
						weather.precipitationSize * (0.24 + d * 0.36) * (1 + Math.min(2, weather.fallSpeed) * 0.16),
					);
					const slantX = wx * 0.022 * length + turbulence * 0.08;
					const slantZ = wz * 0.022 * length + turbulence * 0.05;
					rainRuntime.positions[i6] = x;
					rainRuntime.positions[i6 + 1] = y;
					rainRuntime.positions[i6 + 2] = z;
					rainRuntime.positions[i6 + 3] = x - slantX;
					rainRuntime.positions[i6 + 4] = y + length;
					rainRuntime.positions[i6 + 5] = z - slantZ;
				}
				(rainRuntime.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
				rainRuntime.lines.position.set(camera.position.x, camera.position.y, camera.position.z);
			}
			const weatherLightningColor = new THREE.Color(weather.lightningColor);
			const strikeX = Math.sin((strikeIndex + 1) * 17.31) * 0.5 * weather.area * 0.7;
			const strikeZ = -3 + Math.cos((strikeIndex + 1) * 31.17) * 0.5 * weather.area * 0.45;
			const strikeStart = new THREE.Vector3(
				camera.position.x + strikeX + Math.sin(strikeIndex) * 2,
				camera.position.y + weather.height * 0.75,
				camera.position.z + strikeZ,
			);
			const strikeEnd = new THREE.Vector3(
				camera.position.x + strikeX,
				camera.position.y - weather.height * 0.45,
				camera.position.z + strikeZ,
			);
			updateLightningLine(
				weatherLightning,
				strikeStart,
				strikeEnd,
				0,
				currentTransportPosition,
				Math.min(1.5, weatherFlash * 2.2),
				weatherLightningColor,
			);

			performerRoot.position.set(
				mv("object.positionX", currentScene.object.positionX, -10000, 10000),
				mv("object.positionY", currentScene.object.positionY, -10000, 10000) +
					(activeCue?.rootY ?? 0) * cueWeight * cueStrength,
				mv("object.positionZ", currentScene.object.positionZ, -10000, 10000) +
					(activeCue?.rootZ ?? 0) * cueWeight * cueStrength,
			);
			if (modelPlacementActive)
				performerRoot.position.set(modelPlacementPreview.x, modelPlacementPreview.y, modelPlacementPreview.z);
			performerRoot.rotation.set(
				mv("object.rotationX", currentScene.object.rotationX, -Math.PI * 20, Math.PI * 20),
				mv("object.rotationY", currentScene.object.rotationY, -Math.PI * 20, Math.PI * 20) +
					(now / 1000) * currentScene.object.rotationSpeed,
				mv("object.rotationZ", currentScene.object.rotationZ, -Math.PI * 20, Math.PI * 20),
			);

			const manualTest = Math.max(0, Math.min(1, currentScene.object.testSignal));
			const rawBody = reactiveValue(
				Math.max(visualAudioValue(currentScene.object.bodySource, currentAudio), manualTest),
				currentScene,
			);
			const rawArms = reactiveValue(
				Math.max(visualAudioValue(currentScene.object.armSource, currentAudio), manualTest),
				currentScene,
			);
			const rawPulse = reactiveValue(
				Math.max(visualAudioValue(currentScene.object.pulseSource, currentAudio), manualTest),
				currentScene,
			);
			smoothBody = envelope(smoothBody, rawBody, currentScene.object.attack, currentScene.object.release);
			smoothArms = envelope(smoothArms, rawArms, currentScene.object.attack, currentScene.object.release);
			smoothPulse = envelope(smoothPulse, rawPulse, currentScene.object.attack, currentScene.object.release);
			const bodyMotion = objectIsPerformer ? smoothBody * currentScene.object.bodyAmount : 0;
			const armMotion = objectIsPerformer ? smoothArms * currentScene.object.armAmount : 0;
			const scale =
				mv("object.baseScale", currentScene.object.baseScale, 0.001, 100) *
				(1 + smoothPulse * currentScene.object.pulseAmount * 0.45);
			performerRoot.scale.setScalar(scale);
			springVelocity +=
				((objectIsPerformer ? currentAudio.kick * currentScene.object.springAmount * 1.6 : 0) -
					springPosition * 8.0) *
				dt;
			springVelocity *= Math.pow(0.18, dt);
			springPosition += springVelocity * dt;
			const glow = Math.max(
				0,
				Math.max(visualAudioValue(currentScene.object.glowSource, currentAudio), manualTest) *
					currentScene.object.glowAmount +
					currentAudio.kick * 0.75 +
					cueGlow,
			);

			const objectVisible =
				currentScene.project.mode !== "2d" &&
				!!objectLayer &&
				visualLayerActive(objectLayer, currentTransportPosition);
			mannequin.root.visible = currentScene.object.model === "mannequin" && objectVisible;
			crystal.root.visible = currentScene.object.model === "crystal" && objectVisible;
			const importedModelActive = currentScene.object.model === "glb" || currentScene.object.model === "asset";
			if (!importedModelActive || !currentScene.object.modelUrl) {
				if (glb.root || glb.loadingUrl || lastGlbUrl) clearGlb();
			}
			if (glb.root) glb.root.visible = importedModelActive && objectVisible;
			if (importedModelActive && currentScene.object.modelUrl)
				loadVisualModel(
					currentScene.object.modelUrl,
					currentScene.object.modelFileName,
					currentScene.object.modelFormat,
					currentScene.object.assetFiles,
					currentScene.object.role,
				);
			if (mannequin.root.visible) {
				applyPose(mannequin, currentScene, bodyMotion, armMotion, now / 1000, springPosition);
				applyCueToMannequin(
					mannequin,
					activeCue,
					cueWeight,
					cueStrength,
					perfConfig.headTracking ? perfConfig.headTrackAmount : 0,
				);
				const mannequinSlots: Partial<Record<VisualHumanoidSlot, THREE.Object3D>> = {
					root: mannequin.root,
					spine: mannequin.spine,
					chest: mannequin.chest,
					head: mannequin.head,
					leftShoulder: mannequin.leftShoulder,
					leftForeArm: mannequin.leftElbow,
					leftHand: mannequin.leftHand,
					rightShoulder: mannequin.rightShoulder,
					rightForeArm: mannequin.rightElbow,
					rightHand: mannequin.rightHand,
				};
				for (const [slot, bone] of Object.entries(mannequinSlots) as [VisualHumanoidSlot, THREE.Object3D][]) {
					const prefix = `bone:${slot}:rotation`;
					const x = modulationDelta(modulation, `${prefix}X`),
						y = modulationDelta(modulation, `${prefix}Y`),
						z = modulationDelta(modulation, `${prefix}Z`);
					if (x) bone.rotateX(x);
					if (y) bone.rotateY(y);
					if (z) bone.rotateZ(z);
				}
			}
			if (crystal.root.visible) {
				crystal.root.rotation.x = now * 0.00012 + bodyMotion * 0.25;
				crystal.root.rotation.y = now * 0.00018 + armMotion * 0.18;
			}
			const performerEmissiveDelta = glow * 0.72 + modulationDelta(modulation, "object.emissiveIntensity");
			for (const material of [...mannequin.materials, ...crystal.materials]) {
				material.emissive.set(currentScene.object.emissiveColor);
				material.emissiveIntensity = Math.max(0, 0.1 + performerEmissiveDelta);
			}
			const libraryMaterial = currentScene.object.materialId
				? currentScene.materials.find((m) => m.id === currentScene.object.materialId)
				: undefined;
			const performerEmissiveColor = new THREE.Color(currentScene.object.emissiveColor);
			for (const material of glb.materials) {
				const base = glb.materialBase.get(material);
				let authoredEmissiveIntensity = base?.emissiveIntensity ?? 0;
				if (libraryMaterial) {
					const source = getMaterial(libraryMaterial, modulation);
					material.color.copy(source.color);
					material.metalness = source.metalness;
					material.roughness = source.roughness;
					material.emissive.copy(source.emissive);
					authoredEmissiveIntensity = source.emissiveIntensity;
					material.map = source.map;
					material.normalMap = source.normalMap;
					material.bumpMap = source.bumpMap;
					material.roughnessMap = source.roughnessMap;
					material.metalnessMap = source.metalnessMap;
					material.aoMap = source.aoMap;
					material.emissiveMap = source.emissiveMap;
					material.alphaMap = source.alphaMap;
					material.displacementMap = source.displacementMap;
					material.opacity = source.opacity;
					material.transparent = source.transparent;
					material.envMap = source.envMap;
					material.envMapIntensity = source.envMapIntensity;
					material.needsUpdate = true;
				} else if (currentScene.object.materialOverride) {
					material.color.set(currentScene.object.materialTint);
					material.metalness = Math.max(0, Math.min(1, currentScene.object.materialMetalness));
					material.roughness = Math.max(0, Math.min(1, currentScene.object.materialRoughness));
					material.emissive.set(currentScene.object.emissiveColor);
					authoredEmissiveIntensity = 0.1;
				} else if (base) {
					material.color.copy(base.color);
					material.metalness = base.metalness;
					material.roughness = base.roughness;
					material.emissive.copy(base.emissive);
					material.map = base.map;
					material.normalMap = base.normalMap;
					material.bumpMap = base.bumpMap;
					material.roughnessMap = base.roughnessMap;
					material.metalnessMap = base.metalnessMap;
					material.aoMap = base.aoMap;
					material.emissiveMap = base.emissiveMap;
					material.alphaMap = base.alphaMap;
					material.displacementMap = base.displacementMap;
					material.opacity = base.opacity;
					material.transparent = base.transparent;
					authoredEmissiveIntensity = base.emissiveIntensity;
					material.needsUpdate = true;
				}
				// Performer glow is additive so assigning a library material no longer erases it.
				// Preserve authored/library emissive character, but blend toward the performer glow
				// color when a positive performance/audio glow is actually present.
				if (performerEmissiveDelta > 0.0001) {
					const blend = Math.min(
						1,
						performerEmissiveDelta / Math.max(0.001, authoredEmissiveIntensity + performerEmissiveDelta),
					);
					material.emissive.lerp(performerEmissiveColor, blend);
				}
				material.emissiveIntensity = Math.max(0, authoredEmissiveIntensity + performerEmissiveDelta);
			}
			for (const mesh of glb.morphMeshes) {
				if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) continue;
				for (const [name, index] of Object.entries(mesh.morphTargetDictionary)) {
					mesh.morphTargetInfluences[index] = mv(
						`morph:${name}`,
						currentScene.object.morphTargets[name] ?? 0,
						0,
						1,
					);
				}
			}

			if (glb.root && importedModelActive) {
				for (const [bone, base] of glb.boneBase) {
					bone.position.copy(base.position);
					bone.quaternion.copy(base.quaternion);
					bone.scale.copy(base.scale);
				}
				applyGlbAnimation(currentScene);
				const animationSpeed = mv("object.animationSpeed", currentScene.object.animationSpeed, 0.01, 8);
				const animationWeight = mv("object.animationWeight", 1, 0, 1);
				if (glb.activeAction) {
					glb.activeAction.timeScale = animationSpeed;
					glb.activeAction.setEffectiveWeight(animationWeight);
				}
				glb.mixer?.update(dt);
				const bodyBones = glb.bones.filter((bone) => /spine|chest|hips|pelvis/i.test(bone.name)).slice(0, 5);
				const headBones = glb.bones.filter((bone) => /head|neck/i.test(bone.name)).slice(0, 3);
				for (const bone of bodyBones) bone.rotateZ(bodyMotion * 0.1);
				glb.targets.leftUpperArm?.rotateZ(-armMotion * 0.14);
				glb.targets.rightUpperArm?.rotateZ(armMotion * 0.14);
				for (const bone of headBones) bone.rotateZ(springPosition * 0.12);
				if (objectIsPerformer)
					applyCueToTargets(
						glb.targets,
						activeCue,
						cueWeight,
						cueStrength,
						perfConfig.headTracking ? perfConfig.headTrackAmount : 0,
					);
				applyCustomSkeletalAnimations(currentScene, currentTransportPosition, animationWeight);
				for (const slot of HUMANOID_SLOTS) {
					const bone = resolveBoneForTarget(currentScene, slot);
					if (!bone) continue;
					const prefix = `bone:${slot}:rotation`;
					const x = modulationDelta(modulation, `${prefix}X`),
						y = modulationDelta(modulation, `${prefix}Y`),
						z = modulationDelta(modulation, `${prefix}Z`);
					if (x) bone.rotateX(x);
					if (y) bone.rotateY(y);
					if (z) bone.rotateZ(z);
				}
			}

			ensurePrimitives(currentScene, currentTransportPosition, modulation);
			syncTransformGizmo();
			threeScene.updateMatrixWorld(true);
			if (objectIsPerformer)
				applyIKConstraints(currentScene, currentTransportPosition, importedModelActive && !!glb.root);
			threeScene.updateMatrixWorld(true);
			updateSecondaryDynamics(
				currentScene,
				currentTransportPosition,
				dt,
				modulation,
				importedModelActive && !!glb.root,
				worldWindX,
				worldWindZ,
				windTurbulence,
			);
			// Spring-bone secondary dynamics can rotate rig bones, so refresh matrices before
			// hand colliders and lightning sample their final performer pose for this frame.
			threeScene.updateMatrixWorld(true);
			const leftHandObject =
				importedModelActive && glb.root ? resolveBoneForTarget(currentScene, "leftHand") : mannequin.leftHand;
			const rightHandObject =
				importedModelActive && glb.root ? resolveBoneForTarget(currentScene, "rightHand") : mannequin.rightHand;
			const leftHandPosition = new THREE.Vector3();
			const rightHandPosition = new THREE.Vector3();
			if (leftHandObject) leftHandObject.getWorldPosition(leftHandPosition);
			else performerRoot.localToWorld(leftHandPosition.set(-1.2, 0.8, 0));
			if (rightHandObject) rightHandObject.getWorldPosition(rightHandPosition);
			else performerRoot.localToWorld(rightHandPosition.set(1.2, 0.8, 0));
			if (physicsWorld) {
				physicsWorld.gravity = { x: 0, y: currentScene.physics.gravityY, z: 0 };
				ensureGround(currentScene);
				ensureHandBodies();
				leftHandBody?.setNextKinematicTranslation({
					x: leftHandPosition.x,
					y: leftHandPosition.y,
					z: leftHandPosition.z,
				});
				rightHandBody?.setNextKinematicTranslation({
					x: rightHandPosition.x,
					y: rightHandPosition.y,
					z: rightHandPosition.z,
				});
				if (currentScene.physics.resetSequence !== lastPhysicsReset) {
					lastPhysicsReset = currentScene.physics.resetSequence;
					for (const p of currentScene.primitives) {
						const runtime = primitiveRuntime.get(p.id);
						if (!runtime?.body) continue;
						const q = new THREE.Quaternion().setFromEuler(
							new THREE.Euler(p.rotationX, p.rotationY, p.rotationZ),
						);
						runtime.body.setTranslation({ x: p.positionX, y: p.positionY, z: p.positionZ }, true);
						runtime.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
						runtime.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
						runtime.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
					}
				}
				if (currentScene.physics.enabled && currentScene.physics.mode === "simulate") {
					if (
						currentScene.wind.enabled &&
						currentScene.wind.affectsPhysics &&
						currentScene.wind.physicsForce > 0
					) {
						const basePhysicsForce = Math.max(0, currentScene.wind.physicsForce);
						for (let index = 0; index < currentScene.primitives.length; index++) {
							const primitive = currentScene.primitives[index];
							if (primitive.physics.bodyType !== "dynamic") continue;
							const runtime = primitiveRuntime.get(primitive.id);
							if (!runtime?.body) continue;
							const flutter =
								(Math.sin(windClock * (1.1 + index * 0.037) + index * 2.17) +
									Math.cos(windClock * 0.61 + index * 0.83)) *
								0.5 *
								windTurbulence;
							const lateral = basePhysicsForce * (1 + flutter * 0.08);
							runtime.body.addForce({ x: worldWindX * lateral, y: 0, z: worldWindZ * lateral }, true);
						}
					}
					physicsWorld.timestep = Math.max(1 / 120, Math.min(1 / 30, dt));
					physicsWorld.step();
					for (const p of currentScene.primitives) {
						if (p.physics.bodyType !== "dynamic") continue;
						const runtime = primitiveRuntime.get(p.id);
						if (!runtime?.body) continue;
						const pos = runtime.body.translation(),
							rot = runtime.body.rotation();
						runtime.mesh.position.set(pos.x, pos.y, pos.z);
						runtime.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
					}
				}
			}
			const lightningColor = new THREE.Color(perfConfig.lightningColor);
			const lightningMode = activeCue?.lightning ?? "none";
			const lightningStrength = Math.max(
				0,
				Math.min(1.5, cueWeight * cueStrength * perfConfig.lightningIntensity * 0.52),
			);
			const branchCount = Math.max(1, Math.min(4, Math.round(perfConfig.lightningBranches)));
			const leftTarget = new THREE.Vector3(-8.2, leftHandPosition.y + Math.sin(now * 0.004) * 0.6, -0.8);
			const rightTarget = new THREE.Vector3(8.2, rightHandPosition.y + Math.cos(now * 0.004) * 0.6, -0.8);
			const leftActive = lightningMode === "left" || lightningMode === "dual";
			const rightActive = lightningMode === "right" || lightningMode === "dual";
			for (let i = 0; i < lightning.left.length; i++) {
				const strength = leftActive && i < branchCount ? lightningStrength : 0;
				updateLightningLine(
					lightning.left[i],
					leftHandPosition,
					leftTarget,
					i,
					now / 1000,
					strength,
					lightningColor,
				);
			}
			for (let i = 0; i < lightning.right.length; i++) {
				const strength = rightActive && i < branchCount ? lightningStrength : 0;
				updateLightningLine(
					lightning.right[i],
					rightHandPosition,
					rightTarget,
					i,
					now / 1000,
					strength,
					lightningColor,
				);
			}
			lightning.leftLight.color.copy(lightningColor);
			lightning.rightLight.color.copy(lightningColor);
			lightning.leftLight.position.copy(leftHandPosition);
			lightning.rightLight.position.copy(rightHandPosition);
			lightning.leftLight.intensity = leftActive ? lightningStrength * 8 : 0;
			lightning.rightLight.intensity = rightActive ? lightningStrength * 8 : 0;

			const shockAmount = perfConfig.screenShockwave
				? Math.max(
						0,
						Math.min(
							1.5,
							(activeCue?.impact ?? 0) * perfEnvelope.impact * cueStrength * perfConfig.impactStrength,
						),
					)
				: 0;
			shockwave.visible = shockAmount > 0.015;
			shockwaveMaterial.opacity = Math.min(0.92, shockAmount * 0.78);
			shockwaveMaterial.color.copy(lightningColor);
			shockwave.scale.setScalar(0.75 + shockAmount * 7.5);
			shockwave.rotation.z = now * 0.0008;

			if (now - performanceRuntime.lastBroadcastAt > 120) {
				performanceRuntime.lastBroadcastAt = now;
				const state: VisualPerformanceState = {
					type: "visual-performance-state",
					timestamp: Date.now(),
					cueId: activeCue?.id ?? "",
					label: activeCue?.label ?? "Idle",
					category: activeCue?.category ?? "idle",
					progress: activeCue ? perfEnvelope.progress : 0,
					source: activeCue ? performanceRuntime.source : "idle",
				};
				channel.postMessage(state);
			}

			performanceRuntime.lastKick = currentAudio.kick;
			performanceRuntime.lastEnergy = currentAudio.energy;
			performanceRuntime.lastBass = currentAudio.bass;
			performanceRuntime.lastHighs = currentAudio.highs;

			// Authored grid remains Stage-owned for backwards compatibility. The editor
			// reference grid is independent and never renders to Program / OBS.
			editorReferenceGrid.visible = editorFreeRoam;
			editorAxes.visible = editorFreeRoam;
			editorReferenceGrid.position.y = currentScene.physics.groundY + 0.002;
			editorAxes.position.y = currentScene.physics.groundY + 0.003;
			grid.visible = stageActive && currentScene.grid.visible;
			for (const material of gridMaterials)
				material.opacity = Math.max(
					0,
					Math.min(
						1,
						currentScene.grid.intensity +
							visualAudioValue(currentScene.grid.source, currentAudio) * currentScene.grid.amount * 0.15,
					),
				);
			grid.scale.setScalar(Math.max(0.4, currentScene.grid.size / 14));

			particleRuntime.points.visible =
				currentScene.project.mode !== "2d" &&
				!!particlesLayer &&
				visualLayerActive(particlesLayer, currentTransportPosition);
			if (particleRuntime.points.visible) {
				const particleConfig = {
					...currentScene.particles,
					size: mv("particles.size", currentScene.particles.size, 0.01, 100),
					speed: mv("particles.speed", currentScene.particles.speed, 0, 20),
					gravity: mv("particles.gravity", currentScene.particles.gravity, -20, 20),
					turbulence: mv("particles.turbulence", currentScene.particles.turbulence, 0, 20),
					orbit: mv("particles.orbit", currentScene.particles.orbit, -20, 20),
					spread: mv("particles.spread", currentScene.particles.spread, 0.01, 100),
					positionX: mv("particles.positionX", currentScene.particles.positionX, -1000, 1000),
					positionY: mv("particles.positionY", currentScene.particles.positionY, -1000, 1000),
					positionZ: mv("particles.positionZ", currentScene.particles.positionZ, -1000, 1000),
				};
				const particleScene = { ...currentScene, particles: particleConfig };
				const rawParticleAudio = visualAudioValue(particleConfig.source, currentAudio) * particleConfig.amount;
				// Audio modulates an integrated phase instead of multiplying absolute clock time.
				// That prevents beat hits from teleporting the cloud to unrelated angles.
				const particleFollow = rawParticleAudio > smoothParticleAudio ? 0.22 : 0.075;
				smoothParticleAudio += (rawParticleAudio - smoothParticleAudio) * particleFollow;
				const baseSpeed = Math.max(0, particleConfig.speed);
				particleMotionTime += dt * baseSpeed * (0.7 + smoothParticleAudio * 0.8);
				const positionalAudio = baseSpeed > 0 ? smoothParticleAudio : 0;
				const count = Math.max(
					0,
					Math.min(
						MAX_PARTICLES,
						Math.round(currentScene.particles.count * runtimeQuality.particleMultiplier),
					),
				);
				particleRuntime.geometry.setDrawRange(0, count);
				particleRuntime.material.opacity = mv(
					`layer:${particlesLayer!.id}:opacity`,
					particlesLayer!.opacity,
					0,
					1,
				);
				particleRuntime.material.size = Math.max(
					0.006,
					particleConfig.size * 0.008 * (1 + smoothParticleAudio * 0.3),
				);
				particleRuntime.material.blending =
					particleConfig.blendMode === "normal" ? THREE.NormalBlending : THREE.AdditiveBlending;
				particleRuntime.material.alphaTest = Math.max(0, Math.min(1, particleConfig.alphaTest));
				if (particleConfig.renderMode === "billboard" && particleConfig.textureUrl) {
					if (particleTextureUrl !== particleConfig.textureUrl) {
						particleTextureUrl = particleConfig.textureUrl;
						const requested = particleTextureUrl;
						particleTextureLoader.load(
							requested,
							(tex) => {
								if (particleTextureUrl !== requested) {
									tex.dispose();
									return;
								}
								particleTexture?.dispose();
								particleTexture = tex;
								tex.colorSpace = THREE.SRGBColorSpace;
								tex.anisotropy = runtimeQuality.maxAnisotropy;
								particleRuntime.material.map = tex;
								particleRuntime.material.needsUpdate = true;
							},
							undefined,
							() => {},
						);
					}
				} else {
					if (particleRuntime.material.map) {
						particleRuntime.material.map = null;
						particleRuntime.material.needsUpdate = true;
					}
				}
				const cA = new THREE.Color(particleConfig.colorA),
					cB = new THREE.Color(particleConfig.colorB),
					cC = new THREE.Color(particleConfig.colorC),
					mixed = new THREE.Color();
				for (let i = 0; i < count; i++) {
					const seedLife = particleRuntime.seeds[i * 4 + 3];
					const life = (seedLife + particleMotionTime * 0.12) % 1;
					setParticlePosition(
						i,
						particleScene,
						particleRuntime.positions,
						particleRuntime.seeds,
						life,
						particleMotionTime,
						positionalAudio,
						currentScene.wind.enabled && currentScene.wind.affectsParticles ? worldWindX : 0,
						currentScene.wind.enabled && currentScene.wind.affectsParticles ? worldWindZ : 0,
						currentScene.wind.enabled && currentScene.wind.affectsParticles ? windTurbulence : 0,
					);
					const t = particleRuntime.seeds[i * 4 + 2];
					const mode = particleConfig.colorMode;
					if (mode === "single") mixed.copy(cA);
					else if (mode === "bi") mixed.copy(t < 0.5 ? cA : cB);
					else if (mode === "tri") mixed.copy(t < 0.333 ? cA : t < 0.666 ? cB : cC);
					else if (mode === "gradient") {
						if (t < 0.5) mixed.copy(cA).lerp(cB, t * 2);
						else mixed.copy(cB).lerp(cC, (t - 0.5) * 2);
					} else mixed.setHSL((t + particleMotionTime * particleConfig.rainbowSpeed) % 1, 0.9, 0.62);
					particleRuntime.colors[i * 3] = mixed.r;
					particleRuntime.colors[i * 3 + 1] = mixed.g;
					particleRuntime.colors[i * 3 + 2] = mixed.b;
				}
				(particleRuntime.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
				(particleRuntime.geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
			}

			try {
				const postFx = {
					...currentScene.postFx,
					exposure: mv("postFx.exposure", currentScene.postFx.exposure, 0.05, 8),
					brightness: mv("postFx.brightness", currentScene.postFx.brightness, 0.05, 5),
					contrast: mv("postFx.contrast", currentScene.postFx.contrast, 0.05, 5),
					saturation: mv("postFx.saturation", currentScene.postFx.saturation, 0, 6),
					temperature: mv("postFx.temperature", currentScene.postFx.temperature, -2, 2),
					tint: mv("postFx.tint", currentScene.postFx.tint, -2, 2),
					lift: mv("postFx.lift", currentScene.postFx.lift, -1, 1),
					gamma: mv("postFx.gamma", currentScene.postFx.gamma, 0.1, 4),
					gain: mv("postFx.gain", currentScene.postFx.gain, 0, 6),
					ambientOcclusionIntensity: mv(
						"postFx.ambientOcclusionIntensity",
						currentScene.postFx.ambientOcclusionIntensity,
						0,
						5,
					),
					lightShaftsIntensity: mv(
						"postFx.lightShaftsIntensity",
						currentScene.postFx.lightShaftsIntensity,
						0,
						8,
					),
					lutIntensity: mv("postFx.lutIntensity", currentScene.postFx.lutIntensity, 0, 1),
					chromaticAberration: mv(
						"postFx.chromaticAberration",
						currentScene.postFx.chromaticAberration,
						0,
						6,
					),
					lensDistortion: mv("postFx.lensDistortion", currentScene.postFx.lensDistortion, -2, 2),
					halation: mv("postFx.halation", currentScene.postFx.halation, 0, 4),
					filmGrain: mv("postFx.filmGrain", currentScene.postFx.filmGrain, 0, 2),
					vignette: mv("postFx.vignette", currentScene.postFx.vignette, 0, 2),
				};
				const toneMapping =
					postFx.toneMapping === "none"
						? THREE.NoToneMapping
						: postFx.toneMapping === "linear"
							? THREE.LinearToneMapping
							: postFx.toneMapping === "reinhard"
								? THREE.ReinhardToneMapping
								: postFx.toneMapping === "cineon"
									? THREE.CineonToneMapping
									: postFx.toneMapping === "agx"
										? THREE.AgXToneMapping
										: postFx.toneMapping === "neutral"
											? THREE.NeutralToneMapping
											: THREE.ACESFilmicToneMapping;
				renderer.toneMapping = toneMapping;
				renderer.toneMappingExposure = Math.max(
					0.05,
					(lightingActive ? stage.exposure : 1) * postFx.exposure * cameraExposure,
				);
				const audioColorGradeActive =
					Math.abs(modulationDelta(modulation, "postFx.brightness")) > 0.0001 ||
					Math.abs(modulationDelta(modulation, "postFx.contrast")) > 0.0001 ||
					Math.abs(modulationDelta(modulation, "postFx.saturation")) > 0.0001 ||
					Math.abs(modulationDelta(modulation, "postFx.temperature")) > 0.0001 ||
					Math.abs(modulationDelta(modulation, "postFx.tint")) > 0.0001;
				const colorGradeActive =
					postFx.colorGradeEnabled ||
					audioColorGradeActive ||
					Math.abs(postFx.temperature) > 0.001 ||
					Math.abs(postFx.tint) > 0.001 ||
					Math.abs(postFx.lift) > 0.001 ||
					Math.abs(postFx.gamma - 1) > 0.001 ||
					Math.abs(postFx.gain - 1) > 0.001;
				const weatherHeatHaze = weatherActive ? Math.max(0, weather.heatHaze * weatherMaster) : 0;
				const shaftLight = postFx.lightShaftsSource === "moon" ? moon : sun;
				const shaftWorld = shaftLight.position.clone();
				const shaftNdc = shaftWorld.clone().project(camera);
				const shaftUv = new THREE.Vector2((shaftNdc.x + 1) * 0.5, (shaftNdc.y + 1) * 0.5);
				const cameraForward = new THREE.Vector3();
				camera.getWorldDirection(cameraForward);
				const shaftForward = shaftWorld.clone().sub(camera.position).normalize().dot(cameraForward) > 0;
				for (const runtime of postRuntimes) {
					if (editorFreeRoam && !editorFxPreview) {
						runtime.pass.enabled = false;
						continue;
					}
					if (runtime.type === "ambientOcclusion") {
						const pass = runtime.pass as GTAOPass;
						pass.enabled =
							runtime.module.enabled &&
							currentScene.project.mode !== "2d" &&
							postFx.ambientOcclusionIntensity > 0.001;
						pass.blendIntensity = Math.max(0, Math.min(4, postFx.ambientOcclusionIntensity));
						pass.updateGtaoMaterial({
							radius: Math.max(0.1, postFx.ambientOcclusionRadius),
							samples: runtimeQuality.aoSamples,
							screenSpaceRadius: false,
						});
						continue;
					}
					if (runtime.type === "lightShafts" && runtime.uniforms) {
						const u = runtime.uniforms;
						runtime.pass.enabled =
							runtime.module.enabled && postFx.lightShaftsIntensity > 0.001 && shaftForward;
						(u.lightPosition.value as THREE.Vector2).copy(shaftUv);
						(u.lightColor.value as THREE.Color).set(
							postFx.lightShaftsSource === "moon" ? stage.moonColor : stage.sunColor,
						);
						u.intensity.value = postFx.lightShaftsIntensity;
						u.decay.value = postFx.lightShaftsDecay;
						u.density.value = postFx.lightShaftsDensity;
						u.weight.value = postFx.lightShaftsWeight;
						continue;
					}
					if (runtime.type === "lut") {
						const pass = runtime.pass as LUTPass;
						if (lutTexture) pass.lut = lutTexture;
						else {
							pass.material.uniforms.lut.value = null;
							pass.material.uniforms.lutSize.value = 0;
						}
						pass.intensity = postFx.lutIntensity;
						pass.enabled = runtime.module.enabled && !!lutTexture && postFx.lutIntensity > 0.001;
						continue;
					}
					// Depth of field uses a different shader/uniform set from the modular Studio
					// passes below. Its camera uniforms are updated with the active program camera
					// above. Never run it through the Studio shader's brightness/contrast/etc.
					// Doing so used to dereference missing uniforms and abort every render frame.
					if (runtime.type === "depthOfField") {
						if (!activeProgramCamera || (editorFreeRoam && !editorFxPreview)) runtime.pass.enabled = false;
						continue;
					}
					if (!runtime.uniforms) continue;
					const u = runtime.uniforms;
					// Start every modular studio pass neutral, then enable only the parameters owned by its module.
					u.brightness.value = 1;
					u.contrast.value = 1;
					u.saturation.value = 1;
					u.temperature.value = 0;
					u.tint.value = 0;
					u.lift.value = 0;
					u.gammaValue.value = 1;
					u.gain.value = 1;
					u.chromaticAberration.value = 0;
					u.lensDistortion.value = 0;
					u.lensZoom.value = 1;
					u.halation.value = 0;
					u.filmGrain.value = 0;
					u.vignette.value = 0;
					u.vignetteSoftness.value = postFx.vignetteSoftness;
					u.sharpen.value = 0;
					u.heatHaze.value = 0;
					u.heatHazeSpeed.value = Math.max(0, currentScene.weather.heatHazeSpeed);
					u.time.value = now / 1000;
					if (runtime.type === "colorGrade") {
						runtime.pass.enabled = runtime.module.enabled && colorGradeActive;
						if (runtime.pass.enabled) {
							u.brightness.value = postFx.brightness;
							u.contrast.value = postFx.contrast;
							u.saturation.value = postFx.saturation;
							u.temperature.value = postFx.temperature;
							u.tint.value = postFx.tint;
							u.lift.value = postFx.lift;
							u.gammaValue.value = postFx.gamma;
							u.gain.value = postFx.gain;
						}
					} else if (runtime.type === "lens") {
						runtime.pass.enabled =
							runtime.module.enabled &&
							(postFx.chromaticAberration > 0.001 ||
								Math.abs(postFx.lensDistortion) > 0.001 ||
								Math.abs(postFx.lensZoom - 1) > 0.001 ||
								currentScene.renderer.sharpen > 0.001 ||
								weatherHeatHaze > 0.001);
						if (runtime.pass.enabled) {
							u.chromaticAberration.value = postFx.chromaticAberration;
							u.lensDistortion.value = postFx.lensDistortion;
							u.lensZoom.value = postFx.lensZoom;
							u.sharpen.value = Math.max(0, Math.min(1, currentScene.renderer.sharpen));
							u.heatHaze.value = weatherHeatHaze;
						}
					} else if (runtime.type === "film") {
						runtime.pass.enabled =
							runtime.module.enabled &&
							(postFx.filmGrain > 0.001 || postFx.vignette > 0.001 || postFx.halation > 0.001);
						if (runtime.pass.enabled) {
							u.halation.value = postFx.halation;
							u.filmGrain.value = postFx.filmGrain;
							u.vignette.value = postFx.vignette;
						}
					}
				}

				const hasDofPass = postRuntimes.some(
					(runtime) => runtime.type === "depthOfField" && runtime.pass.enabled,
				);
				if (hasDofPass) {
					const oldTarget = renderer.getRenderTarget();
					const oldOverride = threeScene.overrideMaterial;
					const helperWasVisible = cameraHelperRoot.visible;
					cameraHelperRoot.visible = false;
					threeScene.overrideMaterial = depthMaterial;
					renderer.setRenderTarget(depthTarget);
					renderer.setClearColor(0xffffff, 1);
					renderer.clear(true, true, true);
					renderer.render(threeScene, camera);
					threeScene.overrideMaterial = oldOverride;
					cameraHelperRoot.visible = helperWasVisible;
					renderer.setRenderTarget(oldTarget);
					renderer.setClearColor(0x000000, 0);
				}
				composer.render();
			} catch (caught) {
				reportRendererWarning(
					postRuntimes.some(runtime => runtime.type === "depthOfField" && runtime.pass.enabled)
						? "Depth of Field render"
						: "post-processing/render",
					caught,
				);
				// Drop optional passes for this frame and keep the core renderer alive. This
				// preserves free-roam, scene objects, Spectrum and authored overlays.
				for (const runtime of postRuntimes) runtime.pass.enabled = false;
				fxaaPass.enabled = false;
				smaaPass.enabled = false;
				try {
					renderCoreFallback();
				} catch (coreCaught) {
					const detail =
						coreCaught instanceof Error
							? coreCaught.message
							: String(coreCaught || "Unknown core render error");
					setError(`Core WebGL render failed: ${detail}`);
				}
			}
			const spectrumScene = {
				...currentScene,
				layers: currentScene.layers.map((layer) =>
					layer.type === "spectrum"
						? { ...layer, opacity: mv(`layer:${layer.id}:opacity`, layer.opacity, 0, 1) }
						: layer,
				),
				spectrum: {
					...currentScene.spectrum,
					height: mv("spectrum.height", currentScene.spectrum.height, 0.001, 3),
					thickness: mv("spectrum.thickness", currentScene.spectrum.thickness, 0.01, 4),
					positionX: mv("spectrum.positionX", currentScene.spectrum.positionX, -2, 3),
					positionY: mv("spectrum.positionY", currentScene.spectrum.positionY, -2, 3),
					scale: mv("spectrum.scale", currentScene.spectrum.scale, 0.01, 10),
					rotation: mv("spectrum.rotation", currentScene.spectrum.rotation, -Math.PI * 20, Math.PI * 20),
					glow: mv("spectrum.glow", currentScene.spectrum.glow, 0, 20),
				},
			};
			drawSpectrum(spectrum2d, smoothedSpectrum, spectrumScene, currentAudio, renderWidth, renderHeight);
			drawRoomAudienceEffects(spectrum2d, roomEffectPulsesRef.current, now, renderWidth, renderHeight);

			if (
				currentTransport.transitionSequence != null &&
				currentTransport.transitionSequence !== lastTransitionSequence
			)
				lastTransitionSequence = currentTransport.transitionSequence;
			frameCounter++;
			const elapsed = now - statsStart;
			if (elapsed >= 1000) {
				const fps = (frameCounter * 1000) / elapsed;
				const qualityConfig = sceneRef.current.renderer;
				if (qualityConfig.adaptiveResolution) {
					const targetFps = Math.max(24, Math.min(120, qualityConfig.adaptiveTargetFps));
					if (fps < targetFps * 0.9) {
						adaptiveLowStreak += 1;
						adaptiveHighStreak = 0;
					} else if (fps > targetFps * 0.985) {
						adaptiveHighStreak += 1;
						adaptiveLowStreak = 0;
					} else {
						adaptiveLowStreak = 0;
						adaptiveHighStreak = 0;
					}
					if (adaptiveLowStreak >= 2 || adaptiveHighStreak >= 4) {
						const nextScale = nextAdaptiveQualityScale(
							adaptiveScale,
							fps,
							targetFps,
							qualityConfig.adaptiveMinScale,
							qualityConfig.adaptiveMaxScale,
						);
						if (Math.abs(nextScale - adaptiveScale) > 0.0001) {
							adaptiveScale = nextScale;
							resizeInternalRender(runtimeQuality.renderScale * adaptiveScale);
						}
						adaptiveLowStreak = 0;
						adaptiveHighStreak = 0;
					}
				} else if (Math.abs(adaptiveScale - 1) > 0.0001) {
					adaptiveScale = 1;
					resizeInternalRender(runtimeQuality.renderScale);
				}
				if (!monitorMode)
					channel.postMessage({
						type: "visual-output-stats",
						timestamp: Date.now(),
						fps,
						frameTimeMs: fps > 0 ? 1000 / fps : 0,
						width: renderWidth,
						height: renderHeight,
						internalWidth: targetWidth,
						internalHeight: targetHeight,
						webgl: "WebGL2",
						renderer: rendererName,
						gpuClass: rendererCapabilities.gpuClass,
						qualitySelection: runtimeQuality.selection,
						qualityTier: runtimeQuality.tier,
						qualityLabel: runtimeQuality.label,
						renderScale: effectiveRenderScale,
						adaptiveScale,
						antialiasMode: runtimeQuality.antialiasMode,
						maxSamples: rendererCapabilities.maxSamples,
						maxTextureSize: rendererCapabilities.maxTextureSize,
						maxAnisotropy: rendererCapabilities.maxAnisotropy,
						drawCalls: renderer.info.render.calls,
						triangles: renderer.info.render.triangles,
						textures: renderer.info.memory.textures,
						geometries: renderer.info.memory.geometries,
						recommendedTier: rendererCapabilities.recommendedTier,
						rtxClassHint: rendererCapabilities.rtxClassHint,
					} satisfies VisualOutputStats);
				frameCounter = 0;
				statsStart = now;
			}
		};
		animationFrame = requestAnimationFrame(render);

		const toggleFullscreen = () => {
			if (embedded || obsMode) return;
			if (document.fullscreenElement) void document.exitFullscreen();
			else void document.documentElement.requestFullscreen();
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key.toLowerCase() === "f") toggleFullscreen();
		};
		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("dblclick", toggleFullscreen);
		return () => {
			disposed = true;
			cancelAnimationFrame(animationFrame);
			window.removeEventListener("message", onPlacementMessage);
			window.removeEventListener("message", onViewportCommandMessage);
			window.removeEventListener("keydown", onPlacementKeyDown);
			window.removeEventListener("keydown", onModelPlacementKeyDown);
			canvas.removeEventListener("mousedown", onPlacementMouseDown, true);
			canvas.removeEventListener("mousemove", onPlacementMouseMove, true);
			canvas.removeEventListener("mousemove", onModelPlacementMove, true);
			canvas.removeEventListener("mouseup", onPlacementMouseUp, true);
			canvas.removeEventListener("click", onPlacementClick, true);
			canvas.removeEventListener("click", onModelPlacementClick, true);
			canvas.removeEventListener("dragover", onViewportDragOver);
			canvas.removeEventListener("drop", onViewportDrop);
			clearPlacement(false);
			transformControls?.detach();
			transformControls?.dispose();
			transformControls?.getHelper().removeFromParent();
			transformProxy.removeFromParent();
			modelPlacementActive = false;
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("dblclick", toggleFullscreen);
			if (editorFreeRoam) {
				window.removeEventListener("keydown", onEditorKeyDown);
				window.removeEventListener("keyup", onEditorKeyUp);
				window.removeEventListener("mousemove", onEditorMouseMove);
				window.removeEventListener("mouseup", onEditorMouseUp);
				window.removeEventListener("blur", onWindowBlur);
				document.removeEventListener("visibilitychange", onVisibility);
				document.removeEventListener("pointerlockchange", onPointerLockChange);
				document.removeEventListener("pointerlockerror", onPointerLockError);
				canvas.removeEventListener("mousedown", onEditorMouseDown);
				canvas.removeEventListener("wheel", onEditorWheel);
				canvas.removeEventListener("click", onEditorClick);
				canvas.removeEventListener("contextmenu", onEditorContextMenu);
				canvas.removeEventListener("mousemove", updateEditorPick);
				if (document.pointerLockElement === canvas) document.exitPointerLock();
			}
			for (const helper of cameraHelpers.values()) {
				helper.frustum.geometry.dispose();
				(helper.frustum.material as THREE.Material).dispose();
				helper.forward.geometry.dispose();
				(helper.forward.material as THREE.Material).dispose();
				helper.path.geometry.dispose();
				(helper.path.material as THREE.Material).dispose();
				helper.materialCopies.forEach((material) => material.dispose());
			}
			cameraHelpers.clear();
			threeScene.remove(cameraHelperRoot);
			for (const runtime of secondaryRuntime.values()) disposeSecondaryRuntime(runtime);
			secondaryRuntime.clear();
			threeScene.remove(secondaryGroup);
			for (const runtime of primitiveRuntime.values()) {
				removePhysicsBody(runtime);
				runtime.mesh.geometry.dispose();
			}
			primitiveRuntime.clear();
			materialRuntime.forEach((material) => material.dispose());
			materialTextureCache.forEach((texture) => texture.dispose());
			materialEnvironmentCache.forEach((target) => target.dispose());
			pmremGenerator.dispose();
			physicsWorld?.free();
			clearGlb();
			disposeObject3D(mannequin.root);
			disposeObject3D(crystal.root);
			particleTexture?.dispose();
			particleRuntime.geometry.dispose();
			particleRuntime.material.dispose();
			cloudTexture.dispose();
			cloudMaterial.dispose();
			weatherRuntime.geometry.dispose();
			weatherRuntime.material.dispose();
			rainRuntime.geometry.dispose();
			rainRuntime.material.dispose();
			weatherLightning.geometry.dispose();
			(weatherLightning.material as THREE.Material).dispose();
			flareTexture.dispose();
			flareMaterial.dispose();
			grid.geometry.dispose();
			gridMaterials.forEach((material: THREE.Material) => material.dispose());
			editorReferenceGrid.geometry.dispose();
			editorReferenceMaterials.forEach((material) => material.dispose());
			editorAxes.geometry.dispose();
			const axesMaterial = editorAxes.material as THREE.Material | THREE.Material[];
			(Array.isArray(axesMaterial) ? axesMaterial : [axesMaterial]).forEach((material) => material.dispose());
			for (const line of [...lightning.left, ...lightning.right]) {
				line.geometry.dispose();
				(line.material as THREE.Material).dispose();
			}
			shockwave.geometry.dispose();
			shockwaveMaterial.dispose();
			clearBackgroundMedia();
			mediaGeometry.dispose();
			mediaMaterial.dispose();
			if (skySphereTexture) skySphereTexture.dispose();
			for (const texture of skyBoxTextures) texture?.dispose();
			skySphereGeometry.dispose();
			skySphereMaterial.dispose();
			skyBoxGeometry.dispose();
			skyBoxMaterials.forEach((material) => material.dispose());
			floor.geometry.dispose();
			floorMaterial.dispose();
			depthTarget.dispose();
			depthMaterial.dispose();
			postRuntimes.forEach((runtime) => runtime.pass.dispose?.());
			lutTexture?.dispose();
			composer.dispose();
			renderer.dispose();
			channel.close();
		};
	}, [
		embedded,
		editorFreeRoam,
		editorFxPreview,
		monitorMode,
		obsMode,
		programPreview,
		renderHeight,
		renderWidth,
		qualitySelection,
		antialiasEnabled,
		scene.renderer.antialiasMode,
		scene.renderer.renderScale,
		scene.renderer.adaptiveResolution,
		scene.renderer.adaptiveTargetFps,
		scene.renderer.adaptiveMinScale,
		scene.renderer.adaptiveMaxScale,
		scene.stage.shadowMapSize,
		scene.physics.secondarySubsteps,
		scene.physics.secondaryIterations,
	]);

	const overlayMv = (target: string, base: number, min = -Infinity, max = Infinity) =>
		Math.max(min, Math.min(max, base + (overlayModulationDeltas[target] ?? 0)));
	const overlayPosition = extrapolatedTransportPosition(transport);
	const shapeLayers =
		!sceneHydrated || scene.project.mode === "3d"
			? []
			: scene.layers.filter((layer) => layer.type === "shape2d" && visualLayerActive(layer, overlayPosition));
	const nowPlayingLayer = scene.layers.find((layer) => layer.type === "nowPlaying");
	const objectLayer = scene.layers.find((layer) => layer.type === "object");
	const flashOpacity = sceneHydrated ? Math.min(0.16, (objectLayer?.opacity ?? 0) * audioState.kick * 0.12) : 0;
	const transitionProgress = Math.max(0, Math.min(1, transport.transitionProgress ?? 0));
	const transitionStyle = transitionOverlayStyle(transport.visualTransition ?? "cut", transitionProgress);
	// Program/OBS output is scene-pure: World/Radio metadata never injects branding,
	// station bugs, ad labels, or Up Next text. Text appears only when the scene author
	// explicitly adds a text-capable layer such as Now Playing.
	const nowOpacity =
		sceneHydrated && nowPlayingLayer?.visible
			? overlayMv(`layer:${nowPlayingLayer.id}:opacity`, nowPlayingLayer.opacity, 0, 1)
			: 0;

	return (
		<main
			className={`fixed inset-0 grid place-items-center overflow-hidden select-none ${obsMode ? "cursor-none" : ""}`}
			style={{ background: editorFreeRoam ? "#9b9b9b" : "#000" }}
			aria-label="YSong Visual Output"
		>
			<div
				className="relative overflow-hidden"
				style={{
					background: sceneHydrated ? scene.output.background : editorFreeRoam ? "#9b9b9b" : "#000000",
					width: "min(100vw, calc(100vh * 16 / 9))",
					height: "min(100vh, calc(100vw * 9 / 16))",
				}}
			>
				<canvas
					ref={threeCanvasRef}
					width={renderWidth}
					height={renderHeight}
					className="absolute inset-0 h-full w-full"
					style={{ zIndex: 10, opacity: sceneHydrated ? 1 : 0 }}
				/>
				<canvas
					ref={spectrumRef}
					width={renderWidth}
					height={renderHeight}
					className="pointer-events-none absolute inset-0 h-full w-full"
					style={{ zIndex: 20, opacity: sceneHydrated ? 1 : 0 }}
				/>
				{shapeLayers.map((layer, index) => {
					const shape = scene.shapes2d.find((candidate) => candidate.id === layer.entityId);
					if (!shape) return null;
					const opacity = overlayMv(
						`layer:${layer.id}:opacity`,
						visualLayerOpacityAt(layer, overlayPosition),
						0,
						1,
					);
					const prefix = `shape:${shape.id}`;
					const shapeX = overlayMv(`${prefix}:positionX`, shape.positionX, -2, 3),
						shapeY = overlayMv(`${prefix}:positionY`, shape.positionY, -2, 3),
						shapeWidth = overlayMv(`${prefix}:width`, shape.width, 0.001, 4),
						shapeHeight = overlayMv(`${prefix}:height`, shape.height, 0.001, 4),
						shapeRotation = overlayMv(`${prefix}:rotation`, shape.rotation, -3600, 3600);
					const common: React.CSSProperties = {
						left: `${shapeX * 100}%`,
						top: `${shapeY * 100}%`,
						width: `${shapeWidth * 100}%`,
						height: shape.shape === "line" ? Math.max(1, shape.borderWidth || 2) : `${shapeHeight * 100}%`,
						opacity,
						transform: `translate(-50%,-50%) rotate(${shapeRotation}deg)`,
						zIndex: 21 + index,
					};
					if (shape.shape === "line")
						return (
							<div
								key={layer.id}
								className="pointer-events-none absolute origin-center"
								style={{ ...common, background: shape.color, borderRadius: 999 }}
							/>
						);
					return (
						<div
							key={layer.id}
							className="pointer-events-none absolute"
							style={{
								...common,
								background: shape.color,
								border: `${shape.borderWidth}px solid ${shape.borderColor}`,
								borderRadius: shape.shape === "ellipse" ? "9999px" : `${shape.borderRadius * 100}%`,
							}}
						/>
					);
				})}
				<div
					className="pointer-events-none absolute inset-0 bg-white"
					style={{ opacity: flashOpacity, zIndex: 25 }}
				/>
				{nowPlayingLayer && nowOpacity > 0 ? (
					<div
						className="pointer-events-none absolute text-white"
						style={{
							left: `${scene.nowPlaying.positionX * 100}%`,
							top: `${scene.nowPlaying.positionY * 100}%`,
							width: `${scene.nowPlaying.width * 100}%`,
							opacity: nowOpacity,
							transform: "translateY(-50%)",
							textAlign: scene.nowPlaying.align,
							textShadow: "0 2px 24px rgba(0,0,0,.8)",
							fontSize: `${scene.nowPlaying.fontScale}em`,
							zIndex: 30,
						}}
					>
						<div className="text-[clamp(8px,0.65vw,13px)] font-bold uppercase tracking-[0.34em] text-violet-200/80">
							Now Playing
						</div>
						<div className="mt-[0.5vw] truncate text-[clamp(22px,2.3vw,50px)] font-semibold tracking-tight">
							{scene.nowPlaying.title}
						</div>
						<div className="mt-[0.25vw] truncate text-[clamp(11px,1vw,22px)] text-white/75">
							{scene.nowPlaying.artist}
							{scene.nowPlaying.album ? ` · ${scene.nowPlaying.album}` : ""}
						</div>
					</div>
				) : null}
				<div className="pointer-events-none absolute inset-0" style={{ ...transitionStyle, zIndex: 40 }} />
			</div>
			{error ? (
				<div className="absolute inset-0 grid place-items-center bg-black px-8 text-center text-sm text-red-300">
					{error}
				</div>
			) : null}
		</main>
	);
}

function transitionOverlayStyle(mode: NonNullable<VisualTransportState["visualTransition"]>, progress: number) {
	if (mode === "cut" || progress <= 0 || progress >= 1) return { opacity: 0 };
	const middle = Math.sin(progress * Math.PI);
	if (mode === "flash") return { background: "white", opacity: middle * 0.72 };
	if (mode === "black") return { background: "black", opacity: middle };
	return {
		background: "radial-gradient(circle at 50% 50%, rgba(82,52,150,.25), rgba(0,0,0,.94))",
		opacity: middle * 0.82,
	};
}

function drawSpectrum(
	ctx: CanvasRenderingContext2D,
	smooth: Float32Array,
	scene: VisualSceneState,
	audio: VisualAudioFrame,
	width: number,
	height: number,
) {
	ctx.clearRect(0, 0, width, height);
	const layer = scene.layers.find((candidate) => candidate.type === "spectrum");
	if (!layer || !layer.visible) return;
	const source = audio.spectrum.length ? audio.spectrum : ZERO_AUDIO.spectrum;
	const smoothing = Math.max(0, Math.min(0.97, scene.spectrum.smoothing));
	for (let i = 0; i < smooth.length; i++) smooth[i] = smooth[i] * smoothing + (source[i] ?? 0) * (1 - smoothing);
	const opacity = layer.opacity;
	const energy = Math.max(0, Math.min(1, audio.energy));
	ctx.save();
	ctx.translate(scene.spectrum.positionX * width, scene.spectrum.positionY * height);
	ctx.rotate(scene.spectrum.rotation);
	ctx.scale(scene.spectrum.scale, scene.spectrum.scale);
	ctx.lineJoin = "round";
	ctx.lineCap = "round";
	ctx.shadowBlur = (width <= PREVIEW_WIDTH ? 6 : 12) * scene.spectrum.glow * (0.75 + energy * 0.8);
	ctx.shadowColor = `rgba(157,102,255,${0.45 * opacity})`;
	const gradient = ctx.createLinearGradient(0, -height * 0.28, 0, height * 0.28);
	gradient.addColorStop(0, `rgba(229,199,255,${opacity})`);
	gradient.addColorStop(0.48, `rgba(154,93,255,${opacity * 0.96})`);
	gradient.addColorStop(1, `rgba(50,102,228,${opacity * 0.75})`);
	ctx.strokeStyle = gradient;
	ctx.fillStyle = gradient;
	const mode = scene.spectrum.mode;
	const maxHeight = height * scene.spectrum.height;
	const span = width * 0.9;
	const step = span / smooth.length;
	const barWidth = Math.max(1.2, step * scene.spectrum.thickness);
	const x0 = -span / 2;
	const valueAt = (i: number) => Math.pow(Math.max(0.003, smooth[i] ?? 0), 1.28);

	if (mode === "radial" || mode === "halo" || mode === "ringBars" || mode === "arc" || mode === "dualArc") {
		const radius = Math.min(width, height) * (mode === "halo" ? 0.22 : 0.18);
		const arcStart = mode === "arc" ? Math.PI * 0.08 : mode === "dualArc" ? Math.PI * 0.08 : 0;
		const arcSpan = mode === "arc" ? Math.PI * 0.84 : mode === "dualArc" ? Math.PI * 0.84 : Math.PI * 2;
		ctx.lineWidth = Math.max(1.5, scene.spectrum.thickness * (width <= PREVIEW_WIDTH ? 2 : 4));
		ctx.beginPath();
		for (let i = 0; i < smooth.length; i++) {
			const t = i / (smooth.length - 1);
			const angle = arcStart + t * arcSpan;
			const amp = valueAt(i) * maxHeight * (mode === "halo" ? 0.42 : 0.72);
			const r = radius + amp;
			const x = Math.cos(angle) * r,
				y = Math.sin(angle) * r;
			if (i === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
			if (mode === "ringBars") {
				ctx.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
				ctx.lineTo(x, y);
			}
		}
		if (mode !== "arc" && mode !== "dualArc") ctx.closePath();
		ctx.stroke();
		if (mode === "dualArc") {
			ctx.save();
			ctx.scale(-1, 1);
			ctx.stroke();
			ctx.restore();
		}
		if (mode === "halo") {
			ctx.beginPath();
			ctx.arc(0, 0, radius, 0, Math.PI * 2);
			ctx.globalAlpha = opacity * 0.6;
			ctx.stroke();
			ctx.globalAlpha = 1;
		}
	} else if (mode === "smoothLine" || mode === "oscilloscope" || mode === "filledWave") {
		ctx.lineWidth = Math.max(1.5, scene.spectrum.thickness * (width <= PREVIEW_WIDTH ? 2.2 : 4.2));
		ctx.beginPath();
		for (let i = 0; i < smooth.length; i++) {
			const x = x0 + i * step;
			const raw = valueAt(i);
			const y =
				mode === "oscilloscope"
					? Math.sin(i * 0.48 + raw * 8 + performance.now() * 0.003) * raw * maxHeight * 0.48
					: -raw * maxHeight;
			if (i === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		}
		if (mode === "filledWave") {
			ctx.lineTo(x0 + span, 0);
			ctx.lineTo(x0, 0);
			ctx.closePath();
			ctx.globalAlpha = 0.72;
			ctx.fill();
			ctx.globalAlpha = 1;
		} else ctx.stroke();
	} else if (mode === "centerMirror") {
		for (let i = 0; i < smooth.length / 2; i++) {
			const v = valueAt(i * 2) * maxHeight;
			const distance = i * step * 1.9;
			ctx.fillRect(distance, -v, barWidth, v);
			ctx.fillRect(-distance - barWidth, -v, barWidth, v);
		}
	} else {
		for (let i = 0; i < smooth.length; i++) {
			const v = valueAt(i) * maxHeight;
			const x = x0 + i * step + (step - barWidth) * 0.5;
			if (mode === "mirrored") {
				ctx.fillRect(x, -v, barWidth, v);
				ctx.fillRect(x, 0, barWidth, v);
			} else if (mode === "depthBars") {
				ctx.fillRect(x, -v, barWidth, v);
				ctx.globalAlpha = opacity * 0.28;
				ctx.fillRect(x + barWidth * 0.45, -v - barWidth * 0.45, barWidth, v);
				ctx.globalAlpha = 1;
			} else ctx.fillRect(x, -v, barWidth, v);
		}
	}
	ctx.restore();
	ctx.shadowBlur = 0;
}
