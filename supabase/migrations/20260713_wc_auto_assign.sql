-- Automatic work-center assignment: employee↔WC + production card routing fields

CREATE TABLE IF NOT EXISTS employee_work_centers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_center_id  uuid NOT NULL REFERENCES work_centers(id) ON DELETE CASCADE,
  is_primary      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, work_center_id)
);

CREATE INDEX IF NOT EXISTS idx_ewc_employee ON employee_work_centers (employee_id);
CREATE INDEX IF NOT EXISTS idx_ewc_work_center ON employee_work_centers (work_center_id);

-- production_cards: nullable assignee + WC / current AF node
ALTER TABLE production_cards
  ALTER COLUMN assigned_employee_id DROP NOT NULL;

ALTER TABLE production_cards
  ADD COLUMN IF NOT EXISTS work_center_id uuid REFERENCES work_centers(id) ON DELETE SET NULL;

ALTER TABLE production_cards
  ADD COLUMN IF NOT EXISTS current_activity_flow_node_id uuid REFERENCES activity_flow_nodes(id) ON DELETE SET NULL;

ALTER TABLE production_cards
  ADD COLUMN IF NOT EXISTS assignment_status text NOT NULL DEFAULT 'assigned'
    CHECK (assignment_status IN ('unassigned', 'assigned', 'blocked'));

-- Backfill assignment_status for existing rows
UPDATE production_cards
SET assignment_status = CASE
  WHEN assigned_employee_id IS NULL THEN 'unassigned'
  ELSE 'assigned'
END
WHERE assignment_status IS DISTINCT FROM CASE
  WHEN assigned_employee_id IS NULL THEN 'unassigned'
  ELSE 'assigned'
END;

CREATE INDEX IF NOT EXISTS idx_pc_wc_date_status
  ON production_cards (work_center_id, work_date, status);

CREATE INDEX IF NOT EXISTS idx_pc_assignment_status
  ON production_cards (assignment_status)
  WHERE assignment_status <> 'assigned';

ALTER TABLE employee_work_centers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON employee_work_centers FROM anon, authenticated;
GRANT ALL ON employee_work_centers TO service_role;
