-- Production cards (daily employee tasks), lots, outsource shipments
-- Run in Supabase SQL editor or via CLI

-- ─── production_cards ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS production_cards (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_number             text NOT NULL UNIQUE,
  delivery_schedule_id    uuid NOT NULL REFERENCES delivery_schedules(id) ON DELETE RESTRICT,
  master_record_id        uuid NOT NULL REFERENCES master_records(id) ON DELETE RESTRICT,
  assigned_employee_id    uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  work_date               date NOT NULL,
  target_quantity         numeric(14,4) NOT NULL CHECK (target_quantity > 0),
  overdue_quantity        numeric(14,4) NOT NULL DEFAULT 0 CHECK (overdue_quantity >= 0),
  total_good_produced     numeric(14,4) NOT NULL DEFAULT 0 CHECK (total_good_produced >= 0),
  total_scrap_produced    numeric(14,4) NOT NULL DEFAULT 0 CHECK (total_scrap_produced >= 0),
  backflushed_good_qty    numeric(14,4) NOT NULL DEFAULT 0 CHECK (backflushed_good_qty >= 0),
  status                  text NOT NULL DEFAULT 'READY'
                            CHECK (status IN ('READY', 'RUNNING', 'COMPLETED', 'OVERDUE')),
  started_at              timestamptz,
  completed_at            timestamptz,
  created_by              uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (delivery_schedule_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_pc_assignee_date ON production_cards (assigned_employee_id, work_date);
CREATE INDEX IF NOT EXISTS idx_pc_status ON production_cards (status);
CREATE INDEX IF NOT EXISTS idx_pc_work_date ON production_cards (work_date);
CREATE INDEX IF NOT EXISTS idx_pc_schedule ON production_cards (delivery_schedule_id);
CREATE INDEX IF NOT EXISTS idx_pc_component ON production_cards (master_record_id);

-- ─── production_lots ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS production_lots (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_number              text NOT NULL UNIQUE,
  master_record_id        uuid NOT NULL REFERENCES master_records(id) ON DELETE RESTRICT,
  production_card_id      uuid NOT NULL REFERENCES production_cards(id) ON DELETE CASCADE,
  activity_flow_node_id   uuid REFERENCES activity_flow_nodes(id) ON DELETE SET NULL,
  quantity                numeric(14,4) NOT NULL CHECK (quantity > 0),
  status                  text NOT NULL DEFAULT 'in_process'
                            CHECK (status IN ('in_process', 'at_supplier', 'received', 'consumed', 'merged')),
  merged_into_lot_id      uuid REFERENCES production_lots(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pl_card ON production_lots (production_card_id);
CREATE INDEX IF NOT EXISTS idx_pl_status ON production_lots (status);
CREATE INDEX IF NOT EXISTS idx_pl_component ON production_lots (master_record_id);

-- ─── production_lot_merges ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS production_lot_merges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  result_lot_id   uuid NOT NULL REFERENCES production_lots(id) ON DELETE CASCADE,
  source_lot_id   uuid NOT NULL REFERENCES production_lots(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (result_lot_id, source_lot_id)
);

-- ─── outsource_shipments ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS outsource_shipments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_number         text NOT NULL UNIQUE,
  production_card_id      uuid NOT NULL REFERENCES production_cards(id) ON DELETE CASCADE,
  activity_flow_node_id   uuid NOT NULL REFERENCES activity_flow_nodes(id) ON DELETE RESTRICT,
  supplier_id             uuid,
  status                  text NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft', 'sent', 'received', 'cancelled')),
  sent_at                 timestamptz,
  received_at             timestamptz,
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_os_card ON outsource_shipments (production_card_id);
CREATE INDEX IF NOT EXISTS idx_os_status ON outsource_shipments (status);

-- ─── outsource_shipment_lots ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS outsource_shipment_lots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id   uuid NOT NULL REFERENCES outsource_shipments(id) ON DELETE CASCADE,
  lot_id        uuid NOT NULL REFERENCES production_lots(id) ON DELETE RESTRICT,
  UNIQUE (shipment_id, lot_id)
);

CREATE INDEX IF NOT EXISTS idx_osl_shipment ON outsource_shipment_lots (shipment_id);
CREATE INDEX IF NOT EXISTS idx_osl_lot ON outsource_shipment_lots (lot_id);

-- ─── updated_at triggers ────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_production_cards_updated_at ON production_cards;
CREATE TRIGGER trg_production_cards_updated_at
  BEFORE UPDATE ON production_cards
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_production_lots_updated_at ON production_lots;
CREATE TRIGGER trg_production_lots_updated_at
  BEFORE UPDATE ON production_lots
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_outsource_shipments_updated_at ON outsource_shipments;
CREATE TRIGGER trg_outsource_shipments_updated_at
  BEFORE UPDATE ON outsource_shipments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Row Level Security ─────────────────────────────────────────────────────
ALTER TABLE production_cards          ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_lots           ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_lot_merges     ENABLE ROW LEVEL SECURITY;
ALTER TABLE outsource_shipments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE outsource_shipment_lots   ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON production_cards        FROM anon, authenticated;
REVOKE ALL ON production_lots         FROM anon, authenticated;
REVOKE ALL ON production_lot_merges   FROM anon, authenticated;
REVOKE ALL ON outsource_shipments     FROM anon, authenticated;
REVOKE ALL ON outsource_shipment_lots FROM anon, authenticated;

GRANT ALL ON production_cards         TO service_role;
GRANT ALL ON production_lots          TO service_role;
GRANT ALL ON production_lot_merges    TO service_role;
GRANT ALL ON outsource_shipments      TO service_role;
GRANT ALL ON outsource_shipment_lots  TO service_role;
