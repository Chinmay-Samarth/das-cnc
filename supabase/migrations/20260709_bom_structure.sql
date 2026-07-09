-- BOM versioning + structure edges
-- Run in Supabase SQL editor or via CLI

-- ─── bom_versions (revision header) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bom_versions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_record_id  uuid NOT NULL REFERENCES master_records(id) ON DELETE CASCADE,
  revision          int  NOT NULL DEFAULT 1 CHECK (revision > 0),
  status            text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'active', 'retired')),
  valid_from        date,
  valid_to          date,
  created_by        uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (master_record_id, revision),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bom_versions_one_active_per_record
  ON bom_versions (master_record_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_bom_versions_master_record
  ON bom_versions (master_record_id);

CREATE INDEX IF NOT EXISTS idx_bom_versions_effective
  ON bom_versions (master_record_id, valid_from, valid_to);

-- ─── bom_structure (edges per version) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bom_structure (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_version_id    uuid NOT NULL REFERENCES bom_versions(id) ON DELETE CASCADE,
  parent_element_id uuid NOT NULL REFERENCES master_records(id) ON DELETE CASCADE,
  child_element_id  uuid NOT NULL REFERENCES master_records(id) ON DELETE CASCADE,
  quantity          numeric(14,4) NOT NULL CHECK (quantity > 0),
  uom               varchar(20) NOT NULL,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_element_id <> child_element_id),
  UNIQUE (bom_version_id, parent_element_id, child_element_id)
);

CREATE INDEX IF NOT EXISTS idx_bom_structure_version ON bom_structure (bom_version_id);
CREATE INDEX IF NOT EXISTS idx_bom_structure_parent  ON bom_structure (bom_version_id, parent_element_id);

-- ─── updated_at triggers ────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_bom_versions_updated_at ON bom_versions;
CREATE TRIGGER trg_bom_versions_updated_at
  BEFORE UPDATE ON bom_versions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_bom_structure_updated_at ON bom_structure;
CREATE TRIGGER trg_bom_structure_updated_at
  BEFORE UPDATE ON bom_structure
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Row Level Security ─────────────────────────────────────────────────────
ALTER TABLE bom_versions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_structure ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON bom_versions  FROM anon, authenticated;
REVOKE ALL ON bom_structure FROM anon, authenticated;

GRANT ALL ON bom_versions  TO service_role;
GRANT ALL ON bom_structure TO service_role;
