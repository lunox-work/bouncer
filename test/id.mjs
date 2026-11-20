// The ID check's parsing and rendering (bin/id.mjs), with no session.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { NEW_FILE_BYTES, diffOf, fileLine, itemsOf, render } from "../bin/id.mjs";

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
  const { diff, left } = diffOf(repo);
  assert.match(diff, /\+\+\+ b\/new\.ts/);
  assert.match(diff, /\+export const a = 1;/);
  assert.ok(!diff.includes("a".repeat(1000)), "a large new file is named, not quoted");
  assert.deepEqual(left, ["big.bin (new, large: named only)", "blob.dat (new, binary: named only)"]);
} finally {
  rmSync(repo, { recursive: true, force: true });
}
console.log("id passed");
