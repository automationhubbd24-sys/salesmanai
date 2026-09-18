import { useState, useEffect, useRef } from "react";
import { useNavigate, Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { 
    Facebook, 
    Check, 
    Copy, 
    Loader2, 
    Database, 
    Settings, 
    Trash2, 
    Gift,
    FileText,
    Terminal
} from "lucide-react";
import { BACKEND_URL } from "@/config";
import { useMessenger } from "@/context/MessengerContext";
import { useIsMobile } from "@/hooks/use-mobile";
import {
    MESSENGER_MOBILE_CALLBACK_KEY,
    MESSENGER_MOBILE_FLOW_STATE_KEY,
    beginMessengerMobileOAuth,
    consumeCallbackPayload,
    readFlowState,
    getMessengerMobileRedirectUri,
    clearFlowState,
} from "@/lib/facebookMobileAuth";
import { secureFetch } from "@/lib/api";
import { logFrontendError } from "../../../lib/logger";

// --- Types & Interfaces ---

interface FacebookPage {
    id: string;
    name: string;
    access_token?: string;
    tasks?: string[];
    sources?: string[];
    has_access_token?: boolean;
}

interface PageData {
    page_id: string;
    name: string;
    page_access_token?: string;
    subscription_status?: string;
    subscription_plan?: string;
    message_credit?: number;
    email?: string;
    secret_key?: string;
    found_id?: string;
    db_id?: number;
    id?: number; // Added to catch raw backend ID
    [key: string]: any;
}

declare global {
    interface Window {
        fbAsyncInit: () => void;
        FB: any;
    }
}

// --- Constants ---
interface ConnectionLog {
    timestamp: string;
    type: 'info' | 'success' | 'error' | 'warning';
    action: string;
    message: string;
    details?: any;
}


export default function MessengerIntegrationPage() {
    const navigate = useNavigate();
    const { platform } = useParams();
    const isInstagram = platform === 'instagram';
    const platformName = isInstagram ? 'Instagram' : 'Messenger';
    const channelName = isInstagram ? 'Instagram' : 'Facebook';
    const controlPath = isInstagram ? '/dashboard/instagram/control' : '/dashboard/messenger/control';
    const isMobile = useIsMobile();
    const { 
        refreshPages, 
        pages: contextPages, 
        isTeamMember, 
        activeTeam, 
        viewMode
    } = useMessenger();
    
    // --- State ---
    const [userEmail, setUserEmail] = useState<string | null>(null);
    const [userId, setUserId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [connecting, setConnecting] = useState(false);
    const mobileCallbackProcessedRef = useRef(false);

    // Direct Connect State
    const [directPageName, setDirectPageName] = useState("");
    const [directPageId, setDirectPageId] = useState("");
    const [directAccessToken, setDirectAccessToken] = useState("");
    const [directLoading, setDirectLoading] = useState(false);
    const [isManualSetupOpen, setIsManualSetupOpen] = useState(false);
    const [isMobileConnectDialogOpen, setIsMobileConnectDialogOpen] = useState(false);
    const [pagePendingRemoval, setPagePendingRemoval] = useState<PageData | null>(null);
    const [removingPageId, setRemovingPageId] = useState<string | null>(null);

    // Logs State
    const [connectionLogs, setConnectionLogs] = useState<ConnectionLog[]>([]);
    const [isLogsOpen, setIsLogsOpen] = useState(false);
    
    // Webhook Monitor State
    const [webhookLogs, setWebhookLogs] = useState<any[]>([]);
    const [isWebhookMonitorOpen, setIsWebhookMonitorOpen] = useState(false);
    const [isFetchingWebhooks, setIsFetchingWebhooks] = useState(false);

    // Subscription Modal State - DEPRECATED/REMOVED
    // const [isSubscriptionOpen, setIsSubscriptionOpen] = useState(false);
    // const [selectedPageForSub, setSelectedPageForSub] = useState<PageData | null>(null);
    // const [selectedPlan, setSelectedPlan] = useState("3_months");
    // const [couponCode, setCouponCode] = useState("");
    // const [isProcessingPayment, setIsProcessingPayment] = useState(false);

    // --- Effects ---

    useEffect(() => {
        const email = localStorage.getItem("auth_email");
        const id = localStorage.getItem("auth_user_id");
        if (email && id) {
            setUserId(id);
            if (viewMode === 'team' && isTeamMember && activeTeam) {
                setUserEmail(activeTeam.owner_email);
            } else {
                setUserEmail(email);
            }
        }

        // Initialize Facebook SDK
        window.fbAsyncInit = function() {
            window.FB.init({
                appId      : import.meta.env.VITE_FACEBOOK_APP_ID || 'YOUR_APP_ID_HERE',
                cookie     : true,
                xfbml      : true,
                version    : 'v25.0'
            });
        };

        // Load the SDK script
        (function(d, s, id){
            var js, fjs = d.getElementsByTagName(s)[0] as HTMLElement;
            if (d.getElementById(id)) {return;}
            js = d.createElement(s) as HTMLScriptElement; js.id = id;
            js.src = "https://connect.facebook.net/en_US/sdk.js";
            if (fjs && fjs.parentNode) {
                fjs.parentNode.insertBefore(js, fjs);
            } else {
                d.head.appendChild(js);
            }
        }(document, 'script', 'facebook-jssdk'));

    }, []);

    useEffect(() => {
        if (userEmail) {
            fetchPages();
        }
    }, [userEmail]);

    // Use pages from context instead of local fetch
    const pages = contextPages as PageData[];

    // --- Helper Functions ---

    const addLog = (type: ConnectionLog['type'], action: string, message: string, details?: any) => {
        const newLog: ConnectionLog = {
            timestamp: new Date().toISOString(),
            type,
            action,
            message,
            details
        };
        setConnectionLogs(prev => [newLog, ...prev].slice(0, 50)); // Keep last 50 logs
    };

    const copyWebhook = () => {
        const webhookUrl = `${BACKEND_URL}/webhook`;
        navigator.clipboard.writeText(webhookUrl);
        toast.success("Webhook URL copied!");
    };

    const fetchPages = async () => {
        // Delegated to MessengerContext
        await refreshPages();
        setLoading(false);
    };

    const fetchWebhookLogs = async () => {
        setIsWebhookMonitorOpen(true);
        setIsFetchingWebhooks(true);
        try {
            const token = localStorage.getItem("auth_token");
            const activePageId = localStorage.getItem("active_fb_page_id");
            
            let url = `${BACKEND_URL}/api/webhook/monitor`;
            if (activePageId) {
                url += `?sourceId=${activePageId}`;
            }

            const res = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            });
            if (res.ok) {
                const data = await res.json();
                setWebhookLogs(data.logs || []);
            } else {
                toast.error("Failed to fetch webhook logs");
            }
        } catch (error) {
            console.error("Error fetching webhook logs:", error);
            toast.error("Network error fetching webhooks");
        } finally {
            setIsFetchingWebhooks(false);
        }
    };

    // Auto-refresh effect for Webhook Monitor
    useEffect(() => {
        let interval: any;
        if (isWebhookMonitorOpen) {
            interval = setInterval(() => {
                const token = localStorage.getItem("auth_token");
                const activePageId = localStorage.getItem("active_fb_page_id");
                
                let url = `${BACKEND_URL}/api/webhook/monitor`;
                if (activePageId) {
                    url += `?sourceId=${activePageId}`;
                }

                secureFetch(url, {
                    headers: {
                        Authorization: `Bearer ${token}`
                    }
                })
                .then(res => res.json())
                .then(data => {
                    setWebhookLogs(data.logs || []);
                })
                .catch(err => console.warn("Auto-refresh failed:", err));
            }, 3000); // 3 seconds interval
        }
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [isWebhookMonitorOpen]);


    const unsubscribeAppFromPage = (pageId: string, accessToken: string) => {
        return new Promise((resolve) => {
            const doDirectUnsubscribe = () => {
                fetch(`https://graph.facebook.com/v19.0/${pageId}/subscribed_apps?access_token=${accessToken}`, {
                    method: 'DELETE'
                })
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        console.log('Direct fetch successfully unsubscribed');
                        resolve(true);
                    } else {
                        console.warn('Direct unsubscribe failed:', data);
                        // Even if it fails, we resolve true to allow deletion to proceed
                        // (User wants to delete from system regardless of FB status sometimes)
                        resolve(true); 
                    }
                })
                .catch(err => {
                    console.error('Direct unsubscribe error:', err);
                    resolve(true); // Proceed anyway
                });
            };

            if (window.FB) {
                window.FB.api(
                    `/${pageId}/subscribed_apps`,
                    'delete',
                    {
                        access_token: accessToken
                    },
                    function(response: any) {
                        if (!response || response.error) {
                            console.error('Error unsubscribing app from page:', response?.error);
                            // Fallback to direct
                            doDirectUnsubscribe();
                        } else {
                            console.log('Successfully unsubscribed app from page:', response);
                            resolve(true);
                        }
                    }
                );
            } else {
                doDirectUnsubscribe();
            }
        });
    };

    const savePagesToBackend = async (facebookPages: FacebookPage[], userAccessToken?: string) => {
        console.log('🔍 [DEBUG] savePagesToBackend starting with pages:', facebookPages);
        if (!userEmail) {
            toast.error("User email not found. Please reload.");
            setConnecting(false);
            return;
        }

        const token = localStorage.getItem("auth_token");
        if (!token) {
            toast.error("Please login again");
            setConnecting(false);
            return;
        }

        let successCount = 0;
        let skippedTokenlessCount = 0;
        let subscriptionWarningCount = 0;
        const skippedPages: FacebookPage[] = [];
        const failedPages: Array<{ page: FacebookPage; reason: string; details?: any }> = [];
        for (const [index, page] of facebookPages.entries()) {
            console.log(`🔄 [DEBUG] Processing page ${index + 1}/${facebookPages.length}:`, page.name, page.id);
            if (!page.access_token) {
                skippedTokenlessCount++;
                skippedPages.push(page);
                addLog('warning', 'Page Token Missing', `${page.name || page.id} connect হয়নি: Meta এই Page-এর access token দেয়নি`, {
                    pageId: page.id,
                    tasks: page.tasks || [],
                    sources: page.sources || [],
                    fix: 'Meta Business Settings থেকে এই Facebook account-কে Page Full Control বা Messages access দিন, তারপর reconnect করুন।'
                });
                continue;
            }

            try {
                let dbId: number | null = null;

                console.log(`✅ [DEBUG] Sending page data to backend for authoritative subscription...`);
                const res = await fetch(`${BACKEND_URL}/api/messenger/pages/manual`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        page_id: page.id,
                        name: page.name,
                        page_access_token: page.access_token,
                        user_access_token: userAccessToken,
                        email: userEmail,
                        user_id: userId,
                        tasks: page.tasks || [],
                    }),
                });

                console.log(`✅ [DEBUG] Backend response status:`, res.status);
                const body = await res.json().catch(() => ({}));
                console.log(`✅ [DEBUG] Backend response body:`, body);
                if (!res.ok) {
                    const msg = body.error || body.details?.message || "Failed to save page";
                    failedPages.push({ page, reason: msg, details: body });
                    console.error(`❌ [DEBUG] Error saving page ${page.name}:`, msg);
                    toast.error(`${page.name} connect হয়নি: ${msg}`);
                    addLog('error', 'Backend Save', `${page.name} connect হয়নি: ${msg}`, body);
                    logFrontendError({
                        message: `Backend Save Error: ${msg}`,
                        context: 'MessengerIntegrationPage:savePagesToBackend:Upsert',
                        pageName: page.name,
                        pageId: page.id,
                        details: body,
                    });
                    continue;
                }

                if (body && typeof body.id === "number") {
                    dbId = body.id;
                }

                if (body.subscription_status === 'saved_subscription_failed') {
                    subscriptionWarningCount++;
                    addLog('warning', 'Webhook Subscription', `${page.name} save হয়েছে, কিন্তু webhook subscription failed`, {
                        error: body.subscription_error,
                        details: body.subscription_details
                    });
                } else if (body.subscription_status === 'saved_permission_review_needed') {
                    subscriptionWarningCount++;
                    addLog('warning', 'Page Tasks', `${page.name} save হয়েছে, কিন্তু Meta task list-এ MESSAGING/MANAGE/MODERATE পাওয়া যায়নি`, {
                        tasks: body.page_tasks || page.tasks || []
                    });
                }

                successCount++;
                console.log(`✅ [DEBUG] Page ${page.name} successfully processed! Total success so far: ${successCount}`);
            } catch (err: any) {
                failedPages.push({ page, reason: err.message || 'Unexpected error', details: err });
                console.error(`❌ [DEBUG] Critical exception processing page ${page.name}`, err);
                logFrontendError({
                    message: `Process Page Exception: ${err.message}`,
                    stack: err.stack,
                    context: 'MessengerIntegrationPage:savePagesToSupabase',
                    pageName: page.name,
                    pageId: page.id
                });
            }
        }

        if (skippedPages.length > 0) {
            const pageNames = skippedPages.slice(0, 3).map((page) => page.name || page.id).join(', ');
            const moreText = skippedPages.length > 3 ? ` সহ আরও ${skippedPages.length - 3}টি` : '';
            toast.warning(`${pageNames}${moreText} connect হয়নি: এই Facebook account-এ Page Full Control/Messages access নেই।`);
        }

        if (failedPages.length > 0) {
            addLog('error', 'Failed Pages Summary', `${failedPages.length}টি Page connect failed`, failedPages);
        }

        if (successCount > 0) {
            const warningText = subscriptionWarningCount > 0 ? ` (${subscriptionWarningCount}টি warning আছে)` : '';
            toast.success(`${successCount}টি Page connected${warningText}`);
            fetchPages();
        } else if (skippedTokenlessCount > 0) {
            toast.error("কোনো Page connect হয়নি। Meta Business Settings থেকে এই account-কে Page Full Control বা Messages access দিন, তারপর reconnect করুন।");
        } else {
            toast.error("Failed to connect pages.");
        }
    };

    const handleMessengerMobileCallback = async (code: string) => {
        const token = localStorage.getItem("auth_token");
        if (!token) {
            toast.error("Please login again");
            return;
        }

        setConnecting(true);
        try {
            const response = await secureFetch(`${BACKEND_URL}/api/auth/facebook/messenger/complete-code`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    code,
                    redirectUri: getMessengerMobileRedirectUri(),
                }),
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || data.details?.error?.message || "Failed to complete Facebook login.");
            }

            const facebookPages = Array.isArray(data.pages) ? data.pages : [];
            if (facebookPages.length === 0) {
                throw new Error("No Facebook pages found. If you are a Business Manager Owner, please assign yourself to the page under Business Settings > Add People.");
            }

            await savePagesToBackend(facebookPages, data.access_token);
        } catch (error: any) {
            console.error("Messenger mobile callback error:", error);
            logFrontendError({
                message: `Messenger Mobile Callback Error: ${error.message}`,
                stack: error.stack,
                context: "MessengerIntegrationPage:handleMessengerMobileCallback"
            });
            toast.error(error.message || "Failed to complete Facebook connection");
        } finally {
            setConnecting(false);
        }
    };

    useEffect(() => {
        if (!userEmail || !userId || mobileCallbackProcessedRef.current) {
            return;
        }

        const handleMobileMessage = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;
            if (event.data?.type === "MESSENGER_MOBILE_CALLBACK_COMPLETE") {
                const callbackPayload = consumeCallbackPayload(MESSENGER_MOBILE_CALLBACK_KEY);
                if (callbackPayload) {
                    if (callbackPayload.error || !callbackPayload.code) {
                        toast.error(callbackPayload.errorDescription || "Facebook login was cancelled.");
                        setConnecting(false);
                    } else {
                        void handleMessengerMobileCallback(callbackPayload.code);
                    }
                }
            }
        };

        window.addEventListener("message", handleMobileMessage);

        // POLLING FOR MOBILE OAUTH COMPLETION (Failsafe for App Hijacking)
        let pollInterval: number | null = null;

        const runPoll = async () => {
            const flowState = readFlowState(MESSENGER_MOBILE_FLOW_STATE_KEY);
            if (!flowState?.state) return;

            try {
                const res = await fetch(`${BACKEND_URL}/api/auth/facebook/poll?state=${flowState.state}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.completed) {
                        console.log("Mobile Messenger OAuth completed via polling!");
                        if (data.error) {
                            toast.error(data.errorDescription || "Messenger connection failed.");
                            setConnecting(false);
                        } else if (data.code) {
                            void handleMessengerMobileCallback(data.code);
                        }
                        if (pollInterval) window.clearInterval(pollInterval);
                        pollInterval = null;
                        clearFlowState(MESSENGER_MOBILE_FLOW_STATE_KEY); 
                    }
                }
            } catch (e) {
                // Silent poll error
            }
        };

        if (isMobile) {
            pollInterval = window.setInterval(runPoll, 3000);

            // ACCELERATE POLLING ON FOCUS
            const handleFocus = () => {
                console.log("Messenger window focused, accelerating poll...");
                void runPoll();
            };
            window.addEventListener("focus", handleFocus);
            window.addEventListener("visibilitychange", handleFocus);
            window.addEventListener("pageshow", handleFocus);

            return () => {
                window.removeEventListener("message", handleMobileMessage);
                if (pollInterval) window.clearInterval(pollInterval);
                window.removeEventListener("focus", handleFocus);
                window.removeEventListener("visibilitychange", handleFocus);
                window.removeEventListener("pageshow", handleFocus);
            };
        }

        const callbackPayload = consumeCallbackPayload(MESSENGER_MOBILE_CALLBACK_KEY);
        if (!callbackPayload) {
            return;
        }

        mobileCallbackProcessedRef.current = true;

        if (callbackPayload.error || !callbackPayload.code) {
            toast.error(callbackPayload.errorDescription || "Facebook login was cancelled or blocked.");
            setConnecting(false); // Ensure loading is reset
            return;
        }

        void handleMessengerMobileCallback(callbackPayload.code);

        return () => {
            window.removeEventListener("message", handleMobileMessage);
            if (pollInterval) window.clearInterval(pollInterval);
        };
    }, [userEmail, userId]);

    // --- Action Handlers ---

    const startMessengerMobileConnect = () => {
        setIsMobileConnectDialogOpen(false);
        setConnecting(true);
        beginMessengerMobileOAuth();
    };

    const handleConnectFacebook = async () => {
        if (isMobile) {
            setIsMobileConnectDialogOpen(true);
            return;
        }

        setConnecting(true);
        setIsLogsOpen(true);
        addLog('info', 'FB Login', 'Redirecting to Facebook Login for Business...');
        beginMessengerMobileOAuth();
    };

    const handleDirectConnect = async () => {
        if (!directPageId || !directAccessToken || !directPageName) {
            toast.error("Please fill all fields");
            return;
        }
        
        setDirectLoading(true);
        setIsLogsOpen(true);
        addLog('info', 'Manual Connect', `Starting manual connection for Page ID: ${directPageId}`);
        
        try {
            // Verify token validity by calling FB Graph API manually
            addLog('info', 'FB Graph API', 'Verifying provided access token...');
            const verifyRes = await fetch(`https://graph.facebook.com/v25.0/${directPageId}?fields=name&access_token=${directAccessToken}`);
            const verifyData = await verifyRes.json();
            
            if (verifyData.error) {
                addLog('error', 'FB Graph API', 'Token verification failed', { error: verifyData.error });
                throw new Error(`Invalid Token or Page ID: ${verifyData.error.message}`);
            }
            
            if (verifyData.id !== directPageId) {
                addLog('error', 'Validation', 'Token is valid but belongs to a different Page ID', { 
                    provided: directPageId, 
                    found: verifyData.id 
                });
                throw new Error("Page ID mismatch");
            }

            addLog('success', 'FB Graph API', `Token verified successfully. Verified Page Name: ${verifyData.name}`);

            // Use the verified name if provided name is generic
            const finalName = verifyData.name || directPageName;

            const token = localStorage.getItem("auth_token");
            if (!token) {
                throw new Error("Please login again");
            }

            addLog('info', 'Backend API', 'Saving credentials and checking webhook subscription');
            const res = await fetch(`${BACKEND_URL}/api/messenger/pages/manual`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    page_id: directPageId,
                    name: finalName,
                    page_access_token: directAccessToken,
                    email: userEmail,
                    user_id: userId,
                }),
            });

            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                addLog('error', 'Backend API', `Failed to save page to database`, { status: res.status, response: body });
                throw new Error(body.error || "Failed to save page to database");
            }
            
            if (body.subscription_status === 'saved_subscription_failed') {
                addLog('warning', 'Webhook Subscription', 'Page connected, but automatic webhook field subscription failed', { error: body.subscription_error });
                toast.warning(`${finalName} connected. Webhook field subscription needs review in Meta.`);
            } else {
                addLog('success', 'Process Completed', `${finalName} connected successfully`);
                toast.success(`${finalName} connected successfully!`);
            }
            
            // Set the active page directly into LocalStorage to immediately show it
            localStorage.setItem("active_fb_page_id", directPageId);
            window.dispatchEvent(new Event("storage")); 
            window.dispatchEvent(new Event("db-connection-changed"));

            setDirectPageName("");
            setDirectPageId("");
            setDirectAccessToken("");
            fetchPages();
            
        } catch (error: any) {
            console.error("Direct Connect Error:", error);
            addLog('error', 'Manual Connect', `Process aborted`, { error: error.message });
            logFrontendError({
                message: `Direct Connect Error: ${error.message}`,
                stack: error.stack,
                context: 'MessengerIntegrationPage:handleDirectConnect'
            });
            toast.error(error.message || "Failed to connect page");
        } finally {
            setDirectLoading(false);
            setIsManualSetupOpen(false);
        }
    };

    const handleRemovePage = async (page: PageData) => {
        console.log("handleRemovePage page object:", page);
        setRemovingPageId(page.page_id);

        try {
            // 1. Try to unsubscribe from Facebook (best effort)
            if (page.page_access_token) {
                try {
                    await unsubscribeAppFromPage(page.page_id, page.page_access_token);
                } catch (fbError) {
                    console.warn("Frontend Unsubscribe Failed (Ignored):", fbError);
                }
            }

            const token = localStorage.getItem("auth_token");
            if (!token) {
                throw new Error("Please login again");
            }

            if (!page.page_id) {
                console.error("handleRemovePage: Invalid Page ID", page);
                throw new Error("Invalid Page ID (missing in object)");
            }

            const res = await fetch(`${BACKEND_URL}/api/messenger/pages/${page.page_id}`, {
                method: "DELETE",
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || "Failed to remove from database");
            }

            // 4. Clear from local storage if active
            const activeId = localStorage.getItem("active_fb_page_id");
            if (activeId === page.page_id) {
                localStorage.removeItem("active_fb_db_id");
                localStorage.removeItem("active_fb_page_id");
            }
            
            toast.success(`Disconnected ${page.name}`);
            setPagePendingRemoval(null);
            fetchPages();

        } catch (error: any) {
            console.error("Error removing page:", error);
            logFrontendError({
                message: `Remove Page Error: ${error.message}`,
                stack: error.stack,
                context: 'MessengerIntegrationPage:handleRemovePage',
                pageName: page.name,
                pageId: page.page_id
            });
            toast.error(`Failed to disconnect: ${error.message}`);
        } finally {
            setRemovingPageId(null);
        }
    };

    const handleManage = async (page: PageData) => {
        console.log("handleManage page object:", page); // Debug log
        // ALWAYS ALLOW MANAGE (Free Integration)
        try {
            // Use db_id if available, otherwise fallback to page_id (backend will auto-create config)
            // Priority: db_id (mapped from id in context) -> id (raw from backend) -> page_id (fallback)
            const targetId = page.db_id || page.id || page.page_id;

            if (!targetId) {
                console.error("handleManage: No targetId found", page);
                toast.error("No configuration found for this page. Please contact admin.");
                return;
            }

            localStorage.setItem("active_fb_db_id", String(targetId));
            localStorage.setItem("active_fb_page_id", page.page_id || "");
            toast.success(`Connected to ${page.name}`);
            navigate(controlPath);
        } catch (error) {
            console.error("Error connecting to page:", error);
            toast.error("Failed to connect to page database");
        }
    };

    return (
    <div className="space-y-6 -m-4 md:-m-6 lg:-m-6 p-4 md:p-6 lg:p-6">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8">
                <div>
                    <h1 className="text-3xl font-black text-white tracking-tight flex items-center gap-3">
                        <Facebook className={isInstagram ? "text-pink-500 h-8 w-8" : "text-[#0084FF] h-8 w-8"} />
                        {platformName} Integration
                    </h1>
                    <p className="text-gray-400 mt-2 font-medium">
                        Connect your {channelName} pages to enable AI-powered automated replies.
                    </p>
                </div>
                
                {/* Bonus Alert */}
                <div className="bg-[#00ff88]/10 border border-[#00ff88]/20 px-6 py-4 rounded-2xl flex items-center gap-4 animate-pulse">
                    <div className="bg-[#00ff88] p-2 rounded-full">
                        <Gift className="h-5 w-5 text-black" />
                    </div>
                    <div>
                        <p className="text-[#00ff88] font-black text-sm uppercase tracking-wider">New Integration Bonus!</p>
                        <p className="text-white/70 text-xs">Get <span className="text-[#00ff88] font-bold">100 Free Messages</span> for every new page.</p>
                    </div>
                </div>
            </div>

            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto mt-4 md:mt-0">
                    <Button variant="ghost" asChild className="w-full sm:w-auto">
                        <Link to="/dashboard/api" className="flex items-center gap-2">
                            <FileText className="mr-2 h-4 w-4" />
                            API
                        </Link>
                    </Button>
                    <Button variant="outline" onClick={() => setIsLogsOpen(true)} className="w-full sm:w-auto border-gray-700 text-gray-300 hover:text-white">
                        <Terminal className="mr-2 h-4 w-4" />
                        Connection Logs
                    </Button>
                    <Button variant="outline" onClick={fetchWebhookLogs} className="w-full sm:w-auto border-indigo-700 text-indigo-300 hover:text-indigo-100 hover:bg-indigo-900/30">
                        {isFetchingWebhooks ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
                        Live Monitor
                    </Button>
                    <Button variant="outline" onClick={() => setIsManualSetupOpen(true)} className="w-full sm:w-auto">
                        <Settings className="mr-2 h-4 w-4" />
                        Manual Setup
                    </Button>
                    <Button onClick={handleConnectFacebook} disabled={connecting} className="w-full sm:w-auto">
                        {connecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Facebook className="mr-2 h-4 w-4" />}
                        {connecting ? "Connecting..." : `Connect ${channelName}`}
                    </Button>
                </div>
            </div>
            {isMobile && (
                <div className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-slate-200">
                    Use Chrome or your phone's main browser. If Facebook opens its app, finish login there and return to this browser tab so we can complete the {platformName} connection.
                </div>
            )}

            <AlertDialog open={isMobileConnectDialogOpen} onOpenChange={setIsMobileConnectDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Continue {platformName} connection in browser</AlertDialogTitle>
                        <AlertDialogDescription>
                            On Android, avoid in-app browsers. Tap continue, sign in with Facebook, then return to this browser tab if Facebook opens its app.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={connecting}>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={startMessengerMobileConnect} disabled={connecting}>
                            Continue in Browser
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <Dialog open={isManualSetupOpen} onOpenChange={setIsManualSetupOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Manual {channelName} Page Connection</DialogTitle>
                        <DialogDescription>
                            Use this if the automatic {channelName} login button doesn't work. You'll need your Page ID and Access Token.
                        </DialogDescription>
                    </DialogHeader>

                    {/* Webhook Configuration Details */}
                    <div className="bg-muted/50 p-4 rounded-md space-y-3 mb-4 border">
                        <h4 className="font-semibold text-sm flex items-center gap-2">
                            <Database className="h-4 w-4 text-blue-600" />
                            Webhook Configuration
                        </h4>
                        <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Callback URL</Label>
                            <div className="flex gap-2">
                                <Input 
                                    readOnly 
                                    value={`${BACKEND_URL}/webhook`} 
                                    className="h-8 font-mono text-xs bg-background" 
                                />
                                <Button 
                                    variant="outline" 
                                    size="sm" 
                                    className="h-8 px-2"
                                    onClick={() => {
                                        navigator.clipboard.writeText(`${BACKEND_URL}/webhook`);
                                        toast.success("Copied Callback URL");
                                    }}
                                >
                                    <Copy className="h-3 w-3" />
                                </Button>
                            </div>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Verify Token</Label>
                            <div className="flex gap-2">
                                <Input 
                                    readOnly 
                                    value="123456" 
                                    className="h-8 font-mono text-xs bg-background" 
                                />
                                <Button 
                                    variant="outline" 
                                    size="sm" 
                                    className="h-8 px-2"
                                    onClick={() => {
                                        navigator.clipboard.writeText("123456");
                                        toast.success("Copied Verify Token");
                                    }}
                                >
                                    <Copy className="h-3 w-3" />
                                </Button>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4 py-4 border-t">
                        <div className="space-y-2">
                            <Label>{channelName} Page Name</Label>
                            <Input 
                                placeholder="My Business Page" 
                                value={directPageName}
                                onChange={(e) => setDirectPageName(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>{channelName} Page ID</Label>
                            <Input 
                                placeholder="123456789012345" 
                                value={directPageId}
                                onChange={(e) => setDirectPageId(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>{channelName} Page Access Token</Label>
                            <Input 
                                type="password"
                                placeholder="EAA..." 
                                value={directAccessToken}
                                onChange={(e) => setDirectAccessToken(e.target.value)}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsManualSetupOpen(false)}>Cancel</Button>
                        <Button onClick={handleDirectConnect} disabled={directLoading}>
                            {directLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : `Connect ${channelName} Page`}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10">
                <CardHeader>
                    <CardTitle>Connected {channelName} Pages</CardTitle>
                    <CardDescription>
                        {channelName} pages you have connected to the bot.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center py-8">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : pages.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            No pages connected yet. Click "Connect {channelName}" to get started.
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Page Name</TableHead>
                                        <TableHead>Page ID</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {pages.map((page) => (
                                        <TableRow key={page.page_id}>
                                            <TableCell className="font-medium">
                                                <div className="flex items-center gap-2">
                                                    <Facebook className={isInstagram ? "h-4 w-4 text-pink-500" : "h-4 w-4 text-blue-600"} />
                                                    <span className="whitespace-nowrap">{page.name}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="font-mono text-xs whitespace-nowrap">{page.page_id}</TableCell>
                                            <TableCell>
                                                <div className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-semibold border bg-[#00ff88]/10 text-[#00ff88] border-[#00ff88]/50 whitespace-nowrap">
                                                    <Check className="h-3 w-3" />
                                                    <span>Active (Free)</span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-2">
                                                    <Button variant="outline" size="sm" onClick={() => copyWebhook()}>
                                                        <Copy className="h-4 w-4" />
                                                    </Button>
                                                    <Button variant="default" size="sm" onClick={() => handleManage(page)}>
                                                        <Database className="mr-2 h-4 w-4" />
                                                        Manage
                                                    </Button>
                                                    <Button variant="destructive" size="sm" onClick={() => setPagePendingRemoval(page)} disabled={removingPageId === page.page_id}>
                                                        {removingPageId === page.page_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            <AlertDialog open={!!pagePendingRemoval} onOpenChange={(open) => !open && setPagePendingRemoval(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Disconnect {pagePendingRemoval?.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will remove the connected Page from your workspace and stop the bot from replying to this Page.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={!!removingPageId}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            disabled={!!removingPageId || !pagePendingRemoval}
                            onClick={(event) => {
                                event.preventDefault();
                                if (pagePendingRemoval) {
                                    void handleRemovePage(pagePendingRemoval);
                                }
                            }}
                        >
                            {removingPageId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Disconnect Page
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Logs Dialog */}
            <AlertDialog open={isLogsOpen} onOpenChange={setIsLogsOpen}>
                <AlertDialogContent className="max-w-3xl h-[80vh] flex flex-col p-0 overflow-hidden bg-gray-50/50 backdrop-blur-xl border border-gray-200 shadow-2xl">
                    <div className="p-6 border-b border-gray-200 bg-white flex justify-between items-center">
                        <div>
                            <AlertDialogTitle className="text-xl font-bold flex items-center gap-2 text-gray-900">
                                <Terminal className="w-5 h-5 text-gray-500" />
                                Connection Activity Logs
                            </AlertDialogTitle>
                            <AlertDialogDescription className="text-sm text-gray-500 mt-1">
                                Real-time logs for debugging {channelName} connection and webhook setup issues.
                            </AlertDialogDescription>
                        </div>
                        <button 
                            onClick={() => setConnectionLogs([])}
                            className="text-sm text-red-600 hover:text-red-700 font-medium px-3 py-1.5 rounded-md hover:bg-red-50 transition-colors"
                        >
                            Clear Logs
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 bg-gray-950 font-mono text-sm shadow-inner">
                        {connectionLogs.length === 0 ? (
                            <div className="h-full flex items-center justify-center text-gray-500 flex-col gap-3">
                                <Terminal className="w-10 h-10 opacity-20" />
                                <p>No connection attempts yet.</p>
                                <p className="text-xs">Click 'Connect {channelName}' or 'Manual Setup' to see logs here.</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {connectionLogs.map((log, index) => (
                                    <div 
                                        key={index} 
                                        className={`rounded border p-3 ${
                                            log.type === 'error' ? 'bg-red-950/30 border-red-900/50 text-red-400' :
                                            log.type === 'warning' ? 'bg-yellow-950/30 border-yellow-900/50 text-yellow-400' :
                                            log.type === 'success' ? 'bg-green-950/30 border-green-900/50 text-green-400' :
                                            'bg-gray-900/50 border-gray-800 text-gray-300'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="font-bold flex items-center gap-2">
                                                <span className={`w-2 h-2 rounded-full ${
                                                    log.type === 'error' ? 'bg-red-500' :
                                                    log.type === 'warning' ? 'bg-yellow-500' :
                                                    log.type === 'success' ? 'bg-green-500' :
                                                    'bg-blue-500'
                                                }`} />
                                                [{log.action}]
                                            </span>
                                            <span className="text-xs opacity-50">
                                                {new Date(log.timestamp).toLocaleTimeString()}
                                            </span>
                                        </div>
                                        <div className="mb-2">{log.message}</div>
                                        {log.details && (
                                            <pre className="text-xs bg-black/40 p-3 rounded overflow-x-auto text-gray-400 mt-2 border border-white/5">
                                                {JSON.stringify(log.details, null, 2)}
                                            </pre>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="p-4 border-t border-gray-200 bg-white flex justify-end">
                        <AlertDialogCancel className="bg-gray-100 hover:bg-gray-200 text-gray-700 border-0 font-medium px-6">
                            Close
                        </AlertDialogCancel>
                    </div>
                </AlertDialogContent>
            </AlertDialog>

            {/* Webhook Monitor Dialog */}
            <AlertDialog open={isWebhookMonitorOpen} onOpenChange={setIsWebhookMonitorOpen}>
                <AlertDialogContent className="max-w-4xl h-[85vh] flex flex-col p-0 overflow-hidden bg-[#0A0A0A] border border-gray-800 shadow-2xl">
                    <div className="p-4 border-b border-gray-800 bg-[#111] flex justify-between items-center">
                        <div>
                            <AlertDialogTitle className="text-xl font-bold flex items-center gap-2 text-indigo-400">
                                <Database className="w-5 h-5" />
                                Live Incoming Event Monitor
                            </AlertDialogTitle>
                            <AlertDialogDescription className="text-sm text-gray-500 mt-1">
                                Real-time view of the last 50 payloads received from Meta. (Auto-refreshes every 3 seconds)
                            </AlertDialogDescription>
                        </div>
                        <div className="flex gap-2">
                            <button 
                                onClick={fetchWebhookLogs}
                                disabled={isFetchingWebhooks}
                                className="text-sm bg-indigo-900/50 text-indigo-300 hover:text-indigo-200 hover:bg-indigo-800/50 font-medium px-4 py-2 rounded-md transition-colors flex items-center gap-2"
                            >
                                {isFetchingWebhooks ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                                Refresh
                            </button>
                            <AlertDialogCancel className="bg-gray-800 hover:bg-gray-700 text-gray-300 border-0 font-medium px-4 py-2">
                                Close
                            </AlertDialogCancel>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 font-mono text-sm">
                        {webhookLogs.length === 0 ? (
                            <div className="h-full flex items-center justify-center text-gray-600 flex-col gap-3">
                                <Database className="w-12 h-12 opacity-20" />
                                <p>Waiting for incoming events...</p>
                                <p className="text-xs max-w-md text-center opacity-70">Send a message to your connected Facebook page to see the real-time payload.</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {webhookLogs.map((log: any, index: number) => (
                                    <div key={log.id || index} className="rounded-lg border border-gray-800 bg-[#151515] overflow-hidden">
                                        <div className="flex items-center justify-between p-3 border-b border-gray-800 bg-[#1A1A1A]">
                                            <div className="flex items-center gap-3">
                                                <span className="px-2 py-0.5 rounded text-xs font-bold bg-green-900/50 text-green-400 border border-green-800/50">
                                                    POST /webhook
                                                </span>
                                                <span className="text-gray-400 text-xs">
                                                    Object: <span className="text-blue-400 font-semibold">{log.object || 'unknown'}</span>
                                                </span>
                                                <span className="text-gray-400 text-xs">
                                                    Entries: <span className="text-yellow-400 font-semibold">{log.entry_count || 0}</span>
                                                </span>
                                            </div>
                                            <span className="text-xs text-gray-500">
                                                {new Date(log.timestamp).toLocaleString()}
                                            </span>
                                        </div>
                                        <div className="p-4 overflow-x-auto">
                                            <pre className="text-xs text-gray-300 leading-relaxed">
                                                {JSON.stringify(log.payload, null, 2)}
                                            </pre>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
