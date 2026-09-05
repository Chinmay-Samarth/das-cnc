-- Tally ledger mapping + vendor invoice Purchase voucher sync
-- Apply in Supabase SQL editor or via migration tooling

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS ledger_name text,
  ADD COLUMN IF NOT EXISTS tally_expense_ledger_type text;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS ledger_name text;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS tally_expense_ledger_type text,
  ADD COLUMN IF NOT EXISTS tally_sync_status text,
  ADD COLUMN IF NOT EXISTS tally_sync_error text,
  ADD COLUMN IF NOT EXISTS tally_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS tally_voucher_number text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_tally_expense_ledger_type_check'
  ) THEN
    ALTER TABLE suppliers
      ADD CONSTRAINT suppliers_tally_expense_ledger_type_check
      CHECK (
        tally_expense_ledger_type IS NULL
        OR tally_expense_ledger_type IN ('labour', 'labour_service', 'raw_material')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_tally_expense_ledger_type_check'
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT invoices_tally_expense_ledger_type_check
      CHECK (
        tally_expense_ledger_type IS NULL
        OR tally_expense_ledger_type IN ('labour', 'labour_service', 'raw_material')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_tally_sync_status_check'
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT invoices_tally_sync_status_check
      CHECK (
        tally_sync_status IS NULL
        OR tally_sync_status IN ('pending', 'synced', 'failed', 'skipped')
      );
  END IF;
END $$;
