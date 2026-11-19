// Writes the README marks (light and dark) and the plugin icon's SVG from
// bin/mark.mjs; assets/src/render.mjs turns icon.svg into the PNG.
//   node assets/src/mark.mjs
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { INK, PAPER, iconSvg, markSvg } from "../../bin/mark.mjs";

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
writeFileSync(path.join(assets, "mark-light.svg"), markSvg(INK, 240));
writeFileSync(path.join(assets, "mark-dark.svg"), markSvg(PAPER, 240));
writeFileSync(path.join(assets, "icon.svg"), iconSvg());
