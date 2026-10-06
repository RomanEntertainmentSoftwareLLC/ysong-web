import assert from "node:assert/strict";
import { test } from "node:test";
import { appendJournal, MAX_JOURNAL_ENTRIES, recoverJournal } from "../src/lib/dawAutosaveJournal.ts";

test("journal recovers edits only against its original explicit save", () => {
	const base = { v: 1, tracks: [{ id: "a" }], bpm: 120 };
	const baseText = JSON.stringify(base);
	const first = appendJournal(null, base, baseText, { ...base, bpm: 130 }, "Song");
	const second = appendJournal(first, base, baseText, { ...base, bpm: 130, tracks: [{ id: "b" }] }, "Song 2");
	assert.deepEqual(recoverJournal(base, baseText, second), {
		state: { v: 1, tracks: [{ id: "b" }], bpm: 130 }, name: "Song 2",
	});
	assert.equal(recoverJournal(base, JSON.stringify({ ...base, bpm: 140 }), second), null);
});

test("journal compacts after its entry limit", () => {
	const base = { v: 1, bpm: 120 };
	const baseText = JSON.stringify(base);
	let raw = null;
	for (let index = 0; index < MAX_JOURNAL_ENTRIES + 3; index++) {
		raw = appendJournal(raw, base, baseText, { v: 1, bpm: index }, "Song");
	}
	assert.ok(JSON.parse(raw).entries.length <= MAX_JOURNAL_ENTRIES);
	assert.equal(recoverJournal(base, baseText, raw)?.state.bpm, MAX_JOURNAL_ENTRIES + 2);
});
