
/**
 * Simple logger for frontend errors that can be sent to the backend or monitored.
 */
export const logFrontendError = (data: {
    message: string;
    stack?: string;
    context?: string;
    [key: string]: any;
}) => {
    // Log to console for local debugging
    console.error(`[Frontend Error] ${data.context || 'General'}: ${data.message}`, data);

    // In a production environment, you would send this to your backend
    // fetch('/api/log-error', { method: 'POST', body: JSON.stringify(data) });
};
