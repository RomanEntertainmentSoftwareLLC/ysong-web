import assert from "node:assert/strict";
import { test } from "node:test";
import { createBlankVisualScene } from "../src/lib/visualsScene.ts";
import { appendVisualSceneJournal, newerVisualRevision, readVisualSceneJournal } from "../src/lib/visualSceneJournal.ts";

test("bounded scene revisions recover only when newer than the saved scene", () => {
	const saved = createBlankVisualScene("2d", "Journal");
	saved.updatedAt = 100;
	let raw = null;
	for (let time = 101; time <= 109; time++) raw = appendVisualSceneJournal(raw, { ...saved, updatedAt: time, project: { ...saved.project, name: `Edit ${time}` } });
	assert.equal(readVisualSceneJournal(raw).length, 5);
	assert.equal(newerVisualRevision(raw, saved)?.project.name, "Edit 109");
	assert.equal(newerVisualRevision(raw, { ...saved, updatedAt: 109 }), null);
	assert.deepEqual(readVisualSceneJournal("{broken"), []);
});

test("journal does not replay another project or retain runtime objects", () => {
	const scene = createBlankVisualScene("3d", "A");
	scene.updatedAt = 200;
	const raw = appendVisualSceneJournal(null, { ...scene, runtime: { renderer: "must not persist" } });
	assert.equal(newerVisualRevision(raw, createBlankVisualScene("3d", "B")), null);
	assert.equal(readVisualSceneJournal(raw)?.[0].scene.project.id, scene.project.id);
	assert.equal(raw.includes("must not persist"), false);
});

test("journal can recover when no saved scene exists", () => {
	const scene = createBlankVisualScene("2d", "Unsaved");
	scene.updatedAt = 300;
	const raw = appendVisualSceneJournal(null, scene);
	assert.equal(newerVisualRevision(raw, null)?.project.name, "Unsaved");
});
