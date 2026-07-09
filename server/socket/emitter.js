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

module.exports = {
  setIo,
  emitAttendanceUpdated,
  emitGirnUpdated,
  emitBomUpdated,
};
