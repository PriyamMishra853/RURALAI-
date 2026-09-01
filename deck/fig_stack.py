"""Slide 3 — technology stack strip."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from draw import *

GROUPS = [
    ("FRONTEND", NAVY,   ["React 18", "Vite 5", "Tailwind 3", "WebRTC", "Three.js"]),
    ("BACKEND",  NAVY,   ["Node.js 22", "Express 4", "WebSocket (ws)", "JWT", "pdfkit"]),
    ("AI / ML",  SAFFRON,["Python 3.11", "FastAPI", "scikit-learn", "Whisper", "Gemini vision", "Groq LLM"]),
    ("DATA",     GREEN,  ["PostgreSQL", "Row-level security", "Qdrant vectors", "Object store"]),
]

PADX, GAPG, CH = 10, 16, 19
widths, layouts = [], []
for name, col, items in GROUPS:
    w = max(tw(name, 8, "b"), sum(tw(i, 8, "b") + 18 for i in items) + (len(items) - 1) * 6)
    widths.append(w + PADX * 2)

W = int(sum(widths) + GAPG * (len(GROUPS) - 1) + 12)
H = 66
img, d = canvas(W, H, BG)

x = 6
for (name, col, items), gw in zip(GROUPS, widths):
    rrect(d, (x, 4, x + gw, H - 4), r=8, fill=BG_SOFT, outline=LINE, width=1)
    text(d, (x + PADX, 11), name, 8, "b", col)
    cx = x + PADX
    for it in items:
        cw = chip(d, (cx, 30), it, 8, fill=WHITE, fg=INK, padx=9, pady=5, r=5)
        rrect(d, (cx, 30, cx + cw, 30 + 8 + 10), r=5, fill=None, outline=col, width=1)
        text(d, (cx + cw / 2, 30 + 9), it, 8, "b", INK, anchor="mm")
        cx += cw + 6
    x += gw + GAPG

save(img, os.path.join(os.path.dirname(__file__), "fig_stack.png"), 1560)
print("ok", W, H)
