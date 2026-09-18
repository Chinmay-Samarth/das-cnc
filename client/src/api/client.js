import axios from 'axios';

const api = axios.create({
  // Dev: hit Vite proxy → local API (localhost:3001). Prod: Render unless VITE_API_URL is set.
  baseURL:
    import.meta.env.VITE_API_URL ||
    (import.meta.env.DEV ? '/api' : 'https://das-cnc.onrender.com/api'),
  withCredentials: false,
});

export default api;
