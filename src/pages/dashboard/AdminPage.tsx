import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, Database as DatabaseIcon, Trash2, Edit, CheckCircle, CreditCard, DollarSign, Loader2, XCircle, Cpu, Plus, RefreshCw, Server, Activity, AlertTriangle, ChevronLeft, ChevronRight, Settings, Facebook, Smartphone } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { BACKEND_URL } from "@/config";
import OpenRouterConfigPage from "./OpenRouterConfigPage";

interface ApiKey {
  id: number;
  provider: string;
  model: string;
  api: string;
  status: string;
  usage_today: number;
  last_used_at: string;
  rph_limit?: number;
  rpm_limit?: number;
  rpd_limit?: number;
  cooldown_until?: string | null;
}

interface EngineStats {
  engine_status: string;
  total_keys: number;
  active_keys: number;
  dead_keys: number;
  providers: {
    google: number;
    openai: number;
    groq: number;
    openrouter: number;
    mistral: number;
  };
}

interface EngineConfig {
  id: number;
  name: string;
  provider: string;
  text_model: string;
  voice_model: string;
  image_model: string;
  voice_provider_override: string | null;
  image_provider_override: string | null;
}

interface GlobalEngineConfig {
  provider: string;
  text_model: string;
  vision_model: string;
  voice_model: string;
  text_provider_override?: string | null;
  vision_provider_override?: string | null;
  voice_provider_override?: string | null;
  text_rpm?: number;
  text_rpd?: number;
  text_rph?: number;
  vision_rpm?: number;
  vision_rpd?: number;
  vision_rph?: number;
  voice_rpm?: number;
  voice_rpd?: number;
  voice_rph?: number;
}

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

type Coupon = {
  id: number;
  code: string;
  value: number;
  type: string;
  status: string;
  usage_limit: number;
  current_usage: number;
  per_user_limit: number;
  created_at: string;
};

type GeminiKeyTestResult = {
  id: number;
  provider: string;
  model: string;
  originalModel: string | null;
  success: boolean;
  error: string | null;
};

interface CacheConfig {
  platform: 'messenger' | 'whatsapp';
  id: string;
  name: string;
  semantic_cache_enabled: boolean;
  semantic_cache_threshold: number;
  embed_enabled: boolean;
  semantic_cache_autosave?: boolean;
  created_at?: string;
}

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
  const [couponType, setCouponType] = useState("balance");
  const [couponUsageLimit, setCouponUsageLimit] = useState("1");
  const [couponPerUserLimit, setCouponPerUserLimit] = useState("1");

  // Manual Topup
  const [topupEmail, setTopupEmail] = useState("");
  const [topupAmount, setTopupAmount] = useState("");
  const [topupLoading, setTopupLoading] = useState(false);

  // API Engine State
  const [engineStats, setEngineStats] = useState<EngineStats | null>(null);
  const [engineKeys, setEngineKeys] = useState<ApiKey[]>([]);
  const [engineStatsLoading, setEngineStatsLoading] = useState(false);
  const [engineConfigs, setEngineConfigs] = useState<EngineConfig[]>([]);
  const [globalConfigs, setGlobalConfigs] = useState<GlobalEngineConfig[]>([]);
  const [selectedConfigProvider, setSelectedConfigProvider] = useState("google");
  const [configValues, setConfigValues] = useState<GlobalEngineConfig>({
    provider: "google",
    text_model: "gemini-2.5-flash",
    vision_model: "gemini-2.5-flash",
    voice_model: "gemini-2.5-flash-lite",
    text_provider_override: null,
    vision_provider_override: null,
    voice_provider_override: null,
    text_rpm: 0,
    text_rpd: 0,
    text_rph: 0,
    vision_rpm: 0,
    vision_rpd: 0,
    vision_rph: 0,
    voice_rpm: 0,
    voice_rpd: 0,
    voice_rph: 0
  });
  const [newApi, setNewApi] = useState("");
  const [engineProvider, setEngineProvider] = useState("google");
  const [engineModel, setEngineModel] = useState("default");
  const [engineFilter, setEngineFilter] = useState("all");
  const [enginePage, setEnginePage] = useState(1);
  const [engineTotal, setEngineTotal] = useState(0);
  const [engineSearch, setEngineSearch] = useState("");
  const [engineRevealedKeys, setEngineRevealedKeys] = useState<Record<number, string>>({});
  const [rotationLogs, setRotationLogs] = useState<any[]>([]);

  const [geminiModel, setGeminiModel] = useState("");
  const [geminiMessage, setGeminiMessage] = useState("hi from SalesmanChatbot key test");
  const [geminiProviderFilter, setGeminiProviderFilter] = useState("all");
  const [geminiMarkDead, setGeminiMarkDead] = useState(true);
  const [geminiLoading, setGeminiLoading] = useState(false);
  const [geminiResults, setGeminiResults] = useState<GeminiKeyTestResult[]>([]);
  const [geminiError, setGeminiError] = useState<string | null>(null);
  const [geminiLog, setGeminiLog] = useState<string[]>([]);
  const [geminiSelectedIds, setGeminiSelectedIds] = useState<number[]>([]);

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

  const [dbTables, setDbTables] = useState<string[]>([]);
  const [dbTablesLoading, setDbTablesLoading] = useState(false);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [dbColumns, setDbColumns] = useState<{ column_name: string; data_type: string; is_nullable: string }[]>([]);
  const [dbRows, setDbRows] = useState<any[]>([]);
  const [dbLoading, setDbLoading] = useState(false);
  const [dbLimit] = useState(50);
  const [dbOffset, setDbOffset] = useState(0);
  const [dbSearch, setDbSearch] = useState("");
  const [dbError, setDbError] = useState<string | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<any | null>(null);
  const [insertDialogOpen, setInsertDialogOpen] = useState(false);
  const [insertForm, setInsertForm] = useState<any>({});
  const [sqlText, setSqlText] = useState("");
  const [sqlResult, setSqlResult] = useState<any | null>(null);
  const [sqlError, setSqlError] = useState<string | null>(null);
  const [sqlRunning, setSqlRunning] = useState(false);
  const [createTableDialogOpen, setCreateTableDialogOpen] = useState(false);
  const [newTableName, setNewTableName] = useState("");
  const [newColumns, setNewColumns] = useState<{ name: string; type: string; nullable: boolean }[]>([
    { name: "id", type: "bigserial primary key", nullable: false },
  ]);
  const [addColumnDialogOpen, setAddColumnDialogOpen] = useState(false);
  const [newColumnName, setNewColumnName] = useState("");
  const [newColumnType, setNewColumnType] = useState("");
  const [newColumnNullable, setNewColumnNullable] = useState(true);

  // Pagination for tables list
  const [tableSearch, setTableSearch] = useState("");

  const [activeTab, setActiveTab] = useState(() => {
    const hash = window.location.hash.replace('#', '');
    return hash || "payments";
  });

  useEffect(() => {
    window.location.hash = activeTab;
  }, [activeTab]);

  const [cacheConfigs, setCacheConfigs] = useState<CacheConfig[]>([]);
  const [cacheLoading, setCacheLoading] = useState(false);
  const [cacheSearch, setCacheSearch] = useState("");
  const [cachePage, setCachePage] = useState(1);
  const cacheLimit = 20;
  const [cachePlatform, setCachePlatform] = useState<'all' | 'messenger' | 'whatsapp'>('all');
  const [editingCacheConfig, setEditingCacheConfig] = useState<CacheConfig | null>(null);
  const [isCacheDialogOpen, setIsCacheDialogOpen] = useState(false);
  const [isEntriesDialogOpen, setIsEntriesDialogOpen] = useState(false);
  const [cacheEntries, setCacheEntries] = useState<any[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [selectedConfigForEntries, setSelectedConfigForEntries] = useState<any>(null);
  const [newEntryQuestion, setNewEntryQuestion] = useState("");
  const [newEntryResponse, setNewEntryResponse] = useState("");
  const [editingEntryId, setEditingEntryId] = useState<number | null>(null);
  const [entriesSearch, setEntriesSearch] = useState("");
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  const [embeddingConfig, setEmbeddingConfig] = useState<{ provider: string; model: string; base_url: string; api_key: string }>({
    provider: "openai",
    model: "",
    base_url: "",
    api_key: ""
  });

  const getAdminToken = () => {
    return localStorage.getItem("admin_token") || localStorage.getItem("auth_token") || "";
  };

  useEffect(() => {
    const t = localStorage.getItem("admin_token");
    if (t) setIsAuthenticated(true);
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchTransactions();
      fetchCoupons();
      fetchDbTables();
      fetchEngineData();
      fetchCacheConfigs();
      fetchEmbeddingConfig();
    }
  }, [isAuthenticated]);

  const fetchCacheConfigs = async () => {
    try {
      setCacheLoading(true);
      const token = getAdminToken();
      const res = await fetch(`${BACKEND_URL}/api/db-admin/cache-configs`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.configs)) {
        setCacheConfigs(data.configs);
      }
    } catch (error) {
      console.error("Failed to fetch cache configs", error);
    } finally {
      setCacheLoading(false);
    }
  };

  const fetchCacheEntries = async (platform: string, id: string) => {
    setEntriesLoading(true);
    try {
      const token = getAdminToken();
      const queryParams = new URLSearchParams();
      if (platform === 'messenger') queryParams.append('page_id', id);
      else queryParams.append('session_name', id);
      
      const response = await fetch(`${BACKEND_URL}/api/db-admin/semantic-cache/entries?${queryParams.toString()}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      const data = await response.json();
      if (data.success) {
        setCacheEntries(data.entries || []);
        if (!data.entries || data.entries.length === 0) {
          toast.info("No cache entries found for this account.");
        }
      } else {
        const errorMsg = data.error || "Failed to fetch entries";
        toast.error(`Fetch Error: ${errorMsg}`);
        console.error('Fetch entries error response:', data);
      }
    } catch (error: any) {
      console.error('Fetch entries error:', error);
      toast.error(`Connection Error: ${error.message || "Failed to connect to server"}`);
    } finally {
      setEntriesLoading(false);
    }
  };

  const handleSaveCacheEntry = async () => {
    if (!newEntryQuestion || !newEntryResponse) {
      toast.error("Question and response are required");
      return;
    }
    
    const payload = {
      page_id: selectedConfigForEntries.platform === 'messenger' ? selectedConfigForEntries.id : null,
      session_name: selectedConfigForEntries.platform === 'whatsapp' ? selectedConfigForEntries.id : null,
      question: newEntryQuestion,
      response: newEntryResponse
    };

    try {
      const token = getAdminToken();
      let response;
      if (editingEntryId) {
        response = await fetch(`${BACKEND_URL}/api/db-admin/semantic-cache/update/${editingEntryId}`, {
          method: 'PUT',
          headers: { 
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ question: newEntryQuestion, response: newEntryResponse })
        });
      } else {
        response = await fetch(`${BACKEND_URL}/api/db-admin/semantic-cache/add`, {
          method: 'POST',
          headers: { 
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });
      }

      const data = await response.json();
      if (data.success) {
        toast.success(editingEntryId ? 'Entry updated' : 'Entry added');
        setNewEntryQuestion("");
        setNewEntryResponse("");
        setEditingEntryId(null);
        fetchCacheEntries(selectedConfigForEntries.platform, selectedConfigForEntries.id);
      } else {
        toast.error(data.error || "Failed to save entry");
      }
    } catch (error) {
      toast.error('Failed to save entry');
    }
  };

  const handleDeleteCacheEntry = async (id: number) => {
    if (!confirm('Are you sure you want to delete this cache entry?')) return;
    try {
      const token = getAdminToken();
      const response = await fetch(`${BACKEND_URL}/api/db-admin/semantic-cache/delete/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      if (data.success) {
        toast.success('Entry deleted');
        fetchCacheEntries(selectedConfigForEntries.platform, selectedConfigForEntries.id);
      } else {
        toast.error(data.error || "Delete failed");
      }
    } catch (error) {
      toast.error('Failed to delete entry');
    }
  };

  const handleClearCache = async () => {
    if (!selectedConfigForEntries) return;
    
    try {
      const token = getAdminToken();
      const payload = {
        page_id: selectedConfigForEntries.platform === 'messenger' ? selectedConfigForEntries.id : null,
        session_name: selectedConfigForEntries.platform === 'whatsapp' ? selectedConfigForEntries.id : null,
      };

      const response = await fetch(`${BACKEND_URL}/api/db-admin/semantic-cache/clear`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      
      const data = await response.json();
      if (data.success) {
        toast.success('All cache entries cleared');
        setIsClearConfirmOpen(false);
        fetchCacheEntries(selectedConfigForEntries.platform, selectedConfigForEntries.id);
      } else {
        toast.error(data.error || "Clear failed");
      }
    } catch (error) {
      toast.error('Failed to clear cache');
    }
  };

  const updateCacheConfig = async (config: CacheConfig, updates: Partial<CacheConfig>) => {
    try {
      const token = getAdminToken();
      const res = await fetch(`${BACKEND_URL}/api/db-admin/cache-configs/update`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          platform: config.platform,
          id: config.id,
          ...updates
        })
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Config updated");
        setCacheConfigs(prev => prev.map(c => 
          (c.id === config.id && c.platform === config.platform) ? { ...c, ...updates } : c
        ));
      } else {
        toast.error(data.error || "Update failed");
      }
    } catch (error) {
      toast.error("Update failed");
    }
  };

  const fetchEmbeddingConfig = async () => {
    try {
      const token = getAdminToken();
      const res = await fetch(`${BACKEND_URL}/api/db-admin/embedding-config`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success && data.config) {
        setEmbeddingConfig(data.config);
      }
    } catch (error) {
      console.error("Failed to load embedding config", error);
    }
  };

  const saveEmbeddingConfig = async () => {
    try {
      const token = getAdminToken();
      const res = await fetch(`${BACKEND_URL}/api/db-admin/embedding-config`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(embeddingConfig)
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Embedding config saved");
      } else {
        toast.error(data.error || "Failed to save embedding config");
      }
    } catch (error) {
      toast.error("Failed to save embedding config");
    }
  };

  const filteredCacheConfigs = cacheConfigs
    .filter(c => (cachePlatform === 'all' ? true : c.platform === cachePlatform))
    .filter(c => {
      const search = cacheSearch.toLowerCase();
      const nameMatch = c.name?.toLowerCase().includes(search);
      const idMatch = c.id?.toString().toLowerCase().includes(search);
      return nameMatch || idMatch;
    });

  const paginatedCacheConfigs = filteredCacheConfigs.slice(
    (cachePage - 1) * cacheLimit,
    cachePage * cacheLimit
  );

  const totalCachePages = Math.ceil(filteredCacheConfigs.length / cacheLimit);

  const fetchEngineData = async (page = 1) => {
    try {
      setEngineStatsLoading(true);
      const token = getAdminToken();
      if (!token) return;

      // Fetch Stats with Provider Filter and Pagination
      let statsUrl = `${BACKEND_URL}/api/api-engine/stats?page=${page}&limit=10`;
      if (engineFilter !== "all") {
        statsUrl += `&provider=${engineFilter}`;
      }
      if (engineSearch.trim()) {
        statsUrl += `&q=${encodeURIComponent(engineSearch.trim())}`;
      }

      const statsRes = await fetch(statsUrl, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (statsRes.ok) {
        const data = await statsRes.json();
        setEngineStats(data);
        // Use the filtered keys from the stats response
        if (data.keys) {
          setEngineKeys(data.keys);
          setEngineTotal(data.total || 0);
          setEnginePage(data.page || 1);
        }
      }

      // Fetch Configs
      const configRes = await fetch(`${BACKEND_URL}/api/api-engine/config`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (configRes.ok) setEngineConfigs(await configRes.json());

      // Fetch Rotation Logs
      const logsRes = await fetch(`${BACKEND_URL}/api/api-list/logs`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (logsRes.ok) {
        const logsData = await logsRes.json();
        if (logsData.success) setRotationLogs(logsData.logs || []);
      }

      // Fetch Global Engine Configs
      const globalConfigRes = await fetch(`${BACKEND_URL}/api/api-list/config`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const globalConfigData = await globalConfigRes.json();
      if (globalConfigRes.ok && globalConfigData.success) {
        setGlobalConfigs(globalConfigData.configs || []);
        const current = globalConfigData.configs.find((c: any) => c.provider === selectedConfigProvider);
        if (current) setConfigValues(current);
      }

      // If no filter, we might want to fetch all keys for the regular list (optional)
      // For now, let's stick to the 10-key pool requirement
      /*
      const keysRes = await fetch(`${BACKEND_URL}/api/api-list`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const keysData = await keysRes.json();
      if (keysData.success) setEngineKeys(keysData.items);
      */

    } catch (error) {
      console.error(error);
      toast.error("Failed to load engine data");
    } finally {
      setEngineStatsLoading(false);
    }
  };

  const fetchEngineKeyValue = async (id: number) => {
    try {
      const token = getAdminToken();
      if (!token) return null;
      const res = await fetch(`${BACKEND_URL}/api/api-engine/keys/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        toast.error(data.error || "Failed to load key");
        return null;
      }
      return data.api as string;
    } catch {
      toast.error("Failed to load key");
      return null;
    }
  };

  const toggleRevealKey = async (id: number) => {
    if (engineRevealedKeys[id]) {
      setEngineRevealedKeys((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      return;
    }
    const value = await fetchEngineKeyValue(id);
    if (value) {
      setEngineRevealedKeys((prev) => ({ ...prev, [id]: value }));
    }
  };

  const copyEngineKey = async (id: number) => {
    let value = engineRevealedKeys[id];
    if (!value) {
      value = await fetchEngineKeyValue(id);
    }
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setEngineRevealedKeys((prev) => ({ ...prev, [id]: value }));
      toast.success("Key copied");
    } catch {
      toast.error("Copy failed");
    }
  };


  // Re-fetch when filter changes
  useEffect(() => {
    if (isAuthenticated) {
      setEnginePage(1);
      fetchEngineData(1);
    }
  }, [engineFilter]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const timer = setTimeout(() => {
      setEnginePage(1);
      fetchEngineData(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [engineSearch, isAuthenticated]);

  // Auto-refresh engine pool data (Active Rotation Pool)
  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(() => {
      fetchEngineData(enginePage);
    }, 10000); // 10 seconds
    return () => clearInterval(interval);
  }, [isAuthenticated, enginePage, engineFilter, engineSearch]);

  const updateEngineConfig = async (name: string, config: Partial<EngineConfig>) => {
    try {
      const token = getAdminToken();
      const res = await fetch(`${BACKEND_URL}/api/api-engine/config`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ name, ...config })
      });
      if (res.ok) {
        toast.success(`Updated ${name} configuration`);
        fetchEngineData();
      }
    } catch (error) {
      toast.error("Failed to update engine configuration");
    }
  };

  const fetchGlobalConfigs = async () => {
    try {
      const token = getAdminToken();
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

  const saveGlobalConfig = async () => {
    try {
      const token = getAdminToken();
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
      } else {
        toast.error(body.error || "Failed to save configuration");
      }
    } catch (error) {
      toast.error("Failed to save configuration");
    }
  };

  const refreshGlobalConfigCache = async () => {
    try {
      const token = getAdminToken();
      const res = await fetch(`${BACKEND_URL}/api/api-list/refresh-global-config-cache`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ provider: selectedConfigProvider })
      });
      const body = await res.json();
      if (res.ok && body.success) {
        toast.success("Config cache refreshed");
        fetchGlobalConfigs();
      } else {
        toast.error(body.error || "Failed to refresh cache");
      }
    } catch (error) {
      toast.error("Failed to refresh cache");
    }
  };

  const addEngineKey = async () => {
    if (!newApi) return toast.error("API Key is required");
    
    try {
      const token = getAdminToken();
      const res = await fetch(`${BACKEND_URL}/api/api-engine/keys`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ api: newApi, provider: engineProvider })
      });
      
      const data = await res.json();
      if (data.success) {
        toast.success("Key added to rotation pool");
        setNewApi("");
        fetchEngineData();
      } else {
        toast.error(data.error || "Failed to add key");
      }
    } catch (error) {
      toast.error("Failed to add key");
    }
  };

  const deleteEngineKey = async (id: number) => {
    if (!confirm("Are you sure?")) return;
    try {
      const token = getAdminToken();
      await fetch(`${BACKEND_URL}/api/api-engine/keys/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success("Key removed");
      fetchEngineData();
    } catch (error) {
      toast.error("Failed to delete key");
    }
  };

  const openInsertRow = () => {
    const initialFormState: any = {};
    dbColumns.forEach(col => {
      if (col.is_nullable === 'YES') {
        initialFormState[col.column_name] = null;
      } else {
        // Attempt to provide a sensible default based on data type
        if (col.data_type.includes('char') || col.data_type.includes('text')) {
          initialFormState[col.column_name] = "";
        } else if (col.data_type.includes('int') || col.data_type.includes('numeric') || col.data_type.includes('serial')) {
          initialFormState[col.column_name] = 0;
        } else if (col.data_type.includes('boolean')) {
          initialFormState[col.column_name] = false;
        } else if (col.data_type.includes('timestamp')) {
          initialFormState[col.column_name] = new Date().toISOString();
        } else {
          initialFormState[col.column_name] = "";
        }
      }
    });
    setInsertForm(initialFormState);
    setInsertDialogOpen(true);
  };

  const fetchDbTables = async () => {
    try {
      setDbTablesLoading(true);
      const token = getAdminToken();
      const res = await fetch(`${BACKEND_URL}/api/db-admin/tables`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to load tables");
      }
      setDbTables(data.tables || []);
    } catch (error: any) {
      toast.error(error.message || "Failed to load tables");
    } finally {
      setDbTablesLoading(false);
    }
  };

  const loadTableData = async (tableName: string, offset = 0) => {
    try {
      setDbLoading(true);
      setDbError(null);
      const token = getAdminToken();
      const res = await fetch(`${BACKEND_URL}/api/db-admin/table/${encodeURIComponent(tableName)}?limit=${dbLimit}&offset=${offset}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to load table data");
      }
      setSelectedTable(tableName);
      setDbColumns(data.columns || []);
      setDbRows(data.rows || []);
      setDbOffset(offset);
    } catch (error: any) {
      const message = error.message || "Failed to load table data";
      setDbError(message);
      toast.error(message);
    } finally {
      setDbLoading(false);
    }
  };

  const openEditRow = (row: any) => {
    setEditingRow(row);
    setInsertForm({ ...row }); // Reuse insertForm for editing to have card-like feel
    setEditDialogOpen(true);
  };

  const handleSaveRow = async () => {
    if (!selectedTable || !editingRow) return;
    const keyColumn = dbColumns[0]?.column_name;
    if (!keyColumn) {
      toast.error("No key column found");
      return;
    }
    const keyValue = editingRow[keyColumn];
    try {
      const token = getAdminToken();
      const res = await fetch(`${BACKEND_URL}/api/db-admin/table/${encodeURIComponent(selectedTable)}/update`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          keyColumn,
          keyValue,
          row: insertForm,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to update row");
      }
      toast.success("Row updated");
      setEditDialogOpen(false);
      loadTableData(selectedTable, dbOffset);
    } catch (error: any) {
      toast.error(error.message || "Failed to update row");
    }
  };

  const handleDeleteRow = async (row: any) => {
    if (!selectedTable) return;
    const keyColumn = dbColumns[0]?.column_name;
    if (!keyColumn) {
      toast.error("No key column found");
      return;
    }
    const keyValue = row[keyColumn];
    if (keyValue === undefined || keyValue === null) {
      toast.error("Row has no key value");
      return;
    }
    const confirmed = window.confirm("Are you sure you want to delete this row?");
    if (!confirmed) return;
    try {
      const token = getAdminToken();
      const res = await fetch(`${BACKEND_URL}/api/db-admin/table/${encodeURIComponent(selectedTable)}/delete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          keyColumn,
          keyValue,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to delete row");
      }
      toast.success("Row deleted");
      loadTableData(selectedTable, dbOffset);
    } catch (error: any) {
      toast.error(error.message || "Failed to delete row");
    }
  };

  const handleInsertRow = async () => {
    if (!selectedTable) return;
    try {
      // Convert empty strings to null for nullable columns
      const rowToInsert = { ...insertForm };
      for (const col of dbColumns) {
        if (col.is_nullable === 'YES' && rowToInsert[col.column_name] === '') {
          rowToInsert[col.column_name] = null;
        }
      }

      const token = getAdminToken();
      const res = await fetch(`${BACKEND_URL}/api/db-admin/table/${encodeURIComponent(selectedTable)}/insert`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          row: rowToInsert,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to insert row");
      }
      toast.success("Row inserted");
      setInsertDialogOpen(false);
      loadTableData(selectedTable, dbOffset);
    } catch (error: any) {
      toast.error(error.message || "Failed to insert row");
    }
  };

  const handleCreateTable = async () => {
    if (!newTableName.trim()) {
      toast.error("Table name is required");
      return;
    }
    const columns = newColumns
      .map((c) => ({
        name: c.name.trim(),
        type: c.type.trim(),
        nullable: c.nullable,
      }))
      .filter((c) => c.name && c.type);
    if (columns.length === 0) {
      toast.error("At least one valid column is required");
      return;
    }
    try {
      const token = getAdminToken();
      const res = await fetch(`${BACKEND_URL}/api/db-admin/table`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          table: newTableName.trim(),
          columns,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to create table");
      }
      toast.success("Table created");
      setCreateTableDialogOpen(false);
      setNewTableName("");
      setNewColumns([{ name: "id", type: "bigserial primary key", nullable: false }]);
      fetchDbTables();
      loadTableData(newTableName.trim(), 0);
    } catch (error: any) {
      toast.error(error.message || "Failed to create table");
    }
  };

  const handleAddColumn = async () => {
    if (!selectedTable) return;
    if (!newColumnName.trim() || !newColumnType.trim()) {
      toast.error("Column name and type are required");
      return;
    }
    try {
      const token = getAdminToken();
      const res = await fetch(`${BACKEND_URL}/api/db-admin/table/${encodeURIComponent(selectedTable)}/column`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          column: {
            name: newColumnName.trim(),
            type: newColumnType.trim(),
            nullable: newColumnNullable,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to add column");
      }
      toast.success("Column added");
      setAddColumnDialogOpen(false);
      setNewColumnName("");
      setNewColumnType("");
      setNewColumnNullable(true);
      loadTableData(selectedTable, dbOffset);
    } catch (error: any) {
      toast.error(error.message || "Failed to add column");
    }
  };

  const handleRunSql = async () => {
    if (!sqlText.trim()) {
      toast.error("SQL is empty");
      return;
    }
    setSqlRunning(true);
    setSqlError(null);
    setSqlResult(null);
    try {
      const token = getAdminToken();
      const res = await fetch(`${BACKEND_URL}/api/db-admin/sql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ sql: sqlText }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to run SQL");
      }
      setSqlResult(data);
      toast.success("SQL executed");
      fetchDbTables();
    } catch (error: any) {
      const message = error.message || "Failed to run SQL";
      setSqlError(message);
      toast.error(message);
    } finally {
      setSqlRunning(false);
    }
  };

  const handleLogin = async () => {
    if (!usernameInput || !passwordInput) {
      toast.error("Please enter username and password");
      return;
    }

    setLoginLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: usernameInput, password: passwordInput }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Invalid credentials");
      }

      const body = await res.json().catch(() => ({} as any));
      if (body && body.token) {
        localStorage.setItem("admin_token", String(body.token));
      }
      setIsAuthenticated(true);
      toast.success("Login successful");
    } catch (error: any) {
      console.error(error);
      toast.error("Login failed: " + (error.message || "Unknown error"));
    } finally {
      setLoginLoading(false);
    }
  };

  const fetchTransactions = async () => {
    try {
      setLoadingTxns(true);
      const token = getAdminToken();
      const res = await fetch(`${BACKEND_URL}/api/auth/admin/transactions`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.transactions)) {
        setTransactions(data.transactions as Transaction[]);
      }
    } finally {
      setLoadingTxns(false);
    }
  };

  const fetchCoupons = async () => {
    try {
      setLoadingCoupons(true);
      const token = getAdminToken();
      const res = await fetch(`${BACKEND_URL}/api/auth/admin/coupons`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.coupons)) {
        setCoupons(data.coupons as Coupon[]);
      }
    } finally {
      setLoadingCoupons(false);
    }
  };

  const handleApproveTxn = async (txn: any) => {
    try {
      setProcessingId(txn.id);
      const token = getAdminToken();
      const res = await fetch(`${BACKEND_URL}/api/auth/admin/transactions/${txn.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to approve");
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
      const token = getAdminToken();
      const res = await fetch(`${BACKEND_URL}/api/auth/admin/transactions/${txn.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error("Failed to reject");
      }
      
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
      const token = getAdminToken();
      const res = await fetch(`${BACKEND_URL}/api/auth/admin/coupons`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          code: couponCode,
          value: Number(couponValue),
          type: couponType,
          usage_limit: Number(couponUsageLimit),
          per_user_limit: Number(couponPerUserLimit),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to create coupon");
      }

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
    try {
      const token = getAdminToken();
      const res = await fetch(`${BACKEND_URL}/api/auth/admin/coupons/${coupon.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        throw new Error("Failed to update status");
      }
      fetchCoupons();
    } catch {
      toast.error("Failed to update coupon status");
    }
  };

  const handleManualTopup = async () => {
    if (!topupEmail || !topupAmount) {
      toast.error("Email and Amount are required");
      return;
    }

    setTopupLoading(true);
    try {
      const token = getAdminToken();
      const res = await fetch(`${BACKEND_URL}/api/auth/admin/topup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
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
    setGeminiLoading(true);
    setGeminiError(null);
    setGeminiResults([]);
    const modelLabel = geminiModel ? `model "${geminiModel}"` : "default models";
    setGeminiLog([`Starting API pool test with ${modelLabel}...`]);
    setGeminiSelectedIds([]);

    try {
      const response = await fetch(`${BACKEND_URL}/api/openrouter/pool/test-keys`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: geminiModel,
          message: geminiMessage,
          provider: geminiProviderFilter,
          mark_failed: geminiMarkDead
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        const errorMessage = data?.error || "Failed to run API pool test";
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
      const failedIds = list.filter((r) => !r.success).map((r) => r.id);
      setGeminiSelectedIds(failedIds);
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
      toast.success("API pool test completed");
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

  const handleDeleteFailedGeminiKeys = async () => {
    const failedIds = geminiSelectedIds.filter((id) =>
      geminiResults.some((r) => r.id === id && !r.success)
    );

    if (failedIds.length === 0) {
      toast.error("No failed keys selected for delete");
      return;
    }

    const confirmDelete = window.confirm(
      `Are you sure you want to delete ${failedIds.length} failed keys from api_list?`
    );
    if (!confirmDelete) return;

    try {
      const response = await fetch(`${BACKEND_URL}/api/openrouter/pool/delete-keys`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ids: failedIds }),
      });

      const data = await response.json();

      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Failed to delete API keys");
      }

      const deletedCount = data.deleted ?? failedIds.length;
      toast.success(`Deleted ${deletedCount} failed keys`);

      setGeminiResults((prev) => prev.filter((r) => !failedIds.includes(r.id)));
      setGeminiSelectedIds((prev) => prev.filter((id) => !failedIds.includes(id)));
    } catch (error: any) {
      toast.error(error?.message || "Failed to delete Gemini keys");
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
      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="bg-secondary/50 backdrop-blur-sm border border-white/5 p-1">
          <TabsTrigger value="payments" className="data-[state=active]:bg-primary data-[state=active]:text-black transition-all">Payments</TabsTrigger>
          <TabsTrigger value="finance" className="data-[state=active]:bg-primary data-[state=active]:text-black transition-all">Finance</TabsTrigger>
          <TabsTrigger value="engine" className="data-[state=active]:bg-primary data-[state=active]:text-black transition-all">Engine Test</TabsTrigger>
          <TabsTrigger value="api-engine" className="data-[state=active]:bg-primary data-[state=active]:text-black transition-all">API Engine</TabsTrigger>
          <TabsTrigger value="gemini" className="data-[state=active]:bg-primary data-[state=active]:text-black transition-all">Gemini Monitor</TabsTrigger>
          <TabsTrigger value="cache" className="text-blue-400 font-bold data-[state=active]:bg-blue-500 data-[state=active]:text-white transition-all">Semantic Cache</TabsTrigger>
          <TabsTrigger value="db" className="data-[state=active]:bg-[#00ff88] data-[state=active]:text-black transition-all font-bold">Database Admin</TabsTrigger>
          <TabsTrigger value="openrouter" className="data-[state=active]:bg-primary data-[state=active]:text-black transition-all">OpenRouter Config</TabsTrigger>
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
                            <Badge 
                              variant="secondary"
                              className={
                                txn.status === 'completed' || txn.status === 'approved' ? 'bg-green-100 text-green-700 hover:bg-green-100' :
                                txn.status === 'pending' ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-100' :
                                'bg-red-100 text-red-700 hover:bg-red-100'
                              }
                            >
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
                  <Label>Value (BDT / Credits)</Label>
                  <Input type="number" placeholder="500" value={couponValue} onChange={(e) => setCouponValue(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Coupon Type</Label>
                  <Select value={couponType} onValueChange={setCouponType}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="balance">Balance (BDT)</SelectItem>
                      <SelectItem value="credit">Message Credits</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Total Usage Limit</Label>
                    <Input type="number" value={couponUsageLimit} onChange={(e) => setCouponUsageLimit(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Per User Limit</Label>
                    <Input type="number" value={couponPerUserLimit} onChange={(e) => setCouponPerUserLimit(e.target.value)} />
                  </div>
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
                      <TableHead>Type</TableHead>
                      <TableHead>Usage (Used/Total)</TableHead>
                      <TableHead>Per User</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingCoupons ? (
                         <TableRow><TableCell colSpan={7}>Loading...</TableCell></TableRow>
                    ) : coupons.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-mono font-bold">{c.code}</TableCell>
                        <TableCell>{c.type === 'credit' ? `${c.value} Credits` : `৳${c.value}`}</TableCell>
                        <TableCell className="capitalize">{c.type}</TableCell>
                        <TableCell>{c.current_usage} / {c.usage_limit === 0 ? '∞' : c.usage_limit}</TableCell>
                        <TableCell>{c.per_user_limit === 0 ? '∞' : c.per_user_limit}</TableCell>
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
              <CardTitle>SalesmanChatbot 2.0 Engine Test</CardTitle>
              <CardDescription>
                Send a test message to SalesmanChatbot 2.0 (salesmanchatbot-pro/flash/lite) using a Service API key.
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
                  <span className="text-sm">SalesmanChatbot 2.0 Pro</span>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={engineModels.flash}
                    onCheckedChange={(checked) =>
                      setEngineModels((prev) => ({ ...prev, flash: Boolean(checked) }))
                    }
                  />
                  <span className="text-sm">SalesmanChatbot 2.0 Flash</span>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={engineModels.lite}
                    onCheckedChange={(checked) =>
                      setEngineModels((prev) => ({ ...prev, lite: Boolean(checked) }))
                    }
                  />
                  <span className="text-sm">SalesmanChatbot 2.0 Lite</span>
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

        {/* API Engine Tab */}
        <TabsContent value="api-engine" className="space-y-6">
          {/* Engine Model Configuration */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {engineConfigs.map((config) => (
              <Card key={config.id} className="border-primary/20 bg-card/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Cpu className="h-5 w-5 text-primary" />
                    {config.name === 'salesmanchatbot-pro' ? 'SalesmanChatbot 2.0 Pro Engine (Google)' : 
                     config.name === 'salesmanchatbot-flash' ? 'SalesmanChatbot 2.0 Flash Engine (OpenRouter)' : 
                     'SalesmanChatbot 2.0 Lite Engine (Groq)'}
                  </CardTitle>
                  <CardDescription>Configure models for {config.name}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-xs">Text Model</Label>
                    <Input 
                      value={config.text_model} 
                      onChange={(e) => updateEngineConfig(config.name, { text_model: e.target.value })}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Voice Model</Label>
                    <Input 
                      value={config.voice_model} 
                      onChange={(e) => updateEngineConfig(config.name, { voice_model: e.target.value })}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Image Model</Label>
                    <Input 
                      value={config.image_model} 
                      onChange={(e) => updateEngineConfig(config.name, { image_model: e.target.value })}
                      className="h-8 text-xs"
                    />
                  </div>
                  
                  <div className="pt-2 border-t border-white/5 space-y-3">
                    <div className="space-y-2">
                      <Label className="text-[10px] text-muted-foreground uppercase">Voice Provider Override</Label>
                      <Select 
                        value={config.voice_provider_override || "none"} 
                        onValueChange={(val) => updateEngineConfig(config.name, { voice_provider_override: val === "none" ? null : val })}
                      >
                        <SelectTrigger className="h-7 text-[11px]">
                          <SelectValue placeholder="No Override" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Default (Same Engine)</SelectItem>
                          <SelectItem value="salesmanchatbot-pro">Use 2.0 Pro (Google)</SelectItem>
                          <SelectItem value="salesmanchatbot-flash">Use 2.0 Flash (OpenRouter)</SelectItem>
                          <SelectItem value="salesmanchatbot-lite">Use 2.0 Lite (Groq)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[10px] text-muted-foreground uppercase">Image Provider Override</Label>
                      <Select 
                        value={config.image_provider_override || "none"} 
                        onValueChange={(val) => updateEngineConfig(config.name, { image_provider_override: val === "none" ? null : val })}
                      >
                        <SelectTrigger className="h-7 text-[11px]">
                          <SelectValue placeholder="No Override" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Default (Same Engine)</SelectItem>
                          <SelectItem value="salesmanchatbot-pro">Use 2.0 Pro (Google)</SelectItem>
                          <SelectItem value="salesmanchatbot-flash">Use 2.0 Flash (OpenRouter)</SelectItem>
                          <SelectItem value="salesmanchatbot-lite">Use 2.0 Lite (Groq)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="bg-card/50 backdrop-blur border-primary/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Engine Status</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <div className={`h-3 w-3 rounded-full ${engineStats?.engine_status === 'online' ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                  <span className="text-2xl font-bold capitalize">{engineStats?.engine_status || 'Offline'}</span>
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-card/50 backdrop-blur border-white/10">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Active Keys</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-green-400" />
                  <span className="text-2xl font-bold">{engineStats?.active_keys || 0}</span>
                  <span className="text-xs text-muted-foreground">/ {engineStats?.total_keys || 0}</span>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/50 backdrop-blur border-white/10">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Dead Keys</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-red-400" />
                  <span className="text-2xl font-bold">{engineStats?.dead_keys || 0}</span>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/50 backdrop-blur border-white/10">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Providers</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2 text-xs flex-wrap">
                  <Badge variant="outline" className="bg-blue-500/10 text-blue-400">G: {engineStats?.providers?.google || 0}</Badge>
                  <Badge variant="outline" className="bg-orange-500/10 text-orange-400">O: {engineStats?.providers?.openai || 0}</Badge>
                  <Badge variant="outline" className="bg-purple-500/10 text-purple-400">Gq: {engineStats?.providers?.groq || 0}</Badge>
                  <Badge variant="outline" className="bg-cyan-500/10 text-cyan-400">OR: {engineStats?.providers?.openrouter || 0}</Badge>
                  <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400">M: {engineStats?.providers?.mistral || 0}</Badge>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Global Models Configuration Card */}
          <Card className="border-white/10 bg-[#0f0f0f]/50">
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-[#00ff88]">
                <div className="flex items-center gap-2">
                  <Cpu className="h-5 w-5" />
                  Global Provider Models Configuration
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={refreshGlobalConfigCache}>
                    <RefreshCw className="mr-2 h-4 w-4" /> Refresh Cache
                  </Button>
                  <div className="w-[180px]">
                    <Select 
                      value={selectedConfigProvider} 
                      onValueChange={(val) => {
                        setSelectedConfigProvider(val);
                        const current = globalConfigs.find(c => c.provider === val);
                        if (current) {
                          setConfigValues(current);
                        } else {
                          setConfigValues({
                            provider: val,
                            text_model: val === 'google' ? 'gemini-2.5-flash' : val === 'mistral' ? 'mistral-small-latest' : '',
                            vision_model: val === 'google' ? 'gemini-2.5-flash' : val === 'mistral' ? 'mistral-small-latest' : '',
                            voice_model: val === 'google' ? 'gemini-2.5-flash-lite' : val === 'mistral' ? 'mistral-small-latest' : '',
                            text_provider_override: null,
                            vision_provider_override: null,
                            voice_provider_override: null,
                            text_rpm: 0,
                            text_rpd: 0,
                            text_rph: 0,
                            vision_rpm: 0,
                            vision_rpd: 0,
                            vision_rph: 0,
                            voice_rpm: 0,
                            voice_rpd: 0,
                            voice_rph: 0
                          });
                        }
                      }}
                    >
                      <SelectTrigger className="bg-black/40 border-white/10 h-8">
                        <SelectValue placeholder="Select Provider" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="google">Google Gemini</SelectItem>
                        <SelectItem value="groq">Groq (Llama)</SelectItem>
                        <SelectItem value="openrouter">OpenRouter</SelectItem>
                        <SelectItem value="openai">OpenAI</SelectItem>
                        <SelectItem value="mistral">Mistral</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardTitle>
              <CardDescription>
                Define models, cross-provider overrides, and rate limits for each modality.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Text Modality */}
              <div className="space-y-4 p-4 border border-white/5 rounded-lg bg-white/5">
                <div className="flex items-center gap-2 text-sm font-bold text-[#00ff88]">
                   Text Modality
                </div>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
                  <div className="space-y-2">
                    <Label className="text-xs">Model Name</Label>
                    <Input 
                      value={configValues.text_model} 
                      onChange={(e) => setConfigValues({...configValues, text_model: e.target.value})}
                      placeholder="e.g. gemini-2.5-flash"
                      className="bg-black/40 border-white/10 h-9"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Provider Override</Label>
                    <Select 
                      value={configValues.text_provider_override || "none"} 
                      onValueChange={(val) => setConfigValues({...configValues, text_provider_override: val === "none" ? null : val})}
                    >
                      <SelectTrigger className="bg-black/40 border-white/10 h-9">
                        <SelectValue placeholder="No Override" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Default ({selectedConfigProvider})</SelectItem>
                        <SelectItem value="google">Google Gemini</SelectItem>
                        <SelectItem value="groq">Groq (Llama)</SelectItem>
                        <SelectItem value="openrouter">OpenRouter</SelectItem>
                        <SelectItem value="openai">OpenAI</SelectItem>
                        <SelectItem value="mistral">Mistral</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">RPM (Req/Min)</Label>
                    <Input 
                      type="number"
                      value={configValues.text_rpm} 
                      onChange={(e) => setConfigValues({...configValues, text_rpm: parseInt(e.target.value) || 0})}
                      className="bg-black/40 border-white/10 h-9"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">RPH (Req/Hour)</Label>
                    <Input 
                      type="number"
                      value={configValues.text_rph} 
                      onChange={(e) => setConfigValues({...configValues, text_rph: parseInt(e.target.value) || 0})}
                      className="bg-black/40 border-white/10 h-9"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">RPD (Req/Day)</Label>
                    <Input 
                      type="number"
                      value={configValues.text_rpd} 
                      onChange={(e) => setConfigValues({...configValues, text_rpd: parseInt(e.target.value) || 0})}
                      className="bg-black/40 border-white/10 h-9"
                    />
                  </div>
                </div>
              </div>

              {/* Vision Modality */}
              <div className="space-y-4 p-4 border border-white/5 rounded-lg bg-white/5">
                <div className="flex items-center gap-2 text-sm font-bold text-orange-400">
                   Vision Modality
                </div>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
                  <div className="space-y-2">
                    <Label className="text-xs">Model Name</Label>
                    <Input 
                      value={configValues.vision_model} 
                      onChange={(e) => setConfigValues({...configValues, vision_model: e.target.value})}
                      placeholder="e.g. gemini-2.5-flash"
                      className="bg-black/40 border-white/10 h-9"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Provider Override</Label>
                    <Select 
                      value={configValues.vision_provider_override || "none"} 
                      onValueChange={(val) => setConfigValues({...configValues, vision_provider_override: val === "none" ? null : val})}
                    >
                      <SelectTrigger className="bg-black/40 border-white/10 h-9">
                        <SelectValue placeholder="No Override" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Default ({selectedConfigProvider})</SelectItem>
                        <SelectItem value="google">Google Gemini</SelectItem>
                        <SelectItem value="groq">Groq (Llama)</SelectItem>
                        <SelectItem value="openrouter">OpenRouter</SelectItem>
                        <SelectItem value="openai">OpenAI</SelectItem>
                        <SelectItem value="mistral">Mistral</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">RPM (Req/Min)</Label>
                    <Input 
                      type="number"
                      value={configValues.vision_rpm} 
                      onChange={(e) => setConfigValues({...configValues, vision_rpm: parseInt(e.target.value) || 0})}
                      className="bg-black/40 border-white/10 h-9"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">RPH (Req/Hour)</Label>
                    <Input 
                      type="number"
                      value={configValues.vision_rph} 
                      onChange={(e) => setConfigValues({...configValues, vision_rph: parseInt(e.target.value) || 0})}
                      className="bg-black/40 border-white/10 h-9"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">RPD (Req/Day)</Label>
                    <Input 
                      type="number"
                      value={configValues.vision_rpd} 
                      onChange={(e) => setConfigValues({...configValues, vision_rpd: parseInt(e.target.value) || 0})}
                      className="bg-black/40 border-white/10 h-9"
                    />
                  </div>
                </div>
              </div>

              {/* Voice Modality */}
              <div className="space-y-4 p-4 border border-white/5 rounded-lg bg-white/5">
                <div className="flex items-center gap-2 text-sm font-bold text-blue-400">
                   Voice Modality
                </div>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
                  <div className="space-y-2">
                    <Label className="text-xs">Model Name</Label>
                    <Input 
                      value={configValues.voice_model} 
                      onChange={(e) => setConfigValues({...configValues, voice_model: e.target.value})}
                      placeholder="e.g. gemini-2.5-flash-lite"
                      className="bg-black/40 border-white/10 h-9"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Provider Override</Label>
                    <Select 
                      value={configValues.voice_provider_override || "none"} 
                      onValueChange={(val) => setConfigValues({...configValues, voice_provider_override: val === "none" ? null : val})}
                    >
                      <SelectTrigger className="bg-black/40 border-white/10 h-9">
                        <SelectValue placeholder="No Override" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Default ({selectedConfigProvider})</SelectItem>
                        <SelectItem value="google">Google Gemini</SelectItem>
                        <SelectItem value="groq">Groq (Llama)</SelectItem>
                        <SelectItem value="openrouter">OpenRouter</SelectItem>
                        <SelectItem value="openai">OpenAI</SelectItem>
                        <SelectItem value="mistral">Mistral</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">RPM (Req/Min)</Label>
                    <Input 
                      type="number"
                      value={configValues.voice_rpm} 
                      onChange={(e) => setConfigValues({...configValues, voice_rpm: parseInt(e.target.value) || 0})}
                      className="bg-black/40 border-white/10 h-9"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">RPH (Req/Hour)</Label>
                    <Input 
                      type="number"
                      value={configValues.voice_rph} 
                      onChange={(e) => setConfigValues({...configValues, voice_rph: parseInt(e.target.value) || 0})}
                      className="bg-black/40 border-white/10 h-9"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">RPD (Req/Day)</Label>
                    <Input 
                      type="number"
                      value={configValues.voice_rpd} 
                      onChange={(e) => setConfigValues({...configValues, voice_rpd: parseInt(e.target.value) || 0})}
                      className="bg-black/40 border-white/10 h-9"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-4">
                <Button onClick={saveGlobalConfig} className="bg-[#00ff88] hover:bg-[#00cc77] text-black font-bold px-12">
                  Save All Configurations for {selectedConfigProvider.toUpperCase()}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Add Key Section */}
          <Card className="border-white/10 bg-[#0f0f0f]/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-primary">
                <Plus className="h-5 w-5" /> Add New API Key to Rotation Pool
              </CardTitle>
              <CardDescription>The engine will automatically handle rotation and failure recovery for these keys.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col md:flex-row gap-4">
                <div className="w-full md:w-[200px]">
                    <Select value={engineProvider} onValueChange={setEngineProvider}>
                    <SelectTrigger>
                        <SelectValue placeholder="Provider" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="google">Google Gemini</SelectItem>
                        <SelectItem value="groq">Groq (Llama)</SelectItem>
                        <SelectItem value="openrouter">OpenRouter</SelectItem>
                        <SelectItem value="openai">OpenAI</SelectItem>
                        <SelectItem value="mistral">Mistral</SelectItem>
                    </SelectContent>
                    </Select>
                </div>

                <Input 
                  placeholder="Paste API Key here..." 
                  value={newApi}
                  onChange={(e) => setNewApi(e.target.value)}
                  className="flex-1"
                />
                
                <Button onClick={addEngineKey} className="bg-primary hover:bg-primary/90">
                  <Plus className="mr-2 h-4 w-4" /> Add Key
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Key List */}
          <Card className="border-white/10">
            <CardHeader className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Server className="h-5 w-5" /> Active Rotation Pool
                </CardTitle>
                <CardDescription>Keys currently being used by the API Engine (Showing top 10).</CardDescription>
              </div>
              <div className="flex items-center gap-2 w-full md:w-auto">
                <Input
                  placeholder="Search key or provider..."
                  value={engineSearch}
                  onChange={(e) => setEngineSearch(e.target.value)}
                  className="w-full md:w-[220px]"
                />
                <Select value={engineFilter} onValueChange={setEngineFilter}>
                  <SelectTrigger className="w-[150px]">
                    <SelectValue placeholder="Filter Provider" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Providers</SelectItem>
                    <SelectItem value="google">Google Gemini</SelectItem>
                    <SelectItem value="openrouter">OpenRouter</SelectItem>
                    <SelectItem value="groq">Groq</SelectItem>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="mistral">Mistral</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={() => fetchEngineData(enginePage)}>
                  <RefreshCw className="h-4 w-4 mr-2" /> Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border border-white/10 overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead>Provider</TableHead>
                      <TableHead>Key (Preview)</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Usage (Today)</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                <TableBody>
                  {engineKeys.map((k) => {
                    const revealedKey = engineRevealedKeys[k.id];
                    return (
                      <TableRow key={k.id}>
                        <TableCell className="capitalize font-medium">{k.provider}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {revealedKey || k.api}
                        </TableCell>
                        <TableCell>
                          {k.cooldown_until && new Date(k.cooldown_until) > new Date() ? (
                            <div className="flex flex-col gap-1">
                              <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/20 w-fit">
                                <AlertTriangle className="mr-1 h-3 w-3" /> Locked (Cooldown)
                              </Badge>
                              <span className="text-[10px] text-amber-500/70 font-mono">
                                Ends: {new Date(k.cooldown_until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                          ) : (
                            <Badge variant={k.status === 'active' ? 'default' : 'destructive'} className={k.status === 'active' ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30' : ''}>
                              {k.status}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium text-primary text-lg">{k.usage_today || 0}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => toggleRevealKey(k.id)}>
                              {engineRevealedKeys[k.id] ? "Hide" : "Show"}
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => copyEngineKey(k.id)}>
                              Copy
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => deleteEngineKey(k.id)} className="text-red-400 hover:text-red-300 hover:bg-red-900/20">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {engineKeys.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          No API keys found in rotation pool.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination Controls */}
              {engineTotal > 10 && (
                <div className="flex items-center justify-between mt-4 px-2">
                  <div className="text-xs text-muted-foreground">
                    Showing {(enginePage - 1) * 10 + 1} to {Math.min(enginePage * 10, engineTotal)} of {engineTotal} keys
                  </div>
                  <div className="flex items-center gap-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      disabled={enginePage <= 1}
                      onClick={() => {
                        setEnginePage(enginePage - 1);
                        fetchEngineData(enginePage - 1);
                      }}
                      className="h-8 text-xs"
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" /> Previous
                    </Button>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: Math.ceil(engineTotal / 10) }).map((_, i) => (
                        <Button
                          key={i}
                          variant={enginePage === i + 1 ? "default" : "ghost"}
                          size="sm"
                          onClick={() => {
                            setEnginePage(i + 1);
                            fetchEngineData(i + 1);
                          }}
                          className="h-8 w-8 p-0 text-xs"
                        >
                          {i + 1}
                        </Button>
                      )).slice(Math.max(0, enginePage - 3), Math.min(Math.ceil(engineTotal / 10), enginePage + 2))}
                    </div>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      disabled={enginePage >= Math.ceil(engineTotal / 10)}
                      onClick={() => {
                        setEnginePage(enginePage + 1);
                        fetchEngineData(enginePage + 1);
                      }}
                      className="h-8 text-xs"
                    >
                      Next <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Rotation Logs */}
          <Card className="border-white/10 bg-black/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm font-bold">
                <Activity className="h-4 w-4 text-[#00ff88]" /> Recent Rotation Events
              </CardTitle>
              <CardDescription className="text-[10px]">Real-time key switching logs from the API Engine.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar text-[11px]">
                {rotationLogs.length > 0 ? (
                  rotationLogs.map((log, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0 hover:bg-white/5 px-2 rounded-sm transition-colors">
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground w-16">{new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                        <Badge variant="outline" className="text-[9px] uppercase border-white/10 px-1 py-0 h-4">{log.provider}</Badge>
                        <span className="font-mono text-primary/80">{log.key}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">Index:</span>
                        <span className="bg-white/10 px-1.5 rounded font-bold text-white">{log.index}/{log.total}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-4 text-muted-foreground">No rotation events yet. Start using the API to see logs.</div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="gemini" className="space-y-4">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle>API Pool Monitor</CardTitle>
              <CardDescription>
                Test all keys from api_list and auto‑mark failed keys as dead if enabled.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>Provider</Label>
                  <Select value={geminiProviderFilter} onValueChange={setGeminiProviderFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="All Providers" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Providers</SelectItem>
                      <SelectItem value="google">Google Gemini</SelectItem>
                      <SelectItem value="openrouter">OpenRouter</SelectItem>
                      <SelectItem value="groq">Groq</SelectItem>
                      <SelectItem value="openai">OpenAI</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Model Override (Optional)</Label>
                  <Input
                    value={geminiModel}
                    onChange={(e) => setGeminiModel(e.target.value)}
                    placeholder="leave empty for per‑key model"
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
              <div className="flex flex-wrap items-center gap-4">
                <Button onClick={handleRunGeminiTest} disabled={geminiLoading}>
                  {geminiLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Run API Pool Test
                </Button>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={geminiMarkDead}
                    onChange={(e) => setGeminiMarkDead(e.target.checked)}
                  />
                  Mark failed keys as dead
                </label>
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
                      <TableHead className="w-[32px]">
                        <input
                          type="checkbox"
                          className="h-3 w-3"
                          checked={
                            geminiResults.length > 0 &&
                            geminiResults
                              .filter((r) => !r.success)
                              .every((r) => geminiSelectedIds.includes(r.id))
                          }
                          onChange={(e) => {
                            if (e.target.checked) {
                              setGeminiSelectedIds(
                                geminiResults.filter((r) => !r.success).map((r) => r.id)
                              );
                            } else {
                              setGeminiSelectedIds([]);
                            }
                          }}
                        />
                      </TableHead>
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
                        <TableCell colSpan={6} className="text-center">
                          No results yet. Run a test to see key status.
                        </TableCell>
                      </TableRow>
                    ) : (
                      geminiResults.map((r) => (
                        <TableRow key={r.id} className={!r.success ? "bg-destructive/5" : ""}>
                          <TableCell>
                            <input
                              type="checkbox"
                              className="h-3 w-3"
                              disabled={r.success}
                              checked={geminiSelectedIds.includes(r.id)}
                              onChange={() => {
                                if (r.success) return;
                                setGeminiSelectedIds((prev) =>
                                  prev.includes(r.id)
                                    ? prev.filter((id) => id !== r.id)
                                    : [...prev, r.id]
                                );
                              }}
                            />
                          </TableCell>
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
              {geminiResults.some((r) => !r.success) && (
                <div className="flex items-center justify-between pt-2">
                  <div className="text-xs text-muted-foreground">
                    Selected failed: {geminiSelectedIds.filter((id) =>
                      geminiResults.some((r) => r.id === id && !r.success)
                    ).length}
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDeleteFailedGeminiKeys}
                    disabled={
                      geminiSelectedIds.filter((id) =>
                        geminiResults.some((r) => r.id === id && !r.success)
                      ).length === 0
                    }
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete Selected Failed
                  </Button>
                </div>
              )}
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

        {/* Semantic Cache Tab */}
        <TabsContent value="cache" className="space-y-4">
          <Card className="border-white/10 bg-black/40 backdrop-blur-md">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <div>
                <CardTitle className="text-lg font-bold flex items-center gap-2">
                   <Cpu className="h-5 w-5 text-[#00ff88]" />
                   Global Embedding Model
                </CardTitle>
                <CardDescription>Common configuration for all semantic lookups</CardDescription>
              </div>
              <Button 
                onClick={saveEmbeddingConfig}
                className="bg-[#00ff88] hover:bg-[#00ff88]/90 text-black font-bold h-8 px-6"
              >
                Save Global Config
              </Button>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label className="text-xs uppercase text-muted-foreground">Provider</Label>
                <Select value={embeddingConfig.provider} onValueChange={(val) => setEmbeddingConfig({ ...embeddingConfig, provider: val })}>
                  <SelectTrigger className="h-9 bg-black/40 border-white/10">
                    <SelectValue placeholder="Select Provider" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="google">Google</SelectItem>
                    <SelectItem value="openrouter">OpenRouter</SelectItem>
                    <SelectItem value="groq">Groq</SelectItem>
                    <SelectItem value="mistral">Mistral</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs uppercase text-muted-foreground">Base URL</Label>
                <Input 
                  placeholder="https://api.openai.com/v1"
                  value={embeddingConfig.base_url}
                  onChange={(e) => setEmbeddingConfig({ ...embeddingConfig, base_url: e.target.value })}
                  className="h-9 bg-black/40 border-white/10 font-mono text-xs"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs uppercase text-muted-foreground">API Key</Label>
                <Input 
                  type="password"
                  placeholder="sk-..."
                  value={embeddingConfig.api_key}
                  onChange={(e) => setEmbeddingConfig({ ...embeddingConfig, api_key: e.target.value })}
                  className="h-9 bg-black/40 border-white/10 font-mono text-xs"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs uppercase text-muted-foreground">Model Name</Label>
                <Input 
                  placeholder="text-embedding-3-small"
                  value={embeddingConfig.model}
                  onChange={(e) => setEmbeddingConfig({ ...embeddingConfig, model: e.target.value })}
                  className="h-9 bg-black/40 border-white/10 font-mono text-xs"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-black/20 backdrop-blur-md">
            <CardHeader className="flex flex-col md:flex-row md:items-center justify-between space-y-4 md:space-y-0 pb-6">
              <div>
                <CardTitle className="text-xl font-bold text-white flex items-center gap-2">
                  <DatabaseIcon className="h-6 w-6 text-blue-400" />
                  Semantic Cache Control
                </CardTitle>
                <CardDescription>Manage automation settings for all connected accounts</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="w-36">
                  <Select value={cachePlatform} onValueChange={(val) => {
                    setCachePlatform(val as any);
                    setCachePage(1);
                  }}>
                    <SelectTrigger className="h-9 bg-black/40 border-white/10">
                      <SelectValue placeholder="Platform" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Platforms</SelectItem>
                      <SelectItem value="messenger">Facebook</SelectItem>
                      <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="relative w-64">
                  <Input
                    placeholder="Search by ID or Name..."
                    value={cacheSearch}
                    onChange={(e) => {
                      setCacheSearch(e.target.value);
                      setCachePage(1);
                    }}
                    className="h-9 bg-black/40 border-white/10 pl-9"
                  />
                  <div className="absolute left-3 top-2.5 text-muted-foreground">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                  </div>
                </div>
                <Button 
                  size="icon"
                  variant="outline" 
                  onClick={fetchCacheConfigs}
                  disabled={cacheLoading}
                  className="h-9 w-9 border-white/10 bg-black/20"
                >
                  <RefreshCw className={`h-4 w-4 ${cacheLoading ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-xl border border-white/5 bg-black/30 overflow-hidden shadow-2xl">
                <Table>
                  <TableHeader className="bg-white/5">
                    <TableRow className="hover:bg-transparent border-white/10">
                      <TableHead className="py-3 text-xs uppercase tracking-wider font-semibold text-white/50">Platform</TableHead>
                      <TableHead className="py-3 text-xs uppercase tracking-wider font-semibold text-white/50">Account Name / ID</TableHead>
                      <TableHead className="py-3 text-xs uppercase tracking-wider font-semibold text-white/50 text-center">Cache Status</TableHead>
                      <TableHead className="py-3 text-xs uppercase tracking-wider font-semibold text-white/50 text-right">Added On</TableHead>
                      <TableHead className="py-3 text-xs uppercase tracking-wider font-semibold text-white/50 text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cacheLoading && paginatedCacheConfigs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-20">
                          <div className="flex flex-col items-center gap-3">
                            <Loader2 className="h-10 w-10 animate-spin text-blue-500" />
                            <p className="text-muted-foreground animate-pulse">Syncing accounts...</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : paginatedCacheConfigs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-20">
                          <div className="flex flex-col items-center gap-2 text-muted-foreground">
                            <AlertTriangle className="h-10 w-10 opacity-20" />
                            <p>No connected accounts found matching your filters.</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedCacheConfigs.map((config) => (
                        <TableRow key={`${config.platform}-${config.id}`} className="hover:bg-white/5 border-white/5 group transition-colors">
                          <TableCell className="py-4">
                            <div className="flex items-center gap-3">
                              {config.platform === 'messenger' ? (
                                <div className="p-2 rounded-lg bg-blue-500/10">
                                  <Facebook className="h-4 w-4 text-blue-500" />
                                </div>
                              ) : (
                                <div className="p-2 rounded-lg bg-green-500/10">
                                  <Smartphone className="h-4 w-4 text-green-500" />
                                </div>
                              )}
                              <Badge variant="outline" className={`text-[10px] px-1.5 h-5 capitalize ${config.platform === 'whatsapp' ? 'border-green-500/30 text-green-500 bg-green-500/5' : 'border-blue-500/30 text-blue-500 bg-blue-500/5'}`}>
                                {config.platform}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell className="py-4">
                            <div className="flex flex-col gap-0.5">
                              <span className="text-sm font-semibold text-white group-hover:text-blue-400 transition-colors truncate max-w-[280px]">
                                {config.name}
                              </span>
                              <span className="text-[10px] text-muted-foreground font-mono opacity-60">
                                ID: {config.id}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="py-4 text-center">
                            <Badge variant={config.semantic_cache_enabled ? "default" : "secondary"} className={`text-[10px] px-2 h-5 font-bold ${config.semantic_cache_enabled ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                              {config.semantic_cache_enabled ? 'ENABLED' : 'DISABLED'}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-4 text-right">
                            <span className="text-xs text-muted-foreground opacity-80">
                              {config.created_at ? new Date(config.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '-'}
                            </span>
                          </TableCell>
                          <TableCell className="py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Button 
                                size="sm" 
                                variant="outline" 
                                className="h-8 text-xs gap-2 font-medium px-3 border-white/10 hover:bg-blue-500/10 hover:text-blue-400"
                                onClick={() => {
                                  setSelectedConfigForEntries(config);
                                  fetchCacheEntries(config.platform, config.id);
                                  setIsEntriesDialogOpen(true);
                                }}
                              >
                                <DatabaseIcon className="h-3.5 w-3.5" />
                                Manage Cache
                              </Button>
                              <Button 
                                size="sm" 
                                variant="secondary" 
                                className="h-8 text-xs gap-2 font-bold px-4 bg-white/5 hover:bg-blue-500 hover:text-white border border-white/10 transition-all"
                                onClick={() => {
                                  setEditingCacheConfig({ ...config });
                                  setIsCacheDialogOpen(true);
                                }}
                              >
                                <Settings className="h-3.5 w-3.5" />
                                Config
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Enhanced Pagination */}
              {totalCachePages > 1 && (
                <div className="flex items-center justify-between mt-6 px-2">
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <span className="p-1.5 rounded-md bg-white/5 border border-white/10">
                      {filteredCacheConfigs.length} total accounts
                    </span>
                    <span>Page {cachePage} of {totalCachePages}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-3 border-white/10 bg-black/20 hover:bg-white/5"
                      onClick={() => setCachePage(p => Math.max(1, p - 1))}
                      disabled={cachePage === 1}
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" /> Previous
                    </Button>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: Math.min(5, totalCachePages) }).map((_, i) => {
                         let pageNum = cachePage <= 3 ? i + 1 : cachePage >= totalCachePages - 2 ? totalCachePages - 4 + i : cachePage - 2 + i;
                         if (pageNum < 1 || pageNum > totalCachePages) return null;
                         return (
                          <Button
                            key={pageNum}
                            variant={cachePage === pageNum ? "default" : "outline"}
                            size="sm"
                            className={`h-8 w-8 p-0 ${cachePage === pageNum ? 'bg-blue-600 border-blue-500' : 'border-white/10 bg-black/20 hover:bg-white/5'}`}
                            onClick={() => setCachePage(pageNum)}
                          >
                            {pageNum}
                          </Button>
                        );
                      })}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-3 border-white/10 bg-black/20 hover:bg-white/5"
                      onClick={() => setCachePage(p => Math.min(totalCachePages, p + 1))}
                      disabled={cachePage === totalCachePages}
                    >
                      Next <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="db">
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-[280px,1fr]">
              <Card className="h-full bg-card/50 border-white/5">
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
                    <DatabaseIcon className="h-4 w-4" />
                    Tables
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Input 
                      placeholder="Filter tables..." 
                      className="h-8 text-xs bg-black/20 border-white/10"
                      value={tableSearch}
                      onChange={(e) => setTableSearch(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 h-8 text-[10px] uppercase font-bold"
                        onClick={fetchDbTables}
                        disabled={dbTablesLoading}
                      >
                        <RefreshCw className={`mr-1 h-3 w-3 ${dbTablesLoading ? 'animate-spin' : ''}`} />
                        Refresh
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1 h-8 text-[10px] uppercase font-bold bg-[#00ff88] hover:bg-[#00ff88]/90 text-black"
                        onClick={() => setCreateTableDialogOpen(true)}
                      >
                        <Plus className="mr-1 h-3 w-3" />
                        Create
                      </Button>
                    </div>
                  </div>
                  
                  <div className="space-y-1 mt-4 max-h-[600px] overflow-y-auto custom-scrollbar pr-1">
                    {dbTables.length === 0 && !dbTablesLoading && (
                      <div className="p-3 text-xs text-muted-foreground text-center">No tables found.</div>
                    )}
                    {dbTables
                      .filter(t => t.toLowerCase().includes(tableSearch.toLowerCase()))
                      .map((t) => (
                      <button
                        key={t}
                        onClick={() => loadTableData(t, 0)}
                        className={`w-full text-left px-3 py-2 text-xs rounded-md transition-all duration-200 ${
                          selectedTable === t 
                            ? "bg-[#00ff88]/10 text-[#00ff88] font-bold border border-[#00ff88]/20" 
                            : "text-muted-foreground hover:bg-white/5 hover:text-white"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <div className={`h-1.5 w-1.5 rounded-full ${selectedTable === t ? 'bg-[#00ff88]' : 'bg-transparent'}`} />
                          {t}
                        </div>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="h-full border-white/5 bg-black/20 overflow-hidden flex flex-col">
                <CardHeader className="border-b border-white/5 bg-white/5 pb-4">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <CardTitle className="text-xl font-bold flex items-center gap-2">
                        {selectedTable ? (
                          <>
                            <DatabaseIcon className="h-5 w-5 text-[#00ff88]" />
                            {selectedTable}
                          </>
                        ) : "Select a table"}
                      </CardTitle>
                      <CardDescription className="text-xs">
                        {selectedTable ? `Manage records in ${selectedTable}` : "Choose a table from the sidebar to manage data"}
                      </CardDescription>
                    </div>
                    {selectedTable && (
                      <div className="flex items-center gap-3">
                        <div className="relative group">
                          <Input 
                            placeholder="Search records..." 
                            className="h-9 w-64 text-xs bg-black/40 border-white/10 pl-9 pr-8 focus:ring-1 focus:ring-[#00ff88] transition-all group-hover:border-white/20"
                            value={dbSearch}
                            onChange={(e) => setDbSearch(e.target.value)}
                          />
                          <svg className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground group-focus-within:text-[#00ff88] transition-colors" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                          {dbSearch && (
                            <button 
                              onClick={() => setDbSearch("")}
                              className="absolute right-2 top-2.5 h-4 w-4 text-muted-foreground hover:text-white transition-colors"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                        <div className="h-6 w-[1px] bg-white/10 mx-1" />
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 text-[10px] uppercase font-bold border-white/10 hover:bg-white/5"
                          onClick={() => setAddColumnDialogOpen(true)}
                        >
                          <Settings className="mr-1.5 h-3 w-3" />
                          Columns
                        </Button>
                        <Button
                          size="sm"
                          className="h-9 text-[10px] uppercase font-bold bg-[#00ff88] hover:bg-[#00ff88]/90 text-black shadow-[0_0_15px_rgba(0,255,136,0.2)] hover:shadow-[0_0_20px_rgba(0,255,136,0.4)] transition-all"
                          onClick={openInsertRow}
                        >
                          <Plus className="mr-1.5 h-3.5 w-3.5" />
                          New Record
                        </Button>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="p-0 flex-1 flex flex-col overflow-hidden">
                  {dbError && (
                    <div className="p-4 bg-red-500/10 border-b border-red-500/20 text-xs text-red-400 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4" />
                      {dbError}
                    </div>
                  )}
                  
                  <div className="flex-1 overflow-auto custom-scrollbar">
                    {dbLoading ? (
                      <div className="h-64 flex flex-col items-center justify-center gap-3 opacity-50">
                        <Loader2 className="h-8 w-8 animate-spin text-[#00ff88]" />
                        <p className="text-xs uppercase tracking-widest">Fetching records...</p>
                      </div>
                    ) : !selectedTable ? (
                      <div className="h-64 flex flex-col items-center justify-center gap-4 text-muted-foreground">
                        <DatabaseIcon className="h-12 w-12 opacity-10" />
                        <p className="text-sm font-medium">Select a table from the sidebar</p>
                      </div>
                    ) : (
                      <Table>
                        <TableHeader className="bg-white/5 sticky top-0 z-10">
                          <TableRow className="hover:bg-transparent border-white/5">
                            {dbColumns.map((col) => (
                              <TableHead key={col.column_name} className="py-3 text-[10px] uppercase font-bold text-muted-foreground whitespace-nowrap">
                                <div className="flex items-center gap-1.5">
                                  {col.column_name}
                                  <span className="text-[9px] font-normal opacity-40 lowercase">({col.data_type})</span>
                                </div>
                              </TableHead>
                            ))}
                            <TableHead className="py-3 text-right text-[10px] uppercase font-bold text-muted-foreground sticky right-0 bg-zinc-900 shadow-[-10px_0_10px_-10px_rgba(0,0,0,0.5)]">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {dbRows.length === 0 ? (
                            <TableRow>
                              <TableCell
                                colSpan={dbColumns.length + 1}
                                className="h-32 text-center text-muted-foreground text-xs"
                              >
                                No records found in this table.
                              </TableCell>
                            </TableRow>
                          ) : (
                            dbRows
                              .filter(row => {
                                if (!dbSearch) return true;
                                return Object.values(row).some(val => 
                                  String(val).toLowerCase().includes(dbSearch.toLowerCase())
                                );
                              })
                              .map((row, idx) => (
                              <TableRow key={idx} className="hover:bg-white/5 border-white/5 group transition-colors">
                                {dbColumns.map((col) => (
                                  <TableCell key={col.column_name} className="py-3 text-xs max-w-[200px] truncate font-mono text-muted-foreground group-hover:text-white">
                                    {row[col.column_name] === null ? (
                                      <span className="opacity-20 italic">null</span>
                                    ) : typeof row[col.column_name] === 'boolean' ? (
                                      <Badge variant="outline" className={`text-[10px] px-1 h-4 ${row[col.column_name] ? 'border-green-500/30 text-green-500 bg-green-500/5' : 'border-red-500/30 text-red-500 bg-red-500/5'}`}>
                                        {String(row[col.column_name])}
                                      </Badge>
                                    ) : (
                                      String(row[col.column_name])
                                    )}
                                  </TableCell>
                                ))}
                                <TableCell className="py-3 text-right sticky right-0 bg-transparent group-hover:bg-zinc-800 transition-colors shadow-[-10px_0_10px_-10px_rgba(0,0,0,0.5)]">
                                  <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                                      onClick={() => openEditRow(row)}
                                    >
                                      <Edit className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                      onClick={() => handleDeleteRow(row)}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    )}
                  </div>

                  {/* Table Footer / Pagination */}
                  {selectedTable && (
                    <div className="border-t border-white/5 bg-white/5 p-3 flex items-center justify-between">
                      <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">
                        Showing {dbOffset + 1} - {dbOffset + dbRows.length} Records
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[10px] uppercase font-bold border-white/10 bg-black/20"
                          onClick={() => loadTableData(selectedTable, Math.max(dbOffset - dbLimit, 0))}
                          disabled={dbLoading || dbOffset === 0}
                        >
                          <ChevronLeft className="h-3 w-3 mr-1" />
                          Previous
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[10px] uppercase font-bold border-white/10 bg-black/20"
                          onClick={() => loadTableData(selectedTable, dbOffset + dbLimit)}
                          disabled={dbLoading || dbRows.length < dbLimit}
                        >
                          Next
                          <ChevronRight className="h-3 w-3 ml-1" />
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>SQL Console</CardTitle>
                <CardDescription>Run SQL to create tables or query data in public schema</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {sqlError && (
                  <div className="text-sm text-red-500">
                    {sqlError}
                  </div>
                )}
                <Textarea
                  value={sqlText}
                  onChange={(e) => setSqlText(e.target.value)}
                  className="font-mono text-xs h-40"
                  placeholder="Example: CREATE TABLE public.test (id serial primary key, name text);"
                />
                <div className="flex items-center justify-between">
                  <Button onClick={handleRunSql} disabled={sqlRunning}>
                    {sqlRunning && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Run SQL
                  </Button>
                  {sqlResult && (
                    <div className="text-xs text-muted-foreground">
                      {sqlResult.command || ""}{sqlResult.rowCount !== null && sqlResult.rowCount !== undefined ? ` · ${sqlResult.rowCount} row(s)` : ""}
                    </div>
                  )}
                </div>
                {sqlResult && Array.isArray(sqlResult.rows) && sqlResult.rows.length > 0 && Array.isArray(sqlResult.fields) && sqlResult.fields.length > 0 && (
                  <div className="mt-3 border rounded-md overflow-auto max-h-80">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {sqlResult.fields.map((name: string) => (
                            <TableHead key={name} className="text-xs">
                              {name}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sqlResult.rows.map((row: any, idx: number) => (
                          <TableRow key={idx}>
                            {sqlResult.fields.map((name: string) => (
                              <TableCell key={name} className="text-xs max-w-[260px] truncate">
                                {String(row[name] ?? "")}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
            <DialogContent className="max-w-2xl bg-zinc-950 border-white/10 text-white">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Edit className="h-5 w-5 text-blue-400" />
                  Edit Record
                </DialogTitle>
                <DialogDescription className="text-zinc-400">
                  Modify the fields below for the selected row in {selectedTable}
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 gap-4 py-4 max-h-[60vh] overflow-y-auto custom-scrollbar pr-2">
                {dbColumns.map(col => (
                  <div key={col.column_name} className="space-y-2 p-3 rounded-lg bg-white/5 border border-white/5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor={`edit-${col.column_name}`} className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        {col.column_name}
                        <span className="ml-2 text-[10px] font-normal lowercase opacity-50">({col.data_type})</span>
                      </Label>
                      {col.is_nullable === 'NO' && <Badge className="bg-red-500/10 text-red-500 border-red-500/20 h-4 text-[9px]">Required</Badge>}
                    </div>
                    {col.data_type.includes('boolean') ? (
                      <div className="flex items-center gap-3">
                        <Switch
                          id={`edit-${col.column_name}`}
                          checked={insertForm[col.column_name] || false}
                          onCheckedChange={(checked) => setInsertForm({ ...insertForm, [col.column_name]: checked })}
                        />
                        <span className="text-sm font-mono">{String(insertForm[col.column_name] || false)}</span>
                      </div>
                    ) : col.data_type.includes('text') || col.data_type.includes('json') ? (
                      <Textarea
                        id={`edit-${col.column_name}`}
                        value={insertForm[col.column_name] ?? ''}
                        onChange={(e) => setInsertForm({ ...insertForm, [col.column_name]: e.target.value })}
                        className="bg-black/40 border-white/10 text-xs font-mono min-h-[80px]"
                      />
                    ) : (
                      <Input
                        id={`edit-${col.column_name}`}
                        type={col.data_type.includes('int') || col.data_type.includes('numeric') ? 'number' : 'text'}
                        value={insertForm[col.column_name] ?? ''}
                        onChange={(e) => {
                          const value = col.data_type.includes('int') || col.data_type.includes('numeric')
                            ? e.target.value === '' ? null : Number(e.target.value)
                            : e.target.value;
                          setInsertForm({ ...insertForm, [col.column_name]: value });
                        }}
                        className="bg-black/40 border-white/10 text-xs font-mono h-9"
                      />
                    )}
                  </div>
                ))}
              </div>
              <DialogFooter className="border-t border-white/5 pt-4">
                <Button variant="ghost" onClick={() => setEditDialogOpen(false)} className="text-xs hover:bg-white/5">
                  Cancel
                </Button>
                <Button onClick={handleSaveRow} className="bg-blue-600 hover:bg-blue-700 text-xs font-bold px-8">
                  Save Changes
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={insertDialogOpen} onOpenChange={setInsertDialogOpen}>
            <DialogContent className="max-w-2xl bg-zinc-950 border-white/10 text-white">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Plus className="h-5 w-5 text-[#00ff88]" />
                  Insert New Record
                </DialogTitle>
                <DialogDescription className="text-zinc-400">
                  Add a new row to {selectedTable}
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 gap-4 py-4 max-h-[60vh] overflow-y-auto custom-scrollbar pr-2">
                {dbColumns.map(col => (
                  <div key={col.column_name} className="space-y-2 p-3 rounded-lg bg-white/5 border border-white/5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor={`insert-${col.column_name}`} className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        {col.column_name}
                        <span className="ml-2 text-[10px] font-normal lowercase opacity-50">({col.data_type})</span>
                      </Label>
                      {col.is_nullable === 'NO' && <Badge className="bg-red-500/10 text-red-500 border-red-500/20 h-4 text-[9px]">Required</Badge>}
                    </div>
                    {col.data_type.includes('boolean') ? (
                      <div className="flex items-center gap-3">
                        <Switch
                          id={`insert-${col.column_name}`}
                          checked={insertForm[col.column_name] || false}
                          onCheckedChange={(checked) => setInsertForm({ ...insertForm, [col.column_name]: checked })}
                        />
                        <span className="text-sm font-mono">{String(insertForm[col.column_name] || false)}</span>
                      </div>
                    ) : col.data_type.includes('text') || col.data_type.includes('json') ? (
                      <Textarea
                        id={`insert-${col.column_name}`}
                        value={insertForm[col.column_name] ?? ''}
                        onChange={(e) => setInsertForm({ ...insertForm, [col.column_name]: e.target.value })}
                        className="bg-black/40 border-white/10 text-xs font-mono min-h-[80px]"
                        placeholder={col.is_nullable === 'YES' ? 'Optional' : 'Required'}
                      />
                    ) : (
                      <Input
                        id={`insert-${col.column_name}`}
                        type={col.data_type.includes('int') || col.data_type.includes('numeric') ? 'number' : 'text'}
                        value={insertForm[col.column_name] ?? ''}
                        onChange={(e) => {
                          const value = col.data_type.includes('int') || col.data_type.includes('numeric')
                            ? e.target.value === '' ? null : Number(e.target.value)
                            : e.target.value;
                          setInsertForm({ ...insertForm, [col.column_name]: value });
                        }}
                        className="bg-black/40 border-white/10 text-xs font-mono h-9"
                        placeholder={col.is_nullable === 'YES' ? 'Optional' : 'Required'}
                      />
                    )}
                  </div>
                ))}
              </div>
              <DialogFooter className="border-t border-white/5 pt-4">
                <Button variant="ghost" onClick={() => setInsertDialogOpen(false)} className="text-xs hover:bg-white/5">
                  Cancel
                </Button>
                <Button onClick={handleInsertRow} className="bg-[#00ff88] hover:bg-[#00ff88]/90 text-black text-xs font-bold px-8">
                  Insert Record
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={createTableDialogOpen} onOpenChange={setCreateTableDialogOpen}>
            <DialogContent className="max-w-3xl">
              <DialogHeader>
                <DialogTitle>Create Table</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Table Name</Label>
                  <Input
                    value={newTableName}
                    onChange={(e) => setNewTableName(e.target.value)}
                    placeholder="my_table"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Columns</Label>
                  <div className="space-y-2">
                    {newColumns.map((col, idx) => (
                      <div key={idx} className="grid grid-cols-[1.2fr,1fr,auto] gap-2 items-center">
                        <Input
                          placeholder="column_name"
                          value={col.name}
                          onChange={(e) => {
                            const value = e.target.value;
                            setNewColumns((prev) =>
                              prev.map((c, i) => (i === idx ? { ...c, name: value } : c))
                            );
                          }}
                        />
                        <Input
                          placeholder="text, integer, bigint..."
                          value={col.type}
                          onChange={(e) => {
                            const value = e.target.value;
                            setNewColumns((prev) =>
                              prev.map((c, i) => (i === idx ? { ...c, type: value } : c))
                            );
                          }}
                        />
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={col.nullable}
                            onCheckedChange={(checked) => {
                              setNewColumns((prev) =>
                                prev.map((c, i) => (i === idx ? { ...c, nullable: Boolean(checked) } : c))
                              );
                            }}
                          />
                          <span className="text-xs text-muted-foreground">Nullable</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setNewColumns((prev) => [...prev, { name: "", type: "text", nullable: true }])
                      }
                    >
                      Add Column
                    </Button>
                    {newColumns.length > 1 && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setNewColumns((prev) => prev.slice(0, prev.length - 1))
                        }
                      >
                        Remove Last
                      </Button>
                    )}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateTableDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreateTable}>
                  Create
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={addColumnDialogOpen} onOpenChange={setAddColumnDialogOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Add Column {selectedTable ? `to ${selectedTable}` : ""}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Column Name</Label>
                  <Input
                    value={newColumnName}
                    onChange={(e) => setNewColumnName(e.target.value)}
                    placeholder="new_column"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Column Type</Label>
                  <Input
                    value={newColumnType}
                    onChange={(e) => setNewColumnType(e.target.value)}
                    placeholder="text, integer, timestamptz..."
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={newColumnNullable}
                    onCheckedChange={(checked) => setNewColumnNullable(Boolean(checked))}
                  />
                  <span className="text-xs text-muted-foreground">Nullable</span>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddColumnDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleAddColumn} disabled={!selectedTable}>
                  Add Column
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* OpenRouter Config Tab (Embedded) */}
        <TabsContent value="openrouter">
           <OpenRouterConfigPage />
        </TabsContent>

      </Tabs>

      <Dialog open={isCacheDialogOpen} onOpenChange={setIsCacheDialogOpen}>
        <DialogContent className="max-w-md bg-[#0f0f0f] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-blue-400" />
              Manage Semantic Cache
            </DialogTitle>
            <DialogDescription className="text-white/60">
              Configure settings for {editingCacheConfig?.name} ({editingCacheConfig?.platform})
            </DialogDescription>
          </DialogHeader>
          
          {editingCacheConfig && (
            <div className="space-y-6 py-4">
              <div className="flex items-center justify-between p-3 rounded-lg border border-white/5 bg-white/5">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">Enable Semantic Cache</Label>
                  <p className="text-[11px] text-muted-foreground">Automatically reply to repeated questions.</p>
                </div>
                <Switch 
                  checked={editingCacheConfig.semantic_cache_enabled}
                  onCheckedChange={(val) => setEditingCacheConfig({ ...editingCacheConfig, semantic_cache_enabled: val })}
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg border border-white/5 bg-white/5">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">Use Embedding (Beta)</Label>
                  <p className="text-[11px] text-muted-foreground">Vector-based lookups for higher precision.</p>
                </div>
                <Switch 
                  checked={editingCacheConfig.embed_enabled}
                  onCheckedChange={(val) => setEditingCacheConfig({ ...editingCacheConfig, embed_enabled: val })}
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg border border-white/5 bg-white/5">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">Auto-Learning (AI Auto-Save)</Label>
                  <p className="text-[11px] text-muted-foreground">Automatically save new AI responses to the cache.</p>
                </div>
                <Switch 
                  checked={editingCacheConfig.semantic_cache_autosave ?? true}
                  onCheckedChange={(val) => setEditingCacheConfig({ ...editingCacheConfig, semantic_cache_autosave: val })}
                />
              </div>

              <div className="space-y-3 p-3 rounded-lg border border-white/5 bg-white/5">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Similarity Threshold</Label>
                  <Badge variant="outline" className="font-mono text-blue-400 h-5">{editingCacheConfig.semantic_cache_threshold}</Badge>
                </div>
                <Slider 
                  value={[editingCacheConfig.semantic_cache_threshold]} 
                  min={0.50} 
                  max={0.99} 
                  step={0.01} 
                  onValueChange={(val) => setEditingCacheConfig({ ...editingCacheConfig, semantic_cache_threshold: val[0] })}
                  className="py-2"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground uppercase tracking-widest">
                  <span>Loose (0.50)</span>
                  <span>Strict (0.99)</span>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCacheDialogOpen(false)} className="h-9">
              Cancel
            </Button>
            <Button 
              onClick={() => {
                if (editingCacheConfig) {
                  updateCacheConfig(editingCacheConfig, {
                    semantic_cache_enabled: editingCacheConfig.semantic_cache_enabled,
                    semantic_cache_threshold: editingCacheConfig.semantic_cache_threshold,
                    embed_enabled: editingCacheConfig.embed_enabled,
                    semantic_cache_autosave: editingCacheConfig.semantic_cache_autosave ?? true
                  });
                  setIsCacheDialogOpen(false);
                }
              }} 
              className="bg-blue-600 hover:bg-blue-700 h-9"
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEntriesDialogOpen} onOpenChange={setIsEntriesDialogOpen}>
        <DialogContent className="max-w-4xl bg-[#0f0f0f] border-white/10 text-white h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <DatabaseIcon className="h-5 w-5 text-blue-400" />
              Manage Semantic Cache Entries
            </DialogTitle>
            <DialogDescription className="text-white/60">
              Add, edit or delete cache entries for {selectedConfigForEntries?.name}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-hidden flex flex-col gap-6 py-4">
            {/* Add New Entry Form */}
            <Card className="bg-white/5 border-white/10 shrink-0">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Plus className="h-4 w-4 text-green-400" />
                  {editingEntryId ? 'Edit Entry' : 'Add Manual Cache (Golden Response)'}
                </CardTitle>
              </CardHeader>
              <CardContent className="py-0 px-4 pb-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wider">User Question</Label>
                    <Textarea 
                      placeholder="Enter the question..." 
                      className="bg-black/40 border-white/10 min-h-[80px] text-sm"
                      value={newEntryQuestion}
                      onChange={(e) => setNewEntryQuestion(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wider">AI Response</Label>
                    <Textarea 
                      placeholder="Enter the ideal response..." 
                      className="bg-black/40 border-white/10 min-h-[80px] text-sm"
                      value={newEntryResponse}
                      onChange={(e) => setNewEntryResponse(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  {editingEntryId && (
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => {
                        setEditingEntryId(null);
                        setNewEntryQuestion("");
                        setNewEntryResponse("");
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                  <Button 
                    size="sm" 
                    className="bg-blue-600 hover:bg-blue-700"
                    onClick={handleSaveCacheEntry}
                  >
                    {editingEntryId ? 'Update Entry' : 'Save Entry'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Entries List */}
            <div className="flex-1 flex flex-col gap-3 overflow-hidden">
              <div className="flex items-center justify-between shrink-0">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Activity className="h-4 w-4 text-blue-400" />
                  Existing Cache Entries ({cacheEntries.length})
                </h3>
                <div className="flex items-center gap-2">
                  {cacheEntries.length > 0 && (
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => setIsClearConfirmOpen(true)}
                      className="h-8 px-2 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 flex items-center gap-1.5"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Clear All
                    </Button>
                  )}
                  <div className="relative w-64">
                    <Input 
                      placeholder="Search entries..." 
                      className="h-8 text-xs bg-black/40 border-white/10 pl-8"
                      value={entriesSearch}
                      onChange={(e) => setEntriesSearch(e.target.value)}
                    />
                    <svg className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto rounded-lg border border-white/5 bg-black/20">
                {entriesLoading ? (
                  <div className="h-full flex flex-col items-center justify-center gap-3 opacity-50">
                    <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                    <p className="text-sm">Loading cache entries...</p>
                  </div>
                ) : cacheEntries.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center gap-3 opacity-20">
                    <DatabaseIcon className="h-12 w-12" />
                    <p className="text-sm">No cache entries found for this account.</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader className="bg-white/5 sticky top-0 z-10">
                      <TableRow className="hover:bg-transparent border-white/10">
                        <TableHead className="w-[40%] text-xs uppercase font-bold text-white/50">Question</TableHead>
                        <TableHead className="w-[45%] text-xs uppercase font-bold text-white/50">Response</TableHead>
                        <TableHead className="w-[15%] text-xs uppercase font-bold text-white/50 text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cacheEntries
                        .filter(e => 
                          e.question_norm?.toLowerCase().includes(entriesSearch.toLowerCase()) || 
                          e.response_text?.toLowerCase().includes(entriesSearch.toLowerCase())
                        )
                        .map((entry) => (
                        <TableRow key={entry.id} className="hover:bg-white/5 border-white/5 transition-colors group">
                          <TableCell className="align-top py-4">
                            <div className="text-xs font-medium text-blue-400/90 leading-relaxed line-clamp-3 group-hover:line-clamp-none transition-all">
                              {entry.question_norm}
                            </div>
                          </TableCell>
                          <TableCell className="align-top py-4">
                            <div className="text-xs text-white/70 leading-relaxed line-clamp-3 group-hover:line-clamp-none transition-all">
                              {entry.response_text}
                            </div>
                          </TableCell>
                          <TableCell className="align-top py-4 text-right">
                            <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button 
                                size="icon" 
                                variant="ghost" 
                                className="h-7 w-7 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                                onClick={() => {
                                  setEditingEntryId(entry.id);
                                  setNewEntryQuestion(entry.question_norm);
                                  setNewEntryResponse(entry.response_text);
                                }}
                              >
                                <Edit className="h-3.5 w-3.5" />
                              </Button>
                              <Button 
                                size="icon" 
                                variant="ghost" 
                                className="h-7 w-7 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                onClick={() => handleDeleteCacheEntry(entry.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t border-white/5 pt-4">
            <Button variant="outline" onClick={() => setIsEntriesDialogOpen(false)} className="border-white/10 hover:bg-white/5">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clear Cache Confirmation Dialog */}
      <Dialog open={isClearConfirmOpen} onOpenChange={setIsClearConfirmOpen}>
        <DialogContent className="sm:max-w-[400px] bg-zinc-950 border-white/10 text-white shadow-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400">
              <Trash2 className="h-5 w-5" />
              Clear All Cache Entries
            </DialogTitle>
            <DialogDescription className="text-zinc-400 pt-2">
              Are you sure you want to delete <strong>ALL ({cacheEntries.length})</strong> cache entries for <strong>{selectedConfigForEntries?.name}</strong>? 
              <br/><br/>
              This action cannot be undone and will affect all automated responses for this account.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 mt-4">
            <Button 
              variant="outline" 
              onClick={() => setIsClearConfirmOpen(false)}
              className="border-white/10 hover:bg-white/5 text-xs"
            >
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleClearCache}
              className="bg-red-600 hover:bg-red-700 text-xs font-bold"
            >
              Yes, Clear Everything
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
