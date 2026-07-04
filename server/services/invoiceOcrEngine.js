const Mindee = require('mindee');
const { createClient } = require('@supabase/supabase-js');
const { ensureSupplier, supplierPayloadFromOcrDoc } = require('./girnSupplierEngine');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const mindeeClient = new Mindee.Client({ apiKey: process.env.MINDEE_API_KEY });

const MODEL_PARAMS = {
  modelId: '31f0fcc3-093f-401a-abae-ade4a5158e69',
  rag: true,
  rawText: false,
  polygon: false,
  confidence: false,
};

function getValue(field) {
  return field?.value ?? null;
}

function getItems(field) {
  return Array.isArray(field?.items) ? field.items : [];
}

function extractIrn(doc) {
  for (const item of getItems(doc.reference_numbers)) {
    if (typeof item.value === 'string' && item.value.length === 64) {
      return item.value;
    }
  }
  return null;
}

function normalizeLineItems(doc) {
  return getItems(doc.line_items).map((item) => ({
    description: item.fields?.description?.value || '',
    quantity: item.fields?.quantity?.value ?? null,
    unit_price: item.fields?.unit_price?.value ?? null,
    total: item.fields?.total_price?.value ?? null,
  }));
}

function normalizeTaxItems(doc) {
  return getItems(doc.taxes).map((item) => ({
    rate: item.fields?.rate?.value ?? null,
    base: item.fields?.base?.value ?? null,
    amount: item.fields?.amount?.value ?? item.fields?.base?.value ?? null,
  }));
}

async function updateInvoiceStatus(invoiceId, status) {
  const { error } = await supabase
    .from('invoices')
    .update({ status })
    .eq('id', invoiceId);

  if (error) throw error;
}

async function getInvoice(invoiceId) {
  const { data, error } = await supabase
    .from('invoices')
    .select(`*,
      suppliers(
        id,
        name,
        billing_address,
        account_number,
        ifsc,
        GSTIN,
        state
      )`)
    .eq('id', invoiceId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function resolveSupplier(doc) {
  const payload = supplierPayloadFromOcrDoc(doc);
  const name = String(payload.name || '').trim();
  const gstin = String(payload.GSTIN || '').trim();

  if (!name && !gstin) {
    return null;
  }

  try {
    return await ensureSupplier(payload);
  } catch (err) {
    console.error('Supplier resolve error:', err);
    return null;
  }
}

async function uploadInvoiceFile(file) {
  const fileName = `invoices/${Date.now()}_${file.originalname}`;
  const inputSource = new Mindee.BufferInput({
    buffer: file.buffer,
    filename: fileName,
  });

  const { error: storageError } = await supabase.storage
    .from('invoices')
    .upload(fileName, file.buffer, { contentType: file.mimetype });

  if (storageError) throw storageError;

  const { data: publicUrlData } = supabase.storage
    .from('invoices')
    .getPublicUrl(fileName);

  const publicUrl = publicUrlData?.publicUrl || null;

  const { data: invoice, error: dbError } = await supabase
    .from('invoices')
    .insert({ status: 'extracting', file_url: publicUrl })
    .select()
    .single();

  if (dbError) throw dbError;

  return { invoice, inputSource, publicUrl };
}

async function processInvoiceOCR(invoiceId, inputSource, publicUrl) {
  const apiResponse = await mindeeClient.enqueueAndGetResult(
    Mindee.product.Extraction,
    inputSource,
    MODEL_PARAMS
  );

  const doc = apiResponse.rawHttp.inference.result.fields;

  await updateInvoiceStatus(invoiceId, 'saving');

  const supplierId = await resolveSupplier(doc);
  const lineItems = normalizeLineItems(doc);
  const taxItems = normalizeTaxItems(doc);

  const invoiceData = {
    status: 'pending',
    file_url: publicUrl,
    invoice_number: getValue(doc.invoice_number),
    invoice_date: getValue(doc.date),
    due_date: getValue(doc.due_date),
    base_amount: getValue(doc.total_net),
    total_amount: getValue(doc.total_amount),
    tax_amount: getValue(doc.total_tax),
    line_items: lineItems,
    tax_items: taxItems,
    raw_ocr_response: doc,
    customer_GSTIN: getItems(doc.customer_company_registration)[0]?.fields?.number?.value || null,
    IRN: extractIrn(doc),
    supplier_id: supplierId,
  };

  const { error: dbError } = await supabase
    .from('invoices')
    .update(invoiceData)
    .eq('id', invoiceId);

  if (dbError) throw dbError;

  return {
    invoice: await getInvoice(invoiceId),
    fields: doc,
    lineItems,
    taxItems,
  };
}

async function startInvoiceOCR(file) {
  const uploaded = await uploadInvoiceFile(file);
  const processing = processInvoiceOCR(
    uploaded.invoice.id,
    uploaded.inputSource,
    uploaded.publicUrl
  ).catch(async (err) => {
    console.error('Invoice processing error', err);
    try {
      await updateInvoiceStatus(uploaded.invoice.id, 'error');
    } catch (statusErr) {
      console.error('Unable to mark invoice processing as failed', statusErr);
    }
  });

  return {
    invoice: uploaded.invoice,
    processing,
  };
}

async function extractInvoiceNow(file) {
  const uploaded = await uploadInvoiceFile(file);
  return processInvoiceOCR(uploaded.invoice.id, uploaded.inputSource, uploaded.publicUrl);
}

module.exports = {
  extractInvoiceNow,
  getInvoice,
  processInvoiceOCR,
  startInvoiceOCR,
  updateInvoiceStatus,
};
