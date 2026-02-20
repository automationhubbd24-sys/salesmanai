import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { MessageSquare, RefreshCw, AlertCircle, Calendar as CalendarIcon, Zap, Lock, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Link } from "react-router-dom";
import { addDays, format, startOfDay, endOfDay, subDays, isWithinInterval, parseISO } from "date-fns";
import { DateRange } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
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

export default function WhatsAppConversionPage() {
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
  const [loading, setLoading] = useState(false);
  const [filteredBotReplyCount, setFilteredBotReplyCount] = useState(0);
  const [allTimeBotReplies, setAllTimeBotReplies] = useState(0);
  const [filteredTokenCount, setFilteredTokenCount] = useState(0);
  const [allTimeTokenCount, setAllTimeTokenCount] = useState(0);
  const [tokenBreakdown, setTokenBreakdown] = useState<Record<string, number>>({});
  const [activeSessionName, setActiveSessionName] = useState<string | null>(null);
  const [expandedMessageIds, setExpandedMessageIds] = useState<Set<string | number>>(new Set());
  const [lockedContacts, setLockedContacts] = useState<Record<string, boolean>>({});

  const fetchContacts = async (sessionName: string) => {
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) return;

      const params = new URLSearchParams();
      params.set("session_name", sessionName);

      const res = await fetch(`${BACKEND_URL}/whatsapp/contacts?${params.toString()}`, {
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

      const res = await fetch(`${BACKEND_URL}/whatsapp/contacts/lock`, {
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
        setLockedContacts(prev => ({ ...prev, [phoneNumber]: currentStatus }));
        toast.error("Failed to update lock status");
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
  
  // Date Filter State
  const [date, setDate] = useState<DateRange | undefined>({
    from: startOfDay(new Date()),
    to: endOfDay(new Date()),
  });
  const [filterType, setFilterType] = useState("today");

  useEffect(() => {
    const checkConnection = () => {
        const storedSessionName = localStorage.getItem("active_wa_session_id");
        setActiveSessionName(storedSessionName);
        if (storedSessionName) {
            fetchStats(storedSessionName);
        } else {
            // Fallback: If no session name but we have a DB ID, maybe we can fetch the session name?
            // This happens if the user refreshes and SessionSelector hasn't run yet.
            const storedDbId = localStorage.getItem("active_wp_db_id");
            if (storedDbId) {
                // We can't easily fetch session name from DB ID here without a query.
                // Let's try to fetch it.
                fetchSessionNameFromId(storedDbId);
            }
        }
    };

    checkConnection();
    window.addEventListener("storage", checkConnection);
    window.addEventListener("db-connection-changed", checkConnection);

    return () => {
        window.removeEventListener("storage", checkConnection);
        window.removeEventListener("db-connection-changed", checkConnection);
    };
  }, []); // Fetch stats once on mount

  const fetchSessionNameFromId = async (id: string) => {
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) return;

      const res = await fetch(`${BACKEND_URL}/whatsapp/session-name/${id}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) return;

      const data = await res.json();
      if (data && data.session_name) {
        const sName = String(data.session_name);
        localStorage.setItem("active_wa_session_id", sName);
        setActiveSessionName(sName);
        fetchStats(sName);
      }
    } catch (e) {
      console.error("Error recovering session name", e);
    }
  };


  useEffect(() => {
    // Fetch messages whenever date or sessionName changes
    if (activeSessionName && date?.from && date?.to) {
        fetchMessages(activeSessionName, date.from, date.to);
        fetchContacts(activeSessionName);
    }
  }, [activeSessionName, date]);

  const fetchMessages = async (sessionName: string, from: Date, to: Date) => {
    setLoading(true);
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) {
        setMessages([]);
        setFilteredBotReplyCount(0);
        setFilteredTokenCount(0);
        return;
      }

      const params = new URLSearchParams();
      params.set("session_name", sessionName);
      params.set("from", from.getTime().toString());
      params.set("to", to.getTime().toString());

      const res = await fetch(`${BACKEND_URL}/api/whatsapp/messages?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        throw new Error("Failed to fetch messages");
      }

      const data = await res.json();
      const rows: WaChat[] = (Array.isArray(data) ? data : []) as WaChat[];

      const botReplies = rows.filter(m => m.reply_by === "bot").length || 0;
      setFilteredBotReplyCount(botReplies);

      const tokens = rows.reduce((acc, curr) => acc + (curr.token_usage || 0), 0) || 0;
      setFilteredTokenCount(tokens);

      setMessages(rows);
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

      const res = await fetch(`${BACKEND_URL}/whatsapp/stats?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) return;

      const data = await res.json();
      setAllTimeBotReplies(data.allTimeBotReplies || 0);
      setAllTimeTokenCount(data.allTimeTokenCount || 0);
    } catch (e) {
      console.error("Stats fetch error", e);
    }
  };

  const handleRefresh = () => {
    if (activeSessionName && date?.from && date?.to) {
        fetchMessages(activeSessionName, date.from, date.to);
        fetchStats(activeSessionName);
        toast.success("Refreshed data");
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
      setDate({ from: startOfDay(subDays(now, 6)), to: endOfDay(now) });
    } else if (value === "last30") {
      setDate({ from: startOfDay(subDays(now, 29)), to: endOfDay(now) });
    } else if (value === "custom") {
      // Keep current date or open calendar
    }
  };

  if (!activeSessionName) {
      return (
          <div className="space-y-6">
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
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
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
                    <SelectValue placeholder="Select period" />
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
                        variant={"outline"}
                        className={cn(
                          "w-[240px] justify-start text-left font-normal",
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
                    <PopoverContent className="w-auto p-0" align="start">
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

                <Button variant="outline" size="icon" onClick={handleRefresh}>
                    <RefreshCw className="h-4 w-4" />
                </Button>
            </div>
        </div>

        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10">
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
          <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10">
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
          <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10">
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
          <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Tokens (Filtered)</CardTitle>
              <Zap className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{filteredTokenCount.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">
                Tokens in selected range
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10 shadow-[0_18px_40px_rgba(0,0,0,0.35)]">
        <CardHeader>
          <CardTitle>Message History</CardTitle>
          <CardDescription>Recent messages from users and bot replies.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Sender ID</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Reply By</TableHead>
                <TableHead>Usage (Tokens/Model)</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
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
                    <TableCell>{new Date(msg.timestamp).toLocaleString()}</TableCell>
                    <TableCell className="font-mono text-xs">{msg.sender_id}</TableCell>
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
                      {expandedMessageIds.has(msg.id || msg.message_id || 'unknown') && msg.model_used && (
                        <div className="text-[10px] text-muted-foreground mt-1">
                          {msg.model_used}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`px-2 py-1 rounded-full text-xs border ${
                          msg.reply_by === 'bot'
                            ? 'bg-[#00ff88]/10 text-[#00ff88] border-[#00ff88]/40'
                            : 'bg-white/5 text-white/80 border-white/20'
                        }`}
                      >
                        {msg.reply_by || 'Unknown'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-bold">{msg.token_usage || 0}</span>
                        <span
                          className="text-[10px] text-muted-foreground truncate max-w-[150px]"
                          title={msg.model_used}
                        >
                          {msg.model_used || '-'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span
                        className={`px-2 py-1 rounded-full text-xs border ${
                          msg.status === 'sent'
                            ? 'bg-[#00ff88]/10 text-[#00ff88] border-[#00ff88]/40'
                            : 'bg-yellow-500/10 text-yellow-300 border-yellow-500/40'
                        }`}
                      >
                        {msg.status}
                      </span>
                    </TableCell>
                    <TableCell>
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
                                        <Unlock className="h-4 w-4 text-green-500" />
                                    }
                                </Button>
                            );
                        })()}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
