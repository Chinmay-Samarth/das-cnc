-- Enforce unique purchase invoice numbers per supplier (active rows only).
-- Cancelled / superseded drafts are excluded so OCR retries can reuse a number after abandon.

CREATE UNIQUE INDEX IF NOT EXISTS invoices_supplier_invoice_number_uidx
  ON invoices (supplier_id, lower(trim(invoice_number)))
  WHERE supplier_id IS NOT NULL
    AND invoice_number IS NOT NULL
    AND trim(invoice_number) <> ''
    AND status IS DISTINCT FROM 'cancelled'
    AND (review_status IS NULL OR review_status IS DISTINCT FROM 'superseded');
