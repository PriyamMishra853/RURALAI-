# 06 — Database Schema

> **Navigation:** [Index](README.md) · Previous: [05 — Directory Structure](05-directory-structure.md) · Next: [07 — Tech Stack](07-tech-stack.md)

PostgreSQL, hosted on Supabase. **18 tables**, **10 live enum types**, one aggregation
function, ~40 row-level-security policies.

Source of truth: `database/v2/`. The files under `database/schema.sql`,
`database/apply_all.sql`, `database/seed.sql` and `database/migrations/` are v1
and are superseded — see §9.

---

## 1. Enum types

Every enum, with its exact values in declaration order. Declaration order
matters: Postgres sorts an enum by it, which is why the doctor queue sorts risk
in Node instead (`RISK_ORDER` in `doctor.controller.js`).

| Enum | Values | Declared in |
|---|---|---|
| `staff_role` | `super_admin`, `state_admin`, `district_admin`, `doctor`, `clinic_assistant`, `auditor` | `02_schema.sql` |
| `staff_status` | `active`, `inactive`, `suspended` | `02_schema.sql` |
| `gender_type` | `male`, `female`, `other`, `unknown` | `02_schema.sql` |
| `risk_level` | `low`, `moderate`, `high`, `emergency` | `02_schema.sql` |
| `visit_status` | `in_progress`, `awaiting_ai`, `awaiting_doctor`, `in_consultation`, `completed`, `referred`, `cancelled` | `02_schema.sql` |
| `registration_mode` | `standard`, `abha_ocr`, `emergency_bypass` | `02_schema.sql` |
| `document_type` | `prescription`, `lab_report`, `abha_card`, `discharge_summary`, `other` | `02_schema.sql` |
| `consultation_kind` | `SCHEDULED`, `INSTANT` | `05_consultations.sql` |
| `consultation_state` | `SCHEDULED`, `ACTIVE`, `COMPLETED`, `CANCELLED`, `MISSED` | `05_consultations.sql` |
| `notification_event` | `CONSULTATION_SCHEDULED`, `CONSULTATION_REMINDER`, `CONSULTATION_STARTED`, `CONSULTATION_CANCELLED`, `CONSULTATION_COMPLETED`, `CONSULTATION_FAILED`, `DOCTOR_REVIEW_COMPLETED` (added by `06`), `CASE_ASSIGNED` (added by `07`) | `05`, `06`, `07` |

Two enums declared in `02_schema.sql` — `consultation_status`
(`waiting/active/completed/cancelled/no_show`) and `appointment_status` — belong
to the pre-state-machine design. `05_consultations.sql` drops and rebuilds
`consultations` around `consultation_state`, so `consultation_status` survives as
an orphan type that no live table uses.

### `risk_level` — three tiers in code, four in the database

The rule engine works in `LOW / MEDIUM / HIGH`; the column stores
`low / moderate / high / emergency`. **`medium` is not a value the enum accepts**,
and writing it was a silent insert failure for the commonest tier there is. Two
translators exist:

| Direction | Function | File |
|---|---|---|
| Engine → enum | `RISK_TO_ENUM` + `immediate_referral ⇒ 'emergency'` | `ai.controller.js` |
| Either → enum, or `null` | `normaliseRiskTier()` | `visit.controller.js` |

`normaliseRiskTier` also accepts `MILD`, `SEVERE` and `CRITICAL`, and returns
`null` for anything unrecognised rather than guessing. Eight tests in
`backend/tests/visitRiskTier.test.js` assert it only ever returns a value the
enum accepts.

---

## 2. Entity–relationship diagram

```mermaid
erDiagram
    states ||--o{ districts : contains
    states ||--o{ staff_profiles : "scopes"
    districts ||--o{ staff_profiles : "scopes"
    states ||--o{ patients : "address_state_id"
    districts ||--o{ patients : "clinic_district_id (tenancy)"

    staff_profiles ||--o| doctor_profiles : "extends (doctor only)"
    staff_profiles ||--o{ doctor_schedules : "working windows"
    staff_profiles ||--o{ patients : "registered_by"
    staff_profiles ||--o{ visits : "assistant_id / assigned_doctor_id"
    staff_profiles ||--o{ audit_logs : "actor_id"
    staff_profiles ||--o{ notifications : "recipient_id"

    patients ||--o{ visits : "patient_id = aadhaar_number"
    patients ||--o{ patient_documents : has
    patients ||--o{ patient_images : has
    patients ||--o{ consultations : "subject of"

    visits ||--o{ visit_vitals : records
    visits ||--o{ visit_symptoms : records
    visits ||--o{ patient_documents : attaches
    visits ||--o{ patient_images : attaches
    visits ||--o{ ai_assessments : produces
    visits ||--o{ consultations : schedules
    visits ||--o{ doctor_reviews : receives
    visits ||--o{ prescriptions : yields

    consultations ||--o{ notifications : "may reference"

    states {
        uuid id PK
        varchar100 name UK
        varchar5 code UK "ISO 3166-2:IN"
        varchar20 region_type "state | union_territory"
        timestamptz created_at
    }

    districts {
        uuid id PK
        uuid state_id FK
        varchar100 name "UNIQUE (state_id, name)"
        timestamptz created_at
    }

    staff_profiles {
        uuid id PK
        uuid auth_user_id UK "auth.users.id"
        varchar150 full_name
        varchar255 email UK
        varchar20 phone
        staff_role role
        staff_status status
        uuid state_id FK
        uuid district_id FK
        varchar50 preferred_language
        boolean is_demo
        uuid created_by FK
        timestamptz created_at
        timestamptz updated_at
    }

    doctor_profiles {
        uuid staff_id PK_FK
        varchar100 registration_number UK "NMC / state council"
        varchar150 specialization
        varchar255 qualification
        integer years_of_experience
        text_array consultation_languages
        boolean is_available_for_consultation
    }

    patients {
        varchar12 aadhaar_number PK "12 digits"
        varchar150 full_name
        gender_type gender
        date date_of_birth "age is DERIVED, never stored"
        varchar150 village_line1
        varchar150 village_line2
        varchar100 address_district
        uuid address_state_id FK
        char6 pin_code
        varchar10 phone
        uuid clinic_district_id FK "TENANCY"
        uuid clinic_state_id FK
        varchar17 abha_number UK
        registration_mode registration_mode
        timestamptz reconciled_at
        boolean is_demo
        uuid registered_by FK
        timestamptz created_at
        timestamptz updated_at
    }

    visits {
        uuid id PK
        varchar30 visit_code UK
        varchar12 patient_id FK
        uuid assistant_id FK
        uuid assigned_doctor_id FK "the caseload rule"
        timestamptz assigned_at
        uuid district_id FK
        text chief_complaint
        varchar100 symptom_duration
        integer symptom_duration_value
        varchar10 symptom_duration_unit
        text medical_history
        text known_allergies
        text current_medications
        visit_status status
        risk_level risk_level
        date visit_date "GENERATED STORED, IST"
        timestamptz deleted_at
        uuid deleted_by FK
        text deletion_reason
        boolean is_demo
        timestamptz created_at
        timestamptz updated_at
    }

    visit_vitals {
        uuid id PK
        uuid visit_id FK
        numeric temperature_f
        integer blood_pressure_systolic
        integer blood_pressure_diastolic
        integer pulse_bpm
        integer spo2_percent
        integer respiratory_rate
        integer blood_glucose_mgdl
        uuid recorded_by FK
        timestamptz recorded_at
    }

    visit_symptoms {
        uuid id PK
        uuid visit_id FK
        text description
        varchar20 source "typed | speech | ocr"
        timestamptz created_at
    }

    patient_documents {
        uuid id PK
        varchar12 patient_id FK
        uuid visit_id FK
        document_type document_type
        text storage_path
        varchar100 mime_type
        text ocr_text
        uuid verified_by FK "MANDATORY human verification"
        timestamptz verified_at
        jsonb extracted_data
        uuid uploaded_by FK
        timestamptz created_at
    }

    patient_images {
        uuid id PK
        varchar12 patient_id FK
        uuid visit_id FK
        varchar60 storage_bucket
        text storage_path
        text image_url "deliberately NULL"
        varchar100 mime_type
        jsonb observation
        varchar10 severity_impression
        varchar60 engine
        uuid uploaded_by FK
        timestamptz created_at
    }

    ai_assessments {
        uuid id PK
        uuid visit_id FK
        risk_level risk_level
        text patient_summary
        jsonb first_aid_steps
        jsonb protocol_matches
        jsonb warnings
        jsonb missing_information
        varchar60 recommended_next_action
        boolean requires_doctor
        varchar120 generated_by
        timestamptz created_at
    }

    doctor_schedules {
        uuid id PK
        uuid doctor_id FK
        smallint day_of_week "0 = Sunday"
        time start_time
        time end_time
        boolean is_off
        timestamptz created_at
        timestamptz updated_at
    }

    consultations {
        uuid id PK
        uuid visit_id FK
        varchar12 patient_id FK
        uuid doctor_id FK
        uuid assistant_id FK
        consultation_kind consultation_type
        consultation_state status
        timestamptz scheduled_start_time
        timestamptz scheduled_end_time
        timestamptz actual_start_time
        timestamptz actual_end_time
        varchar30 meeting_provider
        text meeting_room_id
        text meeting_url
        uuid cancelled_by FK
        text cancellation_reason
        timestamptz reminder_sent_at
        timestamptz created_at
        timestamptz updated_at
    }

    doctor_reviews {
        uuid id PK
        uuid visit_id FK
        uuid doctor_id FK
        varchar40 decision
        text clinical_notes
        boolean agreed_with_ai
        timestamptz created_at
    }

    prescriptions {
        uuid id PK
        uuid visit_id FK
        uuid doctor_id FK
        varchar40 prescription_code UK
        jsonb items
        text advice
        timestamptz signed_at
        timestamptz created_at
    }

    notifications {
        uuid id PK
        uuid consultation_id FK
        uuid recipient_id FK
        staff_role recipient_role
        notification_event event_type
        jsonb payload
        timestamptz created_at
        timestamptz read_at
    }

    audit_logs {
        uuid id PK
        uuid actor_id FK
        staff_role actor_role
        varchar80 action
        varchar60 entity_type
        text entity_id "TEXT — a patient key is an Aadhaar, not a UUID"
        jsonb metadata "redacted at write time"
        inet ip_address
        timestamptz created_at
    }
```

---

## 3. Region hierarchy

### `states`

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK, `DEFAULT gen_random_uuid()` |
| `name` | `VARCHAR(100)` | NOT NULL, UNIQUE |
| `code` | `VARCHAR(5)` | NOT NULL, UNIQUE — ISO 3166-2:IN subdivision code |
| `region_type` | `VARCHAR(20)` | NOT NULL, `DEFAULT 'state'`, CHECK ∈ (`state`, `union_territory`) |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, `DEFAULT NOW()` |

Seeded with **36** rows. India has 28 states and 8 union territories;
`region_type` distinguishes them.

### `districts`

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `state_id` | `UUID` | NOT NULL, FK → `states(id)` ON DELETE CASCADE |
| `name` | `VARCHAR(100)` | NOT NULL |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, `DEFAULT NOW()` |

`UNIQUE (state_id, name)` · `idx_districts_state ON districts(state_id)`

Seeded with the **75 districts of Uttar Pradesh**. `GET /api/regions/districts`
returns an empty list for other states, which is expected: the registration form
offers these as `datalist` suggestions and accepts free text, because a patient
may give an address anywhere in India.

**Why this exists as real rows.** v1 stored `state` and `district` as free text on
every patient, so "Uttar Pradesh", "UP" and "uttar pradesh" were three different
regions and no admin scope could be expressed against them.

---

## 4. Staff

### `staff_profiles`

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `auth_user_id` | `UUID` | UNIQUE — links to Supabase `auth.users.id`. **The password lives there, never here** |
| `full_name` | `VARCHAR(150)` | NOT NULL |
| `email` | `VARCHAR(255)` | NOT NULL, UNIQUE |
| `phone` | `VARCHAR(20)` | |
| `role` | `staff_role` | NOT NULL |
| `status` | `staff_status` | NOT NULL, `DEFAULT 'active'` |
| `state_id` | `UUID` | FK → `states(id)` ON DELETE RESTRICT |
| `district_id` | `UUID` | FK → `districts(id)` ON DELETE RESTRICT |
| `preferred_language` | `VARCHAR(50)` | NOT NULL, `DEFAULT 'Hindi'` |
| `is_demo` | `BOOLEAN` | NOT NULL, `DEFAULT FALSE` |
| `created_by` | `UUID` | FK → `staff_profiles(id)` ON DELETE SET NULL — self-referential |
| `created_at`, `updated_at` | `TIMESTAMPTZ` | NOT NULL, `DEFAULT NOW()`; `updated_at` maintained by `trg_staff_touch` |

**`CONSTRAINT staff_scope_matches_role`** — the scope column set must match the
role, so a scoped admin can never silently widen to nationwide:

```sql
(role = 'super_admin'      AND state_id IS NULL     AND district_id IS NULL) OR
(role = 'auditor'          AND district_id IS NULL)                          OR
(role = 'state_admin'      AND state_id IS NOT NULL AND district_id IS NULL) OR
(role = 'district_admin'   AND state_id IS NOT NULL AND district_id IS NOT NULL) OR
(role = 'doctor'           AND state_id IS NOT NULL AND district_id IS NOT NULL) OR
(role = 'clinic_assistant' AND state_id IS NOT NULL AND district_id IS NOT NULL)
```

Indexes: `idx_staff_role`, `idx_staff_district`, `idx_staff_state`,
`idx_staff_auth_user`.

**There is deliberately no self-registration path to this table.** Rows are
created only by `POST /api/admin/users`, which requires an admin role. The
`POST /api/auth/register` route that used to exist accepted an unauthenticated
`role` field.

### `doctor_profiles`

| Column | Type | Constraints |
|---|---|---|
| `staff_id` | `UUID` | PK **and** FK → `staff_profiles(id)` ON DELETE CASCADE |
| `registration_number` | `VARCHAR(100)` | NOT NULL, UNIQUE — NMC or state council |
| `specialization` | `VARCHAR(150)` | NOT NULL |
| `qualification` | `VARCHAR(255)` | |
| `years_of_experience` | `INTEGER` | CHECK ≥ 0 |
| `consultation_languages` | `TEXT[]` | NOT NULL, `DEFAULT ARRAY['Hindi','English']` |
| `is_available_for_consultation` | `BOOLEAN` | NOT NULL, `DEFAULT TRUE` |
| `created_at`, `updated_at` | `TIMESTAMPTZ` | `trg_doctor_touch` |

### `doctor_schedules` — `05_consultations.sql`

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `doctor_id` | `UUID` | NOT NULL, FK → `staff_profiles(id)` ON DELETE CASCADE |
| `day_of_week` | `SMALLINT` | NOT NULL, CHECK 0–6 (**0 = Sunday**) |
| `start_time` | `TIME` | NOT NULL |
| `end_time` | `TIME` | NOT NULL |
| `is_off` | `BOOLEAN` | NOT NULL, `DEFAULT FALSE` |
| `created_at`, `updated_at` | `TIMESTAMPTZ` | `trg_schedules_touch` |

`CONSTRAINT schedule_window_ordered CHECK (is_off OR end_time > start_time)` ·
`UNIQUE (doctor_id, day_of_week)` ·
`idx_schedules_doctor_day ON (doctor_id, day_of_week)`

**A missing row means "not working that day"**, the same as `is_off = true`. Both
are handled, because a partially filled schedule is the normal state of real
rosters — and an empty table makes every booking date read "Closed", which is
what `npm run preflight` check 1 exists to catch.

---

## 5. Clinical core

### `patients`

The Aadhaar number **is** the primary key. There is no separate patient code: a
second human-facing key is one more thing to type, print and mistype, and staff
already ask for Aadhaar at the counter.

| Column | Type | Constraints |
|---|---|---|
| `aadhaar_number` | `VARCHAR(12)` | **PK**, CHECK `~ '^[0-9]{12}$'` |
| `full_name` | `VARCHAR(150)` | NOT NULL, CHECK `length(trim(full_name)) >= 2` |
| `gender` | `gender_type` | NOT NULL |
| `date_of_birth` | `DATE` | NOT NULL, CHECK `<= CURRENT_DATE AND >= CURRENT_DATE - INTERVAL '120 years'` |
| `village_line1` | `VARCHAR(150)` | nullable **after `09`** |
| `village_line2` | `VARCHAR(150)` | |
| `address_district` | `VARCHAR(100)` | nullable **after `09`**. Free text, not a FK |
| `address_state_id` | `UUID` | nullable **after `09`**, FK → `states(id)` ON DELETE RESTRICT |
| `pin_code` | `CHAR(6)` | nullable **after `09`**, CHECK `~ '^[1-9][0-9]{5}$'` |
| `phone` | `VARCHAR(10)` | nullable **after `09`**, CHECK `~ '^[6-9][0-9]{9}$'` |
| `clinic_district_id` | `UUID` | NOT NULL, FK → `districts(id)` ON DELETE RESTRICT — **tenancy** |
| `clinic_state_id` | `UUID` | NOT NULL, FK → `states(id)` ON DELETE RESTRICT |
| `abha_number` | `VARCHAR(17)` | UNIQUE. Populated by ABHA card OCR, **never typed** |
| `registration_mode` | `registration_mode` | NOT NULL, `DEFAULT 'standard'` |
| `reconciled_at` | `TIMESTAMPTZ` | Set when an `emergency_bypass` record has had its real details filled in |
| `is_demo` | `BOOLEAN` | NOT NULL, `DEFAULT FALSE` |
| `registered_by` | `UUID` | FK → `staff_profiles(id)` ON DELETE SET NULL |
| `created_at`, `updated_at` | `TIMESTAMPTZ` | `trg_patients_touch` |

**`CONSTRAINT patients_identity_required_unless_emergency`** (added by `09`):

```sql
registration_mode = 'emergency_bypass'
OR (phone IS NOT NULL AND pin_code IS NOT NULL AND village_line1 IS NOT NULL
    AND address_district IS NOT NULL AND address_state_id IS NOT NULL)
```

A CHECK passes on NULL, so the existing format regexes still reject a *malformed*
PIN while permitting a *missing* one.

Indexes: `idx_patients_clinic_district`, `idx_patients_address_state`,
`idx_patients_abha`, `idx_patients_name ON (lower(full_name))`,
`idx_patients_phone`, and the partial
`idx_patients_unreconciled_emergency ON (clinic_district_id, created_at DESC)
WHERE registration_mode = 'emergency_bypass' AND reconciled_at IS NULL`.

#### Three deliberate decisions

**Age is not a column.** A stored age is wrong the day after it is entered, and
the triage engine applies different thresholds to infants and to the elderly — a
stale age is a clinical error, not a display bug. `ageFromDob()` computes it per
request; `ageDisplay()` reports months under two years and days under one month.

**Address is not jurisdiction.** `address_state_id` / `address_district` are
where the patient lives. `clinic_district_id` is the sub-centre holding the
record, taken from the assistant's own profile and never from the request. RLS
and every district filter key on the latter, so a migrant worker seen in Ballia
who gives a Bihar address stays on Ballia's register.

**District is free text with suggestions**, not a foreign key, because district
masters exist only for UP and a patient may give an address anywhere in India.
State *is* a strict dropdown.

#### Aadhaar at rest

Stored as given, per the specification. Recorded here for whoever operates this
later: raw Aadhaar at rest is restricted under the Aadhaar Act 2016 §29 and the
DPDP Act 2023, and UIDAI's standard pattern for non-authorised entities is a hash
plus last-4 for display. Two mitigations that do not change the specified design
are in place:

- Aadhaar is accepted in **request bodies only** — `POST /api/patients/lookup`,
  never a URL path or query string, because URLs reach access logs, proxy logs
  and browser history.
- `audit.middleware.js` redacts it to `****NNNN` before writing, because the audit
  table is readable by every admin tier and by auditors, none of whom have
  clinical access.

If the legal position is revisited the change is contained: swap the column for
`aadhaar_hash` + `aadhaar_last4` and update the two lookup paths.

Demo Aadhaar numbers all begin with `0` and emergency guest identifiers begin with
`1`. UIDAI allocates real numbers from 2–9, so both satisfy the 12-digit
constraint while being structurally incapable of colliding with a real person's
number.

### `visits`

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `visit_code` | `VARCHAR(30)` | NOT NULL, UNIQUE — `VIS-YYYY-NNNNNN` |
| `patient_id` | `VARCHAR(12)` | NOT NULL, FK → `patients(aadhaar_number)` ON DELETE CASCADE |
| `assistant_id` | `UUID` | FK → `staff_profiles(id)` ON DELETE SET NULL |
| `assigned_doctor_id` | `UUID` | FK → `staff_profiles(id)` ON DELETE SET NULL — **NULL until triage assigns** |
| `assigned_at` | `TIMESTAMPTZ` | |
| `district_id` | `UUID` | NOT NULL, FK → `districts(id)` ON DELETE RESTRICT |
| `chief_complaint` | `TEXT` | |
| `symptom_duration` | `VARCHAR(100)` | Rendered text, read by the AI prompt |
| `symptom_duration_value` | `INTEGER` | **`04`** — CHECK NULL or 1–999 |
| `symptom_duration_unit` | `VARCHAR(10)` | **`04`** — CHECK NULL or ∈ (`days`, `months`, `years`) |
| `medical_history` | `TEXT` | **`04`** |
| `known_allergies` | `TEXT` | **`04`** |
| `current_medications` | `TEXT` | |
| `status` | `visit_status` | NOT NULL, `DEFAULT 'in_progress'` |
| `risk_level` | `risk_level` | nullable until assessed |
| `visit_date` | `DATE` | **GENERATED ALWAYS AS `((created_at AT TIME ZONE 'Asia/Kolkata')::date)` STORED** |
| `deleted_at` | `TIMESTAMPTZ` | **`08`** |
| `deleted_by` | `UUID` | **`08`** — FK → `staff_profiles(id)` ON DELETE SET NULL |
| `deletion_reason` | `TEXT` | **`08`** |
| `is_demo` | `BOOLEAN` | NOT NULL, `DEFAULT FALSE` |
| `created_at`, `updated_at` | `TIMESTAMPTZ` | `trg_visits_touch` |

Indexes:

| Index | Definition | Why |
|---|---|---|
| `idx_visits_patient` | `(patient_id)` | Patient history |
| `idx_visits_district` | `(district_id)` | Assistant scoping |
| `idx_visits_doctor_queue` | `(assigned_doctor_id, visit_date, risk_level)` | **The doctor queue query, exactly.** Stays an index scan at any table size |
| `idx_visits_live` (`08`) | `(district_id, created_at DESC) WHERE deleted_at IS NULL` | Almost every read wants live rows, and almost every row is live |

`visit_date` is generated so it can never drift from `created_at`, and it is
computed in IST because that is the clinic timezone and the day-wise queue is a
clinic day, not a UTC day.

### `visit_vitals`

| Column | Type | CHECK range |
|---|---|---|
| `id` | `UUID` | PK |
| `visit_id` | `UUID` | NOT NULL, FK → `visits(id)` ON DELETE CASCADE |
| `temperature_f` | `NUMERIC(4,1)` | 80–115 |
| `blood_pressure_systolic` | `INTEGER` | 40–300 |
| `blood_pressure_diastolic` | `INTEGER` | 20–200 |
| `pulse_bpm` | `INTEGER` | 20–250 |
| `spo2_percent` | `INTEGER` | 50–100 |
| `respiratory_rate` | `INTEGER` | 5–80 |
| `blood_glucose_mgdl` | `INTEGER` | 20–800 |
| `recorded_by` | `UUID` | FK → `staff_profiles(id)` ON DELETE SET NULL |
| `recorded_at` | `TIMESTAMPTZ` | NOT NULL, `DEFAULT NOW()` |

`idx_vitals_visit ON (visit_id)`

The database ranges are the **outer** physiological bound.
`validateVitalsRanges()` in `visit.controller.js` applies slightly tighter ones
(temperature 95–107, SpO₂ 50–100) plus a cross-field check that diastolic is
below systolic. Both layers are wider than the *alerting* thresholds on purpose:
a genuine SpO₂ of 68 must be enterable, because that is exactly the reading that
needs to reach a doctor fastest.

### `visit_symptoms`

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `visit_id` | `UUID` | NOT NULL, FK → `visits(id)` ON DELETE CASCADE |
| `description` | `TEXT` | NOT NULL |
| `source` | `VARCHAR(20)` | NOT NULL, `DEFAULT 'typed'`, CHECK ∈ (`typed`, `speech`, `ocr`) |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, `DEFAULT NOW()` |

`idx_symptoms_visit ON (visit_id)`. `source` is provenance a doctor can act on:
a spoken symptom passed through transcription and a typed one did not.

### `patient_documents`

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `patient_id` | `VARCHAR(12)` | NOT NULL, FK → `patients(aadhaar_number)` ON DELETE CASCADE |
| `visit_id` | `UUID` | FK → `visits(id)` ON DELETE SET NULL |
| `document_type` | `document_type` | NOT NULL, `DEFAULT 'other'` |
| `storage_path` | `TEXT` | |
| `mime_type` | `VARCHAR(100)` | |
| `ocr_text` | `TEXT` | Raw transcription |
| `verified_by` | `UUID` | FK → `staff_profiles(id)` ON DELETE SET NULL |
| `verified_at` | `TIMESTAMPTZ` | **NULL until a human confirms.** This is the gate |
| `extracted_data` | `JSONB` | NOT NULL, `DEFAULT '{}'` |
| `uploaded_by` | `UUID` | FK → `staff_profiles(id)` ON DELETE SET NULL |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, `DEFAULT NOW()` |

`idx_documents_patient`, `idx_documents_visit`

An extraction with `verified_at IS NULL` is a **draft**. `handOffVisit` reports
verified and total document counts separately in its manifest.

### `patient_images` — `06_patient_images.sql`

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `patient_id` | `VARCHAR(12)` | FK → `patients(aadhaar_number)` ON DELETE CASCADE |
| `visit_id` | `UUID` | NOT NULL, FK → `visits(id)` ON DELETE CASCADE |
| `storage_bucket` | `VARCHAR(60)` | `'injury-photos'` |
| `storage_path` | `TEXT` | **The durable reference** |
| `image_url` | `TEXT` | **Deliberately NULL** — a stored link that expires is worse than none |
| `mime_type` | `VARCHAR(100)` | |
| `observation` | `JSONB` | NOT NULL, `DEFAULT '{}'` — the full vision payload |
| `severity_impression` | `VARCHAR(10)` | CHECK NULL or ∈ (`LOW`, `MEDIUM`, `HIGH`) |
| `engine` | `VARCHAR(60)` | Which model produced the observation |
| `uploaded_by` | `UUID` | FK → `staff_profiles(id)` ON DELETE SET NULL |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, `DEFAULT NOW()` |

`idx_patient_images_visit`, `idx_patient_images_patient`

The observation is stored **with** the file because it is what the doctor
actually reads, and re-running the model on an old photo would cost money and
could return something different.

### `ai_assessments`

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `visit_id` | `UUID` | NOT NULL, FK → `visits(id)` ON DELETE CASCADE |
| `risk_level` | `risk_level` | NOT NULL |
| `patient_summary` | `TEXT` | |
| `first_aid_steps` | `JSONB` | NOT NULL, `DEFAULT '[]'` |
| `protocol_matches` | `JSONB` | NOT NULL, `DEFAULT '[]'` — title, source, version, guidance |
| `warnings` | `JSONB` | NOT NULL, `DEFAULT '[]'` |
| `missing_information` | `JSONB` | NOT NULL, `DEFAULT '[]'` |
| `recommended_next_action` | `VARCHAR(60)` | `EMERGENCY_HOSPITAL_REFERRAL` / `URGENT_DOCTOR_REVIEW` / `DOCTOR_REVIEW` / `PROTOCOL_CARE_DOCTOR_OPTIONAL` |
| `requires_doctor` | `BOOLEAN` | NOT NULL, `DEFAULT TRUE` |
| `generated_by` | `VARCHAR(120)` | e.g. `groq:openai/gpt-oss-120b` or `rule-engine-fallback` — **provenance on every row** |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, `DEFAULT NOW()` |

`idx_assessments_visit ON (visit_id)`

**There is no medication column.** v1 had `ai_recommendations` with a
`recommendation_type = 'medicine'` variant. v2 has no table capable of storing a
model-authored medication at all.

### `consultations` — rebuilt in `05_consultations.sql`

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `visit_id` | `UUID` | NOT NULL, FK → `visits(id)` ON DELETE CASCADE |
| `patient_id` | `VARCHAR(12)` | NOT NULL, FK → `patients(aadhaar_number)` ON DELETE CASCADE |
| `doctor_id` | `UUID` | NOT NULL, FK → `staff_profiles(id)` ON DELETE **RESTRICT** |
| `assistant_id` | `UUID` | FK → `staff_profiles(id)` ON DELETE SET NULL |
| `consultation_type` | `consultation_kind` | NOT NULL, `DEFAULT 'SCHEDULED'` |
| `status` | `consultation_state` | NOT NULL, `DEFAULT 'SCHEDULED'` |
| `scheduled_start_time` | `TIMESTAMPTZ` | NOT NULL |
| `scheduled_end_time` | `TIMESTAMPTZ` | NOT NULL |
| `actual_start_time` | `TIMESTAMPTZ` | |
| `actual_end_time` | `TIMESTAMPTZ` | |
| `meeting_provider` | `VARCHAR(30)` | NOT NULL, `DEFAULT 'mediasoup'` |
| `meeting_room_id` | `TEXT` | Random UUID — never derived from patient data |
| `meeting_url` | `TEXT` | The app's own `/call/:id`, never a raw provider URL |
| `cancelled_by` | `UUID` | FK → `staff_profiles(id)` ON DELETE SET NULL |
| `cancellation_reason` | `TEXT` | |
| `reminder_sent_at` | `TIMESTAMPTZ` | Marked **before** the reminder is sent, so a crash cannot duplicate it |
| `created_at`, `updated_at` | `TIMESTAMPTZ` | `trg_consultations_touch` |

`CONSTRAINT consultation_window_ordered CHECK (scheduled_end_time > scheduled_start_time)`

Indexes:

```sql
idx_consultations_doctor  ON (doctor_id, scheduled_start_time)
idx_consultations_visit   ON (visit_id)
idx_consultations_patient ON (patient_id)
idx_consultations_status  ON (status, scheduled_end_time)

-- The race guard
CREATE UNIQUE INDEX idx_one_active_per_doctor  ON consultations(doctor_id)  WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX idx_one_active_per_patient ON consultations(patient_id) WHERE status = 'ACTIVE';
```

**The two partial unique indexes are the substance of this table.** An
application-level "is this doctor free?" check loses to a concurrent request
every time. Two simultaneous "Find Doctor Now" requests for the same doctor
produce exactly one success and one clean constraint violation, which
`createInstantConsultation` retries against the next candidate.

Only three provider fields are ever stored. No credentials, no worker internals —
`joinMeeting()` issues short-lived per-user tokens.

### `doctor_reviews`

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `visit_id` | `UUID` | NOT NULL, FK → `visits(id)` ON DELETE CASCADE |
| `doctor_id` | `UUID` | NOT NULL, FK → `staff_profiles(id)` ON DELETE **RESTRICT** |
| `decision` | `VARCHAR(40)` | NOT NULL. Enforced in the controller: `treat_locally`, `prescribe`, `refer_hospital`, `follow_up`, `no_action_needed` |
| `clinical_notes` | `TEXT` | Composed lines: `Diagnosis: …`, `Notes: …`, `Referred to: …`, `Follow up in N day(s)` |
| `agreed_with_ai` | `BOOLEAN` | Nullable — the ground-truth signal for whether the AI is helping |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, `DEFAULT NOW()` |

`idx_reviews_visit ON (visit_id)`. `ON DELETE RESTRICT` on `doctor_id` because a
clinical decision must remain attributable.

### `prescriptions`

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `visit_id` | `UUID` | NOT NULL, FK → `visits(id)` ON DELETE CASCADE |
| `doctor_id` | `UUID` | NOT NULL, FK → `staff_profiles(id)` ON DELETE **RESTRICT** |
| `prescription_code` | `VARCHAR(40)` | NOT NULL, UNIQUE — `RX-YYYY-NNNNNNNN` |
| `items` | `JSONB` | NOT NULL, `DEFAULT '[]'` — `{ name, strength, frequency, duration, instructions }` |
| `advice` | `TEXT` | |
| `signed_at` | `TIMESTAMPTZ` | NOT NULL, `DEFAULT NOW()` |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, `DEFAULT NOW()` |

`idx_prescriptions_visit ON (visit_id)`

The only table in the database that can hold a medication a patient is given, and
only a doctor can write to it — enforced in the controller and again by the RLS
policy `prescriptions_insert_by_doctor`, which additionally requires the visit to
be assigned to that doctor.

---

## 6. Supporting tables

### `notifications` — `05_consultations.sql`

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `consultation_id` | `UUID` | FK → `consultations(id)` ON DELETE CASCADE — **nullable**, because `CASE_ASSIGNED` and `DOCTOR_REVIEW_COMPLETED` have no consultation |
| `recipient_id` | `UUID` | NOT NULL, FK → `staff_profiles(id)` ON DELETE CASCADE |
| `recipient_role` | `staff_role` | NOT NULL |
| `event_type` | `notification_event` | NOT NULL |
| `payload` | `JSONB` | NOT NULL, `DEFAULT '{}'` |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, `DEFAULT NOW()` |
| `read_at` | `TIMESTAMPTZ` | |

```sql
idx_notifications_recipient ON (recipient_id, created_at DESC)
idx_notifications_unread    ON (recipient_id) WHERE read_at IS NULL
```

### `audit_logs`

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `actor_id` | `UUID` | FK → `staff_profiles(id)` ON DELETE SET NULL |
| `actor_role` | `staff_role` | |
| `action` | `VARCHAR(80)` | NOT NULL |
| `entity_type` | `VARCHAR(60)` | |
| `entity_id` | `TEXT` | **TEXT, not UUID** — a patient's key is a 12-digit Aadhaar. Masked at write time |
| `metadata` | `JSONB` | NOT NULL, `DEFAULT '{}'` — recursively redacted |
| `ip_address` | `INET` | |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, `DEFAULT NOW()` |

`idx_audit_actor`, `idx_audit_action`, `idx_audit_created ON (created_at DESC)`

**Append-only by policy.** `03_rls.sql` defines a SELECT policy for oversight
roles and an INSERT policy for any active staff member, and **no UPDATE or DELETE
policy for any role** — so with RLS on, entries cannot be altered or removed
through the API at all.

### `referrals` — `11_referral_audit.sql`

One row per referral **shown to a health worker** for an EMERGENCY or HIGH case.

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `visit_id` | `UUID` | FK → `visits(id)` ON DELETE CASCADE |
| `patient_id` | `VARCHAR(12)` | FK → `patients(aadhaar_number)` ON DELETE SET NULL |
| `risk_level` | `VARCHAR(12)` | the tier as the engine reported it |
| `origin_lat` / `origin_lon` | `DOUBLE PRECISION` | where the search started |
| `origin_source` | `VARCHAR(12)` | NOT NULL, CHECK in `('gps', 'district', 'manual')` |
| `origin_accuracy_m` | `DOUBLE PRECISION` | |
| `hospital_name` / `hospital_district` | `TEXT` | |
| `hospital_lat` / `hospital_lon` | `DOUBLE PRECISION` | |
| `distance_km` | `NUMERIC(6,1)` | **as displayed**, not as it would be recomputed |
| `distance_source` | `VARCHAR(20)` | NOT NULL, `DEFAULT 'straight-line'` |
| `eta_text` | `TEXT` | |
| `referred_by` | `UUID` | FK → `staff_profiles(id)` ON DELETE SET NULL |
| `district_id` | `UUID` | FK → `districts(id)` ON DELETE SET NULL |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, `DEFAULT NOW()` |

`idx_referrals_visit`, `idx_referrals_district ON (district_id, created_at DESC)`

**Why `origin_source` is NOT NULL and constrained.** A referral computed from a
good GPS fix and one computed from the clinic's district centroid can name
*different hospitals*. If the wrong patient went to the wrong place, that
distinction is the whole enquiry.

**Distance and ETA are stored as they were shown.** The question after an
incident is what the health worker was looking at when they decided; a value
recomputed from today's road data does not answer it.

**There is no capacity column,** deliberately. No live bed feed exists for UP
district hospitals, and a column here would invite one to be invented.

RLS `referrals_via_district`: the clinic that made the referral can see it, and
a doctor can see referrals on cases assigned to them.

---

## 7. Triggers and functions

### `touch_updated_at()`

```sql
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
```

Attached as `BEFORE UPDATE FOR EACH ROW` to `staff_profiles`, `patients`,
`visits`, `doctor_profiles` (`02`), and `consultations`, `doctor_schedules`
(`05`).

### RLS helper functions — `03_rls.sql`

All `STABLE SECURITY DEFINER SET search_path = public`, so a policy can read
`staff_profiles` without recursing into that table's own policy.

| Function | Returns |
|---|---|
| `auth_staff_id()` | The active staff row id for `auth.uid()` |
| `auth_role()` | `staff_role` |
| `auth_district()` | `district_id` |
| `auth_state()` | `state_id` |
| `auth_is_admin()` | `auth_role() IN ('super_admin','state_admin','district_admin')` |
| `auth_serves_district(target)` | `auth_role() IN ('doctor','clinic_assistant') AND auth_district() = target` |

### `admin_analytics(scope_state UUID, scope_district UUID)` — `10_admin_analytics.sql`

`RETURNS JSONB`, `LANGUAGE sql`, `STABLE`. Returns, in one round trip:

| Key | Contents |
|---|---|
| `visits` | `total`, `today`, `treated`, `awaiting_doctor`, `in_consultation`, `referred` |
| `risk_distribution` | All four tiers, zero-filled |
| `trend` | 14 days, **including quiet days** — a line that skips empty days reads a closed Sunday as busy |
| `demographics.gender` | `female`, `male`, `other`, zero-filled |
| `demographics.age_bands` | `0-5`, `6-17`, `18-39`, `40-59`, `60+` via `width_bucket` |
| `top_districts` | Up to 8, by visit count |

`WHERE v.deleted_at IS NULL` throughout — withdrawn visits were accidental
entries, and counting them would inflate every figure on the page.

**Why it exists.** The same figures were computed in Node by selecting rows and
counting them. PostgREST caps a response at 1,000 rows whatever limit is asked
for, so the demographics silently described the first thousand of 1,876 patients
and every "busiest district" came back as exactly 25 — figures that were wrong
and entirely plausible at the same time.

---

## 8. Row-level security

RLS is enabled on 14 tables in `03_rls.sql`, plus `doctor_schedules`,
`consultations` and `notifications` in `05`, and `patient_images` in `06`.

**A table with RLS on and no policy denies all access**, which is the correct
default for anything not explicitly opened.

### Properties that matter

| Property | Detail |
|---|---|
| **No admin role appears in any policy on `patients`, `visits` or their children** | "Admin cannot edit patient data" is enforced by the database, not only by `clinicalAccess.middleware.js` |
| `visits` is filtered by `assigned_doctor_id` for doctors | The caseload rule, in the same place the data lives |
| `audit_logs` has no UPDATE or DELETE policy for any role | Append-only |
| `prescriptions_insert_by_doctor` requires `auth_role() = 'doctor'` **and** `doctor_id = auth_staff_id()` **and** the visit assigned to them | Three conditions for one insert |
| Clinicians can read the doctor roster in their own district | `staff_read_in_scope` includes `auth_role() IN ('doctor','clinic_assistant') AND role = 'doctor' AND district_id = auth_district()` |
| `notifications_own` restricts reads to `recipient_id = auth_staff_id()` | A recipient id can never be supplied by a client |
| `06` adds `reviews_readable_by_visit_clinicians` and `prescriptions_readable_by_visit_clinicians` | Without these the doctor's decision could not reach the assistant's portal — §3.6 of the specification could not close |

### The service-role caveat, stated plainly

The backend uses the Supabase **service-role key**, which bypasses RLS by design.
That is precisely why the Express guards remain: the two layers state the same
rules, and either one failing alone is not a breach. **If you change a rule in
one, change it in both.**

---

## 9. Migration history

### v1 — superseded

| File | Status |
|---|---|
| `database/schema.sql` | v1, 19 tables including `clinics`, `profiles`, `medical_documents`, `document_extractions`, `knowledge_sources`, `protocols`, `clinical_protocols`, `ai_risk_assessments`, `ai_recommendations` |
| `database/apply_all.sql` | v1 combined apply |
| `database/seed.sql` | v1 seed |

`database/v2/01_reset.sql` **drops all of them**. They are kept for historical
reference only.

### v2 — current

| # | File | Committed | What it changed | Applied in production |
|---|---|---|---|---|
| 01 | `01_reset.sql` | 2026-08-27 | Drops every v1 table and enum type | ✅ Yes — the live database is v2 |
| 02 | `02_schema.sql` | 2026-08-27 | 14 core tables, 9 enums, indexes, `touch_updated_at()` and 4 triggers | ✅ Yes |
| 03 | `03_rls.sql` | 2026-08-27 | RLS on 14 tables, ~40 policies, 6 `SECURITY DEFINER` helpers | ✅ Yes |
| 04 | `04_visit_history.sql` | 2026-08-27 | `visits`: `medical_history`, `known_allergies`, `symptom_duration_value`, `symptom_duration_unit` | ✅ Yes |
| 05 | `05_consultations.sql` | 2026-08-27 | `doctor_schedules`; **drops and rebuilds** `consultations` around the state machine; `notifications`; the two partial unique indexes; `reminder_sent_at`; RLS for all three | ✅ Yes |
| 06 | `06_patient_images.sql` | 2026-08-31 | `patient_images`; adds `DOCTOR_REVIEW_COMPLETED` to `notification_event`; adds the two policies that let the assistant read the doctor's review and prescription | ✅ Yes — `implementation_plan.md` §0.0 records probing the production database directly and finding both present. The migration had been applied by hand before the file was committed |
| 07 | `07_case_handoff.sql` | 2026-08-31 | Adds `CASE_ASSIGNED` to `notification_event`. **No `BEGIN`** — `ALTER TYPE … ADD VALUE` cannot run inside a transaction | ✅ Yes — `implementation_plan.md` §0.4 records it as applied; `npm run preflight` check 6 verifies it |
| 08 | `08_visit_soft_delete.sql` | 2026-08-31 | `visits`: `deleted_at`, `deleted_by`, `deletion_reason`; partial `idx_visits_live`; a column comment | ✅ Yes — `implementation_plan.md` Phase 1 status: *"Migrations 08 and 09 applied to production; existing rows unaffected"* |
| 09 | `09_emergency_registration.sql` | 2026-08-31 | Drops NOT NULL from 5 identity columns; adds `patients_identity_required_unless_emergency`; partial index for unreconciled emergency records | ✅ Yes — same record |
| 10 | `10_admin_analytics.sql` | 2026-09-01 | Creates `admin_analytics(scope_state, scope_district)` | ⚠️ **Presumed applied but not recorded.** Committed with the working dashboard in `1b5cd49`, and `GET /api/admin/analytics` returns 500 without it. There is no verification note for it in the repository — verify with `SELECT proname FROM pg_proc WHERE proname = 'admin_analytics';` |
| 11 | `11_referral_audit.sql` | 2026-09-03 | Creates `referrals` with its two indexes, RLS and the `referrals_via_district` policy | ✅ Yes — applied ahead of the emergency-referral feature in `c2a5b40` |

### `applyV2.js` reads the directory — fixed

It used to carry a hand-maintained list that had drifted four migrations behind,
so a fresh `npm run db:apply -- --confirm` silently produced a database missing
07–10 and reported success. It now discovers migrations instead:

```js
const FILES = fs
  .readdirSync(V2_DIR)
  .filter((f) => /^\d{2}_.*\.sql$/.test(f))
  .sort();
```

Adding a migration file is now enough to have it applied. Was tracked as
[L3](16-known-limitations-and-risks.md#l3).

### Dead migrations — do not run

| File | Why it is dead |
|---|---|
| `database/migrations/001_medication_rule_source.sql` | Adds `rule_source_id` and a CHECK to `ai_recommendations`, a v1 table that `01_reset.sql` drops and v2 never recreates. The invariant it encodes survives in application code as `assertRuleSourced()` |
| `database/migrations/002_patient_is_demo_flag.sql` | Adds `patients.is_demo`, which `02_schema.sql` **already includes**, and backfills three rows by a `patients.id` column that no longer exists — v2 keys on `aadhaar_number`. `HANDOFF.md` describes this as "unapplied"; it is in fact superseded |

---

## 10. Seeded data

`npm run seed` (`seedV2.js`), deterministic — same seed, same dataset, so a
demonstration is reproducible.

| | |
|---|---:|
| States and union territories | 36 |
| Districts (Uttar Pradesh) | 75 |
| Doctors (5 per district) | 375 |
| Clinic assistants (1 per district) | 75 |
| District admins | 8 |
| State admins | 1 |
| Patients (5 per doctor) | 1,875 |
| Visits, risk-tiered over 7 days | 1,875 |

Every row carries `is_demo = true`. Re-running clears the previous demo rows and
their Supabase Auth users first. The `super_admin` is **never** seeded — it is
provisioned by `npm run seed:root` from credentials only the operator holds.

`npm run seed:daily` gives every doctor exactly five cases spanning the whole
severity ladder, reproducible for a given date. Verified against production: 375
doctors with exactly 5 cases each, `moderate=750, low=375, high=375,
emergency=375` — two moderates per doctor, because it is the commonest
presentation and a queue implying emergencies are as frequent as routine cases
would misrepresent the work. Its delete is filtered on `is_demo`, so a real case
an assistant handed over is never removed by a reseed.

---

## 11. Storage

One Supabase Storage bucket:

| Bucket | Visibility | Contents |
|---|---|---|
| `injury-photos` | **Private** | `injuries/{aadhaar}/{timestamp}_{filename}` |

`npm run preflight` asserts both the bucket's existence and `public === false`.
`patient_images.image_url` is deliberately `NULL`; `imageAccess.js` mints a
one-hour signed URL per read. A permanent link to a clinical photograph of an
identifiable patient would be viewable by anyone who ever saw it — after the case
closes, after the staff member leaves, after the link is forwarded.
