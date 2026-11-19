// The ID check's parsing and rendering (bin/id.mjs), with no session.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { NEW_FILE_BYTES, diffOf, itemsOf, render } from "../bin/id.mjs";

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
