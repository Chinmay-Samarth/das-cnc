-- RFD lots can pin which delivery schedule they invoice/dispatch against
-- (campaign cards leave delivery_schedule_id null; operator chooses when past-due + upcoming)

ALTER TABLE production_lots
  ADD COLUMN IF NOT EXISTS delivery_schedule_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'production_lots_delivery_schedule_id_fkey'
  ) THEN
    ALTER TABLE production_lots
      ADD CONSTRAINT production_lots_delivery_schedule_id_fkey
      FOREIGN KEY (delivery_schedule_id)
      REFERENCES delivery_schedules(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS production_lots_delivery_schedule_id_idx
  ON production_lots (delivery_schedule_id)
  WHERE delivery_schedule_id IS NOT NULL;
