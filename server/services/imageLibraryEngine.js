const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const LIMIT = 24;

const EMPLOYEE_FILES = [
  ['img_url', 'Photo'],
  ['aadhar_url', 'Aadhaar'],
  ['marks_card_url', 'Marks card'],
  ['work_experience_url', 'Work experience'],
  ['thumb_impression_url', 'Thumb impression'],
];

function escapeIlike(value) {
  return String(value).replace(/[%_\\]/g, '\\$&');
}

function isImageUrl(url) {
  return /\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(String(url || ''));
}

function rows(result, label) {
  if (result?.error) {
    console.error(`Image library ${label}:`, result.error.message);
    return [];
  }
  return result?.data || [];
}

async function idsByName(table, pattern) {
  const result = await supabase
    .from(table)
    .select('id, name')
    .ilike('name', pattern)
    .limit(40);
  const list = rows(result, table);
  return {
    ids: list.map((row) => row.id),
    names: Object.fromEntries(list.map((row) => [row.id, row.name])),
  };
}

function fileItem({ kind, kindLabel, id, title, subtitle, url, path, fileLabel }) {
  if (!url) return null;
  return {
    id: `${kind}:${id}:${fileLabel || 'file'}`,
    kind,
    kindLabel,
    title,
    subtitle: [subtitle, fileLabel].filter(Boolean).join(' · '),
    url,
    isImage: isImageUrl(url),
    path,
  };
}

async function searchPurchaseInvoices(pattern) {
  const suppliers = await idsByName('suppliers', pattern);
  const [byNumber, bySupplier] = await Promise.all([
    supabase
      .from('invoices')
      .select('id, invoice_number, invoice_date, file_url, supplier_id, suppliers(name)')
      .not('file_url', 'is', null)
      .ilike('invoice_number', pattern)
      .order('created_at', { ascending: false })
      .limit(LIMIT),
    suppliers.ids.length
      ? supabase
          .from('invoices')
          .select('id, invoice_number, invoice_date, file_url, supplier_id, suppliers(name)')
          .not('file_url', 'is', null)
          .in('supplier_id', suppliers.ids)
          .order('created_at', { ascending: false })
          .limit(LIMIT)
      : Promise.resolve({ data: [] }),
  ]);

  const seen = new Set();
  const items = [];
  for (const row of [...rows(byNumber, 'purchase invoices'), ...rows(bySupplier, 'purchase invoices by supplier')]) {
    if (seen.has(row.id) || !row.file_url) continue;
    seen.add(row.id);
    const item = fileItem({
      kind: 'purchase_invoice',
      kindLabel: 'Purchase invoice',
      id: row.id,
      title: row.invoice_number || 'Purchase invoice',
      subtitle: row.suppliers?.name || suppliers.names[row.supplier_id] || '',
      url: row.file_url,
      path: `/invoices/${row.id}`,
    });
    if (item) items.push(item);
  }
  return items;
}

async function searchPurchaseOrders(pattern) {
  const suppliers = await idsByName('suppliers', pattern);
  const [byNumber, bySupplier] = await Promise.all([
    supabase
      .from('purchase_orders')
      .select('id, po_number, pdf_url, supplier_id')
      .not('pdf_url', 'is', null)
      .ilike('po_number', pattern)
      .order('created_at', { ascending: false })
      .limit(LIMIT),
    suppliers.ids.length
      ? supabase
          .from('purchase_orders')
          .select('id, po_number, pdf_url, supplier_id')
          .not('pdf_url', 'is', null)
          .in('supplier_id', suppliers.ids)
          .order('created_at', { ascending: false })
          .limit(LIMIT)
      : Promise.resolve({ data: [] }),
  ]);

  const seen = new Set();
  const merged = [];
  for (const row of [...rows(byNumber, 'purchase orders'), ...rows(bySupplier, 'purchase orders by supplier')]) {
    if (seen.has(row.id) || !row.pdf_url) continue;
    seen.add(row.id);
    merged.push(row);
  }

  const missingIds = [...new Set(merged.map((row) => row.supplier_id).filter((id) => id && !suppliers.names[id]))];
  if (missingIds.length) {
    const extra = await supabase.from('suppliers').select('id, name').in('id', missingIds);
    for (const row of rows(extra, 'purchase order suppliers')) {
      suppliers.names[row.id] = row.name;
    }
  }

  return merged.map((row) => fileItem({
    kind: 'purchase_order',
    kindLabel: 'Purchase order',
    id: row.id,
    title: row.po_number || 'Purchase order',
    subtitle: suppliers.names[row.supplier_id] || '',
    url: row.pdf_url,
    path: `/purchase-orders/${row.id}`,
  })).filter(Boolean);
}

async function searchSalesInvoices(pattern) {
  const customers = await idsByName('customers', pattern);
  const [byNumber, byCustomer] = await Promise.all([
    supabase
      .from('sales_invoices')
      .select('id, invoice_number, file_url, customer_id, customer_snapshot')
      .not('file_url', 'is', null)
      .ilike('invoice_number', pattern)
      .order('created_at', { ascending: false })
      .limit(LIMIT),
    customers.ids.length
      ? supabase
          .from('sales_invoices')
          .select('id, invoice_number, file_url, customer_id, customer_snapshot')
          .not('file_url', 'is', null)
          .in('customer_id', customers.ids)
          .order('created_at', { ascending: false })
          .limit(LIMIT)
      : Promise.resolve({ data: [] }),
  ]);

  const seen = new Set();
  const items = [];
  for (const row of [...rows(byNumber, 'sales invoices'), ...rows(byCustomer, 'sales invoices by customer')]) {
    if (seen.has(row.id) || !row.file_url) continue;
    seen.add(row.id);
    const snapshotName = row.customer_snapshot?.name || '';
    const item = fileItem({
      kind: 'sales_invoice',
      kindLabel: 'Sales invoice',
      id: row.id,
      title: row.invoice_number || 'Sales invoice',
      subtitle: customers.names[row.customer_id] || snapshotName,
      url: row.file_url,
      path: `/sales-invoices/${row.id}`,
    });
    if (item) items.push(item);
  }
  return items;
}

async function searchEmployees(pattern) {
  const result = await supabase
    .from('employees')
    .select(
      'id, full_name, employee_code, img_url, aadhar_url, marks_card_url, work_experience_url, thumb_impression_url'
    )
    .or(`full_name.ilike.${pattern},employee_code.ilike.${pattern}`)
    .order('full_name', { ascending: true })
    .limit(LIMIT);

  const items = [];
  for (const row of rows(result, 'employees')) {
    for (const [column, label] of EMPLOYEE_FILES) {
      const item = fileItem({
        kind: 'employee',
        kindLabel: 'Employee',
        id: row.id,
        title: row.full_name || row.employee_code || 'Employee',
        subtitle: row.employee_code || '',
        fileLabel: label,
        url: row[column],
        path: `/employees/${row.id}`,
      });
      if (item) items.push(item);
    }
  }
  return items;
}

function urlsFromValue(row) {
  const urls = [];
  if (row.file_url) urls.push(row.file_url);
  if (Array.isArray(row.file_urls)) {
    for (const url of row.file_urls) {
      if (url) urls.push(url);
    }
  }
  return urls;
}

async function searchMasters(pattern) {
  const lookup = await supabase
    .from('v_master_lookup')
    .select('record_id, label, master_slug')
    .ilike('label', pattern)
    .order('label', { ascending: true })
    .limit(LIMIT);

  const records = rows(lookup, 'masters');
  if (!records.length) return [];

  const byId = Object.fromEntries(records.map((row) => [row.record_id, row]));
  const ids = records.map((row) => row.record_id);

  const [flatRes, sectionRes] = await Promise.all([
    supabase
      .from('record_values')
      .select('record_id, file_url, file_urls, section_fields(label)')
      .in('record_id', ids),
    supabase
      .from('record_section_rows')
      .select('record_id, record_section_values(file_url, file_urls, section_fields(label))')
      .in('record_id', ids),
  ]);

  const sectionFiles = [];
  for (const row of rows(sectionRes, 'master section files')) {
    for (const value of row.record_section_values || []) {
      sectionFiles.push({ ...value, record_id: row.record_id });
    }
  }

  const items = [];
  const seen = new Set();
  for (const row of [...rows(flatRes, 'master files'), ...sectionFiles]) {
    const record = byId[row.record_id];
    if (!record) continue;
    const fieldLabel = row.section_fields?.label || 'File';
    urlsFromValue(row).forEach((url, index) => {
      const key = `${row.record_id}:${url}`;
      if (seen.has(key)) return;
      seen.add(key);
      const item = fileItem({
        kind: 'master',
        kindLabel: 'Master record',
        id: `${row.record_id}-${index}-${fieldLabel}`,
        title: record.label || 'Master record',
        subtitle: record.master_slug || '',
        fileLabel: fieldLabel,
        url,
        path: record.master_slug
          ? `/masters/${record.master_slug}/records/${row.record_id}`
          : '/masters',
      });
      if (item) items.push(item);
    });
  }
  return items;
}

const SEARCHERS = {
  purchase_invoice: searchPurchaseInvoices,
  purchase_order: searchPurchaseOrders,
  sales_invoice: searchSalesInvoices,
  employee: searchEmployees,
  master: searchMasters,
};

async function searchImageLibrary(rawQuery, kind) {
  const raw = String(rawQuery || '').trim();
  if (raw.length < 2) return [];

  const pattern = `%${escapeIlike(raw)}%`;
  const selected = SEARCHERS[kind] ? [SEARCHERS[kind]] : Object.values(SEARCHERS);
  const groups = await Promise.all(selected.map((search) => search(pattern)));
  return groups.flat();
}

module.exports = { searchImageLibrary };
