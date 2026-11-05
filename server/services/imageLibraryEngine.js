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

function mapPurchaseInvoiceItems(list, supplierNames = {}) {
  const seen = new Set();
  const items = [];
  for (const row of list) {
    if (seen.has(row.id) || !row.file_url) continue;
    seen.add(row.id);
    const item = fileItem({
      kind: 'purchase_invoice',
      kindLabel: 'Purchase invoice',
      id: row.id,
      title: row.invoice_number || 'Purchase invoice',
      subtitle: row.suppliers?.name || supplierNames[row.supplier_id] || '',
      url: row.file_url,
      path: `/invoices/${row.id}`,
    });
    if (item) items.push(item);
  }
  return items;
}

async function searchPurchaseInvoices(pattern) {
  if (!pattern) {
    const result = await supabase
      .from('invoices')
      .select('id, invoice_number, invoice_date, file_url, supplier_id, suppliers(name)')
      .not('file_url', 'is', null)
      .order('created_at', { ascending: false })
      .limit(LIMIT);
    return mapPurchaseInvoiceItems(rows(result, 'purchase invoices'));
  }

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

  return mapPurchaseInvoiceItems(
    [...rows(byNumber, 'purchase invoices'), ...rows(bySupplier, 'purchase invoices by supplier')],
    suppliers.names
  );
}

async function mapPurchaseOrderItems(merged, supplierNames = {}) {
  const names = { ...supplierNames };
  const missingIds = [...new Set(merged.map((row) => row.supplier_id).filter((id) => id && !names[id]))];
  if (missingIds.length) {
    const extra = await supabase.from('suppliers').select('id, name').in('id', missingIds);
    for (const row of rows(extra, 'purchase order suppliers')) {
      names[row.id] = row.name;
    }
  }

  return merged
    .map((row) =>
      fileItem({
        kind: 'purchase_order',
        kindLabel: 'Purchase order',
        id: row.id,
        title: row.po_number || 'Purchase order',
        subtitle: names[row.supplier_id] || '',
        url: row.pdf_url,
        path: `/purchase-orders/${row.id}`,
      })
    )
    .filter(Boolean);
}

async function searchPurchaseOrders(pattern) {
  if (!pattern) {
    const result = await supabase
      .from('purchase_orders')
      .select('id, po_number, pdf_url, supplier_id')
      .not('pdf_url', 'is', null)
      .order('created_at', { ascending: false })
      .limit(LIMIT);
    return mapPurchaseOrderItems(rows(result, 'purchase orders'));
  }

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

  return mapPurchaseOrderItems(merged, suppliers.names);
}

function mapSalesInvoiceItems(list, customerNames = {}) {
  const seen = new Set();
  const items = [];
  for (const row of list) {
    if (seen.has(row.id) || !row.file_url) continue;
    seen.add(row.id);
    const snapshotName = row.customer_snapshot?.name || '';
    const item = fileItem({
      kind: 'sales_invoice',
      kindLabel: 'Sales invoice',
      id: row.id,
      title: row.invoice_number || 'Sales invoice',
      subtitle: customerNames[row.customer_id] || snapshotName,
      url: row.file_url,
      path: `/sales-invoices/${row.id}`,
    });
    if (item) items.push(item);
  }
  return items;
}

async function searchSalesInvoices(pattern) {
  if (!pattern) {
    const result = await supabase
      .from('sales_invoices')
      .select('id, invoice_number, file_url, customer_id, customer_snapshot')
      .not('file_url', 'is', null)
      .order('created_at', { ascending: false })
      .limit(LIMIT);
    return mapSalesInvoiceItems(rows(result, 'sales invoices'));
  }

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

  return mapSalesInvoiceItems(
    [...rows(byNumber, 'sales invoices'), ...rows(byCustomer, 'sales invoices by customer')],
    customers.names
  );
}

function mapEmployeeItems(list) {
  const items = [];
  for (const row of list) {
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

async function searchEmployees(pattern) {
  let query = supabase
    .from('employees')
    .select(
      'id, full_name, employee_code, img_url, aadhar_url, marks_card_url, work_experience_url, thumb_impression_url'
    )
    .order('full_name', { ascending: true })
    .limit(pattern ? LIMIT : LIMIT * 3);

  if (pattern) {
    query = query.or(`full_name.ilike.${pattern},employee_code.ilike.${pattern}`);
  }

  const result = await query;
  const items = mapEmployeeItems(rows(result, 'employees'));
  return pattern ? items : items.slice(0, LIMIT);
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
  let records = [];
  let byId = {};

  if (pattern) {
    const lookup = await supabase
      .from('v_master_lookup')
      .select('record_id, label, master_slug')
      .ilike('label', pattern)
      .order('label', { ascending: true })
      .limit(LIMIT);

    records = rows(lookup, 'masters');
    if (!records.length) return [];
    byId = Object.fromEntries(records.map((row) => [row.record_id, row]));
  }

  const [flatRes, sectionRes] = await Promise.all([
    pattern
      ? supabase
          .from('record_values')
          .select('record_id, file_url, file_urls, section_fields(label)')
          .in(
            'record_id',
            records.map((row) => row.record_id)
          )
      : supabase
          .from('record_values')
          .select('record_id, file_url, file_urls, section_fields(label)')
          .not('file_url', 'is', null)
          .limit(LIMIT),
    pattern
      ? supabase
          .from('record_section_rows')
          .select('record_id, record_section_values(file_url, file_urls, section_fields(label))')
          .in(
            'record_id',
            records.map((row) => row.record_id)
          )
      : supabase
          .from('record_section_rows')
          .select('record_id, record_section_values(file_url, file_urls, section_fields(label))')
          .limit(LIMIT),
  ]);

  const sectionFiles = [];
  for (const row of rows(sectionRes, 'master section files')) {
    for (const value of row.record_section_values || []) {
      if (!pattern && !value.file_url && !(Array.isArray(value.file_urls) && value.file_urls.length)) {
        continue;
      }
      sectionFiles.push({ ...value, record_id: row.record_id });
    }
  }

  const fileRows = [...rows(flatRes, 'master files'), ...sectionFiles];
  if (!pattern) {
    const ids = [...new Set(fileRows.map((row) => row.record_id).filter(Boolean))].slice(0, LIMIT);
    if (ids.length) {
      const lookup = await supabase
        .from('v_master_lookup')
        .select('record_id, label, master_slug')
        .in('record_id', ids);
      byId = Object.fromEntries(rows(lookup, 'masters browse').map((row) => [row.record_id, row]));
    }
  }

  const items = [];
  const seen = new Set();
  for (const row of fileRows) {
    const record = byId[row.record_id] || {
      record_id: row.record_id,
      label: 'Master record',
      master_slug: '',
    };
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
  return items.slice(0, LIMIT);
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
  // Empty / short query = browse recent stored files; 2+ chars = search.
  const pattern = raw.length >= 2 ? `%${escapeIlike(raw)}%` : null;
  const selected = SEARCHERS[kind] ? [SEARCHERS[kind]] : Object.values(SEARCHERS);
  const groups = await Promise.all(selected.map((search) => search(pattern)));
  return groups.flat();
}

module.exports = { searchImageLibrary };
