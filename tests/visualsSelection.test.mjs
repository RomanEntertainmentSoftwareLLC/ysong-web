import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveVisualSelection } from "../src/lib/visualsSelection.ts";

const scene = {
	layers: [{ id: "layer-a" }, { id: "layer-b" }],
	cameras: [{ id: "camera-a" }],
	materials: [{ id: "mat-a" }],
};

test("all editor surfaces resolve the same object identity", () => {
	for (const id of ["layer-a", "camera-a", "material:mat-a", "editor-camera", "renderer-settings"])
		assert.equal(resolveVisualSelection(scene, id), id);
});

test("deleted and rehydrated scene objects lose selection", () => {
	assert.equal(resolveVisualSelection({ ...scene, layers: scene.layers.slice(1) }, "layer-a"), "");
	assert.equal(resolveVisualSelection({ ...scene, cameras: [] }, "camera-a"), "");
	assert.equal(resolveVisualSelection({ ...scene, materials: [] }, "material:mat-a"), "");
	assert.equal(resolveVisualSelection({ layers: [], cameras: [], materials: [] }, "layer-b"), "");
	assert.equal(resolveVisualSelection(scene, "unknown-object"), "");
});
