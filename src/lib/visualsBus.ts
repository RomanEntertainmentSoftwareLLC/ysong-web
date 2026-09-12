export const YSONG_VISUALS_CHANNEL = "ysong.visuals.phase1.v1";
export const YSONG_VISUAL_OUTPUT_NAME = "YSongVisualOutput";
export const YSONG_VISUAL_OUTPUT_TITLE = "YSong Visual Output";

export type VisualOutputStats = {
	type: "visual-output-stats";
	timestamp: number;
	fps: number;
	frameTimeMs: number;
	/** Logical composition size before quality scaling. */
	width: number;
	height: number;
	/** Actual internal 3D render target size after quality/adaptive scaling. */
	internalWidth: number;
	internalHeight: number;
	webgl: "WebGL2";
	renderer: string;
	gpuClass: "software" | "integrated" | "entry" | "mid" | "high" | "unknown";
	qualitySelection: "auto" | "performance" | "high" | "ultra" | "custom";
	qualityTier: "performance" | "high" | "ultra" | "custom";
	qualityLabel: string;
	renderScale: number;
	adaptiveScale: number;
	antialiasMode: "off" | "fxaa" | "smaa" | "msaa2" | "msaa4" | "msaa8";
	maxSamples: number;
	maxTextureSize: number;
	maxAnisotropy: number;
	drawCalls: number;
	triangles: number;
	textures: number;
	geometries: number;
	recommendedTier: "performance" | "high" | "ultra";
	rtxClassHint: boolean;
};

export type VisualOutputError = {
	type: "visual-output-error";
	timestamp: number;
	message: string;
};


export type VisualPerformanceState = {
	type: "visual-performance-state";
	timestamp: number;
	cueId: string;
	label: string;
	category: string;
	progress: number;
	source: "manual" | "auto" | "timeline" | "idle";
};


export type VisualImportedAnimationTrack = {
	name: string;
	property: "position" | "quaternion" | "scale" | "other";
	times: number[];
	values: number[];
	valueSize: number;
};

export type VisualImportedAnimationClip = {
	name: string;
	duration: number;
	tracks: VisualImportedAnimationTrack[];
};

export type VisualModelInfo = {
	type: "visual-model-info";
	timestamp: number;
	fileName: string;
	bones: string[];
	animations: string[];
	animationClips: VisualImportedAnimationClip[];
	morphTargets: string[];
	meshes: number;
};

export type VisualOutputMessage = VisualOutputStats | VisualOutputError | VisualModelInfo | VisualPerformanceState;

export function openVisualOutput() {
	const url = new URL("/visual-output", window.location.origin);
	const visualWindow = window.open(
		url.toString(),
		YSONG_VISUAL_OUTPUT_NAME,
		"popup=yes,width=1280,height=720,resizable=yes,scrollbars=no",
	);
	visualWindow?.focus();
	return visualWindow;
}
