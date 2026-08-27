# Database v2 — roles, regions, and row-level security

## Why v2 exists

v1 had three roles, free-text region columns, a globally visible patient table,
and **zero** row-level security policies. The role model in spec §3.8 cannot be
expressed on top of that: "manage doctors on a region basis" needs the region to
be a foreign key, and "admin cannot edit patient data" needs to hold in the
database, not only in an Express middleware that a direct PostgREST call skips.

## Applying it

```bash
cd backend
npm run inspect                  # what is in the target right now
npm run db:apply -- --confirm    # DESTRUCTIVE: drops v1, creates v2 + RLS
npm run seed                     # 36 states, 75 UP districts, demo staff + patients
npm run seed:root                # your own super_admin (see below)
```

`db:apply` refuses to run without `--confirm` and prints the target hostname
first. `inspect` warns if any patient row is not flagged `is_demo`.

### The super admin

Never seeded, never in the repo, never in the frontend bundle:

```bash
ROOT_ADMIN_EMAIL=you@example.com \
ROOT_ADMIN_PASSWORD='a long unique password' \
npm run seed:root
```

Re-running with the same email rotates the password instead of failing.

## The role model

Baseline from the spec was Admin / Doctor / Clinical Assistant. Three roles were
added because the spec's own wording implies them.

| Role | Scope | Can do | Cannot do |
| :--- | :--- | :--- | :--- |
| `super_admin` | National | Everything administrative; creates state admins | Read or edit any patient record |
| `state_admin` | One state | CRUD doctors, assistants, district admins in that state | Leave their state; touch clinical data |
| `district_admin` | One district | CRUD doctors and assistants in that district | Create peers or superiors; touch clinical data |
| `doctor` | One district | Review cases **assigned to them**, day-wise; video consult; prescribe | See another doctor's caseload; register patients |
| `clinic_assistant` | One district | Register patients, capture vitals/OCR, open visits, request consults | See other districts; review or prescribe |
| `auditor` | National or one state | Read audit logs and aggregate counts | See any patient record; change anything |

**Why `auditor`.** Without it, compliance review means handing someone an admin
account — and every admin account can mutate the roster. An auditor reads the
log and changes nothing, which is what that job actually needs.

**Why the admin split.** The spec says the administrator signs in with "a secret
email/password known only to the developer". That is a different account class
from the regional administrators who manage rosters daily. Collapsing them means
the everyday account also carries nationwide delete rights.

**Why `CREATABLE_ROLES` is asymmetric.** A district admin cannot create another
district admin or a state admin. A compromised district account therefore cannot
widen its own blast radius — it stays confined to the district it started in.

## Patient registration

Six fields, nothing else. Everything derivable is derived.

| # | Field | Rule |
| :--- | :--- | :--- |
| 1 | Aadhaar number | 12 digits, **the primary key** — there is no separate patient code |
| 2 | Patient name | 2-150 characters |
| 3 | Gender | male / female / other |
| 4 | Date of birth | Required. **Age is computed, never typed or stored** |
| 5 | Address | Village line 1 (+ optional line 2), district, state (dropdown), PIN |
| 6 | Phone | 10 digits, must start 6-9 (Indian mobile) |

**Why age is not a column.** A stored age is wrong the day after it is entered,
and the triage engine applies different thresholds to infants and to the
elderly — a stale age is a clinical error, not a display bug. `ageFromDob()`
computes it per request. Under two years it reports months (`17 months`), then
days, because "0 years" tells a doctor nothing about a neonate.

**Address vs. jurisdiction.** `address_state_id` / `address_district` are where
the patient lives. `clinic_district_id` is the sub-centre that holds the record,
taken from the assistant's own profile and never from the request. RLS and every
district filter key on the latter, so a migrant worker seen in Ballia who gives
a Bihar address stays on Ballia's register.

**District is free text with suggestions**, not a foreign key: district masters
are seeded for Uttar Pradesh only, and a patient may give an address anywhere in
India. The form offers the 75 UP districts through a `datalist` and accepts
anything else. State *is* a strict dropdown — all 36 states and UTs.

Registration is two steps: the Aadhaar is checked against the register first,
and the rest of the form opens only if it is new. A returning patient is the
common case at a village sub-centre, and typing eight fields to then hit
"already registered" is the slowest possible way to find that out.

Full Aadhaar is shown only on the single-patient view; lists render
`XXXX XXXX 9012`. Aadhaar Act 2016 §29(4) prohibits public display of the full
number, and a patient list on a shared clinic screen is that situation.

## Aadhaar storage

`patients.aadhaar_number VARCHAR(12) PRIMARY KEY`, stored as given, per §3.8 and
confirmed after the legal position was raised.

For whoever operates this later: raw Aadhaar at rest is restricted under the
Aadhaar Act 2016 §29 and the DPDP Act 2023, and UIDAI's standard pattern for
non-authorised entities is a hash plus last-4 for display. Two mitigations are
in place that do not change the specified design:

- Aadhaar is accepted in request **bodies only** — `POST /api/patients/lookup`,
  never a URL path or query string, because URLs reach access logs, proxy logs
  and browser history.
- `audit.middleware.js` redacts it to `****NNNN` before writing. The audit table
  is readable by every admin tier and by auditors, none of whom have clinical
  access; the identifier should not arrive there through the back door.

If the legal position is ever revisited, the change is contained: swap the
column for `aadhaar_hash` + `aadhaar_last4` and update the two lookup paths.

Demo Aadhaar numbers all begin with `0`. UIDAI allocates real numbers from 2-9,
so seeded values satisfy the 12-digit constraint while being structurally
incapable of colliding with a real person's number. Do not "fix" that leading
zero to look more realistic.

## Row-level security

`03_rls.sql` enables RLS on all 14 tables and defines the policies. The key
properties:

- **No admin role appears in any policy on `patients`, `visits`, or their
  children.** The spec's "Admin cannot edit patient data" is enforced by the
  database, not only by `clinicalAccess.middleware.js`.
- **`visits` is filtered by `assigned_doctor_id`** for doctors — the caseload
  rule, in the same place the data lives.
- **`audit_logs` has no UPDATE or DELETE policy for any role**, so with RLS on,
  entries cannot be altered or removed through the API at all.

The backend's service-role key still bypasses RLS by design. That is why the
Express guards remain: the two layers state the same rules, and either one
failing alone is not a breach. If you change a rule in one, change it in both.

## Seeded demo data

| | |
| :--- | ---: |
| States and union territories | 36 |
| Districts (Uttar Pradesh) | 75 |
| Doctors (5 per district) | 375 |
| Clinic assistants (1 per district) | 75 |
| District admins | 8 |
| State admins | 1 |
| Patients (5 per doctor) | 1,875 |
| Visits (risk-tiered, spread over 7 days) | 1,875 |

Every row carries `is_demo = true`. Re-running `npm run seed` clears the previous
demo rows and their Supabase Auth users first, so it is safe to run repeatedly.

Sign-ins are written to `DEMO_CREDENTIALS.md` in this directory, which is
gitignored. The super admin is not listed there.

A note on the count: the request said 32 states. India has 28 states and 8 union
territories — 36 regions, no subset of which is 32. The accurate list is seeded,
with `region_type` distinguishing the two, since the same request asked for the
state and district data to be correct.
