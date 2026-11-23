// Bouncer's voice (bin/voice.mjs): his line only for a person at a
// terminal, and the judge's piped output unchanged. Pure: no spec, no
// toolchain, no network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { banner, FIGURE, LINES, lineFor, say, voiceOn } from "../bin/voice.mjs";

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

// The banner: the figure, his line under it; with counts, the counts and
// the verdict word between (the "Bouncer mascot review" CLI mock).
const plain = banner(lineFor("overfit", { keys: ["boundary-2", "unhappy-1"] }), { color: false });
assert.equal(plain, [...FIGURE, "", "  Not tonight.  boundary-2, unhappy-1", ""].join("\n"));
assert.ok(!plain.includes("\x1b"), "no escape codes without colour");
const judged = banner(lineFor("overfit", { keys: ["unhappy-1"] }), { color: false, verdict: "overfit", counts: { public: { passed: 22, total: 22 }, hidden: { passed: 38, total: 39 } } });
assert.equal(judged, [...FIGURE, "", "  public  22/22    hidden  38/39", "  verdict overfit", "", "  Not tonight.  unhappy-1", ""].join("\n"));
assert.ok(FIGURE.every((row) => /^[\x20-\x7e]*$/.test(row) && row.length <= 38), "plain ASCII, 38 columns at most");
assert.match(banner(lineFor("passed"), { verdict: "passed", counts: { public: { passed: 1, total: 1 }, hidden: null } }), /hidden\x1b\[0m  -/);
console.log("ok banner");

// say(): writes to a TTY, never to a pipe.
say("overfit", { stream: pipe, keys: ["boundary-2"] });
assert.equal(pipe.out, "", "nothing on a pipe");
const before = process.env.CI;
const noColor = process.env.NO_COLOR;
delete process.env.CI;
delete process.env.NO_COLOR;
say("passed", { stream: tty });
if (before !== undefined) process.env.CI = before;
if (noColor !== undefined) process.env.NO_COLOR = noColor;
assert.match(tty.out, /You're in\./);
console.log("ok say");

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
