import type { VisualSceneState } from "./visualsScene";

const EDITOR_PANELS = new Set([
	"editor-camera", "renderer-settings", "postfx-settings", "physics-settings",
	"wind-settings", "audio-modulation-settings", "ai-director-settings",
]);

/** The layer/camera/material ID is the only selection identity shared by editor surfaces. */
export function resolveVisualSelection(scene: VisualSceneState, id: string): string {
	if (EDITOR_PANELS.has(id)) return id;
	if (scene.layers.some(layer => layer.id === id)) return id;
	if (scene.cameras.some(camera => camera.id === id)) return id;
	if (id.startsWith("material:") && scene.materials.some(material => `material:${material.id}` === id)) return id;
	return "";
}
