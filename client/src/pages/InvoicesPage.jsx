import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Receipt, RefreshCw, Trash2, X } from 'lucide-react';
import AddInvoiceButton from '../components/Invoices/AddInvoiceButton';
import api from '../api/client';
import { formatDisplayDate, toISODateString } from '../utils/dateFormat';
import { PageHeader, EmptyState, StatusBadge, AlertBanner } from '../components/mes';
import { appAlert, appConfirm } from '../components/dialog';
import { useAuth } from '../auth/authContext';
import PurchaseOrdersTab from '../procurement/PurchaseOrdersTab';
import FormSearchSelect from '../components/shared/FormSearchSelect';

const STATUS_OPTIONS = [
  { value: 'needs_review', label: 'Needs review' },
  { value: 'due', label: 'Due' },
  { value: 'girn_due', label: 'GIRN due' },
  { value: 'tally_unsynced', label: 'Not Tally synced' },
  { value: 'paid', label: 'Paid' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'extracting', label: 'Extracting' },
  { value: 'saving', label: 'Saving' },
  { value: 'error', label: 'Error' },
];

function todayYmdIst() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function invoiceDisplayStatus(invoice) {
  const raw = invoice?.status || 'pending';
  if (raw === 'cancelled' || invoice?.review_status === 'superseded') return 'cancelled';
  if (raw === 'needs_review' || invoice?.review_status === 'needs_review') return 'needs_review';
  if (raw === 'paid') return 'paid';
  if (raw === 'extracting' || raw === 'saving' || raw === 'error') return raw;
  const due = invoice?.due_date ? String(invoice.due_date).slice(0, 10) : '';
  if (due && due < todayYmdIst()) return 'overdue';
  return 'due';
}

function isConfirmedApInvoice(invoice) {
  const status = invoiceDisplayStatus(invoice);
  return status === 'due' || status === 'overdue' || status === 'paid';
}

function isGirnDue(invoice) {
  return isConfirmedApInvoice(invoice) && !invoice?.has_girn;
}

function isTallyUnsynced(invoice) {
  if (!isConfirmedApInvoice(invoice)) return false;
  return invoice?.tally_sync_status !== 'synced';
}

function matchesStatusFilter(invoice, statusFilter) {
  if (!statusFilter || statusFilter === 'all') return true;
  if (statusFilter === 'girn_due') return isGirnDue(invoice);
  if (statusFilter === 'tally_unsynced') return isTallyUnsynced(invoice);
  return invoiceDisplayStatus(invoice) === statusFilter;
}

function statusLabel(status) {
  if (status === 'needs_review') return 'NEEDS REVIEW';
  if (status === 'cancelled') return 'CANCELLED';
  if (status === 'due') return 'DUE';
  if (status === 'paid') return 'PAID';
  if (status === 'overdue') return 'OVERDUE';
  if (status === 'girn_due') return 'GIRN DUE';
  if (status === 'tally_unsynced') return 'NOT TALLY SYNCED';
  return String(status || 'DUE').replace(/_/g, ' ').toUpperCase();
}

/** Single badge for the list: prefer actionable statuses over plain due/paid. */
function invoicePrimaryBadge(invoice) {
  const displayStatus = invoiceDisplayStatus(invoice);
  if (displayStatus === 'needs_review') {
    return { status: displayStatus, tone: statusTone(displayStatus), label: statusLabel(displayStatus) };
  }
  if (displayStatus === 'error' || displayStatus === 'extracting' || displayStatus === 'saving') {
    return { status: displayStatus, tone: statusTone(displayStatus), label: statusLabel(displayStatus) };
  }
  if (isGirnDue(invoice)) {
    return { status: 'girn_due', tone: 'ready', label: 'GIRN DUE' };
  }
  if (isTallyUnsynced(invoice)) {
    return {
      status: 'tally_unsynced',
      tone: 'on_hold',
      label: `TALLY ${String(invoice.tally_sync_status || 'pending').toUpperCase()}`,
    };
  }
  return { status: displayStatus, tone: statusTone(displayStatus), label: statusLabel(displayStatus) };
}

const fmt = (val) =>
  isNaN(Number(val)) || val == null
    ? '—'
    : Number(val).toLocaleString('en-IN');

/** Prefer base + tax + round_off when stored total drifted (OCR ₹1 gaps). */
function invoiceDisplayTotal(invoice) {
  const base = Number(invoice?.base_amount);
  const tax = Number(invoice?.tax_amount);
  const roundOff = Number(invoice?.round_off) || 0;
  const stored = Number(invoice?.total_amount);
  if (!Number.isFinite(base) || !Number.isFinite(tax)) {
    return Number.isFinite(stored) ? stored : 0;
  }
  const computed = Math.round((base + tax + roundOff) * 100) / 100;
  if (!Number.isFinite(stored) || Math.abs(stored - computed) >= 0.005) return computed;
  return stored;
}

function currentMonthRange() {
  const now = new Date();
  return {
    from: toISODateString(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: toISODateString(now),
  };
}

function statusTone(status) {
  if (status === 'needs_review') return 'running';
  if (status === 'cancelled') return 'pending';
  if (status === 'paid') return 'completed';
  if (status === 'overdue' || status === 'error') return 'overdue';
  if (status === 'extracting' || status === 'saving') return 'running';
  if (status === 'due' || status === 'pending') return 'pending';
  return status || 'pending';
}

import { sortBy } from '../utils/listHelpers';

async function readExportError(err) {
  const data = err.response?.data;
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text());
      return parsed.error || 'Unable to export invoices';
    } catch {
      return 'Unable to export invoices';
    }
  }
  return err.response?.data?.error || err.message || 'Unable to export invoices';
}

export default function InvoicesPage() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [pageTab, setPageTab] = useState('invoices');
  const monthRange = useMemo(() => currentMonthRange(), []);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortKey, setSortKey] = useState('invoice_date');
  const [sortAsc, setSortAsc] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFrom, setExportFrom] = useState(monthRange.from);
  const [exportTo, setExportTo] = useState(monthRange.to);
  const [exporting, setExporting] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [syncingAll, setSyncingAll] = useState(false);

  const exportDateError = useMemo(() => {
    if (!exportOpen) return '';
    if (!exportFrom || !exportTo) return 'Select both a from and to date.';
    if (exportFrom > exportTo) return 'From date must be on or before the to date.';
    return '';
  }, [exportOpen, exportFrom, exportTo]);

  const loadInvoices = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const { data } = await api.get('/invoices/list');
      setInvoices(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load invoices', err);
      setError(err.response?.data?.error || err.message || 'Unable to load invoices');
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  const filteredInvoices = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matches = invoices.filter((invoice) => {
      const displayStatus = invoiceDisplayStatus(invoice);
      // Hide superseded OCR drafts from the default list
      if (displayStatus === 'cancelled' && statusFilter !== 'cancelled') return false;
      if (!matchesStatusFilter(invoice, statusFilter)) return false;
      if (!query) return true;
      return [
        invoice.suppliers?.name,
        invoice.invoice_number,
        invoice.invoice_date,
        invoiceDisplayTotal(invoice),
        invoice.due_date,
        invoice.status,
        invoice.tally_sync_status,
        invoice.girn_number,
        invoice.customer_GSTIN,
      ]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });

    return sortBy(matches, sortKey, sortAsc, (row) => {
      if (sortKey === 'total_amount') return invoiceDisplayTotal(row);
      if (sortKey === 'supplier_name') return row.suppliers?.name ?? row.supplier_name ?? '';
      return row[sortKey] ?? '';
    });
  }, [invoices, search, statusFilter, sortKey, sortAsc]);

  const unsyncedCount = useMemo(
    () => invoices.filter((invoice) => isTallyUnsynced(invoice)).length,
    [invoices]
  );

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortAsc((current) => !current);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const sortMark = (key) =>
    sortKey === key ? (sortAsc ? ' ▲' : ' ▼') : '';

  function openInvoice(item) {
    const displayStatus = invoiceDisplayStatus(item);
    if (displayStatus === 'needs_review') {
      navigate(`/invoices/${item.id}/review`);
      return;
    }
    if (statusFilter === 'girn_due' && isGirnDue(item)) {
      navigate(`/girn/create?invoice_id=${encodeURIComponent(item.id)}&reviewed=1`);
      return;
    }
    navigate(`/invoices/${item.id}`);
  }

  async function handleDeleteNeedsReview(item, event) {
    event.stopPropagation();
    const ok = await appConfirm({
      title: 'Delete invoice draft?',
      message: `Delete ${item.invoice_number || 'this'} unscanned / needs-review invoice? This cannot be undone.`,
      tone: 'danger',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
    });
    if (!ok) return;

    setDeletingId(item.id);
    try {
      await api.post(`/invoices/${item.id}/abandon-review`);
      setInvoices((current) => current.filter((row) => row.id !== item.id));
    } catch (err) {
      await appAlert({
        title: 'Could not delete',
        message: err.response?.data?.error || 'Unable to delete this invoice draft.',
        tone: 'danger',
      });
    } finally {
      setDeletingId(null);
    }
  }

  function toggleExportPanel() {
    if (exportOpen) {
      setExportOpen(false);
      return;
    }
    setExportFrom(monthRange.from);
    setExportTo(monthRange.to);
    setExportOpen(true);
  }

  async function handleSyncAllTally() {
    if (!unsyncedCount || syncingAll) return;
    const ok = await appConfirm({
      title: 'Sync all to Tally?',
      message: `Post Purchase vouchers for ${unsyncedCount} unsynced invoice${
        unsyncedCount === 1 ? '' : 's'
      }. Already synced invoices are skipped. Continue?`,
      confirmLabel: 'Sync all',
      cancelLabel: 'Cancel',
    });
    if (!ok) return;

    setSyncingAll(true);
    try {
      const { data } = await api.post('/invoices/tally/sync-all');
      const synced = Number(data?.synced) || 0;
      const failed = Number(data?.failed) || 0;
      const skipped = Number(data?.skipped) || 0;
      const total = Number(data?.total) || unsyncedCount;
      const failedRows = Array.isArray(data?.results)
        ? data.results.filter((row) => row.status === 'failed').slice(0, 5)
        : [];
      const failDetail = failedRows.length
        ? `\n\nExamples:\n${failedRows
            .map((row) => `• ${row.invoice_number || row.id}: ${row.error || 'failed'}`)
            .join('\n')}`
        : '';

      await appAlert({
        title: failed ? 'Tally sync finished with errors' : 'Tally sync finished',
        message: `Tried ${total}. Synced ${synced}, skipped ${skipped}, failed ${failed}.${failDetail}`,
        tone: failed ? 'danger' : 'success',
      });
      await loadInvoices();
    } catch (err) {
      await appAlert({
        title: 'Tally sync failed',
        message: err.response?.data?.error || err.message || 'Unable to sync invoices to Tally',
        tone: 'danger',
      });
    } finally {
      setSyncingAll(false);
    }
  }

  async function handleExport() {
    if (exportDateError) {
      await appAlert({
        title: 'Choose a date range',
        message: exportDateError,
        tone: 'danger',
      });
      return;
    }

    try {
      setExporting(true);
      const response = await api.get('/invoices/export', {
        params: { from: exportFrom, to: exportTo },
        responseType: 'blob',
      });

      const blob = new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const fileName = `vendor-invoices-${exportFrom}-to-${exportTo}.xlsx`;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
    } catch (err) {
      console.error('Failed to export invoices', err);
      await appAlert({
        title: 'Export failed',
        message: await readExportError(err),
        tone: 'danger',
      });
    } finally {
      setExporting(false);
    }
  }

  const emptyTitle = search.trim() || statusFilter
    ? 'No matching invoices'
    : 'No invoices yet';
  const emptyDescription = search.trim() || statusFilter
    ? 'Try a different search or status filter.'
    : 'Upload a vendor invoice to start the accounts-payable list.';

  return (
    <main className="mes-shell">
      {pageTab === 'purchase-orders' && isAdmin() ? (
        <PurchaseOrdersTab />
      ) : (
        <>
      <PageHeader
        eyebrow="Accounts payable"
        title="Purchase Invoices"
        subtitle={`${filteredInvoices.length} invoice${filteredInvoices.length === 1 ? '' : 's'}`}
        actions={
          <>
            <button
              type="button"
              className="mes-btn mes-btn-secondary"
              onClick={handleSyncAllTally}
              disabled={syncingAll || unsyncedCount === 0}
              title={
                unsyncedCount === 0
                  ? 'All confirmed invoices are already synced'
                  : `Sync ${unsyncedCount} unsynced invoice${unsyncedCount === 1 ? '' : 's'} to Tally`
              }
            >
              <RefreshCw size={15} />
              {syncingAll
                ? 'Syncing…'
                : unsyncedCount > 0
                  ? `Sync all (${unsyncedCount})`
                  : 'Sync all'}
            </button>
            <button
              type="button"
              className={`mes-btn ${exportOpen ? 'primary-button' : 'mes-btn-secondary'}`}
              onClick={toggleExportPanel}
              aria-expanded={exportOpen}
            >
              <Download size={15} />
              Export to Excel
            </button>
            <AddInvoiceButton onUploaded={loadInvoices} />
          </>
        }
      />

      {exportOpen ? (
        <section className="mes-card mes-export-panel" aria-label="Excel export date range">
          <div className="mes-export-panel-copy">
            <p className="mes-eyebrow">Excel export</p>
            <h2 className="mes-export-panel-title">Invoice date range</h2>
          </div>
          <div className="mes-filters mes-export-panel-fields">
            <label>
              From
              <input
                type="date"
                value={exportFrom}
                onChange={(e) => setExportFrom(e.target.value)}
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={exportTo}
                onChange={(e) => setExportTo(e.target.value)}
              />
            </label>
            <div className="mes-export-panel-actions">
              <button
                type="button"
                className="mes-btn mes-btn-secondary"
                onClick={() => setExportOpen(false)}
                disabled={exporting}
              >
                <X size={15} />
                Cancel
              </button>
              <button
                type="button"
                className="mes-btn primary-button"
                onClick={handleExport}
                disabled={exporting || Boolean(exportDateError)}
              >
                <Download size={15} />
                {exporting ? 'Exporting…' : 'Download'}
              </button>
            </div>
          </div>
          {exportDateError ? (
            <p className="muted mes-export-panel-hint">{exportDateError}</p>
          ) : (
            <p className="muted mes-export-panel-hint">
              {formatDisplayDate(exportFrom)} – {formatDisplayDate(exportTo)}
            </p>
          )}
        </section>
      ) : null}

      <div className="mes-filters">
        <label style={{ flex: 1, minWidth: 220 }}>
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Vendor, invoice #, GSTIN…"
            aria-label="Search invoices"
          />
        </label>
        <label>
          Status
          <FormSearchSelect
            value={statusFilter}
            onChange={(value) => setStatusFilter(value || '')}
            options={STATUS_OPTIONS}
            placeholder="All statuses"
            emptyMessage="No statuses"
          />
        </label>
      </div>

      

      {error ? <AlertBanner title="Unable to load invoices">{error}</AlertBanner> : null}
      {loading ? <p className="muted">Loading invoices…</p> : null}

      {!loading && !filteredInvoices.length ? (
        <EmptyState
          icon={Receipt}
          title={emptyTitle}
          description={emptyDescription}
        />
      ) : null}

      {!loading && filteredInvoices.length ? (
        <section className="mes-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="app-table-wrap">
            <table className="app-table">
              <thead>
                <tr>
                  <th onClick={() => handleSort('supplier_name')} style={{ cursor: 'pointer' }}>
                    Vendor
                    <span className="sort-indicator">{sortMark('supplier_name')}</span>
                  </th>
                  <th onClick={() => handleSort('invoice_number')} style={{ cursor: 'pointer' }}>
                    Invoice #
                    <span className="sort-indicator">{sortMark('invoice_number')}</span>
                  </th>
                  <th onClick={() => handleSort('invoice_date')} style={{ cursor: 'pointer' }}>
                    Date
                    <span className="sort-indicator">{sortMark('invoice_date')}</span>
                  </th>
                  <th onClick={() => handleSort('total_amount')} style={{ cursor: 'pointer' }}>
                    Total
                    <span className="sort-indicator">{sortMark('total_amount')}</span>
                  </th>
                  <th>Advance</th>
                  <th onClick={() => handleSort('due_date')} style={{ cursor: 'pointer' }}>
                    Due date
                    <span className="sort-indicator">{sortMark('due_date')}</span>
                  </th>
                  <th onClick={() => handleSort('status')} style={{ cursor: 'pointer' }}>
                    Status
                    <span className="sort-indicator">{sortMark('status')}</span>
                  </th>
                  <th style={{ width: 88 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.map((item) => {
                  const displayStatus = invoiceDisplayStatus(item);
                  const badge = invoicePrimaryBadge(item);
                  const canDeleteDraft =
                    displayStatus === 'needs_review' || displayStatus === 'error';
                  return (
                  <tr
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openInvoice(item)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openInvoice(item);
                      }
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>{item.suppliers?.name || '—'}</td>
                    <td>{item.invoice_number || '—'}</td>
                    <td>{formatDisplayDate(item.invoice_date || item.created_at)}</td>
                    <td>₹{fmt(invoiceDisplayTotal(item))}</td>
                    <td>
                      {Number(item.po_advance_amount) > 0
                        ? `₹${fmt(item.po_advance_amount)}`
                        : '—'}
                    </td>
                    <td>{formatDisplayDate(item.due_date)}</td>
                    <td>
                      <StatusBadge status={badge.tone}>{badge.label}</StatusBadge>
                    </td>
                    <td onClick={(event) => event.stopPropagation()}>
                      {canDeleteDraft ? (
                        <button
                          type="button"
                          className="mes-btn mes-btn-secondary"
                          style={{ padding: '4px 8px' }}
                          title="Delete draft"
                          disabled={deletingId === item.id}
                          onClick={(event) => handleDeleteNeedsReview(item, event)}
                        >
                          <Trash2 size={14} />
                          {deletingId === item.id ? '…' : 'Delete'}
                        </button>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
        </>
      )}
    </main>
  );
}
