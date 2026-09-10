-- Dispatch / sales redesign: packet size, packing slip print gate, receipt sync
-- Apply in Supabase SQL editor or via migration tooling

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS components_per_packet numeric;

ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS packing_slip_printed_at timestamptz,
  ADD COLUMN IF NOT EXISTS packing_slip_printed_by uuid,
  ADD COLUMN IF NOT EXISTS payment_bank_ledger text,
  ADD COLUMN IF NOT EXISTS tally_receipt_sync_status text,
  ADD COLUMN IF NOT EXISTS tally_receipt_sync_error text,
  ADD COLUMN IF NOT EXISTS tally_receipt_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS tally_receipt_voucher_number text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_invoices_tally_receipt_sync_status_check'
  ) THEN
    ALTER TABLE sales_invoices
      ADD CONSTRAINT sales_invoices_tally_receipt_sync_status_check
      CHECK (
        tally_receipt_sync_status IS NULL
        OR tally_receipt_sync_status IN ('pending', 'synced', 'failed', 'skipped')
      );
  END IF;
END $$;
