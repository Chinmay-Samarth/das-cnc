/**
 * Customer sales invoices (AR) — draft → issue → print gate → pay / cancel.
 * GST: 18% fixed (CGST+SGST same state, IGST inter-state).
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const GST_RATE = 18;
const HALF_RATE = 9;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function isValidUUID(value) {
  return UUID_RE.test(String(value || ''));
}

function toNumber(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/** Indian currency round half-up to 2 decimals */
function round2(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function cleanText(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

function stateCodeFromGstin(gstin) {
  const g = String(gstin || '').trim().toUpperCase();
  if (g.length >= 2 && /^\d{2}/.test(g)) return g.slice(0, 2);
  return null;
}

/** Indian FY label + sequence year key (April–March). year key = starting calendar year. */
function indianFy(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1; // 1–12
  const startYear = m >= 4 ? y : y - 1;
  const endYY = String((startYear + 1) % 100).padStart(2, '0');
  return {
    sequenceYear: startYear,
    label: `${startYear}-${endYY}`,
  };
}

function todayYmd(tz = process.env.TIMEZONE || 'Asia/Kolkata') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDaysYmd(ymd, delta) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

/** Parse "Net 30" / "30 days" / plain number → days; default 30 */
function paymentTermsDays(terms) {
  if (terms == null || terms === '') return 30;
  const n = parseInt(String(terms).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

function computeTax({ quantity, unitPrice, companyStateCode, customerStateCode }) {
  const qty = toNumber(quantity);
  const price = toNumber(unitPrice);
  const taxable = round2(qty * price);
  const company = String(companyStateCode || '').padStart(2, '0').slice(0, 2);
  const customer = String(customerStateCode || '').padStart(2, '0').slice(0, 2);
  const sameState = company && customer && company === customer;

  if (sameState) {
    const half = round2(taxable * (HALF_RATE / 100));
    return {
      taxable_amount: taxable,
      cgst_amount: half,
      sgst_amount: half,
      igst_amount: 0,
      total_amount: round2(taxable + half + half),
      tax_type: 'CGST_SGST',
      gst_rate: GST_RATE,
      place_of_supply_state_code: customer,
    };
  }

  const igst = round2(taxable * (GST_RATE / 100));
  return {
    taxable_amount: taxable,
    cgst_amount: 0,
    sgst_amount: 0,
    igst_amount: igst,
    total_amount: round2(taxable + igst),
    tax_type: 'IGST',
    gst_rate: GST_RATE,
    place_of_supply_state_code: customer || company || null,
  };
}

async function nextSalesInvoiceNumber(prefix = 'INV') {
  const { sequenceYear, label } = indianFy();
  const docType = 'sales_invoice';
  const safePrefix = cleanText(prefix) || 'INV';

  for (let attempt = 0; attempt < 8; attempt++) {
    const { data: existing, error: selErr } = await supabase
      .from('document_sequences')
      .select('last_value')
      .eq('doc_type', docType)
      .eq('year', sequenceYear)
      .maybeSingle();
    if (selErr) throw selErr;

    if (!existing) {
      const { error: insErr } = await supabase
        .from('document_sequences')
        .insert({ doc_type: docType, year: sequenceYear, last_value: 1 });
      if (!insErr) {
        return `${safePrefix}/${label}/0001`;
      }
      continue;
    }

    const nextVal = existing.last_value + 1;
    const { data: updated, error: upErr } = await supabase
      .from('document_sequences')
      .update({ last_value: nextVal })
      .eq('doc_type', docType)
      .eq('year', sequenceYear)
      .eq('last_value', existing.last_value)
      .select('last_value')
      .maybeSingle();
    if (upErr) throw upErr;
    if (updated) {
      return `${safePrefix}/${label}/${String(nextVal).padStart(4, '0')}`;
    }
  }
  throw httpError('Unable to allocate invoice number', 500);
}

async function getCompanySettings() {
  const { data, error } = await supabase
    .from('company_settings')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  const { data: created, error: cErr } = await supabase
    .from('company_settings')
    .insert({
      legal_name: 'DAS CNC',
      trade_name: 'DAS CNC',
      city: 'Bengaluru',
      state: 'Karnataka',
      state_code: '29',
      gstin: '29AADCD1594JIZC',
      invoice_prefix: 'INV',
    })
    .select('*')
    .single();
  if (cErr) throw cErr;
  return created;
}

async function updateCompanySettings(patch) {
  const current = await getCompanySettings();
  const allowed = [
    'legal_name',
    'trade_name',
    'address_line1',
    'address_line2',
    'city',
    'state',
    'state_code',
    'gstin',
    'pan',
    'phone',
    'email',
    'bank_name',
    'bank_account',
    'ifsc',
    'invoice_prefix',
    'logo_url',
  ];
  const update = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      update[key] = cleanText(patch[key]) ?? (key === 'invoice_prefix' ? 'INV' : null);
    }
  }
  if (update.state_code) {
    update.state_code = String(update.state_code).padStart(2, '0').slice(0, 2);
  }
  if (update.gstin && !update.state_code) {
    update.state_code = stateCodeFromGstin(update.gstin);
  }

  const { data, error } = await supabase
    .from('company_settings')
    .update(update)
    .eq('id', current.id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

function companySnapshot(company, override = null) {
  const base = { ...(company || {}) };
  delete base.id;
  delete base.created_at;
  delete base.updated_at;
  if (override && typeof override === 'object') {
    return { ...base, ...override };
  }
  return base;
}

function customerSnapshot(customer) {
  if (!customer) return null;
  return {
    id: customer.id,
    name: customer.name,
    official_address: customer.official_address,
    billing_address: customer.billing_address,
    gstin: customer.gstin,
    pan_no: customer.pan_no,
    contact_person: customer.contact_person,
    contact_phone: customer.contact_phone,
    payment_terms: customer.payment_terms,
    state_code: stateCodeFromGstin(customer.gstin),
  };
}

/**
 * Resolve lot → delivery schedule → blanket line → customer + component label.
 */
async function resolveLotBillingContext(lotId) {
  if (!isValidUUID(lotId)) throw httpError('lot_id is required');

  const { data: lot, error: lotErr } = await supabase
    .from('production_lots')
    .select('*')
    .eq('id', lotId)
    .maybeSingle();
  if (lotErr) throw lotErr;
  if (!lot) throw httpError('Production lot not found', 404);

  let deliveryScheduleId = null;

  if (lot.production_card_id) {
    const { data: card, error: cErr } = await supabase
      .from('production_cards')
      .select('id, delivery_schedule_id, campaign_id')
      .eq('id', lot.production_card_id)
      .maybeSingle();
    if (cErr) throw cErr;
    deliveryScheduleId = card?.delivery_schedule_id || null;
  }

  if (!deliveryScheduleId && lot.campaign_id) {
    const { data: coverage, error: covErr } = await supabase
      .from('campaign_schedule_coverage')
      .select('delivery_schedule_id, schedule_qty, covered_qty')
      .eq('campaign_id', lot.campaign_id)
      .order('delivery_schedule_id', { ascending: true });
    if (covErr) throw covErr;
    if (coverage?.length) {
      deliveryScheduleId = coverage[0].delivery_schedule_id;
    }
  }

  if (!deliveryScheduleId) {
    throw httpError(
      'Cannot invoice this lot — no delivery schedule linked (card or campaign coverage)',
      422
    );
  }

  const { data: schedule, error: sErr } = await supabase
    .from('delivery_schedules')
    .select(
      'id, schedule_number, due_date, quantity, blanket_po_line_id, status, notes'
    )
    .eq('id', deliveryScheduleId)
    .maybeSingle();
  if (sErr) throw sErr;
  if (!schedule) throw httpError('Delivery schedule not found', 404);
  if (!schedule.blanket_po_line_id) {
    throw httpError('Delivery schedule has no blanket PO line', 422);
  }

  const { data: line, error: lErr } = await supabase
    .from('blanket_po_lines')
    .select('id, blanket_po_id, master_record_id, uom, unit_price, line_no, notes')
    .eq('id', schedule.blanket_po_line_id)
    .maybeSingle();
  if (lErr) throw lErr;
  if (!line) throw httpError('Blanket PO line not found', 404);

  const { data: blanket, error: bErr } = await supabase
    .from('blanket_pos')
    .select('id, blanket_number, customer_id, payment_terms, currency, status')
    .eq('id', line.blanket_po_id)
    .maybeSingle();
  if (bErr) throw bErr;
  if (!blanket) throw httpError('Blanket PO not found', 404);

  const { data: customer, error: custErr } = await supabase
    .from('customers')
    .select('*')
    .eq('id', blanket.customer_id)
    .maybeSingle();
  if (custErr) throw custErr;
  if (!customer) throw httpError('Customer not found', 404);

  let componentLabel = null;
  const { data: lookup } = await supabase
    .from('v_master_lookup')
    .select('record_id, label')
    .eq('record_id', line.master_record_id)
    .maybeSingle();
  componentLabel = lookup?.label || null;

  return {
    lot,
    schedule,
    line,
    blanket,
    customer,
    componentLabel,
  };
}

function buildLineItems({ componentLabel, quantity, unitPrice, uom, tax, schedule }) {
  return [
    {
      line_no: 1,
      description: componentLabel || 'Component',
      hsn: null,
      quantity: toNumber(quantity),
      uom: uom || null,
      unit_price: toNumber(unitPrice),
      taxable_amount: tax.taxable_amount,
      schedule_number: schedule?.schedule_number || null,
      schedule_due_date: schedule?.due_date || null,
    },
  ];
}

async function getInvoiceById(id) {
  if (!isValidUUID(id)) throw httpError('Invalid invoice id');
  const { data, error } = await supabase
    .from('sales_invoices')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw httpError('Sales invoice not found', 404);

  const [
    paymentsRes,
    printedByRes,
    issuedByRes,
    paidByRes,
    cancelledByRes,
    customerRes,
    lotRes,
  ] = await Promise.all([
    supabase
      .from('sales_invoice_payments')
      .select('*')
      .eq('sales_invoice_id', id)
      .order('paid_at', { ascending: false }),
    data.printed_by
      ? supabase
          .from('employees')
          .select('id, full_name, employee_code')
          .eq('id', data.printed_by)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    data.issued_by
      ? supabase
          .from('employees')
          .select('id, full_name, employee_code')
          .eq('id', data.issued_by)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    data.payment_recorded_by
      ? supabase
          .from('employees')
          .select('id, full_name, employee_code')
          .eq('id', data.payment_recorded_by)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    data.cancelled_by
      ? supabase
          .from('employees')
          .select('id, full_name, employee_code')
          .eq('id', data.cancelled_by)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    data.customer_id
      ? supabase.from('customers').select('id, name, gstin').eq('id', data.customer_id).maybeSingle()
      : Promise.resolve({ data: null }),
    data.lot_id
      ? supabase
          .from('production_lots')
          .select('id, lot_number, status, quantity')
          .eq('id', data.lot_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const payments = paymentsRes.data || [];
  const payRecorderIds = [...new Set(payments.map((p) => p.recorded_by).filter(Boolean))];
  let empById = {};
  if (payRecorderIds.length) {
    const { data: emps } = await supabase
      .from('employees')
      .select('id, full_name, employee_code')
      .in('id', payRecorderIds);
    empById = Object.fromEntries((emps || []).map((e) => [e.id, e]));
  }

  return {
    ...data,
    quantity: toNumber(data.quantity),
    unit_price: toNumber(data.unit_price),
    taxable_amount: toNumber(data.taxable_amount),
    cgst_amount: toNumber(data.cgst_amount),
    sgst_amount: toNumber(data.sgst_amount),
    igst_amount: toNumber(data.igst_amount),
    total_amount: toNumber(data.total_amount),
    gst_rate: toNumber(data.gst_rate),
    customer_name: customerRes.data?.name || data.customer_snapshot?.name || null,
    lot_number: lotRes.data?.lot_number || null,
    lot_status: lotRes.data?.status || null,
    printed_by_employee: printedByRes.data || null,
    issued_by_employee: issuedByRes.data || null,
    payment_recorded_by_employee: paidByRes.data || null,
    cancelled_by_employee: cancelledByRes.data || null,
    payments: payments.map((p) => ({
      ...p,
      amount: toNumber(p.amount),
      recorded_by_employee: p.recorded_by ? empById[p.recorded_by] || null : null,
    })),
  };
}

async function listInvoices({ status } = {}) {
  let query = supabase
    .from('sales_invoices')
    .select('*')
    .order('created_at', { ascending: false });

  if (status) {
    const statuses = String(status)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (statuses.length === 1) query = query.eq('status', statuses[0]);
    else if (statuses.length > 1) query = query.in('status', statuses);
  } else {
    query = query.in('status', ['due', 'paid', 'cancelled']);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = data || [];
  const custIds = [...new Set(rows.map((r) => r.customer_id).filter(Boolean))];
  let nameById = {};
  if (custIds.length) {
    const { data: customers } = await supabase
      .from('customers')
      .select('id, name')
      .in('id', custIds);
    nameById = Object.fromEntries((customers || []).map((c) => [c.id, c.name]));
  }

  return rows.map((r) => ({
    ...r,
    quantity: toNumber(r.quantity),
    unit_price: toNumber(r.unit_price),
    taxable_amount: toNumber(r.taxable_amount),
    cgst_amount: toNumber(r.cgst_amount),
    sgst_amount: toNumber(r.sgst_amount),
    igst_amount: toNumber(r.igst_amount),
    total_amount: toNumber(r.total_amount),
    customer_name: nameById[r.customer_id] || r.customer_snapshot?.name || null,
    is_printed: !!r.printed_at,
  }));
}

async function findActiveInvoiceForLot(lotId) {
  if (!isValidUUID(lotId)) return null;
  const { data, error } = await supabase
    .from('sales_invoices')
    .select('id, status, printed_at, invoice_number')
    .eq('lot_id', lotId)
    .in('status', ['draft', 'due', 'paid'])
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function createDraftFromLot(lotId, actorId, body = {}) {
  const existing = await findActiveInvoiceForLot(lotId);
  if (existing) {
    throw httpError(
      `Lot already has an active invoice (${existing.invoice_number || existing.status})`,
      409
    );
  }

  const ctx = await resolveLotBillingContext(lotId);
  const company = await getCompanySettings();
  const qty =
    body.quantity != null ? toNumber(body.quantity) : toNumber(ctx.lot.quantity);
  if (!(qty > 0)) throw httpError('quantity must be > 0');

  const unitPrice =
    body.unit_price != null ? toNumber(body.unit_price) : toNumber(ctx.line.unit_price);
  if (!(unitPrice >= 0)) throw httpError('unit_price is invalid');

  const override = body.company_override && typeof body.company_override === 'object'
    ? body.company_override
    : null;
  const snapCompany = companySnapshot(company, override);
  const custSnap = customerSnapshot(ctx.customer);

  let customerState =
    cleanText(body.place_of_supply_state_code) ||
    custSnap?.state_code ||
    stateCodeFromGstin(ctx.customer.gstin);
  if (!customerState) {
    throw httpError(
      'Customer has no GSTIN state code — provide place_of_supply_state_code (2 digits)',
      422
    );
  }
  customerState = String(customerState).padStart(2, '0').slice(0, 2);

  const companyState =
    snapCompany.state_code || stateCodeFromGstin(snapCompany.gstin) || '29';

  const tax = computeTax({
    quantity: qty,
    unitPrice,
    companyStateCode: companyState,
    customerStateCode: customerState,
  });

  const paymentTerms =
    cleanText(body.payment_terms) ||
    ctx.blanket.payment_terms ||
    ctx.customer.payment_terms ||
    '30 days';

  const lineItems = buildLineItems({
    componentLabel: ctx.componentLabel,
    quantity: qty,
    unitPrice,
    uom: ctx.line.uom,
    tax,
    schedule: ctx.schedule,
  });

  const { data, error } = await supabase
    .from('sales_invoices')
    .insert({
      status: 'draft',
      customer_id: ctx.customer.id,
      delivery_schedule_id: ctx.schedule.id,
      lot_id: ctx.lot.id,
      blanket_po_id: ctx.blanket.id,
      blanket_po_line_id: ctx.line.id,
      quantity: qty,
      unit_price: unitPrice,
      uom: ctx.line.uom,
      ...tax,
      company_snapshot: snapCompany,
      customer_snapshot: { ...custSnap, state_code: customerState },
      line_items: lineItems,
      company_override: override,
      notes: cleanText(body.notes),
      payment_terms: paymentTerms,
      created_by: actorId || null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return getInvoiceById(data.id);
}

async function updateDraft(id, patch) {
  const inv = await getInvoiceById(id);
  if (inv.status !== 'draft') {
    throw httpError('Only draft invoices can be edited', 409);
  }

  const company = await getCompanySettings();
  const qty = patch.quantity != null ? toNumber(patch.quantity) : toNumber(inv.quantity);
  if (!(qty > 0)) throw httpError('quantity must be > 0');

  const unitPrice =
    patch.unit_price != null ? toNumber(patch.unit_price) : toNumber(inv.unit_price);

  const override =
    patch.company_override !== undefined
      ? patch.company_override
      : inv.company_override;
  const snapCompany = companySnapshot(company, override);

  let customerState =
    cleanText(patch.place_of_supply_state_code) ||
    inv.place_of_supply_state_code ||
    inv.customer_snapshot?.state_code;
  if (!customerState) {
    throw httpError('place_of_supply_state_code is required', 422);
  }
  customerState = String(customerState).padStart(2, '0').slice(0, 2);

  const companyState =
    snapCompany.state_code || stateCodeFromGstin(snapCompany.gstin) || '29';

  const tax = computeTax({
    quantity: qty,
    unitPrice,
    companyStateCode: companyState,
    customerStateCode: customerState,
  });

  const lineItems = buildLineItems({
    componentLabel: inv.line_items?.[0]?.description,
    quantity: qty,
    unitPrice,
    uom: inv.uom,
    tax,
    schedule: {
      schedule_number: inv.line_items?.[0]?.schedule_number,
      due_date: inv.line_items?.[0]?.schedule_due_date,
    },
  });

  const update = {
    quantity: qty,
    unit_price: unitPrice,
    ...tax,
    company_snapshot: snapCompany,
    customer_snapshot: {
      ...(inv.customer_snapshot || {}),
      state_code: customerState,
    },
    line_items: lineItems,
    company_override: override,
    updated_at: new Date().toISOString(),
  };
  if (patch.notes !== undefined) update.notes = cleanText(patch.notes);
  if (patch.payment_terms !== undefined) {
    update.payment_terms = cleanText(patch.payment_terms);
  }

  const { data, error } = await supabase
    .from('sales_invoices')
    .update(update)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return getInvoiceById(data.id);
}

async function issueInvoice(id, actorId) {
  const inv = await getInvoiceById(id);
  if (inv.status !== 'draft') {
    throw httpError('Only draft invoices can be issued', 409);
  }
  if (!inv.place_of_supply_state_code) {
    throw httpError('Place of supply is required before issue', 422);
  }

  const company = await getCompanySettings();
  const prefix = inv.company_snapshot?.invoice_prefix || company.invoice_prefix || 'INV';
  const invoiceNumber = await nextSalesInvoiceNumber(prefix);

  const issuedAt = new Date().toISOString();
  const issueDate = todayYmd();
  const dueDate = addDaysYmd(issueDate, paymentTermsDays(inv.payment_terms));

  // Freeze company snapshot from current settings + override at issue time
  const frozenCompany = companySnapshot(company, inv.company_override);

  const { data, error } = await supabase
    .from('sales_invoices')
    .update({
      status: 'due',
      invoice_number: invoiceNumber,
      issued_at: issuedAt,
      issued_by: actorId || null,
      due_date: dueDate,
      company_snapshot: frozenCompany,
      updated_at: issuedAt,
    })
    .eq('id', id)
    .eq('status', 'draft')
    .select('*')
    .single();
  if (error) throw error;
  if (!data) throw httpError('Invoice could not be issued (status changed)', 409);
  return getInvoiceById(data.id);
}

async function confirmPrinted(id, actorId) {
  const inv = await getInvoiceById(id);
  if (!['due', 'paid'].includes(inv.status)) {
    throw httpError('Issue the invoice before confirming print', 409);
  }
  if (inv.printed_at) {
    return inv;
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('sales_invoices')
    .update({
      printed_at: now,
      printed_by: actorId || null,
      updated_at: now,
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return getInvoiceById(data.id);
}

async function cancelInvoice(id, actorId, reason) {
  const inv = await getInvoiceById(id);
  if (inv.status === 'cancelled') return inv;
  if (inv.status === 'paid') {
    throw httpError('Cannot cancel a paid invoice', 409);
  }
  if (inv.dispatched_at) {
    throw httpError('Cannot cancel after dispatch', 409);
  }
  if (inv.status === 'draft') {
    // Soft-delete path: mark cancelled without number (rare)
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('sales_invoices')
      .update({
        status: 'cancelled',
        cancelled_at: now,
        cancelled_by: actorId || null,
        cancel_reason: cleanText(reason) || 'Cancelled draft',
        updated_at: now,
      })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return getInvoiceById(data.id);
  }
  if (inv.status !== 'due') {
    throw httpError('Invoice cannot be cancelled in this status', 409);
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('sales_invoices')
    .update({
      status: 'cancelled',
      cancelled_at: now,
      cancelled_by: actorId || null,
      cancel_reason: cleanText(reason) || 'Cancelled',
      updated_at: now,
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return getInvoiceById(data.id);
}

async function recordPayment(id, actorId, body = {}) {
  const inv = await getInvoiceById(id);
  if (inv.status === 'cancelled') {
    throw httpError('Cannot record payment on a cancelled invoice', 409);
  }
  if (inv.status === 'draft') {
    throw httpError('Issue the invoice before recording payment', 409);
  }
  if (inv.status === 'paid') {
    throw httpError('Invoice is already paid', 409);
  }

  const txnId = cleanText(body.transaction_id);
  if (!txnId) throw httpError('transaction_id is required');

  const amount =
    body.amount != null ? round2(body.amount) : round2(inv.total_amount);
  if (!(amount > 0)) throw httpError('amount must be > 0');
  if (amount < round2(inv.total_amount) - 0.001) {
    throw httpError(
      `Payment must cover the full invoice total (${inv.total_amount}) in v1`,
      422
    );
  }

  const paidAt = body.paid_at ? new Date(body.paid_at).toISOString() : new Date().toISOString();

  const { error: payErr } = await supabase.from('sales_invoice_payments').insert({
    sales_invoice_id: id,
    amount,
    transaction_id: txnId,
    paid_at: paidAt,
    recorded_by: actorId || null,
    notes: cleanText(body.notes),
  });
  if (payErr) throw payErr;

  const { data, error } = await supabase
    .from('sales_invoices')
    .update({
      status: 'paid',
      paid_at: paidAt,
      payment_transaction_id: txnId,
      payment_recorded_by: actorId || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return getInvoiceById(data.id);
}

async function markDispatched(lotId) {
  if (!isValidUUID(lotId)) return;
  const now = new Date().toISOString();
  await supabase
    .from('sales_invoices')
    .update({ dispatched_at: now, updated_at: now })
    .eq('lot_id', lotId)
    .in('status', ['due', 'paid'])
    .is('dispatched_at', null);
}

async function assertLotPrintGate(lotId) {
  const inv = await findActiveInvoiceForLot(lotId);
  if (!inv || inv.status === 'draft') {
    throw httpError(
      'Create and issue a sales invoice, then confirm it is printed before dispatch',
      409
    );
  }
  if (!['due', 'paid'].includes(inv.status)) {
    throw httpError('Invoice must be due or paid before dispatch', 409);
  }
  if (!inv.printed_at) {
    throw httpError('Confirm invoice print before dispatch', 409);
  }
  return inv;
}

async function invoiceSummariesForLots(lotIds) {
  const ids = (lotIds || []).filter(isValidUUID);
  if (!ids.length) return {};
  const { data, error } = await supabase
    .from('sales_invoices')
    .select('id, lot_id, status, printed_at, invoice_number')
    .in('lot_id', ids)
    .in('status', ['draft', 'due', 'paid']);
  if (error) throw error;
  const map = {};
  for (const row of data || []) {
    map[row.lot_id] = {
      invoice_id: row.id,
      invoice_status: row.status,
      invoice_number: row.invoice_number,
      printed: !!row.printed_at,
    };
  }
  return map;
}

module.exports = {
  getCompanySettings,
  updateCompanySettings,
  listInvoices,
  getInvoiceById,
  createDraftFromLot,
  updateDraft,
  issueInvoice,
  confirmPrinted,
  cancelInvoice,
  recordPayment,
  markDispatched,
  assertLotPrintGate,
  findActiveInvoiceForLot,
  invoiceSummariesForLots,
  computeTax,
  round2,
  indianFy,
  resolveLotBillingContext,
};
