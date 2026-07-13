import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '../auth/authContext';

const SocketContext = createContext(null);

function getSocketUrl() {
  if (import.meta.env.VITE_SOCKET_URL) {
    return import.meta.env.VITE_SOCKET_URL;
  }
  if (import.meta.env.DEV) {
    return window.location.origin;
  }
  // const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
  const apiUrl = import.meta.env.VITE_API_URL || 'https://das-cnc.onrender.com/api';
  return apiUrl.replace(/\/api\/?$/, '');
}

export function SocketProvider({ children }) {
  const { user } = useAuth();
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);
  /** Rooms to re-join after reconnect */
  const workCenterRoomsRef = useRef(new Set());
  const productionCardRoomsRef = useRef(new Set());

  useEffect(() => {
    if (!user?.token) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setSocket(null);
        setConnected(false);
      }
      workCenterRoomsRef.current.clear();
      productionCardRoomsRef.current.clear();
      return undefined;
    }

    const instance = io(getSocketUrl(), {
      auth: { token: user.token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 800,
      reconnectionDelayMax: 8000,
    });

    socketRef.current = instance;
    setSocket(instance);

    function rejoinRooms() {
      for (const wcId of workCenterRoomsRef.current) {
        instance.emit('join:work-center', wcId);
      }
      for (const cardId of productionCardRoomsRef.current) {
        instance.emit('join:production-card', cardId);
      }
    }

    function onConnect() {
      setConnected(true);
      rejoinRooms();
    }

    function onDisconnect() {
      setConnected(false);
    }

    instance.on('connect', onConnect);
    instance.on('disconnect', onDisconnect);

    return () => {
      instance.off('connect', onConnect);
      instance.off('disconnect', onDisconnect);
      instance.disconnect();
      socketRef.current = null;
      setSocket(null);
      setConnected(false);
    };
  }, [user?.token]);

  const subscribe = useCallback((event, handler) => {
    const activeSocket = socketRef.current;
    if (!activeSocket) return () => {};
    activeSocket.on(event, handler);
    return () => {
      activeSocket.off(event, handler);
    };
  }, []);

  const joinBomRoom = useCallback((recordId) => {
    socketRef.current?.emit('join:bom', recordId);
  }, []);

  const leaveBomRoom = useCallback((recordId) => {
    socketRef.current?.emit('leave:bom', recordId);
  }, []);

  const joinGirnRoom = useCallback((girnId) => {
    socketRef.current?.emit('join:girn', girnId);
  }, []);

  const leaveGirnRoom = useCallback((girnId) => {
    socketRef.current?.emit('leave:girn', girnId);
  }, []);

  const joinBlanketPoRoom = useCallback((blanketPoId) => {
    socketRef.current?.emit('join:blanket-po', blanketPoId);
  }, []);

  const leaveBlanketPoRoom = useCallback((blanketPoId) => {
    socketRef.current?.emit('leave:blanket-po', blanketPoId);
  }, []);

  const joinProductionCardRoom = useCallback((cardId) => {
    if (!cardId) return;
    productionCardRoomsRef.current.add(cardId);
    socketRef.current?.emit('join:production-card', cardId);
  }, []);

  const leaveProductionCardRoom = useCallback((cardId) => {
    if (!cardId) return;
    productionCardRoomsRef.current.delete(cardId);
    socketRef.current?.emit('leave:production-card', cardId);
  }, []);

  const joinWorkCenterRoom = useCallback((workCenterId) => {
    if (!workCenterId) return;
    workCenterRoomsRef.current.add(workCenterId);
    socketRef.current?.emit('join:work-center', workCenterId);
  }, []);

  const leaveWorkCenterRoom = useCallback((workCenterId) => {
    if (!workCenterId) return;
    workCenterRoomsRef.current.delete(workCenterId);
    socketRef.current?.emit('leave:work-center', workCenterId);
  }, []);

  const value = useMemo(
    () => ({
      socket,
      connected,
      subscribe,
      joinBomRoom,
      leaveBomRoom,
      joinGirnRoom,
      leaveGirnRoom,
      joinBlanketPoRoom,
      leaveBlanketPoRoom,
      joinProductionCardRoom,
      leaveProductionCardRoom,
      joinWorkCenterRoom,
      leaveWorkCenterRoom,
    }),
    [
      socket,
      connected,
      subscribe,
      joinBomRoom,
      leaveBomRoom,
      joinGirnRoom,
      leaveGirnRoom,
      joinBlanketPoRoom,
      leaveBlanketPoRoom,
      joinProductionCardRoom,
      leaveProductionCardRoom,
      joinWorkCenterRoom,
      leaveWorkCenterRoom,
    ]
  );

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
}

/**
 * Subscribe to several production realtime channels and invoke onEvent.
 * Useful for My Today / WC Boards silent refresh.
 */
export function useProductionRealtime(onEvent, deps = []) {
  const { subscribe, connected } = useSocket();

  useEffect(() => {
    if (!onEvent || !connected) return undefined;
    const offs = [
      subscribe('production:updated', onEvent),
      subscribe('production:log-submitted', onEvent),
      subscribe('board:update', onEvent),
      subscribe('task:assigned', onEvent),
    ];
    return () => {
      offs.forEach((off) => off());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe, onEvent, connected, ...deps]);
}
