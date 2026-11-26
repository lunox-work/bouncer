#!/usr/bin/env node
// Check on done: a Claude Code Stop hook. When a session that changed code
// hands the turn back, it holds the stop once and has the agent check the
// work with Bouncer. The hook itself runs nothing, reads only the session's
// transcripts on this machine and sends nothing anywhere; what it hands the
// agent depends on the mode:
//
// - "auto" (the default): run `bouncer id` now, unasked, and show the person
//   the list. About $0.06 and 12 seconds of the person's model account.
// - "ask": ask the person one question first (id, check or not now).
//
// The mode is BOUNCER_OFFER (auto, ask or off), else BOUNCER_HOME/offer/mode
// (`bouncer offer auto|ask`), else auto.
//
// When it fires, at most once per turn (`stop_hook_active`):
// - The first time in a session: code changed and the last message claims
//   the work is done, or hands the turn back without asking a question. So a
//   session that changes code gets at least one offer.
// - Again: only after a large change since the last offer (LARGE_FILES new
//   code files or LARGE_LINES changed lines), on the same terms.
// - Never: once Bouncer ran after the last edit, in a headless run (`claude
//   -p`, the Agent SDK) nobody attends, or when turned off.
//
// The plugin bouncer-verify runs it from hooks/hooks.json. Without the plugin,
// `bouncer offer on` copies it under BOUNCER_HOME and adds it to Claude Code's
// user settings (the skill does that on its first use). Off: `bouncer offer
// off` (BOUNCER_HOME/offer/off), or BOUNCER_OFFER=off. Self-contained on purpose: the plugin carries hooks/
// and skills/, not the CLI. The claim patterns are bin/door-rules.mjs's
// (test/offer.mjs holds the two to the same answers).

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const LARGE_FILES = Number(process.env.BOUNCER_OFFER_LARGE_FILES) || 4;
export const LARGE_LINES = Number(process.env.BOUNCER_OFFER_LARGE_LINES) || 200;
/** What Bouncer can check: TypeScript, JavaScript, Python, Go, Rust. */
const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py|go|rs)$/i;
const EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
/** Headless entry points: `claude -p` and the Agent SDK. The desktop app, the CLI and the IDEs are attended. */
const HEADLESS = /^(sdk-|mcp$)/;
const KEEP_DAYS = 30;

// --- what the final message claims (bin/door-rules.mjs, copied) -------------
const NEGATED =
  /\b(not|n't|no|never|without|yet to|unable to|fails? to|cannot|can't|couldn't|remains? to be|still|before|until|unless|once|when|whether|if|rather than|instead of)\s+(\w+\s+){0,3}$/i;
const TESTS_PASS = [
  /\b(tests?|specs?|suites?|test suites?)\s+(now\s+|all\s+|still\s+)?(pass(es|ed|ing)?|are passing|are green|green|succeed(s|ed)?|ran clean|run clean)\b/i,
  /\b(all|every|both)\s+(\d+\s+)?(\w+\s+)?(tests?|specs?|suites?)\b[^.\n]{0,30}\b(pass(es|ed|ing)?|green)\b/i,
  /\b\d+\s*(\/\s*\d+\s*)?(\w+\s+)?(tests?|specs?)\s+(pass(es|ed|ing)?|green)\b/i,
  /\b(tests?|specs?|suites?)\b[^.\n]{0,20}\bpass(es|ed|ing)?\s*[:(]?\s*\d+\s*(\/|of)\s*\d+/i,
  /\b(passing|green|passes)\s+(\w+\s+)?(tests?|suites?|CI)\b/i,
  /\b(CI|build and tests?|typecheck and tests?)\s+(is\s+|are\s+)?(green|passing|passes)\b/i,
  /\b0\s+fail(ures|ed|ing)?\b/i,
];
const DONE = [
  /\b(done|complete[ds]?|finished|implemented|ready( for review| to (merge|ship|go|use))?|fixed|shipped|all set|works now|working now|now works|resolved|landed|merged|committed|pushed|deployed|in place|wrapped up)\b/i,
];
const unnegatedMatch = (text, rules) =>
  rules.some((rule) => {
    const global = new RegExp(rule.source, rule.flags.includes("g") ? rule.flags : `${rule.flags}g`);
    for (const match of text.matchAll(global))
      if (!NEGATED.test(text.slice(Math.max(0, match.index - 40), match.index))) return true;
    return false;
  });
/** What a final message claims: `testsPass` implies `done`. */
export function claimsOf(text) {
  const testsPass = unnegatedMatch(text, TESTS_PASS);
  return { testsPass, done: testsPass || unnegatedMatch(text, DONE) };
}
/** The message hands the turn back with a question: its last line asks one. */
export const asks = (text) => /\?\s*[)*_"'`]*\s*$/.test(text.trim().split("\n").filter((line) => line.trim()).pop() ?? "");

// --- the session ------------------------------------------------------------
const lineCount = (text) => (typeof text === "string" && text.length > 0 ? text.split("\n").length : 0);
function changedLines(name, input) {
  if (name === "Write") return lineCount(input.content);
  if (name === "Edit") return Math.max(lineCount(input.old_string), lineCount(input.new_string));
  if (name === "MultiEdit") return (input.edits ?? []).reduce((sum, edit) => sum + Math.max(lineCount(edit.old_string), lineCount(edit.new_string)), 0);
  if (name === "NotebookEdit") return lineCount(input.new_source);
  return 0;
}
const isBouncer = (name, input) =>
  (name === "Bash" && /(^|[\s;&|/])(bouncer|duediligence)(@[\w.-]+)?(\.mjs)?\s/.test(`${input.command ?? ""} `)) ||
  (name === "Skill" && /(^|:)bouncer$/.test(input.skill ?? ""));

function entries(text) {
  const out = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // a partial last line while the session is still writing
    }
  }
  return out;
}

/**
 * Code edits in a session (its own transcript, then its subagents'), and
 * what the main thread said and ran: `{ files, lines, edits, bouncerAfter, last }`.
 */
export function digest(main, subagents = []) {
  const files = new Set();
  let lines = 0;
  let edits = 0;
  let bouncerAfter = false;
  let last = "";
  const tally = (block) => {
    const input = block.input ?? {};
    const file = input.file_path ?? input.notebook_path;
    if (EDITS.has(block.name) && typeof file === "string" && CODE.test(file)) {
      files.add(file);
      lines += changedLines(block.name, input);
      edits++;
      return true;
    }
    return false;
  };
  for (const entry of entries(main)) {
    const content = entry.message?.content;
    const sidechain = entry.isSidechain === true;
    if (entry.type === "user" && !sidechain && (typeof content === "string" || content?.some?.((c) => c.type === "text"))) last = "";
    if (entry.type !== "assistant" || !Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === "text" && !sidechain) last += `\n${block.text}`;
      if (block.type !== "tool_use") continue;
      if (tally(block)) bouncerAfter = false;
      else if (isBouncer(block.name, block.input ?? {})) bouncerAfter = true;
    }
  }
  for (const text of subagents)
    for (const entry of entries(text))
      if (entry.type === "assistant" && Array.isArray(entry.message?.content))
        for (const block of entry.message.content) if (block.type === "tool_use" && tally(block)) bouncerAfter = false;
  return { files: [...files], lines, edits, bouncerAfter, last: last.trim() };
}

/**
 * Whether to offer now. `seen` is what this session was offered at (null
 * before its first offer); returns `{ offer, large, files, lines }` with the
 * change since then.
 */
export function decide(session, said, seen) {
  if (session.edits === 0 || session.bouncerAfter) return { offer: false };
  if (seen && session.edits <= seen.edits) return { offer: false };
  const before = new Set(seen?.files ?? []);
  const files = session.files.filter((file) => !before.has(file));
  const lines = session.lines - (seen?.lines ?? 0);
  const large = files.length >= LARGE_FILES || lines >= LARGE_LINES;
  const handedBack = claimsOf(said).done || !asks(said);
  const offer = handedBack && (seen === null || large);
  return { offer, large, files: seen === null ? session.files : files, lines };
}

/** The modes: run the ID check unasked, or ask first. */
export const MODES = ["auto", "ask"];

/** The mode in force: BOUNCER_OFFER, else BOUNCER_HOME/offer/mode, else auto; "off" when either says so. */
export function modeOf(env, home) {
  const given = String(env.BOUNCER_OFFER ?? "").trim().toLowerCase();
  if (/^(off|0|false|no)$/.test(given)) return "off";
  if (MODES.includes(given)) return given;
  let saved = "";
  try {
    saved = readFileSync(join(home, "offer", "mode"), "utf8").trim().toLowerCase();
  } catch {
    // never set: the default
  }
  return MODES.includes(saved) ? saved : "auto";
}

/** The text the agent is handed: what to run or ask, and how. Facts only, no voice. */
export function reasonFor({ large, files, lines }, mode = "auto") {
  const names = files.map((file) => file.split(/[\\/]/).pop());
  const shown = names.slice(0, 4).join(", ") + (names.length > 4 ? ` and ${names.length - 4} more` : "");
  const size = `${files.length} code file${files.length === 1 ? "" : "s"}, about ${lines} changed line${lines === 1 ? "" : "s"}`;
  if (mode === "auto")
    return [
      `bouncer-verify, check on done: this session changed ${size} (${shown})${large ? ", a large change" : ""}.`,
      "Your last message has reached the person. Now run Bouncer's ID check on this change, without asking first: the person turned it on to run whenever you hand back code.",
      "- Run `bouncer id --ticket - --voice` in the checkout, the way the bouncer skill runs the CLI (else `npx -y @lunox-work/bouncer id --ticket - --voice`), with their request on stdin: what they asked you for, quoted as they wrote it, follow-ups included. Never your summary of what you built.",
      "- When it prints him at the club's door (a block of text art: his figure in a door frame), show that block unchanged in a code block first. Then his `Bouncer:` lines word for word, then the list as printed, all of it. Questions, not bugs: never rank them or say which pick is wrong.",
      `- Then stop. Mention once that a verdict from tests you never saw is \`bouncer check\`, about $1–7 and 10–25 minutes, and run it only if they ask.${large ? " Worth it for a change this size." : ""}`,
      "If the work is outside what Bouncer checks (rendered UI, network calls, a change across packages, a language other than TypeScript, Python, Go or Rust), say so in one line instead of running it.",
      "To be asked first next time: `bouncer offer ask`. To stop these checks: `bouncer offer off`.",
    ].join("\n");
  return [
    `bouncer-verify, offer on done: this session changed ${size} (${shown})${large ? ", a large change" : ""}.`,
    "Your last message has reached the person. Now ask them one question, nothing else: whether to check this work with Bouncer, tests you never saw.",
    "- `bouncer id`: what their request never said and what you picked for them, as questions to keep or change. About $0.06 and 12 seconds.",
    `- \`bouncer check\`: a verdict (passed, overfit, incomplete...) from a hidden suite written from a spec they confirm. About $1–7 and 10–25 minutes.${large ? " Worth it for a change this size." : ""}`,
    "- Not now.",
    "Use AskUserQuestion where you have it. Run nothing until they answer; on a yes, follow the bouncer skill.",
    "If the work is outside what Bouncer checks (rendered UI, network calls, a change across packages, a language other than TypeScript, Python, Go or Rust), say so in the question.",
    "If they want no more of these offers, run `bouncer offer off`.",
  ].join("\n");
}

// --- the hook ---------------------------------------------------------------
function bouncerHome(env) {
  if (env.BOUNCER_HOME) return env.BOUNCER_HOME;
  const home = join(homedir(), ".bouncer");
  const before = join(homedir(), ".duediligence");
  return !existsSync(home) && existsSync(before) ? before : home;
}

/** The plugin is on in Claude Code's user settings (then a settings copy of this hook stands down). */
function pluginEnabled(env) {
  try {
    const settings = JSON.parse(readFileSync(join(env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "settings.json"), "utf8"));
    return Object.entries(settings.enabledPlugins ?? {}).some(([id, on]) => on === true && id.startsWith("bouncer-verify@"));
  } catch {
    return false;
  }
}

function subagentTranscripts(transcript) {
  const dir = join(transcript.replace(/\.jsonl$/, ""), "subagents");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => {
      try {
        return readFileSync(join(dir, name), "utf8");
      } catch {
        return "";
      }
    });
}

/** Runs the hook on its stdin: prints `{ decision: "block", reason }` to offer, nothing otherwise. */
export function hook(input, env = process.env) {
  if (input.stop_hook_active) return null;
  const home = bouncerHome(env);
  const mode = modeOf(env, home);
  if (mode === "off") return null;
  if (env.CLAUDE_CODE_SESSION_ATTENDED !== "1" && HEADLESS.test(env.CLAUDE_CODE_ENTRYPOINT ?? "")) return null;
  if (!env.CLAUDE_PLUGIN_ROOT && pluginEnabled(env)) return null;
  if (existsSync(join(home, "offer", "off"))) return null;
  const transcript = input.transcript_path;
  if (typeof transcript !== "string" || !existsSync(transcript)) return null;

  const session = digest(readFileSync(transcript, "utf8"), subagentTranscripts(transcript));
  const said = typeof input.last_assistant_message === "string" && input.last_assistant_message.trim() ? input.last_assistant_message : session.last;
  const statePath = join(home, "offer", "sessions.json");
  let state = {};
  try {
    state = JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    // first offer on this machine
  }
  const key = input.session_id ?? transcript;
  const seen = state[key] ?? null;
  const verdict = decide(session, said, seen);
  if (!verdict.offer) return null;

  const now = Date.now();
  for (const [id, item] of Object.entries(state)) if (now - (item.at ?? 0) > KEEP_DAYS * 86_400_000) delete state[id];
  state[key] = { at: now, offers: (seen?.offers ?? 0) + 1, mode, edits: session.edits, lines: session.lines, files: session.files };
  try {
    mkdirSync(join(home, "offer"), { recursive: true });
    writeFileSync(statePath, JSON.stringify(state));
  } catch {
    return null; // without a record it would offer on every turn
  }
  return { decision: "block", reason: reasonFor(verdict, mode) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const out = hook(JSON.parse(readFileSync(0, "utf8")));
    if (out) process.stdout.write(JSON.stringify(out));
  } catch {
    // a hook that fails must never stop the session
  }
}
