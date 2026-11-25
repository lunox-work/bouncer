// What Bouncer remembers, on this machine and nowhere else (PRIVACY.md: no
// telemetry): when he last drew his whole figure, and a tally of the
// verdicts `bouncer judge` gave here. Both live under BOUNCER_HOME
// (default ~/.bouncer/): `.seen` and `tally.jsonl`. Every read and write
// is best effort: a home that cannot be written costs his memory, never a
// verdict.
//
// Not lib.mjs's HOME: lib.mjs creates folders and copies the bundled specs
// on import, and the voice is imported where none of that is wanted. The
// rule is the same: BOUNCER_HOME, else ~/.bouncer/, else a ~/.duediligence/
// from before the rename.

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** The person's Bouncer folder, read from `env` each call. */
export function homeDir(env = process.env) {
  if (env.BOUNCER_HOME) return resolve(env.BOUNCER_HOME);
  const home = join(homedir(), ".bouncer");
  const before = join(homedir(), ".duediligence");
  return !existsSync(home) && existsSync(before) ? before : home;
}

/** How long the whole figure stays drawn: after it, his mark only. */
export const FIGURE_EVERY_MS = 30 * 60 * 1000;

/**
 * Whether the whole figure is due (not drawn in the last 30 minutes), and
 * whether this is the first time he has been seen on this machine at all.
 * `mark` records it as drawn now.
 */
export function seen({ home = homeDir(), now = Date.now(), mark = true } = {}) {
  const path = join(home, ".seen");
  let last = null;
  try {
    last = statSync(path).mtimeMs;
  } catch {
    last = null;
  }
  const due = last === null || now - last >= FIGURE_EVERY_MS;
  if (mark && due) {
    try {
      mkdirSync(home, { recursive: true });
      writeFileSync(path, `${new Date(now).toISOString()}\n`);
    } catch {
      // No memory of it: he draws the figure again next time.
    }
  }
  return { due, first: last === null };
}

/** A verdict at this door, appended to tally.jsonl: { at, slug, verdict, keys }. */
export function tally({ slug, verdict, keys = [] }, { home = homeDir(), now = Date.now() } = {}) {
  try {
    mkdirSync(home, { recursive: true });
    appendFileSync(join(home, "tally.jsonl"), `${JSON.stringify({ at: new Date(now).toISOString(), slug, verdict, keys })}\n`);
  } catch {
    // Not kept: the verdict stands without it.
  }
}

/** Every verdict tallied on this machine, oldest first. */
export function tallied({ home = homeDir() } = {}) {
  let text = "";
  try {
    text = readFileSync(join(home, "tally.jsonl"), "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const entry = JSON.parse(line);
        return typeof entry?.verdict === "string" ? [entry] : [];
      } catch {
        return [];
      }
    });
}

/**
 * The tally as counts: in, turned away, and the scenario kind he turned
 * work away on most (a key's kind is its prefix: `boundary-2` is
 * `boundary`), with how many keys of that kind; null when none failed.
 * Only an overfit's keys count: they are the rules the code missed, where
 * an incomplete's are every scenario a stub fails.
 */
export function summary(entries) {
  const counted = { in: 0, out: 0, total: entries.length, kind: null, kindCount: 0 };
  const kinds = new Map();
  for (const entry of entries) {
    if (entry.verdict === "passed") counted.in += 1;
    else counted.out += 1;
    if (entry.verdict !== "overfit") continue;
    for (const key of entry.keys ?? []) {
      const kind = String(key).replace(/-\d+$/, "");
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    }
  }
  for (const [kind, count] of kinds)
    if (count > counted.kindCount) [counted.kind, counted.kindCount] = [kind, count];
  return counted;
}

/** The tally in one line, for a person; null under `min` verdicts, where a record says nothing yet. */
export function tallyLine(counted, { min = 3 } = {}) {
  if (counted.total < min) return null;
  const away = `${counted.out} turned away`;
  const most = counted.kind === null ? "" : `; most turned away on ${counted.kind}`;
  return `At this door so far: ${counted.in} in, ${away}${most}.`;
}
