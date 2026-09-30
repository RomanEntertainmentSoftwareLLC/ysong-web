import assert from "node:assert/strict";
import { test } from "node:test";
import { createBlankVisualScene } from "../src/lib/visualsScene.ts";
import { syncVisualSceneToFrames } from "../src/lib/visualsViewportSync.ts";

test("rehydrates both viewport renderers from the latest logical scene after navigation", () => {
	const messages = [[], []];
	const frames = messages.map((sent) => ({ contentWindow: { postMessage: (message, origin) => sent.push({ message, origin }) } }));
	const oldScene = createBlankVisualScene("3d", "Before navigation");
	const restoredScene = { ...oldScene, project: { ...oldScene.project, name: "Restored scene" } };

	syncVisualSceneToFrames(oldScene, frames, "https://ysong.test");
	syncVisualSceneToFrames(restoredScene, frames, "https://ysong.test");
	for (const sent of messages) {
		assert.equal(sent.length, 2);
		assert.deepEqual(sent[1], {
			message: { type: "ysong-scene-sync", scene: restoredScene },
			origin: "https://ysong.test",
		});
	}

	const reloadedProgramCamera = { contentWindow: { postMessage: (message, origin) => messages[1].push({ message, origin }) } };
	syncVisualSceneToFrames(restoredScene, [reloadedProgramCamera], "https://ysong.test");
	assert.equal(messages[0].length, 2);
	assert.equal(messages[1].at(-1).message.scene, restoredScene);
});
