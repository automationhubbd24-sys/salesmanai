import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { RefreshCw, ShoppingBag, Unplug } from "lucide-react";
import { BACKEND_URL } from "@/config";

interface ShopifyProduct { shopify_product_id: string; title: string; status: string; variants: Array<{ title: string; price: string; inventoryQuantity: number }> }
export default function ShopifyPage() {
  const [shop, setShop] = useState("");
  const [data, setData] = useState<{ connected: boolean; shopDomain?: string; lastSyncedAt?: string; products: ShopifyProduct[] }>({ connected: false, products: [] });
  const [loading, setLoading] = useState(false);
  const headers = () => ({ Authorization: `Bearer ${localStorage.getItem("auth_token")}` });
  const load = async () => { const res = await fetch(`${BACKEND_URL}/api/shopify/status`, { headers: headers() }); const body = await res.json(); if (!res.ok) throw new Error(body.error); setData(body); };
  useEffect(() => { load().catch(error => toast.error(error.message)); }, []);
  const connect = async () => { setLoading(true); try { const res = await fetch(`${BACKEND_URL}/api/shopify/connect?shop=${encodeURIComponent(shop)}`, { headers: headers() }); const body = await res.json(); if (!res.ok) throw new Error(body.error); window.location.href = body.url; } catch (error: any) { toast.error(error.message); setLoading(false); } };
  const sync = async () => { setLoading(true); try { const res = await fetch(`${BACKEND_URL}/api/shopify/sync`, { method: "POST", headers: headers() }); const body = await res.json(); if (!res.ok) throw new Error(body.error); toast.success(`${body.count}টি পণ্য sync হয়েছে`); await load(); } catch (error: any) { toast.error(error.message); } finally { setLoading(false); } };
  const disconnect = async () => { setLoading(true); try { const res = await fetch(`${BACKEND_URL}/api/shopify`, { method: "DELETE", headers: headers() }); const body = await res.json(); if (!res.ok) throw new Error(body.error); setData({ connected: false, products: [] }); toast.success("Shopify disconnected"); } catch (error: any) { toast.error(error.message); } finally { setLoading(false); } };
  return <div className="space-y-6 max-w-5xl"><Card className="border-white/10 bg-[#0f0f0f]/80"><CardHeader><CardTitle className="flex items-center gap-2"><ShoppingBag className="text-[#00ff88]" /> Shopify read-only catalog</CardTitle><CardDescription>শুধু product এবং inventory পড়া হবে; order/customer write access নেই।</CardDescription></CardHeader><CardContent className="space-y-4">{data.connected ? <div className="flex flex-wrap items-center gap-3"><span className="text-[#00ff88]">Connected: {data.shopDomain}</span><Button onClick={sync} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Manual sync</Button><Button variant="outline" onClick={disconnect} disabled={loading}><Unplug className="mr-2 h-4 w-4" />Disconnect</Button></div> : <div className="flex gap-2 max-w-xl"><Input value={shop} onChange={e => setShop(e.target.value)} placeholder="your-store.myshopify.com" /><Button onClick={connect} disabled={loading || !shop}>Connect Shopify</Button></div>}{data.connected && <div className="grid gap-3 md:grid-cols-2">{data.products.map(product => <div key={product.shopify_product_id} className="rounded-lg border border-white/10 p-4"><div className="font-medium">{product.title}</div><div className="text-sm text-muted-foreground">{product.status} · {product.variants?.reduce((sum, item) => sum + (item.inventoryQuantity || 0), 0)} inventory</div></div>)}</div>}</CardContent></Card></div>;
}
