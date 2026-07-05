import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api/client';
import { getCategoryConfig, requiresInspection } from './girnCategoryConfig';

const fmt = (val) =>
  val == null || isNaN(Number(val))
    ? '—'
    : Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS_LABELS = {
  draft: 'Draft',
  pending_inspection: 'Pending Inspection',
  approved: 'Approved',
  rejected: 'Rejected',
};

const STATUS_STYLES = {
  draft: { background: '#f3f4f6', color: '#374151' },
  pending_inspection: { background: '#fef9c3', color: '#854d0e' },
  approved: { background: '#dcfce7', color: '#166534' },
  rejected: { background: '#fee2e2', color: '#991b1b' },
};

function StatusBadge({ status }) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.draft;
  return (
    <span
      style={{
        ...style,
        padding: '3px 12px',
        borderRadius: 99,
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      {STATUS_LABELS[status] || status}
    </span>
  );
}

function DetailItem({ label, value }) {
  return (
    <div>
      <p className="component-detail-label">{label}</p>
      <p className="component-detail-value">{value || '—'}</p>
    </div>
  );
}

// ─── Overview Tab ──────────────────────────────────────────────────────────────
function OverviewTab({ girn, onAction, actionLoading }) {
  const [rejectNotes, setRejectNotes] = useState('');
  const [showReject, setShowReject] = useState(false);

  const isDraft = girn.status === 'draft';
  const isPending = girn.status === 'pending_inspection';
  const isFinished = girn.status === 'approved' || girn.status === 'rejected';

  return (
    <div>
      <div
        className="employee-detail-grid"
        style={{ marginBottom: 20 }}
      >
        <DetailItem label="GIRN Number" value={girn.girn_number} />
        <DetailItem label="Supplier" value={girn.supplier_name} />
        <DetailItem label="Received Date" value={girn.received_date} />
        <DetailItem
          label="Received By"
          value={
            girn.received_by_name
              ? `${girn.received_by_name}${girn.received_by_code ? ` (${girn.received_by_code})` : ''}`
              : null
          }
        />
        <DetailItem label="PO Reference" value={girn.po_reference} />
        <div>
          <p className="component-detail-label">Source Invoice</p>
          {girn.invoice_id ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <button
                type="button"
                className="secondary-button"
                style={{ width: 'fit-content', padding: '4px 10px' }}
                onClick={() => window.open(`/invoices/${girn.invoice_id}`, '_blank')}
              >
                {girn.invoice_number || 'Open invoice'}
              </button>
              {girn.invoice_file_url ? (
                <a href={girn.invoice_file_url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                  View scan
                </a>
              ) : null}
            </div>
          ) : (
            <p className="component-detail-value">—</p>
          )}
        </div>
        <DetailItem label="CSR" value={girn.csr} />
        <DetailItem label="Grand Total" value={`₹${fmt(girn.grand_total)}`} />
        <div>
          <p className="component-detail-label">Status</p>
          <StatusBadge status={girn.status} />
        </div>
        {girn.notes ? <DetailItem label="Notes" value={girn.notes} /> : null}
      </div>

      {!isFinished ? (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
          {isDraft ? (
            <>
              <button
                type="button"
                className="primary-button"
                disabled={actionLoading}
                onClick={() => onAction('submit')}
              >
                {actionLoading ? 'Submitting...' : 'Submit for Inspection'}
              </button>
            </>
          ) : null}

          {isPending ? (
            <>
              <button
                type="button"
                className="primary-button"
                disabled={actionLoading}
                onClick={() => onAction('approve')}
              >
                {actionLoading ? 'Approving...' : 'Approve'}
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={actionLoading}
                onClick={() => setShowReject((v) => !v)}
              >
                Reject
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {showReject ? (
        <div
          style={{
            marginTop: 16,
            padding: 16,
            border: '1px solid #fca5a5',
            borderRadius: 8,
            background: '#fff7f7',
          }}
        >
          <label style={{ fontWeight: 600, marginBottom: 8, display: 'block' }}>
            Rejection reason (optional)
          </label>
          <textarea
            rows={3}
            value={rejectNotes}
            onChange={(e) => setRejectNotes(e.target.value)}
            placeholder="Describe why this GIRN is being rejected..."
            style={{ marginBottom: 12 }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="primary-button"
              style={{ background: '#dc2626' }}
              disabled={actionLoading}
              onClick={() => onAction('reject', { notes: rejectNotes })}
            >
              {actionLoading ? 'Rejecting...' : 'Confirm Reject'}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setShowReject(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── Items Tab ─────────────────────────────────────────────────────────────────
function ItemsTab({ items }) {
  const grandTotal = items.reduce((sum, i) => sum + (parseFloat(i.total_amount) || 0), 0);

  return (
    <div className="employees-table-wrap">
      <table className="employees-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Category</th>
            <th>Item</th>
            <th>Code</th>
            <th>LOT</th>
            <th>OK / NG</th>
            <th>Unit</th>
            <th>Qty</th>
            <th>Unit Rate</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => {
            const cfg = getCategoryConfig(item.item_category || 'raw_material');
            return (
            <tr key={item.id}>
              <td>{idx + 1}</td>
              <td>{cfg.label}</td>
              <td>{item.master_record_label || item.raw_material_label || item.item_description || '—'}</td>
              <td><strong>{item.item_code || item.rm_code || '—'}</strong></td>
              <td>{item.lot_number || '—'}</td>
              <td>
                {item.item_category === 'gauge'
                  ? `${item.quantity_ok ?? '—'} / ${item.quantity_not_ok ?? '—'}`
                  : '—'}
              </td>
              <td>{item.unit || (cfg.quantityType === 'kg' ? 'kg' : 'nos')}</td>
              <td>{item.quantity}</td>
              <td>₹{fmt(item.unit_rate)}</td>
              <td><strong>₹{fmt(item.total_amount)}</strong></td>
            </tr>
            );
          })}
          <tr>
            <td colSpan={9} style={{ textAlign: 'right', fontWeight: 700, paddingRight: 16 }}>
              Grand Total
            </td>
            <td><strong>₹{fmt(grandTotal)}</strong></td>
          </tr>
        </tbody>
      </table>

      {items.length === 0 ? (
        <p className="muted" style={{ padding: '12px 0' }}>No items recorded.</p>
      ) : null}
    </div>
  );
}

// ─── Inspection Tab ────────────────────────────────────────────────────────────
function ItemInspectionPanel({ girnId, item, isPending, onSave }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [lotNumber, setLotNumber] = useState(item.lot_number || '');

  const category = item.item_category || 'raw_material';
  const cfg = getCategoryConfig(category);

  const [checkpoints, setCheckpoints] = useState([]);
  const [quantityOk, setQuantityOk] = useState(item.quantity_ok ?? item.quantity ?? '');
  const [quantityNotOk, setQuantityNotOk] = useState(item.quantity_not_ok ?? '');

  useEffect(() => {
    if (!open || !girnId || !item.id) return undefined;

    let cancelled = false;
    setLoadingTemplate(true);
    setLoadError(null);

    api.get(`/girn/${girnId}/items/${item.id}/inspection-template`)
      .then(({ data }) => {
        if (cancelled) return;
        setCheckpoints(data.checkpoints || []);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Inspection template load error:', err);
        setLoadError(err.response?.data?.error || 'Unable to load inspection fields from master.');
        setCheckpoints([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingTemplate(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, girnId, item.id]);

  const updateCheckpoint = (idx, field, value) => {
    setCheckpoints((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const allPassed = checkpoints.length > 0 && checkpoints.every((c) => c.passed);
  const someResults = checkpoints.length > 0;

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const payload = { checkpoints };
      if (category === 'gauge') {
        payload.quantity_ok = parseFloat(quantityOk) || 0;
        payload.quantity_not_ok = parseFloat(quantityNotOk) || 0;
      }
      const { data } = await onSave(item.id, payload);
      if (data?.lot_number) {
        setLotNumber(data.lot_number);
      }
    } catch (err) {
      setSaveError(err.response?.data?.error || 'Unable to save inspection.');
    } finally {
      setSaving(false);
    }
  }

  const itemLabel = item.master_record_label || item.raw_material_label || item.item_description || item.item_code || `Item ${item.id}`;

  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        marginBottom: 12,
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          background: '#f9fafb',
          border: 'none',
          padding: '12px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600 }}>{itemLabel}</span>
          <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 99, background: '#e0e7ff', color: '#3730a3' }}>
            {cfg.label}
          </span>
          {lotNumber ? (
            <span style={{ fontSize: 12, fontWeight: 600, color: '#166534' }}>LOT: {lotNumber}</span>
          ) : null}
          {someResults ? (
            <span
              style={{
                padding: '2px 8px',
                borderRadius: 99,
                fontSize: 11,
                fontWeight: 600,
                background: allPassed ? '#dcfce7' : '#fef9c3',
                color: allPassed ? '#166534' : '#854d0e',
              }}
            >
              {allPassed ? 'All Passed' : 'Incomplete'}
            </span>
          ) : null}
        </div>
        <span>{open ? '▲' : '▼'}</span>
      </button>

      {open ? (
        <div style={{ padding: 16 }}>
          {loadingTemplate ? (
            <p className="muted">Loading inspection fields from master...</p>
          ) : null}
          {loadError ? (
            <p className="error-message" style={{ marginBottom: 12 }}>{loadError}</p>
          ) : null}
          {!loadingTemplate && !loadError && checkpoints.length === 0 ? (
            <p className="muted">
              No inspection section found on this item&apos;s master record. Add an &quot;Inspection&quot; section with fields in the master schema.
            </p>
          ) : null}

          {category === 'gauge' && isPending ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
              <label>
                OK Qty
                <input type="number" min="0" value={quantityOk} onChange={(e) => setQuantityOk(e.target.value)} />
              </label>
              <label>
                Not OK Qty
                <input type="number" min="0" value={quantityNotOk} onChange={(e) => setQuantityNotOk(e.target.value)} />
              </label>
              <div>
                <p className="component-detail-label">Received</p>
                <p className="component-detail-value">{item.quantity}</p>
              </div>
            </div>
          ) : null}

          <div className="attendance-table-wrap">
            <table className="attendance-table">
              <thead>
                <tr>
                  <th>Checkpoint</th>
                  <th>Standard</th>
                  <th>Passed</th>
                  <th>Inspector Note</th>
                </tr>
              </thead>
              <tbody>
                {checkpoints.map((cp, idx) => (
                  <tr key={idx}>
                    <td>{cp.checkpoint}</td>
                    <td>{cp.standard || '—'}</td>
                    <td>
                      {isPending ? (
                        <input
                          type="checkbox"
                          checked={cp.passed}
                          onChange={(e) => updateCheckpoint(idx, 'passed', e.target.checked)}
                        />
                      ) : (
                        <span style={{ fontWeight: 700, color: cp.passed ? '#16a34a' : '#dc2626' }}>
                          {cp.passed ? 'Pass' : 'Fail'}
                        </span>
                      )}
                    </td>
                    <td>
                      {isPending ? (
                        <input
                          type="text"
                          value={cp.inspector_note}
                          onChange={(e) => updateCheckpoint(idx, 'inspector_note', e.target.value)}
                          style={{ width: '100%' }}
                        />
                      ) : (
                        cp.inspector_note || '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {isPending ? (
            <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                className="primary-button"
                disabled={saving}
                onClick={handleSave}
              >
                {saving ? 'Saving...' : 'Save Inspection'}
              </button>
              {saveError ? <span className="error-message" style={{ fontSize: 13 }}>{saveError}</span> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function InspectionTab({ girn, items, onSaveInspection }) {
  const isPending = girn.status === 'pending_inspection';
  const inspectableItems = items.filter((item) => requiresInspection(item.item_category || 'raw_material'));

  if (!isPending && girn.status !== 'approved' && girn.status !== 'rejected') {
    return (
      <p className="muted">
        Inspection is available after the GIRN is submitted for inspection.
      </p>
    );
  }

  if (inspectableItems.length === 0) {
    return <p className="muted">No items require inspection on this GIRN.</p>;
  }

  return (
    <div>
      {!isPending ? (
        <p className="muted" style={{ marginBottom: 16 }}>
          This GIRN has been {girn.status}. Inspection records are shown below (read-only).
        </p>
      ) : (
        <p className="muted" style={{ marginBottom: 16 }}>
          Complete inspection using the fields defined in each item&apos;s master inspection section. Oil and Others lines are excluded.
        </p>
      )}
      {inspectableItems.map((item) => (
        <ItemInspectionPanel
          key={item.id}
          girnId={girn.id}
          item={item}
          isPending={isPending}
          onSave={onSaveInspection}
        />
      ))}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function GIRNDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [girn, setGirn] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('overview');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState(null);

  async function loadGirn() {
    try {
      setLoading(true);
      setError(null);
      const { data } = await api.get(`/girn/${id}`);
      setGirn(data.girn);
    } catch (err) {
      console.error('GIRN detail error:', err);
      setError(err.response?.data?.error || 'Unable to load GIRN.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadGirn(); }, [id]);

  async function handleAction(type, payload = {}) {
    setActionLoading(true);
    setActionError(null);
    try {
      await api.post(`/girn/${id}/${type}`, payload);
      await loadGirn();
    } catch (err) {
      console.error(`GIRN ${type} error:`, err);
      setActionError(err.response?.data?.error || `Unable to ${type} GIRN.`);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSaveInspection(itemId, payload) {
    const { data } = await api.post(`/girn/${id}/items/${itemId}/inspect`, payload);
    await loadGirn();
    return { data };
  }

  const items = girn?.items || [];

  return (
    <main className="app-shell employee-details-page masters-page component-details-page">
      <header className="app-header">
        <div className="header-title-block">
          <p className="eyebrow">Procurement</p>
          <h1>{girn ? girn.girn_number : 'GIRN Detail'}</h1>
          {girn ? (
            <p className="muted">{girn.supplier_name} · {girn.received_date}</p>
          ) : null}
        </div>
      </header>

      <section className="card form-card">
        {/* Tabs */}
        <div
          className="tab-row"
          style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}
        >
          {['overview', 'items', 'inspection'].map((t) => (
            <button
              key={t}
              type="button"
              className={tab === t ? 'primary-button' : 'secondary-button'}
              onClick={() => setTab(t)}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
              {t === 'items' && items.length > 0 ? (
                <span className="count-chip" style={{ marginLeft: 6 }}>
                  {items.length}
                </span>
              ) : null}
            </button>
          ))}
          <button
            type="button"
            className="secondary-button"
            onClick={() => navigate('/girn')}
          >
            Back to GIRN list
          </button>
        </div>

        {actionError ? (
          <p className="error-message" style={{ marginBottom: 16 }}>{actionError}</p>
        ) : null}

        {loading ? (
          <p className="muted">Loading GIRN...</p>
        ) : error ? (
          <p className="error-message">{error}</p>
        ) : !girn ? (
          <p className="muted">GIRN not found.</p>
        ) : tab === 'overview' ? (
          <OverviewTab
            girn={girn}
            onAction={handleAction}
            actionLoading={actionLoading}
          />
        ) : tab === 'items' ? (
          <ItemsTab items={items} />
        ) : (
          <InspectionTab
            girn={girn}
            items={items}
            onSaveInspection={handleSaveInspection}
          />
        )}
      </section>
    </main>
  );
}
