/**
 * Customer sales invoices (AR) — draft → issue → print gate → pay / cancel.
 * GST: 18% fixed (CGST+SGST same state, IGST inter-state).
 */

const { createClient } = require('@supabase/supabase-js');
const { isTallyEnabled } = require('./tallyClient');
const {
  assertReadyForSalesTallySync,
  syncSalesVoucherForInvoice,
} = require('./tallySalesVoucher');
const {
  syncReceiptVoucherForInvoice,
  syncReceiptVoucherForInvoices,
} = require('./tallyReceiptVoucher');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/** Prefer Component Name; also accept Regex Name if present on the master. */
const COMPONENT_ITEM_NAME_SLUGS = ['component_name', 'regex_name'];
const COMPONENT_ITEM_NAME_LABEL_RE = /^(component\s*name|regex\s*name)$/i;
/** Prefer drawing_no; also accept common drawing / drg variants. */
const DRAWING_NUMBER_SLUGS = [
  'drawing_no',
  'drawing_number',
  'drg_no',
  'drg_number',
  'drawing',
];
const DRAWING_NUMBER_SLUG_RE = /drawing[_\s-]?no|drg[_\s-]?no|drawing[_\s-]?number|^drawing$/i;
const DRAWING_NUMBER_LABEL_RE = /^(drawing(\s*(no\.?|number))?|drg\.?\s*no\.?)$/i;
/** HSN from dynamic component master (hsn_code slug). */
const HSN_CODE_SLUGS = ['hsn_code', 'hsn', 'sac_code', 'sac'];
const HSN_CODE_SLUG_RE = /hsn[_\s-]?code|^hsn$|sac[_\s-]?code|^sac$/i;
const HSN_CODE_LABEL_RE = /^(hsn(\s*code)?|sac(\s*code)?)$/i;

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
    ledger_name: customer.ledger_name || null,
    official_address: customer.official_address,
    billing_address: customer.billing_address,
    gstin: customer.gstin,
    pan_no: customer.pan_no,
    contact_person: customer.contact_person,
    contact_phone: customer.contact_phone,
    payment_terms: customer.payment_terms,
    components_per_packet: customer.components_per_packet != null
      ? toNumber(customer.components_per_packet)
      : null,
    state_code: stateCodeFromGstin(customer.gstin),
  };
}

function buildPackageLabel(componentsPerPacket, quantity) {
  const size = toNumber(componentsPerPacket);
  const qty = toNumber(quantity);
  if (!(size > 0)) {
    throw httpError(
      'Set components per packet on the customer before creating a sales invoice',
      422
    );
  }
  if (!(qty > 0)) throw httpError('quantity must be > 0');
  const packets = Math.ceil(qty / size);
  return `${size} × ${packets}`;
}

/**
 * Combined RFD qty for same component + schedule (merge-group support).
 * Includes the primary lot.
 */
async function combinedRfdQtyForSchedule(lot, scheduleId) {
  const masterId = lot?.master_record_id;
  const primaryQty = toNumber(lot?.quantity);
  if (!masterId || !isValidUUID(scheduleId)) return primaryQty;

  const { data: siblings, error } = await supabase
    .from('production_lots')
    .select('id, quantity, production_card_id, campaign_id')
    .eq('status', 'ready_for_dispatch')
    .eq('master_record_id', masterId);
  if (error) throw error;

  const lots = siblings || [];
  if (!lots.length) return primaryQty;

  const cardIds = [...new Set(lots.map((l) => l.production_card_id).filter(Boolean))];
  let cardScheduleById = {};
  if (cardIds.length) {
    const { data: cards, error: cErr } = await supabase
      .from('production_cards')
      .select('id, delivery_schedule_id')
      .in('id', cardIds);
    if (cErr) throw cErr;
    cardScheduleById = Object.fromEntries(
      (cards || []).map((c) => [c.id, c.delivery_schedule_id])
    );
  }

  const campaignIds = [
    ...new Set(lots.map((l) => l.campaign_id).filter(Boolean)),
  ];
  const coveredCampaigns = new Set();
  if (campaignIds.length) {
    const { data: cov, error: covErr } = await supabase
      .from('campaign_schedule_coverage')
      .select('campaign_id')
      .in('campaign_id', campaignIds)
      .eq('delivery_schedule_id', scheduleId);
    if (covErr) throw covErr;
    for (const row of cov || []) coveredCampaigns.add(row.campaign_id);
  }

  let combined = 0;
  for (const l of lots) {
    const pinned = l.production_card_id
      ? cardScheduleById[l.production_card_id]
      : null;
    const matches =
      l.id === lot.id ||
      pinned === scheduleId ||
      (l.campaign_id && coveredCampaigns.has(l.campaign_id) && !pinned);
    if (!matches) continue;
    if (pinned && pinned !== scheduleId && l.id !== lot.id) continue;
    combined += toNumber(l.quantity);
  }

  if (!(combined > 0)) combined = primaryQty;
  return Math.round(combined * 10000) / 10000;
}

/**
 * Qty already shipped against delivery schedules (issued/paid invoices with dispatched_at).
 */
async function dispatchedQtyByScheduleIds(scheduleIds) {
  const ids = [...new Set((scheduleIds || []).filter(isValidUUID))];
  if (!ids.length) return {};
  const { data, error } = await supabase
    .from('sales_invoices')
    .select('delivery_schedule_id, quantity')
    .in('delivery_schedule_id', ids)
    .in('status', ['due', 'paid'])
    .not('dispatched_at', 'is', null);
  if (error) throw error;
  const map = {};
  for (const row of data || []) {
    const id = row.delivery_schedule_id;
    if (!id) continue;
    map[id] = (map[id] || 0) + toNumber(row.quantity);
  }
  return map;
}

function remainingFromShipped(scheduleQty, shipped) {
  return Math.round((toNumber(scheduleQty) - toNumber(shipped)) * 10000) / 10000;
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function scheduleBucket(dueDate, today = todayDateString()) {
  const due = String(dueDate || '').slice(0, 10);
  if (!due) return 'upcoming';
  return due < today ? 'past_due' : 'upcoming';
}

function toScheduleOption(sched, remaining, today = todayDateString()) {
  const due = String(sched.due_date || '').slice(0, 10);
  const bucket = scheduleBucket(due, today);
  const isOneOff = sched.rule_id == null;
  return {
    id: sched.id,
    schedule_number: sched.schedule_number || null,
    due_date: sched.due_date || null,
    remaining_qty: toNumber(remaining),
    original_qty: toNumber(sched.quantity),
    bucket,
    is_one_off: isOneOff,
    rule_id: sched.rule_id ?? null,
  };
}

function choiceRequiredFromOptions(options) {
  if (!options?.length) return false;
  let past = false;
  let upcoming = false;
  for (const opt of options) {
    if (opt.bucket === 'past_due') past = true;
    else upcoming = true;
    if (past && upcoming) return true;
  }
  return false;
}

function pickOpenFromList(openList) {
  if (!openList?.length) return null;
  return openList[0];
}

/**
 * Open campaign coverage rows that still have remaining shippable qty (earliest due first).
 */
async function listOpenCampaignSchedules(campaignId) {
  if (!isValidUUID(campaignId)) return [];
  const { data: coverage, error: covErr } = await supabase
    .from('campaign_schedule_coverage')
    .select('delivery_schedule_id, schedule_qty, covered_qty')
    .eq('campaign_id', campaignId);
  if (covErr) throw covErr;
  if (!coverage?.length) return [];

  const scheduleIds = coverage.map((c) => c.delivery_schedule_id).filter(Boolean);
  if (!scheduleIds.length) return [];

  const [{ data: schedules, error: sErr }, shippedMap] = await Promise.all([
    supabase
      .from('delivery_schedules')
      .select(
        'id, schedule_number, due_date, quantity, status, blanket_po_line_id, notes, rule_id'
      )
      .in('id', scheduleIds),
    dispatchedQtyByScheduleIds(scheduleIds),
  ]);
  if (sErr) throw sErr;

  return (schedules || [])
    .filter((s) => s.status !== 'cancelled')
    .map((s) => ({
      schedule: s,
      remaining: remainingFromShipped(s.quantity, shippedMap[s.id] || 0),
      due_date: s.due_date,
    }))
    .filter((s) => s.remaining > 0.0001)
    .sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || '')));
}

/**
 * Open one-off schedules (rule_id IS NULL) for the same component as the lot.
 * These are often created after horizon lock and are missing from campaign coverage.
 */
async function listOpenOneOffSchedulesForMaster(masterRecordId) {
  if (!isValidUUID(masterRecordId)) return [];

  const { data: lines, error: lineErr } = await supabase
    .from('blanket_po_lines')
    .select('id')
    .eq('master_record_id', masterRecordId);
  if (lineErr) throw lineErr;
  const lineIds = (lines || []).map((l) => l.id).filter(Boolean);
  if (!lineIds.length) return [];

  const { data: schedules, error: sErr } = await supabase
    .from('delivery_schedules')
    .select(
      'id, schedule_number, due_date, quantity, status, blanket_po_line_id, notes, rule_id'
    )
    .in('blanket_po_line_id', lineIds)
    .is('rule_id', null)
    .neq('status', 'cancelled');
  if (sErr) throw sErr;
  if (!schedules?.length) return [];

  const scheduleIds = schedules.map((s) => s.id);
  const shippedMap = await dispatchedQtyByScheduleIds(scheduleIds);

  return schedules
    .map((s) => ({
      schedule: s,
      remaining: remainingFromShipped(s.quantity, shippedMap[s.id] || 0),
      due_date: s.due_date,
    }))
    .filter((s) => s.remaining > 0.0001)
    .sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || '')));
}

/** Earliest-due campaign coverage row that still has remaining shippable qty. */
async function pickOpenCampaignScheduleId(campaignId) {
  const open = await listOpenCampaignSchedules(campaignId);
  return pickOpenFromList(open)?.schedule?.id || null;
}

async function remainingQtyForSchedule(scheduleId, scheduleQty) {
  if (!isValidUUID(scheduleId)) return 0;
  const shippedMap = await dispatchedQtyByScheduleIds([scheduleId]);
  return remainingFromShipped(scheduleQty, shippedMap[scheduleId] || 0);
}

/**
 * Open schedules a lot may invoice against:
 * campaign coverage + open card pin + open one-off schedules for the same component.
 */
async function listOpenScheduleOptionsForLot(lot, { card = null } = {}) {
  const today = todayDateString();
  const campaignId = lot.campaign_id || card?.campaign_id || null;
  const open = campaignId ? await listOpenCampaignSchedules(campaignId) : [];
  const byId = new Map(open.map((o) => [o.schedule.id, o]));

  const cardPinId = card?.delivery_schedule_id || null;
  if (cardPinId && !byId.has(cardPinId)) {
    const { data: pinned, error } = await supabase
      .from('delivery_schedules')
      .select(
        'id, schedule_number, due_date, quantity, status, blanket_po_line_id, notes, rule_id'
      )
      .eq('id', cardPinId)
      .maybeSingle();
    if (error) throw error;
    if (pinned && pinned.status !== 'cancelled') {
      const remaining = await remainingQtyForSchedule(pinned.id, pinned.quantity);
      if (remaining > 0.0001) {
        byId.set(pinned.id, {
          schedule: pinned,
          remaining,
          due_date: pinned.due_date,
        });
      }
    }
  }

  if (lot.master_record_id) {
    const oneOffs = await listOpenOneOffSchedulesForMaster(lot.master_record_id);
    for (const row of oneOffs) {
      if (!byId.has(row.schedule.id)) byId.set(row.schedule.id, row);
    }
  }

  const list = [...byId.values()].sort((a, b) =>
    String(a.due_date || '').localeCompare(String(b.due_date || ''))
  );
  return list.map((o) => toScheduleOption(o.schedule, o.remaining, today));
}

function isScheduleIdAllowed(scheduleId, options) {
  return (options || []).some((o) => o.id === scheduleId);
}

/**
 * Batch schedule + remaining demand for many lots (Ready for Dispatch list).
 * Pick order: lot pin → card pin → earliest open campaign coverage.
 */
async function resolveScheduleRemainingForLots(lots) {
  const result = {};
  if (!lots?.length) return result;

  const today = todayDateString();
  const cardIds = [...new Set(lots.map((l) => l.production_card_id).filter(isValidUUID))];
  let cards = [];
  if (cardIds.length) {
    const { data, error } = await supabase
      .from('production_cards')
      .select('id, delivery_schedule_id, campaign_id')
      .in('id', cardIds);
    if (error) throw error;
    cards = data || [];
  }
  const cardById = Object.fromEntries(cards.map((c) => [c.id, c]));

  const campaignIds = [
    ...new Set(
      lots
        .map((l) => l.campaign_id || cardById[l.production_card_id]?.campaign_id || null)
        .filter(isValidUUID)
    ),
  ];

  let coverage = [];
  if (campaignIds.length) {
    const { data, error } = await supabase
      .from('campaign_schedule_coverage')
      .select('campaign_id, delivery_schedule_id, schedule_qty, covered_qty')
      .in('campaign_id', campaignIds);
    if (error) throw error;
    coverage = data || [];
  }

  const masterIds = [
    ...new Set(lots.map((l) => l.master_record_id).filter(isValidUUID)),
  ];
  let oneOffByMaster = {};
  if (masterIds.length) {
    const { data: lines, error: lineErr } = await supabase
      .from('blanket_po_lines')
      .select('id, master_record_id')
      .in('master_record_id', masterIds);
    if (lineErr) throw lineErr;
    const lineIds = (lines || []).map((l) => l.id);
    const lineMaster = Object.fromEntries(
      (lines || []).map((l) => [l.id, l.master_record_id])
    );
    if (lineIds.length) {
      const { data: oneOffSchedules, error: ooErr } = await supabase
        .from('delivery_schedules')
        .select(
          'id, schedule_number, due_date, quantity, blanket_po_line_id, status, notes, rule_id'
        )
        .in('blanket_po_line_id', lineIds)
        .is('rule_id', null)
        .neq('status', 'cancelled');
      if (ooErr) throw ooErr;
      for (const s of oneOffSchedules || []) {
        const mid = lineMaster[s.blanket_po_line_id];
        if (!mid) continue;
        if (!oneOffByMaster[mid]) oneOffByMaster[mid] = [];
        oneOffByMaster[mid].push(s);
      }
    }
  }

  const oneOffScheduleIds = Object.values(oneOffByMaster)
    .flat()
    .map((s) => s.id);

  const scheduleIds = [
    ...new Set(
      [
        ...lots.map((l) => l.delivery_schedule_id),
        ...cards.map((c) => c.delivery_schedule_id),
        ...coverage.map((c) => c.delivery_schedule_id),
        ...oneOffScheduleIds,
      ].filter(isValidUUID)
    ),
  ];

  let scheduleById = {};
  let shippedMap = {};
  if (scheduleIds.length) {
    const [{ data: schedules, error: sErr }, shipped] = await Promise.all([
      supabase
        .from('delivery_schedules')
        .select(
          'id, schedule_number, due_date, quantity, blanket_po_line_id, status, notes, rule_id'
        )
        .in('id', scheduleIds),
      dispatchedQtyByScheduleIds(scheduleIds),
    ]);
    if (sErr) throw sErr;
    scheduleById = Object.fromEntries((schedules || []).map((s) => [s.id, s]));
    shippedMap = shipped;
  }

  const openByCampaign = {};
  for (const row of coverage) {
    const sched = scheduleById[row.delivery_schedule_id];
    if (!sched || sched.status === 'cancelled') continue;
    const remaining = remainingFromShipped(sched.quantity, shippedMap[sched.id] || 0);
    if (!(remaining > 0.0001)) continue;
    if (!openByCampaign[row.campaign_id]) openByCampaign[row.campaign_id] = [];
    openByCampaign[row.campaign_id].push({
      schedule: sched,
      remaining,
      due_date: sched.due_date,
    });
  }
  for (const arr of Object.values(openByCampaign)) {
    arr.sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || '')));
  }

  const openOneOffByMaster = {};
  for (const [mid, rows] of Object.entries(oneOffByMaster)) {
    const open = [];
    for (const raw of rows) {
      const sched = scheduleById[raw.id] || raw;
      if (!sched || sched.status === 'cancelled') continue;
      const remaining = remainingFromShipped(sched.quantity, shippedMap[sched.id] || 0);
      if (!(remaining > 0.0001)) continue;
      open.push({ schedule: sched, remaining, due_date: sched.due_date });
    }
    open.sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || '')));
    openOneOffByMaster[mid] = open;
  }

  function tryOpenSchedule(scheduleId) {
    if (!scheduleId || !scheduleById[scheduleId]) return null;
    const sched = scheduleById[scheduleId];
    if (sched.status === 'cancelled') return null;
    const rem = remainingFromShipped(sched.quantity, shippedMap[sched.id] || 0);
    if (!(rem > 0.0001)) return null;
    return { schedule: sched, remaining: rem };
  }

  for (const lot of lots) {
    const card = lot.production_card_id ? cardById[lot.production_card_id] : null;
    const campaignId = lot.campaign_id || card?.campaign_id || null;

    const optionMap = new Map();
    for (const open of openByCampaign[campaignId] || []) {
      optionMap.set(open.schedule.id, open);
    }
    const cardPinOpen = tryOpenSchedule(card?.delivery_schedule_id || null);
    if (cardPinOpen) optionMap.set(cardPinOpen.schedule.id, cardPinOpen);
    for (const open of openOneOffByMaster[lot.master_record_id] || []) {
      if (!optionMap.has(open.schedule.id)) optionMap.set(open.schedule.id, open);
    }

    const schedule_options = [...optionMap.values()]
      .sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || '')))
      .map((o) => toScheduleOption(o.schedule, o.remaining, today));
    const schedule_choice_required = choiceRequiredFromOptions(schedule_options);

    let picked = tryOpenSchedule(lot.delivery_schedule_id || null);
    if (!picked) picked = tryOpenSchedule(card?.delivery_schedule_id || null);
    if (!picked && campaignId && openByCampaign[campaignId]?.length) {
      const open = openByCampaign[campaignId][0];
      picked = { schedule: open.schedule, remaining: open.remaining };
    }
    if (!picked && schedule_options.length) {
      const first = optionMap.get(schedule_options[0].id);
      if (first) picked = { schedule: first.schedule, remaining: first.remaining };
    }

    result[lot.id] = picked
      ? {
          schedule: picked.schedule,
          remaining_qty: picked.remaining,
          schedule_options,
          schedule_choice_required,
        }
      : {
          schedule: null,
          remaining_qty: null,
          schedule_options,
          schedule_choice_required,
        };
  }

  return result;
}

/**
 * Resolve lot → delivery schedule → blanket line → customer + component label.
 * Pick order: preferredScheduleId → lot pin → card pin → earliest open coverage.
 */
async function resolveLotBillingContext(lotId, opts = {}) {
  if (!isValidUUID(lotId)) throw httpError('lot_id is required');

  const preferredScheduleId = isValidUUID(opts.preferredScheduleId)
    ? opts.preferredScheduleId
    : null;

  const { data: lot, error: lotErr } = await supabase
    .from('production_lots')
    .select('*')
    .eq('id', lotId)
    .maybeSingle();
  if (lotErr) throw lotErr;
  if (!lot) throw httpError('Production lot not found', 404);

  let card = null;
  if (lot.production_card_id) {
    const { data, error: cErr } = await supabase
      .from('production_cards')
      .select('id, delivery_schedule_id, campaign_id')
      .eq('id', lot.production_card_id)
      .maybeSingle();
    if (cErr) throw cErr;
    card = data || null;
  }

  const campaignId = lot.campaign_id || card?.campaign_id || null;
  const schedule_options = await listOpenScheduleOptionsForLot(lot, { card });
  const schedule_choice_required = choiceRequiredFromOptions(schedule_options);

  async function resolveOpenId(candidateId) {
    if (!isValidUUID(candidateId)) return null;
    const { data: pinned, error: pinErr } = await supabase
      .from('delivery_schedules')
      .select('id, quantity, status')
      .eq('id', candidateId)
      .maybeSingle();
    if (pinErr) throw pinErr;
    if (!pinned || pinned.status === 'cancelled') return null;
    const rem = await remainingQtyForSchedule(pinned.id, pinned.quantity);
    return rem > 0.0001 ? pinned.id : null;
  }

  let deliveryScheduleId = null;

  if (preferredScheduleId) {
    if (!isScheduleIdAllowed(preferredScheduleId, schedule_options)) {
      throw httpError(
        'delivery_schedule_id is not an open schedule for this lot',
        422
      );
    }
    deliveryScheduleId = await resolveOpenId(preferredScheduleId);
    if (!deliveryScheduleId) {
      throw httpError('Selected delivery schedule has no remaining quantity', 422);
    }
  }

  if (!deliveryScheduleId) {
    deliveryScheduleId = await resolveOpenId(lot.delivery_schedule_id);
  }
  if (!deliveryScheduleId) {
    deliveryScheduleId = await resolveOpenId(card?.delivery_schedule_id);
  }
  if (!deliveryScheduleId && campaignId) {
    deliveryScheduleId = await pickOpenCampaignScheduleId(campaignId);
  }
  if (!deliveryScheduleId && schedule_options.length) {
    deliveryScheduleId = schedule_options[0].id;
  }

  if (!deliveryScheduleId) {
    throw httpError(
      'Cannot invoice this lot — no delivery schedule linked (card, campaign coverage, or one-off)',
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
    .select('id, blanket_number, customer_id, payment_terms, currency, status, created_at')
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

  const componentLabel = await resolveComponentItemName(line.master_record_id);

  const remaining_qty = await remainingQtyForSchedule(schedule.id, schedule.quantity);

  return {
    lot,
    schedule,
    remaining_qty,
    line,
    blanket,
    customer,
    componentLabel,
    schedule_options,
    schedule_choice_required,
  };
}

/**
 * Resolve a master-record field value by preferred slugs, slug regex, then label regex.
 */
async function resolveMasterFieldValue(
  masterRecordId,
  { slugs = [], slugRe = null, labelRe = null } = {}
) {
  if (!masterRecordId || !isValidUUID(masterRecordId)) return null;

  const { data: record, error: recErr } = await supabase
    .from('master_records')
    .select('id, master_id')
    .eq('id', masterRecordId)
    .maybeSingle();
  if (recErr) throw recErr;
  if (!record?.master_id) return null;

  const { data: schema, error: schemaErr } = await supabase
    .from('v_master_schema')
    .select('field_id, field_slug, field_label')
    .eq('master_id', record.master_id);
  if (schemaErr) throw schemaErr;

  const fields = schema || [];
  const bySlug = Object.fromEntries(fields.map((f) => [String(f.field_slug || ''), f]));

  let fieldId = null;
  for (const slug of slugs) {
    if (bySlug[slug]?.field_id) {
      fieldId = bySlug[slug].field_id;
      break;
    }
  }
  if (!fieldId && slugRe) {
    const bySlugRe = fields.find((f) => slugRe.test(String(f.field_slug || '').trim()));
    fieldId = bySlugRe?.field_id || null;
  }
  if (!fieldId && labelRe) {
    const byLabel = fields.find((f) => labelRe.test(String(f.field_label || '').trim()));
    fieldId = byLabel?.field_id || null;
  }
  if (!fieldId) return null;

  const { data: valueRow, error: valErr } = await supabase
    .from('record_values')
    .select('value')
    .eq('record_id', masterRecordId)
    .eq('field_id', fieldId)
    .maybeSingle();
  if (valErr) throw valErr;

  return cleanText(valueRow?.value);
}

/**
 * Item name for sales / Tally: Component Name (or Regex Name), not v_master_lookup.label
 * (lookup uses first required text field, which is Component ID).
 */
async function resolveComponentItemName(masterRecordId) {
  return resolveMasterFieldValue(masterRecordId, {
    slugs: COMPONENT_ITEM_NAME_SLUGS,
    labelRe: COMPONENT_ITEM_NAME_LABEL_RE,
  });
}

async function resolveDrawingNumber(masterRecordId) {
  return resolveMasterFieldValue(masterRecordId, {
    slugs: DRAWING_NUMBER_SLUGS,
    slugRe: DRAWING_NUMBER_SLUG_RE,
    labelRe: DRAWING_NUMBER_LABEL_RE,
  });
}

async function resolveHsnCode(masterRecordId) {
  return resolveMasterFieldValue(masterRecordId, {
    slugs: HSN_CODE_SLUGS,
    slugRe: HSN_CODE_SLUG_RE,
    labelRe: HSN_CODE_LABEL_RE,
  });
}

function buildLineItems({
  componentLabel,
  quantity,
  unitPrice,
  uom,
  tax,
  schedule,
  poRef,
  poDate,
  hsn,
  packageLabel,
  drawingNumber,
}) {
  return [
    {
      line_no: 1,
      description: componentLabel || 'Component',
      drawing_number: drawingNumber || null,
      hsn: hsn || null,
      po_ref: poRef || null,
      po_date: poDate || null,
      package: packageLabel || null,
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
    packingSlipByRes,
    issuedByRes,
    paidByRes,
    cancelledByRes,
    customerRes,
    lotRes,
    blanketRes,
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
    data.packing_slip_printed_by
      ? supabase
          .from('employees')
          .select('id, full_name, employee_code')
          .eq('id', data.packing_slip_printed_by)
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
      ? supabase
          .from('customers')
          .select('id, name, gstin, ledger_name, components_per_packet')
          .eq('id', data.customer_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    data.lot_id
      ? supabase
          .from('production_lots')
          .select('id, lot_number, status, quantity')
          .eq('id', data.lot_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    data.blanket_po_id
      ? supabase
          .from('blanket_pos')
          .select('id, blanket_number, created_at')
          .eq('id', data.blanket_po_id)
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
    customer: customerRes.data || null,
    customer_name: customerRes.data?.name || data.customer_snapshot?.name || null,
    lot_number: lotRes.data?.lot_number || null,
    lot_status: lotRes.data?.status || null,
    blanket_number: blanketRes.data?.blanket_number || null,
    blanket_created_at: blanketRes.data?.created_at || null,
    printed_by_employee: printedByRes.data || null,
    packing_slip_printed_by_employee: packingSlipByRes.data || null,
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

async function persistSalesTallySyncResult(id, result) {
  const { error } = await supabase
    .from('sales_invoices')
    .update({
      tally_sync_status: result.status,
      tally_sync_error: result.error || null,
      tally_synced_at: result.syncedAt || null,
      tally_voucher_number: result.voucherNumber || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    console.error('Unable to persist sales Tally sync status:', error.message);
  }
}

async function listInvoices({ status, customerId } = {}) {
  let query = supabase
    .from('sales_invoices')
    .select('*')
    .order('created_at', { ascending: false });

  if (customerId && isValidUUID(customerId)) {
    query = query.eq('customer_id', customerId);
  }

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
    .select(
      'id, status, printed_at, packing_slip_printed_at, invoice_number, quantity'
    )
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

  const preferredScheduleId = isValidUUID(body.delivery_schedule_id)
    ? body.delivery_schedule_id
    : null;
  const ctx = await resolveLotBillingContext(lotId, { preferredScheduleId });

  // Persist preferred / resolved schedule on the lot so dispatch gates stay aligned
  if (
    ctx.schedule?.id &&
    ctx.lot.delivery_schedule_id !== ctx.schedule.id
  ) {
    const { error: pinErr } = await supabase
      .from('production_lots')
      .update({
        delivery_schedule_id: ctx.schedule.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', lotId);
    if (pinErr) throw pinErr;
    ctx.lot.delivery_schedule_id = ctx.schedule.id;
  }
  const company = await getCompanySettings();
  const remaining = toNumber(ctx.remaining_qty);
  const lotQty = toNumber(ctx.lot.quantity);
  if (!(remaining > 0.0001)) {
    throw httpError('No remaining delivery schedule quantity to invoice', 422);
  }

  const requested =
    body.quantity != null ? toNumber(body.quantity) : null;

  const combinedRfd = await combinedRfdQtyForSchedule(ctx.lot, ctx.schedule.id);
  const demandMet = combinedRfd + 0.0001 >= remaining;
  const shipQty = Math.min(combinedRfd, remaining);

  let qty;
  if (demandMet) {
    // Parked RFD (this lot alone or merge group) meets DS — invoice exactly remaining
    qty = remaining;
    if (requested != null) {
      if (Math.abs(requested - remaining) > 0.0001 && Math.abs(requested - shipQty) > 0.0001) {
        throw httpError(
          `When schedule demand is met, invoice the full remaining qty (${remaining})`,
          422
        );
      }
      qty = Math.abs(requested - shipQty) <= 0.0001 ? shipQty : remaining;
    }
  } else {
    // Shortfall / early: need override approval
    const { getApprovedForLot } = require('./dispatchShortfallEngine');
    const approval = await getApprovedForLot(lotId);
    if (!approval) {
      throw httpError(
        `Parked RFD qty (${combinedRfd}) is below remaining delivery schedule qty (${remaining}). Wait until RFD meets the schedule, or get override / shortfall approval first.`,
        409
      );
    }
    qty = requested != null ? requested : lotQty;
    if (qty > combinedRfd + 0.0001) {
      throw httpError(
        `Invoice quantity cannot exceed combined RFD qty (${combinedRfd})`,
        422
      );
    }
    if (qty > remaining + 0.0001) {
      throw httpError(
        `Invoice quantity cannot exceed remaining delivery schedule qty (${remaining})`,
        422
      );
    }
  }

  if (!(qty > 0)) throw httpError('quantity must be > 0');

  const unitPrice =
    body.unit_price != null ? toNumber(body.unit_price) : toNumber(ctx.line.unit_price);
  if (!(unitPrice >= 0)) throw httpError('unit_price is invalid');

  const packageLabel = buildPackageLabel(
    ctx.customer.components_per_packet,
    qty
  );
  const [drawingNumber, hsnCode] = await Promise.all([
    resolveDrawingNumber(ctx.line.master_record_id),
    resolveHsnCode(ctx.line.master_record_id),
  ]);

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
    poRef: ctx.blanket.blanket_number,
    poDate: ctx.blanket.created_at || null,
    hsn: hsnCode,
    packageLabel,
    drawingNumber,
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

  const prevLine = inv.line_items?.[0] || {};
  const packetSize =
    inv.customer_snapshot?.components_per_packet ??
    inv.customer?.components_per_packet;
  const packageLabel = buildPackageLabel(packetSize, qty);

  let refreshedHsn = prevLine.hsn || null;
  let refreshedDrawing = prevLine.drawing_number || null;
  let refreshedDescription = prevLine.description || null;
  if (inv.blanket_po_line_id && isValidUUID(inv.blanket_po_line_id)) {
    const { data: poLine } = await supabase
      .from('blanket_po_lines')
      .select('master_record_id')
      .eq('id', inv.blanket_po_line_id)
      .maybeSingle();
    if (poLine?.master_record_id) {
      const [hsnCode, drawingNumber, componentName] = await Promise.all([
        resolveHsnCode(poLine.master_record_id),
        resolveDrawingNumber(poLine.master_record_id),
        resolveComponentItemName(poLine.master_record_id),
      ]);
      if (hsnCode) refreshedHsn = hsnCode;
      if (drawingNumber) refreshedDrawing = drawingNumber;
      if (componentName) refreshedDescription = componentName;
    }
  }

  if (inv.delivery_schedule_id) {
    const { data: sched } = await supabase
      .from('delivery_schedules')
      .select('id, quantity')
      .eq('id', inv.delivery_schedule_id)
      .maybeSingle();
    if (sched) {
      const rem = await remainingQtyForSchedule(sched.id, sched.quantity);
      if (qty > rem + 0.0001) {
        throw httpError(
          `Invoice quantity cannot exceed remaining delivery schedule qty (${rem})`,
          422
        );
      }
      if (inv.lot_id && qty + 0.0001 < rem) {
        const { data: lotRow } = await supabase
          .from('production_lots')
          .select('*')
          .eq('id', inv.lot_id)
          .maybeSingle();
        if (lotRow) {
          const combined = await combinedRfdQtyForSchedule(lotRow, sched.id);
          if (combined + 0.0001 < rem) {
            const { getApprovedForLot } = require('./dispatchShortfallEngine');
            const approval = await getApprovedForLot(inv.lot_id);
            if (!approval) {
              throw httpError(
                `Parked RFD qty (${combined}) is below remaining delivery schedule qty (${rem}). Wait until RFD meets the schedule, or get override / shortfall approval first.`,
                409
              );
            }
          }
        }
      }
    }
  }

  const lineItems = buildLineItems({
    componentLabel: refreshedDescription,
    quantity: qty,
    unitPrice,
    uom: inv.uom,
    tax,
    schedule: {
      schedule_number: prevLine.schedule_number,
      due_date: prevLine.schedule_due_date,
    },
    poRef: prevLine.po_ref || inv.blanket_number,
    poDate: prevLine.po_date || inv.blanket_created_at,
    hsn: refreshedHsn,
    packageLabel,
    drawingNumber: refreshedDrawing,
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

  const issuePatch = {
    status: 'due',
    invoice_number: invoiceNumber,
    issued_at: issuedAt,
    issued_by: actorId || null,
    due_date: dueDate,
    company_snapshot: frozenCompany,
    updated_at: issuedAt,
  };

  if (isTallyEnabled()) {
    issuePatch.tally_sync_status = 'pending';
    issuePatch.tally_sync_error = null;
  }

  const { data, error } = await supabase
    .from('sales_invoices')
    .update(issuePatch)
    .eq('id', id)
    .eq('status', 'draft')
    .select('*')
    .single();
  if (error) throw error;
  if (!data) throw httpError('Invoice could not be issued (status changed)', 409);

  const issued = await getInvoiceById(data.id);
  const invoiceForTally = await attachComponentItemName(issued);
  const customer = invoiceForTally.customer || null;

  if (isTallyEnabled()) {
    const block = assertReadyForSalesTallySync(invoiceForTally, customer);
    if (block) {
      await persistSalesTallySyncResult(id, {
        status: 'failed',
        error: block,
        voucherNumber: null,
        syncedAt: null,
      });
      return getInvoiceById(id);
    }
    const syncResult = await syncSalesVoucherForInvoice(invoiceForTally, customer);
    await persistSalesTallySyncResult(id, syncResult);
    return getInvoiceById(id);
  }

  await persistSalesTallySyncResult(id, {
    status: 'skipped',
    error: 'TALLY_ENABLED is not true — set TALLY_ENABLED=true and restart the API',
    voucherNumber: null,
    syncedAt: null,
  });

  return getInvoiceById(id);
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

async function confirmPackingSlipPrinted(id, actorId) {
  const inv = await getInvoiceById(id);
  if (!['due', 'paid'].includes(inv.status)) {
    throw httpError('Issue the invoice before confirming packing slip print', 409);
  }
  if (!inv.printed_at) {
    throw httpError('Confirm invoice print before packing slip', 409);
  }
  if (inv.packing_slip_printed_at) {
    return inv;
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('sales_invoices')
    .update({
      packing_slip_printed_at: now,
      packing_slip_printed_by: actorId || null,
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

async function persistReceiptTallySyncResult(id, result) {
  const { error } = await supabase
    .from('sales_invoices')
    .update({
      tally_receipt_sync_status: result.status,
      tally_receipt_sync_error: result.error || null,
      tally_receipt_synced_at: result.syncedAt || null,
      tally_receipt_voucher_number: result.voucherNumber || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    console.error('Unable to persist sales receipt Tally sync status:', error.message);
  }
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

  const customer = inv.customer || null;
  if (isTallyEnabled()) {
    const ledgerName = String(customer?.ledger_name || '').trim();
    if (!ledgerName) {
      throw httpError(
        'Set ledger name on the customer before recording payment (Tally sync is enabled)',
        422
      );
    }
  }

  const txnId = cleanText(body.transaction_id);
  if (!txnId) throw httpError('transaction_id is required');

  const bankLedger = cleanText(body.bank_ledger);
  if (isTallyEnabled() && !bankLedger) {
    throw httpError('bank_ledger is required when Tally sync is enabled', 422);
  }

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

  const paidPatch = {
    status: 'paid',
    paid_at: paidAt,
    payment_transaction_id: txnId,
    payment_recorded_by: actorId || null,
    payment_bank_ledger: bankLedger || null,
    updated_at: new Date().toISOString(),
  };

  if (isTallyEnabled()) {
    paidPatch.tally_receipt_sync_status = 'pending';
    paidPatch.tally_receipt_sync_error = null;
  }

  const { data, error } = await supabase
    .from('sales_invoices')
    .update(paidPatch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;

  const paidInvoice = await getInvoiceById(data.id);

  if (isTallyEnabled()) {
    const syncResult = await syncReceiptVoucherForInvoice(
      paidInvoice,
      paidInvoice.customer || customer,
      {
        bankLedger,
        amount,
        reference: txnId,
      }
    );
    await persistReceiptTallySyncResult(id, syncResult);
    return getInvoiceById(id);
  }

  await persistReceiptTallySyncResult(id, {
    status: 'skipped',
    error: 'TALLY_ENABLED is not true — set TALLY_ENABLED=true and restart the API',
    voucherNumber: null,
    syncedAt: null,
  });

  return getInvoiceById(id);
}

/**
 * Settle multiple due invoices for one customer in a single receipt.
 * Amount must equal the sum of selected invoice totals (v1 full settle).
 */
async function recordBulkPayments(actorId, body = {}) {
  const customerId = body.customer_id;
  if (!isValidUUID(customerId)) throw httpError('customer_id is required');

  const invoiceIds = [...new Set((body.invoice_ids || []).filter(isValidUUID))];
  if (!invoiceIds.length) throw httpError('invoice_ids is required');

  const txnId = cleanText(body.transaction_id);
  if (!txnId) throw httpError('transaction_id is required');

  const bankLedger = cleanText(body.bank_ledger);
  if (isTallyEnabled() && !bankLedger) {
    throw httpError('bank_ledger is required when Tally sync is enabled', 422);
  }

  const { data: customer, error: custErr } = await supabase
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .maybeSingle();
  if (custErr) throw custErr;
  if (!customer) throw httpError('Customer not found', 404);

  if (isTallyEnabled() && !String(customer.ledger_name || '').trim()) {
    throw httpError(
      'Set ledger name on the customer before recording payment (Tally sync is enabled)',
      422
    );
  }

  const { data: rows, error } = await supabase
    .from('sales_invoices')
    .select('*')
    .in('id', invoiceIds)
    .eq('customer_id', customerId)
    .eq('status', 'due');
  if (error) throw error;

  const invoices = rows || [];
  if (invoices.length !== invoiceIds.length) {
    throw httpError('All invoices must be due and belong to the customer', 422);
  }

  const sum = round2(invoices.reduce((s, inv) => s + toNumber(inv.total_amount), 0));
  const amount = body.amount != null ? round2(body.amount) : sum;
  if (Math.abs(amount - sum) > 0.01) {
    throw httpError(
      `Bulk payment amount must equal selected invoices total (${sum})`,
      422
    );
  }

  const paidAt = body.paid_at ? new Date(body.paid_at).toISOString() : new Date().toISOString();
  const now = new Date().toISOString();

  for (const inv of invoices) {
    const { error: payErr } = await supabase.from('sales_invoice_payments').insert({
      sales_invoice_id: inv.id,
      amount: round2(inv.total_amount),
      transaction_id: txnId,
      paid_at: paidAt,
      recorded_by: actorId || null,
      notes: cleanText(body.notes) || 'Bulk payment',
    });
    if (payErr) throw payErr;

    const patch = {
      status: 'paid',
      paid_at: paidAt,
      payment_transaction_id: txnId,
      payment_recorded_by: actorId || null,
      payment_bank_ledger: bankLedger || null,
      updated_at: now,
    };
    if (isTallyEnabled()) {
      patch.tally_receipt_sync_status = 'pending';
      patch.tally_receipt_sync_error = null;
    }
    const { error: upErr } = await supabase
      .from('sales_invoices')
      .update(patch)
      .eq('id', inv.id);
    if (upErr) throw upErr;
  }

  let receiptResult = {
    status: 'skipped',
    error: 'TALLY_ENABLED is not true — set TALLY_ENABLED=true and restart the API',
    voucherNumber: null,
    syncedAt: null,
  };

  if (isTallyEnabled()) {
    receiptResult = await syncReceiptVoucherForInvoices(invoices, customer, {
      bankLedger,
      amount,
      reference: txnId,
    });
  }

  for (const inv of invoices) {
    await persistReceiptTallySyncResult(inv.id, receiptResult);
  }

  const paid = [];
  for (const inv of invoices) {
    paid.push(await getInvoiceById(inv.id));
  }

  return {
    sales_invoices: paid,
    receipt_sync: receiptResult,
  };
}

async function retrySalesInvoiceTallySync(id) {
  const inv = await getInvoiceById(id);
  if (!['due', 'paid'].includes(inv.status)) {
    throw httpError('Only issued (due/paid) sales invoices can sync Sales voucher to Tally', 409);
  }

  const customer = inv.customer || null;

  if (!isTallyEnabled()) {
    await persistSalesTallySyncResult(id, {
      status: 'skipped',
      error: 'TALLY_ENABLED is not true — set TALLY_ENABLED=true and restart the API',
      voucherNumber: null,
      syncedAt: null,
    });
    return getInvoiceById(id);
  }

  const block = assertReadyForSalesTallySync(inv, customer);
  if (block) throw httpError(block, 422);

  await supabase
    .from('sales_invoices')
    .update({
      tally_sync_status: 'pending',
      tally_sync_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  const syncResult = await syncSalesVoucherForInvoice(
    await attachComponentItemName(inv),
    customer
  );
  await persistSalesTallySyncResult(id, syncResult);
  return getInvoiceById(id);
}

async function retrySalesInvoiceReceiptTallySync(id) {
  const inv = await getInvoiceById(id);
  if (inv.status !== 'paid') {
    throw httpError('Only paid sales invoices can sync Receipt voucher to Tally', 409);
  }

  const customer = inv.customer || null;
  const bankLedger = String(inv.payment_bank_ledger || '').trim();
  if (!bankLedger) {
    throw httpError('payment_bank_ledger is missing — re-record payment with a bank ledger', 422);
  }

  if (!isTallyEnabled()) {
    await persistReceiptTallySyncResult(id, {
      status: 'skipped',
      error: 'TALLY_ENABLED is not true — set TALLY_ENABLED=true and restart the API',
      voucherNumber: null,
      syncedAt: null,
    });
    return getInvoiceById(id);
  }

  await supabase
    .from('sales_invoices')
    .update({
      tally_receipt_sync_status: 'pending',
      tally_receipt_sync_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  const syncResult = await syncReceiptVoucherForInvoice(inv, customer, {
    bankLedger,
    amount: inv.total_amount,
    reference: inv.payment_transaction_id,
  });
  await persistReceiptTallySyncResult(id, syncResult);
  return getInvoiceById(id);
}

/**
 * Ensure line description / component_name uses Component Name (not lookup label).
 */
async function attachComponentItemName(invoice) {
  if (!invoice) return invoice;

  let masterRecordId = null;
  if (invoice.blanket_po_line_id && isValidUUID(invoice.blanket_po_line_id)) {
    const { data: line } = await supabase
      .from('blanket_po_lines')
      .select('master_record_id')
      .eq('id', invoice.blanket_po_line_id)
      .maybeSingle();
    masterRecordId = line?.master_record_id || null;
  }

  if (!masterRecordId) return invoice;

  const [componentName, hsnCode, drawingNumber] = await Promise.all([
    resolveComponentItemName(masterRecordId),
    resolveHsnCode(masterRecordId),
    resolveDrawingNumber(masterRecordId),
  ]);
  if (!componentName && !hsnCode && !drawingNumber) return invoice;

  const lines = Array.isArray(invoice.line_items) ? [...invoice.line_items] : [];
  if (lines[0]) {
    lines[0] = {
      ...lines[0],
      ...(componentName ? { description: componentName } : null),
      ...(hsnCode ? { hsn: hsnCode } : null),
      ...(drawingNumber ? { drawing_number: drawingNumber } : null),
    };
  }

  return {
    ...invoice,
    component_name: componentName || invoice.component_name || null,
    line_items: lines,
  };
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
      'Create and issue a sales invoice, then confirm invoice and packing slip print before dispatch',
      409
    );
  }
  if (!['due', 'paid'].includes(inv.status)) {
    throw httpError('Invoice must be due or paid before dispatch', 409);
  }
  if (!inv.printed_at) {
    throw httpError('Confirm invoice print before dispatch', 409);
  }
  if (!inv.packing_slip_printed_at) {
    throw httpError('Confirm packing slip print before dispatch', 409);
  }
  return inv;
}

async function storeSalesInvoicePdf(invoiceId, file) {
  if (!isValidUUID(invoiceId)) throw httpError('Invalid invoice id');
  if (!file?.buffer?.length) throw httpError('PDF file is required', 400);

  const inv = await getInvoiceById(invoiceId);
  const original = String(file.originalname || '').trim();
  const safeName = (inv.invoice_number || `draft-${invoiceId}`)
    .replace(/[/\\]+/g, '-')
    .replace(/[^\w.\-]+/g, '_');
  const filename = original && original.toLowerCase().endsWith('.pdf')
    ? original.replace(/[/\\]+/g, '-')
    : `${safeName}.pdf`;
  const storagePath = `sales-invoices/${invoiceId}/${Date.now()}_${filename}`;

  const { error: storageError } = await supabase.storage
    .from('invoices')
    .upload(storagePath, file.buffer, {
      contentType: file.mimetype || 'application/pdf',
      upsert: true,
    });
  if (storageError) throw httpError(storageError.message || 'Unable to store invoice PDF', 500);

  const { data: publicUrlData } = supabase.storage
    .from('invoices')
    .getPublicUrl(storagePath);
  const publicUrl = publicUrlData?.publicUrl || null;
  if (!publicUrl) throw httpError('Unable to resolve stored invoice URL', 500);

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('sales_invoices')
    .update({ file_url: publicUrl, updated_at: now })
    .eq('id', invoiceId);
  if (error) throw error;

  return getInvoiceById(invoiceId);
}

async function invoiceSummariesForLots(lotIds) {
  const ids = (lotIds || []).filter(isValidUUID);
  if (!ids.length) return {};
  const { data, error } = await supabase
    .from('sales_invoices')
    .select(
      'id, lot_id, status, printed_at, packing_slip_printed_at, invoice_number, quantity'
    )
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
      packing_slip_printed: !!row.packing_slip_printed_at,
      quantity: toNumber(row.quantity),
    };
  }
  return map;
}

/**
 * After overage lot split: draft invoices sync to lot qty; issued/printed must already match.
 */
async function assertOrSyncInvoiceQtyForLot(lotId, expectedQty) {
  const inv = await findActiveInvoiceForLot(lotId);
  if (!inv) return null;
  const want = toNumber(expectedQty);
  const have = toNumber(inv.quantity);
  if (Math.abs(have - want) <= 0.0001) return inv;
  if (inv.status === 'draft') {
    return updateDraft(inv.id, { quantity: want });
  }
  throw httpError(
    `Invoice quantity (${have}) must equal schedule dispatch quantity (${want}) after split. Cancel and recreate the invoice for the schedule qty.`,
    409
  );
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
  confirmPackingSlipPrinted,
  cancelInvoice,
  recordPayment,
  recordBulkPayments,
  retrySalesInvoiceTallySync,
  retrySalesInvoiceReceiptTallySync,
  markDispatched,
  assertLotPrintGate,
  findActiveInvoiceForLot,
  invoiceSummariesForLots,
  storeSalesInvoicePdf,
  assertOrSyncInvoiceQtyForLot,
  computeTax,
  round2,
  indianFy,
  resolveLotBillingContext,
  dispatchedQtyByScheduleIds,
  remainingQtyForSchedule,
  pickOpenCampaignScheduleId,
  listOpenCampaignSchedules,
  listOpenOneOffSchedulesForMaster,
  listOpenScheduleOptionsForLot,
  resolveScheduleRemainingForLots,
  buildPackageLabel,
};
