import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001/api',
  // baseURL: import.meta.env.VITE_API_URL || 'https://das-cnc.onrender.com/api',
  withCredentials: false,
});

export default api;
