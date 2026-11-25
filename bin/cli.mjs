#!/usr/bin/env node
// The `bouncer` command: one entry point over the bin scripts,
// which it runs unchanged, in the caller's folder, with their own exit
// codes. The scripts name their next steps as these subcommands
// (`bouncer <command>`). Specs, runs and results live under BOUNCER_HOME
// (default ~/.bouncer/, lib.mjs `HOME`); `where` prints them.
//
//   bouncer <command> [args...] [--voice]
//   bouncer where | help | --version
//
// --voice (anywhere; or BOUNCER_VOICE=1) asks for his lines where no
// terminal is, as `Bouncer: <line>` on stderr for a coding agent to relay
// (bin/voice.mjs); it is taken out before the script sees its arguments.
// BOUNCER_STARTED, the time the outermost command started, times the
// stages of a check.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = dirname(fileURLToPath(import.meta.url));
const COMMANDS = {
  fit: "whether a repository's package can be a target",
  repo: "point a spec at a package: seam, allowed paths, base tree, baseline",
  check: "the agent says it's done: door, fit, the ID check, a drafted spec for the person to confirm, then prepare and judge the working tree",
  door: "what the agent's session shows before any spec, no model: tests skipped or never run, TODOs; reports, never blocks",
  id: "what the ticket never said and what the agent's diff picked: questions to confirm (one session)",
  "id-comment": "the ID check on a pull request: its linked issue and diff, as one comment edited in place; never a check",
  confirm: "a spec's decisions in context; record a confirmation (--by); --from <issue>, --export",
  prepare: "confirmed spec -> skeleton, both suites, calibration (Opus sessions); --hosted builds them on the platform",
  handout: "what an outside agent may see, in a folder of your choice",
  judge: "a src/, or a checkout or commit -> passed | overfit | incomplete | regressed | refused; --card <file.svg>; --platform <submission id>",
  promote: "a passed repository spec's hidden suite into the repository",
  second: "a second hidden suite from another writer, for grading someone else's work; judge then needs both",
  run: "a blind agent session",
  grade: "grade blind runs into results.jsonl",
  retry: "one retry of a blind run, told its failing scenarios",
  seal: "one spec's suites in one file, for a judge that has no specs/ (CI)",
  ci: "judge a commit from a seal and report it as a check; --platform judges it on the hosted platform (OIDC)",
  push: "a confirmed spec as a bounty in the signed-in platform workspace",
  login: "sign in to the Lunox platform (device code in the browser); --org, --platform, --open",
  whoami: "the account, workspace and token expiry signed in with",
  tally: "the verdicts judged on this machine: in, turned away, and on what (local only)",
  logout: "delete the saved platform token",
};
// The method's own measurement tools: `bouncer evidence <name>`, or `bouncer <name>` as before.
const EVIDENCE = {
  referee: "a blind referee of rejected runs' failing tests, on any backend (--backend)",
  "red-team-audit": "red-team passes (run --brief red-team) audited: literals, a second suite, a session",
  "import-archive": "a calibrated spec from the experiment archive, marked not held out",
};

const argv = process.argv.slice(2);
const voice = argv.includes("--voice");
const [command, ...rest] = argv.filter((arg) => arg !== "--voice");
const env = { ...process.env, ...(voice ? { BOUNCER_VOICE: "1" } : {}), BOUNCER_STARTED: process.env.BOUNCER_STARTED || String(Date.now()) };
if (command === "--version" || command === "-v") {
  console.log(JSON.parse(readFileSync(join(BIN, "..", "package.json"), "utf8")).version);
  process.exit(0);
}
if (command === "where") {
  const { HOME, SPECS, RUNS, RESULTS, TEMPLATE, ROOT } = await import("./lib.mjs");
  const before = !process.env.BOUNCER_HOME && basename(HOME) === ".duediligence";
  console.log(JSON.stringify({ home: HOME, specs: SPECS, runs: RUNS, results: RESULTS, template: TEMPLATE, package: ROOT }, null, 2));
  if (before) console.error(`${HOME} is the home from before the rename (0.7.0); it stays the default until ~/.bouncer exists. To move it: mv ${HOME} ${join(dirname(HOME), ".bouncer")}`);
  process.exit(0);
}
let [name, args] = [command, rest];
if (command === "evidence") [name, ...args] = rest;
if (Object.hasOwn(EVIDENCE, name ?? "")) {
  const child = spawnSync(process.execPath, [join(BIN, `${name}.mjs`), ...args], { stdio: "inherit", env });
  if (child.signal) process.kill(process.pid, child.signal);
  process.exit(child.status ?? 1);
}
if (command === "evidence") {
  const width = Math.max(...Object.keys(EVIDENCE).map((key) => key.length));
  console.error(["usage: bouncer evidence <name> [args...]", "", ...Object.entries(EVIDENCE).map(([key, what]) => `  ${key.padEnd(width)}  ${what}`)].join("\n"));
  process.exit(name === undefined ? 0 : 1);
}
if (!Object.hasOwn(COMMANDS, command ?? "")) {
  const width = Math.max(...[...Object.keys(COMMANDS), "where", "evidence"].map((key) => key.length));
  console.error(
    [
      "usage: bouncer <command> [args...]",
      "",
      ...Object.entries(COMMANDS).map(([name, what]) => `  ${name.padEnd(width)}  ${what}`),
      `  ${"where".padEnd(width)}  the folders it reads and writes`,
      `  ${"evidence".padEnd(width)}  the method's measurement tools: ${Object.keys(EVIDENCE).join(", ")}`,
      "",
      "A command that needs arguments prints its own usage when called without them.",
      "Data: BOUNCER_HOME (default ~/.bouncer/).",
      "Platform sign-in (optional; every other command is local): ~/.lunox/credentials (LUNOX_CREDENTIALS),",
      "against https://platform.lunox.work (LUNOX_PLATFORM_URL).",
    ].join("\n"),
  );
  process.exit(command === undefined || command === "help" || command === "--help" ? 0 : 1);
}
// `bouncer <command> --help`: the script's header, its usage and contract. Without
// this, `check --help` ran a check (the 2026-11-20 after-the-fact gate, run 1).
if (rest.includes("--help") || rest.includes("-h")) {
  console.log(helpOf(command));
  process.exit(0);
}
// The first time he is seen on this machine, before the command's own output (bin/voice.mjs `greet`).
const { greet } = await import("./voice.mjs");
greet({ env, options: Object.fromEntries(["json", "plain"].filter((flag) => rest.includes(`--${flag}`) || rest.some((arg) => arg.startsWith(`--${flag}=`))).map((flag) => [flag, true])) });
const child = spawnSync(process.execPath, [join(BIN, `${command}.mjs`), ...rest], { stdio: "inherit", env });
if (child.signal) process.kill(process.pid, child.signal);
process.exit(child.status ?? 1);

/** A script's leading comment block, as help: `node bin/<x>.mjs` shown as `bouncer <x>`. */
function helpOf(name) {
  const lines = readFileSync(join(BIN, `${name}.mjs`), "utf8").split("\n");
  const body = [];
  for (const line of lines.slice(lines[0].startsWith("#!") ? 1 : 0)) {
    if (!line.startsWith("//")) break;
    body.push(line.replace(/^\/\/ ?/, "").replace(/node bin\/([a-z-]+)\.mjs/g, "bouncer $1"));
  }
  return [`bouncer ${name}: ${COMMANDS[name]}`, "", ...body].join("\n").trimEnd();
}
