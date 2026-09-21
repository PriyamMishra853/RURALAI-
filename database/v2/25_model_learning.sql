-- ============================================================================
-- The model learns from completed visits (Roadmap v3, Phase 5 / F3).
--
-- When a doctor completes a visit with a diagnosis, and the patient has an
-- active TRAINING consent (migration 21), the case becomes a learning example:
-- de-identified at capture — no Aadhaar, no internal identifier, no name — and
-- waiting for a doctor to confirm its label. Confirmed examples are what the
-- next candidate model is built from.
--
-- model_versions records every model that has existed as "the shipped base
-- plus exactly these examples", with its scores on the frozen benchmark. The
-- live model is rebuilt from that list on every start, so a redeploy loses
-- nothing and a rollback is re-activating an earlier version.
--
-- Nothing here changes a clinical decision. The model ranks candidates for a
-- doctor to consider; the doctor decides.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS learning_examples (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The visit it came from, so it is captured once. Not exported anywhere.
    visit_id        UUID NOT NULL UNIQUE REFERENCES visits(id) ON DELETE CASCADE,
    district_id     UUID NOT NULL REFERENCES districts(id) ON DELETE RESTRICT,
    -- De-identified at capture: what was complained of, what was decided.
    symptoms_text   VARCHAR(2000) NOT NULL,
    diagnosis_text  VARCHAR(300) NOT NULL,
    age_band        VARCHAR(8),
    gender          VARCHAR(10),
    status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected')),
    -- What the model made of it the last time a candidate was built:
    -- learned · no_symptoms_matched · unmatched_diagnosis.
    last_outcome    VARCHAR(30),
    mapped_label    VARCHAR(200),
    reviewed_by     UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,
    reviewed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT learning_examples_reviewed_shape CHECK (
      (status = 'pending') = (reviewed_at IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_learning_examples_queue
    ON learning_examples (district_id, status, created_at);

CREATE TABLE IF NOT EXISTS model_versions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version       INTEGER NOT NULL UNIQUE CHECK (version >= 1),
    status        VARCHAR(20) NOT NULL DEFAULT 'candidate'
                  CHECK (status IN ('candidate', 'live', 'retired')),
    example_ids   UUID[] NOT NULL DEFAULT '{}',
    learned       INTEGER NOT NULL DEFAULT 0,
    -- Frozen-benchmark scores: {top1, top3, top5, n}, for this model and for
    -- the live model it was compared against at the time.
    metrics       JSONB,
    live_metrics  JSONB,
    created_by    UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    promoted_by   UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,
    promoted_at   TIMESTAMPTZ,

    CONSTRAINT model_versions_live_promoted CHECK (
      status <> 'live' OR promoted_at IS NOT NULL)
);

-- At most one live model.
CREATE UNIQUE INDEX IF NOT EXISTS uq_model_versions_live
    ON model_versions (status) WHERE status = 'live';

ALTER TABLE learning_examples ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS learning_examples_service ON learning_examples;
CREATE POLICY learning_examples_service ON learning_examples
    FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS model_versions_service ON model_versions;
CREATE POLICY model_versions_service ON model_versions
    FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE learning_examples IS
  'A completed, consented visit as a de-identified training example, waiting for a doctor to confirm its label. Captured only with an active training consent.';
COMMENT ON TABLE model_versions IS
  'Every model that has existed, as the shipped base plus exactly these examples, with frozen-benchmark scores. The live one is rebuilt from its list on every start.';

COMMIT;
