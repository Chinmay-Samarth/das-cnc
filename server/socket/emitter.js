let io = null;

function setIo(instance) {
  io = instance;
}

function getIo() {
  return io;
}

function emitAttendanceUpdated(payload) {
  if (!io) return;
  io.to('attendance').emit('attendance:updated', payload);
}

function emitGirnUpdated(payload) {
  if (!io) return;
  const { girnId } = payload;
  io.to('girns').emit('girn:updated', payload);
  if (girnId) {
    io.to(`girn:${girnId}`).emit('girn:updated', payload);
  }
}

function emitBomUpdated(payload) {
  if (!io) return;
  const { recordId } = payload;
  io.to('boms').emit('bom:updated', payload);
  if (recordId) {
    io.to(`bom:${recordId}`).emit('bom:updated', payload);
  }
}

/**
 * Core production fan-out. Also targets WC rooms when workCenterId(s) present.
 * @param {{
 *   action: string,
 *   cardId?: string,
 *   employeeId?: string,
 *   previousEmployeeId?: string,
 *   workCenterId?: string,
 *   previousWorkCenterId?: string,
 *   deliveryScheduleId?: string,
 *   blanketPoId?: string,
 *   status?: string,
 *   cardIds?: string[],
 * }} payload
 */
function emitProductionUpdated(payload) {
  if (!io) return;
  io.to('production').emit('production:updated', payload);

  if (payload.cardId) {
    io.to(`production-card:${payload.cardId}`).emit('production:updated', payload);
  }
  if (payload.employeeId) {
    io.to(`production-employee:${payload.employeeId}`).emit('production:updated', payload);
  }
  if (payload.previousEmployeeId && payload.previousEmployeeId !== payload.employeeId) {
    io.to(`production-employee:${payload.previousEmployeeId}`).emit('production:updated', payload);
  }

  const wcIds = new Set(
    [payload.workCenterId, payload.previousWorkCenterId].filter(Boolean)
  );
  for (const wcId of wcIds) {
    io.to(`wc:${wcId}`).emit('production:updated', payload);
  }

  if (payload.deliveryScheduleId) {
    io.to('delivery-schedules').emit('delivery-schedule:updated', {
      action: 'production_linked',
      scheduleId: payload.deliveryScheduleId,
      blanketPoId: payload.blanketPoId || null,
    });
  }
}

/**
 * Operator terminal log catalyst (alias / dedicated channel).
 * Payload: { production_card_id, operator_id, quantity_good, quantity_scrap, ... }
 */
function emitProductionLogSubmitted(payload) {
  if (!io) return;
  const event = 'production:log-submitted';
  io.to('production').emit(event, payload);
  if (payload.work_center_id) {
    io.to(`wc:${payload.work_center_id}`).emit(event, payload);
  }
  if (payload.operator_id) {
    io.to(`production-employee:${payload.operator_id}`).emit(event, payload);
  }
  if (payload.production_card_id) {
    io.to(`production-card:${payload.production_card_id}`).emit(event, payload);
  }
}

/**
 * Inventory backflush dedicated channel (also keeps inventory:updated).
 */
function emitInventoryBackflushed(payload) {
  if (!io) return;
  io.to('inventory').emit('inventory:backflushed', payload);
  io.to('inventory').emit('inventory:updated', {
    action: 'backflush',
    ...payload,
  });
}

/**
 * Dynamic handoff after EQL / auto-assign.
 * Payload: { task_id, operator_id, sequence_number, allocated_load_mins, work_center_id, ... }
 */
function emitTaskAssigned(payload) {
  if (!io) return;
  const event = 'task:assigned';
  io.to('production').emit(event, payload);
  if (payload.work_center_id) {
    io.to(`wc:${payload.work_center_id}`).emit(event, payload);
  }
  if (payload.operator_id) {
    io.to(`production-employee:${payload.operator_id}`).emit(event, payload);
    // Direct sockets if present
    try {
      const { getSocketIdsForEmployee } = require('./presence');
      for (const sid of getSocketIdsForEmployee(payload.operator_id)) {
        io.to(sid).emit(event, payload);
      }
    } catch {
      /* presence optional */
    }
  }
}

/**
 * Kanban board sync for a work center room.
 * Payload: { work_center_id, card_id, status, from_status?, action, ... }
 */
function emitBoardUpdate(payload) {
  if (!io) return;
  const event = 'board:update';
  const wcIds = new Set(
    [payload.work_center_id, payload.previous_work_center_id].filter(Boolean)
  );
  if (!wcIds.size) {
    io.to('production').emit(event, payload);
    return;
  }
  for (const wcId of wcIds) {
    io.to(`wc:${wcId}`).emit(event, payload);
  }
  io.to('production').emit(event, payload);
}

/**
 * @param {{ action: string, scheduleId?: string, blanketPoId?: string, ruleId?: string, lineId?: string }} payload
 */
function emitDeliveryScheduleUpdated(payload) {
  if (!io) return;
  io.to('delivery-schedules').emit('delivery-schedule:updated', payload);
  if (payload.blanketPoId) {
    io.to(`blanket-po:${payload.blanketPoId}`).emit('delivery-schedule:updated', payload);
  }
  if (payload.scheduleId) {
    io.to(`delivery-schedule:${payload.scheduleId}`).emit('delivery-schedule:updated', payload);
  }
}

/**
 * @param {{ action: string, masterRecordId?: string, itemCategory?: string, stockId?: string }} payload
 */
function emitInventoryUpdated(payload) {
  if (!io) return;
  io.to('inventory').emit('inventory:updated', payload);
}

/**
 * Emit directly to an employee's connected sockets (and their employee room).
 */
function emitToEmployee(employeeId, event, payload) {
  if (!io || !employeeId) return;
  io.to(`production-employee:${employeeId}`).emit(event, payload);
  try {
    const { getSocketIdsForEmployee } = require('./presence');
    for (const sid of getSocketIdsForEmployee(employeeId)) {
      io.to(sid).emit(event, payload);
    }
  } catch {
    /* ignore */
  }
}

module.exports = {
  setIo,
  getIo,
  emitAttendanceUpdated,
  emitGirnUpdated,
  emitBomUpdated,
  emitProductionUpdated,
  emitProductionLogSubmitted,
  emitInventoryBackflushed,
  emitTaskAssigned,
  emitBoardUpdate,
  emitDeliveryScheduleUpdated,
  emitInventoryUpdated,
  emitToEmployee,
};
