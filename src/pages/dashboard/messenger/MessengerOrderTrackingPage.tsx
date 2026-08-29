import { useEffect, useState, useCallback, useRef } from "react";
import { useMessenger } from "@/context/MessengerContext";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  BriefcaseBusiness,
  Calendar as CalendarIcon,
  CalendarCheck,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Info,
  MessageSquare,
  Package,
  RefreshCw,
  ShoppingBag,
  Store,
} from "lucide-react";
import { toast } from "sonner";
import { BACKEND_URL } from "@/config";
import { OrderNotificationModal } from "@/components/dashboard/OrderNotificationModal";
import { ConversationDialog } from "@/components/dashboard/ConversationDialog";
import { useParams } from "react-router-dom";

interface Order {
  id: string;
  product_name: string;
  product_quantity: string | number;
  price: string | number;
  location: string;
  number: string;
  customer_name?: string;
  status: string;
  sender_id: string;
  created_at: string;
}

type BusinessType = "ecommerce" | "service" | "appointment";

const businessTypes: Array<{
  id: BusinessType;
  title: string;
  badge: string;
  description: string;
  examples: string[];
  Icon: typeof Package;
  accent: "emerald" | "sky" | "violet";
}> = [
  {
    id: "ecommerce",
    title: "E-commerce",
    badge: "Product Sell (Courier)",
    description: "Sell physical products online that require courier delivery to customers.",
    examples: ["Clothing, gadgets, accessories", "Home decor, electronics", "Any product that needs delivery"],
    Icon: Package,
    accent: "emerald",
  },
  {
    id: "service",
    title: "Service",
    badge: "Digital / Online Services",
    description: "Sell digital services or intangible products delivered online without courier.",
    examples: ["Follower / Like / View Sell", "Digital Products / E-books", "Demand / Lead Generation", "Other Online Services"],
    Icon: BriefcaseBusiness,
    accent: "sky",
  },
  {
    id: "appointment",
    title: "Appointment",
    badge: "Booking / Reservation",
    description: "Manage appointments, bookings or reservations for any type of service.",
    examples: ["Doctor / DC Appointment", "Consultation Booking", "Event / Meeting Reservation", "Any Time-based Booking"],
    Icon: CalendarCheck,
    accent: "violet",
  },
];

const businessAccentClasses = {
  emerald: {
    card: "border-emerald-500/40 bg-emerald-500/[0.045] hover:border-emerald-400/70 hover:bg-emerald-500/[0.08]",
    iconWrap: "border-emerald-400/60 bg-emerald-500/15 text-emerald-400 shadow-emerald-500/20",
    badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
    example: "text-emerald-400",
    ring: "ring-emerald-400/70",
  },
  sky: {
    card: "border-sky-500/30 bg-sky-500/[0.035] hover:border-sky-400/70 hover:bg-sky-500/[0.075]",
    iconWrap: "border-sky-400/60 bg-sky-500/15 text-sky-400 shadow-sky-500/20",
    badge: "bg-sky-500/15 text-sky-400 border-sky-500/25",
    example: "text-sky-400",
    ring: "ring-sky-400/70",
  },
  violet: {
    card: "border-violet-500/30 bg-violet-500/[0.035] hover:border-violet-400/70 hover:bg-violet-500/[0.075]",
    iconWrap: "border-violet-400/60 bg-violet-500/15 text-violet-400 shadow-violet-500/20",
    badge: "bg-violet-500/15 text-violet-400 border-violet-500/25",
    example: "text-violet-400",
    ring: "ring-violet-400/70",
  },
} as const;

const orderExportHeaders = ["ID", "Product Name", "Customer Name", "Number", "Location", "Quantity", "Price", "Date"];

const getOrderExportRows = (orders: Order[]) => [
  orderExportHeaders,
  ...orders.map((order) => [
    order.id,
    order.product_name || "",
    order.customer_name || "",
    order.number || "",
    order.location || "",
    order.product_quantity || "",
    order.price || "",
    order.created_at || "",
  ]),
];

const escapeCsvCell = (value: string | number) => {
  const text = String(value ?? "");
  const escaped = text.replace(/"/g, '""');
  return /[",\r\n]/.test(text) ? `"${escaped}"` : escaped;
};

const escapeSheetCell = (value: string | number) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const downloadBlob = (content: string, type: string, fileName: string) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export default function MessengerOrderTrackingPage() {
  const { platform } = useParams();
  const isInstagram = platform === "instagram";
  const platformName = isInstagram ? "Instagram" : "Messenger";
  const botLabel = isInstagram ? "Instagram bot" : "Facebook bot";
  const exportPrefix = isInstagram ? "instagram" : "fb";
  const notificationPlatform = isInstagram ? "instagram" : "messenger";
  const { currentPage, loading: contextLoading } = useMessenger();
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [orderLoading, setOrderLoading] = useState(false);
  const [dateFilter, setDateFilter] = useState<'today' | 'yesterday' | 'custom' | 'all'>('today');
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [businessModalOpen, setBusinessModalOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return !localStorage.getItem("messenger_order_business_type");
  });
  const [selectedBusinessType, setSelectedBusinessType] = useState<BusinessType>(() => {
    if (typeof window === "undefined") return "ecommerce";
    return (localStorage.getItem("messenger_order_business_type") as BusinessType | null) || "ecommerce";
  });
  const lastFetchParams = useRef("");
  const lastFetchAt = useRef(0);
  const ordersRef = useRef<Order[]>([]);
  const requestIdRef = useRef(0);
  const inFlightRef = useRef<AbortController | null>(null);

  const activePageId = currentPage?.page_id || null;
  const activeDbId = currentPage?.db_id || (typeof window !== "undefined" ? Number(localStorage.getItem("active_fb_db_id") || 0) : 0);

  const updateOrderStatus = async (orderId: string, newStatus: string) => {
    const token = localStorage.getItem("auth_token");
    if (!token) return;

    try {
      const res = await fetch(`${BACKEND_URL}/api/messenger/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!res.ok) throw new Error("Failed to update status");
      
      toast.success(`Order status updated to ${newStatus}`);
      fetchOrders(false); // Refresh without full loading state
    } catch (error) {
      console.error("Error updating order status:", error);
      toast.error("Failed to update status");
    }
  };

  const handleCopy = (order: Order) => {
    const textToCopy = `Customer Name: ${order.customer_name || 'N/A'}
Product: ${order.product_name || 'N/A'}
Qty: ${order.product_quantity || '1'}
Price: ${order.price || 'N/A'}
Location: ${order.location || 'N/A'}
Phone: ${order.number || 'N/A'}`;

    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopiedId(order.id);
      toast.success("Order details copied to clipboard");
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const handleOpenConversion = (order: Order) => {
    if (!order.sender_id) {
      toast.error("No sender found for this order");
      return;
    }

    setSelectedOrder(order);
  };

  const handleBusinessContinue = () => {
    localStorage.setItem("messenger_order_business_type", selectedBusinessType);
    setBusinessModalOpen(false);
  };

  const selectedBusinessLabel = businessTypes.find((type) => type.id === selectedBusinessType)?.title || "Business Type";

  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);

  const fetchOrders = useCallback(async (showLoading = true) => {
    const token = localStorage.getItem("auth_token");
    
    if (!token || !activePageId) {
      setOrders([]);
      setOrderLoading(false);
      return;
    }

    if (showLoading) setOrderLoading(true);
    
    let requestId = 0;
    let controller: AbortController | null = null;
    try {
      const params = new URLSearchParams();
      params.set("page_id", activePageId);

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      if (dateFilter === 'today') {
        params.set("from", today.getTime().toString());
        params.set("to", tomorrow.getTime().toString());
      } else if (dateFilter === 'yesterday') {
        params.set("from", yesterday.getTime().toString());
        params.set("to", today.getTime().toString());
      } else if (dateFilter === 'custom' && date) {
        const customStart = new Date(date);
        customStart.setHours(0, 0, 0, 0);
        const customEnd = new Date(date);
        customEnd.setHours(23, 59, 59, 999);
        params.set("from", customStart.getTime().toString());
        params.set("to", customEnd.getTime().toString());
      }

      const currentParams = params.toString();
      const now = Date.now();
      if (currentParams === lastFetchParams.current && ordersRef.current.length > 0 && now - lastFetchAt.current < 1500) {
        setOrderLoading(false);
        return;
      }

      if (inFlightRef.current) {
        inFlightRef.current.abort();
      }
      controller = new AbortController();
      inFlightRef.current = controller;
      requestId = ++requestIdRef.current;

      const res = await fetch(`${BACKEND_URL}/api/messenger/orders?${currentParams}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal
      });

      if (!res.ok) throw new Error("Failed to fetch orders");

      const data = await res.json();
      
      // Update last fetch params after success
      lastFetchParams.current = currentParams;
      lastFetchAt.current = Date.now();
      setOrders(Array.isArray(data) ? data : []);
    } catch (error) {
      if ((error as Error)?.name === "AbortError") return;
      console.error("Error fetching orders:", error);
      toast.error("Failed to fetch orders");
    } finally {
      if (requestIdRef.current === requestId) {
        setOrderLoading(false);
        if (inFlightRef.current === controller) {
          inFlightRef.current = null;
        }
      }
    }
  }, [dateFilter, date, activePageId]);

  // Combined effect for initial fetch and filter changes
  useEffect(() => {
    if (activePageId) {
      fetchOrders(true);
    }
  }, [fetchOrders, activePageId]);

  const downloadCSV = () => {
    if (!orders.length) {
      toast.error("No orders to export");
      return;
    }

    const csvContent = getOrderExportRows(orders)
      .map((row) => row.map(escapeCsvCell).join(","))
      .join("\r\n");

    downloadBlob(
      `\uFEFF${csvContent}`,
      "text/csv;charset=utf-8;",
      `${exportPrefix}_orders_${dateFilter}_${format(new Date(), "yyyy-MM-dd")}.csv`
    );
  };

  const downloadGoogleSheet = () => {
    if (!orders.length) {
      toast.error("No orders to export");
      return;
    }

    const tableRows = getOrderExportRows(orders)
      .map((row) => `<tr>${row.map((cell) => `<td>${escapeSheetCell(cell)}</td>`).join("")}</tr>`)
      .join("");
    const sheetContent = `<!DOCTYPE html><html><head><meta charset="UTF-8" /></head><body><table>${tableRows}</table></body></html>`;

    downloadBlob(
      sheetContent,
      "application/vnd.ms-excel;charset=utf-8;",
      `${exportPrefix}_orders_${dateFilter}_${format(new Date(), "yyyy-MM-dd")}.xls`
    );
  };

  if (contextLoading && !activePageId) {
      return (
          <div className="flex items-center justify-center min-h-[400px]">
              <RefreshCw className="h-8 w-8 animate-spin text-primary" />
          </div>
      );
  }

  return (
    <div className="space-y-6 -m-4 md:-m-6 lg:-m-6 p-4 md:p-6 lg:p-6">
      <div className="flex items-center justify-between">
        <div>
           <h2 className="text-3xl font-bold tracking-tight">{platformName} Order Tracking</h2>
           <p className="text-muted-foreground">
             View and manage customer orders collected by the {botLabel}.
           </p>
        </div>
        {activeDbId > 0 && (
          <OrderNotificationModal dbId={activeDbId} platform={notificationPlatform as any} />
        )}
      </div>

      <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10 shadow-[0_18px_40px_rgba(0,0,0,0.35)] border-l-4 border-l-[#00ff88]">
        <CardHeader>
           <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                  <CardTitle className="flex items-center gap-2">
                      <ShoppingBag className="h-5 w-5" />
                      Order List
                  </CardTitle>
                  <CardDescription>All orders within the selected period.</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-3 md:gap-4">
                  <Button
                    variant="outline"
                    onClick={() => setBusinessModalOpen(true)}
                    className="border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300"
                  >
                    <Store className="mr-2 h-4 w-4" />
                    {selectedBusinessLabel}
                  </Button>
                  <Select value={dateFilter} onValueChange={(val: 'today' | 'yesterday' | 'custom' | 'all') => setDateFilter(val)}>
                      <SelectTrigger className="w-[130px]">
                          <SelectValue placeholder="Filter" />
                      </SelectTrigger>
                      <SelectContent>
                          <SelectItem value="today">Today</SelectItem>
                          <SelectItem value="yesterday">Yesterday</SelectItem>
                          <SelectItem value="custom">Custom Date</SelectItem>
                          <SelectItem value="all">All Time</SelectItem>
                      </SelectContent>
                  </Select>
                  
                  {dateFilter === 'custom' && (
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
                            {date ? format(date, "PPP") : <span>Pick a date</span>}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                          <Calendar
                            mode="single"
                            selected={date}
                            onSelect={setDate}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                  )}

                  <Button variant="outline" onClick={downloadCSV}>
                      <Download className="mr-2 h-4 w-4" />
                      CSV
                  </Button>
                  <Button variant="outline" onClick={downloadGoogleSheet}>
                      <Download className="mr-2 h-4 w-4" />
                      Google Sheet
                  </Button>
              </div>
           </div>
        </CardHeader>
        <CardContent>
          {orderLoading ? (
               <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
               </div>
          ) : orders.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground border-2 border-dashed rounded-lg">
                  <ShoppingBag className="mx-auto h-12 w-12 opacity-20 mb-3" />
                  <p>No orders found for the selected period.</p>
              </div>
          ) : (
              <div className="rounded-md border overflow-hidden">
                  <Table>
                      <TableHeader className="bg-muted/50">
                          <TableRow>
                              <TableHead>Date</TableHead>
                              <TableHead>Product</TableHead>
                              <TableHead>Qty</TableHead>
                              <TableHead>Price</TableHead>
                              <TableHead>Location</TableHead>
                              <TableHead>Customer</TableHead>
                              <TableHead>Phone</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Sender ID</TableHead>
                              <TableHead className="w-[120px]">Actions</TableHead>
                          </TableRow>
                      </TableHeader>
                      <TableBody>
                          {orders.map((order) => (
                              <TableRow key={order.id} className="hover:bg-muted/50">
                                  <TableCell className="font-medium whitespace-nowrap">
                                      {format(new Date(order.created_at), "MMM d, HH:mm")}
                                  </TableCell>
                                  <TableCell className="font-medium">{order.product_name}</TableCell>
                                  <TableCell>{order.product_quantity}</TableCell>
                                  <TableCell>{order.price}</TableCell>
                                  <TableCell className="max-w-[200px]">
                                    <Popover>
                                      <PopoverTrigger asChild>
                                        <span className="truncate block cursor-pointer hover:underline text-primary" title="Click to view full address">
                                          {order.location}
                                        </span>
                                      </PopoverTrigger>
                                      <PopoverContent className="w-80">
                                        <div className="space-y-2">
                                          <h4 className="font-medium leading-none">Full Address</h4>
                                          <p className="text-sm text-muted-foreground break-words">{order.location}</p>
                                        </div>
                                      </PopoverContent>
                                    </Popover>
                                  </TableCell>
                                  <TableCell>
                                    {order.customer_name || '-'}
                                  </TableCell>
                                  <TableCell>
                                    {order.number || '-'}
                                  </TableCell>
                                  <TableCell>
                                    <Select 
                                      value={order.status || 'ongoing'} 
                                      onValueChange={(val) => updateOrderStatus(order.id, val)}
                                    >
                                      <SelectTrigger className={cn(
                                        "w-[110px] h-8 text-xs font-medium border-none",
                                        (order.status === 'ongoing' || !order.status) && "bg-[#00ff88]/10 text-[#00ff88] hover:bg-[#00ff88]/20",
                                        order.status === 'delivered' && "bg-blue-500/10 text-blue-500 hover:bg-blue-500/20",
                                        order.status === 'locked' && "bg-red-500/10 text-red-500 hover:bg-red-500/20",
                                        order.status === 'cancelled' && "bg-muted text-muted-foreground hover:bg-muted/80"
                                      )}>
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="ongoing">Ongoing</SelectItem>
                                        <SelectItem value="delivered">Delivered</SelectItem>
                                        <SelectItem value="locked">Locked</SelectItem>
                                        <SelectItem value="cancelled">Cancelled</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </TableCell>
                                  <TableCell>{order.sender_id}</TableCell>
                                  <TableCell>
                                    <div className="flex items-center gap-1">
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => handleOpenConversion(order)}
                                        title="Open Conversation"
                                      >
                                        <MessageSquare className="h-4 w-4 text-primary" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => handleCopy(order)}
                                        title="Copy Order Details"
                                      >
                                        {copiedId === order.id ? (
                                          <Check className="h-4 w-4 text-[#00ff88]" />
                                        ) : (
                                          <Copy className="h-4 w-4 text-muted-foreground" />
                                        )}
                                      </Button>
                                    </div>
                                  </TableCell>
                              </TableRow>
                          ))}
                      </TableBody>
                  </Table>
              </div>
          )}
        </CardContent>
      </Card>
      <Dialog open={businessModalOpen} onOpenChange={setBusinessModalOpen}>
        <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] max-w-5xl overflow-y-auto border-white/10 bg-[#0c1015]/95 p-0 text-white shadow-[0_24px_80px_rgba(0,0,0,0.65)] backdrop-blur-xl sm:rounded-2xl">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_0%,rgba(0,255,136,0.12),transparent_32%),radial-gradient(circle_at_80%_12%,rgba(59,130,246,0.10),transparent_28%)]" />
          <div className="p-6 md:p-8">
            <DialogHeader className="flex-row items-start gap-4 space-y-0 text-left">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-emerald-500/25 bg-emerald-500/15 text-emerald-400 shadow-lg shadow-emerald-500/10">
                <Store className="h-8 w-8" />
              </div>
              <div className="pt-1">
                <DialogTitle className="text-2xl font-bold tracking-tight">Select Business Type</DialogTitle>
                <DialogDescription className="mt-2 text-sm text-slate-300">
                  Choose the type that best matches your business model.
                </DialogDescription>
              </div>
            </DialogHeader>

            <div className="mt-8 grid gap-4 md:grid-cols-3 md:gap-5">
              {businessTypes.map((type) => {
                const Icon = type.Icon;
                const accent = businessAccentClasses[type.accent];
                const isSelected = selectedBusinessType === type.id;

                return (
                  <button
                    key={type.id}
                    type="button"
                    onClick={() => setSelectedBusinessType(type.id)}
                    className={cn(
                      "group relative flex min-h-[460px] flex-col rounded-xl border p-4 text-center transition-all duration-200 hover:-translate-y-1 focus:outline-none focus:ring-2",
                      accent.card,
                      isSelected && "translate-y-[-2px] ring-2",
                      isSelected && accent.ring
                    )}
                  >
                    <span className={cn(
                      "absolute right-5 top-5 flex h-7 w-7 items-center justify-center rounded-full border transition-colors",
                      isSelected ? "border-emerald-400 bg-emerald-400 text-slate-950" : "border-white/20 bg-white/5 text-transparent"
                    )}>
                      <Check className="h-4 w-4" />
                    </span>

                    <div className="mt-6 flex justify-center">
                      <div className={cn("flex h-24 w-24 items-center justify-center rounded-full border shadow-xl", accent.iconWrap)}>
                        <Icon className="h-11 w-11" />
                      </div>
                    </div>

                    <h3 className="mt-5 text-xl font-bold text-white">{type.title}</h3>
                    <div className="mt-3">
                      <span className={cn("rounded-md border px-3 py-1 text-xs font-semibold", accent.badge)}>{type.badge}</span>
                    </div>
                    <p className="mx-auto mt-5 max-w-[240px] text-sm leading-6 text-slate-300">{type.description}</p>

                    <div className="mt-auto rounded-xl border border-white/10 bg-white/[0.035] p-4 text-left">
                      <p className={cn("mb-4 text-sm font-semibold", accent.example)}>Examples</p>
                      <div className="space-y-3">
                        {type.examples.map((example) => (
                          <div key={example} className="flex items-start gap-3 text-sm text-slate-300">
                            <CheckCircle2 className={cn("mt-0.5 h-4 w-4 shrink-0", accent.example)} />
                            <span>{example}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <DialogFooter className="border-t border-white/10 bg-black/20 px-6 py-5 sm:items-center sm:justify-between sm:space-x-0 md:px-8">
            <div className="flex items-center gap-3 text-sm text-slate-400">
              <Info className="h-5 w-5 text-emerald-400" />
              <span>You can change this later in settings.</span>
            </div>
            <Button onClick={handleBusinessContinue} className="h-12 rounded-xl bg-emerald-500 px-7 text-base font-bold text-white hover:bg-emerald-400">
              Continue
              <ArrowRight className="ml-3 h-5 w-5" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConversationDialog
        open={selectedOrder !== null}
        onOpenChange={(open) => !open && setSelectedOrder(null)}
        platform="messenger"
        resourceId={activePageId}
        senderId={selectedOrder?.sender_id || null}
        customerName={selectedOrder?.customer_name}
        order={selectedOrder}
      />
    </div>
  );
}
