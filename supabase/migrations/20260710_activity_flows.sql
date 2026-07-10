-- Activity Flow Chart (routing) — versioned graph per component
-- Run in Supabase SQL editor or via CLI

-- ─── activity_flow_versions ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_flow_versions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_record_id  uuid NOT NULL REFERENCES master_records(id) ON DELETE CASCADE,
  revision          int  NOT NULL DEFAULT 1 CHECK (revision > 0),
  status            text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'active', 'retired')),
  valid_from        date,
  valid_to          date,
  created_by        uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (master_record_id, revision),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_activity_flow_one_active_per_record
  ON activity_flow_versions (master_record_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_activity_flow_versions_record
  ON activity_flow_versions (master_record_id);

CREATE INDEX IF NOT EXISTS idx_activity_flow_versions_status
  ON activity_flow_versions (master_record_id, status);

-- ─── activity_flow_nodes ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_flow_nodes (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_version_id           uuid NOT NULL REFERENCES activity_flow_versions(id) ON DELETE CASCADE,
  activity_type             text NOT NULL
                              CHECK (activity_type IN (
                                'material_issue', 'storage', 'machining', 'inspection',
                                'outsource', 'outsource_inward', 'assembly', 'firewall',
                                'packing', 'dispatch', 'note'
                              )),
  label                     text NOT NULL,
  sequence                  int  NOT NULL DEFAULT 1 CHECK (sequence > 0),
  work_center_id            uuid REFERENCES work_centers(id) ON DELETE SET NULL,
  setup_time_minutes        numeric(12,4) CHECK (setup_time_minutes IS NULL OR setup_time_minutes >= 0),
  run_time_per_unit_minutes numeric(12,4) CHECK (run_time_per_unit_minutes IS NULL OR run_time_per_unit_minutes >= 0),
  queue_time_minutes        numeric(12,4) CHECK (queue_time_minutes IS NULL OR queue_time_minutes >= 0),
  inspection_plan_id        uuid REFERENCES inspection_plans(id) ON DELETE SET NULL,
  inspection_kind           text CHECK (inspection_kind IS NULL OR inspection_kind IN ('in_process', 'final')),
  supplier_id               uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  lead_time_days            numeric(8,2) CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  position_x                numeric(12,2) NOT NULL DEFAULT 0,
  position_y                numeric(12,2) NOT NULL DEFAULT 0,
  notes                     text,
  config                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_flow_nodes_version
  ON activity_flow_nodes (flow_version_id, sequence);

CREATE INDEX IF NOT EXISTS idx_activity_flow_nodes_work_center
  ON activity_flow_nodes (work_center_id);

-- ─── activity_flow_edges ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_flow_edges (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_version_id   uuid NOT NULL REFERENCES activity_flow_versions(id) ON DELETE CASCADE,
  from_node_id      uuid NOT NULL REFERENCES activity_flow_nodes(id) ON DELETE CASCADE,
  to_node_id        uuid NOT NULL REFERENCES activity_flow_nodes(id) ON DELETE CASCADE,
  label             text,
  edge_kind         text NOT NULL DEFAULT 'default'
                      CHECK (edge_kind IN ('default', 'optional', 'rework')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (from_node_id <> to_node_id),
  UNIQUE (flow_version_id, from_node_id, to_node_id)
);

CREATE INDEX IF NOT EXISTS idx_activity_flow_edges_version
  ON activity_flow_edges (flow_version_id);

CREATE INDEX IF NOT EXISTS idx_activity_flow_edges_from
  ON activity_flow_edges (from_node_id);

CREATE INDEX IF NOT EXISTS idx_activity_flow_edges_to
  ON activity_flow_edges (to_node_id);

-- ─── updated_at triggers ────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_activity_flow_versions_updated_at ON activity_flow_versions;
CREATE TRIGGER trg_activity_flow_versions_updated_at
  BEFORE UPDATE ON activity_flow_versions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_activity_flow_nodes_updated_at ON activity_flow_nodes;
CREATE TRIGGER trg_activity_flow_nodes_updated_at
  BEFORE UPDATE ON activity_flow_nodes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Row Level Security ─────────────────────────────────────────────────────
ALTER TABLE activity_flow_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_flow_nodes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_flow_edges    ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON activity_flow_versions FROM anon, authenticated;
REVOKE ALL ON activity_flow_nodes    FROM anon, authenticated;
REVOKE ALL ON activity_flow_edges    FROM anon, authenticated;

GRANT ALL ON activity_flow_versions TO service_role;
GRANT ALL ON activity_flow_nodes    TO service_role;
GRANT ALL ON activity_flow_edges    TO service_role;
