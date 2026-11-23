# The hero's door: Bouncer (assets/src/bouncer-cut.webp, in colour) in front of a club's double
# doors, both leaves swung open, the doorway full of Matrix-style rain made of test results. Each stream spells
# a real test name from specs/duration-parse/tests down the column and ends in PASS (green, most)
# or FAIL (red); dim letters fill the screen behind. The wall is left transparent so the card's own
# background shows round the door. Drawn at 2x the hero's 520×560 door box (index.html places it).
# Writes assets/src/scene.webp. Needs: pip install pillow numpy; macOS for the Menlo font.
#   python assets/src/scene.py
import os, re, glob
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageChops
import numpy as np

here = os.path.dirname(os.path.abspath(__file__))
root = os.path.join(here, "..", "..")
S = 2  # px per unit of the 520×560 box
W, H, FLOOR = 520 * S, 560 * S, 540 * S
DX0, DX1, DTOP, FRAME, LEAF = 210 * S, 390 * S, 100 * S, 12 * S, 74 * S  # doorway, frame, open leaves
HEADTOP, WIDE = 194 * S, 404 * S  # where his head starts, and how wide his cut-out is drawn
FAIL = 0.14  # share of streams that end in FAIL
PIN = (1, 9)  # column and row where one FAIL is pinned to start
FONT = "/System/Library/Fonts/Menlo.ttc"

names = []
for f in sorted(glob.glob(os.path.join(root, "specs", "duration-parse", "tests", "*", "*.test.ts"))):
    names += [m.group(1) for m in re.finditer(r'test\("\[[^\]]+\] ([^"]+)"', open(f).read())]

def rain(w, h, seed=8, size=12 * S):
    rng = np.random.default_rng(seed)
    font, bold = ImageFont.truetype(FONT, size), ImageFont.truetype(FONT, size, index=1)
    cw, ch = int(size * 1.5), int(size * 1.2)  # a clear gap between columns so each reads on its own
    cols, rows = w // cw, h // ch + 1
    pad = (w - cols * cw + cw - int(size * 0.6)) // 2  # centre the columns in the doorway
    img = Image.new("RGB", (w, h), (0, 0, 0)); d = ImageDraw.Draw(img)
    G, R = np.array([30, 235, 95]), np.array([240, 45, 70])
    PASS_, FAIL_ = (70, 255, 125), (255, 70, 95)  # the verdict, one flat colour, every letter alike
    letters = re.sub(r"[^a-z0-9]", "", "".join(names).lower())
    at = lambda c, r: (pad + c * cw, r * ch)
    for c in range(cols):
        for r in range(rows):
            if rng.random() < 0.22:
                d.text(at(c, r), letters[rng.integers(len(letters))], font=font, fill=(0, int(18 + 14 * rng.random()), 8))
    for c in range(cols):
        r = int(rng.integers(-rows, 0)); first = True
        while r < rows + 4:
            name = re.sub(r"[^a-z0-9]", "", names[rng.integers(len(names))].lower())[: int(rng.integers(3, 8))]  # short, so verdicts land above his head
            ok = rng.random() > FAIL; n = len(name)
            if c == PIN[0] and first:  # one FAIL where it shows, left of his head and clear of his line
                ok = False; r = PIN[1] - n - 1
            first = False
            word = "PASS" if ok else "FAIL"
            for k, g in enumerate(name + " " + word):  # the name, a blank, then the verdict
                rr = r + k
                if rr < 0 or rr >= rows: continue
                x, y = at(c, rr)
                d.rectangle([x - 2, y, x + cw - 4, y + ch], fill=(0, 0, 0))
                if k > n:
                    d.text((x, y), g, font=bold, fill=PASS_ if ok else FAIL_); continue
                if k == n: continue
                col = (G if ok else R) * (0.25 + 0.6 * (k / max(1, n)) ** 1.4)  # the name brightens toward its verdict
                d.text((x, y), g, font=font, fill=tuple(int(v) for v in col))
            r += n + 5 + int(rng.integers(1, 6))
    glow = img.filter(ImageFilter.GaussianBlur(2 * S))
    return ImageChops.add(ImageChops.add(img, glow), glow.filter(ImageFilter.GaussianBlur(5 * S)))

scene = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(scene)
# a soft downlight on the wall above the door
yy, xx = np.mgrid[0:H, 0:W].astype(float)
glow = np.clip(1 - np.hypot((xx - (DX0 + DX1) / 2) / 1.5, yy - DTOP + 70 * S) / (240 * S), 0, 1) ** 2
glow *= np.clip(np.minimum.reduce([xx, W - xx, yy, H - yy]) / (60 * S), 0, 1)  # gone before the edges: no box
scene.alpha_composite(Image.fromarray(np.dstack([np.full((H, W, 3), 245, np.uint8), (glow * 26).astype(np.uint8)]), "RGBA"))
# both leaves swung out toward you, then the steel frame
for side, hx in ((-1, DX0 - FRAME), (1, DX1 + FRAME)):
    ox = hx + side * LEAF
    leaf = [(hx, DTOP - FRAME), (ox, DTOP - FRAME - 26 * S), (ox, FLOOR), (hx, FLOOR)]
    d.polygon(leaf, fill=(30, 31, 34, 255))
    d.line(leaf[:2], fill=(80, 83, 87, 255), width=3 * S // 2); d.line([leaf[1], leaf[2]], fill=(70, 72, 76, 255), width=3 * S // 2)
    px = hx + side * (LEAF - 18 * S)
    d.rectangle([min(px, px + side * 5 * S), 280 * S, max(px, px + side * 5 * S), 360 * S], fill=(110, 112, 116, 255))
d.rectangle([DX0 - FRAME, DTOP - FRAME, DX1 + FRAME, FLOOR], fill=(40, 42, 45, 255))
d.rectangle([DX0 - FRAME, DTOP - FRAME, DX1 + FRAME, DTOP - FRAME + 2 * S], fill=(96, 99, 103, 255))
d.rectangle([DX0 - 2, DTOP - 2, DX1 + 2, FLOOR], fill=(92, 95, 99, 255))
# the doorway: rain falling out of the lintel's shadow, darker at the jambs
dw, dh = DX1 - DX0, FLOOR - DTOP
r = np.asarray(rain(dw, dh)).astype(float)
r *= np.clip(0.35 + np.arange(dh)[:, None, None] / (45 * S), 0, 1)
r *= np.clip(0.55 + np.minimum(np.arange(dw), dw - np.arange(dw))[None, :, None] / (30 * S), 0, 1)
scene.paste(Image.fromarray(r.astype(np.uint8)), (DX0, DTOP))
# him, cut off at the floor line, with a night keyline so the black suit holds against the rain
cut = Image.open(os.path.join(here, "bouncer-cut.webp")).convert("RGBA")
top = int(np.where(np.asarray(cut)[..., 3].max(1) > 128)[0][0])
him = Image.new("RGBA", (W, H), (0, 0, 0, 0))
him.paste(cut.resize((WIDE, WIDE), Image.LANCZOS), ((DX0 + DX1 - WIDE) // 2, HEADTOP - top * WIDE // 1024))
a = np.asarray(him).copy(); a[FLOOR:, :, 3] = 0; him = Image.fromarray(a, "RGBA")
key = him.split()[3].filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.GaussianBlur(3))
scene.alpha_composite(Image.merge("RGBA", (*Image.new("RGB", (W, H), (11, 11, 12)).split(), key)))
scene.alpha_composite(him)
scene.save(os.path.join(here, "scene.webp"), quality=92, method=6)
