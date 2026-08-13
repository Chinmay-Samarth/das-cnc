import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Factory } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../auth/authContext';
import { formatDueLabel } from '../blanketPos/scheduleLabels';
import { useSocket, useProductionRealtime } from '../socket/socketContext';
import { appAlert } from '../components/dialog';
import {
  PageHeader,
  StatusBadge,
  EmptyState,
  TruncatedText,
} from '../components/mes';

const BULK_RELOAD_ACTIONS = new Set([
  'assign_unassigned',
  'heal_op_cards',
  'released',
  'rollover',
]);
const STRUCTURAL_WC_RELOAD = new Set([
  'advanced',
  'lot_created',
  'lot_advanced',
  'lot_ready_for_dispatch',
  'acting_manager_pinned',
]);

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function initials(name) {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function itemVisibleOnBoard(item, boardDate) {
  const wd = item?.work_date;
  if (!wd) {
    if (item?.kind === 'lot') return true;
    return false;
  }
  if (wd > boardDate) return false;
  const st = String(item.status || '').toUpperCase();
  if (st === 'RUNNING') return true;
  if (st === 'READY') return wd === boardDate;
  if (['IN_PROCESS', 'RECEIVED'].includes(st)) return wd <= boardDate;
  return false;
}

function isRunningItem(item) {
  const st = String(item.data?.status || '').toUpperCase();
  if (st === 'RUNNING') return true;
  if (item.kind === 'lot' && ['IN_PROCESS', 'RECEIVED'].includes(st)) return true;
  return false;
}

function isOpenBoardStatus(status) {
  const st = String(status || '').toUpperCase();
  return ['READY', 'RUNNING', 'IN_PROCESS', 'RECEIVED'].includes(st);
}

function normalizePayload(raw) {
  return {
    action: raw?.action,
    workCenterId: raw?.work_center_id || raw?.workCenterId || null,
    previousWorkCenterId: raw?.previous_work_center_id || raw?.previousWorkCenterId || null,
    cardId: raw?.card_id || raw?.cardId || null,
    lotId: raw?.lot_id || raw?.lotId || null,
    opCardId: raw?.op_card_id || raw?.opCardId || null,
    status: raw?.status || null,
    workDate: raw?.work_date || raw?.workDate || null,
    assignedEmployeeId: raw?.assigned_employee_id || raw?.employeeId || null,
    assignedEmployee: raw?.assigned_employee || raw?.assignedEmployee || null,
    previousEmployeeId: raw?.previous_employee_id || raw?.previousEmployeeId || null,
  };
}

function buildJobItems(board) {
  const opCards = board?.op_cards || [];
  const useOps = opCards.length > 0;
  const items = [];
  if (useOps) {
    for (const op of opCards) {
      items.push({ kind: 'op_card', data: op, id: op.id });
    }
  } else {
    for (const lot of board?.lots || []) {
      items.push({ kind: 'lot', data: lot, id: lot.id });
    }
    for (const card of board?.cards || []) {
      items.push({ kind: 'card', data: card, id: card.id });
    }
  }
  return items;
}

function splitQueue(items, boardDate) {
  const running = [];
  const today = [];
  for (const item of items) {
    if (!itemVisibleOnBoard(item.data, boardDate)) continue;
    if (isRunningItem(item)) {
      running.push(item);
    } else if (String(item.data.status || '').toUpperCase() === 'READY') {
      today.push(item);
    }
  }
  return { running, today };
}

function remainingForItem(item) {
  const d = item.data;
  if (item.kind === 'op_card') {
    return Math.max(0, Number(d.target_quantity || 0) - Number(d.good_qty || 0));
  }
  if (item.kind === 'lot') return Number(d.quantity || 0);
  return Number(
    d.remaining_qty ??
      Math.max(
        0,
        Number(d.day_goal ?? Number(d.target_quantity) + Number(d.overdue_quantity)) -
          Number(d.total_good_produced || 0)
      )
  );
}

function patchList(list, payload, boardDate, matchFn) {
  if (!list?.length) return { list: list || [], found: false };
  let found = false;
  const next = [];
  for (const row of list) {
    if (!matchFn(row)) {
      next.push(row);
      continue;
    }
    found = true;
    const updated = { ...row };
    if (payload.status) updated.status = payload.status;
    if (payload.assignedEmployeeId != null) {
      updated.assigned_employee_id = payload.assignedEmployeeId;
      updated.assigned_employee_name =
        payload.assignedEmployee?.full_name || updated.assigned_employee_name || null;
    }
    if (payload.workDate) updated.work_date = payload.workDate;
    if (!isOpenBoardStatus(updated.status) || !itemVisibleOnBoard(updated, boardDate)) {
      continue;
    }
    next.push(updated);
  }
  return { list: next, found };
}

function patchBoard(board, payload, boardDate) {
  if (!board) return board;
  const p = payload;
  const matchOp = (row) => p.opCardId && row.id === p.opCardId;
  const matchLot = (row) => p.lotId && row.id === p.lotId;
  const matchCard = (row) => p.cardId && row.id === p.cardId;

  const opResult = patchList(board.op_cards, p, boardDate, matchOp);
  const lotResult = patchList(board.lots, p, boardDate, matchLot);
  const cardResult = patchList(board.cards, p, boardDate, matchCard);
  const found = opResult.found || lotResult.found || cardResult.found;

  return {
    ...board,
    op_cards: opResult.list,
    lots: lotResult.list,
    cards: cardResult.list,
    _patchFound: found,
  };
}

function OperatorAvatarStack({ operators }) {
  if (!operators?.length) {
    return <p className="wc-station-muted">No operators</p>;
  }
  return (
    <div className="wc-avatar-stack" aria-label="Operators on station">
      {operators.map((op) => {
        const openBacklog = Number(op.backlog ?? 0);
        const completedOps = Number(op.completed_ops ?? 0);
        const totalQty = Number(op.total_qty ?? openBacklog);
        const title = [
          op.full_name,
          `Open backlog: ${openBacklog}`,
          completedOps ? `Completed today: ${completedOps}` : null,
          `Day load: ${totalQty}`,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <span key={op.employee_id} className="mes-avatar wc-avatar-stack-item" title={title}>
            {initials(op.full_name)}
          </span>
        );
      })}
    </div>
  );
}

function BoardJobCard({ item, onOpen, onContextMenu }) {
  const d = item.data;
  const running = isRunningItem(item);
  const remaining = remainingForItem(item);

  let label = '';
  let trackingId = null;
  let subtitle = '';
  if (item.kind === 'op_card') {
    label = d.op_card_number;
    trackingId = d.production_card_id;
    subtitle = [d.current_node_label, d.lot_number].filter(Boolean).join(' · ');
  } else if (item.kind === 'lot') {
    label = d.lot_number;
    trackingId = d.production_card_id;
    subtitle = d.current_node_label || '';
  } else {
    label = d.card_number;
    trackingId = d.id;
    subtitle = [d.component_label, d.customer_name].filter(Boolean).join(' · ');
  }

  return (
    <div
      className={`wc-job-card${running ? ' is-running' : ''}`}
      onContextMenu={(e) => onContextMenu(e, item)}
    >
      <div className="wc-job-card-head">
        <button
          type="button"
          className="pc-card-link"
          onClick={() => trackingId && onOpen(trackingId)}
        >
          {label}
        </button>
        <StatusBadge status={d.status || 'READY'} />
      </div>
      <p className="wc-job-card-meta">
        Remaining <strong>{remaining}</strong>
        {d.assigned_employee_name ? ` · ${d.assigned_employee_name}` : ' · Unassigned'}
      </p>
      {subtitle ? (
        <TruncatedText className="wc-job-card-sub">{subtitle}</TruncatedText>
      ) : null}
    </div>
  );
}

function BoardContextMenu({
  menu,
  operators,
  canReassign = false,
  canPinActing = false,
  onReassign,
  onSetActingManager,
  onOpenTracking,
  onClose,
}) {
  const menuRef = useRef(null);
  const [submenuOpen, setSubmenuOpen] = useState(null);

  useEffect(() => {
    if (!menu) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    function onClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [menu, onClose]);

  useEffect(() => {
    setSubmenuOpen(null);
  }, [menu]);

  if (!menu) return null;

  return createPortal(
    <div
      ref={menuRef}
      className="wc-context-menu"
      style={{ top: menu.y, left: menu.x }}
      role="menu"
    >
      {canReassign ? (
        <div
          className="wc-context-has-submenu-wrap"
          onMouseEnter={() => setSubmenuOpen('reassign')}
          onMouseLeave={() => setSubmenuOpen(null)}
        >
          <button type="button" className="wc-context-menu-item wc-context-has-submenu">
            Reassign
            <span aria-hidden>›</span>
          </button>
          {submenuOpen === 'reassign' ? (
            <div className="wc-context-submenu" role="menu">
              {!operators?.length ? (
                <p className="wc-station-muted" style={{ padding: '8px 12px', margin: 0 }}>
                  No operators
                </p>
              ) : (
                operators.map((op) => (
                  <button
                    key={op.employee_id}
                    type="button"
                    className="wc-context-menu-item"
                    onClick={() => onReassign(menu.item, op.employee_id)}
                  >
                    <span className="mes-avatar" style={{ width: 22, height: 22, fontSize: 9 }}>
                      {initials(op.full_name)}
                    </span>
                    <span>
                      {op.full_name}
                      <span className="wc-context-load"> · {Number(op.total_qty ?? 0)}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {canPinActing ? (
        <div
          className="wc-context-has-submenu-wrap"
          onMouseEnter={() => setSubmenuOpen('acting')}
          onMouseLeave={() => setSubmenuOpen(null)}
        >
          <button type="button" className="wc-context-menu-item wc-context-has-submenu">
            Set acting manager
            <span aria-hidden>›</span>
          </button>
          {submenuOpen === 'acting' ? (
            <div className="wc-context-submenu" role="menu">
              {!operators?.length ? (
                <p className="wc-station-muted" style={{ padding: '8px 12px', margin: 0 }}>
                  No present operators
                </p>
              ) : (
                operators.map((op) => (
                  <button
                    key={`act-${op.employee_id}`}
                    type="button"
                    className="wc-context-menu-item"
                    onClick={() => onSetActingManager(op.employee_id)}
                  >
                    <span className="mes-avatar" style={{ width: 22, height: 22, fontSize: 9 }}>
                      {initials(op.full_name)}
                    </span>
                    <span>{op.full_name}</span>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        className="wc-context-menu-item"
        onClick={() => onOpenTracking(menu.item)}
      >
        Open tracking
      </button>
    </div>,
    document.body
  );
}

function WorkCenterStation({ wc, board, boardDate, onOpenCard, onContextMenu }) {
  const items = useMemo(() => buildJobItems(board), [board]);
  const { running, today } = useMemo(() => splitQueue(items, boardDate), [items, boardDate]);
  const loads = board?.operator_loads || [];

  const remaining = items.reduce((s, item) => s + remainingForItem(item), 0);
  const openCount = running.length + today.length;
  const completedToday = loads.reduce((s, op) => s + Number(op.completed_ops ?? 0), 0);
  const actingName = board?.acting_employee?.full_name || null;
  const actingPinned = !!board?.contingency_pinned;

  return (
    <section className="wc-station">
      <header className="wc-station-header">
        <div>
          <h3 className="wc-station-title">
            {wc.code} — {wc.name}
          </h3>
          <p className="wc-station-kpis">
            Remaining <strong>{remaining}</strong> · {openCount} open
            {completedToday > 0 ? ` · ${completedToday} done today` : ''}
          </p>
          {board?.manager_unavailable && actingName ? (
            <p className="wc-station-muted" style={{ margin: '4px 0 0' }}>
              Acting: {actingName}
              {actingPinned ? ' · pinned' : ''}
            </p>
          ) : board?.manager_unavailable ? (
            <p className="wc-station-muted" style={{ margin: '4px 0 0' }}>
              Manager absent — no acting manager yet
            </p>
          ) : null}
        </div>
        <OperatorAvatarStack operators={loads} />
      </header>

      <div className="wc-job-queue">
        {running.length > 0 ? (
          <div className="wc-queue-section">
            <p className="wc-section-label">Running now</p>
            {running.map((item) => (
              <BoardJobCard
                key={`${item.kind}-${item.id}`}
                item={item}
                onOpen={onOpenCard}
                onContextMenu={onContextMenu}
              />
            ))}
          </div>
        ) : null}
        {today.length > 0 ? (
          <div className="wc-queue-section">
            <p className="wc-section-label">Today&apos;s queue</p>
            {today.map((item) => (
              <BoardJobCard
                key={`${item.kind}-${item.id}`}
                item={item}
                onOpen={onOpenCard}
                onContextMenu={onContextMenu}
              />
            ))}
          </div>
        ) : null}
        {!running.length && !today.length ? (
          <p className="wc-station-muted">No work for this date</p>
        ) : null}
      </div>
    </section>
  );
}

export default function WorkCenterBoardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { joinWorkCenterRoom, leaveWorkCenterRoom } = useSocket();
  const [workCenters, setWorkCenters] = useState([]);
  const [date, setDate] = useState(todayStr());
  const [boards, setBoards] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [assignBusy, setAssignBusy] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const dateRef = useRef(date);
  const boardsRef = useRef(boards);
  const workCentersRef = useRef(workCenters);

  const canPinActingRole =
    user?.accessLevel === 'ADMIN' || user?.accessLevel === 'SUPERVISOR';

  useEffect(() => {
    dateRef.current = date;
  }, [date]);
  useEffect(() => {
    boardsRef.current = boards;
  }, [boards]);
  useEffect(() => {
    workCentersRef.current = workCenters;
  }, [workCenters]);

  useEffect(() => {
    api
      .get('/work-centers')
      .then(({ data }) => {
        const list = (data.work_centers || []).filter((w) => w.is_active !== false);
        setWorkCenters(list);
      })
      .catch(() => setWorkCenters([]));
  }, []);

  useEffect(() => {
    const ids = workCenters.map((w) => w.id).filter(Boolean);
    ids.forEach((id) => joinWorkCenterRoom(id));
    return () => {
      ids.forEach((id) => leaveWorkCenterRoom(id));
    };
  }, [workCenters, joinWorkCenterRoom, leaveWorkCenterRoom]);

  const loadBoards = useCallback(
    async ({ silent = false } = {}) => {
      if (!workCenters.length) {
        setBoards({});
        return;
      }
      if (!silent) setLoading(true);
      try {
        const results = await Promise.all(
          workCenters.map(async (wc) => {
            const { data } = await api.get(`/production/work-centers/${wc.id}/board`, {
              params: { date },
            });
            return [wc.id, data];
          })
        );
        setBoards(Object.fromEntries(results));
        setError(null);
      } catch (err) {
        setError(err.response?.data?.error || 'Unable to load work center boards.');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [workCenters, date]
  );

  const refreshBoard = useCallback(async (wcId) => {
    if (!wcId) return;
    try {
      const { data } = await api.get(`/production/work-centers/${wcId}/board`, {
        params: { date: dateRef.current },
      });
      setBoards((prev) => ({ ...prev, [wcId]: data }));
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    loadBoards();
  }, [loadBoards]);

  const applyBoardPatch = useCallback(
    (rawPayload) => {
      const payload = normalizePayload(rawPayload);
      const boardDate = dateRef.current;

      if (BULK_RELOAD_ACTIONS.has(payload.action)) {
        loadBoards({ silent: true });
        return;
      }

      const wcIds = new Set(
        [payload.workCenterId, payload.previousWorkCenterId].filter(Boolean)
      );
      if (!wcIds.size) return;

      let needsWcReload = false;
      const next = { ...boardsRef.current };

      for (const wcId of wcIds) {
        const patched = patchBoard(next[wcId], payload, boardDate);
        const found = patched._patchFound;
        const { _patchFound, ...clean } = patched;
        next[wcId] = clean;
        if (STRUCTURAL_WC_RELOAD.has(payload.action) || !found) {
          needsWcReload = true;
        }
      }

      setBoards(next);

      if (needsWcReload) {
        for (const wcId of wcIds) {
          refreshBoard(wcId);
        }
      }
    },
    [loadBoards, refreshBoard]
  );

  const onRealtime = useCallback(
    (payload) => {
      applyBoardPatch(payload);
    },
    [applyBoardPatch]
  );

  useProductionRealtime(onRealtime, [onRealtime]);

  const totalOpen = useMemo(
    () =>
      Object.values(boards).reduce((s, b) => {
        const items = buildJobItems(b).filter((item) => itemVisibleOnBoard(item.data, date));
        return s + items.length;
      }, 0),
    [boards, date]
  );

  async function handleAssignUnassigned() {
    setAssignBusy(true);
    setError(null);
    try {
      await api.post('/production/assign-unassigned', { date });
      await loadBoards({ silent: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to assign unassigned cards.');
    } finally {
      setAssignBusy(false);
    }
  }

  function handleContextMenu(e, item, wcId) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, item, wcId });
  }

  function closeContextMenu() {
    setContextMenu(null);
  }

  function handleOpenTracking(item) {
    const d = item.data;
    const cardId =
      item.kind === 'card' ? d.id : d.production_card_id || d.parent_production_card_id;
    closeContextMenu();
    if (cardId) navigate(`/production/cards/${cardId}`);
  }

  async function handleReassign(item, employeeId, wcId) {
    closeContextMenu();
    if (!employeeId) return;
    const d = item.data;
    if (employeeId === d.assigned_employee_id) return;

    setAssignBusy(true);
    setError(null);
    try {
      if (item.kind === 'op_card') {
        await api.post(`/production/op-cards/${d.id}/reassign`, {
          employee_id: employeeId,
          work_date: date,
        });
      } else if (item.kind === 'lot') {
        await api.post(`/production/lots/${d.id}/reassign`, {
          employee_id: employeeId,
          work_date: date,
        });
      } else {
        await api.post(`/production/cards/${d.id}/reassign`, {
          employee_id: employeeId,
          work_date: date,
        });
      }
      if (wcId) await refreshBoard(wcId);
    } catch (err) {
      const msg = err.response?.data?.error || 'Reassign failed.';
      setError(msg);
      await appAlert(msg);
    } finally {
      setAssignBusy(false);
    }
  }

  async function handleSetActingManager(employeeId, wcId) {
    closeContextMenu();
    if (!employeeId || !wcId) return;
    setAssignBusy(true);
    setError(null);
    try {
      await api.post(`/production/work-centers/${wcId}/acting-manager`, {
        employee_id: employeeId,
        work_date: date,
      });
      await refreshBoard(wcId);
      await appAlert({ title: 'Acting manager updated', tone: 'success' });
    } catch (err) {
      const msg = err.response?.data?.error || 'Could not set acting manager.';
      setError(msg);
      await appAlert(msg);
    } finally {
      setAssignBusy(false);
    }
  }

  const contextOperators = contextMenu?.wcId
    ? boards[contextMenu.wcId]?.operator_loads || []
    : [];
  const contextBoard = contextMenu?.wcId ? boards[contextMenu.wcId] : null;
  const contextCanReassign = !!contextBoard?.can_reassign;
  const contextCanPin =
    canPinActingRole && !!contextBoard?.can_pin_acting && !!contextBoard?.manager_unavailable;

  return (
    <main className="mes-shell">
      <PageHeader
        eyebrow="Shop floor"
        title="WC Board"
        subtitle={`Station view for ${formatDueLabel(date)}. Right-click a job to reassign when the WC manager is absent.`}
        actions={
          <>
            <button
              type="button"
              className="mes-btn mes-btn-secondary"
              onClick={() => navigate('/production/horizon-planner')}
            >
              Horizon Planner
            </button>
            <button
              type="button"
              className="mes-btn mes-btn-secondary"
              onClick={() => {
                const wcId = Object.keys(boards)[0];
                if (wcId) navigate(`/production/today?wc=${wcId}`);
                else appAlert('Select a work center on the board first.');
              }}
            >
              My Today
            </button>
            <button
              type="button"
              className="mes-btn mes-btn-secondary"
              onClick={() => navigate('/production/dispatch')}
            >
              Ready for Dispatch
            </button>
            <button
              type="button"
              className="mes-btn mes-btn-primary"
              disabled={assignBusy}
              onClick={handleAssignUnassigned}
            >
              {assignBusy ? 'Working…' : 'Fill unassigned'}
            </button>
          </>
        }
      />

      <div className="mes-filters">
        <label>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>

      {error ? <p className="error-message">{error}</p> : null}
      {loading ? <p className="muted">Loading stations…</p> : null}

      {!loading && !workCenters.length ? (
        <EmptyState
          icon={Factory}
          title="No work centers"
          description="Create work centers and link operators before using the board."
          actionLabel="Work Centers"
          onAction={() => navigate('/work-centers')}
        />
      ) : !loading && totalOpen === 0 ? (
        <EmptyState
          icon={Factory}
          title="No cards on this date"
          description="Release schedules to the floor, or pick another date. Stations still show operator load."
        />
      ) : null}

      <div className="wc-station-grid">
        {workCenters.map((wc) => (
          <WorkCenterStation
            key={wc.id}
            wc={wc}
            board={boards[wc.id]}
            boardDate={date}
            onOpenCard={(cardId) => navigate(`/production/cards/${cardId}`)}
            onContextMenu={(e, item) => handleContextMenu(e, item, wc.id)}
          />
        ))}
      </div>

      <BoardContextMenu
        menu={contextMenu}
        operators={contextOperators}
        canReassign={contextCanReassign}
        canPinActing={contextCanPin}
        onReassign={(item, employeeId) =>
          handleReassign(item, employeeId, contextMenu?.wcId)
        }
        onSetActingManager={(employeeId) =>
          handleSetActingManager(employeeId, contextMenu?.wcId)
        }
        onOpenTracking={handleOpenTracking}
        onClose={closeContextMenu}
      />
    </main>
  );
}
