let io = null;

function setIo(instance) {
  io = instance;
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
 * @param {{ action: string, cardId?: string, employeeId?: string, deliveryScheduleId?: string, blanketPoId?: string }} payload
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
  if (payload.deliveryScheduleId) {
    io.to('delivery-schedules').emit('delivery-schedule:updated', {
      action: 'production_linked',
      scheduleId: payload.deliveryScheduleId,
      blanketPoId: payload.blanketPoId || null,
    });
  }
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

module.exports = {
  setIo,
  emitAttendanceUpdated,
  emitGirnUpdated,
  emitBomUpdated,
  emitProductionUpdated,
  emitDeliveryScheduleUpdated,
  emitInventoryUpdated,
};
