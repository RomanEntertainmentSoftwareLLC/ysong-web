export const YSONG_VISUALS_CHANNEL = "ysong.visuals.phase1.v1";
export const YSONG_VISUAL_OUTPUT_NAME = "YSongVisualOutput";
export const YSONG_VISUAL_OUTPUT_TITLE = "YSong Visual Output";

export type VisualOutputStats = {
	type: "visual-output-stats";
	timestamp: number;
	fps: number;
	frameTimeMs: number;
	width: number;
	height: number;
	webgl: "WebGL2";
	renderer: string;
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

export type VisualModelInfo = {
	type: "visual-model-info";
	timestamp: number;
	fileName: string;
	bones: string[];
	animations: string[];
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
