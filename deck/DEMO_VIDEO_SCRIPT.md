# Demo Video — Shot-by-Shot Script

**RuralAI · PS 26133 · Team UNFILTEREDENGINEERS**
**Total length: 3 minutes 00 seconds.** Do not exceed 3:30 — evaluators watch
dozens and the later ones get skimmed.

---

## Before you record — the four decisions that matter

**1. Screen recording beats slides for everything except the first 10 seconds
and the last 15.** Your single biggest advantage over other teams is that your
thing actually runs. A deck in a demo video says "we designed something." A
cursor moving through a working app says "we built it." Roughly 2:35 of this
video is screen capture.

**2. Reseed to Maharashtra first if you possibly can.** The video will show
`UTTAR PRADESH · 75 DISTRICTS` on the hero otherwise, while your deck says
Maharashtra. If you cannot reseed before recording, **do not linger on the hero**
— scroll past it in under 2 seconds (the shot list below already does this).

**3. Record at 1920×1080, browser zoomed to 100%, in an incognito window.**
Hide bookmarks, close other tabs, turn off notifications. A Slack popup mid-demo
is fatal to the impression.

**4. Record voice separately and lay it over the screen capture.** Live
narration while clicking produces hesitation, mouse-hunting and "um." Capture
clean screen footage first, then read the voiceover over it. Your timings below
assume this.

---

## The opening 10 seconds — this decides whether they keep watching

**Do not open with a logo animation. Do not open with a title card. Do not open
with the problem.** Every other video does one of those three, and evaluators
have seen forty of them.

**Open on the running application, mid-action, with a number on screen.**

### Shot 1 · 0:00–0:10 · Cold open

| | |
|---|---|
| **On screen** | Browser already open at `ruralai-psi.vercel.app`, scrolled to the live statistics band. The numbers **75 · 1,880 · 375 · 4** fill the frame. Hold 2 seconds, absolutely still. Then a slow scroll up to reveal the header. |
| **Voiceover** | *"This is not a mockup. It is deployed, and the link is in our submission."* <br><br> *(beat)* <br><br> *"A health worker at a village sub-centre. No doctor on site. Here is what happens next."* |
| **Why** | You have made two claims — it's real, and here's the scenario — before a competing video has finished its logo animation. |

**Cut hard on "next."** No fade.

---

## Full shot list

### Shot 2 · 0:10–0:25 · The problem, stated once and left alone

| | |
|---|---|
| **On screen** | Scroll down the landing page through "The gap this closes." Let the four points pass at reading speed. **Do not stop and read them aloud.** |
| **Voiceover** | *"Rural community health centres run a 79.9 percent shortfall of specialists — that is the Health Ministry's own figure. Patients travel hours. Paper prescriptions are lost between visits, so history restarts from zero."* <br><br> *"So the case should travel. Not the patient."* |
| **Timing** | 15 seconds. This is the only time you talk about the problem. |

---

### Shot 3 · 0:25–0:40 · Sign in as the health worker

| | |
|---|---|
| **On screen** | Click **Staff Sign In**. Type the assistant email. Password typed **off-camera or pre-filled** — never show a real password. Land on the assistant dashboard. Let the recent-patient list render. |
| **Voiceover** | *"The health worker signs in. Not the patient — the patient never touches this system."* <br><br> *"Everything they can see is scoped to their own district. That is enforced in the database, not just hidden in the interface."* |
| **Cut** | Trim the loading spinner. Nobody needs to watch a fetch. |

---

### Shot 4 · 0:40–1:05 · Capture — this is your differentiator, give it room

| | |
|---|---|
| **On screen** | Open a patient → assessment screen. Then, in order: <br> **(a)** Click the microphone, speak a Hindi symptom phrase aloud, show the transcript appearing in the field. <br> **(b)** Switch to the Vitals tab, change two values. <br> **(c)** Switch to Documents, upload a prescription photo, show the OCR extraction appear, then show the **verification modal** side by side. |
| **Voiceover** | *"Symptoms are spoken, in the language the patient actually speaks — seven are supported, detected automatically."* <br><br> *"Vitals next. And the paper prescription in the patient's hand gets photographed and read."* <br><br> *"Now watch this bit. The extraction is a draft. A human confirms it, field by field, before it counts as clinical input. Nothing the model reads reaches the record unverified."* |
| **Timing** | 25 seconds — the longest single block. Worth it. |
| **⚠️** | **Rehearse the Hindi phrase and confirm it transcribes** before the real take. If speech is flaky on the day, record this shot separately and retry until clean. |

---

### Shot 5 · 1:05–1:30 · The assessment — the safety argument

| | |
|---|---|
| **On screen** | Click **Run assessment**. Let the result render. Scroll slowly through: the tier badge, the patient summary, the **disease candidates block**, the warnings. Pause 2 seconds on the candidates. |
| **Voiceover** | *"The assessment runs. Four things contribute, in this order."* <br><br> *"A deterministic rules engine sets the risk tier. A classifier we trained on 244,938 labelled symptom vectors proposes ranked candidates. Vision and OCR can raise the tier. The language model writes the summary last — and only within those bounds."* <br><br> *"The model can raise a risk tier. It can never lower one. And it can never name a medicine."* |
| **Why this shot** | This is the single most defensible 25 seconds in your video. Deliver the last line slowly. |

---

### Shot 6 · 1:30–1:45 · Hand the case to a doctor

| | |
|---|---|
| **On screen** | Select a doctor from the district grid → click hand off → **the manifest appears**. Zoom (or crop in post) so the manifest counts are legible. |
| **Voiceover** | *"The case goes to a named doctor in the same district. And the system reports exactly what it sent — the assessment, the vitals, the symptoms, the documents, how many were verified, the photographs."* <br><br> *"'Case sent' with no statement of what was sent is how empty cases reach a doctor unnoticed."* |

---

### Shot 7 · 1:45–2:15 · The doctor's side — use two windows

| | |
|---|---|
| **On screen** | **Second browser window, doctor account, side by side or cut to full screen.** Show the queue — worst-first ordering visible. Open the handed-over case. Scroll the full evidence: vitals, symptoms, the document, the wound photo, the AI block. Then fill the review: decision, diagnosis, submit. |
| **Voiceover** | *"The doctor sees only cases assigned to them, worst risk first."* <br><br> *"They get everything the health worker captured — including the photograph, which is the part of a remote consultation you cannot reconstruct from text."* <br><br> *"The AI's contribution is shown separately from the doctor's own decision area. They record a diagnosis — which is mandatory — and sign."* |
| **Editing** | A genuine split-screen here is worth the extra effort. It shows both roles in one frame and proves the loop closes. |

---

### Shot 8 · 2:15–2:30 · The loop closing, live

| | |
|---|---|
| **On screen** | Cut back to the **health worker window, already open**, and show the notification arriving and the doctor's decision panel appearing — without a page refresh. |
| **Voiceover** | *"And the decision travels straight back to the health worker, in real time, over the same authenticated socket."* <br><br> *"They are standing with the patient. They should not have to telephone the district to find out what the doctor said."* |
| **⚠️** | This shot only works if the realtime socket is connected. **Test it immediately before recording.** If it fails on the day, fall back to showing the review panel after a refresh and cut the words "without a refresh." |

---

### Shot 9 · 2:30–2:45 · The emergency path

| | |
|---|---|
| **On screen** | New case, or a pre-prepared one, with red-flag vitals — SpO₂ below 90. Run the assessment. Show the **danger-zone screen**: the nearest district hospital, the distance, the emergency numbers. |
| **Voiceover** | *"When the rules detect a red flag — oxygen saturation below 90 — the case leaves the platform entirely."* <br><br> *"Nearest district hospital by real coordinates, no mapping API needed, and the national emergency lines. We show no bed count, because no live feed for that exists and an invented number on a referral screen is the most dangerous thing this system could display."* |

---

### Shot 10 · 2:45–3:00 · Close on the honesty

| | |
|---|---|
| **On screen** | Scroll to the landing page's **"not for clinical use"** notice. Hold 3 seconds. Then a single static end card: the live URL, the repo URL, team name, PS 26133. |
| **Voiceover** | *"One last thing, and it is on our own front page."* <br><br> *"Our triage thresholds and our medicine list come from published guidance. They have not been signed off by a registered practitioner for this deployment — so medication is withheld from the health worker entirely, and we say so."* <br><br> *"AI prepares the case. The doctor makes the medical decision. Everything you just saw is live at this link."* |
| **Why end here** | Ending on a limitation is counter-intuitive and it is exactly why it lands. It reframes every claim before it as measured rather than sold. |

---

## What NOT to include

| Cut | Why |
|---|---|
| **Any slide from the deck** | They already have the deck. Screen recording is your edge — do not spend it on PowerPoint. |
| **A team introduction** | Nobody is watching for your names. It is in the submission. |
| **A logo or title animation** | Costs you the first 5 seconds, which are the ones that matter most. |
| **Architecture diagrams** | They're on slide 2 and 3. In a video they are dead air. |
| **The admin dashboard** | Genuinely built, genuinely not the story. Cut it for time — it is the first thing to go. |
| **Code, an IDE, or a terminal** | Tempting, and it reads as padding. The running app is stronger evidence than source. |
| **Any real password on screen** | Pre-fill or type off-camera. Always. |
| **Loading spinners, empty states, retries** | Cut every one in post. |
| **"As you can see…" / "Now I will show you…"** | Filler. Say what the thing *does*, not what you are about to do. |
| **Background music with lyrics** | If you must use music, instrumental at 10–15% under the voice. Honestly, none is fine. |

---

## Recording checklist

**Before you press record**
- [ ] `ruralai-psi.vercel.app` loads and `/api/health` returns ONLINE
- [ ] `npm run preflight` passes — otherwise queues read "Closed" and the demo dies
- [ ] Doctor has cases assigned **for today** (`npm run seed:daily`)
- [ ] Realtime socket connects — check the notification bell
- [ ] Speech transcription tested with your actual microphone
- [ ] A prescription photo ready on the desktop
- [ ] A wound photo ready
- [ ] A red-flag case prepared for Shot 9
- [ ] Two browser profiles signed in — assistant and doctor
- [ ] Notifications off, bookmarks bar hidden, 1920×1080, 100% zoom

**Recording order** — do not shoot in script order. Shoot in this order and cut
together afterwards:
1. All the health-worker footage in one pass (Shots 3–6, 9)
2. All the doctor footage in one pass (Shot 7)
3. The loop-closing shot last, with both windows live (Shot 8)
4. The landing page shots (1, 2, 10)

**In post**
- [ ] Total runtime ≤ 3:10
- [ ] Every loading spinner cut
- [ ] Voiceover laid over clean footage, not recorded live
- [ ] The four statistics legible at 720p — zoom or crop if not
- [ ] Manifest counts legible in Shot 6
- [ ] End card holds 4 full seconds with the URL readable
- [ ] Watch it once at 720p on a phone. If a number is unreadable there, it is unreadable to a judge on a laptop.

---

## Timing summary

| Shot | Time | Runtime | Content |
|---|---|---|---|
| 1 | 0:10 | 0:10 | Cold open on live numbers |
| 2 | 0:15 | 0:25 | Problem, once |
| 3 | 0:15 | 0:40 | Health worker signs in |
| 4 | 0:25 | 1:05 | Speech · vitals · OCR + verification |
| 5 | 0:25 | 1:30 | Assessment and the safety bound |
| 6 | 0:15 | 1:45 | Handoff manifest |
| 7 | 0:30 | 2:15 | Doctor queue, case, signed review |
| 8 | 0:15 | 2:30 | Loop closes in real time |
| 9 | 0:15 | 2:45 | Emergency referral |
| 10 | 0:15 | 3:00 | The honesty close |

**If you must cut to 2:30:** drop Shot 2 to 8 seconds, drop Shot 9 entirely,
and trim Shot 4 to speech + OCR only. **Never cut Shots 5, 8 or 10** — those are
the safety argument, the closed loop, and the credibility close.
