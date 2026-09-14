-- ============================================================================
-- Doctor-to-doctor referral (Roadmap v3, Phase 1, F1).
--
-- A doctor reviewing a case could decide it or send the patient to a hospital,
-- and nothing else. A general physician who needed a paediatrician, an
-- obstetrician or a second opinion had no way to ask inside the system.
--
-- Three kinds of referral, and they differ in who answers for the patient:
--
--   second_opinion      the referring doctor stays accountable throughout
--   specialist_consult  the referring doctor stays accountable, advised
--   transfer_of_care    the receiving doctor becomes accountable on acceptance
--
-- accountable_doctor_id is stored on every row and every transition, because
-- the Telemedicine Practice Guidelines make the registered practitioner
-- accountable, and a case must never be in a state where it is unclear which
-- doctor answers for it.
--
-- ── Why the visit's own status is not touched ───────────────────────────────
--
-- visit_status gains no new value. Referral state lives entirely here. The
-- demo checkpoint's code filters visits by status, and an enum value it has
-- never seen would put referred cases in the wrong place on a build that
-- predates this table. Additive means additive.
--
-- ── Limits enforced by the database as well as the code ─────────────────────
--
--   one open referral per case     partial unique index below
--   no self-referral               CHECK
--   at most three referrals deep   CHECK on depth, so a case cannot circulate
--                                  between doctors while the patient waits
-- ============================================================================

-- ALTER TYPE ... ADD VALUE cannot run inside a transaction, so these sit above
-- the BEGIN, matching 06, 07 and 13.
ALTER TYPE notification_event ADD VALUE IF NOT EXISTS 'CASE_REFERRAL_REQUESTED';
ALTER TYPE notification_event ADD VALUE IF NOT EXISTS 'CASE_REFERRAL_ACCEPTED';
ALTER TYPE notification_event ADD VALUE IF NOT EXISTS 'CASE_REFERRAL_DECLINED';
ALTER TYPE notification_event ADD VALUE IF NOT EXISTS 'CASE_REFERRAL_COMPLETED';
ALTER TYPE notification_event ADD VALUE IF NOT EXISTS 'CASE_REFERRAL_RETURNED';
ALTER TYPE notification_event ADD VALUE IF NOT EXISTS 'CASE_REFERRAL_CANCELLED';

BEGIN;

CREATE TABLE IF NOT EXISTS case_referrals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  visit_id              UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  district_id           UUID NOT NULL REFERENCES districts(id) ON DELETE RESTRICT,

  -- RESTRICT, like doctor_reviews: a doctor who took part in a referral should
  -- not be able to disappear and take the record of it with them. Seeds clear
  -- these rows explicitly before removing demo staff.
  from_doctor_id        UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE RESTRICT,
  to_doctor_id          UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE RESTRICT,

  referral_type         VARCHAR(24) NOT NULL
                        CHECK (referral_type IN ('second_opinion', 'specialist_consult', 'transfer_of_care')),
  urgency               VARCHAR(12) NOT NULL DEFAULT 'routine'
                        CHECK (urgency IN ('routine', 'urgent')),
  clinical_question     TEXT NOT NULL CHECK (length(trim(clinical_question)) >= 10),

  status                VARCHAR(12) NOT NULL DEFAULT 'requested'
                        CHECK (status IN ('requested', 'accepted', 'declined', 'expired',
                                          'returned', 'completed', 'cancelled')),
  depth                 SMALLINT NOT NULL DEFAULT 1 CHECK (depth BETWEEN 1 AND 3),

  response_notes        TEXT,
  decline_reason        TEXT,
  accountable_doctor_id UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,

  -- An urgent referral nobody accepts must stop blocking the case, not wait
  -- silently while the patient does.
  expires_at            TIMESTAMPTZ NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at          TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,

  CONSTRAINT case_referrals_not_self CHECK (from_doctor_id <> to_doctor_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_case_referrals_one_open
  ON case_referrals(visit_id) WHERE status IN ('requested', 'accepted');

-- "Referred to me" — the receiving doctor's queue.
CREATE INDEX IF NOT EXISTS idx_case_referrals_incoming
  ON case_referrals(to_doctor_id, status, created_at DESC);

-- What the referring doctor has sent and is waiting on.
CREATE INDEX IF NOT EXISTS idx_case_referrals_outgoing
  ON case_referrals(from_doctor_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_case_referrals_visit
  ON case_referrals(visit_id, created_at);

ALTER TABLE case_referrals ENABLE ROW LEVEL SECURITY;

-- Reached only through the service role, like every other clinical table here;
-- who may act on a referral is decided in caseReferralRules.js.
DROP POLICY IF EXISTS case_referrals_service ON case_referrals;
CREATE POLICY case_referrals_service ON case_referrals
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;
