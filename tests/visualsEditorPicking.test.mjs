import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { pickVisibleEditorObject } from "../src/lib/visualsEditorPicking.ts";

const raycaster = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));

test("hidden editor helpers and hidden descendants cannot claim a hit", () => {
	const scene = new THREE.Scene();
	const helperGroup = new THREE.Group();
	const helper = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
	helper.position.z = -2;
	helperGroup.add(helper);
	scene.add(helperGroup);
	const object = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
	object.position.z = -5;
	scene.add(object);
	scene.updateMatrixWorld(true);
	const roots = [["camera", helper], ["object", object]];
	helperGroup.visible = false;
	assert.equal(pickVisibleEditorObject(raycaster, scene, roots), "object");
	helperGroup.visible = true;
	helper.visible = false;
	assert.equal(pickVisibleEditorObject(raycaster, scene, roots), "object");
	helper.visible = true;
	assert.equal(pickVisibleEditorObject(raycaster, scene, roots), "camera");
});

test("detached and stale selectable roots do not own current geometry", () => {
	const scene = new THREE.Scene();
	const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
	mesh.position.z = -3;
	mesh.userData.ysongSelectableId = "stale-id";
	scene.add(mesh);
	scene.updateMatrixWorld(true);
	assert.equal(pickVisibleEditorObject(raycaster, scene, [["current-id", mesh]]), "current-id");
	mesh.removeFromParent();
	assert.equal(pickVisibleEditorObject(raycaster, scene, [["current-id", mesh]]), "");
});
