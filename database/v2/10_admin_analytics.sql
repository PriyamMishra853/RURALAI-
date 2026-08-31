-- ============================================================================
-- Admin analytics, aggregated in the database.
--
-- The dashboard first computed demographics in Node by selecting patient rows
-- and counting them. PostgREST caps a response at 1,000 rows regardless of the
-- limit asked for, so those figures silently described the first thousand
-- patients out of 1,876 — and looked entirely plausible while doing it. Every
-- "busiest district" came back as exactly 25 because the sample ran out.
--
-- Counting where the rows are removes the cap and the round trips together.
--
-- Withdrawn visits are excluded throughout: they were accidental entries, and
-- counting them would inflate every figure on the page.
--
-- Scope is passed in rather than read from the session because the API already
-- resolves it — a district admin sees their district, a state admin their
-- state, and NULL means national.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION admin_analytics(
  scope_state    UUID DEFAULT NULL,
  scope_district UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  WITH scoped_visits AS (
    SELECT v.*
      FROM visits v
     WHERE v.deleted_at IS NULL
       AND (scope_district IS NULL OR v.district_id = scope_district)
       AND (scope_state    IS NULL OR v.district_id IN (
             SELECT d.id FROM districts d WHERE d.state_id = scope_state))
  ),
  scoped_patients AS (
    SELECT p.*
      FROM patients p
     WHERE (scope_district IS NULL OR p.clinic_district_id = scope_district)
       AND (scope_state    IS NULL OR p.clinic_state_id = scope_state)
  ),
  days AS (
    SELECT generate_series(
             ((NOW() AT TIME ZONE 'Asia/Kolkata')::date - INTERVAL '13 days')::date,
             (NOW() AT TIME ZONE 'Asia/Kolkata')::date,
             INTERVAL '1 day')::date AS d
  )
  SELECT jsonb_build_object(
    'visits', jsonb_build_object(
      'total',           (SELECT count(*) FROM scoped_visits),
      'today',           (SELECT count(*) FROM scoped_visits WHERE visit_date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date),
      'treated',         (SELECT count(*) FROM scoped_visits WHERE status = 'completed'),
      'awaiting_doctor', (SELECT count(*) FROM scoped_visits WHERE status = 'awaiting_doctor'),
      'in_consultation', (SELECT count(*) FROM scoped_visits WHERE status = 'in_consultation'),
      'referred',        (SELECT count(*) FROM scoped_visits WHERE status = 'referred')
    ),
    'risk_distribution', (
      SELECT jsonb_object_agg(t.tier, COALESCE(c.n, 0))
        FROM (VALUES ('low'),('moderate'),('high'),('emergency')) AS t(tier)
        LEFT JOIN (
          SELECT risk_level::text AS tier, count(*) AS n
            FROM scoped_visits WHERE risk_level IS NOT NULL GROUP BY risk_level
        ) c ON c.tier = t.tier
    ),
    -- Every day appears, including the quiet ones. A line that skips days with
    -- no visits implies continuous activity and reads a closed Sunday as busy.
    'trend', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'date', days.d, 'visits', COALESCE(v.n, 0), 'urgent', COALESCE(v.urgent, 0)
             ) ORDER BY days.d), '[]'::jsonb)
        FROM days
        LEFT JOIN (
          SELECT visit_date,
                 count(*) AS n,
                 count(*) FILTER (WHERE risk_level IN ('high','emergency')) AS urgent
            FROM scoped_visits GROUP BY visit_date
        ) v ON v.visit_date = days.d
    ),
    'demographics', jsonb_build_object(
      'gender', (
        SELECT jsonb_object_agg(t.g, COALESCE(c.n, 0))
          FROM (VALUES ('female'),('male'),('other')) AS t(g)
          LEFT JOIN (
            SELECT gender::text AS g, count(*) AS n FROM scoped_patients GROUP BY gender
          ) c ON c.g = t.g
      ),
      'age_bands', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('label', b.label, 'count', COALESCE(c.n, 0))
                 ORDER BY b.ord), '[]'::jsonb)
          FROM (VALUES ('0-5',0,5,1),('6-17',6,17,2),('18-39',18,39,3),
                       ('40-59',40,59,4),('60+',60,200,5)) AS b(label, lo, hi, ord)
          LEFT JOIN (
            SELECT width_bucket(
                     EXTRACT(YEAR FROM age(date_of_birth))::int,
                     ARRAY[0,6,18,40,60]) AS bucket,
                   count(*) AS n
              FROM scoped_patients WHERE date_of_birth IS NOT NULL
             GROUP BY bucket
          ) c ON c.bucket = b.ord
      )
    ),
    'top_districts', (
      SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'count')::int DESC), '[]'::jsonb)
        FROM (
          SELECT jsonb_build_object('name', d.name, 'count', count(*)) AS x
            FROM scoped_visits sv JOIN districts d ON d.id = sv.district_id
           GROUP BY d.name ORDER BY count(*) DESC LIMIT 8
        ) t
    )
  );
$$;

COMMENT ON FUNCTION admin_analytics IS
  'Operational figures for the admin dashboard, aggregated server-side so the PostgREST 1000-row cap cannot silently truncate them.';

COMMIT;
