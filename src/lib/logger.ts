import { BACKEND_URL } from "@/config";
import { secureFetch } from "./api";

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

    // Send to backend for persistent auditing
    const { message, stack, context, ...metadata } = data;
    
    secureFetch(`${BACKEND_URL}/api/logs`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            message,
            stack,
            context,
            metadata
        })
    }).catch(err => {
        console.warn('[Logger] Failed to send error to backend:', err);
    });
};
