-- Admin live activity feed (home dashboard)
-- Server-only writes via service role; RLS on with no anon policies

CREATE TABLE IF NOT EXISTS admin_activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  entity_type text,
  entity_id text,
  href text,
  actor_id text,
  actor_name text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_activity_events_created_at
  ON admin_activity_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_activity_events_type_created
  ON admin_activity_events (event_type, created_at DESC);

ALTER TABLE admin_activity_events ENABLE ROW LEVEL SECURITY;
