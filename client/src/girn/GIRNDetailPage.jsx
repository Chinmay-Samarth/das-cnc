import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import api from '../api/client';
import { useSocket } from '../socket/socketContext';
import { getCategoryConfig, requiresInspection } from './girnCategoryConfig';
import { formatDisplayDate } from '../utils/dateFormat';

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
      <p className="employee-detail-label">{label}</p>
      <p className="employee-detail-value">{value || '—'}</p>
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
        className="girn-detail-grid"
        style={{ marginBottom: 20 }}
      >
        <DetailItem label="GIRN Number" value={girn.girn_number} />
        <DetailItem label="Supplier" value={girn.supplier_name} />
        <DetailItem label="Received Date" value={formatDisplayDate(girn.received_date)} />
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
                className="neutral-button"
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
                className="cancel-button"
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
              className="cancel-button"
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
      <table className="app-table">
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
          <tr className='total-row'>
            <td colSpan={9} style={{ textAlign: 'right', fontWeight: 700, paddingRight: 16 }}>
              Grand Total
            </td>
            <td>₹{fmt(grandTotal)}</td>
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
function ItemInspectionPanel({ girnId, item, isPending, onSave, initialInspection }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [lotNumber, setLotNumber] = useState(item.lot_number || '');

  const category = item.item_category || 'raw_material';
  const cfg = getCategoryConfig(category);

  const [plan, setPlan] = useState(null);
  const [sampleSize, setSampleSize] = useState(null);
  const [execution, setExecution] = useState(initialInspection || null);
  const [valueInputs, setValueInputs] = useState({});
  const [docFiles, setDocFiles] = useState({});
  const [docVerified, setDocVerified] = useState({});
  const [quantityOk, setQuantityOk] = useState(item.quantity_ok ?? item.quantity ?? '');
  const [quantityNotOk, setQuantityNotOk] = useState(item.quantity_not_ok ?? '');

  const submitted = Boolean(execution);

  useEffect(() => {
    if (!open || !girnId || !item.id) return undefined;

    let cancelled = false;
    setLoadingPlan(true);
    setLoadError(null);

    api.get(`/girn/${girnId}/items/${item.id}/inspection`)
      .then(({ data }) => {
        if (cancelled) return;
        setPlan(data.plan);
        setSampleSize(data.sample_size);
        setExecution(data.execution || initialInspection || null);

        const inputs = {};
        for (const param of data.plan?.parameters || []) {
          const saved = data.execution?.values?.find((v) => v.plan_parameter_id === param.id);
          inputs[param.id] = {
            measured_value: saved?.measured_value ?? '',
            result: saved?.result ?? (param.check_type === 'dimensional' ? '' : 'pass'),
            remarks: saved?.remarks ?? '',
          };
        }
        setValueInputs(inputs);

        const verified = {};
        for (const doc of data.plan?.documents || []) {
          const saved = data.execution?.documents?.find((d) => d.document_type === doc.document_type);
          verified[doc.document_type] = saved?.verified ?? false;
        }
        setDocVerified(verified);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Inspection load error:', err);
        setLoadError(err.response?.data?.error || 'Unable to load inspection plan.');
      })
      .finally(() => {
        if (!cancelled) setLoadingPlan(false);
      });

    return () => { cancelled = true; };
  }, [open, girnId, item.id, initialInspection]);

  function updateValue(paramId, field, value) {
    setValueInputs((prev) => ({
      ...prev,
      [paramId]: { ...prev[paramId], [field]: value },
    }));
  }

  async function handleSubmit() {
    setSaving(true);
    setSaveError(null);
    try {
      const formData = new FormData();
      const values = (plan?.parameters || []).map((param) => ({
        plan_parameter_id: param.id,
        measured_value: valueInputs[param.id]?.measured_value === ''
          ? null
          : parseFloat(valueInputs[param.id]?.measured_value),
        result: valueInputs[param.id]?.result || 'fail',
        remarks: valueInputs[param.id]?.remarks || null,
      }));
      formData.append('values', JSON.stringify(values));
      formData.append('documents', JSON.stringify(docVerified));

      if (category === 'gauge') {
        formData.append('quantity_ok', parseFloat(quantityOk) || 0);
        formData.append('quantity_not_ok', parseFloat(quantityNotOk) || 0);
      }

      for (const [docType, file] of Object.entries(docFiles)) {
        if (file) formData.append(`doc_${docType}`, file);
      }

      const { data } = await onSave(item.id, formData);
      if (data?.execution) setExecution(data.execution);
      if (data?.lot_number) setLotNumber(data.lot_number);
    } catch (err) {
      setSaveError(err.response?.data?.error || 'Unable to submit inspection.');
    } finally {
      setSaving(false);
    }
  }

  const itemLabel = item.master_record_label || item.raw_material_label || item.item_description || item.item_code || `Item ${item.id}`;
  const resultLabel = execution?.overall_result;
  const resultColor = resultLabel === 'pass' ? '#166534' : resultLabel === 'fail' ? '#991b1b' : '#854d0e';

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 12, overflow: 'hidden' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%', background: '#f9fafb', border: 'none', padding: '12px 16px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      
          
          <div className="" style={{display: 'flex', flexDirection: 'column', gap: '10px'}}>
            <div className="" style={{display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px'}}>
              <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 99, background: '#e0e7ff', color: '#3730a3' }}>
                {cfg.label}
              </span>
              <p style={{ fontWeight: 600, color: 'blue', fontSize: '20px'}}>{itemLabel}</p>
            </div>
          {lotNumber ? (
            <span style={{ fontSize: 12, fontWeight: 600, color: '#166534' }}>LOT: {lotNumber}</span>
          ) : null}
          </div>
          {resultLabel ? (
            <span style={{ padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600, color: resultColor, background: '#f3f4f6', marginLeft: 'auto' }}>
              {resultLabel.toUpperCase()}
            </span>
          ) : null}
        </div>
        <span>{open ? '▲' : '▼'}</span>
      </button>

      {open ? (
        <div style={{ padding: 16 }}>
          {loadingPlan ? <p className="muted">Loading inspection plan...</p> : null}
          {loadError ? <p className="error-message" style={{ marginBottom: 12 }}>{loadError}</p> : null}

          {!loadingPlan && !loadError && plan ? (
            <>
              <div style={{ display: 'grid', gap: 16, marginBottom: 16, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', whiteSpace: 'wrap' }}>
                <div>
                  <p className="employee-detail-label">Plan</p>
                  <p className="employee-detail-value">{plan.plan_code} (rev {plan.revision})</p>
                </div>
                <div>
                  <p className="employee-detail-label">Lot Qty</p>
                  <p className="employee-detail-value">{item.quantity}</p>
                </div>
                <div>
                  <p className="employee-detail-label">Sample Size</p>
                  <p className="employee-detail-value">{sampleSize ?? '—'}</p>
                </div>
              </div>

              {category === 'gauge' && isPending && !submitted ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
                  <label>
                    OK Qty
                    <input type="number" min="0" value={quantityOk} onChange={(e) => setQuantityOk(e.target.value)} />
                  </label>
                  <label>
                    Not OK Qty
                    <input type="number" min="0" value={quantityNotOk} onChange={(e) => setQuantityNotOk(e.target.value)} />
                  </label>
                </div>
              ) : null}

              <div className="employee-table-wrap" style={{ marginBottom: 16 }}>
                <table className="app-table">
                  <thead>
                    <tr>
                      <th>Parameter</th>
                      <th>Type</th>
                      <th>Spec</th>
                      <th>Measured</th>
                      <th>Result</th>
                      <th>Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(plan.parameters || []).map((param) => {
                      const spec = param.check_type === 'dimensional'
                        ? `${param.nominal_value ?? '—'} ${param.unit || ''} (+${param.tol_plus ?? 0}/-${param.tol_minus ?? 0})`
                        : param.instrument_required || '—';
                      const input = valueInputs[param.id] || {};
                      return (
                        <tr key={param.id}>
                          <td>{param.parameter_name}{param.is_mandatory ? ' *' : ''}</td>
                          <td>{param.check_type}</td>
                          <td>{spec}</td>
                          <td>
                            {param.check_type === 'dimensional' ? (
                              submitted ? (input.measured_value ?? '—') : (
                                <input
                                  type="number"
                                  value={input.measured_value}
                                  onChange={(e) => updateValue(param.id, 'measured_value', e.target.value)}
                                  style={{ width: 80 }}
                                />
                              )
                            ) : '—'}
                          </td>
                          <td>
                            {submitted || param.check_type === 'dimensional' ? (
                              <span style={{ fontWeight: 600, color: input.result === 'pass' ? '#16a34a' : '#dc2626' }}>
                                {(input.result || '—').toUpperCase()}
                              </span>
                            ) : (
                              <select
                                value={input.result || 'pass'}
                                onChange={(e) => updateValue(param.id, 'result', e.target.value)}
                              >
                                <option value="pass">Pass</option>
                                <option value="fail">Fail</option>
                                <option value="na">N/A</option>
                              </select>
                            )}
                          </td>
                          <td>
                            {submitted ? (input.remarks || '—') : (
                              <input
                                type="text"
                                value={input.remarks || ''}
                                onChange={(e) => updateValue(param.id, 'remarks', e.target.value)}
                                style={{ width: '100%' }}
                              />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {(plan.documents || []).length > 0 ? (
                <div style={{ marginBottom: 16 }}>
                  <h4 style={{ margin: '0 0 8px' }}>Documents</h4>
                  {(plan.documents || []).map((doc) => {
                    const saved = execution?.documents?.find((d) => d.document_type === doc.document_type);
                    return (
                      <div key={doc.document_type} style={{ marginBottom: 10, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ minWidth: 140, fontWeight: 500 }}>
                          {doc.document_type}{doc.is_mandatory ? ' *' : ''}
                        </span>
                        {submitted ? (
                          saved ? (
                            <a href={saved.file_url} target="_blank" rel="noopener noreferrer">View file</a>
                          ) : '—'
                        ) : (
                          <>
                            <input
                              type="file"
                              onChange={(e) => setDocFiles((prev) => ({ ...prev, [doc.document_type]: e.target.files?.[0] || null }))}
                            />
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <input
                                type="checkbox"
                                checked={docVerified[doc.document_type] || false}
                                onChange={(e) => setDocVerified((prev) => ({ ...prev, [doc.document_type]: e.target.checked }))}
                              />
                              Verified
                            </label>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {isPending && !submitted ? (
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button type="button" className="primary-button" disabled={saving} onClick={handleSubmit}>
                    {saving ? 'Submitting...' : 'Submit Inspection'}
                  </button>
                  {saveError ? <span className="error-message" style={{ fontSize: 13 }}>{saveError}</span> : null}
                </div>
              ) : null}
            </>
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
          Complete inspection using the active plan for each item&apos;s master record. Oil and Others lines are excluded.
        </p>
      )}
      {inspectableItems.map((item) => (
        <ItemInspectionPanel
          key={item.id}
          girnId={girn.id}
          item={item}
          isPending={isPending}
          onSave={onSaveInspection}
          initialInspection={item.inspection}
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
  const { subscribe, joinGirnRoom, leaveGirnRoom } = useSocket();

  const loadGirn = useCallback(async () => {
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
  }, [id]);

  useEffect(() => {
    loadGirn();
  }, [loadGirn]);

  useEffect(() => {
    joinGirnRoom(id);
    return () => leaveGirnRoom(id);
  }, [id, joinGirnRoom, leaveGirnRoom]);

  useEffect(() => {
    const unsubscribe = subscribe('girn:updated', (payload) => {
      if (payload?.girnId === id) {
        loadGirn();
      }
    });
    return unsubscribe;
  }, [subscribe, id, loadGirn]);

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
    const isFormData = payload instanceof FormData;
    const { data } = await api.post(`/girn/${id}/items/${itemId}/inspection`, payload, isFormData ? {
      headers: { 'Content-Type': 'multipart/form-data' },
    } : undefined);
    await loadGirn();
    return { data };
  }

  const items = girn?.items || [];

  return (
    <main className="app-shell employee-shell">
      <header className="app-header employee-card">
        <p onClick={()=> navigate('/girn')} style={{cursor: 'pointer'}}><ArrowLeft size={16} style={{marginRight: 4, display: 'inline'}}/>Back to GIRN</p>
        <div className="header-title-block">
          <p className="eyebrow">Procurement</p>
          <h1>{girn ? girn.girn_number : 'GIRN Detail'}</h1>
          {girn ? (
            <p className="muted">{girn.supplier_name} · {formatDisplayDate(girn.received_date)}</p>
          ) : null}
        </div>
        <div className="pill-tabs">
          {['overview', 'items', 'inspection'].map((t) => (
            <button
              key={t}
              type="button"
              className={`pill-tab ${tab === t ? 'pill-tab-active' : ''}`}
              onClick={() => setTab(t)}
              aria-selected = {tab === t}
              role = 'tab'
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
              {t === 'items' && items.length > 0 ? (
                <span className="count-chip" style={{ marginLeft: 6 }}>
                  {items.length}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </header>

      <section className="card form-card">
        {/* Tabs */}

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
