import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trash, Plus, Check, X } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { BACKEND_URL } from "@/config";

interface ApiItem {
    id: number;
    provider: string;
    api: string;
    status?: string;
    text_model: string;
    vision_model: string;
    voice_model: string;
}

export default function ApiManagementPage() {
    const [apis, setApis] = useState<ApiItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [newApi, setNewApi] = useState("");
    const [provider, setProvider] = useState("gemini");
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editValues, setEditValues] = useState({
        text_model: "",
        vision_model: "",
        voice_model: ""
    });

    useEffect(() => {
        fetchApis();
    }, []);

    const fetchApis = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem("auth_token");
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

    const addApi = async () => {
        if (!newApi) return;
        try {
            const token = localStorage.getItem("auth_token");
            if (!token) return;

            const res = await fetch(`${BACKEND_URL}/api/api-list`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    provider,
                    api: newApi
                })
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

    const updateApi = async (id: number) => {
        try {
            const token = localStorage.getItem("auth_token");
            if (!token) return;

            const res = await fetch(`${BACKEND_URL}/api/api-list/${id}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify(editValues)
            });
            const body = await res.json();
            if (res.ok && body.success) {
                toast.success("API Models updated");
                setEditingId(null);
                fetchApis();
            }
        } catch (error: any) {
            toast.error("Failed to update models");
        }
    };

    const startEditing = (api: ApiItem) => {
        setEditingId(api.id);
        setEditValues({
            text_model: api.text_model,
            vision_model: api.vision_model,
            voice_model: api.voice_model
        });
    };

    const deleteApi = async (id: number) => {
        if (!confirm("Are you sure?")) return;
        try {
            const token = localStorage.getItem("auth_token");
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
                    <div className="flex flex-wrap gap-4 items-end bg-white/5 p-4 rounded-xl border border-white/10">
                        <div className="space-y-2">
                            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Provider</Label>
                            <Select value={provider} onValueChange={setProvider}>
                                <SelectTrigger className="w-[180px] bg-black/40 border-white/10">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="gemini">Gemini (Google)</SelectItem>
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

                        <Button onClick={addApi} className="bg-[#00ff88] hover:bg-[#00cc77] text-black font-bold px-8">
                            <Plus className="mr-2 h-4 w-4" /> Add Key
                        </Button>
                    </div>

                    <div className="rounded-xl border border-white/10 overflow-hidden bg-black/20">
                        <Table>
                            <TableHeader className="bg-white/5">
                                <TableRow className="border-white/10 hover:bg-transparent">
                                    <TableHead className="text-white/60">Provider</TableHead>
                                    <TableHead className="text-white/60">Text Model</TableHead>
                                    <TableHead className="text-white/60">Vision Model</TableHead>
                                    <TableHead className="text-white/60">Voice Model</TableHead>
                                    <TableHead className="text-white/60">Key (Masked)</TableHead>
                                    <TableHead className="text-right text-white/60">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">Loading...</TableCell></TableRow>
                                ) : apis.length === 0 ? (
                                    <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">No API keys added yet.</TableCell></TableRow>
                                ) : (
                                    apis.map((api) => (
                                        <TableRow key={api.id} className="border-white/5 hover:bg-white/5 transition-colors">
                                            <TableCell className="font-bold capitalize">{api.provider}</TableCell>
                                            
                                            {editingId === api.id ? (
                                                <>
                                                    <TableCell><Input size={1} className="h-8 bg-black/60 border-white/20 text-xs" value={editValues.text_model} onChange={e => setEditValues({...editValues, text_model: e.target.value})} /></TableCell>
                                                    <TableCell><Input size={1} className="h-8 bg-black/60 border-white/20 text-xs" value={editValues.vision_model} onChange={e => setEditValues({...editValues, vision_model: e.target.value})} /></TableCell>
                                                    <TableCell><Input size={1} className="h-8 bg-black/60 border-white/20 text-xs" value={editValues.voice_model} onChange={e => setEditValues({...editValues, voice_model: e.target.value})} /></TableCell>
                                                </>
                                            ) : (
                                                <>
                                                    <TableCell className="text-xs text-white/80 font-mono">{api.text_model}</TableCell>
                                                    <TableCell className="text-xs text-white/80 font-mono">{api.vision_model}</TableCell>
                                                    <TableCell className="text-xs text-white/80 font-mono">{api.voice_model}</TableCell>
                                                </>
                                            )}

                                            <TableCell className="font-mono text-[10px] text-white/40">
                                                {api.api ? `${api.api.substring(0, 6)}...${api.api.substring(api.api.length - 4)}` : '******'}
                                            </TableCell>
                                            
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-2">
                                                    {editingId === api.id ? (
                                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-green-400" onClick={() => updateApi(api.id)}>
                                                            <Check className="h-4 w-4" />
                                                        </Button>
                                                    ) : (
                                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-white/40 hover:text-white" onClick={() => startEditing(api)}>
                                                            <Plus className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-red-400/40 hover:text-red-400" onClick={() => deleteApi(api.id)}>
                                                        <Trash className="h-4 w-4" />
                                                    </Button>
                                                </div>
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
