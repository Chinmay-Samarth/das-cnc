-- Allow draft schedule rules without validity dates (set on activate)
ALTER TABLE delivery_schedule_rules
  ALTER COLUMN valid_from DROP NOT NULL;
