import assert from "node:assert/strict";
import { test } from "node:test";
import { applyVisualTransform, selectedVisualTransform } from "../src/lib/visualsTransform.ts";

const primitive = { id: "cube", positionX: 1, positionY: 2, positionZ: 3, rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 2, scaleZ: 3, visible: true };
const object = { positionX: 4, positionY: 5, positionZ: 6, rotationX: 0, rotationY: 0, rotationZ: 0, baseScale: 2 };
const scene = { layers: [{ id: "layer-cube", type: "primitive", entityId: "cube", locked: false, visible: true }, { id: "layer-object", type: "object", locked: false, visible: true }], primitives: [primitive], object };

test("gizmo and inspector share primitive transform ownership", () => {
	const initial = selectedVisualTransform(scene, "layer-cube");
	assert.deepEqual([initial.positionX, initial.scaleY], [1, 2]);
	const next = applyVisualTransform(scene, "layer-cube", { ...initial, positionX: 8, rotationY: Math.PI / 2, scaleY: 4 });
	assert.equal(next.primitives[0].positionX, 8);
	assert.equal(next.primitives[0].rotationY, Math.PI / 2);
	assert.equal(next.primitives[0].scaleY, 4);
	assert.equal(scene.primitives[0].positionX, 1);
	assert.deepEqual(applyVisualTransform(next, "layer-cube", initial).primitives[0], primitive);
});

test("object scale remains uniform and locked or hidden layers cannot move", () => {
	const initial = selectedVisualTransform(scene, "layer-object");
	assert.deepEqual([initial.scaleX, initial.scaleY, initial.scaleZ], [2, 2, 2]);
	assert.equal(applyVisualTransform(scene, "layer-object", { ...initial, scaleX: -3 }).object.baseScale, 0.001);
	const locked = { ...scene, layers: scene.layers.map(layer => ({ ...layer, locked: true })) };
	assert.equal(selectedVisualTransform(locked, "layer-cube"), null);
	assert.equal(applyVisualTransform(locked, "layer-cube", initial), locked);
	const hidden = { ...scene, layers: scene.layers.map(layer => ({ ...layer, visible: false })) };
	assert.equal(selectedVisualTransform(hidden, "layer-object"), null);
});
