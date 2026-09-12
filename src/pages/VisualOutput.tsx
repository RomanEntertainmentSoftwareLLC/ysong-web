import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
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
import { bridgeApi, type VisualAudioFrame, type VisualTransportState, type VisualRoomAudienceEffect, type VisualRoomAudienceEffectId } from "../lib/bridgeApi";
import { extrapolatedTransportPosition, subscribeLocalVisualAudio, subscribeLocalVisualTransport } from "../lib/visualsRealtime";
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
	type VisualHumanoidSlot,
	type VisualSkeletalAnimation,
	type VisualIKConstraint,
	type VisualPostFxModule,
	type VisualPostFxModuleType,
	type VisualSecondaryDynamic,
} from "../lib/visualsScene";
import {
	deterministicCameraShake,
	resolveVisualProgramCamera,
	sampleVisualProgramCamera,
} from "../lib/visualsCamera";
import { activeVisualAnimationClips, animationLayerAllowsTarget, sampleIKWeight } from "../lib/visualsPerformance";
import { buildSecondaryTopology, isSecondarySheet, secondaryTopologySignature, type SecondaryTopology } from "../lib/visualsSecondaryPhysics";
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

type RoomVisualEffectPulse = { effectId: VisualRoomAudienceEffectId; eventId: string; startedAt: number; until: number };
const ROOM_EFFECT_DURATION_MS: Record<VisualRoomAudienceEffectId, number> = {
	applause: 1700, hearts: 2600, confetti: 3200, lightning: 900, fire: 2800, snow: 4200, "camera-shake": 1200, strobe: 1600,
};

function roomEffectStrength(pulses: Map<VisualRoomAudienceEffectId, RoomVisualEffectPulse>, id: VisualRoomAudienceEffectId, now: number) {
	const pulse = pulses.get(id);
	if (!pulse || now >= pulse.until) return 0;
	const duration = Math.max(1, pulse.until - pulse.startedAt);
	const t = Math.max(0, Math.min(1, (now - pulse.startedAt) / duration));
	return Math.sin(Math.PI * Math.min(1, t)) * (1 - t * .18);
}

function hash01(value: number) {
	const x = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
	return x - Math.floor(x);
}

function drawHeart(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, alpha: number) {
	ctx.save(); ctx.translate(x, y); ctx.scale(size, size); ctx.globalAlpha = alpha;
	ctx.beginPath(); ctx.moveTo(0, .28); ctx.bezierCurveTo(-.55, -.12, -.42, -.62, 0, -.30); ctx.bezierCurveTo(.42, -.62, .55, -.12, 0, .28); ctx.closePath();
	ctx.fillStyle = "#d98cff"; ctx.fill(); ctx.restore();
}

function drawRoomAudienceEffects(ctx: CanvasRenderingContext2D, pulses: Map<VisualRoomAudienceEffectId, RoomVisualEffectPulse>, now: number, width: number, height: number) {
	const active = [...pulses.values()].filter((pulse) => now < pulse.until);
	if (!active.length) return;
	for (const pulse of active) {
		const duration = Math.max(1, pulse.until - pulse.startedAt);
		const t = Math.max(0, Math.min(1, (now - pulse.startedAt) / duration));
		const fade = Math.sin(Math.PI * Math.min(1, t));
		ctx.save();
		if (pulse.effectId === "hearts") {
			for (let i=0;i<22;i++){ const seed=hash01(i*9.1+31); const x=(.05+hash01(i*4.7)*.9)*width; const travel=(t*(.55+seed*.45)+hash01(i*2.3)*.1)%1; const y=height*(1.05-travel*1.15); const drift=Math.sin(t*5+i)*width*.018; drawHeart(ctx,x+drift,y,8+seed*12,fade*(.35+seed*.55)); }
		} else if (pulse.effectId === "confetti") {
			const colors=["#ffcf5a","#ff6b9e","#7ce6ff","#a98cff","#7cff9d"];
			for(let i=0;i<54;i++){const seed=hash01(i*7.7+19);const x=(hash01(i*3.17)*1.15-.075)*width+Math.sin(t*7+i)*18;const y=(-.1+t*(.8+seed*.75)+hash01(i*5.3)*.28)*height;ctx.globalAlpha=fade*(.45+seed*.5);ctx.fillStyle=colors[i%colors.length];ctx.save();ctx.translate(x,y);ctx.rotate(t*8+seed*5);ctx.fillRect(-3-seed*3,-7,6+seed*5,14);ctx.restore();}
		} else if (pulse.effectId === "snow") {
			ctx.fillStyle="#eef7ff"; for(let i=0;i<46;i++){const seed=hash01(i*11.2+7);const x=(hash01(i*2.9)*1.1-.05)*width+Math.sin(t*5+i)*22;const y=((hash01(i*4.1)+t*(.35+seed*.5))%1.15)*height;ctx.globalAlpha=fade*(.25+seed*.65);ctx.beginPath();ctx.arc(x,y,1.2+seed*3.4,0,Math.PI*2);ctx.fill();}
		} else if (pulse.effectId === "fire") {
			for(let i=0;i<30;i++){const seed=hash01(i*8.8+4);const x=(.03+hash01(i*3.6)*.94)*width;const rise=(t*(.55+seed*.55)+hash01(i*2.1)*.22)%1;const y=height*(1.02-rise*.42);const h=(16+seed*50)*fade;const grad=ctx.createLinearGradient(x,y,x,y-h);grad.addColorStop(0,"rgba(255,73,20,.0)");grad.addColorStop(.35,"rgba(255,73,20,.72)");grad.addColorStop(1,"rgba(255,224,94,.0)");ctx.fillStyle=grad;ctx.globalAlpha=.8;ctx.beginPath();ctx.moveTo(x-5-seed*5,y);ctx.quadraticCurveTo(x-12,y-h*.45,x+Math.sin(i+t*10)*5,y-h);ctx.quadraticCurveTo(x+12,y-h*.45,x+5+seed*5,y);ctx.closePath();ctx.fill();}
		} else if (pulse.effectId === "applause") {
			ctx.textAlign="center";ctx.textBaseline="middle";ctx.font=`${Math.max(28,width*.022)}px sans-serif`;for(let i=0;i<12;i++){const seed=hash01(i*6.2+15);const x=(.08+hash01(i*2.4)*.84)*width;const y=height*(.88-(t*(.25+seed*.18)));ctx.globalAlpha=fade*(.25+seed*.65);ctx.fillText("👏",x,y);}
		} else if (pulse.effectId === "lightning") {
			ctx.globalAlpha=fade*.88;ctx.strokeStyle="#e7e8ff";ctx.lineWidth=Math.max(2,width*.003);ctx.shadowBlur=20;ctx.shadowColor="#9f8cff";ctx.beginPath();let x=width*(.28+hash01(pulse.eventId.length)*.45),y=-10;ctx.moveTo(x,y);for(let i=1;i<=8;i++){x+=(hash01(i*7+pulse.eventId.length)-.5)*width*.09;y=height*(i/8);ctx.lineTo(x,y);}ctx.stroke();ctx.globalAlpha=fade*.24;ctx.fillStyle="#c9c7ff";ctx.fillRect(0,0,width,height);
		} else if (pulse.effectId === "strobe") {
			const blink=Math.max(0,Math.sin(t*Math.PI*14));ctx.globalAlpha=blink*fade*.5;ctx.fillStyle="#fff";ctx.fillRect(0,0,width,height);
		}
		ctx.restore();
	}
}

const ZERO_AUDIO: VisualAudioFrame = {
	sequence: 0, timestampUnixMs: 0, source: "idle", rms: 0, peak: 0, bass: 0, mids: 0, highs: 0, energy: 0, kick: 0,
	spectrum: Array.from({ length: 64 }, () => 0),
};

const ZERO_TRANSPORT: VisualTransportState = {
	source: "idle", playing: false, positionSeconds: 0, durationSeconds: 0, updatedAt: 0,
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
	materialBase: Map<THREE.MeshStandardMaterial, { color: THREE.Color; metalness: number; roughness: number; emissive: THREE.Color; emissiveIntensity: number }>;
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
	balanced: ["watch-audience", "curious-lean", "open-arms", "reach-camera", "recoil", "rage-build", "energy-gather", "lightning-left", "lightning-right", "predator-stare", "head-snap", "high-ascension"],
	aggressive: ["pound-screen", "double-pound", "grab-camera", "rage-release", "recoil", "stagger", "scream", "bass-possession", "lightning-left", "lightning-right", "dual-lightning", "storm-caller"],
	ethereal: ["look-up", "open-arms", "cruciform", "raise-hands", "high-ascension", "angelic-open", "energy-gather", "energy-release", "lightning-left", "lightning-right", "dual-lightning", "slow-sway"],
	emotional: ["look-down", "look-up", "curious-lean", "sorrow-curl", "mourn", "proud-stance", "protective", "laugh", "scream", "turn-away", "return-stare", "watch-audience"],
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
		rightUpperArm: findNamedTarget(objects, [/right.*upper.*arm/i, /upper.*arm.*r/i, /shoulder.*r/i, /right.*arm/i]),
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
	const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
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

function updateLightningLine(line: THREE.Line, start: THREE.Vector3, end: THREE.Vector3, branch: number, time: number, strength: number, color: THREE.Color) {
	const material = line.material as THREE.LineBasicMaterial;
	material.color.copy(color);
	if (strength <= 0.015) { material.opacity = 0; line.visible = false; return; }
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
		const point = start.clone().addScaledVector(direction, t)
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
	const minGap = Math.max(0.55, perf.minimumCooldown) * 1000 / Math.max(0.35, perf.directorIntensity);
	if (now - runtime.lastAutoAt < minGap) return null;
	const kickEdge = audio.kick > 0.55 && runtime.lastKick <= 0.55;
	const energyEdge = audio.energy > 0.68 && runtime.lastEnergy <= 0.58;
	const bassEdge = audio.bass > 0.72 && runtime.lastBass <= 0.62;
	const highsEdge = audio.highs > 0.72 && runtime.lastHighs <= 0.62;
	let preferred: string[] = [];
	if (kickEdge) preferred = perf.directorMode === "aggressive" ? ["pound-screen", "recoil", "rage-release", "head-snap", "stagger"] : ["recoil", "head-snap", "energy-release", "reach-camera"];
	else if (energyEdge) preferred = perf.directorMode === "ethereal" ? ["high-ascension", "angelic-open", "raise-hands", "dual-lightning"] : ["open-arms", "rage-build", "dual-lightning", "energy-gather"];
	else if (bassEdge) preferred = perf.directorMode === "aggressive" ? ["grab-camera", "bass-possession", "rage-build", "pound-screen"] : ["bass-possession", "reach-camera", "curious-lean", "protective"];
	else if (highsEdge) preferred = ["lightning-left", "lightning-right", "wave-left", "wave-right", "look-up"];
	else if (audio.energy < 0.16 && now - runtime.lastAutoAt > minGap * 2.6) preferred = perf.directorMode === "emotional" ? ["look-down", "sorrow-curl", "mourn", "watch-audience"] : ["breathe", "slow-sway", "watch-audience", "predator-stare"];
	if (!preferred.length) return null;
	const modePool = AUTO_POOLS[perf.directorMode] ?? AUTO_POOLS.balanced;
	const candidates = [...preferred, ...modePool].filter((id, index, all) => all.indexOf(id) === index && !runtime.recent.slice(-4).includes(id));
	const ids = candidates.length ? candidates : preferred;
	const index = Math.abs(Math.floor((audio.sequence * 17 + now * 0.013))) % ids.length;
	return PERFORMANCE_BY_ID.get(ids[index]) ?? null;
}

function triggerPerformance(runtime: PerformanceRuntime, cue: VisualPerformanceCue, strength: number, source: "manual" | "auto" | "timeline", now: number) {
	runtime.active = cue;
	runtime.startedAt = now;
	runtime.durationMs = Math.max(250, cue.duration * 1000);
	runtime.strength = Math.max(0.1, Math.min(2, strength));
	runtime.source = source;
	if (source === "auto") runtime.lastAutoAt = now;
	runtime.recent.push(cue.id);
	if (runtime.recent.length > 12) runtime.recent.splice(0, runtime.recent.length - 12);
}

function applyCueToMannequin(rig: MannequinRig, cue: VisualPerformanceCue | null, weight: number, strength: number, headTrack: number) {
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

function applyCueToTargets(targets: RigTargets, cue: VisualPerformanceCue | null, weight: number, strength: number, headTrack: number) {
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
	const addBox = (parent: THREE.Object3D, size: [number, number, number], pos: [number, number, number], material = dark) => {
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

	const hips = new THREE.Group(); hips.position.y = -0.65; root.add(hips);
	addBox(hips, [1.05, 0.55, 0.55], [0, 0, 0], accent);
	const spine = new THREE.Group(); spine.position.y = 0.28; hips.add(spine);
	addBox(spine, [0.92, 1.25, 0.54], [0, 0.63, 0]);
	const chest = new THREE.Group(); chest.position.y = 1.15; spine.add(chest);
	addBox(chest, [1.46, 1.25, 0.66], [0, 0.45, 0], dark);
	const neck = new THREE.Group(); neck.position.y = 1.15; chest.add(neck);
	addBox(neck, [0.34, 0.34, 0.34], [0, 0.12, 0], accent);
	const head = new THREE.Group(); head.position.y = 0.55; neck.add(head);
	addSphere(head, 0.52, [0, 0.20, 0], skin);

	const makeArm = (side: -1 | 1) => {
		const shoulder = new THREE.Group(); shoulder.position.set(side * 0.86, 0.72, 0); chest.add(shoulder);
		addSphere(shoulder, 0.22, [0, 0, 0], accent);
		addBox(shoulder, [0.34, 1.35, 0.38], [side * 0.04, -0.66, 0], dark);
		const elbow = new THREE.Group(); elbow.position.set(side * 0.04, -1.32, 0); shoulder.add(elbow);
		addSphere(elbow, 0.19, [0, 0, 0], accent);
		addBox(elbow, [0.30, 1.25, 0.34], [0, -0.60, 0], dark);
		const hand = new THREE.Group(); hand.position.y = -1.20; elbow.add(hand);
		addSphere(hand, 0.24, [0, -0.08, 0], skin);
		return { shoulder, elbow, hand };
	};
	const leftArm = makeArm(-1);
	const rightArm = makeArm(1);

	const makeLeg = (side: -1 | 1) => {
		const hip = new THREE.Group(); hip.position.set(side * 0.34, -0.28, 0); hips.add(hip);
		addSphere(hip, 0.21, [0, 0, 0], accent);
		addBox(hip, [0.42, 1.55, 0.48], [0, -0.76, 0], dark);
		const knee = new THREE.Group(); knee.position.y = -1.50; hip.add(knee);
		addSphere(knee, 0.21, [0, 0, 0], accent);
		addBox(knee, [0.37, 1.48, 0.43], [0, -0.72, 0], dark);
		const foot = new THREE.Group(); foot.position.y = -1.43; knee.add(foot);
		addBox(foot, [0.48, 0.28, 0.92], [0, -0.08, 0.22], accent);
	};
	makeLeg(-1); makeLeg(1);
	return {
		root, spine, chest, head,
		leftShoulder: leftArm.shoulder, rightShoulder: rightArm.shoulder,
		leftElbow: leftArm.elbow, rightElbow: rightArm.elbow,
		leftHand: leftArm.hand, rightHand: rightArm.hand,
		materials,
	};
}

function createCrystal() {
	const group = new THREE.Group();
	const materials = [makeMaterial(0x5b49cb), makeMaterial(0x9c6de8), makeMaterial(0x2c78d7)];
	for (const [scale, material] of [[1, materials[0]], [0.58, materials[1]], [1.32, materials[2]]] as const) {
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
		seeds[i * 4] = Math.random(); seeds[i * 4 + 1] = Math.random(); seeds[i * 4 + 2] = Math.random(); seeds[i * 4 + 3] = Math.random();
		colors[i * 3] = 0.62; colors[i * 3 + 1] = 0.55; colors[i * 3 + 2] = 1;
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
	const material = new THREE.PointsMaterial({ color: 0xffffff, vertexColors: true, size: 0.035, transparent: true, opacity: 0.72, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, alphaTest: 0.02 });
	const points = new THREE.Points(geometry, material);
	points.frustumCulled = false;
	return { points, geometry, material, positions, colors, seeds };
}


function makeWeatherParticles() {
	const positions = new Float32Array(MAX_WEATHER_PARTICLES * 3);
	const colors = new Float32Array(MAX_WEATHER_PARTICLES * 3);
	const seeds = new Float32Array(MAX_WEATHER_PARTICLES * 4);
	for (let i = 0; i < MAX_WEATHER_PARTICLES; i++) {
		const hash=(n:number)=>{const v=Math.sin(n*12.9898+78.233)*43758.5453;return v-Math.floor(v)};
		seeds[i*4]=hash(i+1); seeds[i*4+1]=hash(i+101.7); seeds[i*4+2]=hash(i+907.1); seeds[i*4+3]=hash(i+1907.9);
		colors[i*3]=1; colors[i*3+1]=1; colors[i*3+2]=1;
	}
	const geometry=new THREE.BufferGeometry();
	geometry.setAttribute("position",new THREE.BufferAttribute(positions,3));
	geometry.setAttribute("color",new THREE.BufferAttribute(colors,3));
	geometry.setDrawRange(0,0);
	const material=new THREE.PointsMaterial({color:0xffffff,vertexColors:true,size:.065,transparent:true,opacity:.9,depthWrite:false,sizeAttenuation:true,blending:THREE.NormalBlending});
	const points=new THREE.Points(geometry,material); points.frustumCulled=false; points.renderOrder=8;
	return {points,geometry,material,positions,colors,seeds};
}

function wrappedWeather(value:number,span:number){const half=span*.5;return ((((value+half)%span)+span)%span)-half}

function makePrimitiveGeometry(primitive: VisualPrimitiveObject) {
	const sx=Math.max(.01,primitive.sizeX), sy=Math.max(.01,primitive.sizeY), sz=Math.max(.01,primitive.sizeZ);
	const radius=Math.max(.01,primitive.radius), height=Math.max(.01,primitive.height), segments=Math.max(3,Math.min(128,Math.round(primitive.segments)));
	switch(primitive.primitive){
		case "sphere": return new THREE.SphereGeometry(radius,segments,Math.max(2,Math.round(segments/2)));
		case "icosphere": return new THREE.IcosahedronGeometry(radius,Math.max(0,Math.min(5,Math.round(Math.log2(segments/8)))));
		case "cylinder": return new THREE.CylinderGeometry(radius,radius,height,segments,Math.max(1,Math.round(segments/8)));
		case "cone": return new THREE.ConeGeometry(radius,height,segments,Math.max(1,Math.round(segments/8)));
		case "capsule": return new THREE.CapsuleGeometry(radius,Math.max(.01,height-radius*2),Math.max(4,Math.round(segments/4)),segments);
		case "plane": return new THREE.PlaneGeometry(sx,sz,Math.max(1,Math.round(segments/8)),Math.max(1,Math.round(segments/8)));
		case "torus": return new THREE.TorusGeometry(radius,Math.max(.01,primitive.tubeRadius),Math.max(3,Math.round(segments/2)),segments);
		case "pyramid": return new THREE.ConeGeometry(Math.max(sx,sz)*.5,sy,4,1);
		default: return new THREE.BoxGeometry(sx,sy,sz,Math.max(1,Math.round(segments/16)),Math.max(1,Math.round(segments/16)),Math.max(1,Math.round(segments/16)));
	}
}

function autoHumanoidMap(bones: THREE.Bone[]): Partial<Record<VisualHumanoidSlot,string>> {
	const pick=(patterns:RegExp[])=>findNamedTarget(bones,patterns)?.name;
	return {
		root:pick([/^root$/i,/armature/i]), hips:pick([/^hips$/i,/pelvis|hip/i]), spine:pick([/^spine$/i,/spine/i]), chest:pick([/^chest$/i,/upper.?chest|upper.?spine/i]), neck:pick([/^neck$/i,/neck/i]), head:pick([/^head$/i,/head/i]),
		leftShoulder:pick([/left.*shoulder/i,/shoulder.*l/i]), leftUpperArm:pick([/left.*upper.*arm/i,/upper.*arm.*l/i,/left.*arm/i]), leftForeArm:pick([/left.*fore.*arm/i,/fore.*arm.*l/i,/left.*lower.*arm/i]), leftHand:pick([/^left.*hand$/i,/hand.*l/i,/left.*wrist/i]),
		rightShoulder:pick([/right.*shoulder/i,/shoulder.*r/i]), rightUpperArm:pick([/right.*upper.*arm/i,/upper.*arm.*r/i,/right.*arm/i]), rightForeArm:pick([/right.*fore.*arm/i,/fore.*arm.*r/i,/right.*lower.*arm/i]), rightHand:pick([/^right.*hand$/i,/hand.*r/i,/right.*wrist/i]),
		leftUpperLeg:pick([/left.*upper.*leg/i,/left.*thigh/i,/thigh.*l/i]), leftLowerLeg:pick([/left.*lower.*leg/i,/left.*calf/i,/shin.*l/i]), leftFoot:pick([/^left.*foot/i,/foot.*l/i,/left.*ankle/i]),
		rightUpperLeg:pick([/right.*upper.*leg/i,/right.*thigh/i,/thigh.*r/i]), rightLowerLeg:pick([/right.*lower.*leg/i,/right.*calf/i,/shin.*r/i]), rightFoot:pick([/^right.*foot/i,/foot.*r/i,/right.*ankle/i]),
	};
}

function sampleSkeletalTrack(animation: VisualSkeletalAnimation, target: string, property: "rotation"|"position"|"scale", time: number) {
	const frames=animation.keyframes.filter(key=>key.target===target&&key.property===property).sort((a,b)=>a.time-b.time);
	if(!frames.length)return null;
	if(frames.length===1||time<=frames[0].time)return frames[0];
	if(time>=frames[frames.length-1].time)return frames[frames.length-1];
	let left=frames[0],right=frames[frames.length-1];
	for(let i=1;i<frames.length;i++)if(frames[i].time>=time){left=frames[i-1];right=frames[i];break;}
	const raw=(time-left.time)/Math.max(.0001,right.time-left.time); const t=right.easing==="linear"?raw:raw*raw*(3-2*raw);
	return { ...left, x:THREE.MathUtils.lerp(left.x,right.x,t), y:THREE.MathUtils.lerp(left.y,right.y,t), z:THREE.MathUtils.lerp(left.z,right.z,t) };
}

function solveCcdIk(effector:THREE.Object3D,joints:THREE.Object3D[],target:THREE.Vector3,weight:number,iterations:number,maxAngleDegrees:number){
	const w=Math.max(0,Math.min(1,weight)); if(w<=.0001||!joints.length)return;
	const identity=new THREE.Quaternion(); const effWorld=new THREE.Vector3(); const localEff=new THREE.Vector3(); const localTarget=new THREE.Vector3(); const delta=new THREE.Quaternion();
	const maxAngle=THREE.MathUtils.degToRad(Math.max(1,maxAngleDegrees));
	for(let iteration=0;iteration<Math.max(1,Math.min(12,iterations));iteration++){
		for(const joint of joints){
			joint.updateWorldMatrix(true,true); effector.getWorldPosition(effWorld);
			localEff.copy(effWorld); joint.worldToLocal(localEff); localTarget.copy(target); joint.worldToLocal(localTarget);
			if(localEff.lengthSq()<1e-8||localTarget.lengthSq()<1e-8)continue;
			delta.setFromUnitVectors(localEff.normalize(),localTarget.normalize());
			const angle=identity.angleTo(delta); if(angle<1e-5)continue;
			const fraction=Math.min(1,maxAngle/angle)*w; const limited=identity.clone().slerp(delta,fraction);
			joint.quaternion.premultiply(limited).normalize(); joint.updateMatrixWorld(true);
		}
	}
}

function blendLookAt(object:THREE.Object3D,target:THREE.Vector3,weight:number){
	const w=Math.max(0,Math.min(1,weight)); if(w<=.0001)return;
	const before=object.quaternion.clone(); object.lookAt(target); const desired=object.quaternion.clone(); object.quaternion.copy(before).slerp(desired,w).normalize();
}

function setParticlePosition(index: number, scene: VisualSceneState, positions: Float32Array, seeds: Float32Array, life: number, time: number, audio: number, windX = 0, windZ = 0, windTurbulence = 0) {
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
		z = -depth * 0.45 + (sy * 0.7);
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
	const turbulence = scene.particles.turbulence * (0.12 + audio * 0.28) + windTurbulence * .12;
	x += Math.sin(time * 1.1 + phase * 3) * turbulence;
	y += Math.cos(time * 0.9 + phase * 2) * turbulence;
	y -= scene.particles.gravity * life * life * 0.8;
	x += windX * life * 0.9;
	z += windZ * life * 0.9;
	positions[i3] = x + scene.particles.positionX;
	positions[i3 + 1] = y + scene.particles.positionY;
	positions[i3 + 2] = z + scene.particles.positionZ;
}

function applyPose(rig: MannequinRig, scene: VisualSceneState, body: number, arms: number, idleTime: number, spring: number) {
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
	rig.leftElbow.rotation.z = pose === "reach" ? -0.28 - arms * 0.22 : -0.10 - arms * 0.18;
	rig.rightElbow.rotation.z = pose === "reach" ? 0.28 + arms * 0.22 : 0.10 + arms * 0.18;
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
	const [audioState, setAudioState] = useState<VisualAudioFrame>(ZERO_AUDIO);
	const [transport, setTransport] = useState<VisualTransportState>(ZERO_TRANSPORT);
	const [overlayModulationDeltas, setOverlayModulationDeltas] = useState<Record<string, number>>({});
	const [error, setError] = useState("");
	const query = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
	const embedded = query.get("embedded") === "1";
	const programPreview = embedded && query.get("program") === "1";
	const forcedCameraId = query.get("cameraId") || "";
	const editorFreeRoam = embedded && !programPreview;
	const obsMode = query.get("obs") === "1";
	const renderWidth = embedded ? PREVIEW_WIDTH : PROGRAM_WIDTH;
	const renderHeight = embedded ? PREVIEW_HEIGHT : PROGRAM_HEIGHT;
	const qualitySelection = editorFreeRoam ? scene.renderer.editorQuality : scene.renderer.programQuality;
	const antialiasEnabled = editorFreeRoam ? scene.renderer.editorAntialias : scene.renderer.programAntialias;

	useEffect(() => {
		let cancelled = false;
		void bridgeApi.getVisualScene<VisualSceneState>().then((payload) => {
			if (cancelled) return;
			const next = normalizeVisualScene(payload.scene); sceneRef.current = next; sceneHydratedRef.current = true; setScene(next);
		}).catch(() => {});
		void bridgeApi.getVisualAudio().then((frame) => { if (!cancelled) { audioRef.current = frame; setAudioState(frame); } }).catch(() => {});
		void bridgeApi.getVisualTransport().then((next) => { if (!cancelled) { transportRef.current = next; setTransport(next); } }).catch(() => {});
		const stopScene = bridgeApi.subscribeVisualScene<VisualSceneState>((payload) => { const next = normalizeVisualScene(payload.scene); sceneRef.current = next; sceneHydratedRef.current = true; setScene(next); });
		const setAudioFrame = (frame: VisualAudioFrame) => { audioRef.current = frame; setAudioState(frame); };
		const setTransportFrame = (next: VisualTransportState) => { transportRef.current = next; setTransport(next); };
		// In-editor/program windows use the local realtime bus so multiple SSE streams do not
		// saturate the browser's per-origin connection pool. OBS stays on Bridge SSE.
		const stopAudio = obsMode ? bridgeApi.subscribeVisualAudio(setAudioFrame) : subscribeLocalVisualAudio(setAudioFrame);
		const stopTransport = obsMode ? bridgeApi.subscribeVisualTransport(setTransportFrame) : subscribeLocalVisualTransport(setTransportFrame);
		return () => { cancelled = true; stopScene(); stopAudio(); stopTransport(); };
	}, [obsMode]);

	useEffect(() => {
		const trigger = (effect: VisualRoomAudienceEffect) => {
			if (!effect?.eventId || roomEffectSeenRef.current.has(effect.eventId) || !(effect.effectId in ROOM_EFFECT_DURATION_MS)) return;
			roomEffectSeenRef.current.add(effect.eventId);
			if (roomEffectSeenRef.current.size > 256) {
				const first = roomEffectSeenRef.current.values().next().value;
				if (first) roomEffectSeenRef.current.delete(first);
			}
			const startedAt = performance.now();
			roomEffectPulsesRef.current.set(effect.effectId, { effectId: effect.effectId, eventId: effect.eventId, startedAt, until: startedAt + ROOM_EFFECT_DURATION_MS[effect.effectId] });
		};
		const stopLocal = subscribeRoomVenueEvents((_roomId, event) => {
			if (event.kind !== "effect") return;
			const effectId = String(event.payload?.effectId || "") as VisualRoomAudienceEffectId;
			if (!(effectId in ROOM_EFFECT_DURATION_MS)) return;
			trigger({ roomId: event.roomId, eventId: event.id, effectId, actorName: event.actorName, timestampUnixMs: Date.now() });
		});
		const stopBridge = obsMode ? bridgeApi.subscribeVisualRoomEffects((payload) => trigger(payload.effect)) : () => {};
		return () => { stopLocal(); stopBridge(); };
	}, [obsMode]);

	useEffect(() => {
		const previousTitle = document.title;
		document.title = YSONG_VISUAL_OUTPUT_TITLE;
		document.documentElement.style.background = "#000";
		document.body.style.background = "#000";
		document.body.style.overflow = "hidden";
		return () => { document.title = previousTitle; };
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
			renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "high-performance", premultipliedAlpha: false });
		} catch (caught) {
			const message = caught instanceof Error ? caught.message : "WebGL renderer initialization failed.";
			setError(message);
			channel.postMessage({ type: "visual-output-error", timestamp: Date.now(), message } satisfies VisualOutputError);
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
		let runtimeQuality: VisualRuntimeQuality = resolveVisualRuntimeQuality(qualitySelection, rendererCapabilities, customQuality);
		if (!antialiasEnabled) runtimeQuality = { ...runtimeQuality, antialiasMode: "off" };
		let adaptiveScale = scene.renderer.adaptiveResolution
			? Math.max(scene.renderer.adaptiveMinScale, Math.min(scene.renderer.adaptiveMaxScale, 1))
			: 1;
		const fittedRender = fitVisualRenderSize(renderWidth, renderHeight, runtimeQuality.renderScale * adaptiveScale, rendererCapabilities);
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
		backgroundScene.background = new THREE.Color(0x000000);
		const backgroundCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
		const mediaGeometry = new THREE.PlaneGeometry(2, 2);
		const mediaMaterial = new THREE.MeshBasicMaterial({
			color: 0xffffff, transparent: false, depthTest: false, depthWrite: false, toneMapped: false, fog: false,
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
			if (backgroundVideo) { backgroundVideo.pause(); backgroundVideo.removeAttribute("src"); backgroundVideo.load(); backgroundVideo = null; }
			if (backgroundTexture) { backgroundTexture.dispose(); backgroundTexture = null; }
			mediaMaterial.map = null;
			mediaMaterial.needsUpdate = true;
			mediaPlane.visible = false;
		};

		const reportBackgroundMediaError = (key: string, message: string) => {
			if (backgroundMediaFailed === key) return;
			backgroundMediaFailed = key;
			channel.postMessage({ type: "visual-output-error", timestamp: Date.now(), message } satisfies VisualOutputError);
		};

		const assignBackgroundTexture = (key: string, texture: THREE.Texture, aspect: number) => {
			if (backgroundMediaKey !== key) { texture.dispose(); return; }
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
				const refreshVideoFrame = () => { if (backgroundMediaKey === key) texture.needsUpdate = true; };
				video.addEventListener("loadedmetadata", () => {
					if (backgroundMediaKey !== key) return;
					backgroundMediaAspect = video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : 16 / 9;
					refreshVideoFrame();
				});
				video.addEventListener("loadeddata", refreshVideoFrame);
				video.addEventListener("seeked", refreshVideoFrame);
				video.addEventListener("error", () => reportBackgroundMediaError(key, `Could not decode background video: ${layer.fileName || layer.name}. Re-import the file if it was moved or the saved media URL is stale.`));
				video.load();
				video.load();
				return;
			}
			mediaTextureLoader.load(layer.mediaUrl, (texture) => {
				const image = texture.image as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number } | undefined;
				const width = image?.naturalWidth || image?.width || 16;
				const height = image?.naturalHeight || image?.height || 9;
				assignBackgroundTexture(key, texture, height > 0 ? width / height : 16 / 9);
			}, undefined, () => reportBackgroundMediaError(key, `Could not load background image: ${layer.fileName || layer.name}. Re-import the file if its saved media URL is stale.`));
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
					texture.repeat.x = repeatX; texture.offset.x = (1 - repeatX) / 2;
				} else {
					const repeatY = backgroundMediaAspect / targetAspect;
					texture.repeat.y = repeatY; texture.offset.y = (1 - repeatY) / 2;
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
		const skySphereMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, toneMapped: false, depthTest: false, depthWrite: false });
		let skySphereGeometry = new THREE.SphereGeometry(70, 64, 32);
		skySphereGeometry.scale(-1, 1, 1);
		const skySphere = new THREE.Mesh(skySphereGeometry, skySphereMaterial);
		skySphere.renderOrder = -9000; skySphere.frustumCulled = false; skySphere.visible = false;
		threeScene.add(skySphere);
		const skyBoxMaterials = Array.from({ length: 6 }, () => new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide, fog: false, toneMapped: false, depthTest: false, depthWrite: false }));
		const skyBoxGeometry = new THREE.BoxGeometry(110, 110, 110);
		const skyBox = new THREE.Mesh(skyBoxGeometry, skyBoxMaterials);
		skyBox.renderOrder = -9000; skyBox.frustumCulled = false; skyBox.visible = false;
		threeScene.add(skyBox);
		let skySphereUrl = "";
		let skySphereTexture: THREE.Texture | null = null;
		let skySpherePolygonTarget = 0;
		const skyBoxUrls = ["", "", "", "", "", ""];
		const skyBoxTextures: Array<THREE.Texture | null> = [null, null, null, null, null, null];
		const prepSkyTexture = (texture: THREE.Texture) => { texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = runtimeQuality.maxAnisotropy; texture.wrapS = THREE.ClampToEdgeWrapping; texture.wrapT = THREE.ClampToEdgeWrapping; texture.needsUpdate = true; return texture; };
		const setSkySphereUrl = (url: string) => {
			if (url === skySphereUrl) return;
			skySphereUrl = url;
			if (skySphereTexture) { skySphereTexture.dispose(); skySphereTexture = null; }
			skySphereMaterial.map = null; skySphereMaterial.needsUpdate = true;
			if (!url) return;
			skyTextureLoader.load(url, texture => { if (skySphereUrl !== url) { texture.dispose(); return; } skySphereTexture = prepSkyTexture(texture); skySphereMaterial.map = skySphereTexture; skySphereMaterial.needsUpdate = true; }, undefined, () => reportBackgroundMediaError(`sky-sphere|${url}`, "Could not load the Sky Sphere texture."));
		};
		const setSkyBoxFace = (index: number, url: string) => {
			if (skyBoxUrls[index] === url) return;
			skyBoxUrls[index] = url;
			if (skyBoxTextures[index]) { skyBoxTextures[index]?.dispose(); skyBoxTextures[index] = null; }
			skyBoxMaterials[index].map = null; skyBoxMaterials[index].needsUpdate = true;
			if (!url) return;
			skyTextureLoader.load(url, texture => { if (skyBoxUrls[index] !== url) { texture.dispose(); return; } skyBoxTextures[index] = prepSkyTexture(texture); skyBoxMaterials[index].map = skyBoxTextures[index]; skyBoxMaterials[index].needsUpdate = true; }, undefined, () => reportBackgroundMediaError(`sky-box-${index}|${url}`, "Could not load one of the Skybox textures."));
		};
		const updateSky = (state: VisualSceneState, transportPosition: number) => {
			const layer = state.layers.find(candidate => candidate.type === "sky");
			const active = !!layer && visualLayerActive(layer, transportPosition);
			if (!active) { skySphere.visible = false; skyBox.visible = false; return; }
			const brightness = Math.max(0, Math.min(3, state.sky.brightness)) * Math.max(0, Math.min(1, layer?.opacity ?? 1));
			if (state.sky.mode === "sphere") {
				const requestedPolygons = Math.max(256, Math.min(runtimeQuality.skyPolygonCap, Math.min(65536, Math.round(state.sky.spherePolygons || 4096))));
				if (requestedPolygons !== skySpherePolygonTarget) {
					skySpherePolygonTarget = requestedPolygons;
					const widthSegments = Math.max(8, Math.min(256, Math.round(Math.sqrt(requestedPolygons))));
					const heightSegments = Math.max(4, Math.min(128, Math.round(widthSegments / 2)));
					skySphereGeometry.dispose(); skySphereGeometry = new THREE.SphereGeometry(70, widthSegments, heightSegments); skySphereGeometry.scale(-1, 1, 1); skySphere.geometry = skySphereGeometry;
				}
				setSkySphereUrl(state.sky.sphereUrl || "");
				skySphere.position.copy(camera.position); skySphere.rotation.set(0, state.sky.rotationY || 0, 0); skySphereMaterial.color.setScalar(brightness);
				skySphere.visible = !!skySphereTexture; skyBox.visible = false;
				return;
			}
			const urls = [state.sky.boxRightUrl, state.sky.boxLeftUrl, state.sky.boxTopUrl, state.sky.boxBottomUrl, state.sky.boxFrontUrl, state.sky.boxBackUrl];
			urls.forEach((url, index) => setSkyBoxFace(index, url || ""));
			for (const material of skyBoxMaterials) material.color.setScalar(brightness);
			skyBox.position.copy(camera.position); skyBox.rotation.set(0, state.sky.rotationY || 0, 0);
			skyBox.visible = urls.every(Boolean) && skyBoxTextures.every(Boolean); skySphere.visible = false;
		};

		// Embedded preview gets an editor-only FPS camera. Program Output/OBS never
		// consumes this state. Empty-space click reliably captures pointer lock.
		const editorKeys = new Set<string>();
		let editorYaw = 0;
		let editorPitch = 0;
		let editorFast = false;
		let editorPanning = false;
		let hoveredSelectableId = "";
		let lastEditorCameraPost = 0;
		const editorForward = new THREE.Vector3();
		const editorRight = new THREE.Vector3();
		const editorUp = new THREE.Vector3();
		canvas.tabIndex = 0;
		const updateEditorAxes = () => {
			editorForward.set(-Math.sin(editorYaw) * Math.cos(editorPitch), Math.sin(editorPitch), -Math.cos(editorYaw) * Math.cos(editorPitch)).normalize();
			editorRight.crossVectors(editorForward, camera.up).normalize();
			editorUp.crossVectors(editorRight, editorForward).normalize();
		};
		const clearEditorInput = () => { editorKeys.clear(); editorFast = false; editorPanning = false; };
		const onEditorKeyDown = (event: KeyboardEvent) => { if (!editorFreeRoam) return; editorKeys.add(event.code); if (event.code === "ShiftLeft" || event.code === "ShiftRight") editorFast = true; };
		const onEditorKeyUp = (event: KeyboardEvent) => { if (!editorFreeRoam) return; editorKeys.delete(event.code); if (event.code === "ShiftLeft" || event.code === "ShiftRight") editorFast = false; };
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
			canvas.style.cursor = active ? "none" : (hoveredSelectableId ? "pointer" : "crosshair");
			window.parent.postMessage({ type: "ysong-editor-free-roam", active }, window.location.origin);
		};
		const onPointerLockError = () => {
			clearEditorInput();
			canvas.style.cursor = hoveredSelectableId ? "pointer" : "crosshair";
			window.parent.postMessage({ type: "ysong-editor-free-roam", active: false, error: true }, window.location.origin);
		};
		const onEditorClick = () => {
			if (!editorFreeRoam) return;
			canvas.focus({ preventScroll: true });
			if (document.pointerLockElement === canvas) { document.exitPointerLock(); return; }
			if (hoveredSelectableId) { window.parent.postMessage({ type: "ysong-visual-select", id: hoveredSelectableId }, window.location.origin); return; }
			try { const result = canvas.requestPointerLock(); if (result && typeof (result as Promise<void>).catch === "function") void (result as Promise<void>).catch(onPointerLockError); } catch { onPointerLockError(); }
		};
		const onEditorWheel = (event: WheelEvent) => {
			if (!editorFreeRoam) return;
			event.preventDefault();
			updateEditorAxes();
			const amount = Math.max(-2.4, Math.min(2.4, -event.deltaY * (editorFast ? 0.018 : 0.009)));
			camera.position.addScaledVector(editorForward, amount);
		};
		const onEditorMouseDown = (event: MouseEvent) => { if (editorFreeRoam && event.button === 1) { event.preventDefault(); canvas.focus({ preventScroll: true }); editorPanning = true; } };
		const onEditorMouseUp = (event: MouseEvent) => { if (event.button === 1) editorPanning = false; };
		const onWindowBlur = () => clearEditorInput();
		const onVisibility = () => { if (document.hidden) { clearEditorInput(); if (document.pointerLockElement === canvas) document.exitPointerLock(); } };
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
		}

		// Editor-only scene helpers. They are not part of Program Output or OBS.
		// The frustum is a compact DCC-style truncated pyramid with a real near plane;
		// it deliberately does not extend to the camera's potentially huge far clip.
		const cameraHelperRoot = new THREE.Group();
		cameraHelperRoot.name = "YSong Editor Camera Helpers";
		cameraHelperRoot.visible = editorFreeRoam;
		threeScene.add(cameraHelperRoot);
		type CameraHelperRuntime = { root: THREE.Group; frustum: THREE.LineSegments; forward: THREE.Line; target: THREE.Line; path: THREE.Line; pathSignature: string; fallback: THREE.Group; model: THREE.Object3D | null; materialCopies: THREE.Material[] };
		const cameraHelpers = new Map<string, CameraHelperRuntime>();
		let filmCameraTemplate: THREE.Object3D | null = null;
		let filmCameraRequested = false;
		const fbxLoader = new FBXLoader();
		const makeFallbackCamera = () => {
			const root = new THREE.Group();
			const wire = new THREE.MeshBasicMaterial({ color: 0x56d6ff, wireframe: true, transparent: true, opacity: 0.9, depthTest: true });
			const body = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.32, 0.58), wire); body.position.z = 0.18; root.add(body);
			const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 0.34, 12), wire); lens.rotation.x = Math.PI / 2; lens.position.z = -0.28; root.add(lens);
			return root;
		};
		const cloneCameraModel = (source: THREE.Object3D) => {
			const model = source.clone(true);
			const materials: THREE.Material[] = [];
			model.traverse(child => {
				if (!(child instanceof THREE.Mesh)) return;
				const originals = Array.isArray(child.material) ? child.material : [child.material];
				const clones = originals.map(material => { const copy = material.clone(); copy.transparent = true; copy.depthWrite = true; materials.push(copy); return copy; });
				child.material = Array.isArray(child.material) ? clones : clones[0];
			});
			// Imported helper was authored looking +X. YSong Program Cameras look -Z.
			model.rotation.y += Math.PI / 2;
			return { model, materials };
		};
		const requestFilmCamera = () => {
			if (filmCameraRequested || !editorFreeRoam) return;
			filmCameraRequested = true;
			fbxLoader.load("/visuals/filmCamera.fbx", object => {
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
					const cloned = cloneCameraModel(object); helper.model = cloned.model; helper.materialCopies.push(...cloned.materials); helper.root.add(cloned.model);
				}
			}, undefined, () => { /* fallback camera stays visible */ });
		};
		const createFrustum = () => {
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(24 * 3), 3));
			const material = new THREE.LineBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.68, depthTest: true });
			const lines = new THREE.LineSegments(geometry, material); lines.renderOrder = 900; return lines;
		};
		const updateFrustumGeometry = (lines: THREE.LineSegments, programCamera: VisualProgramCamera) => {
			const near = Math.max(0.03, Math.min(programCamera.near, programCamera.helperLength * 0.35));
			const far = Math.max(near + 0.05, programCamera.helperLength);
			const halfFov = THREE.MathUtils.degToRad(Math.max(1, Math.min(179, programCamera.fov))) * 0.5;
			const nh = Math.tan(halfFov) * near, nw = nh * (renderWidth / renderHeight);
			const fh = Math.tan(halfFov) * far, fw = fh * (renderWidth / renderHeight);
			const n = [[-nw,-nh,-near],[nw,-nh,-near],[nw,nh,-near],[-nw,nh,-near]];
			const f = [[-fw,-fh,-far],[fw,-fh,-far],[fw,fh,-far],[-fw,fh,-far]];
			const segs:number[][]=[];
			for(let i=0;i<4;i++){segs.push(n[i],n[(i+1)%4],f[i],f[(i+1)%4],n[i],f[i]);}
			const attr=lines.geometry.getAttribute("position") as THREE.BufferAttribute; let k=0;
			for(const point of segs){attr.setXYZ(k++,point[0],point[1],point[2]);} attr.needsUpdate=true; lines.geometry.computeBoundingSphere();
		};
		const ensureCameraHelpers = (state: VisualSceneState, timelineSeconds: number) => {
			if (!editorFreeRoam) return;
			requestFilmCamera();
			const valid = new Set(state.cameras.map(programCamera => programCamera.id));
			for (const [id, helper] of cameraHelpers) if (!valid.has(id)) { cameraHelperRoot.remove(helper.root); cameraHelperRoot.remove(helper.path); helper.frustum.geometry.dispose(); (helper.frustum.material as THREE.Material).dispose(); helper.forward.geometry.dispose(); (helper.forward.material as THREE.Material).dispose(); helper.target.geometry.dispose(); (helper.target.material as THREE.Material).dispose(); helper.path.geometry.dispose(); (helper.path.material as THREE.Material).dispose(); helper.materialCopies.forEach(material=>material.dispose()); cameraHelpers.delete(id); }
			for (const programCamera of state.cameras) {
				let helper = cameraHelpers.get(programCamera.id);
				if (!helper) {
					const root = new THREE.Group(); root.name = programCamera.name; root.userData.ysongSelectableId = programCamera.id;
					const fallback = makeFallbackCamera(); root.add(fallback);
					const frustum = createFrustum(); frustum.userData.ysongSelectableId = programCamera.id; root.add(frustum);
					const forwardGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0,0,-3)]);
					const forward = new THREE.Line(forwardGeometry, new THREE.LineBasicMaterial({color:0xfde68a,transparent:true,opacity:.8})); root.add(forward);
					const targetGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0,0,-3)]);
					const target = new THREE.Line(targetGeometry, new THREE.LineDashedMaterial({color:0xc084fc,transparent:true,opacity:.72,dashSize:.22,gapSize:.14})); root.add(target);
					const path = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({color:0x22d3ee,transparent:true,opacity:.52,depthTest:true})); path.renderOrder=880; path.visible=false; cameraHelperRoot.add(path);
					let model:THREE.Object3D|null=null; const materialCopies:THREE.Material[]=[];
					if (filmCameraTemplate) { const cloned=cloneCameraModel(filmCameraTemplate); model=cloned.model; materialCopies.push(...cloned.materials); fallback.visible=false; root.add(model); }
					root.traverse(child => { child.userData.ysongSelectableId = programCamera.id; });
					helper = { root, frustum, forward, target, path, pathSignature:"", fallback, model, materialCopies }; cameraHelpers.set(programCamera.id, helper); cameraHelperRoot.add(root);
				}
				const sampled=sampleVisualProgramCamera(programCamera,timelineSeconds);
				helper.root.visible = programCamera.enabled;
				helper.root.position.set(sampled.positionX, sampled.positionY, sampled.positionZ);
				let targetX=sampled.targetX,targetY=sampled.targetY,targetZ=sampled.targetZ;
				if(programCamera.targetMode==="performer"){targetX=performerRoot.position.x+sampled.targetOffsetX;targetY=performerRoot.position.y+sampled.targetOffsetY;targetZ=performerRoot.position.z+sampled.targetOffsetZ;}
				else if(programCamera.targetMode==="primitive"&&programCamera.targetEntityId){const targetRuntime=primitiveRuntime.get(programCamera.targetEntityId);if(targetRuntime){const point=new THREE.Vector3();targetRuntime.mesh.getWorldPosition(point);targetX=point.x+sampled.targetOffsetX;targetY=point.y+sampled.targetOffsetY;targetZ=point.z+sampled.targetOffsetZ;}}
				if (programCamera.aimMode === "rotation") helper.root.rotation.set(sampled.rotationX, sampled.rotationY, sampled.rotationZ);
				else { const proxy = new THREE.PerspectiveCamera(); proxy.position.copy(helper.root.position); proxy.lookAt(targetX,targetY,targetZ); helper.root.quaternion.copy(proxy.quaternion); }
				updateFrustumGeometry(helper.frustum, {...programCamera,fov:sampled.fov});
				helper.frustum.visible = programCamera.showFov;
				helper.forward.visible = programCamera.showForward;
				const forwardAttr=helper.forward.geometry.getAttribute("position") as THREE.BufferAttribute; forwardAttr.setXYZ(1,0,0,-programCamera.helperLength); forwardAttr.needsUpdate=true;
				helper.target.visible = programCamera.showTarget;
				helper.root.updateMatrixWorld(true);
				const targetLocal=helper.root.worldToLocal(new THREE.Vector3(targetX,targetY,targetZ));
				const targetAttr=helper.target.geometry.getAttribute("position") as THREE.BufferAttribute; targetAttr.setXYZ(1,targetLocal.x,targetLocal.y,targetLocal.z); targetAttr.needsUpdate=true; helper.target.computeLineDistances();
				const pathSignature=[programCamera.showPath,programCamera.pathInterpolation,programCamera.pathClosed,programCamera.loop,...programCamera.keyframes.map(k=>`${k.time}:${k.positionX}:${k.positionY}:${k.positionZ}:${k.easing||"inherit"}`)].join("|");
				if(pathSignature!==helper.pathSignature){helper.pathSignature=pathSignature;helper.path.geometry.dispose();const frames=[...programCamera.keyframes].sort((a,b)=>a.time-b.time);if(programCamera.showPath&&frames.length>1){const first=frames[0].time,last=frames[frames.length-1].time;const segments=Math.max(12,Math.min(160,(frames.length-1)*18));const points:THREE.Vector3[]=[];for(let i=0;i<=segments;i++){const t=THREE.MathUtils.lerp(first,last,i/segments);const sample=sampleVisualProgramCamera(programCamera,t);points.push(new THREE.Vector3(sample.positionX,sample.positionY,sample.positionZ));}helper.path.geometry=new THREE.BufferGeometry().setFromPoints(points);helper.path.visible=true;}else{helper.path.geometry=new THREE.BufferGeometry();helper.path.visible=false;}}
				helper.path.visible=programCamera.enabled&&programCamera.showPath&&programCamera.keyframes.length>1;
				const distance = camera.position.distanceTo(helper.root.position);
				const fade = programCamera.fadeModelWhenNear ? THREE.MathUtils.smoothstep(distance, 0.35, 1.8) : 1;
				const modelVisible = programCamera.showModel && fade > .01;
				helper.fallback.visible = !helper.model && modelVisible;
				if (helper.model) helper.model.visible = modelVisible;
				const allMaterials:THREE.Material[]=[...helper.materialCopies]; helper.fallback.traverse(child=>{if(child instanceof THREE.Mesh){const ms=Array.isArray(child.material)?child.material:[child.material];allMaterials.push(...ms)}});
				for(const material of allMaterials){ if("opacity" in material){ const m=material as THREE.Material & {opacity:number}; m.opacity=Math.max(.02,fade); material.transparent=true; material.depthWrite=fade>.35; } }
			}
		};
		const hoverBounds = new THREE.Box3Helper(new THREE.Box3(), 0xc084fc); hoverBounds.visible = false; hoverBounds.renderOrder = 1000; threeScene.add(hoverBounds);
		const raycaster = new THREE.Raycaster();
		const pointer = new THREE.Vector2();
		const selectableRoots = new Map<string, THREE.Object3D>();
		const resolveSelectable = (object: THREE.Object3D | null) => { let current = object; while (current) { const id = current.userData.ysongSelectableId as string | undefined; if (id) return id; current = current.parent; } return ""; };
		const onEditorHover = (event: MouseEvent) => {
			if (!editorFreeRoam || document.pointerLockElement === canvas) return;
			const rect = canvas.getBoundingClientRect(); pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1; pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
			raycaster.setFromCamera(pointer, camera);
			const hits = raycaster.intersectObjects([...selectableRoots.values(), ...cameraHelpers.values()].map(value => "root" in value ? value.root : value), true);
			// A fresh 3D project places Program Camera 1 at the same transform as the
			// editor camera. The editor was therefore raycasting *from inside its camera
			// helper*, treating every empty-space click as "select camera" and never
			// requesting pointer lock. Ignore camera helpers that are effectively sitting
			// on top of the editor camera so empty-space click can enter free roam.
			const selectableHit = hits.find(hit => {
				const id = resolveSelectable(hit.object);
				if (!id) return false;
				const helper = cameraHelpers.get(id);
				return !helper || camera.position.distanceTo(helper.root.position) > 1.05;
			});
			hoveredSelectableId = selectableHit ? resolveSelectable(selectableHit.object) : "";
			canvas.style.cursor = hoveredSelectableId ? "pointer" : "crosshair";
			const root = selectableRoots.get(hoveredSelectableId) || cameraHelpers.get(hoveredSelectableId)?.root;
			if (root) { hoverBounds.box.setFromObject(root); hoverBounds.visible = !hoverBounds.box.isEmpty(); } else hoverBounds.visible = false;
		};
		if (editorFreeRoam) canvas.addEventListener("mousemove", onEditorHover);

		const ambient = new THREE.HemisphereLight(0x8d9dff, 0x190d2a, 0.85);
		threeScene.add(ambient);
		const sun = new THREE.DirectionalLight(0x7f91ff, 0.65);
		sun.position.set(-3, 7, 4);
		sun.castShadow = true;
		sun.shadow.mapSize.set(1024,1024);
		sun.shadow.camera.near=.5; sun.shadow.camera.far=80; sun.shadow.camera.left=-18; sun.shadow.camera.right=18; sun.shadow.camera.top=18; sun.shadow.camera.bottom=-18;
		threeScene.add(sun);
		sun.target.position.set(0,0,0); threeScene.add(sun.target);
		const moon = new THREE.DirectionalLight(0xb9ccff, 0.35);
		moon.position.set(4,6,-5);
		moon.castShadow = false;
		moon.shadow.mapSize.set(1024,1024);
		moon.shadow.camera.near=.5; moon.shadow.camera.far=80; moon.shadow.camera.left=-18; moon.shadow.camera.right=18; moon.shadow.camera.top=18; moon.shadow.camera.bottom=-18;
		threeScene.add(moon);
		moon.target.position.set(0,0,0); threeScene.add(moon.target);
		let shadowMapSize=1024;
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

		const stageFog = new THREE.Fog(0x040613, 7, 26);
		threeScene.fog = stageFog;

		const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x07101f, metalness: 0.18, roughness: 0.78, transparent: true, opacity: 0.24 });
		const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), floorMaterial);
		floor.userData.ysongSelectableId = "stage";
		floor.rotation.x = -Math.PI / 2;
		floor.position.y = -3.16;
		floor.receiveShadow = true;
		threeScene.add(floor);

		const msaaRequested = runtimeQuality.antialiasMode === "msaa8" ? 8 : runtimeQuality.antialiasMode === "msaa4" ? 4 : runtimeQuality.antialiasMode === "msaa2" ? 2 : 0;
		const renderTarget = new THREE.WebGLRenderTarget(targetWidth, targetHeight, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat });
		if (msaaRequested > 0) renderTarget.samples = Math.min(msaaRequested, renderer.capabilities.maxSamples || msaaRequested);
		const composer = new EffectComposer(renderer, renderTarget);
		composer.setSize(targetWidth, targetHeight);
		const backgroundPass = new RenderPass(backgroundScene, backgroundCamera);
		const renderPass = new RenderPass(threeScene, camera);
		// Preserve the dedicated media pass, then clear only depth before drawing the 3D world.
		renderPass.clear = false;
		renderPass.clearDepth = true;
		// Phase 7: Post FX is a real ordered stack. Each module receives its own pass instance
		// so duplicate modules are deterministic and reorder exactly like the inspector shows.
		const depthTarget = new THREE.WebGLRenderTarget(targetWidth, targetHeight, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: false });
		const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide, blending: THREE.NoBlending });
		type PostRuntime = { module: VisualPostFxModule; type: VisualPostFxModuleType; pass: { enabled:boolean; dispose?:()=>void }; uniforms?: Record<string,{value:unknown}> };
		let postRuntimes: PostRuntime[] = [];
		let postStackSignature = "";
		let lutTexture: THREE.Data3DTexture | null = null;
		let lutLoadedUrl = "";
		let lutRequestedUrl = "";
		let lutFailedUrl = "";
		const lutCubeLoader=new LUTCubeLoader(); const lut3dlLoader=new LUT3dlLoader();
		let lastRendererWarning="";
		const reportRendererWarning=(stage:string,caught:unknown)=>{
			const detail=caught instanceof Error?caught.message:String(caught||"Unknown renderer error");
			const message=`Visual renderer fallback (${stage}): ${detail}`;
			if(message===lastRendererWarning)return;
			lastRendererWarning=message;
			channel.postMessage({type:"visual-output-error",timestamp:Date.now(),message} satisfies VisualOutputError);
		};

		const fxaaPass = new ShaderPass(FXAAShader);
		const fxaaResolution = (fxaaPass.material.uniforms.resolution.value as THREE.Vector2);
		fxaaResolution.set(1 / targetWidth, 1 / targetHeight);
		fxaaPass.enabled = runtimeQuality.antialiasMode === "fxaa";
		const smaaPass = new SMAAPass();
		smaaPass.enabled = runtimeQuality.antialiasMode === "smaa";

		const makePostRuntime = (module:VisualPostFxModule):PostRuntime => {
			if(module.type === "ambientOcclusion") { const pass=new GTAOPass(threeScene,camera,targetWidth,targetHeight); pass.enabled=module.enabled; return {module,type:module.type,pass}; }
			if(module.type === "depthOfField") { const pass=new ShaderPass(YSongDepthOfFieldShader); const uniforms=pass.uniforms as Record<string,{value:unknown}>; uniforms.tDepth.value=depthTarget.texture; (uniforms.resolution.value as THREE.Vector2).set(targetWidth,targetHeight); pass.enabled=false; return {module,type:module.type,pass,uniforms}; }
			if(module.type === "bloom") { const pass=new UnrealBloomPass(new THREE.Vector2(targetWidth,targetHeight),.85,.35,.72); pass.enabled=module.enabled; return {module,type:module.type,pass}; }
			if(module.type === "lightShafts") { const pass=new ShaderPass(YSongLightShaftShader); const uniforms=pass.uniforms as Record<string,{value:unknown}>; pass.enabled=false; return {module,type:module.type,pass,uniforms}; }
			if(module.type === "lut") { const pass=lutTexture?new LUTPass({lut:lutTexture,intensity:sceneRef.current.postFx.lutIntensity}):new LUTPass({intensity:sceneRef.current.postFx.lutIntensity}); pass.enabled=module.enabled&&!!lutTexture; return {module,type:module.type,pass}; }
			const pass=new ShaderPass(YSongStudioPostShader); const uniforms=pass.uniforms as Record<string,{value:unknown}>; (uniforms.resolution.value as THREE.Vector2).set(targetWidth,targetHeight); pass.enabled=false; return {module,type:module.type,pass,uniforms};
		};
		const rebuildPostStack = (stack:VisualPostFxModule[]) => {
			for(const runtime of postRuntimes) runtime.pass.dispose?.();
			postRuntimes=[];
			for(const module of stack){
				try{postRuntimes.push(makePostRuntime(module));}
				catch(caught){reportRendererWarning(`Post FX · ${module.name||module.type}`,caught);}
			}
			composer.passes.length=0; composer.addPass(backgroundPass); composer.addPass(renderPass);
			for(const runtime of postRuntimes) composer.addPass(runtime.pass as never);
			composer.addPass(fxaaPass); composer.addPass(smaaPass);
		};
		const assignLutTexture=()=>{for(const runtime of postRuntimes){if(runtime.type!=="lut")continue;const pass=runtime.pass as LUTPass;if(lutTexture)pass.lut=lutTexture;else{pass.material.uniforms.lut.value=null;pass.material.uniforms.lutSize.value=0;}pass.intensity=sceneRef.current.postFx.lutIntensity;pass.enabled=runtime.module.enabled&&!!lutTexture;}};
		const requestLut=(url:string,fileName:string)=>{
			if(!url){lutRequestedUrl="";lutLoadedUrl="";lutFailedUrl="";lutTexture?.dispose();lutTexture=null;assignLutTexture();return;}
			if(url===lutLoadedUrl||url===lutRequestedUrl||url===lutFailedUrl)return; lutRequestedUrl=url; const requested=url; const done=(result:{texture3D:THREE.Data3DTexture})=>{if(lutRequestedUrl!==requested){result.texture3D.dispose();return;}lutTexture?.dispose();lutTexture=result.texture3D;lutLoadedUrl=requested;lutFailedUrl="";lutRequestedUrl="";assignLutTexture();}; const fail=()=>{if(lutRequestedUrl===requested){lutRequestedUrl="";lutFailedUrl=requested;}};
			if(fileName.toLowerCase().endsWith(".3dl"))lut3dlLoader.load(url,done,undefined,fail);else lutCubeLoader.load(url,done,undefined,fail);
		};
		rebuildPostStack(sceneRef.current.postFx.stack);
		postStackSignature=sceneRef.current.postFx.stack.map((m:VisualPostFxModule)=>`${m.id}:${m.type}:${m.enabled?1:0}`).join("|");

		const renderCoreFallback=()=>{
			// Optional post-processing must never take down the authored scene/editor.
			renderer.setRenderTarget(null);
			renderer.autoClear=true;
			renderer.render(backgroundScene,backgroundCamera);
			renderer.autoClear=false;
			renderer.clearDepth();
			renderer.render(threeScene,camera);
			renderer.autoClear=true;
		};

		const resizeInternalRender = (requestedScale:number) => {
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
				const pass = runtime.pass as { setSize?:(width:number,height:number)=>void };
				pass.setSize?.(targetWidth, targetHeight);
			}
			return true;
		};
		let adaptiveLowStreak = 0;
		let adaptiveHighStreak = 0;

		const flareCanvas = document.createElement("canvas"); flareCanvas.width = 128; flareCanvas.height = 128;
		const flareCtx = flareCanvas.getContext("2d")!; const flareGradient = flareCtx.createRadialGradient(64,64,0,64,64,64);
		flareGradient.addColorStop(0,"rgba(255,255,255,1)"); flareGradient.addColorStop(0.12,"rgba(255,244,210,.9)"); flareGradient.addColorStop(0.42,"rgba(170,205,255,.24)"); flareGradient.addColorStop(1,"rgba(255,255,255,0)"); flareCtx.fillStyle=flareGradient; flareCtx.fillRect(0,0,128,128);
		const flareTexture = new THREE.CanvasTexture(flareCanvas);
		const flareMaterial = new THREE.SpriteMaterial({ map: flareTexture, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
		const lensFlareSprite = new THREE.Sprite(flareMaterial); lensFlareSprite.scale.set(3.6,3.6,1); lensFlareSprite.visible=false; threeScene.add(lensFlareSprite);

		const performerRoot = new THREE.Group();
		performerRoot.userData.ysongSelectableId = "object";
		selectableRoots.set("object", performerRoot);
		selectableRoots.set("stage", floor);
		threeScene.add(performerRoot);
		const mannequin = createMannequin(); performerRoot.add(mannequin.root);
		const crystal = createCrystal(); crystal.root.visible = false; performerRoot.add(crystal.root);
		const glb: GlbRuntime = { root: null, mixer: null, clips: [], activeAction: null, fileName: "", bones: [], boneBase: new Map(), materials: [], morphMeshes: [], materialBase: new Map(), loadingUrl: "", targets: {} };
		const gltfLoader = new GLTFLoader();
		const modelFbxLoader = new FBXLoader();
		const objLoader = new OBJLoader();

		const grid = new THREE.GridHelper(28, 28, 0x4c62d9, 0x21305d);
		grid.position.y = -3.15;
		const gridMaterials: THREE.Material[] = Array.isArray(grid.material) ? grid.material : [grid.material];
		for (const material of gridMaterials) { material.transparent = true; material.opacity = 0.32; }
		threeScene.add(grid);

		const particleRuntime = makeParticles();
		particleRuntime.points.userData.ysongSelectableId = "particles";
		selectableRoots.set("particles", particleRuntime.points);
		threeScene.add(particleRuntime.points);
		const particleTextureLoader = new THREE.TextureLoader(); particleTextureLoader.setCrossOrigin("anonymous");
		let particleTexture: THREE.Texture | null = null; let particleTextureUrl = "";
		const cloudCanvas = document.createElement("canvas"); cloudCanvas.width=128; cloudCanvas.height=128; const cloudCtx=cloudCanvas.getContext("2d")!;
		cloudCtx.clearRect(0,0,128,128); for (const [x,y,r,a] of [[44,65,38,.52],[76,58,42,.48],[63,78,44,.46],[87,78,28,.34],[34,82,26,.32]] as const) { const g=cloudCtx.createRadialGradient(x,y,0,x,y,r); g.addColorStop(0,`rgba(255,255,255,${a})`); g.addColorStop(.55,`rgba(255,255,255,${a*.55})`); g.addColorStop(1,"rgba(255,255,255,0)"); cloudCtx.fillStyle=g; cloudCtx.fillRect(x-r,y-r,r*2,r*2); }
		const cloudTexture = new THREE.CanvasTexture(cloudCanvas);
		const cloudMaterial = new THREE.SpriteMaterial({ map: cloudTexture, color: 0xffffff, transparent:true, opacity:.45, depthWrite:false });
		const cloudGroup = new THREE.Group(); cloudGroup.userData.ysongSelectableId="clouds"; selectableRoots.set("clouds",cloudGroup); threeScene.add(cloudGroup);
		const cloudSprites = Array.from({length:144},(_,i)=>{const sprite=new THREE.Sprite(cloudMaterial); sprite.userData.seedA=(Math.sin(i*91.17)*43758.5453)%1; sprite.userData.seedB=(Math.sin(i*47.31+2.1)*15731.743)%1; sprite.userData.seedC=(Math.sin(i*13.77+4.7)*951.135)%1; cloudGroup.add(sprite); return sprite;});
		const weatherRuntime=makeWeatherParticles(); weatherRuntime.points.userData.ysongSelectableId="weather"; selectableRoots.set("weather",weatherRuntime.points); threeScene.add(weatherRuntime.points);
		const weatherFog=new THREE.FogExp2(0xaab6c8,0.018);
		const weatherLightning=makeLightningLine(new THREE.Color(0xdcecff)); weatherLightning.name="YSong Weather Lightning"; threeScene.add(weatherLightning);
		const weatherFlashLight=new THREE.DirectionalLight(0xdcecff,0); weatherFlashLight.position.set(-4,12,2); threeScene.add(weatherFlashLight);
		const lightning = createLightningRuntime();
		threeScene.add(lightning.group);
		const shockwaveMaterial = new THREE.MeshBasicMaterial({ color: 0xd7ecff, transparent: true, opacity: 0, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
		const shockwave = new THREE.Mesh(new THREE.RingGeometry(0.13, 0.18, 64), shockwaveMaterial);
		shockwave.position.set(0, 0, -0.92);
		shockwave.renderOrder = 20;
		camera.add(shockwave);
		threeScene.add(camera);
		const performanceRuntime: PerformanceRuntime = { active: null, startedAt: 0, durationMs: 0, strength: 1, source: "idle", manualSequence: -1, manualInitialized: false, lastAutoAt: 0, recent: [], lastKick: 0, lastEnergy: 0, lastBass: 0, lastHighs: 0, lastBroadcastAt: 0, lastTransportPosition: 0 };
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
		let lastAnimation = "";
		let lastTransitionSequence = -1;

		const clearGlb = () => {
			if (glb.root) { performerRoot.remove(glb.root); disposeObject3D(glb.root); }
			glb.root = null; glb.mixer = null; glb.clips = []; glb.activeAction = null; glb.bones = []; glb.boneBase.clear(); glb.materials = []; glb.morphMeshes = []; glb.materialBase.clear(); glb.targets = {};
		};

		const finalizeLoadedModel = (root:THREE.Group, clips:THREE.AnimationClip[], url:string, fileName:string) => {
			if(disposed){disposeObject3D(root);return;}
			clearGlb();
			const box = new THREE.Box3().setFromObject(root); const size = new THREE.Vector3(); const center = new THREE.Vector3(); box.getSize(size); box.getCenter(center);
			const height = Math.max(0.001, size.y); const normalizeScale = 5.6 / height; root.scale.setScalar(normalizeScale); root.position.sub(center.multiplyScalar(normalizeScale)); root.position.y -= 0.25;
			const bones: THREE.Bone[] = []; const materials: THREE.MeshStandardMaterial[] = []; const morphMeshes:THREE.Mesh[]=[]; const morphNames=new Set<string>(); let meshes = 0;
			root.traverse((object: THREE.Object3D) => {
				if ((object as THREE.Bone).isBone) bones.push(object as THREE.Bone);
				const mesh = object as THREE.Mesh;
				if (mesh.isMesh) { meshes++; mesh.castShadow = true; mesh.receiveShadow = true; if(mesh.morphTargetDictionary&&mesh.morphTargetInfluences){morphMeshes.push(mesh);Object.keys(mesh.morphTargetDictionary).forEach(name=>morphNames.add(name));} const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]; for (const material of list) if ((material as THREE.MeshStandardMaterial)?.isMeshStandardMaterial) materials.push(material as THREE.MeshStandardMaterial); }
			});
			glb.root=root; glb.clips=clips; glb.mixer=clips.length?new THREE.AnimationMixer(root):null; glb.fileName=fileName; glb.bones=bones; glb.materials=materials; glb.morphMeshes=morphMeshes; glb.targets=discoverRigTargets(bones); glb.loadingUrl="";
			for(const material of materials)glb.materialBase.set(material,{color:material.color.clone(),metalness:material.metalness,roughness:material.roughness,emissive:material.emissive.clone(),emissiveIntensity:material.emissiveIntensity});
			for(const bone of bones)glb.boneBase.set(bone,{position:bone.position.clone(),quaternion:bone.quaternion.clone(),scale:bone.scale.clone()});
			performerRoot.add(root); lastGlbUrl=url; lastAnimation="";
			const animationClips=clips.map((clip,index)=>({name:clip.name||`Animation ${index+1}`,duration:Math.max(.001,clip.duration||0),tracks:clip.tracks.map(track=>{const suffix=track.name.split(".").pop()?.toLowerCase()||"";const property=suffix.includes("quaternion")?"quaternion":suffix.includes("position")?"position":suffix.includes("scale")?"scale":"other";return{name:track.name,property:property as "position"|"quaternion"|"scale"|"other",times:Array.from(track.times as ArrayLike<number>),values:Array.from(track.values as ArrayLike<number>),valueSize:track.getValueSize()};})}));
			const payload:VisualModelInfo={type:"visual-model-info",timestamp:Date.now(),fileName,bones:bones.map(b=>b.name||"Unnamed Bone"),animations:clips.map(clip=>clip.name||"Animation"),animationClips,morphTargets:[...morphNames].sort(),meshes}; channel.postMessage(payload);
		};

		const loadVisualModel = (url: string, fileName: string, format:VisualSceneState["object"]["modelFormat"]) => {
			if (!url || glb.loadingUrl === url || lastGlbUrl === url) return;
			glb.loadingUrl=url;
			const onError=(caught:unknown)=>{glb.loadingUrl="";const message=caught instanceof Error?caught.message:`Could not load ${fileName||"3D model"}.`;channel.postMessage({type:"visual-output-error",timestamp:Date.now(),message} satisfies VisualOutputError);};
			if(format==="fbx") { modelFbxLoader.load(url,object=>finalizeLoadedModel(object,object.animations||[],url,fileName),undefined,onError); return; }
			if(format==="obj") { objLoader.load(url,object=>finalizeLoadedModel(object,[],url,fileName),undefined,onError); return; }
			gltfLoader.load(url,(gltf:GLTF)=>finalizeLoadedModel(gltf.scene,gltf.animations||[],url,fileName),undefined,onError);
		};

		const applyGlbAnimation = (currentScene: VisualSceneState) => {
			if (!glb.mixer || !currentScene.object.animation || currentScene.object.animation === lastAnimation) return;
			const clip = glb.clips.find((candidate) => candidate.name === currentScene.object.animation);
			if (!clip) return;
			glb.activeAction?.fadeOut(0.18);
			const action = glb.mixer.clipAction(clip); action.reset(); action.timeScale = currentScene.object.animationSpeed; action.fadeIn(0.18); action.play();
			glb.activeAction = action; lastAnimation = currentScene.object.animation;
		};

		const resolveBoneForTarget=(currentScene:VisualSceneState,target:string)=>{
			if(target.startsWith("bone:")){const name=target.slice(5);return glb.bones.find(b=>b.name===name);}
			const slot=target as VisualHumanoidSlot; const manual=currentScene.object.humanoidMap[slot]; if(manual){const bone=glb.bones.find(b=>b.name===manual);if(bone)return bone;}
			const auto=autoHumanoidMap(glb.bones)[slot]; return auto?glb.bones.find(b=>b.name===auto):undefined;
		};
		const applyCustomSkeletalAnimations=(currentScene:VisualSceneState,positionSeconds:number,strength=1)=>{
			if(!glb.root||!glb.bones.length||!currentScene.animationCues.length)return;
			const activeClips=activeVisualAnimationClips(currentScene.animations,currentScene.animationCues,positionSeconds);
			for(const active of activeClips){
				const animation=active.animation; const cue=active.cue; const blend=Math.max(0,Math.min(1,active.weight*strength));
				if(blend<=.0001)continue;
				const targets=new Set(animation.keyframes.map(k=>k.target).filter(target=>animationLayerAllowsTarget(cue.layer,target)));
				for(const target of targets){
					const bone=resolveBoneForTarget(currentScene,target);if(!bone)continue;
					const base=glb.boneBase.get(bone);
					const rotation=sampleSkeletalTrack(animation,target,"rotation",active.localTime);
					if(rotation){
						const delta=new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(rotation.x),THREE.MathUtils.degToRad(rotation.y),THREE.MathUtils.degToRad(rotation.z),"XYZ"));
						if(cue.blendMode==="additive"){
							const weighted=new THREE.Quaternion().slerp(delta,blend); bone.quaternion.multiply(weighted);
						}else{
							const targetQuat=animation.source==="imported"?delta:(base?base.quaternion.clone().multiply(delta):delta); bone.quaternion.slerp(targetQuat,blend);
						}
					}
					const position=sampleSkeletalTrack(animation,target,"position",active.localTime);
					if(position){
						if(cue.blendMode==="additive")bone.position.add(new THREE.Vector3(position.x,position.y,position.z).multiplyScalar(blend));
						else {const targetPos=animation.source==="imported"?new THREE.Vector3(position.x,position.y,position.z):(base?base.position.clone().add(new THREE.Vector3(position.x,position.y,position.z)):new THREE.Vector3(position.x,position.y,position.z));bone.position.lerp(targetPos,blend);}
					}
					const scale=sampleSkeletalTrack(animation,target,"scale",active.localTime);
					if(scale){
						const sampled=new THREE.Vector3(Math.max(.01,scale.x),Math.max(.01,scale.y),Math.max(.01,scale.z));
						if(cue.blendMode==="additive")bone.scale.multiply(new THREE.Vector3(THREE.MathUtils.lerp(1,sampled.x,blend),THREE.MathUtils.lerp(1,sampled.y,blend),THREE.MathUtils.lerp(1,sampled.z,blend)));
						else {const targetScale=animation.source==="imported"?sampled:(base?base.scale.clone().multiply(sampled):sampled);bone.scale.lerp(targetScale,blend);}
					}
				}
			}
		};


		// Phase 4 scene-authoring runtime: parametric primitives, reusable PBR materials,
		// and Rapier rigid bodies. The primitive mesh is always the editor/render object;
		// in Simulate mode dynamic bodies drive its transform.
		const primitiveGroup=new THREE.Group(); primitiveGroup.name="YSong Primitives"; threeScene.add(primitiveGroup);
		type PrimitiveRuntime={mesh:THREE.Mesh;geometrySignature:string;materialId:string;body:RAPIER.RigidBody|null;bodySignature:string};
		const primitiveRuntime=new Map<string,PrimitiveRuntime>();
		const resolveIKTarget=(constraint:VisualIKConstraint)=>{
			const target=new THREE.Vector3(constraint.targetX,constraint.targetY,constraint.targetZ);
			if(constraint.targetMode==="camera")camera.getWorldPosition(target);
			else if(constraint.targetMode==="primitive"&&constraint.targetEntityId){const runtime=primitiveRuntime.get(constraint.targetEntityId);if(runtime)runtime.mesh.getWorldPosition(target);}
			return target.add(new THREE.Vector3(constraint.offsetX,constraint.offsetY,constraint.offsetZ));
		};
		const applyIKConstraints=(currentScene:VisualSceneState,positionSeconds:number,importedActive:boolean)=>{
			for(const constraint of currentScene.ikConstraints){
				if(!constraint.enabled)continue; const weight=sampleIKWeight(constraint,positionSeconds); if(weight<=.0001)continue; const target=resolveIKTarget(constraint);
				if(constraint.effector==="head"){const head=importedActive?resolveBoneForTarget(currentScene,"head"):mannequin.head;if(head)blendLookAt(head,target,weight);continue;}
				const left=constraint.effector==="leftHand";
				if(importedActive){
					const effector=resolveBoneForTarget(currentScene,left?"leftHand":"rightHand");
					const fore=resolveBoneForTarget(currentScene,left?"leftForeArm":"rightForeArm"); const upper=resolveBoneForTarget(currentScene,left?"leftUpperArm":"rightUpperArm"); const shoulder=resolveBoneForTarget(currentScene,left?"leftShoulder":"rightShoulder");
					if(effector)solveCcdIk(effector,[fore,upper,shoulder].filter((joint):joint is THREE.Bone=>!!joint),target,weight,constraint.iterations,constraint.maxAngleDegrees);
				}else{
					const effector=left?mannequin.leftHand:mannequin.rightHand; const joints=left?[mannequin.leftElbow,mannequin.leftShoulder]:[mannequin.rightElbow,mannequin.rightShoulder]; solveCcdIk(effector,joints,target,weight,constraint.iterations,constraint.maxAngleDegrees);
				}
			}
		};
		const materialRuntime=new Map<string,THREE.MeshPhysicalMaterial>();
		const materialTextureCache=new Map<string,THREE.Texture>();
		const materialEnvironmentCache=new Map<string,THREE.WebGLRenderTarget>();
		const materialTextureLoading=new Set<string>();
		const materialTextureLoader=new THREE.TextureLoader(); materialTextureLoader.setCrossOrigin("anonymous");
		const rgbeLoader=new RGBELoader(); rgbeLoader.setCrossOrigin("anonymous");
		const exrLoader=new EXRLoader(); exrLoader.setCrossOrigin("anonymous");
		const pmremGenerator=new THREE.PMREMGenerator(renderer); pmremGenerator.compileEquirectangularShader();
		const requestMaterialTexture=(url:string,color:boolean,assign:(texture:THREE.Texture)=>void)=>{
			if(!url)return;
			const cached=materialTextureCache.get(url); if(cached){assign(cached);return;}
			if(materialTextureLoading.has(url))return; materialTextureLoading.add(url);
			materialTextureLoader.load(url,texture=>{materialTextureLoading.delete(url);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=runtimeQuality.maxAnisotropy;if(color)texture.colorSpace=THREE.SRGBColorSpace;materialTextureCache.set(url,texture);assign(texture);},undefined,()=>materialTextureLoading.delete(url));
		};
		const requestEnvironmentTexture=(url:string,assign:(texture:THREE.Texture)=>void)=>{
			if(!url)return;
			const cached=materialEnvironmentCache.get(url); if(cached){assign(cached.texture);return;}
			const loadingKey=`env:${url}`;
			if(materialTextureLoading.has(loadingKey))return; materialTextureLoading.add(loadingKey);
			const done=(texture:THREE.Texture)=>{
				materialTextureLoading.delete(loadingKey);
				texture.mapping=THREE.EquirectangularReflectionMapping;
				const target=pmremGenerator.fromEquirectangular(texture);
				texture.dispose();
				materialEnvironmentCache.set(url,target);
				target.texture.userData.ysongUrl=url;
				assign(target.texture);
			};
			const fail=()=>materialTextureLoading.delete(loadingKey);
			let pathname=url.toLowerCase(); try{pathname=new URL(url,window.location.href).pathname.toLowerCase()}catch{/* keep raw URL */}
			if(pathname.endsWith(".hdr")){rgbeLoader.load(url,done,undefined,fail);return;}
			if(pathname.endsWith(".exr")){exrLoader.load(url,done,undefined,fail);return;}
			materialTextureLoader.load(url,texture=>{texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=runtimeQuality.maxAnisotropy;done(texture)},undefined,fail);
		};
		const getMaterial=(asset:VisualMaterialAsset, modulation?:VisualModulationFrame)=>{
			let material=materialRuntime.get(asset.id);
			if(!material){material=new THREE.MeshPhysicalMaterial();materialRuntime.set(asset.id,material);}
			const mm=(property:string,base:number,min=-Infinity,max=Infinity)=>modulation?modulationValue(modulation,`material:${asset.id}:${property}`,base,min,max):base;
			material.color.set(asset.baseColor);material.metalness=mm("metalness",asset.metalness,0,1);material.roughness=mm("roughness",asset.roughness,0,1);material.emissive.set(asset.emissiveColor);material.emissiveIntensity=mm("emissiveIntensity",asset.emissiveIntensity,0,30);
			material.opacity=mm("opacity",asset.opacity,0,1);material.transparent=asset.transparent||material.opacity<.999;material.side=asset.doubleSided?THREE.DoubleSide:THREE.FrontSide;material.normalScale.setScalar(asset.normalScale);material.bumpScale=asset.bumpScale;material.displacementScale=asset.displacementScale;
			material.envMapIntensity=mm("envMapIntensity",asset.envMapIntensity,0,20);material.clearcoat=mm("clearcoat",asset.clearcoat,0,1);material.clearcoatRoughness=asset.clearcoatRoughness;material.transmission=mm("transmission",asset.transmission,0,1);material.ior=asset.ior;
			const slots:[keyof VisualMaterialAsset, keyof THREE.MeshPhysicalMaterial, boolean][]=[
				["baseColorMap","map",true],["normalMap","normalMap",false],["bumpMap","bumpMap",false],["roughnessMap","roughnessMap",false],["metalnessMap","metalnessMap",false],["aoMap","aoMap",false],["emissiveMap","emissiveMap",true],["alphaMap","alphaMap",false],["displacementMap","displacementMap",false]
			];
			for(const [slotName,materialKey,color] of slots){const slot=asset[slotName] as {url:string};const current=(material as unknown as Record<string,unknown>)[materialKey as string] as THREE.Texture|null;if(slot?.url){if(current?.userData.ysongUrl!==slot.url)requestMaterialTexture(slot.url,color,texture=>{texture.userData.ysongUrl=slot.url;(material as unknown as Record<string,unknown>)[materialKey as string]=texture;material!.needsUpdate=true;});}else if(current){(material as unknown as Record<string,unknown>)[materialKey as string]=null;material.needsUpdate=true;}}
			const env=asset.envMap?.url||""; if(env){if(material.envMap?.userData.ysongUrl!==env)requestEnvironmentTexture(env,texture=>{material!.envMap=texture;material!.needsUpdate=true;});}else if(material.envMap){material.envMap=null;material.needsUpdate=true;}
			material.needsUpdate=true;return material;
		};

		const secondaryGroup=new THREE.Group(); secondaryGroup.name="YSong Secondary Physics"; threeScene.add(secondaryGroup);
		type SecondaryRuntime={
			group:THREE.Group; topology:SecondaryTopology; signature:string; material:THREE.MeshPhysicalMaterial;
			sheet:THREE.Mesh|null; segments:THREE.InstancedMesh|null; debugPoints:THREE.Points; debugLines:THREE.LineSegments;
			initialized:boolean; lastAudio:number;
		};
		const secondaryRuntime=new Map<string,SecondaryRuntime>();
		const secondaryMatrix=new THREE.Matrix4();
		const secondaryOffsetMatrix=new THREE.Matrix4();
		const secondaryTempObject=new THREE.Object3D();
		const secondaryUp=new THREE.Vector3(0,1,0);
		const mannequinSecondaryTarget=(target:string):THREE.Object3D|undefined=>{
			if(target==="root"||target==="hips")return mannequin.root;
			if(target==="spine")return mannequin.spine;
			if(target==="chest"||target==="neck")return mannequin.chest;
			if(target==="head")return mannequin.head;
			if(target==="leftShoulder"||target==="leftUpperArm")return mannequin.leftShoulder;
			if(target==="leftForeArm")return mannequin.leftElbow;
			if(target==="leftHand")return mannequin.leftHand;
			if(target==="rightShoulder"||target==="rightUpperArm")return mannequin.rightShoulder;
			if(target==="rightForeArm")return mannequin.rightElbow;
			if(target==="rightHand")return mannequin.rightHand;
			return mannequin.root;
		};
		const resolveSecondaryBone=(state:VisualSceneState,target:string,importedActive:boolean):THREE.Object3D|undefined=>importedActive?(resolveBoneForTarget(state,target)||glb.root||performerRoot):mannequinSecondaryTarget(target);
		const resolveSecondaryAnchorMatrix=(item:VisualSecondaryDynamic,state:VisualSceneState,importedActive:boolean,modulation:VisualModulationFrame)=>{
			const prefix=`secondary:${item.id}`;
			const ox=modulationValue(modulation,`${prefix}:offsetX`,item.offsetX,-100,100),oy=modulationValue(modulation,`${prefix}:offsetY`,item.offsetY,-100,100),oz=modulationValue(modulation,`${prefix}:offsetZ`,item.offsetZ,-100,100);
			secondaryMatrix.identity();
			if(item.anchorMode==="point")secondaryMatrix.makeTranslation(item.anchorX,item.anchorY,item.anchorZ);
			else if(item.anchorMode==="primitive"&&item.anchorEntityId){const runtime=primitiveRuntime.get(item.anchorEntityId);if(runtime){runtime.mesh.updateWorldMatrix(true,false);secondaryMatrix.copy(runtime.mesh.matrixWorld);}else secondaryMatrix.makeTranslation(item.anchorX,item.anchorY,item.anchorZ);}
			else {const anchor=resolveSecondaryBone(state,String(item.anchorBone),importedActive)||performerRoot;anchor.updateWorldMatrix(true,false);secondaryMatrix.copy(anchor.matrixWorld);}
			secondaryOffsetMatrix.makeTranslation(ox,oy,oz);secondaryMatrix.multiply(secondaryOffsetMatrix);return secondaryMatrix;
		};
		const disposeSecondaryRuntime=(runtime:SecondaryRuntime)=>{
			secondaryGroup.remove(runtime.group);selectableRoots.delete(runtime.group.userData.ysongSelectableId as string);
			runtime.sheet?.geometry.dispose();runtime.segments?.geometry.dispose();runtime.material.dispose();runtime.debugPoints.geometry.dispose();(runtime.debugPoints.material as THREE.Material).dispose();runtime.debugLines.geometry.dispose();(runtime.debugLines.material as THREE.Material).dispose();
		};
		const syncSecondaryMaterial=(runtime:SecondaryRuntime,item:VisualSecondaryDynamic,state:VisualSceneState,modulation:VisualModulationFrame,opacity:number)=>{
			const asset=item.materialId?state.materials.find(m=>m.id===item.materialId):undefined;
			if(asset){const source=getMaterial(asset,modulation);runtime.material.color.copy(source.color);runtime.material.metalness=source.metalness;runtime.material.roughness=source.roughness;runtime.material.emissive.copy(source.emissive);runtime.material.emissiveIntensity=source.emissiveIntensity;runtime.material.map=source.map;runtime.material.normalMap=source.normalMap;runtime.material.bumpMap=source.bumpMap;runtime.material.roughnessMap=source.roughnessMap;runtime.material.metalnessMap=source.metalnessMap;runtime.material.aoMap=source.aoMap;runtime.material.emissiveMap=source.emissiveMap;runtime.material.alphaMap=source.alphaMap;runtime.material.envMap=source.envMap;runtime.material.envMapIntensity=source.envMapIntensity;runtime.material.clearcoat=source.clearcoat;runtime.material.clearcoatRoughness=source.clearcoatRoughness;runtime.material.transmission=source.transmission;runtime.material.ior=source.ior;runtime.material.opacity=Math.max(0,Math.min(1,source.opacity*opacity));runtime.material.transparent=runtime.material.opacity<.999||source.transparent;}
			else{runtime.material.color.set(item.color);runtime.material.metalness=item.kind==="chain"?.72:.05;runtime.material.roughness=item.kind==="chain"?.34:.65;runtime.material.emissive.set(0x000000);runtime.material.emissiveIntensity=0;runtime.material.map=null;runtime.material.normalMap=null;runtime.material.bumpMap=null;runtime.material.roughnessMap=null;runtime.material.metalnessMap=null;runtime.material.aoMap=null;runtime.material.emissiveMap=null;runtime.material.alphaMap=null;runtime.material.envMap=null;runtime.material.envMapIntensity=1;runtime.material.clearcoat=0;runtime.material.clearcoatRoughness=0;runtime.material.transmission=0;runtime.material.ior=1.5;runtime.material.opacity=Math.max(0,Math.min(1,opacity));runtime.material.transparent=runtime.material.opacity<.999;}
			runtime.material.side=isSecondarySheet(item)?THREE.DoubleSide:THREE.FrontSide;runtime.material.needsUpdate=true;
		};
		const createSecondaryRuntime=(item:VisualSecondaryDynamic,layer:VisualLayer,state:VisualSceneState,modulation:VisualModulationFrame)=>{
			const topology=buildSecondaryTopology(item);const group=new THREE.Group();group.name=item.name;group.userData.ysongSelectableId=layer.id;secondaryGroup.add(group);selectableRoots.set(layer.id,group);
			const material=new THREE.MeshPhysicalMaterial({color:item.color,roughness:.65,metalness:item.kind==="chain"?.72:.05,side:THREE.DoubleSide});let sheet:THREE.Mesh|null=null;let segments:THREE.InstancedMesh|null=null;
			if(isSecondarySheet(item)){
				const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.BufferAttribute(new Float32Array(topology.positions.length*3),3));if(topology.uvs.length===topology.positions.length*2)geometry.setAttribute("uv",new THREE.BufferAttribute(new Float32Array(topology.uvs),2));geometry.setIndex(topology.triangles);geometry.computeVertexNormals();sheet=new THREE.Mesh(geometry,material);sheet.castShadow=true;sheet.receiveShadow=true;sheet.frustumCulled=false;group.add(sheet);
			}else if(item.kind!=="springBone"){
				const geometry=new THREE.CylinderGeometry(1,1,1,item.kind==="chain"?6:8,1,false);segments=new THREE.InstancedMesh(geometry,material,Math.max(1,topology.positions.length-1));segments.instanceMatrix.setUsage(THREE.DynamicDrawUsage);segments.castShadow=true;segments.receiveShadow=true;segments.frustumCulled=false;group.add(segments);
			}
			const debugGeometry=new THREE.BufferGeometry();debugGeometry.setAttribute("position",new THREE.BufferAttribute(new Float32Array(topology.positions.length*3),3));const debugPoints=new THREE.Points(debugGeometry,new THREE.PointsMaterial({size:.055,color:0x67e8f9,depthTest:false,transparent:true,opacity:.9}));debugPoints.renderOrder=50;group.add(debugPoints);
			const linePositions=new Float32Array(topology.constraints.length*2*3);const lineGeometry=new THREE.BufferGeometry();lineGeometry.setAttribute("position",new THREE.BufferAttribute(linePositions,3));const debugLines=new THREE.LineSegments(lineGeometry,new THREE.LineBasicMaterial({color:0xa78bfa,transparent:true,opacity:.42,depthTest:false}));debugLines.renderOrder=49;group.add(debugLines);
			const runtime:SecondaryRuntime={group,topology,signature:secondaryTopologySignature(item),material,sheet,segments,debugPoints,debugLines,initialized:false,lastAudio:0};syncSecondaryMaterial(runtime,item,state,modulation,layer.opacity);secondaryRuntime.set(item.id,runtime);return runtime;
		};
		const resetSecondaryRuntime=(runtime:SecondaryRuntime,item:VisualSecondaryDynamic,state:VisualSceneState,importedActive:boolean,modulation:VisualModulationFrame)=>{
			const matrix=resolveSecondaryAnchorMatrix(item,state,importedActive,modulation);for(let i=0;i<runtime.topology.restLocal.length;i++){const world=runtime.topology.restLocal[i].clone().applyMatrix4(matrix);runtime.topology.positions[i].copy(world);runtime.topology.previous[i].copy(world);}runtime.initialized=true;runtime.lastAudio=0;
		};
		const pushOutSphere=(point:THREE.Vector3,center:THREE.Vector3,radius:number)=>{let dx=point.x-center.x,dy=point.y-center.y,dz=point.z-center.z;const d2=dx*dx+dy*dy+dz*dz;if(d2>=radius*radius)return;if(d2<1e-9){dx=0;dy=1;dz=0;}else{const inv=1/Math.sqrt(d2);dx*=inv;dy*=inv;dz*=inv;}point.set(center.x+dx*radius,center.y+dy*radius,center.z+dz*radius);};
		type SecondaryPrimitiveCollider={id:string;box:THREE.Box3};
		const collideSecondaryPoint=(point:THREE.Vector3,item:VisualSecondaryDynamic,state:VisualSceneState,performerCenters:{center:THREE.Vector3;radius:number}[],primitiveColliders:SecondaryPrimitiveCollider[])=>{
			const r=Math.max(.001,item.collisionRadius);
			if(item.collideGround&&state.physics.groundEnabled&&point.y<state.physics.groundY+r)point.y=state.physics.groundY+r;
			if(item.collidePerformer)for(const collider of performerCenters)pushOutSphere(point,collider.center,collider.radius+r);
			if(item.collidePrimitives){
				for(const collider of primitiveColliders){if(item.anchorMode==="primitive"&&collider.id===item.anchorEntityId)continue;const box=collider.box;const minX=box.min.x-r,maxX=box.max.x+r,minY=box.min.y-r,maxY=box.max.y+r,minZ=box.min.z-r,maxZ=box.max.z+r;if(point.x<minX||point.x>maxX||point.y<minY||point.y>maxY||point.z<minZ||point.z>maxZ)continue;const distances=[Math.abs(point.x-minX),Math.abs(maxX-point.x),Math.abs(point.y-minY),Math.abs(maxY-point.y),Math.abs(point.z-minZ),Math.abs(maxZ-point.z)];let axis=0;for(let i=1;i<6;i++)if(distances[i]<distances[axis])axis=i;if(axis===0)point.x=minX;else if(axis===1)point.x=maxX;else if(axis===2)point.y=minY;else if(axis===3)point.y=maxY;else if(axis===4)point.z=minZ;else point.z=maxZ;}
			}
		};
		const solveSelfCollision=(topology:SecondaryTopology,radius:number,pinned:Set<number>)=>{
			if(radius<=.001)return;const cell=Math.max(.002,radius*2),target=radius*2;const grid=new Map<string,number[]>();const key=(p:THREE.Vector3)=>`${Math.floor(p.x/cell)},${Math.floor(p.y/cell)},${Math.floor(p.z/cell)}`;
			for(let i=0;i<topology.positions.length;i++){const p=topology.positions[i];const gx=Math.floor(p.x/cell),gy=Math.floor(p.y/cell),gz=Math.floor(p.z/cell);for(let x=gx-1;x<=gx+1;x++)for(let y=gy-1;y<=gy+1;y++)for(let z=gz-1;z<=gz+1;z++){const bucket=grid.get(`${x},${y},${z}`);if(!bucket)continue;for(const j of bucket){if(Math.abs(i-j)<=1)continue;const q=topology.positions[j];let dx=p.x-q.x,dy=p.y-q.y,dz=p.z-q.z;const d2=dx*dx+dy*dy+dz*dz;if(d2>=target*target||d2<1e-12)continue;const d=Math.sqrt(d2),scale=(target-d)/d;dx*=scale;dy*=scale;dz*=scale;const ip=pinned.has(i),jp=pinned.has(j);if(!ip&&!jp){p.x+=dx*.5;p.y+=dy*.5;p.z+=dz*.5;q.x-=dx*.5;q.y-=dy*.5;q.z-=dz*.5;}else if(!ip){p.x+=dx;p.y+=dy;p.z+=dz;}else if(!jp){q.x-=dx;q.y-=dy;q.z-=dz;}}}const k=key(p);const own=grid.get(k)||[];own.push(i);grid.set(k,own);}
		};
		const updateSecondaryGeometry=(runtime:SecondaryRuntime,item:VisualSecondaryDynamic,state:VisualSceneState,layer:VisualLayer,modulation:VisualModulationFrame,positionSeconds:number)=>{
			const positions=runtime.topology.positions;syncSecondaryMaterial(runtime,item,state,modulation,visualLayerOpacityAt(layer,positionSeconds));
			if(runtime.sheet){const attr=runtime.sheet.geometry.getAttribute("position") as THREE.BufferAttribute;for(let i=0;i<positions.length;i++){attr.setXYZ(i,positions[i].x,positions[i].y,positions[i].z);}attr.needsUpdate=true;runtime.sheet.geometry.computeVertexNormals();}
			if(runtime.segments){for(let i=0;i<positions.length-1;i++){const a=positions[i],b=positions[i+1];const dir=b.clone().sub(a);const length=Math.max(.001,dir.length());const taper=item.kind==="tentacle"?Math.max(.22,1-i/Math.max(1,positions.length-1)*.72):item.kind==="hair"?Math.max(.35,1-i/Math.max(1,positions.length-1)*.55):1;secondaryTempObject.position.copy(a).add(b).multiplyScalar(.5);secondaryTempObject.quaternion.setFromUnitVectors(secondaryUp,dir.normalize());secondaryTempObject.scale.set(item.radius*taper,length,item.radius*taper);secondaryTempObject.updateMatrix();runtime.segments.setMatrixAt(i,secondaryTempObject.matrix);}runtime.segments.instanceMatrix.needsUpdate=true;}
			const debugAttr=runtime.debugPoints.geometry.getAttribute("position") as THREE.BufferAttribute;for(let i=0;i<positions.length;i++)debugAttr.setXYZ(i,positions[i].x,positions[i].y,positions[i].z);debugAttr.needsUpdate=true;
			const lineAttr=runtime.debugLines.geometry.getAttribute("position") as THREE.BufferAttribute;for(let i=0;i<runtime.topology.constraints.length;i++){const c=runtime.topology.constraints[i],a=positions[c.a],b=positions[c.b];lineAttr.setXYZ(i*2,a.x,a.y,a.z);lineAttr.setXYZ(i*2+1,b.x,b.y,b.z);}lineAttr.needsUpdate=true;runtime.debugPoints.visible=state.physics.secondaryDebug;runtime.debugLines.visible=state.physics.secondaryDebug;
		};
		const applySpringBone=(runtime:SecondaryRuntime,item:VisualSecondaryDynamic,state:VisualSceneState,importedActive:boolean,modulation:VisualModulationFrame)=>{
			if(item.kind!=="springBone"||runtime.topology.positions.length<2)return;const bone=resolveSecondaryBone(state,String(item.targetBone),importedActive);if(!bone||!bone.parent)return;bone.updateWorldMatrix(true,false);const desired=runtime.topology.positions[1].clone().sub(runtime.topology.positions[0]);if(desired.lengthSq()<1e-8)return;desired.normalize();const currentWorldQuat=new THREE.Quaternion();bone.getWorldQuaternion(currentWorldQuat);const localRest=new THREE.Vector3(item.restDirectionX,item.restDirectionY,item.restDirectionZ);if(localRest.lengthSq()<1e-8)localRest.set(0,1,0);localRest.normalize();const currentDir=localRest.clone().applyQuaternion(currentWorldQuat).normalize();const deltaWorld=new THREE.Quaternion().setFromUnitVectors(currentDir,desired);const desiredWorld=deltaWorld.multiply(currentWorldQuat);const parentWorld=new THREE.Quaternion();bone.parent.getWorldQuaternion(parentWorld);const desiredLocal=parentWorld.invert().multiply(desiredWorld);const influence=modulationValue(modulation,`secondary:${item.id}:boneInfluence`,item.boneInfluence,0,1);bone.quaternion.slerp(desiredLocal,influence);bone.updateMatrixWorld(true);
		};
		let lastSecondaryReset=-1,lastSecondaryTransport=0;
		const updateSecondaryDynamics=(state:VisualSceneState,positionSeconds:number,dt:number,modulation:VisualModulationFrame,importedActive:boolean,worldWindX:number,worldWindZ:number,windTurbulence:number)=>{
			const liveIds=new Set(state.secondaryDynamics.map(item=>item.id));for(const [id,runtime] of secondaryRuntime)if(!liveIds.has(id)){disposeSecondaryRuntime(runtime);secondaryRuntime.delete(id);}
			const seekReset=state.physics.resetSecondaryOnSeek&&(positionSeconds<lastSecondaryTransport-.05||Math.abs(positionSeconds-lastSecondaryTransport)>.75);const globalReset=state.physics.resetSequence!==lastSecondaryReset;lastSecondaryTransport=positionSeconds;if(globalReset)lastSecondaryReset=state.physics.resetSequence;
			const imported=importedActive;
			const performerCollisionActive=imported?!!glb.root?.visible:mannequin.root.visible;
			const performerCenters:{center:THREE.Vector3;radius:number}[]=[];const addCenter=(object:THREE.Object3D|undefined,radius:number)=>{if(!object)return;const center=new THREE.Vector3();object.getWorldPosition(center);performerCenters.push({center,radius});};if(performerCollisionActive){addCenter(resolveSecondaryBone(state,"head",imported),.48);addCenter(resolveSecondaryBone(state,"chest",imported),.68);addCenter(resolveSecondaryBone(state,"hips",imported),.58);}
			const primitiveColliders:SecondaryPrimitiveCollider[]=[];for(const primitive of state.primitives){const runtime=primitiveRuntime.get(primitive.id);if(!runtime?.mesh.visible)continue;runtime.mesh.updateWorldMatrix(true,false);primitiveColliders.push({id:primitive.id,box:new THREE.Box3().setFromObject(runtime.mesh)});}
			for(const item of state.secondaryDynamics){const layer=state.layers.find(l=>l.type==="secondary"&&l.entityId===item.id);if(!layer)continue;let runtime=secondaryRuntime.get(item.id);const sig=secondaryTopologySignature(item);if(!runtime||runtime.signature!==sig){if(runtime)disposeSecondaryRuntime(runtime);runtime=createSecondaryRuntime(item,layer,state,modulation);}runtime.group.userData.ysongSelectableId=layer.id;const active=state.project.mode!=="2d"&&item.enabled&&visualLayerActive(layer,positionSeconds);runtime.group.visible=active&&(item.kind!=="springBone"||state.physics.secondaryDebug);if(!active){runtime.initialized=false;continue;}if(!runtime.initialized||globalReset||seekReset||state.physics.mode==="edit"||!state.physics.enabled||!state.physics.secondaryEnabled)resetSecondaryRuntime(runtime,item,state,imported,modulation);
				const topology=runtime.topology;const anchorMatrix=resolveSecondaryAnchorMatrix(item,state,imported,modulation);const pinned=new Set(topology.pinned);for(const index of topology.pinned){const pinnedWorld=topology.restLocal[index].clone().applyMatrix4(anchorMatrix);topology.positions[index].copy(pinnedWorld);topology.previous[index].copy(pinnedWorld);}
				if(state.physics.enabled&&state.physics.secondaryEnabled&&state.physics.mode==="simulate"){
					const prefix=`secondary:${item.id}`;const stiffness=modulationValue(modulation,`${prefix}:stiffness`,item.stiffness,0,1),bendStiffness=modulationValue(modulation,`${prefix}:bendStiffness`,item.bendStiffness,0,1),gravityScale=modulationValue(modulation,`${prefix}:gravityScale`,item.gravityScale,-5,5),windInfluence=modulationValue(modulation,`${prefix}:windInfluence`,item.windInfluence,0,12),drag=modulationValue(modulation,`${prefix}:drag`,item.drag,0,6),audioAmount=modulationValue(modulation,`${prefix}:audioImpulse`,item.audioImpulse,-20,20);const source=Math.max(0,Math.min(1,modulation.sources[item.audioSource]??0));const transient=Math.max(0,source-runtime.lastAudio);runtime.lastAudio=source;const musicStrength=audioAmount*(transient*5+source*.08);const musicDir=new THREE.Vector3(item.audioDirectionX,item.audioDirectionY,item.audioDirectionZ);if(musicDir.lengthSq()>1e-6)musicDir.normalize();const substeps=Math.max(1,Math.min(state.physics.secondarySubsteps,runtimeQuality.secondarySubsteps));const qualityIterations=Math.max(1,Math.min(state.physics.secondaryIterations,runtimeQuality.secondaryIterations));const subDt=Math.max(1/240,Math.min(1/30,dt/substeps));
					for(let sub=0;sub<substeps;sub++){
						const damping=Math.pow(Math.max(.5,Math.min(.9999,item.damping)),subDt*60)*Math.exp(-drag*subDt*.35);for(let i=0;i<topology.positions.length;i++){if(pinned.has(i))continue;const p=topology.positions[i],prev=topology.previous[i];const vx=(p.x-prev.x)*damping,vy=(p.y-prev.y)*damping,vz=(p.z-prev.z)*damping;prev.copy(p);const flutter=Math.sin(positionSeconds*3.1+i*1.731)+Math.cos(positionSeconds*1.7+i*.417);const ax=worldWindX*windInfluence*(1+flutter*.025*windTurbulence)+musicDir.x*musicStrength*18;const ay=state.physics.gravityY*gravityScale+musicDir.y*musicStrength*18;const az=worldWindZ*windInfluence*(1+flutter*.025*windTurbulence)+musicDir.z*musicStrength*18;p.x+=vx+ax*subDt*subDt;p.y+=vy+ay*subDt*subDt;p.z+=vz+az*subDt*subDt;}
						for(let iteration=0;iteration<qualityIterations;iteration++){
							for(const c of topology.constraints){const a=topology.positions[c.a],b=topology.positions[c.b];let dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z;const dist=Math.sqrt(dx*dx+dy*dy+dz*dz);if(dist<1e-7)continue;const effective=c.role==="bend"?bendStiffness:stiffness;const strength=1-Math.pow(1-Math.max(0,Math.min(1,effective)),1/qualityIterations);const scale=((dist-c.rest)/dist)*strength;dx*=scale;dy*=scale;dz*=scale;const ap=pinned.has(c.a),bp=pinned.has(c.b);if(!ap&&!bp){a.x+=dx*.5;a.y+=dy*.5;a.z+=dz*.5;b.x-=dx*.5;b.y-=dy*.5;b.z-=dz*.5;}else if(!ap){a.x+=dx;a.y+=dy;a.z+=dz;}else if(!bp){b.x-=dx;b.y-=dy;b.z-=dz;}}
							for(let i=0;i<topology.positions.length;i++)if(!pinned.has(i))collideSecondaryPoint(topology.positions[i],item,state,performerCenters,primitiveColliders);if(item.selfCollision)solveSelfCollision(topology,Math.max(item.collisionRadius,item.radius*.55),pinned);for(const index of topology.pinned){const world=topology.restLocal[index].clone().applyMatrix4(anchorMatrix);topology.positions[index].copy(world);topology.previous[index].copy(world);}
						}
					}
				}
				applySpringBone(runtime,item,state,imported,modulation);updateSecondaryGeometry(runtime,item,state,layer,modulation,positionSeconds);
			}
		};
		const primitiveGeometrySignature=(p:VisualPrimitiveObject)=>[p.primitive,p.sizeX,p.sizeY,p.sizeZ,p.radius,p.height,p.segments,p.tubeRadius].join("|");
		const primitiveBodySignature=(p:VisualPrimitiveObject)=>[p.physics.bodyType,p.physics.collider,p.sizeX,p.sizeY,p.sizeZ,p.radius,p.height,p.physics.mass,p.physics.friction,p.physics.restitution,p.physics.linearDamping,p.physics.angularDamping,p.physics.gravityScale].join("|");

		let physicsWorld:RAPIER.World|null=null; let physicsGround:RAPIER.RigidBody|null=null; let physicsGroundSignature=""; let leftHandBody:RAPIER.RigidBody|null=null; let rightHandBody:RAPIER.RigidBody|null=null; let lastPhysicsReset=-1;
		void RAPIER.init().then(()=>{if(disposed)return;physicsWorld=new RAPIER.World({x:0,y:-9.81,z:0});}).catch(()=>{channel.postMessage({type:"visual-output-error",timestamp:Date.now(),message:"Rapier physics could not initialize; visual rendering will continue without simulation."} satisfies VisualOutputError);});
		const removePhysicsBody=(runtime:PrimitiveRuntime)=>{if(physicsWorld&&runtime.body){physicsWorld.removeRigidBody(runtime.body);runtime.body=null;}};
		const rigidBodyDescFor=(p:VisualPrimitiveObject)=>p.physics.bodyType==="dynamic"?RAPIER.RigidBodyDesc.dynamic():p.physics.bodyType==="kinematic"?RAPIER.RigidBodyDesc.kinematicPositionBased():RAPIER.RigidBodyDesc.fixed();
		const colliderDescFor=(p:VisualPrimitiveObject)=>{
			const sx=Math.max(.01,p.sizeX*p.scaleX),sy=Math.max(.01,p.sizeY*p.scaleY),sz=Math.max(.01,p.sizeZ*p.scaleZ),r=Math.max(.01,p.radius*Math.max(p.scaleX,p.scaleZ)),h=Math.max(.01,p.height*p.scaleY);
			const kind=p.physics.collider==="auto"?(p.primitive==="sphere"||p.primitive==="icosphere"?"sphere":p.primitive==="capsule"?"capsule":p.primitive==="cylinder"||p.primitive==="cone"?"cylinder":"box"):p.physics.collider;
			if(kind==="sphere")return RAPIER.ColliderDesc.ball(r);
			if(kind==="capsule")return RAPIER.ColliderDesc.capsule(Math.max(.01,h*.5-r),r);
			if(kind==="cylinder")return RAPIER.ColliderDesc.cylinder(h*.5,r);
			// Convex-hull is intentionally conservative for parametric primitives; a box proxy
			// is deterministic and fast. Imported-mesh convex hull generation comes later.
			return RAPIER.ColliderDesc.cuboid(sx*.5,sy*.5,sz*.5);
		};
		const createPhysicsBody=(p:VisualPrimitiveObject,runtime:PrimitiveRuntime)=>{
			if(!physicsWorld)return;
			removePhysicsBody(runtime);
			const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rotationX,p.rotationY,p.rotationZ));
			const desc=rigidBodyDescFor(p).setTranslation(p.positionX,p.positionY,p.positionZ).setRotation({x:q.x,y:q.y,z:q.z,w:q.w}).setLinearDamping(p.physics.linearDamping).setAngularDamping(p.physics.angularDamping).setGravityScale(p.physics.gravityScale);
			const body=physicsWorld.createRigidBody(desc); const colliderDesc=colliderDescFor(p).setFriction(p.physics.friction).setRestitution(p.physics.restitution).setMass(Math.max(.001,p.physics.mass));physicsWorld.createCollider(colliderDesc,body);runtime.body=body;runtime.bodySignature=primitiveBodySignature(p);
		};
		const ensureGround=(state:VisualSceneState)=>{
			if(!physicsWorld)return;const signature=`${state.physics.groundEnabled}|${state.physics.groundY}`;if(signature===physicsGroundSignature)return;physicsGroundSignature=signature;if(physicsGround){physicsWorld.removeRigidBody(physicsGround);physicsGround=null;}if(!state.physics.groundEnabled)return;physicsGround=physicsWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0,state.physics.groundY-.1,0));physicsWorld.createCollider(RAPIER.ColliderDesc.cuboid(100,.1,100).setFriction(.8),physicsGround);
		};
		const ensureHandBodies=()=>{if(!physicsWorld)return;if(!leftHandBody){leftHandBody=physicsWorld.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());physicsWorld.createCollider(RAPIER.ColliderDesc.ball(.22).setFriction(.7).setRestitution(.05),leftHandBody);}if(!rightHandBody){rightHandBody=physicsWorld.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());physicsWorld.createCollider(RAPIER.ColliderDesc.ball(.22).setFriction(.7).setRestitution(.05),rightHandBody);}};
		const ensurePrimitives=(state:VisualSceneState,positionSeconds:number,modulation:VisualModulationFrame)=>{
			const ids=new Set(state.primitives.map(p=>p.id));for(const [id,runtime] of primitiveRuntime)if(!ids.has(id)){primitiveGroup.remove(runtime.mesh);selectableRoots.delete(`layer-${id}`);removePhysicsBody(runtime);runtime.mesh.geometry.dispose();primitiveRuntime.delete(id);}
			for(const p of state.primitives){const layer=state.layers.find(l=>l.type==="primitive"&&l.entityId===p.id);if(!layer)continue;let runtime=primitiveRuntime.get(p.id);const geometrySignature=primitiveGeometrySignature(p);const materialAsset=state.materials.find(m=>m.id===p.materialId)||state.materials[0];if(!materialAsset)continue;
				if(!runtime){const mesh=new THREE.Mesh(makePrimitiveGeometry(p),getMaterial(materialAsset,modulation));mesh.userData.ysongSelectableId=layer.id;mesh.castShadow=true;mesh.receiveShadow=true;primitiveGroup.add(mesh);selectableRoots.set(layer.id,mesh);runtime={mesh,geometrySignature,materialId:p.materialId,body:null,bodySignature:""};primitiveRuntime.set(p.id,runtime);}else{if(runtime.geometrySignature!==geometrySignature){runtime.mesh.geometry.dispose();runtime.mesh.geometry=makePrimitiveGeometry(p);runtime.geometrySignature=geometrySignature;}if(runtime.materialId!==p.materialId){runtime.mesh.material=getMaterial(materialAsset,modulation);runtime.materialId=p.materialId;}else{runtime.mesh.material=getMaterial(materialAsset,modulation);}}
				const pp=`primitive:${p.id}`; const px=modulationValue(modulation,`${pp}:positionX`,p.positionX,-10000,10000),py=modulationValue(modulation,`${pp}:positionY`,p.positionY,-10000,10000),pz=modulationValue(modulation,`${pp}:positionZ`,p.positionZ,-10000,10000); const rx=modulationValue(modulation,`${pp}:rotationX`,p.rotationX,-Math.PI*20,Math.PI*20),ry=modulationValue(modulation,`${pp}:rotationY`,p.rotationY,-Math.PI*20,Math.PI*20),rz=modulationValue(modulation,`${pp}:rotationZ`,p.rotationZ,-Math.PI*20,Math.PI*20); const sx=modulationValue(modulation,`${pp}:scaleX`,p.scaleX,.001,100),sy=modulationValue(modulation,`${pp}:scaleY`,p.scaleY,.001,100),sz=modulationValue(modulation,`${pp}:scaleZ`,p.scaleZ,.001,100);
				runtime.mesh.visible=state.project.mode!=="2d"&&p.visible&&visualLayerActive(layer,positionSeconds);runtime.mesh.scale.set(sx,sy,sz);
				if(physicsWorld&&runtime.bodySignature!==primitiveBodySignature(p))createPhysicsBody(p,runtime);
				const authoredRotation=new THREE.Euler(rx,ry,rz);const authoredQuaternion=new THREE.Quaternion().setFromEuler(authoredRotation);
				if(!physicsWorld||!runtime.body||state.physics.mode==="edit"||!state.physics.enabled||p.physics.bodyType==="static"){runtime.mesh.position.set(px,py,pz);runtime.mesh.rotation.copy(authoredRotation);if(runtime.body){runtime.body.setTranslation({x:px,y:py,z:pz},true);runtime.body.setRotation({x:authoredQuaternion.x,y:authoredQuaternion.y,z:authoredQuaternion.z,w:authoredQuaternion.w},true);runtime.body.setLinvel({x:0,y:0,z:0},true);runtime.body.setAngvel({x:0,y:0,z:0},true);}}
				else if(p.physics.bodyType==="kinematic"){runtime.mesh.position.set(px,py,pz);runtime.mesh.rotation.copy(authoredRotation);runtime.body.setNextKinematicTranslation({x:px,y:py,z:pz});runtime.body.setNextKinematicRotation({x:authoredQuaternion.x,y:authoredQuaternion.y,z:authoredQuaternion.z,w:authoredQuaternion.w});}
			}
		};

		const modulationRuntime = new Map<string, number>();
		let lastOverlayModulationAt = 0;

		const render = (now: number) => {
			if (disposed) return;
			animationFrame = requestAnimationFrame(render);
			const sinceLast = now - lastRenderAt;
			if (lastRenderAt && sinceLast < FRAME_INTERVAL_MS - 0.35) return;
			lastRenderAt = now - (sinceLast % FRAME_INTERVAL_MS);
			const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000)); lastTime = now;
			const currentScene = sceneRef.current;
			const nextPostSignature=currentScene.postFx.stack.map((m:VisualPostFxModule)=>`${m.id}:${m.type}:${m.enabled?1:0}`).join("|");
			if(nextPostSignature!==postStackSignature){ postStackSignature=nextPostSignature; rebuildPostStack(currentScene.postFx.stack); assignLutTexture(); }
			if(currentScene.postFx.lutUrl!==lutLoadedUrl&&currentScene.postFx.lutUrl!==lutRequestedUrl)requestLut(currentScene.postFx.lutUrl,currentScene.postFx.lutFileName);
			const currentAudio = audioRef.current;
			const currentTransport = transportRef.current;
			const currentTransportPosition = extrapolatedTransportPosition(currentTransport);
			for (const [effectId, pulse] of roomEffectPulsesRef.current) if (now >= pulse.until) roomEffectPulsesRef.current.delete(effectId);
			const roomCameraShake = roomEffectStrength(roomEffectPulsesRef.current, "camera-shake", now);
			const roomLightning = roomEffectStrength(roomEffectPulsesRef.current, "lightning", now);
			const roomStrobe = roomEffectStrength(roomEffectPulsesRef.current, "strobe", now);
			const modulation = evaluateVisualAudioModulation(currentScene, currentAudio, currentTransport, currentTransportPosition, dt, modulationRuntime);
			const mv = (target: string, base: number, min = -Infinity, max = Infinity) => modulationValue(modulation, target, base, min, max);
			const windEnabled=currentScene.wind.enabled;
			const windStrength=windEnabled?mv("wind.strength",currentScene.wind.strength,0,30):0;
			const windDirectionX=mv("wind.directionX",currentScene.wind.directionX,-20,20);
			const windDirectionZ=mv("wind.directionZ",currentScene.wind.directionZ,-20,20);
			const windLength=Math.max(.0001,Math.hypot(windDirectionX,windDirectionZ));
			const windGustiness=mv("wind.gustiness",currentScene.wind.gustiness,0,2);
			const windTurbulence=mv("wind.turbulence",currentScene.wind.turbulence,0,4);
			const windClock=now/1000;
			const gustWave=(Math.sin(windClock*.73)+Math.sin(windClock*1.91+1.7)*.5+Math.sin(windClock*.23+4.1)*.25)/1.75;
			const gustMultiplier=Math.max(.05,1+gustWave*windGustiness);
			const worldWindX=windDirectionX/windLength*windStrength*gustMultiplier;
			const worldWindZ=windDirectionZ/windLength*windStrength*gustMultiplier;
			if (now - lastOverlayModulationAt >= 33) {
				lastOverlayModulationAt = now;
				const nextOverlay = Object.fromEntries(modulation.deltas.entries());
				setOverlayModulationDeltas(previous => {
					const previousKeys = Object.keys(previous), nextKeys = Object.keys(nextOverlay);
					if (previousKeys.length === nextKeys.length && nextKeys.every(key => Math.abs((previous[key] ?? 0) - (nextOverlay[key] ?? 0)) < .0005)) return previous;
					return nextOverlay;
				});
			}

			// The top-most active media clip is the scene background. It is composited inside
			// WebGL so bloom/post-processing can never black it out. Foreground 3D geometry,
			// spectrum and Now Playing remain above it.
			const backgroundLayer = currentScene.layers.find((layer) =>
				layer.type === "media" && layer.visible && !!layer.mediaUrl && visualLayerActive(layer, currentTransportPosition)
			);
			if (backgroundLayer) {
				ensureBackgroundMedia(backgroundLayer);
				const backgroundOpacity = mv(`layer:${backgroundLayer.id}:opacity`, visualLayerOpacityAt(backgroundLayer, currentTransportPosition), 0, 1);
				// Background fades darken toward black instead of making the media plane transparent.
				// Keeping the plane opaque makes its render ordering deterministic: background media first,
				// optional sky environment second, then the 3D world. Fog and lights cannot touch it.
				mediaMaterial.color.setScalar(Math.max(0, Math.min(1, backgroundOpacity)));
				mediaPlane.visible = !!backgroundTexture && backgroundOpacity > 0.001;
				frameBackgroundMedia(backgroundLayer);
				if (backgroundVideo) {
					const timeline = backgroundLayer.timeline ?? { start: 0, duration: 0, trimIn: 0, trimOut: 0, fadeIn: 0, fadeOut: 0 };
					const speed = mv(`layer:${backgroundLayer.id}:speed`, backgroundLayer.speed ?? 1, 0.25, 4);
					backgroundVideo.playbackRate = speed;
					backgroundVideo.loop = backgroundLayer.loop !== false;
					const local = Math.max(0, currentTransportPosition - timeline.start);
					const knownDuration = Math.max(0, backgroundLayer.sourceDuration ?? 0, Number.isFinite(backgroundVideo.duration) ? backgroundVideo.duration : 0);
					const sourceOut = timeline.trimOut > timeline.trimIn ? Math.min(knownDuration || timeline.trimOut, timeline.trimOut) : knownDuration;
					const sourceSpan = Math.max(0.01, sourceOut - timeline.trimIn);
					let desired = timeline.trimIn + local * speed;
					if (backgroundLayer.loop !== false && sourceSpan > 0.05) desired = timeline.trimIn + (((desired - timeline.trimIn) % sourceSpan) + sourceSpan) % sourceSpan;
					else if (sourceOut > timeline.trimIn) desired = Math.min(sourceOut - 0.001, desired);
					const drift = Math.abs((backgroundVideo.currentTime || 0) - desired);
					if (backgroundVideo.readyState >= 1 && drift > (currentTransport.playing ? 0.55 : 0.035)) {
						try { backgroundVideo.currentTime = Math.max(0, desired); } catch { /* metadata can race */ }
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
			const particlesLayer = currentScene.layers.find((layer) => layer.type === "particles");
			const stageLayer = currentScene.layers.find((layer) => layer.type === "stage");
			const cloudsLayer = currentScene.layers.find((layer) => layer.type === "clouds");
			const weatherLayer = currentScene.layers.find((layer) => layer.type === "weather");
			const stageActive = currentScene.project.mode!=="2d" && !!stageLayer && visualLayerActive(stageLayer, currentTransportPosition);
			const weatherActive = currentScene.project.mode!=="2d" && !!weatherLayer && visualLayerActive(weatherLayer,currentTransportPosition);
			const weatherLayerOpacity=weatherActive?mv(`layer:${weatherLayer!.id}:opacity`,visualLayerOpacityAt(weatherLayer!,currentTransportPosition),0,1):0;
			const weather={...currentScene.weather,intensity:mv("weather.intensity",currentScene.weather.intensity,0,4),rain:mv("weather.rain",currentScene.weather.rain,0,1),snow:mv("weather.snow",currentScene.weather.snow,0,1),ash:mv("weather.ash",currentScene.weather.ash,0,1),dust:mv("weather.dust",currentScene.weather.dust,0,1),sand:mv("weather.sand",currentScene.weather.sand,0,1),magic:mv("weather.magic",currentScene.weather.magic,0,1),fog:mv("weather.fog",currentScene.weather.fog,0,1),heatHaze:mv("weather.heatHaze",currentScene.weather.heatHaze,0,1),lightning:mv("weather.lightning",currentScene.weather.lightning,0,1),fallSpeed:mv("weather.fallSpeed",currentScene.weather.fallSpeed,.01,10)};
			const weatherMaster=weatherActive?weather.intensity*weatherLayerOpacity:0;
			const strikeRate=Math.max(0,weather.lightningRate);
			const strikePeriod=strikeRate>0?60/strikeRate:999999;
			const strikeClock=Math.max(0,currentTransportPosition);
			const strikeIndex=Math.floor(strikeClock/strikePeriod);
			const strikePhase=strikePeriod<999999?(strikeClock-strikeIndex*strikePeriod)/strikePeriod:1;
			const strikeSeed=Math.abs(Math.sin((strikeIndex+1)*91.713)*43758.5453)%1;
			const strikeWindow=.045+.035*strikeSeed;
			const weatherFlash=weatherMaster*weather.lightning*(strikePhase<strikeWindow?Math.pow(1-strikePhase/strikeWindow,2):0);
			const perfConfig = currentScene.performance;
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
			} else if (perfConfig.manualCueSequence !== performanceRuntime.manualSequence) {
				performanceRuntime.manualSequence = perfConfig.manualCueSequence;
				const manualCue = PERFORMANCE_BY_ID.get(perfConfig.manualCueId);
				if (manualCue) triggerPerformance(performanceRuntime, manualCue, perfConfig.manualCueStrength, "manual", now);
			}
			const transportDelta = currentTransportPosition - performanceRuntime.lastTransportPosition;
			if (sceneHydratedRef.current && currentTransport.playing && transportDelta >= 0 && transportDelta < 0.65) {
				const timelineCue = perfConfig.timelineCues
					.filter(cue => cue.time > performanceRuntime.lastTransportPosition && cue.time <= currentTransportPosition + 0.015)
					.sort((a,b)=>a.time-b.time)
					.at(-1);
				if (timelineCue) {
					const cue = PERFORMANCE_BY_ID.get(timelineCue.cueId);
					if (cue) triggerPerformance(performanceRuntime, cue, timelineCue.strength, "timeline", now);
				}
			}
			performanceRuntime.lastTransportPosition = currentTransportPosition;
			if (sceneHydratedRef.current && !performanceRuntime.active) {
				const autoCue = chooseAutoCue(currentScene, currentAudio, performanceRuntime, now);
				if (autoCue) triggerPerformance(performanceRuntime, autoCue, Math.max(0.35, perfConfig.directorIntensity), "auto", now);
			}
			const perfEnvelope = performanceWeight(now, performanceRuntime);
			const activeCue = performanceRuntime.active;
			const cueWeight = perfEnvelope.weight;
			const cueStrength = performanceRuntime.strength;
			const cueShake = (activeCue?.shake ?? 0) * cueWeight * cueStrength * perfConfig.cameraShake + (activeCue?.impact ?? 0) * perfEnvelope.impact * perfConfig.impactStrength * 0.45;
			const activeProgramCamera = resolveVisualProgramCamera(currentScene, currentTransportPosition, forcedCameraId);
			let cameraLensResponse=activeProgramCamera?.lensFlare ?? 1;
			let cameraExposure=1;
			if (editorFreeRoam) {
				const moveSpeed = (editorFast ? 8.5 : 3.2) * dt;
				updateEditorAxes();
				if (editorKeys.has("KeyW")) camera.position.addScaledVector(editorForward, moveSpeed);
				if (editorKeys.has("KeyS")) camera.position.addScaledVector(editorForward, -moveSpeed);
				if (editorKeys.has("KeyA")) camera.position.addScaledVector(editorRight, -moveSpeed);
				if (editorKeys.has("KeyD")) camera.position.addScaledVector(editorRight, moveSpeed);
				if (editorKeys.has("Space") || editorKeys.has("KeyE")) camera.position.y += moveSpeed;
				if (editorKeys.has("ControlLeft") || editorKeys.has("ControlRight") || editorKeys.has("KeyC") || editorKeys.has("KeyQ")) camera.position.y -= moveSpeed;
				camera.lookAt(camera.position.clone().add(editorForward));
				ensureCameraHelpers(currentScene,currentTransportPosition);
				if (now-lastEditorCameraPost>120) { lastEditorCameraPost=now; window.parent.postMessage({type:"ysong-editor-camera",position:{x:camera.position.x,y:camera.position.y,z:camera.position.z},rotation:{x:camera.rotation.x,y:camera.rotation.y,z:camera.rotation.z},fov:camera.fov},window.location.origin); }
			} else if (activeProgramCamera) {
				const programCamera = sampleVisualProgramCamera(activeProgramCamera, currentTransportPosition);
				const cameraPrefix=`camera:${activeProgramCamera.id}`;
				programCamera.positionX=mv(`${cameraPrefix}:positionX`,programCamera.positionX,-10000,10000); programCamera.positionY=mv(`${cameraPrefix}:positionY`,programCamera.positionY,-10000,10000); programCamera.positionZ=mv(`${cameraPrefix}:positionZ`,programCamera.positionZ,-10000,10000);
				programCamera.rotationX=mv(`${cameraPrefix}:rotationX`,programCamera.rotationX,-Math.PI*20,Math.PI*20); programCamera.rotationY=mv(`${cameraPrefix}:rotationY`,programCamera.rotationY,-Math.PI*20,Math.PI*20); programCamera.rotationZ=mv(`${cameraPrefix}:rotationZ`,programCamera.rotationZ,-Math.PI*20,Math.PI*20);
				programCamera.fov=mv(`${cameraPrefix}:fov`,programCamera.fov,10,140); programCamera.focusDistance=mv(`${cameraPrefix}:focusDistance`,programCamera.focusDistance,.1,10000); programCamera.focusRange=mv(`${cameraPrefix}:focusRange`,programCamera.focusRange,.02,1000); programCamera.maxBlur=mv(`${cameraPrefix}:maxBlur`,programCamera.maxBlur,0,40); programCamera.bokehSize=mv(`${cameraPrefix}:bokehSize`,programCamera.bokehSize,.1,8);
				programCamera.exposure=mv(`${cameraPrefix}:exposure`,programCamera.exposure,.05,8); programCamera.shakeAmount=mv(`${cameraPrefix}:shakeAmount`,programCamera.shakeAmount,0,10); programCamera.shakeFrequency=mv(`${cameraPrefix}:shakeFrequency`,programCamera.shakeFrequency,.05,30); programCamera.shakeRotation=mv(`${cameraPrefix}:shakeRotation`,programCamera.shakeRotation,0,45);
				cameraLensResponse=mv(`${cameraPrefix}:lensFlare`,activeProgramCamera.lensFlare,0,10);
				cameraExposure=Math.max(.05,programCamera.exposure);
				const nextFov = Math.max(10, Math.min(140, programCamera.fov));
				const nextNear = Math.max(.01, activeProgramCamera.near), nextFar = Math.max(nextNear+.1, activeProgramCamera.far);
				if (Math.abs(camera.fov-nextFov)>.01 || Math.abs(camera.near-nextNear)>.001 || Math.abs(camera.far-nextFar)>.01) { camera.fov=nextFov; camera.near=nextNear; camera.far=nextFar; camera.updateProjectionMatrix(); }
				const authoredShake=deterministicCameraShake(currentTransportPosition,activeProgramCamera.shakeSeed,programCamera.shakeFrequency);
				camera.position.x = programCamera.positionX + authoredShake.x*programCamera.shakeAmount + Math.sin(now * 0.071) * cueShake * 0.075 + Math.sin(now*.132) * roomCameraShake * .18;
				camera.position.y = programCamera.positionY + authoredShake.y*programCamera.shakeAmount + Math.cos(now * 0.083) * cueShake * 0.052 + Math.cos(now*.117) * roomCameraShake * .12;
				camera.position.z = programCamera.positionZ + authoredShake.z*programCamera.shakeAmount + Math.sin(now * 0.097) * cueShake * 0.035 + Math.sin(now*.103) * roomCameraShake * .09;
				if (activeProgramCamera.aimMode === "rotation") camera.rotation.set(programCamera.rotationX, programCamera.rotationY, programCamera.rotationZ);
				else {
					let targetX=programCamera.targetX,targetY=programCamera.targetY,targetZ=programCamera.targetZ;
					if(activeProgramCamera.targetMode==="performer"){targetX=performerRoot.position.x+programCamera.targetOffsetX;targetY=performerRoot.position.y+programCamera.targetOffsetY;targetZ=performerRoot.position.z+programCamera.targetOffsetZ;}
					else if(activeProgramCamera.targetMode==="primitive"&&activeProgramCamera.targetEntityId){const targetRuntime=primitiveRuntime.get(activeProgramCamera.targetEntityId);if(targetRuntime){const targetWorld=new THREE.Vector3();targetRuntime.mesh.getWorldPosition(targetWorld);targetX=targetWorld.x+programCamera.targetOffsetX;targetY=targetWorld.y+programCamera.targetOffsetY;targetZ=targetWorld.z+programCamera.targetOffsetZ;}}
					camera.lookAt(targetX,targetY,targetZ);
				}
				const shakeRadians=THREE.MathUtils.degToRad(programCamera.shakeRotation); if(shakeRadians>.00001) camera.rotateZ(authoredShake.roll*shakeRadians); if(roomCameraShake>.001) camera.rotateZ(Math.sin(now*.151)*roomCameraShake*.018);
				for(const runtime of postRuntimes){ if(runtime.type!=="depthOfField"||!runtime.uniforms)continue; const uniforms=runtime.uniforms; runtime.pass.enabled=runtime.module.enabled && Math.abs(programCamera.dofBalance)>.001 && programCamera.maxBlur>.01; uniforms.cameraNear.value=nextNear; uniforms.cameraFar.value=nextFar; uniforms.focusDistance.value=Math.max(.1,programCamera.focusDistance); uniforms.focusRange.value=Math.max(.02,programCamera.focusRange); uniforms.dofBalance.value=Math.max(-1,Math.min(1,programCamera.dofBalance)); uniforms.maxBlur.value=Math.max(0,programCamera.maxBlur); uniforms.bokehSize.value=Math.max(.1,programCamera.bokehSize); uniforms.bokehBlades.value=Math.max(3,programCamera.bokehBlades); uniforms.bokehRotation.value=THREE.MathUtils.degToRad(programCamera.bokehRotation); uniforms.bokehThreshold.value=programCamera.bokehThreshold; uniforms.bokehGain.value=programCamera.bokehGain; uniforms.bokehAnamorphic.value=programCamera.bokehAnamorphic; }
			}
			if (editorFreeRoam) for(const runtime of postRuntimes) if(runtime.type==="depthOfField") runtime.pass.enabled=false;

			const skyScene={...currentScene,sky:{...currentScene.sky,rotationY:mv("sky.rotationY",currentScene.sky.rotationY,-Math.PI*20,Math.PI*20),brightness:mv("sky.brightness",currentScene.sky.brightness,.01,10)}};
			updateSky(skyScene, currentTransportPosition);

			const stage = { ...currentScene.stage,
				ambientIntensity:mv("stage.ambientIntensity",currentScene.stage.ambientIntensity,0,20), sunIntensity:mv("stage.sunIntensity",currentScene.stage.sunIntensity,0,30), moonIntensity:mv("stage.moonIntensity",currentScene.stage.moonIntensity,0,30), keyIntensity:mv("stage.keyIntensity",currentScene.stage.keyIntensity,0,40), rimIntensity:mv("stage.rimIntensity",currentScene.stage.rimIntensity,0,40), fillIntensity:mv("stage.fillIntensity",currentScene.stage.fillIntensity,0,40),
				fogFar:mv("stage.fogFar",currentScene.stage.fogFar,currentScene.stage.fogNear+.5,500), exposure:mv("stage.exposure",currentScene.stage.exposure,.05,10), bloomStrength:mv("stage.bloomStrength",currentScene.stage.bloomStrength,0,10), lensFlareIntensity:mv("stage.lensFlareIntensity",currentScene.stage.lensFlareIntensity,0,10),
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
			ambient.color.set(stage.ambientSkyColor); ambient.groundColor.set(stage.ambientGroundColor); ambient.intensity = stageActive ? stage.ambientIntensity * (1 + cueFlash * 0.75 + roomStrobe*.8 + roomLightning*.55) : 0;
			sun.color.set(stage.sunColor); sun.intensity = stageActive ? stage.sunIntensity * (1 + sunReact) : 0; sun.position.set(stage.sunX, stage.sunY, stage.sunZ);
			moon.color.set(stage.moonColor); moon.intensity = stageActive && stage.moonEnabled ? stage.moonIntensity * (1 + moonReact) : 0; moon.position.set(stage.moonX,stage.moonY,stage.moonZ);
			key.color.set(stage.keyColor); key.intensity = stageActive ? stage.keyIntensity * (1 + keyReact + cueFlash * 1.7 + roomStrobe*2.5 + roomLightning*2.2) : 0; key.position.set(stage.keyX, stage.keyY, stage.keyZ); key.angle = THREE.MathUtils.degToRad(Math.max(5, Math.min(88, stage.keyAngle))); key.penumbra = Math.max(0, Math.min(1, stage.keyPenumbra)); key.distance = Math.max(0, stage.keyDistance); key.target.position.copy(performerRoot.position);
			rim.color.set(stage.rimColor); rim.intensity = stageActive ? stage.rimIntensity * (1 + rimReact) : 0; rim.position.set(stage.rimX, stage.rimY, stage.rimZ);
			floorLight.color.set(stage.fillColor); floorLight.intensity = stageActive ? stage.fillIntensity * (1 + fillReact) : 0; floorLight.position.set(stage.fillX, stage.fillY, stage.fillZ);
			renderer.toneMappingExposure = Math.max(0.2, stage.exposure);
			renderer.shadowMap.enabled = stageActive && stage.shadows;
			sun.castShadow = stageActive && stage.shadows && stage.sunShadows;
			moon.castShadow = stageActive && stage.shadows && stage.moonEnabled && stage.moonShadows;
			key.castShadow = stageActive && stage.shadows && stage.keyShadows;
			sun.shadow.bias=stage.shadowBias; moon.shadow.bias=stage.shadowBias; key.shadow.bias=stage.shadowBias;
			const authoredShadowMap=[512,1024,2048,4096].includes(Math.round(stage.shadowMapSize))?Math.round(stage.shadowMapSize):1024;
			const requestedShadowMap=Math.min(authoredShadowMap,runtimeQuality.shadowMapSize);
			if(requestedShadowMap!==shadowMapSize){shadowMapSize=requestedShadowMap;sun.shadow.mapSize.set(shadowMapSize,shadowMapSize);moon.shadow.mapSize.set(shadowMapSize,shadowMapSize);key.shadow.mapSize.set(shadowMapSize,shadowMapSize);sun.shadow.map?.dispose();sun.shadow.map=null;moon.shadow.map?.dispose();moon.shadow.map=null;key.shadow.map?.dispose();key.shadow.map=null;}
			floor.visible = stageActive && stage.floorVisible;
			floor.scale.setScalar(Math.max(0.2, stage.floorSize / 40));
			floorMaterial.color.set(stage.floorColor);
			floorMaterial.opacity = Math.max(0, Math.min(1, stage.floorOpacity));
			floorMaterial.depthWrite = floorMaterial.opacity >= 0.98;
			if (weatherActive && weather.fog * weatherMaster > .002) {
				weatherFog.color.set(weather.fogColor);
				weatherFog.density=Math.max(.0001,Math.min(.18,.002+weather.fog*weatherMaster*.045));
				threeScene.fog=weatherFog;
			} else if (stageActive && stage.fogEnabled) {
				stageFog.color.set(stage.fogColor);
				stageFog.near = Math.max(0.1, stage.fogNear);
				stageFog.far = Math.max(stageFog.near + 0.5, stage.fogFar - fogReact * 6 - cueFog * 8);
				threeScene.fog = stageFog;
			} else {
				threeScene.fog = null;
			}
			weatherFlashLight.color.set(roomLightning>.001 ? 0xded8ff : weather.lightningColor); weatherFlashLight.intensity=Math.max(0,weatherFlash*14 + roomLightning*18 + roomStrobe*8);
			const bloomStrength=(stageActive ? (stage.bloomStrength + cueGlow * 0.55 + cueFlash * 0.35) : 0) + weatherFlash*.55 + roomLightning*.65 + roomStrobe*.35;
			for(const runtime of postRuntimes){ if(runtime.type!=="bloom")continue; const pass=runtime.pass as UnrealBloomPass; pass.enabled=runtime.module.enabled && bloomStrength>.001; pass.strength=bloomStrength; pass.radius=Math.max(0,Math.min(1,stage.bloomRadius)); pass.threshold=Math.max(0,Math.min(1,stage.bloomThreshold)); }
			lensFlareSprite.visible = stageActive && stage.lensFlareEnabled && !editorFreeRoam;
			lensFlareSprite.position.copy(sun.position);
			flareMaterial.color.set(stage.sunColor);
			flareMaterial.opacity = lensFlareSprite.visible ? Math.max(0,Math.min(1,stage.lensFlareIntensity*(activeProgramCamera?cameraLensResponse:1))) : 0;

			const cloudsActive = currentScene.project.mode!=="2d" && !!cloudsLayer && visualLayerActive(cloudsLayer,currentTransportPosition);
			cloudGroup.visible = cloudsActive;
			if (cloudsActive) {
				const cfg={...currentScene.clouds,coverage:mv("clouds.coverage",currentScene.clouds.coverage,.01,1),density:mv("clouds.density",currentScene.clouds.density,.01,1),altitude:mv("clouds.altitude",currentScene.clouds.altitude,-100,1000),thickness:mv("clouds.thickness",currentScene.clouds.thickness,.1,200),windX:mv("clouds.windX",currentScene.clouds.windX,-20,20),windZ:mv("clouds.windZ",currentScene.clouds.windZ,-20,20),speed:mv("clouds.speed",currentScene.clouds.speed,-10,10),brightness:mv("clouds.brightness",currentScene.clouds.brightness,.01,10),lightAbsorption:mv("clouds.lightAbsorption",currentScene.clouds.lightAbsorption,0,1)}; const qualityCount=cfg.quality==="ultra"?144:cfg.quality==="high"?96:56; const visibleCount=Math.max(4,Math.min(cloudSprites.length,Math.round(qualityCount*runtimeQuality.cloudMultiplier*Math.max(.08,Math.min(1,cfg.coverage)))));
				const sharedCloudX=currentScene.wind.enabled&&currentScene.wind.affectsClouds?worldWindX:0; const sharedCloudZ=currentScene.wind.enabled&&currentScene.wind.affectsClouds?worldWindZ:0;
				cloudMaterial.color.set(cfg.color).multiplyScalar(Math.max(.05,cfg.brightness*(1-cfg.lightAbsorption*.48))); cloudMaterial.opacity=Math.max(.02,Math.min(.92,cfg.density*mv(`layer:${cloudsLayer!.id}:opacity`,cloudsLayer?.opacity ?? 1,0,1)));
				for(let i=0;i<cloudSprites.length;i++){ const sprite=cloudSprites[i]; sprite.visible=i<visibleCount; if(!sprite.visible)continue; const a=Math.abs(sprite.userData.seedA as number),b=Math.abs(sprite.userData.seedB as number),c=Math.abs(sprite.userData.seedC as number); const drift=now/1000*cfg.speed; const radius=12+20*a; const localX=cfg.windX+sharedCloudX*.22,localZ=cfg.windZ+sharedCloudZ*.22; const theta=i*2.399+drift*.08; sprite.position.set(Math.cos(theta)*radius+drift*localX*1.4,cfg.altitude+(b-.5)*cfg.thickness,Math.sin(theta)*radius+drift*localZ*1.4-8); const size=(4+9*c)*cfg.scale*(.75+cfg.softness*.45); sprite.scale.set(size*1.65,size,1); }
			}
			const weatherWeights=[weather.rain,weather.snow,weather.ash,weather.dust,weather.sand,weather.magic].map(value=>Math.max(0,value*weatherMaster));
			const weatherWeightTotal=weatherWeights.reduce((sum,value)=>sum+value,0);
			weatherRuntime.points.visible=weatherActive&&weatherWeightTotal>.002;
			if(weatherRuntime.points.visible){
				const density=Math.min(1,weatherWeightTotal/1.45); const count=Math.max(8,Math.min(MAX_WEATHER_PARTICLES,Math.round(MAX_WEATHER_PARTICLES*density*runtimeQuality.weatherMultiplier)));
				weatherRuntime.geometry.setDrawRange(0,count); weatherRuntime.material.opacity=Math.max(.03,Math.min(1,.28+weatherMaster*.58)); weatherRuntime.material.size=Math.max(.012,weather.precipitationSize*.055);
				weatherRuntime.material.blending=weather.magic>Math.max(weather.rain,weather.snow,weather.ash,weather.dust,weather.sand)?THREE.AdditiveBlending:THREE.NormalBlending;
				const wx=currentScene.wind.enabled&&currentScene.wind.affectsWeather?worldWindX:0,wz=currentScene.wind.enabled&&currentScene.wind.affectsWeather?worldWindZ:0; const area=Math.max(2,weather.area),height=Math.max(2,weather.height); const weatherClock=now/1000;
				const colors=[new THREE.Color(0xa8c7e8),new THREE.Color(0xf4f7ff),new THREE.Color(0x77767b),new THREE.Color(0xb8a486),new THREE.Color(0xd29b56),new THREE.Color(0x9d72ff)];
				for(let i=0;i<count;i++){const i3=i*3,i4=i*4,a=weatherRuntime.seeds[i4],b=weatherRuntime.seeds[i4+1],c=weatherRuntime.seeds[i4+2],d=weatherRuntime.seeds[i4+3];let pick=d*weatherWeightTotal,kind=0;for(let k=0;k<weatherWeights.length;k++){pick-=weatherWeights[k];if(pick<=0){kind=k;break}} const speeds=[12,1.15,.72,.16,.24,-.32]; const sway=[.06,.32,.45,.72,.88,.65]; const speed=speeds[kind]*weather.fallSpeed; const verticalRaw=b*height+weatherClock*speed; const vertical=((verticalRaw%height)+height)%height; const y=height*.5-vertical; const turbulence=(Math.sin(weatherClock*(.8+c*1.7)+d*18.2)+Math.cos(weatherClock*.43+a*11.7))*.5*windTurbulence*sway[kind]; const windAge=(height*.5-y)/height; const x=wrappedWeather((a-.5)*area+wx*weatherClock*.35+wx*windAge*1.8+turbulence,area); const z=wrappedWeather((c-.5)*area+wz*weatherClock*.35+wz*windAge*1.8+Math.sin(weatherClock*.51+d*9.1)*windTurbulence*sway[kind],area); weatherRuntime.positions[i3]=x;weatherRuntime.positions[i3+1]=y;weatherRuntime.positions[i3+2]=z;const col=colors[kind];weatherRuntime.colors[i3]=col.r;weatherRuntime.colors[i3+1]=col.g;weatherRuntime.colors[i3+2]=col.b;}
				(weatherRuntime.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate=true;(weatherRuntime.geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate=true; weatherRuntime.points.position.set(camera.position.x,camera.position.y,camera.position.z);
			}
			const weatherLightningColor=new THREE.Color(weather.lightningColor); const strikeX=(Math.sin((strikeIndex+1)*17.31)*.5)*weather.area*.7; const strikeZ=-3+(Math.cos((strikeIndex+1)*31.17)*.5)*weather.area*.45; const strikeStart=new THREE.Vector3(camera.position.x+strikeX+Math.sin(strikeIndex)*2,camera.position.y+weather.height*.75,camera.position.z+strikeZ); const strikeEnd=new THREE.Vector3(camera.position.x+strikeX,camera.position.y-weather.height*.45,camera.position.z+strikeZ); updateLightningLine(weatherLightning,strikeStart,strikeEnd,0,currentTransportPosition,Math.min(1.5,weatherFlash*2.2),weatherLightningColor);

			performerRoot.position.set(
				mv("object.positionX",currentScene.object.positionX,-10000,10000),
				mv("object.positionY",currentScene.object.positionY,-10000,10000) + (activeCue?.rootY ?? 0) * cueWeight * cueStrength,
				mv("object.positionZ",currentScene.object.positionZ,-10000,10000) + (activeCue?.rootZ ?? 0) * cueWeight * cueStrength,
			);
			performerRoot.rotation.set(mv("object.rotationX",currentScene.object.rotationX,-Math.PI*20,Math.PI*20), mv("object.rotationY",currentScene.object.rotationY,-Math.PI*20,Math.PI*20) + now / 1000 * currentScene.object.rotationSpeed, mv("object.rotationZ",currentScene.object.rotationZ,-Math.PI*20,Math.PI*20));

			const manualTest = Math.max(0, Math.min(1, currentScene.object.testSignal));
			const rawBody = reactiveValue(Math.max(visualAudioValue(currentScene.object.bodySource, currentAudio), manualTest), currentScene);
			const rawArms = reactiveValue(Math.max(visualAudioValue(currentScene.object.armSource, currentAudio), manualTest), currentScene);
			const rawPulse = reactiveValue(Math.max(visualAudioValue(currentScene.object.pulseSource, currentAudio), manualTest), currentScene);
			smoothBody = envelope(smoothBody, rawBody, currentScene.object.attack, currentScene.object.release);
			smoothArms = envelope(smoothArms, rawArms, currentScene.object.attack, currentScene.object.release);
			smoothPulse = envelope(smoothPulse, rawPulse, currentScene.object.attack, currentScene.object.release);
			const bodyMotion = smoothBody * currentScene.object.bodyAmount;
			const armMotion = smoothArms * currentScene.object.armAmount;
			const scale = mv("object.baseScale",currentScene.object.baseScale,.001,100) * (1 + smoothPulse * currentScene.object.pulseAmount * 0.45);
			performerRoot.scale.setScalar(scale);
			springVelocity += (currentAudio.kick * currentScene.object.springAmount * 1.6 - springPosition * 8.0) * dt;
			springVelocity *= Math.pow(0.18, dt);
			springPosition += springVelocity * dt;
			const glow = Math.max(0, Math.max(visualAudioValue(currentScene.object.glowSource, currentAudio), manualTest) * currentScene.object.glowAmount + currentAudio.kick * 0.75 + cueGlow);

			const objectVisible = currentScene.project.mode!=="2d" && !!objectLayer && visualLayerActive(objectLayer, currentTransportPosition);
			mannequin.root.visible = currentScene.object.model === "mannequin" && objectVisible;
			crystal.root.visible = currentScene.object.model === "crystal" && objectVisible;
			const importedModelActive=(currentScene.object.model === "glb" || currentScene.object.model === "asset");
			if (glb.root) glb.root.visible = importedModelActive && objectVisible;
			if (importedModelActive && currentScene.object.modelUrl) loadVisualModel(currentScene.object.modelUrl, currentScene.object.modelFileName,currentScene.object.modelFormat);
			if (mannequin.root.visible) {
				applyPose(mannequin, currentScene, bodyMotion, armMotion, now / 1000, springPosition);
				applyCueToMannequin(mannequin, activeCue, cueWeight, cueStrength, perfConfig.headTracking ? perfConfig.headTrackAmount : 0);
				const mannequinSlots:Partial<Record<VisualHumanoidSlot,THREE.Object3D>>={root:mannequin.root,spine:mannequin.spine,chest:mannequin.chest,head:mannequin.head,leftShoulder:mannequin.leftShoulder,leftForeArm:mannequin.leftElbow,leftHand:mannequin.leftHand,rightShoulder:mannequin.rightShoulder,rightForeArm:mannequin.rightElbow,rightHand:mannequin.rightHand};
				for(const [slot,bone] of Object.entries(mannequinSlots) as [VisualHumanoidSlot,THREE.Object3D][]){const prefix=`bone:${slot}:rotation`;const x=modulationDelta(modulation,`${prefix}X`),y=modulationDelta(modulation,`${prefix}Y`),z=modulationDelta(modulation,`${prefix}Z`);if(x)bone.rotateX(x);if(y)bone.rotateY(y);if(z)bone.rotateZ(z);}
			}
			if (crystal.root.visible) { crystal.root.rotation.x = now * 0.00012 + bodyMotion * 0.25; crystal.root.rotation.y = now * 0.00018 + armMotion * 0.18; }
			const performerEmissiveDelta = glow * 0.72 + modulationDelta(modulation,"object.emissiveIntensity");
			for (const material of [...mannequin.materials, ...crystal.materials]) {
				material.emissive.set(currentScene.object.emissiveColor);
				material.emissiveIntensity = Math.max(0, 0.10 + performerEmissiveDelta);
			}
			const libraryMaterial=currentScene.object.materialId?currentScene.materials.find(m=>m.id===currentScene.object.materialId):undefined;
			const performerEmissiveColor = new THREE.Color(currentScene.object.emissiveColor);
			for (const material of glb.materials) {
				const base = glb.materialBase.get(material);
				let authoredEmissiveIntensity = base?.emissiveIntensity ?? 0;
				if(libraryMaterial){
					const source=getMaterial(libraryMaterial,modulation);
					material.color.copy(source.color);material.metalness=source.metalness;material.roughness=source.roughness;material.emissive.copy(source.emissive);authoredEmissiveIntensity=source.emissiveIntensity;material.map=source.map;material.normalMap=source.normalMap;material.bumpMap=source.bumpMap;material.roughnessMap=source.roughnessMap;material.metalnessMap=source.metalnessMap;material.aoMap=source.aoMap;material.emissiveMap=source.emissiveMap;material.alphaMap=source.alphaMap;material.displacementMap=source.displacementMap;material.opacity=source.opacity;material.transparent=source.transparent;material.envMap=source.envMap;material.envMapIntensity=source.envMapIntensity;material.needsUpdate=true;
				} else if (currentScene.object.materialOverride) {
					material.color.set(currentScene.object.materialTint);
					material.metalness = Math.max(0, Math.min(1, currentScene.object.materialMetalness));
					material.roughness = Math.max(0, Math.min(1, currentScene.object.materialRoughness));
					material.emissive.set(currentScene.object.emissiveColor);
					authoredEmissiveIntensity = 0.10;
				} else if (base) {
					material.color.copy(base.color);
					material.metalness = base.metalness;
					material.roughness = base.roughness;
					material.emissive.copy(base.emissive);
					authoredEmissiveIntensity = base.emissiveIntensity;
				}
				// Performer glow is additive so assigning a library material no longer erases it.
				// Preserve authored/library emissive character, but blend toward the performer glow
				// color when a positive performance/audio glow is actually present.
				if (performerEmissiveDelta > 0.0001) {
					const blend = Math.min(1, performerEmissiveDelta / Math.max(0.001, authoredEmissiveIntensity + performerEmissiveDelta));
					material.emissive.lerp(performerEmissiveColor, blend);
				}
				material.emissiveIntensity = Math.max(0, authoredEmissiveIntensity + performerEmissiveDelta);
			}
			for(const mesh of glb.morphMeshes){if(!mesh.morphTargetDictionary||!mesh.morphTargetInfluences)continue;for(const [name,index] of Object.entries(mesh.morphTargetDictionary)){mesh.morphTargetInfluences[index]=mv(`morph:${name}`,currentScene.object.morphTargets[name]??0,0,1);}}

			if (glb.root && importedModelActive) {
				for (const [bone, base] of glb.boneBase) { bone.position.copy(base.position); bone.quaternion.copy(base.quaternion); bone.scale.copy(base.scale); }
				applyGlbAnimation(currentScene);
				const animationSpeed=mv("object.animationSpeed",currentScene.object.animationSpeed,.01,8); const animationWeight=mv("object.animationWeight",1,0,1);
				if (glb.activeAction) { glb.activeAction.timeScale = animationSpeed; glb.activeAction.setEffectiveWeight(animationWeight); }
				glb.mixer?.update(dt);
				const bodyBones = glb.bones.filter((bone) => /spine|chest|hips|pelvis/i.test(bone.name)).slice(0, 5);
				const headBones = glb.bones.filter((bone) => /head|neck/i.test(bone.name)).slice(0, 3);
				for (const bone of bodyBones) bone.rotateZ(bodyMotion * 0.10);
				glb.targets.leftUpperArm?.rotateZ(-armMotion * 0.14);
				glb.targets.rightUpperArm?.rotateZ(armMotion * 0.14);
				for (const bone of headBones) bone.rotateZ(springPosition * 0.12);
				applyCueToTargets(glb.targets, activeCue, cueWeight, cueStrength, perfConfig.headTracking ? perfConfig.headTrackAmount : 0);
				applyCustomSkeletalAnimations(currentScene,currentTransportPosition,animationWeight);
				for(const slot of HUMANOID_SLOTS){const bone=resolveBoneForTarget(currentScene,slot);if(!bone)continue;const prefix=`bone:${slot}:rotation`;const x=modulationDelta(modulation,`${prefix}X`),y=modulationDelta(modulation,`${prefix}Y`),z=modulationDelta(modulation,`${prefix}Z`);if(x)bone.rotateX(x);if(y)bone.rotateY(y);if(z)bone.rotateZ(z);}
			}

			ensurePrimitives(currentScene,currentTransportPosition,modulation);
			threeScene.updateMatrixWorld(true);
			applyIKConstraints(currentScene,currentTransportPosition,importedModelActive&&!!glb.root);
			threeScene.updateMatrixWorld(true);
			updateSecondaryDynamics(currentScene,currentTransportPosition,dt,modulation,importedModelActive&&!!glb.root,worldWindX,worldWindZ,windTurbulence);
			// Spring-bone secondary dynamics can rotate rig bones, so refresh matrices before
			// hand colliders and lightning sample their final performer pose for this frame.
			threeScene.updateMatrixWorld(true);
			const leftHandObject = importedModelActive && glb.root ? resolveBoneForTarget(currentScene,"leftHand") : mannequin.leftHand;
			const rightHandObject = importedModelActive && glb.root ? resolveBoneForTarget(currentScene,"rightHand") : mannequin.rightHand;
			const leftHandPosition = new THREE.Vector3();
			const rightHandPosition = new THREE.Vector3();
			if (leftHandObject) leftHandObject.getWorldPosition(leftHandPosition); else performerRoot.localToWorld(leftHandPosition.set(-1.2, 0.8, 0));
			if (rightHandObject) rightHandObject.getWorldPosition(rightHandPosition); else performerRoot.localToWorld(rightHandPosition.set(1.2, 0.8, 0));
			if(physicsWorld){
				physicsWorld.gravity={x:0,y:currentScene.physics.gravityY,z:0}; ensureGround(currentScene); ensureHandBodies();
				leftHandBody?.setNextKinematicTranslation({x:leftHandPosition.x,y:leftHandPosition.y,z:leftHandPosition.z}); rightHandBody?.setNextKinematicTranslation({x:rightHandPosition.x,y:rightHandPosition.y,z:rightHandPosition.z});
				if(currentScene.physics.resetSequence!==lastPhysicsReset){lastPhysicsReset=currentScene.physics.resetSequence;for(const p of currentScene.primitives){const runtime=primitiveRuntime.get(p.id);if(!runtime?.body)continue;const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rotationX,p.rotationY,p.rotationZ));runtime.body.setTranslation({x:p.positionX,y:p.positionY,z:p.positionZ},true);runtime.body.setRotation({x:q.x,y:q.y,z:q.z,w:q.w},true);runtime.body.setLinvel({x:0,y:0,z:0},true);runtime.body.setAngvel({x:0,y:0,z:0},true);}}
				if(currentScene.physics.enabled&&currentScene.physics.mode==="simulate"){
					if(currentScene.wind.enabled&&currentScene.wind.affectsPhysics&&currentScene.wind.physicsForce>0){
						const basePhysicsForce=Math.max(0,currentScene.wind.physicsForce);
						for(let index=0;index<currentScene.primitives.length;index++){
							const primitive=currentScene.primitives[index]; if(primitive.physics.bodyType!=="dynamic")continue;
							const runtime=primitiveRuntime.get(primitive.id); if(!runtime?.body)continue;
							const flutter=(Math.sin(windClock*(1.1+index*.037)+index*2.17)+Math.cos(windClock*.61+index*.83))*.5*windTurbulence;
							const lateral=basePhysicsForce*(1+flutter*.08);
							runtime.body.addForce({x:worldWindX*lateral,y:0,z:worldWindZ*lateral},true);
						}
					}
					physicsWorld.timestep=Math.max(1/120,Math.min(1/30,dt));physicsWorld.step();
					for(const p of currentScene.primitives){if(p.physics.bodyType!=="dynamic")continue;const runtime=primitiveRuntime.get(p.id);if(!runtime?.body)continue;const pos=runtime.body.translation(),rot=runtime.body.rotation();runtime.mesh.position.set(pos.x,pos.y,pos.z);runtime.mesh.quaternion.set(rot.x,rot.y,rot.z,rot.w);}
				}
			}
			const lightningColor = new THREE.Color(perfConfig.lightningColor);
			const lightningMode = activeCue?.lightning ?? "none";
			const lightningStrength = Math.max(0, Math.min(1.5, cueWeight * cueStrength * perfConfig.lightningIntensity * 0.52));
			const branchCount = Math.max(1, Math.min(4, Math.round(perfConfig.lightningBranches)));
			const leftTarget = new THREE.Vector3(-8.2, leftHandPosition.y + Math.sin(now * 0.004) * 0.6, -0.8);
			const rightTarget = new THREE.Vector3(8.2, rightHandPosition.y + Math.cos(now * 0.004) * 0.6, -0.8);
			const leftActive = lightningMode === "left" || lightningMode === "dual";
			const rightActive = lightningMode === "right" || lightningMode === "dual";
			for (let i = 0; i < lightning.left.length; i++) {
				const strength = leftActive && i < branchCount ? lightningStrength : 0;
				updateLightningLine(lightning.left[i], leftHandPosition, leftTarget, i, now / 1000, strength, lightningColor);
			}
			for (let i = 0; i < lightning.right.length; i++) {
				const strength = rightActive && i < branchCount ? lightningStrength : 0;
				updateLightningLine(lightning.right[i], rightHandPosition, rightTarget, i, now / 1000, strength, lightningColor);
			}
			lightning.leftLight.color.copy(lightningColor); lightning.rightLight.color.copy(lightningColor);
			lightning.leftLight.position.copy(leftHandPosition); lightning.rightLight.position.copy(rightHandPosition);
			lightning.leftLight.intensity = leftActive ? lightningStrength * 8 : 0;
			lightning.rightLight.intensity = rightActive ? lightningStrength * 8 : 0;

			const shockAmount = perfConfig.screenShockwave ? Math.max(0, Math.min(1.5, (activeCue?.impact ?? 0) * perfEnvelope.impact * cueStrength * perfConfig.impactStrength)) : 0;
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

			// The grid belongs to the Stage. Hiding Stage must produce a truly clean scene.
			grid.visible = stageActive && currentScene.grid.visible;
			for (const material of gridMaterials) material.opacity = Math.max(0, Math.min(1, currentScene.grid.intensity + visualAudioValue(currentScene.grid.source, currentAudio) * currentScene.grid.amount * 0.15));
			grid.scale.setScalar(Math.max(0.4, currentScene.grid.size / 14));

			particleRuntime.points.visible = currentScene.project.mode!=="2d" && !!particlesLayer && visualLayerActive(particlesLayer, currentTransportPosition);
			if (particleRuntime.points.visible) {
				const particleConfig={...currentScene.particles,size:mv("particles.size",currentScene.particles.size,.01,100),speed:mv("particles.speed",currentScene.particles.speed,0,20),gravity:mv("particles.gravity",currentScene.particles.gravity,-20,20),turbulence:mv("particles.turbulence",currentScene.particles.turbulence,0,20),orbit:mv("particles.orbit",currentScene.particles.orbit,-20,20),spread:mv("particles.spread",currentScene.particles.spread,.01,100),positionX:mv("particles.positionX",currentScene.particles.positionX,-1000,1000),positionY:mv("particles.positionY",currentScene.particles.positionY,-1000,1000),positionZ:mv("particles.positionZ",currentScene.particles.positionZ,-1000,1000)};
				const particleScene={...currentScene,particles:particleConfig};
				const rawParticleAudio = visualAudioValue(particleConfig.source, currentAudio) * particleConfig.amount;
				// Audio modulates an integrated phase instead of multiplying absolute clock time.
				// That prevents beat hits from teleporting the cloud to unrelated angles.
				const particleFollow = rawParticleAudio > smoothParticleAudio ? 0.22 : 0.075;
				smoothParticleAudio += (rawParticleAudio - smoothParticleAudio) * particleFollow;
				const baseSpeed = Math.max(0, particleConfig.speed);
				particleMotionTime += dt * baseSpeed * (0.7 + smoothParticleAudio * 0.8);
				const positionalAudio = baseSpeed > 0 ? smoothParticleAudio : 0;
				const count = Math.max(0, Math.min(MAX_PARTICLES, Math.round(currentScene.particles.count * runtimeQuality.particleMultiplier)));
				particleRuntime.geometry.setDrawRange(0, count);
				particleRuntime.material.opacity = mv(`layer:${particlesLayer!.id}:opacity`,particlesLayer!.opacity,0,1);
				particleRuntime.material.size = Math.max(0.006, particleConfig.size * 0.008 * (1 + smoothParticleAudio * 0.3));
				particleRuntime.material.blending = particleConfig.blendMode === "normal" ? THREE.NormalBlending : THREE.AdditiveBlending;
				particleRuntime.material.alphaTest = Math.max(0,Math.min(1,particleConfig.alphaTest));
				if (particleConfig.renderMode === "billboard" && particleConfig.textureUrl) {
					if (particleTextureUrl !== particleConfig.textureUrl) {
						particleTextureUrl=particleConfig.textureUrl; const requested=particleTextureUrl; particleTextureLoader.load(requested,tex=>{ if(particleTextureUrl!==requested){tex.dispose();return;} particleTexture?.dispose(); particleTexture=tex; tex.colorSpace=THREE.SRGBColorSpace; tex.anisotropy=runtimeQuality.maxAnisotropy; particleRuntime.material.map=tex; particleRuntime.material.needsUpdate=true; },undefined,()=>{});
					}
				} else { if(particleRuntime.material.map){particleRuntime.material.map=null;particleRuntime.material.needsUpdate=true;} }
				const cA=new THREE.Color(particleConfig.colorA),cB=new THREE.Color(particleConfig.colorB),cC=new THREE.Color(particleConfig.colorC),mixed=new THREE.Color();
				for (let i = 0; i < count; i++) {
					const seedLife = particleRuntime.seeds[i * 4 + 3];
					const life = (seedLife + particleMotionTime * 0.12) % 1;
					setParticlePosition(i, particleScene, particleRuntime.positions, particleRuntime.seeds, life, particleMotionTime, positionalAudio, currentScene.wind.enabled&&currentScene.wind.affectsParticles?worldWindX:0, currentScene.wind.enabled&&currentScene.wind.affectsParticles?worldWindZ:0, currentScene.wind.enabled&&currentScene.wind.affectsParticles?windTurbulence:0);
					const t=particleRuntime.seeds[i*4+2]; const mode=particleConfig.colorMode;
					if(mode==="single")mixed.copy(cA); else if(mode==="bi")mixed.copy(t<.5?cA:cB); else if(mode==="tri")mixed.copy(t<.333?cA:t<.666?cB:cC); else if(mode==="gradient"){ if(t<.5)mixed.copy(cA).lerp(cB,t*2); else mixed.copy(cB).lerp(cC,(t-.5)*2); } else mixed.setHSL((t+particleMotionTime*particleConfig.rainbowSpeed)%1,.9,.62);
					particleRuntime.colors[i*3]=mixed.r; particleRuntime.colors[i*3+1]=mixed.g; particleRuntime.colors[i*3+2]=mixed.b;
				}
				(particleRuntime.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
				(particleRuntime.geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
			}

			try {
			const postFx={...currentScene.postFx,
				exposure:mv("postFx.exposure",currentScene.postFx.exposure,.05,8), brightness:mv("postFx.brightness",currentScene.postFx.brightness,.05,5), contrast:mv("postFx.contrast",currentScene.postFx.contrast,.05,5), saturation:mv("postFx.saturation",currentScene.postFx.saturation,0,6), temperature:mv("postFx.temperature",currentScene.postFx.temperature,-2,2), tint:mv("postFx.tint",currentScene.postFx.tint,-2,2), lift:mv("postFx.lift",currentScene.postFx.lift,-1,1), gamma:mv("postFx.gamma",currentScene.postFx.gamma,.1,4), gain:mv("postFx.gain",currentScene.postFx.gain,0,6),
				ambientOcclusionIntensity:mv("postFx.ambientOcclusionIntensity",currentScene.postFx.ambientOcclusionIntensity,0,5), lightShaftsIntensity:mv("postFx.lightShaftsIntensity",currentScene.postFx.lightShaftsIntensity,0,8), lutIntensity:mv("postFx.lutIntensity",currentScene.postFx.lutIntensity,0,1), chromaticAberration:mv("postFx.chromaticAberration",currentScene.postFx.chromaticAberration,0,6), lensDistortion:mv("postFx.lensDistortion",currentScene.postFx.lensDistortion,-2,2), halation:mv("postFx.halation",currentScene.postFx.halation,0,4), filmGrain:mv("postFx.filmGrain",currentScene.postFx.filmGrain,0,2), vignette:mv("postFx.vignette",currentScene.postFx.vignette,0,2)
			};
			const toneMapping=postFx.toneMapping==="none"?THREE.NoToneMapping:postFx.toneMapping==="linear"?THREE.LinearToneMapping:postFx.toneMapping==="reinhard"?THREE.ReinhardToneMapping:postFx.toneMapping==="cineon"?THREE.CineonToneMapping:postFx.toneMapping==="agx"?THREE.AgXToneMapping:postFx.toneMapping==="neutral"?THREE.NeutralToneMapping:THREE.ACESFilmicToneMapping;
			renderer.toneMapping=toneMapping;
			renderer.toneMappingExposure=Math.max(.05,stage.exposure*postFx.exposure*cameraExposure);
			const audioColorGradeActive=Math.abs(modulationDelta(modulation,"postFx.brightness"))>.0001||Math.abs(modulationDelta(modulation,"postFx.contrast"))>.0001||Math.abs(modulationDelta(modulation,"postFx.saturation"))>.0001||Math.abs(modulationDelta(modulation,"postFx.temperature"))>.0001||Math.abs(modulationDelta(modulation,"postFx.tint"))>.0001;
			const colorGradeActive=postFx.colorGradeEnabled||audioColorGradeActive||Math.abs(postFx.temperature)>.001||Math.abs(postFx.tint)>.001||Math.abs(postFx.lift)>.001||Math.abs(postFx.gamma-1)>.001||Math.abs(postFx.gain-1)>.001;
			const weatherHeatHaze=weatherActive?Math.max(0,weather.heatHaze*weatherMaster):0;
			const shaftLight=postFx.lightShaftsSource==="moon"?moon:sun; const shaftWorld=shaftLight.position.clone(); const shaftNdc=shaftWorld.clone().project(camera); const shaftUv=new THREE.Vector2((shaftNdc.x+1)*.5,(shaftNdc.y+1)*.5); const cameraForward=new THREE.Vector3(); camera.getWorldDirection(cameraForward); const shaftForward=shaftWorld.clone().sub(camera.position).normalize().dot(cameraForward)>0;
			for(const runtime of postRuntimes){
				if(runtime.type==="ambientOcclusion"){
					const pass=runtime.pass as GTAOPass; pass.enabled=runtime.module.enabled&&currentScene.project.mode!=="2d"&&postFx.ambientOcclusionIntensity>.001; pass.blendIntensity=Math.max(0,Math.min(4,postFx.ambientOcclusionIntensity)); pass.updateGtaoMaterial({radius:Math.max(.1,postFx.ambientOcclusionRadius),samples:runtimeQuality.aoSamples,screenSpaceRadius:false}); continue;
				}
				if(runtime.type==="lightShafts"&&runtime.uniforms){ const u=runtime.uniforms; runtime.pass.enabled=runtime.module.enabled&&postFx.lightShaftsIntensity>.001&&shaftForward; (u.lightPosition.value as THREE.Vector2).copy(shaftUv); (u.lightColor.value as THREE.Color).set(postFx.lightShaftsSource==="moon"?stage.moonColor:stage.sunColor); u.intensity.value=postFx.lightShaftsIntensity; u.decay.value=postFx.lightShaftsDecay; u.density.value=postFx.lightShaftsDensity; u.weight.value=postFx.lightShaftsWeight; continue; }
				if(runtime.type==="lut"){const pass=runtime.pass as LUTPass;if(lutTexture)pass.lut=lutTexture;else{pass.material.uniforms.lut.value=null;pass.material.uniforms.lutSize.value=0;}pass.intensity=postFx.lutIntensity;pass.enabled=runtime.module.enabled&&!!lutTexture&&postFx.lutIntensity>.001;continue;}
				// Depth of field uses a different shader/uniform set from the modular Studio
				// passes below. Its camera uniforms are updated with the active program camera
				// above. Never run it through the Studio shader's brightness/contrast/etc.
				// Doing so used to dereference missing uniforms and abort every render frame.
				if(runtime.type==="depthOfField"){
					if(!activeProgramCamera || editorFreeRoam) runtime.pass.enabled=false;
					continue;
				}
				if(!runtime.uniforms)continue;
				const u=runtime.uniforms;
				// Start every modular studio pass neutral, then enable only the parameters owned by its module.
				u.brightness.value=1;u.contrast.value=1;u.saturation.value=1;u.temperature.value=0;u.tint.value=0;u.lift.value=0;u.gammaValue.value=1;u.gain.value=1;u.chromaticAberration.value=0;u.lensDistortion.value=0;u.lensZoom.value=1;u.halation.value=0;u.filmGrain.value=0;u.vignette.value=0;u.vignetteSoftness.value=postFx.vignetteSoftness;u.sharpen.value=0;u.heatHaze.value=0;u.heatHazeSpeed.value=Math.max(0,currentScene.weather.heatHazeSpeed);u.time.value=now/1000;
				if(runtime.type==="colorGrade"){ runtime.pass.enabled=runtime.module.enabled&&colorGradeActive; if(runtime.pass.enabled){u.brightness.value=postFx.brightness;u.contrast.value=postFx.contrast;u.saturation.value=postFx.saturation;u.temperature.value=postFx.temperature;u.tint.value=postFx.tint;u.lift.value=postFx.lift;u.gammaValue.value=postFx.gamma;u.gain.value=postFx.gain;} }
				else if(runtime.type==="lens"){ runtime.pass.enabled=runtime.module.enabled&&(postFx.chromaticAberration>.001||Math.abs(postFx.lensDistortion)>.001||Math.abs(postFx.lensZoom-1)>.001||currentScene.renderer.sharpen>.001||weatherHeatHaze>.001); if(runtime.pass.enabled){u.chromaticAberration.value=postFx.chromaticAberration;u.lensDistortion.value=postFx.lensDistortion;u.lensZoom.value=postFx.lensZoom;u.sharpen.value=Math.max(0,Math.min(1,currentScene.renderer.sharpen));u.heatHaze.value=weatherHeatHaze;} }
				else if(runtime.type==="film"){ runtime.pass.enabled=runtime.module.enabled&&(postFx.filmGrain>.001||postFx.vignette>.001||postFx.halation>.001); if(runtime.pass.enabled){u.halation.value=postFx.halation;u.filmGrain.value=postFx.filmGrain;u.vignette.value=postFx.vignette;} }
			}

			const hasDofPass=postRuntimes.some(runtime=>runtime.type==="depthOfField"&&runtime.pass.enabled);
			if(hasDofPass){
				const oldTarget=renderer.getRenderTarget(); const oldOverride=threeScene.overrideMaterial; const skySphereWasVisible=skySphere.visible; const skyBoxWasVisible=skyBox.visible; const helperWasVisible=cameraHelperRoot.visible;
				skySphere.visible=false; skyBox.visible=false; cameraHelperRoot.visible=false; threeScene.overrideMaterial=depthMaterial;
				renderer.setRenderTarget(depthTarget); renderer.setClearColor(0xffffff,1); renderer.clear(true,true,true); renderer.render(threeScene,camera);
				threeScene.overrideMaterial=oldOverride; skySphere.visible=skySphereWasVisible; skyBox.visible=skyBoxWasVisible; cameraHelperRoot.visible=helperWasVisible; renderer.setRenderTarget(oldTarget); renderer.setClearColor(0x000000,0);
			}
			composer.render();
			} catch (caught) {
				reportRendererWarning("post-processing/render",caught);
				// Drop optional passes for this frame and keep the core renderer alive. This
				// preserves free-roam, scene objects, Spectrum and authored overlays.
				for(const runtime of postRuntimes) runtime.pass.enabled=false;
				fxaaPass.enabled=false; smaaPass.enabled=false;
				try{renderCoreFallback();}catch(coreCaught){
					const detail=coreCaught instanceof Error?coreCaught.message:String(coreCaught||"Unknown core render error");
					setError(`Core WebGL render failed: ${detail}`);
				}
			}
			const spectrumScene={...currentScene,layers:currentScene.layers.map(layer=>layer.type==="spectrum"?{...layer,opacity:mv(`layer:${layer.id}:opacity`,layer.opacity,0,1)}:layer),spectrum:{...currentScene.spectrum,height:mv("spectrum.height",currentScene.spectrum.height,.001,3),thickness:mv("spectrum.thickness",currentScene.spectrum.thickness,.01,4),positionX:mv("spectrum.positionX",currentScene.spectrum.positionX,-2,3),positionY:mv("spectrum.positionY",currentScene.spectrum.positionY,-2,3),scale:mv("spectrum.scale",currentScene.spectrum.scale,.01,10),rotation:mv("spectrum.rotation",currentScene.spectrum.rotation,-Math.PI*20,Math.PI*20),glow:mv("spectrum.glow",currentScene.spectrum.glow,0,20)}};
				drawSpectrum(spectrum2d, smoothedSpectrum, spectrumScene, currentAudio, renderWidth, renderHeight);
				drawRoomAudienceEffects(spectrum2d, roomEffectPulsesRef.current, now, renderWidth, renderHeight);

			if (currentTransport.transitionSequence != null && currentTransport.transitionSequence !== lastTransitionSequence) lastTransitionSequence = currentTransport.transitionSequence;
			frameCounter++;
			const elapsed = now - statsStart;
			if (elapsed >= 1000) {
				const fps = frameCounter * 1000 / elapsed;
				const qualityConfig = sceneRef.current.renderer;
				if (qualityConfig.adaptiveResolution) {
					const targetFps = Math.max(24, Math.min(120, qualityConfig.adaptiveTargetFps));
					if (fps < targetFps * .90) { adaptiveLowStreak += 1; adaptiveHighStreak = 0; }
					else if (fps > targetFps * .985) { adaptiveHighStreak += 1; adaptiveLowStreak = 0; }
					else { adaptiveLowStreak = 0; adaptiveHighStreak = 0; }
					if (adaptiveLowStreak >= 2 || adaptiveHighStreak >= 4) {
						const nextScale = nextAdaptiveQualityScale(adaptiveScale, fps, targetFps, qualityConfig.adaptiveMinScale, qualityConfig.adaptiveMaxScale);
						if (Math.abs(nextScale - adaptiveScale) > .0001) {
							adaptiveScale = nextScale;
							resizeInternalRender(runtimeQuality.renderScale * adaptiveScale);
						}
						adaptiveLowStreak = 0;
						adaptiveHighStreak = 0;
					}
				} else if (Math.abs(adaptiveScale - 1) > .0001) {
					adaptiveScale = 1;
					resizeInternalRender(runtimeQuality.renderScale);
				}
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
				frameCounter = 0; statsStart = now;
			}
		};
		animationFrame = requestAnimationFrame(render);

		const toggleFullscreen = () => {
			if (embedded || obsMode) return;
			if (document.fullscreenElement) void document.exitFullscreen();
			else void document.documentElement.requestFullscreen();
		};
		const onKeyDown = (event: KeyboardEvent) => { if (event.key.toLowerCase() === "f") toggleFullscreen(); };
		window.addEventListener("keydown", onKeyDown); window.addEventListener("dblclick", toggleFullscreen);
		return () => {
			disposed = true; cancelAnimationFrame(animationFrame);
			window.removeEventListener("keydown", onKeyDown); window.removeEventListener("dblclick", toggleFullscreen);
			if (editorFreeRoam) { window.removeEventListener("keydown", onEditorKeyDown); window.removeEventListener("keyup", onEditorKeyUp); window.removeEventListener("mousemove", onEditorMouseMove); window.removeEventListener("mouseup", onEditorMouseUp); window.removeEventListener("blur", onWindowBlur); document.removeEventListener("visibilitychange", onVisibility); document.removeEventListener("pointerlockchange", onPointerLockChange); document.removeEventListener("pointerlockerror", onPointerLockError); canvas.removeEventListener("mousedown", onEditorMouseDown); canvas.removeEventListener("wheel", onEditorWheel); canvas.removeEventListener("click", onEditorClick); canvas.removeEventListener("mousemove", onEditorHover); if(document.pointerLockElement===canvas)document.exitPointerLock(); }
			for(const helper of cameraHelpers.values()){helper.frustum.geometry.dispose();(helper.frustum.material as THREE.Material).dispose();helper.forward.geometry.dispose();(helper.forward.material as THREE.Material).dispose();helper.path.geometry.dispose();(helper.path.material as THREE.Material).dispose();helper.materialCopies.forEach(material=>material.dispose());}cameraHelpers.clear();threeScene.remove(cameraHelperRoot);
			for(const runtime of secondaryRuntime.values())disposeSecondaryRuntime(runtime);secondaryRuntime.clear();threeScene.remove(secondaryGroup);
			for(const runtime of primitiveRuntime.values()){removePhysicsBody(runtime);runtime.mesh.geometry.dispose();} primitiveRuntime.clear(); materialRuntime.forEach(material=>material.dispose()); materialTextureCache.forEach(texture=>texture.dispose()); materialEnvironmentCache.forEach(target=>target.dispose()); pmremGenerator.dispose(); physicsWorld?.free();
			clearGlb(); disposeObject3D(mannequin.root); disposeObject3D(crystal.root);
			particleTexture?.dispose(); particleRuntime.geometry.dispose(); particleRuntime.material.dispose(); cloudTexture.dispose(); cloudMaterial.dispose(); weatherRuntime.geometry.dispose(); weatherRuntime.material.dispose(); weatherLightning.geometry.dispose(); (weatherLightning.material as THREE.Material).dispose(); flareTexture.dispose(); flareMaterial.dispose(); grid.geometry.dispose(); gridMaterials.forEach((material: THREE.Material) => material.dispose());
			for (const line of [...lightning.left, ...lightning.right]) { line.geometry.dispose(); (line.material as THREE.Material).dispose(); }
			shockwave.geometry.dispose(); shockwaveMaterial.dispose();
			clearBackgroundMedia(); mediaGeometry.dispose(); mediaMaterial.dispose();
			if (skySphereTexture) skySphereTexture.dispose();
			for (const texture of skyBoxTextures) texture?.dispose();
			skySphereGeometry.dispose(); skySphereMaterial.dispose(); skyBoxGeometry.dispose(); skyBoxMaterials.forEach(material=>material.dispose());
			floor.geometry.dispose(); floorMaterial.dispose(); depthTarget.dispose(); depthMaterial.dispose(); postRuntimes.forEach(runtime=>runtime.pass.dispose?.()); lutTexture?.dispose(); composer.dispose(); renderer.dispose(); channel.close();
		};
	}, [
		embedded,
		editorFreeRoam,
		forcedCameraId,
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

	const overlayMv=(target:string,base:number,min=-Infinity,max=Infinity)=>Math.max(min,Math.min(max,base+(overlayModulationDeltas[target]??0)));
	const overlayPosition = extrapolatedTransportPosition(transport);
	const shapeLayers = scene.project.mode === "3d" ? [] : scene.layers.filter((layer) => layer.type === "shape2d" && visualLayerActive(layer, overlayPosition));
	const nowPlayingLayer = scene.layers.find((layer) => layer.type === "nowPlaying");
	const objectLayer = scene.layers.find((layer) => layer.type === "object");
	const flashOpacity = Math.min(0.16, (objectLayer?.opacity ?? 0) * audioState.kick * 0.12);
	const transitionProgress = Math.max(0, Math.min(1, transport.transitionProgress ?? 0));
	const transitionStyle = transitionOverlayStyle(transport.visualTransition ?? "cut", transitionProgress);
	// Program/OBS output is scene-pure: World/Radio metadata never injects branding,
	// station bugs, ad labels, or Up Next text. Text appears only when the scene author
	// explicitly adds a text-capable layer such as Now Playing.
	const nowOpacity = nowPlayingLayer?.visible ? overlayMv(`layer:${nowPlayingLayer.id}:opacity`,nowPlayingLayer.opacity,0,1) : 0;

	return (
		<main className={`fixed inset-0 grid place-items-center overflow-hidden bg-black select-none ${obsMode ? "cursor-none" : ""}`} aria-label="YSong Visual Output">
			<div className="relative overflow-hidden" style={{ background: scene.output.background, width: "min(100vw, calc(100vh * 16 / 9))", height: "min(100vh, calc(100vw * 9 / 16))" }}>
				<canvas ref={threeCanvasRef} width={renderWidth} height={renderHeight} className="absolute inset-0 h-full w-full" style={{zIndex:10}} />
				<canvas ref={spectrumRef} width={renderWidth} height={renderHeight} className="pointer-events-none absolute inset-0 h-full w-full" style={{zIndex:20}} />
				{shapeLayers.map((layer,index)=>{
					const shape=scene.shapes2d.find(candidate=>candidate.id===layer.entityId);if(!shape)return null;
					const opacity=overlayMv(`layer:${layer.id}:opacity`,visualLayerOpacityAt(layer,overlayPosition),0,1);
					const prefix=`shape:${shape.id}`; const shapeX=overlayMv(`${prefix}:positionX`,shape.positionX,-2,3),shapeY=overlayMv(`${prefix}:positionY`,shape.positionY,-2,3),shapeWidth=overlayMv(`${prefix}:width`,shape.width,.001,4),shapeHeight=overlayMv(`${prefix}:height`,shape.height,.001,4),shapeRotation=overlayMv(`${prefix}:rotation`,shape.rotation,-3600,3600);
					const common:React.CSSProperties={left:`${shapeX*100}%`,top:`${shapeY*100}%`,width:`${shapeWidth*100}%`,height:shape.shape==="line"?Math.max(1,shape.borderWidth||2):`${shapeHeight*100}%`,opacity,transform:`translate(-50%,-50%) rotate(${shapeRotation}deg)`,zIndex:21+index};
					if(shape.shape==="line")return <div key={layer.id} className="pointer-events-none absolute origin-center" style={{...common,background:shape.color,borderRadius:999}}/>;
					return <div key={layer.id} className="pointer-events-none absolute" style={{...common,background:shape.color,border:`${shape.borderWidth}px solid ${shape.borderColor}`,borderRadius:shape.shape==="ellipse"?"9999px":`${shape.borderRadius*100}%`}}/>;
				})}
				<div className="pointer-events-none absolute inset-0 bg-white" style={{ opacity: flashOpacity, zIndex:25 }} />
				{nowPlayingLayer && nowOpacity > 0 ? (
					<div className="pointer-events-none absolute text-white" style={{
						left: `${scene.nowPlaying.positionX * 100}%`, top: `${scene.nowPlaying.positionY * 100}%`, width: `${scene.nowPlaying.width * 100}%`,
						opacity: nowOpacity, transform: "translateY(-50%)", textAlign: scene.nowPlaying.align, textShadow: "0 2px 24px rgba(0,0,0,.8)", fontSize: `${scene.nowPlaying.fontScale}em`, zIndex:30,
					}}>
						<div className="text-[clamp(8px,0.65vw,13px)] font-bold uppercase tracking-[0.34em] text-violet-200/80">Now Playing</div>
						<div className="mt-[0.5vw] truncate text-[clamp(22px,2.3vw,50px)] font-semibold tracking-tight">{scene.nowPlaying.title}</div>
						<div className="mt-[0.25vw] truncate text-[clamp(11px,1vw,22px)] text-white/75">{scene.nowPlaying.artist}{scene.nowPlaying.album ? ` · ${scene.nowPlaying.album}` : ""}</div>
					</div>
				) : null}
				<div className="pointer-events-none absolute inset-0" style={{...transitionStyle,zIndex:40}} />
			</div>
			{error ? <div className="absolute inset-0 grid place-items-center bg-black px-8 text-center text-sm text-red-300">{error}</div> : null}
		</main>
	);
}

function transitionOverlayStyle(mode: NonNullable<VisualTransportState["visualTransition"]>, progress: number) {
	if (mode === "cut" || progress <= 0 || progress >= 1) return { opacity: 0 };
	const middle = Math.sin(progress * Math.PI);
	if (mode === "flash") return { background: "white", opacity: middle * 0.72 };
	if (mode === "black") return { background: "black", opacity: middle };
	return { background: "radial-gradient(circle at 50% 50%, rgba(82,52,150,.25), rgba(0,0,0,.94))", opacity: middle * 0.82 };
}

function drawSpectrum(ctx: CanvasRenderingContext2D, smooth: Float32Array, scene: VisualSceneState, audio: VisualAudioFrame, width: number, height: number) {
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
	ctx.lineJoin = "round"; ctx.lineCap = "round";
	ctx.shadowBlur = (width <= PREVIEW_WIDTH ? 6 : 12) * scene.spectrum.glow * (0.75 + energy * 0.8);
	ctx.shadowColor = `rgba(157,102,255,${0.45 * opacity})`;
	const gradient = ctx.createLinearGradient(0, -height * 0.28, 0, height * 0.28);
	gradient.addColorStop(0, `rgba(229,199,255,${opacity})`);
	gradient.addColorStop(0.48, `rgba(154,93,255,${opacity * 0.96})`);
	gradient.addColorStop(1, `rgba(50,102,228,${opacity * 0.75})`);
	ctx.strokeStyle = gradient; ctx.fillStyle = gradient;
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
			const x = Math.cos(angle) * r, y = Math.sin(angle) * r;
			if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
			if (mode === "ringBars") {
				ctx.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
				ctx.lineTo(x, y);
			}
		}
		if (mode !== "arc" && mode !== "dualArc") ctx.closePath();
		ctx.stroke();
		if (mode === "dualArc") { ctx.save(); ctx.scale(-1, 1); ctx.stroke(); ctx.restore(); }
		if (mode === "halo") { ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.globalAlpha = opacity * 0.6; ctx.stroke(); ctx.globalAlpha = 1; }
	} else if (mode === "smoothLine" || mode === "oscilloscope" || mode === "filledWave") {
		ctx.lineWidth = Math.max(1.5, scene.spectrum.thickness * (width <= PREVIEW_WIDTH ? 2.2 : 4.2));
		ctx.beginPath();
		for (let i = 0; i < smooth.length; i++) {
			const x = x0 + i * step;
			const raw = valueAt(i);
			const y = mode === "oscilloscope" ? Math.sin(i * 0.48 + raw * 8 + performance.now() * 0.003) * raw * maxHeight * 0.48 : -raw * maxHeight;
			if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
		}
		if (mode === "filledWave") { ctx.lineTo(x0 + span, 0); ctx.lineTo(x0, 0); ctx.closePath(); ctx.globalAlpha = 0.72; ctx.fill(); ctx.globalAlpha = 1; }
		else ctx.stroke();
	} else if (mode === "centerMirror") {
		for (let i = 0; i < smooth.length / 2; i++) {
			const v = valueAt(i * 2) * maxHeight;
			const distance = i * step * 1.9;
			ctx.fillRect(distance, -v, barWidth, v); ctx.fillRect(-distance - barWidth, -v, barWidth, v);
		}
	} else {
		for (let i = 0; i < smooth.length; i++) {
			const v = valueAt(i) * maxHeight;
			const x = x0 + i * step + (step - barWidth) * 0.5;
			if (mode === "mirrored") { ctx.fillRect(x, -v, barWidth, v); ctx.fillRect(x, 0, barWidth, v); }
			else if (mode === "depthBars") {
				ctx.fillRect(x, -v, barWidth, v);
				ctx.globalAlpha = opacity * 0.28; ctx.fillRect(x + barWidth * 0.45, -v - barWidth * 0.45, barWidth, v); ctx.globalAlpha = 1;
			} else ctx.fillRect(x, -v, barWidth, v);
		}
	}
	ctx.restore();
	ctx.shadowBlur = 0;
}
