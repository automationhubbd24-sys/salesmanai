import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { MessageSquare, RefreshCw, AlertCircle, Calendar as CalendarIcon, Zap, Lock, Unlock, Download, Send, ChevronLeft, ChevronRight } from "lucide-react";
import { BulkCampaignModal } from "@/components/dashboard/BulkCampaignModal";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Link } from "react-router-dom";
import { addDays, format, startOfDay, endOfDay, subDays, isWithinInterval, parseISO } from "date-fns";
import { DateRange } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import { useWhatsApp } from "@/context/WhatsAppContext";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { BACKEND_URL } from "@/config";
import { useSearchParams } from "react-router-dom";

export default function WhatsAppConversionPage() {
  const { currentSession, loading: contextLoading } = useWhatsApp();
  const [searchParams, setSearchParams] = useSearchParams();
  type WaChat = {
    id?: string | number;
    message_id?: string;
    timestamp: number | string;
    sender_id: string;
    recipient_id?: string;
    text?: string;
    reply_by?: string;
    status?: string;
    token_usage?: number;
    model_used?: string;
  };
  const [messages, setMessages] = useState<WaChat[]>([]);
  const [groupedMessages, setGroupedMessages] = useState<Record<string, WaChat[]>>({});
  const [loading, setLoading] = useState(false);
  const [filteredBotReplyCount, setFilteredBotReplyCount] = useState(0);
  const [allTimeBotReplies, setAllTimeBotReplies] = useState(0);
  const [filteredTokenCount, setFilteredTokenCount] = useState(0);
  const [allTimeTokenCount, setAllTimeTokenCount] = useState(0);
  const [tokenBreakdown, setTokenBreakdown] = useState<Record<string, number>>({});
  const [expandedMessageIds, setExpandedMessageIds] = useState<Set<string | number>>(new Set());
  const [lockedContacts, setLockedContacts] = useState<Record<string, boolean>>({});
  const [currentPageNum, setCurrentPageNum] = useState(1);
  const [totalMessages, setTotalMessages] = useState(0);
  const LIMIT = 50;

  const activeSessionName = currentSession?.name
    || (typeof window !== "undefined" ? localStorage.getItem("active_wa_session_id") : null)
    || null;
  const targetSenderId = searchParams.get("sender_id")?.trim() || "";

  const fetchContacts = async (sessionName: string) => {
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) return;

      const params = new URLSearchParams();
      params.set("session_name", sessionName);

      const res = await fetch(`${BACKEND_URL}/api/whatsapp/contacts?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) return;

      const data = await res.json();
      const map: Record<string, boolean> = {};
      (Array.isArray(data) ? data : []).forEach((c: any) => {
        map[c.phone_number] = c.is_locked;
      });
      setLockedContacts(map);
    } catch (e) {
      console.error("Error fetching contacts:", e);
    }
  };

  const handleDownload = async () => {
    if (!activeSessionName || !date?.from || !date?.to) {
      toast.error("Please select a session and a date range.");
      return;
    }

    try {
      const token = localStorage.getItem("auth_token");
      const params = new URLSearchParams();
      params.set("session_name", activeSessionName);
      params.set("from", date.from.toISOString());
      params.set("to", date.to.toISOString());

      const response = await fetch(`${BACKEND_URL}/api/whatsapp/download-conversation?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `conversation_${activeSessionName}_${format(date.from, "yyyy-MM-dd")}_to_${format(date.to, "yyyy-MM-dd")}.txt`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        toast.error("Failed to download conversation.");
      }
    } catch (error) {
      console.error("Download error:", error);
      toast.error("An error occurred while downloading.");
    }
  };

  const handleToggleLock = async (phoneNumber: string) => {
    if (!activeSessionName) return;
    const currentStatus = !!lockedContacts[phoneNumber];
    const newStatus = !currentStatus;
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) {
        setLockedContacts(prev => ({ ...prev, [phoneNumber]: currentStatus }));
        toast.error("Please login again");
        return;
      }

      setLockedContacts(prev => ({ ...prev, [phoneNumber]: newStatus }));

      const res = await fetch(`${BACKEND_URL}/api/whatsapp/contacts/lock`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          session_name: activeSessionName,
          phone_number: phoneNumber,
          is_locked: newStatus,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setLockedContacts(prev => ({ ...prev, [phoneNumber]: currentStatus }));
        toast.error(errData.error || "Failed to update lock status");
        return;
      }

      toast.success(newStatus ? "Conversation Locked (Handover)" : "Conversation Unlocked (AI Active)");
    } catch (e) {
      console.error(e);
      setLockedContacts(prev => ({ ...prev, [phoneNumber]: currentStatus }));
      toast.error("Error toggling lock");
    }
  };

  const toggleExpand = (id: string | number) => {
    const newSet = new Set(expandedMessageIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setExpandedMessageIds(newSet);
  };

  const formatTimestamp = (value: number | string) => {
    const numeric = typeof value === "string" ? Number(value) : value;
    if (!Number.isFinite(numeric)) return "-";
    const normalized = numeric < 1000000000000 ? numeric * 1000 : numeric;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString();
  };
  
  // Date Filter State
  const [date, setDate] = useState<DateRange | undefined>({
    from: startOfDay(new Date()),
    to: endOfDay(new Date()),
  });
  const [filterType, setFilterType] = useState("today");

  useEffect(() => {
    if (activeSessionName) {
        fetchStats(activeSessionName);
    }
  }, [activeSessionName]);

  useEffect(() => {
    // Fetch messages whenever date or sessionName changes
    if (activeSessionName && date?.from && date?.to) {
        fetchMessages(activeSessionName, date.from, date.to, currentPageNum);
        fetchContacts(activeSessionName);
    }
  }, [activeSessionName, date, currentPageNum, targetSenderId]);

  // Reset page when date changes
  useEffect(() => {
    setCurrentPageNum(1);
  }, [date]);

  useEffect(() => {
    setCurrentPageNum(1);
  }, [targetSenderId]);

  useEffect(() => {
    const groups: Record<string, WaChat[]> = {};
    messages.forEach((msg) => {
      const senderId = msg.sender_id.split('@')[0];
      if (!groups[senderId]) {
        groups[senderId] = [];
      }
      groups[senderId].push(msg);
    });
    setGroupedMessages(groups);
  }, [messages]);

  const fetchMessages = async (sessionName: string, from: Date, to: Date, page: number = 1) => {
    setLoading(true);
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) {
        setMessages([]);
        setFilteredBotReplyCount(0);
        setFilteredTokenCount(0);
        setTotalMessages(0);
        return;
      }

      const params = new URLSearchParams();
      params.set("session_name", sessionName);
      params.set("from", from.getTime().toString());
      params.set("to", to.getTime().toString());
      params.set("page", String(page));
      params.set("limit", String(LIMIT));
      if (targetSenderId) {
        params.set("sender_id", targetSenderId);
      }

      const res = await fetch(`${BACKEND_URL}/api/whatsapp/messages?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to fetch messages");
      }

      const result = await res.json();
      const rows: WaChat[] = (Array.isArray(result.data) ? result.data : []) as WaChat[];

      setMessages(rows);
      setTotalMessages(result.total || 0);
      setFilteredBotReplyCount(result.filteredBotReplyCount || 0);
      setFilteredTokenCount(result.filteredTokenCount || 0);
      setTokenBreakdown(result.tokenBreakdown || {});

    } catch (error: any) {
      console.error("Error fetching messages:", error);
      toast.error("Failed to fetch messages: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async (sessionName: string) => {
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) return;

      const params = new URLSearchParams();
      params.set("session_name", sessionName);

      const res = await fetch(`${BACKEND_URL}/api/whatsapp/stats?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        console.error("Stats fetch error:", errData.error || res.statusText);
        return;
      }

      const data = await res.json();
      setAllTimeBotReplies(data.allTimeBotReplies || 0);
      setAllTimeTokenCount(data.allTimeTokenCount || 0);
    } catch (e) {
      console.error("Stats fetch error", e);
    }
  };

  const handleRefresh = () => {
    if (activeSessionName) {
        if (date?.from && date?.to) {
             fetchMessages(activeSessionName, date.from, date.to, currentPageNum);
             fetchStats(activeSessionName);
        } else {
             fetchMessages(activeSessionName, startOfDay(new Date()), endOfDay(new Date()), 1);
             fetchStats(activeSessionName);
        }
    } else {
        toast.error("No active session found.");
    }
  };

  const handleFilterChange = (value: string) => {
    setFilterType(value);
    const now = new Date();
    
    if (value === "today") {
      setDate({ from: startOfDay(now), to: endOfDay(now) });
    } else if (value === "yesterday") {
      const yesterday = subDays(now, 1);
      setDate({ from: startOfDay(yesterday), to: endOfDay(yesterday) });
    } else if (value === "last7") {
      setDate({ from: subDays(now, 7), to: endOfDay(now) });
    } else if (value === "last30") {
      setDate({ from: subDays(now, 30), to: endOfDay(now) });
    }
    // custom: date picker handles it
  };

  const clearSenderFilter = () => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("sender_id");
    setSearchParams(nextParams);
  };

  if (contextLoading && !activeSessionName) {
      return (
          <div className="flex items-center justify-center min-h-[400px]">
              <RefreshCw className="h-8 w-8 animate-spin text-primary" />
          </div>
      );
  }

  if (!activeSessionName) {
      return (
          <div className="space-y-6 max-w-6xl mx-auto">
              <div>
                <h1 className="text-3xl font-bold tracking-tight">Conversion</h1>
                <p className="text-muted-foreground">
                Track user messages and bot automated replies.
                </p>
            </div>
            <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>No Session Active</AlertTitle>
                <AlertDescription>
                    Please select an active session in the <Link to="/dashboard/whatsapp/sessions" className="underline font-bold">Sessions</Link> page to view conversions.
                </AlertDescription>
            </Alert>
          </div>
      )
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col gap-4">
        {targetSenderId && (
          <Alert>
            <MessageSquare className="h-4 w-4" />
            <AlertTitle>Focused Conversation</AlertTitle>
            <AlertDescription className="flex items-center justify-between gap-3">
              <span>Showing messages for customer: <span className="font-mono">{targetSenderId}</span></span>
              <Button variant="outline" size="sm" onClick={clearSenderFilter}>
                Clear
              </Button>
            </AlertDescription>
          </Alert>
        )}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Conversion</h1>
                <p className="text-muted-foreground">
                Track user messages and bot automated replies for Session: <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded">{activeSessionName}</span>
                </p>
            </div>
            
            <div className="flex items-center gap-2 w-full sm:w-auto">
                <Select value={filterType} onValueChange={handleFilterChange}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Select Filter" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="today">Today</SelectItem>
                    <SelectItem value="yesterday">Yesterday</SelectItem>
                    <SelectItem value="last7">Last 7 Days</SelectItem>
                    <SelectItem value="last30">Last 30 Days</SelectItem>
                    <SelectItem value="custom">Custom Range</SelectItem>
                  </SelectContent>
                </Select>

                {filterType === 'custom' && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        id="date"
                        variant={"outline"}
                        className={cn(
                          "w-[260px] justify-start text-left font-normal",
                          !date && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {date?.from ? (
                          date.to ? (
                            <>
                              {format(date.from, "LLL dd, y")} -{" "}
                              {format(date.to, "LLL dd, y")}
                            </>
                          ) : (
                            format(date.from, "LLL dd, y")
                          )
                        ) : (
                          <span>Pick a date</span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="end">
                      <Calendar
                        initialFocus
                        mode="range"
                        defaultMonth={date?.from}
                        selected={date}
                        onSelect={setDate}
                        numberOfMonths={2}
                      />
                    </PopoverContent>
                  </Popover>
                )}

                <Button onClick={handleRefresh} disabled={loading} variant="outline" size="icon">
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
                <Button onClick={handleDownload} disabled={loading} variant="outline" size="icon">
                    <Download className="h-4 w-4" />
                </Button>
                
                {activeSessionName && (
                  <BulkCampaignModal pageId={activeSessionName} platform="whatsapp" />
                )}
            </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-background border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">All Time Bot Replies</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{allTimeBotReplies}</div>
            <p className="text-xs text-muted-foreground">
              Total lifetime bot replies
            </p>
          </CardContent>
        </Card>

        <Card className="bg-background border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Bot Replies (Filtered)</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{filteredBotReplyCount}</div>
            <p className="text-xs text-muted-foreground">
              Replies in selected range
            </p>
          </CardContent>
        </Card>

        <Card className="bg-background border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">All Time Tokens</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{allTimeTokenCount.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              Total tokens consumed
            </p>
          </CardContent>
        </Card>

        <Card className="bg-background border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Tokens (Filtered)</CardTitle>
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger>
                        <Zap className="h-4 w-4 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                        <p className="font-semibold mb-1">Model Breakdown:</p>
                        {Object.entries(tokenBreakdown).length > 0 ? (
                            Object.entries(tokenBreakdown).map(([model, count]) => (
                                <div key={model} className="text-xs flex justify-between gap-4">
                                    <span>{model}:</span>
                                    <span className="font-mono">{count.toLocaleString()}</span>
                                </div>
                            ))
                        ) : (
                            <span className="text-xs text-muted-foreground">No data</span>
                        )}
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{filteredTokenCount.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              Tokens in selected range
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-background border-border">
        <CardHeader>
          <CardTitle>Message History</CardTitle>
          <CardDescription>
            Recent messages from users and bot replies.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Reply By</TableHead>
                <TableHead>Tokens</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && messages.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center">Loading...</TableCell>
                </TableRow>
              ) : messages.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center">No messages found for this session</TableCell>
                </TableRow>
              ) : (
                messages.map((msg) => (
                  <TableRow key={msg.id || msg.message_id}>
                    <TableCell>{formatTimestamp(msg.timestamp)}</TableCell>
                    <TableCell
                      className={`max-w-[300px] cursor-pointer transition-all text-primary hover:text-primary/80 hover:underline ${
                        expandedMessageIds.has(msg.id || msg.message_id || 'unknown')
                          ? 'whitespace-pre-wrap break-words'
                          : 'truncate'
                      }`}
                      title="Click to expand"
                      onClick={() => toggleExpand(msg.id || msg.message_id || 'unknown')}
                    >
                      {msg.text}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`px-2 py-1 rounded-full text-xs border ${
                          msg.reply_by === 'bot'
                            ? 'bg-primary/10 text-primary border-primary/40'
                            : 'bg-muted/10 text-muted-foreground border-border'
                        }`}
                      >
                        {msg.reply_by || 'Unknown'}
                      </span>
                    </TableCell>
                    <TableCell>
                      {msg.token_usage ? (
                        <div className="flex flex-col">
                          <span className="font-bold">{msg.token_usage}</span>
                          {msg.model_used && (
                            <span className="text-[10px] text-muted-foreground">
                              {msg.model_used}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`px-2 py-1 rounded-full text-xs border ${
                          msg.status === 'sent'
                            ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/40'
                            : msg.status === 'transcribed'
                              ? 'bg-cyan-500/10 text-cyan-500 border-cyan-500/40'
                              : msg.status === 'analyzed'
                                ? 'bg-violet-500/10 text-violet-500 border-violet-500/40'
                                : 'bg-yellow-500/10 text-yellow-500 border-yellow-500/40'
                        }`}
                      >
                        {msg.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                            {(() => {
                                const contactId = msg.reply_by === 'user' ? msg.sender_id : msg.recipient_id;
                                if (!contactId || contactId === activeSessionName) return null;
                                const isLocked = !!lockedContacts[contactId];
                                
                                return (
                                    <Button 
                                        variant="ghost" 
                                        size="sm" 
                                        onClick={() => handleToggleLock(contactId)}
                                        className="h-8 w-8 p-0"
                                        title={isLocked ? "Unlock AI" : "Lock AI (Handover)"}
                                    >
                                        {isLocked ? 
                                            <Lock className="h-4 w-4 text-red-500" /> : 
                                            <Unlock className="h-4 w-4 text-emerald-500" />
                                        }
                                    </Button>
                                );
                            })()}
                        </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {totalMessages > LIMIT && (
            <div className="flex items-center justify-between mt-4 px-2">
              <div className="text-sm text-muted-foreground">
                Showing {((currentPageNum - 1) * LIMIT) + 1} to {Math.min(currentPageNum * LIMIT, totalMessages)} of {totalMessages} messages
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPageNum(prev => Math.max(1, prev - 1))}
                  disabled={currentPageNum === 1 || loading}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Previous
                </Button>
                <div className="text-sm font-medium">
                  Page {currentPageNum} of {Math.ceil(totalMessages / LIMIT)}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPageNum(prev => prev + 1)}
                  disabled={currentPageNum >= Math.ceil(totalMessages / LIMIT) || loading}
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
