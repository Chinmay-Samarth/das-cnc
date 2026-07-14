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
  operatorId = null,
  quantityGood = null,
  quantityScrap = null,
  previousEmployeeId = null,
  previousWorkCenterId = null,
  advance = null,
  cardIds = null,
} = {}) {
  const workCenterId = lot?.work_center_id || card.work_center_id || null;
  const employeeId = lot?.assigned_employee_id || card.assigned_employee_id || null;
  const cardId = card.id || lot?.production_card_id || null;
  const lotId = lot?.id || null;

  const base = {
    action,
    cardId,
    lotId,
    employeeId,
    previousEmployeeId: previousEmployeeId || null,
    workCenterId,
    previousWorkCenterId: previousWorkCenterId || null,
    deliveryScheduleId: card.delivery_schedule_id || null,
    blanketPoId: card.blanket_po_id || null,
    status: lot?.status || card.status || null,
    cardNumber: card.card_number || null,
    lotNumber: lot?.lot_number || null,
    quantityGood,
    quantityScrap,
    cardIds: cardIds || (cardId ? [cardId] : []),
    advanced: !!(advance && advance.advanced),
  };

  emitProductionUpdated(base);

  if (
    action === 'progress' ||
    action === 'completed' ||
    action === 'advanced' ||
    action === 'lot_advanced' ||
    action === 'lot_created'
  ) {
    emitProductionLogSubmitted({
      production_card_id: cardId,
      production_lot_id: lotId,
      operator_id: operatorId || previousEmployeeId || employeeId,
      quantity_good: quantityGood,
      quantity_scrap: quantityScrap,
      work_center_id: previousWorkCenterId || workCenterId,
      status: lot?.status || card.status || null,
      action,
    });
  }

  emitBoardUpdate({
    work_center_id: workCenterId,
    previous_work_center_id: previousWorkCenterId,
    card_id: cardId,
    lot_id: lotId,
    status: lot?.status || card.status || null,
    action,
    assigned_employee_id: employeeId,
    card_number: card.card_number || null,
    lot_number: lot?.lot_number || null,
  });

  // Handoff / fresh assignment → next operator My Today
  const assignActions = new Set([
    'advanced',
    'reassigned',
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
      task_id: lotId || cardId,
      lot_id: lotId,
      card_id: cardId,
      operator_id: employeeId,
      sequence_number: card.current_node_sequence ?? null,
      allocated_load_mins: null,
      work_center_id: workCenterId,
      card_number: card.card_number || null,
      lot_number: lot?.lot_number || null,
      status: lot?.status || card.status || null,
      action,
    });
  }
}

module.exports = {
  broadcastProductionRealtime,
};
