# From project to startup — Rural Health Grid

*A practical plan for a founding team of B.Tech second-year students from middle-class families: no outside money yet, a working product, and a problem the government has asked to be solved.*

---

## Where you already stand

Most student startups begin with an idea. You begin with more than that:

- **A working product, live on the internet**: assisted teleconsultation, voice and typed intake in Marathi, Hindi and 30 more languages, rules-first triage, closed-loop referral tracking, follow-up recall, consent, FHIR export, outcome dashboards — and a diagnosis model that learns from every visit a doctor completes, gated by a frozen benchmark so it can never get worse.
- **Recognition**
  - 🥇 **1st prize — IBM BOB Hackathon, CSJMU Kanpur**
  - 🥇 **1st prize — Ideathon, HBTU Kanpur**
  - 🎤 **Presented at AI MANTHAN 2.0** — explained this problem and solution to the **Governor of Uttar Pradesh**
  - Selected problem: **SIH 2026, PS 26133**, set by the **Government of Maharashtra (MSInS)**
- **A buyer who has already written down the need.** A government problem statement is a customer describing its problem in public. That is rare, and it is your wedge.

What you do not have yet: a clinical partner, a real pilot, a company, money. Every step below is about getting those, in order, cheaply.

---

## 1. The business in one paragraph

Rural Health Grid is software that lets a health worker at a village sub-centre capture a case in the patient's language, have it prepared by AI against government protocols, put it in front of a doctor anywhere, and track the patient until they reach hospital and come back for follow-up — measuring every outcome a health department is judged on. **The first customer is government** (state NHM and health departments), **the second is private and charitable clinic networks**, **the third is hospital chains** that need referral networks.

## 2. How it makes money

| Customer | What they buy | Indicative price | Why they pay |
|---|---|---|---|
| **State / district health department** (B2G) | Licence per sub-centre per month + implementation and training | ₹1,500–3,000 per centre per month; implementation fee per district | Outcomes they are measured on (referral completion, follow-up, waiting time) become numbers; ABDM-ready records |
| **NGO and CSR rural clinic programmes** (B2B) | Same product, self-serve onboarding | ₹2,000–5,000 per centre per month | Donors want outcome data; doctors are scarce |
| **Private clinics and small hospitals** (B2B SaaS) | Assisted teleconsult + referral network + records | ₹3,000–8,000 per month | More patients from surrounding villages; referrals that arrive |
| **Hospital chains** (enterprise) | Referral network across their feeder clinics, dashboards | Annual contract | A tracked referral is revenue that used to be lost |

Also worth knowing: under ABDM, the **Digital Health Incentive Scheme** pays facilities for digital health transactions — a reason for a clinic to adopt an ABDM-integrated system like this one (check current terms on the NHA site).

**Keep costs near zero until revenue:** today the whole platform runs on Railway, Supabase and free-tier AI for well under ₹3,000 a month. Paid AI for 20 centres is roughly ₹5,000–10,000 a month. You do not need an office.

## 3. The roadmap — month by month

### Next 30 days
1. **SIH 2026.** Win or not, the presentation *is* your first sales pitch to the Maharashtra government. Use PROJECT_DOCUMENTATION/SIH_PITCH_GUIDE.md.
2. **Founders' agreement, now, while it is easy.** Who is a founder, equity split, 4-year vesting with a 1-year cliff, what happens if someone leaves. One page, signed by everyone. The most common student-startup failure is not the product — it is the team breaking up with no agreement.
3. **Find a doctor.** A clinical advisor (a community-medicine faculty member, a PHC medical officer, a public-health MD) — ideally who will later join. Offer advisory equity (0.5–1 %). Judges, government and investors all ask "which doctor stands behind this?"
4. **Check your university's IP policy.** If the code was built for a college project, make sure the university does not own it, or get a written no-objection. Then keep it in a repository the founders control.
5. **Apply to an incubator.** You are in Kanpur: **SIIC, IIT Kanpur** (one of India's strongest, with medtech experience), and the incubation / IIC cells at **CSJMU** and **HBTU**, who already know you from your wins. Incubators give mentorship, legal help, cloud credits, and the route to government grants.

### Months 2–3
6. **One pilot site.** Go to a District Health Officer (Kanpur Nagar, or a Maharashtra district through MSInS) with the live demo. Ask for **a letter of intent for a 3-month pilot at one PHC and its sub-centres**, free of charge. Free is fine — the pilot's data is worth more than the fee.
7. **Ethics committee approval** for the pilot, through your medical partner's institution. Required before real patient data trains the model.
8. **DPIIT recognition** (Startup India) once the company exists — tax benefits and access to government schemes.
9. **Cloud credits**: AWS Activate, Google for Startups, Microsoft for Startups — usually available through the incubator.

### Months 3–6
10. **Register the company** when the first grant or paying customer is close: a **Private Limited Company** (investors and government tenders prefer it over an LLP). Cost: roughly ₹10,000–20,000 through the incubator's legal partner.
11. **Grants — non-dilutive money first.** Verify current amounts and deadlines on each scheme's site:
    - **Startup India Seed Fund Scheme** (via an approved incubator) — grant for proof of concept and prototype, and a further tranche as convertible debt
    - **NIDHI-PRAYAS** (DST) — prototyping grant through PRAYAS centres
    - **BIRAC BIG** (Biotechnology Ignition Grant) — for health technology with a clear innovation; your self-learning model and triage safety design are the pitch
    - **MSInS — Maharashtra Startup Week**: winning startups receive **work orders from government departments to pilot their product**. This is almost exactly your pathway; apply every year.
    - **Atal Innovation Mission** challenges and the state startup policies of Maharashtra and Uttar Pradesh
12. **Run the pilot.** Measure against the baseline the system already records: intake time, time to doctor, referral completion, follow-up adherence. Those numbers are your case study.

### Months 6–12
13. **First paying B2B customers** — an NGO or CSR-funded rural clinic programme is the fastest sale (weeks, not the months a government tender takes).
14. **Regulatory groundwork.** Software that supports clinical decisions can count as a medical device (Software as a Medical Device) under India's Medical Devices Rules 2017. Book a consultation through the incubator: keep the doctor making every decision (already true in the product) and plan CDSCO registration before selling triage as a clinical feature at scale. Follow the Telemedicine Practice Guidelines 2020 and the DPDP Act 2023 — consent and audit are already built.
15. **ABDM integration**: register in the ABDM sandbox as a Health Information Provider; the FHIR export is already there.

### Months 12–24
16. **District rollout** with pilot results in hand; first government work order or tender.
17. **Seed round** only now, with traction: angel networks, healthtech-focused seed funds, and the incubator's own fund. Raise to hire, not to survive.
18. **Hire**: one more full-stack engineer, one field implementation person (trains health workers — this is where rollouts succeed or fail), and a part-time clinical lead.

## 4. Doing it while studying

- **Protect the degree.** Do not drop out. Government buyers and investors take a B.Tech founder with a live pilot seriously; the degree costs you nothing in credibility.
- **Use the system you are in:** many universities let a startup count as the semester internship or major project — ask. Sprint in semester breaks; keep term-time to support and sales.
- **Split the roles:** one founder owns product and code, one owns pilots and government relations, one owns clinical and compliance. Everyone sells.
- **Weekly rhythm:** one founders' meeting, one written update to your mentor. Momentum comes from consistency, not all-nighters.

## 5. What could go wrong, and what to do

| Risk | Mitigation |
|---|---|
| Government sales take a long time | Pilot free, sell to NGOs/CSR programmes in parallel, apply to MSInS Startup Week for work orders |
| "Isn't this eSanjeevani?" | Position as complementary: intake, triage, referral tracking, follow-up and learning around the teleconsultation; offer to hand cases into eSanjeevani |
| Clinical liability | Doctor makes every decision (enforced in code); clear not-for-clinical-use status until validated; professional indemnity insurance once commercial |
| Regulation (SaMD) | Early CDSCO consultation; keep decision support advisory; build the quality documentation as you go |
| Data breach | Already: Aadhaar never in URLs or exports, consent, audit, CSP; next: a security audit before the first government deployment |
| Model quality | Frozen benchmark gate; learn only from doctor-confirmed, consented cases; publish accuracy honestly |
| Team split | Founders' agreement with vesting — this month |
| Money runs out | Stay on free and credit tiers; grants before equity; revenue from NGOs before government |

## 6. How to tell the story

> *"We are B.Tech students from Kanpur. We built a system that lets a village health worker in Hingoli speak a patient's complaint in Marathi, has AI prepare it against government protocols, puts it in front of a doctor anywhere, and tracks the patient until they reach hospital — and it learns from every case a doctor closes, without ever getting worse. It won the IBM BOB Hackathon and the HBTU Ideathon, we presented it to the Governor of Uttar Pradesh at AI MANTHAN 2.0, and it is live today. We are looking for one PHC to prove it."*

That last sentence is the whole plan. Everything else follows from the first pilot.

---

*Supporting documents: PROJECT_DOCUMENTATION/PS_26133_COVERAGE_AND_HANDOFF.md (what is built and how to finish the rest), PROJECT_DOCUMENTATION/SIH_PITCH_GUIDE.md (the presentation), PROJECT_DOCUMENTATION/ROADMAP_V3.md (the phased plan).*
