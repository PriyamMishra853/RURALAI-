-- ============================================================================
-- Idempotent writes (Roadmap v3, Phase 6 groundwork).
--
-- A sub-centre on a rural link loses the answer, not the request. The
-- assistant presses "register" again, and the patient is registered twice — or
-- a queued write replays after the connection returns and opens a second visit
-- for the same person on the same day. Offline capture cannot be built on top
-- of that: a queue without idempotency is a duplicate generator.
--
-- So a client may send an Idempotency-Key with a write. The first request with
-- that key does the work and its response is stored; a repeat of the same key
-- returns the stored response without touching anything. A different body
-- under the same key is a mistake on the client's side and is refused rather
-- than silently answered with someone else's result.
--
-- Keys are scoped to the staff member: two people cannot collide, and one
-- person's key cannot be replayed by another. They expire — 24 hours is longer
-- than any retry and shorter than anything worth keeping.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS request_idempotency (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id      UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
    idempotency_key VARCHAR(128) NOT NULL,
    route         VARCHAR(120) NOT NULL,
    -- SHA-256 of the request body: the same key with a different body is a
    -- client bug, and answering it with the first result would be worse.
    request_hash  CHAR(64) NOT NULL,
    status_code   INTEGER NOT NULL CHECK (status_code BETWEEN 100 AND 599),
    response      JSONB NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at    TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',

    CONSTRAINT request_idempotency_expiry_after_start CHECK (expires_at > created_at)
);

-- One result per key per person. The insert races safely: whoever wins stores
-- the answer, the loser reads it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_request_idempotency_key
    ON request_idempotency (staff_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_request_idempotency_expiry
    ON request_idempotency (expires_at);

ALTER TABLE request_idempotency ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS request_idempotency_service ON request_idempotency;
CREATE POLICY request_idempotency_service ON request_idempotency
    FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE request_idempotency IS
  'Stored responses for writes carrying an Idempotency-Key, so a retry over a bad link returns the original answer instead of creating a second patient or visit. Expires after 24 hours.';

COMMIT;
