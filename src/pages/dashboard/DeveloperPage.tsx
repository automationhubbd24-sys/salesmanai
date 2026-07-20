import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Activity, Copy, Eye, EyeOff, Key, Layers, Plus, Power, RefreshCw, Search, Sparkles, Trash2 } from "lucide-react";
import { BACKEND_URL, EXTERNAL_API_BASE } from "@/config";

const token = () => localStorage.getItem("auth_token") || "";
const authHeaders = () => ({ Authorization: `Bearer ${token()}` });
const apiBase = BACKEND_URL.endsWith("/api") ? BACKEND_URL.replace(/\/api$/, "") : BACKEND_URL;

type ApiKeyRow = {
    id: string;
    name: string;
    key_prefix: string;
    status: string;
    created_at: string;
    last_used_at?: string;
};

type ModelRow = {
    id: string;
    name: string;
    description?: string;
    modalities?: { input?: string[]; output?: string[] };
    pricing?: { prompt?: number; completion?: number; cached_prompt?: number };
    context_length?: number;
    released?: string;
    upstream_model?: string;
};

export default function DeveloperPage() {
    const [apiKeys, setApiKeys] = useState<ApiKeyRow[]>([]);
    const [models, setModels] = useState<ModelRow[]>([]);
    const [usageStats, setUsageStats] = useState<any[]>([]);
    const [summary, setSummary] = useState<any>({ total_cost: 0, total_tokens: 0, total_requests: 0, today_cost: 0, today_tokens: 0, today_requests: 0 });
    const [loading, setLoading] = useState(true);
    const [newKey, setNewKey] = useState<string | null>(null);
    const [showNewKey, setShowNewKey] = useState(false);
    const [keyName, setKeyName] = useState("Production key");
    const [query, setQuery] = useState("");
    const [selectedModel, setSelectedModel] = useState<ModelRow | null>(null);

    const filteredModels = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return models;
        return models.filter(model => `${model.id} ${model.name} ${model.description || ""}`.toLowerCase().includes(q));
    }, [models, query]);

    useEffect(() => {
        loadAll();
    }, []);

    const loadAll = async () => {
        setLoading(true);
        await Promise.all([fetchModels(), fetchKeys(), fetchUsage()]);
        setLoading(false);
    };

    const fetchModels = async () => {
        try {
            const res = await fetch(`${apiBase}/v1/models`, { headers: authHeaders() });
            const data = await res.json();
            setModels(data.data || []);
        } catch (error) {
            console.error(error);
        }
    };

    const fetchKeys = async () => {
        try {
            const res = await fetch(`${apiBase}/api/external/keys`, { headers: authHeaders() });
            const data = await res.json();
            setApiKeys(data.keys || []);
        } catch (error) {
            console.error(error);
        }
    };

    const fetchUsage = async () => {
        try {
            const res = await fetch(`${apiBase}/api/external/usage?page=1&limit=20`, { headers: authHeaders() });
            const data = await res.json();
            setUsageStats(data.stats || []);
            setSummary(data.summary || {});
        } catch (error) {
            console.error(error);
        }
    };

    const createKey = async () => {
        try {
            const res = await fetch(`${apiBase}/api/external/keys`, {
                method: "POST",
                headers: { ...authHeaders(), "Content-Type": "application/json" },
                body: JSON.stringify({ name: keyName })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to create API key");
            setNewKey(data.api_key);
            toast.success("API key created");
            fetchKeys();
        } catch (error: any) {
            toast.error(error.message || "Failed to create API key");
        }
    };

    const toggleKey = async (id: string) => {
        try {
            const res = await fetch(`${apiBase}/api/external/keys/${id}/toggle`, { method: "PATCH", headers: authHeaders() });
            if (!res.ok) throw new Error("Failed to update key");
            toast.success("API key status updated");
            fetchKeys();
        } catch (error: any) {
            toast.error(error.message);
        }
    };

    const deleteKey = async (id: string) => {
        if (!confirm("Delete this API key permanently?")) return;
        try {
            const res = await fetch(`${apiBase}/api/external/keys/${id}`, { method: "DELETE", headers: authHeaders() });
            if (!res.ok) throw new Error("Failed to delete key");
            toast.success("API key deleted");
            fetchKeys();
        } catch (error: any) {
            toast.error(error.message);
        }
    };

    const copy = (text: string, label = "Copied") => {
        navigator.clipboard.writeText(text);
        toast.success(label);
    };

    const formatNum = (value: any) => Number(value || 0).toLocaleString();
    const formatMoney = (value: any) => `$${Number(value || 0).toFixed(6)}`;

    return (
        <div className="min-h-screen -m-4 md:-m-6 p-4 md:p-8 bg-[#050507] text-white space-y-6 overflow-x-hidden">
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute top-[-120px] left-[10%] h-80 w-80 rounded-full bg-purple-600/20 blur-[140px]" />
                <div className="absolute top-[140px] right-[-80px] h-96 w-96 rounded-full bg-primary/10 blur-[160px]" />
            </div>

            <div className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="space-y-3">
                    <Badge className="w-fit bg-white/10 text-primary border-white/10">SalesmanChatbot Cloud API</Badge>
                    <h1 className="text-3xl md:text-5xl font-black tracking-tight">Developer API</h1>
                    <p className="max-w-3xl text-slate-400 text-sm md:text-base">
                        One OpenAI-compatible gateway powered by our own AIStudioToProxy and codex-proxy VPS pool, with cache-aware token billing.
                    </p>
                </div>
                <Button onClick={loadAll} disabled={loading} className="bg-white text-black hover:bg-slate-200 rounded-xl font-bold">
                    <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
                </Button>
            </div>

            <div className="relative z-10 grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="bg-white/[0.04] border-white/10 rounded-3xl">
                    <CardHeader>
                        <CardTitle className="text-white flex items-center gap-2"><Activity className="h-5 w-5 text-primary" /> Requests</CardTitle>
                        <CardDescription>Total API calls</CardDescription>
                    </CardHeader>
                    <CardContent className="text-3xl font-black text-white">{formatNum(summary.total_requests)}</CardContent>
                </Card>
                <Card className="bg-white/[0.04] border-white/10 rounded-3xl">
                    <CardHeader>
                        <CardTitle className="text-white flex items-center gap-2"><Layers className="h-5 w-5 text-primary" /> Tokens</CardTitle>
                        <CardDescription>Prompt + completion + cached</CardDescription>
                    </CardHeader>
                    <CardContent className="text-3xl font-black text-white">{formatNum(summary.total_tokens)}</CardContent>
                </Card>
                <Card className="bg-white/[0.04] border-white/10 rounded-3xl">
                    <CardHeader>
                        <CardTitle className="text-white flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" /> Cost</CardTitle>
                        <CardDescription>Calculated from model pricing</CardDescription>
                    </CardHeader>
                    <CardContent className="text-3xl font-black text-white">{formatMoney(summary.total_cost)}</CardContent>
                </Card>
            </div>

            <div className="relative z-10 grid grid-cols-1 xl:grid-cols-5 gap-6">
                <Card className="xl:col-span-2 bg-[#0e0e12] border-white/10 rounded-3xl overflow-hidden">
                    <CardHeader>
                        <CardTitle className="text-white flex items-center gap-2"><Key className="h-5 w-5 text-primary" /> API Keys</CardTitle>
                        <CardDescription>Create, disable, delete and monitor user API keys.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex gap-2">
                            <Input value={keyName} onChange={e => setKeyName(e.target.value)} className="bg-black/40 border-white/10 text-white rounded-xl" placeholder="Key name" />
                            <Button onClick={createKey} className="bg-primary text-black hover:bg-primary/90 rounded-xl font-bold"><Plus className="h-4 w-4 mr-2" /> Create</Button>
                        </div>

                        {newKey && (
                            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 space-y-3">
                                <p className="text-xs text-primary font-bold">Copy now. This full key will not be shown again.</p>
                                <div className="flex gap-2">
                                    <Input readOnly type={showNewKey ? "text" : "password"} value={newKey} className="font-mono bg-black/40 border-white/10 text-white rounded-xl" />
                                    <Button variant="outline" onClick={() => setShowNewKey(!showNewKey)} className="border-white/10 bg-white/5 text-white rounded-xl">{showNewKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>
                                    <Button onClick={() => copy(newKey, "API key copied")} className="bg-white text-black rounded-xl"><Copy className="h-4 w-4" /></Button>
                                </div>
                            </div>
                        )}

                        <div className="rounded-2xl border border-white/10 overflow-hidden">
                            <Table>
                                <TableHeader>
                                    <TableRow className="border-white/10 hover:bg-transparent">
                                        <TableHead className="text-slate-400">Name</TableHead>
                                        <TableHead className="text-slate-400">Key</TableHead>
                                        <TableHead className="text-slate-400">Status</TableHead>
                                        <TableHead className="text-right text-slate-400">Action</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {apiKeys.map(key => (
                                        <TableRow key={key.id} className="border-white/10 hover:bg-white/[0.02]">
                                            <TableCell className="text-white text-xs">{key.name}</TableCell>
                                            <TableCell className="font-mono text-primary text-xs">{key.key_prefix}</TableCell>
                                            <TableCell><Badge className={key.status === "active" ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}>{key.status}</Badge></TableCell>
                                            <TableCell className="text-right space-x-1">
                                                <Button size="icon" variant="ghost" onClick={() => toggleKey(key.id)} className="text-slate-400 hover:text-primary"><Power className="h-4 w-4" /></Button>
                                                <Button size="icon" variant="ghost" onClick={() => deleteKey(key.id)} className="text-slate-400 hover:text-red-400"><Trash2 className="h-4 w-4" /></Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>

                <Card className="xl:col-span-3 bg-[#0e0e12] border-white/10 rounded-3xl overflow-hidden">
                    <CardHeader>
                        <CardTitle className="text-white">Models</CardTitle>
                        <CardDescription>Admin-managed model catalog. Click a model to view modalities, cache pricing, context and upstream info.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                            <Input value={query} onChange={e => setQuery(e.target.value)} className="pl-9 bg-black/40 border-white/10 text-white rounded-xl" placeholder="Search models" />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[520px] overflow-y-auto pr-1">
                            {filteredModels.map(model => (
                                <button key={model.id} onClick={() => setSelectedModel(model)} className="text-left rounded-2xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-primary/30 p-4 transition-all">
                                    <div className="flex items-start justify-between gap-2">
                                        <div>
                                            <h3 className="text-white font-bold text-sm">{model.name}</h3>
                                            <p className="text-primary font-mono text-xs mt-1">{model.id}</p>
                                        </div>
                                        <Badge className="bg-white/10 text-slate-300">{formatNum(model.context_length)}</Badge>
                                    </div>
                                    <p className="text-slate-400 text-xs mt-3 line-clamp-2">{model.description}</p>
                                    <div className="flex flex-wrap gap-1 mt-3">
                                        {(model.modalities?.input || []).map(item => <Badge key={item} className="bg-blue-500/10 text-blue-300">in {item}</Badge>)}
                                        {(model.modalities?.output || []).map(item => <Badge key={item} className="bg-purple-500/10 text-purple-300">out {item}</Badge>)}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="relative z-10 grid grid-cols-1 xl:grid-cols-2 gap-6">
                <Card className="bg-[#0e0e12] border-white/10 rounded-3xl">
                    <CardHeader>
                        <CardTitle className="text-white">OpenAI Compatible Endpoint</CardTitle>
                        <CardDescription>Use this base URL in OpenAI SDK, n8n, Flowise or any compatible client.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="rounded-2xl bg-black/50 border border-white/10 p-4 flex items-center justify-between gap-3">
                            <code className="text-primary text-xs md:text-sm break-all">{EXTERNAL_API_BASE}/v1</code>
                            <Button size="icon" onClick={() => copy(`${EXTERNAL_API_BASE}/v1`, "Base URL copied")} className="bg-white text-black rounded-xl"><Copy className="h-4 w-4" /></Button>
                        </div>
                        <pre className="rounded-2xl bg-black/60 border border-white/10 p-4 text-xs text-slate-300 overflow-x-auto">{`curl ${EXTERNAL_API_BASE}/v1/chat/completions \\
  -H "Authorization: Bearer sk-scb-..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "your-admin-added-model-id",
    "messages": [{"role":"user","content":"Hello"}]
  }'`}</pre>
                    </CardContent>
                </Card>

                <Card className="bg-[#0e0e12] border-white/10 rounded-3xl">
                    <CardHeader>
                        <CardTitle className="text-white">Usage</CardTitle>
                        <CardDescription>Token, cached token and pricing history.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="rounded-2xl border border-white/10 overflow-hidden max-h-[360px] overflow-y-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="border-white/10 hover:bg-transparent">
                                        <TableHead className="text-slate-400">Model</TableHead>
                                        <TableHead className="text-right text-slate-400">Tokens</TableHead>
                                        <TableHead className="text-right text-slate-400">Cached</TableHead>
                                        <TableHead className="text-right text-slate-400">Cost</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {usageStats.map(row => (
                                        <TableRow key={row.id} className="border-white/10 hover:bg-white/[0.02]">
                                            <TableCell className="text-white font-mono text-xs">{row.model}</TableCell>
                                            <TableCell className="text-right text-slate-300 text-xs">{formatNum(row.total_tokens)}</TableCell>
                                            <TableCell className="text-right text-slate-300 text-xs">{formatNum(row.cached_tokens)}</TableCell>
                                            <TableCell className="text-right text-primary text-xs font-bold">{formatMoney(row.cost)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Dialog open={!!selectedModel} onOpenChange={open => !open && setSelectedModel(null)}>
                <DialogContent className="bg-[#0e0e12] border-white/10 text-white rounded-3xl max-w-2xl">
                    <DialogHeader>
                        <DialogTitle className="text-2xl">{selectedModel?.name}</DialogTitle>
                        <DialogDescription className="font-mono text-primary">{selectedModel?.id}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-5">
                        <p className="text-slate-300 text-sm">{selectedModel?.description}</p>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-4"><Label>Context</Label><p className="text-xl font-black mt-1">{formatNum(selectedModel?.context_length)}</p></div>
                            <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-4"><Label>Released</Label><p className="text-xl font-black mt-1">{selectedModel?.released || "-"}</p></div>
                            <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-4"><Label>Input / 1M</Label><p className="text-xl font-black mt-1">{formatMoney(selectedModel?.pricing?.prompt)}</p></div>
                            <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-4"><Label>Output / 1M</Label><p className="text-xl font-black mt-1">{formatMoney(selectedModel?.pricing?.completion)}</p></div>
                            <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-4"><Label>Cached / 1M</Label><p className="text-xl font-black mt-1">{formatMoney(selectedModel?.pricing?.cached_prompt)}</p></div>
                            <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-4"><Label>Upstream</Label><p className="text-xs font-mono mt-2 text-primary break-all">{selectedModel?.upstream_model}</p></div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button onClick={() => copy(selectedModel?.id || "", "Model copied")} className="bg-primary text-black rounded-xl font-bold"><Copy className="h-4 w-4 mr-2" /> Copy model ID</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
