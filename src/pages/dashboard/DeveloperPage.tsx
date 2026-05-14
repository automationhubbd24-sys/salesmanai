import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Copy, RefreshCw, Code, Eye, EyeOff, Activity, ArrowRight, Key, Sparkles, Plus, AlertCircle, CheckCircle2, TrendingUp, DollarSign, Cpu, ArrowLeft } from "lucide-react";
import { BACKEND_URL, EXTERNAL_API_BASE } from "@/config";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import Logo from "@/components/Logo";

export default function DeveloperPage() {
    const [apiKey, setApiKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingStatus, setLoadingStatus] = useState(true);
    const [showKey, setShowKey] = useState(false);
    
    // Developer Access Control
    const [devStatus, setDevStatus] = useState<string>('none');
    const [isDevLoggedIn, setIsDevLoggedIn] = useState(false);
    const [devCreds, setDevCreds] = useState({ id: '', pass: '' });
    const [registering, setRegistering] = useState(false);
    const [loggingIn, setLoggingIn] = useState(false);
    const [regData, setRegData] = useState({ paymentMethod: 'bkash', transactionId: '' });

    // User Gemini Key Management
    const [userGeminiKey, setUserGeminiKey] = useState('');
    const [userGmail, setUserGmail] = useState('');
    const [isAddingKey, setIsAddingKey] = useState(false);
    const userId = localStorage.getItem('auth_user_id');

    useEffect(() => {
        const init = async () => {
            setLoadingStatus(true);
            await fetchDevStatus();
            const devSession = localStorage.getItem('dev_session_unlocked');
            if (devSession === 'true') setIsDevLoggedIn(true);
            setLoadingStatus(false);
        };
        init();
    }, []);

    useEffect(() => {
        if (devStatus === 'approved' && isDevLoggedIn) {
            fetchKey();
            fetchUsage(1);
        }
    }, [devStatus, isDevLoggedIn]);

    const handleDevLogin = async () => {
        try {
            if (!devCreds.id || !devCreds.pass) return;
            setLoggingIn(true);
            const { data } = await api.post('/auth/developer/login', {
                userId,
                devId: devCreds.id,
                devPass: devCreds.pass
            });
            if (data.success) {
                setIsDevLoggedIn(true);
                localStorage.setItem('dev_session_unlocked', 'true');
                toast.success("Developer portal unlocked");
            }
        } catch (err: any) {
            toast.error(err.response?.data?.error || "Invalid Credentials");
        } finally {
            setLoggingIn(false);
        }
    };

    const fetchDevStatus = async () => {
        try {
            if (!userId) return;
            const { data } = await api.get(`/auth/developer/stats/${userId}`);
            setDevStatus(data.developer_status || 'none');
        } catch (err) {
            console.error(err);
        }
    };

    const handleRegister = async () => {
        try {
            if (!regData.transactionId) return;
            setRegistering(true);
            await api.post('/auth/developer/register', {
                userId,
                ...regData
            });
            toast.success("Registration Submitted. Waiting for admin approval.");
            fetchDevStatus();
        } catch (err: any) {
            toast.error(err.response?.data?.error || "Failed to register");
        } finally {
            setRegistering(false);
        }
    };

    const handleAddGeminiKey = async () => {
        if (!userGeminiKey || !userGmail) {
            toast.error("Gmail and API Key are required");
            return;
        }
        setIsAddingKey(true);
        try {
            await api.post('/api-engine/keys', {
                api: userGeminiKey,
                gmail: userGmail,
                provider: 'google',
                mode: 'dev', 
                owner_id: userId
            });
            toast.success("Gemini API Key added successfully");
            setUserGeminiKey('');
            setUserGmail('');
        } catch (err: any) {
            toast.error(err.response?.data?.error || "Failed to add key");
        } finally {
            setIsAddingKey(false);
        }
    };

    const [usageStats, setUsageStats] = useState<any[]>([]);
    const [usageSummary, setUsageSummary] = useState<any>({ 
        total_cost: 0, 
        total_tokens: 0,
        total_requests: 0,
        today_cost: 0, 
        today_tokens: 0,
        today_requests: 0,
        yesterday_cost: 0,
        yesterday_tokens: 0,
        yesterday_requests: 0,
        range_cost: 0,
        range_tokens: 0,
        range_requests: 0
    });
    const [startDate, setStartDate] = useState<string>("");
    const [endDate, setEndDate] = useState<string>("");
    const [regenDialogOpen, setRegenDialogOpen] = useState(false);
    const [isRegenerating, setIsRegenerating] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [pagination, setPagination] = useState<any>({
        total_pages: 1,
        total_records: 0
    });

    const formatCompact = (value?: number) => {
        const n = Number(value || 0);
        if (isNaN(n) || n === 0) return "0";
        if (n >= 1000000) {
            const v = (n / 1000000).toFixed(1).replace(/\.0$/, "");
            return `${v}M`;
        }
        if (n >= 1000) {
            const v = (n / 1000).toFixed(1).replace(/\.0$/, "");
            return `${v}k`;
        }
        return n.toLocaleString();
    };

    const setYesterday = () => {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const dateStr = yesterday.toISOString().split('T')[0];
        setStartDate(dateStr);
        setEndDate(dateStr);
        // We'll trigger fetch in useEffect or manually
    };

    useEffect(() => {
        if (startDate && endDate) {
            setCurrentPage(1); // Reset to page 1 on date filter change
            fetchUsage(1);
        }
    }, [startDate, endDate]);

    const fetchUsage = async (page = 1) => {
        try {
            const token = localStorage.getItem("auth_token");
            if (!token) return;

            let url = `${BACKEND_URL}/api/external/usage?page=${page}&limit=20`;
            if (startDate && endDate) {
                url += `&startDate=${startDate}&endDate=${endDate}`;
            }

            const res = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            const data = await res.json();
            if (data.stats) setUsageStats(data.stats);
            if (data.summary) setUsageSummary(data.summary);
            if (data.pagination) {
                setPagination(data.pagination);
                setCurrentPage(data.pagination.current_page);
            }
        } catch (error) {
            console.error("Failed to fetch usage stats", error);
        }
    };

    const fetchKey = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem("auth_token");
            if (!token) return;

            const res = await fetch(`${BACKEND_URL}/api/external/key`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            const data = await res.json();
            if (data.api_key) setApiKey(data.api_key);
        } catch (error) {
            console.error("Failed to fetch key", error);
        } finally {
            setLoading(false);
        }
    };

    const doRegenerate = async () => {
        setIsRegenerating(true);
        try {
            const token = localStorage.getItem("auth_token");
            if (!token) return;

            const res = await fetch(`${BACKEND_URL}/api/external/key/regenerate`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!res.ok) {
                const errorText = await res.text();
                console.error("Server error response:", errorText);
                try {
                    const errorJson = JSON.parse(errorText);
                    toast.error(`Error (${res.status}): ${errorJson.error || 'Unknown server error'}`);
                } catch (e) {
                    toast.error(`Server Error (${res.status}): Check backend logs`);
                }
                setIsRegenerating(false);
                return;
            }

            const data = await res.json();
            
            if (data.error) {
                toast.error(`Error: ${data.error}`);
                setIsRegenerating(false);
                return;
            }

            if (data.api_key) {
                setApiKey(data.api_key);
                toast.success("New API Key generated");
                setRegenDialogOpen(false);
            } else {
                toast.error("Failed to generate key: No key returned from server");
            }
        } catch (error: any) {
            console.error("Key generation error details:", error);
            if (error.message === "Failed to fetch") {
                toast.error("Cannot connect to backend server. Is it running?");
            } else {
                toast.error(`Failed to generate key: ${error.message}`);
            }
        } finally {
            setIsRegenerating(false);
        }
    };
    
    const regenerateKey = () => {
        setRegenDialogOpen(true);
    };

    const copyToClipboard = () => {
        if (apiKey) {
            navigator.clipboard.writeText(apiKey);
            toast.success("Copied to clipboard");
        }
    };

    if (loadingStatus) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
                <RefreshCw className="h-12 w-12 text-primary animate-spin" />
                <p className="text-muted-foreground animate-pulse font-medium text-lg">Verifying Developer Access...</p>
            </div>
        );
    }

    return (
        <div className="relative min-h-screen space-y-4 md:space-y-6 p-3 md:p-8 animate-in fade-in duration-700 overflow-x-hidden">
            {/* Background Decorative Elements */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
                <div className="absolute -top-[5%] -left-[5%] w-[60%] md:w-[40%] h-[40%] bg-primary/10 rounded-full blur-[80px] md:blur-[120px] animate-pulse"></div>
                <div className="absolute -bottom-[5%] -right-[5%] w-[60%] md:w-[40%] h-[40%] bg-purple-600/10 rounded-full blur-[80px] md:blur-[120px] animate-pulse" style={{ animationDelay: '2s' }}></div>
            </div>

            <div className="relative z-10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="space-y-1">
                    <h1 className="text-2xl md:text-3xl font-bold tracking-tight bg-gradient-to-r from-primary to-purple-600 bg-clip-text text-transparent">Developer API</h1>
                    <p className="text-xs md:text-sm text-muted-foreground max-w-xs md:max-w-none">
                        Integrate our powerful AI engine directly into your own applications.
                    </p>
                </div>
                {devStatus === 'approved' && (
                    <Badge variant="secondary" className="text-[10px] md:text-sm px-2 md:px-3 py-1 bg-green-500/10 text-green-500 border-green-500/20 backdrop-blur-md">
                        <CheckCircle2 className="h-3 w-3 mr-1 shrink-0" /> Approved Developer
                    </Badge>
                )}
            </div>

            {devStatus === 'none' && (
                <div className="relative z-10 flex items-center justify-center py-6 md:py-10 min-h-[75vh]">
                    <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-12 items-center">
                        {/* Left Side: Marketing/Info */}
                        <div className="space-y-6 md:space-y-10 text-center lg:text-left animate-in fade-in slide-in-from-left-12 duration-1000">
                            <div className="flex justify-center lg:justify-start">
                                <Logo showText={true} animated={true} size="lg" accentColor="#00ff88" className="scale-75 md:scale-100" />
                            </div>
                            
                            <div className="space-y-4 md:space-y-6">
                                <h2 className="text-3xl md:text-5xl font-black leading-tight text-white tracking-tight">
                                    Build the Future with <br />
                                    <span className="bg-gradient-to-r from-[#00ff88] to-primary bg-clip-text text-transparent">SalesmanAI API</span>
                                </h2>
                                <p className="text-slate-400 text-base md:text-xl leading-relaxed max-w-md mx-auto lg:mx-0">
                                    Access our world-class AI infrastructure. One API for Text, Image, and Voice. 
                                    Designed for developers who want scale.
                                </p>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6 px-2 sm:px-0">
                                <div className="group p-4 md:p-6 rounded-2xl md:rounded-3xl bg-white/[0.03] border border-white/10 hover:border-[#00ff88]/30 transition-all duration-300 backdrop-blur-sm text-left">
                                    <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl bg-[#00ff88]/10 flex items-center justify-center mb-3 md:mb-4 group-hover:scale-110 transition-transform">
                                        <Sparkles className="h-5 w-5 md:h-6 md:w-6 text-[#00ff88]" />
                                    </div>
                                    <p className="text-base md:text-lg font-bold text-white mb-1">Unified Engine</p>
                                    <p className="text-xs md:text-sm text-muted-foreground leading-relaxed">Multi-modal AI covering Text, Image, and Audio in one request.</p>
                                </div>
                                <div className="group p-4 md:p-6 rounded-2xl md:rounded-3xl bg-white/[0.03] border border-white/10 hover:border-[#00ff88]/30 transition-all duration-300 backdrop-blur-sm text-left">
                                    <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl bg-primary/10 flex items-center justify-center mb-3 md:mb-4 group-hover:scale-110 transition-transform">
                                        <Cpu className="h-5 w-5 md:h-6 md:w-6 text-primary" />
                                    </div>
                                    <p className="text-base md:text-lg font-bold text-white mb-1">High Performance</p>
                                    <p className="text-xs md:text-sm text-muted-foreground leading-relaxed">Enterprise-grade latency and 99.9% uptime for your apps.</p>
                                </div>
                            </div>

                            <div className="flex flex-col sm:flex-row items-center gap-4 pt-2 justify-center lg:justify-start">
                                <div className="flex -space-x-2 md:-space-x-3">
                                    {[1, 2, 3, 4].map((i) => (
                                        <div key={i} className="w-8 h-8 md:w-10 md:h-10 rounded-full border-2 border-[#0a0a0a] bg-gradient-to-br from-gray-700 to-gray-900 flex items-center justify-center text-[8px] md:text-[10px] font-bold text-white shrink-0">
                                            {String.fromCharCode(64 + i)}
                                        </div>
                                    ))}
                                </div>
                                <p className="text-xs md:text-sm text-slate-500">
                                    Trusted by <span className="text-white font-bold">500+</span> developers worldwide
                                </p>
                            </div>
                        </div>

                        {/* Right Side: Registration Form */}
                        <div className="animate-in fade-in slide-in-from-right-12 duration-1000 px-2 sm:px-0">
                            <Card className="relative border-white/10 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)] bg-[#121212]/60 backdrop-blur-2xl rounded-[32px] md:rounded-[40px] overflow-hidden border-t-white/20">
                                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#00ff88] via-primary to-purple-600"></div>
                                
                                <CardHeader className="space-y-3 md:space-y-4 pb-6 md:pb-8 pt-8 md:pt-10 text-center lg:text-left">
                                    <div className="lg:hidden flex justify-center mb-4">
                                        <Logo showText={true} size="sm" accentColor="#00ff88" className="scale-90" />
                                    </div>
                                    <div className="space-y-1 md:space-y-2">
                                        <CardTitle className="text-3xl md:text-4xl font-black text-white tracking-tight">Developer Access</CardTitle>
                                        <CardDescription className="text-base md:text-lg font-medium text-slate-400">
                                            Unlock lifetime API access for a one-time fee of <span className="text-[#00ff88] font-bold">5,000 BDT</span>
                                        </CardDescription>
                                    </div>
                                </CardHeader>

                                <CardContent className="space-y-6 md:space-y-8 pb-8 md:pb-10">
                                    <div className="space-y-5 md:space-y-6">
                                        <div className="space-y-2 md:space-y-3">
                                            <Label className="text-[10px] md:text-xs font-bold uppercase tracking-widest text-slate-500 ml-1">Payment Method</Label>
                                            <div className="relative group">
                                                <select 
                                                    className="w-full h-14 md:h-16 px-4 md:px-5 appearance-none border border-white/10 rounded-xl md:rounded-2xl bg-white/[0.03] text-white text-sm md:text-base focus:ring-2 focus:ring-[#00ff88]/50 focus:border-[#00ff88]/50 outline-none transition-all cursor-pointer hover:bg-white/[0.05]"
                                                    value={regData.paymentMethod}
                                                    onChange={(e) => setRegData({...regData, paymentMethod: e.target.value})}
                                                >
                                                    <option value="bkash" className="bg-[#1a1a1a]">bKash (Personal: 01XXX-XXXXXX)</option>
                                                    <option value="nagad" className="bg-[#1a1a1a]">Nagad (Personal: 01XXX-XXXXXX)</option>
                                                </select>
                                                <div className="absolute right-4 md:right-5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">
                                                    <Plus className="h-4 w-4 md:h-5 md:w-5 rotate-45" />
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-2 md:space-y-3">
                                            <Label className="text-[10px] md:text-xs font-bold uppercase tracking-widest text-slate-500 ml-1">Transaction ID (TrxID)</Label>
                                            <div className="relative">
                                                <Input 
                                                    placeholder="Enter your 10-digit TrxID"
                                                    value={regData.transactionId}
                                                    onChange={(e) => setRegData({...regData, transactionId: e.target.value})}
                                                    className="h-14 md:h-16 px-4 md:px-5 rounded-xl md:rounded-2xl bg-white/[0.03] border-white/10 text-white placeholder:text-white/20 focus:ring-2 focus:ring-[#00ff88]/50 focus:border-[#00ff88]/50 transition-all text-base md:text-lg"
                                                />
                                                <div className="absolute right-4 md:right-5 top-1/2 -translate-y-1/2 text-white/10">
                                                    <Key className="h-4 w-4 md:h-5 md:w-5" />
                                                </div>
                                            </div>
                                        </div>

                                        <Button 
                                            className="w-full h-14 md:h-16 text-lg md:text-xl font-black bg-[#00ff88] text-black hover:bg-[#00f07f] hover:shadow-[0_20px_40px_rgba(0,255,136,0.3)] rounded-xl md:rounded-2xl transition-all duration-300 active:scale-[0.98] group overflow-hidden relative" 
                                            onClick={handleRegister}
                                            disabled={registering || !regData.transactionId}
                                        >
                                            <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000 skew-x-12"></div>
                                            <span className="relative z-10 flex items-center justify-center gap-2">
                                                {registering ? (
                                                    <><RefreshCw className="h-5 w-5 md:h-6 md:w-6 animate-spin" /> Verifying...</>
                                                ) : (
                                                    <>Pay & Unlock Access <ArrowRight className="h-5 w-5 md:h-6 md:w-6 group-hover:translate-x-1 transition-transform" /></>
                                                )}
                                            </span>
                                        </Button>
                                    </div>

                                    <div className="p-3 md:p-4 rounded-xl md:rounded-2xl bg-amber-500/5 border border-amber-500/10 flex items-start gap-2 md:gap-3">
                                        <AlertCircle className="h-4 w-4 md:h-5 md:w-5 text-amber-500 shrink-0 mt-0.5" />
                                        <p className="text-[10px] md:text-xs text-amber-200/70 leading-relaxed">
                                            Please double-check your Transaction ID. Approval typically takes <span className="text-amber-500 font-bold">1-24 hours</span>.
                                        </p>
                                    </div>

                                    <div className="flex justify-center">
                                        <button 
                                            className="text-xs md:text-sm font-bold text-slate-400 hover:text-white transition-colors flex items-center gap-2"
                                            onClick={() => window.history.back()}
                                        >
                                            <ArrowLeft className="h-3 w-3 md:h-4 md:w-4" /> Back to Dashboard
                                        </button>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </div>
            )}

            {devStatus === 'pending' && (
                <div className="relative z-10 flex items-center justify-center py-10 md:py-20 min-h-[65vh] px-2">
                    <div className="w-full max-w-2xl text-center animate-in zoom-in-95 duration-700">
                        <Card className="p-8 md:p-12 space-y-6 md:space-y-8 border-white/10 bg-[#121212]/40 backdrop-blur-2xl rounded-[32px] md:rounded-[40px] shadow-2xl relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-full h-1 bg-amber-500"></div>
                            
                            <div className="mx-auto bg-amber-500/10 p-4 md:p-6 rounded-full w-fit animate-pulse">
                                <AlertCircle className="h-12 w-12 md:h-16 md:w-16 text-amber-500" />
                            </div>
                            
                            <div className="space-y-3 md:space-y-4">
                                <h2 className="text-2xl md:text-4xl font-black text-white tracking-tight">Registration Pending</h2>
                                <p className="text-slate-400 text-base md:text-xl leading-relaxed max-w-md mx-auto">
                                    Your payment is being verified. Access will be granted shortly.
                                </p>
                            </div>

                            <div className="pt-2 md:pt-4 flex flex-col sm:flex-row gap-3 md:gap-4 justify-center">
                                <Button 
                                    size="lg"
                                    onClick={fetchDevStatus}
                                    className="rounded-xl md:rounded-2xl bg-amber-500 hover:bg-amber-400 text-black font-bold px-6 md:px-8 h-12 md:h-14 text-base md:text-lg transition-all active:scale-95 shadow-[0_10px_30px_rgba(245,158,11,0.2)]"
                                >
                                    <RefreshCw className="mr-2 h-4 w-4 md:h-5 md:w-5" /> Check Status
                                </Button>
                                <Button 
                                    variant="outline"
                                    size="lg"
                                    onClick={() => window.history.back()}
                                    className="rounded-xl md:rounded-2xl border-white/10 bg-white/5 hover:bg-white/10 text-white px-6 md:px-8 h-12 md:h-14 text-base md:text-lg transition-all"
                                >
                                    Go Back
                                </Button>
                            </div>
                            
                            <p className="text-[10px] md:text-sm text-slate-500 italic">
                                Verification usually takes less than 24 hours.
                            </p>
                        </Card>
                    </div>
                </div>
            )}

            {devStatus === 'approved' && !isDevLoggedIn && (
                <div className="relative z-10 flex items-center justify-center py-6 md:py-10 min-h-[65vh] px-2">
                    <div className="w-full max-w-md animate-in zoom-in-95 duration-500">
                        <Card className="relative border-white/10 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)] bg-[#121212]/60 backdrop-blur-2xl rounded-[32px] md:rounded-[40px] overflow-hidden border-t-white/20">
                            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-600"></div>
                            
                            <CardHeader className="text-center pb-6 md:pb-8 pt-8 md:pt-10 px-4">
                                <div className="flex justify-center mb-4 md:mb-6">
                                    <Logo size="sm" accentColor="#3b82f6" className="scale-90 md:scale-100" />
                                </div>
                                <CardTitle className="text-2xl md:text-3xl font-black text-white tracking-tight">Unlock Portal</CardTitle>
                                <CardDescription className="text-sm md:text-base text-slate-400">Enter your credentials to continue</CardDescription>
                            </CardHeader>

                            <CardContent className="space-y-5 md:space-y-6 pb-8 md:pb-10 px-4 md:px-6">
                                <div className="space-y-4">
                                    <div className="space-y-1.5 md:space-y-2">
                                        <Label className="text-[10px] md:text-xs font-bold uppercase tracking-widest text-slate-500 ml-1">Developer ID</Label>
                                        <div className="relative">
                                            <Input 
                                                placeholder="Enter Dev ID"
                                                value={devCreds.id}
                                                onChange={(e) => setDevCreds({...devCreds, id: e.target.value})}
                                                className="h-12 md:h-14 px-4 md:px-5 rounded-xl md:rounded-2xl bg-white/[0.03] border-white/10 text-white placeholder:text-white/20 focus:ring-2 focus:ring-blue-500/50 transition-all text-sm md:text-base"
                                            />
                                            <div className="absolute right-4 md:right-5 top-1/2 -translate-y-1/2 text-white/10">
                                                <Activity className="h-4 w-4 md:h-5 md:w-5" />
                                            </div>
                                        </div>
                                    </div>
                                    <div className="space-y-1.5 md:space-y-2">
                                        <Label className="text-[10px] md:text-xs font-bold uppercase tracking-widest text-slate-500 ml-1">Password</Label>
                                        <div className="relative">
                                            <Input 
                                                type="password"
                                                placeholder="Enter Password"
                                                value={devCreds.pass}
                                                onChange={(e) => setDevCreds({...devCreds, pass: e.target.value})}
                                                className="h-12 md:h-14 px-4 md:px-5 rounded-xl md:rounded-2xl bg-white/[0.03] border-white/10 text-white placeholder:text-white/20 focus:ring-2 focus:ring-blue-500/50 transition-all text-sm md:text-base"
                                            />
                                            <div className="absolute right-4 md:right-5 top-1/2 -translate-y-1/2 text-white/10">
                                                <Key className="h-4 w-4 md:h-5 md:w-5" />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <Button 
                                    className="w-full h-12 md:h-16 text-base md:text-lg font-black bg-blue-600 hover:bg-blue-500 text-white rounded-xl md:rounded-2xl transition-all shadow-[0_20px_40px_rgba(59,130,246,0.2)] active:scale-95" 
                                    onClick={handleDevLogin}
                                    disabled={loggingIn || !devCreds.id || !devCreds.pass}
                                >
                                    {loggingIn ? (
                                        <><RefreshCw className="animate-spin h-5 w-5 md:h-6 md:w-6 mr-2" /> Authenticating...</>
                                    ) : (
                                        "Unlock Access"
                                    )}
                                </Button>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            )}

            {devStatus === 'approved' && isDevLoggedIn && (
                <div className="relative z-10 space-y-6 md:space-y-8 pb-10 md:pb-20 px-1 md:px-0">
                    <Card className="border-white/10 bg-[#121212]/40 backdrop-blur-2xl rounded-[24px] md:rounded-[32px] shadow-2xl overflow-hidden">
                        <div className="h-1.5 bg-gradient-to-r from-primary to-purple-600"></div>
                        <CardHeader className="pb-4 pt-6 px-4 md:px-6">
                            <CardTitle className="flex items-center gap-3 text-xl md:text-2xl font-black text-white">
                                <div className="p-2 rounded-xl bg-primary/10 shrink-0">
                                    <Key className="h-5 w-5 md:h-6 md:w-6 text-primary" />
                                </div>
                                Your API Key
                            </CardTitle>
                            <CardDescription className="text-slate-400 text-sm md:text-lg">
                                Use this key to authenticate your requests. Keep it secret!
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6 px-4 md:px-6 pb-6 md:pb-8">
                            <div className="flex flex-col lg:flex-row gap-4">
                                <div className="relative flex-1 group">
                                    <Input 
                                        value={apiKey || "No API Key Generated"} 
                                        type={showKey ? "text" : "password"} 
                                        readOnly 
                                        className="h-12 md:h-14 pr-12 font-mono bg-white/[0.03] border-white/10 rounded-xl md:rounded-2xl text-white text-xs md:text-base focus:ring-primary/50 transition-all"
                                    />
                                    <Button 
                                        variant="ghost" 
                                        size="sm" 
                                        className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 md:h-10 md:w-10 p-0 text-slate-500 hover:text-white hover:bg-white/5 rounded-lg md:rounded-xl"
                                        onClick={() => setShowKey(!showKey)}
                                    >
                                        {showKey ? <EyeOff className="h-4 w-4 md:h-5 md:w-5" /> : <Eye className="h-4 w-4 md:h-5 md:w-5" />}
                                    </Button>
                                </div>
                                <div className="flex flex-row gap-2 md:gap-3">
                                    <Button 
                                        variant="outline" 
                                        onClick={copyToClipboard} 
                                        disabled={!apiKey} 
                                        className="flex-1 lg:flex-none h-12 md:h-14 px-4 md:px-6 border-white/10 bg-white/5 hover:bg-white/10 rounded-xl md:rounded-2xl text-white font-bold transition-all text-xs md:text-base"
                                    >
                                        <Copy className="mr-2 h-4 w-4 md:h-5 md:w-5" /> Copy
                                    </Button>
                                    <Button 
                                        onClick={regenerateKey} 
                                        disabled={loading} 
                                        className="flex-[1.5] lg:flex-none h-12 md:h-14 px-4 md:px-8 bg-[#00ff88] text-black font-black rounded-xl md:rounded-2xl hover:bg-[#00f07f] shadow-[0_10px_30px_rgba(0,255,136,0.2)] transition-all active:scale-95 text-xs md:text-base"
                                    >
                                        <RefreshCw className={`mr-2 h-4 w-4 md:h-5 md:w-5 ${isRegenerating ? 'animate-spin' : ''}`} />
                                        {apiKey ? "Regenerate" : "Generate Key"}
                                    </Button>
                                </div>
                            </div>
                            
                            <Dialog open={regenDialogOpen} onOpenChange={setRegenDialogOpen}>
                              <DialogContent className="max-w-[90vw] md:max-w-md bg-[#0f0f0f]/95 border border-white/10 backdrop-blur-2xl rounded-[24px] md:rounded-[32px]">
                                <DialogHeader>
                                  <DialogTitle className="text-xl md:text-2xl font-black text-white">Regenerate API Key</DialogTitle>
                                  <DialogDescription className="text-slate-400 text-xs md:text-sm">
                                    Your old key will be revoked immediately. This action cannot be undone.
                                  </DialogDescription>
                                </DialogHeader>
                                <div className="py-2 md:py-4 text-slate-300 text-xs md:text-sm">
                                  All existing integrations using the current key will stop working. Are you sure you want to proceed?
                                </div>
                                <DialogFooter className="flex-row gap-2 md:gap-3 justify-end">
                                  <Button variant="ghost" onClick={() => setRegenDialogOpen(false)} className="rounded-xl text-slate-400 text-xs md:text-sm h-10 md:h-12">Cancel</Button>
                                  <Button 
                                    onClick={doRegenerate} 
                                    disabled={isRegenerating}
                                    className="bg-red-500 hover:bg-red-600 text-white font-bold rounded-xl px-4 md:px-6 text-xs md:text-sm h-10 md:h-12"
                                  >
                                    {isRegenerating ? <RefreshCw className="mr-2 h-3 w-3 md:h-4 md:w-4 animate-spin" /> : null}
                                    Yes, Regenerate
                                  </Button>
                                </DialogFooter>
                              </DialogContent>
                            </Dialog>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
                                <div className="group p-4 md:p-5 rounded-xl md:rounded-2xl bg-blue-500/5 border border-blue-500/10 hover:border-blue-500/30 transition-all flex items-start gap-3 md:gap-4 backdrop-blur-sm">
                                    <div className="p-2 md:p-2.5 rounded-xl bg-blue-500/10 text-blue-400 mt-0.5 md:mt-1 shrink-0">
                                        <Activity className="h-4 w-4 md:h-5 md:w-5" />
                                    </div>
                                    <div className="space-y-1.5 md:space-y-2 flex-1">
                                        <p className="text-xs md:text-sm font-bold text-blue-100 leading-snug">Read the full API documentation to master integration.</p>
                                        <Button variant="link" className="text-blue-400 font-bold p-0 h-auto hover:text-blue-300 text-xs md:text-sm" asChild>
                                            <Link to="/dashboard/api-docs" className="flex items-center gap-1">
                                                View Docs <ArrowRight className="h-3 w-3" />
                                            </Link>
                                        </Button>
                                    </div>
                                </div>
                                <div className="p-4 md:p-5 rounded-xl md:rounded-2xl bg-green-500/5 border border-green-500/10 flex items-start gap-3 md:gap-4 backdrop-blur-sm">
                                    <div className="p-2 md:p-2.5 rounded-xl bg-green-500/10 text-green-400 mt-0.5 md:mt-1 shrink-0">
                                        <Sparkles className="h-4 w-4 md:h-5 md:w-5" />
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-xs md:text-sm font-bold text-green-100">Free Trial Active</p>
                                        <p className="text-[10px] md:text-xs text-green-200/60 leading-relaxed">
                                            New accounts get 20 requests for free to test our API features.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
                        <Card className="border-white/10 bg-[#121212]/40 backdrop-blur-2xl rounded-[24px] md:rounded-[32px] shadow-xl overflow-hidden">
                            <CardHeader className="pb-3 md:pb-4 pt-6 px-4 md:px-6">
                                <CardTitle className="flex items-center gap-3 text-lg md:text-xl font-black text-white">
                                    <div className="p-2 rounded-xl bg-[#00ff88]/10 shrink-0">
                                        <Sparkles className="h-4 w-4 md:h-5 md:w-5 text-[#00ff88]" />
                                    </div>
                                    Power with Gemini
                                </CardTitle>
                                <CardDescription className="text-slate-400 text-xs md:text-sm">
                                    Add your own Gemini API key for shared capacity.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4 px-4 md:px-6 pb-6 md:pb-8">
                                <div className="space-y-3 md:space-y-4">
                                    <div className="space-y-1.5 md:space-y-2">
                                        <Label className="text-[10px] md:text-xs font-bold uppercase tracking-widest text-slate-500 ml-1">Gmail Address</Label>
                                        <Input 
                                            placeholder="Enter your Gmail" 
                                            value={userGmail}
                                            onChange={(e) => setUserGmail(e.target.value)}
                                            className="h-10 md:h-12 bg-white/[0.03] border-white/10 rounded-lg md:rounded-xl text-white text-sm placeholder:text-white/10"
                                        />
                                    </div>
                                    <div className="space-y-1.5 md:space-y-2">
                                        <Label className="text-[10px] md:text-xs font-bold uppercase tracking-widest text-slate-500 ml-1">Gemini API Key</Label>
                                        <Input 
                                            placeholder="Paste your Gemini API key" 
                                            value={userGeminiKey}
                                            onChange={(e) => setUserGeminiKey(e.target.value)}
                                            className="h-10 md:h-12 bg-white/[0.03] border-white/10 rounded-lg md:rounded-xl text-white text-sm placeholder:text-white/10"
                                        />
                                    </div>
                                </div>
                                <Button 
                                    onClick={handleAddGeminiKey} 
                                    disabled={isAddingKey || !userGeminiKey || !userGmail}
                                    className="w-full h-10 md:h-12 bg-[#00ff88] text-black font-black rounded-lg md:rounded-xl hover:bg-[#00f07f] transition-all active:scale-95 text-xs md:text-sm"
                                >
                                    {isAddingKey ? <RefreshCw className="mr-2 h-3 w-3 md:h-4 md:w-4 animate-spin" /> : <Plus className="mr-2 h-3 w-3 md:h-4 md:w-4" />}
                                    Add Gemini Key
                                </Button>
                                <p className="text-[9px] md:text-[10px] text-slate-500 italic leading-relaxed text-center px-2 md:px-4">
                                    * By adding your key, you agree to share 50% of its rate limit for our tasks.
                                </p>
                            </CardContent>
                        </Card>

                        <Card className="border-white/10 bg-[#121212]/40 backdrop-blur-2xl rounded-[24px] md:rounded-[32px] shadow-xl overflow-hidden">
                            <CardHeader className="pb-3 md:pb-4 pt-6 px-4 md:px-6">
                                <CardTitle className="flex items-center gap-3 text-lg md:text-xl font-black text-white">
                                    <div className="p-2 rounded-xl bg-primary/10 shrink-0">
                                        <Code className="h-4 w-4 md:h-5 md:w-5 text-primary" />
                                    </div>
                                    Quick Integration
                                </CardTitle>
                                <CardDescription className="text-slate-400 text-xs md:text-sm">
                                    Connect your apps to our Unified Engine.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4 md:space-y-6 px-4 md:px-6 pb-6 md:pb-8">
                                <div className="bg-black/40 p-3 md:p-4 rounded-xl md:rounded-2xl border border-white/5 space-y-1 md:space-y-2">
                                    <p className="text-[9px] md:text-[10px] font-bold text-slate-500 uppercase tracking-widest">Post Endpoint</p>
                                    <code className="block text-xs md:text-sm font-mono text-primary break-all leading-relaxed">
                                        {window.location.origin}/api/v1/dev/chat
                                    </code>
                                </div>
                                <div className="space-y-2 md:space-y-3">
                                    <div className="flex items-center justify-between p-2 md:p-3 rounded-lg md:rounded-xl bg-white/5 border border-white/5">
                                        <span className="text-[10px] md:text-xs font-bold text-slate-400">Auth Method</span>
                                        <span className="text-[9px] md:text-xs font-mono text-[#00ff88] bg-[#00ff88]/10 px-2 py-0.5 rounded">Bearer Token</span>
                                    </div>
                                    <div className="flex items-center justify-between p-2 md:p-3 rounded-lg md:rounded-xl bg-white/5 border border-white/5">
                                        <span className="text-[10px] md:text-xs font-bold text-slate-400">Default Model</span>
                                        <span className="text-[9px] md:text-xs font-mono text-primary bg-primary/10 px-2 py-0.5 rounded">salesmanchatbot-pro</span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    <Card className="border-white/10 bg-[#121212]/40 backdrop-blur-2xl rounded-[24px] md:rounded-[32px] shadow-xl overflow-hidden">
                        <CardHeader className="pb-3 md:pb-4 pt-6 px-4 md:px-6 border-b border-white/5">
                            <CardTitle className="flex items-center gap-3 text-xl md:text-2xl font-black text-white">
                                <div className="p-2 rounded-xl bg-purple-500/10 shrink-0">
                                    <Code className="h-5 w-5 md:h-6 md:w-6 text-purple-500" />
                                </div>
                                Integration Guide
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-8 md:space-y-10 pt-6 md:pt-8 px-4 md:px-6 pb-6 md:pb-8">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-10">
                                <div className="space-y-6 md:space-y-8">
                                    <div className="space-y-3 md:space-y-4">
                                        <h3 className="text-base md:text-lg font-bold text-white flex items-center gap-2 md:gap-3">
                                            <span className="h-7 w-7 md:h-8 md:u-8 rounded-full bg-primary/10 text-primary text-xs md:text-sm flex items-center justify-center font-black">1</span>
                                            Base URL
                                        </h3>
                                        <div className="flex gap-2 items-center">
                                            <Input 
                                                value={EXTERNAL_API_BASE} 
                                                readOnly 
                                                className="h-10 md:h-12 font-mono bg-black/40 border-white/10 rounded-lg md:rounded-xl text-primary text-xs md:text-sm"
                                            />
                                            <Button variant="outline" size="icon" className="h-10 w-10 md:h-12 md:w-12 rounded-lg md:rounded-xl border-white/10 hover:bg-white/5 shrink-0" onClick={() => {
                                                navigator.clipboard.writeText(EXTERNAL_API_BASE);
                                                toast.success("Base URL copied");
                                            }}>
                                                <Copy className="h-4 w-4 md:h-5 md:w-5" />
                                            </Button>
                                        </div>
                                    </div>

                                    <div className="space-y-3 md:space-y-4">
                                        <h3 className="text-base md:text-lg font-bold text-white flex items-center gap-2 md:gap-3">
                                            <span className="h-7 w-7 md:h-8 md:u-8 rounded-full bg-primary/10 text-primary text-xs md:text-sm flex items-center justify-center font-black">2</span>
                                            Example Request
                                        </h3>
                                        <div className="relative group">
                                            <div className="absolute right-2 top-2 md:right-4 md:top-4 z-10 opacity-100 lg:opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Button 
                                                    variant="secondary" 
                                                    size="sm" 
                                                    className="h-7 md:h-8 rounded-lg bg-white/10 hover:bg-white/20 backdrop-blur-md text-[10px] md:text-xs"
                                                    onClick={() => {
                                                        navigator.clipboard.writeText(`curl -X POST ${EXTERNAL_API_BASE}/chat/completions \\\n  -H \"Content-Type: application/json\" \\\n  -H \"Authorization: Bearer ${apiKey || 'YOUR_API_KEY'}\" \\\n  -d '{\n    \"model\": \"salesmanchatbot-pro\",\n    \"messages\": [\n      {\"role\": \"user\", \"content\": \"Hello, how are you?\"}\n    ]\n  }'`);
                                                        toast.success("cURL copied");
                                                    }}
                                                >
                                                    <Copy className="h-3 w-3 md:h-3.5 md:w-3.5 mr-1" /> Copy
                                                </Button>
                                            </div>
                                            <pre className="bg-black/60 text-slate-300 p-4 md:p-6 rounded-xl md:rounded-2xl overflow-x-auto text-[10px] md:text-xs font-mono border border-white/5 shadow-inner leading-relaxed">
{`curl -X POST ${EXTERNAL_API_BASE}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKey || 'YOUR_API_KEY'}" \\
  -d '{
    "model": "salesmanchatbot-pro",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'`}
                                            </pre>
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-6 md:space-y-8">
                                    <div className="p-4 md:p-6 rounded-xl md:rounded-2xl bg-white/[0.02] border border-white/5 space-y-4">
                                        <h3 className="text-base md:text-lg font-bold text-white">n8n Setup</h3>
                                        <ul className="space-y-2 md:space-y-3 text-xs md:text-sm text-slate-400">
                                            <li className="flex items-center justify-between">
                                                <span>Node Type</span>
                                                <span className="text-white font-bold">OpenAI</span>
                                            </li>
                                            <li className="flex items-center justify-between">
                                                <span>Resource</span>
                                                <span className="text-white font-bold">Chat</span>
                                            </li>
                                            <li className="flex items-center justify-between">
                                                <span>Model</span>
                                                <code className="text-primary font-mono text-[10px] md:text-xs">salesmanchatbot-pro</code>
                                            </li>
                                            <li className="pt-2">
                                                <p className="text-[10px] md:text-xs mb-1.5 md:mb-2 text-slate-500 uppercase font-bold tracking-widest">Base URL</p>
                                                <div className="flex items-center gap-2 p-2 rounded-lg bg-black/40 border border-white/5">
                                                    <code className="flex-1 text-[9px] md:text-[10px] text-primary truncate font-mono">{EXTERNAL_API_BASE}</code>
                                                    <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-500 shrink-0" onClick={() => {
                                                        navigator.clipboard.writeText(EXTERNAL_API_BASE);
                                                        toast.success("n8n URL copied");
                                                    }}>
                                                        <Copy className="h-3 w-3" />
                                                    </Button>
                                                </div>
                                            </li>
                                        </ul>
                                    </div>

                                    <div className="grid grid-cols-2 gap-2 md:gap-3">
                                        {['Text Gen', 'Vision', 'Audio', 'Tools'].map((cap) => (
                                            <div key={cap} className="flex items-center gap-2 p-2 md:p-3 rounded-lg md:rounded-xl bg-white/5 border border-white/5 text-[10px] md:text-xs font-bold text-slate-300">
                                                <div className="h-1 md:h-1.5 w-1 md:w-1.5 rounded-full bg-[#00ff88] shrink-0" /> {cap}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Stats Section */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                        {[
                            { label: 'Total Cost', value: `৳${usageSummary.total_cost?.toFixed(4)}`, sub: 'Lifetime API spend', color: 'primary' },
                            { label: 'Today\'s Cost', value: `৳${usageSummary.today_cost?.toFixed(4)}`, sub: 'Spend since midnight', color: 'primary' },
                            { label: 'Total Tokens', value: formatCompact(usageSummary.total_tokens), sub: 'Lifetime capacity', color: 'purple-500' }
                        ].map((stat, i) => (
                            <Card key={i} className="border-white/10 bg-[#121212]/40 backdrop-blur-2xl rounded-[20px] md:rounded-[24px] shadow-lg overflow-hidden group hover:border-white/20 transition-all">
                                <CardHeader className="pb-1 md:pb-2 pt-4 md:pt-6 px-4 md:px-6">
                                    <CardTitle className="text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-widest">{stat.label}</CardTitle>
                                </CardHeader>
                                <CardContent className="px-4 md:px-6 pb-4 md:pb-6">
                                    <div className={`text-2xl md:text-3xl font-black text-white group-hover:text-${stat.color} transition-colors`}>{stat.value}</div>
                                    <p className="text-[10px] md:text-xs text-slate-500 mt-0.5 md:mt-1">{stat.sub}</p>
                                </CardContent>
                            </Card>
                        ))}
                    </div>

                    <Card className="border-white/10 bg-[#121212]/40 backdrop-blur-2xl rounded-[24px] md:rounded-[32px] shadow-xl overflow-hidden">
                        <CardHeader className="px-4 md:px-6 pt-6 md:pt-8">
                            <CardTitle className="flex items-center gap-3 text-lg md:text-xl font-black text-white">
                                <Activity className="h-5 w-5 text-primary shrink-0" />
                                Usage Statistics
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="px-4 md:px-6 pb-6 md:pb-8">
                            <div className="rounded-xl md:rounded-2xl border border-white/10 overflow-hidden bg-black/20">
                                <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-white/10">
                                    <Table>
                                        <TableHeader className="bg-white/5">
                                            <TableRow className="border-white/10 hover:bg-transparent">
                                                <TableHead className="text-slate-400 font-bold text-xs md:text-sm whitespace-nowrap">Date</TableHead>
                                                <TableHead className="text-slate-400 font-bold text-xs md:text-sm whitespace-nowrap">Model</TableHead>
                                                <TableHead className="text-right text-slate-400 font-bold text-xs md:text-sm whitespace-nowrap">Tokens</TableHead>
                                                <TableHead className="text-right text-slate-400 font-bold text-xs md:text-sm whitespace-nowrap">Cost (BDT)</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {usageStats.length > 0 ? (
                                                usageStats.map((stat, i) => (
                                                    <TableRow key={i} className="border-white/5 hover:bg-white/5 transition-colors">
                                                        <TableCell className="text-slate-300 py-3 md:py-4 text-xs md:text-sm whitespace-nowrap">{new Date(stat.created_at).toLocaleString()}</TableCell>
                                                        <TableCell>
                                                            <span className="px-2 py-0.5 md:py-1 rounded-md md:rounded-lg bg-primary/10 text-primary text-[9px] md:text-[10px] font-mono font-bold whitespace-nowrap">
                                                                {stat.model}
                                                            </span>
                                                        </TableCell>
                                                        <TableCell className="text-right font-mono text-slate-300 text-xs md:text-sm">{formatCompact(stat.tokens)}</TableCell>
                                                        <TableCell className="text-right font-mono text-primary font-bold text-xs md:text-sm">৳{Number(stat.cost || 0).toFixed(4)}</TableCell>
                                                    </TableRow>
                                                ))
                                            ) : (
                                                <TableRow>
                                                    <TableCell colSpan={4} className="text-center py-10 md:py-12 text-slate-500 text-xs md:text-sm">
                                                        No usage data available yet.
                                                    </TableCell>
                                                </TableRow>
                                            )}
                                        </TableBody>
                                    </Table>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    );
}
