// Bouncer's mark: three features and nothing else (the visor, the mouth, the
// earpiece coil). One colour. Writes the light and dark README marks and the
// plugin icon's SVG; assets/src/render.mjs turns icon.svg into the PNG.
//   node assets/src/mark.mjs
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const INK = "#0b0b0c"; // night
export const PAPER = "#f2efe8"; // paper
export const ROPE = "#d6223f"; // velvet rope, the one accent
export const IN = "#22c55e"; // only for "you're in"

/** The mark's shapes in a 64×64 box, painted in `color`. */
export function markShapes(color) {
  return [
    `<path fill="${color}" d="M6 21 Q32 16 58 21 L57 31 Q45 34.5 36 31 L32 28.5 L28 31 Q19 34.5 7 31 Z"/>`,
    `<rect fill="${color}" x="24" y="44" width="16" height="4.4" rx="2.2"/>`,
    `<path fill="none" stroke="${color}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" d="M56.5 30.5 Q61 32.5 58.8 36.2 Q56.6 39.8 59.8 42.2 Q63 44.8 59.8 47.6 Q57 50.2 59.2 53.6"/>`,
  ].join("");
}

/** A standalone SVG of the mark, cropped to its shapes, `width` px wide. */
export function markSvg(color, width = 64) {
  const height = Math.round((width * 44) / 60);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="4 13 60 44" width="${width}" height="${height}" role="img" aria-label="Bouncer"><title>Bouncer</title>${markShapes(color)}</svg>\n`;
}

/** The plugin icon: the mark in paper on a night square. */
export function iconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><rect width="1024" height="1024" fill="${INK}"/><g transform="translate(70 50) scale(13)">${markShapes(PAPER)}</g></svg>\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  writeFileSync(path.join(assets, "mark-light.svg"), markSvg(INK, 220));
  writeFileSync(path.join(assets, "mark-dark.svg"), markSvg(PAPER, 220));
  writeFileSync(path.join(assets, "icon.svg"), iconSvg());
}
