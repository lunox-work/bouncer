// Bouncer, drawn: a marker doodle of a bald egg of a head sitting straight on
// shoulders as wide as the box, no neck, black shades, the earpiece coil, a
// flat bored mouth. The line is traced from a FLUX doodle (assets/src/trace.py
// writes bin/mark-art.mjs); `fill` paints what his outline encloses, for scenes
// where he must stand solid in front of something. Used by bin/card.mjs and
// assets/src/mark.mjs (the README marks, the hero's door and the plugin icon).
import { BOX, FILL_PATH, INK_PATH, SPECK_PATH } from "./mark-art.mjs";

export const INK = "#0b0b0c"; // night
export const PAPER = "#f2efe8"; // paper
export const ROPE = "#d6223f"; // velvet rope, the one accent
export const IN = "#22c55e"; // only for "you're in"

/**
 * His shapes in a 120×120 box, the line in `color`. Options: `fill` paints what
 * his outline encloses; `specks` adds the ink spatter around him (standalone
 * marks only, in a scene it reads as dust); `weight` thickens the line, in px of
 * the 120 box, for marks drawn small. `id` is kept for callers.
 */
export function markShapes(color, id = "bouncer", { fill = null, specks = false, weight = 0 } = {}) {
  const k = 120 / BOX;
  const inside = fill ? `<path d="${FILL_PATH}" fill="${fill}"/>` : "";
  const line = weight ? ` stroke="${color}" stroke-width="${(weight / k).toFixed(1)}" stroke-linejoin="round"` : "";
  const spatter = specks ? `<path d="${SPECK_PATH}" fill="${color}"/>` : "";
  return `<g data-mark="${id}" transform="scale(${k})">${inside}<path d="${INK_PATH}" fill="${color}" fill-rule="evenodd"${line}/>${spatter}</g>`;
}

/** A standalone SVG of the mark, `size` px square; `opts` as markShapes. */
export function markSvg(color, size = 120, opts = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="${size}" height="${size}" role="img" aria-label="Bouncer"><title>Bouncer</title>${markShapes(color, "bouncer", opts)}</svg>\n`;
}

/** The plugin icon: him in ink on a paper square, his shoulders running off its bottom edge. */
export function iconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><rect width="1024" height="1024" fill="${PAPER}"/><g transform="translate(62 154) scale(7.5)">${markShapes(INK, "icon", { specks: true })}</g></svg>\n`;
}
