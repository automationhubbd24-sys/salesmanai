import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Calendar as CalendarIcon, Check, Copy, Download, MessageSquare, RefreshCw, ShoppingBag, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OrderNotificationModal } from "@/components/dashboard/OrderNotificationModal";
import { ConversationDialog } from "@/components/dashboard/ConversationDialog";
import { useInstagram } from "@/context/InstagramContext";
import { BACKEND_URL } from "@/config";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { toast } from "sonner";

type Order = {
  id: string;
  product_name?: string;
  product_quantity?: string | number;
  price?: string | number;
  customer_name?: string;
  number?: string;
  location?: string;
  status?: string;
  sender_id?: string;
  created_at?: string;
};

type DateFilter = "today" | "yesterday" | "custom" | "all";
type OrderView = "active" | "draft";
type OrderEditForm = Pick<Order, "product_name" | "product_quantity" | "price" | "location" | "customer_name" | "number">;

const csvCell = (value: unknown) => {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const getOrderEditForm = (order: Order): OrderEditForm => ({
  product_name: order.product_name || "",
  product_quantity: order.product_quantity || "",
  price: order.price || "",
  location: order.location || "",
  customer_name: order.customer_name || "",
  number: order.number || "",
});

export default function InstagramOrderTrackingPage() {
  const navigate = useNavigate();
  const { currentAccount, loading: accountLoading } = useInstagram();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [dateFilter, setDateFilter] = useState<DateFilter>("today");
  const [orderView, setOrderView] = useState<OrderView>("active");
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [editForm, setEditForm] = useState<OrderEditForm | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);

  const accountId = currentAccount?.page_id || null;
  const dbId = currentAccount?.db_id || currentAccount?.id || 0;
  const draftOrders = orders.filter((order) => order.status === "pending" || order.status === "draft");
  const activeOrders = orders.filter((order) => order.status !== "pending" && order.status !== "draft");
  const visibleOrders = orderView === "draft" ? draftOrders : activeOrders;

  const fetchOrders = useCallback(async () => {
    if (!accountId) {
      setOrders([]);
      return;
    }

    setLoading(true);
    try {
      const token = localStorage.getItem("auth_token");
      const params = new URLSearchParams({ account_id: accountId });

      if (dateFilter !== "all") {
        const selected = dateFilter === "yesterday" ? new Date(Date.now() - 86400000) : (date || new Date());
        const from = new Date(selected);
        from.setHours(0, 0, 0, 0);
        const to = new Date(selected);
        to.setHours(23, 59, 59, 999);
        params.set("from", String(from.getTime()));
        params.set("to", String(to.getTime()));
      }

      const response = await fetch(`${BACKEND_URL}/api/instagram/orders?${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!response.ok) throw new Error("Instagram orders load করা যায়নি");

      const data = await response.json();
      setOrders(Array.isArray(data) ? data : []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Instagram orders load করা যায়নি");
    } finally {
      setLoading(false);
    }
  }, [accountId, date, dateFilter]);

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  const downloadCsv = () => {
    if (!visibleOrders.length) {
      toast.error("Export করার জন্য কোনো order নেই");
      return;
    }

    const content = [
      ["ID", "Date", "Customer", "Phone", "Product", "Quantity", "Price", "Location", "Status"],
      ...visibleOrders.map((order) => [
        order.id,
        order.created_at || "",
        order.customer_name || "",
        order.number || "",
        order.product_name || "",
        order.product_quantity || "",
        order.price || "",
        order.location || "",
        order.status || "ongoing",
      ]),
    ].map((row) => row.map(csvCell).join(",")).join("\r\n");

    const url = URL.createObjectURL(new Blob([`\uFEFF${content}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `instagram-${orderView}-orders-${format(new Date(), "yyyy-MM-dd")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const openEditOrder = (order: Order) => {
    setEditingOrder(order);
    setEditForm(getOrderEditForm(order));
  };

  const updateEditField = (field: keyof OrderEditForm, value: string) => {
    setEditForm((current) => current ? { ...current, [field]: value } : current);
  };

  const saveOrderEdit = async () => {
    const token = localStorage.getItem("auth_token");
    if (!token || !editingOrder || !editForm) return;

    setSavingOrder(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/instagram/orders/${editingOrder.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(editForm),
      });

      if (!response.ok) throw new Error("Order update করা যায়নি");

      const data = await response.json();
      const updatedOrder = data.order || { ...editingOrder, ...editForm };
      setOrders((current) => current.map((order) => order.id === editingOrder.id ? { ...order, ...updatedOrder } : order));
      setEditingOrder(null);
      setEditForm(null);
      toast.success("Order updated successfully");
      void fetchOrders();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Order update করা যায়নি");
    } finally {
      setSavingOrder(false);
    }
  };

  const copyOrder = async (order: Order) => {
    await navigator.clipboard.writeText(`Customer: ${order.customer_name || "-"}\nProduct: ${order.product_name || "-"}\nQty: ${order.product_quantity || "-"}\nPrice: ${order.price || "-"}\nPhone: ${order.number || "-"}\nLocation: ${order.location || "-"}`);
    setCopiedId(order.id);
    toast.success("Order details copied");
    window.setTimeout(() => setCopiedId(null), 1800);
  };

  const dateLabel = useMemo(() => date ? format(date, "PPP") : "তারিখ নির্বাচন করুন", [date]);

  if (accountLoading) {
    return <div className="flex min-h-[360px] items-center justify-center"><RefreshCw className="h-7 w-7 animate-spin" /></div>;
  }

  if (!accountId) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center gap-3">
        <ShoppingBag className="h-14 w-14 text-muted-foreground" />
        <h2 className="text-2xl font-bold">No Instagram Account Connected</h2>
        <p className="text-muted-foreground">Order দেখতে আগে একটি Instagram account select করুন।</p>
        <Button onClick={() => navigate("/dashboard/instagram/integration")}>Go to Instagram Integration</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Instagram Order Tracking</h1>
          <p className="mt-1 text-muted-foreground">Instagram DM থেকে পাওয়া customer order দেখুন ও পরিচালনা করুন।</p>
        </div>
        {dbId > 0 && <OrderNotificationModal dbId={Number(dbId)} platform="instagram" />}
      </div>

      <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10 shadow-[0_18px_40px_rgba(0,0,0,0.35)] border-l-4 border-l-pink-500">
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <ShoppingBag className="h-5 w-5 text-pink-500" />
                  Order List
                </CardTitle>
                <CardDescription>Active orders and draft orders are separated for faster review.</CardDescription>
              </div>
              <Tabs value={orderView} onValueChange={(value) => setOrderView(value as OrderView)}>
                <TabsList className="grid w-full grid-cols-2 bg-muted/40 sm:w-[360px]">
                  <TabsTrigger value="active">Active Orders ({activeOrders.length})</TabsTrigger>
                  <TabsTrigger value="draft">Draft Orders ({draftOrders.length})</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={dateFilter} onValueChange={(value) => setDateFilter(value as DateFilter)}>
                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="yesterday">Yesterday</SelectItem>
                  <SelectItem value="custom">Custom Date</SelectItem>
                  <SelectItem value="all">All Time</SelectItem>
                </SelectContent>
              </Select>
              {dateFilter === "custom" && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline"><CalendarIcon className="mr-2 h-4 w-4" />{dateLabel}</Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar mode="single" selected={date} onSelect={setDate} initialFocus />
                  </PopoverContent>
                </Popover>
              )}
              <Button variant="outline" size="icon" onClick={() => void fetchOrders()} disabled={loading}>
                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              </Button>
              <Button variant="outline" onClick={downloadCsv}><Download className="mr-2 h-4 w-4" />CSV</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12"><RefreshCw className="h-7 w-7 animate-spin text-pink-500" /></div>
          ) : orders.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground"><ShoppingBag className="mx-auto mb-3 h-12 w-12 opacity-30" />নির্বাচিত সময়ের কোনো order পাওয়া যায়নি।</div>
          ) : visibleOrders.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground"><ShoppingBag className="mx-auto mb-3 h-12 w-12 opacity-30" />No {orderView} orders found for the selected period.</div>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleOrders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="whitespace-nowrap">{order.created_at ? format(new Date(order.created_at), "MMM d, HH:mm") : "-"}</TableCell>
                      <TableCell>{order.product_name || "-"}</TableCell>
                      <TableCell>{order.product_quantity || "-"}</TableCell>
                      <TableCell>{order.price || "-"}</TableCell>
                      <TableCell>{order.customer_name || "-"}</TableCell>
                      <TableCell>{order.number || "-"}</TableCell>
                      <TableCell>
                        <span className={cn(
                          "rounded-full px-2 py-1 text-xs",
                          (order.status === "pending" || order.status === "draft") ? "bg-orange-500/10 text-orange-500" : "bg-pink-500/10 text-pink-500"
                        )}>
                          {order.status === "pending" || order.status === "draft" ? "draft" : (order.status || "ongoing")}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="grid grid-cols-3 justify-end gap-1 sm:inline-grid sm:w-auto sm:grid-cols-3">
                        <Button variant="ghost" size="icon" title="Open conversation" disabled={!order.sender_id} onClick={() => setSelectedOrder(order)}>
                          <MessageSquare className="h-4 w-4 text-pink-500" />
                        </Button>
                        <Button variant="ghost" size="icon" title="Edit order" onClick={() => openEditOrder(order)}>
                          <Pencil className="h-4 w-4 text-pink-500" />
                        </Button>
                        <Button variant="ghost" size="icon" title="Copy order" onClick={() => void copyOrder(order)}>
                          {copiedId === order.id ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
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

      <Dialog open={editingOrder !== null} onOpenChange={(open) => {
        if (!open) {
          setEditingOrder(null);
          setEditForm(null);
        }
      }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit order</DialogTitle>
            <DialogDescription>Product, customer, phone, price, quantity ও location update করুন।</DialogDescription>
          </DialogHeader>
          {editForm && (
            <div className="grid gap-4 py-2 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="instagram-product-name">Product name</Label>
                <Input id="instagram-product-name" value={String(editForm.product_name || "")} onChange={(event) => updateEditField("product_name", event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="instagram-qty">Qty</Label>
                <Input id="instagram-qty" value={String(editForm.product_quantity || "")} onChange={(event) => updateEditField("product_quantity", event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="instagram-price">Price</Label>
                <Input id="instagram-price" value={String(editForm.price || "")} onChange={(event) => updateEditField("price", event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="instagram-customer">Customer name</Label>
                <Input id="instagram-customer" value={String(editForm.customer_name || "")} onChange={(event) => updateEditField("customer_name", event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="instagram-phone">Phone</Label>
                <Input id="instagram-phone" value={String(editForm.number || "")} onChange={(event) => updateEditField("number", event.target.value)} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="instagram-location">Location</Label>
                <Input id="instagram-location" value={String(editForm.location || "")} onChange={(event) => updateEditField("location", event.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setEditingOrder(null)} disabled={savingOrder}>Cancel</Button>
            <Button onClick={saveOrderEdit} disabled={savingOrder}>{savingOrder ? "Saving..." : "Save changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConversationDialog
        open={selectedOrder !== null}
        onOpenChange={(open) => !open && setSelectedOrder(null)}
        platform="instagram"
        resourceId={accountId}
        senderId={selectedOrder?.sender_id || null}
        customerName={selectedOrder?.customer_name}
        order={selectedOrder ? {
          id: selectedOrder.id,
          product_name: selectedOrder.product_name || "",
          product_quantity: selectedOrder.product_quantity || "",
          price: selectedOrder.price || "",
          location: selectedOrder.location || "",
          number: selectedOrder.number || "",
          status: selectedOrder.status || "ongoing",
          created_at: selectedOrder.created_at || "",
        } : null}
      />
    </div>
  );
}
