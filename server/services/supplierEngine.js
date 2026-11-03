const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function clean(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

/**
 * Create a supplier from OCR / invoice scan data.
 * Uses insert (not upsert) so missing unique keys do not fail the write.
 */
async function createSupplierFromInvoice(dataBody = {}) {
  const name = clean(dataBody.name);
  const gstin = clean(dataBody.GSTIN || dataBody.gstin);
  if (!name && !gstin) {
    throw new Error('Supplier name or GSTIN is required');
  }

  const insertPayload = {
    name: name || `Supplier ${gstin}`,
    ledger_name: name || `Supplier ${gstin}`,
    contact_phone: clean(dataBody.contact_number || dataBody.contact_phone),
    GSTIN: gstin,
    state: clean(dataBody.state),
    ifsc: clean(dataBody.IFSC || dataBody.ifsc),
    account_number: clean(dataBody.account_number),
    email: clean(dataBody.email),
    billing_address: clean(dataBody.billing_address),
    customer_recommended: false,
  };

  const { data: newSupplier, error: dbError } = await supabase
    .from('suppliers')
    .insert(insertPayload)
    .select('*')
    .single();

  if (dbError) throw dbError;
  return [newSupplier];
}

module.exports = { createSupplierFromInvoice };
