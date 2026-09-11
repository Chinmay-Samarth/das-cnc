-- Add Emp.xls "Inc+ Prod All" column (incentive_paid + production_allowance)
-- Apply in Supabase SQL editor or via migration tooling

ALTER TABLE salary_payroll_lines
  ADD COLUMN IF NOT EXISTS inc_plus_prod_all numeric NOT NULL DEFAULT 0;
