-- Multi-category GIRN schema changes
-- Run in Supabase SQL editor

ALTER TABLE girn_items
  ADD COLUMN IF NOT EXISTS item_category text NOT NULL DEFAULT 'raw_material',
  ADD COLUMN IF NOT EXISTS master_record_id uuid,
  ADD COLUMN IF NOT EXISTS quantity_type text NOT NULL DEFAULT 'kg',
  ADD COLUMN IF NOT EXISTS item_code text,
  ADD COLUMN IF NOT EXISTS item_description text,
  ADD COLUMN IF NOT EXISTS lot_number text,
  ADD COLUMN IF NOT EXISTS quantity_ok numeric,
  ADD COLUMN IF NOT EXISTS quantity_not_ok numeric;

UPDATE girn_items
SET master_record_id = raw_material_id
WHERE master_record_id IS NULL AND raw_material_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS inventory_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_category text NOT NULL,
  master_record_id uuid NOT NULL,
  lot_number text,
  current_stock numeric NOT NULL DEFAULT 0,
  unit text,
  UNIQUE NULLS NOT DISTINCT (item_category, master_record_id, lot_number)
);

CREATE TABLE IF NOT EXISTS inventory_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_category text NOT NULL,
  master_record_id uuid NOT NULL,
  lot_number text,
  change_qty numeric NOT NULL,
  reason text NOT NULL,
  reference_id uuid,
  note text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS component_lot_sequences (
  master_record_id uuid NOT NULL,
  lot_date date NOT NULL,
  last_seq int NOT NULL DEFAULT 0,
  PRIMARY KEY (master_record_id, lot_date)
);

-- Migrate legacy raw material stock (run once if tables exist)
INSERT INTO inventory_stock (item_category, master_record_id, current_stock, unit)
SELECT 'raw_material', raw_material_id, current_stock, unit
FROM raw_material_stock
ON CONFLICT DO NOTHING;

INSERT INTO inventory_ledger (item_category, master_record_id, change_qty, reason, reference_id, note, created_at)
SELECT 'raw_material', raw_material_id, change_qty, reason, reference_id, note, COALESCE(created_at, now())
FROM stock_ledger
ON CONFLICT DO NOTHING;
