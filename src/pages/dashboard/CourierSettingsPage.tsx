import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, KeyRound, RefreshCw, ShieldCheck, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { BACKEND_URL } from "@/config";
import { toast } from "sonner";

const providerOptions = [
  { value: "steadfast", label: "Steadfast" },
  { value: "pathao", label: "Pathao" },
  { value: "redx", label: "RedX" },
];

const providerLabels = Object.fromEntries(providerOptions.map((item) => [item.value, item.label]));

type CourierSettings = {
  connected: boolean;
  provider: string;
  api_key_masked?: string | null;
  secret_key_masked?: string | null;
  merchant_id_masked?: string | null;
  store_id_masked?: string | null;
  pickup_address?: string;
  is_active: boolean;
  last_tested_at?: string | null;
};

export default function CourierSettingsPage() {
  const [settings, setSettings] = useState<CourierSettings | null>(null);
  const [provider, setProvider] = useState("steadfast");
  const [apiKey, setApiKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [merchantId, setMerchantId] = useState("");
  const [storeId, setStoreId] = useState("");
  const [pickupAddress, setPickupAddress] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;

  const loadSettings = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/courier/settings?provider=${provider}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Courier settings load kora jayni");
      const data = await response.json();
      setSettings(data);
      setApiKey("");
      setSecretKey("");
      setMerchantId("");
      setStoreId("");
      setPickupAddress(data.pickup_address || "");
      setIsActive(data.is_active !== false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Courier settings load kora jayni");
    } finally {
      setLoading(false);
    }
  }, [provider, token]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const saveSettings = async () => {
    if (!token) return;
    if (!settings?.connected && (!apiKey.trim() || !secretKey.trim())) {
      toast.error("API key and secret key required");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/courier/settings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          provider,
          api_key: apiKey.trim() || undefined,
          secret_key: secretKey.trim() || undefined,
          merchant_id: merchantId.trim() || undefined,
          store_id: storeId.trim() || undefined,
          pickup_address: pickupAddress.trim(),
          is_active: isActive,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Courier settings save kora jayni");
      setSettings(data.settings);
      setApiKey("");
      setSecretKey("");
      setMerchantId("");
      setStoreId("");
      toast.success(`${providerLabels[provider]} integration saved`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Courier settings save kora jayni");
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    if (!token) return;
    setTesting(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/courier/test`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ provider }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Courier test failed");
      toast.success(`${providerLabels[provider]} API connected successfully`);
      void loadSettings();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Courier test failed");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6 -m-4 p-4 md:-m-6 md:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Courier Integration</h2>
          <p className="text-muted-foreground">Business owner Steadfast, Pathao ba RedX API ekhane setup korbe.</p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-[#00ff88]/30 bg-[#00ff88]/5 px-4 py-2 text-sm text-[#00ff88]">
          {settings?.connected ? <CheckCircle2 className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
          {settings?.connected ? "Connected" : "Not connected"}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card className="border-l-4 border-l-[#00ff88] bg-[#0f0f0f]/80 shadow-[0_18px_40px_rgba(0,0,0,0.35)]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Truck className="h-5 w-5 text-[#00ff88]" /> Provider setup</CardTitle>
            <CardDescription>Credential encrypted hoye save hobe. Existing key thakle blank rekhe only address/status update korte parben.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-2">
              <Label>Courier Provider</Label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {providerOptions.map((item) => (
                    <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>{provider === "pathao" ? "Client ID / API Key" : "API Key"}</Label>
                <Input value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={settings?.api_key_masked || "Enter API key"} autoComplete="off" />
              </div>
              <div className="grid gap-2">
                <Label>{provider === "pathao" ? "Client Secret" : "Secret Key"}</Label>
                <Input type="password" value={secretKey} onChange={(event) => setSecretKey(event.target.value)} placeholder={settings?.secret_key_masked || "Enter secret key"} autoComplete="new-password" />
              </div>
            </div>

            {(provider === "pathao" || provider === "redx") && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>{provider === "pathao" ? "Store ID" : "Merchant ID"}</Label>
                  <Input value={merchantId} onChange={(event) => setMerchantId(event.target.value)} placeholder={settings?.merchant_id_masked || "Optional provider ID"} autoComplete="off" />
                </div>
                <div className="grid gap-2">
                  <Label>{provider === "pathao" ? "Access Token / Store Secret" : "Store ID"}</Label>
                  <Input value={storeId} onChange={(event) => setStoreId(event.target.value)} placeholder={settings?.store_id_masked || "Optional extra credential"} autoComplete="off" />
                </div>
              </div>
            )}

            <div className="grid gap-2">
              <Label>Pickup Address</Label>
              <Textarea value={pickupAddress} onChange={(event) => setPickupAddress(event.target.value)} placeholder="Shop/warehouse pickup address" rows={4} />
            </div>

            <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 p-4">
              <div>
                <p className="font-semibold">Enable courier booking</p>
                <p className="text-sm text-muted-foreground">Active orders theke one-click booking allow korbe.</p>
              </div>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>

            <div className="flex flex-wrap gap-3">
              <Button onClick={saveSettings} disabled={saving || loading} className="bg-[#00ff88] text-black hover:bg-[#00dd77]">
                {saving && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />} Save Integration
              </Button>
              <Button variant="outline" onClick={testConnection} disabled={testing || !settings?.connected}>
                {testing && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />} Test Connection
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-[#0f0f0f]/80">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-[#00ff88]" /> Setup guide</CardTitle>
            <CardDescription>Business owner er jonno simple flow.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <div className="rounded-2xl border border-white/10 p-4">
              <p className="font-semibold text-foreground">1. Courier provider select korun</p>
              <p>Steadfast, Pathao ba RedX er merchant account credential paste korun.</p>
            </div>
            <div className="rounded-2xl border border-white/10 p-4">
              <p className="font-semibold text-foreground">2. Save + Test</p>
              <p>Credential save kore Test Connection click korle account valid kina check hobe.</p>
            </div>
            <div className="rounded-2xl border border-white/10 p-4">
              <p className="font-semibold text-foreground">3. Orders page theke send</p>
              <p>WhatsApp, Messenger, Instagram active orders theke single ba bulk courier e pathano jabe.</p>
            </div>
            {settings?.last_tested_at && <p>Last tested: {new Date(settings.last_tested_at).toLocaleString()}</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
