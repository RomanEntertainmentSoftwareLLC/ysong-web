import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/devCrossWindowSync.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const start = source.indexOf("function installFetchHook()");
const end = source.indexOf("\n}\n", start) + 3;
const code = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

test('production does not open the development-only LAN event stream', () => {
  const ast = ts.createSourceFile('sync.ts', source, ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'connectServerEvents');
  let opened = 0;
  const context = vm.createContext({ LAN_SYNC_ENABLED: false, canParticipate: () => true,
    readToken: () => 'test-token', URLSearchParams, windowId: 'test', eventSource: null,
    EventSource: class { constructor() { opened++; } }, devLog: () => {} });
  vm.runInContext(ts.transpileModule(fn.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  context.connectServerEvents(); assert.equal(opened, 0);
  context.LAN_SYNC_ENABLED = true; context.connectServerEvents(); assert.equal(opened, 1);
});

test('client-state hydration, saves and boot seeding use the configured API origin', async () => {
  const ast = ts.createSourceFile('sync.ts', source, ts.ScriptTarget.Latest, true);
  const names = ['fetchClientState', 'pushClientState', 'pushClientStateAfterSuppression'];
  const calls = [];
  const context = vm.createContext({ AUTH_BASE: 'https://api.ysong.test', windowId: 'test',
    readToken: () => 'test-token', isAppPage: () => true, canParticipate: () => true,
    isSuppressed: () => false, isYSongStateKey: () => true, stableStorageValue: (_key, value) => value,
    devLog: () => {}, fetch: async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ state: {} }) }; } });
  for (const name of names) {
    const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(fn);
    vm.runInContext(ts.transpileModule(fn.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  }
  await context.fetchClientState();
  await context.pushClientState('ysong:test', 'value');
  await context.pushClientStateAfterSuppression('ysong:test', 'value');
  assert.equal(calls.length, 3);
  for (const call of calls) assert.equal(call.url, 'https://api.ysong.test/api/client-state');
});

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
