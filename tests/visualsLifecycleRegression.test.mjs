import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { applyVisualMaterialUpload, createVisualMaterialUploadTracker } from "../src/lib/visualMaterialUpload.ts";
import { resolveVisualProgramCamera } from "../src/lib/visualsCamera.ts";
import { pickVisibleEditorObject } from "../src/lib/visualsEditorPicking.ts";
import { createBlankVisualScene, makeVisualMaterial, makeVisualPrimitive, normalizeVisualScene } from "../src/lib/visualsScene.ts";
import { resolveVisualSelection } from "../src/lib/visualsSelection.ts";
import { syncVisualSceneToFrames } from "../src/lib/visualsViewportSync.ts";

function populatedScene() {
	const scene = createBlankVisualScene("3d", "Lifecycle stage");
	scene.object.model = "asset";
	scene.object.modelUrl = "/uploads/stage.glb";
	scene.weather.preset = "rain";
	scene.sky.mode = "sphere";
	scene.sky.sphereUrl = "/uploads/sky.jpg";
	scene.sky.rotationY = 1.25;
	scene.cameras[0].dofBalance = .7;
	scene.cameras[0].focusDistance = 4;
	return scene;
}

test("first tab return rehydrates editor and Program Camera from one reopened scene", () => {
	const persisted = JSON.parse(JSON.stringify(populatedScene()));
	const reopened = normalizeVisualScene(persisted);
	const deliveries = [[], []];
	const frames = deliveries.map(messages => ({ contentWindow: { postMessage(message, origin) { messages.push({ message, origin }); } } }));
	// Each iframe has just mounted. A later return must not be needed to repair either view.
	syncVisualSceneToFrames(reopened, frames, "https://ysong.test");
	for (const messages of deliveries) {
		assert.equal(messages.length, 1);
		assert.equal(messages[0].origin, "https://ysong.test");
		assert.equal(messages[0].message.type, "ysong-scene-sync");
		assert.strictEqual(messages[0].message.scene, reopened);
		assert.equal(messages[0].message.scene.object.modelUrl, "/uploads/stage.glb");
		assert.equal(messages[0].message.scene.weather.preset, "rain");
		assert.equal(messages[0].message.scene.sky.sphereUrl, "/uploads/sky.jpg");
		assert.equal(messages[0].message.scene.sky.rotationY, 1.25);
		assert.equal(resolveVisualProgramCamera(messages[0].message.scene, 0)?.id, reopened.activeCameraId);
	}
	assert.equal(reopened.cameras[0].dofBalance, .7);
	assert.equal(reopened.cameras[0].focusDistance, 4);
});

test("late material uploads preserve the newest scene and independent texture slots", () => {
	const scene = populatedScene();
	const material = makeVisualMaterial("Raincoat");
	scene.materials.push(material);
	const reserve = createVisualMaterialUploadTracker();
	const oldColor = reserve(material.id, "baseColorMap");
	const normal = reserve(material.id, "normalMap");
	const newColor = reserve(material.id, "baseColorMap");
	let current = { ...scene, project: { ...scene.project, name: "Edited while loading" } };
	if (newColor()) current = applyVisualMaterialUpload(current, material.id, "baseColorMap", "/new.png", "new.png");
	if (normal()) current = applyVisualMaterialUpload(current, material.id, "normalMap", "/normal.png", "normal.png");
	if (oldColor()) current = applyVisualMaterialUpload(current, material.id, "baseColorMap", "/old.png", "old.png");
	assert.equal(current.project.name, "Edited while loading");
	assert.equal(current.materials.find(item => item.id === material.id).baseColorMap.url, "/new.png");
	assert.equal(current.materials.find(item => item.id === material.id).normalMap.url, "/normal.png");
	assert.equal(current.object.materialId, material.id);
});

test("helper raycasts and selection follow visible geometry after scene reopen", () => {
	const state = populatedScene();
	const primitive = makeVisualPrimitive("box", "Target");
	state.primitives.push(primitive);
	state.layers.push({ id: "target-layer", type: "primitive", name: "Target", entityId: primitive.id, visible: true, opacity: 1 });
	const reopened = normalizeVisualScene(JSON.parse(JSON.stringify(state)));
	const world = new THREE.Scene();
	const helper = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
	helper.position.z = -2;
	const hidden = new THREE.Group();
	hidden.visible = false;
	hidden.add(helper);
	world.add(hidden);
	const target = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
	target.position.z = -5;
	world.add(target);
	world.updateMatrixWorld(true);
	const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
	const picked = pickVisibleEditorObject(ray, world, [["camera-helper", helper], ["target-layer", target]]);
	assert.equal(picked, "target-layer");
	assert.equal(resolveVisualSelection(reopened, picked), "target-layer");
	assert.equal(resolveVisualSelection(normalizeVisualScene({ ...reopened, primitives: [], layers: [] }), picked), "");
});
