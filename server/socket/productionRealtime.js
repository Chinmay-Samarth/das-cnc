const {
  emitProductionUpdated,
  emitProductionLogSubmitted,
  emitTaskAssigned,
  emitBoardUpdate,
} = require('./emitter');

/**
 * Unified production realtime fan-out after mutations (progress, complete, assign, advance).
 */
function broadcastProductionRealtime({
  action,
  card = {},
  operatorId = null,
  quantityGood = null,
  quantityScrap = null,
  previousEmployeeId = null,
  previousWorkCenterId = null,
  advance = null,
  cardIds = null,
} = {}) {
  const workCenterId = card.work_center_id || null;
  const employeeId = card.assigned_employee_id || null;
  const cardId = card.id || null;

  const base = {
    action,
    cardId,
    employeeId,
    previousEmployeeId: previousEmployeeId || null,
    workCenterId,
    previousWorkCenterId: previousWorkCenterId || null,
    deliveryScheduleId: card.delivery_schedule_id || null,
    blanketPoId: card.blanket_po_id || null,
    status: card.status || null,
    cardNumber: card.card_number || null,
    quantityGood,
    quantityScrap,
    cardIds: cardIds || (cardId ? [cardId] : []),
    advanced: !!(advance && advance.advanced),
  };

  emitProductionUpdated(base);

  if (action === 'progress' || action === 'completed' || action === 'advanced') {
    emitProductionLogSubmitted({
      production_card_id: cardId,
      operator_id: operatorId || previousEmployeeId || employeeId,
      quantity_good: quantityGood,
      quantity_scrap: quantityScrap,
      work_center_id: previousWorkCenterId || workCenterId,
      status: card.status || null,
      action,
    });
  }

  emitBoardUpdate({
    work_center_id: workCenterId,
    previous_work_center_id: previousWorkCenterId,
    card_id: cardId,
    status: card.status || null,
    action,
    assigned_employee_id: employeeId,
    card_number: card.card_number || null,
  });

  // Handoff / fresh assignment → next operator My Today
  const assignedTo =
    employeeId &&
    (action === 'advanced' ||
      action === 'reassigned' ||
      action === 'assign_unassigned' ||
      action === 'released' ||
      (action === 'completed' && advance?.advanced));

  if (assignedTo && employeeId) {
    emitTaskAssigned({
      task_id: cardId,
      operator_id: employeeId,
      sequence_number: card.current_node_sequence ?? null,
      allocated_load_mins: null,
      work_center_id: workCenterId,
      card_number: card.card_number || null,
      status: card.status || null,
      action,
    });
  }
}

module.exports = {
  broadcastProductionRealtime,
};
