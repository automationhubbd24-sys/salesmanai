import { useCallback, useEffect, useState } from "react";
import { useWhatsApp } from "@/context/WhatsAppContext";
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
  AlertCircle,
  MessageSquare,
  Package,
  RefreshCw,
  ShoppingBag,
  Store,
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { BACKEND_URL } from "@/config";
import { OrderNotificationModal } from "@/components/dashboard/OrderNotificationModal";
import { ConversationDialog } from "@/components/dashboard/ConversationDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type BusinessType = "ecommerce" | "service" | "appointment";

interface Order {
  id: string;
  business_type?: BusinessType;
  product_name: string;
  product_quantity: string | number;
  price: string | number;
  location: string;
  number: string;
  customer_name?: string;
  service_name?: string;
  service_package?: string;
  service_details?: string;
  delivery_method?: string;
  appointment_type?: string;
  appointment_date?: string;
  appointment_time?: string;
  appointment_notes?: string;
  assigned_to?: string;
  status: string;
  sender_id: string;
  created_at: string;
}

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

const statusOptionsByType: Record<BusinessType, Array<{ value: string; label: string }>> = {
  ecommerce: [
    { value: "pending", label: "Pending" },
    { value: "ongoing", label: "Ongoing" },
    { value: "delivered", label: "Delivered" },
    { value: "locked", label: "Locked" },
    { value: "cancelled", label: "Cancelled" },
  ],
  service: [
    { value: "new", label: "New" },
    { value: "in_progress", label: "In Progress" },
    { value: "waiting_customer", label: "Waiting" },
    { value: "completed", label: "Completed" },
    { value: "cancelled", label: "Cancelled" },
  ],
  appointment: [
    { value: "requested", label: "Requested" },
    { value: "confirmed", label: "Confirmed" },
    { value: "rescheduled", label: "Rescheduled" },
    { value: "completed", label: "Completed" },
    { value: "cancelled", label: "Cancelled" },
    { value: "no_show", label: "No Show" },
  ],
};

const getBusinessType = (type?: BusinessType | null): BusinessType => type || "ecommerce";
const getPrimaryName = (order: Order, type: BusinessType) =>
  type === "service" ? order.service_name || order.product_name : type === "appointment" ? order.appointment_type || order.product_name : order.product_name;
const getStatusClass = (status?: string) => cn(
  ["pending", "new", "requested"].includes(status || "") && "bg-orange-500/10 text-orange-500 hover:bg-orange-500/20",
  ["ongoing", "in_progress", "confirmed"].includes(status || "") && "bg-[#00ff88]/10 text-[#00ff88] hover:bg-[#00ff88]/20",
  ["delivered", "completed"].includes(status || "") && "bg-blue-500/10 text-blue-500 hover:bg-blue-500/20",
  ["locked", "no_show"].includes(status || "") && "bg-red-500/10 text-red-500 hover:bg-red-500/20",
  status === "cancelled" && "bg-muted text-muted-foreground hover:bg-muted/80",
  status === "rescheduled" && "bg-violet-500/10 text-violet-500 hover:bg-violet-500/20"
);

const getOrderExportRows = (orders: Order[], type: BusinessType) => {
  const headers = type === "service"
    ? ["ID", "Service", "Package", "Details", "Customer Name", "Number", "Delivery Method", "Status", "Date"]
    : type === "appointment"
      ? ["ID", "Appointment", "Date", "Time", "Assigned To", "Customer Name", "Number", "Notes", "Status", "Created At"]
      : ["ID", "Product Name", "Customer Name", "Number", "Location", "Quantity", "Price", "Status", "Date"];

  return [
    headers,
    ...orders.map((order) => type === "service" ? [
      order.id, order.service_name || order.product_name || "", order.service_package || "", order.service_details || "", order.customer_name || "", order.number || "", order.delivery_method || "", order.status || "", order.created_at || "",
    ] : type === "appointment" ? [
      order.id, order.appointment_type || order.product_name || "", order.appointment_date || "", order.appointment_time || "", order.assigned_to || "", order.customer_name || "", order.number || "", order.appointment_notes || "", order.status || "", order.created_at || "",
    ] : [
      order.id, order.product_name || "", order.customer_name || "", order.number || "", order.location || "", order.product_quantity || "", order.price || "", order.status || "", order.created_at || "",
    ]),
  ];
};

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

export default function WhatsAppOrderTrackingPage() {
  const { currentSession, loading: contextLoading } = useWhatsApp();
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [orderLoading, setOrderLoading] = useState(false);
  const [dateFilter, setDateFilter] = useState<'today' | 'yesterday' | 'custom' | 'all'>('today');
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [businessModalOpen, setBusinessModalOpen] = useState(false);
  const [savedBusinessType, setSavedBusinessType] = useState<BusinessType | null>(null);
  const [selectedBusinessType, setSelectedBusinessType] = useState<BusinessType>("ecommerce");

  const activeSessionName = currentSession?.name
    || (typeof window !== "undefined" ? localStorage.getItem("active_wa_session_id") : null)
    || null;
  const activeDbId = (currentSession as any)?.wp_db_id || (typeof window !== "undefined" ? Number(localStorage.getItem("active_wp_db_id") || 0) : 0);
  const businessTypeStorageKey = activeSessionName ? `whatsapp_order_business_type:${activeSessionName}` : null;
  const activeBusinessType = getBusinessType(savedBusinessType);

  useEffect(() => {
    if (!businessTypeStorageKey || typeof window === "undefined") {
      setSavedBusinessType(null);
      setSelectedBusinessType("ecommerce");
      return;
    }

    const storedType = localStorage.getItem(businessTypeStorageKey) as BusinessType | null;
    const resolvedType = getBusinessType(storedType);
    setSavedBusinessType(storedType);
    setSelectedBusinessType(resolvedType);
  }, [businessTypeStorageKey]);

  const selectedBusinessLabel = savedBusinessType
    ? businessTypes.find((type) => type.id === savedBusinessType)?.title || "Business Type"
    : "Select Business Type";

  const handleBusinessContinue = () => {
    if (businessTypeStorageKey) {
      localStorage.setItem(businessTypeStorageKey, selectedBusinessType);
    }
    setSavedBusinessType(selectedBusinessType);
    setBusinessModalOpen(false);
  };

  const fetchOrders = useCallback(async (showLoading = true) => {
    if (!activeSessionName) return;
    if (showLoading) setOrderLoading(true);
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) {
        setOrders([]);
        return;
      }

      const params = new URLSearchParams();
      if (activeSessionName) {
        params.set("session_name", String(activeSessionName));
      }
      params.set("business_type", activeBusinessType);

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      if (dateFilter === "today") {
        params.set("from", today.getTime().toString());
        params.set("to", tomorrow.getTime().toString());
      } else if (dateFilter === "yesterday") {
        params.set("from", yesterday.getTime().toString());
        params.set("to", today.getTime().toString());
      } else if (dateFilter === "custom" && date) {
        const customStart = new Date(date);
        customStart.setHours(0, 0, 0, 0);
        const customEnd = new Date(date);
        customEnd.setHours(23, 59, 59, 999);
        params.set("from", customStart.getTime().toString());
        params.set("to", customEnd.getTime().toString());
      }

      const res = await fetch(`${BACKEND_URL}/api/whatsapp/orders?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const msg = errBody.error || "Failed to fetch orders";
        throw new Error(msg);
      }

      const data = await res.json();
      setOrders(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Error fetching orders:", error);
      toast.error((error as Error).message || "Failed to fetch orders");
    } finally {
      if (showLoading) setOrderLoading(false);
    }
  }, [dateFilter, date, activeSessionName, activeBusinessType]);

  const updateOrderStatus = async (orderId: string, newStatus: string) => {
    const token = localStorage.getItem("auth_token");
    if (!token) return;

    try {
      const res = await fetch(`${BACKEND_URL}/api/whatsapp/orders/${orderId}/status`, {
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
    const type = getBusinessType(order.business_type || activeBusinessType);
    const textToCopy = type === "service"
      ? `Customer Name: ${order.customer_name || 'N/A'}
Service: ${order.service_name || order.product_name || 'N/A'}
Package: ${order.service_package || 'N/A'}
Details: ${order.service_details || 'N/A'}
Delivery Method: ${order.delivery_method || 'N/A'}
Phone: ${order.number || 'N/A'}`
      : type === "appointment"
        ? `Customer Name: ${order.customer_name || 'N/A'}
Appointment: ${order.appointment_type || order.product_name || 'N/A'}
Date: ${order.appointment_date || 'N/A'}
Time: ${order.appointment_time || 'N/A'}
Assigned To: ${order.assigned_to || 'N/A'}
Phone: ${order.number || 'N/A'}`
        : `Customer Name: ${order.customer_name || 'N/A'}
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

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  if (contextLoading && !activeSessionName) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <RefreshCw className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!activeSessionName) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] space-y-4">
        <AlertCircle className="h-16 w-16 text-muted-foreground" />
        <h2 className="text-2xl font-bold">No Official WhatsApp Selected</h2>
        <p className="text-muted-foreground">Please select or reconnect an official WhatsApp number to view orders.</p>
        <Button asChild>
            <Link to="/dashboard/whatsapp/sessions">Go to Sessions</Link>
        </Button>
      </div>
    );
  }

  const downloadCSV = () => {
    if (!orders.length) {
      toast.error("No orders to export");
      return;
    }

    const csvContent = getOrderExportRows(orders, activeBusinessType)
      .map((row) => row.map(escapeCsvCell).join(","))
      .join("\r\n");

    downloadBlob(
      `\uFEFF${csvContent}`,
      "text/csv;charset=utf-8;",
      `orders_${dateFilter}_${format(new Date(), "yyyy-MM-dd")}.csv`
    );
  };

  const downloadGoogleSheet = () => {
    if (!orders.length) {
      toast.error("No orders to export");
      return;
    }

    const tableRows = getOrderExportRows(orders, activeBusinessType)
      .map((row) => `<tr>${row.map((cell) => `<td>${escapeSheetCell(cell)}</td>`).join("")}</tr>`)
      .join("");
    const sheetContent = `<!DOCTYPE html><html><head><meta charset="UTF-8" /></head><body><table>${tableRows}</table></body></html>`;

    downloadBlob(
      sheetContent,
      "application/vnd.ms-excel;charset=utf-8;",
      `orders_${dateFilter}_${format(new Date(), "yyyy-MM-dd")}.xls`
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
           <h2 className="text-3xl font-bold tracking-tight">Order Tracking</h2>
           <p className="text-muted-foreground">
             View and manage customer orders collected by the bot.
           </p>
        </div>
        {activeDbId > 0 && (
          <OrderNotificationModal dbId={activeDbId} platform="whatsapp" />
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
                    onClick={() => {
                      if (savedBusinessType) setSelectedBusinessType(savedBusinessType);
                      setBusinessModalOpen(true);
                    }}
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
                              <TableHead>{activeBusinessType === "service" ? "Service" : activeBusinessType === "appointment" ? "Appointment" : "Product"}</TableHead>
                              {activeBusinessType === "ecommerce" && <TableHead>Qty</TableHead>}
                              {activeBusinessType === "ecommerce" && <TableHead>Price</TableHead>}
                              {activeBusinessType === "service" && <TableHead>Package</TableHead>}
                              {activeBusinessType === "appointment" && <TableHead>Schedule</TableHead>}
                              <TableHead>{activeBusinessType === "appointment" ? "Assigned" : activeBusinessType === "service" ? "Delivery" : "Location"}</TableHead>
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
                                  <TableCell className="font-medium">{getPrimaryName(order, activeBusinessType) || '-'}</TableCell>
                                  {activeBusinessType === "ecommerce" && <TableCell>{order.product_quantity}</TableCell>}
                                  {activeBusinessType === "ecommerce" && <TableCell>{order.price}</TableCell>}
                                  {activeBusinessType === "service" && <TableCell>{order.service_package || '-'}</TableCell>}
                                  {activeBusinessType === "appointment" && <TableCell>{[order.appointment_date, order.appointment_time].filter(Boolean).join(' ') || '-'}</TableCell>}
                                  <TableCell className="max-w-[200px]">
                                    <Popover>
                                      <PopoverTrigger asChild>
                                        <span className="truncate block cursor-pointer hover:underline text-primary" title="Click to view full details">
                                          {activeBusinessType === "appointment" ? order.assigned_to || '-' : activeBusinessType === "service" ? order.delivery_method || order.service_details || '-' : order.location || '-'}
                                        </span>
                                      </PopoverTrigger>
                                      <PopoverContent className="w-80">
                                        <div className="space-y-2">
                                          <h4 className="font-medium leading-none">Details</h4>
                                          <p className="text-sm text-muted-foreground break-words">
                                            {activeBusinessType === "appointment" ? order.appointment_notes || order.assigned_to || '-' : activeBusinessType === "service" ? order.service_details || order.delivery_method || '-' : order.location || '-'}
                                          </p>
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
                                      value={order.status || statusOptionsByType[activeBusinessType][0].value} 
                                      onValueChange={(val) => updateOrderStatus(order.id, val)}
                                    >
                                      <SelectTrigger className={cn(
                                        "w-[130px] h-8 text-xs font-medium border-none",
                                        getStatusClass(order.status || statusOptionsByType[activeBusinessType][0].value)
                                      )}>
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {statusOptionsByType[activeBusinessType].map((option) => (
                                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                        ))}
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
        <DialogContent className="flex max-h-[92dvh] w-[calc(100vw-1rem)] max-w-[980px] flex-col overflow-hidden border-white/10 bg-[#0b1110]/95 p-0 text-white shadow-[0_24px_80px_rgba(0,0,0,0.65)] backdrop-blur-xl sm:w-[calc(100vw-2rem)] sm:rounded-2xl">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.18),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.09),transparent_34%)]" />
          <div className="min-h-0 overflow-y-auto p-4 sm:p-6">
            <DialogHeader className="flex-row items-start gap-3 space-y-0 pr-8 text-left sm:gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-emerald-500/25 bg-emerald-500/15 text-emerald-400 shadow-lg shadow-emerald-500/10 sm:h-16 sm:w-16">
                <Store className="h-6 w-6 sm:h-8 sm:w-8" />
              </div>
              <div className="pt-0.5 sm:pt-1">
                <DialogTitle className="text-xl font-bold tracking-tight sm:text-2xl">Select Business Type</DialogTitle>
                <DialogDescription className="mt-2 text-sm text-slate-300">
                  Choose the type that best matches your business model.
                </DialogDescription>
              </div>
            </DialogHeader>

            <div className="mt-5 grid gap-3 sm:mt-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
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
                      "group relative flex min-h-[unset] flex-col rounded-xl border p-3 text-center transition-all duration-200 hover:-translate-y-1 focus:outline-none focus:ring-2 sm:p-4 lg:min-h-[420px]",
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

                    <div className="mt-2 flex justify-center sm:mt-3">
                      <div className={cn("flex h-16 w-16 items-center justify-center rounded-2xl border shadow-xl sm:h-20 sm:w-20", accent.iconWrap)}>
                        <Icon className="h-8 w-8 sm:h-10 sm:w-10" />
                      </div>
                    </div>

                    <h3 className="mt-4 text-lg font-bold text-white sm:text-xl">{type.title}</h3>
                    <div className="mt-3">
                      <span className={cn("rounded-md border px-3 py-1 text-xs font-semibold", accent.badge)}>{type.badge}</span>
                    </div>
                    <p className="mx-auto mt-4 max-w-[240px] text-sm leading-6 text-slate-300">{type.description}</p>

                    <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.035] p-3 text-left">
                      <p className={cn("mb-3 text-sm font-semibold", accent.example)}>Examples</p>
                      <div className="space-y-2.5">
                        {type.examples.map((example) => (
                          <div key={example} className="flex items-start gap-2.5 text-sm leading-5 text-slate-300">
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

          <DialogFooter className="gap-4 border-t border-white/10 bg-black/25 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:space-x-0 sm:px-6">
            <div className="flex items-center gap-3 text-xs text-slate-400 sm:text-sm">
              <Info className="h-5 w-5 shrink-0 text-emerald-400" />
              <span>You can change this later in settings.</span>
            </div>
            <Button onClick={handleBusinessContinue} className="h-11 w-full rounded-xl bg-emerald-500 px-6 text-sm font-bold text-white hover:bg-emerald-400 sm:h-12 sm:w-auto sm:text-base">
              Continue
              <ArrowRight className="ml-3 h-5 w-5" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConversationDialog
        open={selectedOrder !== null}
        onOpenChange={(open) => !open && setSelectedOrder(null)}
        platform="whatsapp"
        resourceId={activeSessionName}
        senderId={selectedOrder?.sender_id || null}
        customerName={selectedOrder?.customer_name}
        order={selectedOrder}
      />
    </div>
  );
}
