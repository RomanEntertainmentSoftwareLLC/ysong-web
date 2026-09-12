import * as THREE from "three";
import type { VisualAntialiasMode, VisualQualitySelection, VisualQualityTier } from "./visualsScene";

export type VisualGpuClass = "software" | "integrated" | "entry" | "mid" | "high" | "unknown";

export type VisualRendererCapabilities = {
	renderer: string;
	gpuClass: VisualGpuClass;
	webgl2: boolean;
	maxTextureSize: number;
	maxRenderbufferSize: number;
	maxSamples: number;
	maxAnisotropy: number;
	precision: string;
	recommendedTier: VisualQualityTier;
	rtxClassHint: boolean;
};

export type VisualRuntimeQuality = {
	selection: VisualQualitySelection;
	tier: VisualQualityTier | "custom";
	label: string;
	renderScale: number;
	antialiasMode: VisualAntialiasMode;
	shadowMapSize: 512 | 1024 | 2048 | 4096;
	cloudMultiplier: number;
	particleMultiplier: number;
	weatherMultiplier: number;
	aoSamples: number;
	secondarySubsteps: number;
	secondaryIterations: number;
	skyPolygonCap: number;
	maxAnisotropy: number;
};

type CustomQuality = {
	renderScale: number;
	antialiasMode: VisualAntialiasMode;
	shadowMapSize: number;
	secondarySubsteps: number;
	secondaryIterations: number;
};

const PROFILE: Record<VisualQualityTier, Omit<VisualRuntimeQuality, "selection" | "tier" | "label" | "maxAnisotropy"> & { maxAnisotropy: number }> = {
	performance: {
		renderScale: 0.75,
		antialiasMode: "fxaa",
		shadowMapSize: 1024,
		cloudMultiplier: 0.62,
		particleMultiplier: 0.58,
		weatherMultiplier: 0.62,
		aoSamples: 6,
		secondarySubsteps: 1,
		secondaryIterations: 3,
		skyPolygonCap: 4096,
		maxAnisotropy: 2,
	},
	high: {
		renderScale: 1,
		antialiasMode: "smaa",
		shadowMapSize: 2048,
		cloudMultiplier: 1,
		particleMultiplier: 1,
		weatherMultiplier: 1,
		aoSamples: 12,
		secondarySubsteps: 2,
		secondaryIterations: 5,
		skyPolygonCap: 16384,
		maxAnisotropy: 8,
	},
	ultra: {
		renderScale: 1.25,
		antialiasMode: "msaa4",
		shadowMapSize: 4096,
		cloudMultiplier: 1.38,
		particleMultiplier: 1.32,
		weatherMultiplier: 1.28,
		aoSamples: 16,
		secondarySubsteps: 3,
		secondaryIterations: 7,
		skyPolygonCap: 65536,
		maxAnisotropy: 16,
	},
};

function rendererGpuClass(rendererName: string): VisualGpuClass {
	const name = rendererName.toLowerCase();
	if (/swiftshader|llvmpipe|software|mesa offscreen/.test(name)) return "software";
	if (/intel.*(hd|uhd)|iris|mali|adreno|vivante/.test(name)) return "integrated";
	if (/gtx\s*(6|7|8|9)\d{2}|radeon\s*(hd|r[579])/.test(name)) return "entry";
	if (/gtx\s*10\d0|gtx\s*16\d0|rx\s*(4|5)\d{3}|arc\s*a[357]/.test(name)) return "mid";
	if (/rtx\s*(20|30|40|50)\d{2}|rx\s*(6|7|8|9)\d{3}|apple\s*m[1-9]/.test(name)) return "high";
	return "unknown";
}

function recommendTier(gpuClass: VisualGpuClass, maxSamples: number, maxTextureSize: number): VisualQualityTier {
	if (gpuClass === "software" || gpuClass === "integrated" || maxTextureSize < 8192) return "performance";
	if (gpuClass === "high" && maxSamples >= 4 && maxTextureSize >= 16384) return "ultra";
	return "high";
}

export function readVisualRendererCapabilities(renderer: THREE.WebGLRenderer, rendererName: string): VisualRendererCapabilities {
	const gl = renderer.getContext();
	const maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 4096;
	const maxRenderbufferSize = Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)) || maxTextureSize;
	const maxSamples = Math.max(0, Number(renderer.capabilities.maxSamples) || 0);
	const maxAnisotropy = Math.max(1, Number(renderer.capabilities.getMaxAnisotropy?.()) || 1);
	const gpuClass = rendererGpuClass(rendererName);
	return {
		renderer: rendererName,
		gpuClass,
		webgl2: renderer.capabilities.isWebGL2,
		maxTextureSize,
		maxRenderbufferSize,
		maxSamples,
		maxAnisotropy,
		precision: renderer.capabilities.precision,
		recommendedTier: recommendTier(gpuClass, maxSamples, maxTextureSize),
		rtxClassHint: /rtx\s*(20|30|40|50)\d{2}/i.test(rendererName),
	};
}

function supportedMsaa(mode: VisualAntialiasMode, maxSamples: number): VisualAntialiasMode {
	if (mode === "msaa8") {
		if (maxSamples >= 8) return "msaa8";
		if (maxSamples >= 4) return "msaa4";
		if (maxSamples >= 2) return "msaa2";
		return "smaa";
	}
	if (mode === "msaa4") {
		if (maxSamples >= 4) return "msaa4";
		if (maxSamples >= 2) return "msaa2";
		return "smaa";
	}
	if (mode === "msaa2") return maxSamples >= 2 ? "msaa2" : "smaa";
	return mode;
}

export function resolveVisualRuntimeQuality(
	selection: VisualQualitySelection,
	capabilities: VisualRendererCapabilities,
	custom: CustomQuality,
): VisualRuntimeQuality {
	if (selection === "custom") {
		const shadow = [512, 1024, 2048, 4096].includes(Math.round(custom.shadowMapSize)) ? Math.round(custom.shadowMapSize) : 1024;
		return {
			selection,
			tier: "custom",
			label: "Custom",
			renderScale: Math.max(0.5, Math.min(2, custom.renderScale || 1)),
			antialiasMode: supportedMsaa(custom.antialiasMode, capabilities.maxSamples),
			shadowMapSize: shadow as 512 | 1024 | 2048 | 4096,
			cloudMultiplier: 1,
			particleMultiplier: 1,
			weatherMultiplier: 1,
			aoSamples: 12,
			secondarySubsteps: Math.max(1, Math.min(8, Math.round(custom.secondarySubsteps || 2))),
			secondaryIterations: Math.max(1, Math.min(16, Math.round(custom.secondaryIterations || 5))),
			skyPolygonCap: 65536,
			maxAnisotropy: capabilities.maxAnisotropy,
		};
	}
	const tier = selection === "auto" ? capabilities.recommendedTier : selection;
	const profile = PROFILE[tier];
	return {
		selection,
		tier,
		label: selection === "auto" ? `Auto · ${tier[0].toUpperCase()}${tier.slice(1)}` : `${tier[0].toUpperCase()}${tier.slice(1)}`,
		...profile,
		antialiasMode: supportedMsaa(profile.antialiasMode, capabilities.maxSamples),
		maxAnisotropy: Math.min(profile.maxAnisotropy, capabilities.maxAnisotropy),
	};
}

export function fitVisualRenderSize(width: number, height: number, scale: number, capabilities: VisualRendererCapabilities) {
	const maxDimension = Math.max(320, Math.min(capabilities.maxTextureSize, capabilities.maxRenderbufferSize));
	const desiredScale = Math.max(0.5, Math.min(2, scale));
	const dimensionScale = Math.min(1, maxDimension / Math.max(width * desiredScale, height * desiredScale));
	const fittedScale = Math.max(0.25, desiredScale * dimensionScale);
	return {
		scale: fittedScale,
		width: Math.max(320, Math.round(width * fittedScale)),
		height: Math.max(180, Math.round(height * fittedScale)),
	};
}

export function nextAdaptiveQualityScale(current: number, fps: number, targetFps: number, minScale: number, maxScale: number) {
	const min = Math.max(0.4, Math.min(1, minScale));
	const max = Math.max(min, Math.min(1, maxScale));
	const value = Math.max(min, Math.min(max, current));
	if (!Number.isFinite(fps) || fps <= 0) return value;
	if (fps < targetFps * 0.72) return Math.max(min, value - 0.12);
	if (fps < targetFps * 0.88) return Math.max(min, value - 0.06);
	if (fps > targetFps * 0.985) return Math.min(max, value + 0.035);
	return value;
}
