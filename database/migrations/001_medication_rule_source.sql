-- Medication may never be model-authored.
--
-- Plan §D.2 and §B.3: a medication recommendation must point at the formulary
-- rule it came from. Enforcing this in the database rather than in application
-- code means a compromised service-role key, a future controller that forgets
-- the check, or a direct SQL insert still cannot store a medication that no
-- signed rule produced.
--
-- NOT YET APPLIED — the database was unreachable when this was written.
-- Apply with: psql "$DATABASE_URL" -f database/migrations/001_medication_rule_source.sql

ALTER TABLE ai_recommendations
  ADD COLUMN IF NOT EXISTS rule_source_id VARCHAR(64);

-- Existing rows predate the formulary and cannot be retro-attributed, so the
-- constraint is scoped to rows created from here on.
ALTER TABLE ai_recommendations
  DROP CONSTRAINT IF EXISTS medicine_requires_rule_source;

ALTER TABLE ai_recommendations
  ADD CONSTRAINT medicine_requires_rule_source
  CHECK (
    recommendation_type <> 'medicine'
    OR rule_source_id IS NOT NULL
    OR created_at < '2026-08-26'::timestamptz
  );

COMMENT ON CONSTRAINT medicine_requires_rule_source ON ai_recommendations IS
  'A medication recommendation must name the formulary rule that produced it. Never relax this to make an insert succeed — fix the caller.';

CREATE INDEX IF NOT EXISTS idx_ai_recommendations_rule_source
  ON ai_recommendations (rule_source_id)
  WHERE recommendation_type = 'medicine';
