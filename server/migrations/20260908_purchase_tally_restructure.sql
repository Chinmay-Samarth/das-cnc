-- Purchase invoice payment sync + PO advances + bank ledger
-- Apply in Supabase SQL editor or via migration tooling

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS tally_payment_sync_status text,
  ADD COLUMN IF NOT EXISTS tally_payment_sync_error text,
  ADD COLUMN IF NOT EXISTS tally_payment_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS tally_payment_voucher_number text,
  ADD COLUMN IF NOT EXISTS payment_bank_ledger text,
  ADD COLUMN IF NOT EXISTS po_advance_amount numeric;

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS advance_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS advance_paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS advance_reference text,
  ADD COLUMN IF NOT EXISTS advance_bank_ledger text,
  ADD COLUMN IF NOT EXISTS tally_advance_sync_status text,
  ADD COLUMN IF NOT EXISTS tally_advance_sync_error text,
  ADD COLUMN IF NOT EXISTS tally_advance_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS tally_advance_voucher_number text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_tally_payment_sync_status_check'
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT invoices_tally_payment_sync_status_check
      CHECK (
        tally_payment_sync_status IS NULL
        OR tally_payment_sync_status IN ('pending', 'synced', 'failed', 'skipped')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_tally_advance_sync_status_check'
  ) THEN
    ALTER TABLE purchase_orders
      ADD CONSTRAINT purchase_orders_tally_advance_sync_status_check
      CHECK (
        tally_advance_sync_status IS NULL
        OR tally_advance_sync_status IN ('pending', 'synced', 'failed', 'skipped')
      );
  END IF;
END $$;
