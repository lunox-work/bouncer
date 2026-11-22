// Writes the README marks (light and dark), the hero's filled one, the small corner one and the plugin icon's SVG from
// bin/mark.mjs; assets/src/render.mjs turns icon.svg into the PNG.
//   node assets/src/mark.mjs
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { INK, PAPER, iconSvg, markSvg } from "../../bin/mark.mjs";

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
writeFileSync(path.join(assets, "mark-light.svg"), markSvg(INK, 240, { specks: true }));
writeFileSync(path.join(assets, "mark-dark.svg"), markSvg(PAPER, 240, { specks: true }));
writeFileSync(path.join(assets, "mark-scene.svg"), markSvg(INK, 240, { fill: PAPER, weight: 0.6 })); // the hero: solid paper on the door
writeFileSync(path.join(assets, "mark-small.svg"), markSvg(PAPER, 120, { weight: 2.4 })); // the images' corner logo, drawn ~36px
writeFileSync(path.join(assets, "icon.svg"), iconSvg());
