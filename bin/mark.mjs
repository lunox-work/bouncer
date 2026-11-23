// Bouncer, drawn: the movie bouncer, huge in a black suit, shaved head, shades,
// arms crossed, the earpiece wire coiling into his collar. Traced from a FLUX
// comic drawing (assets/src/trace.py writes bin/mark-art.mjs): the ink is the
// suit, the shades and the lines; `fill` paints what his outline encloses (face,
// hands, the fold lines), `outline` rings him like a sticker so the black suit
// holds on a dark background. Used by bin/card.mjs and assets/src/mark.mjs (the
// README marks, the hero's door and the plugin icon).
import { BOX, FILL_PATH, INK_PATH } from "./mark-art.mjs";

export const INK = "#0b0b0c"; // night
export const PAPER = "#f2efe8"; // paper
export const ROPE = "#d6223f"; // velvet rope, the one accent
export const IN = "#22c55e"; // only for "you're in"

/**
 * His shapes in a 120×120 box, the ink in `color`. Options: `fill` paints what
 * his outline encloses; `outline` rings him in that colour, `ring` px of the 120
 * box wide, for dark backgrounds. `id` is kept for callers.
 */
export function markShapes(color, id = "bouncer", { fill = null, outline = null, ring = 3 } = {}) {
  const k = 120 / BOX;
  const edge = outline ? `<path d="${FILL_PATH}" fill="${outline}" stroke="${outline}" stroke-width="${(ring * 2 / k).toFixed(0)}" stroke-linejoin="round"/>` : "";
  const inside = fill ? `<path d="${FILL_PATH}" fill="${fill}"/>` : "";
  return `<g data-mark="${id}" transform="scale(${k})">${edge}${inside}<path d="${INK_PATH}" fill="${color}" fill-rule="evenodd"/></g>`;
}

/** A standalone SVG of the mark, `size` px square; `opts` as markShapes. */
export function markSvg(color, size = 120, opts = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="${size}" height="${size}" role="img" aria-label="Bouncer"><title>Bouncer</title>${markShapes(color, "bouncer", opts)}</svg>\n`;
}

/** The plugin icon: him on a paper square, his shoulders running off its bottom edge. */
export function iconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><rect width="1024" height="1024" fill="${PAPER}"/><g transform="translate(32 104) scale(8)">${markShapes(INK, "icon", { fill: PAPER })}</g></svg>\n`;
}
