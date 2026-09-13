-- Absent LOP deduction: basic / wage_period * absent_days
-- Apply in Supabase SQL editor or via migration tooling

ALTER TABLE salary_payroll_lines
  ADD COLUMN IF NOT EXISTS absent_deduction numeric NOT NULL DEFAULT 0;
