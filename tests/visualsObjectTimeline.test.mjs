import assert from "node:assert/strict";
import { test } from "node:test";
import { createBlankVisualScene, normalizeVisualScene, visualObjectAt } from "../src/lib/visualsScene.ts";

test("object tracks sample in layer-local time and preserve untracked values", () => {
	const scene = createBlankVisualScene("3d", "Animation");
	const layer = { id: "object", type: "object", name: "Object", visible: true, opacity: 1, timeline: { start: 5, duration: 10, trimIn: 0, trimOut: 0, fadeIn: 0, fadeOut: 0, keyframes: [
		{ id: "a", property: "positionX", time: 0, value: 0, easing: "linear" },
		{ id: "b", property: "positionX", time: 4, value: 8, easing: "linear" },
		{ id: "c", property: "visible", time: 0, value: true, easing: "linear" },
		{ id: "d", property: "visible", time: 3, value: false, easing: "linear" },
	] } };
	scene.layers.push(layer);
	const atSeven = visualObjectAt(scene, layer, 7);
	assert.equal(atSeven.object.positionX, 4);
	assert.equal(atSeven.object.positionY, scene.object.positionY);
	assert.equal(atSeven.visible, true);
	assert.equal(visualObjectAt(scene, layer, 8).visible, false);
	assert.equal(scene.object.positionX, 0);
	assert.equal(visualObjectAt(scene, undefined, 7).object, scene.object);
});

test("normalization bounds object keys and survives a save round trip", () => {
	const scene = createBlankVisualScene("3d", "Animation");
	scene.layers.push({ id: "object", type: "object", name: "Object", visible: true, opacity: 1, timeline: { start: 0, duration: 0, trimIn: 0, trimOut: 0, fadeIn: 0, fadeOut: 0, keyframes: [
		{ id: "valid", property: "pulseAmount", time: 2, value: 100, easing: "smooth" },
		{ id: "invalid", property: "positionX", time: -1, value: 5, easing: "linear" },
	] } });
	const saved = normalizeVisualScene(JSON.parse(JSON.stringify(scene)));
	assert.equal(saved.layers[0].timeline.keyframes.length, 1);
	assert.equal(saved.layers[0].timeline.keyframes[0].value, 10);
	assert.deepEqual(normalizeVisualScene(JSON.parse(JSON.stringify(saved))), saved);
});
