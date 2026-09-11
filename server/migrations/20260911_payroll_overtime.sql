-- Overtime hours from attendance + OT hourly rate + overtime pay
-- Apply in Supabase SQL editor or via migration tooling

ALTER TABLE salary_payroll_lines
  ADD COLUMN IF NOT EXISTS overtime_hours numeric NOT NULL DEFAULT 0;

ALTER TABLE salary_payroll_lines
  ADD COLUMN IF NOT EXISTS overtime_hourly_rate numeric NOT NULL DEFAULT 0;

ALTER TABLE salary_payroll_lines
  ADD COLUMN IF NOT EXISTS overtime_pay numeric NOT NULL DEFAULT 0;
