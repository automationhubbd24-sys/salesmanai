import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BACKEND_URL } from "@/config";
import { Loader2, Save, Play, Lock } from "lucide-react";

export default function OpenRouterConfigPage() {
    const [loading, setLoading] = useState(false);
    const [testLoading, setTestLoading] = useState(false);
    
    // Config State
    const [config, setConfig] = useState<any>({
        text_model: "",
        voice_model: "",
        image_model: "",
        text_model_details: { rpm: 20, rpd: 50, lock_auto_update: false },
        voice_model_details: { rpm: 20, rpd: 50 },
        image_model_details: { rpm: 20, rpd: 50 },
    });

    // Test Console State
    const [testParams, setTestParams] = useState({
        apiKey: "",
        model: "",
        type: "text", // text, voice, image
        input: "Hello, how are you?",
    });
    const [testResult, setTestResult] = useState<any>(null);

    useEffect(() => {
        fetchConfig();
    }, []);

    const fetchConfig = async () => {
        setLoading(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) return;

            const res = await fetch(`${BACKEND_URL}/api/openrouter/config`, {
                headers: { 'Authorization': `Bearer ${session.access_token}` }
            });
            const data = await res.json();
            if (data.success && data.config) {
                // Merge with defaults to ensure nested objects exist
                setConfig({
                    ...config,
                    ...data.config,
                    text_model_details: data.config.text_model_details || { rpm: 20, rpd: 50, lock_auto_update: false },
                    voice_model_details: data.config.voice_model_details || { rpm: 20, rpd: 50 },
                    image_model_details: data.config.image_model_details || { rpm: 20, rpd: 50 },
                });
            }
        } catch (error) {
            toast.error("Failed to load config");
        } finally {
            setLoading(false);
        }
    };

    const saveConfig = async () => {
        setLoading(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) return;

            const res = await fetch(`${BACKEND_URL}/api/openrouter/config`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`
                },
                body: JSON.stringify(config)
            });
            const data = await res.json();
            if (data.success) {
                toast.success("Configuration Saved & Engine Updated!");
            } else {
                toast.error("Failed to save: " + data.error);
            }
        } catch (error) {
            toast.error("Error saving config");
        } finally {
            setLoading(false);
        }
    };

    const runTest = async () => {
        if (!testParams.apiKey) {
            toast.error("Please enter an OpenRouter API Key for testing");
            return;
        }
        setTestLoading(true);
        setTestResult(null);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) return;

            const res = await fetch(`${BACKEND_URL}/api/openrouter/test-model`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`
                },
                body: JSON.stringify(testParams)
            });
            const data = await res.json();
            setTestResult(data);
            
            if (data.success) {
                toast.success("Test Successful!");
                // Auto-fill headers into config if model matches
                if (testParams.model === config.text_model) {
                    // Optional: Auto-update limits? 
                    // Let's just notify the user.
                    // toast.info("Check Rate Limit headers below to update RPM/RPD!");
                }
            } else {
                toast.error("Test Failed: " + (data.error?.message || "Unknown error"));
            }
        } catch (error) {
            toast.error("Test Error");
        } finally {
            setTestLoading(false);
        }
    };

    return (
        <div className="container mx-auto p-6 space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-3xl font-bold">OpenRouter Engine Config</h1>
                <Button onClick={saveConfig} disabled={loading}>
                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Save Configuration
                </Button>
            </div>

            {/* TEST CONSOLE */}
            <Card className="border-blue-200 bg-blue-50/20">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Play className="h-5 w-5 text-blue-600" />
                        Model Test Console
                    </CardTitle>
                    <CardDescription>
                        Test models in real-time to determine Rate Limits before saving.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Test API Key</Label>
                            <Input 
                                type="password" 
                                placeholder="sk-or-v1-..." 
                                value={testParams.apiKey}
                                onChange={(e) => setTestParams({...testParams, apiKey: e.target.value})}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Model ID</Label>
                            <Input 
                                placeholder="e.g. liquid/lfm-2.5-1.2b-instruct:free" 
                                value={testParams.model}
                                onChange={(e) => setTestParams({...testParams, model: e.target.value})}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Type</Label>
                            <Select 
                                value={testParams.type} 
                                onValueChange={(val) => setTestParams({...testParams, type: val})}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="text">Text (Chat)</SelectItem>
                                    <SelectItem value="image">Image (Vision Input)</SelectItem>
                                    <SelectItem value="voice">Voice (Audio Input)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    
                    <div className="space-y-2">
                        <Label>Test Input (Prompt / URL)</Label>
                        <Textarea 
                            rows={3}
                            value={testParams.input}
                            onChange={(e) => setTestParams({...testParams, input: e.target.value})}
                        />
                    </div>

                    <Button onClick={runTest} disabled={testLoading} variant="secondary" className="w-full">
                        {testLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Run Test"}
                    </Button>

                    {testResult && (
                        <div className="mt-4 p-4 bg-black/90 text-green-400 rounded-md font-mono text-sm overflow-auto max-h-96">
                            <p className="font-bold text-white mb-2">Result (Latency: {testResult.latency}ms)</p>
                            
                            {/* Rate Limit Headers Table */}
                            {testResult.headers && (
                                <div className="mb-4 p-2 bg-gray-800 rounded border border-gray-700">
                                    <p className="text-gray-400 text-xs mb-1">Rate Limit Headers:</p>
                                    <div className="grid grid-cols-3 gap-2 text-xs">
                                        <div>Limit: <span className="text-white">{testResult.headers.limit || 'N/A'}</span></div>
                                        <div>Remaining: <span className="text-white">{testResult.headers.remaining || 'N/A'}</span></div>
                                        <div>Reset: <span className="text-white">{testResult.headers.reset || 'N/A'}</span></div>
                                    </div>
                                </div>
                            )}

                            <pre>{JSON.stringify(testResult.data, null, 2)}</pre>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* CONFIG FORM */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* TEXT MODEL */}
                <Card>
                    <CardHeader>
                        <CardTitle>Generator Model (Text)</CardTitle>
                        <CardDescription>
                            Up to 3 models, comma separated: planner, generator, refiner
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label>Model ID(s) (comma separated, up to 3)</Label>
                            <Input 
                                value={config.text_model} 
                                onChange={(e) => setConfig({...config, text_model: e.target.value})}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-2">
                                <Label>RPM Limit</Label>
                                <Input 
                                    type="number" 
                                    value={config.text_model_details?.rpm} 
                                    onChange={(e) => setConfig({
                                        ...config, 
                                        text_model_details: { ...config.text_model_details, rpm: parseInt(e.target.value) }
                                    })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>RPD Limit</Label>
                                <Input 
                                    type="number" 
                                    value={config.text_model_details?.rpd} 
                                    onChange={(e) => setConfig({
                                        ...config, 
                                        text_model_details: { ...config.text_model_details, rpd: parseInt(e.target.value) }
                                    })}
                                />
                            </div>
                        </div>
                        <div className="flex items-center space-x-2 pt-2">
                            <Checkbox 
                                id="lock_auto" 
                                checked={config.text_model_details?.lock_auto_update}
                                onCheckedChange={(checked) => setConfig({
                                    ...config,
                                    text_model_details: { ...config.text_model_details, lock_auto_update: !!checked }
                                })}
                            />
                            <Label htmlFor="lock_auto" className="flex items-center gap-2 cursor-pointer">
                                <Lock className="h-3 w-3" /> Lock Auto-Update
                            </Label>
                        </div>
                    </CardContent>
                </Card>

                {/* VOICE MODEL */}
                <Card>
                    <CardHeader>
                        <CardTitle>Planner / Helper Model</CardTitle>
                        <CardDescription>Small model for intent + refinement (Model 1 &amp; 3)</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label>Model ID</Label>
                            <Input 
                                value={config.voice_model} 
                                onChange={(e) => setConfig({...config, voice_model: e.target.value})}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-2">
                                <Label>RPM Limit</Label>
                                <Input 
                                    type="number" 
                                    value={config.voice_model_details?.rpm} 
                                    onChange={(e) => setConfig({
                                        ...config, 
                                        voice_model_details: { ...config.voice_model_details, rpm: parseInt(e.target.value) }
                                    })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>RPD Limit</Label>
                                <Input 
                                    type="number" 
                                    value={config.voice_model_details?.rpd} 
                                    onChange={(e) => setConfig({
                                        ...config, 
                                        voice_model_details: { ...config.voice_model_details, rpd: parseInt(e.target.value) }
                                    })}
                                />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* IMAGE MODEL */}
                <Card>
                    <CardHeader>
                        <CardTitle>Image / Vision Model</CardTitle>
                        <CardDescription>For image messages (not used in text-only pipeline)</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label>Model ID</Label>
                            <Input 
                                value={config.image_model} 
                                onChange={(e) => setConfig({...config, image_model: e.target.value})}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-2">
                                <Label>RPM Limit</Label>
                                <Input 
                                    type="number" 
                                    value={config.image_model_details?.rpm} 
                                    onChange={(e) => setConfig({
                                        ...config, 
                                        image_model_details: { ...config.image_model_details, rpm: parseInt(e.target.value) }
                                    })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>RPD Limit</Label>
                                <Input 
                                    type="number" 
                                    value={config.image_model_details?.rpd} 
                                    onChange={(e) => setConfig({
                                        ...config, 
                                        image_model_details: { ...config.image_model_details, rpd: parseInt(e.target.value) }
                                    })}
                                />
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
