import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from '@dnd-kit/core';
import { Factory } from 'lucide-react';
import api from '../api/client';
import { formatDueLabel } from '../blanketPos/scheduleLabels';
import { useSocket, useProductionRealtime } from '../socket/socketContext';
import {
  PageHeader,
  StatusBadge,
  EmptyState,
  TruncatedText,
} from '../components/mes';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/** Prefer operator chips when nested/overlapping with WC column droppables. */
function preferOperatorCollisions(collisions) {
  if (!collisions?.length) return collisions;
  const ops = collisions.filter((c) => String(c.id).startsWith('op:'));
  return ops.length ? ops : collisions;
}

function boardCollisionDetection(args) {
  const pointerHits = preferOperatorCollisions(pointerWithin(args));
  if (pointerHits.length) return pointerHits;
  const rectHits = preferOperatorCollisions(rectIntersection(args));
  if (rectHits.length) return rectHits;
  return preferOperatorCollisions(closestCenter(args));
}

function resolveDropTarget(over) {
  if (!over) return null;
  const data = over.data?.current;
  if (data?.type === 'operator' || data?.type === 'wc-column') return data;

  const id = String(over.id || '');
  if (id.startsWith('op:')) {
    // id format: op:<workCenterUuid>:<employeeUuid>
    const rest = id.slice(3);
    const splitAt = rest.indexOf(':');
    if (splitAt > 0) {
      return {
        type: 'operator',
        wcId: rest.slice(0, splitAt),
        employeeId: rest.slice(splitAt + 1),
      };
    }
  }
  if (id.startsWith('wc:')) {
    return { type: 'wc-column', wcId: id.slice(3) };
  }
  return data || null;
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

function KanbanCard({ card, dragging, onOpen }) {
  const remaining = Number(
    card.remaining_qty ??
      Math.max(
        0,
        Number(card.day_goal ?? Number(card.target_quantity) + Number(card.overdue_quantity)) -
          Number(card.total_good_produced || 0)
      )
  );
  const title = [
    card.component_label,
    card.customer_name,
    `Due ${card.schedule_due_date || '—'}`,
    card.assigned_employee_name || 'Unassigned',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={`mes-kanban-card${dragging ? ' is-dragging' : ''}`} title={title}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <button
          type="button"
          className="pc-card-link"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onOpen?.(card.id);
          }}
        >
          {card.card_number}
        </button>
        <StatusBadge status={card.status} />
      </div>
      <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text-secondary)' }}>
        Remaining: <strong style={{ color: 'var(--text-primary)' }}>{remaining}</strong>
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="mes-avatar">{initials(card.assigned_employee_name)}</span>
        <TruncatedText style={{ fontSize: 12 }}>
          {card.assigned_employee_name || 'Unassigned'}
        </TruncatedText>
      </div>
    </div>
  );
}

function KanbanLotCard({ lot, dragging, onOpen }) {
  const title = [
    lot.component_label,
    lot.current_node_label,
    lot.assigned_employee_name || 'Unassigned',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={`mes-kanban-card${dragging ? ' is-dragging' : ''}`} title={title}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <button
          type="button"
          className="pc-card-link"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (lot.production_card_id) onOpen?.(lot.production_card_id);
          }}
        >
          {lot.lot_number}
        </button>
        <StatusBadge status={lot.status || 'in_process'} />
      </div>
      <p style={{ margin: '0 0 4px', fontSize: 12, color: 'var(--text-secondary)' }}>
        Lot · Qty <strong style={{ color: 'var(--text-primary)' }}>{Number(lot.quantity || 0)}</strong>
      </p>
      {lot.current_node_label ? (
        <p style={{ margin: '0 0 8px', fontSize: 11, color: 'var(--text-secondary)' }}>
          {lot.current_node_label}
          {lot.current_node_type ? ` · ${lot.current_node_type}` : ''}
        </p>
      ) : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="mes-avatar">{initials(lot.assigned_employee_name)}</span>
        <TruncatedText style={{ fontSize: 12 }}>
          {lot.assigned_employee_name || 'Unassigned'}
        </TruncatedText>
      </div>
    </div>
  );
}

function DraggableCard({ card, wcId, onOpen }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `card:${card.id}`,
    data: { type: 'card', card, wcId },
  });

  return (
    <div ref={setNodeRef} {...listeners} {...attributes} style={{ opacity: isDragging ? 0.4 : 1 }}>
      <KanbanCard card={card} onOpen={onOpen} />
    </div>
  );
}

function DraggableLot({ lot, wcId, onOpen }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `lot:${lot.id}`,
    data: { type: 'lot', lot, wcId },
  });

  return (
    <div ref={setNodeRef} {...listeners} {...attributes} style={{ opacity: isDragging ? 0.4 : 1 }}>
      <KanbanLotCard lot={lot} onOpen={onOpen} />
    </div>
  );
}

function KanbanOpCard({ op, dragging, onOpen }) {
  const remaining = Math.max(0, Number(op.target_quantity || 0) - Number(op.good_qty || 0));
  const title = [
    op.component_label,
    op.current_node_label,
    op.assigned_employee_name || 'Unassigned',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={`mes-kanban-card${dragging ? ' is-dragging' : ''}`} title={title}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <button
          type="button"
          className="pc-card-link"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (op.production_card_id) onOpen?.(op.production_card_id);
          }}
        >
          {op.op_card_number}
        </button>
        <StatusBadge status={op.status || 'READY'} />
      </div>
      <p style={{ margin: '0 0 4px', fontSize: 12, color: 'var(--text-secondary)' }}>
        Op card · Remaining{' '}
        <strong style={{ color: 'var(--text-primary)' }}>{remaining}</strong>
      </p>
      {op.current_node_label ? (
        <p style={{ margin: '0 0 8px', fontSize: 11, color: 'var(--text-secondary)' }}>
          {op.current_node_label}
          {op.lot_number ? ` · ${op.lot_number}` : ''}
        </p>
      ) : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="mes-avatar">{initials(op.assigned_employee_name)}</span>
        <TruncatedText style={{ fontSize: 12 }}>
          {op.assigned_employee_name || 'Unassigned'}
        </TruncatedText>
      </div>
    </div>
  );
}

function DraggableOpCard({ op, wcId, onOpen }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `opcard:${op.id}`,
    data: { type: 'op_card', op, wcId },
  });

  return (
    <div ref={setNodeRef} {...listeners} {...attributes} style={{ opacity: isDragging ? 0.4 : 1 }}>
      <KanbanOpCard op={op} onOpen={onOpen} />
    </div>
  );
}

function OperatorDropChip({ operator, wcId }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `op:${wcId}:${operator.employee_id}`,
    data: { type: 'operator', wcId, employeeId: operator.employee_id },
  });

  const openBacklog = Number(operator.backlog ?? 0);
  const completedOps = Number(operator.completed_ops ?? 0);
  const totalQty = Number(operator.total_qty ?? openBacklog);
  const title = [
    `Open backlog: ${openBacklog}`,
    completedOps ? `Completed ops today: ${completedOps}` : null,
    `Day load: ${totalQty}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      ref={setNodeRef}
      className={`mes-op-chip${isOver ? ' is-over' : ''}`}
      title={title}
    >
      <span className="mes-avatar" style={{ width: 22, height: 22, fontSize: 9 }}>
        {initials(operator.full_name)}
      </span>
      {operator.full_name?.split(' ')[0] || 'Op'}
      <span style={{ opacity: 0.7 }}>
        ·{totalQty}
        {completedOps > 0 ? ` (${completedOps}✓)` : ''}
      </span>
    </div>
  );
}

function WcColumn({ wc, board, onOpenCard }) {
  const opCards = board?.op_cards || [];
  const useOps = opCards.length > 0;
  const cards = useOps ? [] : board?.cards || [];
  const lots = useOps ? [] : board?.lots || [];
  const loads = board?.operator_loads || [];
  const remaining = useOps
    ? opCards.reduce(
        (s, o) => s + Math.max(0, Number(o.target_quantity || 0) - Number(o.good_qty || 0)),
        0
      )
    : cards.reduce(
        (s, c) =>
          s +
          Number(
            c.remaining_qty ??
              Math.max(
                0,
                Number(c.day_goal ?? Number(c.target_quantity) + Number(c.overdue_quantity)) -
                  Number(c.total_good_produced || 0)
              )
          ),
        0
      ) + lots.reduce((s, l) => s + Number(l.quantity || 0), 0);

  // Column droppable is cards-only so operator chips are not nested underneath it
  const { setNodeRef } = useDroppable({
    id: `wc:${wc.id}`,
    data: { type: 'wc-column', wcId: wc.id },
  });

  return (
    <div className="mes-kanban-col">
      <div className="mes-kanban-col-header">
        <h3>
          {wc.code} — {wc.name}
        </h3>
        <p>
          Remaining backlog <strong>{remaining}</strong>
          {useOps
            ? ` · ${opCards.length} op card${opCards.length === 1 ? '' : 's'}`
            : ` · ${cards.length} card${cards.length === 1 ? '' : 's'}${
                lots.length ? ` · ${lots.length} lot${lots.length === 1 ? '' : 's'}` : ''
              }`}
        </p>
        {(() => {
          const completedToday = loads.reduce(
            (s, op) => s + Number(op.completed_ops ?? 0),
            0
          );
          return completedToday > 0 ? (
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
              Completed today: {completedToday} op{completedToday === 1 ? '' : 's'}
            </p>
          ) : null;
        })()}
        {loads.length ? (
          <div className="mes-op-drop">
            {loads.map((op) => (
              <OperatorDropChip key={op.employee_id} operator={op} wcId={wc.id} />
            ))}
          </div>
        ) : (
          <p style={{ marginTop: 6 }}>No operators linked</p>
        )}
      </div>
      <div className="mes-kanban-cards" ref={setNodeRef}>
        {opCards.map((op) => (
          <DraggableOpCard key={op.id} op={op} wcId={wc.id} onOpen={onOpenCard} />
        ))}
        {lots.map((lot) => (
          <DraggableLot key={lot.id} lot={lot} wcId={wc.id} onOpen={onOpenCard} />
        ))}
        {cards.map((card) => (
          <DraggableCard key={card.id} card={card} wcId={wc.id} onOpen={onOpenCard} />
        ))}
        {!opCards.length && !cards.length && !lots.length ? (
          <p className="muted" style={{ fontSize: 12, padding: 8, margin: 0 }}>
            Empty queue
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default function WorkCenterBoardPage() {
  const navigate = useNavigate();
  const { joinWorkCenterRoom, leaveWorkCenterRoom } = useSocket();
  const [workCenters, setWorkCenters] = useState([]);
  const [date, setDate] = useState(todayStr());
  const [boards, setBoards] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [assignBusy, setAssignBusy] = useState(false);
  const [activeCard, setActiveCard] = useState(null);
  const [activeLot, setActiveLot] = useState(null);
  const [activeOpCard, setActiveOpCard] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  useEffect(() => {
    api
      .get('/work-centers')
      .then(({ data }) => {
        const list = (data.work_centers || []).filter((w) => w.is_active !== false);
        setWorkCenters(list);
      })
      .catch(() => setWorkCenters([]));
  }, []);

  // Join every active WC room for live kanban sync
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

  useEffect(() => {
    loadBoards();
  }, [loadBoards]);

  const onRealtime = useCallback(() => {
    loadBoards({ silent: true });
  }, [loadBoards]);

  useProductionRealtime(onRealtime, [onRealtime]);

  const totalCards = useMemo(
    () =>
      Object.values(boards).reduce(
        (s, b) =>
          s +
          (b?.op_cards?.length || 0) +
          (b?.op_cards?.length
            ? 0
            : (b?.cards?.length || 0) + (b?.lots?.length || 0)),
        0
      ),
    [boards]
  );

  async function handleAssignUnassigned() {
    setAssignBusy(true);
    setError(null);
    try {
      await api.post('/production/assign-unassigned', { date });
      await loadBoards();
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to assign unassigned cards.');
    } finally {
      setAssignBusy(false);
    }
  }

  async function handleDragEnd(event) {
    setActiveCard(null);
    setActiveLot(null);
    setActiveOpCard(null);
    const { active, over } = event;
    if (!over) return;

    const itemType = active.data.current?.type;
    const card = active.data.current?.card;
    const lot = active.data.current?.lot;
    const opCard = active.data.current?.op;
    const fromWc = active.data.current?.wcId;
    const overData = resolveDropTarget(over);

    if (!card && !lot && !opCard) return;
    if (!overData) return;

    // Block cross-WC moves
    if (overData.type === 'wc-column' && overData.wcId !== fromWc) {
      setError('Items stay on their Activity Flow work center — reassign operators within the same lane.');
      return;
    }

    if (overData.type !== 'operator') return;

    if (overData.wcId !== fromWc) {
      setError('Cannot move work to an operator on a different work center.');
      return;
    }

    const employeeId = overData.employeeId;
    if (!employeeId) return;

    if (itemType === 'op_card') {
      if (!opCard?.id) return;
      if (employeeId === opCard.assigned_employee_id) return;
      setAssignBusy(true);
      setError(null);
      try {
        await api.post(`/production/op-cards/${opCard.id}/reassign`, {
          employee_id: employeeId,
        });
        await loadBoards({ silent: true });
      } catch (err) {
        setError(err.response?.data?.error || 'Op card reassign failed.');
      } finally {
        setAssignBusy(false);
      }
      return;
    }

    if (itemType === 'lot') {
      if (!lot?.id) return;
      if (employeeId === lot.assigned_employee_id) return;
      setAssignBusy(true);
      setError(null);
      try {
        await api.post(`/production/lots/${lot.id}/reassign`, {
          employee_id: employeeId,
        });
        await loadBoards({ silent: true });
      } catch (err) {
        setError(err.response?.data?.error || 'Lot reassign failed.');
      } finally {
        setAssignBusy(false);
      }
      return;
    }

    if (!card?.id) return;
    if (employeeId === card.assigned_employee_id) return;
    setAssignBusy(true);
    setError(null);
    try {
      await api.post(`/production/cards/${card.id}/reassign`, {
        employee_id: employeeId,
      });
      await loadBoards({ silent: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Reassign failed.');
    } finally {
      setAssignBusy(false);
    }
  }

  return (
    <main className="mes-shell">
      <PageHeader
        eyebrow="Shop floor"
        title="WC Board"
        subtitle={`Multi-lane queue for ${formatDueLabel(date)}. Operation cards — drag onto an operator chip in the same lane to reassign.`}
        actions={
          <>
            <button type="button" className="mes-btn mes-btn-secondary" onClick={() => navigate('/production')}>
              Production
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
      {loading ? <p className="muted">Loading lanes…</p> : null}

      {!loading && !workCenters.length ? (
        <EmptyState
          icon={Factory}
          title="No work centers"
          description="Create work centers and link operators before using the board."
          actionLabel="Work Centers"
          onAction={() => navigate('/work-centers')}
        />
      ) : !loading && totalCards === 0 ? (
        <EmptyState
          icon={Factory}
          title="No cards on this date"
          description="Release schedules to the floor, or pick another date. Empty lanes still show operator load."
        />
      ) : null}

      <DndContext
        sensors={sensors}
        collisionDetection={boardCollisionDetection}
        onDragStart={(e) => {
          setActiveCard(e.active.data.current?.card || null);
          setActiveLot(e.active.data.current?.lot || null);
          setActiveOpCard(e.active.data.current?.op || null);
        }}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setActiveCard(null);
          setActiveLot(null);
          setActiveOpCard(null);
        }}
      >
        <div className="mes-kanban">
          {workCenters.map((wc) => (
            <WcColumn
              key={wc.id}
              wc={wc}
              board={boards[wc.id]}
              onOpenCard={(cardId) => navigate(`/production/cards/${cardId}`)}
            />
          ))}
        </div>
        <DragOverlay>
          {activeOpCard ? (
            <KanbanOpCard op={activeOpCard} dragging />
          ) : activeLot ? (
            <KanbanLotCard lot={activeLot} dragging />
          ) : activeCard ? (
            <KanbanCard card={activeCard} dragging />
          ) : null}
        </DragOverlay>
      </DndContext>
    </main>
  );
}
