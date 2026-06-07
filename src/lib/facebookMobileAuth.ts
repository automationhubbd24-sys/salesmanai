const FACEBOOK_DIALOG_VERSION = import.meta.env.VITE_FACEBOOK_GRAPH_VERSION || "v25.0";
const FACEBOOK_APP_ID = import.meta.env.VITE_FACEBOOK_APP_ID || "3741087806186945";
const WHATSAPP_CONFIG_ID = import.meta.env.VITE_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID || "2197274487770639";

export const MESSENGER_MOBILE_FLOW_STATE_KEY = "messenger_mobile_oauth_state";
export const MESSENGER_MOBILE_CALLBACK_KEY = "messenger_mobile_oauth_callback";
export const WHATSAPP_MOBILE_FLOW_STATE_KEY = "whatsapp_mobile_oauth_state";
export const WHATSAPP_MOBILE_CALLBACK_KEY = "whatsapp_mobile_oauth_callback";

type MobileFlowState = {
  state: string;
  createdAt: number;
  returnPath: string;
  callbackPath: string;
};

type MobileCallbackPayload = {
  code: string | null;
  error: string | null;
  errorReason: string | null;
  errorDescription: string | null;
  state: string | null;
};

function getAppOrigin() {
  return window.location.origin.replace(/\/+$/, "");
}

function buildFacebookDialogUrl(params: Record<string, string>) {
  const url = new URL(`https://www.facebook.com/${FACEBOOK_DIALOG_VERSION}/dialog/oauth`);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return url.toString();
}

function createState() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function getMessengerMobileRedirectUri() {
  return `${getAppOrigin()}/auth/facebook/messenger/callback`;
}

export function getWhatsAppMobileRedirectUri() {
  return `${getAppOrigin()}/auth/facebook/whatsapp/callback`;
}

export function beginMessengerMobileOAuth() {
  const state = createState();
  const flowState: MobileFlowState = {
    state,
    createdAt: Date.now(),
    returnPath: "/dashboard/messenger/integration",
    callbackPath: "/auth/facebook/messenger/callback",
  };

  sessionStorage.setItem(MESSENGER_MOBILE_FLOW_STATE_KEY, JSON.stringify(flowState));

  const url = buildFacebookDialogUrl({
    client_id: FACEBOOK_APP_ID,
    redirect_uri: getMessengerMobileRedirectUri(),
    state,
    scope: "pages_show_list,pages_messaging,pages_read_engagement,pages_manage_metadata,pages_read_user_content",
    response_type: "code",
    auth_type: "rerequest",
    display: "page", // Forces a full-page browser flow instead of app switch
  });

  window.location.assign(url);
}

export function beginWhatsAppMobileOAuth() {
  const state = createState();
  const flowState: MobileFlowState = {
    state,
    createdAt: Date.now(),
    returnPath: "/dashboard/whatsapp/sessions",
    callbackPath: "/auth/facebook/whatsapp/callback",
  };

  sessionStorage.setItem(WHATSAPP_MOBILE_FLOW_STATE_KEY, JSON.stringify(flowState));

  const url = buildFacebookDialogUrl({
    client_id: FACEBOOK_APP_ID,
    redirect_uri: getWhatsAppMobileRedirectUri(),
    state,
    response_type: "code",
    config_id: WHATSAPP_CONFIG_ID,
    override_default_response_type: "true",
    display: "page", // Forces a full-page browser flow instead of app switch
    extras: JSON.stringify({
      setup: {},
      feature: "whatsapp_embedded_signup",
      sessionInfoVersion: "3",
    }),
  });

  window.location.assign(url);
}

export function readFlowState(storageKey: string): MobileFlowState | null {
  const raw = sessionStorage.getItem(storageKey);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as MobileFlowState;
  } catch {
    sessionStorage.removeItem(storageKey);
    return null;
  }
}

export function clearFlowState(storageKey: string) {
  sessionStorage.removeItem(storageKey);
}

export function storeCallbackPayload(storageKey: string, payload: MobileCallbackPayload) {
  sessionStorage.setItem(storageKey, JSON.stringify(payload));
}

export function consumeCallbackPayload(storageKey: string): MobileCallbackPayload | null {
  const raw = sessionStorage.getItem(storageKey);
  if (!raw) {
    return null;
  }

  sessionStorage.removeItem(storageKey);

  try {
    return JSON.parse(raw) as MobileCallbackPayload;
  } catch {
    return null;
  }
}
