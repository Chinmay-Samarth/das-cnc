import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api/client';

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
            <th>RM ID</th>
            <th>RM Code</th>
            <th>Grade</th>
            <th>Inventory No.</th>
            <th>Unit</th>
            <th>Qty</th>
            <th>Unit Rate</th>
            <th>Amount</th>
            <th>GST %</th>
            <th>GST Amt</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr key={item.id}>
              <td>{idx + 1}</td>
              <td>{item.raw_material_label || '—'}</td>
              <td><strong>{item.rm_code || '—'}</strong></td>
              <td>{item.grade || '—'}</td>
              <td>{item.inventory_number || '—'}</td>
              <td>{item.unit || '—'}</td>
              <td>{item.quantity}</td>
              <td>₹{fmt(item.unit_rate)}</td>
              <td>₹{fmt(item.amount)}</td>
              <td>{item.vat_percentage || 0}%</td>
              <td>₹{fmt(item.vat_amount)}</td>
              <td><strong>₹{fmt(item.total_amount)}</strong></td>
            </tr>
          ))}
          <tr>
            <td colSpan={11} style={{ textAlign: 'right', fontWeight: 700, paddingRight: 16 }}>
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
const DEFAULT_CHECKPOINTS = [
  { checkpoint: 'Dimensional Check', standard: '', passed: false, inspector_note: '' },
  { checkpoint: 'Visual Inspection', standard: '', passed: false, inspector_note: '' },
  { checkpoint: 'Material Grade Verification', standard: '', passed: false, inspector_note: '' },
];

function ItemInspectionPanel({ item, isPending, onSave }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const existingLogs = item.inspection_logs || [];
  const initCheckpoints =
    existingLogs.length > 0
      ? existingLogs.map((l) => ({
          checkpoint: l.checkpoint,
          standard: l.standard || '',
          passed: l.passed,
          inspector_note: l.inspector_note || '',
        }))
      : DEFAULT_CHECKPOINTS.map((cp) => ({ ...cp }));

  const [checkpoints, setCheckpoints] = useState(initCheckpoints);

  const updateCheckpoint = (idx, field, value) => {
    setCheckpoints((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const addCheckpoint = () =>
    setCheckpoints((prev) => [
      ...prev,
      { checkpoint: '', standard: '', passed: false, inspector_note: '' },
    ]);

  const removeCheckpoint = (idx) =>
    setCheckpoints((prev) => prev.filter((_, i) => i !== idx));

  const allPassed = checkpoints.length > 0 && checkpoints.every((c) => c.passed);
  const someResults = checkpoints.length > 0;

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(item.id, checkpoints);
    } catch (err) {
      setSaveError(err.response?.data?.error || 'Unable to save inspection.');
    } finally {
      setSaving(false);
    }
  }

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontWeight: 600 }}>
            {item.raw_material_label || item.rm_code || `Item ${item.id}`}
          </span>
          {item.grade ? (
            <span className="table-subtext">{item.grade}</span>
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
          <div className="attendance-table-wrap">
            <table className="attendance-table">
              <thead>
                <tr>
                  <th>Checkpoint</th>
                  <th>Standard</th>
                  <th>Passed</th>
                  <th>Inspector Note</th>
                  {isPending ? <th></th> : null}
                </tr>
              </thead>
              <tbody>
                {checkpoints.map((cp, idx) => (
                  <tr key={idx}>
                    <td>
                      {isPending ? (
                        <input
                          type="text"
                          value={cp.checkpoint}
                          onChange={(e) => updateCheckpoint(idx, 'checkpoint', e.target.value)}
                          style={{ width: '100%' }}
                        />
                      ) : (
                        cp.checkpoint
                      )}
                    </td>
                    <td>
                      {isPending ? (
                        <input
                          type="text"
                          value={cp.standard}
                          onChange={(e) => updateCheckpoint(idx, 'standard', e.target.value)}
                          style={{ width: '100%' }}
                        />
                      ) : (
                        cp.standard || '—'
                      )}
                    </td>
                    <td>
                      {isPending ? (
                        <input
                          type="checkbox"
                          checked={cp.passed}
                          onChange={(e) => updateCheckpoint(idx, 'passed', e.target.checked)}
                        />
                      ) : (
                        <span
                          style={{
                            fontWeight: 700,
                            color: cp.passed ? '#16a34a' : '#dc2626',
                          }}
                        >
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
                    {isPending ? (
                      <td>
                        <button
                          type="button"
                          className="secondary-button"
                          style={{ fontSize: 11, padding: '2px 8px' }}
                          onClick={() => removeCheckpoint(idx)}
                        >
                          ✕
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {isPending ? (
            <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="button" className="secondary-button" onClick={addCheckpoint}>
                + Add Checkpoint
              </button>
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

  if (!isPending && girn.status !== 'approved' && girn.status !== 'rejected') {
    return (
      <p className="muted">
        Inspection is available after the GIRN is submitted for inspection.
      </p>
    );
  }

  if (items.length === 0) {
    return <p className="muted">No items to inspect.</p>;
  }

  return (
    <div>
      {!isPending ? (
        <p className="muted" style={{ marginBottom: 16 }}>
          This GIRN has been {girn.status}. Inspection records are shown below (read-only).
        </p>
      ) : (
        <p className="muted" style={{ marginBottom: 16 }}>
          Fill in inspection checkpoints for each item and save. Approve or reject from the Overview tab.
        </p>
      )}
      {items.map((item) => (
        <ItemInspectionPanel
          key={item.id}
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

  async function handleSaveInspection(itemId, checkpoints) {
    await api.post(`/girn/${id}/items/${itemId}/inspect`, { checkpoints });
    await loadGirn();
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
