/**
 * Vendor AP invoice list/export helpers.
 * Excel layout matches the purchase register (one row per invoice).
 */

const ExcelJS = require('exceljs');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const LIST_SELECT = `
  id,
  invoice_number,
  invoice_date,
  due_date,
  total_amount,
  tax_amount,
  base_amount,
  customer_GSTIN,
  IRN,
  status,
  supplier_id,
  file_url,
  created_at,
  updated_at,
  register_serial,
  credit_period_days,
  paid_at,
  payment_reference,
  payment_deduction,
  payment_remarks,
  suppliers(name, GSTIN)
`;

const EXPORT_SELECT = `
  ${LIST_SELECT},
  line_items,
  tax_items
`;

const FIXED_COLUMNS = [
  { header: 'YY', key: 'yy', width: 8 },
  { header: 'mm', key: 'mm', width: 8 },
  { header: 'SL', key: 'sl', width: 10 },
  { header: 'Rec Dt', key: 'rec_dt', width: 14 },
  { header: 'Party', key: 'party', width: 28 },
  { header: 'Bill No', key: 'bill_no', width: 18 },
  { header: 'Bill Dt', key: 'bill_dt', width: 14 },
  { header: 'Bill Amt', key: 'bill_amt', width: 14 },
  { header: 'GST No', key: 'gst_no', width: 20 },
  { header: 'CP', key: 'cp', width: 8 },
  { header: 'Due Dt', key: 'due_dt', width: 14 },
  { header: 'Pay Date', key: 'pay_date', width: 14 },
  { header: 'REF', key: 'pay_ref', width: 18 },
  { header: 'Deduction', key: 'deduction', width: 12 },
  { header: 'Remarks', key: 'remarks', width: 24 },
  { header: 'Sub Total', key: 'sub_total', width: 14 },
  { header: 'S Cess', key: 's_cess', width: 12 },
  { header: 'Add ED', key: 'add_ed', width: 12 },
  { header: 'IGST', key: 'igst', width: 12 },
  { header: 'CGST/SGST 18%', key: 'cgst_sgst', width: 16 },
  { header: 'PF', key: 'pf', width: 10 },
  { header: 'Service Tax', key: 'service_tax', width: 12 },
  { header: 'Other Tax', key: 'other_tax', width: 12 },
  { header: 'Discount', key: 'discount', width: 12 },
  { header: 'Status', key: 'status', width: 10 },
];

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function parseInvoiceDateRange(from, to, { required = false } = {}) {
  const fromDate = from == null || from === '' ? '' : String(from).trim();
  const toDate = to == null || to === '' ? '' : String(to).trim();

  if (required && (!fromDate || !toDate)) {
    throw httpError('From and to dates are required');
  }
  if (fromDate && !ISO_DATE_RE.test(fromDate)) {
    throw httpError('Invalid from date');
  }
  if (toDate && !ISO_DATE_RE.test(toDate)) {
    throw httpError('Invalid to date');
  }
  if (fromDate && toDate && fromDate > toDate) {
    throw httpError('From date must be on or before to date');
  }

  return {
    from: fromDate || null,
    to: toDate || null,
  };
}

async function listInvoicesByDateRange({ from, to, includeLines = false } = {}) {
  let query = supabase
    .from('invoices')
    .select(includeLines ? EXPORT_SELECT : LIST_SELECT)
    .order('invoice_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (from) query = query.gte('invoice_date', from);
  if (to) query = query.lte('invoice_date', to);

  const { data, error } = await query;
  if (error) throw httpError(error.message, 500);
  return data || [];
}

function toNumberOrNull(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') return null;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function ymdParts(value) {
  if (value == null || value === '') return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return {
      year: value.getUTCFullYear(),
      month: value.getUTCMonth() + 1,
      day: value.getUTCDate(),
    };
  }

  const str = String(value).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if (iso) {
    return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  }
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(str);
  if (dmy) {
    return { year: Number(dmy[3]), month: Number(dmy[2]), day: Number(dmy[1]) };
  }

  const parsed = new Date(str);
  if (Number.isNaN(parsed.getTime())) return null;
  return {
    year: parsed.getUTCFullYear(),
    month: parsed.getUTCMonth() + 1,
    day: parsed.getUTCDate(),
  };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Plain dd-mm-yyyy text — avoids Excel 2007 NaN / unreadable Date cells. */
function toExcelDateText(value) {
  const parts = ymdParts(value);
  if (!parts) return '';
  return `${pad2(parts.day)}-${pad2(parts.month)}-${parts.year}`;
}

function excelSafeText(value) {
  if (value == null) return '';
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .trim();
}

function daysBetweenYmd(from, to) {
  const a = ymdParts(from);
  const b = ymdParts(to);
  if (!a || !b) return null;
  const start = Date.UTC(a.year, a.month - 1, a.day);
  const end = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((end - start) / 86400000);
}

function asLineItems(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function taxRateFraction(rate) {
  const n = Number(rate);
  if (!Number.isFinite(n)) return null;
  return n > 1 ? n / 100 : n;
}

function taxLineAmount(tax) {
  const amount = Number(tax?.amount);
  if (Number.isFinite(amount)) return amount;
  const base = Number(tax?.base);
  const rate = taxRateFraction(tax?.rate);
  if (Number.isFinite(base) && rate != null) return base * rate;
  return 0;
}

function splitTaxItems(taxItems) {
  const items = asLineItems(taxItems);
  let igst = 0;
  let cgstSgst = 0;
  let other = 0;

  const classified = items.map((tax) => {
    const rate = taxRateFraction(tax.rate);
    const amount = taxLineAmount(tax);
    let kind = 'other';
    if (rate != null && Math.abs(rate - 0.09) < 0.015) kind = 'cgst_sgst';
    else if (rate != null && Math.abs(rate - 0.18) < 0.015) kind = 'igst';
    return { kind, amount };
  });

  const nines = classified.filter((t) => t.kind === 'cgst_sgst');
  const eighteens = classified.filter((t) => t.kind === 'igst');
  const rest = classified.filter((t) => t.kind === 'other');

  if (nines.length >= 1) {
    cgstSgst = nines.reduce((sum, t) => sum + t.amount, 0);
  }
  if (eighteens.length === 1 && nines.length === 0) {
    igst = eighteens[0].amount;
  } else if (eighteens.length >= 1) {
    if (nines.length >= 1) {
      other += eighteens.reduce((sum, t) => sum + t.amount, 0);
    } else {
      igst = eighteens.reduce((sum, t) => sum + t.amount, 0);
    }
  }
  other += rest.reduce((sum, t) => sum + t.amount, 0);

  return {
    igst: igst || null,
    cgstSgst: cgstSgst || null,
    other: other || null,
  };
}

function exportStatus(invoice) {
  return invoice.status === 'paid' ? 'PAID' : 'DUE';
}

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function lineItemColumns(maxLines) {
  const cols = [];
  for (let i = 1; i <= maxLines; i += 1) {
    cols.push(
      { header: `MATERIAL ${i}`, key: `material_${i}`, width: 28 },
      { header: `QTY ${i}`, key: `qty_${i}`, width: 10 },
      { header: `UNIT ${i}`, key: `unit_${i}`, width: 10 },
      { header: `RATE ${i}`, key: `rate_${i}`, width: 12 },
      { header: `GRN ${i}`, key: `grn_${i}`, width: 18 }
    );
  }
  return cols;
}

async function loadGirnByInvoiceIds(invoiceIds) {
  if (!invoiceIds.length) return new Map();
  const { data, error } = await supabase
    .from('girns')
    .select('id, girn_number, invoice_id, girn_items(item_description, rm_code, unit)')
    .in('invoice_id', invoiceIds);

  if (error) {
    const fallback = await supabase
      .from('girns')
      .select('id, girn_number, invoice_id')
      .in('invoice_id', invoiceIds);
    if (fallback.error) throw httpError(fallback.error.message, 500);
    const map = new Map();
    for (const girn of fallback.data || []) {
      if (!girn.invoice_id) continue;
      const existing = map.get(girn.invoice_id) || [];
      existing.push({ ...girn, girn_items: [] });
      map.set(girn.invoice_id, existing);
    }
    return map;
  }

  const map = new Map();
  for (const girn of data || []) {
    if (!girn.invoice_id) continue;
    const existing = map.get(girn.invoice_id) || [];
    existing.push(girn);
    map.set(girn.invoice_id, existing);
  }
  return map;
}

function unitForLine(line, girns) {
  if (line.unit) return line.unit;
  const key = normalizeKey(line.description);
  if (!key) return '';
  for (const girn of girns) {
    for (const item of girn.girn_items || []) {
      const desc = normalizeKey(item.item_description || item.rm_code);
      if (desc && desc === key && item.unit) return item.unit;
    }
  }
  return '';
}

function styleHeaderRow(sheet) {
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E3A8A' },
  };
  header.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  header.height = 28;
}

function fallbackSerials(invoices) {
  const groups = new Map();
  for (const invoice of invoices) {
    const parts = ymdParts(invoice.created_at) || ymdParts(invoice.invoice_date);
    const key = parts ? `${parts.year}-${String(parts.month).padStart(2, '0')}` : 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(invoice);
  }

  const assigned = new Map();
  for (const rows of groups.values()) {
    rows.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
    rows.forEach((invoice, index) => {
      if (invoice.register_serial) {
        assigned.set(invoice.id, invoice.register_serial);
      } else {
        assigned.set(invoice.id, `A${String(index + 1).padStart(2, '0')}`);
      }
    });
  }
  return assigned;
}

async function buildVendorInvoiceWorkbook(invoices, { from, to } = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'DasCNC';
  workbook.created = new Date();
  workbook.description = from && to
    ? `Vendor invoices ${from} to ${to}`
    : 'Vendor invoices';

  const sheet = workbook.addWorksheet('Invoices', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  const lineCounts = invoices.map((inv) => asLineItems(inv.line_items).length);
  const maxLines = lineCounts.length ? Math.max(0, ...lineCounts) : 0;
  sheet.columns = [...FIXED_COLUMNS, ...lineItemColumns(maxLines)];
  styleHeaderRow(sheet);

  const girnMap = await loadGirnByInvoiceIds(invoices.map((inv) => inv.id).filter(Boolean));
  const serials = fallbackSerials(invoices);

  const moneyKeys = [
    'bill_amt',
    'deduction',
    'sub_total',
    's_cess',
    'add_ed',
    'igst',
    'cgst_sgst',
    'pf',
    'service_tax',
    'other_tax',
    'discount',
  ];

  for (const invoice of invoices) {
    const billParts = ymdParts(invoice.invoice_date) || ymdParts(invoice.created_at);
    const taxes = splitTaxItems(invoice.tax_items);
    const lines = asLineItems(invoice.line_items);
    const girns = girnMap.get(invoice.id) || [];
    const girnNumber = excelSafeText(girns[0]?.girn_number || '');
    const creditPeriod =
      invoice.credit_period_days != null && invoice.credit_period_days !== ''
        ? Number(invoice.credit_period_days)
        : daysBetweenYmd(invoice.invoice_date, invoice.due_date);

    const row = {
      yy: billParts ? String(billParts.year).slice(-2) : '',
      mm: billParts ? pad2(billParts.month) : '',
      sl: excelSafeText(serials.get(invoice.id) || invoice.register_serial || ''),
      rec_dt: toExcelDateText(invoice.created_at),
      party: excelSafeText(invoice.suppliers?.name),
      bill_no: excelSafeText(invoice.invoice_number),
      bill_dt: toExcelDateText(invoice.invoice_date),
      bill_amt: toNumberOrNull(invoice.total_amount),
      gst_no: excelSafeText(invoice.suppliers?.GSTIN),
      cp: Number.isFinite(creditPeriod) ? creditPeriod : null,
      due_dt: toExcelDateText(invoice.due_date),
      pay_date: toExcelDateText(invoice.paid_at),
      pay_ref: excelSafeText(invoice.payment_reference),
      deduction: toNumberOrNull(invoice.payment_deduction),
      remarks: excelSafeText(invoice.payment_remarks),
      sub_total: toNumberOrNull(invoice.base_amount),
      s_cess: null,
      add_ed: null,
      igst: toNumberOrNull(taxes.igst),
      cgst_sgst: toNumberOrNull(taxes.cgstSgst),
      pf: null,
      service_tax: null,
      other_tax: toNumberOrNull(taxes.other),
      discount: null,
      status: exportStatus(invoice),
    };

    for (let i = 0; i < maxLines; i += 1) {
      const line = lines[i] || {};
      const n = i + 1;
      row[`material_${n}`] = excelSafeText(line.description);
      row[`qty_${n}`] = toNumberOrNull(line.quantity);
      row[`unit_${n}`] = excelSafeText(unitForLine(line, girns));
      row[`rate_${n}`] = toNumberOrNull(line.unit_price);
      row[`grn_${n}`] = lines[i] ? girnNumber : '';
    }

    sheet.addRow(row);
  }

  for (const key of moneyKeys) {
    const col = sheet.getColumn(key);
    if (col) col.numFmt = '#,##0.00';
  }
  for (let i = 1; i <= maxLines; i += 1) {
    const qtyCol = sheet.getColumn(`qty_${i}`);
    const rateCol = sheet.getColumn(`rate_${i}`);
    if (qtyCol) qtyCol.numFmt = '#,##0.00';
    if (rateCol) rateCol.numFmt = '#,##0.00';
  }

  return workbook;
}

async function exportVendorInvoicesExcel({ from, to } = {}) {
  const range = parseInvoiceDateRange(from, to, { required: true });
  const invoices = await listInvoicesByDateRange({
    ...range,
    includeLines: true,
  });

  if (!invoices.length) {
    throw httpError('No invoices found in this date range', 404);
  }

  const workbook = await buildVendorInvoiceWorkbook(invoices, range);
  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `vendor-invoices-${range.from}-to-${range.to}.xlsx`;

  return { buffer: Buffer.from(buffer), filename, count: invoices.length };
}

module.exports = {
  parseInvoiceDateRange,
  listInvoicesByDateRange,
  buildVendorInvoiceWorkbook,
  exportVendorInvoicesExcel,
};
