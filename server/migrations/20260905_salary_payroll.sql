-- Monthly payroll + formula versioning + leave pay type + employee account_type
-- Apply in Supabase SQL editor or via migration tooling

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS account_type text;

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS pay_type text;

ALTER TABLE leave_requests
  DROP CONSTRAINT IF EXISTS leave_requests_pay_type_check;

ALTER TABLE leave_requests
  ADD CONSTRAINT leave_requests_pay_type_check
  CHECK (pay_type IS NULL OR pay_type IN ('paid', 'unpaid'));

CREATE TABLE IF NOT EXISTS salary_formula_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_number integer NOT NULL UNIQUE,
  label text,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  formulas jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES employees(id)
);

CREATE TABLE IF NOT EXISTS salary_payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year integer NOT NULL,
  month integer NOT NULL CHECK (month >= 1 AND month <= 12),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'locked')),
  formula_version_id uuid NOT NULL REFERENCES salary_formula_versions(id),
  locked_at timestamptz,
  locked_by uuid REFERENCES employees(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (year, month)
);

CREATE TABLE IF NOT EXISTS salary_payroll_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES salary_payroll_runs(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id),
  formula_version_id uuid NOT NULL REFERENCES salary_formula_versions(id),
  wage_period integer NOT NULL DEFAULT 0,
  days_worked numeric NOT NULL DEFAULT 0,
  paid_leave numeric NOT NULL DEFAULT 0,
  earned_leave numeric NOT NULL DEFAULT 0,
  basic numeric NOT NULL DEFAULT 0,
  incentive_paid numeric NOT NULL DEFAULT 0,
  production_allowance numeric NOT NULL DEFAULT 0,
  basic_earned numeric NOT NULL DEFAULT 0,
  allowance numeric NOT NULL DEFAULT 0,
  allowance_plus_pa numeric NOT NULL DEFAULT 0,
  total_earned numeric NOT NULL DEFAULT 0,
  esi numeric NOT NULL DEFAULT 0,
  pf numeric NOT NULL DEFAULT 0,
  pt numeric NOT NULL DEFAULT 0,
  total_deductions numeric NOT NULL DEFAULT 0,
  net_paid numeric NOT NULL DEFAULT 0,
  manual_overrides jsonb NOT NULL DEFAULT '[]'::jsonb,
  computed_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_salary_payroll_runs_ym
  ON salary_payroll_runs (year, month);

CREATE INDEX IF NOT EXISTS idx_salary_payroll_lines_run
  ON salary_payroll_lines (run_id);

CREATE INDEX IF NOT EXISTS idx_salary_payroll_lines_employee
  ON salary_payroll_lines (employee_id);

CREATE INDEX IF NOT EXISTS idx_leave_requests_pay_type
  ON leave_requests (employee_id, status, pay_type);

INSERT INTO salary_formula_versions (version_number, label, effective_from, formulas)
SELECT
  1,
  'Excel baseline (empwithsalary)',
  CURRENT_DATE,
  '{
    "basic_earned": "IF(basic > 0, basic / wage_period * (days_worked + paid_leave + earned_leave), 0)",
    "allowance": "basic_earned * 0.15",
    "allowance_plus_pa": "allowance + production_allowance",
    "total_earned": "basic_earned + allowance + production_allowance + incentive_paid",
    "esi": "total_earned * 0.75 / 100",
    "pf": "IF((basic_earned + allowance) <= 15000, (basic_earned + allowance) * 0.12, 15000 * 0.12)",
    "pt": "IF(total_earned > 25000, 200, 0)",
    "total_deductions": "esi + pf + pt",
    "net_paid": "total_earned - total_deductions"
  }'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM salary_formula_versions WHERE version_number = 1
);
