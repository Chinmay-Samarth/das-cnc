-- Absent days from attendance (ABSENT status) for the payroll month
-- Apply in Supabase SQL editor or via migration tooling

ALTER TABLE salary_payroll_lines
  ADD COLUMN IF NOT EXISTS absent_days numeric NOT NULL DEFAULT 0;
