// The door (bin/door.mjs) on a made-up transcript: no model, no network.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ASK, sessionOf } from "../bin/door.mjs";

const dir = mkdtempSync(join(tmpdir(), "bouncer-door-"));
const line = (type, content) => JSON.stringify({ type, message: { role: type, content } });
try {
  const transcript = join(dir, "session.jsonl");
  writeFileSync(
    transcript,
    [
      line("user", "Add parseDuration to src/index.ts"),
      line("assistant", [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "npm test" } }]),
      line("user", [{ type: "tool_result", tool_use_id: "t1", content: "# pass 3\n# fail 0" }]),
      line("assistant", [{ type: "tool_use", id: "t2", name: "Edit", input: { file_path: "/w/src/index.ts", old_string: "a", new_string: "b" } }]),
      line("user", [{ type: "tool_result", tool_use_id: "t2", content: "ok" }]),
      line("assistant", [{ type: "text", text: "Done. All tests pass." }]),
      "{ partial",
    ].join("\n"),
  );
  assert.ok(sessionOf(transcript).length >= 5, "the session reads, a partial line skipped");
  const run = spawnSync(process.execPath, [new URL("../bin/door.mjs", import.meta.url).pathname, "--transcript", transcript, "--no-gate", "--json"], { encoding: "utf8", cwd: dir });
  assert.equal(run.status, 0, run.stderr);
  const out = JSON.parse(run.stdout);
  assert.equal(out.claimsDone, true);
  assert.deepEqual(out.findings.map((item) => item.rule), ["never-queued"]);
  assert.equal(out.findings[0].ask, ASK["never-queued"]);
  const plain = spawnSync(process.execPath, [new URL("../bin/door.mjs", import.meta.url).pathname, "--transcript", transcript, "--no-gate"], { encoding: "utf8", cwd: dir });
  assert.equal(plain.status, 0, "the door never fails a run");
  assert.match(plain.stdout, /not a verdict/);
  assert.ok(!/Not tonight|You're in/.test(plain.stdout), "no voice on findings");

  // Without --transcript: the newest session that edited a file, not a newer one that only asks.
  const home = join(dir, "home");
  const checkout = join(dir, "checkout");
  mkdirSync(checkout, { recursive: true });
  const folder = join(home, ".claude", "projects", realpathSync(checkout).replace(/[^a-zA-Z0-9]/g, "-"));
  mkdirSync(folder, { recursive: true });
  const toolLine = (name, input) => JSON.stringify({ type: "assistant", timestamp: "2026-11-20T10:00:00.000Z", message: { content: [{ type: "tool_use", id: name, name, input }] } });
  writeFileSync(join(folder, "agent.jsonl"), `${toolLine("Edit", { file_path: join(checkout, "a.ts") })}\n`);
  utimesSync(join(folder, "agent.jsonl"), new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
  writeFileSync(join(folder, "asker.jsonl"), `${toolLine("Bash", { command: "bouncer door" })}\n`);
  const door = () => spawnSync(process.execPath, [new URL("../bin/door.mjs", import.meta.url).pathname, "--no-gate"], { encoding: "utf8", cwd: checkout, env: { ...process.env, HOME: home } });
  const picked = door();
  assert.match(picked.stderr, /door: read .*agent\.jsonl \(the newest session that edited files; .*asker\.jsonl edited none\)/);
  rmSync(join(folder, "agent.jsonl"));
  const none = door();
  assert.match(none.stdout, /No Claude Code session that edited files here was found .*asker\.jsonl.*The change came from elsewhere/);
  console.log("ok - door reads the newest session that edited files, and says when none did");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log("door passed");
