import type { VisualSceneState } from "./visualsScene";

type SceneFrame = { contentWindow: Pick<Window, "postMessage"> | null } | null;

/** Send the current logical scene to every live renderer, including Program Camera. */
export function syncVisualSceneToFrames(scene: VisualSceneState, frames: SceneFrame[], origin: string) {
	const message = { type: "ysong-scene-sync", scene };
	for (const frame of frames) frame?.contentWindow?.postMessage(message, origin);
}
