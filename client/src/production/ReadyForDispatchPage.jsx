import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Layers, PackageCheck, RefreshCw, Truck } from 'lucide-react';
import api from '../api/client';
import { formatDueLabel } from '../blanketPos/scheduleLabels';
import { useProductionRealtime, useSocket } from '../socket/socketContext';
import {
  PageHeader,
  StatusBadge,
  EmptyState,
  TruncatedText,
} from '../components/mes';
import { appAlert, appPrompt } from '../components/dialog';

function qtyGateLabel(lot) {
  const gate = lot.qty_gate;
  const req = lot.shortfall_request;
  if (!gate || gate.mode === 'no_schedule') return 'No delivery schedule';
  if (gate.mode === 'match') return 'Match';
  if (gate.mode === 'overage') return 'Will split + retain';
  if (req?.status === 'pending') return 'Shortfall — pending approval';
  if (req?.status === 'approved') return 'Shortfall — approved';
  return 'Shortfall — approval needed';
}

function qtyGateTone(lot) {
  const gate = lot.qty_gate;
  const req = lot.shortfall_request;
  if (!gate || gate.mode === 'no_schedule') return 'overdue';
  if (gate.mode === 'match') return 'COMPLETED';
  if (gate.mode === 'overage') return 'READY';
  if (req?.status === 'approved') return 'COMPLETED';
  if (req?.status === 'pending') return 'RUNNING';
  return 'overdue';
}

function invoiceLabel(inv) {
  if (!inv) return 'Invoice: not created';
  if (inv.invoice_status === 'draft') return 'Invoice: draft (issue required)';
  if (inv.printed) return `Invoice: ${inv.invoice_number || inv.invoice_status} · printed`;
  return `Invoice: ${inv.invoice_number || inv.invoice_status} · print confirmation needed`;
}

function invoiceWizardPath(lotId, shipQty) {
  const qty = Number(shipQty);
  const q = Number.isFinite(qty) && qty > 0 ? `&quantity=${encodeURIComponent(String(qty))}` : '';
  return `/sales-invoices/new?lotId=${lotId}${q}`;
}

function partitionDispatchQueue(lots) {
  const groupMap = new Map();
  const standalone = [];
  for (const lot of lots) {
    const key = lot.dispatch_group?.key;
    if (!key) {
      standalone.push(lot);
      continue;
    }
    if (!groupMap.has(key)) {
      groupMap.set(key, { ...lot.dispatch_group, members: [] });
    }
    groupMap.get(key).members.push(lot);
  }
  return { groups: [...groupMap.values()], standalone };
}

function groupQtyLabel(group) {
  const req = group.shortfall_request;
  if (group.meets_demand) return 'Meets demand';
  if (req?.status === 'pending') return 'Shortfall — pending approval';
  if (req?.status === 'approved') return 'Shortfall — approved';
  return 'Shortfall — approval needed';
}

function groupQtyTone(group) {
  const req = group.shortfall_request;
  if (group.meets_demand) return 'COMPLETED';
  if (req?.status === 'approved') return 'COMPLETED';
  if (req?.status === 'pending') return 'RUNNING';
  return 'overdue';
}

function mergeDispatchTitle(group, primaryInv) {
  if (group.can_merge_dispatch) {
    const extra = Number(group.combined_qty) - Number(group.ship_qty);
    return extra > 0.0001
      ? 'Will merge, ship schedule qty, and retain the rest as a new lot'
      : 'Will merge lots and dispatch';
  }
  const issued = (group.members || []).filter((l) => {
    const inv = l.sales_invoice;
    return inv && ['due', 'paid'].includes(inv.invoice_status);
  });
  if (issued.length > 1) {
    return 'Cancel extra issued invoices on absorbed lots first';
  }
  if (
    primaryInv &&
    ['due', 'paid'].includes(primaryInv.invoice_status) &&
    Math.abs(Number(primaryInv.quantity) - Number(group.ship_qty)) > 0.0001
  ) {
    return `Invoice qty must equal ship qty (${Number(group.ship_qty)})`;
  }
  if (!primaryInv || primaryInv.invoice_status === 'draft' || !primaryInv.printed) {
    return group.meets_demand
      ? 'Create, issue, and confirm print of an invoice for the schedule qty first'
      : 'Create, issue, and confirm print of an invoice for the combined qty first';
  }
  if (!group.meets_demand && group.shortfall_request?.status === 'pending') {
    return 'Waiting for admin shortfall approval';
  }
  if (!group.meets_demand && group.shortfall_request?.status !== 'approved') {
    return 'Request admin approval for shortfall before merge & dispatch';
  }
  return 'Not ready to merge & dispatch';
}

export default function ReadyForDispatchPage() {
  const navigate = useNavigate();
  const { subscribe } = useSocket();
  const [lots, setLots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const { groups, standalone } = useMemo(() => partitionDispatchQueue(lots), [lots]);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const { data } = await api.get('/production/ready-for-dispatch');
      setLots(data.lots || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to load ready-for-dispatch queue.');
      setLots([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useProductionRealtime(() => load({ silent: true }), [load]);

  useEffect(() => {
    return subscribe('dispatch-shortfall:updated', () => {
      load({ silent: true });
    });
  }, [subscribe, load]);

  async function dispatchOne(lotId) {
    setBusyId(lotId);
    setError(null);
    try {
      await api.post(`/production/lots/${lotId}/dispatch`);
      await load({ silent: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Dispatch failed.');
    } finally {
      setBusyId(null);
    }
  }

  async function mergeAndDispatch(group) {
    setBusyId(group.key);
    setError(null);
    try {
      await api.post('/production/lots/merge-and-dispatch', {
        lot_ids: group.lot_ids,
      });
      await load({ silent: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Merge & dispatch failed.');
    } finally {
      setBusyId(null);
    }
  }

  async function requestShortfallApproval(lot, group = null) {
    const qty = group ? Number(group.combined_qty || 0) : Number(lot.quantity || 0);
    const remaining = group
      ? Number(group.schedule_qty || 0)
      : Number(lot.delivery_schedule_qty ?? lot.qty_gate?.schedule_qty ?? 0);
    const reason = await appPrompt({
      title: 'Request shortfall approval',
      message: `${group ? 'Combined' : 'Lot'} qty ${qty} is less than schedule qty ${remaining}. Explain why this short dispatch should be allowed.`,
      placeholder: 'Reason…',
      confirmLabel: 'Submit',
    });
    if (reason == null) return;
    if (!String(reason).trim()) {
      await appAlert({
        title: 'Reason required',
        message: 'Enter a reason for the shortfall request.',
        tone: 'danger',
      });
      return;
    }
    setBusyId(group?.key || lot.id);
    setError(null);
    try {
      await api.post('/dispatch-shortfall-approvals', {
        lot_id: lot.id,
        reason: String(reason).trim(),
      });
      await appAlert({
        title: 'Request submitted',
        message: 'Waiting for admin approval before dispatch.',
        tone: 'success',
      });
      await load({ silent: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not submit shortfall request.');
    } finally {
      setBusyId(null);
    }
  }

  function renderStandalone(lot) {
    const busy = busyId === lot.id;
    const inv = lot.sales_invoice;
    const canDispatch = !!lot.can_dispatch;
    const gate = lot.qty_gate;
    const isShortfall = gate?.mode === 'shortfall';
    const shortfallPending = lot.shortfall_request?.status === 'pending';
    const shortfallApproved = lot.shortfall_request?.status === 'approved';
    const needApprovalRequest = isShortfall && !shortfallPending && !shortfallApproved;
    const scheduleQty = lot.delivery_schedule_qty ?? gate?.schedule_qty ?? null;

    return (
      <article key={lot.id} className="mes-task-card">
        <div className="mes-task-top">
          <div style={{ minWidth: 0, flex: 1 }}>
            <p className="mes-task-id">
              <Truck size={16} aria-hidden />
              <span>{lot.lot_number}</span>
              {lot.card_number ? (
                <button
                  type="button"
                  className="mes-btn mes-btn-secondary"
                  style={{ marginLeft: 8, padding: '2px 8px', fontSize: 12 }}
                  onClick={() => navigate(`/production/cards/${lot.production_card_id}`)}
                >
                  {lot.card_number}
                </button>
              ) : null}
            </p>
            <h2 style={{ margin: '0 0 4px', fontSize: '1.05rem' }}>
              <TruncatedText>{lot.component_label || 'Component'}</TruncatedText>
            </h2>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Qty <strong>{Number(lot.quantity || 0)}</strong>
              {lot.schedule_due_date ? ` · Due ${formatDueLabel(lot.schedule_due_date)}` : ''}
              {lot.current_node_label ? ` · ${lot.current_node_label}` : ''}
            </p>
            <p
              className="muted"
              style={{
                margin: '4px 0 0',
                fontSize: 12,
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span>
                Remaining{' '}
                <strong>{scheduleQty != null ? Number(scheduleQty) : '—'}</strong>
                {' · '}
                Lot qty <strong>{Number(lot.quantity || 0)}</strong>
              </span>
              <StatusBadge status={qtyGateTone(lot)}>{qtyGateLabel(lot)}</StatusBadge>
            </p>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
              {invoiceLabel(inv)}
            </p>
          </div>
          <StatusBadge status={lot.status} />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          {!inv ? (
            <button
              type="button"
              className="mes-btn mes-btn-primary"
              style={{ flex: 1, padding: '12px', fontSize: 14 }}
              onClick={() =>
                navigate(
                  invoiceWizardPath(
                    lot.id,
                    lot.qty_gate?.mode === 'overage' ? scheduleQty : lot.quantity
                  )
                )
              }
            >
              Create invoice
            </button>
          ) : (
            <button
              type="button"
              className="mes-btn mes-btn-secondary"
              style={{ flex: 1, padding: '12px', fontSize: 14 }}
              onClick={() =>
                inv.invoice_status === 'draft' || !inv.printed
                  ? navigate(
                      invoiceWizardPath(
                        lot.id,
                        lot.qty_gate?.mode === 'overage' ? scheduleQty : lot.quantity
                      )
                    )
                  : navigate(`/sales-invoices/${inv.invoice_id}`)
              }
            >
              {!inv.printed || inv.invoice_status === 'draft'
                ? 'Open invoice wizard'
                : 'View invoice'}
            </button>
          )}
          {needApprovalRequest ? (
            <button
              type="button"
              className="mes-btn mes-btn-secondary"
              style={{ flex: 1, padding: '12px', fontSize: 14 }}
              disabled={busy}
              onClick={() => requestShortfallApproval(lot)}
            >
              {busy ? 'Submitting…' : 'Request approval'}
            </button>
          ) : null}
          <button
            type="button"
            className="mes-btn mes-btn-primary"
            style={{ flex: 1, padding: '12px', fontSize: 14 }}
            disabled={busy || !canDispatch}
            title={
              canDispatch
                ? gate?.mode === 'overage'
                  ? 'Will ship schedule qty and retain the rest as a new lot'
                  : undefined
                : shortfallPending
                  ? 'Waiting for admin shortfall approval'
                  : isShortfall && !shortfallApproved
                    ? 'Request admin approval for shortfall before dispatch'
                    : gate?.mode === 'no_schedule'
                      ? 'Lot has no delivery schedule'
                      : 'Confirm invoice print before dispatch'
            }
            onClick={() => dispatchOne(lot.id)}
          >
            {busy ? 'Dispatching…' : 'Dispatch'}
          </button>
        </div>
      </article>
    );
  }

  function renderGroup(group) {
    const busy = busyId === group.key;
    const primary = group.members.find((l) => l.id === group.primary_lot_id) || group.members[0];
    const inv = primary?.sales_invoice;
    const extra = Number(group.combined_qty) - Number(group.ship_qty);
    const isShortfall = !group.meets_demand;
    const shortfallPending = group.shortfall_request?.status === 'pending';
    const shortfallApproved = group.shortfall_request?.status === 'approved';
    const needApprovalRequest = isShortfall && !shortfallPending && !shortfallApproved;

    return (
      <article key={group.key} className="mes-task-card mes-dispatch-group">
        <div className="mes-task-top">
          <div style={{ minWidth: 0, flex: 1 }}>
            <p className="mes-task-id">
              <Layers size={16} aria-hidden />
              <span>Merge for dispatch</span>
              {group.schedule_number ? (
                <span className="muted" style={{ fontWeight: 500, fontSize: 13 }}>
                  {group.schedule_number}
                </span>
              ) : null}
            </p>
            <h2 style={{ margin: '0 0 4px', fontSize: '1.05rem' }}>
              <TruncatedText>{group.component_label || primary?.component_label || 'Component'}</TruncatedText>
            </h2>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Combined <strong>{Number(group.combined_qty || 0)}</strong>
              {' · Remaining '}
              <strong>{Number(group.schedule_qty || 0)}</strong>
              {group.schedule_due_date ? ` · Due ${formatDueLabel(group.schedule_due_date)}` : ''}
            </p>
            <p
              className="muted"
              style={{
                margin: '4px 0 0',
                fontSize: 12,
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span>
                Ship <strong>{Number(group.ship_qty || 0)}</strong>
                {extra > 0.0001 ? (
                  <>
                    {' · Retain '}
                    <strong>{extra}</strong>
                  </>
                ) : null}
              </span>
              <StatusBadge status={groupQtyTone(group)}>{groupQtyLabel(group)}</StatusBadge>
            </p>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
              {invoiceLabel(inv)}
            </p>
          </div>
          <StatusBadge status="READY">Group</StatusBadge>
        </div>

        <ul className="mes-dispatch-group-members">
          {group.members.map((lot) => (
            <li key={lot.id} className="mes-dispatch-group-member">
              <span>
                <Truck size={14} aria-hidden />
                {lot.lot_number}
                {lot.card_number ? (
                  <button
                    type="button"
                    className="mes-btn mes-btn-secondary"
                    style={{ marginLeft: 8, padding: '1px 6px', fontSize: 11 }}
                    onClick={() => navigate(`/production/cards/${lot.production_card_id}`)}
                  >
                    {lot.card_number}
                  </button>
                ) : null}
              </span>
              <strong>Qty {Number(lot.quantity || 0)}</strong>
            </li>
          ))}
        </ul>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          {!inv ? (
            <button
              type="button"
              className="mes-btn mes-btn-primary"
              style={{ flex: 1, padding: '12px', fontSize: 14 }}
              onClick={() => navigate(invoiceWizardPath(group.primary_lot_id, group.ship_qty))}
            >
              Create invoice
            </button>
          ) : (
            <button
              type="button"
              className="mes-btn mes-btn-secondary"
              style={{ flex: 1, padding: '12px', fontSize: 14 }}
              onClick={() =>
                inv.invoice_status === 'draft' || !inv.printed
                  ? navigate(invoiceWizardPath(group.primary_lot_id, group.ship_qty))
                  : navigate(`/sales-invoices/${inv.invoice_id}`)
              }
            >
              {!inv.printed || inv.invoice_status === 'draft'
                ? 'Open invoice wizard'
                : 'View invoice'}
            </button>
          )}
          {needApprovalRequest && primary ? (
            <button
              type="button"
              className="mes-btn mes-btn-secondary"
              style={{ flex: 1, padding: '12px', fontSize: 14 }}
              disabled={busy}
              onClick={() => requestShortfallApproval(primary, group)}
            >
              {busy ? 'Submitting…' : 'Request approval'}
            </button>
          ) : null}
          <button
            type="button"
            className="mes-btn mes-btn-primary"
            style={{ flex: 1, padding: '12px', fontSize: 14 }}
            disabled={busy || !group.can_merge_dispatch}
            title={mergeDispatchTitle(group, inv)}
            onClick={() => mergeAndDispatch(group)}
          >
            {busy ? 'Merging…' : 'Merge & Dispatch'}
          </button>
        </div>
      </article>
    );
  }

  return (
    <main className="mes-shell">
      <PageHeader
        eyebrow="Shop floor"
        title="Ready for Dispatch"
        subtitle="Invoice must be issued and confirmed printed before a lot can ship. Same-component lots on one delivery schedule are grouped for merge & dispatch, even when combined qty is still short."
        actions={
          <>
            <button
              type="button"
              className="mes-btn mes-btn-secondary"
              onClick={() => navigate('/sales-invoices')}
            >
              <FileText size={16} />
              Sales invoices
            </button>
            <button
              type="button"
              className="mes-btn mes-btn-secondary"
              onClick={() => navigate('/production/work-centers')}
            >
              WC Board
            </button>
            <button type="button" className="mes-btn mes-btn-secondary" onClick={load} disabled={loading}>
              <RefreshCw size={16} />
              Refresh
            </button>
          </>
        }
      />

      {error ? <p className="error-message">{error}</p> : null}
      {loading ? <p className="muted">Loading…</p> : null}

      {!loading && !lots.length ? (
        <EmptyState
          icon={PackageCheck}
          title="Nothing ready"
          description="Lots appear here after packing (or a terminal dispatch node) completes."
          actionLabel="Open WC Board"
          onAction={() => navigate('/production/work-centers')}
        />
      ) : (
        <div className="mes-task-queue">
          {groups.map(renderGroup)}
          {standalone.map(renderStandalone)}
        </div>
      )}
    </main>
  );
}
