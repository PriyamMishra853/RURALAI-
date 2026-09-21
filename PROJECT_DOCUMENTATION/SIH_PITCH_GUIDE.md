# SIH 2026 — how to present Rural Health Grid to the judges

**PS 26133 · Government of Maharashtra (MSInS) · Team UNFILTEREDENGINEERS**

This is the honest verdict on the project, and the points to press hard in the presentation. Judges at SIH see dozens of "AI healthcare apps". What wins is showing, concretely, that yours solves *their* problem, runs today, and is safe to put in a public health system.

---

## 1. The verdict

**The product is strong where most entries are weak.** Most teams demo a chatbot and a dashboard. You have a working clinical workflow end to end — registration, voice/typed intake, triage, doctor review, teleconsultation, closed-loop referral, follow-up, consent, interoperable export, outcome dashboards — deployed and measurable, with 550+ automated tests. Lead with that.

**Your uniqueness is real, so say it plainly:** *the model learns from every visit a doctor completes — and it can never get worse, because every retrained model must beat the current one on a frozen benchmark before it goes live.* Nobody else in the room will have a self-improving model with a safety gate, consent, and a live demo.

**The weakness judges will probe:** clinical validation and real-world data. You do not have a hospital pilot yet, and the translations are machine-made. Do not hide this — name it and show the path (§5). Judges trust teams that know their gaps.

---

## 2. The one-line pitch

> **"A village health worker speaks or types the patient's complaint in Marathi; AI prepares the case against Ministry protocols; a doctor anywhere decides; the referral is tracked until the patient reaches hospital — and the system gets smarter with every visit a doctor completes."**

Say "strengthens, not replaces, the public health system" — it is the PS's own wording.

---

## 3. Slide order that works (8–10 slides)

1. **The problem, in one patient.** "Sunita, 34, Hingoli. Fever 5 days. Nearest doctor 40 km." Use the PS's own words: travel, specialist shortage, fragmented records, delayed referrals.
2. **Our answer in one picture** — the care pathway (it is the landing page hero): village sub-centre → health assistant → AI preparation → doctor → hospital → follow-up, one record throughout.
3. **Live demo** (§4). The strongest slide is not a slide.
4. **The self-learning model** — the diagram from PS_26133_COVERAGE_AND_HANDOFF.md §2.1, and the real numbers: base 87.3 % top-3 on 2,910 held-out cases; learned from doctor-confirmed visits; cannot be promoted if worse.
5. **Safety by design** — rules set the triage tier, AI may only raise it; medicines only from a signed formulary; every AI output is a draft until a person confirms it; nothing fabricated.
6. **Maps to every PS outcome** — the table in PS_26133_COVERAGE_AND_HANDOFF.md §0, with the dashboard screenshot showing referral completion and follow-up adherence *measured*.
7. **Standards and privacy** — FHIR R4 export, internal patient ID (never Aadhaar in exports), three separate consents, DPDP Act alignment, audit log of every disclosure.
8. **Built for Maharashtra, works anywhere** — 36 Maharashtra districts seeded, Marathi interface, 33 languages; low-connectivity design.
9. **Development pathway** (§5) — pilot → district → state.
10. **Team and traction** (§6).

---

## 4. The live demo script (4 minutes)

1. Sign in as a Hingoli assistant. Open patient 080000000301.
2. **CHATBOX:** type *"ताप तीन दिवसांपासून, BP 140/90, pulse 96, मधुमेह आहे"* (Marathi mixed with English). Show it fill duration, BP, pulse and history, and read the numbers back aloud. Apply; show the *heard — tap when checked* marks.
3. Run the assessment → tier and disease candidates.
4. Sign in as a Hingoli doctor; review; decide "refer to hospital". Show the referral slip with the QR code.
5. Open the QR link on a phone — the hospital confirms arrival with no login. Back in the clinic, the notification arrives.
6. Admin dashboard: outcomes by district, referral completion, and **the learning card**: the candidate model built automatically, scored against the live one.

Practise it on production the day before; keep a screen recording as a fallback in case the venue network fails.

---

## 5. The development pathway — say this with confidence

Judges decide on "can this actually be deployed". Show the road, with what exists at each step:

| Stage | What happens | What already exists |
|---|---|---|
| **1. Pilot — 1 PHC, 3 sub-centres (3 months)** | Real patients, one district, one hospital receiving referrals. Measure intake time, referral completion, follow-up adherence against the baseline. | Everything in the live system; baseline metrics start recording on day one. |
| **2. District — 1 district, ~40 sub-centres (6 months)** | Native-speaker-reviewed Marathi; ABHA linkage via ABDM sandbox; ethics approval so the model can learn from real, consented cases. | Consent model, FHIR export, learning pipeline, frozen benchmark. |
| **3. State — MSInS / NHM Maharashtra** | Integration with state systems (drug inventory, HMIS), paid AI tier, multi-instance scaling. | Outcome dashboards by district; idempotent writes for offline sync; scaling analysis (§3.9 of the handoff doc). |

**The line to use:** *"Everything in stage 1 is already built and deployed. We need a PHC to pilot it."*

---

## 6. Things to say forcefully

- **"AI prepares the case. The doctor makes the decision."** It is enforced in code: the rules engine sets the tier, the model can only raise it, and medicines never come from the model.
- **"It learns from every visit, and it can never get worse."** Frozen benchmark + consent + doctor-confirmed labels.
- **"Nothing is fabricated."** A default vital nobody measured is marked and never exported or learned from; a misheard number is checked before it counts.
- **"Every outcome in the problem statement is a number on our dashboard"** — referral completion, follow-up adherence, time to consultation — "with a baseline, so improvement can be proved."
- **"Interoperable by design"** — FHIR R4, internal patient identifier, ABDM-ready.
- **"It runs in the patient's language"** — Marathi, Hindi and 30 more, voice or typed.

## 7. Questions judges will ask, and the honest answers

| Question | Answer |
|---|---|
| How is this different from eSanjeevani? | eSanjeevani is the government's teleconsultation platform — a video call between a patient or health worker and a doctor. We are the layer around the call that it does not have: voice/typed intake in the local language, rules-first triage that decides *who needs a doctor now*, the closed-loop referral that tracks the patient to the hospital, follow-up recall, and a model that learns from every completed visit. We complement it and can hand cases into it — we do not compete with it. Say this before they ask. |
| Is it clinically validated? | Not yet — that is what the pilot is for. Triage thresholds come from published MoHFW guidance; medication is limited to a formulary a registered practitioner must sign; the system is marked not-for-clinical-use until then. |
| What if the AI is wrong? | It never decides. It ranks candidates; the doctor decides. The tier can only be raised by AI. Every AI value is a draft until a person confirms it. |
| How do you handle privacy? | Three separate consents, Aadhaar never in a URL or an export, every disclosure audited, nothing stored from voice intake. DPDP Act aligned. |
| Does the self-learning model risk drift? | Every candidate is scored on 2,910 cases it never saw; a worse model cannot be promoted. Only doctor-signed diagnoses from consented patients teach it. |
| What about no internet? | Writes are idempotent (the foundation for offline sync), the app is small, AI is optional to the core workflow. Full offline capture is the next build. |
| How will it scale? | Measured: ~9 KB per visit; the bottleneck is AI quota, solved by a paid tier at tens of dollars a month for 20 centres. |
| Why Maharashtra? | Seeded with all 36 districts and their hospitals, Marathi interface, and the PS is MSInS's. |
| Business model? | See STARTUP.md: government deployment first (NHM/state), then SaaS for private and charitable clinics, then hospital chains. |

## 8. Traction to put on the team slide

- **1st prize — IBM BOB Hackathon, CSJMU Kanpur**
- **1st prize — Ideathon, HBTU Kanpur**
- **Presented at AI MANTHAN 2.0** — explained this problem and solution to the **Governor of Uttar Pradesh**
- Now building a **startup** around it (STARTUP.md)
- Live on the internet today; 550+ automated tests; 111 districts across Maharashtra and Uttar Pradesh seeded

## 9. Deliverables checklist for SIH evaluation

- [ ] **Source code link** — GitHub repository (make sure `.env` is not in it; it is gitignored)
- [ ] **README with setup instructions** — `PROJECT_DOCUMENTATION/01-setup-guide.md` (link it from the root README)
- [ ] **Architecture document** — `PROJECT_DOCUMENTATION/ARCHITECTURE.md` + `03-data-flow.md`
- [ ] **Demo video** — record the §4 script (4–5 minutes), with Marathi CHATBOX input on screen
- [ ] **Technical presentation** — the §3 slide order
