import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../auth/authContext';

const MastersNavContext = createContext(null);

export function MastersNavProvider({ children }) {
  const { user } = useAuth();
  const [masters, setMasters] = useState([]);
  const [loading, setLoading] = useState(false);

  const refreshMasters = useCallback(async () => {
    if (!user) {
      setMasters([]);
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.get('/masters');
      setMasters(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch masters:', err);
      setMasters([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refreshMasters();
  }, [refreshMasters]);

  return (
    <MastersNavContext.Provider value={{ masters, loading, refreshMasters }}>
      {children}
    </MastersNavContext.Provider>
  );
}

export function useMastersNav() {
  const context = useContext(MastersNavContext);
  if (!context) {
    throw new Error('useMastersNav must be used within a MastersNavProvider');
  }
  return context;
}
