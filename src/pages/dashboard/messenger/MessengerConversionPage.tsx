import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { MessageSquare, RefreshCw, AlertCircle, Calendar as CalendarIcon, Zap, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Link } from "react-router-dom";
import { addDays, format, startOfDay, endOfDay, subDays, isWithinInterval, parseISO } from "date-fns";
import { DateRange } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import { useMessenger } from "@/context/MessengerContext";
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

export default function MessengerConversionPage() {
  const { currentPage, loading: contextLoading } = useMessenger();
  const [messages, setMessages] = useState<any[]>([]);
  const [groupedMessages, setGroupedMessages] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(false);
  const [filteredBotReplyCount, setFilteredBotReplyCount] = useState(0);
  const [allTimeBotReplies, setAllTimeBotReplies] = useState(0);
  const [filteredTokenCount, setFilteredTokenCount] = useState(0);
  const [allTimeTokenCount, setAllTimeTokenCount] = useState(0);
  const [tokenBreakdown, setTokenBreakdown] = useState<Record<string, number>>({});
  const [currentPageNum, setCurrentPageNum] = useState(1);
  const [totalMessages, setTotalMessages] = useState(0);
  const LIMIT = 50;
  
  // Date Filter State
  const [date, setDate] = useState<DateRange | undefined>({
    from: startOfDay(new Date()),
    to: endOfDay(new Date()),
  });
  const [filterType, setFilterType] = useState("today");

  const activePageId = currentPage?.page_id || null;

  useEffect(() => {
    if (activePageId) {
        fetchStats(activePageId);
    }
  }, [activePageId]);

  useEffect(() => {
    // Fetch messages whenever date, pageId, or currentPageNum changes
    if (activePageId && date?.from && date?.to) {
        fetchMessages(activePageId, date.from, date.to, currentPageNum);
    }
  }, [activePageId, date, currentPageNum]);

  // Reset page when date changes
  useEffect(() => {
    setCurrentPageNum(1);
  }, [date]);

  // Separate function for All Time Stats (Optimized)
  const fetchStats = async (pageId: string) => {
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) return;

      const params = new URLSearchParams();
      params.set("page_id", pageId);

      const res = await fetch(`${BACKEND_URL}/api/messenger/stats?${params.toString()}`, {
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

  const fetchMessages = async (pageId: string, from: Date, to: Date, page: number = 1) => {
    setLoading(true);
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) {
        setMessages([]);
        setFilteredBotReplyCount(0);
        setFilteredTokenCount(0);
        setTokenBreakdown({});
        setTotalMessages(0);
        return;
      }

      const params = new URLSearchParams();
      params.set("page_id", pageId);
      params.set("from", from.toISOString());
      params.set("to", to.toISOString());
      params.set("page", String(page));
      params.set("limit", String(LIMIT));

      const res = await fetch(`${BACKEND_URL}/api/messenger/chats?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        throw new Error("Failed to fetch messages");
      }

      const result = await res.json();
      const fetchedMessages = Array.isArray(result.data) ? result.data : [];
      setMessages(fetchedMessages);
      setTotalMessages(result.total || 0);
      setFilteredBotReplyCount(result.filteredBotReplyCount || 0);
      setFilteredTokenCount(result.filteredTokenCount || 0);
      setTokenBreakdown(result.tokenBreakdown || {});

    } catch (error) {
      console.error("Error fetching messages:", error);
      toast.error("Failed to fetch messages");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const groups: Record<string, any[]> = {};
    messages.forEach((msg) => {
      if (!groups[msg.sender_id]) {
        groups[msg.sender_id] = [];
      }
      groups[msg.sender_id].push(msg);
    });
    setGroupedMessages(groups);
  }, [messages]);

  const handleFilterChange = (val: string) => {
    setFilterType(val);
    const now = new Date();
    
    if (val === 'today') {
        setDate({ from: startOfDay(now), to: endOfDay(now) });
    } else if (val === 'yesterday') {
        const y = subDays(now, 1);
        setDate({ from: startOfDay(y), to: endOfDay(y) });
    } else if (val === 'last7') {
        setDate({ from: subDays(now, 7), to: endOfDay(now) });
    }
    // custom: date picker handles it
  };

  const handleRefresh = () => {
    if (activePageId) {
        if (date?.from && date?.to) {
             fetchMessages(activePageId, date.from, date.to, currentPageNum);
             fetchStats(activePageId); // Also refresh stats
        } else {
             fetchMessages(activePageId, startOfDay(new Date()), endOfDay(new Date()), 1);
             fetchStats(activePageId);
        }
    } else {
        toast.error("No active page found. Please connect a database.");
    }
  };

  const handleDownload = async () => {
    if (!activePageId || !date?.from || !date?.to) {
      toast.error("Please select a page and a date range.");
      return;
    }

    try {
      const token = localStorage.getItem("auth_token");
      const params = new URLSearchParams();
      params.set("page_id", activePageId);
      params.set("from", date.from.toISOString());
      params.set("to", date.to.toISOString());

      const response = await fetch(`${BACKEND_URL}/api/messenger/download-conversation?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `conversation_${activePageId}_${format(date.from, "yyyy-MM-dd")}_to_${format(date.to, "yyyy-MM-dd")}.txt`;
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

  if (contextLoading && !activePageId) {
      return (
          <div className="flex items-center justify-center min-h-[400px]">
              <RefreshCw className="h-8 w-8 animate-spin text-primary" />
          </div>
      );
  }

  if (!activePageId) {
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
                <AlertTitle>No Database Connected</AlertTitle>
                <AlertDescription>
                    Please connect a database in the <Link to="/dashboard/messenger/database" className="underline font-bold">Database Connect</Link> page to view conversions.
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
                Track user messages and bot automated replies for Page ID: <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded">{activePageId}</span>
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
            </div>
        </div>
      </div>

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

      <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10 shadow-[0_18px_40px_rgba(0,0,0,0.35)]">
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
                  <TableCell colSpan={6} className="text-center">No messages found for this page</TableCell>
                </TableRow>
              ) : (
                messages.map((msg) => (
                  <TableRow key={msg.id}>
                    <TableCell>{new Date(msg.created_at).toLocaleString()}</TableCell>
                    <TableCell className="font-mono text-xs">{msg.sender_id}</TableCell>
                    <TableCell className="max-w-[300px] truncate" title={msg.text}>{msg.text}</TableCell>
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
                      {msg.token ? (
                        <div className="flex flex-col">
                          <span className="font-bold">{msg.token}</span>
                          {msg.ai_model && (
                            <span className="text-[10px] text-muted-foreground">
                              {msg.ai_model}
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
                            ? 'bg-[#00ff88]/10 text-[#00ff88] border-[#00ff88]/40'
                            : 'bg-yellow-500/10 text-yellow-300 border-yellow-500/40'
                        }`}
                      >
                        {msg.status}
                      </span>
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
