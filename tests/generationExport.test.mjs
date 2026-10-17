import assert from "node:assert/strict";
import { test } from "node:test";
import { createDeterministicZip, safeGenerationExportName } from "../src/lib/generationExport.ts";

test("generation export filenames are stable and filesystem-safe", () => {
  assert.equal(safeGenerationExportName("  Café: Night / Demo  "), "Cafe-Night-Demo");
  assert.equal(safeGenerationExportName("../"), "generation");
});

test("ZIP entries are sorted and use reproducible metadata", async () => {
  const first = createDeterministicZip([
    { name: "z.txt", data: new TextEncoder().encode("last") },
    { name: "a.txt", data: new TextEncoder().encode("first") },
  ]);
  const second = createDeterministicZip([
    { name: "a.txt", data: new TextEncoder().encode("first") },
    { name: "z.txt", data: new TextEncoder().encode("last") },
  ]);
  const a = new Uint8Array(await first.arrayBuffer());
  const b = new Uint8Array(await second.arrayBuffer());
  assert.deepEqual(a, b);
  assert.equal(new DataView(a.buffer).getUint32(0, true), 0x04034b50);
  assert.equal(new TextDecoder().decode(a.slice(30, 35)), "a.txt");
});
