-- Persist round_off and ensure tax_items entries carry GST kind (CGST/SGST/IGST/UTGST)
-- Apply in Supabase SQL editor or via migration tooling

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS round_off numeric DEFAULT 0;

-- Backfill missing kind on existing tax_items JSONB rows
UPDATE invoices
SET tax_items = (
  WITH elems AS (
    SELECT
      ordinality,
      elem,
      CASE
        WHEN NULLIF(elem->>'rate', '') IS NULL THEN NULL
        WHEN (elem->>'rate')::numeric > 0 AND (elem->>'rate')::numeric <= 1
          THEN (elem->>'rate')::numeric * 100
        ELSE (elem->>'rate')::numeric
      END AS rate_pct
    FROM jsonb_array_elements(COALESCE(tax_items, '[]'::jsonb))
      WITH ORDINALITY AS t(elem, ordinality)
  ),
  tagged AS (
    SELECT
      ordinality,
      elem,
      rate_pct,
      SUM(
        CASE
          WHEN COALESCE(elem->>'kind', '') = ''
            AND rate_pct IS NOT NULL
            AND rate_pct <= 14
          THEN 1 ELSE 0
        END
      ) OVER (ORDER BY ordinality ROWS UNBOUNDED PRECEDING) AS half_seq
    FROM elems
  )
  SELECT COALESCE(
    jsonb_agg(
      CASE
        WHEN upper(COALESCE(elem->>'kind', '')) IN ('CGST', 'SGST', 'IGST', 'UTGST')
          THEN elem || jsonb_build_object('kind', upper(elem->>'kind'))
        WHEN rate_pct IS NOT NULL AND rate_pct > 14
          THEN elem || jsonb_build_object('kind', 'IGST')
        WHEN rate_pct IS NOT NULL AND rate_pct <= 14
          THEN elem || jsonb_build_object(
            'kind',
            CASE WHEN half_seq % 2 = 1 THEN 'CGST' ELSE 'SGST' END
          )
        ELSE elem || jsonb_build_object('kind', 'GST')
      END
      ORDER BY ordinality
    ),
    '[]'::jsonb
  )
  FROM tagged
)
WHERE tax_items IS NOT NULL
  AND jsonb_typeof(tax_items) = 'array'
  AND jsonb_array_length(tax_items) > 0
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(tax_items) e
    WHERE upper(COALESCE(e->>'kind', '')) NOT IN ('CGST', 'SGST', 'IGST', 'UTGST')
  );

COMMENT ON COLUMN invoices.round_off IS 'Invoice round-off amount (can be negative)';
COMMENT ON COLUMN invoices.tax_items IS 'JSON array of {kind, rate, base, amount}; kind is CGST|SGST|IGST|UTGST';
