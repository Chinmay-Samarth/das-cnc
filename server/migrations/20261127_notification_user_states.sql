-- Per-user notification ledger: read/dismiss are independent per employee.
-- Master `notifications` rows remain the shared alert event; this table stores
-- each admin's personal inbox state.

CREATE TABLE IF NOT EXISTS notification_user_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'unread'
    CHECK (status IN ('unread', 'read', 'dismissed')),
  read_at timestamptz,
  dismissed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_user_states_unique UNIQUE (notification_id, employee_id)
);

CREATE INDEX IF NOT EXISTS notification_user_states_employee_status_idx
  ON notification_user_states (employee_id, status);

CREATE INDEX IF NOT EXISTS notification_user_states_notification_idx
  ON notification_user_states (notification_id);
