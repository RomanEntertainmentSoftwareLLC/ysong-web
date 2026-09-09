export type VisualAudioSource = "bass" | "mids" | "highs" | "energy" | "kick" | "rms" | "peak";
export type VisualLayerType = "media" | "particles" | "spectrum" | "object" | "nowPlaying" | "stage";
export type VisualMediaKind = "image" | "video" | "model";
export type VisualObjectModel = "mannequin" | "crystal" | "glb";
export type VisualPoseMode = "idle" | "reach" | "cruciform";
export type VisualPerformanceDirectorMode = "balanced" | "aggressive" | "ethereal" | "emotional";
export type VisualPerformanceLightning = "none" | "left" | "right" | "dual";

export type VisualPerformanceTimelineCue = {
	id: string;
	time: number;
	cueId: string;
	strength: number;
};

export type VisualPerformanceCue = {
	id: string;
	label: string;
	category: "idle" | "gesture" | "emotion" | "impact" | "energy";
	duration: number;
	cooldown: number;
	bodyLean?: number;
	bodyTwist?: number;
	rootY?: number;
	rootZ?: number;
	headPitch?: number;
	headYaw?: number;
	headRoll?: number;
	leftArmX?: number;
	rightArmX?: number;
	leftArmZ?: number;
	rightArmZ?: number;
	leftElbowZ?: number;
	rightElbowZ?: number;
	lightning?: VisualPerformanceLightning;
	impact?: number;
	flash?: number;
	shake?: number;
	fog?: number;
	glow?: number;
	animationHint?: string;
};
export type VisualParticleEmitter = "box" | "sphere" | "ring" | "fountain" | "tunnel";
export type VisualSpectrumMode = "bars" | "smoothLine" | "mirrored" | "centerMirror" | "radial" | "halo" | "arc" | "dualArc" | "ringBars" | "oscilloscope" | "filledWave" | "depthBars";
export type VisualTextAlign = "left" | "center" | "right";
export type VisualBlendMode = "normal" | "screen" | "add" | "multiply";
export type VisualTimelineSnapMode = "seconds" | "beat" | "bar";

export type VisualMediaAsset = {
	id: string;
	name: string;
	kind: "image" | "video";
	url: string;
	duration: number;
};

export type VisualTimelineMarker = {
	id: string;
	time: number;
	label: string;
};

export type VisualLayerTimeline = {
	start: number;
	duration: number;
	trimIn: number;
	trimOut: number;
	fadeIn: number;
	fadeOut: number;
};

export type VisualLayer = {
	id: string;
	type: VisualLayerType;
	name: string;
	visible: boolean;
	locked?: boolean;
	opacity: number;
	blendMode?: VisualBlendMode;
	mediaKind?: VisualMediaKind;
	mediaUrl?: string;
	fileName?: string;
	fit?: "cover" | "contain";
	loop?: boolean;
	speed?: number;
	sourceDuration?: number;
	timeline?: VisualLayerTimeline;
};

export type VisualSceneState = {
	version: 7;
	updatedAt: number;
	output: {
		width: 1920;
		height: 1080;
		fps: 60;
		background: string;
	};
	timeline: {
		durationSeconds: number;
		zoom: number;
		snapSeconds: number;
		snapMode: VisualTimelineSnapMode;
		markers: VisualTimelineMarker[];
	};
	assets: VisualMediaAsset[];
	layers: VisualLayer[];
	object: {
		model: VisualObjectModel;
		modelUrl: string;
		modelFileName: string;
		animation: string;
		animationSpeed: number;
		pose: VisualPoseMode;
		positionX: number;
		positionY: number;
		positionZ: number;
		rotationX: number;
		rotationY: number;
		rotationZ: number;
		baseScale: number;
		rotationSpeed: number;
		idleAmount: number;
		testSignal: number;
		pulseSource: VisualAudioSource;
		pulseAmount: number;
		glowSource: VisualAudioSource;
		glowAmount: number;
		emissiveColor: string;
		bodySource: VisualAudioSource;
		bodyAmount: number;
		armSource: VisualAudioSource;
		armAmount: number;
		springAmount: number;
		sensitivity: number;
		deadZone: number;
		attack: number;
		release: number;
		cameraDistance: number;
		cameraFov: number;
		cameraHeight: number;
		cameraTargetY: number;
		materialOverride: boolean;
		materialTint: string;
		materialMetalness: number;
		materialRoughness: number;
	};
	performance: {
		autoDirector: boolean;
		directorMode: VisualPerformanceDirectorMode;
		directorIntensity: number;
		minimumCooldown: number;
		manualCueId: string;
		manualCueSequence: number;
		manualCueStrength: number;
		headTracking: boolean;
		headTrackAmount: number;
		lightningColor: string;
		lightningIntensity: number;
		lightningBranches: number;
		impactStrength: number;
		fogBurst: number;
		cameraShake: number;
		screenShockwave: boolean;
		timelineCues: VisualPerformanceTimelineCue[];
	};
	grid: {
		visible: boolean;
		size: number;
		intensity: number;
		source: VisualAudioSource;
		amount: number;
	};
	stage: {
		floorVisible: boolean;
		floorSize: number;
		floorColor: string;
		fogEnabled: boolean;
		fogColor: string;
		fogNear: number;
		fogFar: number;
		fogSource: VisualAudioSource;
		fogAmount: number;
		ambientIntensity: number;
		sunColor: string;
		sunIntensity: number;
		sunX: number;
		sunY: number;
		sunZ: number;
		sunSource: VisualAudioSource;
		sunAmount: number;
		keyColor: string;
		keyIntensity: number;
		keyX: number;
		keyY: number;
		keyZ: number;
		keyAngle: number;
		keyPenumbra: number;
		keyDistance: number;
		keySource: VisualAudioSource;
		keyAmount: number;
		rimColor: string;
		rimIntensity: number;
		rimX: number;
		rimY: number;
		rimZ: number;
		rimSource: VisualAudioSource;
		rimAmount: number;
		fillColor: string;
		fillIntensity: number;
		fillX: number;
		fillY: number;
		fillZ: number;
		fillSource: VisualAudioSource;
		fillAmount: number;
		shadows: boolean;
		exposure: number;
		bloomStrength: number;
		bloomRadius: number;
		bloomThreshold: number;
	};
	particles: {
		count: number;
		size: number;
		source: VisualAudioSource;
		amount: number;
		depth: number;
		spread: number;
		speed: number;
		emitter: VisualParticleEmitter;
		gravity: number;
		turbulence: number;
		orbit: number;
		positionX: number;
		positionY: number;
		positionZ: number;
	};
	spectrum: {
		mode: VisualSpectrumMode;
		preset: string;
		height: number;
		thickness: number;
		smoothing: number;
		positionX: number;
		positionY: number;
		scale: number;
		rotation: number;
		glow: number;
	};
	nowPlaying: {
		title: string;
		artist: string;
		album: string;
		positionX: number;
		positionY: number;
		width: number;
		fontScale: number;
		align: VisualTextAlign;
	};
};

export const PERFORMANCE_BEHAVIORS: VisualPerformanceCue[] = [
	{ id: "still", label: "Still Watch", category: "idle", duration: 2.4, cooldown: 2.5 },
	{ id: "breathe", label: "Slow Breathe", category: "idle", duration: 2.8, cooldown: 2.5, bodyLean: 0.08, glow: 0.08 },
	{ id: "slow-sway", label: "Slow Sway", category: "idle", duration: 3.2, cooldown: 3.0, bodyTwist: 0.16, headRoll: -0.08 },
	{ id: "watch-audience", label: "Watch Audience", category: "idle", duration: 2.4, cooldown: 2.2, headPitch: -0.05, rootZ: 0.18 },
	{ id: "look-down", label: "Look Down", category: "emotion", duration: 2.0, cooldown: 1.8, headPitch: 0.42, bodyLean: 0.12 },
	{ id: "look-up", label: "Look Up", category: "emotion", duration: 2.0, cooldown: 1.8, headPitch: -0.42, bodyLean: -0.08 },
	{ id: "look-left", label: "Look Left", category: "gesture", duration: 1.4, cooldown: 1.2, headYaw: 0.58 },
	{ id: "look-right", label: "Look Right", category: "gesture", duration: 1.4, cooldown: 1.2, headYaw: -0.58 },
	{ id: "tilt-left", label: "Head Tilt Left", category: "emotion", duration: 1.7, cooldown: 1.4, headRoll: 0.38, headYaw: 0.12 },
	{ id: "tilt-right", label: "Head Tilt Right", category: "emotion", duration: 1.7, cooldown: 1.4, headRoll: -0.38, headYaw: -0.12 },
	{ id: "nod", label: "Nod", category: "gesture", duration: 0.9, cooldown: 1.1, headPitch: 0.38 },
	{ id: "head-snap", label: "Head Snap", category: "impact", duration: 0.55, cooldown: 1.2, headYaw: 0.72, headRoll: -0.18, shake: 0.12 },
	{ id: "curious-lean", label: "Curious Lean", category: "emotion", duration: 2.1, cooldown: 1.8, bodyLean: -0.18, bodyTwist: 0.16, headRoll: 0.24, rootZ: 0.28 },
	{ id: "sorrow-curl", label: "Sorrow Curl", category: "emotion", duration: 2.8, cooldown: 2.4, bodyLean: 0.38, headPitch: 0.42, leftArmZ: -0.22, rightArmZ: 0.22 },
	{ id: "mourn", label: "Mourn", category: "emotion", duration: 3.0, cooldown: 2.5, bodyLean: 0.28, headPitch: 0.34, leftElbowZ: -0.42, rightElbowZ: 0.42, fog: 0.28 },
	{ id: "rage-build", label: "Rage Build", category: "emotion", duration: 2.0, cooldown: 1.8, bodyLean: -0.18, leftArmZ: 0.28, rightArmZ: -0.28, glow: 0.85, fog: 0.22 },
	{ id: "rage-release", label: "Rage Release", category: "impact", duration: 0.85, cooldown: 1.6, bodyLean: -0.34, leftArmZ: 0.92, rightArmZ: -0.92, impact: 0.55, flash: 0.28, shake: 0.55, glow: 1.1 },
	{ id: "proud-stance", label: "Proud Stance", category: "emotion", duration: 2.4, cooldown: 2.0, bodyLean: -0.12, headPitch: -0.12, leftArmZ: 0.18, rightArmZ: -0.18 },
	{ id: "protective", label: "Protective Pose", category: "emotion", duration: 2.2, cooldown: 2.0, bodyLean: 0.12, leftArmX: -0.85, rightArmX: -0.85, leftArmZ: -0.36, rightArmZ: 0.36 },
	{ id: "defensive-raise", label: "Defensive Raise", category: "gesture", duration: 1.7, cooldown: 1.5, leftArmX: -1.0, rightArmX: -1.0, leftArmZ: 0.38, rightArmZ: -0.38 },
	{ id: "open-arms", label: "Open Arms", category: "gesture", duration: 2.2, cooldown: 1.8, leftArmZ: 1.22, rightArmZ: -1.22, bodyLean: -0.12, glow: 0.28 },
	{ id: "cruciform", label: "Cruciform", category: "gesture", duration: 2.8, cooldown: 2.3, leftArmZ: 1.56, rightArmZ: -1.56, headPitch: -0.08 },
	{ id: "raise-hands", label: "Raise Hands", category: "gesture", duration: 2.0, cooldown: 1.7, leftArmZ: 2.15, rightArmZ: -2.15, leftElbowZ: -0.18, rightElbowZ: 0.18, glow: 0.35 },
	{ id: "lower-hands", label: "Lower Hands", category: "gesture", duration: 1.8, cooldown: 1.5, leftArmZ: 0.12, rightArmZ: -0.12, headPitch: 0.08 },
	{ id: "beckon-left", label: "Beckon Left", category: "gesture", duration: 1.5, cooldown: 1.4, leftArmX: -1.2, leftArmZ: 0.72, leftElbowZ: -0.95 },
	{ id: "beckon-right", label: "Beckon Right", category: "gesture", duration: 1.5, cooldown: 1.4, rightArmX: -1.2, rightArmZ: -0.72, rightElbowZ: 0.95 },
	{ id: "point-left", label: "Point Left", category: "gesture", duration: 1.4, cooldown: 1.3, leftArmZ: 1.46, leftElbowZ: 0.06, headYaw: 0.34 },
	{ id: "point-right", label: "Point Right", category: "gesture", duration: 1.4, cooldown: 1.3, rightArmZ: -1.46, rightElbowZ: -0.06, headYaw: -0.34 },
	{ id: "reach-left", label: "Reach Left", category: "gesture", duration: 1.8, cooldown: 1.5, leftArmX: -1.4, leftArmZ: 0.68, leftElbowZ: -0.22, bodyTwist: 0.18 },
	{ id: "reach-right", label: "Reach Right", category: "gesture", duration: 1.8, cooldown: 1.5, rightArmX: -1.4, rightArmZ: -0.68, rightElbowZ: 0.22, bodyTwist: -0.18 },
	{ id: "reach-camera", label: "Reach At Camera", category: "gesture", duration: 1.9, cooldown: 2.0, rootZ: 1.15, bodyLean: -0.28, leftArmX: -1.55, rightArmX: -1.55, leftArmZ: 0.38, rightArmZ: -0.38, glow: 0.25, animationHint: "Reach" },
	{ id: "grab-camera", label: "Grab Audience", category: "impact", duration: 1.35, cooldown: 2.3, rootZ: 1.72, bodyLean: -0.42, leftArmX: -1.72, rightArmX: -1.72, leftArmZ: 0.18, rightArmZ: -0.18, impact: 0.24, shake: 0.22, glow: 0.45, animationHint: "Reach" },
	{ id: "push-glass", label: "Push Against Glass", category: "impact", duration: 2.0, cooldown: 2.3, rootZ: 1.55, bodyLean: -0.24, leftArmX: -1.62, rightArmX: -1.62, leftArmZ: 0.16, rightArmZ: -0.16, fog: 0.16, glow: 0.22, animationHint: "Reach" },
	{ id: "pound-screen", label: "Pound Screen", category: "impact", duration: 0.82, cooldown: 2.1, rootZ: 2.05, bodyLean: -0.52, rightArmX: -1.82, rightArmZ: -0.18, rightElbowZ: 0.08, impact: 1.0, flash: 0.72, shake: 1.0, fog: 0.55, glow: 0.85 },
	{ id: "double-pound", label: "Double Pound", category: "impact", duration: 1.05, cooldown: 2.7, rootZ: 1.9, bodyLean: -0.48, leftArmX: -1.78, rightArmX: -1.78, impact: 1.0, flash: 0.88, shake: 1.0, fog: 0.7, glow: 1.0 },
	{ id: "recoil", label: "Impact Recoil", category: "impact", duration: 0.72, cooldown: 1.1, rootZ: -0.52, bodyLean: 0.4, headPitch: -0.22, shake: 0.34 },
	{ id: "stagger", label: "Stagger", category: "impact", duration: 1.1, cooldown: 1.4, rootZ: -0.34, bodyLean: 0.26, bodyTwist: 0.38, headRoll: 0.22, shake: 0.22 },
	{ id: "collapse", label: "Collapse", category: "emotion", duration: 2.4, cooldown: 3.0, rootY: -1.35, bodyLean: 0.78, headPitch: 0.58, fog: 0.35 },
	{ id: "rise", label: "Rise", category: "energy", duration: 2.4, cooldown: 2.7, rootY: 0.65, bodyLean: -0.22, headPitch: -0.25, glow: 0.78, fog: 0.28 },
	{ id: "bow", label: "Bow", category: "gesture", duration: 2.0, cooldown: 2.0, bodyLean: 0.72, headPitch: 0.34, animationHint: "Bow" },
	{ id: "wave-left", label: "Wave Left", category: "gesture", duration: 1.8, cooldown: 1.6, leftArmZ: 1.72, leftElbowZ: -0.72, animationHint: "Wave" },
	{ id: "wave-right", label: "Wave Right", category: "gesture", duration: 1.8, cooldown: 1.6, rightArmZ: -1.72, rightElbowZ: 0.72, animationHint: "Wave" },
	{ id: "scream", label: "Scream", category: "emotion", duration: 1.45, cooldown: 2.0, bodyLean: -0.28, headPitch: -0.55, leftArmZ: 0.78, rightArmZ: -0.78, glow: 1.0, fog: 0.38, shake: 0.15 },
	{ id: "laugh", label: "Laugh", category: "emotion", duration: 1.8, cooldown: 1.8, bodyLean: -0.16, headPitch: -0.18, headRoll: 0.12, leftArmZ: 0.32, rightArmZ: -0.32 },
	{ id: "shudder", label: "Shudder", category: "emotion", duration: 1.0, cooldown: 1.3, bodyTwist: 0.24, headRoll: 0.18, shake: 0.18, glow: 0.22 },
	{ id: "bass-possession", label: "Bass Possession", category: "energy", duration: 1.6, cooldown: 1.8, bodyLean: -0.36, bodyTwist: 0.34, headPitch: -0.32, glow: 1.05, fog: 0.3 },
	{ id: "high-ascension", label: "High Ascension", category: "energy", duration: 2.3, cooldown: 2.3, rootY: 0.55, headPitch: -0.42, leftArmZ: 1.22, rightArmZ: -1.22, glow: 1.2, fog: 0.35 },
	{ id: "lightning-left", label: "Lightning Left", category: "energy", duration: 0.95, cooldown: 1.7, leftArmZ: 1.42, leftArmX: -0.22, lightning: "left", flash: 0.28, shake: 0.18, glow: 1.2 },
	{ id: "lightning-right", label: "Lightning Right", category: "energy", duration: 0.95, cooldown: 1.7, rightArmZ: -1.42, rightArmX: -0.22, lightning: "right", flash: 0.28, shake: 0.18, glow: 1.2 },
	{ id: "dual-lightning", label: "Dual Lightning", category: "energy", duration: 1.15, cooldown: 2.3, leftArmZ: 1.4, rightArmZ: -1.4, lightning: "dual", flash: 0.5, shake: 0.38, fog: 0.45, glow: 1.5 },
	{ id: "storm-caller", label: "Storm Caller", category: "energy", duration: 2.0, cooldown: 3.0, leftArmZ: 2.05, rightArmZ: -2.05, lightning: "dual", flash: 0.36, shake: 0.25, fog: 0.8, glow: 1.75 },
	{ id: "energy-gather", label: "Gather Energy", category: "energy", duration: 2.1, cooldown: 2.2, leftArmX: -0.82, rightArmX: -0.82, leftElbowZ: -0.82, rightElbowZ: 0.82, glow: 1.35, fog: 0.38 },
	{ id: "energy-release", label: "Energy Release", category: "energy", duration: 0.9, cooldown: 2.0, leftArmZ: 1.28, rightArmZ: -1.28, impact: 0.48, flash: 0.58, shake: 0.45, glow: 1.5 },
	{ id: "angelic-open", label: "Angelic Open", category: "energy", duration: 2.6, cooldown: 2.5, leftArmZ: 1.46, rightArmZ: -1.46, headPitch: -0.26, rootY: 0.18, glow: 1.0, fog: 0.28 },
	{ id: "predator-stare", label: "Predator Stare", category: "emotion", duration: 2.3, cooldown: 2.2, rootZ: 0.48, headPitch: -0.05, bodyLean: -0.12, glow: 0.42 },
	{ id: "turn-away", label: "Turn Away", category: "emotion", duration: 2.0, cooldown: 1.9, bodyTwist: 0.72, headYaw: 0.72 },
	{ id: "return-stare", label: "Return Stare", category: "emotion", duration: 1.4, cooldown: 1.8, bodyTwist: -0.34, headYaw: -0.42, rootZ: 0.32, glow: 0.38 },
];

export const SPECTRUM_PRESETS: Array<{ id: string; label: string; mode: VisualSpectrumMode; patch: Partial<VisualSceneState["spectrum"]> }> = [
	{ id: "bars", label: "Bars", mode: "bars", patch: { height: 0.24, thickness: 0.72, smoothing: 0.72, glow: 0.75 } },
	{ id: "silk-line", label: "Silk Line", mode: "smoothLine", patch: { height: 0.22, smoothing: 0.84, glow: 1.25 } },
	{ id: "mirror", label: "Mirror", mode: "mirrored", patch: { height: 0.20, smoothing: 0.75, glow: 0.85 } },
	{ id: "center-mirror", label: "Center", mode: "centerMirror", patch: { height: 0.18, smoothing: 0.78, glow: 0.95 } },
	{ id: "radial", label: "Radial", mode: "radial", patch: { height: 0.22, thickness: 0.62, smoothing: 0.78, glow: 1.0, positionX: 0.5, positionY: 0.5, scale: 0.76 } },
	{ id: "seraph-halo", label: "Seraph Halo", mode: "halo", patch: { height: 0.14, thickness: 0.52, smoothing: 0.86, glow: 1.55, positionX: 0.5, positionY: 0.5, scale: 0.72 } },
	{ id: "arc", label: "Arc", mode: "arc", patch: { height: 0.19, thickness: 0.68, smoothing: 0.80, glow: 1.1, positionX: 0.5, positionY: 0.66, scale: 0.88 } },
	{ id: "dual-arc", label: "Dual Arc", mode: "dualArc", patch: { height: 0.18, thickness: 0.64, smoothing: 0.82, glow: 1.15, positionX: 0.5, positionY: 0.56, scale: 0.82 } },
	{ id: "ring-bars", label: "Ring Bars", mode: "ringBars", patch: { height: 0.18, thickness: 0.72, smoothing: 0.76, glow: 1.25, positionX: 0.5, positionY: 0.5, scale: 0.70 } },
	{ id: "scope", label: "Scope", mode: "oscilloscope", patch: { height: 0.16, smoothing: 0.58, glow: 1.3, positionY: 0.82 } },
	{ id: "filled", label: "Filled Wave", mode: "filledWave", patch: { height: 0.22, smoothing: 0.80, glow: 0.85 } },
	{ id: "depth-bars", label: "Depth Bars", mode: "depthBars", patch: { height: 0.25, thickness: 0.78, smoothing: 0.70, glow: 1.0 } },
	{ id: "neon-bars", label: "Neon Bars", mode: "bars", patch: { height: 0.34, thickness: 0.42, smoothing: 0.58, glow: 1.9, positionY: 0.88 } },
	{ id: "cathedral", label: "Cathedral", mode: "mirrored", patch: { height: 0.34, thickness: 0.34, smoothing: 0.82, glow: 1.4, positionY: 0.72, scale: 0.88 } },
	{ id: "razor-line", label: "Razor Line", mode: "smoothLine", patch: { height: 0.12, thickness: 0.28, smoothing: 0.92, glow: 1.75, positionY: 0.84 } },
	{ id: "ghost-mirror", label: "Ghost Mirror", mode: "centerMirror", patch: { height: 0.28, thickness: 0.26, smoothing: 0.88, glow: 1.55, positionY: 0.58 } },
	{ id: "eclipse", label: "Eclipse", mode: "halo", patch: { height: 0.09, thickness: 0.34, smoothing: 0.91, glow: 2.2, positionX: 0.5, positionY: 0.48, scale: 0.82 } },
	{ id: "thin-halo", label: "Thin Halo", mode: "halo", patch: { height: 0.07, thickness: 0.22, smoothing: 0.94, glow: 1.9, positionX: 0.5, positionY: 0.46, scale: 0.64 } },
	{ id: "infernal-ring", label: "Infernal Ring", mode: "ringBars", patch: { height: 0.29, thickness: 0.86, smoothing: 0.62, glow: 1.8, positionX: 0.5, positionY: 0.52, scale: 0.78 } },
	{ id: "moon-arc", label: "Moon Arc", mode: "arc", patch: { height: 0.11, thickness: 0.38, smoothing: 0.92, glow: 1.65, positionX: 0.5, positionY: 0.7, scale: 1.0 } },
	{ id: "twin-arcs", label: "Twin Arcs", mode: "dualArc", patch: { height: 0.24, thickness: 0.36, smoothing: 0.86, glow: 1.65, positionX: 0.5, positionY: 0.54, scale: 0.94 } },
	{ id: "pulse-ring", label: "Pulse Ring", mode: "radial", patch: { height: 0.35, thickness: 0.88, smoothing: 0.55, glow: 1.25, positionX: 0.5, positionY: 0.5, scale: 0.6 } },
	{ id: "sigil", label: "Sigil", mode: "ringBars", patch: { height: 0.12, thickness: 0.32, smoothing: 0.9, glow: 2.1, positionX: 0.5, positionY: 0.5, scale: 0.52, rotation: 0.34 } },
	{ id: "choir-line", label: "Choir Line", mode: "smoothLine", patch: { height: 0.3, thickness: 0.52, smoothing: 0.9, glow: 1.2, positionY: 0.75, scale: 1.0 } },
	{ id: "abyss-wave", label: "Abyss Wave", mode: "filledWave", patch: { height: 0.32, thickness: 0.68, smoothing: 0.88, glow: 1.25, positionY: 0.86 } },
	{ id: "gold-bars", label: "Gold Bars", mode: "bars", patch: { height: 0.18, thickness: 0.92, smoothing: 0.8, glow: 1.55, positionY: 0.9, scale: 0.8 } },
	{ id: "low-riser", label: "Low Riser", mode: "mirrored", patch: { height: 0.13, thickness: 0.58, smoothing: 0.9, glow: 1.1, positionY: 0.9, scale: 0.92 } },
	{ id: "storm-scope", label: "Storm Scope", mode: "oscilloscope", patch: { height: 0.28, thickness: 0.46, smoothing: 0.42, glow: 2.0, positionY: 0.62, scale: 0.9 } },
	{ id: "crown", label: "Crown", mode: "arc", patch: { height: 0.24, thickness: 0.55, smoothing: 0.74, glow: 1.75, positionX: 0.5, positionY: 0.28, scale: 0.66, rotation: 3.14 } },
	{ id: "orbital", label: "Orbital", mode: "radial", patch: { height: 0.16, thickness: 0.3, smoothing: 0.9, glow: 1.9, positionX: 0.5, positionY: 0.5, scale: 0.94, rotation: 0.25 } },
	{ id: "seraph-wide", label: "Seraph Wide", mode: "halo", patch: { height: 0.18, thickness: 0.4, smoothing: 0.88, glow: 2.0, positionX: 0.5, positionY: 0.48, scale: 1.08 } },
	{ id: "void-depth", label: "Void Depth", mode: "depthBars", patch: { height: 0.42, thickness: 0.42, smoothing: 0.66, glow: 1.35, positionY: 0.83, scale: 0.9 } },
];

export const DEFAULT_VISUAL_SCENE: VisualSceneState = {
	version: 7,
	updatedAt: Date.now(),
	output: { width: 1920, height: 1080, fps: 60, background: "#02030a" },
	timeline: { durationSeconds: 180, zoom: 1, snapSeconds: 0.25, snapMode: "seconds", markers: [] },
	assets: [],
	layers: [
		{ id: "stage", type: "stage", name: "Stage Lighting & Fog", visible: true, opacity: 1, timeline: { start: 0, duration: 0, trimIn: 0, trimOut: 0, fadeIn: 0, fadeOut: 0 } },
		{ id: "particles", type: "particles", name: "3D Cosmic Dust", visible: true, opacity: 0.72, timeline: { start: 0, duration: 0, trimIn: 0, trimOut: 0, fadeIn: 0, fadeOut: 0 } },
		{ id: "object", type: "object", name: "3D Performer", visible: true, opacity: 1, timeline: { start: 0, duration: 0, trimIn: 0, trimOut: 0, fadeIn: 0, fadeOut: 0 } },
		{ id: "spectrum", type: "spectrum", name: "Spectrum", visible: true, opacity: 0.66, timeline: { start: 0, duration: 0, trimIn: 0, trimOut: 0, fadeIn: 0, fadeOut: 0 } },
		{ id: "now-playing", type: "nowPlaying", name: "Now Playing", visible: true, opacity: 0.92, timeline: { start: 0, duration: 0, trimIn: 0, trimOut: 0, fadeIn: 0, fadeOut: 0 } },
	],
	object: {
		model: "mannequin",
		modelUrl: "",
		modelFileName: "",
		animation: "",
		animationSpeed: 1,
		pose: "idle",
		positionX: 0,
		positionY: -0.2,
		positionZ: 0,
		rotationX: 0,
		rotationY: 0,
		rotationZ: 0,
		baseScale: 1,
		rotationSpeed: 0,
		idleAmount: 0.08,
		testSignal: 0,
		pulseSource: "bass",
		pulseAmount: 0.22,
		glowSource: "energy",
		glowAmount: 1.15,
		emissiveColor: "#6d36ff",
		bodySource: "bass",
		bodyAmount: 1.0,
		armSource: "highs",
		armAmount: 1.0,
		springAmount: 0.22,
		sensitivity: 1.65,
		deadZone: 0.05,
		attack: 0.42,
		release: 0.14,
		cameraDistance: 7.4,
		cameraFov: 52,
		cameraHeight: 0.35,
		cameraTargetY: 0,
		materialOverride: false,
		materialTint: "#ffffff",
		materialMetalness: 0.35,
		materialRoughness: 0.45,
	},
	performance: {
		autoDirector: false,
		directorMode: "balanced",
		directorIntensity: 0.82,
		minimumCooldown: 1.35,
		manualCueId: "reach-camera",
		manualCueSequence: 0,
		manualCueStrength: 1,
		headTracking: true,
		headTrackAmount: 0.55,
		lightningColor: "#9fdcff",
		lightningIntensity: 2.6,
		lightningBranches: 3,
		impactStrength: 1,
		fogBurst: 0.85,
		cameraShake: 1,
		screenShockwave: true,
		timelineCues: [],
	},
	grid: {
		visible: true,
		size: 14,
		intensity: 0.32,
		source: "energy",
		amount: 0.8,
	},
	stage: {
		floorVisible: true,
		floorSize: 30,
		floorColor: "#07101f",
		fogEnabled: true,
		fogColor: "#040613",
		fogNear: 7,
		fogFar: 26,
		fogSource: "energy",
		fogAmount: 0.35,
		ambientIntensity: 0.85,
		sunColor: "#7f91ff",
		sunIntensity: 0.65,
		sunX: -3.0,
		sunY: 7.0,
		sunZ: 4.0,
		sunSource: "energy",
		sunAmount: 0.55,
		keyColor: "#fff4e8",
		keyIntensity: 2.4,
		keyX: -4.0,
		keyY: 6.0,
		keyZ: 5.0,
		keyAngle: 38,
		keyPenumbra: 0.38,
		keyDistance: 38,
		keySource: "kick",
		keyAmount: 1.9,
		rimColor: "#9b54ff",
		rimIntensity: 3.2,
		rimX: 4.0,
		rimY: 3.0,
		rimZ: 2.0,
		rimSource: "highs",
		rimAmount: 1.6,
		fillColor: "#2e75ff",
		fillIntensity: 1.8,
		fillX: -3.0,
		fillY: -1.0,
		fillZ: 2.0,
		fillSource: "energy",
		fillAmount: 1.1,
		shadows: true,
		exposure: 1.05,
		bloomStrength: 0.85,
		bloomRadius: 0.35,
		bloomThreshold: 0.72,
	},
	particles: {
		count: 1400,
		size: 5,
		source: "highs",
		amount: 1.35,
		depth: 12,
		spread: 8,
		speed: 0.42,
		emitter: "tunnel",
		gravity: 0,
		turbulence: 0.5,
		orbit: 0.15,
		positionX: 0,
		positionY: 0,
		positionZ: -5,
	},
	spectrum: {
		mode: "bars",
		preset: "bars",
		height: 0.22,
		thickness: 0.72,
		smoothing: 0.72,
		positionX: 0.5,
		positionY: 0.90,
		scale: 0.9,
		rotation: 0,
		glow: 0.9,
	},
	nowPlaying: {
		title: "YSong Visuals",
		artist: "Now Playing",
		album: "Broadcast Studio",
		positionX: 0.05,
		positionY: 0.83,
		width: 0.55,
		fontScale: 1,
		align: "left",
	},
};

function numberOr(value: unknown, fallback: number) {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeTimeline(input: VisualLayer["timeline"] | undefined): VisualLayerTimeline {
	return {
		start: Math.max(0, numberOr(input?.start, 0)),
		duration: Math.max(0, numberOr(input?.duration, 0)),
		trimIn: Math.max(0, numberOr(input?.trimIn, 0)),
		trimOut: Math.max(0, numberOr(input?.trimOut, 0)),
		fadeIn: Math.max(0, numberOr(input?.fadeIn, 0)),
		fadeOut: Math.max(0, numberOr(input?.fadeOut, 0)),
	};
}

export function normalizeVisualScene(input: unknown): VisualSceneState {
	if (!input || typeof input !== "object") return structuredClone(DEFAULT_VISUAL_SCENE);
	const raw = input as Omit<Partial<VisualSceneState>, "version"> & { version?: number };
	if (!Array.isArray(raw.layers)) return structuredClone(DEFAULT_VISUAL_SCENE);
	const normalized: VisualSceneState = {
		...structuredClone(DEFAULT_VISUAL_SCENE),
		...raw,
		version: 7,
		output: { ...DEFAULT_VISUAL_SCENE.output, ...(raw.output ?? {}) },
		timeline: {
			...DEFAULT_VISUAL_SCENE.timeline,
			...(raw.timeline ?? {}),
			markers: Array.isArray(raw.timeline?.markers)
				? raw.timeline.markers
					.filter((marker): marker is VisualTimelineMarker => !!marker && typeof marker === "object")
					.map(marker => ({
						id: marker.id || crypto.randomUUID(),
						time: Math.max(0, numberOr(marker.time, 0)),
						label: typeof marker.label === "string" && marker.label.trim() ? marker.label : "Marker",
					}))
				: [],
		},
		assets: Array.isArray(raw.assets)
			? raw.assets
				.filter((asset): asset is VisualMediaAsset => !!asset && typeof asset === "object" && typeof asset.url === "string")
				.map(asset => ({
					id: asset.id || crypto.randomUUID(),
					name: asset.name || "Media",
					kind: asset.kind === "video" ? "video" : "image",
					url: asset.url,
					duration: Math.max(0, numberOr(asset.duration, 0)),
				}))
			: [],
		object: { ...DEFAULT_VISUAL_SCENE.object, ...(raw.object ?? {}) },
		performance: {
			...DEFAULT_VISUAL_SCENE.performance,
			...(raw.performance ?? {}),
			timelineCues: Array.isArray(raw.performance?.timelineCues)
				? raw.performance.timelineCues
					.filter((cue): cue is VisualPerformanceTimelineCue => !!cue && typeof cue === "object" && typeof cue.cueId === "string")
					.map(cue => ({ id: cue.id || crypto.randomUUID(), time: Math.max(0, numberOr(cue.time, 0)), cueId: cue.cueId, strength: Math.max(0.1, Math.min(2, numberOr(cue.strength, 1))) }))
				: [],
		},
		grid: { ...DEFAULT_VISUAL_SCENE.grid, ...(raw.grid ?? {}) },
		stage: { ...DEFAULT_VISUAL_SCENE.stage, ...(raw.stage ?? {}) },
		particles: { ...DEFAULT_VISUAL_SCENE.particles, ...(raw.particles ?? {}) },
		spectrum: { ...DEFAULT_VISUAL_SCENE.spectrum, ...(raw.spectrum ?? {}) },
		nowPlaying: { ...DEFAULT_VISUAL_SCENE.nowPlaying, ...(raw.nowPlaying ?? {}) },
		layers: raw.layers.map((layer) => ({
			id: layer.id || crypto.randomUUID(),
			type: layer.type,
			name: layer.type === "object" && (!layer.name || layer.name === "Reactive Core" || layer.name === "Humanoid Dummy") ? "3D Performer" : (layer.name || layer.type),
			visible: layer.visible !== false,
			locked: layer.locked === true,
			opacity: Number.isFinite(layer.opacity) ? Math.min(1, Math.max(0, layer.opacity)) : 1,
			blendMode: layer.blendMode === "screen" || layer.blendMode === "add" || layer.blendMode === "multiply" ? layer.blendMode : "normal",
			mediaKind: layer.mediaKind,
			mediaUrl: layer.mediaUrl,
			fileName: layer.fileName,
			fit: layer.fit,
			loop: layer.loop,
			speed: layer.speed,
			sourceDuration: layer.sourceDuration,
			timeline: normalizeTimeline(layer.timeline),
		})),
	};
	if ((raw.version ?? 0) < 4) {
		normalized.object.rotationSpeed = 0;
		normalized.object.idleAmount = 0.08;
		normalized.object.bodyAmount = Math.max(0.8, normalized.object.bodyAmount ?? 0.8);
		normalized.object.armAmount = Math.max(0.8, normalized.object.armAmount ?? 0.8);
	}
	if (!normalized.layers.some((layer) => layer.type === "stage")) {
		normalized.layers.unshift(structuredClone(DEFAULT_VISUAL_SCENE.layers[0]));
	}
	return normalized;
}

export function visualAudioValue(source: VisualAudioSource, frame: {
	bass: number; mids: number; highs: number; energy: number; kick: number; rms: number; peak: number;
}) {
	return Math.max(0, Math.min(1, frame[source] ?? 0));
}

export function visualLayerActive(layer: VisualLayer, positionSeconds: number) {
	if (!layer.visible) return false;
	const timeline = layer.timeline;
	if (!timeline || timeline.duration <= 0) return true;
	return positionSeconds >= timeline.start && positionSeconds < timeline.start + timeline.duration;
}

export function visualLayerOpacityAt(layer: VisualLayer, positionSeconds: number) {
	if (!visualLayerActive(layer, positionSeconds)) return 0;
	const timeline = layer.timeline;
	if (!timeline || timeline.duration <= 0) return layer.opacity;
	const local = positionSeconds - timeline.start;
	let factor = 1;
	if (timeline.fadeIn > 0) factor = Math.min(factor, local / timeline.fadeIn);
	if (timeline.fadeOut > 0) factor = Math.min(factor, (timeline.duration - local) / timeline.fadeOut);
	return layer.opacity * Math.max(0, Math.min(1, factor));
}
