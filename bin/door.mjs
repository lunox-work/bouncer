#!/usr/bin/env node
// The door: what an agent's finished session shows before any spec, with no
// model. It reads the session's transcript (bin/door-rules.mjs) and, in a
// TypeScript checkout with carveout installed, `carveout gate --json`, and
// lists what is worth a look before anyone trusts "done": no test run after
// the last edit, tests skipped, weakened or deleted, the last test run red,
// only tests the agent wrote, a TODO left in code, harness or config edited.
//
// It reports and never turns work away. Measured on 127 finished sessions
// in real repositories, no rule fired on 10% of those that claimed done, and
// a model-judged check of 50 firings upheld 1 (evidence/DOOR.md). So the
// findings are questions for the person, printed without his voice; his
// line comes only with a clean door, which points at the real check.
//
//   node bin/door.mjs [--transcript <file>] [--repo [<checkout>]] [--no-gate] [--json]
//
// The transcript: --transcript, else the newest Claude Code transcript for
// the checkout's folder (default the current one). Exit 0 always; --json
// prints { transcript, claimsDone, findings, gate }.

import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { addClaudeCodeEvent, doorRules } from "./door-rules.mjs";
import { linesOf } from "./lines.mjs";
import { args, newestTranscript } from "./lib.mjs";
import { say } from "./voice.mjs";

/** What each finding asks the person to look at. */
export const ASK = {
  "never-queued": "It says the tests pass, but no test command ran after its last code edit.",
  "crossed-off": "A test was skipped, lost assertions, or was deleted.",
  "last-run-red": "It says the tests pass, but the last test command it ran failed.",
  "homemade-id": "Every test it ran is one it wrote itself in this session.",
  "left-a-note": "It added a TODO, FIXME or \"not implemented\" in code.",
  clipboard: "It edited harness or config: test scripts, a lockfile, tsconfig, test-runner config or CI.",
};

/** The session in `transcript` as door-rules events, read line by line. */
export function sessionOf(transcript) {
  const session = [];
  for (const raw of linesOf(transcript)) {
    if (raw === "") continue;
    try {
      addClaudeCodeEvent(session, JSON.parse(raw));
    } catch {
      // A partial last line while the session is still writing.
    }
  }
  return session;
}

/** `carveout gate --json` in `checkout` when carveout is installed and the checkout is TypeScript; null otherwise. */
export function gateOf(checkout) {
  if (!existsSync(join(checkout, "tsconfig.json")) && !existsSync(join(checkout, "package.json"))) return null;
  const version = spawnSync("carveout", ["--version"], { encoding: "utf8" });
  if (version.status !== 0) return null;
  const run = spawnSync("carveout", ["gate", "--json"], { cwd: checkout, encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
  try {
    const gate = JSON.parse(run.stdout);
    return { version: version.stdout.trim(), refused: Array.isArray(gate.refused) ? gate.refused : [] };
  } catch {
    return null;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { options } = args();
  const checkout = resolve(typeof options.repo === "string" ? options.repo : ".");
  const transcript = typeof options.transcript === "string" ? resolve(options.transcript) : newestTranscript(checkout);
  const session = transcript !== null && existsSync(transcript) ? sessionOf(transcript) : null;
  const fired = session === null ? [] : doorRules(session);
  const claimsDone = fired.some((item) => item.rule === "claims-done");
  const findings = fired.filter((item) => item.rule !== "claims-done").map((item) => ({ rule: item.rule, ask: ASK[item.rule] ?? item.reason, evidence: typeof item.evidence === "string" ? item.evidence.replace(/\s*\n\s*/g, "; ").replace(/\s+/g, " ").slice(0, 160) : "" }));
  const gate = options["no-gate"] === true ? null : gateOf(checkout);

  if (options.json !== undefined) {
    console.log(JSON.stringify({ transcript, claimsDone, findings, gate }, null, 2));
    process.exit(0);
  }
  if (session === null) console.log(`No agent session found for ${checkout}; pass --transcript <file>.`);
  else {
    // The newest session may be one from a parent folder about other work: say which was read.
    if (typeof options.transcript !== "string") console.error(`door: read ${transcript}`);
    const holds = gate?.refused ?? [];
    if (findings.length === 0 && holds.length === 0) {
      say("door-clean", { options });
      console.log("Nothing obvious at the door. That says nothing about whether the code does what the ticket meant: bouncer id, then the list.");
    } else {
      console.log(`Worth a look before you trust "done" (not a verdict; these rules are often wrong, evidence/DOOR.md):`);
      for (const item of findings) console.log(`- ${item.ask}${item.evidence ? `\n  ${item.evidence}` : ""}`);
      if (holds.length > 0) {
        console.log(`carveout gate ${gate.version}, ${holds.length} file(s) for a reviewer's eye:`);
        for (const hold of holds) console.log(`- ${hold.path}: ${hold.reason}`);
      }
    }
    if (!claimsDone && session !== null) console.log("(Its last message does not claim the work is done.)");
  }
  process.exit(0);
}
