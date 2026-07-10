-- Work Centers (legacy module) + machine membership
-- Run in Supabase SQL editor or via CLI

-- ─── work_centers ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_centers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  code                  text NOT NULL UNIQUE,
  department_id         uuid REFERENCES departments(id) ON DELETE SET NULL,
  overhead_hourly_rate  numeric(12,4) NOT NULL DEFAULT 0 CHECK (overhead_hourly_rate >= 0),
  speed                 numeric(12,4) NOT NULL DEFAULT 1 CHECK (speed > 0),
  efficiency            numeric(5,2)  NOT NULL DEFAULT 100 CHECK (efficiency > 0 AND efficiency <= 100),
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_centers_department
  ON work_centers (department_id);

CREATE INDEX IF NOT EXISTS idx_work_centers_active
  ON work_centers (is_active)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_work_centers_code
  ON work_centers (code);

-- ─── work_center_machines ───────────────────────────────────────────────────
-- Many machines per work center; each machine belongs to at most one center
CREATE TABLE IF NOT EXISTS work_center_machines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_center_id      uuid NOT NULL REFERENCES work_centers(id) ON DELETE CASCADE,
  machine_record_id   uuid NOT NULL REFERENCES master_records(id) ON DELETE CASCADE,
  sequence            int  NOT NULL DEFAULT 1 CHECK (sequence > 0),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (machine_record_id),
  UNIQUE (work_center_id, machine_record_id)
);

CREATE INDEX IF NOT EXISTS idx_wc_machines_center
  ON work_center_machines (work_center_id, sequence);

CREATE INDEX IF NOT EXISTS idx_wc_machines_machine
  ON work_center_machines (machine_record_id);

-- ─── updated_at trigger ─────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_work_centers_updated_at ON work_centers;
CREATE TRIGGER trg_work_centers_updated_at
  BEFORE UPDATE ON work_centers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Row Level Security ─────────────────────────────────────────────────────
ALTER TABLE work_centers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_center_machines ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON work_centers         FROM anon, authenticated;
REVOKE ALL ON work_center_machines FROM anon, authenticated;

GRANT ALL ON work_centers         TO service_role;
GRANT ALL ON work_center_machines TO service_role;
