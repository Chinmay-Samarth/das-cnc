-- RLS for inventory tables (Express uses service_role)

ALTER TABLE inventory_stock   ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_ledger  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON inventory_stock   FROM anon, authenticated;
REVOKE ALL ON inventory_ledger  FROM anon, authenticated;

GRANT ALL ON inventory_stock   TO service_role;
GRANT ALL ON inventory_ledger  TO service_role;
