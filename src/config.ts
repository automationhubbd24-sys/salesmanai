export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 
  (window.location.hostname === 'localhost' 
    ? 'http://localhost:3001' 
    : 'https://webhook.salesmanchatbot.online');

export const EXTERNAL_API_BASE = 'https://api.salesmanchatbot.online/api/external/v1';
