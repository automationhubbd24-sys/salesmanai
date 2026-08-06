import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Download, MessageSquare, RefreshCw, Send, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calendar } from "@/components/ui/calendar";
import { BulkCampaignModal } from "@/components/dashboard/BulkCampaignModal";
import { useInstagram } from "@/context/InstagramContext";
import { BACKEND_URL } from "@/config";
import { cn } from "@/lib/utils";
import { format, startOfDay, endOfDay, subDays } from "date-fns";
import { DateRange } from "react-day-picker";
import { toast } from "sonner";

type Message = { id: string; sender_id?: string; text?: string; reply_by?: string; status?: string; token?: number; ai_model?: string; created_at?: string };
type ApiResult = { data?: Message[]; total?: number; filteredBotReplyCount?: number; filteredTokenCount?: number };
const LIMIT = 50;

export default function InstagramConversionPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { currentAccount, loading: accountLoading } = useInstagram();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [botReplies, setBotReplies] = useState(0);
  const [tokens, setTokens] = useState(0);
  const [filterType, setFilterType] = useState("today");
  const [date, setDate] = useState<DateRange | undefined>({ from: startOfDay(new Date()), to: endOfDay(new Date()) });
  const accountId = currentAccount?.page_id || null;
  const senderId = searchParams.get("sender_id") || "";

  const fetchMessages = useCallback(async () => {
    if (!accountId || !date?.from || !date?.to) { setMessages([]); return; }
    setLoading(true);
    try {
      const token = localStorage.getItem("auth_token");
      const params = new URLSearchParams({ account_id: accountId, from: date.from.toISOString(), to: date.to.toISOString(), page: String(page), limit: String(LIMIT) });
      if (senderId) params.set("sender_id", senderId);
      const response = await fetch(`${BACKEND_URL}/api/instagram/chats?${params}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error("Instagram conversions load করা যায়নি");
      const result: ApiResult | Message[] = await response.json();
      const data = Array.isArray(result) ? result : result.data || [];
      setMessages(data); setTotal(Array.isArray(result) ? data.length : result.total || data.length);
      setBotReplies(Array.isArray(result) ? data.filter(item => item.reply_by === "bot").length : result.filteredBotReplyCount || 0);
      setTokens(Array.isArray(result) ? data.reduce((sum, item) => sum + Number(item.token || 0), 0) : result.filteredTokenCount || 0);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Instagram conversions load করা যায়নি"); }
    finally { setLoading(false); }
  }, [accountId, date?.from, date?.to, page, senderId]);

  useEffect(() => { void fetchMessages(); }, [fetchMessages]);
  useEffect(() => { setPage(1); }, [date?.from, date?.to, senderId]);

  const updateFilter = (value: string) => {
    setFilterType(value); const now = new Date();
    if (value === "today") setDate({ from: startOfDay(now), to: endOfDay(now) });
    if (value === "yesterday") { const yesterday = subDays(now, 1); setDate({ from: startOfDay(yesterday), to: endOfDay(yesterday) }); }
    if (value === "last7") setDate({ from: startOfDay(subDays(now, 7)), to: endOfDay(now) });
  };
  const clearSender = () => { const next = new URLSearchParams(searchParams); next.delete("sender_id"); setSearchParams(next); };
  const downloadCsv = () => {
    if (!messages.length) { toast.error("Download করার জন্য কোনো message নেই"); return; }
    const quote = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const rows = [["Time", "Customer", "Message", "Reply By", "Tokens", "Status"], ...messages.map(item => [item.created_at || "", item.sender_id || "", item.text || "", item.reply_by || "", item.token || "", item.status || ""])];
    const url = URL.createObjectURL(new Blob([`\uFEFF${rows.map(row => row.map(quote).join(",")).join("\r\n")}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `instagram-conversion-${format(new Date(), "yyyy-MM-dd")}.csv`; link.click(); URL.revokeObjectURL(url);
  };
  const dateLabel = useMemo(() => date?.from ? date.to ? `${format(date.from, "LLL d, y")} – ${format(date.to, "LLL d, y")}` : format(date.from, "LLL d, y") : "তারিখ নির্বাচন করুন", [date]);

  if (accountLoading) return <div className="flex min-h-[360px] items-center justify-center"><RefreshCw className="h-7 w-7 animate-spin" /></div>;
  if (!accountId) return <div className="flex min-h-[360px] flex-col items-center justify-center gap-3"><MessageSquare className="h-14 w-14 text-muted-foreground" /><h2 className="text-2xl font-bold">No Instagram Account Connected</h2><p className="text-muted-foreground">Conversion দেখতে আগে একটি Instagram account select করুন।</p><Button onClick={() => navigate("/dashboard/instagram/integration")}>Go to Instagram Integration</Button></div>;

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  return <div className="space-y-6"><div className="flex flex-col gap-4"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h1 className="text-3xl font-bold">Instagram Conversion</h1><p className="mt-1 text-muted-foreground">{currentAccount.name}-এর DM conversation ও bot performance দেখুন।</p></div><div className="flex flex-wrap items-center gap-2"><Select value={filterType} onValueChange={updateFilter}><SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="today">Today</SelectItem><SelectItem value="yesterday">Yesterday</SelectItem><SelectItem value="last7">Last 7 Days</SelectItem><SelectItem value="custom">Custom Range</SelectItem></SelectContent></Select>{filterType === "custom" && <Popover><PopoverTrigger asChild><Button variant="outline"><CalendarIcon className="mr-2 h-4 w-4" />{dateLabel}</Button></PopoverTrigger><PopoverContent className="w-auto p-0"><Calendar initialFocus mode="range" selected={date} onSelect={setDate} numberOfMonths={2} /></PopoverContent></Popover>}<Button variant="outline" size="icon" onClick={() => void fetchMessages()} disabled={loading}><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /></Button><Button variant="outline" size="icon" onClick={downloadCsv}><Download className="h-4 w-4" /></Button><BulkCampaignModal pageId={accountId} platform="instagram" trigger={<Button><Send className="mr-2 h-4 w-4" />Bulk Message</Button>} /></div></div>{senderId && <Card className="border-pink-500/30"><CardContent className="flex items-center justify-between gap-3 py-3"><span className="text-sm">Focused conversation: <span className="font-mono">{senderId}</span></span><Button variant="outline" size="sm" onClick={clearSender}>Clear</Button></CardContent></Card>}</div><div className="grid gap-4 sm:grid-cols-3"><Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Messages</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{total}</div><p className="text-xs text-muted-foreground">Selected range</p></CardContent></Card><Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Bot Replies</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{botReplies}</div><p className="text-xs text-muted-foreground">Selected range</p></CardContent></Card><Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm font-medium">AI Tokens <Zap className="h-4 w-4 text-pink-500" /></CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{tokens.toLocaleString()}</div><p className="text-xs text-muted-foreground">Selected range</p></CardContent></Card></div><Card><CardHeader><CardTitle className="flex items-center gap-2"><MessageSquare className="text-pink-500" />Message History</CardTitle><CardDescription>Customer messages, admin replies ও AI response history।</CardDescription></CardHeader><CardContent><div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Customer</TableHead><TableHead>Message</TableHead><TableHead>Reply By</TableHead><TableHead>Tokens</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{loading && !messages.length ? <TableRow><TableCell colSpan={6} className="py-10 text-center">Loading...</TableCell></TableRow> : !messages.length ? <TableRow><TableCell colSpan={6} className="py-10 text-center">কোনো message পাওয়া যায়নি।</TableCell></TableRow> : messages.map(message => <TableRow key={message.id}><TableCell className="whitespace-nowrap">{message.created_at ? format(new Date(message.created_at), "MMM d, HH:mm") : "-"}</TableCell><TableCell className="font-mono text-xs">{message.sender_id || "-"}</TableCell><TableCell className="max-w-[340px] truncate" title={message.text}>{message.text || "-"}</TableCell><TableCell><span className={cn("rounded-full border px-2 py-1 text-xs", message.reply_by === "bot" ? "border-pink-500/30 bg-pink-500/10 text-pink-500" : "text-muted-foreground")}>{message.reply_by || "customer"}</span></TableCell><TableCell>{message.token || "-"}{message.ai_model && <span className="block text-[10px] text-muted-foreground">{message.ai_model}</span>}</TableCell><TableCell>{message.status || "received"}</TableCell></TableRow>)}</TableBody></Table></div>{total > LIMIT && <div className="mt-4 flex items-center justify-between"><span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page === 1 || loading} onClick={() => setPage(current => current - 1)}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button><Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage(current => current + 1)}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button></div></div>}</CardContent></Card></div>;
}
