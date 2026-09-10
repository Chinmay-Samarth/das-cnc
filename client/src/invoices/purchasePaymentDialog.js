import api from '../api/client';
import { appAlert, appForm } from '../components/dialog';
import { formatDisplayDate } from '../utils/dateFormat';

function formatInr(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function todayInputValue() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function invoiceDueAmount(inv) {
  if (inv?.amount_due != null && Number.isFinite(Number(inv.amount_due))) {
    return Number(inv.amount_due);
  }
  const total = Number(inv?.total_amount || 0);
  const advance = Number(inv?.po_advance_amount || 0);
  return Math.max(total - advance, 0);
}

/**
 * Payment dialog for one or many purchase invoices (Tally Payment / Agst Ref).
 * @returns {Promise<object|null>} API response data, or null if cancelled
 */
export async function openPurchasePaymentDialog({
  supplierId,
  supplierName,
  ledgerName,
  invoices,
  tallyEnabled,
  mode = 'single',
  selectInvoices = false,
}) {
  const list = Array.isArray(invoices) ? invoices.filter(Boolean) : [];
  if (!list.length) {
    await appAlert('No due invoices selected');
    return null;
  }

  if (tallyEnabled) {
    const ledger = String(ledgerName || '').trim();
    if (!ledger) {
      await appAlert(
        'Set ledger name on the supplier before recording payment (Tally sync is enabled).'
      );
      return null;
    }
  }

  let outstandingLine = '';
  if (tallyEnabled && supplierId) {
    try {
      const { data } = await api.get(`/invoices/tally/supplier-outstanding/${supplierId}`);
      if (data?.outstanding != null) {
        outstandingLine = `\nPayable (Tally): ₹${formatInr(data.outstanding)}`;
      } else if (data?.error) {
        outstandingLine = `\nTally payable unavailable: ${data.error}`;
      }
    } catch (err) {
      outstandingLine = `\nTally payable unavailable: ${
        err.response?.data?.error || err.message || 'error'
      }`;
    }
  }

  let bankOptions = [];
  if (tallyEnabled) {
    try {
      const { data } = await api.get('/invoices/tally/bank-ledgers');
      bankOptions = data.bank_ledgers || [];
      if (!bankOptions.length) {
        await appAlert(
          data.error ||
            'No bank ledgers found in Tally. Ensure Bank Accounts exist and Tally is running.'
        );
        return null;
      }
    } catch (err) {
      await appAlert(err.response?.data?.error || 'Unable to load bank ledgers from Tally');
      return null;
    }
  }

  const fields = [];

  if (selectInvoices) {
    fields.push({
      name: 'invoice_ids',
      label: 'Purchase invoices (Tally Agst Ref)',
      type: 'checklist',
      required: true,
      defaultValue: [],
      options: list.map((inv) => {
        const number = inv.invoice_number || inv.id;
        const due = inv.due_date ? ` · Due ${formatDisplayDate(inv.due_date)}` : '';
        return {
          value: inv.id,
          label: `${number}${due}`,
          amount: invoiceDueAmount(inv),
        };
      }),
    });
  }

  fields.push(
    {
      name: 'paid_at',
      label: 'Payment date',
      type: 'date',
      required: true,
      defaultValue: todayInputValue(),
    },
    {
      name: 'transaction_id',
      label: 'Reference (UTR / cheque)',
      type: 'text',
      required: true,
      placeholder: 'UTR / cheque / NEFT ref',
    }
  );

  if (tallyEnabled) {
    fields.push({
      name: 'bank_ledger',
      label: 'Bank ledger',
      type: 'select',
      required: true,
      options: bankOptions.map((name) => ({ value: name, label: name })),
    });
  }

  let message;
  if (selectInvoices) {
    message = `${supplierName || 'Supplier'} · ${list.length} due invoice(s) available.\nSelect which invoices to clear on the Tally payment (Agst Ref).${outstandingLine}`;
  } else {
    const total = list.reduce((s, inv) => s + invoiceDueAmount(inv), 0);
    const invoiceLabels = list
      .map((inv) => inv.invoice_number || inv.id)
      .slice(0, 6)
      .join(', ');
    const more = list.length > 6 ? ` +${list.length - 6} more` : '';
    message = `${supplierName || 'Supplier'} · ${list.length} invoice(s): ${invoiceLabels}${more}\nAmount: ₹${formatInr(total)}${outstandingLine}`;
  }

  const values = await appForm({
    title:
      mode === 'bulk' || list.length > 1 || selectInvoices
        ? 'Record bulk payment'
        : 'Record payment',
    message,
    fields,
    confirmLabel: 'Record payment',
  });
  if (!values) return null;

  let payList = list;
  if (selectInvoices) {
    const selectedIds = new Set(
      (Array.isArray(values.invoice_ids) ? values.invoice_ids : []).map(String)
    );
    payList = list.filter((inv) => selectedIds.has(String(inv.id)));
    if (!payList.length) {
      await appAlert('Select at least one purchase invoice to pay');
      return null;
    }
  }

  const total = payList.reduce((s, inv) => s + invoiceDueAmount(inv), 0);
  const payload = {
    paid_at: values.paid_at,
    transaction_id: String(values.transaction_id || '').trim(),
    bank_ledger: values.bank_ledger ? String(values.bank_ledger).trim() : undefined,
    amount: total,
  };

  if (mode === 'bulk' || payList.length > 1 || (selectInvoices && payList.length > 1)) {
    const { data } = await api.post('/invoices/bulk-payments', {
      supplier_id: supplierId,
      invoice_ids: payList.map((inv) => inv.id),
      ...payload,
    });
    return data;
  }

  const { data } = await api.post(`/invoices/${payList[0].id}/payments`, payload);
  return data;
}

export { formatInr, invoiceDueAmount };
