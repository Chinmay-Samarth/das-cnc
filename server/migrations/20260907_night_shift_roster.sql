-- Weekly night-shift roster (ISO week Monday start)
-- Apply in Supabase SQL editor or via migration tooling

CREATE TABLE IF NOT EXISTS night_shift_roster_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start_date date NOT NULL,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES employees(id),
  UNIQUE (week_start_date, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_night_shift_roster_week
  ON night_shift_roster_members (week_start_date);

CREATE INDEX IF NOT EXISTS idx_night_shift_roster_employee
  ON night_shift_roster_members (employee_id);

-- Seed current ISO week with employees already on Night
INSERT INTO night_shift_roster_members (week_start_date, employee_id)
SELECT
  (CURRENT_DATE - ((EXTRACT(ISODOW FROM CURRENT_DATE)::integer - 1)))::date AS week_start_date,
  e.id
FROM employees e
JOIN shifts s ON s.id = e.shift_id
WHERE e.is_active = true
  AND s.name = 'Night'
ON CONFLICT (week_start_date, employee_id) DO NOTHING;
