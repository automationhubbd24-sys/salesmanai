import { useState, useEffect, useCallback } from "react";
import { secureFetch } from "@/lib/api";
import { Link } from "react-router-dom";
import { useWhatsApp } from "@/context/WhatsAppContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { RefreshCw, Plus, QrCode, Trash2, Play, Pause, Server, Zap, Download, Smartphone, AlertTriangle, FileText, Loader2, Gift, Infinity as InfinityIcon, Facebook, Copy, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { WorkspaceSwitcher } from "@/components/dashboard/WorkspaceSwitcher";
import { BACKEND_URL } from "@/config";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function SessionManager() {
  const { sessions, refreshSessions, loading: listLoading, setCurrentSession } = useWhatsApp();
  const [newSessionName, setNewSessionName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [viewingSessionQr, setViewingSessionQr] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  
  // Modal States
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [loadingSession, setLoadingSession] = useState<{ name: string; action: string } | null>(null);
  
  // Renew States
  const [showRenewModal, setShowRenewModal] = useState(false);
  const [sessionToRenew, setSessionToRenew] = useState<string | null>(null);
  const [isRenewing, setIsRenewing] = useState(false);

  // Pairing Code States
  const [showPairingModal, setShowPairingModal] = useState(false);
  const [pairingPhoneNumber, setPairingPhoneNumber] = useState("");
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [isPairingLoading, setIsPairingLoading] = useState(false);

  // Selection States
  const [selectedEngine, setSelectedEngine] = useState<"WEBJS" | "OFFICIAL">("WEBJS");
  const [selectedPlan, setSelectedPlan] = useState("30");

  // Official API Fields
  const [useCustomCredentials, setUseCustomCredentials] = useState(false);
  const [wabaId, setWabaId] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [cloudApiToken, setCloudApiToken] = useState("");
  const [officialPhoneNumber, setOfficialPhoneNumber] = useState("");
  const [isFetchingId, setIsFetchingId] = useState(false);
  const [connectingMeta, setConnectingMeta] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Derived values for Webhook
  const WEBHOOK_URL = `${BACKEND_URL}/webhook`;
  const VERIFY_TOKEN = "salesman_ai_2026";

  const handleCopy = (text: string, field: string) => {
      navigator.clipboard.writeText(text);
      setCopiedField(field);
      toast.success(`${field} copied to clipboard!`);
      setTimeout(() => setCopiedField(null), 2000);
  };

  // Create Session States
  // const [createCountryCode, setCreateCountryCode] = useState("+880"); // Removed

  const handleWhatsAppEmbeddedSignup = async () => {
    if (!(window as any).FB) {
      toast.error("Facebook SDK not loaded. Please refresh.");
      return;
    }

    setConnectingMeta(true);
    try {
      const response: any = await new Promise((resolve, reject) => {
        (window as any).FB.login((res: any) => {
          if (res.authResponse) resolve(res);
          else reject(new Error("Login cancelled or failed"));
        }, {
          scope: 'whatsapp_business_management,whatsapp_business_messaging,business_management',
          extras: {
            feature: 'whatsapp_embedded_signup',
            setup_id: import.meta.env.VITE_FB_CONFIG_ID || '' // 2026 Configuration ID
          }
        });
      });

      const accessToken = response.authResponse.accessToken;
      
      const res = await secureFetch(`${BACKEND_URL}/api/whatsapp/official/embedded-signup`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem("auth_token")}`
        },
        body: JSON.stringify({ accessToken })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to link WhatsApp");

      // Auto-refresh sessions to show the newly created one
      refreshSessions();
      setShowCreateModal(false);
      
      toast.success(`Connected to ${data.phone_number}! Bot is now active.`);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setConnectingMeta(false);
    }
  };

  const handleLookupOfficialId = async () => {
    if (!officialPhoneNumber) {
        toast.error("Please enter your phone number first");
        return;
    }
    
    setIsFetchingId(true);
    try {
        const token = localStorage.getItem("auth_token");
        const params = new URLSearchParams();
        params.append("phoneNumber", officialPhoneNumber);
        if (useCustomCredentials) {
            params.append("wabaId", wabaId);
            params.append("cloudApiToken", cloudApiToken);
        }

        const res = await secureFetch(`${BACKEND_URL}/api/whatsapp/official/lookup-id?${params.toString()}`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Lookup failed");

        setPhoneNumberId(data.phone_number_id);
        toast.success("Phone Number ID fetched successfully!");
    } catch (e: any) {
        toast.error(e.message);
    } finally {
        setIsFetchingId(false);
    }
  };

  const fetchBalance = useCallback(async () => {
      try {
          const token = localStorage.getItem("auth_token");
          if (!token) return;

          const res = await secureFetch(`${BACKEND_URL}/api/auth/payments/me`, {
              headers: { Authorization: `Bearer ${token}` }
          });

          if (!res.ok) return;

          const data = await res.json();
          if (typeof data.balance === "number") {
              setBalance(data.balance);
          }
      } catch (e) {
          console.error("Failed to fetch balance", e);
      }
  }, []);

  useEffect(() => {
    fetchBalance();

    // Initialize Facebook SDK
    const initFB = () => {
        const appId = import.meta.env.VITE_FACEBOOK_APP_ID || '3741087806186945';
        if ((window as any).FB) {
            (window as any).FB.init({
                appId      : appId,
                cookie     : true,
                xfbml      : true,
                version    : 'v20.0'
            });
            console.log("FB SDK Initialized manually with ID:", appId);
        }
    };

    if (!(window as any).FB) {
        (window as any).fbAsyncInit = function() {
            initFB();
        };

        (function(d, s, id){
            var js: HTMLScriptElement, fjs = d.getElementsByTagName(s)[0] as HTMLElement;
            if (d.getElementById(id)) { initFB(); return; }
            js = d.createElement(s) as HTMLScriptElement; js.id = id;
            js.src = "https://connect.facebook.net/en_US/sdk.js";
            if (fjs && fjs.parentNode) {
                fjs.parentNode.insertBefore(js, fjs);
            } else {
                d.head.appendChild(js);
            }
        }(document, 'script', 'facebook-jssdk'));
    } else {
        initFB();
    }
  }, [fetchBalance]);

  // Poll for updates when QR dialog is open
  useEffect(() => {
    let interval: any;
    if (viewingSessionQr) {
      interval = setInterval(refreshSessions, 3000); // Poll every 3s
    }
    return () => clearInterval(interval);
  }, [viewingSessionQr, refreshSessions]);

  // Poll for QR code specifically if it's missing in the active dialog
  useEffect(() => {
    let interval: any;
    // We poll if:
    // 1. We are viewing a session
    // 2. The QR code is missing OR we just want to keep it fresh
    // 3. The session is NOT working (no need to poll if connected)
    if (viewingSessionQr) {
      const fetchQr = async () => {
          try {
              const res = await secureFetch(`${BACKEND_URL}/api/whatsapp/session/qr/${viewingSessionQr}`);
              const data = await res.json();
              if (data.qr_code) {
                  setQrCodeUrl(data.qr_code);
              }
          } catch (e) {
              console.error("Error polling QR:", e);
          }
      };
      
      fetchQr(); // Initial call
      interval = setInterval(fetchQr, 3000); // Poll every 3s
    }
    return () => clearInterval(interval);
  }, [viewingSessionQr]);

  // Calculate Price
  const getPrice = () => {
    if (selectedEngine === "OFFICIAL") {
        return 2000; // Lifetime Fixed Price
    }

    // Determine price based on selected plan (WEBJS engine only)
    if (selectedPlan === "2") return 200; // 48 Hrs
    if (selectedPlan === "30") return 1500;
    if (selectedPlan === "60") return 2800;
    if (selectedPlan === "90") return 3500;
    return 0;
  };

  const downloadQR = () => {
    if (!qrCodeUrl) return;
    
    // Check if it's a data URL (base64)
    if (qrCodeUrl.startsWith('data:image')) {
        const link = document.createElement('a');
        link.href = qrCodeUrl;
        link.download = `whatsapp-qr-${viewingSessionQr || 'session'}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast.success("QR Code downloaded!");
    } else {
        // If it's a regular URL, fetch and blob it (less likely here as backend returns base64)
        toast.error("Invalid QR format for download");
    }
  };

  const openPairingModal = () => {
      setPairingPhoneNumber("");
      setPairingCode(null);
      setShowPairingModal(true);
  };

  const handleGetPairingCode = async () => {
      if (!pairingPhoneNumber || !viewingSessionQr) return;
      
      setIsPairingLoading(true);
      try {
          const token = localStorage.getItem("auth_token");
          const res = await secureFetch(`${BACKEND_URL}/api/whatsapp/session/pairing-code`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            body: JSON.stringify({ 
                sessionName: viewingSessionQr,
                phoneNumber: pairingPhoneNumber
            })
          });
          
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to get pairing code');
          
          setPairingCode(data.code);
          toast.success("Pairing code generated!");
      } catch (error: any) {
          toast.error(error.message);
      } finally {
          setIsPairingLoading(false);
      }
  };

  const handleCreateSession = async () => {
    if (!newSessionName.trim()) {
      toast.error("Please enter a session name");
      return;
    }

    const price = getPrice();
    if (balance !== null && balance < price) {
        toast.error(`Insufficient Balance. You need ${price} BDT.`);
        return;
    }

    if (selectedEngine === "OFFICIAL") {
      if (!phoneNumberId) {
        toast.error("Please enter your Phone Number ID");
        return;
      }
      if (useCustomCredentials && (!wabaId || !cloudApiToken)) {
        toast.error("Please fill all Official API fields or use Managed Mode");
        return;
      }
    }

    setIsCreating(true);
    setQrCodeUrl(null);
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) {
        throw new Error("Please login again");
      }

      const suffix = Math.random().toString(36).substring(2, 8);
      // Sanitize session name: remove spaces, special chars
      const sanitizedName = newSessionName.trim().replace(/[^a-zA-Z0-9]/g, '_');
      const finalSessionName = `${sanitizedName}_${suffix}`;

      const payload: any = { 
        sessionName: finalSessionName,
        planDays: selectedEngine === "OFFICIAL" ? 36500 : parseInt(selectedPlan), // 36500 for Lifetime
        engine: selectedEngine
      };

      if (selectedEngine === "OFFICIAL") {
        payload.waba_id = useCustomCredentials ? wabaId : null;
        payload.phone_number_id = phoneNumberId; // Always required for routing
        payload.cloud_api_token = useCustomCredentials ? cloudApiToken : null;
      }

      console.log("Creating session with payload:", payload);

      const res = await secureFetch(`${BACKEND_URL}/api/whatsapp/session/create`, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create session');
      
      toast.success("Session created!");
      
      // Auto-connect database
      // Check for wp_db_id OR id (some backends return id)
      const dbId = data.wp_db_id || data.id;
      if (dbId) {
          const dbIdStr = String(dbId);
          localStorage.setItem("active_wp_db_id", dbIdStr);
          // Dispatch event for same-tab updates
          window.dispatchEvent(new Event("db-connection-changed"));
          toast.success(`Database Connected: ID ${dbId}`);
      }

      // Refresh sessions and auto-select the new one
      await refreshSessions();
      
      // Construct a temporary session object to set immediately if refresh is lagging
      // But ideally refreshSessions should find it because backend waits for it
      // We need to find the session in the UPDATED sessions list.
      // Since refreshSessions updates the context state, we can't access the *new* state immediately here 
      // because state updates are async.
      // However, we can construct a partial session object and set it.
      
      const newSessionObj = {
          name: finalSessionName,
          status: 'SCAN_QR_CODE', // Initial status
          wp_db_id: dbId,
          config: {},
          me: null,
          expires_at: null, // Will be fetched on next refresh
          plan_days: payload.planDays
      };
      
      // Force set current session to the new one
      setCurrentSession(newSessionObj);

      fetchBalance(); 
      setShowCreateModal(false);
      setNewSessionName("");
      
      // Handle QR Code if present
      if (data.qr_code) {
          setQrCodeUrl(data.qr_code);
          setViewingSessionQr(finalSessionName);
      } else {
          fetchQr(finalSessionName);
      }
      
      await refreshSessions();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error(message);
    } finally {
      setIsCreating(false);
    }
  };

  const fetchQr = async (sessionName: string, retries = 10) => {
    try {
      setViewingSessionQr(sessionName);
      const res = await secureFetch(`${BACKEND_URL}/api/whatsapp/session/qr/${sessionName}?t=${Date.now()}`, {
          method: 'GET'
      });
      
      if (res.ok) {
        const data = await res.json();
        if (data.qr_code) {
            setQrCodeUrl(data.qr_code);
        } else {
             if (retries > 0) {
                setTimeout(() => fetchQr(sessionName, retries - 1), 3000);
             }
        }
      } else {
        if (retries > 0) {
            setTimeout(() => fetchQr(sessionName, retries - 1), 3000);
            return;
        }
        toast.error("QR Code not available yet");
      }
    } catch (e) {
        console.error(e);
        if (retries > 0) {
            setTimeout(() => fetchQr(sessionName, retries - 1), 3000);
        }
    }
  };

  const handleAction = async (action: 'start' | 'stop' | 'delete' | 'restart' | 'renew', sessionName: string) => {
    if (action === 'delete') {
        setSessionToDelete(sessionName);
        setShowDeleteModal(true);
        return;
    }
    
    if (action === 'renew') {
        setSessionToRenew(sessionName);
        setSelectedPlan("30"); // Default
        setShowRenewModal(true);
        return;
    }

    // Direct action for start/stop/restart
    executeAction(action, sessionName);
  };

  const handleRenewSession = async () => {
      if (!sessionToRenew) return;
      
      const price = getPrice();
      if (balance !== null && balance < price) {
          toast.error(`Insufficient Balance. You need ${price} BDT.`);
          return;
      }
  
      setIsRenewing(true);
      try {
          const token = localStorage.getItem("auth_token");
          if (!token) {
            throw new Error("Please login again");
          }
          const res = await secureFetch(`${BACKEND_URL}/api/whatsapp/session/renew`, {
              method: 'POST',
              headers: { 
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`
              },
              body: JSON.stringify({ 
                  sessionName: sessionToRenew,
                  days: parseInt(selectedPlan)
              })
          });
  
          if (!res.ok) throw new Error('Renew failed');
          
          toast.success("Session renewed successfully!");
          await refreshSessions();
          setShowRenewModal(false);
          setSessionToRenew(null);
          fetchBalance();
      } catch (e: any) {
          toast.error(e.message || "Failed to renew");
      } finally {
          setIsRenewing(false);
      }
  };

  const executeAction = async (action: 'start' | 'stop' | 'delete' | 'restart', sessionName: string) => {
    if (action === 'delete') {
      setIsDeleting(true);
    } else {
      setLoadingSession({ name: sessionName, action });
    }
    
    try {
      const token = localStorage.getItem("auth_token");
      const res = await secureFetch(`${BACKEND_URL}/api/whatsapp/session/${action}`, {
        method: action === 'delete' ? 'DELETE' : 'POST',
        headers: { 
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ sessionName })
      });
      
      if (!res.ok) throw new Error('Action failed');
      
      toast.success(`Session ${action}ed successfully`);
      
      if (action === 'restart') {
          setTimeout(async () => {
              await refreshSessions();
              fetchQr(sessionName);
          }, 3000);
      } else {
          await refreshSessions();
      }

      if (action === 'delete') {
          if (viewingSessionQr === sessionName) {
            setViewingSessionQr(null);
            setQrCodeUrl(null);
          }
          setShowDeleteModal(false);
          setSessionToDelete(null);
      }
    } catch (error: unknown) {
      toast.error(`Failed to ${action} session`);
    } finally {
      if (action === 'delete') {
        setIsDeleting(false);
      } else {
        setLoadingSession(null);
      }
    }
  };

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8">
        <div>
          <h1 className="text-3xl font-black text-white tracking-tight flex items-center gap-3">
            <Smartphone className="text-primary h-8 w-8" />
            WhatsApp Session Manager
          </h1>
          <p className="text-gray-400 mt-2 font-medium">
            Manage your WhatsApp sessions and automation settings.
          </p>
          <div className="mt-2">
            <WorkspaceSwitcher platform="whatsapp" />
          </div>
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
        <div className="flex flex-wrap gap-2 items-center">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/dashboard/api" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              API
            </Link>
          </Button>
          {balance !== null && (
              <Badge variant="outline" className="text-base px-3 py-1 border-green-200 bg-green-50 text-green-700">
                  Balance: {balance} BDT
              </Badge>
          )}
          <Button onClick={() => refreshSessions()} variant="outline" size="sm">
            <RefreshCw className={`mr-2 h-4 w-4 ${listLoading ? 'animate-spin' : ''}`} />
            Refresh List
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* New Session Trigger Card */}
        <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10 hover:border-[#00ff88]/50 hover:shadow-[0_0_40px_rgba(0,255,136,0.25)] cursor-pointer transition-all duration-300 flex flex-col items-center justify-center min-h-[280px] md:min-h-[320px] group rounded-2xl" onClick={() => setShowCreateModal(true)}>
          <CardContent className="flex flex-col items-center gap-6 py-8 md:py-10">
              <div className="relative">
                  <div className="absolute inset-0 bg-green-500/20 blur-2xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  <div className="relative p-5 rounded-2xl bg-slate-900 border border-slate-800 group-hover:border-green-500/40 group-hover:bg-green-950/20 transition-all duration-300 shadow-xl ring-1 ring-white/5">
                    <Plus className="h-10 w-10 text-slate-500 group-hover:text-green-400 transition-colors duration-300" />
                  </div>
              </div>
              <div className="text-center space-y-2 max-w-[240px]">
                <h3 className="font-bold text-xl md:text-2xl text-slate-200 group-hover:text-green-400 transition-colors tracking-tight">Add Connection</h3>
                <p className="text-xs md:text-sm text-slate-500 px-2 leading-relaxed group-hover:text-slate-400 transition-colors">Deploy a new WhatsApp engine with our premium infrastructure.</p>
              </div>
              <Button variant="outline" className="mt-2 h-9 border-slate-700/50 text-slate-400 group-hover:text-green-400 group-hover:border-green-500/40 group-hover:bg-green-500/5 font-medium px-6 rounded-full transition-all text-xs md:text-sm">
                  Initialize
              </Button>
          </CardContent>
        </Card>

        {/* Existing Sessions List */}
        {sessions.map((session) => (
          <Card key={session.name} className={`relative overflow-hidden bg-[#0f0f0f]/80 backdrop-blur-sm border transition-all duration-300 group rounded-2xl ${
            session.api_type === 'official' 
              ? 'border-blue-500/30 hover:border-blue-500/60 hover:shadow-[0_0_35px_rgba(59,130,246,0.2)]' 
              : 'border-white/10 hover:border-[#00ff88]/40 hover:shadow-[0_0_35px_rgba(0,255,136,0.2)]'
          }`}>
            {/* Status Indicator Line (Top) */}
            <div className={`absolute top-0 left-0 w-full h-[2px] ${
              session.api_type === 'official'
                ? 'bg-gradient-to-r from-blue-500/80 to-indigo-400/80'
                : session.status === 'WORKING' 
                  ? 'bg-gradient-to-r from-green-500/80 to-emerald-400/80' 
                  : 'bg-gradient-to-r from-yellow-500/80 to-orange-400/80'
            }`} />
            
            <CardHeader className="pb-3 bg-slate-900/20 border-b border-slate-800/40 pt-5">
              <div className="flex justify-between items-center mb-1">
                <div className="flex items-center gap-2.5">
                    <div className={`h-2.5 w-2.5 rounded-full shadow-[0_0_8px] ${session.status === 'WORKING' ? 'bg-green-500 shadow-green-500/40 animate-pulse' : 'bg-yellow-500 shadow-yellow-500/40'}`} />
                    <CardTitle className="text-lg md:text-xl font-bold text-slate-100 tracking-tight truncate max-w-[150px]">{session.name}</CardTitle>
                    {session.api_type === 'official' && (
                      <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[9px] h-4 uppercase font-black">Official</Badge>
                    )}
                </div>
                <Badge variant="outline" className={`font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-md ${session.status === 'WORKING' ? 'border-green-500/20 text-green-400 bg-green-500/5' : 'border-yellow-500/20 text-yellow-400 bg-yellow-500/5'}`}>
                  {session.status}
                </Badge>
              </div>
              <CardDescription className="text-[10px] font-mono text-slate-600 flex items-center gap-1.5">
                <span className="text-slate-500">ID:</span> 
                <span className="bg-slate-900/50 px-1 py-0.5 rounded text-slate-400 truncate max-w-[180px]">{(session as any).wp_id || String(session.id)}</span>
              </CardDescription>
            </CardHeader>

            <CardContent className="pt-5 space-y-3">
              {/* Expiry Info Enhanced */}
              {(session as any).expires_at && (() => {
                  const expiresAt = new Date((session as any).expires_at);
                  const now = new Date();
                  const diffTime = expiresAt.getTime() - now.getTime();
                  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                  const isExpired = diffDays <= 0;
                  
                  return (
                    <div className={`flex justify-between items-center p-2.5 rounded-lg border mb-3 ${
                        isExpired 
                            ? "bg-red-500/5 border-red-500/20" 
                            : diffDays <= 3 
                                ? "bg-orange-500/5 border-orange-500/20" 
                                : "bg-slate-800/30 border-slate-700/30"
                    }`}>
                        <div className="flex flex-col gap-0.5">
                            <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">
                                {isExpired ? "Subscription Ended" : "Valid Until"}
                            </span>
                            <div className="flex items-center gap-1.5">
                                <div className={`h-1.5 w-1.5 rounded-full ${isExpired ? "bg-red-500" : diffDays <= 3 ? "bg-orange-500" : "bg-emerald-500"}`} />
                                <span className={`text-xs font-bold font-mono ${
                                    isExpired ? "text-red-400" : diffDays <= 3 ? "text-orange-400" : "text-emerald-400"
                                }`}>
                                    {isExpired 
                                        ? "EXPIRED" 
                                        : `${diffDays} Day${diffDays !== 1 ? 's' : ''} Left`}
                                </span>
                                <span className="text-[10px] text-slate-600 font-mono ml-1">
                                    ({expiresAt.toLocaleDateString()})
                                </span>
                            </div>
                        </div>
                         <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => handleAction('renew', session.name)} 
                          className={`h-7 text-[10px] px-3 border-dashed ${
                              isExpired 
                                ? "border-red-500/30 text-red-400 hover:bg-red-500/10 hover:border-red-500/50" 
                                : "border-green-500/30 text-green-400 hover:bg-green-500/10 hover:border-green-500/50"
                          }`}
                      >
                          Renew
                      </Button>
                    </div>
                  );
              })()}

              {/* Control Grid */}
              <div className="grid grid-cols-2 gap-2.5">
                {session.status === 'STOPPED' ? (
                   <Button 
                     size="sm" 
                     variant="outline" 
                     disabled={loadingSession?.name === session.name}
                     className="h-9 border-slate-800 bg-slate-900/30 text-slate-300 hover:bg-green-950/20 hover:text-green-400 hover:border-green-500/20 transition-all text-xs" 
                     onClick={() => handleAction('start', session.name)}
                   >
                     {loadingSession?.name === session.name && loadingSession?.action === 'start' ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                     ) : (
                        <Play className="mr-1.5 h-3.5 w-3.5" />
                     )}
                     Start
                   </Button>
                ) : (
                   <Button 
                     size="sm" 
                     variant="outline" 
                     disabled={loadingSession?.name === session.name}
                     className="h-9 border-slate-800 bg-slate-900/30 text-slate-300 hover:bg-yellow-950/20 hover:text-yellow-400 hover:border-yellow-500/20 transition-all text-xs" 
                     onClick={() => handleAction('stop', session.name)}
                   >
                     {loadingSession?.name === session.name && loadingSession?.action === 'stop' ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                     ) : (
                        <Pause className="mr-1.5 h-3.5 w-3.5" />
                     )}
                     Stop
                   </Button>
                )}
                
                <Button 
                    size="sm" 
                    variant="outline" 
                    disabled={loadingSession?.name === session.name}
                    className="h-9 border-slate-800 bg-slate-900/30 text-slate-300 hover:bg-orange-950/20 hover:text-orange-400 hover:border-orange-500/20 transition-all text-xs" 
                    onClick={() => handleAction('restart', session.name)}
                >
                    <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loadingSession?.name === session.name && loadingSession?.action === 'restart' ? 'animate-spin' : ''}`} /> 
                    Restart
                </Button>
              </div>

              {/* Secondary Actions */}
              <div className="flex gap-2.5">
                  {session.api_type === 'official' ? (
                      <div className="flex-1 bg-blue-500/10 border border-blue-500/20 rounded-lg p-2 text-center">
                          <p className="text-[10px] text-blue-400 font-bold uppercase">Official Cloud API</p>
                          <p className="text-[9px] text-slate-500 mt-1">Meta Official Integration</p>
                      </div>
                  ) : (
                    <Button 
                        variant="secondary" 
                        className={`flex-1 h-9 text-xs border border-slate-800/50 ${session.status === 'WORKING' ? 'bg-green-500/5 text-green-500 border-green-500/10' : 'bg-slate-800/50 text-slate-300 hover:bg-slate-800'}`}
                        onClick={() => fetchQr(session.name)}
                        disabled={session.status === 'WORKING'}
                    >
                        <QrCode className="mr-1.5 h-3.5 w-3.5" /> 
                        {session.status === 'WORKING' ? 'Linked' : 'Connect'}
                    </Button>
                  )}

                  <Button size="sm" variant="outline" className="h-9 w-10 px-0 border-slate-800/50 bg-slate-900/30 text-slate-400 hover:bg-red-950/20 hover:text-red-400 hover:border-red-500/20 transition-all" onClick={() => handleAction('delete', session.name)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
              </div>

              {/* Official API Webhook Info */}
              {session.api_type === 'official' && (
                <div className="mt-2 p-3 bg-blue-950/20 border border-blue-500/20 rounded-xl space-y-2">
                    <div className="flex items-center gap-2">
                        <Server className="h-3.5 w-3.5 text-blue-400" />
                        <span className="text-[11px] font-bold text-blue-400 uppercase tracking-wider">Webhook Config</span>
                    </div>
                    <div className="space-y-1">
                        <p className="text-[10px] text-slate-400">Copy this URL to Meta Developer Portal:</p>
                        <div className="flex items-center gap-2 bg-black/40 p-2 rounded border border-white/5">
                            <code className="text-[9px] text-blue-300 truncate flex-1">
                                {`${BACKEND_URL}/webhook`}
                            </code>
                            <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-5 w-5 text-slate-500 hover:text-blue-400"
                                onClick={() => {
                                    navigator.clipboard.writeText(`${BACKEND_URL}/webhook`);
                                    toast.success("Webhook URL copied!");
                                }}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                            </Button>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 pt-1 border-t border-white/5">
                        <span className="text-[9px] text-slate-500 font-medium">Verify Token:</span>
                        <code className="text-[9px] text-emerald-400 font-bold">salesman_ai_2026</code>
                    </div>
                </div>
              )}

              {/* QR Display Area */}
              {viewingSessionQr === session.name && session.status !== 'WORKING' && (
                <div className="mt-3 flex flex-col items-center p-4 rounded-xl bg-white border-2 border-slate-800 shadow-inner animate-in fade-in zoom-in duration-300 relative group">
                    {qrCodeUrl ? (
                        <>
                            <img 
                              src={qrCodeUrl} 
                              alt="QR Code" 
                              className="w-full max-w-[400px] h-auto min-h-[200px] object-contain mix-blend-multiply transition-all duration-500" 
                            />
                            <div className="flex flex-col items-center gap-2 mt-4 w-full justify-center">
                                <div className="flex items-center gap-2">
                                    <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Scan with WhatsApp</p>
                                    <Button 
                                        size="icon" 
                                        variant="ghost" 
                                        className="h-6 w-6 text-slate-400 hover:text-green-600 hover:bg-green-50" 
                                        onClick={downloadQR}
                                        title="Download QR"
                                    >
                                        <Download className="h-3 w-3" />
                                    </Button>
                                </div>
                                <Button
                                    variant="link"
                                    size="sm"
                                    className="h-auto p-0 text-[10px] text-blue-600 underline"
                                    onClick={openPairingModal}
                                >
                                    Or link with phone number
                                </Button>
                                <div className="mt-2 p-2 bg-yellow-500/10 border border-yellow-500/20 rounded text-[10px] text-yellow-600 text-center max-w-[200px] space-y-1">
                                    <AlertTriangle className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />
                                    <div className="space-y-1">
                                        <p className="text-xs font-semibold text-yellow-500">Security Note</p>
                                        <p className="text-xs text-yellow-600/90 leading-relaxed">
                                            WhatsApp may warn you not to share this code. Since you are connecting your own session, it is safe to proceed.
                                            <br/><strong className="text-yellow-500">Never share this code with anyone else.</strong>
                                        </p>
                                    </div>
                                </div>
                                <p className="text-[10px] text-slate-400 font-medium text-center leading-tight max-w-[180px]">
                                    Use <span className="text-blue-500 font-bold">Link with Phone Number</span> for best experience.
                                </p>
                            </div>
                        </>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-40 w-40">
                            <Loader2 className="h-8 w-8 text-slate-400 animate-spin" />
                            <p className="text-xs text-slate-500 mt-2">Loading QR...</p>
                        </div>
                    )}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* CREATE SESSION MODAL */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent className="sm:max-w-[600px] bg-slate-950 shadow-2xl border border-slate-800 rounded-2xl overflow-hidden p-0 gap-0 text-slate-100">
          <div className="bg-slate-900/50 p-6 border-b border-slate-800">
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold flex items-center gap-2 text-white">
                 <Zap className="h-6 w-6 text-green-500" />
                 Create New Session
              </DialogTitle>
              <DialogDescription className="text-slate-400">
                Configure your engine and subscription plan to start automating.
              </DialogDescription>
            </DialogHeader>
          </div>
          
          <div className="grid gap-6 p-6">
            {/* Engine Selection */}
            <div className="space-y-3">
                <Label className="text-base font-semibold text-slate-200">Select Engine</Label>
                <div className="grid grid-cols-2 gap-4">
                    <div 
                        onClick={() => setSelectedEngine("WEBJS")}
                        className={`cursor-pointer p-4 rounded-xl border-2 transition-all duration-200 ${
                            selectedEngine === "WEBJS" 
                            ? "border-green-500 bg-green-500/10 shadow-[0_0_15px_rgba(34,197,94,0.1)]" 
                            : "border-slate-800 bg-slate-900/50 hover:border-slate-700"
                        }`}
                    >
                        <div className="flex items-center gap-3">
                            <Zap className={`w-5 h-5 ${selectedEngine === "WEBJS" ? "text-green-400" : "text-slate-500"}`} />
                            <div>
                                <p className={`text-sm font-bold ${selectedEngine === "WEBJS" ? "text-green-400" : "text-slate-300"}`}>WEBJS (Unofficial)</p>
                                <p className="text-[10px] text-slate-500">Scan QR Code to connect.</p>
                            </div>
                        </div>
                    </div>
                    <div 
                        onClick={() => {
                            setSelectedEngine("OFFICIAL");
                            setSelectedPlan("30");
                        }}
                        className={`cursor-pointer p-4 rounded-xl border-2 transition-all duration-200 ${
                            selectedEngine === "OFFICIAL" 
                            ? "border-blue-500 bg-blue-500/10 shadow-[0_0_15px_rgba(59,130,246,0.1)]" 
                            : "border-slate-800 bg-slate-900/50 hover:border-slate-700"
                        }`}
                    >
                        <div className="flex items-center gap-3">
                            <Server className={`w-5 h-5 ${selectedEngine === "OFFICIAL" ? "text-blue-400" : "text-slate-500"}`} />
                            <div>
                                <p className={`text-sm font-bold ${selectedEngine === "OFFICIAL" ? "text-blue-400" : "text-slate-300"}`}>Cloud API (Official)</p>
                                <p className="text-[10px] text-slate-500">Connect via Meta Platform.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {selectedEngine === "OFFICIAL" && (
                <div className="space-y-4 p-5 bg-blue-500/5 border border-blue-500/20 rounded-2xl">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <Server className="w-4 h-4 text-blue-400" />
                            <span className="text-sm font-bold text-blue-400 uppercase tracking-tight">Managed Infrastructure</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Label htmlFor="custom-creds" className="text-[10px] text-slate-500 uppercase font-bold cursor-pointer">Use My Own API</Label>
                            <Switch 
                                id="custom-creds"
                                checked={useCustomCredentials}
                                onCheckedChange={setUseCustomCredentials}
                                className="scale-75 data-[state=checked]:bg-blue-600"
                            />
                        </div>
                    </div>

                    {/* Webhook Configuration Card */}
                    <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 space-y-3">
                        <div className="flex items-center gap-2 pb-1 border-b border-slate-800/50">
                            <Zap className="w-3.5 h-3.5 text-yellow-500" />
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Webhook Configuration</span>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <Label className="text-[9px] font-bold text-slate-500 uppercase">Callback URL</Label>
                                <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2">
                                    <span className="text-[11px] text-slate-300 font-mono truncate flex-1">{WEBHOOK_URL}</span>
                                    <button 
                                        onClick={() => handleCopy(WEBHOOK_URL, "Webhook URL")}
                                        className="text-slate-500 hover:text-blue-400 transition-colors"
                                    >
                                        {copiedField === "Webhook URL" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                                    </button>
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-[9px] font-bold text-slate-500 uppercase">Verify Token</Label>
                                <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2">
                                    <span className="text-[11px] text-slate-300 font-mono truncate flex-1">{VERIFY_TOKEN}</span>
                                    <button 
                                        onClick={() => handleCopy(VERIFY_TOKEN, "Verify Token")}
                                        className="text-slate-500 hover:text-blue-400 transition-colors"
                                    >
                                        {copiedField === "Verify Token" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {!useCustomCredentials ? (
                        <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                            <div className="bg-blue-600/10 p-4 rounded-xl border border-blue-500/20 flex flex-col md:flex-row items-center justify-between gap-4">
                                <div>
                                    <p className="text-xs font-bold text-blue-400 uppercase tracking-tight">Quick Connect</p>
                                    <p className="text-[11px] text-blue-300/80 leading-relaxed mt-1">
                                        Log in with Facebook to auto-fetch your WhatsApp Business Account.
                                    </p>
                                </div>
                                <Button 
                                    type="button"
                                    size="sm"
                                    onClick={handleWhatsAppEmbeddedSignup}
                                    disabled={connectingMeta}
                                    className="bg-blue-600 hover:bg-blue-700 text-white w-full md:w-auto"
                                >
                                    {connectingMeta ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Facebook className="mr-2 h-4 w-4" />}
                                    {connectingMeta ? "Connecting..." : "Connect with Meta"}
                                </Button>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Phone Number</Label>
                                    <div className="flex gap-2">
                                        <Input 
                                            placeholder="+88017..." 
                                            value={officialPhoneNumber}
                                            onChange={(e) => setOfficialPhoneNumber(e.target.value)}
                                            className="h-10 bg-slate-900/50 border-slate-800 text-white text-sm focus:border-blue-500/50"
                                        />
                                        <Button 
                                            size="sm" 
                                            variant="secondary" 
                                            onClick={handleLookupOfficialId}
                                            disabled={isFetchingId}
                                            className="h-10 bg-blue-600 hover:bg-blue-700 text-white px-3"
                                        >
                                            {isFetchingId ? <Loader2 className="h-4 w-4 animate-spin" /> : "Fetch"}
                                        </Button>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Phone Number ID</Label>
                                    <Input 
                                        placeholder="15-digit ID" 
                                        value={phoneNumberId}
                                        onChange={(e) => setPhoneNumberId(e.target.value)}
                                        className="h-10 bg-slate-900/50 border-slate-800 text-white text-sm focus:border-blue-500/50"
                                    />
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">WABA ID</Label>
                                    <Input 
                                        placeholder="Enter WABA ID" 
                                        value={wabaId}
                                        onChange={(e) => setWabaId(e.target.value)}
                                        className="h-10 bg-slate-900/50 border-slate-800 text-white text-sm focus:border-blue-500/50"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Phone Number</Label>
                                    <div className="flex gap-2">
                                        <Input 
                                            placeholder="+88017..." 
                                            value={officialPhoneNumber}
                                            onChange={(e) => setOfficialPhoneNumber(e.target.value)}
                                            className="h-10 bg-slate-900/50 border-slate-800 text-white text-sm focus:border-blue-500/50"
                                        />
                                        <Button 
                                            size="sm" 
                                            variant="secondary" 
                                            onClick={handleLookupOfficialId}
                                            disabled={isFetchingId}
                                            className="h-10 bg-blue-600 hover:bg-blue-700 text-white px-3"
                                        >
                                            {isFetchingId ? <Loader2 className="h-4 w-4 animate-spin" /> : "Fetch"}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Phone Number ID</Label>
                                    <Input 
                                        placeholder="Enter Phone ID" 
                                        value={phoneNumberId}
                                        onChange={(e) => setPhoneNumberId(e.target.value)}
                                        className="h-10 bg-slate-900/50 border-slate-800 text-white text-sm focus:border-blue-500/50"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Permanent Access Token</Label>
                                    <Input 
                                        type="password"
                                        placeholder="EAAG..." 
                                        value={cloudApiToken}
                                        onChange={(e) => setCloudApiToken(e.target.value)}
                                        className="h-10 bg-slate-900/50 border-slate-800 text-white text-sm focus:border-blue-500/50"
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Plan Selection */}
            <div className="space-y-3">
                <Label className="text-base font-semibold text-slate-200">
                    {selectedEngine === "OFFICIAL" ? "License Type" : "Select Duration"}
                </Label>
                <div className="grid grid-cols-4 gap-3">
                    {selectedEngine === "OFFICIAL" ? (
                        <div 
                            className="col-span-4 cursor-pointer rounded-xl border-2 p-3 text-center transition-all duration-200 border-blue-500/50 bg-blue-500/10 shadow-[0_0_15px_rgba(59,130,246,0.1)]"
                        >
                            <div className="flex items-center justify-center gap-2">
                                <InfinityIcon className="h-5 w-5 text-blue-400" />
                                <div className="text-lg font-black text-blue-400 uppercase tracking-wider">Lifetime License</div>
                            </div>
                            <div className="text-xs font-bold text-blue-500/70 mt-1">2000 BDT • Unlimited Access</div>
                        </div>
                    ) : (
                        ["2", "30", "60", "90"].map((plan) => {
                            const isSelected = selectedPlan === plan;
                            let price = 0;
                            if (plan === "2") price = 200;
                            else if (plan === "30") price = 1500;
                            else if (plan === "60") price = 2800;
                            else if (plan === "90") price = 3500;

                            return (
                                <div 
                                    key={plan}
                                    onClick={() => setSelectedPlan(plan)}
                                    className={`cursor-pointer rounded-xl border-2 p-2 text-center transition-all duration-200 hover:scale-[1.02] ${
                                        isSelected 
                                        ? "border-green-500/50 bg-green-500/10 shadow-[0_0_15px_rgba(34,197,94,0.1)]" 
                                        : "border-slate-800 bg-slate-900/50 hover:border-slate-700 hover:bg-slate-900"
                                    }`}
                                >
                                    <div className={`text-sm md:text-base font-bold ${isSelected ? "text-green-400" : "text-slate-300"}`}>
                                        {plan === "2" ? "48 Hrs" : `${plan} Days`}
                                    </div>
                                    <div className={`text-xs font-medium ${isSelected ? "text-green-500" : "text-slate-500"}`}>{price} BDT</div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Session Name */}
            <div className="space-y-2">
                <Label className="text-base font-semibold text-slate-200">Session Name</Label>
                <Input 
                    placeholder="e.g. Support Bot 1" 
                    value={newSessionName}
                    onChange={(e) => setNewSessionName(e.target.value)}
                    className="h-11 bg-slate-900 border-slate-800 focus:border-green-500 focus:ring-green-500/20 rounded-lg text-white placeholder:text-slate-600"
                />
            </div>

            {/* Total Price */}
            <div className="flex items-center justify-between rounded-xl border border-slate-800 p-5 bg-slate-900/50">
                <div className="flex flex-col">
                    <span className="text-sm font-semibold text-slate-300">Total Cost</span>
                    <span className="text-xs text-slate-500">Deducted from your balance</span>
                </div>
                <div className="text-3xl font-black text-green-500">
                    {getPrice()} <span className="text-sm font-medium text-green-600/70">BDT</span>
                </div>
            </div>
          </div>

          <div className="p-6 bg-slate-900 border-t border-slate-800 flex justify-end gap-3">
            <Button variant="outline" size="lg" onClick={() => setShowCreateModal(false)} className="border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800 hover:text-white">Cancel</Button>
            <Button size="lg" onClick={handleCreateSession} disabled={isCreating} className="bg-green-600 hover:bg-green-700 text-white min-w-[150px] shadow-lg shadow-green-900/20">
                {isCreating ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : "Pay & Create"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* DELETE CONFIRMATION MODAL */}
      <Dialog open={showDeleteModal} onOpenChange={setShowDeleteModal}>
        <DialogContent className="sm:max-w-[425px] bg-slate-950 shadow-2xl border border-slate-800 rounded-2xl overflow-hidden p-0 gap-0">
          <div className="bg-red-950/30 p-6 border-b border-red-900/30">
            <DialogHeader>
              <DialogTitle className="text-xl font-bold text-red-500 flex items-center gap-2">
                  <Trash2 className="h-6 w-6" /> Delete Session?
              </DialogTitle>
            </DialogHeader>
          </div>
          
          <div className="p-6">
            <DialogDescription className="text-base text-slate-400">
              Are you sure you want to delete <strong className="text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded font-mono">{sessionToDelete}</strong>? 
              <br /><br />
              This action cannot be undone. It will disconnect the WhatsApp session and remove all associated data immediately.
            </DialogDescription>
          </div>

          <div className="p-6 bg-slate-900 border-t border-slate-800 flex justify-end gap-3">
            <Button variant="outline" onClick={() => setShowDeleteModal(false)} disabled={isDeleting} className="border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800 hover:text-white">
                Cancel
            </Button>
            <Button 
                variant="destructive" 
                onClick={() => sessionToDelete && executeAction('delete', sessionToDelete)}
                disabled={isDeleting}
                className="bg-red-600 hover:bg-red-700 min-w-[120px] shadow-lg shadow-red-900/20"
            >
                {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Delete Session"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* RENEW SESSION MODAL */}
      <Dialog open={showRenewModal} onOpenChange={setShowRenewModal}>
        <DialogContent className="sm:max-w-[600px] bg-slate-950 shadow-2xl border border-slate-800 rounded-2xl overflow-hidden p-0 gap-0 text-slate-100">
          <div className="bg-slate-900/50 p-6 border-b border-slate-800">
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold flex items-center gap-2 text-white">
                 <RefreshCw className="h-6 w-6 text-green-500" />
                 Renew Session
              </DialogTitle>
              <DialogDescription className="text-slate-400">
                Extend the validity of <span className="font-mono text-green-400">{sessionToRenew}</span>.
              </DialogDescription>
            </DialogHeader>
          </div>
          
          <div className="grid gap-6 p-6">
            {/* Plan Selection */}
            <div className="space-y-3">
                <Label className="text-base font-semibold text-slate-200">Select Extension Duration</Label>
                <div className="grid grid-cols-4 gap-3">
                    {["2", "30", "60", "90"].map((plan) => {
                        const isSelected = selectedPlan === plan;
                        let price = 0;
                        if (plan === "2") price = 200;
                        else if (plan === "30") price = 1500;
                        else if (plan === "60") price = 2800;
                        else if (plan === "90") price = 3500;

                        return (
                            <div 
                                key={plan}
                                onClick={() => setSelectedPlan(plan)}
                                className={`cursor-pointer rounded-xl border-2 p-3 text-center transition-all duration-200 hover:scale-[1.02] ${
                                    isSelected 
                                    ? "border-green-500/50 bg-green-500/10 shadow-[0_0_15px_rgba(34,197,94,0.1)]" 
                                    : "border-slate-800 bg-slate-900/50 hover:border-slate-700 hover:bg-slate-900"
                                }`}
                            >
                                <div className={`text-lg font-bold ${isSelected ? "text-green-400" : "text-slate-300"}`}>{plan === "2" ? "48 Hrs" : `${plan} Days`}</div>
                                <div className={`text-sm font-medium ${isSelected ? "text-green-500" : "text-slate-500"}`}>{price} BDT</div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Total Price */}
            <div className="flex items-center justify-between rounded-xl border border-slate-800 p-5 bg-slate-900/50">
                <div className="flex flex-col">
                    <span className="text-sm font-semibold text-slate-300">Total Renewal Cost</span>
                    <span className="text-xs text-slate-500">Deducted from your balance</span>
                </div>
                <div className="text-3xl font-black text-green-500">
                    {getPrice()} <span className="text-sm font-medium text-green-600/70">BDT</span>
                </div>
            </div>
          </div>

          <div className="p-6 bg-slate-900 border-t border-slate-800 flex justify-end gap-3">
            <Button variant="outline" size="lg" onClick={() => setShowRenewModal(false)} className="border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800 hover:text-white">Cancel</Button>
            <Button size="lg" onClick={handleRenewSession} disabled={isRenewing} className="bg-green-600 hover:bg-green-700 text-white min-w-[150px] shadow-lg shadow-green-900/20">
                {isRenewing ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : "Pay & Renew"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* PAIRING CODE MODAL */}
      <Dialog open={showPairingModal} onOpenChange={setShowPairingModal}>
        <DialogContent className="sm:max-w-[425px] bg-slate-950 shadow-2xl border border-slate-800 rounded-2xl overflow-hidden p-0 gap-0 text-slate-100">
            <div className="bg-slate-900/50 p-6 border-b border-slate-800">
                <DialogHeader>
                    <DialogTitle className="text-xl font-bold flex items-center gap-2 text-white">
                        <Smartphone className="h-5 w-5 text-blue-500" />
                        Link with Phone Number
                    </DialogTitle>
                    <DialogDescription className="text-slate-400">
                        Enter phone number to get pairing code for <span className="font-mono text-blue-400">{viewingSessionQr}</span>
                    </DialogDescription>
                </DialogHeader>
            </div>

            <div className="p-6 space-y-4">
                <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg flex gap-3 items-start">
                    <AlertTriangle className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                        <p className="text-xs font-semibold text-yellow-500">Security Note</p>
                        <p className="text-xs text-yellow-600/90 leading-relaxed">
                            WhatsApp may warn you not to share this code. Since you are connecting your own session, it is safe to proceed.
                            <br/><strong className="text-yellow-500">Never share this code with anyone else.</strong>
                        </p>
                    </div>
                </div>

                {!pairingCode ? (
                    <div className="space-y-3">
                        <Label className="text-sm font-semibold text-slate-200">Phone Number</Label>
                        <Input
                            placeholder="e.g. 8801956871403"
                            value={pairingPhoneNumber}
                            onChange={(e) => setPairingPhoneNumber(e.target.value)}
                            className="bg-slate-900 border-slate-800 focus:border-blue-500 text-white"
                        />
                        <p className="text-xs text-slate-500">
                            Enter full number with country code (e.g. 8801956871403). No '+' or spaces.
                        </p>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center space-y-4 py-4">
                        <div className="text-center space-y-1">
                            <p className="text-sm text-slate-400">Your Pairing Code</p>
                            <div className="text-3xl font-mono font-bold tracking-widest text-white bg-slate-900 px-6 py-3 rounded-xl border border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.1)]">
                                {pairingCode}
                            </div>
                        </div>
                        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-xs text-blue-300 max-w-[280px] text-center">
                            1. Open WhatsApp on your phone<br/>
                            2. Go to Linked Devices &gt; Link a Device<br/>
                            3. Select "Link with phone number instead"<br/>
                            4. Enter this code
                        </div>
                    </div>
                )}
            </div>

            <div className="p-6 bg-slate-900 border-t border-slate-800 flex justify-end gap-3">
                <Button variant="outline" onClick={() => setShowPairingModal(false)} className="border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800 hover:text-white">
                    Close
                </Button>
                {!pairingCode && (
                    <Button 
                        onClick={handleGetPairingCode} 
                        disabled={isPairingLoading || !pairingPhoneNumber}
                        className="bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-900/20"
                    >
                        {isPairingLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Get Code"}
                    </Button>
                )}
            </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
