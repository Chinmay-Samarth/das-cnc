-- Link outsource-return GIRNs to shipments
-- Fixes: Could not find the 'outsource_shipment_id' column of 'girns' in the schema cache

ALTER TABLE public.girns
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS outsource_shipment_id uuid;

ALTER TABLE public.girns
  DROP CONSTRAINT IF EXISTS girns_source_check;

ALTER TABLE public.girns
  ADD CONSTRAINT girns_source_check
  CHECK (source IN ('standard', 'outsource_return'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'girns_outsource_shipment_id_fkey'
  ) THEN
    ALTER TABLE public.girns
      ADD CONSTRAINT girns_outsource_shipment_id_fkey
      FOREIGN KEY (outsource_shipment_id)
      REFERENCES public.outsource_shipments(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS girns_outsource_shipment_id_idx
  ON public.girns (outsource_shipment_id)
  WHERE outsource_shipment_id IS NOT NULL;

ALTER TABLE public.outsource_shipments
  ADD COLUMN IF NOT EXISTS girn_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outsource_shipments_girn_id_fkey'
  ) THEN
    ALTER TABLE public.outsource_shipments
      ADD CONSTRAINT outsource_shipments_girn_id_fkey
      FOREIGN KEY (girn_id)
      REFERENCES public.girns(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS outsource_shipments_girn_id_uidx
  ON public.outsource_shipments (girn_id)
  WHERE girn_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
