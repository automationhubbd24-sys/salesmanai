export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
    ? 'http://localhost:3001' 
    : window.location.origin); // Auto-detect for self-hosted VPS

export const EXTERNAL_API_BASE = 'https://api.salesmanchatbot.online/api/external/v1';
