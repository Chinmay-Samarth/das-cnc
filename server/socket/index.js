const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { setIo } = require('./emitter');
const { registerSocket, unregisterSocket } = require('./presence');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-env';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function initSocket(httpServer) {
  const corsOrigin = process.env.FRONTEND_URL || '*';

  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigin,
      methods: ['GET', 'POST'],
    },
    // Helpful under flaky shop-floor networks
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) {
        return next(new Error('Authentication required'));
      }
      const user = jwt.verify(token, JWT_SECRET);
      socket.user = user;
      return next();
    } catch (err) {
      return next(new Error('Invalid or expired token'));
    }
  });

  setIo(io);
  return io;
}

function attachConnectionHandlers(io) {
  io.on('connection', (socket) => {
    const employeeId = socket.user?.sub || null;

    socket.join('attendance');
    socket.join('girns');
    socket.join('boms');
    socket.join('production');
    socket.join('delivery-schedules');
    socket.join('inventory');

    if (employeeId) {
      socket.join(`production-employee:${employeeId}`);
      registerSocket(employeeId, socket.id);
    }

    socket.workCenterRooms = new Set();

    socket.on('join:bom', (recordId) => {
      if (isUuid(recordId)) socket.join(`bom:${recordId}`);
    });
    socket.on('leave:bom', (recordId) => {
      if (isUuid(recordId)) socket.leave(`bom:${recordId}`);
    });

    socket.on('join:girn', (girnId) => {
      if (isUuid(girnId)) socket.join(`girn:${girnId}`);
    });
    socket.on('leave:girn', (girnId) => {
      if (isUuid(girnId)) socket.leave(`girn:${girnId}`);
    });

    socket.on('join:blanket-po', (blanketPoId) => {
      if (isUuid(blanketPoId)) socket.join(`blanket-po:${blanketPoId}`);
    });
    socket.on('leave:blanket-po', (blanketPoId) => {
      if (isUuid(blanketPoId)) socket.leave(`blanket-po:${blanketPoId}`);
    });

    socket.on('join:production-card', (cardId) => {
      if (isUuid(cardId)) socket.join(`production-card:${cardId}`);
    });
    socket.on('leave:production-card', (cardId) => {
      if (isUuid(cardId)) socket.leave(`production-card:${cardId}`);
    });

    socket.on('join:work-center', (workCenterId) => {
      if (!isUuid(workCenterId)) return;
      const room = `wc:${workCenterId}`;
      socket.join(room);
      socket.workCenterRooms.add(room);
    });

    socket.on('leave:work-center', (workCenterId) => {
      if (!isUuid(workCenterId)) return;
      const room = `wc:${workCenterId}`;
      socket.leave(room);
      socket.workCenterRooms.delete(room);
    });

    socket.on('disconnect', () => {
      if (employeeId) {
        unregisterSocket(employeeId, socket.id);
      }
      socket.workCenterRooms.clear();
    });
  });
}

module.exports = {
  initSocket,
  attachConnectionHandlers,
};
