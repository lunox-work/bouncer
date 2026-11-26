#!/usr/bin/env node
// Check on done (hooks/offer-on-done.mjs): when a Claude Code session that
// changed code hands the turn back, the agent runs Bouncer's ID check
// (mode auto, the default) or asks whether to (mode ask). The bouncer-verify
// plugin turns it on by itself; installed another way (the skills CLI, a
// copied skill folder), `on` adds it to Claude Code's user settings, which
// the skill does on its first use.
//
//   node bin/offer.mjs [status | on | auto | ask | off] [--settings <file>]
//
//   status             whether it is on, in which mode, and through what (the default)
//   on                 through the plugin when it is enabled, else a copy of
//                      the hook under BOUNCER_HOME/offer/ run from a Stop hook
//                      in the user settings; the mode stays as it was
//   auto | ask         on, and the mode: run the ID check unasked, or ask first
//   off                off everywhere: BOUNCER_HOME/offer/off, and the
//                      settings hook removed (the plugin's own hook reads the
//                      flag)
//   --settings <file>  another settings.json (default: settings.json in
//                      $CLAUDE_CONFIG_DIR or ~/.claude)
//
// Exit 0, or 1 when the settings file is not JSON it can safely rewrite.

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HOME } from "./lib.mjs";
import { modeOf } from "../hooks/offer-on-done.mjs";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "..", "hooks", "offer-on-done.mjs");
const DIR = join(HOME, "offer");
const FLAG = join(DIR, "off");
const COPY = join(DIR, "offer-on-done.mjs");
const MODE = join(DIR, "mode");
const MARK = "offer-on-done.mjs";

const USAGE = "usage: bouncer offer [status | on | auto | ask | off] [--settings <file>]";
const argv = process.argv.slice(2);
const at = argv.indexOf("--settings");
if (at >= 0 && !argv[at + 1]) {
  console.error(USAGE);
  process.exit(1);
}
const command = argv.find((arg, i) => !arg.startsWith("--") && !(at >= 0 && i === at + 1)) ?? "status";
const SETTINGS = at >= 0 ? argv[at + 1] : join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "settings.json");

function readSettings() {
  if (!existsSync(SETTINGS)) return {};
  const text = readFileSync(SETTINGS, "utf8");
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // reported below
  }
  console.error(`${SETTINGS}: not a JSON object; left as it is. Fix it, or add the hook by hand (bouncer offer --help).`);
  process.exit(1);
}

const isOurs = (hook) => typeof hook?.command === "string" && hook.command.includes(MARK);
const pluginOn = (settings) => Object.entries(settings.enabledPlugins ?? {}).some(([id, on]) => on === true && id.startsWith("bouncer-verify@"));
const settingsHook = (settings) => (settings.hooks?.Stop ?? []).some((group) => (group.hooks ?? []).some(isOurs));

/** The settings without our Stop hook; groups left empty go too. */
function withoutOurs(settings) {
  const stop = (settings.hooks?.Stop ?? []).map((group) => ({ ...group, hooks: (group.hooks ?? []).filter((hook) => !isOurs(hook)) })).filter((group) => group.hooks.length > 0);
  const hooks = { ...(settings.hooks ?? {}), Stop: stop };
  if (stop.length === 0) delete hooks.Stop;
  const next = { ...settings, hooks };
  if (Object.keys(hooks).length === 0) delete next.hooks;
  return next;
}

function write(settings) {
  mkdirSync(dirname(SETTINGS), { recursive: true });
  writeFileSync(SETTINGS, `${JSON.stringify(settings, null, 2)}\n`);
}

/** What each mode does, as `status` and the switches say it. */
const DOES = {
  auto: "runs the ID check when your agent hands back code (about $0.06 each)",
  ask: "your agent asks whether to check when it hands back code",
};

const settings = readSettings();
if (command === "status") {
  const off = existsSync(FLAG);
  const mode = modeOf(process.env, HOME);
  const through = pluginOn(settings) ? "the bouncer-verify plugin" : settingsHook(settings) ? `a Stop hook in ${SETTINGS}` : null;
  if (off || mode === "off") console.log(`off (${off ? FLAG : "BOUNCER_OFFER"})${through ? `; ${through} stays installed and stands down` : ""}`);
  else if (through) console.log(`on, ${mode}: ${DOES[mode]}. Through ${through}.`);
  else console.log("off: not installed. `bouncer offer on` adds it.");
} else if (command === "on" || command === "auto" || command === "ask") {
  rmSync(FLAG, { force: true });
  if (command !== "on") {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(MODE, `${command}\n`);
  }
  const mode = modeOf(process.env, HOME);
  const what = mode === "off" ? "on, but BOUNCER_OFFER=off in this environment holds it off" : `on, ${mode}: ${DOES[mode]}`;
  if (pluginOn(settings)) {
    if (settingsHook(settings)) write(withoutOurs(settings)); // the plugin's hook is the one that runs
    console.log(`${what}. Through the bouncer-verify plugin.`);
  } else {
    mkdirSync(DIR, { recursive: true });
    copyFileSync(HOOK, COPY);
    const next = withoutOurs(settings);
    const hooks = next.hooks ?? {};
    hooks.Stop = [...(hooks.Stop ?? []), { hooks: [{ type: "command", command: `node "${COPY.replace(/\\/g, "/")}"`, timeout: 10 }] }];
    write({ ...next, hooks });
    console.log(`${what}. A Stop hook in ${SETTINGS} runs ${COPY}; it takes effect in new Claude Code sessions. ${mode === "ask" ? "Unasked instead: bouncer offer auto" : "Asked first instead: bouncer offer ask"}. Off: bouncer offer off`);
  }
} else if (command === "off") {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FLAG, "Check on done is off: `bouncer offer on` turns it back on.\n");
  if (settingsHook(settings)) write(withoutOurs(settings));
  console.log(`off${pluginOn(settings) ? " (the bouncer-verify plugin's hook stands down)" : ""}. On again: bouncer offer on`);
} else {
  console.error(USAGE);
  process.exit(1);
}
