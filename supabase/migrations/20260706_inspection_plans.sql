-- Inspection Plan + GIRN Execution
-- Run in Supabase SQL editor or via CLI

-- ─── 1. inspection_plans ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inspection_plans (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_record_id      uuid NOT NULL REFERENCES master_records(id) ON DELETE CASCADE,
  plan_code             text NOT NULL,
  revision              int  NOT NULL DEFAULT 1 CHECK (revision > 0),
  status                text NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'active', 'retired')),
  effective_from        date,
  sampling_rule_type    text NOT NULL DEFAULT 'percentage'
                          CHECK (sampling_rule_type IN ('percentage', 'fixed_count')),
  sampling_rule_value   numeric NOT NULL DEFAULT 100 CHECK (sampling_rule_value > 0),
  created_by            uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (master_record_id, revision)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inspection_plans_one_active_per_record
  ON inspection_plans (master_record_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_inspection_plans_master_record
  ON inspection_plans (master_record_id);

CREATE INDEX IF NOT EXISTS idx_inspection_plans_status
  ON inspection_plans (master_record_id, status);

-- ─── 2. inspection_plan_parameters ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inspection_plan_parameters (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id             uuid NOT NULL REFERENCES inspection_plans(id) ON DELETE CASCADE,
  sequence            int  NOT NULL DEFAULT 1 CHECK (sequence > 0),
  parameter_name      text NOT NULL,
  check_type          text NOT NULL
                        CHECK (check_type IN ('dimensional', 'visual', 'functional', 'document')),
  nominal_value       numeric,
  tol_plus            numeric,
  tol_minus           numeric,
  unit                text,
  instrument_required text,
  is_mandatory        boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_plan_parameters_plan
  ON inspection_plan_parameters (plan_id, sequence);

-- ─── 3. inspection_plan_documents ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inspection_plan_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id         uuid NOT NULL REFERENCES inspection_plans(id) ON DELETE CASCADE,
  document_type   text NOT NULL,
  is_mandatory    boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, document_type)
);

CREATE INDEX IF NOT EXISTS idx_plan_documents_plan
  ON inspection_plan_documents (plan_id);

-- ─── 4. girn_inspections ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS girn_inspections (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  girn_item_id             uuid NOT NULL REFERENCES girn_items(id) ON DELETE CASCADE,
  plan_id                  uuid NOT NULL REFERENCES inspection_plans(id) ON DELETE RESTRICT,
  plan_revision_snapshot   int  NOT NULL CHECK (plan_revision_snapshot > 0),
  lot_qty                  numeric NOT NULL CHECK (lot_qty >= 0),
  sample_size              int     NOT NULL CHECK (sample_size >= 0),
  inspector_id             uuid REFERENCES employees(id) ON DELETE SET NULL,
  overall_result           text NOT NULL
                             CHECK (overall_result IN ('pass', 'fail', 'conditional')),
  inspected_at             timestamptz NOT NULL DEFAULT now(),
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (girn_item_id)
);

CREATE INDEX IF NOT EXISTS idx_girn_inspections_item
  ON girn_inspections (girn_item_id);

CREATE INDEX IF NOT EXISTS idx_girn_inspections_plan
  ON girn_inspections (plan_id);

-- ─── 5. girn_inspection_values ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS girn_inspection_values (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id      uuid NOT NULL REFERENCES girn_inspections(id) ON DELETE CASCADE,
  plan_parameter_id  uuid NOT NULL REFERENCES inspection_plan_parameters(id) ON DELETE RESTRICT,
  measured_value     numeric,
  result             text NOT NULL CHECK (result IN ('pass', 'fail', 'na')),
  remarks            text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inspection_id, plan_parameter_id)
);

CREATE INDEX IF NOT EXISTS idx_girn_inspection_values_inspection
  ON girn_inspection_values (inspection_id);

-- ─── 6. girn_inspection_documents ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS girn_inspection_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id   uuid NOT NULL REFERENCES girn_inspections(id) ON DELETE CASCADE,
  document_type   text NOT NULL,
  file_url        text NOT NULL,
  verified        boolean NOT NULL DEFAULT false,
  uploaded_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inspection_id, document_type)
);

CREATE INDEX IF NOT EXISTS idx_girn_inspection_documents_inspection
  ON girn_inspection_documents (inspection_id);

-- ─── updated_at trigger ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inspection_plans_updated_at ON inspection_plans;
CREATE TRIGGER trg_inspection_plans_updated_at
  BEFORE UPDATE ON inspection_plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 7. Hard cutover: drop legacy inspection logs ───────────────────────────
DROP TABLE IF EXISTS girn_inspection_logs;

-- ─── 8. Row Level Security ──────────────────────────────────────────────────
ALTER TABLE inspection_plans              ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_plan_parameters    ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_plan_documents     ENABLE ROW LEVEL SECURITY;
ALTER TABLE girn_inspections              ENABLE ROW LEVEL SECURITY;
ALTER TABLE girn_inspection_values        ENABLE ROW LEVEL SECURITY;
ALTER TABLE girn_inspection_documents     ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON inspection_plans              FROM anon, authenticated;
REVOKE ALL ON inspection_plan_parameters    FROM anon, authenticated;
REVOKE ALL ON inspection_plan_documents     FROM anon, authenticated;
REVOKE ALL ON girn_inspections              FROM anon, authenticated;
REVOKE ALL ON girn_inspection_values        FROM anon, authenticated;
REVOKE ALL ON girn_inspection_documents     FROM anon, authenticated;

GRANT ALL ON inspection_plans              TO service_role;
GRANT ALL ON inspection_plan_parameters    TO service_role;
GRANT ALL ON inspection_plan_documents     TO service_role;
GRANT ALL ON girn_inspections              TO service_role;
GRANT ALL ON girn_inspection_values        TO service_role;
GRANT ALL ON girn_inspection_documents     TO service_role;
