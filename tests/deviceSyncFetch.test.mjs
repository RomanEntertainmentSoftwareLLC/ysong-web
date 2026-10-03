import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/devCrossWindowSync.ts", import.meta.url), "utf8");
const start = source.indexOf("function installFetchHook()");
const end = source.indexOf("\n}\n", start) + 3;
const code = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

for (const [url, expected] of [
  ["http://127.0.0.1:39451/ui/open", false],
  ["http://127.0.0.1:39451/vst3/load", false],
  ["https://api.ysong.test/api/uploads", true],
  ["https://third-party.test/api/upload", false],
]) {
  test(`device-sync header is ${expected ? "included" : "omitted"} for ${url}`, async () => {
    let received;
    const context = vm.createContext({
      URL, Headers, Request, AUTH_BASE: "https://api.ysong.test", windowId: "window-test",
      window: { location: { origin: "https://www.ysong.test" }, fetch: async (input, init) => { received = { input, init }; return { ok: true }; } },
      mutationInfo: (input, init) => ({ url: String(input), method: init.method }),
      canParticipate: () => true, hasRecentUserAction: () => false,
      apiPathFromUrl: (input) => new URL(input).pathname,
    });
    vm.runInContext(`${code}\ninstallFetchHook()`, context);
    await context.window.fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const headers = new Headers(received.init.headers);
    assert.equal(headers.has("X-YSong-Client-Id"), expected);
    assert.equal(headers.get("Content-Type"), "application/json");
    assert.equal(received.init.body, "{}");
  });
}
