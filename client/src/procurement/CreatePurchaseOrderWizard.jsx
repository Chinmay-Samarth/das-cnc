import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, Printer, Send, Download, Trash2, FileText } from 'lucide-react';
import api from '../api/client';
import { PageHeader, AlertBanner, EmptyState, StatusBadge } from '../components/mes';
import { appAlert } from '../components/dialog';
import MasterItemSelect from '../girn/MasterItemSelect';
import { printPurchaseOrderPdf, downloadPurchaseOrderPdf, formatInr } from './downloadPurchaseOrderPdf';

const STEPS = [
  { id: 1, title: 'Demand review', hint: 'Select items and quantities' },
  { id: 2, title: 'Supplier & header', hint: 'Who supplies and when' },
  { id: 3, title: 'Edit lines', hint: 'Rates, MOQ, amounts' },
  { id: 4, title: 'Approve & send', hint: 'Print, then send' },
];

export default function CreatePurchaseOrderWizard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const existingId = searchParams.get('id');
  const seedMasterId = searchParams.get('master_record_id');

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const [demand, setDemand] = useState([]);
  const [selected, setSelected] = useState({});
  const [qtys, setQtys] = useState({});

  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState('');
  const [expectedDelivery, setExpectedDelivery] = useState('');
  const [notes, setNotes] = useState('');

  const [po, setPo] = useState(null);
  const [lines, setLines] = useState([]);
  const [printed, setPrinted] = useState(false);

  const loadDemand = useCallback(async () => {
    const { data } = await api.get('/purchase-orders/demand-summary');
    const items = data.items || [];
    setDemand(items);
    const nextQty = {};
    const nextSel = {};
    for (const item of items) {
      nextQty[item.master_record_id] = String(item.suggested_qty);
    }
    if (seedMasterId) {
      nextSel[seedMasterId] = true;
      const found = items.find((i) => i.master_record_id === seedMasterId);
      if (!found) {
        nextQty[seedMasterId] = searchParams.get('quantity') || '1';
      }
    }
    setQtys(nextQty);
    setSelected(nextSel);
    return items;
  }, [seedMasterId, searchParams]);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ data: supData }] = await Promise.all([
        api.get('/suppliers'),
        loadDemand(),
      ]);
      setSuppliers(supData.suppliers || []);

      if (existingId) {
        const { data } = await api.get(`/purchase-orders/${existingId}`);
        const order = data.purchase_order;
        setPo(order);
        setSupplierId(order.supplier_id || '');
        setExpectedDelivery(order.expected_delivery_date ? String(order.expected_delivery_date).slice(0, 10) : '');
        setNotes(order.notes || '');
        setLines(
          (order.lines || []).map((l) => ({
            ...l,
            quantity: String(l.quantity),
            unit_rate: String(l.unit_rate ?? 0),
          }))
        );
        const sel = {};
        const q = {};
        for (const l of order.lines || []) {
          sel[l.master_record_id] = true;
          q[l.master_record_id] = String(l.quantity);
        }
        setSelected((prev) => ({ ...prev, ...sel }));
        setQtys((prev) => ({ ...prev, ...q }));
        if (order.status !== 'draft') setStep(4);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to load PO wizard');
    } finally {
      setLoading(false);
    }
  }, [existingId, loadDemand]);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const selectedItems = useMemo(() => {
    const fromDemand = demand.filter((d) => selected[d.master_record_id]);
    const extraIds = Object.keys(selected).filter(
      (id) => selected[id] && !demand.some((d) => d.master_record_id === id)
    );
    const extras = extraIds.map((id) => {
      const line = lines.find((l) => l.master_record_id === id);
      return {
        master_record_id: id,
        item_label: line?.item_label || id,
        item_category: line?.item_category || 'raw_material',
        suggested_qty: Number(qtys[id] || line?.quantity || 0),
        moq: Number(line?.moq || 0),
        unit: line?.unit || 'kg',
        campaign_requirement: Number(line?.campaign_requirement || 0),
        trigger_reason: line?.trigger_reason || 'manual',
        supplier_id: supplierId || null,
      };
    });
    return [...fromDemand, ...extras];
  }, [demand, selected, lines, qtys, supplierId]);

  const selectedSupplier = suppliers.find((s) => s.id === supplierId);

  useEffect(() => {
    if (expectedDelivery || !selectedSupplier?.lead_time_days) return;
    const d = new Date();
    d.setDate(d.getDate() + Number(selectedSupplier.lead_time_days || 0));
    setExpectedDelivery(d.toISOString().slice(0, 10));
  }, [selectedSupplier, expectedDelivery]);

  const runningTotal = useMemo(
    () =>
      lines.reduce(
        (s, l) => s + Number(l.quantity || 0) * Number(l.unit_rate || 0),
        0
      ),
    [lines]
  );

  function toggleItem(id) {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function canContinue() {
    if (step === 1) return selectedItems.length > 0;
    if (step === 2) return Boolean(supplierId);
    if (step === 3) return lines.length > 0 && lines.every((l) => Number(l.quantity) > 0);
    return true;
  }

  async function saveDraftHeader() {
    const payloadLines = selectedItems.map((item) => ({
      item_category: item.item_category,
      master_record_id: item.master_record_id,
      quantity: Number(qtys[item.master_record_id] || item.suggested_qty || 0),
      unit: item.unit,
      unit_rate: Number(lines.find((l) => l.master_record_id === item.master_record_id)?.unit_rate || 0),
      campaign_requirement: item.campaign_requirement || 0,
      moq: item.moq || 0,
      trigger_reason: item.trigger_reason || null,
    }));

    const body = {
      supplier_id: supplierId || null,
      notes,
      expected_delivery_date: expectedDelivery || null,
      lines: payloadLines,
    };

    if (po?.id) {
      const { data } = await api.patch(`/purchase-orders/${po.id}`, body);
      return data.purchase_order;
    }
    const { data } = await api.post('/purchase-orders', body);
    return data.purchase_order;
  }

  async function handleContinue() {
    setBusy(true);
    setError(null);
    try {
      if (step === 1 && !supplierId) {
        const hinted = selectedItems.find((i) => i.supplier_id)?.supplier_id;
        if (hinted) setSupplierId(hinted);
      }
      if (step === 2) {
        const saved = await saveDraftHeader();
        setPo(saved);
        setLines(
          (saved.lines || []).map((l) => ({
            ...l,
            quantity: String(l.quantity),
            unit_rate: String(l.unit_rate ?? 0),
          }))
        );
        navigate(`/purchase-orders/create?id=${saved.id}`, { replace: true });
      }
      if (step === 3 && po?.id) {
        const { data } = await api.patch(`/purchase-orders/${po.id}`, {
          supplier_id: supplierId || null,
          notes,
          expected_delivery_date: expectedDelivery || null,
          lines: lines.map((l) => ({
            item_category: l.item_category,
            master_record_id: l.master_record_id,
            quantity: Number(l.quantity),
            unit: l.unit,
            unit_rate: Number(l.unit_rate) || 0,
            campaign_requirement: Number(l.campaign_requirement) || 0,
            moq: Number(l.moq) || 0,
            trigger_reason: l.trigger_reason || null,
          })),
        });
        setPo(data.purchase_order);
      }
      setStep((s) => Math.min(4, s + 1));
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to save draft');
    } finally {
      setBusy(false);
    }
  }

  async function handlePrint() {
    if (!po) return;
    setBusy(true);
    try {
      const stored = await printPurchaseOrderPdf({ ...po, lines: po.lines });
      setPo(stored);
      setPrinted(true);
    } catch (err) {
      await appAlert({ title: 'Print failed', message: err.message || 'Unable to print PO', tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function handleDownload() {
    if (!po) return;
    setBusy(true);
    try {
      const stored = await downloadPurchaseOrderPdf(po);
      setPo(stored);
    } catch (err) {
      await appAlert({ title: 'Download failed', message: err.message || 'Unable to download PO', tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function handleSend() {
    if (!po?.id) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/purchase-orders/${po.id}/send`);
      setPo(data.purchase_order);
      await appAlert({ title: 'PO sent', message: `${data.purchase_order.po_number} is now due.`, tone: 'success' });
      navigate(`/purchase-orders/${po.id}`);
    } catch (err) {
      await appAlert({
        title: 'Send failed',
        message: err.response?.data?.error || 'Unable to send PO',
        tone: 'danger',
      });
    } finally {
      setBusy(false);
    }
  }

  function addManualLine(record) {
    const recordId = record?.master_record_id || record?.record_id;
    if (!recordId) return;
    setSelected((prev) => ({ ...prev, [recordId]: true }));
    setQtys((prev) => ({ ...prev, [recordId]: prev[recordId] || '1' }));
    setLines((prev) => {
      if (prev.some((l) => l.master_record_id === recordId)) return prev;
      return [
        ...prev,
        {
          master_record_id: recordId,
          item_label: record.master_record_label || record.label,
          item_category: 'raw_material',
          quantity: '1',
          unit: 'kg',
          unit_rate: '0',
          moq: 0,
          campaign_requirement: 0,
        },
      ];
    });
  }

  if (loading) {
    return (
      <main className="mes-shell bpo-setup-page po-setup-page">
        <p className="muted">Loading demand…</p>
      </main>
    );
  }

  return (
    <main className="mes-shell bpo-setup-page po-setup-page">
      <PageHeader
        eyebrow="Procurement"
        title={po?.po_number ? `Draft ${po.po_number}` : 'New purchase order'}
        subtitle="Select demand, lock the supplier, print the PO, then send it."
        actions={
          <button type="button" className="neutral-button" onClick={() => navigate('/purchase-orders')}>
            <ArrowLeft size={16} />
            All POs
          </button>
        }
      />

      <nav className="bpo-steps" aria-label="Purchase order steps">
        {STEPS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`bpo-step${step === s.id ? ' is-active' : ''}${step > s.id ? ' is-done' : ''}`}
            onClick={() => {
              if (s.id < step || (s.id === step + 1 && canContinue()) || (po && s.id === 4)) setStep(s.id);
            }}
            disabled={s.id > step + 1 || (s.id > step && !canContinue())}
          >
            <span className="bpo-step-num">
              {step > s.id ? <Check size={14} strokeWidth={3} /> : s.id}
            </span>
            <span className="bpo-step-text">
              <strong>
                {s.title}
                {s.id === 1 && selectedItems.length ? ` (${selectedItems.length})` : ''}
              </strong>
              <small>{s.hint}</small>
            </span>
          </button>
        ))}
      </nav>

      <section className="card bpo-setup-card">
        {error ? <AlertBanner tone="danger">{error}</AlertBanner> : null}

        {step === 1 ? (
          <div className="bpo-panel">
            <h2>Demand review</h2>
            <p className="muted bpo-lead">
              Tick the items to order. Suggested quantities are pre-filled; you can override any line.
            </p>

            {demand.length === 0 && selectedItems.length === 0 ? (
              <EmptyState
                title="No demand gaps"
                description="Campaign and reorder-level needs are currently covered. You can still add an item below."
              />
            ) : (
              <div className="app-table-wrap">
                <table className="app-table">
                  <thead>
                    <tr>
                      <th />
                      <th>Item</th>
                      <th>Campaign</th>
                      <th>On-hand</th>
                      <th>ROL gap</th>
                      <th>Open POs</th>
                      <th>Order qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {demand.map((item) => (
                      <tr key={item.master_record_id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={Boolean(selected[item.master_record_id])}
                            onChange={() => toggleItem(item.master_record_id)}
                          />
                        </td>
                        <td>
                          <strong>{item.item_label}</strong>
                          <div className="table-subtext">{item.trigger_reason?.replace(/_/g, ' ')}</div>
                        </td>
                        <td>{item.campaign_requirement}</td>
                        <td>{item.on_hand}</td>
                        <td>{item.rol_gap}</td>
                        <td>{item.open_po_qty}</td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={qtys[item.master_record_id] ?? ''}
                            onChange={(e) =>
                              setQtys((prev) => ({ ...prev, [item.master_record_id]: e.target.value }))
                            }
                            disabled={busy}
                          />
                          <span className="table-subtext"> {item.unit}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {selectedItems.length ? (
              <div className="bpo-summary-chip">
                <strong>{selectedItems.length} line{selectedItems.length === 1 ? '' : 's'} selected</strong>
                <span>Continue to assign a supplier</span>
              </div>
            ) : null}

            <label>
              Add another item
              <MasterItemSelect
                masterSlug="raw-material"
                category="raw_material"
                value=""
                onChange={addManualLine}
                placeholder="Search raw material…"
                disabled={busy}
              />
            </label>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="bpo-panel">
            <h2>Supplier & header</h2>
            <p className="muted bpo-lead">
              Who should this order go to? Delivery date defaults from the supplier lead time.
            </p>

            <div className="bpo-grid-2">
              <label>
                Supplier <span className="req">*</span>
                <select
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  required
                  disabled={busy}
                >
                  <option value="">Select supplier…</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Expected delivery
                <input
                  type="date"
                  value={expectedDelivery}
                  onChange={(e) => setExpectedDelivery(e.target.value)}
                  disabled={busy}
                />
              </label>
            </div>

            <label>
              Notes
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Optional"
                disabled={busy}
              />
            </label>

            {selectedSupplier ? (
              <div className="bpo-summary-chip">
                <strong>{selectedSupplier.name}</strong>
                <span>
                  {selectedItems.length} line{selectedItems.length === 1 ? '' : 's'}
                  {selectedSupplier.lead_time_days != null
                    ? ` · ${selectedSupplier.lead_time_days} day lead`
                    : ''}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="bpo-panel">
            <h2>Review & edit lines</h2>
            <p className="muted bpo-lead">Adjust quantities and rates. Lines below MOQ are flagged.</p>

            <div className="app-table-wrap">
              <table className="app-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>Unit</th>
                    <th>Rate</th>
                    <th>Amount</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, idx) => {
                    const qty = Number(line.quantity) || 0;
                    const rate = Number(line.unit_rate) || 0;
                    const belowMoq = Number(line.moq) > 0 && qty < Number(line.moq);
                    return (
                      <tr key={line.master_record_id}>
                        <td>
                          <strong>{line.item_label || line.master_record_id}</strong>
                          {belowMoq ? (
                            <div className="table-subtext">
                              <StatusBadge status="overdue">Below MOQ {line.moq}</StatusBadge>
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={line.quantity}
                            disabled={busy}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((l, i) => (i === idx ? { ...l, quantity: e.target.value } : l))
                              )
                            }
                          />
                        </td>
                        <td>{line.unit}</td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={line.unit_rate}
                            disabled={busy}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((l, i) => (i === idx ? { ...l, unit_rate: e.target.value } : l))
                              )
                            }
                          />
                        </td>
                        <td>{formatInr(qty * rate)}</td>
                        <td>
                          <button
                            type="button"
                            className="link-button"
                            disabled={busy}
                            onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                          >
                            <Trash2 size={14} />
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="bpo-summary-chip">
              <strong>Running total</strong>
              <span>{formatInr(runningTotal)}</span>
            </div>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="bpo-panel">
            <h2>Approve & send</h2>
            <p className="muted bpo-lead">
              Print or download the PO, confirm it was printed, then send it to the supplier.
            </p>

            <div className="bpo-review">
              <h3>Review</h3>
              <ul>
                <li>
                  <span>PO number</span>
                  <strong>{po?.po_number || '—'}</strong>
                </li>
                <li>
                  <span>Supplier</span>
                  <strong>{po?.supplier_name || selectedSupplier?.name || '—'}</strong>
                </li>
                <li>
                  <span>Lines</span>
                  <strong>{lines.length}</strong>
                </li>
                <li>
                  <span>Total</span>
                  <strong>{formatInr(po?.total_amount || runningTotal)}</strong>
                </li>
                <li>
                  <span>Delivery</span>
                  <strong>{expectedDelivery || po?.expected_delivery_date || '—'}</strong>
                </li>
              </ul>
            </div>

            <div className="bpo-actions-row" style={{ marginTop: 16 }}>
              <button type="button" className="neutral-button" disabled={busy || !po} onClick={handleDownload}>
                <Download size={15} />
                Download PDF
              </button>
              <button type="button" className="neutral-button" disabled={busy || !po} onClick={handlePrint}>
                <Printer size={15} />
                Print PO
              </button>
            </div>

            <label className="bpo-check">
              <input
                type="checkbox"
                checked={printed}
                onChange={(e) => setPrinted(e.target.checked)}
                disabled={busy || !po}
              />
              <span>
                Confirm printed
                <small>Enables Send to supplier after the print dialog</small>
              </span>
            </label>
          </div>
        ) : null}

        <div className="bpo-footer">
          {step > 1 ? (
            <div className="bpo-actions-row">
              <button
                type="button"
                className="neutral-button"
                disabled={busy}
                onClick={() => setStep((s) => s - 1)}
              >
                Back
              </button>
              {step === 4 ? (
                <button
                  type="button"
                  className="neutral-button"
                  disabled={busy}
                  onClick={() => navigate(po?.id ? `/purchase-orders/${po.id}` : '/purchase-orders')}
                >
                  <FileText size={15} />
                  Keep as draft
                </button>
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              className="cancel-button"
              disabled={busy}
              onClick={() => navigate('/purchase-orders')}
            >
              Cancel
            </button>
          )}

          {step < 4 ? (
            <button
              type="button"
              className="primary-button"
              disabled={busy || !canContinue()}
              onClick={handleContinue}
            >
              {busy ? 'Saving…' : 'Continue'}
            </button>
          ) : (
            <button
              type="button"
              className="primary-button"
              disabled={busy || !printed || !po}
              onClick={handleSend}
            >
              <Send size={15} />
              {busy ? 'Sending…' : 'Send to supplier'}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
