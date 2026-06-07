/**
 * Facebook Mobile Auth Utility
 * 
 * Provides robust OAuth redirect flows for mobile browsers where popups are often blocked
 * or cause issues when the Facebook App hijacks the intent.
 */

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
 * Begin the WhatsApp Mobile OAuth flow by redirecting to Facebook
 */
export function beginWhatsAppMobileOAuth(): void {
  const appId = import.meta.env.VITE_FACEBOOK_APP_ID || "3741087806186945";
  const configId = import.meta.env.VITE_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID || "2197274487770639";
  const state = generateState();
  const redirectUri = getWhatsAppMobileRedirectUri();

  // Store state for validation on return
  const flowState: FlowState = {
    state,
    returnPath: window.location.pathname,
    timestamp: Date.now(),
  };
  localStorage.setItem(WHATSAPP_MOBILE_FLOW_STATE_KEY, JSON.stringify(flowState));

  // Build the Facebook OAuth URL for Embedded Signup
  const oauthUrl = new URL("https://www.facebook.com/v25.0/dialog/oauth");
  oauthUrl.searchParams.set("client_id", appId);
  oauthUrl.searchParams.set("redirect_uri", redirectUri);
  oauthUrl.searchParams.set("state", state);
  oauthUrl.searchParams.set("config_id", configId);
  oauthUrl.searchParams.set("response_type", "code");
  oauthUrl.searchParams.set("override_default_response_type", "true");
  
  // Extra parameters for WhatsApp Embedded Signup
  const extras = {
    setup: {},
    featureType: "whatsapp_business_app_onboarding",
    sessionInfoVersion: "3",
  };
  oauthUrl.searchParams.set("extras", JSON.stringify(extras));

  // Redirect the user
  window.location.href = oauthUrl.toString();
}

/**
 * Begin the Messenger Mobile OAuth flow by redirecting to Facebook
 */
export function beginMessengerMobileOAuth(): void {
  const appId = import.meta.env.VITE_FACEBOOK_APP_ID;
  const state = generateState();
  const redirectUri = getMessengerMobileRedirectUri();

  if (!appId) {
    console.error("VITE_FACEBOOK_APP_ID is not configured");
    return;
  }

  // Store state for validation on return
  const flowState: FlowState = {
    state,
    returnPath: window.location.pathname,
    timestamp: Date.now(),
  };
  localStorage.setItem(MESSENGER_MOBILE_FLOW_STATE_KEY, JSON.stringify(flowState));

  // Build the Facebook OAuth URL for Messenger
  const oauthUrl = new URL("https://www.facebook.com/v25.0/dialog/oauth");
  oauthUrl.searchParams.set("client_id", appId);
  oauthUrl.searchParams.set("redirect_uri", redirectUri);
  oauthUrl.searchParams.set("state", state);
  oauthUrl.searchParams.set("response_type", "code");
  oauthUrl.searchParams.set("scope", "pages_show_list,pages_messaging,pages_read_engagement,pages_manage_metadata,pages_read_user_content");

  // Redirect the user
  window.location.href = oauthUrl.toString();
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
