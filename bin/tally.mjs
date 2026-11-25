#!/usr/bin/env node
// The verdicts `bouncer judge` gave on this machine (bin/regulars.mjs): how
// many got in, how many he turned away, and the scenario kind he turned
// work away on most. Kept in BOUNCER_HOME/tally.jsonl and read nowhere
// else; a seal's judgement (CI) is not tallied.
//
//   node bin/tally.mjs [--last <n>] [--json]
//
// --last lists the newest n verdicts (default 10, 0 for none).

import { args } from "./lib.mjs";
import { homeDir, summary, tallied, tallyLine } from "./regulars.mjs";

const { options } = args();
const entries = tallied();
const counted = summary(entries);
if (options.json !== undefined) {
  console.log(JSON.stringify({ ...counted, entries }, null, 2));
  process.exit(0);
}
if (entries.length === 0) {
  console.log(`Nobody at the door yet: no verdict judged on this machine (${homeDir()}/tally.jsonl).`);
  process.exit(0);
}
const line = tallyLine(counted, { min: 1 });
console.log(line);
const last = Number(options.last ?? 10);
if (Number.isFinite(last) && last > 0) {
  console.log("");
  for (const entry of entries.slice(-last).reverse())
    console.log(`${String(entry.at).slice(0, 16).replace("T", " ")}  ${entry.verdict.padEnd(10)}  ${entry.slug}${entry.keys?.length > 0 ? `  ${entry.keys.join(", ")}` : ""}`);
}
