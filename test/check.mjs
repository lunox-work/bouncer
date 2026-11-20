// bouncer check's own logic, with no model and no install: the slug, the
// package a change is in, its seam, the base and the changed files on a real
// throwaway git repository, and the stops before anything costs money; and
// what a rerun does: which check it resumes, the flags it refuses, and a
// change that moved since the list was read.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baseOf, changedFiles, freeSlug, isTest, newestCheck, packageOf, resumeConflicts, seamDrift, seamOf, slugFor, staleness } from "../bin/check.mjs";
import { diffOf } from "../bin/id.mjs";

const ok = (name) => console.log(`ok ${name}`);

assert.equal(slugFor("My Repo", "feat/Escrow_split"), "check-my-repo-feat-escrow-split");
assert.equal(slugFor("x", "").length <= 60, true);
assert.ok(slugFor("a".repeat(80), "b").length <= 60);
assert.equal(slugFor("My Repo", "main", "0123456789abcdef"), "check-my-repo-main-0123456");
assert.ok(slugFor("a".repeat(80), "b", "0123456789abcdef").length <= 60);
assert.match(slugFor("a".repeat(80), "b", "0123456789abcdef"), /-0123456$/);
assert.equal(freeSlug("s", () => false), "s");
assert.equal(freeSlug("s", (slug) => ["s", "s-2"].includes(slug)), "s-3");
ok("slugFor: kebab-case, at most 60 characters, the base's hash last; freeSlug counts up");

const records = [
  { slug: "check-r-main-aaaaaaa", record: { checkout: "/r", branch: "main", at: "2026-11-19T00:00:00.000Z" } },
  { slug: "check-r-main-bbbbbbb", record: { checkout: "/r", branch: "main", at: "2026-11-20T00:00:00.000Z" } },
  { slug: "check-r-other-ccccccc", record: { checkout: "/r", branch: "other", at: "2026-11-21T00:00:00.000Z" } },
  { slug: "check-q-main-ddddddd", record: { checkout: "/q", branch: "main", at: "2026-11-22T00:00:00.000Z" } },
  { slug: "check-old-main", record: { checkout: "/old", at: "2026-11-01T00:00:00.000Z" } },
];
assert.equal(newestCheck(records, "/r", "main", "check-r-main").slug, "check-r-main-bbbbbbb");
assert.equal(newestCheck(records, "/r", "none", "check-r-none"), null);
assert.equal(newestCheck(records, "/old", "main", "check-old-main").slug, "check-old-main", "a record from before branches were kept");
assert.equal(newestCheck(records, "/old", "dev", "check-old-dev"), null);
ok("newestCheck: this checkout and branch, the newest");

const held = { base: "a".repeat(40), package: "packages/core", seam: ["packages/core/src/a.ts"], ticket: { from: "o/r#12", sha256: "t1" } };
assert.deepEqual(resumeConflicts(held, {}), []);
assert.deepEqual(resumeConflicts(held, { base: "a".repeat(40), package: "packages/core", seam: ["packages/core/src/a.ts"], from: "o/r#12", ticketSha256: "t1" }), []);
assert.equal(resumeConflicts(held, { base: "b".repeat(40), package: ".", seam: ["x.ts"], from: "o/r#13", ticketSha256: "t2" }).length, 5);
assert.match(resumeConflicts(held, { from: "o/r#13" })[0], /--from is o\/r#13; this check's ticket came from o\/r#12/);
assert.deepEqual(resumeConflicts({ ...held, ticket: undefined }, { from: "o/r#13", ticketSha256: "t2" }), [], "a check with no ticket yet takes the one given");
ok("resumeConflicts: a flag that differs from the resumed check is named");

assert.equal(staleness({ listedSha256: undefined, nowSha256: "b", confirmed: false, draftIntact: true }), "fresh");
assert.equal(staleness({ listedSha256: "a", nowSha256: "a", confirmed: true, draftIntact: false }), "fresh");
assert.equal(staleness({ listedSha256: "a", nowSha256: "b", confirmed: false, draftIntact: true }), "redo");
assert.equal(staleness({ listedSha256: "a", nowSha256: "b", confirmed: false, draftIntact: false }), "edited");
assert.equal(staleness({ listedSha256: "a", nowSha256: "b", confirmed: true, draftIntact: true }), "confirmed");
assert.deepEqual(seamDrift({ package: ".", seam: ["src/a.ts"] }, ["src/a.ts", "src/c.ts", "src/c.test.ts", "README.md"]), ["src/c.ts"]);
ok("staleness and seamDrift: a change that moved since the list was read");

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
assert.equal(isTest("src/spec/parser.ts"), false, "spec/ inside the source is source");
assert.equal(isTest("spec/parser.ts"), true);
assert.equal(isTest("packages/core/spec/parser.ts", "packages/core"), true);
assert.equal(isTest("packages/core/src/e2e/client.ts", "packages/core"), false);
assert.equal(isTest("src/__tests__/a.ts"), true);
assert.deepEqual(seamOf(["src/spec/parser.ts", "spec/parser.spec.ts", "e2e/run.ts"], "."), ["src/spec/parser.ts"]);
ok("seamOf: changed sources in the package, tests left out, spec/ a test folder only at the package's top");

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

  // Out of scope for a hidden suite, with a ticket: the ID check still runs on the whole change, exit 2.
  const listHome = mkdtempSync(join(tmpdir(), "bouncer-check-home-"));
  try {
    writeFileSync(join(listHome, "ticket.md"), "# Add b\n");
    const answer = '[{"question":"What is b?","ticket":"silent","chose":"b is 1","where":"src/b.ts:1","instead":"b is 0"}]';
    const listed = (...argv) =>
      spawnSync(process.execPath, [join(import.meta.dirname, "..", "bin", "check.mjs"), "--repo", repo, "--no-door", "--ticket", join(listHome, "ticket.md"), ...argv], {
        encoding: "utf8",
        env: { ...process.env, BOUNCER_HOME: listHome, BOUNCER_BACKEND: "exec", BOUNCER_EXEC: `cat > /dev/null; printf '%s\\n' '\`\`\`json' '${answer}' '\`\`\`'`, BOUNCER_SPECS: "" },
        timeout: 120_000,
      });
    const unfit = listed("--package", ".");
    assert.equal(unfit.status, 2, unfit.stdout + unfit.stderr);
    assert.match(unfit.stdout, /No hidden suite here, so nothing will be prepared or judged\./);
    assert.match(unfit.stdout, /1 thing your ticket never said\. Your agent picked for you:[\s\S]*What is b\?/);
    assert.match(unfit.stdout, /Questions, not bugs/);
    assert.equal(readdirSync(join(listHome, "specs")).some((slug) => existsSync(join(listHome, "specs", slug, "check.json"))), false, "no record to resume");

    mkdirSync(join(repo, "web", "src"), { recursive: true });
    writeFileSync(join(repo, "web", "package.json"), "{}\n");
    writeFileSync(join(repo, "web", "src", "c.ts"), "export const c = 1;\n");
    const spans = listed("--new");
    assert.equal(spans.status, 2, spans.stdout + spans.stderr);
    assert.match(spans.stderr, /The change spans packages \(\., web\): out of scope for a hidden suite/);
    assert.match(spans.stdout, /What is b\?/);
    rmSync(join(repo, "web"), { recursive: true, force: true });
  } finally {
    rmSync(listHome, { recursive: true, force: true });
  }
  ok("out of scope with a ticket: fit unsupported or spanning packages still lists what the agent picked, exit 2");

  // A rerun. The check is seeded as an earlier run left it at the confirmation
  // stop: pointed (toolchain.json), with its ticket, list and drafted spec.
  const state = mkdtempSync(join(tmpdir(), "bouncer-check-home-"));
  const sha = (text) => createHash("sha256").update(text).digest("hex");
  const run = (...argv) => spawnSync(process.execPath, [join(import.meta.dirname, "..", "bin", "check.mjs"), "--repo", repo, "--no-door", ...argv], { encoding: "utf8", env: { ...process.env, BOUNCER_HOME: state, BOUNCER_BACKEND: "exec", BOUNCER_SPECS: "" }, timeout: 120_000 });
  try {
    const slug = `check-${slugFor(repo.split("/").at(-1), "agent").slice("check-".length)}-${first.slice(0, 7)}`;
    const spec = join(state, "specs", slug);
    mkdirSync(spec, { recursive: true });
    mkdirSync(join(state, "runs", slug), { recursive: true });
    writeFileSync(join(spec, "check.json"), JSON.stringify({ checkout: git("rev-parse", "--show-toplevel"), branch: "agent", base: first, package: ".", seam: ["src/a.ts", "src/b.ts"], changed: ["src/a.ts", "src/b.ts"], at: "2026-11-19T10:00:00.000Z", ticket: { sha256: sha("# Add b\n") } }));
    writeFileSync(join(spec, "toolchain.json"), "{}\n");
    writeFileSync(join(spec, "ticket.md"), "# Add b\n");
    writeFileSync(join(spec, "spec.md"), "# Add b\n\nDecided: b is 1.\n");
    const listed = (diff) => writeFileSync(join(state, "runs", slug, "id.json"), JSON.stringify({ diffSha256: sha(diff), items: [] }));
    listed(diffOf(repo, first).diff);

    const resumed = run();
    assert.equal(resumed.status, 3, resumed.stdout + resumed.stderr);
    assert.match(resumed.stdout, new RegExp(`bouncer check: resuming ${slug}, started 2026-11-19`));
    assert.match(resumed.stdout, /base [0-9a-f]{12}, package \., seam src\/a\.ts, src\/b\.ts\nticket: Add b\nA different change or ticket on this branch\? bouncer check --new/);
    assert.match(resumed.stdout, /never been confirmed/);
    assert.match(resumed.stdout, /Keeping every pick makes the hidden tests say what the code already does/);
    assert.ok(!/Note: the change moved/.test(resumed.stdout));

    // A different ticket, base or seam is refused, not ignored.
    writeFileSync(join(state, "other.md"), "# Remove a\n");
    const other = run("--ticket", join(state, "other.md"), "--base", "HEAD", "--seam", "src/a.ts");
    assert.equal(other.status, 1);
    assert.match(other.stderr, /- --base is [0-9a-f]{12}; this check's base is [0-9a-f]{12}\n- --seam is src\/a\.ts; this check's seam is src\/a\.ts, src\/b\.ts\n- --ticket is not the ticket this check holds\nNothing was changed\. Start another check with --new/);
    writeFileSync(join(state, "same.md"), "# Add b\n");
    assert.equal(run("--ticket", join(state, "same.md")).status, 3, "the same ticket again is fine");

    // The change moved after the list was read: a new source file, and an edited draft is left alone.
    writeFileSync(join(repo, "src", "c.ts"), "export const c = 1;\n");
    const moved = run();
    assert.equal(moved.status, 3);
    assert.match(moved.stdout, /Note: changed since this check started and outside its seam: src\/c\.ts\./);
    assert.match(moved.stdout, /Note: the change moved since the list was read, and spec\.md was edited after it was drafted, so neither is redone\. bouncer id /);

    // --new starts another check on the same branch, under its own slug; two commits past main is said.
    git("add", ".");
    git("commit", "-q", "-m", "agent again");
    const fresh = run("--new");
    assert.notEqual(fresh.status, 0);
    assert.ok(!/resuming/.test(fresh.stdout));
    assert.match(fresh.stdout, new RegExp(`bouncer check: ${slug}-2 `), "the same base on the same branch counts up");
    assert.match(fresh.stdout, /Note: the base is 2 commits behind HEAD, so the change read is everything since [0-9a-f]{12} \(3 files\)\. .* --base/);
    assert.equal(run("--new", "--slug", slug).status, 1);
    assert.equal(existsSync(join(state, "specs", `${slug}-2`, "check.json")), false, "a check fit refused leaves no record to resume");
    assert.deepEqual(readdirSync(join(state, "runs")), [slug], "no session ran");
    ok("a rerun: resumed and said, differing flags refused, a moved change named, --new counts up");

    // The draft (crashed in 0.8.0: capDiff's object went to the drafter as the diff). No list and no
    // spec.md: the ID check and the drafter run, as exec stand-ins told apart by id.md, then exit 3.
    rmSync(join(spec, "spec.md"));
    rmSync(join(state, "runs", slug, "id.json"));
    const answer = '[{"question":"What is b?","ticket":"silent","chose":"b is 1","where":"src/b.ts:1","instead":"b is 0"}]';
    const drafted = spawnSync(process.execPath, [join(import.meta.dirname, "..", "bin", "check.mjs"), "--repo", repo, "--no-door", "--slug", slug], {
      encoding: "utf8",
      env: {
        ...process.env,
        BOUNCER_HOME: state,
        BOUNCER_BACKEND: "exec",
        BOUNCER_SPECS: "",
        BOUNCER_EXEC: `cat > /dev/null; if [ -f id.md ] && [ -f change.diff ]; then printf '# Add b\\n\\nDecided:\\n- b is 1.\\n' > spec.md; else printf '%s\\n' '\`\`\`json' '${answer}' '\`\`\`'; fi`,
      },
      timeout: 120_000,
    });
    assert.equal(drafted.status, 3, drafted.stdout + drafted.stderr);
    assert.match(drafted.stdout, /What is b\?/);
    assert.match(readFileSync(join(spec, "spec.md"), "utf8"), /Decided:\n- b is 1\./);
    assert.match(drafted.stdout, /Decided, the kinds drafts get wrong most often first:[\s\S]*b is 1\./, "the stop lists spec.md's decisions");
    assert.ok(existsSync(join(spec, "confirming.json")), "and starts the person's clock");
    assert.ok(!/node bin\/|^Next:/m.test(drafted.stdout + drafted.stderr), "no step's own Next: line, no clone-only command");
    ok("the draft: the ID check, then spec.md drafted from the ticket, the list and the diff, then the confirmation stop");
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
} finally {
  rmSync(repo, { recursive: true, force: true });
}
