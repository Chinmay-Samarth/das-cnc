const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { setIo } = require('./emitter');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-env';



function initSocket(httpServer) {
  const corsOrigin = process.env.FRONTEND_URL || '*';

  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigin,
      methods: ['GET', 'POST'],
    },
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
    console.log('user connected - ', socket.id);
    socket.join('attendance');
    socket.join('girns');
    socket.join('boms');
    socket.join('production');
    socket.join('delivery-schedules');
    socket.join('inventory');

    const employeeId = socket.user?.sub;
    if (employeeId) {
      socket.join(`production-employee:${employeeId}`);
    }

    socket.on('join:bom', (recordId) => {
      if (recordId) socket.join(`bom:${recordId}`);
    });

    socket.on('leave:bom', (recordId) => {
      if (recordId) socket.leave(`bom:${recordId}`);
    });

    socket.on('join:girn', (girnId) => {
      if (girnId) socket.join(`girn:${girnId}`);
    });

    socket.on('leave:girn', (girnId) => {
      if (girnId) socket.leave(`girn:${girnId}`);
    });

    socket.on('join:blanket-po', (blanketPoId) => {
      if (blanketPoId) socket.join(`blanket-po:${blanketPoId}`);
    });

    socket.on('leave:blanket-po', (blanketPoId) => {
      if (blanketPoId) socket.leave(`blanket-po:${blanketPoId}`);
    });

    socket.on('join:production-card', (cardId) => {
      if (cardId) socket.join(`production-card:${cardId}`);
    });

    socket.on('leave:production-card', (cardId) => {
      if (cardId) socket.leave(`production-card:${cardId}`);
    });
  });
}

module.exports = {
  initSocket,
  attachConnectionHandlers,
};
