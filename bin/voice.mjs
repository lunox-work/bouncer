// Bouncer's voice: one short line beside a verdict, for a person at a
// terminal. The machine word (passed, overfit, ...) never changes and stays
// in the output agents and CI parse; the line is printed above it, and only
// when `voiceOn` says a person is reading: a TTY, no --plain, no --json, no
// NO_COLOR, no CI, no seal (put --plain last: the option parser takes a
// following word as its value). Off the TTY the output is byte for byte what it
// was before (test/voice.mjs).
//
// Rules for a line: no line without a check behind it; never more than the
// rule key (he doesn't explain the list); he turns down the claim, never the
// person.

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
};

const IN = new Set(["passed", "passed-retry", "door-clean"]);
const ASK = new Set(["id"]);

/**
 * Whether a person is reading `stream`: a TTY, and nothing asked for plain
 * output. `options` is the command's parsed options (lib.mjs `args`).
 */
export function voiceOn({ stream = process.stdout, env = process.env, options = {}, sealed = false } = {}) {
  if (sealed || options.plain !== undefined || options.json !== undefined) return false;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.CI !== undefined && env.CI !== "" && env.CI !== "false") return false;
  if (env.BOUNCER_VOICE === "0") return false;
  return stream?.isTTY === true;
}

/** His line for a verdict: `retry` for a keyed retry's submission, `keys` the failing scenario keys. */
export function lineFor(verdict, { retry = false, keys = [], aside = null } = {}) {
  const id = retry && (verdict === "passed" || verdict === "overfit") ? `${verdict}-retry` : verdict;
  const text = LINES[id];
  if (text === undefined) return null;
  const extra = aside !== null && LINES[aside] !== undefined ? ` ${LINES[aside]}` : "";
  return { id, text: `${text}${extra}`, keys: id === "overfit" ? keys : [], tone: IN.has(id) ? "in" : ASK.has(id) ? "ask" : "out" };
}

/**
 * The terminal mark, three lines: the visor, the mouth, the coil (≀). Kept
 * to block characters every terminal font has.
 */
export const MARK = ["▄▄▄▄▄▄▄▄▄▄▄▄▄▄ ", "▀█████▀▀█████▀≀", "     ▀▀▀▀     ≀"];

/** The banner printed above a verdict: the mark, his line beside it, coloured by tone. */
export function banner(line, { color = true } = {}) {
  if (line === null) return "";
  const paint = (code, text) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
  const said = `${paint(`1;${{ in: 32, ask: 33 }[line.tone] ?? 31}`, line.text)}${line.keys.length > 0 ? ` ${paint(2, line.keys.join(", "))}` : ""}`;
  return [`  ${MARK[0]}`, `  ${MARK[1]}   ${said}`, `  ${MARK[2]}`, ""].join("\n");
}

/** Prints the banner for `id` on `stream` when a person is reading it. */
export function say(id, { stream = process.stdout, options = {}, sealed = false, keys = [], retry = false, aside = null } = {}) {
  if (!voiceOn({ stream, options, sealed })) return;
  const line = lineFor(id, { retry, keys, aside });
  if (line !== null) stream.write(`${banner(line)}\n`);
}
