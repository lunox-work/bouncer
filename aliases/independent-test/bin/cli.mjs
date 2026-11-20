#!/usr/bin/env node
// `independent-test` was renamed to `duediligence` and then to `bouncer`; this runs bouncer
// with the same arguments and exit codes. INDEPENDENT_TESTS_* and DUEDILIGENCE_* still
// work (a BOUNCER_* value set alongside wins, then DUEDILIGENCE_*), and a data folder
// from before the renames stays in use: bouncer itself keeps an existing
// ~/.duediligence/, and ~/.independent-tests/ is handed to it here.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

for (const prefix of ["DUEDILIGENCE_", "INDEPENDENT_TESTS_"]) {
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith(prefix)) continue;
    const name = `BOUNCER_${key.slice(prefix.length)}`;
    if (process.env[name] === undefined) process.env[name] = value;
  }
}
const before = join(homedir(), ".independent-tests");
const later = [".bouncer", ".duediligence"].some((dir) =>
  existsSync(join(homedir(), dir)),
);
if (process.env.BOUNCER_HOME === undefined && existsSync(before) && !later)
  process.env.BOUNCER_HOME = before;
await import("@lunox-work/bouncer");
