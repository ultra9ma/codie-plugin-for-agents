import fs from "node:fs";

const root = process.argv[2] ?? new URL("..", import.meta.url).pathname;

const agentdEdits = [
  ["var AGENTD_VERSION = 48;", "var AGENTD_VERSION = 1048;"],
  [`name: "ask_agent",
    version: "v7",`, `name: "ask_agent",
    version: "v8",`],
  [`        target: { type: "string", description: "Only with mode session: the exact session or project the user named. Never invent one." }
      },`, `        target: { type: "string", description: "Only with mode session: the exact session or project the user named. Never invent one." },
        agent: {
          type: "string",
          enum: ["any", "claude", "codex"],
          description: 'any (default): whichever agent is available. claude / codex: only when the user explicitly names that agent ("with Claude", "Claudeで", "クロードで", "with Codex", "Codexで", "コーデックスで"). Never guess from the task content. claude works only with mode auto.'
        }
      },`],
  [`  const mode = args.mode ?? "auto";
  const target = typeof args.target === "string" ? args.target.trim() : "";
  if (mode === "session" && !target) return { error: "Specify the session or project to continue." };
  if (mode !== "session" && target) return { error: "Only session routing may specify a target session." };
  if (mode === "auto") return { text: prompt };
  return { text: prompt, routing: { mode, ...mode === "session" ? { target } : {} } };`, `  const mode = args.mode ?? "auto";
  const agent = args.agent ?? "any";
  const target = typeof args.target === "string" ? args.target.trim() : "";
  if (!["any", "claude", "codex"].includes(agent)) return { error: "agent must be any, claude or codex." };
  if (agent === "claude" && mode !== "auto") return { error: "Session routing works only with Codex. Use mode auto for Claude." };
  if (mode === "session" && !target) return { error: "Specify the session or project to continue." };
  if (mode !== "session" && target) return { error: "Only session routing may specify a target session." };
  const via = agent === "any" ? {} : { agent };
  if (mode === "auto") return { text: prompt, ...via };
  return { text: prompt, ...via, routing: { mode, ...mode === "session" ? { target } : {} } };`],
  [`    if (event.routing) {
      if (this.background(event)) this.link.accept(taskId, ACCEPTED);`, `    if (event.routing || event.agent === "codex") {
      if (this.background(event)) this.link.accept(taskId, ACCEPTED);`],
  [`    if (!tried.has("listen") && this.listening()) {`, `    if (!tried.has("listen") && !event.agent && this.listening()) {`],
  [`    const backend = event.routing ? this.#codexOn() && this.hasCodexSession() ? "codex" : null : this.backend();`, `    const backend = event.routing || event.agent === "codex" ? this.#codexOn() && this.hasCodexSession() ? "codex" : null : event.agent === "claude" ? this.#claudeOn() && this.claudeCwd() ? "claude" : null : this.backend();`],
  [`        else if (event.routing) {
          this.link.sendError(taskId, e.message);`, `        else if (event.routing || event.agent === "codex") {
          this.link.sendError(taskId, e.message);`],
];

const serverEdits = [["var AGENTD_VERSION = 48;", "var AGENTD_VERSION = 1048;"]];

function apply(file, edits) {
  let src = fs.readFileSync(file, "utf8");
  for (const [from, to] of edits) {
    const count = src.split(from).length - 1;
    if (count !== 1) throw new Error(`${file}: expected 1 match, got ${count}: ${from.slice(0, 60)}`);
    src = src.replace(from, () => to);
  }
  fs.writeFileSync(file, src);
  console.log(`patched ${file} (${edits.length} edits)`);
}

for (const plugin of ["claude", "codex"]) {
  apply(`${root}/${plugin}/dist/agentd.mjs`, agentdEdits);
  apply(`${root}/${plugin}/dist/server.mjs`, serverEdits);
}
