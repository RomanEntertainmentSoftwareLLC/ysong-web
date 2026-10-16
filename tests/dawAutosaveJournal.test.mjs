import assert from "node:assert/strict";
import { test } from "node:test";
import { appendJournal, hasNewerJournalState, inspectJournal, MAX_JOURNAL_ENTRIES, recoverJournal } from "../src/lib/dawAutosaveJournal.ts";

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

test("recovery inspection returns preview metadata and detects only changed state", () => {
	const base = { v: 1, tracks: [{ id: "a" }], bpm: 120 };
	const baseText = JSON.stringify(base);
	const raw = appendJournal(null, base, baseText, { ...base, bpm: 128 }, "Recovery song");
	const inspected = inspectJournal(base, baseText, raw);
	assert.equal(inspected.name, "Recovery song");
	assert.equal(inspected.entryCount, 1);
	assert.ok(Number.isFinite(inspected.updatedAt));
	assert.equal(hasNewerJournalState(base, inspected.state), true);
	assert.equal(hasNewerJournalState(inspected.state, inspected.state), false);
});

test("legacy journals remain recoverable with unknown preview time", () => {
	const base = { v: 1, bpm: 120 };
	const baseText = JSON.stringify(base);
	let hash = 2166136261;
	for (let index = 0; index < baseText.length; index++) hash = Math.imul(hash ^ baseText.charCodeAt(index), 16777619);
	const legacy = JSON.stringify({ v: 1, base: `${baseText.length}:${hash >>> 0}`, name: "Legacy", entries: [{ bpm: 121 }] });
	assert.equal(inspectJournal(base, baseText, legacy)?.updatedAt, null);
});
