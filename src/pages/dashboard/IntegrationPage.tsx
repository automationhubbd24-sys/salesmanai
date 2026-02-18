import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useParams } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { 
  Loader2, 
  RefreshCw, 
  CheckCircle, 
  XCircle, 
  Plus, 
  Trash2, 
  StopCircle, 
  PlayCircle, 
  QrCode, 
  Search,
  Eye,
  Settings,
  MoreVertical,
  Download
} from "lucide-react";
import { BACKEND_URL } from "@/config";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose
} from "@/components/ui/dialog";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// CustomAlert Removed

interface WhatsAppSession {
  id: string;
  session_name: string;
  status: string;
  qr_code?: string;
  user_email?: string;
  user_id?: string;
  updated_at?: string;
  session_id?: string;
}

export default function IntegrationPage() {
  const { platform } = useParams();
  const [sessions, setSessions] = useState<WhatsAppSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [newSessionName, setNewSessionName] = useState("");
  const [creating, setCreating] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [qrSession, setQrSession] = useState<WhatsAppSession | null>(null);
  const [restartingId, setRestartingId] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [selectedPlan, setSelectedPlan] = useState("30");

  // Pairing Code State
  const [phoneNumber, setPhoneNumber] = useState("");
  const [countryCode, setCountryCode] = useState("+880");
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingLoading, setPairingLoading] = useState(false);

  const countries = [
    { code: "+880", label: "Bangladesh (+880)" },
    { code: "+1", label: "USA/Canada (+1)" },
    { code: "+91", label: "India (+91)" },
    { code: "+44", label: "UK (+44)" },
    { code: "+971", label: "UAE (+971)" },
    { code: "+966", label: "Saudi Arabia (+966)" },
    { code: "+60", label: "Malaysia (+60)" },
    { code: "+65", label: "Singapore (+65)" },
    { code: "+61", label: "Australia (+61)" },
    { code: "+974", label: "Qatar (+974)" },
    { code: "+968", label: "Oman (+968)" },
    { code: "+965", label: "Kuwait (+965)" },
    { code: "+973", label: "Bahrain (+973)" },
    { code: "+39", label: "Italy (+39)" },
    { code: "+33", label: "France (+33)" },
    { code: "+49", label: "Germany (+49)" },
    { code: "+34", label: "Spain (+34)" },
    { code: "+351", label: "Portugal (+351)" },
    { code: "+31", label: "Netherlands (+31)" },
    { code: "+32", label: "Belgium (+32)" },
    { code: "+41", label: "Switzerland (+41)" },
    { code: "+46", label: "Sweden (+46)" },
    { code: "+47", label: "Norway (+47)" },
    { code: "+45", label: "Denmark (+45)" },
    { code: "+353", label: "Ireland (+353)" },
    { code: "+27", label: "South Africa (+27)" },
    { code: "+55", label: "Brazil (+55)" },
    { code: "+52", label: "Mexico (+52)" },
    { code: "+54", label: "Argentina (+54)" },
    { code: "+86", label: "China (+86)" },
    { code: "+81", label: "Japan (+81)" },
    { code: "+82", label: "South Korea (+82)" },
    { code: "+62", label: "Indonesia (+62)" },
    { code: "+66", label: "Thailand (+66)" },
    { code: "+84", label: "Vietnam (+84)" },
    { code: "+63", label: "Philippines (+63)" },
    { code: "+92", label: "Pakistan (+92)" },
    { code: "+94", label: "Sri Lanka (+94)" },
    { code: "+977", label: "Nepal (+977)" },
    { code: "+20", label: "Egypt (+20)" },
    { code: "+212", label: "Morocco (+212)" },
    { code: "+90", label: "Turkey (+90)" },
    { code: "+7", label: "Russia/Kazakhstan (+7)" },
  ];

  const fetchBalance = React.useCallback(async () => {
  }, []);

  const fetchSessions = React.useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) {
        setSessions([]);
        return;
      }

      const res = await fetch(`${BACKEND_URL}/whatsapp/sessions`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) {
        throw new Error("Failed to load sessions");
      }

      const data = await res.json();
      const items = Array.isArray(data) ? data : [];
      const mapped: WhatsAppSession[] = items.map((s: any) => ({
        id: String(s.wp_db_id ?? s.wp_id ?? s.id ?? s.name),
        session_name: String(s.session_name ?? s.name),
        status: String(s.status || "UNKNOWN"),
        qr_code: s.qr_code,
        user_email: s.user_email,
        user_id: s.user_id,
        updated_at: s.updated_at,
        session_id: s.session_id
      }));
      setSessions(mapped);
    } catch (error: unknown) {
      console.error("Error fetching sessions:", error);
      toast.error("Failed to load sessions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    console.log("IntegrationPage v1.5 (NATIVE POPUP) loaded");
    if (platform === 'whatsapp') {
      fetchSessions();
      fetchBalance();
    }
  }, [platform, fetchSessions, fetchBalance]);

  // Sync qrSession with sessions list when it updates
  useEffect(() => {
    if (qrSession) {
      const updatedSession = sessions.find(s => s.id === qrSession.id);
      if (updatedSession && updatedSession.qr_code !== qrSession.qr_code) {
        setQrSession(updatedSession);
      }
    }
  }, [sessions, qrSession]);

  // Poll for QR code continuously to prevent invalidation
  useEffect(() => {
    let interval: NodeJS.Timeout;
    // Condition: Open Modal (qrSession) AND Not Connected (WORKING) AND Not Stopped
    if (qrSession && qrSession.status !== 'WORKING' && qrSession.status !== 'STOPPED') {
      const fetchQr = async () => {
          try {
              const res = await fetch(`${BACKEND_URL}/whatsapp/session/qr/${qrSession.session_name}`);
              const data = await res.json();
              
              if (data.qr_code === 'SESSION_FAILED') {
                  console.warn("Session in FAILED state. Auto-restarting...");
                  toast.error("Session failed. Auto-restarting...");
                  handleAction(qrSession.session_name, 'restart');
                  return;
              }

              if (data.qr_code) {
                  // Always update to the latest QR to ensure it's valid
                  setQrSession(prev => prev ? { ...prev, qr_code: data.qr_code } : null);
              }
          } catch (e) {
              console.error("Error polling QR:", e);
          }
      };
      
      fetchQr(); // Initial call
      interval = setInterval(fetchQr, 3000); // Poll every 3s
    }
    return () => clearInterval(interval);
  }, [qrSession?.session_name, qrSession?.status]);

  // Poll for updates when QR dialog is open
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (qrSession && qrSession.status !== 'WORKING') {
      interval = setInterval(fetchSessions, 3000); // Poll every 3s
    }
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrSession?.status, qrSession?.id, fetchSessions]); // Depend on status/id, not full object to avoid loop




  const createSession = async () => {
    setCreating(true);
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) {
        throw new Error("Please login again to create a session.");
      }

      // Generate random suffix for unique session name (6 chars)
      const suffix = Math.random().toString(36).substring(2, 8);
      const finalSessionName = `${newSessionName.trim()}_${suffix}`;

      const payload = { 
        sessionName: finalSessionName, 
        planDays: selectedPlan
      };
      console.log("Sending payload to /whatsapp/session/create:", payload);

      const res = await fetch(`${BACKEND_URL}/whatsapp/session/create`, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create session');
      
      toast.success("Session created! Please scan the QR code.");
      setNewSessionName("");
      
      // Optimistically add to list
      const newSession: WhatsAppSession = {
        id: data.id || data.session_name,
        session_name: data.session_name,
        status: 'created',
        qr_code: data.qr_code
      };
      setSessions(prev => [newSession, ...prev]);
      setQrSession(newSession);

      fetchSessions();
      fetchBalance(); // Update balance after deduction
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error(message);
    } finally {
      setCreating(false);
    }
  };

  const handleStartNew = async (e: React.MouseEvent) => {
    // Force prevent default submission
    e.preventDefault();
    e.stopPropagation();

    if (!newSessionName.trim()) {
      toast.error("Please enter a session name");
      return;
    }

    // Determine price based on plan
    let price = 500;
    if (selectedPlan === "60") price = 900;
    if (selectedPlan === "90") price = 800;

    // 1. Force Browser Native Popup (Unstoppable)
    // Adding a slight delay to ensure event propagation is done
    setTimeout(() => {
        const confirmed = window.confirm(
            `Confirm Payment?\n\nPlan: ${selectedPlan} Days\nPrice: ${price} BDT\n\nBalance will be deducted. Press OK to Pay & Create.`
        );
        
        if (confirmed) {
            createSession();
        }
    }, 100);
  };

  const handleAction = async (sessionName: string, action: 'start' | 'stop' | 'restart' | 'delete') => {
        if (action === 'delete') {
            // Force delay to prevent UI race conditions
            setTimeout(() => {
                const confirmed = window.confirm(
                    "Are you sure you want to DELETE this session?\n\nThis will disconnect your WhatsApp and cannot be undone.\n\nPress OK to Delete."
                );
                if (confirmed) {
                    performAction(sessionName, action);
                }
            }, 100);
            return;
        }

        performAction(sessionName, action);
    };

  const handleGetPairingCode = async () => {
      if (!qrSession || !phoneNumber) {
          toast.error("Please enter a phone number");
          return;
      }

      // Clean the phone number (remove spaces, dashes)
      let cleanPhone = phoneNumber.replace(/[\s-]/g, '');

      // Special validation for Bangladesh (+880)
      if (countryCode === "+880") {
          // Remove leading 0 if present (e.g. 017... -> 17...)
          if (cleanPhone.startsWith('0')) {
              cleanPhone = cleanPhone.substring(1);
          }
          
          // Validate length (should be 10 digits after +880)
          if (cleanPhone.length !== 10) {
              toast.error("For Bangladesh (+880), please enter exactly 10 digits (e.g. 1712345678).");
              return;
          }
      } else {
          // General cleanup for other countries: remove leading 0s
          cleanPhone = cleanPhone.replace(/^0+/, '');
      }

      const fullPhoneNumber = `${countryCode}${cleanPhone}`;

      setPairingLoading(true);
      setPairingCode(null);
      try {
          const res = await fetch(`${BACKEND_URL}/whatsapp/session/pairing-code`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionName: qrSession.session_name, phoneNumber: fullPhoneNumber })
          });
          const data = await res.json();
          if (data.error) throw new Error(data.error);
          setPairingCode(data.code);
          toast.success("Pairing Code Generated!");
      } catch (e: any) {
          toast.error(e.message || "Failed to get pairing code");
      } finally {
          setPairingLoading(false);
      }
  };


    const handleDownloadQr = () => {
      if (!qrSession?.qr_code) return;
      
      const link = document.createElement('a');
      link.href = qrSession.qr_code;
      link.download = `whatsapp-qr-${qrSession.session_name}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success("QR Code Downloaded!");
  };

  const performAction = async (sessionName: string, action: 'start' | 'stop' | 'delete' | 'restart') => {
      const token = localStorage.getItem("auth_token");
      if (!token) {
        throw new Error("Please login again to manage sessions.");
      }

      if (action === 'delete') {
      // Don't wait for response, just optimistic update immediately
      setSessions(prev => prev.filter(s => s.session_name !== sessionName));
      
      try {
        await fetch(`${BACKEND_URL}/whatsapp/session/${action}`, {
          method: 'POST',
          headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ sessionName })
        });
        toast.success(`Session ${action}ed successfully`);
      } catch (e) {
        console.error("Delete failed but removed from UI:", e);
        // Don't re-add to UI to avoid confusion, user wants it gone
      }
      return;
    }

    try {
      if (action === 'restart') {
         setRestartingId(sessionName);
      }
      
      const res = await fetch(`${BACKEND_URL}/whatsapp/session/${action}`, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ sessionName })
      });
      
      if (!res.ok) throw new Error(`Failed to ${action} session`);
      
      toast.success(action === 'restart' ? "Session restarting. Check QR shortly." : `Session ${action}ed successfully`);
      
      if (action === 'restart') {
         // Optimistically update session list status to clear "FAILED" immediately
         setSessions(prev => prev.map(s => 
             s.session_name === sessionName ? { ...s, status: 'RESTARTING' } : s
         ));

         // Show QR modal immediately with loading state to trigger polling
         const session = sessions.find(s => s.session_name === sessionName);
         if (session) {
             setQrSession({ ...session, qr_code: undefined, status: 'RESTARTING' });
         }
         fetchSessions();
      } else {
         setTimeout(() => fetchSessions(), 2000);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error(message);
    } finally {
      if (action === 'restart') setRestartingId(null);
    }
  };

  const filteredSessions = sessions.filter(session => 
    session.session_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'WORKING':
        return (
          <div className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[10px] font-semibold border bg-[#00ff88]/10 text-[#00ff88] border-[#00ff88]/50">
            <CheckCircle className="w-3 h-3" />
            <span>WORKING</span>
          </div>
        );
      case 'STOPPED':
        return (
          <div className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[10px] font-semibold border bg-muted/20 text-muted-foreground border-border/60">
            <StopCircle className="w-3 h-3" />
            <span>STOPPED</span>
          </div>
        );
      case 'created':
      case 'scanned':
        return (
          <div className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[10px] font-semibold border bg-amber-500/10 text-amber-400 border-amber-500/40">
            <QrCode className="w-3 h-3" />
            <span>SCAN_QR_CODE</span>
          </div>
        );
      case 'FAILED':
        return (
          <div className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[10px] font-semibold border bg-red-500/10 text-red-400 border-red-500/40">
            <XCircle className="w-3 h-3" />
            <span>FAILED</span>
          </div>
        );
      default:
        return (
          <div className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[10px] font-semibold border bg-muted/20 text-muted-foreground border-border/60">
            <span>{status}</span>
          </div>
        );
    }
  };

  if (platform !== 'whatsapp') {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4 capitalize">{platform} Integration</h1>
        <p className="text-muted-foreground">Integration for {platform} is coming soon.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-2">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
           <h1 className="text-2xl font-bold">WhatsApp Integration (v1.5)</h1>
           <p className="text-muted-foreground">Connect your WhatsApp number to start automating conversations</p>
        </div>
        <div className="flex gap-2 items-center">
          {balance !== null && (
              <Badge variant="outline" className="text-base px-3 py-1 border-green-200 bg-green-50 text-green-700">
                  Balance: {balance} BDT
              </Badge>
          )}
          <Button variant="outline" onClick={() => { fetchSessions(); fetchBalance(); }} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>
      
      {/* Controls Bar */}
      <div className="flex flex-col gap-4 bg-[#0f0f0f]/80 backdrop-blur-sm p-4 rounded-lg border border-white/10">
         {/* Plan Selection */}
         <div className="w-full">
            <Label className="mb-2 block">Select Plan</Label>
            <div className="flex flex-wrap gap-4">
                <div 
                  className={`border p-3 rounded-xl cursor-pointer transition-all text-sm ${
                    selectedPlan === "30"
                      ? "border-[#00ff88]/80 bg-[#00ff88]/10 shadow-[0_0_25px_rgba(0,255,136,0.25)]"
                      : "border-border bg-background/40 hover:border-[#00ff88]/40 hover:bg-background/60"
                  }`}
                  onClick={() => setSelectedPlan("30")}
                >
                    <div className="font-bold">30 Days</div>
                    <div className="text-xs text-muted-foreground">500 BDT</div>
                </div>
                <div 
                  className={`border p-3 rounded-xl cursor-pointer transition-all text-sm ${
                    selectedPlan === "60"
                      ? "border-[#00ff88]/80 bg-[#00ff88]/10 shadow-[0_0_25px_rgba(0,255,136,0.25)]"
                      : "border-border bg-background/40 hover:border-[#00ff88]/40 hover:bg-background/60"
                  }`}
                  onClick={() => setSelectedPlan("60")}
                >
                    <div className="font-bold">60 Days</div>
                    <div className="text-xs text-muted-foreground">900 BDT</div>
                </div>
                <div 
                  className={`border p-3 rounded-xl cursor-pointer transition-all text-sm ${
                    selectedPlan === "90"
                      ? "border-[#00ff88]/80 bg-[#00ff88]/10 shadow-[0_0_25px_rgba(0,255,136,0.25)]"
                      : "border-border bg-background/40 hover:border-[#00ff88]/40 hover:bg-background/60"
                  }`}
                  onClick={() => setSelectedPlan("90")}
                >
                    <div className="font-bold">90 Days</div>
                    <div className="text-xs text-muted-foreground">800 BDT</div>
                </div>
            </div>
         </div>

        <div className="flex flex-col md:flex-row gap-4 justify-between items-end md:items-center">
        {/* Create Session Form */}
          <div className="flex flex-col md:flex-row gap-2 w-full md:w-auto items-stretch md:items-end">
             <div className="grid w-full md:max-w-sm items-center gap-1.5">
              <Label htmlFor="sessionName">New Session Name</Label>
              <Input 
                id="sessionName" 
                placeholder="e.g., Sales Bot" 
                value={newSessionName}
                onChange={(e) => setNewSessionName(e.target.value)}
                className="w-full md:w-[200px]"
              />
            </div>
            <Button onClick={handleStartNew} disabled={creating} className="bg-green-600 hover:bg-green-700 w-full md:w-auto">
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Start New
            </Button>
        </div>

        {/* Search */}
        <div className="relative w-full md:w-[300px]">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search by Name..." 
            className="pl-8" 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        </div>
      </div>

      {/* Session Grid - Responsive Layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {filteredSessions.length === 0 ? (
           <div className="col-span-full text-center p-8 border rounded-lg bg-muted/20">
             {loading ? (
                <div className="flex flex-col items-center gap-2">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p>Loading sessions...</p>
                </div>
             ) : (
                <p className="text-muted-foreground">No sessions found. Create one to get started.</p>
             )}
           </div>
        ) : (
          filteredSessions.map((session) => (
            <Card
              key={session.id}
              className="overflow-hidden flex flex-col h-full shadow-sm hover:shadow-lg transition-shadow bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10"
            >
              <CardHeader className="p-3 pb-1">
                <div className="flex flex-col sm:flex-row justify-between items-start gap-2">
                    <div className="overflow-hidden w-full">
                        <CardTitle className="text-base font-semibold truncate" title={session.session_name}>{session.session_name}</CardTitle>
                        <CardDescription className="text-xs mt-0.5 truncate text-gray-500">ID: {(session.id || session.session_id || 'N/A').slice(0, 8)}...</CardDescription>
                    </div>
                    <div className="shrink-0 self-start sm:self-center scale-90 origin-top-right">
                        {getStatusBadge(session.status)}
                    </div>
                </div>
              </CardHeader>
              <CardContent className="p-3 pt-2 flex-grow">
                {session.status === 'FAILED' && (
                    <div className="mb-2 p-2 bg-red-50 border border-red-100 rounded text-[10px] text-red-600 leading-tight">
                        Session failed. <span className="font-bold cursor-pointer underline" onClick={() => handleAction(session.session_name, 'restart')}>Restart</span>
                    </div>
                )}
                <div className="space-y-1 text-xs">
                    <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Account:</span>
                        <span className="font-medium truncate max-w-[120px]">{session.user_email || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Server:</span>
                        <span className="font-medium">WAHA</span>
                    </div>
                </div>
              </CardContent>
              <div className="flex flex-wrap items-center justify-between p-2 bg-muted/30 border-t gap-2">
                  <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="outline" size="sm" onClick={() => setQrSession(session)} className="h-7 text-xs px-2 flex-grow md:flex-grow-0">
                                <QrCode className="h-3 w-3 mr-1.5 text-blue-600" />
                                QR / Pair
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Scan QR Code or Pair Code</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  <div className="flex gap-1 flex-wrap justify-end flex-grow md:flex-grow-0">
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                {session.status === 'FAILED' ? (
                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 animate-pulse" onClick={() => handleAction(session.session_name, 'restart')}>
                                        <RefreshCw className="h-3.5 w-3.5" />
                                    </Button>
                                ) : (
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleAction(session.session_name, 'start')}>
                                        <PlayCircle className="h-3.5 w-3.5 text-green-600" />
                                    </Button>
                                )}
                            </TooltipTrigger>
                            <TooltipContent>{session.status === 'FAILED' ? 'Fix Failed Session' : 'Start Session'}</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="outline" size="sm" className="h-7 text-xs px-2 border-orange-200 hover:bg-orange-50 text-orange-700" onClick={() => handleAction(session.session_name, 'restart')} disabled={restartingId === session.session_name}>
                                    {restartingId === session.session_name ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                                    Restart
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Restart Session</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleAction(session.session_name, 'stop')}>
                                    <StopCircle className="h-3.5 w-3.5 text-red-500" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Stop Session</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                    
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-red-600 hover:bg-red-50" onClick={() => handleAction(session.session_name, 'delete')}>
                        <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
              </div>
            </Card>
          ))
        )}
      </div>

      {/* QR Code Dialog */}
      <Dialog open={!!qrSession} onOpenChange={(open) => !open && setQrSession(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Session QR Code: {qrSession?.session_name}</DialogTitle>
            <DialogDescription>
              Scan this QR code with your WhatsApp to connect.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center justify-center p-6 gap-4">
            {qrSession?.qr_code ? (
              <div className="flex flex-col items-center gap-2">
                  <img 
                    src={qrSession.qr_code} 
                    alt="QR Code" 
                    className="w-64 h-64 object-contain border rounded-lg bg-white"
                  />
                  <p className="text-xs text-red-500 font-medium animate-pulse text-center max-w-[250px]">
                      ⚠️ QR Code refreshes automatically every few seconds. Please scan quickly to avoid timeout!
                  </p>
              </div>
            ) : qrSession?.status === 'WORKING' ? (
                <div className="flex flex-col items-center justify-center h-64 w-64 bg-green-50 rounded-lg border border-green-200">
                    <CheckCircle className="h-8 w-8 text-green-500 mb-2" />
                    <p className="text-green-700 font-medium">Session Connected</p>
                    <p className="text-xs text-green-600 text-center px-4 mt-1">To scan a new QR code, please click "Regenerate QR" below.</p>
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center h-64 w-64 bg-secondary/20 rounded-lg border border-dashed">
                    <Loader2 className="h-8 w-8 animate-spin text-primary mb-2" />
                    <p className="text-muted-foreground text-sm">Waiting for QR Code...</p>
                </div>
            )}
            
            <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => {
                    if (qrSession) handleAction(qrSession.session_name, 'restart');
                }}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Regenerate QR
                </Button>
                <Button variant="outline" size="sm" onClick={handleDownloadQr} disabled={!qrSession?.qr_code}>
                    <Download className="h-4 w-4 mr-2" />
                    Download QR
                </Button>
                <Button variant="outline" size="sm" onClick={fetchSessions}>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    I Scanned It
                </Button>
            </div>

            <div className="w-full border-t pt-4 mt-2">
                <p className="text-sm font-medium mb-2 text-center">Or Link with Phone Number</p>
                <div className="flex gap-2">
                    <Select value={countryCode} onValueChange={setCountryCode}>
                        <SelectTrigger className="w-[120px]">
                            <SelectValue placeholder="Code" />
                        </SelectTrigger>
                        <SelectContent>
                            {countries.map((c) => (
                                <SelectItem key={c.code} value={c.code}>
                                    {c.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Input 
                        placeholder={countryCode === "+880" ? "1712345678 (10 digits)" : "Phone number"} 
                        value={phoneNumber} 
                        onChange={e => setPhoneNumber(e.target.value)}
                        className="flex-1"
                    />
                    <Button onClick={handleGetPairingCode} disabled={pairingLoading}>
                        {pairingLoading ? <Loader2 className="animate-spin h-4 w-4" /> : "Get Code"}
                    </Button>
                </div>
                {pairingCode && (
                    <div className="mt-4 p-4 bg-secondary rounded-lg text-center">
                        <p className="text-xs text-muted-foreground mb-1">Pairing Code (Expires quickly!)</p>
                        <div className="flex items-center justify-center gap-2">
                            <p className="text-2xl font-mono font-bold tracking-widest text-primary">{pairingCode}</p>
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                                navigator.clipboard.writeText(pairingCode);
                                toast.success("Copied!");
                            }}>
                                <span className="sr-only">Copy</span>
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                            </Button>
                        </div>
                    </div>
                )}
            </div>
          </div>
        </DialogContent>

      </Dialog>


    </div>
  );
}
