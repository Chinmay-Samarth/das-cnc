/**
 * Apply mapped invoice line rates onto RM commercials + rate history.
 * Never throws into callers (log + swallow at call site preferred).
 */

const { createClient } = require('@supabase/supabase-js');
const { ensureNotification } = require('./notificationStore');
const { loadCommercialSourcesForRecords } = require('./masterFieldEngine');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const MASTER_SLUG = 'raw-material';
const RATE_EPSILON = 0.0001;

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function deriveTaxGst(taxItems = []) {
  const items = Array.isArray(taxItems) ? taxItems : [];
  const igst = items.find((t) => String(t.kind || '').toUpperCase() === 'IGST' && t.rate != null);
  if (igst) return toNumber(igst.rate);

  const cgst = items.find((t) => String(t.kind || '').toUpperCase() === 'CGST' && t.rate != null);
  const sgst = items.find((t) => String(t.kind || '').toUpperCase() === 'SGST' && t.rate != null);
  if (cgst || sgst) {
    return round2((toNumber(cgst?.rate) || 0) + (toNumber(sgst?.rate) || 0));
  }

  const gst = items.find((t) => String(t.kind || '').toUpperCase() === 'GST' && t.rate != null);
  return gst ? toNumber(gst.rate) : null;
}

async function getCommercialMeta() {
  const { data: master, error: mErr } = await supabase
    .from('masters')
    .select('id')
    .eq('slug', MASTER_SLUG)
    .maybeSingle();
  if (mErr) throw mErr;
  if (!master?.id) return null;

  const { data: section, error: sErr } = await supabase
    .from('master_sections')
    .select('id')
    .eq('master_id', master.id)
    .eq('slug', 'commercials')
    .maybeSingle();
  if (sErr) throw sErr;
  if (!section?.id) return null;

  const { data: fields, error: fErr } = await supabase
    .from('section_fields')
    .select('id, slug, field_type')
    .eq('section_id', section.id)
    .in('slug', ['source', 'rate', 'tax_gst']);
  if (fErr) throw fErr;

  const bySlug = Object.fromEntries((fields || []).map((f) => [f.slug, f]));
  if (!bySlug.source || !bySlug.rate) return null;

  return { sectionId: section.id, fields: bySlug };
}

async function upsertCommercialRow({
  masterRecordId,
  supplierId,
  rate,
  taxGst,
  meta,
}) {
  const { data: rows, error } = await supabase
    .from('record_section_rows')
    .select(
      `
      id, row_order,
      record_section_values (
        id, field_id, value, linked_record_id,
        section_fields ( slug )
      )
    `
    )
    .eq('section_id', meta.sectionId)
    .eq('record_id', masterRecordId)
    .order('row_order');
  if (error) throw error;

  let existingRow = null;
  let previousRate = null;

  for (const row of rows || []) {
    const cells = row.record_section_values || [];
    const sourceCell = cells.find((c) => c.section_fields?.slug === 'source');
    const sid = sourceCell?.linked_record_id || sourceCell?.value;
    if (String(sid || '') === String(supplierId)) {
      existingRow = row;
      const rateCell = cells.find((c) => c.section_fields?.slug === 'rate');
      previousRate = toNumber(rateCell?.value);
      break;
    }
  }

  if (existingRow) {
    const cells = existingRow.record_section_values || [];
    const rateCell = cells.find((c) => c.section_fields?.slug === 'rate');
    const taxCell = cells.find((c) => c.section_fields?.slug === 'tax_gst');

    if (rateCell?.id) {
      const { error: upErr } = await supabase
        .from('record_section_values')
        .update({ value: String(rate) })
        .eq('id', rateCell.id);
      if (upErr) throw upErr;
    } else {
      const { error: insErr } = await supabase.from('record_section_values').insert({
        row_id: existingRow.id,
        field_id: meta.fields.rate.id,
        value: String(rate),
      });
      if (insErr) throw insErr;
    }

    if (taxGst != null && meta.fields.tax_gst) {
      if (taxCell?.id) {
        const { error: upTax } = await supabase
          .from('record_section_values')
          .update({ value: String(taxGst) })
          .eq('id', taxCell.id);
        if (upTax) throw upTax;
      } else {
        const { error: insTax } = await supabase.from('record_section_values').insert({
          row_id: existingRow.id,
          field_id: meta.fields.tax_gst.id,
          value: String(taxGst),
        });
        if (insTax) throw insTax;
      }
    }

    return { previousRate, created: false };
  }

  const nextOrder =
    (rows || []).reduce((max, r) => Math.max(max, Number(r.row_order) || 0), -1) + 1;

  const { data: newRow, error: rowErr } = await supabase
    .from('record_section_rows')
    .insert({
      record_id: masterRecordId,
      section_id: meta.sectionId,
      row_order: nextOrder,
    })
    .select('id')
    .single();
  if (rowErr) throw rowErr;

  // Supplier master is legacy — store UUID in value (not linked_record_id FK to master_records)
  const inserts = [
    {
      row_id: newRow.id,
      field_id: meta.fields.source.id,
      linked_record_id: null,
      value: String(supplierId),
    },
    {
      row_id: newRow.id,
      field_id: meta.fields.rate.id,
      value: String(rate),
    },
  ];
  if (taxGst != null && meta.fields.tax_gst) {
    inserts.push({
      row_id: newRow.id,
      field_id: meta.fields.tax_gst.id,
      value: String(taxGst),
    });
  }

  const { error: cellErr } = await supabase.from('record_section_values').insert(inserts);
  if (cellErr) throw cellErr;

  return { previousRate: null, created: true };
}

async function insertHistoryRow(row) {
  if (row.invoice_id != null && row.line_index != null) {
    const { data: existing, error: exErr } = await supabase
      .from('rm_rate_history')
      .select('id')
      .eq('invoice_id', row.invoice_id)
      .eq('line_index', row.line_index)
      .maybeSingle();
    if (exErr) throw exErr;
    if (existing?.id) {
      const { error: upErr } = await supabase
        .from('rm_rate_history')
        .update({
          master_record_id: row.master_record_id,
          supplier_id: row.supplier_id,
          rate: row.rate,
          tax_gst: row.tax_gst,
          quantity: row.quantity,
          observed_at: row.observed_at,
          previous_rate: row.previous_rate,
        })
        .eq('id', existing.id);
      if (upErr) throw upErr;
      return { skipped: false, updated: true };
    }
  }

  const { error } = await supabase.from('rm_rate_history').insert({
    master_record_id: row.master_record_id,
    supplier_id: row.supplier_id,
    rate: row.rate,
    tax_gst: row.tax_gst,
    quantity: row.quantity,
    invoice_id: row.invoice_id,
    line_index: row.line_index,
    observed_at: row.observed_at,
    previous_rate: row.previous_rate,
  });
  if (error) {
    if (String(error.code) === '23505') return { skipped: true };
    throw error;
  }
  return { skipped: false, updated: false };
}

async function maybeNotifyRateIncrease({
  masterRecordId,
  supplierId,
  rate,
  previousRate,
  invoice,
  line,
  taxGst,
}) {
  if (previousRate == null || !(rate > previousRate + RATE_EPSILON)) return;

  const supplierName = invoice?.suppliers?.name || invoice?.supplier_name || 'Supplier';
  const rmLabel =
    line.master_record_label ||
    line.description ||
    line.scanned_description ||
    masterRecordId;
  const invoiceNumber = invoice?.invoice_number || invoice?.id;

  await ensureNotification({
    audience: 'admin',
    category: 'finance',
    severity: 'warning',
    priority: 2,
    type: 'rm_rate_increase',
    title: 'Raw material rate increased',
    body: `${supplierName}: ${rmLabel} ${round2(previousRate)} → ${round2(rate)}`,
    employee_id: null,
    dedupe_key: `rm_rate_increase:${masterRecordId}:${supplierId}:${invoice?.id || 'x'}:${round2(rate)}`,
    payload: {
      master_record_id: masterRecordId,
      master_slug: MASTER_SLUG,
      supplier_id: supplierId,
      supplier_name: supplierName,
      invoice_id: invoice?.id || null,
      invoice_number: invoiceNumber,
      previous_rate: previousRate,
      new_rate: rate,
      tax_gst: taxGst,
      href: `/masters/${MASTER_SLUG}/records/${masterRecordId}?tab=commercials`,
    },
  });
}

/**
 * @param {{ invoice: object, lines?: object[] }} args
 */
async function applyInvoiceLineRates({ invoice, lines }) {
  const supplierId = invoice?.supplier_id;
  if (!supplierId) return { applied: 0 };

  const meta = await getCommercialMeta();
  if (!meta) return { applied: 0 };

  const taxGst = deriveTaxGst(invoice.tax_items);
  const observedAt = invoice.invoice_date
    ? new Date(`${String(invoice.invoice_date).slice(0, 10)}T12:00:00.000Z`).toISOString()
    : new Date().toISOString();

  const workLines = Array.isArray(lines) ? lines : invoice.line_items || [];
  let applied = 0;

  for (let index = 0; index < workLines.length; index += 1) {
    const line = workLines[index];
    if (line?.master_slug && line.master_slug !== MASTER_SLUG) continue;
    if (line?.item_category && line.item_category !== 'raw_material') continue;

    const masterRecordId = line?.master_record_id;
    const rate = toNumber(line?.unit_price);
    if (!masterRecordId || rate == null || rate < 0) continue;

    const { previousRate } = await upsertCommercialRow({
      masterRecordId,
      supplierId,
      rate,
      taxGst,
      meta,
    });

    await insertHistoryRow({
      master_record_id: masterRecordId,
      supplier_id: supplierId,
      rate,
      tax_gst: taxGst,
      quantity: toNumber(line.quantity),
      invoice_id: invoice.id,
      line_index: index,
      observed_at: observedAt,
      previous_rate: previousRate,
    });

    await maybeNotifyRateIncrease({
      masterRecordId,
      supplierId,
      rate,
      previousRate,
      invoice,
      line,
      taxGst,
    });

    applied += 1;
  }

  return { applied };
}

async function listRateHistoryForRecord(masterRecordId, { limit = 200 } = {}) {
  const capped = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const { data, error } = await supabase
    .from('rm_rate_history')
    .select(
      `
      id, master_record_id, supplier_id, rate, tax_gst, quantity,
      invoice_id, line_index, observed_at, previous_rate,
      suppliers ( id, name )
    `
    )
    .eq('master_record_id', masterRecordId)
    .order('observed_at', { ascending: true })
    .limit(capped);
  if (error) throw error;

  return (data || []).map((row) => ({
    id: row.id,
    master_record_id: row.master_record_id,
    supplier_id: row.supplier_id,
    supplier_name: row.suppliers?.name || null,
    rate: toNumber(row.rate),
    tax_gst: toNumber(row.tax_gst),
    quantity: toNumber(row.quantity),
    invoice_id: row.invoice_id,
    line_index: row.line_index,
    observed_at: row.observed_at,
    previous_rate: toNumber(row.previous_rate),
  }));
}

async function listCurrentCommercialRates(masterRecordId) {
  const byRecord = await loadCommercialSourcesForRecords([masterRecordId], MASTER_SLUG);
  const rows = byRecord[masterRecordId] || [];
  if (!rows.length) return [];

  const supplierIds = rows.map((r) => r.supplier_id);
  const { data: suppliers, error } = await supabase
    .from('suppliers')
    .select('id, name')
    .in('id', supplierIds);
  if (error) throw error;
  const nameById = Object.fromEntries((suppliers || []).map((s) => [s.id, s.name]));

  return rows.map((r) => ({
    supplier_id: r.supplier_id,
    supplier_name: nameById[r.supplier_id] || null,
    rate: r.rate,
    tax_gst: r.tax_gst,
  }));
}

module.exports = {
  applyInvoiceLineRates,
  listRateHistoryForRecord,
  listCurrentCommercialRates,
  deriveTaxGst,
};
