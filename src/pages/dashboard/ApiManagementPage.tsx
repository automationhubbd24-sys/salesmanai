import React, { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trash, Plus, Check, RefreshCw, Search, Filter, ChevronLeft, ChevronRight, History, Activity, Zap, Shield, Clock, Database, BrainCircuit, BarChart3, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { BACKEND_URL } from "@/config";
import { cn } from "@/lib/utils";

interface ApiItem {
    id: number;
    provider: string;
    api: string;
    status?: string;
    usage_today?: number;
    usage_tokens_today?: number;
    usage_count?: number;
    current_rpm?: number;
    current_rph?: number;
    rph_limit?: number;
    rpm_limit?: number;
    rpd_limit?: number;
    cooldown_until?: string | null;
    model_usage?: Record<string, { count?: number; tokens?: number }>;
}

interface RotationLog {
    timestamp: string;
    provider: string;
    model: string;
    key: string;
    index: number;
    total: number;
}

interface GlobalConfig {
    provider: string;
    text_model: string;
    vision_model: string;
    voice_model: string;
    text_provider_override?: string;
    vision_provider_override?: string;
    voice_provider_override?: string;
    text_rpm?: number;
    text_rpd?: number;
    text_rph?: number;
    text_tpm?: number;
    text_tpd?: number;
    text_tpmo?: number;
    vision_rpm?: number;
    vision_rpd?: number;
    vision_rph?: number;
    vision_tpm?: number;
    vision_tpd?: number;
    vision_tpmo?: number;
    voice_rpm?: number;
    voice_rpd?: number;
    voice_rph?: number;
    voice_tpm?: number;
    voice_tpd?: number;
    voice_tpmo?: number;
    semantic_cache_enabled?: boolean;
    semantic_cache_threshold?: number;
}

export default function ApiManagementPage() {
    const [apis, setApis] = useState<ApiItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [newApi, setNewApi] = useState("");
    const [provider, setProvider] = useState("google");
    const [globalConfigs, setGlobalConfigs] = useState<GlobalConfig[]>([]);
    const [selectedConfigProvider, setSelectedConfigProvider] = useState("google");
    const [configValues, setConfigValues] = useState<GlobalConfig>({
        provider: "google",
        text_model: "gemini-2.5-flash",
        vision_model: "gemini-2.5-flash",
        voice_model: "gemini-2.5-flash",
        text_rpm: 10,
        text_rpd: 1500,
        semantic_cache_enabled: true,
        semantic_cache_threshold: 0.95
    });

    // Pagination & Search State
    const [page, setPage] = useState(1);
    const [totalItems, setTotalItems] = useState(0);
    const [limit] = useState(10);
    const [searchQuery, setSearchQuery] = useState("");
    const [providerFilter, setProviderFilter] = useState("all");
    const [rotationLogs, setRotationLogs] = useState<RotationLog[]>([]);
    const [selectedIds, setSelectedIds] = useState<number[]>([]);

    const fetchApis = useCallback(async () => {
        setLoading(true);
        try {
            let token = localStorage.getItem("auth_token");
            if (!token) return;

            const params = new URLSearchParams({
                page: page.toString(),
                limit: limit.toString(),
                provider: providerFilter,
                q: searchQuery
            });

            const res = await fetch(`${BACKEND_URL}/api/api-list?${params.toString()}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const body = await res.json();
            if (res.ok && body.success) {
                setApis(body.keys || []);
                setTotalItems(body.total || 0);
            }
        } catch (error: any) {
            toast.error("Failed to fetch API list");
        } finally {
            setLoading(false);
        }
    }, [page, limit, providerFilter, searchQuery]);

    const fetchRotationLogs = async () => {
        try {
            let token = localStorage.getItem("auth_token");
            const res = await fetch(`${BACKEND_URL}/api/api-list/rotation-logs`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const body = await res.json();
            if (res.ok && body.success) {
                setRotationLogs(body.logs || []);
            }
        } catch (error) {
            console.error("Failed to fetch rotation logs", error);
        }
    };

    useEffect(() => {
        fetchApis();
        fetchGlobalConfigs();
        fetchRotationLogs();
        
        const interval = setInterval(fetchRotationLogs, 5000);
        return () => clearInterval(interval);
    }, [fetchApis]);

    const fetchGlobalConfigs = async () => {
        try {
            let token = localStorage.getItem("auth_token");
            const res = await fetch(`${BACKEND_URL}/api/api-list/config`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const body = await res.json();
            if (res.ok && body.success) {
                setGlobalConfigs(body.configs || []);
                const current = body.configs.find((c: any) => c.provider === selectedConfigProvider);
                if (current) setConfigValues(current);
            }
        } catch (error) {
            console.error("Failed to fetch configs", error);
        }
    };

    const handleProviderChange = (newProvider: string) => {
        setSelectedConfigProvider(newProvider);
        const current = globalConfigs.find(c => c.provider === newProvider);
        if (current) {
            setConfigValues(current);
        } else {
            setConfigValues({
                provider: newProvider,
                text_model: newProvider === "google" ? "gemini-2.5-flash" : "gpt-4o-mini",
                vision_model: newProvider === "google" ? "gemini-2.5-flash" : "gpt-4o-mini",
                voice_model: newProvider === "google" ? "gemini-2.5-flash" : "gpt-4o-mini",
                text_rpm: 10,
                text_rpd: 1500,
                semantic_cache_enabled: true,
                semantic_cache_threshold: 0.95
            });
        }
    };

    const saveGlobalConfig = async () => {
        try {
            let token = localStorage.getItem("auth_token");
            const res = await fetch(`${BACKEND_URL}/api/api-list/config`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify(configValues)
            });
            const body = await res.json();
            if (res.ok && body.success) {
                toast.success("Global configuration saved");
                fetchGlobalConfigs();
            }
        } catch (error) {
            toast.error("Failed to save configuration");
        }
    };

    const addApi = async () => {
        if (!newApi) return;
        try {
            let token = localStorage.getItem("auth_token");
            const res = await fetch(`${BACKEND_URL}/api/api-list`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ provider, api: newApi })
            });
            const body = await res.json();
            if (res.ok && body.success) {
                toast.success("API Key added successfully");
                setNewApi("");
                fetchApis();
            } else {
                throw new Error(body.error);
            }
        } catch (error: any) {
            toast.error(error.message || "Failed to add API Key");
        }
    };

    const deleteApi = async (id: number) => {
        if (!confirm("Are you sure?")) return;
        try {
            let token = localStorage.getItem("auth_token");
            const res = await fetch(`${BACKEND_URL}/api/api-list/${id}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                toast.success("API Key deleted");
                // Keep current page; if now empty, fallback one page
                await fetchApis();
                setSelectedIds(prev => prev.filter(x => x !== id));
            }
        } catch (error) {
            toast.error("Failed to delete");
        }
    };

    const toggleSelect = (id: number) => {
        setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const selectAllOnPage = () => {
        const idsOnPage = apis.map(a => a.id);
        const allSelected = idsOnPage.every(id => selectedIds.includes(id));
        if (allSelected) {
            setSelectedIds(prev => prev.filter(id => !idsOnPage.includes(id)));
        } else {
            setSelectedIds(prev => Array.from(new Set([...prev, ...idsOnPage])));
        }
    };

    const deleteSelected = async () => {
        if (selectedIds.length === 0) {
            toast.info("No keys selected");
            return;
        }
        if (!confirm(`Delete ${selectedIds.length} selected keys?`)) return;
        try {
            let token = localStorage.getItem("auth_token");
            await Promise.all(
                selectedIds.map(id =>
                    fetch(`${BACKEND_URL}/api/api-list/${id}`, {
                        method: "DELETE",
                        headers: { Authorization: `Bearer ${token}` }
                    })
                )
            );
            toast.success(`Deleted ${selectedIds.length} keys`);
            setSelectedIds([]);
            // Keep the user on the same page; if the page becomes empty, go to previous page
            const prevPage = page;
            await fetchApis();
            if (apis.length === 0 && prevPage > 1) {
                setPage(prevPage - 1);
            }
        } catch (error) {
            toast.error("Bulk delete failed");
        }
    };

    const totalPages = Math.ceil(totalItems / limit);

    return (
        <div className="container mx-auto p-4 space-y-6 max-w-7xl">
            {/* Header with Stats Summary */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card className="bg-[#0f0f0f]/60 border-white/5 backdrop-blur-md">
                    <CardContent className="p-4 flex items-center gap-4">
                        <div className="h-10 w-10 rounded-full bg-blue-500/10 flex items-center justify-center">
                            <Zap className="h-5 w-5 text-blue-500" />
                        </div>
                        <div>
                            <p className="text-xs text-white/40 font-medium uppercase tracking-wider">Total Pool</p>
                            <p className="text-2xl font-bold text-white">{totalItems}</p>
                        </div>
                    </CardContent>
                </Card>
                <Card className="bg-[#0f0f0f]/60 border-white/5 backdrop-blur-md">
                    <CardContent className="p-4 flex items-center gap-4">
                        <div className="h-10 w-10 rounded-full bg-green-500/10 flex items-center justify-center">
                            <Activity className="h-5 w-5 text-green-500" />
                        </div>
                        <div>
                            <p className="text-xs text-white/40 font-medium uppercase tracking-wider">Active Keys</p>
                            <p className="text-2xl font-bold text-green-400">{apis.filter(k => k.status === 'active').length}</p>
                        </div>
                    </CardContent>
                </Card>
                <Card className="bg-[#0f0f0f]/60 border-white/5 backdrop-blur-md">
                    <CardContent className="p-4 flex items-center gap-4">
                        <div className="h-10 w-10 rounded-full bg-orange-500/10 flex items-center justify-center">
                            <Shield className="h-5 w-5 text-orange-500" />
                        </div>
                        <div>
                            <p className="text-xs text-white/40 font-medium uppercase tracking-wider">In Cooldown</p>
                            <p className="text-2xl font-bold text-orange-400">
                                {apis.filter(k => k.cooldown_until && new Date(k.cooldown_until) > new Date()).length}
                            </p>
                        </div>
                    </CardContent>
                </Card>
                <Card className="bg-[#0f0f0f]/60 border-white/5 backdrop-blur-md">
                    <CardContent className="p-4 flex items-center gap-4">
                        <div className="h-10 w-10 rounded-full bg-purple-500/10 flex items-center justify-center">
                            <BrainCircuit className="h-5 w-5 text-purple-500" />
                        </div>
                        <div>
                            <p className="text-xs text-white/40 font-medium uppercase tracking-wider">Semantic Cache</p>
                            <p className="text-2xl font-bold text-purple-400">Active</p>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Tabs defaultValue="management" className="w-full">
                <TabsList className="bg-black/40 border border-white/10 p-1">
                    <TabsTrigger value="management" className="gap-2"><Database className="h-4 w-4" /> Management</TabsTrigger>
                    <TabsTrigger value="config" className="gap-2"><Settings2 className="h-4 w-4" /> Advanced Config</TabsTrigger>
                    <TabsTrigger value="analytics" className="gap-2"><BarChart3 className="h-4 w-4" /> Analytics</TabsTrigger>
                </TabsList>

                <TabsContent value="management" className="space-y-6 mt-6">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="lg:col-span-2 space-y-6">
                            <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10 shadow-2xl overflow-hidden">
                                <CardHeader className="bg-white/5 border-b border-white/5">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <CardTitle className="text-xl font-bold text-white">API Rotation Pool</CardTitle>
                                            <CardDescription>Manage and monitor your API keys</CardDescription>
                                        </div>
                                        <Button 
                                            size="sm"
                                            onClick={async () => {
                                                try {
                                                    const token = localStorage.getItem("auth_token");
                                                    const res = await fetch(`${BACKEND_URL}/api/api-list/refresh-cache`, {
                                                        method: "POST",
                                                        headers: { Authorization: `Bearer ${token}` }
                                                    });
                                                    const data = await res.json();
                                                    if (data.success) {
                                                        toast.success("API Cache refreshed successfully!");
                                                        fetchApis();
                                                    }
                                                } catch (e) {
                                                    toast.error("Refresh failed");
                                                }
                                            }}
                                            variant="outline"
                                            className="border-[#00ff88]/30 text-[#00ff88] hover:bg-[#00ff88]/10"
                                        >
                                            <RefreshCw className="mr-2 h-3.5 w-3.5" /> Sync Cache
                                        </Button>
                                    </div>
                                </CardHeader>
                                <CardContent className="p-6 space-y-6">
                                    <div className="bg-[#1a1a1a]/40 p-5 rounded-xl border border-white/5">
                                        <div className="flex items-center gap-2 mb-4">
                                            <Plus className="h-4 w-4 text-[#00ff88]" />
                                            <h3 className="text-sm font-bold text-white uppercase tracking-tight">Add Key to Pool</h3>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                                            <div className="md:col-span-3 space-y-2">
                                                <Label className="text-[10px] uppercase font-bold text-white/40">Provider</Label>
                                                <Select value={provider} onValueChange={setProvider}>
                                                    <SelectTrigger className="bg-black/60 border-white/10 h-10">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent className="bg-[#0f0f0f] border-white/10">
                                                        <SelectItem value="google">Google Gemini</SelectItem>
                                                        <SelectItem value="openai">OpenAI</SelectItem>
                                                        <SelectItem value="openrouter">OpenRouter</SelectItem>
                                                        <SelectItem value="groq">Groq</SelectItem>
                                                        <SelectItem value="mistral">Mistral</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>

                                            <div className="md:col-span-6 space-y-2">
                                                <Label className="text-[10px] uppercase font-bold text-white/40">API Secret Key</Label>
                                                <Input 
                                                    placeholder="sk-..." 
                                                    value={newApi} 
                                                    onChange={(e) => setNewApi(e.target.value)}
                                                    className="bg-black/60 border-white/10 focus:border-[#00ff88]/50 h-10 font-mono text-sm"
                                                />
                                            </div>

                                            <Button onClick={addApi} className="md:col-span-3 bg-[#00ff88] hover:bg-[#00cc77] text-black font-bold h-10 shadow-[0_0_15px_rgba(0,255,136,0.3)]">
                                                Add Key
                                            </Button>
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
                                            <div className="relative flex-1 w-full">
                                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/20" />
                                                <Input 
                                                    placeholder="Search keys..."
                                                    value={searchQuery}
                                                    onChange={(e) => {
                                                        setSearchQuery(e.target.value);
                                                        setPage(1);
                                                    }}
                                                    className="pl-10 bg-black/40 border-white/10 h-10"
                                                />
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Select value={providerFilter} onValueChange={(v) => {
                                                    setProviderFilter(v);
                                                    setPage(1);
                                                }}>
                                                    <SelectTrigger className="w-[140px] bg-black/40 border-white/10 h-10">
                                                        <SelectValue placeholder="Provider" />
                                                    </SelectTrigger>
                                                    <SelectContent className="bg-[#0f0f0f] border-white/10">
                                                        <SelectItem value="all">All</SelectItem>
                                                        <SelectItem value="google">Google</SelectItem>
                                                        <SelectItem value="openai">OpenAI</SelectItem>
                                                        <SelectItem value="groq">Groq</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>

                                        <div className="rounded-xl border border-white/5 overflow-hidden bg-black/20">
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="flex items-center gap-3">
                                                    <Button variant="outline" size="sm" onClick={selectAllOnPage} className="border-white/10">
                                                        {apis.length > 0 && apis.every(a => selectedIds.includes(a.id)) ? "Unselect All" : "Select All"}
                                                    </Button>
                                                    <span className="text-[11px] text-white/40">Selected: {selectedIds.length}</span>
                                                </div>
                                                <Button 
                                                    variant="destructive" 
                                                    size="sm" 
                                                    onClick={deleteSelected}
                                                    className="bg-red-600 hover:bg-red-700"
                                                >
                                                    <Trash className="mr-2 h-3.5 w-3.5" /> Delete Selected
                                                </Button>
                                            </div>
                                            <Table>
                                                <TableHeader className="bg-white/5">
                                                    <TableRow className="border-white/5">
                                                        <TableHead className="w-10">
                                                            <input 
                                                                type="checkbox" 
                                                                aria-label="Select all"
                                                                checked={apis.length > 0 && apis.every(a => selectedIds.includes(a.id))}
                                                                onChange={selectAllOnPage}
                                                            />
                                                        </TableHead>
                                                        <TableHead className="text-[10px] uppercase font-bold text-white/40">Provider</TableHead>
                                                        <TableHead className="text-[10px] uppercase font-bold text-white/40">Key</TableHead>
                                                        <TableHead className="text-[10px] uppercase font-bold text-white/40">Load</TableHead>
                                                        <TableHead className="text-[10px] uppercase font-bold text-white/40">Status</TableHead>
                                                        <TableHead className="text-right text-[10px] uppercase font-bold text-white/40">Action</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {loading ? (
                                                        <TableRow><TableCell colSpan={5} className="text-center py-20"><Activity className="h-6 w-6 animate-spin mx-auto text-[#00ff88]" /></TableCell></TableRow>
                                                    ) : apis.map((api) => {
                                                        const isLocked = api.cooldown_until && new Date(api.cooldown_until).getTime() > Date.now();
                                                        const rpmUsage = api.current_rpm || 0;
                                                        const rpmLimit = api.rpm_limit || 10;
                                                        const rpmPercent = Math.min((rpmUsage / rpmLimit) * 100, 100);
                                                        
                                                        return (
                                                            <TableRow key={api.id} className="border-white/5 hover:bg-white/5 transition-all">
                                                                <TableCell className="w-10">
                                                                    <input 
                                                                        type="checkbox" 
                                                                        checked={selectedIds.includes(api.id)}
                                                                        onChange={() => toggleSelect(api.id)}
                                                                    />
                                                                </TableCell>
                                                                <TableCell className="font-bold text-sm capitalize">{api.provider}</TableCell>
                                                                <TableCell className="font-mono text-[11px] text-white/40">{api.api ? `${api.api.substring(0, 12)}...` : '******'}</TableCell>
                                                                <TableCell>
                                                                    <div className="space-y-2 w-32">
                                                                        {/* Today */}
                                                                        <div className="bg-white/5 p-1.5 rounded border border-white/5">
                                                                            <div className="flex justify-between text-[9px] font-bold text-white/60 mb-1">
                                                                                <span>{api.usage_today || 0} Req</span>
                                                                                <span className="text-emerald-400">{(api.usage_tokens_today ? (api.usage_tokens_today / 1000).toFixed(1) : '0')}k Tokens</span>
                                                                            </div>
                                                                            <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                                                                                <div className={cn("h-full transition-all", rpmPercent > 80 ? "bg-red-500" : "bg-[#00ff88]")} style={{ width: `${rpmPercent}%` }} />
                                                                            </div>
                                                                        </div>
                                                                        {/* Model Breakdown */}
                                                                        {api.model_usage && Object.keys(api.model_usage).length > 0 && (
                                                                            <div className="bg-white/5 p-1.5 rounded border border-white/5 space-y-1">
                                                                                <span className="text-[8px] text-white/40 uppercase font-black">Model Usage</span>
                                                                                {Object.entries(api.model_usage).slice(0, 3).map(([model, data]: [string, any]) => (
                                                                                    <div key={model} className="flex justify-between items-center">
                                                                                        <span className="text-[8px] text-white/50 truncate max-w-[80px]">{model.split('/').pop()}</span>
                                                                                        <span className="text-[9px] font-mono text-[#00ff88]">{data.count}</span>
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                        )}
                                                                        {/* Total */}
                                                                        <div className="flex justify-between items-center px-1">
                                                                            <span className="text-[8px] text-white/20 uppercase font-black tracking-widest">Lifetime</span>
                                                                            <span className="text-[10px] font-mono text-white/40">{api.usage_count || 0}</span>
                                                                        </div>
                                                                    </div>
                                                                </TableCell>
                                                                <TableCell>
                                                                    {isLocked ? (
                                                                        <span className="text-orange-400 text-[10px] font-bold flex items-center gap-1"><Clock className="h-3 w-3" /> LOCKED</span>
                                                                    ) : (
                                                                        <span className="text-[#00ff88] text-[10px] font-bold flex items-center gap-1"><Check className="h-3 w-3" /> ACTIVE</span>
                                                                    )}
                                                                </TableCell>
                                                                <TableCell className="text-right">
                                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-white/20 hover:text-red-500" onClick={() => deleteApi(api.id)}><Trash className="h-3.5 w-3.5" /></Button>
                                                                </TableCell>
                                                            </TableRow>
                                                        );
                                                    })}
                                                </TableBody>
                                            </Table>
                                        </div>

                                        <div className="flex items-center justify-between pt-2">
                                            <p className="text-[11px] text-white/40">Showing {apis.length} of {totalItems} keys</p>
                                            <div className="flex items-center gap-2">
                                                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)} className="h-8 w-8 p-0 border-white/5"><ChevronLeft className="h-4 w-4" /></Button>
                                                <span className="text-[11px] font-bold">{page} / {totalPages || 1}</span>
                                                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="h-8 w-8 p-0 border-white/5"><ChevronRight className="h-4 w-4" /></Button>
                                            </div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        <div className="space-y-6">
                            <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10 shadow-2xl h-[calc(100vh-220px)] overflow-hidden flex flex-col">
                                <CardHeader className="bg-white/5 border-b border-white/5 p-4">
                                    <div className="flex items-center justify-between">
                                        <CardTitle className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                                            <History className="h-4 w-4 text-[#00ff88]" /> Rotation Logs
                                        </CardTitle>
                                        <div className="flex items-center gap-1.5 bg-[#00ff88]/10 px-2 py-0.5 rounded-full border border-[#00ff88]/20">
                                            <div className="h-1.5 w-1.5 bg-[#00ff88] rounded-full animate-pulse shadow-[0_0_8px_#00ff88]" />
                                            <span className="text-[9px] text-[#00ff88] font-bold uppercase tracking-tighter">Live</span>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent className="p-0 flex-1 overflow-y-auto custom-scrollbar">
                                    <div className="divide-y divide-white/5">
                                        {rotationLogs.map((log, idx) => (
                                            <div key={idx} className="p-3 hover:bg-white/5 transition-colors space-y-2">
                                                <div className="flex justify-between items-center">
                                                    <span className="text-[10px] text-white/40">{new Date(log.timestamp).toLocaleTimeString()}</span>
                                                    <span className="text-[9px] bg-white/10 text-white/60 px-1.5 py-0.5 rounded uppercase font-bold">{log.provider}</span>
                                                </div>
                                                <p className="text-[11px] font-bold text-white truncate">{log.model}</p>
                                                <div className="flex items-center gap-2">
                                                    <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                                                        <div className="h-full bg-[#00ff88]/40" style={{ width: `${(log.index / log.total) * 100}%` }} />
                                                    </div>
                                                    <span className="text-[9px] text-white/40">{log.index} / {log.total}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="config" className="space-y-6 mt-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <Card className="bg-[#0f0f0f]/80 border border-white/10">
                            <CardHeader>
                                <CardTitle className="text-lg flex items-center gap-2"><Settings2 className="h-5 w-5 text-[#00ff88]" /> Global Provider Models</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label className="text-xs text-white/40">Select Provider</Label>
                                    <Select value={selectedConfigProvider} onValueChange={handleProviderChange}>
                                        <SelectTrigger className="bg-black/60 border-white/10"><SelectValue /></SelectTrigger>
                                        <SelectContent className="bg-[#0f0f0f] border-white/10">
                                            <SelectItem value="google">Google Gemini</SelectItem>
                                            <SelectItem value="openai">OpenAI</SelectItem>
                                            <SelectItem value="groq">Groq</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label className="text-xs text-white/40">Text Model</Label>
                                        <Input className="bg-black/60 border-white/10" value={configValues.text_model} onChange={(e) => setConfigValues({...configValues, text_model: e.target.value})} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-xs text-white/40">Vision Model</Label>
                                        <Input className="bg-black/60 border-white/10" value={configValues.vision_model} onChange={(e) => setConfigValues({...configValues, vision_model: e.target.value})} />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label className="text-xs text-white/40">RPM Limit</Label>
                                        <Input type="number" className="bg-black/60 border-white/10" value={configValues.text_rpm} onChange={(e) => setConfigValues({...configValues, text_rpm: parseInt(e.target.value) || 0})} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-xs text-white/40">RPD Limit</Label>
                                        <Input type="number" className="bg-black/60 border-white/10" value={configValues.text_rpd} onChange={(e) => setConfigValues({...configValues, text_rpd: parseInt(e.target.value) || 0})} />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label className="text-xs text-blue-400">TPM Limit</Label>
                                        <Input type="number" className="bg-black/60 border-blue-500/20" value={configValues.text_tpm} onChange={(e) => setConfigValues({...configValues, text_tpm: parseInt(e.target.value) || 0})} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-xs text-blue-400">TPD Limit</Label>
                                        <Input type="number" className="bg-black/60 border-blue-500/20" value={configValues.text_tpd} onChange={(e) => setConfigValues({...configValues, text_tpd: parseInt(e.target.value) || 0})} />
                                    </div>
                                </div>
                                <Button onClick={saveGlobalConfig} className="w-full bg-[#00ff88] text-black font-bold">Save Provider Config</Button>
                            </CardContent>
                        </Card>

                        <Card className="bg-[#0f0f0f]/80 border border-white/10">
                            <CardHeader>
                                <CardTitle className="text-lg flex items-center gap-2"><BrainCircuit className="h-5 w-5 text-purple-500" /> Semantic Cache Engine</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <div className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-white/5">
                                    <div className="space-y-0.5">
                                        <Label className="text-base">Enable Semantic Cache</Label>
                                        <p className="text-xs text-white/40">Reduce costs by reusing previous AI responses for similar queries.</p>
                                    </div>
                                    <Switch checked={configValues.semantic_cache_enabled} onCheckedChange={(v) => setConfigValues({...configValues, semantic_cache_enabled: v})} />
                                </div>
                                <div className="space-y-4">
                                    <div className="flex justify-between">
                                        <Label className="text-xs text-white/40">Similarity Threshold</Label>
                                        <span className="text-xs font-bold text-purple-400">{(configValues.semantic_cache_threshold || 0.95) * 100}%</span>
                                    </div>
                                    <Input 
                                        type="range" min="0.80" max="1.0" step="0.01" 
                                        value={configValues.semantic_cache_threshold || 0.95} 
                                        onChange={(e) => setConfigValues({...configValues, semantic_cache_threshold: parseFloat(e.target.value)})} 
                                        className="h-2 bg-white/5"
                                    />
                                    <p className="text-[10px] text-white/20 italic text-center">Higher values mean more exact matches are required.</p>
                                </div>
                                <Button variant="outline" className="w-full border-purple-500/30 text-purple-400 hover:bg-purple-500/10">Clear Cache Database</Button>
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    );
}
