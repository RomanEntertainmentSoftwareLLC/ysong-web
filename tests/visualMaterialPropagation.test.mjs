import assert from "node:assert/strict";
import { test } from "node:test";
import { createBlankVisualScene, makeVisualMaterial } from "../src/lib/visualsScene.ts";
import { applyVisualMaterialUpload, createVisualMaterialUploadTracker, isCurrentVisualMaterialTexture } from "../src/lib/visualMaterialUpload.ts";
import { createVisualSceneWriter } from "../src/lib/visualSceneWriter.ts";

test("uploaded texture references merge into the latest scene and assign imported objects", () => {
	const material = makeVisualMaterial("Paint");
	const scene = createBlankVisualScene("3d", "Model");
	const current = {
		...scene,
		object: { ...scene.object, model: "asset", materialId: "" },
		materials: [...scene.materials, material],
		project: { ...scene.project, name: "Recent edit" },
	};
	const first = applyVisualMaterialUpload(current, material.id, "baseColorMap", "/first.png", "first.png");
	const second = applyVisualMaterialUpload(first, material.id, "normalMap", "/normal.png", "normal.png");
	assert.equal(second.project.name, "Recent edit");
	assert.equal(second.object.materialId, material.id);
	assert.deepEqual(second.materials.find((item) => item.id === material.id).baseColorMap, { url: "/first.png", fileName: "first.png" });
	assert.deepEqual(second.materials.find((item) => item.id === material.id).normalMap, { url: "/normal.png", fileName: "normal.png" });
	const replaced = applyVisualMaterialUpload(second, material.id, "baseColorMap", "/new.png", "new.png");
	assert.equal(isCurrentVisualMaterialTexture(replaced, material.id, "baseColorMap", "/first.png"), false);
	assert.equal(isCurrentVisualMaterialTexture(replaced, material.id, "baseColorMap", "/new.png"), true);
});

test("older Bridge write completes before the latest scene is sent", async () => {
	const started = [];
	let finishFirst;
	const writer = createVisualSceneWriter(async (scene) => {
		started.push(scene);
		if (scene === "old") await new Promise((resolve) => { finishFirst = resolve; });
	});
	writer("old");
	writer("intermediate");
	writer("latest");
	assert.deepEqual(started, ["old"]);
	finishFirst();
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.deepEqual(started, ["old", "latest"]);
});

test("a late upload cannot replace a newer selection in the same slot", () => {
	const reserve = createVisualMaterialUploadTracker();
	const first = reserve("paint", "baseColorMap");
	const normal = reserve("paint", "normalMap");
	const second = reserve("paint", "baseColorMap");
	assert.equal(first(), false);
	assert.equal(second(), true);
	assert.equal(normal(), true);
});
