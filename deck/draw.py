"""
Shared drawing helpers for the RuralAI SIH deck diagrams.

Everything renders at SCALE x and downsamples with LANCZOS, so edges and text
are crisp at PowerPoint's rendering size. Colours match the live production
site (ruralai-psi.vercel.app) so the deck and the demo read as one product.
"""
from PIL import Image, ImageDraw, ImageFont

SCALE = 3

# --- palette: India government medical, matching the deployed app -----------
NAVY      = (11, 60, 120)      # gov-600, primary
NAVY_DEEP = (8, 40, 79)
NAVY_SOFT = (232, 240, 250)
SAFFRON   = (243, 146, 17)
GREEN     = (21, 128, 61)
AMBER     = (180, 83, 9)
ORANGE    = (194, 65, 12)
RED       = (190, 18, 60)
INK       = (15, 32, 55)
MUTED     = (82, 100, 124)
LINE      = (205, 216, 230)
BG        = (255, 255, 255)
BG_SOFT   = (244, 247, 251)
WHITE     = (255, 255, 255)
GREEN_BG  = (222, 247, 230)
AMBER_BG  = (255, 247, 224)
RED_BG    = (254, 226, 232)

F = "C:/Windows/Fonts/"


def font(size, weight="r"):
    f = {"r": "calibri.ttf", "b": "calibrib.ttf", "i": "calibrii.ttf"}[weight]
    return ImageFont.truetype(F + f, size * SCALE)


def canvas(w, h, bg=BG):
    img = Image.new("RGB", (w * SCALE, h * SCALE), bg)
    return img, ImageDraw.Draw(img)


def S(v):
    return int(round(v * SCALE))


def rrect(d, box, r=8, fill=None, outline=None, width=1):
    x0, y0, x1, y1 = [S(v) for v in box]
    d.rounded_rectangle([x0, y0, x1, y1], radius=S(r), fill=fill,
                        outline=outline, width=S(width) if outline else 0)


def text(d, xy, s, size=11, weight="r", fill=INK, anchor="la", spacing=1.25):
    x, y = S(xy[0]), S(xy[1])
    fnt = font(size, weight)
    if "\n" in s:
        d.multiline_text((x, y), s, font=fnt, fill=fill, anchor=anchor,
                         spacing=int(size * SCALE * (spacing - 1)) + S(2))
    else:
        d.text((x, y), s, font=fnt, fill=fill, anchor=anchor)


def tw(s, size, weight="r"):
    """Text width in unscaled units."""
    f = font(size, weight)
    return f.getbbox(s)[2] / SCALE


def arrow(d, p0, p1, color=NAVY, width=2, head=7):
    """Straight arrow with a solid triangular head."""
    import math
    x0, y0 = S(p0[0]), S(p0[1])
    x1, y1 = S(p1[0]), S(p1[1])
    ang = math.atan2(y1 - y0, x1 - x0)
    hl = S(head)
    bx, by = x1 - hl * math.cos(ang), y1 - hl * math.sin(ang)
    d.line([x0, y0, bx, by], fill=color, width=S(width))
    hw = hl * 0.52
    d.polygon([
        (x1, y1),
        (bx - hw * math.sin(ang), by + hw * math.cos(ang)),
        (bx + hw * math.sin(ang), by - hw * math.cos(ang)),
    ], fill=color)


def elbow(d, p0, p1, color=NAVY, width=2, head=7, mid=None):
    """Right-angled connector: horizontal, then vertical, then arrow head."""
    x0, y0 = p0
    x1, y1 = p1
    mx = mid if mid is not None else (x0 + x1) / 2
    d.line([S(x0), S(y0), S(mx), S(y0)], fill=color, width=S(width))
    d.line([S(mx), S(y0), S(mx), S(y1)], fill=color, width=S(width))
    arrow(d, (mx, y1 - (12 if y1 > y0 else -12)), (x1, y1), color, width, head)


def chip(d, xy, label, size=8.5, fill=NAVY, fg=WHITE, padx=6, pady=3, r=None):
    """Small pill label. Returns its width."""
    w = tw(label, size, "b") + padx * 2
    h = size + pady * 2
    x, y = xy
    rrect(d, (x, y, x + w, y + h), r=(r if r is not None else h / 2), fill=fill)
    text(d, (x + w / 2, y + h / 2), label, size, "b", fg, anchor="mm")
    return w


def save(img, path, w):
    """Downsample to final width and save."""
    h = int(img.height * (w * SCALE / img.width) / SCALE)
    img.resize((w, h), Image.LANCZOS).save(path, "PNG", optimize=True)
    return path


def wrap(s, size, weight, maxw):
    """Greedy word wrap to a pixel width; returns a list of lines."""
    out, cur = [], ""
    for word in s.split():
        t = (cur + " " + word).strip()
        if tw(t, size, weight) <= maxw or not cur:
            cur = t
        else:
            out.append(cur)
            cur = word
    if cur:
        out.append(cur)
    return out


def para(d, xy, s, size, weight, fill, maxw, lh=None):
    """Draw wrapped text. Returns the y after the last line."""
    lh = lh or size * 1.35
    x, y = xy
    for ln in wrap(s, size, weight, maxw):
        text(d, (x, y), ln, size, weight, fill)
        y += lh
    return y
