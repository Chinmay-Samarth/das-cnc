const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const COMPONENT_SLUG = 'component';

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function isValidUUID(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function cleanText(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

async function nextDocumentNumber(docType, prefix) {
  const year = new Date().getFullYear();

  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: existing, error: selErr } = await supabase
      .from('document_sequences')
      .select('last_value')
      .eq('doc_type', docType)
      .eq('year', year)
      .maybeSingle();

    if (selErr) throw selErr;

    if (!existing) {
      const { error: insErr } = await supabase
        .from('document_sequences')
        .insert({ doc_type: docType, year, last_value: 1 });
      if (!insErr) {
        return `${prefix}-${year}-0001`;
      }
      // concurrent insert — retry
      continue;
    }

    const nextVal = existing.last_value + 1;
    const { data: updated, error: upErr } = await supabase
      .from('document_sequences')
      .update({ last_value: nextVal })
      .eq('doc_type', docType)
      .eq('year', year)
      .eq('last_value', existing.last_value)
      .select('last_value')
      .maybeSingle();

    if (upErr) throw upErr;
    if (updated) {
      return `${prefix}-${year}-${String(nextVal).padStart(4, '0')}`;
    }
  }

  throw httpError('Unable to allocate document number', 500);
}

async function recomputeReleasedQty(lineId) {
  const { data, error } = await supabase
    .from('delivery_schedules')
    .select('quantity')
    .eq('blanket_po_line_id', lineId)
    .neq('status', 'cancelled');

  if (error) throw error;

  const total = (data || []).reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const { error: upErr } = await supabase
    .from('blanket_po_lines')
    .update({ released_qty: total })
    .eq('id', lineId);

  if (upErr) throw upErr;
  return total;
}

async function validateComponentRecord(masterRecordId) {
  if (!isValidUUID(masterRecordId)) throw httpError('Invalid master_record_id');

  const { data: master, error: mErr } = await supabase
    .from('masters')
    .select('id')
    .eq('slug', COMPONENT_SLUG)
    .eq('is_active', true)
    .maybeSingle();

  if (mErr) throw mErr;
  if (!master) throw httpError("Component master (slug 'component') not found", 404);

  const { data: record, error } = await supabase
    .from('master_records')
    .select('id')
    .eq('id', masterRecordId)
    .eq('master_id', master.id)
    .maybeSingle();

  if (error) throw error;
  if (!record) throw httpError('Component master record not found', 404);
  return record;
}

async function getActiveBomVersionId(masterRecordId) {
  const { data, error } = await supabase
    .from('bom_versions')
    .select('id')
    .eq('master_record_id', masterRecordId)
    .eq('status', 'active')
    .maybeSingle();

  if (error) throw error;
  return data?.id || null;
}

async function getActiveActivityFlowVersionId(masterRecordId) {
  const { data, error } = await supabase
    .from('activity_flow_versions')
    .select('id')
    .eq('master_record_id', masterRecordId)
    .eq('status', 'active')
    .maybeSingle();

  if (error) throw error;
  return data?.id || null;
}

async function enrichLines(lines) {
  if (!lines?.length) return [];

  const recordIds = [...new Set(lines.map((l) => l.master_record_id).filter(Boolean))];
  const { data: lookups, error } = await supabase
    .from('v_master_lookup')
    .select('record_id, label, master_slug')
    .in('record_id', recordIds);

  if (error) throw error;
  const byId = new Map((lookups || []).map((r) => [r.record_id, r]));

  return lines.map((l) => {
    const lookup = byId.get(l.master_record_id) || {};
    return {
      ...l,
      unit_price: Number(l.unit_price),
      released_qty: Number(l.released_qty),
      component_label: lookup.label || l.master_record_id,
      component_slug: lookup.master_slug || COMPONENT_SLUG,
    };
  });
}

async function getBlanketById(id) {
  if (!isValidUUID(id)) throw httpError('Invalid blanket PO id');

  const { data, error } = await supabase
    .from('blanket_pos')
    .select('*, customers(id, name)')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw httpError('Blanket PO not found', 404);

  const { data: lines, error: lineErr } = await supabase
    .from('blanket_po_lines')
    .select('*')
    .eq('blanket_po_id', id)
    .order('line_no', { ascending: true });

  if (lineErr) throw lineErr;

  const customer = Array.isArray(data.customers) ? data.customers[0] : data.customers;
  const { customers, ...rest } = data;

  return {
    ...rest,
    customer_name: customer?.name || null,
    lines: await enrichLines(lines || []),
  };
}

async function listBlankets() {
  const { data, error } = await supabase
    .from('blanket_pos')
    .select('*, customers(id, name)')
    .order('created_at', { ascending: false });

  if (error) throw error;

  const ids = (data || []).map((b) => b.id);
  let countMap = new Map();
  let valueMap = new Map();
  if (ids.length) {
    const { data: lines, error: lineErr } = await supabase
      .from('blanket_po_lines')
      .select('blanket_po_id, unit_price, released_qty')
      .in('blanket_po_id', ids);
    if (lineErr) throw lineErr;
    for (const row of lines || []) {
      countMap.set(row.blanket_po_id, (countMap.get(row.blanket_po_id) || 0) + 1);
      const prev = valueMap.get(row.blanket_po_id) || { released_value: 0, line_value: 0 };
      const price = Number(row.unit_price) || 0;
      const released = Number(row.released_qty) || 0;
      prev.released_value += released * price;
      // Contract value proxy: at least released; detail may refine
      prev.line_value += Math.max(released, 1) * price;
      valueMap.set(row.blanket_po_id, prev);
    }
  }

  // Enrich with schedule qty totals for better progress denominators
  if (ids.length) {
    const { data: schedLines } = await supabase
      .from('blanket_po_lines')
      .select('id, blanket_po_id, unit_price')
      .in('blanket_po_id', ids);
    const lineIds = (schedLines || []).map((l) => l.id);
    if (lineIds.length) {
      const { data: schedules } = await supabase
        .from('delivery_schedules')
        .select('blanket_po_line_id, quantity, status')
        .in('blanket_po_line_id', lineIds)
        .neq('status', 'cancelled');
      const lineById = Object.fromEntries((schedLines || []).map((l) => [l.id, l]));
      const contractByPo = new Map();
      for (const s of schedules || []) {
        const line = lineById[s.blanket_po_line_id];
        if (!line) continue;
        const price = Number(line.unit_price) || 0;
        const qty = Number(s.quantity) || 0;
        contractByPo.set(
          line.blanket_po_id,
          (contractByPo.get(line.blanket_po_id) || 0) + qty * price
        );
      }
      for (const [poId, contract] of contractByPo.entries()) {
        const prev = valueMap.get(poId) || { released_value: 0, line_value: 0 };
        prev.contract_value = contract;
        valueMap.set(poId, prev);
      }
    }
  }

  return (data || []).map((row) => {
    const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers;
    const { customers, ...rest } = row;
    const vals = valueMap.get(row.id) || {};
    return {
      ...rest,
      customer_name: customer?.name || null,
      line_count: countMap.get(row.id) || 0,
      released_value: Math.round((vals.released_value || 0) * 100) / 100,
      contract_value: Math.round((vals.contract_value || vals.line_value || 0) * 100) / 100,
    };
  });
}

async function createBlanket(payload, createdBy) {
  const customerId = cleanText(payload.customer_id);
  if (!customerId || !isValidUUID(customerId)) throw httpError('customer_id is required');

  const { data: customer, error: cErr } = await supabase
    .from('customers')
    .select('id')
    .eq('id', customerId)
    .maybeSingle();
  if (cErr) throw cErr;
  if (!customer) throw httpError('Customer not found', 404);

  const blanketNumber = await nextDocumentNumber('blanket_po', 'BPO');

  const { data, error } = await supabase
    .from('blanket_pos')
    .insert({
      blanket_number: blanketNumber,
      customer_id: customerId,
      status: 'draft',
      currency: cleanText(payload.currency) || 'INR',
      valid_from: null,
      valid_to: null,
      payment_terms: cleanText(payload.payment_terms),
      notes: cleanText(payload.notes),
      created_by: createdBy || null,
    })
    .select('*')
    .single();

  if (error) throw error;
  return getBlanketById(data.id);
}

async function updateBlanket(id, payload) {
  const blanket = await getBlanketById(id);
  if (['closed', 'cancelled'].includes(blanket.status)) {
    throw httpError('Closed or cancelled blankets cannot be edited');
  }

  const updates = {};
  // valid_from / valid_to are system-managed on activate/close (BOM-style)
  if (payload.payment_terms !== undefined) updates.payment_terms = cleanText(payload.payment_terms);
  if (payload.notes !== undefined) updates.notes = cleanText(payload.notes);
  if (payload.currency !== undefined) updates.currency = cleanText(payload.currency) || 'INR';
  if (payload.customer_id !== undefined) {
    if (blanket.status !== 'draft') throw httpError('Customer can only be changed on draft blankets');
    if (!isValidUUID(payload.customer_id)) throw httpError('Invalid customer_id');
    updates.customer_id = payload.customer_id;
  }

  if (!Object.keys(updates).length) throw httpError('No fields to update');

  const { error } = await supabase.from('blanket_pos').update(updates).eq('id', id);
  if (error) throw error;
  return getBlanketById(id);
}

async function setBlanketStatus(id, status) {
  const allowed = ['active', 'on_hold', 'closed', 'cancelled'];
  if (!allowed.includes(status)) throw httpError('Invalid status');

  const blanket = await getBlanketById(id);
  const today = todayDateString();

  if (status === 'active') {
    if (!['draft', 'on_hold'].includes(blanket.status)) {
      throw httpError('Only draft or on-hold blankets can be activated');
    }
    if (!blanket.lines?.length) throw httpError('Add at least one line before activating');

    // First activation from draft: BOM-style validity + retire prior open contracts for this customer
    if (blanket.status === 'draft') {
      const { data: priorOpen, error: priorErr } = await supabase
        .from('blanket_pos')
        .select('id')
        .eq('customer_id', blanket.customer_id)
        .in('status', ['active', 'on_hold'])
        .neq('id', id);

      if (priorErr) throw priorErr;

      for (const row of priorOpen || []) {
        const { error: retireErr } = await supabase
          .from('blanket_pos')
          .update({ status: 'closed', valid_to: today })
          .eq('id', row.id);
        if (retireErr) throw retireErr;
      }

      const { error } = await supabase
        .from('blanket_pos')
        .update({
          status: 'active',
          valid_from: today,
          valid_to: null,
        })
        .eq('id', id);
      if (error) throw error;
      return getBlanketById(id);
    }

    // Resume from hold: keep existing valid_from, ensure open-ended
    const { error } = await supabase
      .from('blanket_pos')
      .update({
        status: 'active',
        valid_to: null,
      })
      .eq('id', id);
    if (error) throw error;
    return getBlanketById(id);
  }

  if (status === 'on_hold' && blanket.status !== 'active') {
    throw httpError('Only active blankets can be put on hold');
  }
  if (status === 'closed' && !['active', 'on_hold'].includes(blanket.status)) {
    throw httpError('Only active or on-hold blankets can be closed');
  }
  if (status === 'cancelled' && !['draft', 'on_hold'].includes(blanket.status)) {
    throw httpError('Only draft or on-hold blankets can be cancelled');
  }

  const updates = { status };
  if (status === 'closed' && !blanket.valid_to) {
    updates.valid_to = today;
  }

  const { error } = await supabase.from('blanket_pos').update(updates).eq('id', id);
  if (error) throw error;
  return getBlanketById(id);
}

async function assertBlanketEditableForLines(blanketPoId) {
  const blanket = await getBlanketById(blanketPoId);
  if (['closed', 'cancelled'].includes(blanket.status)) {
    throw httpError('Cannot modify lines on a closed or cancelled blanket');
  }
  return blanket;
}

async function addLine(blanketPoId, payload) {
  const blanket = await assertBlanketEditableForLines(blanketPoId);
  await validateComponentRecord(payload.master_record_id);

  const unitPrice = Number(payload.unit_price);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) throw httpError('unit_price must be >= 0');

  const uom = cleanText(payload.uom) || 'pcs';

  const { data: maxRows, error: maxErr } = await supabase
    .from('blanket_po_lines')
    .select('line_no')
    .eq('blanket_po_id', blanketPoId)
    .order('line_no', { ascending: false })
    .limit(1);
  if (maxErr) throw maxErr;
  const lineNo = (maxRows?.[0]?.line_no || 0) + 1;

  const { data, error } = await supabase
    .from('blanket_po_lines')
    .insert({
      blanket_po_id: blanketPoId,
      line_no: lineNo,
      master_record_id: payload.master_record_id,
      uom,
      unit_price: unitPrice,
      notes: cleanText(payload.notes),
    })
    .select('*')
    .single();

  if (error) throw error;
  const [enriched] = await enrichLines([data]);
  return { blanket, line: enriched };
}

async function updateLine(blanketPoId, lineId, payload) {
  await assertBlanketEditableForLines(blanketPoId);

  const { data: line, error } = await supabase
    .from('blanket_po_lines')
    .select('*')
    .eq('id', lineId)
    .eq('blanket_po_id', blanketPoId)
    .maybeSingle();

  if (error) throw error;
  if (!line) throw httpError('Line not found', 404);

  const updates = {};
  if (payload.unit_price !== undefined) {
    const unitPrice = Number(payload.unit_price);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw httpError('unit_price must be >= 0');
    updates.unit_price = unitPrice;
  }
  if (payload.uom !== undefined) updates.uom = cleanText(payload.uom) || 'pcs';
  if (payload.notes !== undefined) updates.notes = cleanText(payload.notes);
  if (payload.master_record_id !== undefined) {
    if (Number(line.released_qty) > 0) {
      throw httpError('Cannot change component after schedules exist');
    }
    await validateComponentRecord(payload.master_record_id);
    updates.master_record_id = payload.master_record_id;
  }

  if (!Object.keys(updates).length) throw httpError('No fields to update');

  const { data: updated, error: upErr } = await supabase
    .from('blanket_po_lines')
    .update(updates)
    .eq('id', lineId)
    .select('*')
    .single();

  if (upErr) throw upErr;
  const [enriched] = await enrichLines([updated]);
  return enriched;
}

async function deleteLine(blanketPoId, lineId) {
  await assertBlanketEditableForLines(blanketPoId);

  const { data: line, error } = await supabase
    .from('blanket_po_lines')
    .select('id, released_qty')
    .eq('id', lineId)
    .eq('blanket_po_id', blanketPoId)
    .maybeSingle();

  if (error) throw error;
  if (!line) throw httpError('Line not found', 404);
  if (Number(line.released_qty) > 0) {
    throw httpError('Cannot delete a line that has delivery schedules');
  }

  const { error: delErr } = await supabase.from('blanket_po_lines').delete().eq('id', lineId);
  if (delErr) throw delErr;
  return { success: true };
}

async function getLineWithBlanket(lineId) {
  if (!isValidUUID(lineId)) throw httpError('Invalid line id');

  const { data: line, error } = await supabase
    .from('blanket_po_lines')
    .select('*')
    .eq('id', lineId)
    .maybeSingle();

  if (error) throw error;
  if (!line) throw httpError('Blanket PO line not found', 404);

  const blanket = await getBlanketById(line.blanket_po_id);
  const [enriched] = await enrichLines([line]);
  return { line: enriched, blanket };
}

function assertBlanketAcceptsSchedules(blanket) {
  if (blanket.status !== 'active') {
    throw httpError('Only active blankets accept delivery schedules');
  }
}

/** Draft rules can be authored on draft/active/on_hold blankets; generation still needs active. */
function assertBlanketAcceptsRuleDrafts(blanket) {
  if (['closed', 'cancelled'].includes(blanket.status)) {
    throw httpError('Cannot add schedule rules on a closed or cancelled blanket');
  }
}

function dateInRange(dateStr, from, to) {
  if (from && dateStr < from) return false;
  if (to && dateStr > to) return false;
  return true;
}

function isoWeekday(date) {
  // JS: 0=Sun..6=Sat → ISO 1=Mon..7=Sun
  const d = date.getUTCDay();
  return d === 0 ? 7 : d;
}

function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

function parseDateOnly(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (!m) throw httpError('Invalid date format (YYYY-MM-DD)');
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function daysBetweenUtc(a, b) {
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function daysInUtcMonth(year, monthIndex0) {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

/** Snap calendar date forward to the next (or same) matching ISO weekday. */
function snapToWeekday(dateStr, weekday) {
  const d = parseDateOnly(dateStr);
  const target = Number(weekday);
  for (let i = 0; i < 7; i++) {
    if (isoWeekday(d) === target) return toDateString(d);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return toDateString(d);
}

/**
 * Resolve due dates for a rule within a horizon.
 * ruleDates: [{ due_date, quantity? }] for custom cadence.
 */
function matchingDates(rule, horizonStart, horizonEnd, blanket, ruleDates = []) {
  const start = parseDateOnly(horizonStart);
  const end = parseDateOnly(horizonEnd);
  if (end < start) throw httpError('horizon_end must be >= horizon_start');

  const interval = Math.max(1, Number(rule.interval_weeks) || 1);
  const cadence = rule.cadence;
  const dates = [];

  if (cadence === 'custom') {
    for (const row of ruleDates || []) {
      const ds = String(row.due_date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) continue;
      if (ds < horizonStart || ds > horizonEnd) continue;
      if (!dateInRange(ds, rule.valid_from, rule.valid_to)) continue;
      if (!dateInRange(ds, blanket.valid_from, blanket.valid_to)) continue;
      dates.push(ds);
    }
    dates.sort();
    return [...new Set(dates)];
  }

  let anchor = null;
  if (cadence === 'weekly' && interval > 1) {
    const anchorRaw = rule.anchor_date || rule.valid_from || horizonStart;
    anchor = parseDateOnly(snapToWeekday(anchorRaw, rule.weekday));
  }

  const cursor = new Date(start);
  while (cursor <= end) {
    const ds = toDateString(cursor);
    let match = false;

    if (cadence === 'weekly') {
      if (isoWeekday(cursor) === Number(rule.weekday)) {
        if (interval <= 1) {
          match = true;
        } else if (anchor) {
          const weeks = Math.floor(daysBetweenUtc(anchor, cursor) / 7);
          match = weeks >= 0 && weeks % interval === 0;
        }
      }
    } else if (cadence === 'monthly') {
      const md = Number(rule.month_day);
      const dim = daysInUtcMonth(cursor.getUTCFullYear(), cursor.getUTCMonth());
      const targetDay = Math.min(md, dim);
      match = cursor.getUTCDate() === targetDay;
    }

    if (
      match &&
      dateInRange(ds, rule.valid_from, rule.valid_to) &&
      dateInRange(ds, blanket.valid_from, blanket.valid_to)
    ) {
      dates.push(ds);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

async function listRuleDates(ruleId) {
  if (!isValidUUID(ruleId)) throw httpError('Invalid rule id');
  const { data, error } = await supabase
    .from('delivery_schedule_rule_dates')
    .select('*')
    .eq('rule_id', ruleId)
    .order('due_date', { ascending: true });
  if (error) throw error;
  return (data || []).map((r) => ({
    ...r,
    quantity: r.quantity != null ? Number(r.quantity) : null,
  }));
}

/**
 * Replace the full custom date set for a rule.
 * dates: string[] | { due_date, quantity? }[]
 */
async function setRuleDates(ruleId, datesPayload) {
  if (!isValidUUID(ruleId)) throw httpError('Invalid rule id');

  const { data: rule, error } = await supabase
    .from('delivery_schedule_rules')
    .select('*')
    .eq('id', ruleId)
    .maybeSingle();
  if (error) throw error;
  if (!rule) throw httpError('Schedule rule not found', 404);
  if (rule.cadence !== 'custom') {
    throw httpError('Only custom cadence rules have a date list');
  }

  const { blanket } = await getLineWithBlanket(rule.blanket_po_line_id);
  if (['closed', 'cancelled'].includes(blanket.status)) {
    throw httpError('Cannot edit rules on a closed or cancelled blanket');
  }

  const raw = Array.isArray(datesPayload) ? datesPayload : [];
  const normalized = [];
  const seen = new Set();
  for (const item of raw) {
    const due =
      typeof item === 'string'
        ? String(item).slice(0, 10)
        : String(item?.due_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) {
      throw httpError(`Invalid custom date: ${due || '(empty)'}`);
    }
    if (seen.has(due)) continue;
    seen.add(due);
    let qty = null;
    if (item && typeof item === 'object' && item.quantity != null && item.quantity !== '') {
      qty = Number(item.quantity);
      if (!Number.isFinite(qty) || qty <= 0) throw httpError('custom date quantity must be > 0');
    }
    normalized.push({ rule_id: ruleId, due_date: due, quantity: qty });
  }

  const { error: delErr } = await supabase
    .from('delivery_schedule_rule_dates')
    .delete()
    .eq('rule_id', ruleId);
  if (delErr) throw delErr;

  if (normalized.length) {
    const { error: insErr } = await supabase
      .from('delivery_schedule_rule_dates')
      .insert(normalized);
    if (insErr) throw insErr;
  }

  return listRuleDates(ruleId);
}

async function enrichRule(rule) {
  if (!rule) return null;
  const base = {
    ...rule,
    default_quantity: Number(rule.default_quantity),
    interval_weeks: Number(rule.interval_weeks) || 1,
  };
  if (rule.cadence === 'custom') {
    base.custom_dates = await listRuleDates(rule.id);
  } else {
    base.custom_dates = [];
  }
  return base;
}

async function listRules(lineId) {
  let query = supabase
    .from('delivery_schedule_rules')
    .select('*')
    .order('created_at', { ascending: false });

  if (lineId) query = query.eq('blanket_po_line_id', lineId);

  const { data, error } = await query;
  if (error) throw error;
  const rules = [];
  for (const r of data || []) {
    rules.push(await enrichRule(r));
  }
  return rules;
}

async function createRule(payload) {
  const { line, blanket } = await getLineWithBlanket(payload.blanket_po_line_id);
  assertBlanketAcceptsRuleDrafts(blanket);

  let cadence = payload.cadence;
  // UI convenience: biweekly → weekly + interval 2
  let intervalWeeks = Number(payload.interval_weeks);
  if (cadence === 'biweekly') {
    cadence = 'weekly';
    if (!Number.isFinite(intervalWeeks) || intervalWeeks < 1) intervalWeeks = 2;
  }
  if (!['weekly', 'monthly', 'custom'].includes(cadence)) {
    throw httpError('cadence must be weekly, monthly, or custom');
  }
  if (!Number.isInteger(intervalWeeks) || intervalWeeks < 1) intervalWeeks = 1;
  if (cadence !== 'weekly') intervalWeeks = 1;

  const defaultQty = Number(payload.default_quantity);
  if (!Number.isFinite(defaultQty) || defaultQty <= 0) throw httpError('default_quantity must be > 0');

  const row = {
    blanket_po_line_id: line.id,
    cadence,
    weekday: null,
    month_day: null,
    interval_weeks: intervalWeeks,
    anchor_date: null,
    default_quantity: defaultQty,
    valid_from: null,
    valid_to: null,
    is_active: false,
    notes: cleanText(payload.notes),
  };

  if (cadence === 'weekly') {
    const weekday = Number(payload.weekday);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
      throw httpError('weekday must be 1 (Mon) through 7 (Sun)');
    }
    row.weekday = weekday;
    if (payload.anchor_date) {
      row.anchor_date = snapToWeekday(payload.anchor_date, weekday);
    }
  } else if (cadence === 'monthly') {
    const monthDay = Number(payload.month_day);
    if (!Number.isInteger(monthDay) || monthDay < 1 || monthDay > 31) {
      throw httpError('month_day must be 1 through 31');
    }
    row.month_day = monthDay;
  }

  const { data, error } = await supabase
    .from('delivery_schedule_rules')
    .insert(row)
    .select('*')
    .single();

  if (error) throw error;

  if (cadence === 'custom' && Array.isArray(payload.custom_dates) && payload.custom_dates.length) {
    await setRuleDates(data.id, payload.custom_dates);
  }

  return enrichRule(data);
}

async function updateRule(ruleId, payload) {
  if (!isValidUUID(ruleId)) throw httpError('Invalid rule id');

  const { data: rule, error } = await supabase
    .from('delivery_schedule_rules')
    .select('*')
    .eq('id', ruleId)
    .maybeSingle();

  if (error) throw error;
  if (!rule) throw httpError('Schedule rule not found', 404);

  const { blanket } = await getLineWithBlanket(rule.blanket_po_line_id);
  if (['closed', 'cancelled'].includes(blanket.status)) {
    throw httpError('Cannot edit rules on a closed or cancelled blanket');
  }

  const updates = {};
  if (payload.default_quantity !== undefined) {
    const q = Number(payload.default_quantity);
    if (!Number.isFinite(q) || q <= 0) throw httpError('default_quantity must be > 0');
    updates.default_quantity = q;
  }
  if (payload.notes !== undefined) updates.notes = cleanText(payload.notes);

  if (rule.cadence === 'weekly') {
    if (payload.weekday !== undefined) {
      if (rule.is_active) throw httpError('Cannot change weekday on an active rule; create a new rule instead');
      const weekday = Number(payload.weekday);
      if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
        throw httpError('weekday must be 1–7');
      }
      updates.weekday = weekday;
    }
    if (payload.interval_weeks !== undefined) {
      if (rule.is_active) {
        throw httpError('Cannot change interval on an active rule; create a new rule instead');
      }
      const iv = Number(payload.interval_weeks);
      if (!Number.isInteger(iv) || iv < 1) throw httpError('interval_weeks must be >= 1');
      updates.interval_weeks = iv;
    }
    if (payload.anchor_date !== undefined) {
      if (rule.is_active) {
        throw httpError('Cannot change anchor_date on an active rule; create a new rule instead');
      }
      const wd = updates.weekday != null ? updates.weekday : rule.weekday;
      updates.anchor_date = payload.anchor_date
        ? snapToWeekday(payload.anchor_date, wd)
        : null;
    }
  }

  if (rule.cadence === 'monthly' && payload.month_day !== undefined) {
    if (rule.is_active) throw httpError('Cannot change month day on an active rule; create a new rule instead');
    const monthDay = Number(payload.month_day);
    if (!Number.isInteger(monthDay) || monthDay < 1 || monthDay > 31) {
      throw httpError('month_day must be 1–31');
    }
    updates.month_day = monthDay;
  }

  let updated = rule;
  if (Object.keys(updates).length) {
    const { data, error: upErr } = await supabase
      .from('delivery_schedule_rules')
      .update(updates)
      .eq('id', ruleId)
      .select('*')
      .single();
    if (upErr) throw upErr;
    updated = data;
  }

  if (rule.cadence === 'custom' && payload.custom_dates !== undefined) {
    await setRuleDates(ruleId, payload.custom_dates);
  }

  if (!Object.keys(updates).length && payload.custom_dates === undefined) {
    throw httpError('No fields to update');
  }

  return enrichRule(updated);
}

/**
 * Activate a draft rule: valid_from = today, valid_to = null.
 * Retires the previous active rule on the same line with the same cadence slot
 * (weekly: same weekday + interval; monthly: same month_day; custom: none).
 */
async function activateRule(ruleId) {
  if (!isValidUUID(ruleId)) throw httpError('Invalid rule id');

  const { data: rule, error } = await supabase
    .from('delivery_schedule_rules')
    .select('*')
    .eq('id', ruleId)
    .maybeSingle();

  if (error) throw error;
  if (!rule) throw httpError('Schedule rule not found', 404);
  if (rule.is_active) throw httpError('Rule is already active');
  if (rule.valid_from) {
    throw httpError('Cannot reactivate a closed rule; create a new draft rule instead');
  }

  const { blanket } = await getLineWithBlanket(rule.blanket_po_line_id);
  assertBlanketAcceptsSchedules(blanket);

  if (rule.cadence === 'custom') {
    const dates = await listRuleDates(ruleId);
    if (!dates.length) throw httpError('Custom rule needs at least one date before activate');
  }

  const today = todayDateString();
  const activateUpdates = {
    is_active: true,
    valid_from: today,
    valid_to: null,
  };

  if (rule.cadence === 'weekly') {
    const interval = Number(rule.interval_weeks) || 1;
    if (interval > 1 && !rule.anchor_date) {
      activateUpdates.anchor_date = snapToWeekday(today, rule.weekday);
    } else if (rule.anchor_date) {
      activateUpdates.anchor_date = snapToWeekday(rule.anchor_date, rule.weekday);
    }
  }

  // Retire prior active sibling in the same "slot" (not for custom)
  if (rule.cadence === 'weekly' || rule.cadence === 'monthly') {
    let priorQuery = supabase
      .from('delivery_schedule_rules')
      .select('id')
      .eq('blanket_po_line_id', rule.blanket_po_line_id)
      .eq('is_active', true)
      .eq('cadence', rule.cadence)
      .neq('id', ruleId);

    if (rule.cadence === 'weekly') {
      priorQuery = priorQuery
        .eq('weekday', rule.weekday)
        .eq('interval_weeks', Number(rule.interval_weeks) || 1);
    } else {
      priorQuery = priorQuery.eq('month_day', rule.month_day);
    }

    const { data: priorActive, error: priorErr } = await priorQuery;
    if (priorErr) throw priorErr;

    for (const row of priorActive || []) {
      const { error: retireErr } = await supabase
        .from('delivery_schedule_rules')
        .update({ is_active: false, valid_to: today })
        .eq('id', row.id);
      if (retireErr) throw retireErr;
    }
  }

  const { data, error: actErr } = await supabase
    .from('delivery_schedule_rules')
    .update(activateUpdates)
    .eq('id', ruleId)
    .select('*')
    .single();

  if (actErr) throw actErr;
  return enrichRule(data);
}

async function deactivateRule(ruleId) {
  if (!isValidUUID(ruleId)) throw httpError('Invalid rule id');

  const { data: rule, error } = await supabase
    .from('delivery_schedule_rules')
    .select('*')
    .eq('id', ruleId)
    .maybeSingle();

  if (error) throw error;
  if (!rule) throw httpError('Schedule rule not found', 404);
  if (!rule.is_active) throw httpError('Rule is already inactive');

  const today = todayDateString();
  const { data, error: upErr } = await supabase
    .from('delivery_schedule_rules')
    .update({
      is_active: false,
      valid_to: rule.valid_to || today,
    })
    .eq('id', ruleId)
    .select('*')
    .single();

  if (upErr) throw upErr;
  return enrichRule(data);
}

function isoWeekdayFromDateString(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').slice(0, 10));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const js = d.getUTCDay();
  return js === 0 ? 7 : js;
}

const WEEKDAY_LABELS = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
};

async function enrichSchedules(rows) {
  if (!rows?.length) return [];

  const lineIds = [...new Set(rows.map((r) => r.blanket_po_line_id))];
  const ruleIds = [...new Set(rows.map((r) => r.rule_id).filter(Boolean))];

  const { data: lines, error: lineErr } = await supabase
    .from('blanket_po_lines')
    .select('id, blanket_po_id, master_record_id, uom, unit_price, blanket_pos(id, blanket_number, customer_id, customers(name))')
    .in('id', lineIds);

  if (lineErr) throw lineErr;

  let ruleMap = new Map();
  if (ruleIds.length) {
    const { data: rules, error: ruleErr } = await supabase
      .from('delivery_schedule_rules')
      .select('id, cadence, weekday, month_day, default_quantity, interval_weeks, anchor_date')
      .in('id', ruleIds);
    if (ruleErr) throw ruleErr;
    ruleMap = new Map((rules || []).map((r) => [r.id, r]));
  }

  const recordIds = [...new Set((lines || []).map((l) => l.master_record_id))];
  const { data: lookups } = await supabase
    .from('v_master_lookup')
    .select('record_id, label')
    .in('record_id', recordIds.length ? recordIds : ['00000000-0000-0000-0000-000000000000']);

  const lookupMap = new Map((lookups || []).map((l) => [l.record_id, l.label]));
  const lineMap = new Map((lines || []).map((l) => [l.id, l]));

  return rows.map((s) => {
    const line = lineMap.get(s.blanket_po_line_id);
    const blanket = line
      ? Array.isArray(line.blanket_pos)
        ? line.blanket_pos[0]
        : line.blanket_pos
      : null;
    const customer = blanket
      ? Array.isArray(blanket.customers)
        ? blanket.customers[0]
        : blanket.customers
      : null;
    const rule = s.rule_id ? ruleMap.get(s.rule_id) : null;
    const dueWeekday = isoWeekdayFromDateString(s.due_date);

    return {
      ...s,
      quantity: Number(s.quantity),
      component_label: line ? lookupMap.get(line.master_record_id) || null : null,
      master_record_id: line?.master_record_id || null,
      uom: line?.uom || null,
      unit_price: line ? Number(line.unit_price) : null,
      blanket_po_id: line?.blanket_po_id || null,
      blanket_number: blanket?.blanket_number || null,
      customer_name: customer?.name || null,
      due_weekday: dueWeekday,
      due_weekday_label: dueWeekday ? WEEKDAY_LABELS[dueWeekday] || null : null,
      rule_cadence: rule?.cadence || null,
      rule_weekday: rule?.weekday != null ? Number(rule.weekday) : null,
      rule_weekday_label:
        rule?.cadence === 'weekly' && rule?.weekday != null
          ? WEEKDAY_LABELS[Number(rule.weekday)] || null
          : null,
      rule_month_day: rule?.month_day != null ? Number(rule.month_day) : null,
      rule_interval_weeks: rule?.interval_weeks != null ? Number(rule.interval_weeks) : null,
      rule_anchor_date: rule?.anchor_date || null,
    };
  });
}

async function listSchedules(filters = {}) {
  let query = supabase
    .from('delivery_schedules')
    .select('*')
    .order('due_date', { ascending: true });

  if (filters.from) query = query.gte('due_date', filters.from);
  if (filters.to) query = query.lte('due_date', filters.to);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.blanket_po_line_id) query = query.eq('blanket_po_line_id', filters.blanket_po_line_id);

  const { data, error } = await query;
  if (error) throw error;

  let rows = await enrichSchedules(data || []);

  if (filters.blanket_po_id) {
    rows = rows.filter((r) => r.blanket_po_id === filters.blanket_po_id);
  }
  if (filters.customer_id) {
    // need customer on blanket — re-filter via blankets
    const { data: blankets } = await supabase
      .from('blanket_pos')
      .select('id')
      .eq('customer_id', filters.customer_id);
    const ids = new Set((blankets || []).map((b) => b.id));
    rows = rows.filter((r) => ids.has(r.blanket_po_id));
  }

  return rows;
}

async function createOneOffSchedule(payload, createdBy) {
  const { line, blanket } = await getLineWithBlanket(payload.blanket_po_line_id);
  assertBlanketAcceptsSchedules(blanket);

  const dueDate = payload.due_date;
  if (!dueDate) throw httpError('due_date is required');
  if (!dateInRange(dueDate, blanket.valid_from, blanket.valid_to)) {
    throw httpError('due_date is outside the blanket validity window');
  }

  const qty = Number(payload.quantity);
  if (!Number.isFinite(qty) || qty <= 0) throw httpError('quantity must be > 0');

  const scheduleNumber = await nextDocumentNumber('delivery_schedule', 'DS');

  const { data, error } = await supabase
    .from('delivery_schedules')
    .insert({
      blanket_po_line_id: line.id,
      rule_id: null,
      schedule_number: scheduleNumber,
      due_date: dueDate,
      quantity: qty,
      status: 'planned',
      notes: cleanText(payload.notes),
      created_by: createdBy || null,
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') throw httpError('A schedule already exists for this date on the line', 409);
    throw error;
  }

  await recomputeReleasedQty(line.id);
  const [enriched] = await enrichSchedules([data]);
  return enriched;
}

async function generateFromRule(payload, createdBy) {
  const ruleId = payload.rule_id;
  if (!isValidUUID(ruleId)) throw httpError('rule_id is required');

  const { data: rule, error } = await supabase
    .from('delivery_schedule_rules')
    .select('*')
    .eq('id', ruleId)
    .maybeSingle();

  if (error) throw error;
  if (!rule) throw httpError('Schedule rule not found', 404);
  if (!rule.is_active) throw httpError('Schedule rule is inactive');
  if (!rule.valid_from) throw httpError('Schedule rule has no valid_from; activate it first');

  const { line, blanket } = await getLineWithBlanket(rule.blanket_po_line_id);
  assertBlanketAcceptsSchedules(blanket);

  const horizonStart = payload.horizon_start;
  const horizonEnd = payload.horizon_end;
  if (!horizonStart || !horizonEnd) throw httpError('horizon_start and horizon_end are required');

  const ruleDates = rule.cadence === 'custom' ? await listRuleDates(ruleId) : [];
  const qtyByDate = Object.fromEntries(
    (ruleDates || []).map((r) => [r.due_date, r.quantity != null ? Number(r.quantity) : null])
  );
  const dates = matchingDates(rule, horizonStart, horizonEnd, blanket, ruleDates);
  const created = [];
  const skipped = [];

  for (const dueDate of dates) {
    const scheduleNumber = await nextDocumentNumber('delivery_schedule', 'DS');
    const qty =
      qtyByDate[dueDate] != null && qtyByDate[dueDate] > 0
        ? qtyByDate[dueDate]
        : Number(rule.default_quantity);
    const { data, error: insErr } = await supabase
      .from('delivery_schedules')
      .insert({
        blanket_po_line_id: line.id,
        rule_id: rule.id,
        schedule_number: scheduleNumber,
        due_date: dueDate,
        quantity: qty,
        status: 'planned',
        created_by: createdBy || null,
      })
      .select('*')
      .single();

    if (insErr) {
      if (insErr.code === '23505') {
        skipped.push(dueDate);
        continue;
      }
      throw insErr;
    }
    created.push(data);
  }

  await recomputeReleasedQty(line.id);
  return {
    created_count: created.length,
    skipped_count: skipped.length,
    skipped_dates: skipped,
    schedules: await enrichSchedules(created),
  };
}

async function previewMatchingDates(payload) {
  const ruleId = payload.rule_id;
  if (!isValidUUID(ruleId)) throw httpError('rule_id is required');

  const { data: rule, error } = await supabase
    .from('delivery_schedule_rules')
    .select('*')
    .eq('id', ruleId)
    .maybeSingle();
  if (error) throw error;
  if (!rule) throw httpError('Schedule rule not found', 404);

  const { blanket } = await getLineWithBlanket(rule.blanket_po_line_id);
  const horizonStart = payload.horizon_start;
  const horizonEnd = payload.horizon_end;
  if (!horizonStart || !horizonEnd) throw httpError('horizon_start and horizon_end are required');

  // Preview may use draft valid_from=null → treat as open from horizon for match window of rule
  const ruleForMatch = {
    ...rule,
    valid_from: rule.valid_from || horizonStart,
  };

  const ruleDates = rule.cadence === 'custom' ? await listRuleDates(ruleId) : [];
  const dates = matchingDates(ruleForMatch, horizonStart, horizonEnd, blanket, ruleDates);
  return {
    rule_id: ruleId,
    cadence: rule.cadence,
    interval_weeks: Number(rule.interval_weeks) || 1,
    dates,
    count: dates.length,
  };
}

async function updateSchedule(id, payload) {
  if (!isValidUUID(id)) throw httpError('Invalid schedule id');

  const { data: schedule, error } = await supabase
    .from('delivery_schedules')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!schedule) throw httpError('Delivery schedule not found', 404);
  if (schedule.status !== 'planned') {
    throw httpError('Only planned schedules can be edited');
  }

  const { blanket } = await getLineWithBlanket(schedule.blanket_po_line_id);

  const updates = {};
  if (payload.quantity !== undefined) {
    const qty = Number(payload.quantity);
    if (!Number.isFinite(qty) || qty <= 0) throw httpError('quantity must be > 0');
    updates.quantity = qty;
  }
  if (payload.due_date !== undefined) {
    if (!dateInRange(payload.due_date, blanket.valid_from, blanket.valid_to)) {
      throw httpError('due_date is outside the blanket validity window');
    }
    updates.due_date = payload.due_date;
  }
  if (payload.notes !== undefined) updates.notes = cleanText(payload.notes);

  if (!Object.keys(updates).length) throw httpError('No fields to update');

  const { data, error: upErr } = await supabase
    .from('delivery_schedules')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single();

  if (upErr) {
    if (upErr.code === '23505') throw httpError('A schedule already exists for this date', 409);
    throw upErr;
  }

  await recomputeReleasedQty(schedule.blanket_po_line_id);
  const [enriched] = await enrichSchedules([data]);
  return enriched;
}

async function releaseSchedule(id) {
  if (!isValidUUID(id)) throw httpError('Invalid schedule id');

  const { data: schedule, error } = await supabase
    .from('delivery_schedules')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!schedule) throw httpError('Delivery schedule not found', 404);
  if (schedule.status !== 'planned') throw httpError('Only planned schedules can be released');

  const { line } = await getLineWithBlanket(schedule.blanket_po_line_id);

  const bomVersionId = await getActiveBomVersionId(line.master_record_id);
  const afVersionId = await getActiveActivityFlowVersionId(line.master_record_id);

  if (!bomVersionId) {
    throw httpError('Cannot release: component has no active BOM');
  }
  if (!afVersionId) {
    throw httpError('Cannot release: component has no active Activity Flow');
  }

  const { data, error: upErr } = await supabase
    .from('delivery_schedules')
    .update({
      status: 'released',
      bom_version_id: bomVersionId,
      activity_flow_version_id: afVersionId,
    })
    .eq('id', id)
    .select('*')
    .single();

  if (upErr) throw upErr;
  const [enriched] = await enrichSchedules([data]);
  return enriched;
}

async function cancelSchedule(id) {
  if (!isValidUUID(id)) throw httpError('Invalid schedule id');

  const { data: schedule, error } = await supabase
    .from('delivery_schedules')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!schedule) throw httpError('Delivery schedule not found', 404);
  if (schedule.status === 'cancelled') throw httpError('Schedule is already cancelled');
  if (schedule.status === 'released') {
    // allow cancel of released for v1 with note — or block. Plan says cancel adjusts released_qty.
    // Allow cancel of planned and released for flexibility before production exists.
  }

  const { data, error: upErr } = await supabase
    .from('delivery_schedules')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .select('*')
    .single();

  if (upErr) throw upErr;
  await recomputeReleasedQty(schedule.blanket_po_line_id);
  const [enriched] = await enrichSchedules([data]);
  return enriched;
}

module.exports = {
  listBlankets,
  getBlanketById,
  createBlanket,
  updateBlanket,
  setBlanketStatus,
  addLine,
  updateLine,
  deleteLine,
  listRules,
  createRule,
  updateRule,
  activateRule,
  deactivateRule,
  listRuleDates,
  setRuleDates,
  listSchedules,
  createOneOffSchedule,
  generateFromRule,
  previewMatchingDates,
  updateSchedule,
  releaseSchedule,
  cancelSchedule,
  getLineWithBlanket,
  nextDocumentNumber,
  getActiveBomVersionId,
  getActiveActivityFlowVersionId,
  todayDateString,
  matchingDates,
};
