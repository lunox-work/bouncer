// Writes the README marks (light and dark), the small corner one and the plugin icon's SVG from bin/mark.mjs;
// assets/src/render.mjs turns icon.svg into the PNG. The hero's door is a picture: assets/src/scene.py.
//   node assets/src/mark.mjs
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { INK, PAPER, iconSvg, markSvg } from "../../bin/mark.mjs";

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
writeFileSync(path.join(assets, "mark-light.svg"), markSvg(INK, 240, { fill: PAPER }));
writeFileSync(path.join(assets, "mark-dark.svg"), markSvg(INK, 240, { fill: PAPER, outline: PAPER, ring: 2 }));
writeFileSync(path.join(assets, "mark-small.svg"), markSvg(INK, 120, { fill: PAPER, outline: PAPER, ring: 4 })); // the images' corner logo, ~46px on night
writeFileSync(path.join(assets, "icon.svg"), iconSvg());
