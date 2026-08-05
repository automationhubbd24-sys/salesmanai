import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { BACKEND_URL } from "@/config";
import { cn } from "@/lib/utils";
import {
  ArrowUpRight,
  CalendarDays,
  Hash,
  Inbox,
  MapPin,
  MessageCircle,
  Package,
  Phone,
  RefreshCw,
  Send,
} from "lucide-react";

export type OrderConversationSummary = {
  id: string;
  product_name: string;
  product_quantity: string | number;
  price: string | number;
  location: string;
  number: string;
  status: string;
  created_at: string;
};

type Message = {
  from?: string;
  body?: string;
  is_ai?: boolean;
  reply_by?: string | null;
  timestamp?: string | number | null;
};

type ConversationDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platform: "whatsapp" | "messenger";
  resourceId: string | null;
  senderId: string | null;
  customerName?: string;
  order?: OrderConversationSummary | null;
};

const getInitials = (value: string) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "CU";

const formatDate = (value?: string | number | null, options?: Intl.DateTimeFormatOptions) => {
  if (value === undefined || value === null || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, options).format(date);
};

const getStatusClass = (status?: string) => {
  switch (status?.trim().toLowerCase()) {
    case "pending":
      return "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400";
    case "ongoing":
    case "confirmed":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
    case "delivered":
      return "border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-400";
    case "locked":
    case "cancelled":
      return "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
};

export function ConversationDialog({
  open,
  onOpenChange,
  platform,
  resourceId,
  senderId,
  customerName,
  order,
}: ConversationDialogProps) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const loadMessages = useCallback(async (signal: AbortSignal) => {
    if (!resourceId || !senderId) return;

    setLoading(true);
    setError(null);
    setMessages([]);

    try {
      const token = localStorage.getItem("auth_token");
      const response = await fetch(
        `${BACKEND_URL}/api/${platform}/messages/${resourceId}/${senderId}?limit=40`,
        { headers: { Authorization: `Bearer ${token}` }, signal },
      );

      if (!response.ok) throw new Error("Failed to load conversation");

      const data = await response.json();
      setMessages(Array.isArray(data) ? data : []);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError((err as Error).message || "Failed to load conversation");
      }
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [platform, resourceId, senderId]);

  useEffect(() => {
    if (!open || !resourceId || !senderId) return;

    const controller = new AbortController();
    void loadMessages(controller.signal);
    return () => controller.abort();
  }, [loadMessages, open, resourceId, senderId, retryKey]);

  const title = customerName || senderId || "Conversation";
  const platformLabel = platform === "whatsapp" ? "WhatsApp Business" : "Messenger Business";
  const platformClass = platform === "whatsapp"
    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
    : "bg-blue-500/10 text-blue-700 dark:text-blue-400";
  const orderDate = formatDate(order?.created_at, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const PlatformIcon = platform === "whatsapp" ? MessageCircle : Send;

  const handleViewDetails = () => {
    if (!senderId) return;
    onOpenChange(false);
    navigate(`/dashboard/${platform}/smart-inbox?sender_id=${encodeURIComponent(senderId)}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[calc(100vw-1.5rem)] max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:w-[calc(100vw-3rem)]">
        <DialogHeader className="border-b bg-muted/30 px-5 py-4 pr-12 sm:px-6 sm:pr-14">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar className="h-11 w-11 shrink-0 border">
              <AvatarFallback className={platformClass}>{getInitials(title)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle className="truncate text-base sm:text-lg">{title}</DialogTitle>
                <Badge variant="secondary" className={cn("gap-1", platformClass)}>
                  <PlatformIcon className="h-3 w-3" />
                  {platformLabel}
                </Badge>
              </div>
              <DialogDescription className="mt-0.5 truncate">
                {senderId || "No customer identifier"} · Conversation preview
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_280px]">
          <section className="flex min-h-0 flex-col border-b lg:border-b-0 lg:border-r">
            <div className="flex items-center gap-2 border-b px-5 py-3 sm:px-6">
              <MessageCircle className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Message timeline</h3>
              <span className="text-xs text-muted-foreground">Read-only preview</span>
            </div>
            <ScrollArea className="h-[38vh] min-h-[260px] flex-1 bg-muted/10 px-5 py-5 sm:px-6 lg:h-auto">
              {loading ? (
                <div className="space-y-5">
                  {["w-3/4", "w-2/3", "w-3/5"].map((width, index) => (
                    <div key={index} className={cn("space-y-2", index === 1 && "ml-auto flex flex-col items-end")}>
                      <Skeleton className="h-3 w-20" />
                      <Skeleton className={cn("h-16 rounded-2xl", width)} />
                    </div>
                  ))}
                </div>
              ) : error ? (
                <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 text-center">
                  <div className="rounded-full bg-destructive/10 p-3 text-destructive"><RefreshCw className="h-5 w-5" /></div>
                  <div>
                    <p className="text-sm font-medium">Could not load conversation</p>
                    <p className="mt-1 text-xs text-muted-foreground">{error}</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setRetryKey((key) => key + 1)}>
                    <RefreshCw className="mr-2 h-3.5 w-3.5" />Retry
                  </Button>
                </div>
              ) : messages.length === 0 ? (
                <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 text-center">
                  <div className="rounded-full bg-muted p-3"><Inbox className="h-6 w-6 text-muted-foreground" /></div>
                  <div>
                    <p className="text-sm font-medium">No messages found</p>
                    <p className="mt-1 text-xs text-muted-foreground">Messages for this customer will appear here when available.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((message, index) => {
                    const isBot = message.reply_by === "bot" || message.is_ai;
                    const isAdmin = !isBot && (message.reply_by === "admin" || message.from === "me");
                    const isOutgoing = isBot || isAdmin;
                    const role = isBot ? "Bot / Agent" : isAdmin ? "Admin" : "Customer";
                    const time = formatDate(message.timestamp, { hour: "numeric", minute: "2-digit" });
                    const bubbleClass = isBot
                      ? "rounded-br-sm bg-emerald-600 text-white"
                      : isAdmin
                        ? "rounded-br-sm bg-blue-600 text-white"
                        : "rounded-bl-sm bg-zinc-800 text-zinc-50 dark:bg-zinc-900";

                    return (
                      <div key={`${message.timestamp || "message"}-${index}`} className={cn("flex", isOutgoing ? "justify-end" : "justify-start")}>
                        <div className={cn("flex max-w-[88%] flex-col gap-1 sm:max-w-[76%]", isOutgoing ? "items-end" : "items-start")}>
                          <span className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{role}</span>
                          <div className={cn("rounded-2xl px-3.5 py-2.5 text-sm shadow-sm", bubbleClass)}>
                            <p className="whitespace-pre-wrap break-words leading-relaxed">{message.body || "—"}</p>
                            {time && <p className="mt-1.5 text-right text-[10px] text-white/70">{time}</p>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </section>

          <aside className="bg-muted/20 px-5 py-5 sm:px-6 lg:overflow-y-auto">
            <div className="space-y-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customer context</p>
                <div className="mt-3 space-y-3 text-sm">
                  <div className="flex gap-2"><Hash className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><span className="break-all">{senderId || "Unavailable"}</span></div>
                  {order?.number && <div className="flex gap-2"><Phone className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><span className="break-words">{order.number}</span></div>}
                  {order?.location && <div className="flex gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><span className="break-words">{order.location}</span></div>}
                </div>
              </div>

              {order && (
                <div className="rounded-xl border bg-background p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2"><Package className="h-4 w-4 text-muted-foreground" /><p className="text-sm font-semibold">Order summary</p></div>
                    <Badge variant="outline" className={getStatusClass(order.status)}>{order.status || "Unknown"}</Badge>
                  </div>
                  <div className="mt-4 space-y-3 text-sm">
                    <div><p className="text-xs text-muted-foreground">Order ID</p><p className="mt-0.5 truncate font-medium" title={order.id}>#{order.id.slice(-8)}</p></div>
                    <div><p className="text-xs text-muted-foreground">Product</p><p className="mt-0.5 break-words font-medium">{order.product_name || "—"}</p></div>
                    <div className="grid grid-cols-2 gap-3"><div><p className="text-xs text-muted-foreground">Quantity</p><p className="mt-0.5 font-medium">{order.product_quantity || "—"}</p></div><div><p className="text-xs text-muted-foreground">Price</p><p className="mt-0.5 font-medium">{order.price || "—"}</p></div></div>
                    {orderDate && <div className="flex gap-2 border-t pt-3 text-xs text-muted-foreground"><CalendarDays className="h-3.5 w-3.5 shrink-0" />{orderDate}</div>}
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>

        <DialogFooter className="border-t bg-background px-5 py-3 sm:flex-row sm:justify-end sm:px-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={handleViewDetails} disabled={!senderId}>
            View more details<ArrowUpRight className="ml-2 h-4 w-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
