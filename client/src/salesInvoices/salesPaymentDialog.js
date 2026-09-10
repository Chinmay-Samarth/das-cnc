import api from '../api/client';
import { appAlert, appForm } from '../components/dialog';
import { formatDisplayDate } from '../utils/dateFormat';
import { formatInr } from './downloadSalesInvoicePdf';

function todayInputValue() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Purchase-style payment dialog for one or many sales invoices.
 * @returns {Promise<object|null>} API response data, or null if cancelled
 */
export async function openSalesPaymentDialog({
  customerId,
  customerName,
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
        'Set ledger name on the customer before recording payment (Tally sync is enabled).'
      );
      return null;
    }
  }

  let outstandingLine = '';
  if (tallyEnabled && customerId) {
    try {
      const { data } = await api.get(
        `/sales-invoices/tally/customer-outstanding/${customerId}`
      );
      if (data?.outstanding != null) {
        outstandingLine = `\nOwes (Tally): ₹${formatInr(data.outstanding)}`;
      } else if (data?.error) {
        outstandingLine = `\nTally outstanding unavailable: ${data.error}`;
      }
    } catch (err) {
      outstandingLine = `\nTally outstanding unavailable: ${
        err.response?.data?.error || err.message || 'error'
      }`;
    }
  }

  let bankOptions = [];
  if (tallyEnabled) {
    try {
      const { data } = await api.get('/sales-invoices/tally/bank-ledgers');
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
      label: 'Sales invoices (Tally Agst Ref)',
      type: 'checklist',
      required: true,
      defaultValue: [],
      options: list.map((inv) => {
        const number = inv.invoice_number || inv.id;
        const due = inv.due_date ? ` · Due ${formatDisplayDate(inv.due_date)}` : '';
        return {
          value: inv.id,
          label: `${number}${due}`,
          amount: Number(inv.total_amount || 0),
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
    message = `${customerName || 'Customer'} · ${list.length} due invoice(s) available.\nSelect which invoices to clear on the Tally receipt (Agst Ref).${outstandingLine}`;
  } else {
    const total = list.reduce((s, inv) => s + Number(inv.total_amount || 0), 0);
    const invoiceLabels = list
      .map((inv) => inv.invoice_number || inv.id)
      .slice(0, 6)
      .join(', ');
    const more = list.length > 6 ? ` +${list.length - 6} more` : '';
    message = `${customerName || 'Customer'} · ${list.length} invoice(s): ${invoiceLabels}${more}\nAmount: ₹${formatInr(total)}${outstandingLine}`;
  }

  const values = await appForm({
    title: mode === 'bulk' || list.length > 1 || selectInvoices ? 'Record bulk payment' : 'Record payment',
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
      await appAlert('Select at least one sales invoice to pay');
      return null;
    }
  }

  const total = payList.reduce((s, inv) => s + Number(inv.total_amount || 0), 0);
  const payload = {
    paid_at: values.paid_at,
    transaction_id: String(values.transaction_id || '').trim(),
    bank_ledger: values.bank_ledger ? String(values.bank_ledger).trim() : undefined,
    amount: total,
  };

  if (mode === 'bulk' || payList.length > 1 || (selectInvoices && payList.length > 1)) {
    const { data } = await api.post('/sales-invoices/bulk-payments', {
      customer_id: customerId,
      invoice_ids: payList.map((inv) => inv.id),
      ...payload,
    });
    return data;
  }

  const { data } = await api.post(`/sales-invoices/${payList[0].id}/payments`, payload);
  return data;
}
