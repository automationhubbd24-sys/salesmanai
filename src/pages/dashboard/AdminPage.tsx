import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, Users, Settings, Database as DatabaseIcon, Activity, AlertTriangle, Trash2, Edit, Ban, CheckCircle, CreditCard, DollarSign, Loader2, XCircle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Database } from "@/integrations/supabase/types";
import { BACKEND_URL } from "@/config";
import OpenRouterConfigPage from "./OpenRouterConfigPage";

type Transaction = {
  id: string;
  user_email: string;
  amount: number;
  method: string;
  trx_id: string;
  sender_number: string;
  status: string;
  created_at: string;
};

type Coupon = Database["public"]["Tables"]["referral_codes"]["Row"];

type GeminiKeyTestResult = {
  id: number;
  provider: string;
  model: string;
  originalModel: string | null;
  success: boolean;
  error: string | null;
};

type EngineTestResult = {
  model: string;
  success: boolean;
  latency: number | null;
  error: string | null;
  preview: string | null;
};

export default function AdminPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loadingTxns, setLoadingTxns] = useState(false);
  const [loadingCoupons, setLoadingCoupons] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Login State
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [usernameInput, setUsernameInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  // Coupon Form
  const [couponCode, setCouponCode] = useState("");
  const [couponValue, setCouponValue] = useState("");

  // Manual Topup
  const [topupEmail, setTopupEmail] = useState("");
  const [topupAmount, setTopupAmount] = useState("");
  const [topupLoading, setTopupLoading] = useState(false);

  const [geminiModel, setGeminiModel] = useState("gemini-2.5-flash-lite");
  const [geminiMessage, setGeminiMessage] = useState("hi from SalesmanChatbot key test");
  const [geminiLoading, setGeminiLoading] = useState(false);
  const [geminiResults, setGeminiResults] = useState<GeminiKeyTestResult[]>([]);
  const [geminiError, setGeminiError] = useState<string | null>(null);
  const [geminiLog, setGeminiLog] = useState<string[]>([]);

  const [engineApiKey, setEngineApiKey] = useState("");
  const [engineMessage, setEngineMessage] = useState("Hello from SalesmanChatbot admin test");
  const [engineModels, setEngineModels] = useState<{ pro: boolean; flash: boolean; lite: boolean }>({
    pro: true,
    flash: true,
    lite: true,
  });
  const [engineLoading, setEngineLoading] = useState(false);
  const [engineResults, setEngineResults] = useState<EngineTestResult[]>([]);
  const [engineError, setEngineError] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated) {
      fetchTransactions();
      fetchCoupons();
    }
  }, [isAuthenticated]);

  const handleLogin = async () => {
    if (!usernameInput || !passwordInput) {
      toast.error("Please enter username and password");
      return;
    }

    setLoginLoading(true);
    try {
      // Query 'app_users' table
      const { data, error } = await (supabase as any)
        .from('app_users')
        .select('*')
        .eq('key', usernameInput)
        .eq('pas', passwordInput)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setIsAuthenticated(true);
        toast.success("Login successful");
      } else {
        toast.error("Invalid credentials");
      }
    } catch (error: any) {
      console.error(error);
      toast.error("Login failed: " + (error.message || "Unknown error"));
    } finally {
      setLoginLoading(false);
    }
  };

  const fetchTransactions = async () => {
    setLoadingTxns(true);
    const { data } = await supabase
      .from('payment_transactions')
      .select('*')
      .order('created_at', { ascending: false });
    if (data) setTransactions(data as unknown as Transaction[]);
    setLoadingTxns(false);
  };

  const fetchCoupons = async () => {
    setLoadingCoupons(true);
    const { data } = await supabase
      .from('referral_codes')
      .select('*')
      .order('created_at', { ascending: false });
    if (data) setCoupons(data);
    setLoadingCoupons(false);
  };

  const handleApproveTxn = async (txn: any) => {
    try {
      setProcessingId(txn.id);
      
      // Use RPC function to securely update balance and status in one transaction
      // This bypasses RLS issues on user_configs
      const { error } = await (supabase as any).rpc('approve_deposit', { txn_id: txn.id });

      if (error) {
        console.error("RPC Error:", error);
        // Fallback for legacy support (if function not created yet)
        if (error.message?.includes('function') && error.message?.includes('does not exist')) {
            toast.error("Database function missing. Please run the provided SQL script.");
            return;
        }
        throw error;
      }

      toast.success(`Transaction approved. Added ${txn.amount} BDT to user.`);
      fetchTransactions();

    } catch (error: unknown) {
      console.error(error);
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error("Failed to approve: " + message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleRejectTxn = async (txn: Transaction) => {
    try {
      setProcessingId(txn.id);
      const { error } = await (supabase as any)
        .from('payment_transactions')
        .update({ status: 'failed' })
        .eq('id', txn.id);
      
      if (error) throw error;
      
      toast.success("Transaction rejected.");
      fetchTransactions();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error("Failed to reject: " + message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleCreateCoupon = async () => {
    if (!couponCode || !couponValue) {
      toast.error("Please fill all fields");
      return;
    }

    try {
      const { error } = await (supabase as any).from('referral_codes').insert({
        code: couponCode,
        value: Number(couponValue),
        type: 'balance',
        status: 'active'
      });

      if (error) throw error;

      toast.success("Coupon created!");
      setCouponCode("");
      setCouponValue("");
      fetchCoupons();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error("Failed to create coupon: " + message);
    }
  };

  const toggleCouponStatus = async (coupon: Coupon) => {
    const newStatus = coupon.status === 'active' ? 'inactive' : 'active';
    await (supabase as any).from('referral_codes').update({ status: newStatus }).eq('id', coupon.id);
    fetchCoupons();
  };

  const handleManualTopup = async () => {
    if (!topupEmail || !topupAmount) {
      toast.error("Email and Amount are required");
      return;
    }

    setTopupLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/admin/topup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: topupEmail,
          amount: topupAmount
        })
      });

      const data = await res.json();
      if (res.ok) {
        toast.success(`Success! Added ${topupAmount} to ${topupEmail}. New Balance: ${data.newBalance}`);
        setTopupEmail("");
        setTopupAmount("");
        fetchTransactions(); // Refresh list to show log
      } else {
        throw new Error(data.error || "Failed to topup");
      }
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setTopupLoading(false);
    }
  };

  const handleRunGeminiTest = async () => {
    if (!geminiModel) {
      toast.error("Model name is required");
      return;
    }

    setGeminiLoading(true);
    setGeminiError(null);
    setGeminiResults([]);
    setGeminiLog([`Starting Gemini pool test with model "${geminiModel}"...`]);

    try {
      const response = await fetch(`${BACKEND_URL}/api/openrouter/gemini/test-keys`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: geminiModel,
          message: geminiMessage
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        const errorMessage = data?.error || "Failed to run Gemini test";
        setGeminiError(errorMessage);
        setGeminiLog((prev) => [...prev, `Error: ${errorMessage}`]);
        toast.error(errorMessage);
        return;
      }

      const list: GeminiKeyTestResult[] = (data.results || []).map((r: any) => ({
        id: r.id,
        provider: r.provider || "",
        model: r.model || geminiModel,
        originalModel: r.original_model ?? null,
        success: !!r.success,
        error: r.error || null,
      }));

      setGeminiResults(list);
      const items = data.results || [];
      const total = items.length;
      const logLines = items.map((r: any, index: number) => {
        const status = r.success ? "OK" : "FAILED";
        const prefix = `[${index + 1}/${total}]`;
        const base = `${prefix} Testing Key id=${r.id} provider=${r.provider || ""} model=${r.model || ""} -> ${status}`;
        if (!r.success && r.error) {
          return `${base} (error=${r.error})`;
        }
        return base;
      });
      setGeminiLog((prev) => [...prev, ...logLines]);
      toast.success("Gemini pool test completed");
    } catch (error: any) {
      const message = error?.message || "Unexpected error while testing Gemini keys";
      setGeminiError(message);
      toast.error(message);
    } finally {
      setGeminiLoading(false);
    }
  };

  const handleRunEngineTest = async () => {
    if (!engineApiKey) {
      toast.error("Service API key is required");
      return;
    }

    const selectedModels: string[] = [];
    if (engineModels.pro) selectedModels.push("salesmanchatbot-pro");
    if (engineModels.flash) selectedModels.push("salesmanchatbot-flash");
    if (engineModels.lite) selectedModels.push("salesmanchatbot-lite");

    if (selectedModels.length === 0) {
      toast.error("Select at least one model to test");
      return;
    }

    setEngineLoading(true);
    setEngineError(null);
    setEngineResults([]);

    const results: EngineTestResult[] = [];

    try {
      for (const model of selectedModels) {
        const started = performance.now();

        try {
          const response = await fetch(`${BACKEND_URL}/api/external/v1/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${engineApiKey}`,
            },
            body: JSON.stringify({
              model,
              messages: [{ role: "user", content: engineMessage }],
            }),
          });

          const data = await response.json();
          const duration = performance.now() - started;

          if (!response.ok || !data || !data.choices || !data.choices[0]?.message?.content) {
            const message =
              data?.error?.message || data?.error || `Request failed with status ${response.status}`;

            results.push({
              model,
              success: false,
              latency: duration,
              error: message,
              preview: null,
            });
          } else {
            const content: string = data.choices[0].message.content || "";
            const preview = content.length > 120 ? `${content.slice(0, 117)}...` : content;

            results.push({
              model,
              success: true,
              latency: duration,
              error: null,
              preview,
            });
          }
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : "Network error while calling engine";
          const duration = performance.now() - started;

          results.push({
            model,
            success: false,
            latency: duration,
            error: message,
            preview: null,
          });
        }
      }

      setEngineResults(results);
      const failedCount = results.filter((r) => !r.success).length;
      if (failedCount === 0) {
        toast.success("All models responded successfully");
      } else {
        toast.error(`Some models failed: ${failedCount} of ${results.length}`);
      }
    } finally {
      setEngineLoading(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] animate-in fade-in duration-500">
        <Card className="w-full max-w-md shadow-lg border-t-4 border-t-primary">
          <CardHeader className="text-center space-y-2">
            <Shield className="h-12 w-12 mx-auto text-primary" />
            <CardTitle className="text-2xl">Admin Login</CardTitle>
            <CardDescription>Secure Area. Please authenticate.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Username (Key)</Label>
              <Input 
                value={usernameInput} 
                onChange={e => setUsernameInput(e.target.value)} 
                placeholder="Enter admin key"
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              />
            </div>
            <div className="space-y-2">
              <Label>Password</Label>
              <Input 
                type="password" 
                value={passwordInput} 
                onChange={e => setPasswordInput(e.target.value)} 
                placeholder="Enter password"
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              />
            </div>
            <Button className="w-full font-bold" onClick={handleLogin} disabled={loginLoading}>
              {loginLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Access Dashboard"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Warning */}
      <div className="flex items-center gap-4 p-4 bg-destructive/10 rounded-lg border border-destructive/20">
        <Shield className="h-8 w-8 text-destructive" />
        <div>
          <h2 className="text-xl font-bold text-foreground">Admin Control Panel</h2>
          <p className="text-sm text-muted-foreground">
            Manage payments, users, and system settings.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="payments" className="space-y-4">
        <TabsList className="bg-secondary">
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="finance">Finance</TabsTrigger>
          <TabsTrigger value="engine">Engine Test</TabsTrigger>
          <TabsTrigger value="gemini">Gemini Monitor</TabsTrigger>
          <TabsTrigger value="users">User Management</TabsTrigger>
          <TabsTrigger value="system">System Settings</TabsTrigger>
          <TabsTrigger value="openrouter">OpenRouter Config</TabsTrigger>
        </TabsList>

        {/* Payments Tab */}
        <TabsContent value="payments">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle>Transaction Requests</CardTitle>
              <CardDescription>Approve or reject deposit requests</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User Email</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Details</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingTxns ? (
                       <TableRow><TableCell colSpan={6} className="text-center">Loading...</TableCell></TableRow>
                    ) : transactions.length === 0 ? (
                       <TableRow><TableCell colSpan={6} className="text-center">No transactions found</TableCell></TableRow>
                    ) : (
                      transactions.map((txn: any) => (
                        <TableRow key={txn.id}>
                          <TableCell className="font-medium text-sm">{txn.user_email}</TableCell>
                          <TableCell className="capitalize">{txn.method}</TableCell>
                          <TableCell className="font-bold text-green-600">৳{txn.amount}</TableCell>
                          <TableCell>
                            <div className="text-xs">
                              <p>TRX: {txn.trx_id}</p>
                              <p className="text-muted-foreground">Sender: {txn.sender_number}</p>
                              <p className="text-muted-foreground">{new Date(txn.created_at).toLocaleString()}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={txn.status === 'completed' ? 'default' : txn.status === 'pending' ? 'secondary' : 'destructive'}>
                              {txn.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {txn.status === 'pending' && (
                              <div className="flex justify-end gap-2">
                                <Button 
                                  size="sm" 
                                  variant="outline" 
                                  className="text-green-600 border-green-200 hover:bg-green-50"
                                  onClick={() => handleApproveTxn(txn)}
                                  disabled={processingId === txn.id}
                                >
                                  {processingId === txn.id ? <Loader2 className="h-4 w-4 animate-spin"/> : <CheckCircle className="h-4 w-4" />}
                                </Button>
                                <Button 
                                  size="sm" 
                                  variant="outline" 
                                  className="text-red-600 border-red-200 hover:bg-red-50"
                                  onClick={() => handleRejectTxn(txn)}
                                  disabled={processingId === txn.id}
                                >
                                  {processingId === txn.id ? <Loader2 className="h-4 w-4 animate-spin"/> : <XCircle className="h-4 w-4" />}
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Finance Tab */}
        <TabsContent value="finance" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5" /> Manual Top-Up
                </CardTitle>
                <CardDescription>Add balance directly to a user via Email</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>User Email</Label>
                  <Input 
                    placeholder="user@example.com" 
                    value={topupEmail}
                    onChange={(e) => setTopupEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Amount (BDT)</Label>
                  <Input 
                    type="number" 
                    placeholder="100" 
                    value={topupAmount}
                    onChange={(e) => setTopupAmount(e.target.value)}
                  />
                </div>
                <Button className="w-full" onClick={handleManualTopup} disabled={topupLoading}>
                  {topupLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Add Balance
                </Button>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5" /> Create Coupon
                </CardTitle>
                <CardDescription>Generate balance codes</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Coupon Code</Label>
                  <Input placeholder="e.g. WELCOME500" value={couponCode} onChange={(e) => setCouponCode(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Value (BDT)</Label>
                  <Input type="number" placeholder="500" value={couponValue} onChange={(e) => setCouponValue(e.target.value)} />
                </div>
                <Button className="w-full" onClick={handleCreateCoupon}>Create Code</Button>
              </CardContent>
            </Card>

            <Card className="bg-card border-border md:col-span-2">
              <CardHeader>
                <CardTitle>Active Coupons</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Value</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingCoupons ? (
                         <TableRow><TableCell colSpan={4}>Loading...</TableCell></TableRow>
                    ) : coupons.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-mono font-bold">{c.code}</TableCell>
                        <TableCell>৳{c.value}</TableCell>
                        <TableCell>
                          <Badge variant={c.status === 'active' ? 'default' : 'secondary'}>{c.status}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="ghost" onClick={() => toggleCouponStatus(c)}>
                            {c.status === 'active' ? 'Deactivate' : 'Activate'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="engine" className="space-y-4">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle>SalesmanChatbot Engine Test</CardTitle>
              <CardDescription>
                Send a test message to salesmanchatbot-pro, -flash, and -lite using a Service API key.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Service API Key</Label>
                  <Input
                    type="password"
                    value={engineApiKey}
                    onChange={(e) => setEngineApiKey(e.target.value)}
                    placeholder="sk-salesman-..."
                    className="font-mono"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Test Message</Label>
                  <Input
                    value={engineMessage}
                    onChange={(e) => setEngineMessage(e.target.value)}
                    placeholder="Hello from admin test"
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={engineModels.pro}
                    onCheckedChange={(checked) =>
                      setEngineModels((prev) => ({ ...prev, pro: Boolean(checked) }))
                    }
                  />
                  <span className="text-sm">salesmanchatbot-pro</span>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={engineModels.flash}
                    onCheckedChange={(checked) =>
                      setEngineModels((prev) => ({ ...prev, flash: Boolean(checked) }))
                    }
                  />
                  <span className="text-sm">salesmanchatbot-flash</span>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={engineModels.lite}
                    onCheckedChange={(checked) =>
                      setEngineModels((prev) => ({ ...prev, lite: Boolean(checked) }))
                    }
                  />
                  <span className="text-sm">salesmanchatbot-lite</span>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <Button onClick={handleRunEngineTest} disabled={engineLoading}>
                  {engineLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Run Engine Test
                </Button>
                {engineResults.length > 0 && (
                  <div className="text-sm text-muted-foreground">
                    Total: {engineResults.length} | Failed:{" "}
                    {engineResults.filter((r) => !r.success).length}
                  </div>
                )}
              </div>

              {engineError && (
                <div className="text-sm text-red-500">
                  {engineError}
                </div>
              )}

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Model</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Latency (ms)</TableHead>
                      <TableHead>Preview / Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {engineResults.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center">
                          No test run yet. Enter a key and click Run Engine Test.
                        </TableCell>
                      </TableRow>
                    ) : (
                      engineResults.map((r) => (
                        <TableRow key={r.model}>
                          <TableCell className="font-mono text-xs">{r.model}</TableCell>
                          <TableCell>
                            {r.success ? (
                              <Badge className="bg-green-600 text-white">OK</Badge>
                            ) : (
                              <Badge variant="destructive">Failed</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {r.latency !== null ? Math.round(r.latency) : "-"}
                          </TableCell>
                          <TableCell className="text-xs max-w-[320px] truncate">
                            {r.success ? r.preview || "-" : r.error || "-"}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Users Tab (Placeholder) */}
        <TabsContent value="gemini" className="space-y-4">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle>Gemini API Pool Monitor</CardTitle>
              <CardDescription>
                Test all Gemini keys from api_list with a sample message and see which ones failed.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Model Name</Label>
                  <Input
                    value={geminiModel}
                    onChange={(e) => setGeminiModel(e.target.value)}
                    placeholder="gemini-2.5-flash-lite"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Test Message</Label>
                  <Input
                    value={geminiMessage}
                    onChange={(e) => setGeminiMessage(e.target.value)}
                    placeholder="hi from SalesmanChatbot key test"
                  />
                </div>
              </div>
              <div className="flex items-center gap-4">
                <Button onClick={handleRunGeminiTest} disabled={geminiLoading}>
                  {geminiLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Run Gemini Test
                </Button>
                {geminiResults.length > 0 && (
                  <div className="text-sm text-muted-foreground">
                    Total: {geminiResults.length} | Failed: {geminiResults.filter(r => !r.success).length}
                  </div>
                )}
              </div>
              {geminiError && (
                <div className="text-sm text-red-500">
                  {geminiError}
                </div>
              )}
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Provider</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {geminiResults.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center">
                          No results yet. Run a test to see key status.
                        </TableCell>
                      </TableRow>
                    ) : (
                      geminiResults.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-mono text-xs">{r.id}</TableCell>
                          <TableCell className="capitalize">{r.provider}</TableCell>
                          <TableCell>{r.model || "-"}</TableCell>
                          <TableCell>
                            {r.success ? (
                              <Badge className="bg-green-600 text-white">OK</Badge>
                            ) : (
                              <Badge variant="destructive">Failed</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs max-w-[240px] truncate">
                            {r.error || "-"}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              <div className="mt-4 border rounded-md p-2 bg-muted/40 max-h-64 overflow-y-auto text-xs font-mono">
                {geminiLog.length === 0 ? (
                  <div className="text-muted-foreground">No logs yet.</div>
                ) : (
                  geminiLog.map((line, index) => (
                    <div key={index}>{line}</div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Users Tab (Placeholder) */}
        <TabsContent value="users">
          <Card>
            <CardHeader><CardTitle>User Management</CardTitle></CardHeader>
            <CardContent><p className="text-muted-foreground">User management features coming soon.</p></CardContent>
          </Card>
        </TabsContent>

        {/* System Tab (Placeholder) */}
        <TabsContent value="system">
           <Card>
            <CardHeader><CardTitle>System Settings</CardTitle></CardHeader>
            <CardContent><p className="text-muted-foreground">System settings coming soon.</p></CardContent>
          </Card>
        </TabsContent>

        {/* OpenRouter Config Tab (Embedded) */}
        <TabsContent value="openrouter">
           <OpenRouterConfigPage />
        </TabsContent>

      </Tabs>
    </div>
  );
}
