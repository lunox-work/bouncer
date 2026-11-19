// Bouncer, drawn: no neck, shoulders edge to edge, a small head, wraparound
// shades, a flat mouth, arms crossed, the earpiece coil. One colour; the
// details are holes, so whatever is behind him shows through them. Used by
// bin/card.mjs and assets/src/mark.mjs (the README marks and the plugin icon).

export const INK = "#0b0b0c"; // night
export const PAPER = "#f2efe8"; // paper
export const ROPE = "#d6223f"; // velvet rope, the one accent
export const IN = "#22c55e"; // only for "you're in"

/** His shapes in a 120×120 box, painted in `color`; `id` names the mask, unique per document. */
export function markShapes(color, id = "bouncer-cut") {
  return `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="120">
<rect width="120" height="120" fill="#fff"/>
<path d="M43 27 Q60 24.6 77 27 L76.5 34.6 Q69 36.8 63.4 34.4 L60 32.6 L56.6 34.4 Q51 36.8 43.5 34.6 Z" fill="#000"/>
<rect x="55" y="43.6" width="10" height="2.6" rx="1.3" fill="#000"/>
<path d="M51 58 Q60 64 69 58" fill="none" stroke="#000" stroke-width="2.4" stroke-linecap="round"/>
<rect x="28" y="86" width="64" height="16" rx="8" transform="rotate(12 60 94)" fill="none" stroke="#000" stroke-width="2.8"/>
<rect x="28" y="86" width="64" height="16" rx="8" transform="rotate(-12 60 94)" fill="#fff" stroke="#000" stroke-width="2.8"/>
</mask>
<g mask="url(#${id})" fill="${color}">
<path d="M0 120 V98 C0 76 14 66 34 59 L48 53 H72 L86 59 C106 66 120 76 120 98 V120 Z"/>
<path d="M60 14 C70 14 76 20 76 30 V40 Q76 50 68 54 H52 Q44 50 44 40 V30 C44 20 50 14 60 14 Z"/>
</g>
<path d="M77 34.4 q5 1 4 4.4 q-2.2 2.6 0.8 4.8 q3.4 2.2 0.4 4.8 q-2.4 2.2 0.6 4.6 q2 1.8 1.6 5.6" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** A standalone SVG of the mark, `size` px square. */
export function markSvg(color, size = 120) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="${size}" height="${size}" role="img" aria-label="Bouncer"><title>Bouncer</title>${markShapes(color)}</svg>\n`;
}

/** The plugin icon: him in paper on a night square, rising from its bottom edge. */
export function iconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><rect width="1024" height="1024" fill="${INK}"/><g transform="translate(92 164) scale(7)">${markShapes(PAPER)}</g></svg>\n`;
}
