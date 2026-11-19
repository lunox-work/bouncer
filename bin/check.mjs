#!/usr/bin/env node
// After the fact, as one command (skills/bouncer/references/check.md): the
// agent says it's done and the person doubts it. Runs every step that needs
// no person, in order, and stops only where one is needed. Each step is
// skipped when its output exists, so running it again resumes.
//
//   node bin/check.mjs [--repo <checkout>] [--from <issue> | --ticket <file>]
//     [--base <ref>] [--package <dir>] [--seam <file>[,<file>]] [--slug <slug>]
//     [--accept-open] [--card <file.svg>] [--no-door]
//
// 1. The door (bin/door.mjs): a report, never a stop.
// 2. The change: --base, else the merge-base with the default branch when
//    HEAD is past it, else HEAD (the working tree's change). Its package is
//    the nearest folder with a package.json or a pyproject.toml shared by
//    every changed source file; a change spanning packages stops. The seam
//    is the changed source files that are not tests. --package and --seam
//    override.
// 3. bin/repo.mjs points one slug at that package (fit at base); unsupported
//    stops with exit 2.
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
// specs/<slug>/check.json keeps the checkout, base, package and seam, so a
// rerun judges the same change after the agent commits it. The slug is
// --slug, else `check-<folder>-<branch>`.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { confirmation } from "./confirm.mjs";
import { render } from "./id.mjs";
import { ROOT, RUNS, args, discard, log, prompt, readJson, session, specDir, stage, toolchainOf, workdir, writeJson } from "./lib.mjs";
import { say } from "./voice.mjs";

const SOURCE = /\.(?:[cm]?[jt]sx?|py)$/;
const TEST = /(?:^|\/)(?:__tests__|__mocks__|tests?|spec|e2e)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)test_[^/]*\.py$|_test\.py$|(?:^|\/)conftest\.py$/;
const MANIFESTS = ["package.json", "pyproject.toml", "setup.py", "setup.cfg"];

/** A kebab-case slug for a checkout and branch: `check-<folder>-<branch>`, at most 60 characters. */
export function slugFor(folder, branch) {
  const kebab = (text) =>
    String(text ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  return ["check", kebab(folder), kebab(branch)].filter(Boolean).join("-").slice(0, 60).replace(/-+$/, "");
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
  return changed.filter((path) => SOURCE.test(path) && !TEST.test(path) && inside(path)).sort();
}

/** What the drafting session is told beyond prompts/repo/spec-from-ticket.md. */
export const DRAFT_ADDENDUM = `
\`id.md\` lists what an implementation of this ticket already picked for each
open question it met, with the ticket's sentence and the usual alternative.
Make each one a \`Decided:\` item: the pick as the rule, its \`Ticket:\` line as
listed, and the listed alternative as \`Instead:\`. The person keeps or
changes each one before any test is written. Decide any other open question
as above.
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

const step = (script, argv) => spawnSync(process.execPath, [join(ROOT, "bin", script), ...argv], { cwd: ROOT, stdio: "inherit" }).status ?? 1;

async function draftSpec(slug, out) {
  const chain = toolchainOf(slug);
  const listed = readJson(join(RUNS, slug, "id.json"), null);
  const dir = stage(workdir(`${slug}-draft`), slug, { spec: false });
  try {
    writeFileSync(join(dir, "ticket.md"), readFileSync(join(out, "ticket.md"), "utf8"));
    writeFileSync(join(dir, "id.md"), `${render(listed?.items ?? [])}\n`);
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

async function main() {
  const { options } = args();
  const checkout = realpathSync(resolve(typeof options.repo === "string" ? options.repo : "."));
  if (git(checkout, "rev-parse", "--show-toplevel").status !== 0) {
    console.error(`${checkout} is not a git checkout. Run bouncer check inside the repository the agent changed, or pass --repo.`);
    return 1;
  }
  const root = git(checkout, "rev-parse", "--show-toplevel").stdout.trim();
  const branch = git(root, "rev-parse", "--abbrev-ref", "HEAD").stdout.trim();
  const slug = typeof options.slug === "string" ? options.slug : slugFor(basename(root), branch === "HEAD" ? git(root, "rev-parse", "--short", "HEAD").stdout.trim() : branch);
  const out = specDir(slug);
  const recordPath = join(out, "check.json");
  let record = readJson(recordPath, null);
  console.log(`bouncer check: ${slug} (${root})`);

  // 1. The door: a report, never a stop.
  if (options["no-door"] === undefined && record === null) step("door.mjs", ["--repo", root]);

  // 2. The change.
  if (record === null) {
    const base = baseOf(root, typeof options.base === "string" ? options.base : undefined);
    const changed = changedFiles(root, base);
    if (changed.length === 0) {
      console.error(`No change against ${base.slice(0, 12)}. Leave the agent's change in the working tree, or pass --base <the commit before it>.`);
      return 1;
    }
    let pkg = typeof options.package === "string" ? options.package.replace(/\/+$/, "") || "." : null;
    if (pkg === null) {
      const found = packageOf(changed, (path) => existsSync(join(root, path)));
      if (found.none) {
        console.error(`The change touches no source file (${changed.slice(0, 5).join(", ")}${changed.length > 5 ? ", ..." : ""}). Nothing here to judge.`);
        return 2;
      }
      if (found.spans) {
        console.error(`The change spans packages (${found.spans.join(", ")}): out of scope. Pass --package <dir> to judge one of them.`);
        return 2;
      }
      pkg = found.pkg;
    }
    const seam = typeof options.seam === "string" ? options.seam.split(",").map((item) => item.trim()).filter(Boolean) : seamOf(changed, pkg);
    if (seam.length === 0) {
      console.error(`No changed source file in ${pkg} outside the tests. Pass --seam <file>[,<file>].`);
      return 2;
    }
    record = { checkout: root, base, package: pkg, seam, changed, at: new Date().toISOString() };
    console.log(`base ${base.slice(0, 12)}, package ${pkg}, seam ${seam.join(", ")}`);
  }

  // 3. Point the slug at the package.
  if (!existsSync(join(out, "toolchain.json"))) {
    const status = step("repo.mjs", [slug, "--repo", record.checkout, "--package", record.package, "--seam", record.seam.join(","), "--base", record.base]);
    if (status !== 0) return status;
  }
  writeJson(recordPath, record);

  // 4. The ticket.
  if (!existsSync(join(out, "ticket.md"))) {
    if (typeof options.from === "string") {
      const status = step("confirm.mjs", [slug, "--from", options.from]);
      if (status !== 0) return status;
    } else if (typeof options.ticket === "string") {
      writeFileSync(join(out, "ticket.md"), readFileSync(resolve(options.ticket), "utf8"));
    } else {
      console.error(`No ticket. Pass --from <issue url | owner/repo#n | JIRA-KEY>, or --ticket <file> with the request in the person's words.`);
      return 1;
    }
  }

  // 5. The ID check, on the working tree against base.
  if (!existsSync(join(RUNS, slug, "id.json"))) {
    const status = step("id.mjs", [slug, "--repo", record.checkout, "--base", record.base]);
    if (status !== 0) return status;
  }

  // 6. spec.md from the ticket and the list.
  if (!existsSync(join(out, "spec.md"))) await draftSpec(slug, out);

  // 7. The person confirms.
  const confirmed = confirmation(slug);
  if (!confirmed.ok) {
    say("unconfirmed", { options });
    console.log(
      [
        `${slug}: ${confirmed.reason}.`,
        `The list above is what the ticket never said and what the agent picked; spec.md makes each pick a Decided: item.`,
        `1. bouncer confirm ${slug}            lists each decision: keep the agent's pick or take the other, and edit ${join(out, "spec.md")}`,
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
