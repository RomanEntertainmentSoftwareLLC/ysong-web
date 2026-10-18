import assert from "node:assert/strict";
import { test } from "node:test";
import { createBlankVisualScene, makeVisualPrimitive, normalizeVisualScene } from "../src/lib/visualsScene.ts";
import { canParentPrimitive, parentPrimitive, primitiveWorldMatrix, removePrimitiveParent } from "../src/lib/visualsHierarchy.ts";

test("reparent and unparent preserve world transform; cycles are rejected", () => {
	const scene = createBlankVisualScene("3d");
	const parent = makeVisualPrimitive("box", "Parent");
	parent.positionX = 4;
	parent.rotationY = .4;
	const child = makeVisualPrimitive("box", "Child");
	child.positionZ = 2;
	scene.primitives = [parent, child];
	const before = primitiveWorldMatrix(scene.primitives, child.id).elements;
	const grouped = parentPrimitive(scene, child.id, parent.id);
	assert.notEqual(grouped, scene);
	assert.equal(grouped.primitives[1].parentId, parent.id);
	assert.deepEqual(primitiveWorldMatrix(grouped.primitives, child.id).elements.map((n, i) => Math.abs(n - before[i]) < 1e-10), Array(16).fill(true));
	assert.equal(canParentPrimitive(grouped, parent.id, child.id), false);
	assert.equal(parentPrimitive(grouped, parent.id, child.id), grouped);
	const reopened = normalizeVisualScene(JSON.parse(JSON.stringify(grouped)));
	assert.equal(reopened.primitives[1].parentId, parent.id);
	assert.equal(parentPrimitive(reopened, child.id, "").primitives[1].parentId, "");
	const detached = removePrimitiveParent(reopened, parent.id);
	assert.equal(detached.primitives[1].parentId, "");
	assert.deepEqual(primitiveWorldMatrix(detached.primitives, child.id).elements.map((n, i) => Math.abs(n - before[i]) < 1e-10), Array(16).fill(true));
});

test("invalid saved parent links are removed", () => {
	const scene = createBlankVisualScene("3d");
	const a = makeVisualPrimitive("box");
	const b = makeVisualPrimitive("box");
	a.parentId = b.id; b.parentId = a.id;
	scene.primitives = [a, b];
	const reopened = normalizeVisualScene(scene);
	assert.ok(reopened.primitives.some(p => !p.parentId));
});
