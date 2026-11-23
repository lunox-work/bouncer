// Bouncer, drawn: the movie bouncer, huge and heavyset in a black suit, bald,
// shades, arms crossed, an earpiece with a coiled tube into his collar. In
// colour, from a FLUX drawing; assets/src/marks.py writes bin/mark-art.mjs (a
// small PNG with a paper ring, so the black suit holds on the card's night)
// along with the README, corner and plugin marks. Used by bin/card.mjs.
import { MARK_PNG } from "./mark-art.mjs";

export const INK = "#0b0b0c"; // night
export const PAPER = "#f2efe8"; // paper
export const ROPE = "#d6223f"; // velvet rope, the one accent
export const IN = "#22c55e"; // only for "you're in"

/** Him, `size` px square, at x, y, as an SVG <image>. */
export function markImage(x, y, size) {
  return `<image data-mark="bouncer" x="${x}" y="${y}" width="${size}" height="${size}" href="${MARK_PNG}"/>`;
}
