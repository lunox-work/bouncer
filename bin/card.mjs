// The verdict card: the agent's own claim, Bouncer's answer, the stamp, and
// the counts, as one 1280×640 SVG (`judge --card <file.svg>`, and the
// README's verdict image through assets/src/render.mjs). `card()` is pure.
// A card carries only what the implementer may see: the verdict, counts,
// failing scenario keys and the hidden suite's hash, never a hidden test's
// name or body.
import { readFileSync } from "node:fs";
import { lineFor } from "./voice.mjs";

const INK = "#0b0b0c";
const PAPER = "#f2efe8";
const ROPE = "#d6223f";
const IN = "#22c55e";
const MUTED = "#8b877f";
const SANS = "'Space Grotesk', 'Inter', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
const BODY = "'DM Sans', 'Inter', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "'DM Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const escape = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Words wrapped to lines of at most `width` characters, at most `max` lines (the last ends in … when cut). */
export function wrap(text, width, max) {
  const lines = [];
  let line = "";
  for (const word of String(text).trim().split(/\s+/)) {
    if (line === "") line = word;
    else if (`${line} ${word}`.length <= width) line = `${line} ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== "") lines.push(line);
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  kept[max - 1] = `${kept[max - 1].replace(/[\s.,;:!?]*$/, "").slice(0, width - 1)}…`;
  return kept;
}

/** The mark's three shapes (assets/src/mark.mjs), placed at x, y, `scale` px per unit. */
function mark(x, y, scale, color) {
  return `<g transform="translate(${x} ${y}) scale(${scale}) translate(-4 -13)"><path fill="${color}" d="M6 21 Q32 16 58 21 L57 31 Q45 34.5 36 31 L32 28.5 L28 31 Q19 34.5 7 31 Z"/><rect fill="${color}" x="24" y="44" width="16" height="4.4" rx="2.2"/><path fill="none" stroke="${color}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" d="M56.5 30.5 Q61 32.5 58.8 36.2 Q56.6 39.8 59.8 42.2 Q63 44.8 59.8 47.6 Q57 50.2 59.2 53.6"/></g>`;
}

/** The club hand stamp: two words in a double border, a little off square. */
export function stamp(x, y, words, color, rotate = -9) {
  const [top, bottom] = words;
  return `<g transform="translate(${x} ${y}) rotate(${rotate})" opacity="0.92">
  <rect x="-150" y="-78" width="300" height="156" rx="14" fill="none" stroke="${color}" stroke-width="7"/>
  <rect x="-136" y="-64" width="272" height="128" rx="8" fill="none" stroke="${color}" stroke-width="2.5"/>
  <text x="0" y="-8" text-anchor="middle" font-family="${MONO}" font-size="30" letter-spacing="9" fill="${color}">${escape(top)}</text>
  <text x="0" y="40" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="46" letter-spacing="3" fill="${color}">${escape(bottom)}</text>
</g>`;
}

/**
 * The card. `claim` is the agent's own sentence (null leaves its bubble
 * out: a card never invents what an agent said); `keys` the failing
 * scenario keys; `fontFace` optional @font-face CSS for rendering with the
 * brand fonts.
 */
export function card({ verdict, claim = null, keys = [], slug = "", counts = null, sha = null, retry = false, fontFace = "" }) {
  const said = lineFor(verdict, { retry, keys }) ?? { text: verdict, keys: [], tone: "out" };
  const tone = said.tone === "in" ? IN : ROPE;
  const parts = [];
  parts.push(`<rect width="1280" height="640" fill="${INK}"/>`);
  parts.push(`<rect width="1280" height="640" fill="url(#glow)"/>`);
  parts.push(mark(72, 60, 0.95, PAPER));
  parts.push(`<text x="140" y="92" font-family="${MONO}" font-size="24" fill="${PAPER}">bouncer</text>`);

  let y = 170;
  if (claim !== null && String(claim).trim() !== "") {
    const lines = wrap(`“${String(claim).trim().replace(/^["“]|["”]$/g, "")}”`, 40, 3);
    parts.push(`<text x="72" y="${y}" font-family="${MONO}" font-size="17" letter-spacing="4" fill="${MUTED}">YOUR AGENT</text>`);
    const height = lines.length * 46 + 40;
    parts.push(`<rect x="72" y="${y + 18}" width="720" height="${height}" rx="20" fill="#1a1a1d"/>`);
    lines.forEach((line, i) => parts.push(`<text x="100" y="${y + 70 + i * 46}" font-family="${BODY}" font-size="34" fill="${PAPER}">${escape(line)}</text>`));
    y += 18 + height + 46;
  } else y = 250;

  parts.push(`<text x="792" y="${y}" text-anchor="end" font-family="${MONO}" font-size="17" letter-spacing="4" fill="${MUTED}">BOUNCER</text>`);
  const keyText = said.keys.length > 0 ? said.keys.slice(0, 3).join(", ") + (said.keys.length > 3 ? ", …" : "") : "";
  parts.push(`<rect x="152" y="${y + 18}" width="640" height="104" rx="20" fill="${said.tone === "in" ? "#0d2416" : "#2a0d13"}" stroke="${tone}" stroke-opacity="0.55" stroke-width="2"/>`);
  parts.push(
    `<text x="184" y="${y + 86}" font-family="${SANS}" font-weight="700" font-size="46" fill="${PAPER}">${escape(said.text)}${keyText ? `<tspan dx="18" font-family="${MONO}" font-weight="400" font-size="34" fill="${tone}">${escape(keyText)}</tspan>` : ""}</text>`,
  );

  const words = said.tone === "in" ? ["YOU'RE", "IN"] : verdict === "incomplete" ? ["NOT", "DRESSED"] : ["NOT", "TONIGHT"];
  parts.push(stamp(1040, 300, words, tone));

  const facts = [
    slug,
    counts?.public ? `public ${counts.public.passed}/${counts.public.total}` : null,
    counts?.hidden ? `hidden ${counts.hidden.passed}/${counts.hidden.total}` : null,
    sha ? `sha256 ${String(sha).slice(0, 12)}…` : null,
  ].filter(Boolean);
  parts.push(`<text x="72" y="584" font-family="${MONO}" font-size="19" fill="${MUTED}">${escape(facts.join("  ·  "))}</text>`);
  parts.push(`<text x="1208" y="584" text-anchor="end" font-family="${MONO}" font-size="19" fill="${MUTED}">${escape(verdict)}</text>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 640" width="1280" height="640" role="img" aria-label="${escape(`${said.text} ${keyText}`.trim())}">
<defs><radialGradient id="glow" cx="0.82" cy="0.42" r="0.6"><stop offset="0" stop-color="${tone}" stop-opacity="0.16"/><stop offset="1" stop-color="${tone}" stop-opacity="0"/></radialGradient>${fontFace ? `<style>${fontFace}</style>` : ""}</defs>
${parts.join("\n")}
</svg>
`;
}

/**
 * The agent's last claim in a Claude Code transcript (.jsonl): the last
 * sentence of its final message that says tests pass or the work is done,
 * else null. Reads the file once; nothing else.
 */
export function lastClaim(transcript) {
  let last = null;
  for (const raw of readFileSync(transcript, "utf8").split("\n")) {
    if (raw === "") continue;
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      continue;
    }
    if (event.type !== "assistant" || event.isSidechain === true) continue;
    const content = event.message?.content;
    const text = typeof content === "string" ? content : Array.isArray(content) ? content.filter((part) => part.type === "text").map((part) => part.text).join("\n") : "";
    if (text.trim() !== "") last = text;
  }
  if (last === null) return null;
  const sentences = last.replace(/[*_`#>]/g, "").split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const claim = [...sentences].reverse().find((s) => /\b(tests?|suite)\b.*\b(pass|passing|green)\b|\ball (tests? )?pass|\b(done|complete|implemented|ready)\b/i.test(s));
  return claim ?? null;
}
