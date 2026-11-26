#!/usr/bin/env node
// The ID check: what the ticket never said, and what the agent picked. One
// read-only session (prompts/id.md) is given the ticket and the agent's
// diff, nothing else, and lists the open questions the diff answers. The
// list is questions for the person, never "bugs found": a 2026-10-28 check
// on 105 stored runs found the decision that failed a hidden suite in the
// list for 59 of 61 rejected runs, at about ten items a run, and the
// model's own risk ranking was no better than chance, so nothing is ranked.
// The person's keep or change for each item becomes a `Decided:` line in
// spec.md (`Ticket:` and `Instead:` come with it), which is step 2's
// confirmation.
//
//   node bin/id.mjs [<slug>] [--ticket <file>|- | --from <issue>] [--diff <file> | --repo [<checkout>] [--base <ref>]] [--model <id>] [--json]
//
// The ticket: --ticket (a file, or - for stdin: the request in the person's
// words), --from (a GitHub issue URL, owner/repo#n or a Jira key, as
// bin/confirm.mjs --from reads one), else specs/<slug>/ticket.md. The diff:
// --diff, else the change in --repo (default the current folder) against
// --base. With no --base it is the change `bouncer check` would read: the
// working tree against HEAD, or against the fork from the default branch
// when HEAD is past it, which is then said. Writes runs/<slug>/id.json when
// a slug is given. With none, the ticket and the list are kept under
// runs/_id/lists/ by the diff's hash, so a `bouncer check` of the same
// change goes on from them instead of asking and listing again. Exit 0 with
// a list (maybe empty), 1 when the session gave no list.

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PROMPTS, RUNS, args, log, readJson, session, sha256, specDir, workdir, writeJson, discard } from "./lib.mjs";
import { LONG_LIST, say } from "./voice.mjs";

export const ID_MODEL = "claude-sonnet-5-5";

/**
 * The JSON a session ends with: the last ```json block, read to the answer's
 * final fence rather than the first one after it, since an item may quote a
 * fence (a markdown or gherkin parser's diff does: all 12 gherkin-parse
 * lists were lost to that, evidence/id-blind.mjs); else the outermost array
 * or object in the text. undefined when nothing parses.
 */
export function lastJsonBlock(text) {
  const all = String(text ?? "");
  const tries = [];
  const open = all.lastIndexOf("```json");
  if (open !== -1) {
    const body = all.slice(open + "```json".length);
    const close = body.lastIndexOf("```");
    tries.push(close === -1 ? body : body.slice(0, close));
    for (const match of all.matchAll(/```json\s*([\s\S]*?)```/g)) tries.push(match[1]);
  }
  for (const [first, last] of [["[", "]"], ["{", "}"]]) {
    const from = all.indexOf(first);
    const to = all.lastIndexOf(last);
    if (from !== -1 && to > from) tries.push(all.slice(from, to + 1));
  }
  tries.push(all.trim());
  for (const raw of tries) {
    try {
      return JSON.parse(raw);
    } catch {}
  }
  return undefined;
}

/** Twelve items at most, as prompts/id.md asks. */
export const MAX_ITEMS = 12;

/** One item as the list holds it, or null when it lacks a question or a pick. */
export function itemOf(item) {
  if (!item || typeof item.question !== "string" || typeof item.chose !== "string") return null;
  return {
    question: item.question.trim(),
    ticket: typeof item.ticket === "string" && item.ticket.trim() !== "" ? item.ticket.trim() : "silent",
    chose: item.chose.trim(),
    where: typeof item.where === "string" ? item.where.trim() : "",
    instead: typeof item.instead === "string" ? item.instead.trim() : "",
  };
}

/** The items of a session's answer: the last ```json block, checked; null when there is none. */
export function itemsOf(text) {
  const parsed = lastJsonBlock(text);
  if (!Array.isArray(parsed)) return null;
  return parsed.map(itemOf).filter(Boolean).slice(0, MAX_ITEMS);
}

/**
 * A feed for the answer's text as the model writes it: `onItem(item, n)` is
 * called for each item of the ```json array the moment its object closes,
 * so a person sees the first pick seconds in instead of the whole list at
 * the end. Only the array after the first ```json fence is read (prose
 * before it is not); an object that does not parse or lacks a question is
 * skipped. What `itemsOf` reads from the final text stays the list of
 * record: the caller compares the two.
 */
export function itemFeed(onItem) {
  let text = "";
  let at = -1; // where scanning resumes; -1 until the fence is seen
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;
  let done = false;
  let count = 0;
  return (chunk) => {
    if (done) return;
    text += chunk;
    if (at === -1) {
      const fence = text.indexOf("```json");
      if (fence === -1) return;
      at = fence + "```json".length;
    }
    for (; at < text.length && !done; at++) {
      const c = text[at];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = depth > 0;
      else if (c === "[" || c === "{") {
        if (depth === 1 && c === "{") start = at;
        depth += 1;
      } else if (c === "]" || c === "}") {
        depth -= 1;
        if (depth === 1 && c === "}" && start !== -1) {
          let item = null;
          try {
            item = itemOf(JSON.parse(text.slice(start, at + 1)));
          } catch {}
          start = -1;
          if (item !== null && count < MAX_ITEMS) onItem(item, ++count);
        } else if (depth <= 0) done = true;
      } else if (c === "`" && depth === 0) done = true;
    }
  };
}

/**
 * A `where` as the file's own line. prompts/id.md asks for "the line in the
 * diff", and the session counts lines of diff.patch: on a real pull request
 * `src/slug.js:22` was the 22nd line of the diff, the file's line 5. A line
 * inside one of `path`'s hunks becomes its line in the new file (a removed
 * line, where it stood); anything else (another file's section, a header, past
 * the end, no line) is left as written. `a:12-15` maps both ends.
 */
export function fileLine(diff, where) {
  const match = /^(.+?):(\d+)(?:-(\d+))?$/.exec(where ?? "");
  if (!match || typeof diff !== "string") return where ?? "";
  const lines = diff.split("\n");
  const at = (n) => {
    if (n < 1 || n > lines.length) return null;
    let line = null;
    let file = null;
    for (let i = 0; i < n; i++) {
      const text = lines[i];
      if (text.startsWith("diff --git ")) [file, line] = [null, null];
      else if (text.startsWith("+++ ") && line === null) file = text.slice(4).replace(/^b\//, "");
      else if (text.startsWith("@@")) {
        const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
        line = hunk ? Number(hunk[1]) : null;
        if (i === n - 1) return null;
      } else if (line !== null && i < n - 1 && !text.startsWith("-") && !text.startsWith("\\")) line += 1;
    }
    const text = lines[n - 1];
    if (line === null || file === null || text.startsWith("diff --git ") || text.startsWith("\\")) return null;
    const named = match[1].replace(/^b\//, "");
    if (!(file === named || file.endsWith(`/${named}`) || named.endsWith(`/${file}`))) return null;
    return line;
  };
  const from = at(Number(match[2]));
  if (from === null) return where;
  if (match[3] === undefined) return `${match[1]}:${from}`;
  const to = at(Number(match[3]));
  return to === null || to < from ? `${match[1]}:${from}` : `${match[1]}:${from}-${to}`;
}

/** What follows the list when the answers go into a spec (a slug, or under `bouncer check`). */
const INTO_SPEC = "Keep or change each one; the answers go into spec.md as Decided: lines.";
/** What follows it on its own, with no spec yet. */
export const ON_ITS_OWN = "Questions, not bugs. Any pick you'd change, your agent isn't done with.";

/** One item of the list as a person reads it, numbered `n`. */
export function renderItem(item, n) {
  const said = item.ticket === "silent" ? "ticket: silent" : `ticket: "${item.ticket}"`;
  return [`${n}. ${item.question}`, `   picked: ${item.chose}${item.where ? ` (${item.where})` : ""}`, `   ${said}`, ...(item.instead ? [`   instead: ${item.instead}`] : [])].join("\n");
}

const things = (n) => `${n} thing${n === 1 ? "" : "s"}`;

/** The list as a person reads it; `closing` is the line after it. */
export function render(items, closing = INTO_SPEC) {
  if (items.length === 0) return "Your ticket left nothing open that this change answers.";
  const head = `${things(items.length)} your ticket never said. Your agent picked for you:`;
  return [head, "", ...items.map((item, i) => renderItem(item, i + 1)), "", closing].join("\n");
}

/** The head of a list printed as it arrives, before its count is known. */
export const LIVE_HEAD = "What your ticket never said, and what your agent picked for you:";
/** The line after a list printed as it arrived: its count, then `closing`. */
export const liveTail = (count, closing = INTO_SPEC) =>
  count === 0 ? "Your ticket left nothing open that this change answers." : `${things(count)} in all. ${closing}`;

const git = (checkout, ...argv) => spawnSync("git", ["-C", checkout, ...argv], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

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

const listPath = (diffSha256) => join(RUNS, "_id", "lists", `${diffSha256.slice(0, 16)}.json`);

/**
 * The ticket and the list a slugless `bouncer id` read for the change whose
 * diff hashes to `diffSha256`, or null: { at, ticket, ticketSha256, from,
 * diffSha256, costUsd, items }. `bouncer check` goes on from it, so the
 * person is not asked for the ticket twice nor shown a second, different list.
 */
export function savedList(diffSha256) {
  const found = readJson(listPath(diffSha256), null);
  return found !== null && found.diffSha256 === diffSha256 && Array.isArray(found.items) && typeof found.ticket === "string" ? found : null;
}

/** A new file larger than this is named in the diff, not quoted. */
export const NEW_FILE_BYTES = 256 * 1024;
/** The diff a session is given is cut here: past it the list would cost more than it tells. */
export const DIFF_BYTES = 600 * 1024;

/**
 * The working tree's change in `checkout` against `base`, untracked files
 * included (binary ones and those over NEW_FILE_BYTES by name only), cut at
 * DIFF_BYTES. Returns { diff, left: what was named or cut, for the person }.
 */
export function diffOf(checkout, base = "HEAD") {
  const tracked = git(checkout, "diff", base, "--no-color", "--no-ext-diff");
  if (tracked.status !== 0) throw new Error(`${checkout}: git diff ${base} failed: ${(tracked.stderr ?? "").trim() || tracked.error?.message}`);
  const left = [];
  const added = git(checkout, "ls-files", "--others", "--exclude-standard")
    .stdout.split("\n")
    .filter(Boolean)
    .map((path) => {
      // `ls-files --others` also names what is not a file: a nested clone or a
      // git worktree as `dir/`, a symlink by its own path. Reading one as a
      // file threw EISDIR and ended the check (0.8.6). A link is shown as git
      // shows one, its target as its content; any other non-file is not part
      // of the change.
      const file = join(checkout, path.replace(/\/+$/, ""));
      const entry = lstatSync(file, { throwIfNoEntry: false });
      if (entry === undefined) return "";
      if (entry.isSymbolicLink()) return `diff --git a/${path} b/${path}\nnew file mode 120000\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1 @@\n+${readlinkSync(file)}\n\\ No newline at end of file\n`;
      if (!entry.isFile()) return "";
      const { size } = entry;
      const text = size > NEW_FILE_BYTES ? null : readFileSync(file, "utf8");
      if (text === null || text.includes("\u0000")) {
        left.push(`${path} (new, ${text === null ? "large" : "binary"}: named only)`);
        return `diff --git a/${path} b/${path}\nnew file mode 100644\n(${size} bytes, not shown)\n`;
      }
      const lines = text.split("\n");
      return `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join("\n")}\n`;
    })
    .join("");
  const capped = capDiff(tracked.stdout + added);
  return { diff: capped.diff, left: [...left, ...capped.left] };
}

/** A diff cut at DIFF_BYTES: { diff, left: what was cut, for the person }. */
export function capDiff(diff) {
  if (Buffer.byteLength(diff) <= DIFF_BYTES) return { diff, left: [] };
  return { diff: `${Buffer.from(diff).subarray(0, DIFF_BYTES).toString("utf8")}\n(diff cut here)\n`, left: [`the diff past its first ${DIFF_BYTES / 1024} KiB`] };
}

/**
 * The prompt is one command-line argument: past this many bytes the two
 * files stay on disk for the session to open (Linux caps one argument at
 * 128 KiB, Windows a whole command line at 32,767 characters).
 */
export const INLINE_BYTES = process.platform === "win32" ? 24_000 : 100_000;
const READ_LINE = "Read both files. Do not run anything and do not change any file.";
const INLINE_LINE = "Both files are below in full, the diff with its line numbers as `where` takes them: there is nothing to open. Do not run anything and do not change any file.";

/** A diff as Claude Code's Read tool shows it: each line after its number and a tab. */
export const numbered = (text) =>
  text
    .split("\n")
    .map((line, i) => `${String(i + 1).padStart(6)}\t${line}`)
    .join("\n");

/**
 * The ID prompt with the ticket and the diff in it, so the session answers
 * in one turn instead of first opening the two files (two of an 18 s
 * session's three turns). The diff is numbered as the Read tool numbers it,
 * since `where` counts its lines and `fileLine` maps them. Returns the
 * plain prompt, the files left to be read, when the result would pass
 * INLINE_BYTES or prompts/id.md no longer says to read them.
 */
export function promptFor(prompt, ticket, diff) {
  if (!prompt.includes(READ_LINE)) return prompt;
  const text = [prompt.replace(READ_LINE, INLINE_LINE).trimEnd(), "", "## ticket.md", "", ticket.trimEnd(), "", "## diff.patch", "", numbered(diff), ""].join("\n");
  return Buffer.byteLength(text) > INLINE_BYTES ? prompt : text;
}

/**
 * One ID session (prompts/id.md) over a ticket and a diff, in a scratch
 * folder that holds nothing else. `items` is null when the session gave no
 * list. `name` labels the scratch folder; the transcript goes under `slug`.
 * `onItem(item, n)`, when given, gets each item as the session writes it
 * (`itemFeed`; on the claude CLI only), its `where` already the file's line.
 */
export async function listOf({ ticket, diff, model = ID_MODEL, name = "ticket", slug = null, onItem = null }) {
  const dir = workdir(`id-${name}`);
  let result;
  try {
    writeFileSync(join(dir, "ticket.md"), ticket);
    writeFileSync(join(dir, "diff.patch"), diff);
    const transcript = join(RUNS, slug ?? "_id", "id", `${sha256(diff).slice(0, 16)}.jsonl`);
    const text = promptFor(readFileSync(join(PROMPTS, "id.md"), "utf8"), ticket, diff);
    const onText = onItem === null ? undefined : itemFeed((item, n) => onItem({ ...item, where: fileLine(diff, item.where) }, n));
    result = await session({ cwd: dir, text, transcript, kind: "generate", model, onText });
  } finally {
    discard(dir);
  }
  const items = itemsOf(result.finalText)?.map((item) => ({ ...item, where: fileLine(diff, item.where) })) ?? null;
  return { items, costUsd: result.costUsd ?? null, subtype: result.subtype ?? null, apiError: result.apiError ?? null, durationMs: result.durationMs ?? null };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { options, rest } = args();
  const [slug] = rest;
  const usage = "usage: bouncer id [<slug>] [--ticket <file>|- | --from <issue>] [--diff <file> | --repo [<checkout>] [--base <ref>]] [--model <id>] [--json]";
  let ticket;
  let ticketFile = null;
  try {
    if (typeof options.from === "string") ticket = await (await import("./confirm.mjs")).ticketFrom(options.from, options);
    else if (options.ticket === "-") ticket = readFileSync(0, "utf8");
    else {
      ticketFile = typeof options.ticket === "string" ? resolve(options.ticket) : slug ? join(specDir(slug), "ticket.md") : null;
      if (ticketFile === null || !existsSync(ticketFile)) {
        console.error(`${usage}\nNo ticket: pass --ticket <file>, --ticket - with the request on stdin, --from <issue>, or a slug whose specs/<slug>/ticket.md exists.`);
        process.exit(1);
      }
      ticket = readFileSync(ticketFile, "utf8");
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  if (ticket.trim() === "") {
    console.error("The ticket is empty: pass the request in the person's words.");
    process.exit(1);
  }
  let diff;
  let checkout = null;
  let base = null;
  try {
    if (typeof options.diff === "string") diff = readFileSync(resolve(options.diff), "utf8");
    else {
      const given = resolve(typeof options.repo === "string" ? options.repo : ".");
      const top = git(given, "rev-parse", "--show-toplevel");
      if (top.status !== 0) throw new Error(`${given} is not a git checkout. Run bouncer id inside the repository the agent changed, or pass --repo or --diff.`);
      checkout = top.stdout.trim();
      base = baseOf(checkout, typeof options.base === "string" ? options.base : undefined);
      const behind = Number(git(checkout, "rev-list", "--count", `${base}..HEAD`).stdout.trim() || 0);
      // Said, since on a shared branch those commits may not all be the agent's.
      if (typeof options.base !== "string" && behind >= 1) console.error(`id: reading everything since ${base.slice(0, 12)} (${behind} commit${behind === 1 ? "" : "s"} and the working tree). --base <ref> reads less.`);
      const found = diffOf(checkout, base);
      diff = found.diff;
      if (found.left.length > 0) console.error(`id: not read: ${found.left.join("; ")}.`);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  if (diff.trim() === "") {
    console.error(base === null ? "No change to check: the diff is empty." : `No change to check: nothing differs from ${base.slice(0, 12)}. Leave the agent's change in the working tree, or pass --base <the commit before it>.`);
    process.exit(1);
  }
  log("id: reading the ticket and the diff");
  // A person at a terminal sees each pick as it is written; a script or an
  // agent's Bash gets the whole list at the end, in the shape it always had.
  const alone = !slug && !process.env.BOUNCER_UNDER_CHECK;
  const closing = alone ? ON_ITS_OWN : INTO_SPEC;
  const live = options.json === undefined && process.stdout.isTTY === true;
  const shown = [];
  if (live) say("id", { options });
  const onItem = live
    ? (item, n) => {
        if (n === 1) console.log(`${LIVE_HEAD}\n`);
        shown.push(item);
        console.log(renderItem(item, n));
      }
    : null;
  const result = await listOf({ ticket, diff, model: typeof options.model === "string" ? options.model : ID_MODEL, name: slug ?? "ticket", slug, onItem });
  const { items } = result;
  if (items === null) {
    console.error(`id: the session gave no list (${result.subtype ?? "no result"}${result.apiError ? `, ${result.apiError}` : ""}).`);
    process.exit(1);
  }
  const at = new Date().toISOString();
  const from = typeof options.from === "string" ? options.from : undefined;
  if (slug) writeJson(join(RUNS, slug, "id.json"), { at, ticket: ticketFile ?? from ?? "stdin", diffSha256: sha256(diff), costUsd: result.costUsd, items });
  else writeJson(listPath(sha256(diff)), { at, ticket, ticketSha256: sha256(ticket), ...(from ? { from } : {}), diffSha256: sha256(diff), costUsd: result.costUsd, items });
  const aside = items.length >= LONG_LIST ? "long-list" : items.length === 0 ? "empty-list" : null;
  if (options.json !== undefined) console.log(JSON.stringify(items, null, 2));
  else {
    if (live) {
      // Printed as it came; the final answer is the list of record, so a
      // stream that missed or misread an item is followed by the whole list.
      if (JSON.stringify(shown) === JSON.stringify(items)) console.log(`\n${liveTail(items.length, closing)}`);
      else console.log(`${shown.length > 0 ? "\nThe list as it was settled:\n\n" : ""}${render(items, closing)}`);
      // Beside the list, its size: the count is the check behind it.
      if (aside !== null) say(aside, { options });
    } else {
      // Beside his line, the list's size: the count is the check behind it.
      say("id", { options, aside });
      // On its own there is no spec yet: say what the list is, and what a verdict would take.
      console.log(render(items, closing));
    }
    if (alone && checkout !== null) say("cover-charge", { options });
    if (alone && checkout !== null) console.log("For a verdict from tests it never saw: bouncer check. It keeps this ticket and list; about $1-7 of Opus and 10-25 minutes once you confirm.");
  }
}
