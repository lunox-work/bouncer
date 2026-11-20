// Renders the README images and the social preview (one PNG per <section> of
// index.html, at 2x; social.png is uploaded in the repository settings),
// the plugin icon (.claude-plugin/icon.png from assets/icon.svg) and an
// example verdict card (assets/card.png, from bin/card.mjs). Needs Playwright:
//   node assets/src/mark.mjs && PLAYWRIGHT=<dir containing node_modules/playwright> node assets/src/render.mjs [<id>...]
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { card } from "../../bin/card.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.join(here, "..");
const require = createRequire(path.join(process.env.PLAYWRIGHT ?? process.cwd(), "package.json"));
const { chromium } = require("playwright");
const only = process.argv.slice(2);
const want = (id) => only.length === 0 || only.includes(id);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(path.join(here, "index.html")).href);
await page.evaluate(() => document.fonts.ready);
for (const id of await page.$$eval("section.card", (all) => all.map((el) => el.id)))
  if (want(id)) await page.locator(`#${id}`).screenshot({ path: path.join(assets, `${id}.png`) });

const fonts = pathToFileURL(path.join(here, "fonts")).href;
const fontFace = `@font-face{font-family:"Space Grotesk";font-weight:600 700;src:url("${fonts}/space-grotesk-latin-600-normal.woff2")}@font-face{font-family:"DM Mono";src:url("${fonts}/dm-mono-latin-400-normal.woff2")}@font-face{font-family:"DM Sans";src:url("${fonts}/dm-sans-latin-400-normal.woff2")}`;
const still = async (svg, out, size) => {
  const shot = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
  await shot.setContent(`<body style="margin:0">${svg}</body>`);
  await shot.evaluate(() => document.fonts.ready);
  await shot.locator("svg").first().screenshot({ path: out });
  await shot.close();
};
if (want("card"))
  // The README's example card: the escrow-split exchange (index.html's comment has the source).
  await still(
    card({ verdict: "overfit", claim: "The build is clean and my 21 tests pass.", keys: ["boundary-2"], slug: "escrow-split", counts: { public: { passed: 22, total: 22 }, hidden: { passed: 43, total: 46 } }, fontFace }),
    path.join(assets, "card.png"),
    { width: 1280, height: 640 },
  );
if (want("icon")) await still(readFileSync(path.join(assets, "icon.svg"), "utf8"), path.join(assets, "..", ".claude-plugin", "icon.png"), { width: 1024, height: 1024 });
await browser.close();
