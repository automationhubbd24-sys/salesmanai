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
        <div className="relative min-h-screen space-y-4 md:space-y-6 p-4 md:p-8 animate-in fade-in duration-500 overflow-x-hidden bg-[#0a0a0a]">
            {/* Minimal Background Element */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
                <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-primary/5 rounded-full blur-[120px]"></div>
            </div>

            <div className="relative z-10">
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white">Developer API</h1>
                <p className="text-sm text-slate-400 mt-1">
                    Integrate our AI engine into your applications.
                </p>
            </div>

            {devStatus === 'none' && (
                <div className="relative z-10 flex items-center justify-center py-6 md:py-12 px-4">
                    <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-5 gap-8 lg:gap-12 items-start">
                        {/* Left Side: Why Buy? (3/5 width) */}
                        <div className="lg:col-span-3 space-y-8 animate-in fade-in duration-700">
                            <div className="space-y-4">
                                <Badge className="bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 transition-colors">Developer Portal</Badge>
                                <h2 className="text-3xl md:text-5xl font-bold leading-tight text-white tracking-tight">
                                    Build Smarter Apps with <span className="text-primary">SalesmanAI API</span>
                                </h2>
                                <p className="text-slate-400 text-base md:text-lg leading-relaxed max-w-xl">
                                    আমাদের পাওয়ারফুল AI ইঞ্জিন ব্যবহার করে আপনার নিজের অ্যাপ্লিকেশনে Text, Vision এবং Voice ফিচার যুক্ত করুন মাত্র কয়েক লাইনে।
                                </p>
                            </div>

                            {/* Feature Preview Boxes */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 space-y-2 group hover:border-primary/30 transition-all">
                                    <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                                        <Sparkles className="h-4 w-4 text-blue-400" />
                                    </div>
                                    <h4 className="text-white font-bold text-sm">Unified AI Engine</h4>
                                    <p className="text-xs text-slate-500">Access Text, Image, and Audio models through a single API endpoint.</p>
                                </div>
                                <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 space-y-2 group hover:border-primary/30 transition-all">
                                    <div className="h-8 w-8 rounded-lg bg-green-500/10 flex items-center justify-center">
                                        <Activity className="h-4 w-4 text-green-400" />
                                    </div>
                                    <h4 className="text-white font-bold text-sm">Real-time Analytics</h4>
                                    <p className="text-xs text-slate-500">Monitor your API usage, token consumption, and costs in real-time.</p>
                                </div>
                            </div>

                            {/* Code Preview */}
                            <div className="rounded-2xl overflow-hidden border border-white/5 bg-black/40 shadow-inner group">
                                <div className="px-4 py-2 bg-white/5 border-b border-white/5 flex items-center justify-between">
                                    <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">example_request.js</span>
                                    <div className="flex gap-1.5">
                                        <div className="h-2 w-2 rounded-full bg-red-500/20"></div>
                                        <div className="h-2 w-2 rounded-full bg-amber-500/20"></div>
                                        <div className="h-2 w-2 rounded-full bg-green-500/20"></div>
                                    </div>
                                </div>
                                <pre className="p-4 text-[10px] md:text-xs font-mono text-primary/80 leading-relaxed overflow-x-auto">
{`const response = await fetch('api.salesmanchatbot.online/v1/chat', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer YOUR_API_KEY' },
  body: JSON.stringify({
    model: 'salesmanchatbot-pro',
    prompt: 'Hello AI!'
  })
});`}
                                </pre>
                            </div>
                        </div>

                        {/* Right Side: Access Card (2/5 width) */}
                        <div className="lg:col-span-2 animate-in fade-in duration-700 lg:sticky lg:top-8">
                            <Card className="border-white/5 bg-[#121212] rounded-[32px] overflow-hidden shadow-2xl">
                                <CardHeader className="space-y-1 pb-6 pt-8 px-6 md:px-8 border-b border-white/5">
                                    <CardTitle className="text-xl font-bold text-white tracking-tight">Access Card</CardTitle>
                                    <CardDescription className="text-slate-400 text-xs">
                                        Lifetime access: <span className="text-primary font-bold">5,000 BDT</span>
                                    </CardDescription>
                                </CardHeader>

                                <CardContent className="space-y-6 py-8 px-6 md:px-8">
                                    <div className="space-y-5">
                                        {/* Simple Instructions */}
                                        <div className="space-y-2">
                                            <p className="text-[10px] font-bold uppercase text-slate-500 tracking-widest ml-1">Payment Instruction</p>
                                            <div className="p-3.5 rounded-2xl bg-primary/5 border border-primary/10 space-y-2">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-xs text-slate-300 font-medium">bKash/Nagad (Personal)</span>
                                                </div>
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="text-lg font-mono font-bold text-white">01956871403</span>
                                                    <Button 
                                                        variant="ghost" 
                                                        size="icon" 
                                                        className="h-8 w-8 text-primary hover:bg-primary/10"
                                                        onClick={() => {
                                                            navigator.clipboard.writeText("01956871403");
                                                            toast.success("Copied to clipboard");
                                                        }}
                                                    >
                                                        <Copy className="h-3.5 w-3.5" />
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <Label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">Payment Method</Label>
                                            <select 
                                                className="w-full h-11 px-3 appearance-none border border-white/10 rounded-xl bg-white/[0.02] text-white text-xs focus:ring-1 focus:ring-primary outline-none transition-all cursor-pointer"
                                                value={regData.paymentMethod}
                                                onChange={(e) => setRegData({...regData, paymentMethod: e.target.value})}
                                            >
                                                <option value="bkash" className="bg-[#1a1a1a]">bKash</option>
                                                <option value="nagad" className="bg-[#1a1a1a]">Nagad</option>
                                            </select>
                                        </div>

                                        <div className="space-y-2">
                                            <Label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">Transaction ID (TrxID)</Label>
                                            <Input 
                                                placeholder="Paste TrxID here"
                                                value={regData.transactionId}
                                                onChange={(e) => setRegData({...regData, transactionId: e.target.value})}
                                                className="h-11 px-3 rounded-xl bg-white/[0.02] border-white/10 text-white placeholder:text-white/10 focus:ring-1 focus:ring-primary transition-all text-sm"
                                            />
                                        </div>

                                        <Button 
                                            className="w-full h-12 text-sm font-bold bg-primary text-black hover:bg-primary/90 rounded-xl transition-all active:scale-[0.98] mt-2 shadow-[0_8px_16px_rgba(0,255,136,0.1)]" 
                                            onClick={handleRegister}
                                            disabled={registering || !regData.transactionId}
                                        >
                                            {registering ? (
                                                <RefreshCw className="h-4 w-4 animate-spin" />
                                            ) : (
                                                "Unlock Access"
                                            )}
                                        </Button>
                                    </div>

                                    <div className="flex justify-center">
                                        <button 
                                            className="text-[10px] font-medium text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1.5"
                                            onClick={() => window.history.back()}
                                        >
                                            <ArrowLeft className="h-3 w-3" /> Dashboard
                                        </button>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </div>
            )}

            {devStatus === 'pending' && (
                <div className="relative z-10 flex items-center justify-center py-20 px-4">
                    <Card className="w-full max-w-md p-10 text-center border-white/5 bg-[#121212] rounded-3xl shadow-2xl">
                        <div className="mx-auto bg-amber-500/10 p-4 rounded-full w-fit mb-6">
                            <AlertCircle className="h-10 w-10 text-amber-500" />
                        </div>
                        <h2 className="text-2xl font-bold text-white mb-2">Registration Pending</h2>
                        <p className="text-slate-400 text-sm mb-8">
                            Your payment is being verified. Verification usually takes less than 24 hours.
                        </p>
                        <div className="flex flex-col gap-3">
                            <Button 
                                onClick={fetchDevStatus}
                                className="w-full h-12 bg-primary text-black font-bold rounded-xl"
                            >
                                <RefreshCw className="mr-2 h-4 w-4" /> Check Status
                            </Button>
                            <Button 
                                variant="ghost"
                                onClick={() => window.history.back()}
                                className="w-full h-12 text-slate-400 hover:text-white"
                            >
                                Go Back
                            </Button>
                        </div>
                    </Card>
                </div>
            )}

            {devStatus === 'approved' && !isDevLoggedIn && (
                <div className="relative z-10 flex items-center justify-center py-20 px-4">
                    <Card className="w-full max-w-md border-white/5 bg-[#121212] rounded-3xl overflow-hidden shadow-2xl">
                        <CardHeader className="text-center pt-10 pb-6">
                            <CardTitle className="text-2xl font-bold text-white">Unlock Portal</CardTitle>
                            <CardDescription className="text-slate-400">Enter your credentials to continue</CardDescription>
                        </CardHeader>

                        <CardContent className="space-y-6 pb-10 px-8">
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Developer ID</Label>
                                    <Input 
                                        placeholder="Enter Dev ID"
                                        value={devCreds.id}
                                        onChange={(e) => setDevCreds({...devCreds, id: e.target.value})}
                                        className="h-12 px-4 rounded-xl bg-white/[0.02] border-white/10 text-white placeholder:text-white/10 focus:ring-1 focus:ring-primary transition-all text-sm"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Password</Label>
                                    <Input 
                                        type="password"
                                        placeholder="Enter Password"
                                        value={devCreds.pass}
                                        onChange={(e) => setDevCreds({...devCreds, pass: e.target.value})}
                                        className="h-12 px-4 rounded-xl bg-white/[0.02] border-white/10 text-white placeholder:text-white/10 focus:ring-1 focus:ring-primary transition-all text-sm"
                                    />
                                </div>
                            </div>

                            <Button 
                                className="w-full h-12 text-sm font-bold bg-primary text-black hover:bg-primary/90 rounded-xl transition-all" 
                                onClick={handleDevLogin}
                                disabled={loggingIn || !devCreds.id || !devCreds.pass}
                            >
                                {loggingIn ? (
                                    <RefreshCw className="animate-spin h-5 w-5" />
                                ) : (
                                    "Unlock Access"
                                )}
                            </Button>
                        </CardContent>
                    </Card>
                </div>
            )}

            {devStatus === 'approved' && isDevLoggedIn && (
                <div className="relative z-10 space-y-6 pb-20">
                    <Card className="border-white/5 bg-[#121212] rounded-3xl overflow-hidden shadow-2xl">
                        <CardHeader className="pb-4 pt-8 px-6 md:px-10">
                            <CardTitle className="text-xl md:text-2xl font-bold text-white flex items-center gap-2">
                                <Key className="h-5 w-5 text-primary" />
                                API Key
                            </CardTitle>
                            <CardDescription className="text-slate-400">
                                Use this key to authenticate your requests. Keep it secure.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6 px-6 md:px-10 pb-10">
                            <div className="flex flex-col lg:flex-row gap-4">
                                <div className="relative flex-1 group">
                                    <Input 
                                        value={apiKey || "No API Key Generated"} 
                                        type={showKey ? "text" : "password"} 
                                        readOnly 
                                        className="h-12 pr-12 font-mono bg-white/[0.02] border-white/10 rounded-xl text-white text-xs md:text-sm focus:ring-1 focus:ring-primary transition-all"
                                    />
                                    <Button 
                                        variant="ghost" 
                                        size="sm" 
                                        className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 p-0 text-slate-500 hover:text-white"
                                        onClick={() => setShowKey(!showKey)}
                                    >
                                        {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </Button>
                                </div>
                                <div className="flex flex-row gap-3">
                                    <Button 
                                        variant="outline" 
                                        onClick={copyToClipboard} 
                                        disabled={!apiKey} 
                                        className="h-12 px-6 border-white/10 bg-white/5 hover:bg-white/10 rounded-xl text-white font-bold transition-all text-sm"
                                    >
                                        <Copy className="mr-2 h-4 w-4" /> Copy
                                    </Button>
                                    <Button 
                                        onClick={regenerateKey} 
                                        disabled={loading} 
                                        className="h-12 px-8 bg-primary text-black font-bold rounded-xl hover:bg-primary/90 transition-all text-sm"
                                    >
                                        <RefreshCw className={`mr-2 h-4 w-4 ${isRegenerating ? 'animate-spin' : ''}`} />
                                        {apiKey ? "Regenerate" : "Generate"}
                                    </Button>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/5 space-y-2">
                                    <p className="text-sm font-bold text-white">API Docs</p>
                                    <p className="text-xs text-slate-400 leading-relaxed">Learn how to integrate our AI into your workflow.</p>
                                    <Button variant="link" className="text-primary font-bold p-0 h-auto text-xs" asChild>
                                        <Link to="/dashboard/api-docs" className="flex items-center gap-1">
                                            Open Documentation <ArrowRight className="h-3 w-3" />
                                        </Link>
                                    </Button>
                                </div>
                                <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/5 space-y-2">
                                    <p className="text-sm font-bold text-white">Usage Trial</p>
                                    <p className="text-xs text-slate-400 leading-relaxed">20 free requests included for initial testing.</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <Card className="border-white/5 bg-[#121212] rounded-3xl overflow-hidden shadow-xl">
                            <CardHeader className="pt-8 px-6 md:px-10">
                                <CardTitle className="text-lg font-bold text-white">External Engine</CardTitle>
                                <CardDescription className="text-slate-400 text-xs">Add your Gemini API key for extra capacity.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4 px-6 md:px-10 pb-10">
                                <div className="space-y-3">
                                    <Input 
                                        placeholder="Gmail Address" 
                                        value={userGmail}
                                        onChange={(e) => setUserGmail(e.target.value)}
                                        className="h-12 bg-white/[0.02] border-white/10 rounded-xl text-white text-sm"
                                    />
                                    <Input 
                                        placeholder="Gemini API Key" 
                                        value={userGeminiKey}
                                        onChange={(e) => setUserGeminiKey(e.target.value)}
                                        className="h-12 bg-white/[0.02] border-white/10 rounded-xl text-white text-sm"
                                    />
                                </div>
                                <Button 
                                    onClick={handleAddGeminiKey} 
                                    disabled={isAddingKey || !userGeminiKey || !userGmail}
                                    className="w-full h-12 bg-white/5 hover:bg-white/10 text-white font-bold rounded-xl transition-all"
                                >
                                    {isAddingKey ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Save Gemini Key"}
                                </Button>
                            </CardContent>
                        </Card>

                        <Card className="border-white/5 bg-[#121212] rounded-3xl overflow-hidden shadow-xl">
                            <CardHeader className="pt-8 px-6 md:px-10">
                                <CardTitle className="text-lg font-bold text-white">Endpoint</CardTitle>
                                <CardDescription className="text-slate-400 text-xs">Direct API connection point.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4 px-6 md:px-10 pb-10">
                                <div className="bg-black/40 p-4 rounded-xl border border-white/5">
                                    <code className="block text-[10px] md:text-xs font-mono text-primary break-all leading-relaxed">
                                        {window.location.origin}/api/v1/dev/chat
                                    </code>
                                </div>
                                <div className="flex justify-between text-[10px] md:text-xs text-slate-500 font-medium">
                                    <span>Auth: Bearer Token</span>
                                    <span>Model: salesmanchatbot-pro</span>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Stats Table */}
                    <Card className="border-white/5 bg-[#121212] rounded-3xl overflow-hidden shadow-xl">
                        <CardHeader className="px-6 md:px-10 pt-8 pb-4">
                            <CardTitle className="text-lg font-bold text-white">Usage Statistics</CardTitle>
                        </CardHeader>
                        <CardContent className="px-6 md:px-10 pb-10">
                            <div className="rounded-xl border border-white/5 overflow-hidden">
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader className="bg-white/[0.02]">
                                            <TableRow className="border-white/5 hover:bg-transparent">
                                                <TableHead className="text-slate-500 font-bold text-xs uppercase tracking-wider">Date</TableHead>
                                                <TableHead className="text-slate-500 font-bold text-xs uppercase tracking-wider">Model</TableHead>
                                                <TableHead className="text-right text-slate-500 font-bold text-xs uppercase tracking-wider">Tokens</TableHead>
                                                <TableHead className="text-right text-slate-500 font-bold text-xs uppercase tracking-wider">Cost (BDT)</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {usageStats.length > 0 ? (
                                                usageStats.map((stat, i) => (
                                                    <TableRow key={i} className="border-white/5 hover:bg-white/[0.01] transition-colors">
                                                        <TableCell className="text-slate-400 py-4 text-xs">{new Date(stat.created_at).toLocaleDateString()}</TableCell>
                                                        <TableCell>
                                                            <span className="text-slate-300 text-xs font-mono">{stat.model}</span>
                                                        </TableCell>
                                                        <TableCell className="text-right font-mono text-slate-400 text-xs">{formatCompact(stat.tokens)}</TableCell>
                                                        <TableCell className="text-right font-mono text-primary font-bold text-xs">৳{Number(stat.cost || 0).toFixed(4)}</TableCell>
                                                    </TableRow>
                                                ))
                                            ) : (
                                                <TableRow>
                                                    <TableCell colSpan={4} className="text-center py-10 text-slate-600 text-xs italic">
                                                        No usage data yet.
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
