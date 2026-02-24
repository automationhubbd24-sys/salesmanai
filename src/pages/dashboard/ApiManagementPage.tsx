import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trash, Plus, Check } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { BACKEND_URL } from "@/config";

interface ApiItem {
    id: number;
    provider: string;
    api: string;
    status?: string;
}

interface GlobalConfig {
    provider: string;
    text_model: string;
    vision_model: string;
    voice_model: string;
}

export default function ApiManagementPage() {
    // FINAL UI CLEANUP: No individual model selection allowed during key addition.
    const [apis, setApis] = useState<ApiItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [newApi, setNewApi] = useState("");
    const [provider, setProvider] = useState("google");
    const [globalConfigs, setGlobalConfigs] = useState<GlobalConfig[]>([]);
    const [selectedConfigProvider, setSelectedConfigProvider] = useState("google");
    const [configValues, setConfigValues] = useState<GlobalConfig>({
        provider: "google",
        text_model: "gemini-2.0-flash",
        vision_model: "gemini-2.0-flash",
        voice_model: "gemini-2.0-flash-lite"
    });

    useEffect(() => {
        fetchApis();
        fetchGlobalConfigs();
    }, []);

    const fetchApis = async () => {
        setLoading(true);
        try {
            let token = localStorage.getItem("auth_token");
            if (!token) return;

            const res = await fetch(`${BACKEND_URL}/api/api-list`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const body = await res.json();
            if (res.ok && body.success) {
                setApis(body.items || []);
            }
        } catch (error: any) {
            toast.error("Failed to fetch API list");
        } finally {
            setLoading(false);
        }
    };

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
                text_model: "gemini-2.0-flash",
                vision_model: "gemini-2.0-flash",
                voice_model: "gemini-2.0-flash-lite"
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
                fetchApis();
            }
        } catch (error) {
            toast.error("Failed to delete");
        }
    };

    return (
        <div className="container mx-auto p-6 space-y-6">
            <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10 shadow-[0_18px_40px_rgba(0,0,0,0.35)]">
                <CardHeader>
                    <CardTitle className="text-2xl font-bold bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
                        API Engine Management
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    {/* Add Key Section - ONLY PROVIDER AND KEY */}
                    <div className="bg-white/5 p-4 rounded-xl border border-white/10">
                        <h3 className="text-sm font-bold text-[#00ff88] mb-4 flex items-center">
                            <Plus className="mr-2 h-4 w-4" /> Add New API Key to Rotation Pool
                        </h3>
                        <div className="flex flex-wrap gap-4 items-end">
                            <div className="w-[180px] space-y-2">
                                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Provider</Label>
                                <Select value={provider} onValueChange={setProvider}>
                                    <SelectTrigger className="w-full bg-black/40 border-white/10">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="google">Google Gemini</SelectItem>
                                        <SelectItem value="openai">OpenAI</SelectItem>
                                        <SelectItem value="openrouter">OpenRouter</SelectItem>
                                        <SelectItem value="groq">Groq</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="flex-1 space-y-2">
                                <Label className="text-xs uppercase tracking-wider text-muted-foreground">API Key</Label>
                                <Input 
                                    placeholder="Paste your API key here..." 
                                    value={newApi} 
                                    onChange={(e) => setNewApi(e.target.value)}
                                    className="bg-black/40 border-white/10 focus:border-[#00ff88]/50 transition-all"
                                />
                            </div>

                            <Button onClick={addApi} className="bg-[#00ff88] hover:bg-[#00cc77] text-black font-bold px-8 h-10">
                                <Plus className="mr-2 h-4 w-4" /> Add Key
                            </Button>
                        </div>
                    </div>

                    {/* Global Models Configuration Card */}
                    <div className="bg-white/5 p-6 rounded-xl border border-white/10 space-y-6">
                        <div className="flex items-center justify-between border-b border-white/5 pb-4">
                            <div>
                                <h3 className="text-lg font-bold text-[#00ff88]">Global Provider Models Configuration</h3>
                                <p className="text-xs text-muted-foreground">Define models for Text, Vision, and Voice for each provider.</p>
                            </div>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-end">
                            <div className="space-y-2">
                                <Label className="text-xs uppercase text-muted-foreground">Select Provider</Label>
                                <Select value={selectedConfigProvider} onValueChange={handleProviderChange}>
                                    <SelectTrigger className="bg-black/40 border-white/10">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="google">Google Gemini</SelectItem>
                                        <SelectItem value="openai">OpenAI</SelectItem>
                                        <SelectItem value="openrouter">OpenRouter</SelectItem>
                                        <SelectItem value="groq">Groq</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label className="text-xs uppercase text-muted-foreground">Text Model</Label>
                                <Input 
                                    className="bg-black/40 border-white/10 text-xs"
                                    value={configValues.text_model}
                                    onChange={(e) => setConfigValues({...configValues, text_model: e.target.value})}
                                    placeholder="e.g. gemini-2.0-flash"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label className="text-xs uppercase text-muted-foreground">Vision Model</Label>
                                <Input 
                                    className="bg-black/40 border-white/10 text-xs"
                                    value={configValues.vision_model}
                                    onChange={(e) => setConfigValues({...configValues, vision_model: e.target.value})}
                                    placeholder="e.g. gemini-2.0-flash"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label className="text-xs uppercase text-muted-foreground">Voice Model</Label>
                                <Input 
                                    className="bg-black/40 border-white/10 text-xs"
                                    value={configValues.voice_model}
                                    onChange={(e) => setConfigValues({...configValues, voice_model: e.target.value})}
                                    placeholder="e.g. gemini-2.0-flash-lite"
                                />
                            </div>
                        </div>

                        <div className="flex justify-end pt-2">
                            <Button onClick={saveGlobalConfig} className="bg-[#00ff88]/10 hover:bg-[#00ff88]/20 text-[#00ff88] border border-[#00ff88]/30 font-bold px-10">
                                <Check className="mr-2 h-4 w-4" /> Save Configuration
                            </Button>
                        </div>
                    </div>

                    {/* Rotation Pool List */}
                    <div className="rounded-xl border border-white/10 overflow-hidden bg-black/20">
                        <Table>
                            <TableHeader className="bg-white/5">
                                <TableRow className="border-white/10 hover:bg-transparent">
                                    <TableHead className="text-white/60">Provider</TableHead>
                                    <TableHead className="text-white/60">Key (Masked)</TableHead>
                                    <TableHead className="text-white/60">Status</TableHead>
                                    <TableHead className="text-right text-white/60">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    <TableRow><TableCell colSpan={4} className="text-center py-10 text-muted-foreground">Loading...</TableCell></TableRow>
                                ) : apis.length === 0 ? (
                                    <TableRow><TableCell colSpan={4} className="text-center py-10 text-muted-foreground">No API keys added yet.</TableCell></TableRow>
                                ) : (
                                    apis.map((api) => (
                                        <TableRow key={api.id} className="border-white/5 hover:bg-white/5 transition-colors">
                                            <TableCell className="capitalize font-bold">{api.provider}</TableCell>
                                            <TableCell className="font-mono text-xs text-white/40">
                                                {api.api ? `${api.api.substring(0, 8)}...${api.api.substring(api.api.length - 4)}` : '******'}
                                            </TableCell>
                                            <TableCell>
                                                {api.status === "active" ? (
                                                    <div className="flex items-center gap-2 text-green-400 text-[10px] uppercase font-bold tracking-widest">
                                                        <div className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" /> Active
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-2 text-red-400 text-[10px] uppercase font-bold tracking-widest">
                                                        <div className="h-1.5 w-1.5 rounded-full bg-red-400" /> Inactive
                                                    </div>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button variant="ghost" size="icon" className="h-8 w-8 text-red-400/40 hover:text-red-400" onClick={() => deleteApi(api.id)}>
                                                    <Trash className="h-4 w-4" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
