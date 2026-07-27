const {
  emitProductionUpdated,
  emitProductionLogSubmitted,
  emitTaskAssigned,
  emitBoardUpdate,
} = require('./emitter');

/**
 * Unified production realtime fan-out after mutations (progress, complete, assign, advance).
 * Supports schedule cards and lot travelers (lotId / workCenterId on board + task events).
 */
function broadcastProductionRealtime({
  action,
  card = {},
  lot = null,
  opCard = null,
  assignee = null,
  operatorId = null,
  quantityGood = null,
  quantityScrap = null,
  previousEmployeeId = null,
  previousWorkCenterId = null,
  advance = null,
  cardIds = null,
} = {}) {
  const workCenterId =
    opCard?.work_center_id || lot?.work_center_id || card.work_center_id || null;
  const employeeId =
    opCard?.assigned_employee_id ||
    lot?.assigned_employee_id ||
    card.assigned_employee_id ||
    assignee?.employee_id ||
    assignee?.id ||
    null;
  const cardId = card.id || lot?.production_card_id || opCard?.parent_production_card_id || null;
  const lotId = lot?.id || opCard?.production_lot_id || null;
  const opCardId = opCard?.id || null;
  const workDate = opCard?.work_date || card.work_date || lot?.work_date || null;
  const status = opCard?.status || lot?.status || card.status || null;

  const assignedEmployee =
    assignee && (assignee.full_name || assignee.employee_id || assignee.id)
      ? {
          id: assignee.employee_id || assignee.id || employeeId,
          full_name: assignee.full_name || opCard?.assigned_employee_name || null,
        }
      : employeeId && (opCard?.assigned_employee_name || card.assigned_employee_name || lot?.assigned_employee_name)
        ? {
            id: employeeId,
            full_name:
              opCard?.assigned_employee_name ||
              card.assigned_employee_name ||
              lot?.assigned_employee_name ||
              null,
          }
        : null;

  const base = {
    action,
    cardId,
    lotId,
    opCardId,
    employeeId,
    previousEmployeeId: previousEmployeeId || null,
    workCenterId,
    previousWorkCenterId: previousWorkCenterId || null,
    deliveryScheduleId: card.delivery_schedule_id || null,
    blanketPoId: card.blanket_po_id || null,
    status,
    workDate,
    cardNumber: card.card_number || opCard?.op_card_number || null,
    lotNumber: lot?.lot_number || opCard?.lot_number || null,
    quantityGood,
    quantityScrap,
    cardIds: cardIds || (cardId ? [cardId] : []),
    advanced: !!(advance && advance.advanced),
    assignedEmployee,
  };

  emitProductionUpdated(base);

  if (
    action === 'progress' ||
    action === 'completed' ||
    action === 'advanced' ||
    action === 'lot_advanced' ||
    action === 'lot_created' ||
    action === 'op_started' ||
    action === 'op_reassigned'
  ) {
    emitProductionLogSubmitted({
      production_card_id: cardId,
      production_lot_id: lotId,
      op_card_id: opCardId,
      operator_id: operatorId || previousEmployeeId || employeeId,
      quantity_good: quantityGood,
      quantity_scrap: quantityScrap,
      work_center_id: previousWorkCenterId || workCenterId,
      status,
      action,
    });
  }

  emitBoardUpdate({
    work_center_id: workCenterId,
    previous_work_center_id: previousWorkCenterId,
    card_id: cardId,
    lot_id: lotId,
    op_card_id: opCardId,
    status,
    action,
    work_date: workDate,
    assigned_employee_id: employeeId,
    previous_employee_id: previousEmployeeId || null,
    assigned_employee: assignedEmployee,
    card_number: card.card_number || opCard?.op_card_number || null,
    lot_number: lot?.lot_number || opCard?.lot_number || null,
    op_card_number: opCard?.op_card_number || null,
  });

  // Handoff / fresh assignment → next operator My Today
  const assignActions = new Set([
    'advanced',
    'reassigned',
    'op_reassigned',
    'assign_unassigned',
    'released',
    'lot_created',
    'lot_advanced',
    'lot_reassigned',
    'lot_ready_for_dispatch',
  ]);
  const assignedTo =
    employeeId &&
    (assignActions.has(action) || (action === 'completed' && advance?.advanced));

  if (assignedTo && employeeId) {
    emitTaskAssigned({
      task_id: opCardId || lotId || cardId,
      op_card_id: opCardId,
      lot_id: lotId,
      card_id: cardId,
      operator_id: employeeId,
      sequence_number: card.current_node_sequence ?? opCard?.current_node_sequence ?? null,
      allocated_load_mins: null,
      work_center_id: workCenterId,
      card_number: card.card_number || opCard?.op_card_number || null,
      lot_number: lot?.lot_number || opCard?.lot_number || null,
      status,
      action,
    });
  }
}

module.exports = {
  broadcastProductionRealtime,
};
