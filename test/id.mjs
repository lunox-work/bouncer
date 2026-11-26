// The ID check's parsing and rendering (bin/id.mjs), with no session.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { INLINE_BYTES, LIVE_HEAD, NEW_FILE_BYTES, ON_ITS_OWN, diffOf, fileLine, itemFeed, itemsOf, liveTail, numbered, promptFor, render, renderItem } from "../bin/id.mjs";
import { textFeed } from "../bin/lib.mjs";

const answer = 'Reading both.\n```json\n[{"question":"What does a $0 bounty release?","ticket":"","chose":"Records a release of 0.","where":"src/index.ts:41","instead":"Records nothing."},{"bad":1}]\n```';
assert.deepEqual(itemsOf(answer), [{ question: "What does a $0 bounty release?", ticket: "silent", chose: "Records a release of 0.", where: "src/index.ts:41", instead: "Records nothing." }]);
assert.equal(itemsOf("no json here"), null);
assert.equal(itemsOf('```json\n{"not":"a list"}\n```'), null);
assert.equal(itemsOf("```json\n" + JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ question: `q${i}`, chose: "c" }))) + "\n```").length, 12, "twelve at most");
console.log("ok itemsOf");

const text = render(itemsOf(answer));
assert.match(text, /^1 thing your ticket never said\. Your agent picked for you:/);
assert.match(text, /picked: Records a release of 0\. \(src\/index\.ts:41\)/);
assert.match(text, /ticket: silent/);
assert.ok(!/bug|wrong|risk/i.test(text), "questions, never verdicts");
assert.equal(render([]), "Your ticket left nothing open that this change answers.");
console.log("ok render");

// fileLine: the session counts lines of diff.patch; the person reads the file's.
// This diff is the real pull request's where src/slug.js:22 meant the file's line 5.
{
  const diff = [
    "diff --git a/.github/workflows/bouncer-id.yml b/.github/workflows/bouncer-id.yml",
    "index cf4bb24..d09da15 100644",
    "--- a/.github/workflows/bouncer-id.yml",
    "+++ b/.github/workflows/bouncer-id.yml",
    "@@ -6,4 +6,5 @@ jobs:",
    "   id:",
    "     permissions: { contents: read, pull-requests: write, issues: read }",
    "     uses: lunox-work/bouncer/.github/workflows/id-comment.yml@main",
    "-    secrets: { anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }} }",
    "+    secrets:",
    "+      anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}",
    "diff --git a/src/slug.js b/src/slug.js",
    "index b4e7b07..ceb3201 100644",
    "--- a/src/slug.js",
    "+++ b/src/slug.js",
    "@@ -1,3 +1,7 @@",
    " export function slug(text) {",
    "-  return text.toLowerCase().trim();",
    "+  return text",
    "+    .toLowerCase()",
    "+    .trim()",
    '+    .replace(/[^a-z0-9]+/g, "-")',
    '+    .replace(/^-+|-+$/g, "");',
    " }",
    "",
  ].join("\n");
  assert.equal(fileLine(diff, "src/slug.js:19"), "src/slug.js:2");
  assert.equal(fileLine(diff, "src/slug.js:22"), "src/slug.js:5");
  assert.equal(fileLine(diff, "src/slug.js:23"), "src/slug.js:6");
  assert.equal(fileLine(diff, "src/slug.js:22-23"), "src/slug.js:5-6");
  assert.equal(fileLine(diff, "src/slug.js:17"), "src/slug.js:1", "a context line");
  assert.equal(fileLine(diff, "src/slug.js:18"), "src/slug.js:2", "a removed line: where it stood");
  assert.equal(fileLine(diff, ".github/workflows/bouncer-id.yml:10"), ".github/workflows/bouncer-id.yml:9", "past a removed line");
  assert.equal(fileLine(diff, "b/src/slug.js:20"), "b/src/slug.js:3");
  assert.equal(fileLine(diff, "slug.js:21"), "slug.js:4", "a path named by its tail");
  assert.equal(fileLine(diff, "src/slug.js:9"), "src/slug.js:9", "another file's section: left as written");
  assert.equal(fileLine(diff, "src/slug.js:14"), "src/slug.js:14", "a header line: left as written");
  assert.equal(fileLine(diff, "src/slug.js:16"), "src/slug.js:16", "the hunk header: left as written");
  assert.equal(fileLine(diff, "src/slug.js:400"), "src/slug.js:400", "past the end: left as written");
  assert.equal(fileLine(diff, "src/slug.js"), "src/slug.js");
  assert.equal(fileLine(diff, ""), "");
  assert.equal(fileLine(diff, undefined), "");
}
console.log("ok fileLine");

// diffOf: the working tree against HEAD, untracked files included.
const repo = mkdtempSync(join(tmpdir(), "bouncer-id-"));
try {
  const git = (...argv) => spawnSync("git", ["-C", repo, ...argv], { encoding: "utf8" });
  git("init", "-q");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "base");
  writeFileSync(join(repo, "new.ts"), "export const a = 1;\n");
  writeFileSync(join(repo, "big.bin"), Buffer.alloc(NEW_FILE_BYTES + 1, 97));
  writeFileSync(join(repo, "blob.dat"), Buffer.from([1, 0, 2]));
  // What `ls-files --others` names that is not a file: a link to a folder, a
  // nested clone (`nested/`). Reading them threw EISDIR in 0.8.6.
  mkdirSync(join(repo, "nested"));
  spawnSync("git", ["-C", join(repo, "nested"), "init", "-q"]);
  spawnSync("git", ["-C", join(repo, "nested"), "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "n"]);
  let linked = true;
  try {
    symlinkSync("nested", join(repo, "link"), "dir");
  } catch {
    linked = false; // Windows without the privilege to make links
  }
  const { diff, left } = diffOf(repo);
  if (linked) assert.match(diff, /diff --git a\/link b\/link\nnew file mode 120000\n[^]*?\n\+nested\n/, "a link is shown by its target");
  assert.ok(!diff.includes("nested/"), "a nested clone is not part of the change");
  assert.match(diff, /\+\+\+ b\/new\.ts/);
  assert.match(diff, /\+export const a = 1;/);
  assert.ok(!diff.includes("a".repeat(1000)), "a large new file is named, not quoted");
  assert.deepEqual(left, ["big.bin (new, large: named only)", "blob.dat (new, binary: named only)"]);
} finally {
  rmSync(repo, { recursive: true, force: true });
}
console.log("ok diffOf");

// On its own, as the first thing a person runs: the request on stdin, the
// change picked the way `bouncer check` picks it (here committed on a branch,
// so the fork from main), no spec and no slug. The ticket and the list are
// kept for a check of the same change.
{
  const work = mkdtempSync(join(tmpdir(), "bouncer-id-alone-"));
  const home = mkdtempSync(join(tmpdir(), "bouncer-id-home-"));
  try {
    const git = (...argv) => spawnSync("git", ["-C", work, "-c", "user.email=t@t", "-c", "user.name=t", ...argv], { encoding: "utf8" });
    git("init", "-q", "-b", "main");
    writeFileSync(join(work, "a.ts"), "export const a = 1;\n");
    git("add", ".");
    git("commit", "-q", "-m", "base");
    const first = git("rev-parse", "HEAD").stdout.trim();
    git("checkout", "-q", "-b", "agent");
    writeFileSync(join(work, "b.ts"), "export const b = 1;\n");
    git("add", ".");
    git("commit", "-q", "-m", "agent");
    const answer = '[{"question":"What is b?","ticket":"silent","chose":"b is 1","where":"b.ts:1","instead":"b is 0"}]';
    const id = (argv, input) =>
      spawnSync(process.execPath, [join(import.meta.dirname, "..", "bin", "id.mjs"), ...argv], {
        cwd: work,
        input,
        encoding: "utf8",
        env: { ...process.env, BOUNCER_HOME: home, BOUNCER_BACKEND: "exec", BOUNCER_EXEC: `cat > /dev/null; printf '%s\\n' '\`\`\`json' '${answer}' '\`\`\`'`, BOUNCER_SPECS: "", BOUNCER_UNDER_CHECK: "" },
        timeout: 120_000,
      });
    const alone = id(["--ticket", "-"], "Add b.\n");
    assert.equal(alone.status, 0, alone.stdout + alone.stderr);
    assert.match(alone.stderr, new RegExp(`id: reading everything since ${first.slice(0, 12)} \\(1 commit and the working tree\\)`));
    assert.match(alone.stdout, /1 thing your ticket never said\. Your agent picked for you:[\s\S]*What is b\?[\s\S]*picked: b is 1 \(b\.ts:1\)/);
    assert.ok(alone.stdout.includes(ON_ITS_OWN) && !alone.stdout.includes("spec.md"), "no spec yet: the list is questions, nothing goes into a spec");
    assert.match(alone.stdout, /For a verdict from tests it never saw: bouncer check\./);
    const lists = join(home, "runs", "_id", "lists");
    const [kept] = readdirSync(lists).map((name) => JSON.parse(readFileSync(join(lists, name), "utf8")));
    assert.equal(kept.ticket, "Add b.\n");
    assert.equal(kept.items.length, 1);
    assert.match(kept.diffSha256, /^[0-9a-f]{64}$/);

    assert.equal(id(["--ticket", "-"], "  \n").status, 1, "an empty ticket is refused");
    const none = id(["--ticket", "-", "--base", "HEAD"], "Add b.\n");
    assert.equal(none.status, 1);
    assert.match(none.stderr, /No change to check: nothing differs from [0-9a-f]{12}\./);
    const noTicket = id([]);
    assert.equal(noTicket.status, 1);
    assert.match(noTicket.stderr, /No ticket: pass --ticket <file>, --ticket - with the request on stdin, --from <issue>/);
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
}
console.log("ok id on its own: stdin ticket, the branch's change, the list kept for check");

// itemFeed: each item the moment its object closes, however the text is cut.
{
  const items = [
    { question: "What does a $0 bounty release?", ticket: "silent", chose: 'Records "0" {as} [a] release.\\n', where: "src/index.ts:41", instead: "Nothing." },
    { question: "Second?", ticket: "Pay out once.", chose: "Pays twice } ] ```", where: "", instead: "" },
  ];
  const answer = `Prose with [brackets] and {braces} first.\n\`\`\`json\n[${JSON.stringify(items[0])}, {"bad": 1}, ${JSON.stringify(items[1])}]\n\`\`\`\nAfter: {"question":"no","chose":"no"}`;
  for (const size of [1, 3, 7, answer.length]) {
    const got = [];
    const feed = itemFeed((item, n) => got.push([n, item]));
    for (let i = 0; i < answer.length; i += size) feed(answer.slice(i, i + size));
    assert.deepEqual(got.map(([n]) => n), [1, 2], `chunks of ${size}`);
    assert.deepEqual(got.map(([, item]) => item), itemsOf(answer), `chunks of ${size}: the same items as the final parse`);
  }
  const many = itemFeed(() => {});
  let count = 0;
  const counted = itemFeed(() => count++);
  counted("```json\n" + JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ question: `q${i}`, chose: "c" }))) + "\n```");
  assert.equal(count, 12, "twelve at most");
  many("no fence, no items");
}
console.log("ok itemFeed");

// promptFor: the files in the prompt, the diff numbered as Read numbers it.
{
  const prompt = readFileSync(join(import.meta.dirname, "..", "prompts", "id.md"), "utf8");
  const text = promptFor(prompt, "Add b.\n", "diff --git a/b.ts b/b.ts\n+export const b = 1;\n");
  assert.ok(!text.includes("Read both files."), "nothing to open");
  assert.match(text, /## ticket\.md\n\nAdd b\.\n\n## diff\.patch\n\n     1\tdiff --git a\/b\.ts b\/b\.ts\n     2\t\+export const b = 1;\n/);
  assert.ok(text.includes("Answer with one JSON block"), "the instructions stay whole");
  assert.equal(numbered("a\nb"), "     1\ta\n     2\tb");
  assert.equal(promptFor(prompt, "t", "+x\n".repeat(INLINE_BYTES)), prompt, "too large: the files stay on disk");
  assert.equal(promptFor("an edited prompt", "t", "d"), "an edited prompt", "a prompt that no longer says to read them is left alone");
}
console.log("ok promptFor");

// textFeed: text deltas as they come; whole blocks only when the CLI sent none.
{
  const line = (o) => JSON.stringify(o) + "\n";
  const delta = (text) => line({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } });
  const got = [];
  const feed = textFeed((text) => got.push(text));
  const out = line({ type: "system", subtype: "init" }) + delta("He") + line({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "hm" } } }) + delta("llo") + line({ type: "assistant", message: { content: [{ type: "text", text: "Hello" }] } });
  for (let i = 0; i < out.length; i += 5) feed(Buffer.from(out.slice(i, i + 5)));
  assert.deepEqual(got, ["He", "llo"]);
  const whole = [];
  textFeed((text) => whole.push(text))(line({ type: "assistant", message: { content: [{ type: "thinking", thinking: "x" }, { type: "text", text: "All at once" }] } }));
  assert.deepEqual(whole, ["All at once"]);
}
console.log("ok textFeed");

assert.equal(renderItem({ question: "Q?", ticket: "silent", chose: "C.", where: "a.ts:1", instead: "" }, 3), "3. Q?\n   picked: C. (a.ts:1)\n   ticket: silent");
assert.equal(liveTail(2, ON_ITS_OWN), `2 things in all. ${ON_ITS_OWN}`);
assert.equal(liveTail(0), "Your ticket left nothing open that this change answers.");
assert.ok(!/bug|wrong|risk/i.test(LIVE_HEAD));
console.log("ok live head and tail");

// One session on a fake claude CLI: items arrive before it ends, the
// transcript keeps its usual shape, the prompt carries the files.
if (process.platform !== "win32") {
  const home = mkdtempSync(join(tmpdir(), "bouncer-id-live-"));
  try {
    const items = [1, 2, 3].map((n) => ({ question: `Q${n}?`, ticket: "silent", chose: `C${n}.`, where: "", instead: "" }));
    const final = "```json\n" + JSON.stringify(items) + "\n```";
    const fake = join(home, "claude.mjs");
    writeFileSync(
      fake,
      `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(join(home, "argv.json"))}, JSON.stringify(process.argv.slice(2)));
const final = ${JSON.stringify(final)};
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
out({ type: "system", subtype: "init", session_id: "s", model: "m" });
const parts = final.match(/[\\s\\S]{1,40}/g);
let i = 0;
const tick = setInterval(() => {
  if (i < parts.length) return out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: parts[i++] } } });
  clearInterval(tick);
  out({ type: "assistant", message: { content: [{ type: "text", text: final }] } });
  out({ type: "result", subtype: "success", result: final, total_cost_usd: 0.01, num_turns: 1 });
}, 30);
`,
    );
    const runner = join(home, "run.mjs");
    writeFileSync(
      runner,
      `import { listOf } from ${JSON.stringify(join(import.meta.dirname, "..", "bin", "id.mjs"))};
const seen = [];
const started = Date.now();
const result = await listOf({ ticket: "Add b.\\n", diff: "diff --git a/b.ts b/b.ts\\n+b\\n", onItem: (item, n) => seen.push({ n, q: item.question, ms: Date.now() - started }) });
console.log(JSON.stringify({ seen, items: result.items, ms: Date.now() - started }));
`,
    );
    const run = spawnSync(process.execPath, [runner], { encoding: "utf8", env: { ...process.env, BOUNCER_HOME: home, CLAUDE_BIN: fake, BOUNCER_BACKEND: "claude-cli", BOUNCER_SPECS: "" }, timeout: 60_000 });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const got = JSON.parse(run.stdout.trim().split("\n").pop());
    assert.deepEqual(got.seen.map((s) => s.q), ["Q1?", "Q2?", "Q3?"]);
    assert.deepEqual(got.items.map((item) => item.question), ["Q1?", "Q2?", "Q3?"]);
    assert.ok(got.seen[0].ms < got.ms - 100, `the first item came before the session ended (${got.seen[0].ms} of ${got.ms} ms)`);
    const argv = JSON.parse(readFileSync(join(home, "argv.json"), "utf8"));
    assert.ok(argv.includes("--include-partial-messages"));
    assert.match(argv[argv.indexOf("-p") + 1], /## diff\.patch\n\n     1\tdiff --git a\/b\.ts b\/b\.ts/);
    const [transcript] = readdirSync(join(home, "runs", "_id", "id"));
    const kept = readFileSync(join(home, "runs", "_id", "id", transcript), "utf8");
    assert.ok(!kept.includes("stream_event") && kept.includes('"type":"result"'), "the transcript keeps its usual shape");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
  console.log("ok id streams on the claude CLI");
}
console.log("id passed");
