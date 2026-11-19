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
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PROMPTS, RUNS, args, log, session, sha256, specDir, workdir, writeJson, discard } from "./lib.mjs";
import { say } from "./voice.mjs";

export const ID_MODEL = "claude-sonnet-5-5";

/** The items of a session's answer: the last ```json block, checked; null when there is none. */
export function itemsOf(text) {
  const blocks = [...String(text ?? "").matchAll(/```json\s*([\s\S]*?)```/g)];
  const raw = blocks.length > 0 ? blocks.at(-1)[1] : String(text ?? "").trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
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

/** The working tree's change in `checkout` against `base`, untracked files included. */
export function diffOf(checkout, base = "HEAD") {
  const git = (...argv) => spawnSync("git", ["-C", checkout, ...argv], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const tracked = git("diff", base, "--no-color", "--no-ext-diff");
  if (tracked.status !== 0) throw new Error(`${checkout}: git diff ${base} failed: ${tracked.stderr.trim()}`);
  const untracked = git("ls-files", "--others", "--exclude-standard").stdout.split("\n").filter(Boolean);
  const added = untracked
    .map((path) => {
      const file = join(checkout, path);
      const text = readFileSync(file, "utf8");
      if (text.includes("\u0000")) return "";
      const lines = text.split("\n");
      return `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join("\n")}\n`;
    })
    .join("");
  return tracked.stdout + added;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const { options, rest } = args();
  const [slug] = rest;
  const ticketFile = typeof options.ticket === "string" ? resolve(options.ticket) : slug ? join(specDir(slug), "ticket.md") : null;
  if (ticketFile === null || !existsSync(ticketFile)) {
    console.error("usage: node bin/id.mjs [<slug>] [--ticket <file>] [--diff <file> | --repo [<checkout>] [--base <ref>]] [--model <id>] [--json]\nNo ticket: pass --ticket <file>, or a slug whose specs/<slug>/ticket.md exists.");
    process.exit(1);
  }
  let diff;
  try {
    diff =
      typeof options.diff === "string"
        ? readFileSync(resolve(options.diff), "utf8")
        : diffOf(resolve(typeof options.repo === "string" ? options.repo : "."), typeof options.base === "string" ? options.base : "HEAD");
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  if (diff.trim() === "") {
    console.error("No change to check: the diff is empty.");
    process.exit(1);
  }
  const dir = workdir(`id-${slug ?? "ticket"}`);
  let result;
  try {
    writeFileSync(join(dir, "ticket.md"), readFileSync(ticketFile, "utf8"));
    writeFileSync(join(dir, "diff.patch"), diff);
    const transcript = join(RUNS, slug ?? "_id", "id", `${sha256(diff).slice(0, 16)}.jsonl`);
    log("id: reading the ticket and the diff");
    result = await session({ cwd: dir, text: readFileSync(join(PROMPTS, "id.md"), "utf8"), transcript, kind: "generate", model: typeof options.model === "string" ? options.model : ID_MODEL });
  } finally {
    discard(dir);
  }
  const items = itemsOf(result.finalText);
  if (items === null) {
    console.error(`id: the session gave no list (${result.subtype ?? "no result"}${result.apiError ? `, ${result.apiError}` : ""}).`);
    process.exit(1);
  }
  if (slug) writeJson(join(RUNS, slug, "id.json"), { at: new Date().toISOString(), ticket: ticketFile, diffSha256: sha256(diff), costUsd: result.costUsd ?? null, items });
  if (options.json !== undefined) console.log(JSON.stringify(items, null, 2));
  else {
    say("id", { options });
    console.log(render(items));
  }
}
