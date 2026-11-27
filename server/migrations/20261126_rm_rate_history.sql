-- Raw material commercial rate history (invoice-observed)

CREATE TABLE IF NOT EXISTS rm_rate_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_record_id uuid NOT NULL REFERENCES master_records(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  rate numeric NOT NULL,
  tax_gst numeric,
  quantity numeric,
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  line_index integer,
  observed_at timestamptz NOT NULL DEFAULT now(),
  previous_rate numeric
);

CREATE INDEX IF NOT EXISTS idx_rm_rate_history_record_observed
  ON rm_rate_history (master_record_id, observed_at ASC);

CREATE INDEX IF NOT EXISTS idx_rm_rate_history_supplier_observed
  ON rm_rate_history (supplier_id, observed_at ASC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rm_rate_history_invoice_line
  ON rm_rate_history (invoice_id, line_index)
  WHERE invoice_id IS NOT NULL AND line_index IS NOT NULL;

ALTER TABLE rm_rate_history ENABLE ROW LEVEL SECURITY;
