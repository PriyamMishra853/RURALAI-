"""Slide 3 — end-to-end clinical flow with the triage branch. Carries the slide."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from draw import *

W, H = 780, 268
img, d = canvas(W, H, BG)

# ---------------------------------------------------------- capture pipeline
steps = [
    ("01", "REGISTER", "Aadhaar key\nage derived"),
    ("02", "CAPTURE", "voice · vitals\nhistory"),
    ("03", "DIGITISE", "scripts · labs\nwound photos"),
]
bw, gap, top = 108, 14, 30
for i, (n, t, s) in enumerate(steps):
    x = 6 + i * (bw + gap)
    rrect(d, (x, top, x + bw, top + 60), r=7, fill=WHITE, outline=NAVY, width=2)
    chip(d, (x + 8, top + 7), n, 7, fill=NAVY)
    text(d, (x + 34, top + 9), t, 9.5, "b", NAVY)
    text(d, (x + 10, top + 30), s, 7.5, "r", MUTED)
    if i < 2:
        arrow(d, (x + bw + 2, top + 30), (x + bw + gap - 2, top + 30), NAVY, 1.6, 6)

# ------------------------------------------------------------- assess engine
ax = 6 + 3 * (bw + gap)
aw = 168
arrow(d, (ax - 14, top + 30), (ax - 2, top + 30), NAVY, 1.6, 6)
rrect(d, (ax, top - 6, ax + aw, top + 96), r=8, fill=(252, 246, 235), outline=SAFFRON, width=2)
chip(d, (ax + 8, top - 1), "04", 7, fill=AMBER)
text(d, (ax + 34, top + 1), "ASSESS", 9.5, "b", AMBER)

rows = [
    ("Rule engine", "sets the tier floor", GREEN),
    ("Classifier", "ranked candidates", NAVY),
    ("Vision / OCR", "may raise the tier", NAVY),
    ("LLM", "writes the summary", MUTED),
]
for j, (a, b, c) in enumerate(rows):
    y = top + 18 + j * 18
    d.ellipse([S(ax + 11), S(y + 3), S(ax + 17), S(y + 9)], fill=c)
    text(d, (ax + 22, y), a, 7.8, "b", c)
    text(d, (ax + 84, y), b, 7.5, "r", MUTED)

text(d, (ax + aw / 2, top + 100), "final tier = MAX(rule, vision, model)", 7.5, "b", AMBER, anchor="ma")

# ------------------------------------------------------------- tier branches
bx = ax + aw + 26
tiers = [
    ("LOW", "Protocol care on the spot\nDoctor reviews in daily batch", GREEN, GREEN_BG),
    ("MEDIUM", "Video consultation required\nbefore any treatment", AMBER, AMBER_BG),
    ("HIGH / EMERGENCY", "Nearest district hospital\n108 · case leaves platform", RED, RED_BG),
]
tw_, th = W - bx - 8, 52
for k, (t, s, col, bg) in enumerate(tiers):
    y = 16 + k * (th + 12)
    rrect(d, (bx, y, bx + tw_, y + th), r=7, fill=bg, outline=col, width=2)
    text(d, (bx + 10, y + 8), t, 9, "b", col)
    text(d, (bx + 10, y + 24), s, 7.5, "r", INK)
    elbow(d, (ax + aw + 4, top + 44), (bx - 3, y + th / 2), col, 1.6, 6, mid=bx - 13)

# --------------------------------------------------------------- decision bar
dy = 214
rrect(d, (6, dy, W - 8, dy + 44), r=8, fill=NAVY, outline=None)
text(d, (18, dy + 9), "05  ·  DECIDE", 9.5, "b", SAFFRON)
text(d, (18, dy + 25), "A registered practitioner signs every prescription, referral and clinical decision.",
     8.5, "b", WHITE)
text(d, (W - 18, dy + 9), "06  ·  CLOSE THE LOOP", 9.5, "b", SAFFRON, anchor="ra")
text(d, (W - 18, dy + 25), "Decision pushed back to the health worker in real time.",
     8.5, "r", (215, 228, 244), anchor="ra")

for k in range(3):
    y = 16 + k * (th + 12) + th
    if k < 2:
        d.line([S(bx + tw_ / 2), S(y), S(bx + tw_ / 2), S(y + 12)], fill=LINE, width=S(1.4))
arrow(d, (bx + tw_ / 2, 16 + 2 * (th + 12) + th + 2), (bx + tw_ / 2, dy - 3), MUTED, 1.6, 6)
arrow(d, (ax + aw / 2, top + 112), (ax + aw / 2, dy - 3), MUTED, 1.6, 6)

save(img, os.path.join(os.path.dirname(__file__), "fig_flow.png"), 1560)
print("ok")
