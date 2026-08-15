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

function ymdPartsIst(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return ymdPartsIst(new Date());
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const pick = (type) => Number(parts.find((p) => p.type === type)?.value);
  return { year: pick('year'), month: pick('month'), day: pick('day') };
}

function isoDateUtc(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function daysBetweenYmd(from, to) {
  const fromStr = String(from || '').slice(0, 10);
  const toStr = String(to || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromStr) || !/^\d{4}-\d{2}-\d{2}$/.test(toStr)) return null;
  const start = Date.UTC(
    Number(fromStr.slice(0, 4)),
    Number(fromStr.slice(5, 7)) - 1,
    Number(fromStr.slice(8, 10))
  );
  const end = Date.UTC(
    Number(toStr.slice(0, 4)),
    Number(toStr.slice(5, 7)) - 1,
    Number(toStr.slice(8, 10))
  );
  return Math.round((end - start) / 86400000);
}

async function nextRegisterSerial(createdAt) {
  const { year, month } = ymdPartsIst(createdAt);
  const start = new Date(`${isoDateUtc(year, month, 1)}T00:00:00+05:30`).toISOString();
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const end = new Date(`${isoDateUtc(nextYear, nextMonth, 1)}T00:00:00+05:30`).toISOString();

  const { count, error } = await supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', start)
    .lt('created_at', end)
    .not('register_serial', 'is', null);

  if (error) throw error;
  const n = (count || 0) + 1;
  return `A${String(n).padStart(2, '0')}`;
}

function normalizeLineItems(doc) {
  return getItems(doc.line_items).map((item) => ({
    description: item.fields?.description?.value || '',
    quantity: item.fields?.quantity?.value ?? null,
    unit: item.fields?.unit?.value || item.fields?.quantity_unit?.value || '',
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
  const invoiceDate = getValue(doc.date);
  const dueDate = getValue(doc.due_date);
  const existing = await getInvoice(invoiceId);
  const registerSerial =
    existing?.register_serial || (await nextRegisterSerial(existing?.created_at || new Date()));

  const invoiceData = {
    status: 'pending',
    file_url: publicUrl,
    invoice_number: getValue(doc.invoice_number),
    invoice_date: invoiceDate,
    due_date: dueDate,
    credit_period_days: daysBetweenYmd(invoiceDate, dueDate),
    register_serial: registerSerial,
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
