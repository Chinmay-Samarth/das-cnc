-- Blanket POs (customer sales blankets) + recurring delivery schedules
-- Run in Supabase SQL editor or via CLI

-- ─── document number sequences ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_sequences (
  doc_type   text NOT NULL,
  year       int  NOT NULL CHECK (year >= 2000),
  last_value int  NOT NULL DEFAULT 0 CHECK (last_value >= 0),
  PRIMARY KEY (doc_type, year)
);

-- ─── blanket_pos ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS blanket_pos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blanket_number  text NOT NULL UNIQUE,
  customer_id     uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'active', 'on_hold', 'closed', 'cancelled')),
  currency        text NOT NULL DEFAULT 'INR',
  valid_from      date,
  valid_to        date,
  payment_terms   text,
  notes           text,
  created_by      uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

CREATE INDEX IF NOT EXISTS idx_blanket_pos_customer ON blanket_pos (customer_id);
CREATE INDEX IF NOT EXISTS idx_blanket_pos_status ON blanket_pos (status);

-- ─── blanket_po_lines ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS blanket_po_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blanket_po_id     uuid NOT NULL REFERENCES blanket_pos(id) ON DELETE CASCADE,
  line_no           int  NOT NULL CHECK (line_no > 0),
  master_record_id  uuid NOT NULL REFERENCES master_records(id) ON DELETE RESTRICT,
  uom               text NOT NULL DEFAULT 'pcs',
  unit_price        numeric(14,4) NOT NULL CHECK (unit_price >= 0),
  released_qty      numeric(14,4) NOT NULL DEFAULT 0 CHECK (released_qty >= 0),
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (blanket_po_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_blanket_po_lines_po ON blanket_po_lines (blanket_po_id);
CREATE INDEX IF NOT EXISTS idx_blanket_po_lines_component ON blanket_po_lines (master_record_id);

-- ─── delivery_schedule_rules ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery_schedule_rules (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blanket_po_line_id  uuid NOT NULL REFERENCES blanket_po_lines(id) ON DELETE CASCADE,
  cadence             text NOT NULL CHECK (cadence IN ('weekly', 'monthly')),
  weekday             int  CHECK (weekday IS NULL OR (weekday BETWEEN 1 AND 7)),
  month_day           int  CHECK (month_day IS NULL OR (month_day BETWEEN 1 AND 28)),
  default_quantity    numeric(14,4) NOT NULL CHECK (default_quantity > 0),
  valid_from          date NOT NULL,
  valid_to            date,
  is_active           boolean NOT NULL DEFAULT true,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CHECK (
    (cadence = 'weekly'  AND weekday IS NOT NULL AND month_day IS NULL) OR
    (cadence = 'monthly' AND month_day IS NOT NULL AND weekday IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_ds_rules_line ON delivery_schedule_rules (blanket_po_line_id);
CREATE INDEX IF NOT EXISTS idx_ds_rules_active ON delivery_schedule_rules (is_active) WHERE is_active = true;

-- ─── delivery_schedules (occurrences) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery_schedules (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blanket_po_line_id        uuid NOT NULL REFERENCES blanket_po_lines(id) ON DELETE CASCADE,
  rule_id                   uuid REFERENCES delivery_schedule_rules(id) ON DELETE SET NULL,
  schedule_number           text NOT NULL UNIQUE,
  due_date                  date NOT NULL,
  quantity                  numeric(14,4) NOT NULL CHECK (quantity > 0),
  status                    text NOT NULL DEFAULT 'planned'
                              CHECK (status IN ('planned', 'released', 'cancelled')),
  notes                     text,
  bom_version_id            uuid REFERENCES bom_versions(id) ON DELETE SET NULL,
  activity_flow_version_id  uuid REFERENCES activity_flow_versions(id) ON DELETE SET NULL,
  created_by                uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- Unique per line/date/rule among non-cancelled rows
CREATE UNIQUE INDEX IF NOT EXISTS uq_ds_line_date_rule
  ON delivery_schedules (blanket_po_line_id, due_date, rule_id)
  WHERE rule_id IS NOT NULL AND status <> 'cancelled';

CREATE UNIQUE INDEX IF NOT EXISTS uq_ds_line_date_oneoff
  ON delivery_schedules (blanket_po_line_id, due_date)
  WHERE rule_id IS NULL AND status <> 'cancelled';

CREATE INDEX IF NOT EXISTS idx_ds_line ON delivery_schedules (blanket_po_line_id);
CREATE INDEX IF NOT EXISTS idx_ds_due_date ON delivery_schedules (due_date);
CREATE INDEX IF NOT EXISTS idx_ds_status ON delivery_schedules (status);

-- ─── updated_at triggers ────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_blanket_pos_updated_at ON blanket_pos;
CREATE TRIGGER trg_blanket_pos_updated_at
  BEFORE UPDATE ON blanket_pos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_blanket_po_lines_updated_at ON blanket_po_lines;
CREATE TRIGGER trg_blanket_po_lines_updated_at
  BEFORE UPDATE ON blanket_po_lines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_ds_rules_updated_at ON delivery_schedule_rules;
CREATE TRIGGER trg_ds_rules_updated_at
  BEFORE UPDATE ON delivery_schedule_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_delivery_schedules_updated_at ON delivery_schedules;
CREATE TRIGGER trg_delivery_schedules_updated_at
  BEFORE UPDATE ON delivery_schedules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Row Level Security ─────────────────────────────────────────────────────
ALTER TABLE document_sequences      ENABLE ROW LEVEL SECURITY;
ALTER TABLE blanket_pos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE blanket_po_lines        ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_schedule_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_schedules      ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON document_sequences      FROM anon, authenticated;
REVOKE ALL ON blanket_pos             FROM anon, authenticated;
REVOKE ALL ON blanket_po_lines        FROM anon, authenticated;
REVOKE ALL ON delivery_schedule_rules FROM anon, authenticated;
REVOKE ALL ON delivery_schedules      FROM anon, authenticated;

GRANT ALL ON document_sequences      TO service_role;
GRANT ALL ON blanket_pos             TO service_role;
GRANT ALL ON blanket_po_lines        TO service_role;
GRANT ALL ON delivery_schedule_rules TO service_role;
GRANT ALL ON delivery_schedules      TO service_role;
