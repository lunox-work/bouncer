#!/usr/bin/env node
// After the fact, as one command (skills/bouncer/references/check.md): the
// agent says it's done and the person doubts it. Runs every step that needs
// no person, in order, and stops only where one is needed. Each step is
// skipped when its output exists, so running it again resumes.
//
//   node bin/check.mjs [--repo <checkout>] [--from <issue> | --ticket <file>]
//     [--base <ref>] [--package <dir>] [--seam <file>[,<file>]] [--slug <slug>]
//     [--new] [--accept-open] [--card <file.svg>] [--no-door]
//
// 1. The door (bin/door.mjs): a report, never a stop.
// 2. The change: --base, else the merge-base with the default branch when
//    HEAD is past it, else HEAD (the working tree's change). A base two or
//    more commits behind HEAD is said, with --base, since on a shared branch
//    those commits may not all be the agent's. Its package is
//    the nearest folder with a package.json or a pyproject.toml shared by
//    every changed source file; a change spanning packages stops. The seam
//    is the changed source files that are not tests. --package and --seam
//    override.
// 3. bin/repo.mjs points one slug at that package (fit at base); unsupported
//    stops with exit 2; with a ticket, the ID check (step 5) runs on the
//    whole change first, as it does for a change spanning packages.
// 4. The ticket: --from (bin/confirm.mjs --from), --ticket, or one already
//    in specs/<slug>/ticket.md.
// 5. The ID check (bin/id.mjs) on the working tree against base.
// 6. spec.md, drafted in one session from the ticket and the list, each
//    listed pick a `Decided:` item with the listed alternative as `Instead:`.
// 7. Stop, exit 3: the person confirms (`bouncer confirm <slug>`, then
//    `--by`). Nothing here confirms for them.
// 8. Once confirmed: bin/prepare.mjs, then bin/judge.mjs --repo --audit on
//    the working tree, exiting with the judge's code.
//
// specs/<slug>/check.json keeps the checkout, branch, base, package, seam
// and where the ticket came from, so a rerun judges the same change after
// the agent commits it. A rerun on the same checkout and branch resumes the
// newest check there and says which: its base, seam and ticket. --new starts
// another (a second task on the same branch); a --base, --package, --seam,
// --from or --ticket that differs from the resumed check's is refused, not
// ignored. The slug is --slug, else `check-<folder>-<branch>-<base>`.
//
// The change can move between runs. Before drafting and before preparing,
// the diff is hashed against the one the list was read from: while the spec
// is unconfirmed the list and the draft are redone (unless the person edited
// the draft), once it is confirmed the move is said and judged as it is.
// Sources changed since the check started are named: they are outside its
// seam.
//
// Exit: once judged, the judge's code (0 passed, 2 overfit, 3 regressed, 1
// otherwise). Before that: 1 nothing to check, a refused flag or a failed
// step; 2 out of scope or `fit` unsupported; 3 the person must confirm; 4
// prepare's open questions (answer them in spec.md, or --accept-open).

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { confirmation } from "./confirm.mjs";
import { capDiff, diffOf, render } from "./id.mjs";
import { ROOT, RUNS, SPECS, args, discard, log, prompt, readJson, session, sha256, specDir, stage, toolchainOf, workdir, writeJson } from "./lib.mjs";
import { say } from "./voice.mjs";

const SOURCE = /\.(?:[cm]?[jt]sx?|py)$/;
// A test by its name or by a test folder anywhere in the path.
const TEST = /(?:^|\/)(?:__tests__|__mocks__|tests?)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)test_[^/]*\.py$|_test\.py$|(?:^|\/)conftest\.py$/;
// spec/, specs/ and e2e/ are test folders only at the top of the package: src/spec/parser.ts is source.
const TEST_ROOT = /^(?:specs?|e2e)\//;

/** Whether a repository-relative path is a test, for a package at `pkg` ("." is the root). */
export function isTest(path, pkg = ".") {
  const inside = pkg === "." ? path : path.startsWith(`${pkg}/`) ? path.slice(pkg.length + 1) : path;
  return TEST.test(path) || TEST_ROOT.test(inside);
}
const MANIFESTS = ["package.json", "pyproject.toml", "setup.py", "setup.cfg"];

/**
 * A kebab-case slug for a checkout and branch, at most 60 characters:
 * `check-<folder>-<branch>`, and with `base` (a commit) its first seven
 * characters after it, so two changes on one branch get two slugs.
 */
export function slugFor(folder, branch, base = "") {
  const kebab = (text) =>
    String(text ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const short = kebab(base).slice(0, 7);
  const stem = ["check", kebab(folder), kebab(branch)]
    .filter(Boolean)
    .join("-")
    .slice(0, short ? 52 : 60)
    .replace(/-+$/, "");
  return short ? `${stem}-${short}` : stem;
}

/** `slug`, or `slug-2`, `slug-3`... : the first that `taken(slug)` does not hold. */
export function freeSlug(slug, taken) {
  if (!taken(slug)) return slug;
  for (let n = 2; ; n += 1) if (!taken(`${slug}-${n}`)) return `${slug}-${n}`;
}

/**
 * The newest check started on this checkout and branch, among `records`
 * ([{ slug, record }], each a specs/<slug>/check.json): { slug, record } or
 * null. A record from before branches were kept matches by its slug.
 */
export function newestCheck(records, root, branch, legacySlug) {
  const mine = records.filter(({ slug, record }) => record?.checkout === root && (record.branch === undefined ? slug === legacySlug : record.branch === branch));
  return mine.sort((a, b) => String(b.record.at ?? "").localeCompare(String(a.record.at ?? "")))[0] ?? null;
}

/**
 * What a rerun's flags ask for that the resumed check is not: one line each,
 * empty when they agree. `given` holds only the flags passed: { base (a
 * commit), package, seam: [..], from, ticketSha256 }.
 */
export function resumeConflicts(record, given) {
  const found = [];
  if (given.base !== undefined && given.base !== record.base) found.push(`--base is ${given.base.slice(0, 12)}; this check's base is ${String(record.base).slice(0, 12)}`);
  if (given.package !== undefined && given.package !== record.package) found.push(`--package is ${given.package}; this check's package is ${record.package}`);
  if (given.seam !== undefined && [...given.seam].sort().join("\n") !== [...record.seam].sort().join("\n")) found.push(`--seam is ${given.seam.join(", ")}; this check's seam is ${record.seam.join(", ")}`);
  // A check that holds no ticket yet takes the one this run brings.
  if (given.from !== undefined && record.ticket !== undefined && given.from !== record.ticket.from) found.push(`--from is ${given.from}; this check's ticket ${record.ticket?.from ? `came from ${record.ticket.from}` : "did not come from there"}`);
  if (given.ticketSha256 !== undefined && record.ticket !== undefined && given.ticketSha256 !== record.ticket.sha256) found.push("--ticket is not the ticket this check holds");
  return found;
}

/**
 * What to do when the diff may have moved since the list was read:
 * "fresh" (same diff, or no list yet), "redo" (moved, unconfirmed, the
 * draft untouched: read the list and draft again), "edited" (moved,
 * unconfirmed, but the person edited the draft: leave both), "confirmed"
 * (moved after the person confirmed: say so and judge it as it is).
 */
export function staleness({ listedSha256, nowSha256, confirmed, draftIntact }) {
  if (listedSha256 === undefined || listedSha256 === null || listedSha256 === nowSha256) return "fresh";
  if (confirmed) return "confirmed";
  return draftIntact ? "redo" : "edited";
}

/** Sources changed now, in the check's package and outside its tests, that its seam does not hold. */
export function seamDrift(record, changedNow) {
  return seamOf(changedNow, record.package).filter((path) => !record.seam.includes(path));
}

/**
 * The package a change is in: the nearest folder holding a manifest, for
 * every changed source file. { pkg } when they agree ("." is the root),
 * { spans: [..] } when they do not, { none: true } with no source change.
 * `has(path)` says whether a repository-relative file exists.
 */
export function packageOf(changed, has) {
  const found = new Set();
  for (const file of changed.filter((path) => SOURCE.test(path))) {
    let dir = posix.dirname(file);
    for (;;) {
      if (MANIFESTS.some((name) => has(dir === "." ? name : `${dir}/${name}`))) break;
      if (dir === ".") break;
      dir = posix.dirname(dir);
    }
    found.add(dir);
  }
  if (found.size === 0) return { none: true };
  if (found.size > 1) return { spans: [...found].sort() };
  return { pkg: [...found][0] };
}

/** The seam: changed source files inside `pkg` that are not tests, repository-relative. */
export function seamOf(changed, pkg) {
  const inside = (path) => pkg === "." || path.startsWith(`${pkg}/`);
  return changed.filter((path) => SOURCE.test(path) && !isTest(path, pkg) && inside(path)).sort();
}

/** What the drafting session is told beyond prompts/repo/spec-from-ticket.md. */
export const DRAFT_ADDENDUM = `
\`id.md\` lists what an implementation of this ticket already picked for each
open question it met, with the ticket's sentence and the usual alternative.
Make each one a \`Decided:\` item: the pick as the rule, its \`Ticket:\` line as
listed, and the listed alternative as \`Instead:\`. The person keeps or
changes each one before any test is written. Decide any other open question
as above.

\`change.diff\` is the change itself, already written. Read it for the
interface only: name the functions, types and files the change exports, by
its names and signatures. A helper it keeps private is not part of the
interface, however useful it would be to test, and nothing it does not have
is. The decisions come from \`id.md\` and the ticket, not from the code.
`;

const git = (checkout, ...argv) => spawnSync("git", ["-C", checkout, ...argv], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const lines = (text) => String(text ?? "").split("\n").map((line) => line.trim()).filter(Boolean);

/** The default branch's ref: origin/HEAD, else main, else master; null when none exists. */
function defaultBranch(checkout) {
  const head = git(checkout, "symbolic-ref", "--quiet", "refs/remotes/origin/HEAD");
  if (head.status === 0) return head.stdout.trim().replace(/^refs\/remotes\//, "");
  for (const name of ["origin/main", "origin/master", "main", "master"]) if (git(checkout, "rev-parse", "--verify", "--quiet", name).status === 0) return name;
  return null;
}

/** The base commit of the change: --base, else the merge-base with the default branch when HEAD is past it, else HEAD. */
export function baseOf(checkout, given) {
  if (given) {
    const sha = git(checkout, "rev-parse", "--verify", `${given}^{commit}`);
    if (sha.status !== 0) throw new Error(`--base ${given}: no such commit in ${checkout}.`);
    return sha.stdout.trim();
  }
  const head = git(checkout, "rev-parse", "HEAD").stdout.trim();
  const branch = defaultBranch(checkout);
  const fork = branch === null ? "" : git(checkout, "merge-base", "HEAD", branch).stdout.trim();
  return fork !== "" && fork !== head ? fork : head;
}

/** Changed files against `base`: tracked changes plus untracked files, repository-relative. */
export function changedFiles(checkout, base) {
  const tracked = git(checkout, "diff", "--name-only", "--no-renames", base);
  if (tracked.status !== 0) throw new Error(`git diff ${base} failed in ${checkout}: ${tracked.stderr.trim()}`);
  const untracked = git(checkout, "ls-files", "--others", "--exclude-standard");
  return [...new Set([...lines(tracked.stdout), ...lines(untracked.stdout)])].sort();
}

// BOUNCER_UNDER_CHECK: the steps leave out their own "Next:" lines, since check decides what comes next.
const step = (script, argv) => spawnSync(process.execPath, [join(ROOT, "bin", script), ...argv], { cwd: ROOT, stdio: "inherit", env: { ...process.env, BOUNCER_UNDER_CHECK: "1" } }).status ?? 1;

async function draftSpec(slug, out, diff) {
  const chain = toolchainOf(slug);
  const listed = readJson(join(RUNS, slug, "id.json"), null);
  const dir = stage(workdir(`${slug}-draft`), slug, { spec: false });
  try {
    writeFileSync(join(dir, "ticket.md"), readFileSync(join(out, "ticket.md"), "utf8"));
    writeFileSync(join(dir, "id.md"), `${render(listed?.items ?? [])}\n`);
    writeFileSync(join(dir, "change.diff"), diff);
    log(slug, "drafting spec.md from the ticket and the ID check");
    const result = await session({
      cwd: dir,
      text: `${prompt("spec-from-ticket", chain)}\n${DRAFT_ADDENDUM}`,
      transcript: join(RUNS, slug, "check", "draft.jsonl"),
      kind: "generate",
      chain,
    });
    if (!existsSync(join(dir, "spec.md"))) throw new Error(`the drafting session wrote no spec.md (${result.subtype ?? "no result"})`);
    writeFileSync(join(out, "spec.md"), readFileSync(join(dir, "spec.md"), "utf8"));
  } finally {
    discard(dir);
  }
}

/** Every check started on this machine: [{ slug, record }]. */
function checks() {
  if (!existsSync(SPECS)) return [];
  return readdirSync(SPECS)
    .map((slug) => ({ slug, record: readJson(join(SPECS, slug, "check.json"), null) }))
    .filter(({ record }) => record !== null);
}

/**
 * Out of scope for a hidden suite (a change spanning packages, `fit`
 * unsupported) is not out of scope for the list: the ID check needs a
 * ticket and a diff, no runner and no package. With a ticket, list what it
 * never said and what the whole change picked, then stop with exit 2 as
 * before. With none, say how to get the list. No record is kept, so a later
 * run starts afresh.
 */
function listOnly({ slug, out, ticketPath, root, base, options, givenTicket }) {
  if (!existsSync(ticketPath)) {
    if (typeof options.from === "string") {
      if (step("confirm.mjs", [slug, "--from", options.from]) !== 0) return 2;
    } else if (givenTicket !== undefined) {
      mkdirSync(out, { recursive: true });
      writeFileSync(ticketPath, givenTicket);
    } else {
      console.error("No hidden suite here. With --from <issue> or --ticket <file>, bouncer check still lists what the ticket never said and what the agent picked (bouncer id).");
      return 2;
    }
  }
  console.log("No hidden suite here, so nothing will be prepared or judged. The ID check reads the whole change:");
  const status = step("id.mjs", [slug, "--repo", root, "--base", base]);
  if (status !== 0) return status;
  console.log("Questions, not bugs: put each to the person. A pick they would change is work the agent is not done with.");
  return 2;
}

const headingOf = (file) => (existsSync(file) ? (/^#\s+(.+)$/m.exec(readFileSync(file, "utf8"))?.[1] ?? readFileSync(file, "utf8").split("\n").find((line) => line.trim() !== "") ?? "").trim() : "");

async function main() {
  const { options } = args();
  const checkout = realpathSync(resolve(typeof options.repo === "string" ? options.repo : "."));
  if (git(checkout, "rev-parse", "--show-toplevel").status !== 0) {
    console.error(`${checkout} is not a git checkout. Run bouncer check inside the repository the agent changed, or pass --repo.`);
    return 1;
  }
  const root = git(checkout, "rev-parse", "--show-toplevel").stdout.trim();
  const named = git(root, "rev-parse", "--abbrev-ref", "HEAD").stdout.trim();
  const branch = named === "HEAD" ? git(root, "rev-parse", "--short", "HEAD").stdout.trim() : named;
  const stem = slugFor(basename(root), branch);
  const fresh = options.new !== undefined;
  const givenBase = typeof options.base === "string" ? baseOf(root, options.base) : undefined;
  const givenPackage = typeof options.package === "string" ? options.package.replace(/\/+$/, "") || "." : undefined;
  const givenSeam = typeof options.seam === "string" ? options.seam.split(",").map((item) => item.trim()).filter(Boolean) : undefined;
  if (typeof options.ticket === "string" && !existsSync(resolve(options.ticket))) {
    console.error(`--ticket ${options.ticket}: no such file.`);
    return 1;
  }
  const givenTicket = typeof options.ticket === "string" ? readFileSync(resolve(options.ticket), "utf8") : undefined;

  // Which check: --slug, else the newest one started on this checkout and branch, else a new one.
  let slug;
  let record = null;
  if (typeof options.slug === "string") {
    slug = options.slug;
    record = readJson(join(specDir(slug), "check.json"), null);
    if (record !== null && fresh) {
      console.error(`--new, but ${slug} already holds a check (started ${String(record.at).slice(0, 10)}). Pick another --slug.`);
      return 1;
    }
  } else {
    const earlier = fresh ? null : newestCheck(checks(), root, branch, stem);
    if (earlier !== null) ({ slug, record } = earlier);
    else slug = freeSlug(slugFor(basename(root), branch, givenBase ?? baseOf(root)), (candidate) => existsSync(specDir(candidate)));
  }
  const out = specDir(slug);
  const recordPath = join(out, "check.json");
  const ticketPath = join(out, "ticket.md");

  if (record === null) console.log(`bouncer check: ${slug} (${root})`);
  else {
    // A resumed check is said, so a second task on the same branch is not judged against the first one's spec.
    // The ticket held is the file as it is now: the person may have edited it since.
    const held = existsSync(ticketPath) ? { from: record.ticket?.from, sha256: sha256(readFileSync(ticketPath, "utf8")) } : undefined;
    const conflicts = resumeConflicts({ ...record, ticket: held }, {
      base: givenBase,
      package: givenPackage,
      seam: givenSeam,
      from: typeof options.from === "string" ? options.from : undefined,
      ticketSha256: givenTicket === undefined ? undefined : sha256(givenTicket),
    });
    const ticket = headingOf(ticketPath);
    console.log(
      [
        `bouncer check: resuming ${slug}, started ${String(record.at).slice(0, 10)} (${record.checkout})`,
        `base ${String(record.base).slice(0, 12)}, package ${record.package}, seam ${record.seam.join(", ")}`,
        ...(ticket ? [`ticket: ${ticket}`] : []),
        "A different change or ticket on this branch? bouncer check --new",
      ].join("\n"),
    );
    if (conflicts.length > 0) {
      console.error(`This run asks for something else than the check it resumes:\n${conflicts.map((line) => `- ${line}`).join("\n")}\nNothing was changed. Start another check with --new, or drop the flag to go on with this one.`);
      return 1;
    }
  }

  // 1. The door: a report, never a stop.
  if (options["no-door"] === undefined && record === null) step("door.mjs", ["--repo", root]);

  // 2. The change.
  if (record === null) {
    const base = givenBase ?? baseOf(root);
    const changed = changedFiles(root, base);
    if (changed.length === 0) {
      console.error(`No change against ${base.slice(0, 12)}. Leave the agent's change in the working tree, or pass --base <the commit before it>.`);
      return 1;
    }
    const behind = Number(git(root, "rev-list", "--count", `${base}..HEAD`).stdout.trim() || 0);
    if (givenBase === undefined && behind >= 2)
      console.log(`Note: the base is ${behind} commits behind HEAD, so the change read is everything since ${base.slice(0, 12)} (${changed.length} files). If only the last of them are the agent's, stop and pass --base <the commit before its change>.`);
    let pkg = givenPackage ?? null;
    if (pkg === null) {
      const found = packageOf(changed, (path) => existsSync(join(root, path)));
      if (found.none) {
        console.error(`The change touches no source file (${changed.slice(0, 5).join(", ")}${changed.length > 5 ? ", ..." : ""}). Nothing here to judge.`);
        return 2;
      }
      if (found.spans) {
        console.error(`The change spans packages (${found.spans.join(", ")}): out of scope for a hidden suite. Pass --package <dir> to judge one of them.`);
        return listOnly({ slug, out, ticketPath, root, base, options, givenTicket });
      }
      pkg = found.pkg;
    }
    const seam = givenSeam ?? seamOf(changed, pkg);
    if (seam.length === 0) {
      console.error(`No changed source file in ${pkg} outside the tests. Pass --seam <file>[,<file>].`);
      return 2;
    }
    record = { checkout: root, branch, base, package: pkg, seam, seamGiven: givenSeam !== undefined, changed, at: new Date().toISOString() };
    console.log(`base ${base.slice(0, 12)}, package ${pkg}, seam ${seam.join(", ")}`);
  }

  // 3. Point the slug at the package.
  if (!existsSync(join(out, "toolchain.json"))) {
    const status = step("repo.mjs", [slug, "--repo", record.checkout, "--package", record.package, "--seam", record.seam.join(","), "--base", record.base]);
    if (status === 2) return listOnly({ slug, out, ticketPath, root, base: record.base, options, givenTicket });
    if (status !== 0) return status;
  }
  writeJson(recordPath, record);

  // 4. The ticket.
  if (!existsSync(ticketPath)) {
    if (typeof options.from === "string") {
      const status = step("confirm.mjs", [slug, "--from", options.from]);
      if (status !== 0) return status;
    } else if (givenTicket !== undefined) {
      writeFileSync(ticketPath, givenTicket);
    } else {
      console.error(`No ticket. Pass --from <issue url | owner/repo#n | JIRA-KEY>, or --ticket <file> with the request in the person's words.`);
      return 1;
    }
    record.ticket = { ...(typeof options.from === "string" ? { from: options.from } : {}), ...(existsSync(ticketPath) ? { sha256: sha256(readFileSync(ticketPath, "utf8")) } : {}) };
    writeJson(recordPath, record);
  }

  // The change may have moved since this check read it.
  const specPath = join(out, "spec.md");
  const idPath = join(RUNS, slug, "id.json");
  const changedNow = changedFiles(record.checkout, record.base);
  const drift = record.seamGiven ? [] : seamDrift(record, changedNow);
  if (drift.length > 0)
    console.log(`Note: changed since this check started and outside its seam: ${drift.join(", ")}. The judge reports them as outside the allowed paths; bouncer check --new starts a check that includes them.`);
  const moved = staleness({
    listedSha256: readJson(idPath, null)?.diffSha256,
    nowSha256: sha256(diffOf(record.checkout, record.base).diff),
    confirmed: confirmation(slug).ok,
    draftIntact: !existsSync(specPath) || (typeof record.draftSha256 === "string" && sha256(readFileSync(specPath, "utf8")) === record.draftSha256),
  });
  const again = `bouncer id ${slug} --repo ${record.checkout} --base ${String(record.base).slice(0, 12)}`;
  if (moved === "redo") console.log("The change moved since the list was read: reading the list and drafting spec.md again.");
  if (moved === "edited") console.log(`Note: the change moved since the list was read, and spec.md was edited after it was drafted, so neither is redone. ${again} reads the list again.`);
  if (moved === "confirmed") console.log(`Note: the change moved since the list was read and the spec confirmed. It is judged as it is now; what it picked since is not on the list (${again}).`);

  // 5. The ID check, on the working tree against base.
  if (!existsSync(idPath) || moved === "redo") {
    const status = step("id.mjs", [slug, "--repo", record.checkout, "--base", record.base]);
    if (status !== 0) return status;
  }

  // 6. spec.md from the ticket and the list.
  if (!existsSync(specPath) || moved === "redo") {
    await draftSpec(slug, out, capDiff(diffOf(record.checkout, record.base).diff).diff);
    record.draftSha256 = sha256(readFileSync(specPath, "utf8"));
    writeJson(recordPath, record);
  }

  // 7. The person confirms.
  const confirmed = confirmation(slug);
  if (!confirmed.ok) {
    say("unconfirmed", { options });
    // The listing starts the person's clock (bin/confirm.mjs). Printed here, so
    // the decisions a session puts to the person are the ones --by checks an
    // answer against: in the 2026-11-20 after-the-fact gate a session asked
    // from the ID list alone, listed only after the answer, and --by refused.
    step("confirm.mjs", [slug]);
    console.log(
      [
        `${slug}: ${confirmed.reason}.`,
        `Above: what the ticket never said and what the agent picked, then spec.md's Decided: items, which make each pick a rule. The person's clock started with that listing.`,
        `Keeping every pick makes the hidden tests say what the code already does: the verdict is independent where the ticket states a rule and where the person changes a pick.`,
        `1. Put each decision to the person now: keep the agent's pick or take the other; edit ${specPath} with their answers`,
        `2. bouncer confirm ${slug} --by "<name>"   only after the person said yes to the spec as it stands`,
        `3. bouncer check${typeof options.slug === "string" ? ` --slug ${slug}` : ""}                prepares the suites (about $1-7 of Opus, 10-25 minutes) and judges`,
      ].join("\n"),
    );
    return 3;
  }

  // 8. Prepare and judge the working tree.
  const prepared = step("prepare.mjs", [slug, ...(options["accept-open"] !== undefined ? ["--accept-open"] : [])]);
  if (prepared !== 0) return prepared;
  return step("judge.mjs", [slug, "--repo", record.checkout, "--audit", ...(typeof options.card === "string" ? ["--card", resolve(options.card)] : [])]);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(await main());
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
