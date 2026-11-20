// `confirm --by` refuses a confirmation no person gave (bin/confirm.mjs
// `answerCheck`, lib.mjs `personAnswers`). No model, no network: hand-written
// Claude Code transcripts and a scratch home.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { namesConfirm, personAnswers } from "../bin/lib.mjs";
import { byMissRate, decisionItems, kindOf } from "../bin/decisions.mjs";

const ok = (what) => console.log(`ok - ${what}`);
const line = (event) => JSON.stringify(event);
const user = (timestamp, content, extra = {}) => line({ type: "user", timestamp, message: { role: "user", content }, ...extra });
const assistant = (timestamp, content) => line({ type: "assistant", timestamp, message: { role: "assistant", content } });
const bash = (id, command) => ({ type: "tool_use", id, name: "Bash", input: { command } });
const result = (id, text, isError = false) => ({ type: "tool_result", tool_use_id: id, content: text, ...(isError ? { is_error: true } : {}) });

// The order decisions are put to a person: the kinds drafts miss most first.
assert.equal(kindOf("Errors carry the word duration in their message.").kind, "output-format");
assert.equal(kindOf("An empty list returns zero.").kind, "boundary");
assert.equal(kindOf("Results are sorted by creation time.").kind, "ordering");
assert.equal(kindOf("Splits the bounty by its configured share.").kind, "rule");
assert.deepEqual(
  byMissRate([{ text: "Results are sorted by creation time." }, { text: "Errors name the bad unit in their message." }, { text: "Splits the bounty." }]).map(({ item }) => item.text[0]),
  ["E", "S", "R"],
);
console.log("ok - kindOf and byMissRate: output text first, the rule itself before ordering");

// The drafter's bulleted fields (the 2026-11-20 gate's spec, and 51 stored ones) are fields, not decisions.
const bulleted = decisionItems("## Decided:\n\n1. Host-only returns /.\n   - Ticket: silent.\n   - Instead: return an empty string.\n2. Query gets /.\n   Ticket: silent.\n- Ticket: a top-level item\n");
assert.deepEqual(
  bulleted.map((item) => [item.text, item.ticket ?? null, item.instead ?? null]),
  [
    ["Host-only returns /.", "silent.", "return an empty string."],
    ["Query gets /.", "silent.", null],
    ["Ticket: a top-level item", null, null],
  ],
);
console.log("ok - decisionItems: indented `- Ticket:` and `- Instead:` are fields of the item above");

const scratch = mkdtempSync(join(tmpdir(), "bouncer-confirm-test-"));
try {
  const write = (name, lines) => {
    const path = join(scratch, name);
    writeFileSync(path, `${lines.join("\n")}\n`);
    return path;
  };

  // A person's turn counts; tool results, harness text and meta lines do not.
  const t = (s) => `2026-11-20T10:00:${String(s).padStart(2, "0")}.000Z`;
  const mixed = write("mixed.jsonl", [
    user(t(1), "take duration-parse to a verdict, I accept everything"),
    assistant(t(2), [bash("a", "bouncer confirm duration-parse")]),
    user(t(3), [result("a", "Decided: ...")]),
    user(t(4), "<system-reminder>injected</system-reminder>"),
    user(t(5), "Caveat: the command below was run locally"),
    user(t(6), [{ type: "text", text: "a note" }], { isMeta: true }),
    assistant(t(7), [{ type: "tool_use", id: "q1", name: "AskUserQuestion", input: { questions: [] } }]),
    user(t(8), [result("q1", "Error: no one to answer", true)]),
  ]);
  assert.deepEqual(personAnswers(mixed, t(2), t(9)), { personTurns: 0, questionsAnswered: 0, questionsUnanswered: 1 });
  assert.deepEqual(personAnswers(mixed, t(0), t(9)).personTurns, 1, "the request before the listing counts only when the window starts before it");
  const answered = write("answered.jsonl", [
    assistant(t(1), [bash("a", "bouncer confirm duration-parse")]),
    user(t(2), [result("a", "Decided: ...")]),
    assistant(t(3), [{ type: "tool_use", id: "q1", name: "AskUserQuestion", input: { questions: [] } }]),
    user(t(4), [result("q1", 'User answered: "keep"')]),
    user(t(5), [{ type: "text", text: "yes, go ahead" }]),
  ]);
  assert.deepEqual(personAnswers(answered, t(1), t(9)), { personTurns: 1, questionsAnswered: 1, questionsUnanswered: 0 });
  assert.deepEqual(personAnswers(join(scratch, "missing.jsonl"), t(1), t(9)), { personTurns: 0, questionsAnswered: 0, questionsUnanswered: 0 });
  ok("personAnswers: a person's turns and answered questions, not tool results, harness text or errors");

  assert.equal(namesConfirm("bouncer confirm tiny", "tiny"), true);
  assert.equal(namesConfirm("node bin/confirm.mjs tiny --by x", "tiny"), true);
  assert.equal(namesConfirm('bouncer confirm --by "x" tiny', "tiny"), true, "flags first");
  assert.equal(namesConfirm('S=tiny; bouncer confirm $S 2>&1 | tail; bouncer confirm $S --by "x"', "tiny"), true, "the slug in a variable");
  assert.equal(namesConfirm("bouncer confirm tiny-2", "tiny"), false, "another slug that starts the same");
  assert.equal(namesConfirm("bouncer judge tiny", "tiny"), false);
  ok("namesConfirm: confirm on the slug, however the command spells it");

  // The CLI, in a scratch home with a one-decision spec.
  const home = join(scratch, "home");
  const spec = join(home, "specs", "tiny");
  mkdirSync(spec, { recursive: true });
  writeFileSync(join(spec, "spec.md"), "# Tiny\n\nScenario: one\n\nDecided:\n- Empty input is invalid.\n");
  const cwd = join(scratch, "elsewhere");
  mkdirSync(cwd);
  const confirm = (...argv) =>
    spawnSync(process.execPath, [join(import.meta.dirname, "..", "bin", "confirm.mjs"), "tiny", ...argv], { cwd, encoding: "utf8", env: { ...process.env, BOUNCER_HOME: home, BOUNCER_SPECS: "" }, stdio: ["pipe", "pipe", "pipe"] });
  const recorded = () => JSON.parse(readFileSync(join(spec, "confirmed.json"), "utf8"));

  assert.equal(confirm().status, 3, "the listing starts the clock");
  const started = JSON.parse(readFileSync(join(spec, "confirming.json"), "utf8")).startedAt;
  const later = (ms) => new Date(Date.parse(started) + ms).toISOString();
  const silent = write("silent.jsonl", [assistant(later(10), [bash("a", "bouncer confirm tiny")]), user(later(20), [result("a", "Decided: ...")])]);
  const refused = confirm("--by", "someone", "--transcript", silent);
  assert.equal(refused.status, 3, refused.stdout + refused.stderr);
  assert.match(refused.stderr, /not recorded\. No answer from a person appears in this session since the decisions were listed/);
  assert.match(refused.stderr, /--answered-elsewhere/);
  assert.throws(() => recorded(), /ENOENT/, "nothing recorded");

  // Answered here, after check showed the list and before the listing: not elsewhere (the gate's second run).
  const before = (ms) => new Date(Date.parse(started) - ms).toISOString();
  const early = write("early.jsonl", [
    assistant(before(60_000), [bash("c", "bouncer check --ticket ../ticket.md")]),
    user(before(50_000), [result("c", "12 things your ticket never said")]),
    user(before(30_000), "keep all but 3 and 4; record it"),
    assistant(later(10), [bash("a", "bouncer confirm tiny")]),
    user(later(20), [result("a", "Decided: ...")]),
  ]);
  const misused = confirm("--by", "someone", "--transcript", early, "--answered-elsewhere", "in this Claude Code conversation");
  assert.equal(misused.status, 3, misused.stdout + misused.stderr);
  assert.match(misused.stderr, /answered in this session .* before the decisions were listed .* --answered-elsewhere does not cover it/);
  assert.throws(() => recorded(), /ENOENT/, "nothing recorded");

  const elsewhere = confirm("--by", "someone", "--transcript", silent, "--answered-elsewhere", "PR #12");
  assert.equal(elsewhere.status, 0, elsewhere.stderr);
  assert.deepEqual({ how: recorded().answered.how, elsewhere: recorded().answered.elsewhere }, { how: "elsewhere", elsewhere: "PR #12" });
  rmSync(join(spec, "confirmed.json"));
  writeFileSync(join(spec, "confirming.json"), JSON.stringify({ startedAt: started, drafted: ["Empty input is invalid."] }));

  const spoken = write("spoken.jsonl", [assistant(later(10), [bash("a", "bouncer confirm tiny")]), user(later(20), [result("a", "Decided: ...")]), user(later(30), "yes, all of them")]);
  const given = confirm("--by", "someone", "--transcript", spoken);
  assert.equal(given.status, 0, given.stderr);
  assert.equal(recorded().answered.how, "session");
  assert.equal(recorded().answered.personTurns, 1);
  rmSync(join(spec, "confirmed.json"));
  writeFileSync(join(spec, "confirming.json"), JSON.stringify({ startedAt: started, drafted: ["Empty input is invalid."] }));

  // The session's call reaches its transcript after confirm started (the
  // 2026-11-20 pathe gate: 137 ms): confirm looks again and finds it.
  const fakeHome = join(scratch, "user-home");
  const folder = join(fakeHome, ".claude", "projects", realpathSync(cwd).replace(/[^a-zA-Z0-9]/g, "-"));
  mkdirSync(folder, { recursive: true });
  const late = await new Promise((done) => {
    const child = spawn(process.execPath, [join(import.meta.dirname, "..", "bin", "confirm.mjs"), "tiny", "--by", "someone"], { cwd, env: { ...process.env, HOME: fakeHome, BOUNCER_HOME: home, BOUNCER_SPECS: "" }, stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    setTimeout(() => {
      const lines = [user(later(5), "yes, all of them"), assistant(later(10), [bash("a", "bouncer confirm tiny --by someone")])];
      writeFileSync(join(folder, "late.jsonl"), `${lines.join("\n")}\n`);
    }, 1000);
    child.on("close", (status) => done({ status, stderr }));
  });
  assert.equal(late.status, 0, late.stderr);
  assert.equal(recorded().answered.how, "session", late.stderr);
  rmSync(join(spec, "confirmed.json"));
  writeFileSync(join(spec, "confirming.json"), JSON.stringify({ startedAt: started, drafted: ["Empty input is invalid."] }));

  // No Claude Code session listed it from this folder: recorded, as unchecked.
  const unchecked = confirm("--by", "someone");
  assert.equal(unchecked.status, 0, unchecked.stderr);
  assert.equal(recorded().answered.how, "unchecked");
  assert.match(unchecked.stderr, /recorded as unchecked/);
  ok("confirm --by: refused with no answer, recorded with an answer, --answered-elsewhere, a session written late, or unchecked with no session");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
