// Check on done (hooks/offer-on-done.mjs, bin/offer.mjs) on made-up
// sessions: no model, no network, a temp BOUNCER_HOME and settings file.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { claimsOf as doorClaims } from "../bin/door-rules.mjs";
import { asks, claimsOf, decide, digest, hook, LARGE_FILES, LARGE_LINES, modeOf } from "../hooks/offer-on-done.mjs";

const HOOK = fileURLToPath(new URL("../hooks/offer-on-done.mjs", import.meta.url));
const CLI = fileURLToPath(new URL("../bin/cli.mjs", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "bouncer-offer-"));
const line = (type, content, extra = {}) => JSON.stringify({ type, ...extra, message: { role: type, content } });
const user = (text) => line("user", text);
const say = (text) => line("assistant", [{ type: "text", text }]);
const tool = (name, input) => line("assistant", [{ type: "tool_use", id: name, name, input }]);
const edit = (file, n = 1) => tool("Edit", { file_path: file, old_string: "a", new_string: Array(n).fill("b").join("\n") });
const write = (file, n) => tool("Write", { file_path: file, content: Array(n).fill("x").join("\n") });

try {
  // The claim patterns are door's: same answers on the same sentences.
  for (const text of [
    "Done. All tests pass.",
    "Implemented parseDuration; 12 tests pass.",
    "The tests don't pass yet.",
    "Before the tests pass I need your call on rounding.",
    "Fixed the off-by-one.",
    "Here is what I found in the parser.",
    "Ready for review.",
    "I have not finished the migration.",
    "CI is green.",
    "Which of the two approaches do you want?",
  ])
    assert.deepEqual(claimsOf(text), doorClaims(text), `claims differ from door's on: ${text}`);
  assert.equal(asks("Done. Want me to commit it?"), true);
  assert.equal(asks("Done.\n\nWant me to open a PR?**"), true);
  assert.equal(asks("Is it fixed? Yes: the cause was the cache."), false);
  console.log("ok - the hook reads claims as door does");

  // digest: code edits from the session and its subagents, docs left out, bouncer after the last edit.
  const session = digest(
    [user("add a parser"), edit("/w/src/parse.ts", 3), tool("Write", { file_path: "/w/README.md", content: "x\ny" }), say("Done."), "{ partial"].join("\n"),
    [line("assistant", [{ type: "tool_use", name: "Write", input: { file_path: "/w/src/lex.py", content: "a\nb\nc\nd" } }], { isSidechain: true })],
  );
  assert.deepEqual(session.files, ["/w/src/parse.ts", "/w/src/lex.py"]);
  assert.equal(session.lines, 7);
  assert.equal(session.edits, 2);
  assert.equal(session.last, "Done.");
  assert.equal(digest([edit("/w/a.ts"), tool("Bash", { command: "npx -y @lunox-work/bouncer@0.8.4 id --ticket -" })].join("\n")).bouncerAfter, true);
  assert.equal(digest([edit("/w/a.ts"), tool("Bash", { command: "npx -y duediligence check" })].join("\n")).bouncerAfter, true, "the old name counts");
  assert.equal(digest([tool("Skill", { skill: "bouncer" }), edit("/w/a.ts")].join("\n")).bouncerAfter, false);
  assert.equal(digest([edit("/w/styles.css"), say("Done.")].join("\n")).edits, 0);
  console.log("ok - digest counts code edits, subagents included, and bouncer runs after them");

  // decide: at least once, again only after a large change.
  const small = { files: ["/w/a.ts"], lines: 5, edits: 1, bouncerAfter: false };
  assert.equal(decide(small, "Done. All tests pass.", null).offer, true, "first offer on a done claim");
  assert.equal(decide(small, "Updated the regex to accept spaces.", null).offer, true, "first offer on a plain hand-back");
  assert.equal(decide(small, "Done. Want me to commit?", null).offer, true, "a claim then a question still offers");
  assert.equal(decide(small, "Which rounding do you want, up or half-even?", null).offer, false, "a question mid-task waits");
  assert.equal(decide({ ...small, bouncerAfter: true }, "Done.", null).offer, false);
  assert.equal(decide({ ...small, edits: 0, files: [] }, "Done.", null).offer, false);
  const seen = { edits: 1, lines: 5, files: ["/w/a.ts"], offers: 1 };
  assert.equal(decide(small, "Done.", seen).offer, false, "nothing new since the offer");
  assert.equal(decide({ ...small, edits: 2, lines: 20 }, "Done.", seen).offer, false, "a small change after an offer waits");
  const wide = { files: ["/w/a.ts", ...Array.from({ length: LARGE_FILES }, (_, i) => `/w/m${i}.ts`)], lines: 30, edits: 6, bouncerAfter: false };
  const byFiles = decide(wide, "Done. All tests pass.", seen);
  assert.equal(byFiles.offer, true, "again after a large change in files");
  assert.equal(byFiles.large, true);
  assert.equal(byFiles.files.length, LARGE_FILES);
  assert.equal(decide({ ...small, edits: 3, lines: 5 + LARGE_LINES }, "Refactor finished.", seen).offer, true, "again after a large change in lines");
  console.log("ok - decide offers at least once, and again after a large change");

  // The hook end to end: its state, once per batch, the guards.
  const home = join(dir, "home");
  const env = { BOUNCER_HOME: home, CLAUDE_CONFIG_DIR: join(dir, "claude"), CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_CODE_SESSION_ATTENDED: "1" };
  const transcript = join(dir, "s1.jsonl");
  writeFileSync(transcript, [user("add a parser"), edit("/w/src/parse.ts", 3), say("Done. All tests pass.")].join("\n"));
  const input = { session_id: "s1", transcript_path: transcript };
  const first = hook(input, env);
  assert.equal(first?.decision, "block");
  // auto, the default: run the ID check now, unasked.
  assert.match(first.reason, /^bouncer-verify, check on done: this session changed 1 code file, about 3 changed lines \(parse\.ts\)\./);
  assert.match(first.reason, /without asking first/);
  assert.match(first.reason, /`bouncer id --ticket - --voice`.*quoted as they wrote it/);
  assert.match(first.reason, /\$1–7 and 10–25 minutes/, "the cost the CLI itself prints in a repository");
  assert.match(first.reason, /`bouncer offer ask`.*`bouncer offer off`/);
  assert.ok(!/AskUserQuestion/.test(first.reason), "auto asks nothing");
  assert.match(first.reason, /club's door.*code block/, "his door art goes to the person as printed");
  assert.ok(!/Not tonight|You're in/.test(first.reason), "no voice in what the agent is handed");
  assert.equal(hook({ ...input, stop_hook_active: true }, env), null, "never twice in a turn");
  assert.equal(hook(input, env), null, "once per batch of edits");
  const lots = Array.from({ length: LARGE_FILES }, (_, i) => write(`/w/src/m${i}.ts`, 50));
  writeFileSync(transcript, [readFileSync(transcript, "utf8"), user("now the rest"), ...lots, say("All done, refactor finished.")].join("\n"));
  const again = hook(input, env);
  assert.match(again?.reason ?? "", /a large change/, "again after a large change");
  assert.equal(JSON.parse(readFileSync(join(home, "offer", "sessions.json"), "utf8")).s1.offers, 2);
  assert.equal(JSON.parse(readFileSync(join(home, "offer", "sessions.json"), "utf8")).s1.mode, "auto");
  assert.equal(hook({ ...input, session_id: "s2" }, { ...env, BOUNCER_OFFER: "off" }), null, "BOUNCER_OFFER=off");
  // ask: one question first, as before.
  const asked = hook({ ...input, session_id: "s2a" }, { ...env, BOUNCER_OFFER: "ask" });
  assert.match(asked.reason, /^bouncer-verify, offer on done: this session changed \d+ code files?, /);
  assert.match(asked.reason, /`bouncer id`.*\$0\.06/);
  assert.match(asked.reason, /AskUserQuestion/);
  assert.match(asked.reason, /`bouncer offer off`/);
  // The mode: BOUNCER_OFFER, else the saved file, else auto.
  assert.equal(modeOf({}, join(dir, "nowhere")), "auto");
  mkdirSync(join(home, "offer"), { recursive: true });
  writeFileSync(join(home, "offer", "mode"), "ask\n");
  assert.equal(modeOf({}, home), "ask");
  assert.equal(modeOf({ BOUNCER_OFFER: "auto" }, home), "auto", "the environment wins");
  assert.equal(modeOf({ BOUNCER_OFFER: "no" }, home), "off");
  assert.match(hook({ ...input, session_id: "s2b" }, env).reason, /^bouncer-verify, offer on done/, "the saved mode is used");
  writeFileSync(join(home, "offer", "mode"), "nonsense\n");
  assert.equal(modeOf({}, home), "auto", "an unknown saved mode is the default");
  rmSync(join(home, "offer", "mode"));
  assert.equal(hook({ ...input, session_id: "s3" }, { ...env, CLAUDE_CODE_ENTRYPOINT: "sdk-cli", CLAUDE_CODE_SESSION_ATTENDED: "" }), null, "headless");
  assert.ok(hook({ ...input, session_id: "s4" }, { ...env, CLAUDE_CODE_ENTRYPOINT: "sdk-ts" }), "the SDK attended (the desktop app) still offers");
  mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true });
  writeFileSync(join(env.CLAUDE_CONFIG_DIR, "settings.json"), JSON.stringify({ enabledPlugins: { "bouncer-verify@bouncer": true } }));
  assert.equal(hook({ ...input, session_id: "s5" }, env), null, "a settings copy stands down for the plugin");
  assert.ok(hook({ ...input, session_id: "s6" }, { ...env, CLAUDE_PLUGIN_ROOT: "/p" }), "the plugin's own hook runs");
  rmSync(join(env.CLAUDE_CONFIG_DIR, "settings.json"));

  // As Claude Code runs it: stdin in, JSON or nothing out, exit 0 even on junk.
  const run = (stdin, extra = {}) => spawnSync(process.execPath, [HOOK], { input: stdin, encoding: "utf8", env: { ...process.env, ...env, ...extra } });
  const ran = run(JSON.stringify({ session_id: "s7", transcript_path: transcript }));
  assert.equal(ran.status, 0, ran.stderr);
  assert.equal(JSON.parse(ran.stdout).decision, "block");
  for (const junk of ["", "{ not json", JSON.stringify({ transcript_path: join(dir, "missing.jsonl") })]) {
    const quiet = run(junk);
    assert.equal(quiet.status, 0);
    assert.equal(quiet.stdout, "");
  }
  console.log("ok - the hook offers once per batch, again after a large change, and stands down when it should");

  // bouncer offer: on adds one Stop hook beside the person's own, off removes it and sets the flag.
  const settings = join(dir, "settings.json");
  writeFileSync(settings, JSON.stringify({ model: "opus", hooks: { Stop: [{ hooks: [{ type: "command", command: "echo mine" }] }] } }, null, 2));
  const offer = (...args) => spawnSync(process.execPath, [CLI, "offer", ...args, "--settings", settings], { encoding: "utf8", env: { ...process.env, BOUNCER_HOME: home } });
  assert.match(offer("status").stdout, /^off: not installed/);
  const on = offer("on");
  assert.equal(on.status, 0, on.stderr);
  const after = JSON.parse(readFileSync(settings, "utf8"));
  assert.equal(after.model, "opus");
  assert.equal(after.hooks.Stop.length, 2);
  assert.equal(after.hooks.Stop[0].hooks[0].command, "echo mine");
  assert.match(after.hooks.Stop[1].hooks[0].command, /^node ".*offer[/\\]offer-on-done\.mjs"$/);
  assert.ok(existsSync(join(home, "offer", "offer-on-done.mjs")), "the hook copied under BOUNCER_HOME");
  offer("on");
  assert.equal(JSON.parse(readFileSync(settings, "utf8")).hooks.Stop.length, 2, "on twice adds it once");
  assert.match(offer("status").stdout, /^on, auto: runs the ID check when your agent hands back code \(about \$0\.06 each\)\. Through a Stop hook in /);
  const before = spawnSync(process.execPath, [CLI, "offer", "--settings", settings, "status"], { encoding: "utf8", env: { ...process.env, BOUNCER_HOME: home } });
  assert.match(before.stdout, /^on, auto: .*Through a Stop hook in /, "--settings before the command");
  assert.match(offer("ask").stdout, /^on, ask: your agent asks whether to check/);
  assert.equal(readFileSync(join(home, "offer", "mode"), "utf8").trim(), "ask");
  assert.equal(JSON.parse(readFileSync(settings, "utf8")).hooks.Stop.length, 2, "ask keeps one hook");
  offer("on");
  assert.match(offer("status").stdout, /^on, ask: /, "on keeps the mode");
  assert.match(offer("auto").stdout, /^on, auto: /);
  assert.equal(readFileSync(join(home, "offer", "mode"), "utf8").trim(), "auto");
  const off = offer("off");
  assert.equal(off.status, 0, off.stderr);
  assert.deepEqual(JSON.parse(readFileSync(settings, "utf8")).hooks.Stop, [{ hooks: [{ type: "command", command: "echo mine" }] }]);
  assert.ok(existsSync(join(home, "offer", "off")));
  assert.equal(hook({ ...input, session_id: "s8" }, env), null, "the off flag stops it");
  writeFileSync(settings, JSON.stringify({ enabledPlugins: { "bouncer-verify@bouncer": true } }));
  assert.match(offer("on").stdout, /^on, auto: .*Through the bouncer-verify plugin\./);
  assert.equal(JSON.parse(readFileSync(settings, "utf8")).hooks, undefined, "no copy beside the plugin");
  writeFileSync(settings, "{ broken");
  const refused = offer("on");
  assert.equal(refused.status, 1);
  assert.equal(readFileSync(settings, "utf8"), "{ broken", "a settings file it cannot read is left alone");
  console.log("ok - bouncer offer on/auto/ask/off/status keep the person's settings");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log("offer passed");
