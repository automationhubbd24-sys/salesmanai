import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { Megaphone, Plus, Trash2, Search, Loader2, Save, AlertCircle, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { BACKEND_URL } from "@/config";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

interface Ad {
  id: number;
  ad_id: string;
  page_id: string;
  description: string;
  linked_product_ids: string[];
}

interface Product {
  id: string;
  name: string;
}

export default function AdsPage() {
  const { platform } = useParams();
  const [ads, setAds] = useState<Ad[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasActivePages, setHasActivePages] = useState<boolean | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Form State
  const [adId, setAdId] = useState("");
  const [pageId, setPageId] = useState("");
  const [description, setDescription] = useState("");
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);

  useEffect(() => {
    checkActivePages();
    fetchAds();
  }, [platform]);

  // Fetch products whenever isDialogOpen becomes true or pageId changes
  useEffect(() => {
    if (isDialogOpen) {
      fetchProducts();
    }
  }, [isDialogOpen, pageId]);

  const checkActivePages = async () => {
    try {
      const token = localStorage.getItem("auth_token");
      const userId = localStorage.getItem("user_id");
      
      // Check if there is an active page in localStorage (sidebar selection)
      const activeFbPageId = localStorage.getItem("active_fb_page_id");
      const activeWpSession = localStorage.getItem("active_wp_session");
      
      if (activeFbPageId || activeWpSession) {
        setHasActivePages(true);
        return;
      }

      // Fallback: Check for any Messenger or WhatsApp pages from API
      const [msgRes, waRes] = await Promise.all([
        fetch(`${BACKEND_URL}/api/external/fb/pages?user_id=${userId}`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch(`${BACKEND_URL}/api/external/wa/sessions?user_id=${userId}`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);

      const msgData = await msgRes.json();
      const waData = await waRes.json();

      const totalActive = (msgData.pages?.length || 0) + (waData.sessions?.length || 0);
      setHasActivePages(totalActive > 0);
    } catch (error) {
      console.error("Failed to check active pages:", error);
      setHasActivePages(false);
    }
  };

  const fetchAds = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem("auth_token");
      const userId = localStorage.getItem("user_id");
      const teamOwner = localStorage.getItem("team_owner_email");
      
      let url = `${BACKEND_URL}/api/ads?user_id=${userId}`;
      if (teamOwner) url += `&team_owner=${teamOwner}`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) throw new Error("Failed to fetch ads");
      const data = await response.json();
      setAds(data);
    } catch (error) {
      console.error("Failed to fetch ads:", error);
      toast.error("Failed to load ads library");
    } finally {
      setLoading(false);
    }
  };

  const fetchProducts = async () => {
    try {
      const token = localStorage.getItem("auth_token");
      const userId = localStorage.getItem("user_id");
      
      // Use the pageId from the form if available, otherwise it might fetch all or none
      // In your case, we want products linked to the active context
      let url = `${BACKEND_URL}/api/products?user_id=${userId}`;
      if (pageId) {
        url += `&page_id=${pageId}`;
      }

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) throw new Error("Failed to fetch products");
      const data = await response.json();
      setProducts(data.products || []);
    } catch (error) {
      console.error("Failed to fetch products:", error);
    }
  };

  const handleSaveAd = async () => {
    if (!adId || !pageId) {
      toast.error("Ad ID and Page ID are required");
      return;
    }

    try {
      setIsSaving(true);
      const token = localStorage.getItem("auth_token");
      const userId = localStorage.getItem("user_id");
      
      const response = await fetch(`${BACKEND_URL}/api/ads`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ad_id: adId,
          page_id: pageId,
          user_id: userId,
          description,
          linked_product_ids: selectedProducts,
        }),
      });

      if (!response.ok) throw new Error("Failed to save ad context");
      
      toast.success("Ad context saved successfully");
      setIsDialogOpen(false);
      fetchAds();
      resetForm();
    } catch (error) {
      console.error("Failed to save ad:", error);
      toast.error("Failed to save ad context");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteAd = async (ad_id: string, p_id: string) => {
    if (!confirm("Are you sure you want to delete this ad context?")) return;

    try {
      const token = localStorage.getItem("auth_token");
      const response = await fetch(`${BACKEND_URL}/api/ads?ad_id=${ad_id}&page_id=${p_id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error("Failed to delete ad context");
      
      toast.success("Ad context deleted");
      fetchAds();
    } catch (error) {
      console.error("Failed to delete ad:", error);
      toast.error("Failed to delete ad context");
    }
  };

  const resetForm = () => {
    setAdId("");
    setPageId("");
    setDescription("");
    setSelectedProducts([]);
  };

  const filteredAds = ads.filter(
    (ad) =>
      ad.ad_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ad.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (hasActivePages === false) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="bg-yellow-500/10 p-4 rounded-full mb-4">
          <AlertCircle className="h-12 w-12 text-yellow-500" />
        </div>
        <h2 className="text-2xl font-bold">No Active Pages Found</h2>
        <p className="text-muted-foreground max-w-md mt-2 mb-6">
          To use the Ads Library, you first need to connect at least one Facebook Page or WhatsApp session.
        </p>
        <a href="https://salesmanchatbot.online/dashboard/messenger/integration">
          <Button>
            Go to Integration
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ads Library</h1>
          <p className="text-muted-foreground">
            Configure smart AI responses for specific Facebook/WhatsApp ads.
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={resetForm}>
              <Plus className="mr-2 h-4 w-4" />
              Add Ad Context
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px] bg-[#0f0f0f] border-white/10 text-white">
            <DialogHeader>
              <DialogTitle>Add New Ad Context</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="adId">Ad ID</Label>
                <Input
                  id="adId"
                  placeholder="e.g. 1234567890"
                  value={adId}
                  onChange={(e) => setAdId(e.target.value)}
                  className="bg-white/5 border-white/10"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="pageId">Page ID / Session Name</Label>
                <Input
                  id="pageId"
                  placeholder="e.g. 1092837465"
                  value={pageId}
                  onChange={(e) => setPageId(e.target.value)}
                  className="bg-white/5 border-white/10"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="description">Ad Description (for AI Context)</Label>
                <Textarea
                  id="description"
                  placeholder="Describe what this ad is about..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="bg-white/5 border-white/10 min-h-[100px]"
                />
              </div>
              <div className="grid gap-2">
                <Label>Linked Products</Label>
                <div className="grid grid-cols-1 gap-2 max-h-[150px] overflow-y-auto p-2 border border-white/10 rounded-md bg-white/5">
                  {products.map((product) => (
                    <div key={product.id} className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id={`prod-${product.id}`}
                        checked={selectedProducts.includes(product.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedProducts([...selectedProducts, product.id]);
                          } else {
                            setSelectedProducts(selectedProducts.filter(id => id !== product.id));
                          }
                        }}
                        className="rounded border-white/20 bg-white/10"
                      />
                      <label htmlFor={`prod-${product.id}`} className="text-sm cursor-pointer truncate">
                        {product.name}
                      </label>
                    </div>
                  ))}
                  {products.length === 0 && (
                    <p className="text-xs text-muted-foreground italic">No products found. Add products first.</p>
                  )}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)} className="border-white/10 hover:bg-white/5">
                Cancel
              </Button>
              <Button onClick={handleSaveAd} disabled={isSaving}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Context
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search ads by ID or description..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10 bg-[#0f0f0f]/80 border-white/10"
        />
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="mt-2 text-muted-foreground">Loading ads library...</p>
        </div>
      ) : filteredAds.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredAds.map((ad) => (
            <Card key={`${ad.ad_id}-${ad.page_id}`} className="bg-[#0f0f0f]/80 backdrop-blur-sm border-white/10 hover:border-primary/50 transition-colors">
              <CardHeader className="pb-3">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-2">
                    <Megaphone className="h-4 w-4 text-primary" />
                    <CardTitle className="text-lg">Ad ID: {ad.ad_id}</CardTitle>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => handleDeleteAd(ad.ad_id, ad.page_id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <CardDescription className="font-mono text-xs">Page ID: {ad.page_id}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-semibold mb-1">AI Context:</p>
                    <p className="text-sm text-muted-foreground line-clamp-3">
                      {ad.description || "No description provided."}
                    </p>
                  </div>
                  {ad.linked_product_ids && ad.linked_product_ids.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold mb-1">Linked Products:</p>
                      <div className="flex flex-wrap gap-1">
                        {ad.linked_product_ids.map((pId) => {
                          const p = products.find(p => String(p.id) === String(pId));
                          return (
                            <span key={pId} className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full border border-primary/20">
                              {p?.name || `ID: ${pId}`}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center border rounded-lg border-dashed border-white/10 bg-[#0f0f0f]/40">
          <Megaphone className="h-12 w-12 text-muted-foreground/20 mb-4" />
          <h3 className="text-lg font-medium">No ad contexts found</h3>
          <p className="text-muted-foreground max-w-sm mt-1">
            Add your first ad context to help the AI understand which products customers are asking about.
          </p>
          <Button variant="outline" className="mt-4 border-white/10" onClick={() => setIsDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Ad Context
          </Button>
        </div>
      )}
    </div>
  );
}
