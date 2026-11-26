# Bouncer at the club's door, for the terminal: the README's Bouncer (assets/src/bouncer-cut.webp, the
# drawing every mark is made from) large in front of the club's open double doors, test-result rain
# in the doorway, as in the hero. Writes bin/door-art.mjs, which bin/voice.mjs draws above his line.
#
# How it keeps his likeness at 60 columns:
# - Quadrant cells (▘▝▖▗▚▞▛▜▙▟ and the halves): every cell is 2x2 sub-dots drawn in two colours,
#   the character and the colours picked to fit its four sub-dots best: twice the detail across
#   that half blocks give.
# - Pixel art, not a blur: the full-size drawing is smoothed (median), snapped to its own flat
#   palette (his skin's few tones found apart from the rest, so a small area keeps its colour),
#   then each sub-dot takes the commonest colour of its block. The suit stays black with its
#   charcoal folds, the shades stay solid, the skin stays the drawing's peach.
# - A paper outline round him and under him, as the README mark has, so the black suit holds on a
#   dark terminal. The wall stays transparent: the terminal's own background shows through.
# Needs: pip install pillow numpy
#   python assets/src/terminal.py
import os, random
from PIL import Image, ImageDraw, ImageFilter
import numpy as np

here = os.path.dirname(os.path.abspath(__file__))
root = os.path.join(here, "..", "..")
CROP = (22, 0, 1008, 986)  # his whole width, as assets/src/marks.py crops him
PAPER = (242, 239, 232)
COLS = 60  # terminal columns; sub-dots are half a cell each way, so 120 across
SKIN_TONES, OTHER_TONES, SMOOTH = 4, 4, 7
QUAD_BITS = 16  # a cell's character is its mask: TL 1, TR 2, BL 4, BR 8, drawn in the foreground

cut = Image.open(os.path.join(here, "bouncer-cut.webp")).convert("RGBA").crop(CROP)


def kmeans(x, k, seed=3, iters=25):
    rng = np.random.default_rng(seed)
    c = x[rng.choice(len(x), k, replace=False)]
    for _ in range(iters):
        label = ((x[:, None, :] - c[None]) ** 2).sum(-1).argmin(1)
        c = np.array([x[label == j].mean(0) if (label == j).any() else c[j] for j in range(k)])
    return c


def him(sw):
    """Him on a sub-dot grid sw wide (each sub-dot twice as tall as wide), outlined in paper."""
    src = np.array(cut.filter(ImageFilter.MedianFilter(SMOOTH))).astype(float)
    alpha = src[..., 3] >= 128
    sample = src[alpha][:, :3][::7]
    r, g, b = sample.T
    skin = (r > 90) & (r > g + 25) & (r > b + 40)
    palette = np.vstack([kmeans(sample[skin], SKIN_TONES), kmeans(sample[~skin], OTHER_TONES)])
    flat = src[..., :3].reshape(-1, 3)
    index = np.concatenate([((flat[i:i + 200000, None, :] - palette[None]) ** 2).sum(-1).argmin(1) for i in range(0, len(flat), 200000)]).reshape(alpha.shape)
    sh = round(cut.height / cut.width * sw / 2)
    ys = np.linspace(0, cut.height, sh + 1).astype(int)
    xs = np.linspace(0, cut.width, sw + 1).astype(int)
    out = np.zeros((sh + 1, sw, 4))
    mask = np.zeros((sh, sw), bool)
    for j in range(sh):
        for i in range(sw):
            covered = alpha[ys[j]:ys[j + 1], xs[i]:xs[i + 1]]
            if covered.mean() < 0.5:
                continue
            votes = index[ys[j]:ys[j + 1], xs[i]:xs[i + 1]][covered]
            out[j, i, :3] = palette[np.bincount(votes, minlength=len(palette)).argmax()]
            out[j, i, 3] = 255
            mask[j, i] = True
    # the outline: one sub-dot down, two across (a sub-dot is half as wide), and closed under him
    grown = np.array(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))) > 0
    wide = grown.copy()
    wide[:, 1:] |= grown[:, :-1]
    wide[:, :-1] |= grown[:, 1:]
    ring = np.zeros((sh + 1, sw), bool)
    ring[:sh] = wide & ~mask
    ring[sh] = mask[-1] | ring[sh - 1]
    out[ring, :3] = PAPER
    out[ring, 3] = 255
    return out


def scene(sw):
    """The door behind him: both leaves open, the steel frame, the doorway dark with falling results."""
    figure = him(sw)
    top = round(figure.shape[0] * 0.22)
    height = top + figure.shape[0]
    img = Image.new("RGBA", (sw, height), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx, half, y0 = sw // 2, round(sw * 0.2), 2
    x0, x1 = cx - half, cx + half
    d.polygon([(x0 - 3, y0 - 1), (x0 - 16, y0 + 2), (x0 - 16, height), (x0 - 3, height)], fill=(34, 36, 40, 255))
    d.polygon([(x1 + 3, y0 - 1), (x1 + 16, y0 + 2), (x1 + 16, height), (x1 + 3, height)], fill=(34, 36, 40, 255))
    d.rectangle([x0 - 3, y0 - 1, x1 + 3, height], fill=(70, 73, 78, 255))
    d.rectangle([x0, y0 + 1, x1, height], fill=(8, 10, 9, 255))
    rng = random.Random(8)
    for x in range(x0 + 2, x1 - 1, 3):
        red = rng.random() < 0.15  # a failing test streams red, the rest green
        head = rng.randrange(y0 + 3, height)
        for k in range(rng.randrange(3, 9)):
            y = head - k
            if y <= y0:
                break
            fade = max(0.3, 1 - k / 8)
            colour = (214, 40, 63) if red else (45, 200, 95)
            img.putpixel((x, y), tuple(int(v * fade) for v in colour) + (255,))
    canvas = np.array(img).astype(float)
    region = canvas[top:top + figure.shape[0]]
    a = figure[..., 3:4] / 255
    region[..., :3] = figure[..., :3] * a + region[..., :3] * (1 - a)
    region[..., 3] = np.maximum(region[..., 3], figure[..., 3])
    return canvas


def cells(grid):
    """Each 2x2 block as one cell: (mask, fg, bg), bg None where the wall shows through."""
    if grid.shape[0] % 2:
        grid = np.vstack([grid, np.zeros((1, grid.shape[1], 4))])
    rows = []
    for y in range(0, grid.shape[0], 2):
        row = []
        for x in range(0, grid.shape[1], 2):
            px = [grid[y, x], grid[y, x + 1], grid[y + 1, x], grid[y + 1, x + 1]]
            opaque = [p[3] >= 128 for p in px]
            best = None
            for bits in range(QUAD_BITS):
                drawn = [i for i in range(4) if bits >> i & 1]
                rest = [i for i in range(4) if not bits >> i & 1]
                if any(not opaque[i] for i in drawn):
                    continue  # only opaque sub-dots are drawn
                clear = all(not opaque[i] for i in rest)
                if rest and not clear and any(not opaque[i] for i in rest):
                    continue  # a background half wall, half colour can't be drawn
                fg = np.mean([px[i][:3] for i in drawn], axis=0) if drawn else None
                bg = None if clear or not rest else np.mean([px[i][:3] for i in rest], axis=0)
                err = sum(((px[i][:3] - fg) ** 2).sum() for i in drawn)
                err += sum(((px[i][:3] - bg) ** 2).sum() for i in rest) if bg is not None else 0
                if best is None or err < best[0]:
                    best = (err, bits, fg, bg)
            if best is None:  # wall and colour mixed every way: the colour wins
                best = (0, 15, np.mean([p[:3] for p, o in zip(px, opaque) if o], axis=0), None)
            row.append(best[1:])
        rows.append(row)
    return rows


hexc = lambda c: "......" if c is None else "%02x%02x%02x" % tuple(int(round(v)) for v in c)
rows = cells(scene(COLS * 2))
out = os.path.join(root, "bin", "door-art.mjs")
with open(out, "w") as f:
    f.write("// Generated by assets/src/terminal.py from assets/src/bouncer-cut.webp: do not edit by hand.\n")
    f.write(f"// Bouncer at the club's door, {COLS} columns by {len(rows)} lines: one string per line, 13 characters a cell:\n")
    f.write("// the quadrant mask in hex (TL 1, TR 2, BL 4, BR 8, drawn in the foreground), the foreground,\n")
    f.write("// then the background, each six hex digits or \"......\" for none (the terminal's own background).\n")
    f.write("export const DOOR_CELLS = [\n")
    for row in rows:
        f.write('  "' + "".join("%x%s%s" % (bits, hexc(fg), hexc(bg)) for bits, fg, bg in row) + '",\n')
    f.write("];\n")
print(out, COLS, "x", len(rows))
