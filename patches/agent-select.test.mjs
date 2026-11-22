import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const source = process.env.UNDER_TEST ?? new URL("../claude/dist/agentd.mjs", import.meta.url).pathname;
const exported = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "codie-test-")), "agentd.mjs");
fs.writeFileSync(exported, fs.readFileSync(source, "utf8").replace(/^await runAgentd\(\);$/m, "export { askRequest, Router, Dispatcher, AGENT_TOOLS };"));
const { askRequest, Router, Dispatcher, AGENT_TOOLS } = await import(exported);

test("ask_agent exposes agent enum", () => {
  const t = AGENT_TOOLS.find((x) => x.name === "ask_agent");
  assert.deepEqual(t.parameters.properties.agent.enum, ["any", "claude", "codex"]);
});

test("askRequest", () => {
  assert.deepEqual(askRequest({ prompt: "x" }), { text: "x" });
  assert.deepEqual(askRequest({ prompt: "x", agent: "any" }), { text: "x" });
  assert.deepEqual(askRequest({ prompt: "x", agent: null }), { text: "x" });
  assert.deepEqual(askRequest({ prompt: "x", agent: "codex" }), { text: "x", agent: "codex" });
  assert.deepEqual(askRequest({ prompt: "x", agent: "claude" }), { text: "x", agent: "claude" });
  assert.deepEqual(askRequest({ prompt: "x", agent: "codex", mode: "session", target: "p" }), { text: "x", agent: "codex", routing: { mode: "session", target: "p" } });
  assert.ok(askRequest({ prompt: "x", agent: "claude", mode: "continue" }).error);
  assert.ok(askRequest({ prompt: "x", agent: "gemini" }).error);
});

function router({ background = () => false } = {}) {
  const log = [];
  const link = { accept: (id) => log.push(["accept", id]), sendError: (id, m) => log.push(["error", id, m]) };
  const tasks = { get: () => ({}), heldBy: () => [], hold() {} };
  const r = new Router({ link, tasks, background: (e) => { log.push(["background", e.agent ?? "any"]); return background(e); }, deliveryMs: 60000, pickupMs: 60000 });
  r.register({ host: "claude", channel: true, inbox: true, sessionPid: 1 });
  return { r, log };
}

test("any / claude go to the open Claude Code session first", () => {
  for (const agent of [undefined, "claude"]) {
    const { r, log } = router();
    r.onDeviceMessage({ taskId: "t", text: "x", ...(agent ? { agent } : {}) });
    assert.equal(r.pendingDelivery.get("t")?.sessionId !== undefined, true);
    assert.deepEqual(log, []);
    for (const p of r.pendingDelivery.values()) clearTimeout(p.timer);
  }
});

test("codex skips the Claude Code session", () => {
  const { r, log } = router({ background: () => true });
  r.onDeviceMessage({ taskId: "t", text: "x", agent: "codex" });
  assert.equal(r.pendingDelivery.size, 0);
  assert.deepEqual(log, [["background", "codex"], ["accept", "t"]]);
});

test("codex with no Codex session is rejected, not sent to Claude", () => {
  const { r, log } = router({ background: () => false });
  r.onDeviceMessage({ taskId: "t", text: "x", agent: "codex" });
  assert.equal(r.pendingDelivery.size, 0);
  assert.equal(log.at(-1)[0], "error");
});

function dispatcher({ codexOpen, claudeCwd }) {
  const tried = [];
  const d = new Dispatcher({
    tasks: { get: () => ({}), bindThread() {} },
    link: { sendError() {}, accept() {} },
    codex: { pickThread: async () => { tried.push("codex"); throw new Error("stop"); } },
    claude: { start: async () => { tried.push("claude"); throw new Error("stop"); } },
    hasCodexSession: () => codexOpen,
    claudeCwd: () => claudeCwd,
  });
  d.codexThread = codexOpen ? "th" : null;
  return { d, tried };
}

test("Dispatcher.take picks the backend by agent", async () => {
  const cases = [
    [{ agent: undefined, codexOpen: true, claudeCwd: "/p" }, true, "codex"],
    [{ agent: "claude", codexOpen: true, claudeCwd: "/p" }, true, "claude"],
    [{ agent: "codex", codexOpen: true, claudeCwd: "/p" }, true, "codex"],
    [{ agent: "codex", codexOpen: false, claudeCwd: "/p" }, false, null],
    [{ agent: "claude", codexOpen: true, claudeCwd: null }, false, null],
  ];
  for (const [{ agent, ...env }, taken, first] of cases) {
    const { d, tried } = dispatcher(env);
    assert.equal(d.take({ taskId: "t", deviceId: "d", text: "x", ...(agent ? { agent } : {}) }), taken, JSON.stringify({ agent, env }));
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(tried[0] ?? null, first, JSON.stringify({ agent, env, tried }));
    if (agent === "codex") assert.ok(!tried.includes("claude"), "codex must not fall back to claude");
  }
});
