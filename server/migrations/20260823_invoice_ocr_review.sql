-- Invoice OCR review + supplier item aliases
-- Apply in Supabase SQL editor or via migration tooling

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS ocr_confidence_level numeric,
  ADD COLUMN IF NOT EXISTS ocr_warnings jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS review_status text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES employees(id);

CREATE TABLE IF NOT EXISTS supplier_invoice_item_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  scanned_description_raw text NOT NULL,
  scanned_description_normalized text NOT NULL,
  master_record_id uuid NOT NULL,
  master_slug text,
  item_category text,
  created_by uuid REFERENCES employees(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier_id, scanned_description_normalized)
);

CREATE INDEX IF NOT EXISTS idx_supplier_invoice_aliases_supplier
  ON supplier_invoice_item_aliases (supplier_id);

CREATE INDEX IF NOT EXISTS idx_supplier_invoice_aliases_normalized
  ON supplier_invoice_item_aliases (supplier_id, scanned_description_normalized);
