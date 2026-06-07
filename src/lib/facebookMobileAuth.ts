/**
 * Facebook Mobile Auth Utility
 * 
 * Provides robust OAuth redirect flows for mobile browsers where popups are often blocked
 * or cause issues when the Facebook App hijacks the intent.
 */

import { BACKEND_URL } from "@/config";

export const WHATSAPP_MOBILE_CALLBACK_KEY = "wa_mobile_callback_payload";
export const MESSENGER_MOBILE_CALLBACK_KEY = "messenger_mobile_callback_payload";
export const WHATSAPP_MOBILE_FLOW_STATE_KEY = "wa_mobile_flow_state";
export const MESSENGER_MOBILE_FLOW_STATE_KEY = "messenger_mobile_flow_state";

interface FlowState {
  state: string;
  returnPath: string;
  timestamp: number;
}

interface CallbackPayload {
  code: string | null;
  error: string | null;
  errorReason: string | null;
  errorDescription: string | null;
  state: string | null;
}

/**
 * Generate a random state string for OAuth security
 */
function generateState(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

/**
 * Get the redirect URI for WhatsApp mobile flow
 */
export function getWhatsAppMobileRedirectUri(): string {
  return `${window.location.origin}/auth/facebook/whatsapp/callback`;
}

/**
 * Get the redirect URI for Messenger mobile flow
 */
export function getMessengerMobileRedirectUri(): string {
  return `${window.location.origin}/auth/facebook/messenger/callback`;
}

/**
 * Begin the WhatsApp Mobile OAuth flow by using a backend redirector to bypass App Hijacking
 */
export function beginWhatsAppMobileOAuth(): void {
  const state = generateState();
  
  // Store state for validation on return
  const flowState: FlowState = {
    state,
    returnPath: window.location.pathname,
    timestamp: Date.now(),
  };
  localStorage.setItem(WHATSAPP_MOBILE_FLOW_STATE_KEY, JSON.stringify(flowState));

  // Build the Backend Redirector URL
  // Using our own domain for the initial click prevents the OS from hijacking the link to the Facebook App.
  const startUrl = new URL(`${BACKEND_URL}/api/auth/facebook/start`);
  startUrl.searchParams.set("type", "whatsapp");
  startUrl.searchParams.set("state", state);

  window.location.href = startUrl.toString();
}

/**
 * Begin the Messenger Mobile OAuth flow by using a backend redirector to bypass App Hijacking
 */
export function beginMessengerMobileOAuth(): void {
  const state = generateState();

  // Store state for validation on return
  const flowState: FlowState = {
    state,
    returnPath: window.location.pathname,
    timestamp: Date.now(),
  };
  localStorage.setItem(MESSENGER_MOBILE_FLOW_STATE_KEY, JSON.stringify(flowState));

  // Build the Backend Redirector URL
  const startUrl = new URL(`${BACKEND_URL}/api/auth/facebook/start`);
  startUrl.searchParams.set("type", "messenger");
  startUrl.searchParams.set("state", state);

  window.location.href = startUrl.toString();
}

/**
 * Store the callback payload received from Facebook
 */
export function storeCallbackPayload(key: string, payload: CallbackPayload): void {
  localStorage.setItem(key, JSON.stringify(payload));
}

/**
 * Consume (read and then delete) the callback payload
 */
export function consumeCallbackPayload(key: string): CallbackPayload | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  
  try {
    const payload = JSON.parse(raw) as CallbackPayload;
    localStorage.removeItem(key);
    return payload;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

/**
 * Read the flow state for validation
 */
export function readFlowState(key: string): FlowState | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  
  try {
    return JSON.parse(raw) as FlowState;
  } catch {
    return null;
  }
}

/**
 * Clear the flow state
 */
export function clearFlowState(key: string): void {
  localStorage.removeItem(key);
}
