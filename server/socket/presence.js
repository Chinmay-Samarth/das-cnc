/**
 * In-memory employee ↔ socket presence for direct worker notifications.
 * Rooms remain the primary fan-out mechanism; this map enables emitToEmployee().
 */

const employeeSockets = new Map(); // employeeId -> Set<socketId>

function registerSocket(employeeId, socketId) {
  if (!employeeId || !socketId) return;
  let set = employeeSockets.get(employeeId);
  if (!set) {
    set = new Set();
    employeeSockets.set(employeeId, set);
  }
  set.add(socketId);
}

function unregisterSocket(employeeId, socketId) {
  if (!employeeId || !socketId) return;
  const set = employeeSockets.get(employeeId);
  if (!set) return;
  set.delete(socketId);
  if (!set.size) employeeSockets.delete(employeeId);
}

function getSocketIdsForEmployee(employeeId) {
  const set = employeeSockets.get(employeeId);
  return set ? [...set] : [];
}

function isEmployeeOnline(employeeId) {
  return getSocketIdsForEmployee(employeeId).length > 0;
}

module.exports = {
  registerSocket,
  unregisterSocket,
  getSocketIdsForEmployee,
  isEmployeeOnline,
};
