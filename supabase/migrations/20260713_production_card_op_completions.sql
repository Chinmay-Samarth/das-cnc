-- Per-operation completions ledger for WC handoffs + operator credit

CREATE TABLE IF NOT EXISTS production_card_op_completions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_card_id        uuid NOT NULL REFERENCES production_cards(id) ON DELETE CASCADE,
  activity_flow_node_id     uuid REFERENCES activity_flow_nodes(id) ON DELETE SET NULL,
  work_center_id            uuid REFERENCES work_centers(id) ON DELETE SET NULL,
  employee_id               uuid REFERENCES employees(id) ON DELETE SET NULL,
  good_qty                  numeric(14,4) NOT NULL DEFAULT 0 CHECK (good_qty >= 0),
  scrap_qty                 numeric(14,4) NOT NULL DEFAULT 0 CHECK (scrap_qty >= 0),
  completed_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pcoc_employee_completed
  ON production_card_op_completions (employee_id, completed_at);

CREATE INDEX IF NOT EXISTS idx_pcoc_card
  ON production_card_op_completions (production_card_id);

ALTER TABLE production_card_op_completions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON production_card_op_completions FROM anon, authenticated;
GRANT ALL ON production_card_op_completions TO service_role;
