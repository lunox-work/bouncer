#!/usr/bin/env node
// `duediligence` was renamed to `bouncer`; this runs it with the same arguments
// and exit codes. DUEDILIGENCE_* still work (a BOUNCER_* value set alongside
// wins); bouncer itself keeps an existing ~/.duediligence/ as its data folder.
for (const [key, value] of Object.entries(process.env)) {
  if (!key.startsWith("DUEDILIGENCE_")) continue;
  const name = `BOUNCER_${key.slice("DUEDILIGENCE_".length)}`;
  if (process.env[name] === undefined) process.env[name] = value;
}
await import("@lunox-work/bouncer");
