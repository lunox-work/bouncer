// Bouncer's voice: one short line beside a verdict, for a person. The
// machine word (passed, overfit, ...) never changes and stays in the output
// agents and CI parse; the line is printed above it, and only when
// `voiceMode` says a person is reading:
//
// - "banner": a TTY, no --plain, no --json, no NO_COLOR, no CI, no seal. His
//   figure (then, within 30 minutes of drawing it, his mark only) and the
//   line, on the stream given (stdout beside a verdict).
// - "line": asked for with BOUNCER_VOICE=1 or --voice, where no TTY is (a
//   coding agent's shell, which relays it). One `Bouncer: <line>` on
//   stderr, so stdout stays byte for byte what it was.
//
// Off the TTY and unasked, the output is byte for byte what it was before
// (test/voice.mjs). --plain, --json, a seal and BOUNCER_VOICE=0 silence him
// even when asked. Put --plain or --voice last: the option parser takes a
// following word as its value (cli.mjs takes --voice out wherever it is).
//
// Rules for a line: no line without a check behind it; never more than the
// rule key (he doesn't explain the list); he turns down the claim, never the
// person. The stage lines (`announce`) each name a step that is running.

import { DOOR_CELLS } from "./door-art.mjs";
import { seen } from "./regulars.mjs";

/** The lines, by what happened. `keys` is appended to "Not tonight." */
export const LINES = {
  passed: "You're in.",
  "passed-retry": "One fix. You're in.",
  overfit: "Not tonight.",
  "overfit-retry": "Same shoes.",
  incomplete: "Not dressed for it.",
  regressed: "You broke something on the way in.",
  refused: "You don't write on my clipboard.",
  "outside-scope": "Just you. Not your twelve friends.",
  unconfirmed: "No list tonight. Ask the owner.",
  "list-changed": "Someone touched my list. Nobody gets in.",
  // The door reports without his voice (its rules are often wrong, evidence/DOOR.md); only a clean door gets a line.
  "door-clean": "Dress code's fine. The list is another matter: bouncer check.",
  id: "Let me see some ID.",
  // Beside the list `bouncer id` printed: by its count.
  "long-list": "That's a lot of guessing for one ticket.",
  "empty-list": "Nothing on here I'd ask about.",
  // Before a verdict that costs money: the price is the check behind it.
  "cover-charge": "Cover charge: about $1-7 and 10-25 minutes. Your call.",
  // `fit` unsupported, or a change no hidden suite can cover: the list still works.
  "wrong-club": "Wrong club.",
  // The first time he is seen on this machine (cli.mjs `greet`).
  met: "He's on the door.",
  // The stages of a check, each printed as it starts (`announce`).
  "stage-ticket": "Reading the ticket.",
  "stage-skeleton": "Setting up the room.",
  "stage-public": "Posting the house rules.",
  "stage-private": "Writing the list. Door's closed.",
  "stage-empty-room": "Checking the list against an empty room.",
  "stage-reference": "Sending a regular through first.",
  "stage-ready": "The list is ready.",
  "stage-judge": "Checking ID.",
};

/** A list of `LONG_LIST` picks or more gets "long-list" beside it. */
export const LONG_LIST = 10;

const IN = new Set(["passed", "passed-retry", "door-clean"]);
const ASK = new Set(["id", "cover-charge", "met", "long-list", "empty-list"]);

/**
 * How a person is reading `stream`: "banner" at a TTY, "line" where one
 * asked for him without a TTY (BOUNCER_VOICE=1, --voice), else null.
 * `options` is the command's parsed options (lib.mjs `args`).
 */
export function voiceMode({ stream = process.stdout, env = process.env, options = {}, sealed = false } = {}) {
  if (sealed || options.plain !== undefined || options.json !== undefined) return null;
  if (env.BOUNCER_VOICE === "0") return null;
  const quiet = (env.NO_COLOR !== undefined && env.NO_COLOR !== "") || (env.CI !== undefined && env.CI !== "" && env.CI !== "false");
  if (stream?.isTTY === true && !quiet) return "banner";
  return env.BOUNCER_VOICE === "1" || options.voice !== undefined ? "line" : null;
}

/** Whether a person is reading `stream` at all (`voiceMode` not null). */
export const voiceOn = (given = {}) => voiceMode(given) !== null;

/** His line for a verdict: `retry` for a keyed retry's submission, `keys` the failing scenario keys. */
export function lineFor(verdict, { retry = false, keys = [], aside = null } = {}) {
  const id = retry && (verdict === "passed" || verdict === "overfit") ? `${verdict}-retry` : verdict;
  const text = LINES[id];
  if (text === undefined) return null;
  const extra = aside !== null && LINES[aside] !== undefined ? ` ${LINES[aside]}` : "";
  return { id, text: `${text}${extra}`, keys: id === "overfit" ? keys : [], tone: IN.has(id) ? "in" : ASK.has(id) ? "ask" : "out" };
}

/**
 * The terminal figure, after the README's Bouncer: bald, shades, the
 * earpiece's coil down to his collar, broad shoulders, lapels and tie, arms
 * crossed over the suit with both fists showing. Plain ASCII, so every
 * terminal font draws him the same; 38 columns wide.
 */
export const FIGURE = [
  "               _.------._",
  "             .'          '.",
  "            /   ________   \\",
  "           |   [___][___]   |~,",
  "           |       __       |  )",
  "            \\     '--'     /  (",
  "       ______'.___\\  /___.'___)__",
  "     .'      \\    \\\\//    /      '.",
  "    /         \\    ||    /         \\",
  "   |     ______\\___||___/______     |",
  "   |   _(______________________)_   |",
  "   |  (__)                    (__)  |",
  "   |   '----------.  .----------'   |",
  "   |              |  |              |",
];

/** His mark, for every line after the figure: the shades. */
export const MARK = "[___][___]";

/**
 * Him at the club's door in plain ASCII, for where no colour goes (a coding
 * agent's shell, which shows it in a code block): FIGURE in the doorway,
 * test results falling past his head. No sign over it. He is wider than the
 * door, so below his shoulders the jambs are behind him. 37 columns.
 */
export const DOOR_TEXT = (() => {
  const LEFT = 8;
  const RIGHT = 35;
  const row = (text) => text.padEnd(40).split("");
  const lintel = row(`${" ".repeat(LEFT)}+${"-".repeat(RIGHT - LEFT - 1)}+`);
  const doorway = [row(""), ...FIGURE.slice(0, 6).map(row)];
  doorway.forEach((cells, r) => {
    cells[LEFT] = "|";
    cells[RIGHT] = "|";
    const used = cells.map((c, i) => (c !== " " && i > LEFT && i < RIGHT ? i : null)).filter((i) => i !== null);
    const [from, to] = used.length > 0 ? [Math.min(...used) - 1, Math.max(...used) + 1] : [RIGHT, LEFT];
    for (let i = LEFT + 2; i < RIGHT - 1; i += 3) if (i < from || i > to) cells[i] = (i + r) % 2 === 0 ? ":" : ".";
  });
  return [lintel, ...doorway, ...FIGURE.slice(6).map(row)].map((cells) => cells.join("").trimEnd());
})();

/** How many colours the terminal takes: "truecolor" when COLORTERM says so, else the xterm 256. */
export function colorDepth(env = process.env) {
  return /^(truecolor|24bit)$/i.test(env.COLORTERM ?? "") ? "truecolor" : "256";
}

/** An sRGB colour in CIELAB, where distance follows what the eye sees (hue included). */
function lab([r, g, b]) {
  const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** The xterm 256 above the 16 system colours, in CIELAB: the 6x6x6 cube (16-231), then the grey ramp (232-255). */
const XTERM = (() => {
  const level = [0, 95, 135, 175, 215, 255];
  const cube = Array.from({ length: 216 }, (_, n) => [level[Math.floor(n / 36)], level[Math.floor(n / 6) % 6], level[n % 6]]);
  return [...cube, ...Array.from({ length: 24 }, (_, n) => [8 + n * 10, 8 + n * 10, 8 + n * 10])].map(lab);
})();

/**
 * An RGB colour as the nearest of the xterm 256 in CIELAB, so his skin keeps
 * its peach instead of the tan that is nearer in RGB. Only a near-neutral
 * colour may land on the grey ramp: a dark green or red keeps its hue.
 */
function xterm256([r, g, b]) {
  const neutral = Math.max(r, g, b) - Math.min(r, g, b) < 24;
  const [L, A, B] = lab([r, g, b]);
  let best = 0;
  let bestDistance = Infinity;
  XTERM.forEach(([l, a, bb], i) => {
    if (i >= 216 && !neutral) return;
    const distance = (l - L) ** 2 + (a - A) ** 2 + (bb - B) ** 2;
    if (distance < bestDistance) [best, bestDistance] = [i, distance];
  });
  return 16 + best;
}

/** A quadrant cell's character by its mask (TL 1, TR 2, BL 4, BR 8): the set quarters take the foreground. */
const QUADRANTS = " ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█";

/**
 * Him at the club's door in colour (bin/door-art.mjs, from assets/src/terminal.py:
 * the README's Bouncer in front of the hero's doors, as pixel art): quadrant
 * cells, each 2x2 sub-dots in two colours, the wall left to the terminal's
 * own background. 60 columns.
 */
export function doorArt({ depth = "truecolor" } = {}) {
  const width = DOOR_CELLS[0].length / 13;
  const rgb = (hex) => (hex === "......" ? null : [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)));
  const code = (layer, c) => (depth === "truecolor" ? `${layer};2;${c.join(";")}` : `${layer};5;${xterm256(c)}`);
  const lines = [];
  for (const row of DOOR_CELLS) {
    let line = "";
    for (let x = 0; x < width; x += 1) {
      const cell = row.slice(x * 13, x * 13 + 13);
      const mask = parseInt(cell[0], 16);
      const fg = rgb(cell.slice(1, 7));
      const bg = rgb(cell.slice(7, 13));
      if (mask === 0 && bg === null) line += "\x1b[0m ";
      else if (mask === 0) line += `\x1b[0;${code(48, bg)}m `;
      else line += `\x1b[0;${code(38, fg)}${bg === null ? "" : `;${code(48, bg)}`}m${QUADRANTS[mask]}`;
    }
    lines.push(`${line}\x1b[0m`.replace(/(\x1b\[0m )+\x1b\[0m$/, "\x1b[0m"));
  }
  return lines;
}

/**
 * The banner printed above a verdict: him at the door (in colour, or
 * DOOR_TEXT when `color` is false; `figure: false`, his mark only), then,
 * when `counts` is given ({ public, hidden }, each { passed, total }), the
 * counts and the machine word, then his line with the failing keys beside
 * it, then `record` (regulars.mjs `tallyLine`) when given.
 */
export function banner(line, { color = true, depth = "truecolor", counts = null, verdict = null, figure = true, record = null } = {}) {
  if (line === null) return "";
  const paint = (code, text) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
  const tone = { in: 32, ask: 33 }[line.tone] ?? 31;
  const count = (suite) => {
    if (!suite) return "-";
    const text = `${suite.passed}/${suite.total}`;
    return suite.passed < suite.total ? paint(31, text) : text;
  };
  const stats =
    counts === null
      ? []
      : [`  ${paint(2, "public")}  ${count(counts.public)}    ${paint(2, "hidden")}  ${count(counts.hidden)}`, ...(verdict === null ? [] : [`  ${paint(2, "verdict")} ${paint(tone, verdict)}`]), ""];
  const said = `${paint(`1;${tone}`, line.text)}${line.keys.length > 0 ? `  ${paint(2, line.keys.join(", "))}` : ""}`;
  const top = figure ? [...(color ? doorArt({ depth }) : DOOR_TEXT), ""] : counts === null ? [] : [`  ${paint(2, MARK)}`, ""];
  const lead = figure || counts !== null ? "  " : `  ${paint(2, MARK)}  `;
  return [...top, ...stats, `${lead}${said}`, ...(record === null ? [] : [`  ${paint(2, record)}`]), ""].join("\n");
}

/** The whole figure is drawn at most once per process, and once per 30 minutes (regulars.mjs `seen`). */
let drawn = false;
function figureDue() {
  if (drawn) return false;
  drawn = true;
  return seen().due;
}

/**
 * Prints his line for `id`: the banner on `stream` at a TTY, or one
 * `Bouncer:` line on `side` (stderr) when asked for without one, under
 * DOOR_TEXT when his figure is due. `record` is a line of fact printed after
 * his (the tally).
 */
export function say(id, { stream = process.stdout, side = process.stderr, env = process.env, options = {}, sealed = false, keys = [], retry = false, aside = null, counts = null, record = null } = {}) {
  const mode = voiceMode({ stream, env, options, sealed });
  if (mode === null) return;
  const line = lineFor(id, { retry, keys, aside });
  if (line === null) return;
  if (mode === "banner") {
    stream.write(`${banner(line, { depth: colorDepth(env), counts, verdict: counts === null ? null : id, figure: figureDue(), record })}\n`);
    return;
  }
  if (figureDue()) side.write(`${DOOR_TEXT.join("\n")}\n`);
  side.write(`Bouncer: ${line.text}${line.keys.length > 0 ? `  ${line.keys.join(", ")}` : ""}\n`);
  if (record !== null) side.write(`Bouncer: ${record}\n`);
}

/** Minutes and seconds, as a clock: 14:05, or 1:02:09 past an hour. */
export function clock(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const [h, m, s] = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * A stage of a check, as it starts: his line for it, the time since the
 * command started (BOUNCER_STARTED, set by cli.mjs) and `extra` (a cost),
 * on stderr. Nothing when no person is reading.
 */
export function announce(id, { stream = process.stderr, env = process.env, now = Date.now(), extra = null } = {}) {
  const mode = voiceMode({ stream, env });
  const text = LINES[`stage-${id}`];
  if (mode === null || text === undefined) return;
  const started = Number(env.BOUNCER_STARTED);
  const facts = [Number.isFinite(started) && started > 0 ? clock(now - started) : null, extra].filter(Boolean).join(", ");
  if (mode === "line") {
    stream.write(`Bouncer: ${text}${facts === "" ? "" : ` (${facts})`}\n`);
    return;
  }
  const paint = (code, value) => `\x1b[${code}m${value}\x1b[0m`;
  stream.write(`  ${paint(2, MARK)}  ${paint(1, text)}${facts === "" ? "" : `  ${paint(2, facts)}`}\n`);
}

/**
 * The first time he is seen on this machine: him at the door and "He's
 * on the door." (DOOR_TEXT and a `Bouncer:` line when asked for without a
 * TTY). Records him as seen, so the next banner within 30 minutes draws his
 * mark only.
 */
export function greet({ stream = process.stdout, side = process.stderr, env = process.env, options = {} } = {}) {
  const mode = voiceMode({ stream, env, options });
  if (mode === null || !seen({ mark: false }).first) return;
  seen();
  drawn = true;
  if (mode === "line") side.write(`${DOOR_TEXT.join("\n")}\nBouncer: ${LINES.met}\n`);
  else stream.write(`${[...doorArt({ depth: colorDepth(env) }), "", `  \x1b[1;33m${LINES.met}\x1b[0m`, ""].join("\n")}\n`);
}
