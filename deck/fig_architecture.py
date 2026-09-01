"""Slide 2 — system architecture, four tiers, showing what is live today."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from draw import *

W, H = 620, 300
img, d = canvas(W, H, BG)

TIERS = [
    ("FRONTLINE",  36),
    ("PLATFORM",  104),
    ("INTELLIGENCE", 178),
    ("DATA",      248),
]
for name, y in TIERS:
    text(d, (6, y + 14), name, 7, "b", MUTED)

LX = 54          # left edge of the band content
BW = W - LX - 8

# ---------------------------------------------------------------- frontline
boxes = [
    ("Health worker\nsub-centre", GREEN),
    ("Doctor\nPHC / anywhere", NAVY),
    ("District admin\ndashboard", MUTED),
]
bw, gap = 122, 14
for i, (lab, col) in enumerate(boxes):
    x = LX + i * (bw + gap)
    rrect(d, (x, 24, x + bw, 74), r=7, fill=WHITE, outline=col, width=2)
    text(d, (x + bw / 2, 49), lab, 9, "b", col, anchor="mm")

rrect(d, (LX + 3 * (bw + gap), 24, W - 8, 74), r=7, fill=NAVY_SOFT)
text(d, (LX + 3 * (bw + gap) + 8, 33), "Multilingual", 8, "b", NAVY)
text(d, (LX + 3 * (bw + gap) + 8, 45), "7 languages", 7.5, "r", MUTED)
text(d, (LX + 3 * (bw + gap) + 8, 56), "speech + read-aloud", 7.5, "r", MUTED)

# ----------------------------------------------------------------- platform
rrect(d, (LX, 96, W - 8, 156), r=8, fill=BG_SOFT, outline=LINE, width=1)
text(d, (LX + 10, 103), "Node.js / Express API   ·   59 routes   ·   one authenticated WebSocket",
     8.5, "b", NAVY)

mods = ["Triage", "Records", "Queue &\nscheduling", "Teleconsult\nWebRTC", "Referral", "Dashboards"]
mw = (BW - 20 - 5 * 7) / 6
for i, m in enumerate(mods):
    x = LX + 10 + i * (mw + 7)
    rrect(d, (x, 118, x + mw, 148), r=5, fill=WHITE, outline=LINE, width=1)
    text(d, (x + mw / 2, 133), m, 7.5, "b", INK, anchor="mm")

# ------------------------------------------------------------- intelligence
rrect(d, (LX, 170, W - 8, 230), r=8, fill=(252, 246, 235), outline=SAFFRON, width=1)
text(d, (LX + 10, 177), "AI layer   —   rules decide, models advise", 8.5, "b", AMBER)

ai = [
    ("Rule engine", "deterministic\ntier floor", GREEN),
    ("Trained classifier", "244,938 vectors\ntop-5 0.974", NAVY),
    ("Vision + OCR", "wounds, scripts\nlab reports", NAVY),
    ("LLM synthesis", "bounded — cannot\nlower a tier", MUTED),
]
aw = (BW - 20 - 3 * 8) / 4
for i, (t, sub, col) in enumerate(ai):
    x = LX + 10 + i * (aw + 8)
    rrect(d, (x, 190, x + aw, 224), r=5, fill=WHITE, outline=col, width=1)
    text(d, (x + aw / 2, 197), t, 8, "b", col, anchor="ma")
    text(d, (x + aw / 2, 208), sub, 7, "r", MUTED, anchor="ma")

# ---------------------------------------------------------------------- data
dat = [
    "PostgreSQL · 17 tables · row-level security",
    "Private object store · signed URLs",
    "Append-only audit log",
]
dw = (BW - 2 * 8) / 3
for i, t in enumerate(dat):
    x = LX + i * (dw + 8)
    rrect(d, (x, 244, x + dw, 274), r=6, fill=NAVY, outline=None)
    for j, ln in enumerate(wrap(t, 7.5, "b", dw - 14)):
        text(d, (x + dw / 2, 250 + j * 10), ln, 7.5, "b", WHITE, anchor="ma")

# ------------------------------------------------------------------- arrows
for x in (LX + 60, LX + 196, LX + 332):
    arrow(d, (x, 76), (x, 94), NAVY, 1.5, 5)
    arrow(d, (x, 158), (x, 168), SAFFRON, 1.5, 5)
    arrow(d, (x, 232), (x, 242), NAVY, 1.5, 5)

save(img, os.path.join(os.path.dirname(__file__), "fig_architecture.png"), 1240)
print("ok")
