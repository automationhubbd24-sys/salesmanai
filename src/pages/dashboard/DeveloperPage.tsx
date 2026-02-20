import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Copy, RefreshCw, Code, Eye, EyeOff, Activity, ArrowRight, Key } from "lucide-react";
import { BACKEND_URL, EXTERNAL_API_BASE } from "@/config";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

export default function DeveloperPage() {
    const [apiKey, setApiKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [showKey, setShowKey] = useState(false);
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
            fetchUsage();
        }
    }, [startDate, endDate]);

    useEffect(() => {
        fetchKey();
        fetchUsage();
    }, []);

    const fetchUsage = async () => {
        try {
            const token = localStorage.getItem("auth_token");
            if (!token) return;

            let url = `${BACKEND_URL}/external/usage`;
            if (startDate && endDate) {
                url += `?startDate=${startDate}&endDate=${endDate}`;
            }

            const res = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            const data = await res.json();
            if (data.stats) setUsageStats(data.stats);
            if (data.summary) setUsageSummary(data.summary);
        } catch (error) {
            console.error("Failed to fetch usage stats", error);
        }
    };

    const fetchKey = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem("auth_token");
            if (!token) return;

            const res = await fetch(`${BACKEND_URL}/external/key`, {
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

            const res = await fetch(`${BACKEND_URL}/external/key/regenerate`, {
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

    return (
        <div className="space-y-6 p-4 md:p-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-primary to-purple-600 bg-clip-text text-transparent">Developer API</h1>
                    <p className="text-muted-foreground">
                        Integrate our powerful AI engine directly into your own applications.
                    </p>
                </div>
            </div>

            <Card className="border-primary/20 bg-card/50 backdrop-blur-sm shadow-xl">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Key className="h-5 w-5 text-primary" />
                        Your API Key
                    </CardTitle>
                    <CardDescription>
                        Use this key to authenticate your requests. Keep it secret!
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex flex-col md:flex-row gap-2">
                        <div className="relative flex-1">
                            <Input 
                                value={apiKey || "No API Key Generated"} 
                                type={showKey ? "text" : "password"} 
                                readOnly 
                                className="pr-10 font-mono bg-background/50 border-primary/20"
                            />
                            <Button 
                                variant="ghost" 
                                size="sm" 
                                className="absolute right-0 top-0 h-full px-3 text-muted-foreground hover:text-foreground"
                                onClick={() => setShowKey(!showKey)}
                            >
                                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                        </div>
                        <Button variant="outline" onClick={copyToClipboard} disabled={!apiKey} className="w-full md:w-auto border-primary/20 hover:bg-primary/10">
                            <Copy className="mr-2 h-4 w-4" /> Copy
                        </Button>
                        <Button onClick={regenerateKey} disabled={loading} className="w-full md:w-auto bg-[#00ff88] text-black font-bold rounded-full hover:bg-[#00f07f] shadow-[0_10px_30px_rgba(0,255,136,0.25)]">
                            <RefreshCw className={`mr-2 h-4 w-4 ${isRegenerating ? 'animate-spin' : ''} text-black`} />
                            {apiKey ? "Regenerate" : "Generate Key"}
                        </Button>
                    </div>
                    
                    <Dialog open={regenDialogOpen} onOpenChange={setRegenDialogOpen}>
                      <DialogContent className="max-w-md bg-[#0f0f0f]/95 border border-white/10 backdrop-blur-md">
                        <DialogHeader>
                          <DialogTitle>Regenerate API Key</DialogTitle>
                          <DialogDescription>
                            Your old key will be revoked immediately. Copy and store the new key securely.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="text-sm text-muted-foreground">
                          This action will require all existing integrations to use the new key. Proceed?
                        </div>
                        <DialogFooter>
                          <Button variant="outline" onClick={() => setRegenDialogOpen(false)}>Cancel</Button>
                          <Button 
                            onClick={doRegenerate} 
                            disabled={isRegenerating}
                            className="bg-[#00ff88] text-black font-bold rounded-full hover:bg-[#00f07f] shadow-[0_10px_30px_rgba(0,255,136,0.25)]"
                          >
                            {isRegenerating ? <RefreshCw className="mr-2 h-4 w-4 animate-spin text-black" /> : null}
                            Confirm Regenerate
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                    <div className="flex flex-col gap-3">
                        <div className="text-sm bg-blue-50/50 dark:bg-blue-900/20 p-4 rounded-xl border border-blue-200/50 dark:border-blue-800/50 text-blue-800 dark:text-blue-300 flex items-center justify-between backdrop-blur-md">
                            <div className="flex items-center gap-2">
                                <Activity className="h-4 w-4" />
                                <span>Check our documentation for Rate Limits, Pricing and Integration details.</span>
                            </div>
                            <Button variant="link" className="text-blue-700 dark:text-blue-400 font-bold p-0 h-auto" asChild>
                                <Link to="/dashboard/api-docs">
                                    View Docs <ArrowRight className="ml-1 h-3 w-3" />
                                </Link>
                            </Button>
                        </div>
                        <div className="text-sm bg-green-50/50 dark:bg-green-900/20 p-4 rounded-xl border border-green-200/50 dark:border-green-800/50 text-green-800 dark:text-green-300 backdrop-blur-md">
                            <strong className="text-green-900 dark:text-green-200">Free Trial:</strong> New accounts get 20 requests for free (one-time) to test our API and platform.
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card className="border-border/50 bg-card/30 backdrop-blur-sm">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-xl">
                        <Code className="h-5 w-5 text-purple-500" /> Integration Guide
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div>
                        <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                            <span className="h-6 w-6 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center">1</span>
                            Base URL
                        </h3>
                        <div className="flex gap-2 items-center mb-4">
                            <Input 
                                value={EXTERNAL_API_BASE} 
                                readOnly 
                                className="font-mono bg-muted/50 border-border/50"
                            />
                            <Button variant="outline" size="sm" onClick={() => {
                                navigator.clipboard.writeText(EXTERNAL_API_BASE);
                                toast.success("Base URL copied");
                            }}>
                                <Copy className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>

                    <div>
                        <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                            <span className="h-6 w-6 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center">2</span>
                            Example Request (cURL)
                        </h3>
                        <div className="flex items-center justify-end gap-2 mb-2">
                            <Button 
                                variant="outline" 
                                size="sm" 
                                className="h-8 text-xs"
                                onClick={() => {
                                    navigator.clipboard.writeText(`${EXTERNAL_API_BASE}/chat/completions`);
                                    toast.success("Endpoint URL copied");
                                }}
                            >
                                <Copy className="h-3.5 w-3.5 mr-1" /> Copy URL
                            </Button>
                            <Button 
                                variant="outline" 
                                size="sm" 
                                className="h-8 text-xs"
                                onClick={() => {
                                    navigator.clipboard.writeText(`curl -X POST ${EXTERNAL_API_BASE}/chat/completions \\\n  -H \"Content-Type: application/json\" \\\n  -H \"Authorization: Bearer ${apiKey || 'YOUR_API_KEY'}\" \\\n  -d '{\n    \"model\": \"salesmanchatbot-pro\",\n    \"messages\": [\n      {\"role\": \"user\", \"content\": \"Hello, how are you?\"}\n    ]\n  }'`);
                                    toast.success("cURL command copied");
                                }}
                            >
                                <Copy className="h-3.5 w-3.5 mr-1" /> Copy cURL
                            </Button>
                        </div>
                        <div>
                            <pre className="bg-slate-950 text-slate-50 p-6 rounded-xl overflow-x-auto text-sm font-mono border border-slate-800 shadow-2xl">
{`curl -X POST ${EXTERNAL_API_BASE}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKey || 'YOUR_API_KEY'}" \\
  -d '{
    "model": "salesmanchatbot-pro",
    "messages": [
      {"role": "user", "content": "Hello, how are you?"}
    ]
  }'`}
                            </pre>
                        </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-6 pt-4 border-t border-border/50">
                        <div>
                            <h3 className="text-lg font-semibold mb-3">n8n Setup (OpenAI Node)</h3>
                            <div className="space-y-3 text-sm text-muted-foreground">
                                <p>Use the <strong>OpenAI</strong> node with these settings:</p>
                                <ul className="list-disc list-inside space-y-2 ml-2">
                                    <li className="flex items-center justify-between">
                                        <span>Resource: <code className="text-primary font-bold">Chat</code></span>
                                    </li>
                                    <li className="flex items-center justify-between">
                                        <span>Operation: <code className="text-primary font-bold">Message</code></span>
                                    </li>
                                    <li className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                        <div className="flex-1 max-w-full">
                                            <span>Base URL:</span>{" "}
                                            <code className="text-primary font-bold break-all">{EXTERNAL_API_BASE}</code>
                                        </div>
                                        <div>
                                            <Button variant="outline" size="sm" className="h-7" onClick={() => {
                                                navigator.clipboard.writeText(EXTERNAL_API_BASE);
                                                toast.success("n8n Base URL copied");
                                            }}>
                                                <Copy className="h-3 w-3 mr-1" /> Copy
                                            </Button>
                                        </div>
                                    </li>
                                    <li className="flex items-center justify-between">
                                        <span>Model: <code className="text-primary font-bold">salesmanchatbot-pro</code></span>
                                    </li>
                                </ul>
                                <p className="text-xs italic mt-2 text-amber-600 dark:text-amber-400">Important: Paste the full Base URL in the OpenAI node "Base URL" field.</p>
                            </div>
                        </div>
                        <div>
                            <h3 className="text-lg font-semibold mb-3">Capabilities</h3>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="p-2 rounded-lg bg-primary/5 border border-primary/10 flex items-center gap-2">
                                    <div className="h-1.5 w-1.5 rounded-full bg-primary" /> Text Generation
                                </div>
                                <div className="p-2 rounded-lg bg-primary/5 border border-primary/10 flex items-center gap-2">
                                    <div className="h-1.5 w-1.5 rounded-full bg-primary" /> Vision (Images)
                                </div>
                                <div className="p-2 rounded-lg bg-primary/5 border border-primary/10 flex items-center gap-2">
                                    <div className="h-1.5 w-1.5 rounded-full bg-primary" /> Audio Analysis
                                </div>
                                <div className="p-2 rounded-lg bg-primary/5 border border-primary/10 flex items-center gap-2">
                                    <div className="h-1.5 w-1.5 rounded-full bg-primary" /> Tool Calling
                                </div>
                            </div>
                            <div className="mt-4 text-sm">
                                <h4 className="font-semibold mb-2">Pricing</h4>
                                <div className="rounded-lg border p-3 bg-muted/30">
                                    <div className="flex items-center justify-between">
                                        <span className="font-mono">salesmanchatbot-pro</span>
                                        <span className="font-bold text-primary">৳250 / 1M Tokens</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="border-primary/10 bg-card/50">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground uppercase">Total Cost</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">৳{usageSummary.total_cost?.toFixed(4)}</div>
                        <p className="text-xs text-muted-foreground mt-1">Lifetime API spend</p>
                    </CardContent>
                </Card>
                <Card className="border-primary/10 bg-card/50">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground uppercase">Today's Cost</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">৳{usageSummary.today_cost?.toFixed(4)}</div>
                        <p className="text-xs text-muted-foreground mt-1">Spend since midnight</p>
                    </CardContent>
                </Card>
                <Card className="border-primary/10 bg-card/50">
                    <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                        <CardTitle className="text-sm font-medium text-muted-foreground uppercase">Range Cost</CardTitle>
                        <Button 
                            variant="outline" 
                            size="sm" 
                            className="h-6 text-[10px] px-2 border-primary/20 hover:bg-primary/10"
                            onClick={setYesterday}
                        >
                            Yesterday
                        </Button>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">৳{usageSummary.range_cost?.toFixed(4)}</div>
                        <div className="text-xs text-muted-foreground mt-1">Tokens: {formatCompact(usageSummary.range_tokens)}</div>
                        <div className="text-xs text-muted-foreground">Requests: {usageSummary.range_requests?.toLocaleString?.()}</div>
                        <div className="flex flex-col gap-2 mt-2">
                            <div className="flex gap-2 items-center">
                                <div className="grid flex-1">
                                    <label className="text-[10px] text-muted-foreground mb-1 ml-1">From</label>
                                    <Input 
                                        type="date" 
                                        className="h-8 text-xs p-2 bg-background/50 border-primary/10 focus:border-primary/30" 
                                        value={startDate} 
                                        onChange={(e) => setStartDate(e.target.value)} 
                                    />
                                </div>
                                <div className="grid flex-1">
                                    <label className="text-[10px] text-muted-foreground mb-1 ml-1">To</label>
                                    <Input 
                                        type="date" 
                                        className="h-8 text-xs p-2 bg-background/50 border-primary/10 focus:border-primary/30" 
                                        value={endDate} 
                                        onChange={(e) => setEndDate(e.target.value)} 
                                    />
                                </div>
                                <div className="pt-5">
                                    <Button size="sm" className="h-8 w-8 p-0" onClick={fetchUsage}>
                                        <RefreshCw className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="border-primary/10 bg-card/50">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground uppercase">Total Tokens</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{formatCompact(usageSummary.total_tokens)}</div>
                        <p className="text-xs text-muted-foreground mt-1">Lifetime tokens</p>
                    </CardContent>
                </Card>
                <Card className="border-primary/10 bg-card/50">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground uppercase">Today's Requests</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{usageSummary.today_requests?.toLocaleString?.()}</div>
                        <p className="text-xs text-muted-foreground mt-1">Since midnight</p>
                        <div className="text-xs text-muted-foreground mt-1">Tokens: {formatCompact(usageSummary.today_tokens)}</div>
                    </CardContent>
                </Card>
                <Card className="border-primary/10 bg-card/50">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground uppercase">Yesterday</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-sm">Cost: ৳{usageSummary.yesterday_cost?.toFixed(4)}</div>
                        <div className="text-sm">Tokens: {formatCompact(usageSummary.yesterday_tokens)}</div>
                        <div className="text-sm">Requests: {usageSummary.yesterday_requests?.toLocaleString?.()}</div>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Activity className="h-5 w-5" />
                        Usage Statistics
                    </CardTitle>
                    <CardDescription>
                        Recent API usage by model.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border overflow-hidden">
                        <div className="max-h-[400px] overflow-y-auto relative scrollbar-thin scrollbar-thumb-primary/10 scrollbar-track-transparent">
                            <Table>
                                <TableHeader className="sticky top-0 bg-card z-10 shadow-sm">
                                    <TableRow>
                                        <TableHead className="bg-card">Date</TableHead>
                                        <TableHead className="bg-card">Model</TableHead>
                                        <TableHead className="text-right bg-card">Tokens</TableHead>
                                        <TableHead className="text-right bg-card">Cost (BDT)</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {usageStats.length > 0 ? (
                                        usageStats.map((stat, i) => (
                                            <TableRow key={i} className="hover:bg-muted/50 transition-colors">
                                                <TableCell className="py-3">{new Date(stat.created_at).toLocaleString()}</TableCell>
                                                <TableCell className="py-3">
                                                    <span className="inline-flex items-center rounded-full px-2 py-1 text-xs font-medium bg-primary/5 text-primary border border-primary/10 font-mono">
                                                        {stat.model}
                                                    </span>
                                                </TableCell>
                                    <TableCell className="text-right py-3 font-mono font-medium">{formatCompact(stat.tokens)}</TableCell>
                                                <TableCell className="text-right py-3 font-mono font-medium text-primary">৳{Number(stat.cost || 0).toFixed(4)}</TableCell>
                                            </TableRow>
                                        ))
                                    ) : (
                                        <TableRow>
                                            <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                                                No usage data available.
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
    );
}
