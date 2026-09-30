import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveVisualProgramCamera } from "../src/lib/visualsCamera.ts";
import { createBlankVisualScene, normalizeVisualScene } from "../src/lib/visualsScene.ts";

test("program camera follows the persisted master and timeline cuts after replacement", () => {
	const initial = createBlankVisualScene("3d", "Camera scene");
	const first = initial.cameras[0];
	const second = { ...structuredClone(first), id: "program-camera-second", name: "Second" };
	const scene = normalizeVisualScene({
		...initial,
		cameras: [first, second],
		activeCameraId: second.id,
		cameraCuts: [{ id: "cut-1", time: 2, cameraId: first.id }],
	});
	assert.equal(resolveVisualProgramCamera(scene, 1)?.id, second.id);
	assert.equal(resolveVisualProgramCamera(scene, 3)?.id, first.id);

	const replaced = normalizeVisualScene({ ...scene, cameras: [second], cameraCuts: scene.cameraCuts });
	assert.equal(replaced.cameraCuts.length, 0);
	assert.equal(resolveVisualProgramCamera(replaced, 3)?.id, second.id);
	assert.equal(normalizeVisualScene(structuredClone(replaced)).activeCameraId, second.id);
});

test("program camera falls back to an enabled camera when the selected camera is unavailable", () => {
	const initial = createBlankVisualScene("3d", "Camera fallback");
	const first = { ...initial.cameras[0], enabled: false };
	const second = { ...structuredClone(first), id: "program-camera-enabled", enabled: true };
	const scene = normalizeVisualScene({ ...initial, cameras: [first, second], activeCameraId: first.id });
	assert.equal(resolveVisualProgramCamera(scene, 0)?.id, second.id);
	assert.equal(resolveVisualProgramCamera(normalizeVisualScene({ ...scene, cameras: [second] }), 0)?.id, second.id);
});
