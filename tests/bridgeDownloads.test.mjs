import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/bridgeReleases.ts", import.meta.url), "utf8");
const ui = readFileSync(new URL("../src/components/BridgeDownloads.tsx", import.meta.url), "utf8");
const js = ts.transpileModule(source.replace(/export /g, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const context = vm.createContext({ URL });
vm.runInContext(js, context);
const artifact = { platform: "windows", architecture: "x64", channel: "production", status: "published", signed: true,
  url: "https://downloads.ysong.ai/bridge.exe", fileType: "EXE", sha256: "a".repeat(64), signatureStatus: "Code signed" };

test("only signed, published production artifacts become downloads", () => {
  const release = context.parseBridgeRelease({ channel: "production", version: "1.2.3", artifacts: [artifact,
    { ...artifact, signed: false }, { ...artifact, status: "dev" },
    { ...artifact, url: "http://example.com/dev.exe" }, { ...artifact, sha256: "invalid" }] });
  assert.equal(release.artifacts.length, 1);
  assert.equal(release.artifacts[0].url, artifact.url);
  assert.equal(context.parseBridgeRelease({ channel: "dev", version: "1", artifacts: [artifact] }), null);
  assert.equal(context.parseBridgeRelease({ channel: "production", version: "1", artifacts: [{ ...artifact, platform: "macos" }] }).artifacts.length, 0);
});

test("download UI retains manual platform controls and honest empty states", () => {
  assert.match(ui, /aria-pressed=\{platform === choice\}/);
  assert.match(ui, /A production download for \{labels\[platform\]\} is coming soon/);
  assert.match(ui, /Checksum and installation details/);
  assert.match(ui, /Release notes for version/);
});

test("platform detection and missing-platform state", () => {
  assert.equal(context.detectPlatform("Windows NT 10.0"), "windows");
  assert.equal(context.detectPlatform("Macintosh; Intel Mac OS X"), "macos");
  assert.equal(context.detectPlatform("X11; Linux x86_64"), "linux");
  const release = context.parseBridgeRelease({ channel: "production", version: "1", artifacts: [artifact] });
  assert.equal(release.artifacts.filter(item => item.platform === "macos").length, 0);
});
