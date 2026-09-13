-- Excel payroll model columns:
-- unauthorized_absent_days: input for 1.5× LOP cut
-- regular_earnings: Basic Earned + Allowance + Incentive + Production Allowance (excludes OT)

ALTER TABLE salary_payroll_lines
  ADD COLUMN IF NOT EXISTS unauthorized_absent_days numeric NOT NULL DEFAULT 0;

ALTER TABLE salary_payroll_lines
  ADD COLUMN IF NOT EXISTS regular_earnings numeric NOT NULL DEFAULT 0;
