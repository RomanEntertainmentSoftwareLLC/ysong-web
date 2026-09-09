import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { bridgeApi, type VisualAudioFrame, type VisualTransportState } from "../lib/bridgeApi";
import {
	DEFAULT_VISUAL_SCENE,
	PERFORMANCE_BEHAVIORS,
	normalizeVisualScene,
	visualAudioValue,
	visualLayerActive,
	visualLayerOpacityAt,
	type VisualLayer,
	type VisualPerformanceCue,
	type VisualSceneState,
} from "../lib/visualsScene";
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
	boneBase: Map<THREE.Bone, THREE.Quaternion>;
	materials: THREE.MeshStandardMaterial[];
	materialBase: Map<THREE.MeshStandardMaterial, { color: THREE.Color; metalness: number; roughness: number }>;
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
	rig.leftShoulder.rotation.z += (cue.leftArmZ ?? 0) * w;
	rig.rightShoulder.rotation.z += (cue.rightArmZ ?? 0) * w;
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
	const seeds = new Float32Array(MAX_PARTICLES * 4);
	for (let i = 0; i < MAX_PARTICLES; i++) {
		seeds[i * 4] = Math.random(); seeds[i * 4 + 1] = Math.random(); seeds[i * 4 + 2] = Math.random(); seeds[i * 4 + 3] = Math.random();
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
	const material = new THREE.PointsMaterial({ color: 0x9f8cff, size: 0.035, transparent: true, opacity: 0.72, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
	const points = new THREE.Points(geometry, material);
	points.frustumCulled = false;
	return { points, geometry, material, positions, seeds };
}

function setParticlePosition(index: number, scene: VisualSceneState, positions: Float32Array, seeds: Float32Array, life: number, time: number, audio: number) {
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
	const turbulence = scene.particles.turbulence * (0.12 + audio * 0.28);
	x += Math.sin(time * 1.1 + phase * 3) * turbulence;
	y += Math.cos(time * 0.9 + phase * 2) * turbulence;
	y -= scene.particles.gravity * life * life * 0.8;
	positions[i3] = x + scene.particles.positionX;
	positions[i3 + 1] = y + scene.particles.positionY;
	positions[i3 + 2] = z + scene.particles.positionZ;
}

function applyPose(rig: MannequinRig, scene: VisualSceneState, body: number, arms: number, idleTime: number, spring: number) {
	const idle = scene.object.idleAmount;
	const pose = scene.object.pose;
	const baseArm = pose === "cruciform" ? Math.PI / 2 : pose === "reach" ? 1.05 : 0.18;
	const sway = Math.sin(idleTime * 0.75) * idle * 0.18;
	rig.spine.rotation.z = sway + body * 0.34;
	rig.spine.rotation.x = body * 0.22;
	rig.chest.rotation.y = -sway * 0.7 + body * 0.25;
	rig.head.rotation.z = -sway * 0.65 + spring * 0.18;
	rig.head.rotation.x = body * -0.12 + spring * 0.09;
	const armSwing = arms * 0.95;
	rig.leftShoulder.rotation.z = baseArm + armSwing;
	rig.rightShoulder.rotation.z = -baseArm - armSwing;
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
	const [scene, setScene] = useState<VisualSceneState>(() => structuredClone(DEFAULT_VISUAL_SCENE));
	const [audioState, setAudioState] = useState<VisualAudioFrame>(ZERO_AUDIO);
	const [transport, setTransport] = useState<VisualTransportState>(ZERO_TRANSPORT);
	const [error, setError] = useState("");
	const query = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
	const embedded = query.get("embedded") === "1";
	const obsMode = query.get("obs") === "1";
	const renderWidth = embedded ? PREVIEW_WIDTH : PROGRAM_WIDTH;
	const renderHeight = embedded ? PREVIEW_HEIGHT : PROGRAM_HEIGHT;

	useEffect(() => {
		let cancelled = false;
		void bridgeApi.getVisualScene<VisualSceneState>().then((payload) => {
			if (cancelled) return;
			const next = normalizeVisualScene(payload.scene); sceneRef.current = next; setScene(next);
		}).catch(() => {});
		void bridgeApi.getVisualTransport().then((next) => { if (!cancelled) { transportRef.current = next; setTransport(next); } }).catch(() => {});
		const stopScene = bridgeApi.subscribeVisualScene<VisualSceneState>((payload) => { const next = normalizeVisualScene(payload.scene); sceneRef.current = next; setScene(next); });
		const stopAudio = bridgeApi.subscribeVisualAudio((frame) => { audioRef.current = frame; setAudioState(frame); });
		const stopTransport = bridgeApi.subscribeVisualTransport((next) => { transportRef.current = next; setTransport(next); });
		return () => { cancelled = true; stopScene(); stopAudio(); stopTransport(); };
	}, []);

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
			renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: !embedded, powerPreference: "high-performance", premultipliedAlpha: false });
		} catch (caught) {
			const message = caught instanceof Error ? caught.message : "WebGL renderer initialization failed.";
			setError(message);
			channel.postMessage({ type: "visual-output-error", timestamp: Date.now(), message } satisfies VisualOutputError);
			return () => channel.close();
		}
		renderer.setPixelRatio(1);
		renderer.setSize(renderWidth, renderHeight, false);
		renderer.setClearColor(0x000000, 0);
		renderer.shadowMap.enabled = !embedded;
		renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		renderer.outputColorSpace = THREE.SRGBColorSpace;
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.toneMappingExposure = 1.05;

		const threeScene = new THREE.Scene();
		const camera = new THREE.PerspectiveCamera(52, renderWidth / renderHeight, 0.1, 120);
		camera.position.set(0, 0.3, 7.4);
		camera.lookAt(0, 0, 0);

		const ambient = new THREE.HemisphereLight(0x8d9dff, 0x190d2a, 0.85);
		threeScene.add(ambient);
		const sun = new THREE.DirectionalLight(0x7f91ff, 0.65);
		sun.position.set(-3, 7, 4);
		threeScene.add(sun);
		const key = new THREE.SpotLight(0xffffff, 2.4, 38, THREE.MathUtils.degToRad(38), 0.38, 1.5);
		key.position.set(-4, 6, 5);
		key.castShadow = !embedded;
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

		const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x07101f, metalness: 0.18, roughness: 0.78 });
		const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), floorMaterial);
		floor.rotation.x = -Math.PI / 2;
		floor.position.y = -3.16;
		floor.receiveShadow = true;
		threeScene.add(floor);

		const composer = new EffectComposer(renderer);
		const renderPass = new RenderPass(threeScene, camera);
		const bloomPass = new UnrealBloomPass(new THREE.Vector2(renderWidth, renderHeight), 0.85, 0.35, 0.72);
		composer.addPass(renderPass);
		composer.addPass(bloomPass);

		const performerRoot = new THREE.Group();
		threeScene.add(performerRoot);
		const mannequin = createMannequin(); performerRoot.add(mannequin.root);
		const crystal = createCrystal(); crystal.root.visible = false; performerRoot.add(crystal.root);
		const glb: GlbRuntime = { root: null, mixer: null, clips: [], activeAction: null, fileName: "", bones: [], boneBase: new Map(), materials: [], materialBase: new Map(), loadingUrl: "", targets: {} };
		const loader = new GLTFLoader();

		const grid = new THREE.GridHelper(28, 28, 0x4c62d9, 0x21305d);
		grid.position.y = -3.15;
		const gridMaterials: THREE.Material[] = Array.isArray(grid.material) ? grid.material : [grid.material];
		for (const material of gridMaterials) { material.transparent = true; material.opacity = 0.32; }
		threeScene.add(grid);

		const particleRuntime = makeParticles();
		threeScene.add(particleRuntime.points);
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
		let smoothArms = 0;
		let smoothPulse = 0;
		let springPosition = 0;
		let springVelocity = 0;
		let lastGlbUrl = "";
		let lastAnimation = "";
		let lastTransitionSequence = -1;

		const clearGlb = () => {
			if (glb.root) { performerRoot.remove(glb.root); disposeObject3D(glb.root); }
			glb.root = null; glb.mixer = null; glb.clips = []; glb.activeAction = null; glb.bones = []; glb.boneBase.clear(); glb.materials = []; glb.materialBase.clear(); glb.targets = {};
		};

		const loadGlb = (url: string, fileName: string) => {
			if (!url || glb.loadingUrl === url || lastGlbUrl === url) return;
			glb.loadingUrl = url;
			loader.load(url, (gltf: GLTF) => {
				if (disposed) { disposeObject3D(gltf.scene); return; }
				clearGlb();
				const root = gltf.scene;
				const box = new THREE.Box3().setFromObject(root);
				const size = new THREE.Vector3(); const center = new THREE.Vector3(); box.getSize(size); box.getCenter(center);
				const height = Math.max(0.001, size.y);
				const normalizeScale = 5.6 / height;
				root.scale.setScalar(normalizeScale);
				root.position.sub(center.multiplyScalar(normalizeScale));
				root.position.y -= 0.25;
				const bones: THREE.Bone[] = [];
				const materials: THREE.MeshStandardMaterial[] = [];
				let meshes = 0;
				root.traverse((object: THREE.Object3D) => {
					if ((object as THREE.Bone).isBone) bones.push(object as THREE.Bone);
					const mesh = object as THREE.Mesh;
					if (mesh.isMesh) {
						meshes++;
						mesh.castShadow = !embedded; mesh.receiveShadow = !embedded;
						const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
						for (const material of list) if ((material as THREE.MeshStandardMaterial)?.isMeshStandardMaterial) materials.push(material as THREE.MeshStandardMaterial);
					}
				});
				glb.root = root; glb.clips = gltf.animations ?? []; glb.mixer = glb.clips.length ? new THREE.AnimationMixer(root) : null; glb.fileName = fileName; glb.bones = bones; glb.materials = materials; glb.targets = discoverRigTargets(bones); glb.loadingUrl = "";
				for (const material of materials) glb.materialBase.set(material, { color: material.color.clone(), metalness: material.metalness, roughness: material.roughness });
				for (const bone of bones) glb.boneBase.set(bone, bone.quaternion.clone());
				performerRoot.add(root);
				lastGlbUrl = url; lastAnimation = "";
				const payload: VisualModelInfo = { type: "visual-model-info", timestamp: Date.now(), fileName, bones: bones.map((bone) => bone.name || "Unnamed Bone"), animations: glb.clips.map((clip) => clip.name || "Animation"), meshes };
				channel.postMessage(payload);
			}, undefined, (caught: unknown) => {
				glb.loadingUrl = "";
				const message = caught instanceof Error ? caught.message : `Could not load ${fileName || "GLB model"}.`;
				channel.postMessage({ type: "visual-output-error", timestamp: Date.now(), message } satisfies VisualOutputError);
			});
		};

		const applyGlbAnimation = (currentScene: VisualSceneState) => {
			if (!glb.mixer || !currentScene.object.animation || currentScene.object.animation === lastAnimation) return;
			const clip = glb.clips.find((candidate) => candidate.name === currentScene.object.animation);
			if (!clip) return;
			glb.activeAction?.fadeOut(0.18);
			const action = glb.mixer.clipAction(clip); action.reset(); action.timeScale = currentScene.object.animationSpeed; action.fadeIn(0.18); action.play();
			glb.activeAction = action; lastAnimation = currentScene.object.animation;
		};

		const render = (now: number) => {
			if (disposed) return;
			animationFrame = requestAnimationFrame(render);
			const sinceLast = now - lastRenderAt;
			if (lastRenderAt && sinceLast < FRAME_INTERVAL_MS - 0.35) return;
			lastRenderAt = now - (sinceLast % FRAME_INTERVAL_MS);
			const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000)); lastTime = now;
			const currentScene = sceneRef.current;
			const currentAudio = audioRef.current;
			const currentTransport = transportRef.current;
			const objectLayer = currentScene.layers.find((layer) => layer.type === "object");
			const particlesLayer = currentScene.layers.find((layer) => layer.type === "particles");
			const stageLayer = currentScene.layers.find((layer) => layer.type === "stage");
			const stageActive = !!stageLayer && visualLayerActive(stageLayer, currentTransport.positionSeconds);
			const perfConfig = currentScene.performance;
			if (performanceRuntime.active && now - performanceRuntime.startedAt >= performanceRuntime.durationMs) {
				performanceRuntime.active = null;
				performanceRuntime.source = "idle";
			}
			if (!performanceRuntime.manualInitialized) {
				performanceRuntime.manualSequence = perfConfig.manualCueSequence;
				performanceRuntime.manualInitialized = true;
			} else if (perfConfig.manualCueSequence !== performanceRuntime.manualSequence) {
				performanceRuntime.manualSequence = perfConfig.manualCueSequence;
				const manualCue = PERFORMANCE_BY_ID.get(perfConfig.manualCueId);
				if (manualCue) triggerPerformance(performanceRuntime, manualCue, perfConfig.manualCueStrength, "manual", now);
			}
			const transportDelta = currentTransport.positionSeconds - performanceRuntime.lastTransportPosition;
			if (currentTransport.playing && transportDelta >= 0 && transportDelta < 0.65) {
				const timelineCue = perfConfig.timelineCues
					.filter(cue => cue.time > performanceRuntime.lastTransportPosition && cue.time <= currentTransport.positionSeconds + 0.015)
					.sort((a,b)=>a.time-b.time)
					.at(-1);
				if (timelineCue) {
					const cue = PERFORMANCE_BY_ID.get(timelineCue.cueId);
					if (cue) triggerPerformance(performanceRuntime, cue, timelineCue.strength, "timeline", now);
				}
			}
			performanceRuntime.lastTransportPosition = currentTransport.positionSeconds;
			if (!performanceRuntime.active) {
				const autoCue = chooseAutoCue(currentScene, currentAudio, performanceRuntime, now);
				if (autoCue) triggerPerformance(performanceRuntime, autoCue, Math.max(0.35, perfConfig.directorIntensity), "auto", now);
			}
			const perfEnvelope = performanceWeight(now, performanceRuntime);
			const activeCue = performanceRuntime.active;
			const cueWeight = perfEnvelope.weight;
			const cueStrength = performanceRuntime.strength;
			const cueShake = (activeCue?.shake ?? 0) * cueWeight * cueStrength * perfConfig.cameraShake + (activeCue?.impact ?? 0) * perfEnvelope.impact * perfConfig.impactStrength * 0.45;
			const baseCameraDistance = Math.max(3.0, currentScene.object.cameraDistance);
			const nextFov = Math.max(20, Math.min(100, currentScene.object.cameraFov));
			if (Math.abs(camera.fov - nextFov) > 0.01) { camera.fov = nextFov; camera.updateProjectionMatrix(); }
			camera.position.x = Math.sin(now * 0.071) * cueShake * 0.075;
			camera.position.y = currentScene.object.cameraHeight + Math.cos(now * 0.083) * cueShake * 0.052;
			camera.position.z = baseCameraDistance + Math.sin(now * 0.097) * cueShake * 0.035;
			camera.lookAt(0, currentScene.object.cameraTargetY, 0);

			const stage = currentScene.stage;
			const sunReact = visualAudioValue(stage.sunSource, currentAudio) * stage.sunAmount;
			const keyReact = visualAudioValue(stage.keySource, currentAudio) * stage.keyAmount;
			const rimReact = visualAudioValue(stage.rimSource, currentAudio) * stage.rimAmount;
			const fillReact = visualAudioValue(stage.fillSource, currentAudio) * stage.fillAmount;
			const fogReact = visualAudioValue(stage.fogSource, currentAudio) * stage.fogAmount;
			const cueFog = (activeCue?.fog ?? 0) * cueWeight * cueStrength * perfConfig.fogBurst;
			const cueGlow = (activeCue?.glow ?? 0) * cueWeight * cueStrength;
			const cueFlash = (activeCue?.flash ?? 0) * (0.35 + perfEnvelope.impact * 0.65) * cueWeight * cueStrength;
			ambient.intensity = stageActive ? stage.ambientIntensity * (1 + cueFlash * 0.75) : 0;
			sun.color.set(stage.sunColor); sun.intensity = stageActive ? stage.sunIntensity * (1 + sunReact) : 0; sun.position.set(stage.sunX, stage.sunY, stage.sunZ);
			key.color.set(stage.keyColor); key.intensity = stageActive ? stage.keyIntensity * (1 + keyReact + cueFlash * 1.7) : 0; key.position.set(stage.keyX, stage.keyY, stage.keyZ); key.angle = THREE.MathUtils.degToRad(Math.max(5, Math.min(88, stage.keyAngle))); key.penumbra = Math.max(0, Math.min(1, stage.keyPenumbra)); key.distance = Math.max(0, stage.keyDistance); key.target.position.copy(performerRoot.position);
			rim.color.set(stage.rimColor); rim.intensity = stageActive ? stage.rimIntensity * (1 + rimReact) : 0; rim.position.set(stage.rimX, stage.rimY, stage.rimZ);
			floorLight.color.set(stage.fillColor); floorLight.intensity = stageActive ? stage.fillIntensity * (1 + fillReact) : 0; floorLight.position.set(stage.fillX, stage.fillY, stage.fillZ);
			renderer.toneMappingExposure = Math.max(0.2, stage.exposure);
			renderer.shadowMap.enabled = stageActive && stage.shadows && !embedded;
			key.castShadow = stageActive && stage.shadows && !embedded;
			floor.visible = stageActive && stage.floorVisible;
			floor.scale.setScalar(Math.max(0.2, stage.floorSize / 40));
			floorMaterial.color.set(stage.floorColor);
			if (stageActive && stage.fogEnabled) {
				stageFog.color.set(stage.fogColor);
				stageFog.near = Math.max(0.1, stage.fogNear);
				stageFog.far = Math.max(stageFog.near + 0.5, stage.fogFar - fogReact * 6 - cueFog * 8);
				threeScene.fog = stageFog;
			} else {
				threeScene.fog = null;
			}
			bloomPass.strength = stageActive ? (stage.bloomStrength + cueGlow * 0.55 + cueFlash * 0.35) * (embedded ? 0.45 : 1) : 0;
			bloomPass.radius = Math.max(0, Math.min(1, stage.bloomRadius));
			bloomPass.threshold = Math.max(0, Math.min(1, stage.bloomThreshold));
			performerRoot.position.set(
				currentScene.object.positionX,
				currentScene.object.positionY + (activeCue?.rootY ?? 0) * cueWeight * cueStrength,
				currentScene.object.positionZ + (activeCue?.rootZ ?? 0) * cueWeight * cueStrength,
			);
			performerRoot.rotation.set(currentScene.object.rotationX, currentScene.object.rotationY + now / 1000 * currentScene.object.rotationSpeed, currentScene.object.rotationZ);

			const manualTest = Math.max(0, Math.min(1, currentScene.object.testSignal));
			const rawBody = reactiveValue(Math.max(visualAudioValue(currentScene.object.bodySource, currentAudio), manualTest), currentScene);
			const rawArms = reactiveValue(Math.max(visualAudioValue(currentScene.object.armSource, currentAudio), manualTest), currentScene);
			const rawPulse = reactiveValue(Math.max(visualAudioValue(currentScene.object.pulseSource, currentAudio), manualTest), currentScene);
			smoothBody = envelope(smoothBody, rawBody, currentScene.object.attack, currentScene.object.release);
			smoothArms = envelope(smoothArms, rawArms, currentScene.object.attack, currentScene.object.release);
			smoothPulse = envelope(smoothPulse, rawPulse, currentScene.object.attack, currentScene.object.release);
			const bodyMotion = smoothBody * currentScene.object.bodyAmount;
			const armMotion = smoothArms * currentScene.object.armAmount;
			const scale = currentScene.object.baseScale * (1 + smoothPulse * currentScene.object.pulseAmount * 0.45);
			performerRoot.scale.setScalar(scale);
			springVelocity += (currentAudio.kick * currentScene.object.springAmount * 1.6 - springPosition * 8.0) * dt;
			springVelocity *= Math.pow(0.18, dt);
			springPosition += springVelocity * dt;
			const glow = Math.max(0, Math.max(visualAudioValue(currentScene.object.glowSource, currentAudio), manualTest) * currentScene.object.glowAmount + currentAudio.kick * 0.75 + cueGlow);

			mannequin.root.visible = currentScene.object.model === "mannequin" && !!objectLayer && visualLayerActive(objectLayer, currentTransport.positionSeconds);
			crystal.root.visible = currentScene.object.model === "crystal" && !!objectLayer && visualLayerActive(objectLayer, currentTransport.positionSeconds);
			if (glb.root) glb.root.visible = currentScene.object.model === "glb" && !!objectLayer && visualLayerActive(objectLayer, currentTransport.positionSeconds);
			if (currentScene.object.model === "glb" && currentScene.object.modelUrl) loadGlb(currentScene.object.modelUrl, currentScene.object.modelFileName);
			if (mannequin.root.visible) {
				applyPose(mannequin, currentScene, bodyMotion, armMotion, now / 1000, springPosition);
				applyCueToMannequin(mannequin, activeCue, cueWeight, cueStrength, perfConfig.headTracking ? perfConfig.headTrackAmount : 0);
			}
			if (crystal.root.visible) { crystal.root.rotation.x = now * 0.00012 + bodyMotion * 0.25; crystal.root.rotation.y = now * 0.00018 + armMotion * 0.18; }
			for (const material of [...mannequin.materials, ...crystal.materials, ...glb.materials]) { material.emissive.set(currentScene.object.emissiveColor); material.emissiveIntensity = 0.10 + glow * 0.72; }
			for (const material of glb.materials) {
				const base = glb.materialBase.get(material);
				if (currentScene.object.materialOverride) {
					material.color.set(currentScene.object.materialTint);
					material.metalness = Math.max(0, Math.min(1, currentScene.object.materialMetalness));
					material.roughness = Math.max(0, Math.min(1, currentScene.object.materialRoughness));
				} else if (base) {
					material.color.copy(base.color);
					material.metalness = base.metalness;
					material.roughness = base.roughness;
				}
			}

			if (glb.root && currentScene.object.model === "glb") {
				for (const [bone, base] of glb.boneBase) bone.quaternion.copy(base);
				applyGlbAnimation(currentScene);
				if (glb.activeAction) glb.activeAction.timeScale = currentScene.object.animationSpeed;
				glb.mixer?.update(dt);
				const bodyBones = glb.bones.filter((bone) => /spine|chest|hips|pelvis/i.test(bone.name)).slice(0, 5);
				const headBones = glb.bones.filter((bone) => /head|neck/i.test(bone.name)).slice(0, 3);
				for (const bone of bodyBones) bone.rotateZ(bodyMotion * 0.10);
				glb.targets.leftUpperArm?.rotateZ(-armMotion * 0.14);
				glb.targets.rightUpperArm?.rotateZ(armMotion * 0.14);
				for (const bone of headBones) bone.rotateZ(springPosition * 0.12);
				applyCueToTargets(glb.targets, activeCue, cueWeight, cueStrength, perfConfig.headTracking ? perfConfig.headTrackAmount : 0);
			}

			threeScene.updateMatrixWorld(true);
			const leftHandObject = currentScene.object.model === "glb" && glb.root ? glb.targets.leftHand : mannequin.leftHand;
			const rightHandObject = currentScene.object.model === "glb" && glb.root ? glb.targets.rightHand : mannequin.rightHand;
			const leftHandPosition = new THREE.Vector3();
			const rightHandPosition = new THREE.Vector3();
			if (leftHandObject) leftHandObject.getWorldPosition(leftHandPosition); else performerRoot.localToWorld(leftHandPosition.set(-1.2, 0.8, 0));
			if (rightHandObject) rightHandObject.getWorldPosition(rightHandPosition); else performerRoot.localToWorld(rightHandPosition.set(1.2, 0.8, 0));
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

			grid.visible = currentScene.grid.visible;
			for (const material of gridMaterials) material.opacity = Math.max(0, Math.min(1, currentScene.grid.intensity + visualAudioValue(currentScene.grid.source, currentAudio) * currentScene.grid.amount * 0.15));
			grid.scale.setScalar(Math.max(0.4, currentScene.grid.size / 14));

			particleRuntime.points.visible = !!particlesLayer && visualLayerActive(particlesLayer, currentTransport.positionSeconds);
			if (particleRuntime.points.visible) {
				const particleAudio = visualAudioValue(currentScene.particles.source, currentAudio) * currentScene.particles.amount;
				const count = Math.max(0, Math.min(MAX_PARTICLES, Math.round(currentScene.particles.count * (embedded ? 0.72 : 1))));
				particleRuntime.geometry.setDrawRange(0, count);
				particleRuntime.material.opacity = visualLayerOpacityAt(particlesLayer!, currentTransport.positionSeconds);
				particleRuntime.material.size = Math.max(0.006, currentScene.particles.size * 0.008 * (1 + particleAudio * 0.3));
				const speed = Math.max(0.01, currentScene.particles.speed * (0.7 + particleAudio * 1.8));
				for (let i = 0; i < count; i++) {
					const seedLife = particleRuntime.seeds[i * 4 + 3];
					const life = (seedLife + now / 1000 * speed * 0.12) % 1;
					setParticlePosition(i, currentScene, particleRuntime.positions, particleRuntime.seeds, life, now / 1000, particleAudio);
				}
				(particleRuntime.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
			}

			composer.render();
			drawSpectrum(spectrum2d, smoothedSpectrum, currentScene, currentAudio, currentTransport, renderWidth, renderHeight);

			if (currentTransport.transitionSequence != null && currentTransport.transitionSequence !== lastTransitionSequence) lastTransitionSequence = currentTransport.transitionSequence;
			frameCounter++;
			const elapsed = now - statsStart;
			if (elapsed >= 1000) {
				const fps = frameCounter * 1000 / elapsed;
				channel.postMessage({ type: "visual-output-stats", timestamp: Date.now(), fps, frameTimeMs: fps > 0 ? 1000 / fps : 0, width: renderWidth, height: renderHeight, webgl: "WebGL2", renderer: getRendererName(renderer) } satisfies VisualOutputStats);
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
			clearGlb(); disposeObject3D(mannequin.root); disposeObject3D(crystal.root);
			particleRuntime.geometry.dispose(); particleRuntime.material.dispose(); grid.geometry.dispose(); gridMaterials.forEach((material: THREE.Material) => material.dispose());
			for (const line of [...lightning.left, ...lightning.right]) { line.geometry.dispose(); (line.material as THREE.Material).dispose(); }
			shockwave.geometry.dispose(); shockwaveMaterial.dispose();
			floor.geometry.dispose(); floorMaterial.dispose(); composer.dispose(); renderer.dispose(); channel.close();
		};
	}, [embedded, obsMode, renderHeight, renderWidth]);

	const mediaLayers = useMemo(() => scene.layers.filter((layer) => layer.type === "media" && layer.visible && layer.mediaUrl), [scene.layers]);
	const nowPlayingLayer = scene.layers.find((layer) => layer.type === "nowPlaying");
	const objectLayer = scene.layers.find((layer) => layer.type === "object");
	const flashOpacity = Math.min(0.16, (objectLayer?.opacity ?? 0) * audioState.kick * 0.12);
	const transitionProgress = Math.max(0, Math.min(1, transport.transitionProgress ?? 0));
	const transitionStyle = transitionOverlayStyle(transport.visualTransition ?? "cut", transitionProgress);
	const nowOpacity = nowPlayingLayer ? visualLayerOpacityAt(nowPlayingLayer, transport.positionSeconds) : 0;

	return (
		<main className={`fixed inset-0 grid place-items-center overflow-hidden bg-black select-none ${obsMode ? "cursor-none" : ""}`} aria-label="YSong Visual Output">
			<div className="relative overflow-hidden" style={{ background: scene.output.background, width: "min(100vw, calc(100vh * 16 / 9))", height: "min(100vh, calc(100vw * 9 / 16))" }}>
				{mediaLayers.map((layer) => <MediaLayer key={layer.id} layer={layer} transport={transport} />)}
				<div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(63,89,180,.11),transparent_42%),linear-gradient(to_bottom,rgba(0,0,0,.02),rgba(0,0,0,.30))]" />
				<canvas ref={threeCanvasRef} width={renderWidth} height={renderHeight} className="absolute inset-0 h-full w-full" />
				<canvas ref={spectrumRef} width={renderWidth} height={renderHeight} className="absolute inset-0 h-full w-full" />
				<div className="pointer-events-none absolute inset-0 bg-white" style={{ opacity: flashOpacity }} />
				{nowPlayingLayer && nowOpacity > 0 ? (
					<div className="absolute text-white" style={{
						left: `${scene.nowPlaying.positionX * 100}%`, top: `${scene.nowPlaying.positionY * 100}%`, width: `${scene.nowPlaying.width * 100}%`,
						opacity: nowOpacity, transform: "translateY(-50%)", textAlign: scene.nowPlaying.align, textShadow: "0 2px 24px rgba(0,0,0,.8)", fontSize: `${scene.nowPlaying.fontScale}em`,
					}}>
						<div className="text-[clamp(8px,0.65vw,13px)] font-bold uppercase tracking-[0.34em] text-violet-200/80">Now Playing</div>
						<div className="mt-[0.5vw] truncate text-[clamp(22px,2.3vw,50px)] font-semibold tracking-tight">{scene.nowPlaying.title}</div>
						<div className="mt-[0.25vw] truncate text-[clamp(11px,1vw,22px)] text-white/75">{scene.nowPlaying.artist}{scene.nowPlaying.album ? ` · ${scene.nowPlaying.album}` : ""}</div>
					</div>
				) : null}
				<div className="pointer-events-none absolute inset-0" style={transitionStyle} />
				<div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/[0.03]" />
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

function MediaLayer({ layer, transport }: { layer: VisualLayer; transport: VisualTransportState }) {
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const active = visualLayerActive(layer, transport.positionSeconds);
	const opacity = active ? visualLayerOpacityAt(layer, transport.positionSeconds) : 0;
	useEffect(() => {
		const video = videoRef.current;
		if (!video || layer.mediaKind !== "video") return;
		const timeline = layer.timeline ?? { start: 0, duration: 0, trimIn: 0, trimOut: 0, fadeIn: 0, fadeOut: 0 };
		video.playbackRate = Math.max(0.25, Math.min(4, layer.speed ?? 1));
		if (!active) { video.pause(); return; }
		const local = Math.max(0, transport.positionSeconds - timeline.start);
		const sourceDuration = Math.max(0, layer.sourceDuration ?? video.duration ?? 0);
		const sourceOut = timeline.trimOut > timeline.trimIn ? Math.min(sourceDuration || timeline.trimOut, timeline.trimOut) : sourceDuration;
		const sourceSpan = Math.max(0.01, sourceOut - timeline.trimIn);
		let desired = timeline.trimIn + local * video.playbackRate;
		if (layer.loop !== false && sourceSpan > 0.05) desired = timeline.trimIn + ((desired - timeline.trimIn) % sourceSpan);
		else if (sourceOut > timeline.trimIn) desired = Math.min(sourceOut - 0.001, desired);
		if (Number.isFinite(desired) && Math.abs(video.currentTime - desired) > 0.18) {
			try { video.currentTime = Math.max(0, desired); } catch { /* metadata may not be ready yet */ }
		}
		if (transport.playing) void video.play().catch(() => {}); else video.pause();
	}, [active, layer.loop, layer.mediaKind, layer.sourceDuration, layer.speed, layer.timeline, transport.playing, transport.positionSeconds]);
	const blend = layer.blendMode === "add" ? "plus-lighter" : layer.blendMode === "screen" ? "screen" : layer.blendMode === "multiply" ? "multiply" : "normal";
	const style = { opacity, objectFit: layer.fit ?? "cover", display: active ? "block" : "none", mixBlendMode: blend } as const;
	if (layer.mediaKind === "video") return <video ref={videoRef} src={layer.mediaUrl} muted playsInline preload="auto" className="absolute inset-0 h-full w-full" style={style} />;
	return <img src={layer.mediaUrl} alt="" className="absolute inset-0 h-full w-full" style={style} />;
}

function drawSpectrum(ctx: CanvasRenderingContext2D, smooth: Float32Array, scene: VisualSceneState, audio: VisualAudioFrame, transport: VisualTransportState, width: number, height: number) {
	ctx.clearRect(0, 0, width, height);
	const layer = scene.layers.find((candidate) => candidate.type === "spectrum");
	if (!layer || !visualLayerActive(layer, transport.positionSeconds)) return;
	const source = audio.spectrum.length ? audio.spectrum : ZERO_AUDIO.spectrum;
	const smoothing = Math.max(0, Math.min(0.97, scene.spectrum.smoothing));
	for (let i = 0; i < smooth.length; i++) smooth[i] = smooth[i] * smoothing + (source[i] ?? 0) * (1 - smoothing);
	const opacity = visualLayerOpacityAt(layer, transport.positionSeconds);
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
