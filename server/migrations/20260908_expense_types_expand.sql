-- Expand supplier / invoice expense types to match Purchase Accounts chart

ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_tally_expense_ledger_type_check;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_tally_expense_ledger_type_check;

ALTER TABLE suppliers
  ADD CONSTRAINT suppliers_tally_expense_ledger_type_check
  CHECK (
    tally_expense_ledger_type IS NULL
    OR tally_expense_ledger_type IN (
      'labour',
      'labour_service',
      'consumable',
      'raw_material',
      'spares_and_tools'
    )
  );

ALTER TABLE invoices
  ADD CONSTRAINT invoices_tally_expense_ledger_type_check
  CHECK (
    tally_expense_ledger_type IS NULL
    OR tally_expense_ledger_type IN (
      'labour',
      'labour_service',
      'consumable',
      'raw_material',
      'spares_and_tools'
    )
  );
