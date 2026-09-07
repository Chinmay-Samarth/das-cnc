-- Tally Sales voucher sync columns on sales_invoices
-- Apply in Supabase SQL editor or via migration tooling

ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS tally_sync_status text,
  ADD COLUMN IF NOT EXISTS tally_sync_error text,
  ADD COLUMN IF NOT EXISTS tally_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS tally_voucher_number text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_invoices_tally_sync_status_check'
  ) THEN
    ALTER TABLE sales_invoices
      ADD CONSTRAINT sales_invoices_tally_sync_status_check
      CHECK (
        tally_sync_status IS NULL
        OR tally_sync_status IN ('pending', 'synced', 'failed', 'skipped')
      );
  END IF;
END $$;
