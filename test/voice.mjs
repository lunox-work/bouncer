// Bouncer's voice (bin/voice.mjs): his line only for a person at a
// terminal, and the judge's piped output unchanged. Pure: no spec, no
// toolchain, no network.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIGURE_EVERY_MS, seen, summary, tallied, tally, tallyLine } from "../bin/regulars.mjs";
import { announce, banner, clock, colorDepth, doorArt, DOOR_TEXT, FIGURE, greet, LINES, lineFor, MARK, say, voiceMode, voiceOn } from "../bin/voice.mjs";

// What he remembers goes to a scratch home, never the person's.
const home = mkdtempSync(join(tmpdir(), "bouncer-voice-"));
process.env.BOUNCER_HOME = home;

const tty = { isTTY: true, out: "", write(text) { this.out += text; } };
const pipe = { isTTY: false, out: "", write(text) { this.out += text; } };
const env = {};

// When a person is reading.
assert.equal(voiceOn({ stream: tty, env }), true);
assert.equal(voiceOn({ stream: pipe, env }), false, "a pipe gets no voice");
assert.equal(voiceOn({ stream: tty, env, options: { plain: true } }), false, "--plain");
assert.equal(voiceOn({ stream: tty, env, options: { json: "out.json" } }), false, "--json");
assert.equal(voiceOn({ stream: tty, env: { NO_COLOR: "1" } }), false, "NO_COLOR");
assert.equal(voiceOn({ stream: tty, env: { CI: "true" } }), false, "CI");
assert.equal(voiceOn({ stream: tty, env: { CI: "false" } }), true, "CI=false is not CI");
assert.equal(voiceOn({ stream: tty, env: { BOUNCER_VOICE: "0" } }), false, "BOUNCER_VOICE=0");
assert.equal(voiceOn({ stream: tty, env, sealed: true }), false, "a seal's output is for CI");
// Asked for without a TTY (a coding agent's shell): one line, on stderr.
assert.equal(voiceMode({ stream: tty, env }), "banner");
assert.equal(voiceMode({ stream: pipe, env }), null, "unasked, a pipe gets nothing");
assert.equal(voiceMode({ stream: pipe, env: { BOUNCER_VOICE: "1" } }), "line", "BOUNCER_VOICE=1");
assert.equal(voiceMode({ stream: pipe, env, options: { voice: true } }), "line", "--voice");
assert.equal(voiceMode({ stream: pipe, env: { BOUNCER_VOICE: "1", CI: "true" } }), "line", "asked for, CI or not");
assert.equal(voiceMode({ stream: tty, env: { BOUNCER_VOICE: "1", NO_COLOR: "1" } }), "line", "NO_COLOR when asked: no banner, still the line");
for (const options of [{ json: "x.json", voice: true }, { plain: true, voice: true }])
  assert.equal(voiceMode({ stream: pipe, env, options }), null, "--json and --plain win over --voice");
assert.equal(voiceMode({ stream: pipe, env: { BOUNCER_VOICE: "1" }, sealed: true }), null, "a seal wins over BOUNCER_VOICE=1");
console.log("ok voiceOn");

// The lines: every verdict judge prints has one; keys only on a first overfit.
for (const verdict of ["passed", "overfit", "incomplete", "regressed", "refused"]) assert.ok(lineFor(verdict), verdict);
assert.deepEqual(lineFor("overfit", { keys: ["boundary-2"] }), { id: "overfit", text: "Not tonight.", keys: ["boundary-2"], tone: "out" });
assert.equal(lineFor("overfit", { retry: true, keys: ["boundary-2"] }).text, "Same shoes.");
assert.deepEqual(lineFor("overfit", { retry: true, keys: ["boundary-2"] }).keys, []);
assert.equal(lineFor("passed", { retry: true }).text, "One fix. You're in.");
assert.equal(lineFor("passed", { aside: "outside-scope" }).text, "You're in. Just you. Not your twelve friends.");
assert.equal(lineFor("passed").tone, "in");
assert.equal(lineFor("no-such-verdict"), null);
for (const [id, text] of Object.entries(LINES)) assert.ok(text.length <= 70, `${id} is short`);
console.log("ok lines");

// The banner: him at the door, his line under it; with counts, the
// counts and the verdict word between (the "Bouncer mascot review" CLI mock).
const plain = banner(lineFor("overfit", { keys: ["boundary-2", "unhappy-1"] }), { color: false });
assert.equal(plain, [...DOOR_TEXT, "", "  Not tonight.  boundary-2, unhappy-1", ""].join("\n"));
assert.ok(!plain.includes("\x1b"), "no escape codes without colour");
const judged = banner(lineFor("overfit", { keys: ["unhappy-1"] }), { color: false, verdict: "overfit", counts: { public: { passed: 22, total: 22 }, hidden: { passed: 38, total: 39 } } });
assert.equal(judged, [...DOOR_TEXT, "", "  public  22/22    hidden  38/39", "  verdict overfit", "", "  Not tonight.  unhappy-1", ""].join("\n"));
assert.ok(FIGURE.every((row) => /^[\x20-\x7e]*$/.test(row) && row.length <= 38), "plain ASCII, 38 columns at most");
assert.ok(DOOR_TEXT.every((row) => /^[\x20-\x7e]*$/.test(row) && row.length <= 40), "the door in plain ASCII, 40 columns at most");
assert.match(DOOR_TEXT[0], /^ +\+-+\+$/, "a plain lintel: no word over the door");
assert.ok(!DOOR_TEXT.join("").includes("DONE"), "no DONE sign");
assert.ok(FIGURE.slice(0, 6).every((row) => DOOR_TEXT.some((line) => line.includes(row.trim()))), "his head in the doorway");
// In colour: the README's Bouncer at the door in quadrant cells, 60 columns, in 24-bit or the xterm 256.
const visible = (line) => line.replace(/\x1b\[[0-9;]*m/g, "");
const deep = doorArt({ depth: "truecolor" });
const shallow = doorArt({ depth: "256" });
assert.ok(!deep.join("").includes("DONE") && !deep.join("").includes("D O N E"), "no sign over the door");
assert.ok(deep.length >= 20 && deep.every((line) => visible(line).length <= 60), "60 columns at most");
assert.ok(deep.some((line) => line.includes("38;2;")) && !shallow.some((line) => line.includes(";2;")), "24-bit only when asked");
const greenish = (n) => n >= 16 && n < 232 && Math.floor((n - 16) / 6) % 6 > Math.max(Math.floor((n - 16) / 36), (n - 16) % 6);
assert.ok([...shallow.join("").matchAll(/38;5;(\d+)/g)].some((m) => greenish(Number(m[1]))), "the 256 keep the rain's green");
assert.ok(deep.every((line) => line.endsWith("\x1b[0m")), "every line resets its colour");
assert.equal(colorDepth({ COLORTERM: "truecolor" }), "truecolor");
assert.equal(colorDepth({ COLORTERM: "24bit" }), "truecolor");
assert.equal(colorDepth({ TERM_PROGRAM: "Apple_Terminal" }), "256");
assert.ok(banner(lineFor("passed"), {}).includes(deep[1]), "the banner draws him in colour");
assert.match(banner(lineFor("passed"), { verdict: "passed", counts: { public: { passed: 1, total: 1 }, hidden: null } }), /hidden\x1b\[0m  -/);
console.log("ok banner");

// say(): writes to a TTY, never to a pipe.
const side = { isTTY: false, out: "", write(text) { this.out += text; } };
say("overfit", { stream: pipe, side, env, keys: ["boundary-2"] });
assert.equal(pipe.out, "", "nothing on a pipe");
assert.equal(side.out, "", "nor on stderr, unasked");
// Asked for: stdout untouched, his line on stderr, keys and the tally beside it.
say("overfit", { stream: pipe, side, env: { BOUNCER_VOICE: "1" }, keys: ["boundary-2"], record: "At this door so far: 1 in, 2 turned away." });
assert.equal(pipe.out, "", "stdout stays the machine's");
assert.equal(side.out, `${DOOR_TEXT.join("\n")}\nBouncer: Not tonight.  boundary-2\nBouncer: At this door so far: 1 in, 2 turned away.\n`, "his door first, when it is due");
const before = process.env.CI;
const noColor = process.env.NO_COLOR;
delete process.env.CI;
delete process.env.NO_COLOR;
say("passed", { stream: tty });
if (before !== undefined) process.env.CI = before;
if (noColor !== undefined) process.env.NO_COLOR = noColor;
assert.match(tty.out, /You're in\./);
// The figure once per process (and once per 30 minutes): after it, his mark.
const again = { isTTY: true, out: "", write(text) { this.out += text; } };
say("passed", { stream: again, env });
assert.ok(!again.out.includes(FIGURE[0]) && again.out.includes(MARK), "the second time, the mark only");
console.log("ok say");

// What he remembers: .seen, and the tally (bin/regulars.mjs).
const fresh = mkdtempSync(join(tmpdir(), "bouncer-seen-"));
assert.deepEqual(seen({ home: fresh, mark: false }), { due: true, first: true });
assert.equal(existsSync(join(fresh, ".seen")), false, "mark: false writes nothing");
assert.deepEqual(seen({ home: fresh }), { due: true, first: true });
assert.deepEqual(seen({ home: fresh }), { due: false, first: false }, "drawn: not due again");
const past = (Date.now() - FIGURE_EVERY_MS - 1000) / 1000;
utimesSync(join(fresh, ".seen"), past, past);
assert.deepEqual(seen({ home: fresh }), { due: true, first: false }, "due again after 30 minutes");
assert.deepEqual(tallied({ home: fresh }), []);
tally({ slug: "a", verdict: "overfit", keys: ["boundary-2", "unhappy-1"] }, { home: fresh });
tally({ slug: "a", verdict: "passed", keys: [] }, { home: fresh });
assert.equal(tallyLine(summary(tallied({ home: fresh }))), null, "under three verdicts, no record line");
tally({ slug: "b", verdict: "overfit", keys: ["boundary-1"] }, { home: fresh });
tally({ slug: "c", verdict: "incomplete", keys: ["happy-1", "happy-2", "happy-3"] }, { home: fresh });
const withStub = summary(tallied({ home: fresh }));
assert.equal(withStub.kind, "boundary", "an incomplete's keys are not what he turned it away on");
tally({ slug: "c", verdict: "passed", keys: [] }, { home: fresh });
const counted = summary(tallied({ home: fresh }));
assert.deepEqual([counted.in, counted.out, counted.total, counted.kind, counted.kindCount], [2, 3, 5, "boundary", 2]);
assert.equal(tallyLine(counted), "At this door so far: 2 in, 3 turned away; most turned away on boundary.");
assert.equal(tallied({ home: join(fresh, "nowhere") }).length, 0, "no tally file: none");
console.log("ok regulars");

// The stages: on stderr, with the clock since the command started.
assert.equal(clock(65_000), "1:05");
assert.equal(clock(3_725_000), "1:02:05");
const err = { isTTY: false, out: "", write(text) { this.out += text; } };
announce("private", { stream: err, env });
assert.equal(err.out, "", "unasked, no stage line");
announce("private", { stream: err, env: { BOUNCER_VOICE: "1", BOUNCER_STARTED: "1000" }, now: 1000 + 125_000 });
assert.equal(err.out, "Bouncer: Writing the list. Door's closed. (2:05)\n");
announce("ready", { stream: err, env: { BOUNCER_VOICE: "1" }, extra: "the suites cost $3.10" });
assert.ok(err.out.endsWith("Bouncer: The list is ready. (the suites cost $3.10)\n"));
announce("no-such-stage", { stream: err, env: { BOUNCER_VOICE: "1" } });
assert.ok(!err.out.includes("undefined"));
for (const name of ["skeleton", "public", "private"]) assert.ok(LINES[`stage-${name}`], `generate's ${name} party has a stage line`);

// The greeting: once, the first time he is seen on this machine.
const greetHome = mkdtempSync(join(tmpdir(), "bouncer-greet-"));
const greeted = { isTTY: false, out: "", write(text) { this.out += text; } };
process.env.BOUNCER_HOME = greetHome;
greet({ stream: pipe, side: greeted, env: { BOUNCER_VOICE: "1" } });
greet({ stream: pipe, side: greeted, env: { BOUNCER_VOICE: "1" } });
process.env.BOUNCER_HOME = home;
assert.equal(greeted.out, `${DOOR_TEXT.join("\n")}\nBouncer: He's on the door.\n`, "once, at his door");
console.log("ok stages");

// The judge prints his line only through say(), before the verdict line it
// already printed, so the machine output is unchanged after it.
const judge = readFileSync(new URL("../bin/judge.mjs", import.meta.url), "utf8");
assert.equal(judge.match(/\bsay\(/g).length, 3, "judge calls say() for the new-module verdict, the repository verdict and a changed list");
assert.ok(!/console\.log\([^)]*LINES/.test(judge), "no line printed around say()");
// The card (bin/card.mjs): pure, carries only what the implementer may see.
const { card, wrap } = await import("../bin/card.mjs");
const counts = { public: { passed: 22, total: 22 }, hidden: { passed: 38, total: 39 } };
const out = card({ verdict: "overfit", claim: "All <21> tests pass & done.", keys: ["unhappy-1"], slug: "duration-parse", counts, sha: "011e72943df09a8b6b55" });
assert.match(out, /^<svg /);
assert.ok(out.includes("Not tonight.") && out.includes("unhappy-1") && out.includes("hidden 38/39") && out.includes("sha256 011e72943df0"));
assert.ok(out.includes("&lt;21&gt;") && out.includes("&amp;"), "the claim is escaped");
assert.ok(out.includes("YOUR AGENT"));
const noClaim = card({ verdict: "passed", claim: null, slug: "duration-parse", counts });
assert.ok(!noClaim.includes("YOUR AGENT"), "no claim, no agent bubble: a card never invents what an agent said");
assert.ok(noClaim.includes("You're in.") && noClaim.includes("IN"));
assert.deepEqual(wrap("one two three four five six", 9, 2), ["one two", "three…"]);
assert.ok(judge.includes("console.error(`Card: "), "the card's path goes to stderr, so stdout stays the verdict");
console.log("ok card");
console.log("voice passed");
