"""Slide 5 — before / after patient journey, with sourced stat callouts."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from draw import *

W, H = 700, 178
img, d = canvas(W, H, BG)

LX, RW = 96, W - 96 - 8


def journey(y, label, sub, col, bg, steps, note):
    rrect(d, (6, y, 88, y + 54), r=7, fill=col)
    lab_lines = label.splitlines()
    sub_lines = wrap(sub, 6.9, "r", 74)
    block = len(lab_lines) * 12 + 3 + len(sub_lines) * 8.6
    ly = y + (54 - block) / 2
    for j, ln in enumerate(lab_lines):
        text(d, (47, ly + j * 12), ln, 10, "b", WHITE, anchor="ma")
    sy0 = ly + len(lab_lines) * 12 + 3
    for j, ln in enumerate(sub_lines):
        text(d, (47, sy0 + j * 8.6), ln, 6.9, "r", (240, 243, 248), anchor="ma")

    sw = (RW - (len(steps) - 1) * 26) / len(steps)
    for i, (t, s) in enumerate(steps):
        x = LX + i * (sw + 26)
        rrect(d, (x, y, x + sw, y + 54), r=7, fill=bg, outline=col, width=1)
        text(d, (x + sw / 2, y + 9), t, 8.2, "b", col, anchor="ma")
        for j, ln in enumerate(wrap(s, 7.2, "r", sw - 12)):
            text(d, (x + sw / 2, y + 23 + j * 9.5), ln, 7.2, "r", INK, anchor="ma")
        if i < len(steps) - 1:
            arrow(d, (x + sw + 4, y + 27), (x + sw + 22, y + 27), col, 1.6, 6)
    text(d, (LX, y + 58), note, 7.4, "i", MUTED)


journey(
    10, "TODAY", "the journey the PS describes", RED, RED_BG,
    [("Symptom", "at the village"),
     ("Travel", "hours to a\ndistrict hospital"),
     ("Queue", "no appointment\nno triage"),
     ("Consult", "history restarts\nfrom zero"),
     ("Paper script", "lost before the\nnext visit")],
    "68% of rural health spending is out of pocket · ₹16,676 average per hospitalisation  (NSS 75th Round)")

journey(
    108, "WITH\nRuralAI", "same clinical authority,\nno journey", GREEN, GREEN_BG,
    [("Symptom", "at the village"),
     ("Sub-centre", "health worker\ncaptures the case"),
     ("AI prepares", "triage · records\nprotocols"),
     ("Doctor decides", "video or daily\nbatch review"),
     ("Record persists", "referral only\nwhen needed")],
    "Travel happens only for the cases that genuinely need a hospital — the tier decides, not the queue.")

save(img, os.path.join(os.path.dirname(__file__), "fig_impact.png"), 1500)
print("ok")
