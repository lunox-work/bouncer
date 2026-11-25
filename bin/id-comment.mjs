#!/usr/bin/env node
// The ID check on a pull request: `bouncer id` over the pull request's
// linked issue and its diff, posted as ONE comment that is edited in place
// on every push (found again by a hidden marker). It is the always-on
// surface the door could not be (evidence/DOOR.md), and it keeps the ID
// check's shape: questions for the person, unranked, never findings.
//
// It never changes a check. It calls no check-run or status endpoint, and it
// exits 0 whatever happens (no ticket, no list, a read-only token on a fork's
// pull request), so the job that runs it cannot go red; --strict turns
// failures into exit 1 for a caller who wants that.
//
//   node bin/id-comment.mjs [--pr <n>] [--issue <n>] [--ticket <file>] [--diff <file>]
//                           [--items <file.json>] [--model <id>] [--dry-run] [--strict]
//
// In a GitHub Actions job on `pull_request` it needs no flags: the pull
// request comes from $GITHUB_EVENT_PATH, the repository from
// $GITHUB_REPOSITORY, the token from BOUNCER_GITHUB_TOKEN or GITHUB_TOKEN
// (`pull-requests: write`, `issues: read`), the API from $GITHUB_API_URL.
//
// - The ticket: --ticket, else --issue, else the issues the pull request's
//   description closes ("Fixes #12", same repository, three at most), else
//   the pull request's own title and description, and the comment says so.
// - The diff: --diff, else the pull request's diff from the API, cut at
//   DIFF_BYTES like `bouncer id`.
// - The list: one session (bin/id.mjs `listOf`), or --items for a list made
//   elsewhere. --dry-run prints the comment and posts nothing.
//
// The ticket and the diff are other people's text, and the list is a model's
// reading of them, so only the list's own fields reach the comment, each cut
// to one short line with mentions, issue references, links and HTML made
// inert (`inert`). Nothing is posted when the list is empty and no comment
// exists yet; an existing comment is updated to say nothing is open.

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { capDiff, itemsOf } from "./id.mjs";
import { LINES } from "./voice.mjs";

/** What finds the comment again on the next push. */
export const MARKER = "<!-- bouncer:id -->";
/** A ticket longer than this is cut: the session reads one ticket, not a thread. */
export const TICKET_BYTES = 64 * 1024;

/**
 * Text from a ticket, a diff or a model as one line that does nothing when
 * GitHub renders it: no mention notifies anyone, no `#12` back-links an
 * issue, no link, image or HTML (so no second marker). Backticks stay: a
 * question reads better with its identifiers as code.
 */
export function inert(text, max = 300) {
  const line = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const cut = line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
  return cut
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([[\]])/g, "\\$1")
    .replace(/@(?=\w)/g, "@​")
    .replace(/#(?=\d)/g, "#​");
}

/** Text for a code span, where nothing is rendered: one line, no backticks. */
const code = (text, max = 120) =>
  String(text ?? "")
    .replace(/[\s`]+/g, " ")
    .trim()
    .slice(0, max);

/** The same-repository issues a pull request's description closes, in order, without repeats. */
export function closingIssues(body, repository) {
  const found = [];
  const pattern = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b\s*:?\s+(?:#(\d+)|https?:\/\/[^\s/]+\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)|([\w.-]+\/[\w.-]+)#(\d+))/gi;
  for (const match of String(body ?? "").matchAll(pattern)) {
    const [, local, urlRepo, urlNumber, namedRepo, namedNumber] = match;
    const number = local ?? (urlRepo?.toLowerCase() === repository.toLowerCase() ? urlNumber : namedRepo?.toLowerCase() === repository.toLowerCase() ? namedNumber : null);
    if (number && !found.includes(Number(number))) found.push(Number(number));
  }
  return found;
}

/**
 * The comment. `source` is what was read as the ticket: { issues: [n, ...] },
 * { pull: n } (no linked issue) or { file: true }.
 */
export function renderComment({ items, source = {}, sha = "", left = [], voice = true }) {
  const read = source.issues?.length > 0 ? source.issues.map((n) => `#${n}`).join(", ") : source.pull ? "this pull request's description" : "the ticket";
  const head = voice ? [`### ${LINES.id}`, ""] : [];
  const foot = [
    "bouncer id",
    ...(sha ? [`\`${String(sha).slice(0, 7)}\``] : []),
    `read ${read} and this pull request's diff`,
    ...(source.pull ? ['no linked issue: write "Fixes" and the issue\'s number in the description to have it read instead'] : []),
    ...(left.length > 0 ? [`not read: ${left.map((part) => inert(part, 120)).join("; ")}`] : []),
    "edited in place on each push",
  ].join(" · ");
  if (items.length === 0) return [MARKER, ...head, `Nothing ${read} left open that this change answers.`, "", `<sub>${foot}</sub>`, ""].join("\n");
  const list = items.flatMap((item, i) => [
    `${i + 1}. **${inert(item.question)}**`,
    `   - picked: ${inert(item.chose)}${code(item.where) ? ` (\`${code(item.where)}\`)` : ""}`,
    `   - ticket: ${item.ticket === "silent" ? "silent" : `"${inert(item.ticket)}"`}`,
    ...(item.instead ? [`   - instead: ${inert(item.instead)}`] : []),
  ]);
  return [
    MARKER,
    ...head,
    `**${items.length} thing${items.length === 1 ? "" : "s"} ${read} never said.** This change picked for you:`,
    "",
    ...list,
    "",
    "Questions to confirm, in no order. Not a verdict, and nothing here fails a check: keep or change each one, in a reply or in the ticket.",
    "",
    `<sub>${foot}</sub>`,
    "",
  ].join("\n");
}

/** What to do with `body`, given the pull request's comments (oldest first): create, update one, or nothing. */
export function planUpsert(comments, body, { quietWhenEmpty = false } = {}) {
  const mine = comments.find((comment) => typeof comment.body === "string" && comment.body.includes(MARKER));
  if (mine === undefined) return quietWhenEmpty ? { action: "none", why: "nothing open and no comment yet" } : { action: "create" };
  if (mine.body.trim() === body.trim()) return { action: "none", id: mine.id, why: "the comment already says this" };
  return { action: "update", id: mine.id };
}

/** A GitHub REST client over `fetch`: request(method, path, { body, accept }) → { status, ok, data }. */
export function github({ api = "https://api.github.com", token, fetch: send = fetch }) {
  return async function request(method, path, { body, accept = "application/vnd.github+json" } = {}) {
    const response = await send(`${api.replace(/\/$/, "")}${path}`, {
      method,
      headers: { Accept: accept, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "bouncer-id", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let data = text;
    if (accept.includes("json")) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    return { status: response.status, ok: response.ok, data };
  };
}

/** The pull request's comments, oldest first, ten pages at most. */
async function commentsOf(request, repository, pr) {
  const all = [];
  for (let page = 1; page <= 10; page += 1) {
    const got = await request("GET", `/repos/${repository}/issues/${pr}/comments?per_page=100&page=${page}`);
    if (!got.ok || !Array.isArray(got.data)) throw new Error(`reading the pull request's comments: HTTP ${got.status}`);
    all.push(...got.data);
    if (got.data.length < 100) break;
  }
  return all;
}

const cutTicket = (text) => (Buffer.byteLength(text) > TICKET_BYTES ? `${Buffer.from(text).subarray(0, TICKET_BYTES).toString("utf8")}\n(ticket cut here)\n` : text);

/**
 * The whole step. Everything from outside comes in as an argument, so a test
 * runs it with a mocked GitHub and a stored list: `fetch`, `env`, `options`
 * (the flags), and `list` ({ ticket, diff, model }) → { items | null, ... }.
 * Returns { action: "create" | "update" | "none" | "dry-run", body?, why? };
 * throws with a message for the person when it cannot go on.
 */
export async function idComment({ env = process.env, options = {}, fetch: send = fetch, list }) {
  const event = env.GITHUB_EVENT_PATH && existsSync(env.GITHUB_EVENT_PATH) ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8")) : {};
  const repository = env.GITHUB_REPOSITORY;
  const pr = Number(options.pr ?? event.pull_request?.number ?? event.number);
  const dry = options["dry-run"] !== undefined;
  const offline = dry && typeof options.ticket === "string" && typeof options.diff === "string";
  if (!offline && (!repository || !Number.isInteger(pr) || pr <= 0)) throw new Error("no pull request: run it on a pull_request event, or pass --pr <n> with GITHUB_REPOSITORY set");
  const token = env.BOUNCER_GITHUB_TOKEN || env.GITHUB_TOKEN;
  const request = github({ api: env.GITHUB_API_URL || "https://api.github.com", token, fetch: send });

  let pull = event.pull_request ?? null;
  const pullOf = async () => {
    if (pull === null) {
      const got = await request("GET", `/repos/${repository}/pulls/${pr}`);
      if (!got.ok || got.data === null) throw new Error(`reading pull request ${pr}: HTTP ${got.status}`);
      pull = got.data;
    }
    return pull;
  };

  // The ticket.
  let ticket;
  let source;
  if (typeof options.ticket === "string") {
    ticket = readFileSync(resolve(options.ticket), "utf8");
    source = { file: true };
  } else {
    const numbers = options.issue !== undefined ? [Number(options.issue)] : closingIssues((await pullOf()).body, repository).slice(0, 3);
    const issues = [];
    for (const number of numbers) {
      const got = await request("GET", `/repos/${repository}/issues/${number}`);
      // The issues API also answers for pull requests: one of those is not a ticket.
      if (got.ok && got.data && got.data.pull_request === undefined) issues.push({ number, text: `# ${got.data.title ?? ""}\n\n${got.data.body ?? ""}\n` });
    }
    if (issues.length > 0) {
      ticket = issues.map((issue) => issue.text).join("\n");
      source = { issues: issues.map((issue) => issue.number) };
    } else {
      const own = await pullOf();
      ticket = `# ${own.title ?? ""}\n\n${own.body ?? ""}\n`;
      source = { pull: pr };
    }
  }
  if (ticket.replace(/^#\s*$/m, "").trim() === "") return { action: "none", why: "the ticket is empty" };

  // The diff.
  let raw;
  if (typeof options.diff === "string") raw = readFileSync(resolve(options.diff), "utf8");
  else {
    const got = await request("GET", `/repos/${repository}/pulls/${pr}`, { accept: "application/vnd.github.diff" });
    if (!got.ok || typeof got.data !== "string") throw new Error(`reading pull request ${pr}'s diff: HTTP ${got.status}${got.status === 406 ? " (too large for the API: pass --diff <file>)" : ""}`);
    raw = got.data;
  }
  if (raw.trim() === "") return { action: "none", why: "the diff is empty" };
  const { diff, left } = capDiff(raw);

  // The list.
  const listed = typeof options.items === "string" ? { items: itemsOf(readFileSync(resolve(options.items), "utf8")) } : await list({ ticket: cutTicket(ticket), diff, model: typeof options.model === "string" ? options.model : undefined });
  if (!Array.isArray(listed.items)) throw new Error(`the session gave no list (${listed.subtype ?? "no result"}${listed.apiError ? `, ${listed.apiError}` : ""})`);

  const sha = offline ? "" : (event.pull_request?.head?.sha ?? pull?.head?.sha ?? "");
  const body = renderComment({ items: listed.items, source, sha, left, voice: env.BOUNCER_VOICE !== "0" });
  if (dry) return { action: "dry-run", body };

  const plan = planUpsert(await commentsOf(request, repository, pr), body, { quietWhenEmpty: listed.items.length === 0 });
  if (plan.action === "none") return { ...plan, body };
  const sent = plan.action === "create" ? await request("POST", `/repos/${repository}/issues/${pr}/comments`, { body: { body } }) : await request("PATCH", `/repos/${repository}/issues/comments/${plan.id}`, { body: { body } });
  if (!sent.ok) throw new Error(`posting the comment: HTTP ${sent.status}${sent.status === 403 ? " (the token cannot write: a fork's pull request, or no `pull-requests: write`)" : ""}`);
  return { action: plan.action, id: sent.data?.id ?? plan.id, body };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { args } = await import("./lib.mjs");
  const { options } = args();
  if (options.help !== undefined) {
    console.error("usage: bouncer id-comment [--pr <n>] [--issue <n>] [--ticket <file>] [--diff <file>] [--items <file.json>] [--model <id>] [--dry-run] [--strict]");
    process.exit(0);
  }
  try {
    const { listOf } = await import("./id.mjs");
    const done = await idComment({ options, list: ({ ticket, diff, model }) => listOf({ ticket, diff, model, name: "comment" }) });
    if (done.action === "dry-run") console.log(done.body);
    else console.error(`id-comment: ${done.action === "none" ? `nothing posted (${done.why})` : `comment ${done.action}d`}`);
  } catch (error) {
    // A warning, never a red job: this step may not change a check.
    const said = process.env.GITHUB_ACTIONS && /^No agent to run sessions on/.test(error.message)
      ? "No secret to run on. Add CLAUDE_CODE_OAUTH_TOKEN (your Claude subscription, from `claude setup-token`) or ANTHROPIC_API_KEY as a repository secret and pass it to this workflow: `bouncer ci init` does both."
      : error.message;
    console.error(process.env.GITHUB_ACTIONS ? `::warning title=bouncer id::${String(said).replace(/\r?\n/g, " ")}` : `id-comment: ${said}`);
    process.exit(options.strict !== undefined ? 1 : 0);
  }
}
