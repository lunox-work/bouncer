#!/usr/bin/env node
// Offer on done (hooks/offer-on-done.mjs): when a Claude Code session that
// changed code hands the turn back, the agent asks whether to check the work
// with Bouncer. The bouncer-verify plugin turns it on by itself; installed
// another way (the skills CLI, a copied skill folder), `on` adds it to Claude
// Code's user settings.
//
//   node bin/offer.mjs [status | on | off] [--settings <file>]
//
//   status             whether it is on, and through what (the default)
//   on                 through the plugin when it is enabled, else a copy of
//                      the hook under BOUNCER_HOME/offer/ run from a Stop hook
//                      in the user settings
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

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "..", "hooks", "offer-on-done.mjs");
const DIR = join(HOME, "offer");
const FLAG = join(DIR, "off");
const COPY = join(DIR, "offer-on-done.mjs");
const MARK = "offer-on-done.mjs";

const USAGE = "usage: bouncer offer [status | on | off] [--settings <file>]";
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

const settings = readSettings();
if (command === "status") {
  const off = existsSync(FLAG);
  const through = pluginOn(settings) ? "the bouncer-verify plugin" : settingsHook(settings) ? `a Stop hook in ${SETTINGS}` : null;
  if (off) console.log(`off (${FLAG})${through ? `; ${through} stays installed and stands down` : ""}`);
  else if (through) console.log(`on, through ${through}`);
  else console.log("off: not installed. `bouncer offer on` adds it.");
} else if (command === "on") {
  rmSync(FLAG, { force: true });
  if (pluginOn(settings)) {
    if (settingsHook(settings)) write(withoutOurs(settings)); // the plugin's hook is the one that runs
    console.log("on, through the bouncer-verify plugin");
  } else {
    mkdirSync(DIR, { recursive: true });
    copyFileSync(HOOK, COPY);
    const next = withoutOurs(settings);
    const hooks = next.hooks ?? {};
    hooks.Stop = [...(hooks.Stop ?? []), { hooks: [{ type: "command", command: `node "${COPY.replace(/\\/g, "/")}"`, timeout: 10 }] }];
    write({ ...next, hooks });
    console.log(`on: a Stop hook in ${SETTINGS} runs ${COPY}. It takes effect in new Claude Code sessions. Off: bouncer offer off`);
  }
} else if (command === "off") {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FLAG, "Offer on done is off: `bouncer offer on` turns it back on.\n");
  if (settingsHook(settings)) write(withoutOurs(settings));
  console.log(`off${pluginOn(settings) ? " (the bouncer-verify plugin's hook stands down)" : ""}. On again: bouncer offer on`);
} else {
  console.error(USAGE);
  process.exit(1);
}
