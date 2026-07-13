import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
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

function DraggableCard({ card, wcId, onOpen }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.id,
    data: { type: 'card', card, wcId },
  });

  return (
    <div ref={setNodeRef} {...listeners} {...attributes} style={{ opacity: isDragging ? 0.4 : 1 }}>
      <KanbanCard card={card} onOpen={onOpen} />
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
  const cards = board?.cards || [];
  const loads = board?.operator_loads || [];
  const remaining = cards.reduce(
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
  );

  const { setNodeRef } = useDroppable({
    id: `wc:${wc.id}`,
    data: { type: 'wc-column', wcId: wc.id },
  });

  return (
    <div className="mes-kanban-col" ref={setNodeRef}>
      <div className="mes-kanban-col-header">
        <h3>
          {wc.code} — {wc.name}
        </h3>
        <p>
          Remaining backlog <strong>{remaining}</strong> · {cards.length} card
          {cards.length === 1 ? '' : 's'}
        </p>
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
      <div className="mes-kanban-cards">
        {cards.map((card) => (
          <DraggableCard key={card.id} card={card} wcId={wc.id} onOpen={onOpenCard} />
        ))}
        {!cards.length ? (
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
    () => Object.values(boards).reduce((s, b) => s + (b?.cards?.length || 0), 0),
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
    const { active, over } = event;
    if (!over) return;

    const card = active.data.current?.card;
    const fromWc = active.data.current?.wcId;
    const overData = over.data.current;

    if (!card) return;

    // Block cross-WC moves
    if (overData?.type === 'wc-column' && overData.wcId !== fromWc) {
      setError('Cards stay on their Activity Flow work center — reassign operators within the same lane.');
      return;
    }

    if (overData?.type === 'operator') {
      if (overData.wcId !== fromWc) {
        setError('Cannot move a card to an operator on a different work center.');
        return;
      }
      if (overData.employeeId === card.assigned_employee_id) return;
      setAssignBusy(true);
      setError(null);
      try {
        await api.post(`/production/cards/${card.id}/reassign`, {
          employee_id: overData.employeeId,
        });
        await loadBoards({ silent: true });
      } catch (err) {
        setError(err.response?.data?.error || 'Reassign failed.');
      } finally {
        setAssignBusy(false);
      }
    }
  }

  return (
    <main className="mes-shell">
      <PageHeader
        eyebrow="Shop floor"
        title="WC Board"
        subtitle={`Multi-lane queue for ${formatDueLabel(date)}. Drag a card onto an operator chip in the same lane to reassign.`}
        actions={
          <>
            <button type="button" className="mes-btn mes-btn-secondary" onClick={() => navigate('/production')}>
              Production
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
        onDragStart={(e) => setActiveCard(e.active.data.current?.card || null)}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveCard(null)}
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
        <DragOverlay>{activeCard ? <KanbanCard card={activeCard} dragging /> : null}</DragOverlay>
      </DndContext>
    </main>
  );
}
