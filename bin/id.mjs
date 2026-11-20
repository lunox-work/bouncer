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
//   node bin/id.mjs [<slug>] [--ticket <file>] [--diff <file> | --repo [<checkout>] [--base <ref>]] [--model <id>] [--json]
//
// The ticket: --ticket, else specs/<slug>/ticket.md. The diff: --diff, else
// `git diff <base>` of --repo (default the current folder; base HEAD, so the
// working tree's change) plus its untracked files. Writes
// runs/<slug>/id.json when a slug is given. Exit 0 with a list (maybe
// empty), 1 when the session gave no list.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PROMPTS, RUNS, args, log, session, sha256, specDir, workdir, writeJson, discard } from "./lib.mjs";
import { say } from "./voice.mjs";

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

/** The items of a session's answer: the last ```json block, checked; null when there is none. */
export function itemsOf(text) {
  const parsed = lastJsonBlock(text);
  if (!Array.isArray(parsed)) return null;
  return parsed
    .filter((item) => item && typeof item.question === "string" && typeof item.chose === "string")
    .slice(0, 12)
    .map((item) => ({
      question: item.question.trim(),
      ticket: typeof item.ticket === "string" && item.ticket.trim() !== "" ? item.ticket.trim() : "silent",
      chose: item.chose.trim(),
      where: typeof item.where === "string" ? item.where.trim() : "",
      instead: typeof item.instead === "string" ? item.instead.trim() : "",
    }));
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

/** The list as a person reads it. */
export function render(items) {
  if (items.length === 0) return "Your ticket left nothing open that this change answers.";
  const head = `${items.length} thing${items.length === 1 ? "" : "s"} your ticket never said. Your agent picked for you:`;
  const lines = items.map((item, i) => {
    const said = item.ticket === "silent" ? "ticket: silent" : `ticket: "${item.ticket}"`;
    return [`${i + 1}. ${item.question}`, `   picked: ${item.chose}${item.where ? ` (${item.where})` : ""}`, `   ${said}`, ...(item.instead ? [`   instead: ${item.instead}`] : [])].join("\n");
  });
  return [head, "", ...lines, "", "Keep or change each one; the answers go into spec.md as Decided: lines."].join("\n");
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
  const git = (...argv) => spawnSync("git", ["-C", checkout, ...argv], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const tracked = git("diff", base, "--no-color", "--no-ext-diff");
  if (tracked.status !== 0) throw new Error(`${checkout}: git diff ${base} failed: ${(tracked.stderr ?? "").trim() || tracked.error?.message}`);
  const left = [];
  const added = git("ls-files", "--others", "--exclude-standard")
    .stdout.split("\n")
    .filter(Boolean)
    .map((path) => {
      const file = join(checkout, path);
      const size = statSync(file, { throwIfNoEntry: false })?.size;
      if (size === undefined) return "";
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
 * One ID session (prompts/id.md) over a ticket and a diff, in a scratch
 * folder that holds nothing else. `items` is null when the session gave no
 * list. `name` labels the scratch folder; the transcript goes under `slug`.
 */
export async function listOf({ ticket, diff, model = ID_MODEL, name = "ticket", slug = null }) {
  const dir = workdir(`id-${name}`);
  let result;
  try {
    writeFileSync(join(dir, "ticket.md"), ticket);
    writeFileSync(join(dir, "diff.patch"), diff);
    const transcript = join(RUNS, slug ?? "_id", "id", `${sha256(diff).slice(0, 16)}.jsonl`);
    result = await session({ cwd: dir, text: readFileSync(join(PROMPTS, "id.md"), "utf8"), transcript, kind: "generate", model });
  } finally {
    discard(dir);
  }
  const items = itemsOf(result.finalText)?.map((item) => ({ ...item, where: fileLine(diff, item.where) })) ?? null;
  return { items, costUsd: result.costUsd ?? null, subtype: result.subtype ?? null, apiError: result.apiError ?? null };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { options, rest } = args();
  const [slug] = rest;
  const ticketFile = typeof options.ticket === "string" ? resolve(options.ticket) : slug ? join(specDir(slug), "ticket.md") : null;
  if (ticketFile === null || !existsSync(ticketFile)) {
    console.error("usage: bouncer id [<slug>] [--ticket <file>] [--diff <file> | --repo [<checkout>] [--base <ref>]] [--model <id>] [--json]\nNo ticket: pass --ticket <file>, or a slug whose specs/<slug>/ticket.md exists.");
    process.exit(1);
  }
  let diff;
  try {
    if (typeof options.diff === "string") diff = readFileSync(resolve(options.diff), "utf8");
    else {
      const found = diffOf(resolve(typeof options.repo === "string" ? options.repo : "."), typeof options.base === "string" ? options.base : "HEAD");
      diff = found.diff;
      if (found.left.length > 0) console.error(`id: not read: ${found.left.join("; ")}.`);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  if (diff.trim() === "") {
    console.error("No change to check: the diff is empty.");
    process.exit(1);
  }
  log("id: reading the ticket and the diff");
  const result = await listOf({ ticket: readFileSync(ticketFile, "utf8"), diff, model: typeof options.model === "string" ? options.model : ID_MODEL, name: slug ?? "ticket", slug });
  const { items } = result;
  if (items === null) {
    console.error(`id: the session gave no list (${result.subtype ?? "no result"}${result.apiError ? `, ${result.apiError}` : ""}).`);
    process.exit(1);
  }
  if (slug) writeJson(join(RUNS, slug, "id.json"), { at: new Date().toISOString(), ticket: ticketFile, diffSha256: sha256(diff), costUsd: result.costUsd, items });
  if (options.json !== undefined) console.log(JSON.stringify(items, null, 2));
  else {
    say("id", { options });
    console.log(render(items));
  }
}
