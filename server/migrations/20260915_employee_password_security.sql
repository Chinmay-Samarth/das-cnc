-- Employee password security: bcrypt hash storage + first-login change flag
-- Apply in Supabase SQL editor or via migration tooling

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS password_hash text,
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;

COMMENT ON COLUMN employees.password_hash IS 'bcrypt hash; plaintext password column must be null after migration';
COMMENT ON COLUMN employees.must_change_password IS 'True after admin create/reset until employee changes password';
COMMENT ON COLUMN employees.password_changed_at IS 'Last successful self-service password change';
