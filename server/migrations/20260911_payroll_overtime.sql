-- Overtime hours from attendance + overtime pay formula output
-- Apply in Supabase SQL editor or via migration tooling

ALTER TABLE salary_payroll_lines
  ADD COLUMN IF NOT EXISTS overtime_hours numeric NOT NULL DEFAULT 0;

ALTER TABLE salary_payroll_lines
  ADD COLUMN IF NOT EXISTS overtime_pay numeric NOT NULL DEFAULT 0;
