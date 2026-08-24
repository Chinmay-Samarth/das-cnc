const { createClient } = require('@supabase/supabase-js');
const { createSupplierFromInvoice } = require('./supplierEngine');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function clean(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

async function findSupplierByGstin(gstin) {
  if (!gstin) return null;

  const { data, error } = await supabase
    .from('suppliers')
    .select('id')
    .eq('GSTIN', gstin)
    .maybeSingle();

  if (error) throw error;
  return data?.id ?? null;
}

async function findSupplierByName(name) {
  if (!name) return null;

  const { data, error } = await supabase
    .from('suppliers')
    .select('id, name')
    .ilike('name', name)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.id ?? null;
}

async function ensureSupplier(supplierData = {}) {
  const name = clean(supplierData.name || supplierData.supplier_name);
  const gstin = clean(supplierData.GSTIN || supplierData.gstin || supplierData.supplier_gstin);
  const looksLikeAddress =
    name &&
    /district|kanchee|layout|cross|peenya|industrial|fac\.|sipcot/i.test(name) &&
    !/pvt|ltd|limited|llp|company|works|enterprises/i.test(name);
  const safeName = looksLikeAddress ? null : name;

  if (supplierData.supplier_id || supplierData.id) {
    return supplierData.supplier_id || supplierData.id;
  }

  if (gstin) {
    const existingByGstin = await findSupplierByGstin(gstin);
    if (existingByGstin) return existingByGstin;
  }

  if (safeName) {
    const existingByName = await findSupplierByName(safeName);
    if (existingByName) return existingByName;
  }

  if (!safeName && !gstin) {
    throw new Error('Supplier name or GSTIN is required to create a supplier');
  }

  const created = await createSupplierFromInvoice({
    name: safeName || `Supplier ${gstin}`,
    GSTIN: gstin,
    state: clean(supplierData.state || supplierData.supplier_state),
    IFSC: clean(supplierData.IFSC || supplierData.ifsc),
    account_number: clean(supplierData.account_number),
    email: clean(supplierData.email),
    billing_address: clean(supplierData.billing_address || supplierData.supplier_billing_address),
    contact_number: clean(supplierData.contact_phone),
  });

  return created?.[0]?.id ?? null;
}

function supplierPayloadFromOcrDoc(doc) {
  if (!doc || typeof doc !== 'object') return {};

  // Custom Invoice OCR (Paddle) response shape
  if (doc.supplier && typeof doc.supplier === 'object') {
    return {
      name: clean(doc.supplier.name),
      GSTIN: clean(doc.supplier.gstin),
      state: clean(doc.supplier.billing_state),
      IFSC: clean(doc.bank?.ifsc),
      account_number: clean(doc.bank?.account_number),
      email: clean(doc.supplier.email),
      billing_address: clean(
        doc.supplier.billing_address || doc.supplier.current_address
      ),
      contact_phone: clean(doc.supplier.phone),
    };
  }

  // Legacy Mindee field shape (older stored raw_ocr_response)
  const payment = Array.isArray(doc?.supplier_payment_details?.items)
    ? doc.supplier_payment_details.items[0]?.fields || {}
    : {};

  let gstin = null;
  if (Array.isArray(doc?.supplier_company_registration?.items)) {
    for (const item of doc.supplier_company_registration.items) {
      if (item.fields?.type?.value === 'GSTIN') {
        gstin = item.fields?.number?.value || null;
        break;
      }
    }
  }

  return {
    name: doc?.supplier_name?.value || null,
    GSTIN: gstin,
    state: doc?.supplier_address?.fields?.state?.value || null,
    IFSC: payment.swift?.value || null,
    account_number: payment.account_number?.value || null,
    email: doc?.supplier_payment_details?.supplier_email?.value ?? null,
    billing_address: doc?.supplier_address?.fields?.address?.value || null,
  };
}

function supplierPayloadFromInvoice(invoice) {
  if (!invoice) return {};

  const joined = invoice.suppliers || {};
  const ocrPayload = invoice.raw_ocr_response
    ? supplierPayloadFromOcrDoc(invoice.raw_ocr_response)
    : {};

  return {
    supplier_id: invoice.supplier_id || joined.id || null,
    name: joined.name || ocrPayload.name || null,
    GSTIN: joined.GSTIN || ocrPayload.GSTIN || null,
    state: joined.state || ocrPayload.state || null,
    billing_address: joined.billing_address || ocrPayload.billing_address || null,
    account_number: joined.account_number || ocrPayload.account_number || null,
    ifsc: joined.ifsc || ocrPayload.IFSC || null,
    email: joined.email || ocrPayload.email || null,
  };
}

module.exports = {
  ensureSupplier,
  supplierPayloadFromInvoice,
  supplierPayloadFromOcrDoc,
};
