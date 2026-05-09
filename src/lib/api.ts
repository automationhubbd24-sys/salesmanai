import { toast } from "sonner";

/**
 * Enhanced fetch wrapper that handles common auth issues
 * like 401 Unauthorized by automatically logging out the user
 * and clearing stale local storage data.
 */
export const secureFetch = async (url: string, options: RequestInit = {}) => {
  try {
    // Automatically inject Authorization header if token exists
    const token = localStorage.getItem("auth_token");
    const headers = new Headers(options.headers || {});
    
    if (token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    const response = await fetch(url, { ...options, headers });

    // Handle 401 Unauthorized (Invalid/Expired Token)
    if (response.status === 401) {
      console.error("[Auth] Session expired or invalid token (401). Redirecting to login...");
      
      // Clear all auth related data to prevent infinite loops or stale state
      const preservedKeys = ["remembered_email", "theme", "language", "messenger_view_mode", "whatsapp_view_mode"];
      const keysToKeep: Record<string, string | null> = {};
      
      preservedKeys.forEach(key => {
        keysToKeep[key] = localStorage.getItem(key);
      });

      // Clear all storage
      localStorage.clear();

      // Restore non-sensitive user preferences
      Object.entries(keysToKeep).forEach(([key, value]) => {
        if (value !== null) localStorage.setItem(key, value);
      });

      // Show a professional message to the user
      toast.error("Your session has expired. Please log in again.", {
        description: "For your security, we've signed you out.",
        duration: 5000,
      });

      // Redirect to login page after a short delay
      setTimeout(() => {
        window.location.href = "/login";
      }, 1500);

      // Return a rejected promise to stop further execution in the calling code
      return Promise.reject(new Error("Unauthorized"));
    }

    return response;
  } catch (error) {
    console.error("[Network] Fetch error:", error);
    throw error;
  }
};
