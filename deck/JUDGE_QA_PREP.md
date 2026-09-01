# Judge Q&A Prep — RuralAI · PS 26133 · SIH 2026

**Team UNFILTEREDENGINEERS** · Government of Maharashtra · MedTech/BioTech/HealthTech

---

## Before you read the answers — three rules

1. **Never bluff a number.** Every figure in your deck is sourced. If asked
   something you did not source, say *"I don't have a defensible number for
   that"* and move on. One invented statistic loses the round.
2. **Name your gaps before they find them.** The single strongest move you have
   is that your own front page says *"not for clinical use."* Use it.
3. **When you don't know, say what you'd measure.** *"I don't know. Here's how
   I'd find out"* scores better than a guess.

---

## The 15 questions

### Q1. "Why is this not just eSanjeevani? The government already has it."

**This is your hardest question. Expect it first.**

> eSanjeevani is excellent and it has done 43 crore consultations. It is a
> *consultation* platform — it connects a doctor to a patient over video.
>
> The problem statement asks for nine things around that: triage, longitudinal
> records, referral tracking, diagnostic coordination, medicine availability,
> queue management, follow-up, dashboards and multilingual capture. eSanjeevani
> does the consultation. We prepare the case *before* it and record the decision
> *after* it.
>
> Concretely: eSanjeevani cannot read the paper prescription in the patient's
> hand, cannot triage before the doctor picks up, and does not hold a structured
> record between visits. We do those three, then hand off. The problem statement
> says "strengthening, not replacing" — we are the layer that makes each
> eSanjeevani consultation start from a prepared case instead of a blank screen.

**Do not disparage eSanjeevani.** A Maharashtra panel may have helped deploy it.

---

### Q2. "What is actually working versus mocked? Be specific."

> Nothing on the deck is mocked. The link is live, the API answers, and you can
> sign in.
>
> **Fully built and running:** assisted teleconsultation, appointment and queue
> management, digital triage, longitudinal records, emergency referral routing,
> facility dashboards, multilingual speech, document OCR, wound-photo analysis.
>
> **Partially built:** referral *routing* works — 75 district hospitals by real
> coordinates — but referral *completion tracking* does not. Lab reports are read
> and interpreted, but we do not order diagnostics. Medicine availability is
> indexed with 2,503 real products and prices, but is not yet wired to a screen.
>
> **Not built:** high-risk follow-up scheduling, and ABDM/FHIR record exchange.
>
> That is 5 of the problem statement's 10 named components fully built, 3
> partial, 2 absent. I'd rather tell you that than have you find it.

---

### Q3. "How do I know your AI is safe? What if it gives wrong medical advice?"

> Three things, all enforced in code rather than promised.
>
> **One.** The AI cannot lower a risk tier. A deterministic rules engine sets the
> floor; the model may raise it and never lower it. Final tier is the maximum of
> rules, vision and model. If the model is down or returns garbage, the tier
> floors at MEDIUM and the case says it was not assessed by a model.
>
> **Two.** The model can never name a medicine. Not even paracetamol. Anything it
> writes about medication is deleted from the output — we discard it rather than
> filter it, because a model that ignores instructions must not be able to reach a
> health worker with a dose. Six automated tests search the serialised output for
> every drug name in our formulary and fail if one appears.
>
> **Three.** Nothing is fabricated. Silence returns no transcript. An unreadable
> prescription returns no extraction. We never substitute something plausible.

---

### Q4. "Your own site says 'not for clinical use.' So it doesn't work?"

**Do not get defensive. This is a strength.**

> It works. What has not happened is a registered practitioner signing off our
> triage thresholds and our formulary for this specific deployment and
> population.
>
> Our thresholds come from NEWS2, PALS and WHO IMNCI. That is good sourcing, and
> it is still not the same as a doctor putting their registration number against
> them. Until that happens, medication is suppressed entirely by default in
> production, and we say so on the front page.
>
> A team that quietly shipped unsigned dose guidance to a health worker would
> have a more impressive-looking demo and a much worse product. That signature is
> a named launch gate, not a code task — it is the longest-lead item we have and
> we started on it first.

---

### Q5. "How does this scale to all of Maharashtra?"

> The schema is already the right shape. States and districts are foreign keys,
> not text. Tenancy is the sub-centre. Patients are keyed on Aadhaar, which is
> already national and already unique. The doctor-queue query has a purpose-built
> composite index that stays an index scan whether the table holds two thousand
> rows or twenty million.
>
> Arithmetic: Maharashtra has roughly 10,500 sub-centres. At 20 assessments per
> sub-centre per day that is about 210,000 a day, or roughly 22 per second at a
> 3× peak. Postgres is not the constraint at that rate.
>
> The real constraints are three, and I know exactly what they are: rate limiting
> and socket fan-out are per-process today and need a shared Redis store, and the
> hosted-model rate limit is the ceiling on assessment throughput. That last one
> is why we have an on-premise model on the roadmap.

---

### Q6. "What does it cost to run?"

> The expensive parts of a telemedicine platform are structurally free here.
> Video is peer-to-peer, so there is no per-minute vendor fee. Referral routing
> is a local coordinate file, so there is no mapping API bill. Read-aloud uses the
> browser's own speech engine, so there is no per-character TTS cost. The disease
> classifier is a 3.6 MB file that runs on CPU.
>
> The only genuine per-assessment cost is the language-model call for the summary
> and the vision call for a photograph. Those are the two lines an owned,
> on-premise model removes — which is why it is the top of our roadmap.
>
> I want to be honest that I do not have a validated per-assessment rupee figure,
> because we have not run at volume. I can tell you the cost *structure*, not a
> unit cost.

---

### Q7. "What's your business model? Who pays?"

> Not the patient. A rural sub-centre patient cannot be the payer and designing
> as if they could be is how this class of product fails.
>
> Primary route is per-facility licensing under National Health Mission budgets —
> state health departments already procure software this way, and the unit of
> deployment here is exactly the unit they procure for.
>
> Second route: teleconsultations are already a reimbursable service under the
> Ayushman Bharat framework. Every consultation on our platform already produces
> the artefacts a claim needs as durable rows — participants, start and end times,
> the decision, the signed prescription, and an independent audit entry. The claim
> export is a query, not new capture.
>
> Third: the three highest-lead items — practitioner review, a physician-reviewed
> protocol corpus, and infrastructure — are exactly what CSR health budgets fund.

---

### Q8. "How do you handle patient data privacy? You're storing Aadhaar."

> Aadhaar is the primary key, as the specification asks. I know that carries
> obligations under the Aadhaar Act 2016 section 29 and the DPDP Act 2023, so
> here is what we do about it.
>
> It never travels in a URL — lookups are POSTs with the number in the body,
> because URLs reach access logs, proxy logs and browser history. Lists render
> masked as XXXX XXXX and the last four digits; the full number appears only on a
> single-patient view, because section 29(4) prohibits public display and a
> patient list on a shared clinic screen is that situation. It is redacted to four
> digits before anything is written to the audit log. Search matches a 12-digit
> term exactly, never as a substring, so partial digits cannot walk the keyspace.
>
> Wound photographs sit in a private bucket; the database stores a path, not a
> URL, and readers get a one-hour signed link.
>
> And we have documented the migration to a hashed column plus last-four if the
> legal position tightens — it is two lookup paths, contained.

---

### Q9. "Who is liable if the AI gets a patient's diagnosis wrong?"

> The AI does not diagnose. That is not a disclaimer, it is a structural fact —
> the system prompt forbids a definitive diagnosis, and the output carries ranked
> statistical *candidates* labelled as such, separately from the model's prose,
> precisely so nobody can mistake one for the other.
>
> Every clinical decision is made and signed by a doctor registered with the
> National Medical Commission. Our product principle is one sentence: AI prepares
> the case, the doctor makes the medical decision. The liability sits exactly
> where the NMC Telemedicine Practice Guidelines 2020 put it — with the
> registered practitioner.
>
> What we are accountable for is that the case we hand that doctor is complete
> and not fabricated. That is why the handoff returns a manifest of exactly what
> was sent, and why we refuse to invent a symptom, a transcript or a bed count.

---

### Q10. "Rural areas have no internet. How does this work offline?"

**Answer precisely — do not overclaim.**

> Partially today, fully on the roadmap, and I'll be exact about which is which.
>
> **Works with no network right now:** the triage rules engine, which is a pure
> function with no I/O and therefore cannot fail; referral routing, because the 75
> hospitals are a local coordinate file and the nearest is a haversine
> calculation; and read-aloud, which uses the browser's own engine.
>
> **Needs a network today:** the language-model summary and the vision call.
>
> So a sub-centre that loses connectivity still registers the patient, still gets
> a triage tier, and still gets a referral destination. What it loses is the
> narrative summary and photo analysis — a real degradation, and the system says
> so rather than pretending.
>
> Closing it is a 4-bit quantised model at the PHC, roughly 5 GB on a fanless box.
> Then the district link becomes a sync path rather than a dependency.

---

### Q11. "Why should a health worker trust this? What if they just ignore it?"

> Because it refuses to overreach, and they will notice that quickly.
>
> It does not tell them a diagnosis. It does not hand them a drug. It tells them
> what to do right now — first aid they are trained to perform — and it tells them
> when to stop and escalate. A tool that says "I do not know" earns trust faster
> than one that always has an answer.
>
> Two design details matter here. Vitals are pre-filled with typical adult values
> so they change two or three boxes instead of six — but the form tracks which
> fields they actually touched and warns before assessing on untouched defaults.
> And when the model does not find a confident match, we say so plainly instead of
> showing five near-tied guesses that invite over-reading.

---

### Q12. "Your accuracy is 97.4%. On what? That sounds too good."

**Do not let this stand unqualified. Correct it yourself.**

> Let me be precise, because that number is easy to over-read.
>
> It is **top-5** accuracy — the correct disease appears somewhere in the top five
> candidates — measured on 48,988 held-out cases across 582 disease classes.
> Top-1 is 85.4%. We report top-5 because the orchestrator only ever consumes a
> top-5 list and hands it to the doctor as evidence.
>
> The important caveat: that is measured on a public augmented dataset, not on
> Indian rural presentations. It measures generalisation *within that dataset*. It
> is not a claim about clinical accuracy at a Maharashtra sub-centre, and I would
> not present it as one.
>
> What makes it defensible is that it is reproducible — the training script is in
> the repo, the split is seeded, and the artifact is committed. You can re-run it.

---

### Q13. "Did you build this or assemble it from libraries?"

> The clinically-critical parts are ours and are the ones I would want you to
> read. The triage engine — age bands, the dehydration syndrome logic, the
> zero-is-a-reading handling — is written and unit-tested by us, 28 tests. The
> formulary gating engine with its eight sequential gates is ours. The symptom
> matcher went through four documented iterations because the first three
> produced clinically wrong matches, and every one of those failures is now a
> regression test.
>
> We use standard infrastructure — Express, Postgres, React, scikit-learn — and I
> would be suspicious of a team that had rewritten those.
>
> The one thing worth pointing at: we evaluated ZegoCloud and LiveKit for video,
> got both working, and still removed them in favour of our own peer-to-peer
> WebRTC, because a consultation is exactly two peers and that removes a
> per-minute cost and a vendor from the media path.

---

### Q14. "What happens when the AI is down?"

> The clinic keeps working, and it says what it lost.
>
> Every external dependency has a defined failure value and none of them is
> "return something plausible." Model down: the tier floors at MEDIUM with an
> explicit warning that this case was not assessed by a model. Inference service
> down: no candidates, with the text "absence of candidates is not evidence of
> good health" — because a doctor reading an empty list must not read it as
> reassurance. Speech fails: no transcript and a reason, never a substitute
> sentence. Vision fails: the photo is stored and flagged for direct doctor
> review.
>
> The bottom rung never fails, because the rules engine has no I/O.
>
> That behaviour is deliberate. An earlier version of our speech path substituted
> a fixed sentence describing fever and cough when transcription failed — and
> fever plus cough is a MEDIUM-tier rule, so a silent recording produced a triaged
> case describing a patient who did not exist. We found it, and it is why the
> whole system is built to fail visibly rather than plausibly.

---

### Q15. "What's genuinely novel here? Everyone has an AI health app."

> One sentence: **most teams wire a language model to a prompt. We use a language
> model that is bounded by a model we trained.**
>
> The classifier proposes ranked candidates from 244,938 labelled symptom
> vectors. The language model may re-rank and reject them. It may not introduce a
> disease outside that list. That bound is what keeps the output traceable to
> training data rather than to the model's imagination — and it means we can tell
> you where any given candidate came from.
>
> Around it: deterministic rules that the model cannot override, a medication
> boundary enforced by tests rather than by a prompt, and demographic gates that
> remove candidates that are anatomically impossible for the patient — because
> before we added them the classifier ranked ovarian cyst for a five-year-old boy,
> and a doctor who sees that once stops trusting the whole list.
>
> None of that is a bigger model. All of it is architecture.

---

## Five more they might ask

**"How long did this take?"** — Give the honest answer. The repo history is
public and shows the arc; do not inflate it.

**"How many people on the team?"** — Answer plainly. If you built it largely
alone, say so — with a live deployment and 135 tests, that is impressive, not
embarrassing.

**"Can we see the code?"** — `github.com/PriyamMishra853/RURALAI-`. Point them at
`PROJECT_DOCUMENTATION/` — 20 sections, and section 16 is a list of your own
known defects. Very few teams will show a judge their own bug list.

**"What if a doctor disagrees with the AI?"** — They just record their decision;
the AI's tier does not gate them. We store `agreed_with_ai` on every review
precisely so we can measure how often that happens — and that column is the
training signal for the next model.

**"Why Maharashtra?"** — The problem statement is Maharashtra's, and the
within-state inequity is the argument: anaemia runs 41.2% in Sindhudurg to 68.2%
in Gadchiroli. The same protocol has to reach both, and today it does not.

---

## ⚠️ Two traps specific to your deck

**Trap 1 — the geography.** Your live site currently reads
`UTTAR PRADESH · 75 DISTRICTS`, and your seed data is UP districts and UP
hospitals. Your deck is written for Maharashtra. **If a judge opens the link
before you reseed, they will see the mismatch.**

If it is not reseeded in time and they notice, say this and do not improvise:

> The platform is district-scoped by design and the seed is one state's grid. We
> built the pilot on Uttar Pradesh's 75 districts because that hospital
> coordinate set was already assembled. Migrating to Maharashtra's districts is a
> data change, not a code change — the states table already contains Maharashtra,
> and every scope in the system is a foreign key, not a hard-coded string.

Then move on immediately. Do not linger.

**Trap 2 — the unsigned formulary.** If a clinician on the panel presses on
medication, do not defend the dose values. Say: *"I am not asking you to accept
those numbers. That is exactly why they are suppressed."*

---

## Your closing line, if you get one

> Every claim on these six slides is either in the repository or at the live
> link. Including the ones about what we haven't finished.
