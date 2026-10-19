import assert from "node:assert/strict";
import { test } from "node:test";
import { createBlankVisualScene, makeVisualMaterial, normalizeVisualScene } from "../src/lib/visualsScene.ts";
import { assetReferences, deleteProjectAsset, relinkProjectAsset } from "../src/lib/visualProjectAssets.ts";

test("existing project imports acquire stable asset records", () => {
	const scene = createBlankVisualScene("3d");
	scene.object.modelUrl = "/model.glb";
	scene.object.modelFileName = "model.glb";
	scene.object.assetFiles = [{path:"textures/paint.png", fileName:"paint.png", url:"/paint.png"}];
	const material = makeVisualMaterial("Paint");
	material.baseColorMap = {url:"/paint.png", fileName:"paint.png"};
	scene.materials.push(material);
	const first = normalizeVisualScene(scene);
	const second = normalizeVisualScene(first);
	assert.deepEqual(second.projectAssets, first.projectAssets);
	assert.equal(first.projectAssets.filter(asset => asset.url === "/paint.png").length, 1);
});

test("relink updates references and delete protects assets in use", () => {
	const scene = createBlankVisualScene("3d");
	scene.object.modelUrl = "/old.glb";
	scene.object.modelFileName = "old.glb";
	scene.projectAssets = [{id:"stable", kind:"model", name:"old.glb", url:"/old.glb", provenance:"Imported", status:"missing"}];
	assert.deepEqual(assetReferences(scene, scene.projectAssets[0]), ["Imported object"]);
	assert.equal(deleteProjectAsset(scene, "stable"), scene);
	const relinked = relinkProjectAsset(scene, "stable", "/new.glb", "new.glb");
	assert.equal(relinked.projectAssets[0].id, "stable");
	assert.equal(relinked.projectAssets[0].status, "available");
	assert.equal(relinked.object.modelUrl, "/new.glb");
	relinked.object.modelUrl = "";
	assert.equal(deleteProjectAsset(relinked, "stable").projectAssets.length, 0);
});
