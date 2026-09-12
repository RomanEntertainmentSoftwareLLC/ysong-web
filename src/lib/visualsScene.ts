export type VisualAudioSource = "bass" | "mids" | "highs" | "energy" | "kick" | "rms" | "peak" | "beat" | "bar";
export type VisualAudioCurve = "linear" | "easeIn" | "easeOut" | "smoothstep";
export type VisualAudioBinding = {
	id: string;
	directorPlanId?: string;
	enabled: boolean;
	name: string;
	source: VisualAudioSource;
	target: string;
	amount: number;
	attack: number;
	release: number;
	threshold: number;
	invert: boolean;
	curve: VisualAudioCurve;
};
export type VisualLayerType = "media" | "particles" | "spectrum" | "object" | "primitive" | "shape2d" | "secondary" | "nowPlaying" | "stage" | "sky" | "clouds" | "weather";
export type VisualMediaKind = "image" | "video" | "model";
export type VisualObjectModel = "mannequin" | "crystal" | "glb" | "asset";
export type VisualModelFormat = "glb" | "gltf" | "fbx" | "obj";
export type VisualProjectMode = "2d" | "3d" | "hybrid";
export type VisualAntialiasMode = "off" | "fxaa" | "smaa" | "msaa2" | "msaa4" | "msaa8";
export type VisualQualityTier = "performance" | "high" | "ultra";
export type VisualQualitySelection = "auto" | VisualQualityTier | "custom";
export type VisualToneMapping = "none" | "linear" | "reinhard" | "cineon" | "aces" | "agx" | "neutral";
export type VisualPostFxModuleType = "ambientOcclusion" | "depthOfField" | "bloom" | "lightShafts" | "colorGrade" | "lut" | "lens" | "film";
export type VisualPostFxModule = { id: string; type: VisualPostFxModuleType; name: string; enabled: boolean; };
export type VisualPrimitiveType = "box" | "sphere" | "icosphere" | "cylinder" | "cone" | "capsule" | "plane" | "torus" | "pyramid";
export type VisualPhysicsBodyType = "static" | "dynamic" | "kinematic";
export type VisualColliderType = "auto" | "box" | "sphere" | "capsule" | "cylinder" | "convexHull";
export type VisualPhysicsMode = "edit" | "simulate";
export type VisualSecondaryKind = "hair" | "cloth" | "cape" | "rope" | "chain" | "tentacle" | "wings" | "springBone";
export type VisualSecondaryAnchorMode = "performerBone" | "primitive" | "point";
export type VisualShape2DType = "rectangle" | "ellipse" | "line";
export type VisualBoneProperty = "rotation" | "position" | "scale";
export type VisualKeyEasing = "linear" | "smooth";
export type VisualAnimationLayer = "base" | "upperBody" | "lowerBody" | "arms" | "head";
export type VisualAnimationBlendMode = "override" | "additive";
export type VisualIKEffector = "head" | "leftHand" | "rightHand";
export type VisualIKTargetMode = "camera" | "primitive" | "point";
export type VisualCameraPathInterpolation = "linear" | "smooth" | "catmullRom";
export type VisualCameraSegmentEasing = "inherit" | "linear" | "easeIn" | "easeOut" | "easeInOut" | "hold";
export type VisualCameraTargetMode = "point" | "performer" | "primitive";
export type VisualHumanoidSlot = "root" | "hips" | "spine" | "chest" | "neck" | "head" | "leftShoulder" | "leftUpperArm" | "leftForeArm" | "leftHand" | "rightShoulder" | "rightUpperArm" | "rightForeArm" | "rightHand" | "leftUpperLeg" | "leftLowerLeg" | "leftFoot" | "rightUpperLeg" | "rightLowerLeg" | "rightFoot";
export type VisualPoseMode = "idle" | "reach" | "cruciform";
export type VisualPerformanceDirectorMode = "balanced" | "aggressive" | "ethereal" | "emotional";
export type VisualAiDirectorStyle = "balanced" | "cinematic" | "aggressive" | "ethereal" | "minimal";
export type VisualAiDirectorScope = "full" | "camera" | "performance" | "atmosphere" | "post" | "reactivity";
export type VisualPerformanceLightning = "none" | "left" | "right" | "dual";

export type VisualPerformanceTimelineCue = {
	id: string;
	directorPlanId?: string;
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
export type VisualParticleColorMode = "single" | "bi" | "tri" | "gradient" | "rainbow";
export type VisualParticleRenderMode = "point" | "billboard";
export type VisualParticleBlendMode = "normal" | "additive";
export type VisualCloudQuality = "performance" | "high" | "ultra";
export type VisualWeatherPreset = "clear" | "rain" | "snow" | "storm" | "ash" | "dust" | "sandstorm" | "magic";
export type VisualSpectrumMode = "bars" | "smoothLine" | "mirrored" | "centerMirror" | "radial" | "halo" | "arc" | "dualArc" | "ringBars" | "oscilloscope" | "filledWave" | "depthBars";
export type VisualTextAlign = "left" | "center" | "right";
export type VisualBlendMode = "normal" | "screen" | "add" | "multiply";
export type VisualTimelineSnapMode = "seconds" | "beat" | "bar";
export type VisualSkyMode = "sphere" | "box";


export type VisualTextureSlot = {
	url: string;
	fileName: string;
};

export type VisualMaterialAsset = {
	id: string;
	name: string;
	baseColor: string;
	metalness: number;
	roughness: number;
	emissiveColor: string;
	emissiveIntensity: number;
	opacity: number;
	transparent: boolean;
	doubleSided: boolean;
	normalScale: number;
	bumpScale: number;
	displacementScale: number;
	envMapIntensity: number;
	clearcoat: number;
	clearcoatRoughness: number;
	transmission: number;
	ior: number;
	baseColorMap: VisualTextureSlot;
	normalMap: VisualTextureSlot;
	bumpMap: VisualTextureSlot;
	roughnessMap: VisualTextureSlot;
	metalnessMap: VisualTextureSlot;
	aoMap: VisualTextureSlot;
	emissiveMap: VisualTextureSlot;
	alphaMap: VisualTextureSlot;
	displacementMap: VisualTextureSlot;
	envMap: VisualTextureSlot;
};

export type VisualPrimitivePhysics = {
	bodyType: VisualPhysicsBodyType;
	collider: VisualColliderType;
	mass: number;
	friction: number;
	restitution: number;
	linearDamping: number;
	angularDamping: number;
	gravityScale: number;
};

export type VisualPrimitiveObject = {
	id: string;
	name: string;
	primitive: VisualPrimitiveType;
	visible: boolean;
	locked: boolean;
	positionX: number;
	positionY: number;
	positionZ: number;
	rotationX: number;
	rotationY: number;
	rotationZ: number;
	scaleX: number;
	scaleY: number;
	scaleZ: number;
	sizeX: number;
	sizeY: number;
	sizeZ: number;
	radius: number;
	height: number;
	segments: number;
	tubeRadius: number;
	materialId: string;
	physics: VisualPrimitivePhysics;
};


export type VisualSecondaryDynamic = {
	id: string;
	name: string;
	enabled: boolean;
	kind: VisualSecondaryKind;
	anchorMode: VisualSecondaryAnchorMode;
	anchorBone: VisualHumanoidSlot | `bone:${string}`;
	targetBone: VisualHumanoidSlot | `bone:${string}`;
	anchorEntityId: string;
	anchorX: number;
	anchorY: number;
	anchorZ: number;
	offsetX: number;
	offsetY: number;
	offsetZ: number;
	segments: number;
	columns: number;
	length: number;
	width: number;
	radius: number;
	stiffness: number;
	bendStiffness: number;
	damping: number;
	gravityScale: number;
	windInfluence: number;
	drag: number;
	collisionRadius: number;
	collideGround: boolean;
	collidePrimitives: boolean;
	collidePerformer: boolean;
	selfCollision: boolean;
	audioSource: VisualAudioSource;
	audioImpulse: number;
	audioDirectionX: number;
	audioDirectionY: number;
	audioDirectionZ: number;
	materialId: string;
	color: string;
	mirror: boolean;
	restDirectionX: number;
	restDirectionY: number;
	restDirectionZ: number;
	boneInfluence: number;
};

export type VisualShape2D = {
	id: string;
	name: string;
	shape: VisualShape2DType;
	color: string;
	positionX: number;
	positionY: number;
	width: number;
	height: number;
	rotation: number;
	borderWidth: number;
	borderColor: string;
	borderRadius: number;
};

export type VisualSkeletalKeyframe = {
	id: string;
	time: number;
	target: VisualHumanoidSlot | `bone:${string}`;
	property: VisualBoneProperty;
	x: number;
	y: number;
	z: number;
	easing: VisualKeyEasing;
};

export type VisualSkeletalAnimation = {
	id: string;
	name: string;
	duration: number;
	loop: boolean;
	source: "authored" | "imported";
	sourceClip: string;
	tags: string[];
	keyframes: VisualSkeletalKeyframe[];
};

// Phase 9 promotes the old point-only animation cue into a real DAW clip.
// `blend` is retained as a migration/compatibility alias for older scenes.
export type VisualAnimationCue = {
	id: string;
	directorPlanId?: string;
	time: number;
	duration: number;
	trimIn: number;
	animationId: string;
	speed: number;
	loop: boolean;
	blend: number;
	weight: number;
	blendIn: number;
	blendOut: number;
	layer: VisualAnimationLayer;
	blendMode: VisualAnimationBlendMode;
	enabled: boolean;
};

export type VisualIKWeightKeyframe = {
	id: string;
	time: number;
	weight: number;
	easing: VisualKeyEasing;
};

export type VisualIKConstraint = {
	id: string;
	name: string;
	enabled: boolean;
	effector: VisualIKEffector;
	targetMode: VisualIKTargetMode;
	targetEntityId: string;
	targetX: number;
	targetY: number;
	targetZ: number;
	offsetX: number;
	offsetY: number;
	offsetZ: number;
	weight: number;
	iterations: number;
	maxAngleDegrees: number;
	weightKeys: VisualIKWeightKeyframe[];
};

export type VisualCameraKeyframe = {
	id: string;
	directorPlanId?: string;
	time: number;
	positionX: number;
	positionY: number;
	positionZ: number;
	targetX: number;
	targetY: number;
	targetZ: number;
	targetOffsetX?: number;
	targetOffsetY?: number;
	targetOffsetZ?: number;
	fov: number;
	rotationX?: number;
	rotationY?: number;
	rotationZ?: number;
	focusDistance?: number;
	aperture?: number;
	dofAmount?: number;
	dofBalance?: number;
	focusRange?: number;
	maxBlur?: number;
	bokehSize?: number;
	exposure?: number;
	shakeAmount?: number;
	shakeFrequency?: number;
	shakeRotation?: number;
	easing?: VisualCameraSegmentEasing;
};

export type VisualProgramCamera = {
	id: string;
	name: string;
	enabled: boolean;
	aimMode: "target" | "rotation";
	targetMode: VisualCameraTargetMode;
	targetEntityId: string;
	targetOffsetX: number;
	targetOffsetY: number;
	targetOffsetZ: number;
	positionX: number;
	positionY: number;
	positionZ: number;
	rotationX: number;
	rotationY: number;
	rotationZ: number;
	targetX: number;
	targetY: number;
	targetZ: number;
	fov: number;
	near: number;
	far: number;
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
	lensFlare: number;
	exposure: number;
	shakeAmount: number;
	shakeFrequency: number;
	shakeRotation: number;
	shakeSeed: number;
	pathInterpolation: VisualCameraPathInterpolation;
	pathClosed: boolean;
	showPath: boolean;
	showThirds: boolean;
	showCenter: boolean;
	showSafeAreas: boolean;
	showModel: boolean;
	fadeModelWhenNear: boolean;
	showFov: boolean;
	showForward: boolean;
	showTarget: boolean;
	helperLength: number;
	loop: boolean;
	keyframes: VisualCameraKeyframe[];
};

export type VisualCameraCut = {
	id: string;
	directorPlanId?: string;
	time: number;
	cameraId: string;
};

export type VisualMediaAsset = {
	id: string;
	name: string;
	kind: "image" | "video";
	url: string;
	duration: number;
};

export type VisualTimelineMarker = {
	id: string;
	directorPlanId?: string;
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

export type VisualAiDirectorState = {
	style: VisualAiDirectorStyle;
	scope: VisualAiDirectorScope;
	intensity: number;
	preserveManual: boolean;
	replacePreviousDirectorPlan: boolean;
	seed: number;
	prompt: string;
	lastPlanId: string;
	lastPlanSummary: string;
	lastPlanSource: "ai" | "fallback" | "";
	lastAppliedAt: number;
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
	entityId?: string;
	fit?: "cover" | "contain";
	loop?: boolean;
	speed?: number;
	sourceDuration?: number;
	timeline?: VisualLayerTimeline;
};

export type VisualSceneState = {
	version: 21;
	project: {
		id: string;
		name: string;
		mode: VisualProjectMode;
	};
	renderer: {
		/** Per-view quality presets. Auto chooses a conservative hardware recommendation. */
		editorQuality: VisualQualitySelection;
		programQuality: VisualQualitySelection;
		/** Custom-mode controls retained from the Phase 4 renderer foundation. */
		antialiasMode: VisualAntialiasMode;
		renderScale: number;
		editorAntialias: boolean;
		programAntialias: boolean;
		sharpen: number;
		/** Optional dynamic-resolution multiplier applied under the selected preset. */
		adaptiveResolution: boolean;
		adaptiveTargetFps: number;
		adaptiveMinScale: number;
		adaptiveMaxScale: number;
	};
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
	materials: VisualMaterialAsset[];
	primitives: VisualPrimitiveObject[];
	shapes2d: VisualShape2D[];
	secondaryDynamics: VisualSecondaryDynamic[];
	animations: VisualSkeletalAnimation[];
	animationCues: VisualAnimationCue[];
	ikConstraints: VisualIKConstraint[];
	physics: {
		enabled: boolean;
		mode: VisualPhysicsMode;
		gravityY: number;
		groundEnabled: boolean;
		groundY: number;
		resetSequence: number;
		secondaryEnabled: boolean;
		secondarySubsteps: number;
		secondaryIterations: number;
		secondaryDebug: boolean;
		resetSecondaryOnSeek: boolean;
	};
	postFx: {
		stack: VisualPostFxModule[];
		toneMapping: VisualToneMapping;
		exposure: number;
		colorGradeEnabled: boolean;
		saturation: number;
		contrast: number;
		brightness: number;
		temperature: number;
		tint: number;
		lift: number;
		gamma: number;
		gain: number;
		lutUrl: string;
		lutFileName: string;
		lutIntensity: number;
		ambientOcclusionIntensity: number;
		ambientOcclusionRadius: number;
		lightShaftsIntensity: number;
		lightShaftsSource: "sun" | "moon";
		lightShaftsDecay: number;
		lightShaftsDensity: number;
		lightShaftsWeight: number;
		chromaticAberration: number;
		lensDistortion: number;
		lensZoom: number;
		halation: number;
		filmGrain: number;
		vignette: number;
		vignetteSoftness: number;
	};
	audioModulation: {
		enabled: boolean;
		masterAmount: number;
		testSignal: number;
		bindings: VisualAudioBinding[];
	};
	director: VisualAiDirectorState;
	layers: VisualLayer[];
	object: {
		model: VisualObjectModel;
		modelUrl: string;
		modelFileName: string;
		modelFormat: VisualModelFormat;
		materialId: string;
		humanoidMap: Partial<Record<VisualHumanoidSlot, string>>;
		morphTargets: Record<string, number>;
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
	camera: {
		positionX: number;
		positionY: number;
		positionZ: number;
		targetX: number;
		targetY: number;
		targetZ: number;
		fov: number;
		loop: boolean;
		keyframes: VisualCameraKeyframe[];
	};
	cameras: VisualProgramCamera[];
	activeCameraId: string;
	cameraCuts: VisualCameraCut[];
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
		floorOpacity: number;
		fogEnabled: boolean;
		fogColor: string;
		fogNear: number;
		fogFar: number;
		fogSource: VisualAudioSource;
		fogAmount: number;
		ambientIntensity: number;
		ambientSkyColor: string;
		ambientGroundColor: string;
		sunColor: string;
		sunIntensity: number;
		sunX: number;
		sunY: number;
		sunZ: number;
		sunSource: VisualAudioSource;
		sunAmount: number;
		moonEnabled: boolean;
		moonColor: string;
		moonIntensity: number;
		moonX: number;
		moonY: number;
		moonZ: number;
		moonSource: VisualAudioSource;
		moonAmount: number;
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
		sunShadows: boolean;
		moonShadows: boolean;
		keyShadows: boolean;
		shadowMapSize: number;
		shadowBias: number;
		exposure: number;
		bloomStrength: number;
		bloomRadius: number;
		bloomThreshold: number;
		lensFlareEnabled: boolean;
		lensFlareIntensity: number;
	};
	sky: {
		mode: VisualSkyMode;
		sphereUrl: string;
		sphereFileName: string;
		spherePolygons: number;
		rotationY: number;
		brightness: number;
		boxRightUrl: string;
		boxLeftUrl: string;
		boxTopUrl: string;
		boxBottomUrl: string;
		boxFrontUrl: string;
		boxBackUrl: string;
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
		renderMode: VisualParticleRenderMode;
		colorMode: VisualParticleColorMode;
		colorA: string;
		colorB: string;
		colorC: string;
		rainbowSpeed: number;
		textureUrl: string;
		textureFileName: string;
		blendMode: VisualParticleBlendMode;
		alphaTest: number;
	};
	clouds: {
		coverage: number;
		density: number;
		altitude: number;
		thickness: number;
		scale: number;
		softness: number;
		windX: number;
		windZ: number;
		speed: number;
		brightness: number;
		lightAbsorption: number;
		color: string;
		quality: VisualCloudQuality;
	};
	wind: {
		enabled: boolean;
		directionX: number;
		directionZ: number;
		strength: number;
		gustiness: number;
		turbulence: number;
		affectsClouds: boolean;
		affectsParticles: boolean;
		affectsWeather: boolean;
		affectsPhysics: boolean;
		physicsForce: number;
	};
	weather: {
		preset: VisualWeatherPreset;
		intensity: number;
		rain: number;
		snow: number;
		ash: number;
		dust: number;
		sand: number;
		magic: number;
		fog: number;
		fogColor: string;
		heatHaze: number;
		heatHazeSpeed: number;
		lightning: number;
		lightningRate: number;
		lightningColor: string;
		precipitationSize: number;
		fallSpeed: number;
		area: number;
		height: number;
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


export const HUMANOID_SLOTS: VisualHumanoidSlot[] = [
	"root","hips","spine","chest","neck","head",
	"leftShoulder","leftUpperArm","leftForeArm","leftHand",
	"rightShoulder","rightUpperArm","rightForeArm","rightHand",
	"leftUpperLeg","leftLowerLeg","leftFoot","rightUpperLeg","rightLowerLeg","rightFoot",
];

export const DEFAULT_VISUAL_MATERIAL: VisualMaterialAsset = {
	id: "material-default", name: "Default PBR", baseColor: "#b9c2ff", metalness: 0.15, roughness: 0.55,
	emissiveColor: "#000000", emissiveIntensity: 0, opacity: 1, transparent: false, doubleSided: false,
	normalScale: 1, bumpScale: 0.2, displacementScale: 0, envMapIntensity: 1, clearcoat: 0, clearcoatRoughness: 0.1, transmission: 0, ior: 1.5,
	baseColorMap: {url:"",fileName:""}, normalMap: {url:"",fileName:""}, bumpMap: {url:"",fileName:""}, roughnessMap: {url:"",fileName:""},
	metalnessMap: {url:"",fileName:""}, aoMap: {url:"",fileName:""}, emissiveMap: {url:"",fileName:""}, alphaMap: {url:"",fileName:""}, displacementMap: {url:"",fileName:""}, envMap: {url:"",fileName:""},
};

export function makeVisualMaterial(name = "New Material"): VisualMaterialAsset {
	return {...structuredClone(DEFAULT_VISUAL_MATERIAL), id:`material-${crypto.randomUUID()}`, name};
}

export function makeVisualPrimitive(primitive: VisualPrimitiveType, name?: string): VisualPrimitiveObject {
	const label = name || primitive.charAt(0).toUpperCase()+primitive.slice(1);
	return {
		id:`primitive-${crypto.randomUUID()}`, name:label, primitive, visible:true, locked:false,
		positionX:0, positionY:primitive==="plane"?-3:0, positionZ:0, rotationX:primitive==="plane"?-Math.PI/2:0, rotationY:0, rotationZ:0,
		scaleX:1, scaleY:1, scaleZ:1, sizeX:2, sizeY:2, sizeZ:2, radius:1, height:3, segments:32, tubeRadius:.28, materialId:"material-default",
		physics:{bodyType:primitive==="plane"?"static":"static", collider:"auto", mass:1, friction:.6, restitution:.1, linearDamping:.05, angularDamping:.05, gravityScale:1},
	};
}

export function makeVisualShape2D(shape: VisualShape2DType = "rectangle", name?: string): VisualShape2D {
	return {id:`shape2d-${crypto.randomUUID()}`,name:name||`2D ${shape}`,shape,color:"#8d6cff",positionX:.5,positionY:.5,width:.28,height:.18,rotation:0,borderWidth:0,borderColor:"#ffffff",borderRadius:.08};
}

export function makeVisualSecondary(kind: VisualSecondaryKind, name?: string): VisualSecondaryDynamic {
	const defaults: Record<VisualSecondaryKind, Partial<VisualSecondaryDynamic>> = {
		hair:{segments:14,columns:1,length:2.2,width:.18,radius:.035,stiffness:.86,bendStiffness:.42,damping:.965,gravityScale:.6,windInfluence:1.25,drag:.18,collisionRadius:.05,anchorBone:"head",restDirectionX:0,restDirectionY:-1,restDirectionZ:.08,color:"#37213f"},
		cloth:{segments:10,columns:8,length:3,width:3,radius:.025,stiffness:.9,bendStiffness:.3,damping:.972,gravityScale:1,windInfluence:1.1,drag:.28,collisionRadius:.04,anchorBone:"chest",restDirectionX:0,restDirectionY:-1,restDirectionZ:.08,color:"#6950a8"},
		cape:{segments:12,columns:7,length:3.6,width:2.6,radius:.03,stiffness:.9,bendStiffness:.36,damping:.97,gravityScale:1,windInfluence:1.45,drag:.34,collisionRadius:.05,anchorBone:"chest",restDirectionX:0,restDirectionY:-.9,restDirectionZ:.35,color:"#421a61"},
		rope:{segments:18,columns:1,length:4,radius:.055,stiffness:.96,bendStiffness:.15,damping:.975,gravityScale:1,windInfluence:.45,drag:.12,collisionRadius:.07,anchorBone:"rightHand",restDirectionX:0,restDirectionY:-1,restDirectionZ:0,color:"#8d704d"},
		chain:{segments:14,columns:1,length:3.2,radius:.075,stiffness:.985,bendStiffness:.08,damping:.982,gravityScale:1.25,windInfluence:.12,drag:.08,collisionRadius:.09,anchorBone:"rightHand",restDirectionX:0,restDirectionY:-1,restDirectionZ:0,color:"#aeb5c2"},
		tentacle:{segments:20,columns:1,length:4.2,radius:.12,stiffness:.9,bendStiffness:.55,damping:.96,gravityScale:.4,windInfluence:.8,drag:.22,collisionRadius:.13,anchorBone:"spine",restDirectionX:0,restDirectionY:-.25,restDirectionZ:-1,color:"#713d8e"},
		wings:{segments:9,columns:7,length:2.8,width:4.8,radius:.04,stiffness:.94,bendStiffness:.48,damping:.968,gravityScale:.28,windInfluence:1.6,drag:.35,collisionRadius:.05,anchorBone:"chest",mirror:true,restDirectionX:0,restDirectionY:.05,restDirectionZ:-1,color:"#d5dcff"},
		springBone:{segments:1,columns:1,length:.75,radius:.03,stiffness:.72,bendStiffness:.25,damping:.94,gravityScale:.25,windInfluence:.55,drag:.18,collisionRadius:.03,anchorBone:"head",targetBone:"head",restDirectionX:0,restDirectionY:1,restDirectionZ:0,color:"#76e5ff",boneInfluence:1},
	};
	const preset=defaults[kind];
	return {
		id:`secondary-${crypto.randomUUID()}`,name:name||({hair:"Hair Dynamics",cloth:"Cloth",cape:"Cape",rope:"Rope",chain:"Chain",tentacle:"Tentacle",wings:"Wings",springBone:"Spring Bone"}[kind]),enabled:true,kind,anchorMode:"performerBone",anchorBone:"chest",targetBone:"head",anchorEntityId:"",anchorX:0,anchorY:2,anchorZ:0,offsetX:0,offsetY:0,offsetZ:0,segments:12,columns:1,length:3,width:2,radius:.05,stiffness:.9,bendStiffness:.3,damping:.97,gravityScale:1,windInfluence:1,drag:.2,collisionRadius:.05,collideGround:true,collidePrimitives:true,collidePerformer:true,selfCollision:false,audioSource:"energy",audioImpulse:0,audioDirectionX:0,audioDirectionY:.35,audioDirectionZ:-1,materialId:"",color:"#8d6cff",mirror:false,restDirectionX:0,restDirectionY:-1,restDirectionZ:0,boneInfluence:1,...preset,
	};
}

export const DEFAULT_VISUAL_SCENE: VisualSceneState = {
	version: 21,
	project: { id: "visual-project-default", name: "Untitled Visual", mode: "hybrid" },
	renderer: {
		editorQuality: "performance",
		programQuality: "auto",
		antialiasMode: "smaa",
		renderScale: 1,
		editorAntialias: true,
		programAntialias: true,
		sharpen: 0,
		adaptiveResolution: false,
		adaptiveTargetFps: 60,
		adaptiveMinScale: 0.65,
		adaptiveMaxScale: 1,
	},
	updatedAt: Date.now(),
	output: { width: 1920, height: 1080, fps: 60, background: "#02030a" },
	timeline: { durationSeconds: 180, zoom: 1, snapSeconds: 0.25, snapMode: "seconds", markers: [] },
	assets: [],
	materials: [structuredClone(DEFAULT_VISUAL_MATERIAL)],
	primitives: [],
	shapes2d: [],
	secondaryDynamics: [],
	animations: [],
	animationCues: [],
	ikConstraints: [],
	physics: { enabled: true, mode: "edit", gravityY: -9.81, groundEnabled: true, groundY: -3.16, resetSequence: 0, secondaryEnabled: true, secondarySubsteps: 2, secondaryIterations: 5, secondaryDebug: false, resetSecondaryOnSeek: true },
	postFx: {
		stack: [
			{id:"post-ao",type:"ambientOcclusion",name:"Ambient Occlusion",enabled:false},
			{id:"post-dof",type:"depthOfField",name:"Depth of Field",enabled:true},
			{id:"post-bloom",type:"bloom",name:"Bloom",enabled:true},
			{id:"post-shafts",type:"lightShafts",name:"Light Shafts",enabled:false},
			{id:"post-color",type:"colorGrade",name:"Color Grade",enabled:true},
			{id:"post-lut",type:"lut",name:"3D LUT",enabled:false},
			{id:"post-lens",type:"lens",name:"Lens",enabled:true},
			{id:"post-film",type:"film",name:"Film",enabled:true},
		],
		toneMapping:"aces", exposure:1, colorGradeEnabled:false, saturation:1, contrast:1, brightness:1, temperature:0, tint:0, lift:0, gamma:1, gain:1, lutUrl:"", lutFileName:"", lutIntensity:1,
		ambientOcclusionIntensity:1, ambientOcclusionRadius:4, lightShaftsIntensity:0, lightShaftsSource:"sun", lightShaftsDecay:.94, lightShaftsDensity:.88, lightShaftsWeight:.22,
		chromaticAberration:0, lensDistortion:0, lensZoom:1, halation:0, filmGrain:0, vignette:0, vignetteSoftness:.45
	},
	audioModulation: { enabled: true, masterAmount: 1, testSignal: 0, bindings: [] },
	director: { style:"cinematic", scope:"full", intensity:.8, preserveManual:true, replacePreviousDirectorPlan:true, seed:7, prompt:"", lastPlanId:"", lastPlanSummary:"", lastPlanSource:"", lastAppliedAt:0 },
	layers: [
		{ id: "stage", type: "stage", name: "Stage Lighting & Fog", visible: true, opacity: 1, timeline: { start: 0, duration: 0, trimIn: 0, trimOut: 0, fadeIn: 0, fadeOut: 0 } },
		{ id: "sky", type: "sky", name: "Sky Environment", visible: false, opacity: 1, timeline: { start: 0, duration: 0, trimIn: 0, trimOut: 0, fadeIn: 0, fadeOut: 0 } },
		{ id: "clouds", type: "clouds", name: "Volumetric Clouds", visible: false, opacity: 0.78, timeline: { start: 0, duration: 0, trimIn: 0, trimOut: 0, fadeIn: 0, fadeOut: 0 } },
		{ id: "weather", type: "weather", name: "Weather & Atmosphere", visible: false, opacity: 1, timeline: { start: 0, duration: 0, trimIn: 0, trimOut: 0, fadeIn: 0, fadeOut: 0 } },
		{ id: "particles", type: "particles", name: "3D Cosmic Dust", visible: false, opacity: 0.72, timeline: { start: 0, duration: 0, trimIn: 0, trimOut: 0, fadeIn: 0, fadeOut: 0 } },
		{ id: "object", type: "object", name: "3D Performer", visible: true, opacity: 1, timeline: { start: 0, duration: 0, trimIn: 0, trimOut: 0, fadeIn: 0, fadeOut: 0 } },
		{ id: "spectrum", type: "spectrum", name: "Spectrum", visible: true, opacity: 0.66, timeline: { start: 0, duration: 0, trimIn: 0, trimOut: 0, fadeIn: 0, fadeOut: 0 } },
		{ id: "now-playing", type: "nowPlaying", name: "Now Playing", visible: true, opacity: 0.92, timeline: { start: 0, duration: 0, trimIn: 0, trimOut: 0, fadeIn: 0, fadeOut: 0 } },
	],
	object: {
		model: "mannequin",
		modelUrl: "",
		modelFileName: "",
		modelFormat: "glb",
		materialId: "",
		humanoidMap: {},
		morphTargets: {},
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
	camera: {
		positionX: 0,
		positionY: 0.35,
		positionZ: 7.4,
		targetX: 0,
		targetY: 0,
		targetZ: 0,
		fov: 52,
		loop: false,
		keyframes: [],
	},
	cameras: [{
		id: "program-camera-1",
		name: "Program Camera 1",
		enabled: true,
		aimMode: "target",
		targetMode: "point", targetEntityId: "", targetOffsetX: 0, targetOffsetY: 0, targetOffsetZ: 0,
		positionX: 0, positionY: 0.35, positionZ: 7.4,
		rotationX: 0, rotationY: 0, rotationZ: 0,
		targetX: 0, targetY: 0, targetZ: 0,
		fov: 52, near: 0.1, far: 120,
		focusDistance: 7.4, aperture: 2.8, dofAmount: 0, dofBalance: 0, focusRange: 1.2, maxBlur: 12,
		bokehSize: 1, bokehBlades: 6, bokehRotation: 0, bokehThreshold: 0.8, bokehGain: 1.2, bokehAnamorphic: 1, lensFlare: 1,
		exposure: 1, shakeAmount: 0, shakeFrequency: 1.6, shakeRotation: 0, shakeSeed: 1,
		pathInterpolation: "smooth", pathClosed: false, showPath: false,
		showThirds: false, showCenter: false, showSafeAreas: false,
		showModel: true, fadeModelWhenNear: true, showFov: false, showForward: false, showTarget: false, helperLength: 12,
		loop: false, keyframes: [],
	}],
	activeCameraId: "program-camera-1",
	cameraCuts: [],
	grid: {
		visible: false,
		size: 14,
		intensity: 0.32,
		source: "energy",
		amount: 0.8,
	},
	stage: {
		floorVisible: false,
		floorSize: 30,
		floorColor: "#07101f",
		floorOpacity: 0.24,
		fogEnabled: true,
		fogColor: "#040613",
		fogNear: 7,
		fogFar: 26,
		fogSource: "energy",
		fogAmount: 0.35,
		ambientIntensity: 0.85,
		ambientSkyColor: "#8d9dff",
		ambientGroundColor: "#190d2a",
		sunColor: "#7f91ff",
		sunIntensity: 0.65,
		sunX: -3.0,
		sunY: 7.0,
		sunZ: 4.0,
		sunSource: "energy",
		sunAmount: 0.55,
		moonEnabled: false,
		moonColor: "#b9ccff",
		moonIntensity: 0.35,
		moonX: 4.0,
		moonY: 6.0,
		moonZ: -5.0,
		moonSource: "highs",
		moonAmount: 0.25,
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
		sunShadows: true,
		moonShadows: false,
		keyShadows: true,
		shadowMapSize: 1024,
		shadowBias: -0.00035,
		exposure: 1.05,
		bloomStrength: 0.85,
		bloomRadius: 0.35,
		bloomThreshold: 0.72,
		lensFlareEnabled: false,
		lensFlareIntensity: 0.7,
	},
	sky: {
		mode: "sphere",
		sphereUrl: "",
		sphereFileName: "",
		spherePolygons: 4096,
		rotationY: 0,
		brightness: 1,
		boxRightUrl: "",
		boxLeftUrl: "",
		boxTopUrl: "",
		boxBottomUrl: "",
		boxFrontUrl: "",
		boxBackUrl: "",
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
		renderMode: "point",
		colorMode: "single",
		colorA: "#9f8cff",
		colorB: "#43d9ff",
		colorC: "#ff4fd8",
		rainbowSpeed: 0.12,
		textureUrl: "",
		textureFileName: "",
		blendMode: "additive",
		alphaTest: 0.02,
	},
	clouds: {
		coverage: 0.55, density: 0.58, altitude: 6.5, thickness: 4.5, scale: 1, softness: 0.72,
		windX: 0.35, windZ: 0.08, speed: 0.16, brightness: 1, lightAbsorption: 0.28, color: "#ffffff", quality: "performance",
	},
	wind: {
		enabled: true, directionX: 0.55, directionZ: 0.15, strength: 0.35, gustiness: 0.18, turbulence: 0.12,
		affectsClouds: true, affectsParticles: true, affectsWeather: true, affectsPhysics: true, physicsForce: 1.2,
	},
	weather: {
		preset: "clear", intensity: 1, rain: 0, snow: 0, ash: 0, dust: 0, sand: 0, magic: 0, fog: 0, fogColor: "#aab6c8", heatHaze: 0, heatHazeSpeed: 0.8, lightning: 0, lightningRate: 8, lightningColor: "#dcecff", precipitationSize: 1, fallSpeed: 1, area: 24, height: 18,
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


function normalizeTextureSlot(input: unknown): VisualTextureSlot {
	if (!input || typeof input !== "object") return {url:"",fileName:""};
	const raw = input as Partial<VisualTextureSlot>;
	return {url:typeof raw.url==="string"?raw.url:"",fileName:typeof raw.fileName==="string"?raw.fileName:""};
}

function normalizeVisualMaterial(input: Partial<VisualMaterialAsset>, index: number): VisualMaterialAsset {
	const d = DEFAULT_VISUAL_MATERIAL;
	return {
		...structuredClone(d), ...input, id:typeof input.id==="string"&&input.id?input.id:`material-${index+1}`, name:typeof input.name==="string"&&input.name.trim()?input.name:`Material ${index+1}`,
		baseColor:typeof input.baseColor==="string"?input.baseColor:d.baseColor, metalness:Math.max(0,Math.min(1,numberOr(input.metalness,d.metalness))), roughness:Math.max(0,Math.min(1,numberOr(input.roughness,d.roughness))),
		emissiveColor:typeof input.emissiveColor==="string"?input.emissiveColor:d.emissiveColor, emissiveIntensity:Math.max(0,numberOr(input.emissiveIntensity,d.emissiveIntensity)), opacity:Math.max(0,Math.min(1,numberOr(input.opacity,d.opacity))),
		normalScale:numberOr(input.normalScale,d.normalScale), bumpScale:numberOr(input.bumpScale,d.bumpScale), displacementScale:numberOr(input.displacementScale,d.displacementScale), envMapIntensity:Math.max(0,numberOr(input.envMapIntensity,d.envMapIntensity)),
		clearcoat:Math.max(0,Math.min(1,numberOr(input.clearcoat,d.clearcoat))), clearcoatRoughness:Math.max(0,Math.min(1,numberOr(input.clearcoatRoughness,d.clearcoatRoughness))), transmission:Math.max(0,Math.min(1,numberOr(input.transmission,d.transmission))), ior:Math.max(1,Math.min(2.5,numberOr(input.ior,d.ior))),
		baseColorMap:normalizeTextureSlot(input.baseColorMap), normalMap:normalizeTextureSlot(input.normalMap), bumpMap:normalizeTextureSlot(input.bumpMap), roughnessMap:normalizeTextureSlot(input.roughnessMap), metalnessMap:normalizeTextureSlot(input.metalnessMap), aoMap:normalizeTextureSlot(input.aoMap), emissiveMap:normalizeTextureSlot(input.emissiveMap), alphaMap:normalizeTextureSlot(input.alphaMap), displacementMap:normalizeTextureSlot(input.displacementMap), envMap:normalizeTextureSlot(input.envMap),
	};
}

function normalizeVisualPrimitive(input: Partial<VisualPrimitiveObject>, index: number): VisualPrimitiveObject {
	const kind:VisualPrimitiveType = ["box","sphere","icosphere","cylinder","cone","capsule","plane","torus","pyramid"].includes(String(input.primitive)) ? input.primitive as VisualPrimitiveType : "box";
	const d=makeVisualPrimitive(kind, typeof input.name==="string"?input.name:undefined);
	return {...d,...input,id:typeof input.id==="string"&&input.id?input.id:`primitive-${index+1}`,primitive:kind,visible:input.visible!==false,locked:input.locked===true,positionX:numberOr(input.positionX,d.positionX),positionY:numberOr(input.positionY,d.positionY),positionZ:numberOr(input.positionZ,d.positionZ),rotationX:numberOr(input.rotationX,d.rotationX),rotationY:numberOr(input.rotationY,d.rotationY),rotationZ:numberOr(input.rotationZ,d.rotationZ),scaleX:Math.max(.001,numberOr(input.scaleX,1)),scaleY:Math.max(.001,numberOr(input.scaleY,1)),scaleZ:Math.max(.001,numberOr(input.scaleZ,1)),sizeX:Math.max(.01,numberOr(input.sizeX,d.sizeX)),sizeY:Math.max(.01,numberOr(input.sizeY,d.sizeY)),sizeZ:Math.max(.01,numberOr(input.sizeZ,d.sizeZ)),radius:Math.max(.01,numberOr(input.radius,d.radius)),height:Math.max(.01,numberOr(input.height,d.height)),segments:Math.max(3,Math.min(128,Math.round(numberOr(input.segments,d.segments)))),tubeRadius:Math.max(.01,numberOr(input.tubeRadius,d.tubeRadius)),materialId:typeof input.materialId==="string"?input.materialId:d.materialId,physics:{...d.physics,...(input.physics??{}),bodyType:input.physics?.bodyType==="dynamic"||input.physics?.bodyType==="kinematic"?input.physics.bodyType:"static",collider:["box","sphere","capsule","cylinder","convexHull"].includes(String(input.physics?.collider))?input.physics!.collider as VisualColliderType:"auto",mass:Math.max(.001,numberOr(input.physics?.mass,d.physics.mass)),friction:Math.max(0,numberOr(input.physics?.friction,d.physics.friction)),restitution:Math.max(0,Math.min(1,numberOr(input.physics?.restitution,d.physics.restitution))),linearDamping:Math.max(0,numberOr(input.physics?.linearDamping,d.physics.linearDamping)),angularDamping:Math.max(0,numberOr(input.physics?.angularDamping,d.physics.angularDamping)),gravityScale:numberOr(input.physics?.gravityScale,d.physics.gravityScale)}};
}

function normalizeVisualShape2D(input: Partial<VisualShape2D>, index:number): VisualShape2D {
	const shape:VisualShape2DType=input.shape==="ellipse"||input.shape==="line"?input.shape:"rectangle"; const d=makeVisualShape2D(shape);
	return {...d,...input,id:typeof input.id==="string"&&input.id?input.id:`shape2d-${index+1}`,name:typeof input.name==="string"&&input.name.trim()?input.name:`2D ${shape}`,shape,color:typeof input.color==="string"?input.color:d.color,positionX:Math.max(-2,Math.min(3,numberOr(input.positionX,d.positionX))),positionY:Math.max(-2,Math.min(3,numberOr(input.positionY,d.positionY))),width:Math.max(.001,numberOr(input.width,d.width)),height:Math.max(.001,numberOr(input.height,d.height)),rotation:numberOr(input.rotation,d.rotation),borderWidth:Math.max(0,numberOr(input.borderWidth,d.borderWidth)),borderColor:typeof input.borderColor==="string"?input.borderColor:d.borderColor,borderRadius:Math.max(0,Math.min(1,numberOr(input.borderRadius,d.borderRadius)))};
}

function normalizeSkeletalAnimation(input: Partial<VisualSkeletalAnimation>, index:number): VisualSkeletalAnimation {
	return {
		id:typeof input.id==="string"&&input.id?input.id:`animation-${index+1}`,
		name:typeof input.name==="string"&&input.name.trim()?input.name:`Animation ${index+1}`,
		duration:Math.max(.05,numberOr(input.duration,2)),
		loop:input.loop===true,
		source:input.source==="imported"?"imported":"authored",
		sourceClip:typeof input.sourceClip==="string"?input.sourceClip:"",
		tags:Array.isArray(input.tags)?input.tags.filter((tag):tag is string=>typeof tag==="string").slice(0,32):[],
		keyframes:Array.isArray(input.keyframes)?input.keyframes.filter(Boolean).map((key)=>({id:key.id||crypto.randomUUID(),time:Math.max(0,numberOr(key.time,0)),target:(typeof key.target==="string"?key.target:"root") as VisualSkeletalKeyframe["target"],property:(key.property==="position"||key.property==="scale"?key.property:"rotation") as VisualBoneProperty,x:numberOr(key.x,0),y:numberOr(key.y,0),z:numberOr(key.z,0),easing:(key.easing==="linear"?"linear":"smooth") as VisualKeyEasing})).sort((a,b)=>a.time-b.time):[]
	};
}

function normalizeIKConstraint(input: Partial<VisualIKConstraint>, index:number): VisualIKConstraint {
	return {
		id:typeof input.id==="string"&&input.id?input.id:`ik-${index+1}`, name:typeof input.name==="string"&&input.name.trim()?input.name:`IK ${index+1}`, enabled:input.enabled!==false,
		effector:input.effector==="leftHand"||input.effector==="rightHand"?input.effector:"head", targetMode:input.targetMode==="camera"||input.targetMode==="primitive"?input.targetMode:"point", targetEntityId:typeof input.targetEntityId==="string"?input.targetEntityId:"",
		targetX:numberOr(input.targetX,0), targetY:numberOr(input.targetY,1.5), targetZ:numberOr(input.targetZ,2), offsetX:numberOr(input.offsetX,0), offsetY:numberOr(input.offsetY,0), offsetZ:numberOr(input.offsetZ,0),
		weight:Math.max(0,Math.min(1,numberOr(input.weight,1))), iterations:Math.max(1,Math.min(12,Math.round(numberOr(input.iterations,4)))), maxAngleDegrees:Math.max(1,Math.min(180,numberOr(input.maxAngleDegrees,55))),
		weightKeys:Array.isArray(input.weightKeys)?input.weightKeys.filter(Boolean).map(key=>({id:key.id||crypto.randomUUID(),time:Math.max(0,numberOr(key.time,0)),weight:Math.max(0,Math.min(1,numberOr(key.weight,1))),easing:(key.easing==="linear"?"linear":"smooth") as VisualKeyEasing})).sort((a,b)=>a.time-b.time):[]
	};
}

function normalizeSecondaryDynamic(input: Partial<VisualSecondaryDynamic>, index: number): VisualSecondaryDynamic {
	const kind=(['hair','cloth','cape','rope','chain','tentacle','wings','springBone'] as string[]).includes(String(input.kind))?input.kind as VisualSecondaryKind:'rope';
	const d=makeVisualSecondary(kind, typeof input.name==='string'&&input.name.trim()?input.name:undefined);
	return {...d,...input,id:typeof input.id==='string'&&input.id?input.id:`secondary-${index+1}`,enabled:input.enabled!==false,kind,anchorMode:input.anchorMode==='primitive'||input.anchorMode==='point'?input.anchorMode:'performerBone',anchorBone:(typeof input.anchorBone==='string'?input.anchorBone:d.anchorBone) as VisualSecondaryDynamic['anchorBone'],targetBone:(typeof input.targetBone==='string'?input.targetBone:d.targetBone) as VisualSecondaryDynamic['targetBone'],anchorEntityId:typeof input.anchorEntityId==='string'?input.anchorEntityId:'',segments:Math.max(1,Math.min(64,Math.round(numberOr(input.segments,d.segments)))),columns:Math.max(1,Math.min(32,Math.round(numberOr(input.columns,d.columns)))),length:Math.max(.05,Math.min(100,numberOr(input.length,d.length))),width:Math.max(.02,Math.min(100,numberOr(input.width,d.width))),radius:Math.max(.005,Math.min(5,numberOr(input.radius,d.radius))),stiffness:Math.max(0,Math.min(1,numberOr(input.stiffness,d.stiffness))),bendStiffness:Math.max(0,Math.min(1,numberOr(input.bendStiffness,d.bendStiffness))),damping:Math.max(.5,Math.min(.9999,numberOr(input.damping,d.damping))),gravityScale:Math.max(-5,Math.min(5,numberOr(input.gravityScale,d.gravityScale))),windInfluence:Math.max(0,Math.min(10,numberOr(input.windInfluence,d.windInfluence))),drag:Math.max(0,Math.min(4,numberOr(input.drag,d.drag))),collisionRadius:Math.max(.001,Math.min(2,numberOr(input.collisionRadius,d.collisionRadius))),audioSource:(['bass','mids','highs','energy','kick','rms','peak','beat','bar'] as string[]).includes(String(input.audioSource))?input.audioSource as VisualAudioSource:'energy',audioImpulse:Math.max(-20,Math.min(20,numberOr(input.audioImpulse,d.audioImpulse))),materialId:typeof input.materialId==='string'?input.materialId:d.materialId,color:typeof input.color==='string'?input.color:d.color,boneInfluence:Math.max(0,Math.min(1,numberOr(input.boneInfluence,d.boneInfluence)))};
}

export function normalizeVisualScene(input: unknown): VisualSceneState {
	if (!input || typeof input !== "object") return structuredClone(DEFAULT_VISUAL_SCENE);
	const raw = input as Omit<Partial<VisualSceneState>, "version"> & { version?: number };
	if (!Array.isArray(raw.layers)) return structuredClone(DEFAULT_VISUAL_SCENE);
	const normalized: VisualSceneState = {
		...structuredClone(DEFAULT_VISUAL_SCENE),
		...raw,
		version: 21,
		project: { ...DEFAULT_VISUAL_SCENE.project, ...(raw.project ?? {}), id: typeof raw.project?.id === "string" && raw.project.id ? raw.project.id : DEFAULT_VISUAL_SCENE.project.id, name: typeof raw.project?.name === "string" && raw.project.name.trim() ? raw.project.name : DEFAULT_VISUAL_SCENE.project.name, mode: raw.project?.mode === "2d" || raw.project?.mode === "3d" ? raw.project.mode : "hybrid" },
		renderer: {
			...DEFAULT_VISUAL_SCENE.renderer,
			...(raw.renderer ?? {}),
			// v19 and older only had direct AA/render-scale controls. Preserve that exact
			// authored behavior by migrating legacy scenes into Custom rather than silently
			// applying a Phase 11 preset.
			editorQuality: (["auto","performance","high","ultra","custom"] as string[]).includes(String(raw.renderer?.editorQuality)) ? raw.renderer!.editorQuality as VisualQualitySelection : (numberOr(raw.version,0)>0&&numberOr(raw.version,0)<20?"custom":DEFAULT_VISUAL_SCENE.renderer.editorQuality),
			programQuality: (["auto","performance","high","ultra","custom"] as string[]).includes(String(raw.renderer?.programQuality)) ? raw.renderer!.programQuality as VisualQualitySelection : (numberOr(raw.version,0)>0&&numberOr(raw.version,0)<20?"custom":DEFAULT_VISUAL_SCENE.renderer.programQuality),
			antialiasMode: ["off","fxaa","smaa","msaa2","msaa4","msaa8"].includes(String(raw.renderer?.antialiasMode)) ? raw.renderer!.antialiasMode : DEFAULT_VISUAL_SCENE.renderer.antialiasMode,
			renderScale: Math.max(.5, Math.min(2, numberOr(raw.renderer?.renderScale, 1))),
			editorAntialias: raw.renderer?.editorAntialias !== false,
			programAntialias: raw.renderer?.programAntialias !== false,
			adaptiveResolution: raw.renderer?.adaptiveResolution === true,
			adaptiveTargetFps: Math.max(24, Math.min(120, numberOr(raw.renderer?.adaptiveTargetFps, 60))),
			adaptiveMinScale: Math.max(.4, Math.min(1, numberOr(raw.renderer?.adaptiveMinScale, .65))),
			adaptiveMaxScale: Math.max(.4, Math.min(1, numberOr(raw.renderer?.adaptiveMaxScale, 1))),
		},
		output: { ...DEFAULT_VISUAL_SCENE.output, ...(raw.output ?? {}) },
		timeline: {
			...DEFAULT_VISUAL_SCENE.timeline,
			...(raw.timeline ?? {}),
			markers: Array.isArray(raw.timeline?.markers)
				? raw.timeline.markers
					.filter((marker): marker is VisualTimelineMarker => !!marker && typeof marker === "object")
					.map(marker => ({
						id: marker.id || crypto.randomUUID(), directorPlanId: typeof marker.directorPlanId === "string" ? marker.directorPlanId : undefined,
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
		materials: Array.isArray(raw.materials) && raw.materials.length ? raw.materials.filter(Boolean).map((material,index)=>normalizeVisualMaterial(material as Partial<VisualMaterialAsset>,index)) : [structuredClone(DEFAULT_VISUAL_MATERIAL)],
		primitives: Array.isArray(raw.primitives) ? raw.primitives.filter(Boolean).map((primitive,index)=>normalizeVisualPrimitive(primitive as Partial<VisualPrimitiveObject>,index)) : [],
		shapes2d: Array.isArray(raw.shapes2d) ? raw.shapes2d.filter(Boolean).map((shape,index)=>normalizeVisualShape2D(shape as Partial<VisualShape2D>,index)) : [],
		secondaryDynamics: Array.isArray(raw.secondaryDynamics) ? raw.secondaryDynamics.filter(Boolean).map((item,index)=>normalizeSecondaryDynamic(item as Partial<VisualSecondaryDynamic>,index)) : [],
		animations: Array.isArray(raw.animations) ? raw.animations.filter(Boolean).map((animation,index)=>normalizeSkeletalAnimation(animation as Partial<VisualSkeletalAnimation>,index)) : [],
		animationCues: Array.isArray(raw.animationCues) ? raw.animationCues.filter(Boolean).map((cue)=>{
			const legacyBlend=Math.max(0,Math.min(2,numberOr(cue.blend,.2)));
			return {id:cue.id||crypto.randomUUID(),directorPlanId:typeof cue.directorPlanId==="string"?cue.directorPlanId:undefined,time:Math.max(0,numberOr(cue.time,0)),duration:Math.max(0,numberOr(cue.duration,0)),trimIn:Math.max(0,numberOr(cue.trimIn,0)),animationId:typeof cue.animationId==="string"?cue.animationId:"",speed:Math.max(.05,numberOr(cue.speed,1)),loop:cue.loop===true,blend:legacyBlend,weight:Math.max(0,Math.min(1,numberOr(cue.weight,legacyBlend))),blendIn:Math.max(0,numberOr(cue.blendIn,.12)),blendOut:Math.max(0,numberOr(cue.blendOut,.18)),layer:(cue.layer==="upperBody"||cue.layer==="lowerBody"||cue.layer==="arms"||cue.layer==="head"?cue.layer:"base") as VisualAnimationLayer,blendMode:(cue.blendMode==="additive"?"additive":"override") as VisualAnimationBlendMode,enabled:cue.enabled!==false};
		}).filter(cue=>cue.animationId).sort((a,b)=>a.time-b.time) : [],
		ikConstraints: Array.isArray(raw.ikConstraints) ? raw.ikConstraints.filter(Boolean).map((constraint,index)=>normalizeIKConstraint(constraint as Partial<VisualIKConstraint>,index)) : [],
		physics: { ...DEFAULT_VISUAL_SCENE.physics, ...(raw.physics ?? {}), gravityY:numberOr(raw.physics?.gravityY,DEFAULT_VISUAL_SCENE.physics.gravityY), groundY:numberOr(raw.physics?.groundY,DEFAULT_VISUAL_SCENE.physics.groundY), resetSequence:Math.max(0,Math.round(numberOr(raw.physics?.resetSequence,0))), mode:raw.physics?.mode==="simulate"?"simulate":"edit", secondaryEnabled:raw.physics?.secondaryEnabled!==false, secondarySubsteps:Math.max(1,Math.min(8,Math.round(numberOr(raw.physics?.secondarySubsteps,2)))), secondaryIterations:Math.max(1,Math.min(16,Math.round(numberOr(raw.physics?.secondaryIterations,5)))), secondaryDebug:raw.physics?.secondaryDebug===true, resetSecondaryOnSeek:raw.physics?.resetSecondaryOnSeek!==false },
		postFx: (()=>{
			const pf=raw.postFx; const validTypes:VisualPostFxModuleType[]=["ambientOcclusion","depthOfField","bloom","lightShafts","colorGrade","lut","lens","film"];
			const stack=Array.isArray(pf?.stack)?pf!.stack.filter(Boolean).map((m,index)=>({id:typeof m.id==="string"&&m.id?m.id:`post-${index+1}`,type:validTypes.includes(m.type as VisualPostFxModuleType)?m.type as VisualPostFxModuleType:"colorGrade",name:typeof m.name==="string"&&m.name.trim()?m.name:`Post FX ${index+1}`,enabled:m.enabled!==false})):structuredClone(DEFAULT_VISUAL_SCENE.postFx.stack);
			return { ...DEFAULT_VISUAL_SCENE.postFx, ...(pf ?? {}), stack,
				toneMapping:(["none","linear","reinhard","cineon","aces","agx","neutral"] as string[]).includes(String(pf?.toneMapping))?pf!.toneMapping as VisualToneMapping:"aces", exposure:Math.max(.05,Math.min(8,numberOr(pf?.exposure,1))),
				saturation:Math.max(0,Math.min(3,numberOr(pf?.saturation,1))), contrast:Math.max(0,Math.min(3,numberOr(pf?.contrast,1))), brightness:Math.max(0,Math.min(3,numberOr(pf?.brightness,1))), temperature:Math.max(-1,Math.min(1,numberOr(pf?.temperature,0))), tint:Math.max(-1,Math.min(1,numberOr(pf?.tint,0))), lift:Math.max(-1,Math.min(1,numberOr(pf?.lift,0))), gamma:Math.max(.1,Math.min(4,numberOr(pf?.gamma,1))), gain:Math.max(0,Math.min(5,numberOr(pf?.gain,1))), lutUrl:typeof pf?.lutUrl==="string"?pf.lutUrl:"", lutFileName:typeof pf?.lutFileName==="string"?pf.lutFileName:"", lutIntensity:Math.max(0,Math.min(1,numberOr(pf?.lutIntensity,1))),
				ambientOcclusionIntensity:Math.max(0,Math.min(4,numberOr(pf?.ambientOcclusionIntensity,1))), ambientOcclusionRadius:Math.max(.1,Math.min(32,numberOr(pf?.ambientOcclusionRadius,4))), lightShaftsIntensity:Math.max(0,Math.min(5,numberOr(pf?.lightShaftsIntensity,0))), lightShaftsSource:pf?.lightShaftsSource==="moon"?"moon":"sun", lightShaftsDecay:Math.max(.7,Math.min(.999,numberOr(pf?.lightShaftsDecay,.94))), lightShaftsDensity:Math.max(.1,Math.min(1.5,numberOr(pf?.lightShaftsDensity,.88))), lightShaftsWeight:Math.max(.01,Math.min(1,numberOr(pf?.lightShaftsWeight,.22))),
				chromaticAberration:Math.max(0,Math.min(1,numberOr(pf?.chromaticAberration,0))), lensDistortion:Math.max(-1,Math.min(1,numberOr(pf?.lensDistortion,0))), lensZoom:Math.max(.5,Math.min(2,numberOr(pf?.lensZoom,1))), halation:Math.max(0,Math.min(2,numberOr(pf?.halation,0))), filmGrain:Math.max(0,Math.min(1,numberOr(pf?.filmGrain,0))), vignette:Math.max(0,Math.min(1,numberOr(pf?.vignette,0))), vignetteSoftness:Math.max(.05,Math.min(1,numberOr(pf?.vignetteSoftness,.45))) };
		})(),
		audioModulation: {
			enabled: raw.audioModulation?.enabled !== false,
			masterAmount: Math.max(0, Math.min(4, numberOr(raw.audioModulation?.masterAmount, 1))),
			testSignal: Math.max(0, Math.min(1, numberOr(raw.audioModulation?.testSignal, 0))),
			bindings: Array.isArray(raw.audioModulation?.bindings) ? raw.audioModulation.bindings.filter(Boolean).map((binding,index)=>({
				id: typeof binding.id === "string" && binding.id ? binding.id : `audio-binding-${index+1}`, directorPlanId: typeof binding.directorPlanId === "string" ? binding.directorPlanId : undefined,
				enabled: binding.enabled !== false,
				name: typeof binding.name === "string" && binding.name.trim() ? binding.name : `Audio Mapping ${index+1}`,
				source: (["bass","mids","highs","energy","kick","rms","peak","beat","bar"] as string[]).includes(String(binding.source)) ? binding.source as VisualAudioSource : "energy",
				target: typeof binding.target === "string" ? binding.target : "stage.bloomStrength",
				amount: Math.max(-100, Math.min(100, numberOr(binding.amount, 1))),
				attack: Math.max(.001, Math.min(10, numberOr(binding.attack, .08))),
				release: Math.max(.001, Math.min(10, numberOr(binding.release, .24))),
				threshold: Math.max(0, Math.min(.99, numberOr(binding.threshold, 0))),
				invert: binding.invert === true,
				curve: binding.curve === "easeIn" || binding.curve === "easeOut" || binding.curve === "linear" ? binding.curve : "smoothstep",
			})) : [],
		},
		director: {
			...DEFAULT_VISUAL_SCENE.director, ...(raw.director ?? {}),
			style: (["balanced","cinematic","aggressive","ethereal","minimal"] as string[]).includes(String(raw.director?.style)) ? raw.director!.style as VisualAiDirectorStyle : DEFAULT_VISUAL_SCENE.director.style,
			scope: (["full","camera","performance","atmosphere","post","reactivity"] as string[]).includes(String(raw.director?.scope)) ? raw.director!.scope as VisualAiDirectorScope : DEFAULT_VISUAL_SCENE.director.scope,
			intensity: Math.max(.1, Math.min(1.5, numberOr(raw.director?.intensity, DEFAULT_VISUAL_SCENE.director.intensity))),
			preserveManual: raw.director?.preserveManual !== false,
			replacePreviousDirectorPlan: raw.director?.replacePreviousDirectorPlan !== false,
			seed: Math.max(0, Math.min(2147483647, Math.round(numberOr(raw.director?.seed, DEFAULT_VISUAL_SCENE.director.seed)))),
			prompt: typeof raw.director?.prompt === "string" ? raw.director.prompt.slice(0,4000) : "",
			lastPlanId: typeof raw.director?.lastPlanId === "string" ? raw.director.lastPlanId : "",
			lastPlanSummary: typeof raw.director?.lastPlanSummary === "string" ? raw.director.lastPlanSummary.slice(0,1000) : "",
			lastPlanSource: raw.director?.lastPlanSource === "ai" || raw.director?.lastPlanSource === "fallback" ? raw.director.lastPlanSource : "",
			lastAppliedAt: Math.max(0, numberOr(raw.director?.lastAppliedAt, 0)),
		},
		object: { ...DEFAULT_VISUAL_SCENE.object, ...(raw.object ?? {}), modelFormat: raw.object?.modelFormat === "fbx" || raw.object?.modelFormat === "obj" || raw.object?.modelFormat === "gltf" ? raw.object.modelFormat : "glb", materialId: typeof raw.object?.materialId === "string" ? raw.object.materialId : "", humanoidMap: raw.object?.humanoidMap && typeof raw.object.humanoidMap === "object" ? raw.object.humanoidMap : {}, morphTargets: raw.object?.morphTargets && typeof raw.object.morphTargets === "object" ? raw.object.morphTargets : {} },
		camera: {
			...DEFAULT_VISUAL_SCENE.camera,
			...((raw as Partial<VisualSceneState>).camera ?? {}),
			positionX: numberOr((raw as Partial<VisualSceneState>).camera?.positionX, 0),
			positionY: numberOr((raw as Partial<VisualSceneState>).camera?.positionY, numberOr(raw.object?.cameraHeight, DEFAULT_VISUAL_SCENE.camera.positionY)),
			positionZ: numberOr((raw as Partial<VisualSceneState>).camera?.positionZ, numberOr(raw.object?.cameraDistance, DEFAULT_VISUAL_SCENE.camera.positionZ)),
			targetX: numberOr((raw as Partial<VisualSceneState>).camera?.targetX, 0),
			targetY: numberOr((raw as Partial<VisualSceneState>).camera?.targetY, numberOr(raw.object?.cameraTargetY, DEFAULT_VISUAL_SCENE.camera.targetY)),
			targetZ: numberOr((raw as Partial<VisualSceneState>).camera?.targetZ, 0),
			fov: numberOr((raw as Partial<VisualSceneState>).camera?.fov, numberOr(raw.object?.cameraFov, DEFAULT_VISUAL_SCENE.camera.fov)),
			loop: (raw as Partial<VisualSceneState>).camera?.loop === true,
			keyframes: Array.isArray((raw as Partial<VisualSceneState>).camera?.keyframes) ? ((raw as Partial<VisualSceneState>).camera!.keyframes as VisualCameraKeyframe[]).filter(Boolean).map(keyframe => ({
				id: keyframe.id || crypto.randomUUID(), time: Math.max(0, numberOr(keyframe.time, 0)),
				positionX: numberOr(keyframe.positionX, 0), positionY: numberOr(keyframe.positionY, DEFAULT_VISUAL_SCENE.camera.positionY), positionZ: numberOr(keyframe.positionZ, DEFAULT_VISUAL_SCENE.camera.positionZ),
				targetX: numberOr(keyframe.targetX, 0), targetY: numberOr(keyframe.targetY, 0), targetZ: numberOr(keyframe.targetZ, 0), fov: numberOr(keyframe.fov, DEFAULT_VISUAL_SCENE.camera.fov),
			})).sort((a,b)=>a.time-b.time) : [],
		},
		cameras: [],
		activeCameraId: typeof raw.activeCameraId === "string" ? raw.activeCameraId : DEFAULT_VISUAL_SCENE.activeCameraId,
		cameraCuts: Array.isArray(raw.cameraCuts) ? raw.cameraCuts.filter(Boolean).map(cut => ({
			id: cut.id || crypto.randomUUID(), directorPlanId: typeof cut.directorPlanId === "string" ? cut.directorPlanId : undefined, time: Math.max(0, numberOr(cut.time, 0)), cameraId: typeof cut.cameraId === "string" ? cut.cameraId : DEFAULT_VISUAL_SCENE.activeCameraId,
		})).sort((a,b)=>a.time-b.time) : [],
		performance: {
			...DEFAULT_VISUAL_SCENE.performance,
			...(raw.performance ?? {}),
			timelineCues: Array.isArray(raw.performance?.timelineCues)
				? raw.performance.timelineCues
					.filter((cue): cue is VisualPerformanceTimelineCue => !!cue && typeof cue === "object" && typeof cue.cueId === "string")
					.map(cue => ({ id: cue.id || crypto.randomUUID(), directorPlanId: typeof cue.directorPlanId === "string" ? cue.directorPlanId : undefined, time: Math.max(0, numberOr(cue.time, 0)), cueId: cue.cueId, strength: Math.max(0.1, Math.min(2, numberOr(cue.strength, 1))) }))
				: [],
		},
		grid: { ...DEFAULT_VISUAL_SCENE.grid, ...(raw.grid ?? {}) },
		stage: { ...DEFAULT_VISUAL_SCENE.stage, ...(raw.stage ?? {}), ambientSkyColor:typeof raw.stage?.ambientSkyColor==="string"?raw.stage.ambientSkyColor:DEFAULT_VISUAL_SCENE.stage.ambientSkyColor, ambientGroundColor:typeof raw.stage?.ambientGroundColor==="string"?raw.stage.ambientGroundColor:DEFAULT_VISUAL_SCENE.stage.ambientGroundColor, moonEnabled:raw.stage?.moonEnabled===true, moonColor:typeof raw.stage?.moonColor==="string"?raw.stage.moonColor:DEFAULT_VISUAL_SCENE.stage.moonColor, moonIntensity:Math.max(0,Math.min(20,numberOr(raw.stage?.moonIntensity,DEFAULT_VISUAL_SCENE.stage.moonIntensity))), moonX:numberOr(raw.stage?.moonX,DEFAULT_VISUAL_SCENE.stage.moonX), moonY:numberOr(raw.stage?.moonY,DEFAULT_VISUAL_SCENE.stage.moonY), moonZ:numberOr(raw.stage?.moonZ,DEFAULT_VISUAL_SCENE.stage.moonZ), moonSource:(["bass","mids","highs","energy","kick","rms","peak"] as VisualAudioSource[]).includes(raw.stage?.moonSource as VisualAudioSource)?raw.stage!.moonSource as VisualAudioSource:DEFAULT_VISUAL_SCENE.stage.moonSource, moonAmount:Math.max(0,Math.min(10,numberOr(raw.stage?.moonAmount,DEFAULT_VISUAL_SCENE.stage.moonAmount))), shadowMapSize:[512,1024,2048,4096].includes(Math.round(numberOr(raw.stage?.shadowMapSize,1024)))?Math.round(numberOr(raw.stage?.shadowMapSize,1024)):1024, shadowBias:Math.max(-.02,Math.min(.02,numberOr(raw.stage?.shadowBias,-.00035))), sunShadows:raw.stage?.sunShadows!==false, moonShadows:raw.stage?.moonShadows===true, keyShadows:raw.stage?.keyShadows!==false },
		sky: { ...DEFAULT_VISUAL_SCENE.sky, ...(raw.sky ?? {}) },
		particles: { ...DEFAULT_VISUAL_SCENE.particles, ...(raw.particles ?? {}) },
		clouds: { ...DEFAULT_VISUAL_SCENE.clouds, ...(raw.clouds ?? {}), lightAbsorption:Math.max(0,Math.min(1,numberOr(raw.clouds?.lightAbsorption,DEFAULT_VISUAL_SCENE.clouds.lightAbsorption))) },
		wind: { ...DEFAULT_VISUAL_SCENE.wind, ...(raw.wind ?? {}), directionX:numberOr(raw.wind?.directionX,DEFAULT_VISUAL_SCENE.wind.directionX), directionZ:numberOr(raw.wind?.directionZ,DEFAULT_VISUAL_SCENE.wind.directionZ), strength:Math.max(0,Math.min(20,numberOr(raw.wind?.strength,DEFAULT_VISUAL_SCENE.wind.strength))), gustiness:Math.max(0,Math.min(2,numberOr(raw.wind?.gustiness,DEFAULT_VISUAL_SCENE.wind.gustiness))), turbulence:Math.max(0,Math.min(4,numberOr(raw.wind?.turbulence,DEFAULT_VISUAL_SCENE.wind.turbulence))), physicsForce:Math.max(0,Math.min(100,numberOr(raw.wind?.physicsForce,DEFAULT_VISUAL_SCENE.wind.physicsForce))) },
		weather: { ...DEFAULT_VISUAL_SCENE.weather, ...(raw.weather ?? {}), preset:(["clear","rain","snow","storm","ash","dust","sandstorm","magic"] as string[]).includes(String(raw.weather?.preset))?raw.weather!.preset as VisualWeatherPreset:"clear", intensity:Math.max(0,Math.min(3,numberOr(raw.weather?.intensity,1))), rain:Math.max(0,Math.min(1,numberOr(raw.weather?.rain,0))), snow:Math.max(0,Math.min(1,numberOr(raw.weather?.snow,0))), ash:Math.max(0,Math.min(1,numberOr(raw.weather?.ash,0))), dust:Math.max(0,Math.min(1,numberOr(raw.weather?.dust,0))), sand:Math.max(0,Math.min(1,numberOr(raw.weather?.sand,0))), magic:Math.max(0,Math.min(1,numberOr(raw.weather?.magic,0))), fog:Math.max(0,Math.min(1,numberOr(raw.weather?.fog,0))), heatHaze:Math.max(0,Math.min(1,numberOr(raw.weather?.heatHaze,0))), heatHazeSpeed:Math.max(0,Math.min(5,numberOr(raw.weather?.heatHazeSpeed,.8))), lightning:Math.max(0,Math.min(1,numberOr(raw.weather?.lightning,0))), lightningRate:Math.max(0,Math.min(120,numberOr(raw.weather?.lightningRate,8))), precipitationSize:Math.max(.1,Math.min(5,numberOr(raw.weather?.precipitationSize,1))), fallSpeed:Math.max(.05,Math.min(8,numberOr(raw.weather?.fallSpeed,1))), area:Math.max(2,Math.min(200,numberOr(raw.weather?.area,24))), height:Math.max(2,Math.min(200,numberOr(raw.weather?.height,18))) },
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
			entityId: typeof layer.entityId === "string" ? layer.entityId : undefined,
			fit: layer.fit,
			loop: layer.loop,
			speed: layer.speed,
			sourceDuration: layer.sourceDuration,
			// Phase 3 keeps core layers continuous by default (duration 0), but explicit
			// timeline ranges are now preserved so every visual scene object can be trimmed.
			timeline: normalizeTimeline(layer.timeline),
		})),
	};
	const rawCameras = Array.isArray(raw.cameras) ? raw.cameras : [];
	normalized.cameras = (rawCameras.length ? rawCameras : [{
		...DEFAULT_VISUAL_SCENE.cameras[0],
		positionX: normalized.camera.positionX, positionY: normalized.camera.positionY, positionZ: normalized.camera.positionZ,
		targetX: normalized.camera.targetX, targetY: normalized.camera.targetY, targetZ: normalized.camera.targetZ,
		fov: normalized.camera.fov, loop: normalized.camera.loop, keyframes: normalized.camera.keyframes,
	}]).filter(Boolean).map((camera, index) => {
		const fallback = DEFAULT_VISUAL_SCENE.cameras[0];
		const source = camera as Partial<VisualProgramCamera>;
		return {
			...fallback, ...source,
			id: typeof source.id === "string" && source.id ? source.id : `program-camera-${index + 1}`,
			name: typeof source.name === "string" && source.name.trim() ? source.name : `Program Camera ${index + 1}`,
			enabled: source.enabled !== false,
			aimMode: source.aimMode === "rotation" ? "rotation" : "target",
			targetMode: source.targetMode === "performer" || source.targetMode === "primitive" ? source.targetMode : "point",
			targetEntityId: typeof source.targetEntityId === "string" ? source.targetEntityId : "",
			targetOffsetX: numberOr(source.targetOffsetX, 0), targetOffsetY: numberOr(source.targetOffsetY, 0), targetOffsetZ: numberOr(source.targetOffsetZ, 0),
			positionX: numberOr(source.positionX, fallback.positionX), positionY: numberOr(source.positionY, fallback.positionY), positionZ: numberOr(source.positionZ, fallback.positionZ),
			rotationX: numberOr(source.rotationX, 0), rotationY: numberOr(source.rotationY, 0), rotationZ: numberOr(source.rotationZ, 0),
			targetX: numberOr(source.targetX, fallback.targetX), targetY: numberOr(source.targetY, fallback.targetY), targetZ: numberOr(source.targetZ, fallback.targetZ),
			fov: numberOr(source.fov, fallback.fov), near: Math.max(0.01, numberOr(source.near, fallback.near)), far: Math.max(1, numberOr(source.far, fallback.far)),
			focusDistance: Math.max(0.1, numberOr(source.focusDistance, fallback.focusDistance)), aperture: Math.max(0.1, numberOr(source.aperture, fallback.aperture)), dofAmount: Math.max(0, numberOr(source.dofAmount, fallback.dofAmount)),
			dofBalance: Math.max(-1, Math.min(1, numberOr(source.dofBalance, source.dofAmount ? Math.min(1,source.dofAmount) : fallback.dofBalance))), focusRange: Math.max(.02, numberOr(source.focusRange,fallback.focusRange)), maxBlur: Math.max(0,Math.min(40,numberOr(source.maxBlur,fallback.maxBlur))),
			bokehSize: Math.max(.1,Math.min(4,numberOr(source.bokehSize,fallback.bokehSize))), bokehBlades: Math.max(3,Math.min(12,Math.round(numberOr(source.bokehBlades,fallback.bokehBlades)))), bokehRotation:numberOr(source.bokehRotation,fallback.bokehRotation), bokehThreshold:Math.max(0,Math.min(3,numberOr(source.bokehThreshold,fallback.bokehThreshold))), bokehGain:Math.max(0,Math.min(5,numberOr(source.bokehGain,fallback.bokehGain))), bokehAnamorphic:Math.max(.25,Math.min(4,numberOr(source.bokehAnamorphic,fallback.bokehAnamorphic))), lensFlare: Math.max(0, numberOr(source.lensFlare, fallback.lensFlare)),
			exposure: Math.max(.05,Math.min(8,numberOr(source.exposure,fallback.exposure))), shakeAmount: Math.max(0,Math.min(10,numberOr(source.shakeAmount,fallback.shakeAmount))), shakeFrequency: Math.max(.05,Math.min(30,numberOr(source.shakeFrequency,fallback.shakeFrequency))), shakeRotation: Math.max(0,Math.min(45,numberOr(source.shakeRotation,fallback.shakeRotation))), shakeSeed: numberOr(source.shakeSeed,index+1),
			pathInterpolation: source.pathInterpolation === "linear" || source.pathInterpolation === "catmullRom" ? source.pathInterpolation : "smooth", pathClosed: source.pathClosed === true, showPath: source.showPath === true,
			showThirds: source.showThirds === true, showCenter: source.showCenter === true, showSafeAreas: source.showSafeAreas === true,
			showModel: source.showModel !== false, fadeModelWhenNear: source.fadeModelWhenNear !== false, showFov: source.showFov === true, showForward: source.showForward === true, showTarget: source.showTarget === true, helperLength: Math.max(1,Math.min(100,numberOr(source.helperLength,fallback.helperLength))),
			loop: source.loop === true,
			keyframes: Array.isArray(source.keyframes) ? source.keyframes.filter(Boolean).map(keyframe => ({
				...keyframe, id: keyframe.id || crypto.randomUUID(), directorPlanId: typeof keyframe.directorPlanId === "string" ? keyframe.directorPlanId : undefined, time: Math.max(0, numberOr(keyframe.time, 0)),
				positionX: numberOr(keyframe.positionX, fallback.positionX), positionY: numberOr(keyframe.positionY, fallback.positionY), positionZ: numberOr(keyframe.positionZ, fallback.positionZ),
				targetX: numberOr(keyframe.targetX, fallback.targetX), targetY: numberOr(keyframe.targetY, fallback.targetY), targetZ: numberOr(keyframe.targetZ, fallback.targetZ), targetOffsetX:numberOr(keyframe.targetOffsetX,source.targetOffsetX ?? 0), targetOffsetY:numberOr(keyframe.targetOffsetY,source.targetOffsetY ?? 0), targetOffsetZ:numberOr(keyframe.targetOffsetZ,source.targetOffsetZ ?? 0), fov: numberOr(keyframe.fov, fallback.fov),
				rotationX: numberOr(keyframe.rotationX, source.rotationX ?? 0), rotationY: numberOr(keyframe.rotationY, source.rotationY ?? 0), rotationZ: numberOr(keyframe.rotationZ, source.rotationZ ?? 0),
				focusDistance: Math.max(0.1, numberOr(keyframe.focusDistance, source.focusDistance ?? fallback.focusDistance)), aperture: Math.max(0.1, numberOr(keyframe.aperture, source.aperture ?? fallback.aperture)), dofAmount: Math.max(0, numberOr(keyframe.dofAmount, source.dofAmount ?? fallback.dofAmount)), dofBalance: Math.max(-1,Math.min(1,numberOr(keyframe.dofBalance,source.dofBalance ?? fallback.dofBalance))), focusRange:Math.max(.02,numberOr(keyframe.focusRange,source.focusRange ?? fallback.focusRange)), maxBlur:Math.max(0,numberOr(keyframe.maxBlur,source.maxBlur ?? fallback.maxBlur)), bokehSize:Math.max(.1,numberOr(keyframe.bokehSize,source.bokehSize ?? fallback.bokehSize)),
				exposure: Math.max(.05,Math.min(8,numberOr(keyframe.exposure,source.exposure ?? fallback.exposure))), shakeAmount:Math.max(0,Math.min(10,numberOr(keyframe.shakeAmount,source.shakeAmount ?? fallback.shakeAmount))), shakeFrequency:Math.max(.05,Math.min(30,numberOr(keyframe.shakeFrequency,source.shakeFrequency ?? fallback.shakeFrequency))), shakeRotation:Math.max(0,Math.min(45,numberOr(keyframe.shakeRotation,source.shakeRotation ?? fallback.shakeRotation))),
				easing: (keyframe.easing === "linear" || keyframe.easing === "easeIn" || keyframe.easing === "easeOut" || keyframe.easing === "easeInOut" || keyframe.easing === "hold" ? keyframe.easing : "inherit") as VisualCameraSegmentEasing,
			})).sort((a,b)=>a.time-b.time) : [],
		} satisfies VisualProgramCamera;
	});
	if (!normalized.cameras.some(camera => camera.id === normalized.activeCameraId)) normalized.activeCameraId = normalized.cameras[0]?.id || DEFAULT_VISUAL_SCENE.activeCameraId;
	normalized.cameraCuts = normalized.cameraCuts.filter(cut => normalized.cameras.some(camera => camera.id === cut.cameraId));
	if ((raw.version ?? 0) < 12) {
		// Old builds accidentally persisted finite ranges on core layers, making them
		// disappear after seeking/restart. Migrate those old core ranges to continuous.
		normalized.layers = normalized.layers.map(layer => layer.type === "media" ? layer : { ...layer, timeline: { start: 0, duration: 0, trimIn: 0, trimOut: 0, fadeIn: 0, fadeOut: 0 } });
	}
	if ((raw.version ?? 0) < 4) {
		normalized.object.rotationSpeed = 0;
		normalized.object.idleAmount = 0.08;
		normalized.object.bodyAmount = Math.max(0.8, normalized.object.bodyAmount ?? 0.8);
		normalized.object.armAmount = Math.max(0.8, normalized.object.armAmount ?? 0.8);
	}
	if ((raw.version ?? 0) < 11) {
		// Older builds used an opaque floor under the grid, which visually buried background video/stills.
		// Migrate to the transparent-grid-first editor behavior. Users can explicitly re-enable the floor.
		normalized.stage.floorVisible = false;
		normalized.stage.floorOpacity = 0.24;
	}
	// Pre-v21 scenes relied on implicit core layers. Preserve those old projects, but
	// never re-inject demo/system layers into a v21+ project whose author intentionally
	// removed them (especially a newly-created blank project).
	if ((raw.version ?? 0) < 21) {
		if (!normalized.layers.some((layer) => layer.type === "sky")) {
			const skyLayer = structuredClone(DEFAULT_VISUAL_SCENE.layers.find(layer => layer.type === "sky")!);
			normalized.layers.splice(Math.min(1, normalized.layers.length), 0, skyLayer);
		}
		if (!normalized.layers.some((layer) => layer.type === "stage")) {
			normalized.layers.unshift(structuredClone(DEFAULT_VISUAL_SCENE.layers[0]));
		}
		if (!normalized.layers.some((layer) => layer.type === "clouds")) {
			const cloudsLayer = structuredClone(DEFAULT_VISUAL_SCENE.layers.find(layer => layer.type === "clouds")!);
			const skyIndex = normalized.layers.findIndex(layer => layer.type === "sky");
			normalized.layers.splice(skyIndex >= 0 ? skyIndex + 1 : 1, 0, cloudsLayer);
		}
		if (!normalized.layers.some((layer) => layer.type === "weather")) {
			const weatherLayer = structuredClone(DEFAULT_VISUAL_SCENE.layers.find(layer => layer.type === "weather")!);
			const cloudsIndex = normalized.layers.findIndex(layer => layer.type === "clouds");
			normalized.layers.splice(cloudsIndex >= 0 ? cloudsIndex + 1 : Math.min(2, normalized.layers.length), 0, weatherLayer);
		}
	}

	if (!normalized.materials.some(material=>material.id==="material-default")) normalized.materials.unshift(structuredClone(DEFAULT_VISUAL_MATERIAL));
	const validMaterialIds=new Set(normalized.materials.map(material=>material.id));
	normalized.primitives=normalized.primitives.map(primitive=>validMaterialIds.has(primitive.materialId)?primitive:{...primitive,materialId:"material-default"});
	for (const primitive of normalized.primitives) {
		if (!normalized.layers.some(layer=>layer.type==="primitive"&&layer.entityId===primitive.id)) normalized.layers.push({id:`layer-${primitive.id}`,type:"primitive",name:primitive.name,visible:primitive.visible,locked:primitive.locked,opacity:1,entityId:primitive.id,timeline:{start:0,duration:0,trimIn:0,trimOut:0,fadeIn:0,fadeOut:0}});
	}
	for (const shape of normalized.shapes2d) {
		if (!normalized.layers.some(layer=>layer.type==="shape2d"&&layer.entityId===shape.id)) normalized.layers.push({id:`layer-${shape.id}`,type:"shape2d",name:shape.name,visible:true,locked:false,opacity:1,entityId:shape.id,timeline:{start:0,duration:0,trimIn:0,trimOut:0,fadeIn:0,fadeOut:0}});
	}
	normalized.animationCues=normalized.animationCues.filter(cue=>normalized.animations.some(animation=>animation.id===cue.animationId));

	// Recover Media Bin entries from timeline media layers when older persisted scenes
	// retained their URLs but lost the separate asset index. This keeps imported media
	// reusable after restart instead of leaving a visible clip backed by "0 assets".
	if (normalized.assets.length === 0) {
		const seen = new Set<string>();
		for (const layer of normalized.layers) {
			if (layer.type !== "media" || !layer.mediaUrl || (layer.mediaKind !== "image" && layer.mediaKind !== "video")) continue;
			if (seen.has(layer.mediaUrl)) continue;
			seen.add(layer.mediaUrl);
			normalized.assets.push({
				id: `recovered-${layer.id}`,
				name: layer.fileName || layer.name || (layer.mediaKind === "video" ? "Recovered video" : "Recovered image"),
				kind: layer.mediaKind,
				url: layer.mediaUrl,
				duration: Math.max(0, numberOr(layer.sourceDuration, 0)),
			});
		}
	}
	return normalized;
}

export function createBlankVisualScene(mode: VisualProjectMode, name = "Untitled Visual"): VisualSceneState {
	const next=structuredClone(DEFAULT_VISUAL_SCENE);
	next.project={id:`visual-project-${crypto.randomUUID()}`,name,mode};
	next.updatedAt=Date.now();
	next.assets=[]; next.primitives=[]; next.shapes2d=[]; next.secondaryDynamics=[]; next.animations=[]; next.animationCues=[]; next.ikConstraints=[]; next.cameraCuts=[]; next.timeline.markers=[]; next.audioModulation.bindings=[]; next.audioModulation.testSignal=0;
	next.object.modelUrl=""; next.object.modelFileName=""; next.object.animation=""; next.object.materialId=""; next.object.humanoidMap={}; next.object.morphTargets={};
	next.performance.timelineCues=[]; next.performance.manualCueSequence=0; next.performance.autoDirector=false; next.director.lastPlanId=""; next.director.lastPlanSummary=""; next.director.lastPlanSource=""; next.director.lastAppliedAt=0;
	// A blank project is genuinely blank. Runtime/editor infrastructure may still exist,
	// but no optional visual/physics/post stack is active until the user creates it.
	next.postFx.stack=[]; next.postFx.colorGradeEnabled=false; next.postFx.lutUrl=""; next.postFx.lutFileName="";
	next.physics.enabled=false; next.physics.secondaryEnabled=false; next.wind.enabled=false;
	next.cameras=mode==="2d"?[]:[structuredClone(DEFAULT_VISUAL_SCENE.cameras[0])];
	next.activeCameraId=next.cameras[0]?.id||"";
	if (mode==="2d") next.layers=[];
	else next.layers=[]; // Blank means blank. Cameras are scene infrastructure, not demo content.
	return next;
}

export function isLayerAllowedInProject(mode: VisualProjectMode, type: VisualLayerType) {
	// Media and graphic overlays can sit over either a 2D or 3D scene. Only authored
	// 2D shapes and world-space 3D objects are mode-specific.
	const universal=type==="media"||type==="spectrum"||type==="nowPlaying";
	const is2D=type==="shape2d";
	const is3D=type==="stage"||type==="sky"||type==="clouds"||type==="weather"||type==="particles"||type==="object"||type==="primitive"||type==="secondary";
	return universal || mode==="hybrid" || (mode==="2d"&&is2D) || (mode==="3d"&&is3D);
}

export function weatherPresetPatch(preset: VisualWeatherPreset): Partial<VisualSceneState["weather"]> {
	if (preset === "rain") return { preset, rain:.82, snow:0, ash:0, dust:.08, sand:0, magic:0, fog:.18, heatHaze:0, lightning:.08, fallSpeed:1.25 };
	if (preset === "snow") return { preset, rain:0, snow:.82, ash:0, dust:0, sand:0, magic:0, fog:.22, heatHaze:0, lightning:0, fallSpeed:.42 };
	if (preset === "storm") return { preset, rain:1, snow:0, ash:0, dust:.14, sand:0, magic:0, fog:.38, heatHaze:.04, lightning:.9, lightningRate:14, fallSpeed:1.65 };
	if (preset === "ash") return { preset, rain:0, snow:0, ash:.86, dust:.28, sand:0, magic:0, fog:.3, heatHaze:.12, lightning:.04, fallSpeed:.28 };
	if (preset === "dust") return { preset, rain:0, snow:0, ash:0, dust:.9, sand:.12, magic:0, fog:.42, heatHaze:.18, lightning:0, fallSpeed:.12 };
	if (preset === "sandstorm") return { preset, rain:0, snow:0, ash:0, dust:.72, sand:1, magic:0, fog:.72, fogColor:"#b98a52", heatHaze:.34, lightning:.12, fallSpeed:.18 };
	if (preset === "magic") return { preset, rain:0, snow:.08, ash:0, dust:.08, sand:0, magic:1, fog:.22, fogColor:"#5f50a8", heatHaze:.16, lightning:.35, lightningRate:9, fallSpeed:.22 };
	return { preset:"clear", rain:0, snow:0, ash:0, dust:0, sand:0, magic:0, fog:0, heatHaze:0, lightning:0 };
}

export function visualAudioValue(source: VisualAudioSource, frame: {
	bass: number; mids: number; highs: number; energy: number; kick: number; rms: number; peak: number;
}) {
	// Beat/bar require transport tempo and are evaluated by visualsModulation.ts. Legacy
	// per-control audio reactions safely resolve them to zero here.
	if (source === "beat" || source === "bar") return 0;
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
