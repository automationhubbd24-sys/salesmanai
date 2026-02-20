import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, Database as DatabaseIcon, Trash2, Edit, CheckCircle, CreditCard, DollarSign, Loader2, XCircle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
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

type Coupon = {
  id: number;
  code: string;
  value: number;
  type: string;
  status: string;
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
  const [dbError, setDbError] = useState<string | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editJson, setEditJson] = useState("");
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

  useEffect(() => {
    if (isAuthenticated) {
      fetchTransactions();
      fetchCoupons();
      fetchDbTables();
    }
  }, [isAuthenticated]);

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
      const res = await fetch(`${BACKEND_URL}/api/db-admin/tables`);
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
      const res = await fetch(`${BACKEND_URL}/api/db-admin/table/${encodeURIComponent(tableName)}?limit=${dbLimit}&offset=${offset}`);
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
    setEditJson(JSON.stringify(row, null, 2));
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
      const parsed = JSON.parse(editJson);
      const res = await fetch(`${BACKEND_URL}/api/db-admin/table/${encodeURIComponent(selectedTable)}/update`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          keyColumn,
          keyValue,
          row: parsed,
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
      const res = await fetch(`${BACKEND_URL}/api/db-admin/table/${encodeURIComponent(selectedTable)}/delete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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

      const res = await fetch(`${BACKEND_URL}/api/db-admin/table/${encodeURIComponent(selectedTable)}/insert`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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
      const res = await fetch(`${BACKEND_URL}/api/db-admin/table`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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
      const res = await fetch(`${BACKEND_URL}/api/db-admin/table/${encodeURIComponent(selectedTable)}/column`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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
      const res = await fetch(`${BACKEND_URL}/api/db-admin/sql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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
      const res = await fetch(`${BACKEND_URL}/api/auth/admin/transactions`);
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
      const res = await fetch(`${BACKEND_URL}/api/auth/admin/coupons`);
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
      const res = await fetch(`${BACKEND_URL}/api/auth/admin/transactions/${txn.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      const res = await fetch(`${BACKEND_URL}/api/auth/admin/transactions/${txn.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      const res = await fetch(`${BACKEND_URL}/api/auth/admin/coupons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: couponCode,
          value: Number(couponValue),
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
      const res = await fetch(`${BACKEND_URL}/api/auth/admin/coupons/${coupon.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
    setGeminiSelectedIds([]);

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
      const response = await fetch(`${BACKEND_URL}/api/openrouter/gemini/delete-keys`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ids: failedIds }),
      });

      const data = await response.json();

      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Failed to delete Gemini keys");
      }

      const deletedCount = data.deleted ?? failedIds.length;
      toast.success(`Deleted ${deletedCount} failed Gemini keys`);

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
          <TabsTrigger value="db">Database Admin</TabsTrigger>
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

        <TabsContent value="db">
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-[260px,1fr]">
              <Card className="h-full">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <DatabaseIcon className="h-5 w-5" />
                    Tables
                  </CardTitle>
                  <CardDescription>Select a table to view and edit rows</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mb-2"
                    onClick={fetchDbTables}
                    disabled={dbTablesLoading}
                  >
                    {dbTablesLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Refresh Tables
                  </Button>
                  <Button
                    size="sm"
                    className="w-full mb-2"
                    onClick={() => setCreateTableDialogOpen(true)}
                  >
                    Create Table
                  </Button>
                  <div className="border rounded-md max-h-[480px] overflow-auto">
                    {dbTables.length === 0 && !dbTablesLoading && (
                      <div className="p-3 text-sm text-muted-foreground">No tables found in public schema.</div>
                    )}
                    {dbTables.map((t) => (
                      <button
                        key={t}
                        onClick={() => loadTableData(t, 0)}
                        className={`w-full text-left px-3 py-2 text-sm border-b last:border-b-0 hover:bg-muted ${
                          selectedTable === t ? "bg-muted font-semibold" : ""
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="h-full">
                <CardHeader>
                  <CardTitle>
                    {selectedTable ? `Table: ${selectedTable}` : "Select a table"}
                  </CardTitle>
                  <CardDescription>
                    View, insert, edit, and delete rows from the selected table
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {dbError && (
                    <div className="text-sm text-red-500">
                      {dbError}
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-muted-foreground">
                      Limit {dbLimit} · Offset {dbOffset}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setAddColumnDialogOpen(true)}
                        disabled={!selectedTable}
                      >
                        Add Column
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => selectedTable && loadTableData(selectedTable, Math.max(dbOffset - dbLimit, 0))}
                        disabled={!selectedTable || dbLoading || dbOffset === 0}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => selectedTable && loadTableData(selectedTable, dbOffset + dbLimit)}
                        disabled={!selectedTable || dbLoading || dbRows.length < dbLimit}
                      >
                        Next
                      </Button>
                      <Button
                        size="sm"
                        onClick={openInsertRow}
                        disabled={!selectedTable}
                      >
                        Add Row
                      </Button>
                    </div>
                  </div>

                  <div className="overflow-auto border rounded-md">
                    {dbLoading ? (
                      <div className="p-4 text-center text-sm text-muted-foreground">
                        Loading table data...
                      </div>
                    ) : !selectedTable ? (
                      <div className="p-4 text-center text-sm text-muted-foreground">
                        Select a table from the left panel.
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {dbColumns.map((col) => (
                              <TableHead key={col.column_name} className="text-xs">
                                {col.column_name}
                              </TableHead>
                            ))}
                            <TableHead className="text-right text-xs">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {dbRows.length === 0 ? (
                            <TableRow>
                              <TableCell
                                colSpan={dbColumns.length + 1}
                                className="text-xs text-muted-foreground text-center"
                              >
                                No rows found in this page.
                              </TableCell>
                            </TableRow>
                          ) : (
                            dbRows.map((row, idx) => (
                              <TableRow key={idx}>
                                {dbColumns.map((col) => (
                                  <TableCell key={col.column_name} className="text-xs max-w-[260px] truncate">
                                    {String(row[col.column_name] ?? "")}
                                  </TableCell>
                                ))}
                                <TableCell className="text-right">
                                  <div className="flex justify-end gap-2">
                                    <Button
                                      variant="outline"
                                      size="icon"
                                      onClick={() => openEditRow(row)}
                                    >
                                      <Edit className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="icon"
                                      className="text-red-600 border-red-200 hover:bg-red-50"
                                      onClick={() => handleDeleteRow(row)}
                                    >
                                      <Trash2 className="h-4 w-4" />
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
            <DialogContent className="max-w-3xl">
              <DialogHeader>
                <DialogTitle>Edit Row</DialogTitle>
              </DialogHeader>
              <div className="space-y-2">
                <Label>Row JSON</Label>
                <Textarea
                  value={editJson}
                  onChange={(e) => setEditJson(e.target.value)}
                  className="font-mono text-xs h-64"
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSaveRow}>
                  Save Changes
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={insertDialogOpen} onOpenChange={setInsertDialogOpen}>
            <DialogContent className="max-w-3xl">
              <DialogHeader>
                <DialogTitle>Insert Row into {selectedTable}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 max-h-[60vh] overflow-y-auto p-1">
                {dbColumns.map(col => (
                  <div key={col.column_name} className="grid grid-cols-3 items-center gap-4">
                    <Label htmlFor={col.column_name} className="text-right">
                      {col.column_name}
                      <span className="text-muted-foreground text-xs ml-1">({col.data_type})</span>
                    </Label>
                    {col.data_type.includes('boolean') ? (
                      <Switch
                        id={col.column_name}
                        checked={insertForm[col.column_name] || false}
                        onCheckedChange={(checked) => setInsertForm({ ...insertForm, [col.column_name]: checked })}
                        className="col-span-2"
                      />
                    ) : col.data_type.includes('text') || col.data_type.includes('json') ? (
                      <Textarea
                        id={col.column_name}
                        value={insertForm[col.column_name] ?? ''}
                        onChange={(e) => setInsertForm({ ...insertForm, [col.column_name]: e.target.value })}
                        placeholder={col.is_nullable === 'YES' ? 'Optional' : 'Required'}
                        className="col-span-2 font-mono text-xs"
                      />
                    ) : (
                      <Input
                        id={col.column_name}
                        type={col.data_type.includes('int') || col.data_type.includes('numeric') ? 'number' : 'text'}
                        value={insertForm[col.column_name] ?? ''}
                        onChange={(e) => {
                          const value = col.data_type.includes('int') || col.data_type.includes('numeric')
                            ? e.target.value === '' ? null : Number(e.target.value)
                            : e.target.value;
                          setInsertForm({ ...insertForm, [col.column_name]: value });
                        }}
                        placeholder={col.is_nullable === 'YES' ? 'Optional' : 'Required'}
                        className="col-span-2"
                      />
                    )}
                  </div>
                ))}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setInsertDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleInsertRow}>
                  Insert
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
    </div>
  );
}
