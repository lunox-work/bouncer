// bouncer check's own logic, with no model and no install: the slug, the
// package a change is in, its seam, the base and the changed files on a real
// throwaway git repository, and the stops before anything costs money.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baseOf, changedFiles, packageOf, seamOf, slugFor } from "../bin/check.mjs";

const ok = (name) => console.log(`ok ${name}`);

assert.equal(slugFor("My Repo", "feat/Escrow_split"), "check-my-repo-feat-escrow-split");
assert.equal(slugFor("x", "").length <= 60, true);
assert.ok(slugFor("a".repeat(80), "b").length <= 60);
ok("slugFor: kebab-case, at most 60 characters");

const files = new Set(["package.json", "packages/core/package.json", "packages/web/package.json", "py/pyproject.toml"]);
const has = (path) => files.has(path);
assert.deepEqual(packageOf(["packages/core/src/a.ts", "packages/core/test/a.test.ts", "README.md"], has), { pkg: "packages/core" });
assert.deepEqual(packageOf(["packages/core/src/a.ts", "packages/web/src/b.tsx"], has), { spans: ["packages/core", "packages/web"] });
assert.deepEqual(packageOf(["src/index.ts"], has), { pkg: "." });
assert.deepEqual(packageOf(["py/src/mod/x.py"], has), { pkg: "py" });
assert.deepEqual(packageOf(["README.md", "pnpm-lock.yaml"], has), { none: true });
ok("packageOf: nearest manifest, spans refused, docs-only is none");

assert.deepEqual(seamOf(["packages/core/src/a.ts", "packages/core/src/a.test.ts", "packages/core/test/b.ts", "packages/core/README.md", "packages/web/src/c.ts"], "packages/core"), ["packages/core/src/a.ts"]);
assert.deepEqual(seamOf(["src/mod.py", "tests/test_mod.py", "src/mod_test.py", "conftest.py"], "."), ["src/mod.py"]);
ok("seamOf: changed sources in the package, tests left out");

const repo = mkdtempSync(join(tmpdir(), "bouncer-check-"));
const git = (...argv) => {
  const run = spawnSync("git", ["-C", repo, ...argv], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim();
};
try {
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  writeFileSync(join(repo, "package.json"), "{}\n");
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src", "a.ts"), "export const a = 1;\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  const first = git("rev-parse", "HEAD");

  // Working tree only: base is HEAD, the change is the edit plus the new file.
  writeFileSync(join(repo, "src", "a.ts"), "export const a = 2;\n");
  writeFileSync(join(repo, "src", "b.ts"), "export const b = 1;\n");
  assert.equal(baseOf(repo), first);
  assert.deepEqual(changedFiles(repo, first), ["src/a.ts", "src/b.ts"]);

  // Committed on a branch: base is the fork from main.
  git("checkout", "-q", "-b", "agent");
  git("add", ".");
  git("commit", "-q", "-m", "agent");
  assert.equal(baseOf(repo), first);
  assert.deepEqual(changedFiles(repo, baseOf(repo)), ["src/a.ts", "src/b.ts"]);
  assert.equal(baseOf(repo, "HEAD"), git("rev-parse", "HEAD"));
  assert.throws(() => baseOf(repo, "no-such-ref"), /no such commit/);
  ok("baseOf and changedFiles: working tree, a branch past main, --base");

  // The CLI stops before any session: no ticket.
  const home = mkdtempSync(join(tmpdir(), "bouncer-check-home-"));
  const cli = spawnSync(process.execPath, [join(import.meta.dirname, "..", "bin", "check.mjs"), "--repo", repo, "--no-door", "--package", "."], {
    encoding: "utf8",
    env: { ...process.env, BOUNCER_HOME: home, BOUNCER_BACKEND: "exec" },
    timeout: 120_000,
  });
  rmSync(home, { recursive: true, force: true });
  assert.notEqual(cli.status, 0);
  assert.match(cli.stdout, /bouncer check: check-/);
  assert.match(cli.stdout, /seam src\/a\.ts, src\/b\.ts/);
  ok("the CLI picks the change and stops before any session (fit refuses a repo with no runner)");
} finally {
  rmSync(repo, { recursive: true, force: true });
}
