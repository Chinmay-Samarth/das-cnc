const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function toNumber(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

function ratesMatch(a, b, tolerancePct = 1) {
  const expected = toNumber(a);
  const actual = toNumber(b);
  if (expected === 0 && actual === 0) return true;
  if (expected === 0) return false;
  const diffPct = (Math.abs(actual - expected) / expected) * 100;
  return diffPct <= tolerancePct;
}

async function clearOpenExceptions(poId) {
  await supabase
    .from('purchase_order_match_exceptions')
    .delete()
    .eq('purchase_order_id', poId)
    .eq('resolved', false);
}

async function addException(poId, row) {
  await supabase.from('purchase_order_match_exceptions').insert({
    purchase_order_id: poId,
    purchase_order_line_id: row.lineId || null,
    exception_type: row.type,
    expected_value: row.expected != null ? String(row.expected) : null,
    actual_value: row.actual != null ? String(row.actual) : null,
    source: row.source || null,
    resolved: false,
  });
}

function parseInvoiceLines(invoice) {
  const raw = invoice?.line_items;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : parsed?.items || [];
  } catch {
    return [];
  }
}

async function runThreeWayMatch(poId) {
  const { data: po, error: poErr } = await supabase
    .from('purchase_orders')
    .select('id, status, invoice_id')
    .eq('id', poId)
    .maybeSingle();
  if (poErr) throw poErr;
  if (!po) return { match_status: 'pending', exceptions: [] };

  const { data: lines } = await supabase
    .from('purchase_order_lines')
    .select('*')
    .eq('purchase_order_id', poId)
    .order('line_no');

  const { data: girns } = await supabase
    .from('girns')
    .select('id, status')
    .eq('purchase_order_id', poId)
    .eq('status', 'approved');

  const girnIds = (girns || []).map((g) => g.id);
  let girnItems = [];
  if (girnIds.length) {
    const { data } = await supabase
      .from('girn_items')
      .select('purchase_order_line_id, quantity, unit_rate, master_record_id')
      .in('girn_id', girnIds);
    girnItems = data || [];
  }

  let invoice = null;
  if (po.invoice_id) {
    const { data } = await supabase
      .from('invoices')
      .select('id, line_items, total_amount')
      .eq('id', po.invoice_id)
      .maybeSingle();
    invoice = data;
  }

  await clearOpenExceptions(poId);
  const exceptions = [];

  if (po.status === 'draft') {
    await supabase.from('purchase_orders').update({ match_status: 'pending' }).eq('id', poId);
    return { match_status: 'pending', exceptions: [] };
  }

  for (const line of lines || []) {
    const poQty = toNumber(line.quantity);
    const receivedQty = toNumber(line.received_qty);
    const girnQty = girnItems
      .filter((gi) => gi.purchase_order_line_id === line.id)
      .reduce((s, gi) => s + toNumber(gi.quantity), 0);

    if (po.status !== 'draft' && poQty > 0 && girnIds.length === 0) {
      await addException(poId, {
        lineId: line.id,
        type: 'missing_girn',
        expected: poQty,
        actual: 0,
        source: 'girn',
      });
      exceptions.push({ type: 'missing_girn', line_id: line.id });
    }

    if (Math.abs(poQty - girnQty) > 0.0001 && girnIds.length > 0) {
      await addException(poId, {
        lineId: line.id,
        type: 'qty_po_girn',
        expected: poQty,
        actual: girnQty,
        source: 'girn',
      });
      exceptions.push({ type: 'qty_po_girn', line_id: line.id });
    }

    if (receivedQty >= poQty && poQty > 0 && !invoice) {
      await addException(poId, {
        lineId: line.id,
        type: 'missing_invoice',
        expected: 'invoice linked',
        actual: 'none',
        source: 'invoice',
      });
      exceptions.push({ type: 'missing_invoice', line_id: line.id });
    }
  }

  if (invoice) {
    const invLines = parseInvoiceLines(invoice);
    for (const line of lines || []) {
      const invLine = invLines.find(
        (il) =>
          String(il.master_record_id || il.item_code || '').toLowerCase() ===
            String(line.master_record_id).toLowerCase() ||
          String(il.description || il.item_description || '')
            .toLowerCase()
            .includes(String(line.master_record_id).slice(0, 8))
      );
      const invoicedQty = invLine ? toNumber(invLine.quantity || invLine.qty) : 0;
      const invRate = invLine ? toNumber(invLine.unit_rate || invLine.rate || invLine.price) : 0;

      await supabase
        .from('purchase_order_lines')
        .update({ invoiced_qty: invoicedQty, updated_at: new Date().toISOString() })
        .eq('id', line.id);

      if (invoicedQty > 0 && Math.abs(toNumber(line.received_qty) - invoicedQty) > 0.0001) {
        await addException(poId, {
          lineId: line.id,
          type: 'qty_girn_invoice',
          expected: line.received_qty,
          actual: invoicedQty,
          source: 'invoice',
        });
        exceptions.push({ type: 'qty_girn_invoice', line_id: line.id });
      }

      if (invRate > 0 && line.unit_rate > 0 && !ratesMatch(line.unit_rate, invRate)) {
        await addException(poId, {
          lineId: line.id,
          type: 'rate_po_invoice',
          expected: line.unit_rate,
          actual: invRate,
          source: 'invoice',
        });
        exceptions.push({ type: 'rate_po_invoice', line_id: line.id });
      }
    }
  }

  const matchStatus = exceptions.length ? 'exceptions' : girnIds.length || invoice ? 'matched' : 'pending';
  await supabase
    .from('purchase_orders')
    .update({ match_status: matchStatus, updated_at: new Date().toISOString() })
    .eq('id', poId);

  const { data: exRows } = await supabase
    .from('purchase_order_match_exceptions')
    .select('*')
    .eq('purchase_order_id', poId)
    .eq('resolved', false);

  return { match_status: matchStatus, exceptions: exRows || [] };
}

async function resolveMatchException(poId, exceptionId) {
  const { error } = await supabase
    .from('purchase_order_match_exceptions')
    .update({ resolved: true })
    .eq('id', exceptionId)
    .eq('purchase_order_id', poId);
  if (error) throw error;

  const { data: open } = await supabase
    .from('purchase_order_match_exceptions')
    .select('id')
    .eq('purchase_order_id', poId)
    .eq('resolved', false);
  if (!(open || []).length) {
    await supabase.from('purchase_orders').update({ match_status: 'matched' }).eq('id', poId);
  }
  return runThreeWayMatch(poId);
}

async function hasUnresolvedMatchExceptions(poId) {
  const { data } = await supabase
    .from('purchase_order_match_exceptions')
    .select('id')
    .eq('purchase_order_id', poId)
    .eq('resolved', false)
    .limit(1);
  return (data || []).length > 0;
}

module.exports = {
  runThreeWayMatch,
  resolveMatchException,
  hasUnresolvedMatchExceptions,
};
