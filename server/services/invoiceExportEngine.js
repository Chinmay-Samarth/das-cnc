/**
 * Vendor AP invoice list/export helpers.
 * Excel column layout is a placeholder until the official format is provided.
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
  suppliers(name)
`;

const EXPORT_SELECT = `
  ${LIST_SELECT},
  line_items,
  tax_items
`;

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

function toExcelDate(value) {
  if (value == null || value === '') return null;
  const str = String(value).slice(0, 10);
  const match = ISO_DATE_RE.exec(str);
  if (!match) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function toNumberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toJsonCell(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function styleHeaderRow(sheet) {
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E3A8A' },
  };
  header.alignment = { vertical: 'middle', horizontal: 'left' };
  header.height = 22;
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

  sheet.columns = [
    { header: 'Invoice number', key: 'invoice_number', width: 22 },
    { header: 'Invoice date', key: 'invoice_date', width: 14 },
    { header: 'Due date', key: 'due_date', width: 14 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Vendor', key: 'vendor', width: 28 },
    { header: 'Base amount', key: 'base_amount', width: 14 },
    { header: 'Tax amount', key: 'tax_amount', width: 14 },
    { header: 'Total amount', key: 'total_amount', width: 14 },
    { header: 'Customer GSTIN', key: 'customer_gstin', width: 20 },
    { header: 'IRN', key: 'irn', width: 28 },
    { header: 'Supplier id', key: 'supplier_id', width: 38 },
    { header: 'Invoice id', key: 'invoice_id', width: 38 },
    { header: 'Created at', key: 'created_at', width: 20 },
    { header: 'Line items', key: 'line_items', width: 40 },
    { header: 'Tax items', key: 'tax_items', width: 40 },
  ];

  styleHeaderRow(sheet);

  for (const invoice of invoices) {
    sheet.addRow({
      invoice_number: invoice.invoice_number || '',
      invoice_date: toExcelDate(invoice.invoice_date),
      due_date: toExcelDate(invoice.due_date),
      status: invoice.status || '',
      vendor: invoice.suppliers?.name || '',
      base_amount: toNumberOrNull(invoice.base_amount),
      tax_amount: toNumberOrNull(invoice.tax_amount),
      total_amount: toNumberOrNull(invoice.total_amount),
      customer_gstin: invoice.customer_GSTIN || '',
      irn: invoice.IRN || '',
      supplier_id: invoice.supplier_id || '',
      invoice_id: invoice.id || '',
      created_at: toExcelDate(invoice.created_at),
      line_items: toJsonCell(invoice.line_items),
      tax_items: toJsonCell(invoice.tax_items),
    });
  }

  sheet.getColumn('invoice_date').numFmt = 'DD-MM-YYYY';
  sheet.getColumn('due_date').numFmt = 'DD-MM-YYYY';
  sheet.getColumn('created_at').numFmt = 'DD-MM-YYYY HH:MM';
  sheet.getColumn('base_amount').numFmt = '#,##0.00';
  sheet.getColumn('tax_amount').numFmt = '#,##0.00';
  sheet.getColumn('total_amount').numFmt = '#,##0.00';

  sheet.getColumn('line_items').alignment = { wrapText: true, vertical: 'top' };
  sheet.getColumn('tax_items').alignment = { wrapText: true, vertical: 'top' };

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
