-- Ensure all payroll dual-basic / Excel-model columns exist
-- Fixes ESI Basic saves being stripped when PostgREST retried missing optional columns

ALTER TABLE salary_payroll_lines
  ADD COLUMN IF NOT EXISTS esi_basic numeric NOT NULL DEFAULT 0;

ALTER TABLE salary_payroll_lines
  ADD COLUMN IF NOT EXISTS unauthorized_absent_days numeric NOT NULL DEFAULT 0;

ALTER TABLE salary_payroll_lines
  ADD COLUMN IF NOT EXISTS regular_earnings numeric NOT NULL DEFAULT 0;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS esi_basic_salary numeric;

UPDATE salary_payroll_lines
SET esi_basic = basic
WHERE COALESCE(esi_basic, 0) = 0 AND COALESCE(basic, 0) > 0;

NOTIFY pgrst, 'reload schema';
