const { classifyLineItems } = require('./girnItemClassifier');
const { supplierPayloadFromInvoice } = require('./girnSupplierEngine');
const { getCategoryConfig } = require('../config/girnCategoryConfig');

function toNumber(value) {
  const number = parseFloat(value);
  return Number.isFinite(number) ? number : 0;
}

function inferRmId(description = '') {
  const match = String(description).match(/\b\d{3,}\b/);
  return match ? match[0] : '';
}

function normalizeOcrGirnItems(lineItems = [], taxItems = []) {
  const rawDefaultVat = toNumber(taxItems[0]?.rate);
  let defaultVat = rawDefaultVat;
  if (defaultVat > 0 && defaultVat <= 1) {
    defaultVat = defaultVat * 100;
  }

  return lineItems.map((item) => {
    const description = item.scanned_description || item.description || '';
    const quantity = toNumber(item.quantity);
    const unitRate = toNumber(item.unit_price);
    const fallbackTotal = toNumber(item.total);
    const amount = quantity && unitRate ? quantity * unitRate : fallbackTotal;
    const vatPercentage = defaultVat || 0;
    const vatAmount = amount * (vatPercentage / 100);
    const totalAmount = amount + vatAmount;

    return {
      raw_material_id: null,
      raw_material_label: '',
      rm_id: inferRmId(description),
      rm_code: description,
      grade: '',
      inventory_number: '',
      unit: item.unit || '',
      quantity,
      unit_rate: unitRate,
      amount,
      vat_percentage: vatPercentage,
      vat_amount: vatAmount,
      total_amount: totalAmount,
      item_category: item.item_category,
      master_record_id: item.master_record_id,
      master_record_label: item.master_record_label,
      match_confidence: item.match_confidence,
    };
  });
}

async function buildDraftGirnFromInvoice(invoice, employeeId) {
  const supplierFields = supplierPayloadFromInvoice(invoice);
  const baseItems = normalizeOcrGirnItems(invoice.line_items || [], invoice.tax_items || []);
  const supplierId = invoice.supplier_id || supplierFields.supplier_id || null;

  const classifications = await classifyLineItems(
    baseItems.map((item) => ({
      ...item,
      description: item.rm_code || item.item_description || '',
    })),
    { supplierId }
  );

  const items = baseItems.map((item, idx) => {
    const cls = classifications[idx] || {};
    const fromInvoice = invoice.line_items?.[idx] || {};
    const category = fromInvoice.item_category || cls.item_category || 'other';
    const cfg = getCategoryConfig(category);

    return {
      ...item,
      item_category: category,
      master_record_id: fromInvoice.master_record_id || cls.master_record_id || null,
      master_record_label: fromInvoice.master_record_label || cls.master_record_label || '',
      item_code: cls.item_code || item.rm_id || '',
      item_description: fromInvoice.scanned_description || cls.item_description || item.rm_code || '',
      quantity_type: cls.quantity_type || cfg.quantityType,
      match_confidence: fromInvoice.match_confidence || cls.match_confidence || 'none',
    };
  });

  const grandTotal = items.reduce((sum, item) => sum + toNumber(item.total_amount), 0);

  return {
    invoice_id: invoice.id,
    supplier_id: supplierId || '',
    supplier_name: supplierFields.name || invoice.suppliers?.name || '',
    supplier_gstin: supplierFields.GSTIN || invoice.suppliers?.GSTIN || '',
    supplier_state: supplierFields.state || invoice.suppliers?.state || '',
    supplier_billing_address: supplierFields.billing_address || invoice.suppliers?.billing_address || '',
    received_by: employeeId || '',
    po_reference: invoice.invoice_number || '',
    received_date: invoice.invoice_date || new Date().toISOString().slice(0, 10),
    csr: '',
    notes: invoice.invoice_number ? `Generated from invoice ${invoice.invoice_number}` : 'Generated from scanned invoice',
    grand_total: grandTotal || toNumber(invoice.total_amount),
    items,
  };
}

module.exports = {
  buildDraftGirnFromInvoice,
  normalizeOcrGirnItems,
};
