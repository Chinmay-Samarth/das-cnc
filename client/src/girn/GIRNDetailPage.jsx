import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  FileText,
  Package,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../auth/authContext';
import { useSocket } from '../socket/socketContext';
import { getCategoryConfig, requiresInspection } from './girnCategoryConfig';
import { formatDisplayDate, formatDisplayDateTime } from '../utils/dateFormat';
import {
  AlertBanner,
  EmptyState,
  FilePicker,
  MetricCard,
  PageHeader,
  ProgressBar,
  StatusBadge,
} from '../components/mes';

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

function girnStatusTone(status) {
  if (status === 'approved') return 'completed';
  if (status === 'rejected') return 'overdue';
  if (status === 'pending_inspection') return 'running';
  return 'draft';
}

function resultTone(result) {
  if (result === 'pass') return 'completed';
  if (result === 'fail') return 'overdue';
  return 'draft';
}

function DetailItem({ label, value }) {
  return (
    <div className="girn-detail-field">
      <p className="employee-detail-label">{label}</p>
      <p className="employee-detail-value">{value || '—'}</p>
    </div>
  );
}

function OverviewTab({ girn, onAction, actionLoading, canReview, inspectionProgress }) {
  const [rejectNotes, setRejectNotes] = useState('');
  const [showReject, setShowReject] = useState(false);

  const isDraft = girn.status === 'draft';
  const isPending = girn.status === 'pending_inspection';
  const isFinished = girn.status === 'approved' || girn.status === 'rejected';
  const approverLabel = girn.approver_name
    ? `${girn.approver_name}${girn.approver_code ? ` (${girn.approver_code})` : ''}`
    : null;
  const rejecterLabel = girn.rejecter_name
    ? `${girn.rejecter_name}${girn.rejecter_code ? ` (${girn.rejecter_code})` : ''}`
    : null;

  return (
    <div className="girn-detail-overview">
      <div className="mes-metric-grid girn-detail-metrics">
        <MetricCard
          label="Grand total"
          value={`₹${fmt(girn.grand_total)}`}
          hint={girn.supplier_name || 'Supplier'}
          icon={Package}
          tone="info"
        />
        <MetricCard
          label="Status"
          value={STATUS_LABELS[girn.status] || girn.status}
          hint={formatDisplayDate(girn.received_date)}
          icon={ClipboardCheck}
          tone={
            girn.status === 'approved'
              ? 'success'
              : girn.status === 'rejected'
                ? 'danger'
                : girn.status === 'pending_inspection'
                  ? 'amber'
                  : 'neutral'
          }
        />
        {inspectionProgress.total > 0 ? (
          <MetricCard
            label="Inspection"
            value={`${inspectionProgress.passed}/${inspectionProgress.total}`}
            hint={
              inspectionProgress.ready
                ? 'All items passed'
                : isPending
                  ? 'In progress'
                  : 'Complete'
            }
            icon={CheckCircle2}
            tone={inspectionProgress.ready || girn.status === 'approved' ? 'success' : 'amber'}
          />
        ) : null}
      </div>

      {inspectionProgress.total > 0 && isPending ? (
        <div className="girn-detail-progress">
          <ProgressBar
            value={inspectionProgress.passed}
            max={inspectionProgress.total}
            label="Inspection progress"
          />
        </div>
      ) : null}

      <div className="girn-detail-grid">
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
        <div className="girn-detail-field">
          <p className="employee-detail-label">Purchase order</p>
          {girn.purchase_order_id ? (
            <Link
              to={`/purchase-orders/${girn.purchase_order_id}`}
              className="neutral-button"
              style={{ display: 'inline-flex', width: 'fit-content', gap: 6, alignItems: 'center' }}
            >
              <FileText size={16} />
              {girn.purchase_order_number || girn.po_reference || 'Open PO'}
            </Link>
          ) : (
            <p className="employee-detail-value">{girn.po_reference || '—'}</p>
          )}
        </div>
        <div className="girn-detail-field">
          <p className="employee-detail-label">Source Invoice</p>
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
            <p className="employee-detail-value">—</p>
          )}
        </div>
        <DetailItem label="CSR" value={girn.csr} />
        <div className="girn-detail-field">
          <p className="employee-detail-label">Status</p>
          <StatusBadge status={girnStatusTone(girn.status)}>
            {STATUS_LABELS[girn.status] || girn.status}
          </StatusBadge>
        </div>
        {girn.notes ? <DetailItem label="Notes" value={girn.notes} /> : null}
        {girn.status === 'approved' && approverLabel ? (
          <DetailItem
            label="Approved by"
            value={`${approverLabel}${girn.approved_at ? ` on ${formatDisplayDateTime(girn.approved_at)}` : ''}`}
          />
        ) : null}
        {girn.status === 'rejected' && rejecterLabel ? (
          <DetailItem
            label="Rejected by"
            value={`${rejecterLabel}${girn.rejected_at ? ` on ${formatDisplayDateTime(girn.rejected_at)}` : ''}`}
          />
        ) : null}
      </div>

      {!isFinished ? (
        <div className="girn-detail-actions">
          {isDraft ? (
            <button
              type="button"
              className="primary-button"
              disabled={actionLoading}
              onClick={() => onAction('submit')}
            >
              {actionLoading ? 'Submitting…' : 'Submit for Inspection'}
            </button>
          ) : null}

          {isPending && canReview ? (
            <>
              <button
                type="button"
                className="primary-button"
                disabled={actionLoading}
                onClick={() => onAction('approve')}
              >
                {actionLoading ? 'Approving…' : 'Approve'}
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
          {isPending && !canReview ? (
            <AlertBanner tone="info">
              Inspections that pass will auto-approve this GIRN. Admins are notified when it is approved.
            </AlertBanner>
          ) : null}
        </div>
      ) : null}

      {showReject ? (
        <div className="girn-reject-panel mes-card">
          <label className="girn-reject-label">Rejection reason (optional)</label>
          <textarea
            rows={3}
            value={rejectNotes}
            onChange={(e) => setRejectNotes(e.target.value)}
            placeholder="Describe why this GIRN is being rejected…"
          />
          <div className="girn-detail-actions">
            <button
              type="button"
              className="primary-button girn-reject-confirm"
              disabled={actionLoading}
              onClick={() => onAction('reject', { notes: rejectNotes })}
            >
              {actionLoading ? 'Rejecting…' : 'Confirm Reject'}
            </button>
            <button type="button" className="cancel-button" onClick={() => setShowReject(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ItemsTab({ items }) {
  const grandTotal = items.reduce((sum, i) => sum + (parseFloat(i.total_amount) || 0), 0);

  if (!items.length) {
    return <EmptyState title="No items" description="No line items recorded on this GIRN." />;
  }

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
                <td>
                  {item.master_record_label || item.raw_material_label || item.item_description || '—'}
                </td>
                <td>
                  <strong>{item.item_code || item.rm_code || '—'}</strong>
                </td>
                <td>{item.lot_number || '—'}</td>
                <td>
                  {item.item_category === 'gauge'
                    ? `${item.quantity_ok ?? '—'} / ${item.quantity_not_ok ?? '—'}`
                    : '—'}
                </td>
                <td>{item.unit || (cfg.quantityType === 'kg' ? 'kg' : 'nos')}</td>
                <td>{item.quantity}</td>
                <td>₹{fmt(item.unit_rate)}</td>
                <td>
                  <strong>₹{fmt(item.total_amount)}</strong>
                </td>
              </tr>
            );
          })}
          <tr className="total-row">
            <td colSpan={9} style={{ textAlign: 'right', fontWeight: 700, paddingRight: 16 }}>
              Grand Total
            </td>
            <td>₹{fmt(grandTotal)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ItemInspectionPanel({ girnId, item, isPending, onSave, initialInspection }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [lotNumber, setLotNumber] = useState(item.lot_number || '');
  const [autoApprovedMsg, setAutoApprovedMsg] = useState('');

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
  const resultLabel = execution?.overall_result;

  useEffect(() => {
    if (!open || !girnId || !item.id) return undefined;

    let cancelled = false;
    setLoadingPlan(true);
    setLoadError(null);

    api
      .get(`/girn/${girnId}/items/${item.id}/inspection`)
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

    return () => {
      cancelled = true;
    };
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
    setAutoApprovedMsg('');
    try {
      const formData = new FormData();
      const values = (plan?.parameters || []).map((param) => ({
        plan_parameter_id: param.id,
        measured_value:
          valueInputs[param.id]?.measured_value === ''
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
      if (data?.auto_approved) {
        setAutoApprovedMsg('All inspections passed — GIRN was auto-approved and admin was notified.');
      }
    } catch (err) {
      setSaveError(err.response?.data?.error || 'Unable to submit inspection.');
    } finally {
      setSaving(false);
    }
  }

  const itemLabel =
    item.master_record_label ||
    item.raw_material_label ||
    item.item_description ||
    item.item_code ||
    `Item ${item.id}`;

  const paramCount = plan?.parameters?.length || 0;
  const passedParams = useMemo(() => {
    if (!plan?.parameters) return 0;
    return plan.parameters.filter((p) => valueInputs[p.id]?.result === 'pass').length;
  }, [plan, valueInputs]);

  return (
    <div className={`girn-inspect-panel mes-card${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="girn-inspect-header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <div className="girn-inspect-header-main">
          <StatusBadge status="draft">{cfg.label}</StatusBadge>
          <div className="girn-inspect-titles">
            <p className="girn-inspect-title">{itemLabel}</p>
            <p className="girn-inspect-meta">
              Qty {item.quantity}
              {lotNumber ? ` · LOT ${lotNumber}` : ''}
              {paramCount ? ` · ${paramCount} checks` : ''}
            </p>
          </div>
        </div>
        <div className="girn-inspect-header-aside">
          {resultLabel ? (
            <StatusBadge status={resultTone(resultLabel)}>
              {resultLabel === 'pass' ? (
                <>
                  <CheckCircle2 size={12} /> Pass
                </>
              ) : resultLabel === 'fail' ? (
                <>
                  <XCircle size={12} /> Fail
                </>
              ) : (
                resultLabel
              )}
            </StatusBadge>
          ) : isPending ? (
            <StatusBadge status="running">Pending</StatusBadge>
          ) : null}
          <ChevronDown size={18} className="girn-inspect-chevron" aria-hidden />
        </div>
      </button>

      {open ? (
        <div className="girn-inspect-body">
          {loadingPlan ? <p className="muted">Loading inspection plan…</p> : null}
          {loadError ? <AlertBanner tone="danger">{loadError}</AlertBanner> : null}
          {autoApprovedMsg ? <AlertBanner tone="success">{autoApprovedMsg}</AlertBanner> : null}

          {!loadingPlan && !loadError && plan ? (
            <>
              <div className="mes-metric-grid girn-inspect-metrics">
                <MetricCard label="Plan" value={plan.plan_code} hint={`Rev ${plan.revision}`} />
                <MetricCard label="Lot qty" value={item.quantity} />
                <MetricCard label="Sample size" value={sampleSize ?? '—'} />
                {submitted || !isPending ? (
                  <MetricCard
                    label="Result"
                    value={(resultLabel || '—').toUpperCase()}
                    tone={resultLabel === 'pass' ? 'success' : resultLabel === 'fail' ? 'danger' : 'neutral'}
                    icon={resultLabel === 'pass' ? CheckCircle2 : resultLabel === 'fail' ? ShieldAlert : ClipboardCheck}
                  />
                ) : (
                  <MetricCard
                    label="Checks set"
                    value={`${passedParams}/${paramCount || 0}`}
                    tone="amber"
                  />
                )}
              </div>

              {category === 'gauge' && isPending && !submitted ? (
                <div className="girn-inspect-gauge-grid">
                  <label>
                    OK Qty
                    <input
                      type="number"
                      min="0"
                      value={quantityOk}
                      onChange={(e) => setQuantityOk(e.target.value)}
                    />
                  </label>
                  <label>
                    Not OK Qty
                    <input
                      type="number"
                      min="0"
                      value={quantityNotOk}
                      onChange={(e) => setQuantityNotOk(e.target.value)}
                    />
                  </label>
                </div>
              ) : null}

              <div className="employees-table-wrap">
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
                      const spec =
                        param.check_type === 'dimensional'
                          ? `${param.nominal_value ?? '—'} ${param.unit || ''} (+${param.tol_plus ?? 0}/-${param.tol_minus ?? 0})`
                          : param.instrument_required || '—';
                      const input = valueInputs[param.id] || {};
                      return (
                        <tr key={param.id}>
                          <td>
                            {param.parameter_name}
                            {param.is_mandatory ? ' *' : ''}
                          </td>
                          <td>{param.check_type}</td>
                          <td>{spec}</td>
                          <td>
                            {param.check_type === 'dimensional' ? (
                              submitted ? (
                                input.measured_value ?? '—'
                              ) : (
                                <input
                                  type="number"
                                  value={input.measured_value}
                                  onChange={(e) =>
                                    updateValue(param.id, 'measured_value', e.target.value)
                                  }
                                  style={{ width: 88 }}
                                />
                              )
                            ) : (
                              '—'
                            )}
                          </td>
                          <td>
                            {submitted || param.check_type === 'dimensional' ? (
                              <StatusBadge status={resultTone(input.result)}>
                                {(input.result || '—').toUpperCase()}
                              </StatusBadge>
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
                            {submitted ? (
                              input.remarks || '—'
                            ) : (
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
                <div className="girn-inspect-docs">
                  <h4 className="girn-inspect-docs-title">Documents</h4>
                  <div className="girn-inspect-docs-list">
                    {(plan.documents || []).map((doc) => {
                      const saved = execution?.documents?.find(
                        (d) => d.document_type === doc.document_type
                      );
                      return (
                        <div key={doc.document_type} className="girn-inspect-doc-row">
                          <span className="girn-inspect-doc-name">
                            {doc.document_type}
                            {doc.is_mandatory ? ' *' : ''}
                          </span>
                          {submitted ? (
                            saved ? (
                              <a href={saved.file_url} target="_blank" rel="noopener noreferrer">
                                View file
                              </a>
                            ) : (
                              '—'
                            )
                          ) : (
                            <div className="girn-inspect-doc-controls">
                              <FilePicker
                                label="Upload"
                                accept="*/*"
                                onChange={(file) =>
                                  setDocFiles((prev) => ({
                                    ...prev,
                                    [doc.document_type]: file || null,
                                  }))
                                }
                              />
                              <label className="girn-inspect-verify">
                                <input
                                  type="checkbox"
                                  checked={docVerified[doc.document_type] || false}
                                  onChange={(e) =>
                                    setDocVerified((prev) => ({
                                      ...prev,
                                      [doc.document_type]: e.target.checked,
                                    }))
                                  }
                                />
                                Verified
                              </label>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {isPending && !submitted ? (
                <div className="girn-detail-actions">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={saving}
                    onClick={handleSubmit}
                  >
                    {saving ? 'Submitting…' : 'Submit Inspection'}
                  </button>
                  {saveError ? <AlertBanner tone="danger">{saveError}</AlertBanner> : null}
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
  const inspectableItems = items.filter((item) =>
    requiresInspection(item.item_category || 'raw_material')
  );
  const passed = inspectableItems.filter((i) => i.inspection?.overall_result === 'pass').length;

  if (!isPending && girn.status !== 'approved' && girn.status !== 'rejected') {
    return (
      <EmptyState
        title="Inspection not started"
        description="Submit the GIRN for inspection to run quality checks."
      />
    );
  }

  if (inspectableItems.length === 0) {
    return (
      <EmptyState
        title="No inspection required"
        description="Oil and Others lines are excluded from inspection."
      />
    );
  }

  return (
    <div className="girn-inspect-tab">
      {isPending ? (
        <div className="girn-detail-progress">
          <ProgressBar
            value={passed}
            max={inspectableItems.length}
            label="Items inspected"
          />
          <p className="muted girn-inspect-hint">
            Complete each item against its active master plan. When all mandatory checks pass, this
            GIRN is auto-approved and admin is alerted.
          </p>
        </div>
      ) : (
        <AlertBanner tone={girn.status === 'approved' ? 'success' : 'danger'}>
          This GIRN is {girn.status}. Inspection records below are read-only.
        </AlertBanner>
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

export default function GIRNDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const canReview = user?.accessLevel === 'ADMIN' || user?.accessLevel === 'SUPERVISOR';
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
    const { data } = await api.post(
      `/girn/${id}/items/${itemId}/inspection`,
      payload,
      isFormData
        ? {
            headers: { 'Content-Type': 'multipart/form-data' },
          }
        : undefined
    );
    await loadGirn();
    return { data };
  }

  const items = girn?.items || [];
  const inspectionProgress = useMemo(() => {
    const inspectable = items.filter((item) =>
      requiresInspection(item.item_category || 'raw_material')
    );
    const passed = inspectable.filter((i) => i.inspection?.overall_result === 'pass').length;
    return {
      total: inspectable.length,
      passed,
      ready: inspectable.length > 0 && passed === inspectable.length,
    };
  }, [items]);

  return (
    <main className="mes-shell">
      <PageHeader
        eyebrow="Procurement"
        title={girn ? girn.girn_number : 'GIRN Detail'}
        subtitle={
          girn ? `${girn.supplier_name || 'Supplier'} · ${formatDisplayDate(girn.received_date)}` : ''
        }
        actions={
          girn ? (
            <StatusBadge status={girnStatusTone(girn.status)}>
              {STATUS_LABELS[girn.status] || girn.status}
            </StatusBadge>
          ) : null
        }
      />

      <div className="mes-view-toggle" role="tablist" aria-label="GIRN sections">
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'items', label: `Items${items.length ? ` (${items.length})` : ''}` },
          {
            id: 'inspection',
            label:
              inspectionProgress.total > 0
                ? `Inspection (${inspectionProgress.passed}/${inspectionProgress.total})`
                : 'Inspection',
          },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`mes-view-toggle-btn${tab === t.id ? ' is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <section className="mes-card form-card">
        {actionError ? <AlertBanner tone="danger">{actionError}</AlertBanner> : null}

        {loading ? (
          <p className="muted">Loading GIRN…</p>
        ) : error ? (
          <AlertBanner tone="danger">{error}</AlertBanner>
        ) : !girn ? (
          <EmptyState title="Not found" description="This GIRN could not be loaded." />
        ) : tab === 'overview' ? (
          <OverviewTab
            girn={girn}
            onAction={handleAction}
            actionLoading={actionLoading}
            canReview={canReview}
            inspectionProgress={inspectionProgress}
          />
        ) : tab === 'items' ? (
          <ItemsTab items={items} />
        ) : (
          <InspectionTab girn={girn} items={items} onSaveInspection={handleSaveInspection} />
        )}
      </section>
    </main>
  );
}
