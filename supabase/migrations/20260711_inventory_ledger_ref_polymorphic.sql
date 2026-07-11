-- Allow inventory_ledger.reference_id to point at non-GIRN sources (e.g. production cards on backflush)
ALTER TABLE inventory_ledger
  DROP CONSTRAINT IF EXISTS inventory_ledger_reference_id_fkey;
