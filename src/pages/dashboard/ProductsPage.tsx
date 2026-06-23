import { useState, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Lock, Plus, Trash2, Package, Search, Image as ImageIcon, Loader2, ShoppingBag, Download, Edit, X, Video } from "lucide-react";
import { BACKEND_URL } from "@/config";
import { cn } from "@/lib/utils";

// Types
interface Variant {
    name: string;
    price: string;
    currency: string;
    available: boolean;
    stock?: number;
    image_url?: string | null;
    video_url?: string | null;
    sku_code?: string | null;
    attributes?: Record<string, string>;
}

interface ProductAttribute {
    name: string;
    label: string;
    values: string[];
}

interface ProductSku {
    sku_id?: string | null;
    sku_code: string;
    name: string;
    key?: string;
    attributes: Record<string, string>;
    price: number;
    currency: string;
    stock: number;
    available: boolean;
    image_url?: string | null;
    video_url?: string | null;
    aliases?: string[];
}

interface Product {
    id: number;
    name: string;
    description: string;
    keywords?: string;
    image_url: string | null;
    video_url?: string | null;
    additional_images?: string[] | null;
    variants: Variant[];
    is_active: boolean;
    price?: number;
    currency?: string;
    stock?: number;
    allowed_messenger_ids?: string[];
    allowed_wa_sessions?: string[];
    is_combo?: boolean;
    combo_items?: string[];
    allow_description?: boolean;
    product_mode?: "simple" | "option-list" | "sku-matrix";
    attribute_schema?: ProductAttribute[];
    sku_matrix?: ProductSku[];
}

const MAX_PRODUCT_TOTAL_IMAGES = 50;

export default function ProductsPage() {
    const location = useLocation();
    const getInitialPageId = () => {
        const wa = localStorage.getItem('active_wa_session_id');
        const fb = localStorage.getItem('active_fb_page_id');
        const path = location.pathname || "";
        if (path.includes("/dashboard/messenger")) {
            return fb || wa || null;
        }
        if (path.includes("/dashboard/whatsapp")) {
            return wa || fb || null;
        }
        return fb || wa || null;
    };

    const [loading, setLoading] = useState(true);
    const [userId, setUserId] = useState<string | null>(null);
    const [products, setProducts] = useState<Product[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    
    const initialPageId = getInitialPageId();
    const [pageId, setPageId] = useState<string | null>(initialPageId);
    const getContextTypeForPage = (targetPageId: string | null = pageId) => {
        if (typeof window === "undefined" || !targetPageId) return null;
        const normalizedTarget = String(targetPageId).trim();
        const activeWa = String(localStorage.getItem("active_wa_session_id") || "").trim();
        const activeFb = String(localStorage.getItem("active_fb_page_id") || "").trim();
        if (activeWa && normalizedTarget === activeWa) return "whatsapp";
        if (activeFb && normalizedTarget === activeFb) return "messenger";
        return /^\d+$/.test(normalizedTarget) ? "messenger" : "whatsapp";
    };

    useEffect(() => {
        const handleSync = () => {
            const pid = getInitialPageId();
            setPageId(pid);
        };
        window.addEventListener("db-connection-changed", handleSync);
        window.addEventListener("storage", handleSync);

        // Initial check and load with immediate context
        checkAccess(initialPageId);
        fetchPages();

        return () => {
            window.removeEventListener("db-connection-changed", handleSync);
            window.removeEventListener("storage", handleSync);
        };
    }, []);

    // Form State
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [isWCDialogOpen, setIsWCDialogOpen] = useState(false);
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [editProductId, setEditProductId] = useState<number | null>(null);
    
    // Product Form
    const [productName, setProductName] = useState("");
    const [productDesc, setProductDesc] = useState("");
    const [productPrice, setProductPrice] = useState("0");
    const [productCurrency, setProductCurrency] = useState("USD");
    const [isCustomCurrency, setIsCustomCurrency] = useState(false);
    const [productStock, setProductStock] = useState("0");
    const [productKeywords, setProductKeywords] = useState<string[]>([]);
    const [keywordInput, setKeywordInput] = useState("");
    const [productImage, setProductImage] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [productVideo, setProductVideo] = useState<File | null>(null);
    const [videoPreview, setVideoPreview] = useState<string | null>(null);
    const [productImages, setProductImages] = useState<File[]>([]);
    const [imagePreviews, setImagePreviews] = useState<string[]>([]);
    const [existingAdditionalImages, setExistingAdditionalImages] = useState<string[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const videoInputRef = useRef<HTMLInputElement>(null);
    const openImagePicker = () => {
        if (fileInputRef.current) {
            try { (fileInputRef.current as any).value = null; } catch {}
            fileInputRef.current.click();
        }
    };
    const openVideoPicker = () => {
        if (videoInputRef.current) {
            try { (videoInputRef.current as any).value = null; } catch {}
            videoInputRef.current.click();
        }
    };

    const getAdditionalBlobPreviews = (
        previews: string[] = imagePreviews,
        primaryPreview: string | null = imagePreview,
        hasPrimaryFile: boolean = !!productImage
    ) => {
        return previews.filter((src) => src.startsWith("blob:") && !(hasPrimaryFile && primaryPreview === src));
    };

    // WC Form
    const [wcUrl, setWcUrl] = useState("");
    const [wcKey, setWcKey] = useState("");
    const [wcSecret, setWcSecret] = useState("");

    // Page Visibility
    const [availablePages, setAvailablePages] = useState<any[]>([]);
    const [pageSearch, setPageSearch] = useState("");

    // Filtered pages for display
    const filteredPages = availablePages.filter(p => 
        p.name.toLowerCase().includes(pageSearch.toLowerCase())
    );

    const [selectedWA, setSelectedWA] = useState<Set<string>>(new Set());
    const [selectedFB, setSelectedFB] = useState<Set<string>>(new Set());
    const normalizeId = (v: any) => String(v).trim().toLowerCase();
    const commitAssignmentSelection = (nextFB: Set<string>, nextWA: Set<string>) => {
        setSelectedFB(new Set(nextFB));
        setSelectedWA(new Set(nextWA));
        if (editProductId) {
            persistAssignments(nextFB, nextWA);
        }
    };
    const handleSelectAllPages = () => {
        const newFbIds = filteredPages.filter(p => p.type === 'messenger').map(p => normalizeId(p.page_id));
        const newWaIds = filteredPages.filter(p => p.type === 'whatsapp').map(p => normalizeId(p.page_id));
        const nextFB = new Set(Array.from(selectedFB));
        const nextWA = new Set(Array.from(selectedWA));
        newFbIds.forEach(id => nextFB.add(id));
        newWaIds.forEach(id => nextWA.add(id));
        commitAssignmentSelection(nextFB, nextWA);
    };

    const handleDeselectAllPages = () => {
        const fbIdsToRemove = filteredPages.filter(p => p.type === 'messenger').map(p => normalizeId(p.page_id));
        const waIdsToRemove = filteredPages.filter(p => p.type === 'whatsapp').map(p => normalizeId(p.page_id));
        const nextFB = new Set(Array.from(selectedFB));
        const nextWA = new Set(Array.from(selectedWA));
        fbIdsToRemove.forEach(id => nextFB.delete(id));
        waIdsToRemove.forEach(id => nextWA.delete(id));
        commitAssignmentSelection(nextFB, nextWA);
    };

    const [isCombo, setIsCombo] = useState(false);
    const [comboItems, setComboItems] = useState<string[]>([]);
    const [comboItemInput, setComboItemInput] = useState("");
    const [allowDescription, setAllowDescription] = useState(false);

    const [variants, setVariants] = useState<Variant[]>([
        { name: "Default", price: "0", currency: "BDT", available: true }
    ]);
    const [showVariants, setShowVariants] = useState(false);
    const [productMode, setProductMode] = useState<"simple" | "option-list" | "sku-matrix">("simple");
    const [attributeSchema, setAttributeSchema] = useState<ProductAttribute[]>([]);
    const [skuMatrix, setSkuMatrix] = useState<ProductSku[]>([]);
    const [pendingDeleteProduct, setPendingDeleteProduct] = useState<Product | null>(null);
    const [debugLogOpen, setDebugLogOpen] = useState(false);
    const [debugLogText, setDebugLogText] = useState("");
    const [debugLogFilter, setDebugLogFilter] = useState("");
    const logFileInputRef = useRef<HTMLInputElement>(null);
    const [errorOpen, setErrorOpen] = useState(false);
    const [errorItems, setErrorItems] = useState<{ time: number; source: string; status?: number; message: string }[]>([]);
    const [errorFilter, setErrorFilter] = useState("");
    const [errorBanner, setErrorBanner] = useState("");
    const recordError = (source: string, message: string, status?: number) => {
        const entry = { time: Date.now(), source, status, message };
        setErrorItems(prev => [entry, ...prev].slice(0, 500));
        setErrorBanner(`${source}${status ? ` [${status}]` : ""}: ${message}`);
        setErrorOpen(true);
        setTimeout(() => setErrorBanner(""), 6000);
    };
    const handleLogFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files && e.target.files[0] ? e.target.files[0] : null;
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const text = String(reader.result || "");
            setDebugLogText(text);
            setDebugLogOpen(true);
        };
        reader.readAsText(file);
    };

    const persistAssignments = async (nextSelectedFB?: Set<string>, nextSelectedWA?: Set<string>) => {
        if (!userId || !editProductId) return;
        try {
            setIsSubmitting(true);
            const token = localStorage.getItem("auth_token");
            const params = new URLSearchParams();
            params.set("user_id", userId);
            const resolvedPageId = pageId ?? getInitialPageId();
            const teamOwner = getTeamOwnerForContext(resolvedPageId);
            if (teamOwner) params.set("team_owner", teamOwner);
            if (resolvedPageId) params.set("page_id", resolvedPageId);
            const selectedMessengerIds = Array.from(nextSelectedFB ?? selectedFB);
            const selectedWASessions = Array.from(nextSelectedWA ?? selectedWA);
            const formData = new FormData();
            formData.append("allowed_messenger_ids", JSON.stringify(selectedMessengerIds));
            formData.append("allowed_wa_sessions", JSON.stringify(selectedWASessions));
            if (resolvedPageId) {
                formData.append("page_id", resolvedPageId);
            }
            const res = await fetch(`${BACKEND_URL}/api/products/${editProductId}?${params.toString()}`, {
                method: "PUT",
                headers: token ? { Authorization: `Bearer ${token}` } : {},
                body: formData
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                toast.error(data?.error || "Failed to update assignments");
                recordError("PUT /api/products assignments", data?.error || "Failed to update assignments", res.status);
                return;
            }
            setDebugLogText(prev => `${prev}\n[Client] ASSIGNMENTS_UPDATED fb=${JSON.stringify(selectedMessengerIds)} wa=${JSON.stringify(selectedWASessions)}`);
            const refreshToken = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
            fetchProducts(userId, searchQuery, refreshToken || undefined);
        } catch (error) {
            toast.error("Error updating assignments");
            recordError("PUT /api/products assignments", String(error));
        } finally {
            setIsSubmitting(false);
        }
    };

    const getTeamOwnerForContext = (targetPageId: string | null = pageId) => {
        if (typeof window === "undefined") return null;
        const teamOwner = localStorage.getItem("active_team_owner");
        const authUserRaw = localStorage.getItem("auth_user");
        let authEmail = null;
        try {
            authEmail = JSON.parse(authUserRaw || "{}")?.email || null;
        } catch (e) {}

        // Safety: If I am the team owner, I don't need to send the param
        try {
            const user = JSON.parse(localStorage.getItem("auth_user") || "{}");
            if (user.email && teamOwner === user.email) {
                // #region debug-point A:products-team-owner-self
                if (import.meta.env.VITE_DEBUG_SERVER_URL) fetch(import.meta.env.VITE_DEBUG_SERVER_URL,{method:"POST",body:JSON.stringify({sessionId:"product-scope-leak",runId:"pre-fix",hypothesisId:"A",location:"ProductsPage.tsx:getTeamOwnerForContext:self",msg:"[DEBUG] team owner matched auth user",data:{pageId:targetPageId,teamOwner,authEmail,activeFb:localStorage.getItem("active_fb_page_id"),activeWa:localStorage.getItem("active_wa_session_id"),messengerViewMode:localStorage.getItem("messenger_view_mode"),whatsappViewMode:localStorage.getItem("whatsapp_view_mode")},ts:Date.now()})}).catch(()=>{});
                // #endregion
                return null;
            }
        } catch (e) {
            
        }

        const activeWa = localStorage.getItem("active_wa_session_id");
        const activeFb = localStorage.getItem("active_fb_page_id");
        const contextType = getContextTypeForPage(targetPageId);

        if (contextType === "whatsapp") {
            const mode = localStorage.getItem("whatsapp_view_mode");
            const result = mode === "team" ? teamOwner : null;
            // #region debug-point A:products-team-owner-wa
            if (import.meta.env.VITE_DEBUG_SERVER_URL) fetch(import.meta.env.VITE_DEBUG_SERVER_URL,{method:"POST",body:JSON.stringify({sessionId:"product-scope-leak",runId:"pre-fix",hypothesisId:"A",location:"ProductsPage.tsx:getTeamOwnerForContext:wa",msg:"[DEBUG] team owner resolution for whatsapp",data:{pageId:targetPageId,activeWa,activeFb,teamOwner,authEmail,mode,result,messengerViewMode:localStorage.getItem("messenger_view_mode"),whatsappViewMode:localStorage.getItem("whatsapp_view_mode")},ts:Date.now()})}).catch(()=>{});
            // #endregion
            if (mode === "team") return teamOwner;
            return null;
        }

        if (contextType === "messenger") {
            const mode = localStorage.getItem("messenger_view_mode");
            const result = mode === "team" ? teamOwner : null;
            // #region debug-point A:products-team-owner-fb
            if (import.meta.env.VITE_DEBUG_SERVER_URL) fetch(import.meta.env.VITE_DEBUG_SERVER_URL,{method:"POST",body:JSON.stringify({sessionId:"product-scope-leak",runId:"pre-fix",hypothesisId:"A",location:"ProductsPage.tsx:getTeamOwnerForContext:fb",msg:"[DEBUG] team owner resolution for messenger",data:{pageId:targetPageId,activeWa,activeFb,teamOwner,authEmail,mode,result,messengerViewMode:localStorage.getItem("messenger_view_mode"),whatsappViewMode:localStorage.getItem("whatsapp_view_mode")},ts:Date.now()})}).catch(()=>{});
            // #endregion
            if (mode === "team") return teamOwner;
            return null;
        }

        // #region debug-point A:products-team-owner-fallback
        if (import.meta.env.VITE_DEBUG_SERVER_URL) fetch(import.meta.env.VITE_DEBUG_SERVER_URL,{method:"POST",body:JSON.stringify({sessionId:"product-scope-leak",runId:"pre-fix",hypothesisId:"A",location:"ProductsPage.tsx:getTeamOwnerForContext:fallback",msg:"[DEBUG] fallback team owner resolution",data:{pageId:targetPageId,activeWa,activeFb,teamOwner,authEmail,messengerViewMode:localStorage.getItem("messenger_view_mode"),whatsappViewMode:localStorage.getItem("whatsapp_view_mode"),returnedTeamOwner:teamOwner||null},ts:Date.now()})}).catch(()=>{});
        // #endregion
        return teamOwner || null;
    };

    const getActiveProductContext = (explicitPageId?: string | null) => {
        const resolvedPageId = explicitPageId !== undefined ? explicitPageId : (pageId ?? getInitialPageId());
        return {
            resolvedPageId,
            currentType: getContextTypeForPage(resolvedPageId),
            teamOwner: getTeamOwnerForContext(resolvedPageId)
        };
    };

    // 4. Trigger fetch on search or context changes
    useEffect(() => {
        if (userId) {
            const timer = setTimeout(async () => {
                const token = localStorage.getItem("auth_token");
                fetchProducts(userId, searchQuery, token || undefined, pageId);
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [searchQuery, userId, pageId]);

    // Auto-reload on page change
    useEffect(() => {
        const handleReload = () => {
            if (userId) {
                const token = localStorage.getItem("auth_token");
                const currentPid = getInitialPageId();
                fetchProducts(userId, searchQuery, token || undefined, currentPid);
            }
        };
        
        window.addEventListener("dashboard:reload", handleReload);
        
        return () => {
            window.removeEventListener("dashboard:reload", handleReload);
        };
    }, [userId, searchQuery, pageId]);

    const checkAccess = async (forcedPageId?: string | null) => {
        try {
            if (typeof window === "undefined") {
                return;
            }
            const storedUser = localStorage.getItem("auth_user");
            const storedToken = localStorage.getItem("auth_token");
            if (!storedUser || !storedToken) {
                return;
            }
            let parsedUser: any = null;
            try {
                parsedUser = JSON.parse(storedUser);
            } catch {
                return;
            }
            const uid = parsedUser && parsedUser.id ? String(parsedUser.id) : null;
            if (!uid) {
                return;
            }
            setUserId(uid);
            
            // Priority: provided arguments > current state
            const activeId = forcedPageId !== undefined ? forcedPageId : pageId;
            fetchProducts(uid, "", storedToken, activeId);
        } catch (error) {
            
        } finally {
            setLoading(false);
        }
    };

    const fetchProducts = async (uid: string, query: string = "", token?: string, explicitPageId?: string | null) => {
        try {
            const params = new URLSearchParams();
            params.set("user_id", uid);
            if (query) {
                params.set("search", query);
            }

            const { resolvedPageId, teamOwner } = getActiveProductContext(explicitPageId);
            setPageId(resolvedPageId);
            if (teamOwner) params.set("team_owner", teamOwner);

            if (!resolvedPageId) {
                setProducts([]);
                return;
            }

            if (resolvedPageId) {
                params.set("page_id", resolvedPageId);
            }

            const url = `${BACKEND_URL}/api/products?${params.toString()}`;
            // #region debug-point B:products-fetch-request
            if (import.meta.env.VITE_DEBUG_SERVER_URL) fetch(import.meta.env.VITE_DEBUG_SERVER_URL,{method:"POST",body:JSON.stringify({sessionId:"product-scope-leak",runId:"pre-fix",hypothesisId:"B",location:"ProductsPage.tsx:fetchProducts:request",msg:"[DEBUG] products request prepared",data:{uid,query,resolvedPageId,statePageId:pageId,teamOwner,url,activeFb:typeof window!=="undefined"?localStorage.getItem("active_fb_page_id"):null,activeWa:typeof window!=="undefined"?localStorage.getItem("active_wa_session_id"):null,activeTeamOwner:typeof window!=="undefined"?localStorage.getItem("active_team_owner"):null,messengerViewMode:typeof window!=="undefined"?localStorage.getItem("messenger_view_mode"):null,whatsappViewMode:typeof window!=="undefined"?localStorage.getItem("whatsapp_view_mode"):null},ts:Date.now()})}).catch(()=>{});
            // #endregion

            const headers: HeadersInit = {};
            if (token) {
                headers.Authorization = `Bearer ${token}`;
            }

            const res = await fetch(url, { headers });
            const data = await res.json().catch(() => null);

            if (!res.ok) {
                const message = data && data.error ? data.error : `Products fetch failed (${res.status})`;
                throw new Error(message);
            }

            if (data && data.data && Array.isArray(data.data)) {
                // #region debug-point C:products-fetch-response
                if (import.meta.env.VITE_DEBUG_SERVER_URL) fetch(import.meta.env.VITE_DEBUG_SERVER_URL,{method:"POST",body:JSON.stringify({sessionId:"product-scope-leak",runId:"pre-fix",hypothesisId:"C",location:"ProductsPage.tsx:fetchProducts:response",msg:"[DEBUG] products response received",data:{resolvedPageId,url,count:data.data.length,firstProducts:data.data.slice(0,5).map((p:any)=>({id:p.id,name:p.name,allowed_messenger_ids:p.allowed_messenger_ids,allowed_wa_sessions:p.allowed_wa_sessions}))},ts:Date.now()})}).catch(()=>{});
                // #endregion
                setProducts(data.data);
                setDebugLogText(prev => `${prev}\n[Client] PRODUCTS_FETCH page=${resolvedPageId} count=${data.data.length}`);
            } else if (Array.isArray(data)) {
                setProducts(data);
                setDebugLogText(prev => `${prev}\n[Client] PRODUCTS_FETCH page=${resolvedPageId} count=${data.length}`);
            } else {
                setProducts([]);
                setDebugLogText(prev => `${prev}\n[Client] PRODUCTS_FETCH page=${resolvedPageId} count=0`);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : "Products load failed";
            toast.error(message);
            recordError("GET /api/products", message);
        } finally {
            setLoading(false);
        }
    };

    const fetchPages = async () => {
        try {
            if (typeof window === "undefined") {
                return;
            }
            const token = localStorage.getItem("auth_token");
            if (!token) return;

            const teamOwner = getTeamOwnerForContext();
            const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
            
            if (teamOwner) {
                headers['x-team-owner'] = teamOwner;
            }

            const resMsg = await fetch(`${BACKEND_URL}/api/messenger/pages`, { headers });
            const dataMsg = await resMsg.json();
            
            const resWa = await fetch(`${BACKEND_URL}/api/whatsapp/sessions`, { headers });
            const dataWa = await resWa.json();

            let combinedPages: any[] = [];

            if (Array.isArray(dataMsg)) {
                combinedPages = [...combinedPages, ...dataMsg.map((p: any) => ({
                    page_id: String(p.page_id).trim(),
                    name: `(FB) ${String(p.name).trim()}`,
                    type: 'messenger'
                }))];
            }

            if (Array.isArray(dataWa)) {
                combinedPages = [...combinedPages, ...dataWa.map((s: any) => ({
                    page_id: String(s.name).trim(),
                    name: `(WA) ${String(s.name).trim()}`,
                    type: 'whatsapp'
                }))];
            }

            setAvailablePages(combinedPages);
            const fbCount = combinedPages.filter(p => p.type === 'messenger').length;
            const waCount = combinedPages.filter(p => p.type === 'whatsapp').length;
            setDebugLogText(prev => `${prev}\n[Client] PAGES_FETCH fb=${fbCount} wa=${waCount}`);
            return combinedPages;
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to fetch pages";
            recordError("GET /api/messenger/pages | GET /api/whatsapp/sessions", message);
            return [];
        }
    };

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const incoming = Array.from(e.target.files);
            
            // Keep 1 main image plus up to 49 additional images.
            const maxNew = MAX_PRODUCT_TOTAL_IMAGES - imagePreviews.length;
            if (maxNew <= 0) {
                toast.error(`Total ${MAX_PRODUCT_TOTAL_IMAGES} ta image er besi deoya jabe na.`);
                return;
            }
            const limited = incoming.slice(0, maxNew);
            if (limited.length < incoming.length) {
                toast.error(`Sudhu prothom ${maxNew} ta image add kora hoyeche. Total limit ${MAX_PRODUCT_TOTAL_IMAGES}.`);
            }
            
            const newFilePreviews = limited.map(f => URL.createObjectURL(f));
            setImagePreviews(prev => [...prev, ...newFilePreviews]);
            
            // Update primary image if none existed
            if (!imagePreview && newFilePreviews.length > 0) {
                setImagePreview(newFilePreviews[0]);
                setProductImage(limited[0]);
                if (limited.length > 1) {
                    setProductImages(prev => [...prev, ...limited.slice(1)]);
                }
            } else {
                setProductImages(prev => [...prev, ...limited]);
            }
        }
    };

    const handleVideoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files && e.target.files[0] ? e.target.files[0] : null;
        if (!file) return;

        if (!file.type.startsWith("video/")) {
            toast.error("Please select a valid video file.");
            return;
        }

        if (file.size > 16 * 1024 * 1024) {
            toast.error("Video size 16 MB er besi hote parbe na.");
            if (videoInputRef.current) {
                try { (videoInputRef.current as any).value = null; } catch {}
            }
            return;
        }

        if (videoPreview?.startsWith("blob:")) {
            URL.revokeObjectURL(videoPreview);
        }

        const preview = URL.createObjectURL(file);
        setProductVideo(file);
        setVideoPreview(preview);
    };

    const removeVideo = () => {
        if (videoPreview?.startsWith("blob:")) {
            URL.revokeObjectURL(videoPreview);
        }
        setProductVideo(null);
        setVideoPreview(null);
        if (videoInputRef.current) {
            try { (videoInputRef.current as any).value = null; } catch {}
        }
    };

    const removeImageAt = (index: number) => {
        const previewToRemove = imagePreviews[index];
        const isPrimaryPreview = previewToRemove === imagePreview;
        const isBlobPreview = previewToRemove?.startsWith('blob:');
        const additionalBlobPreviews = getAdditionalBlobPreviews();
        
        // 1. Update Previews
        const newPreviews = imagePreviews.filter((_, i) => i !== index);
        let newFiles = [...productImages];
        let newExisting = existingAdditionalImages.filter(url => url !== previewToRemove);

        // 2. Remove uploaded additional file if applicable
        if (isBlobPreview) {
            if (!isPrimaryPreview) {
                const fileIndex = additionalBlobPreviews.indexOf(previewToRemove);
                if (fileIndex >= 0) {
                    newFiles = newFiles.filter((_, i) => i !== fileIndex);
                }
            }
        }

        // 3. Recalculate primary image if the current one was removed
        if (isPrimaryPreview) {
            const nextPrimaryPreview = newPreviews[0] || null;

            if (isBlobPreview && productImage) {
                setProductImage(null);
            }

            if (nextPrimaryPreview?.startsWith('blob:')) {
                const remainingBlobPreviews = getAdditionalBlobPreviews(newPreviews, null, false);
                const promoteIndex = remainingBlobPreviews.indexOf(nextPrimaryPreview);
                if (promoteIndex >= 0 && newFiles[promoteIndex]) {
                    const promotedFile = newFiles[promoteIndex];
                    newFiles = newFiles.filter((_, i) => i !== promoteIndex);
                    setProductImage(promotedFile);
                } else {
                    setProductImage(null);
                }
            } else {
                setProductImage(null);
                if (nextPrimaryPreview && newExisting.includes(nextPrimaryPreview)) {
                    newExisting = newExisting.filter(url => url !== nextPrimaryPreview);
                }
            }

            setImagePreview(nextPrimaryPreview);
        }

        setImagePreviews(newPreviews);
        setProductImages(newFiles);
        setExistingAdditionalImages(newExisting);
    };

    const normalizeKeywords = (value: string) => {
        return value
            .split(/[,\n]/)
            .map(k => k.trim())
            .filter(k => k.length > 0);
    };

    // Ensure they are arrays and handle possible JSON strings
    const parseAssignment = (val: any) => {
        if (!val) return [];
        let arr = [];
        
        if (Array.isArray(val)) {
            arr = val;
        } else {
            try {
                const parsed = typeof val === 'string' ? JSON.parse(val) : val;
                if (Array.isArray(parsed)) arr = parsed;
                else if (typeof parsed === 'string') arr = [parsed];
            } catch (e) {
                if (typeof val === 'string' && val.includes(',')) {
                    arr = val.split(',').map(s => s.trim());
                } else if (typeof val === 'string') {
                    arr = [val];
                }
            }
        }

        // CLEANUP: Ensure all elements are STRINGS and not objects/nulls
        return arr
            .map(id => {
                if (!id) return null;
                // If it's an object, try to find an ID or name property, or skip it
                if (typeof id === 'object') {
                    const obj = id as any;
                    return String(obj.id || obj.page_id || obj.name || "").trim();
                }
                return String(id).trim();
            })
            .filter(id => id && id !== 'null' && id !== 'undefined' && id !== '[object Object]');
    };

    const normalizeAttributeName = (value: string, fallbackIndex = 0) => {
        const normalized = String(value || `attribute_${fallbackIndex + 1}`)
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_]+/g, "_")
            .replace(/^_+|_+$/g, "");
        return normalized || `attribute_${fallbackIndex + 1}`;
    };

    const formatAttributeLabel = (value: string) =>
        String(value || "")
            .replace(/_/g, " ")
            .replace(/\b\w/g, (m) => m.toUpperCase());

    const splitAttributeValues = (value: string) =>
        String(value || "")
            .split(/[\n,;|]+/)
            .map((item) => item.trim())
            .filter(Boolean);

    const normalizeAttributeSchemaValue = (schema: ProductAttribute[]): ProductAttribute[] => {
        return schema.map((attribute, index) => ({
            name: normalizeAttributeName(attribute.name || attribute.label, index),
            label: String(attribute.label || formatAttributeLabel(attribute.name)).trim() || formatAttributeLabel(attribute.name),
            values: Array.from(new Set((attribute.values || [])
                .flatMap((value) => splitAttributeValues(String(value || "")))))
        })).filter((attribute) => attribute.values.length > 0 || attribute.label);
    };

    const normalizeSkuAttributes = (attributes: Record<string, string> = {}) => {
        return Object.fromEntries(
            Object.entries(attributes)
                .map(([key, value]) => [normalizeAttributeName(key), String(value || "").trim()])
                .filter(([, value]) => Boolean(value))
        );
    };

    const buildSkuKey = (attributes: Record<string, string>) => {
        return Object.entries(normalizeSkuAttributes(attributes))
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => `${key}:${String(value || "").trim().toLowerCase()}`)
            .join("|");
    };

    const buildSkuName = (attributes: Record<string, string>) =>
        Object.values(normalizeSkuAttributes(attributes)).filter(Boolean).join(" / ") || "Standard";

    const encodeSkuSegment = (value: string) =>
        String(value || "")
            .toUpperCase()
            .replace(/(\d)\s*[.,]\s*(\d)/g, "$1P$2")
            .replace(/[^A-Z0-9]+/g, "")
            .slice(0, 8);

    const buildSkuCode = (attributes: Record<string, string>, index: number) => {
        const parts = Object.values(normalizeSkuAttributes(attributes))
            .filter(Boolean)
            .slice(0, 3)
            .map((value) => encodeSkuSegment(String(value)));
        return parts.length > 0 ? parts.join("-") : `SKU-${index + 1}`;
    };

    const createSkuRecord = (attributes: Record<string, string>, index: number, existingSku?: ProductSku): ProductSku => {
        const normalizedAttributes = normalizeSkuAttributes(attributes);
        const previousAttributes = normalizeSkuAttributes(existingSku?.attributes || {});
        const nextAutoCode = buildSkuCode(normalizedAttributes, index);
        const previousAutoCode = buildSkuCode(previousAttributes, index);
        const nextAutoName = buildSkuName(normalizedAttributes);
        const previousAutoName = buildSkuName(previousAttributes);

        return {
            sku_id: existingSku?.sku_id || null,
            sku_code: !existingSku?.sku_code || existingSku.sku_code === previousAutoCode || /^SKU-\d+$/i.test(existingSku.sku_code)
                ? nextAutoCode
                : existingSku.sku_code,
            name: !existingSku?.name || existingSku.name === previousAutoName || existingSku.name === "Standard"
                ? nextAutoName
                : existingSku.name,
            key: buildSkuKey(normalizedAttributes) || existingSku?.key || `manual:${index + 1}`,
            attributes: normalizedAttributes,
            price: existingSku?.price ?? Number(productPrice || 0),
            currency: existingSku?.currency || productCurrency || "USD",
            stock: existingSku?.stock ?? Number(productStock || 0),
            available: existingSku?.available ?? (Number(productStock || 0) > 0),
            image_url: existingSku?.image_url || null,
            video_url: existingSku?.video_url || null,
            aliases: existingSku?.aliases || []
        };
    };

    const generateSkuCombinations = (schema: ProductAttribute[]) => {
        const normalized = normalizeAttributeSchemaValue(schema).filter((attribute) => attribute.values.length > 0);
        if (normalized.length === 0) return [];
        let combinations: Record<string, string>[] = [{}];
        normalized.forEach((attribute) => {
            const next: Record<string, string>[] = [];
            combinations.forEach((base) => {
                attribute.values.forEach((value) => {
                    next.push({ ...base, [attribute.name]: value });
                });
            });
            combinations = next;
        });
        return combinations;
    };

    const countSkuCombinations = (schema: ProductAttribute[]) => {
        const normalized = normalizeAttributeSchemaValue(schema).filter((attribute) => attribute.values.length > 0);
        if (normalized.length === 0) return 0;
        return normalized.reduce((total, attribute) => total * attribute.values.length, 1);
    };

    const buildSkuMatrixFromSchema = (schema: ProductAttribute[], currentSkus: ProductSku[] = skuMatrix) => {
        const normalized = normalizeAttributeSchemaValue(schema);
        const combinations = generateSkuCombinations(normalized);
        const existingMap = new Map(currentSkus.map((sku) => [sku.key || buildSkuKey(sku.attributes || {}), sku]));
        const generatedRows = combinations.map((attributes, index) => {
            const key = buildSkuKey(attributes);
            const existingSku = existingMap.get(key);
            return createSkuRecord(attributes, index, existingSku ? { ...existingSku, key } : undefined);
        });
        const generatedMap = new Map(generatedRows.map((sku) => [sku.key || buildSkuKey(sku.attributes || {}), sku]));

        const preservedRows = currentSkus.map((sku, index) => {
            const key = sku.key || buildSkuKey(sku.attributes || {});
            if (key && generatedMap.has(key)) {
                return generatedMap.get(key) as ProductSku;
            }
            return createSkuRecord(sku.attributes || {}, index, sku);
        });

        const appendedRows = generatedRows
            .filter((sku) => {
                const key = sku.key || buildSkuKey(sku.attributes || {});
                return key ? !existingMap.has(key) : true;
            })
            .map((sku, index) => createSkuRecord(sku.attributes || {}, preservedRows.length + index, sku));

        return [...preservedRows, ...appendedRows];
    };

    const syncSkuMatrixFromSchema = (schema: ProductAttribute[], currentSkus: ProductSku[] = skuMatrix) => {
        const normalized = normalizeAttributeSchemaValue(schema);
        const next = buildSkuMatrixFromSchema(normalized, currentSkus);
        setAttributeSchema(normalized);
        setSkuMatrix(next);
        if (next.length === 0) {
            toast.error("Kombination generate korte hole kompakhe 1 ta attribute e multiple value din.");
            return;
        }
        toast.success(`${next.length} ta SKU combination ready.`);
    };

    const addManualSkuRow = () => {
        const normalized = normalizeAttributeSchemaValue(attributeSchema);
        if (normalized.length === 0) {
            toast.error("Age kompakhe 1 ta attribute label din, tarpor SKU row add korun.");
            return;
        }

        const emptyAttributes = Object.fromEntries(normalized.map((attribute) => [attribute.name, ""])) as Record<string, string>;
        setAttributeSchema(normalized);
        setSkuMatrix((current) => {
            const draft = {
                sku_id: null,
                sku_code: "",
                name: "",
                key: `manual:${current.length + 1}`,
                attributes: emptyAttributes,
                price: Number(productPrice || 0),
                currency: productCurrency || "USD",
                stock: Number(productStock || 0),
                available: Number(productStock || 0) > 0,
                image_url: null,
                video_url: null,
                aliases: []
            } as ProductSku;
            return [...current, createSkuRecord(emptyAttributes, current.length, draft)];
        });
    };

    const addKeywordFromInput = () => {
        const raw = keywordInput.replace(/\s+/g, " ").trim();
        if (!raw) {
            setKeywordInput("");
            return;
        }
        const parts = normalizeKeywords(raw);
        if (parts.length === 0) {
            setKeywordInput("");
            return;
        }
        const lowerExisting = new Set(productKeywords.map(k => k.toLowerCase()));
        const merged = [...productKeywords];
        parts.forEach(p => {
            if (!lowerExisting.has(p.toLowerCase())) {
                merged.push(p);
                lowerExisting.add(p.toLowerCase());
            }
        });
        setProductKeywords(merged);
        setKeywordInput("");
    };

    const removeKeywordAt = (index: number) => {
        const next = [...productKeywords];
        next.splice(index, 1);
        setProductKeywords(next);
    };

    const handleKeywordInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        if (value.endsWith("  ")) {
            setKeywordInput(value);
            addKeywordFromInput();
            return;
        }
        if (value.includes("\n")) {
            setKeywordInput(value.replace(/\n/g, ""));
            addKeywordFromInput();
            return;
        }
        setKeywordInput(value);
    };

    const handleKeywordKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault();
            addKeywordFromInput();
        }
        if (e.key === "," || e.key === "Tab") {
            e.preventDefault();
            addKeywordFromInput();
        }
    };

    const handleAutoExtractVisuals = async () => {
        if (!imagePreview) {
            toast.error("Please upload an image first to auto-extract details.");
            return;
        }
        toast.info("Extracting visual details... This might take a few seconds.");
        // This is a UI placeholder simulation for the AI Auto-Extract feature.
        // In a full implementation, this would send the image base64 to a backend endpoint
        // that uses the Vision model to return keywords and description.
        setTimeout(() => {
            const simulatedKeywords = ["AI-Extracted", "Visual-Tag"];
            const lowerExisting = new Set(productKeywords.map(k => k.toLowerCase()));
            const merged = [...productKeywords];
            simulatedKeywords.forEach(p => {
                if (!lowerExisting.has(p.toLowerCase())) {
                    merged.push(p);
                    lowerExisting.add(p.toLowerCase());
                }
            });
            setProductKeywords(merged);
            toast.success("Visual tags auto-extracted and added to keywords!");
        }, 1500);
    };

    const handleEdit = async (product: Product) => {
        setEditProductId(product.id || null);
        setProductName(product.name);
        setProductDesc(product.description || "");
        setProductKeywords(product.keywords ? normalizeKeywords(product.keywords) : []);
        setKeywordInput("");
        setProductPrice(product.price?.toString() || "0");
        
        const standardCurrencies = ["USD", "BDT", "EUR", "GBP", "INR", "PKR", "CAD", "AUD", "AED", "SAR", "MYR", "SGD"];
        const curr = product.currency || "USD";
        if (standardCurrencies.includes(curr)) {
            setProductCurrency(curr);
            setIsCustomCurrency(false);
        } else {
            setProductCurrency(curr);
            setIsCustomCurrency(true);
        }

        setProductStock(product.stock?.toString() || "0");
        setImagePreview(product.image_url || null);
        setVideoPreview(product.video_url || null);
        setProductVideo(null);
        const additional = Array.isArray(product.additional_images) ? product.additional_images : [];
        setExistingAdditionalImages(additional);
        setImagePreviews(product.image_url ? [product.image_url, ...additional] : additional);
        setProductImages([]);

        const messengerIdsRaw = parseAssignment(product.allowed_messenger_ids);
        const waSessionsRaw = parseAssignment(product.allowed_wa_sessions);
        let messengerIds = messengerIdsRaw;
        let waSessions = waSessionsRaw;
        let pages = availablePages;
        if (!pages || pages.length === 0) {
            pages = await fetchPages() || [];
        }
        if (pages && pages.length > 0) {
            const messengerSet = new Set(pages.filter(p => p.type === 'messenger').map(p => String(p.page_id).trim()));
            const waSet = new Set(pages.filter(p => p.type === 'whatsapp').map(p => String(p.page_id).trim()));
            const waInMessenger = messengerIds.filter(id => waSet.has(id));
            const messengerInWA = waSessions.filter(id => messengerSet.has(id));
            messengerIds = Array.from(new Set(messengerIds.filter(id => messengerSet.has(id)).concat(messengerInWA)));
            waSessions = Array.from(new Set(waSessions.filter(id => waSet.has(id)).concat(waInMessenger)));
        } else {
            const isNumeric = (s: string) => /^\d+$/.test(s);
            const onlyMessenger = messengerIds.filter(isNumeric);
            const waFromMessenger = messengerIds.filter(id => !isNumeric(id));
            const onlyWA = waSessions.filter(id => !isNumeric(id));
            messengerIds = Array.from(new Set(onlyMessenger));
            waSessions = Array.from(new Set([...onlyWA, ...waFromMessenger]));
        }
        setSelectedWA(new Set(waSessions.map(id => normalizeId(id))));
        setSelectedFB(new Set(messengerIds.map(id => normalizeId(id))));

        setDebugLogText(prev => `${prev}\n[Client] EDIT_SELECTED wa=${JSON.stringify(waSessions)} fb=${JSON.stringify(messengerIds)}`);
        setDebugLogOpen(true);

        setIsCombo(!!product.is_combo);
        setComboItems(Array.isArray(product.combo_items) ? product.combo_items : []);
        setComboItemInput("");
        setAllowDescription(product.allow_description === true);

        const nextMode = product.product_mode || (product.sku_matrix && product.sku_matrix.length > 0 ? "sku-matrix" : (product.variants && product.variants.length > 0 ? "option-list" : "simple"));
        setProductMode(nextMode);
        setAttributeSchema(Array.isArray(product.attribute_schema) ? product.attribute_schema : []);
        setSkuMatrix(Array.isArray(product.sku_matrix) ? product.sku_matrix : []);

        if (nextMode === "option-list" && product.variants && product.variants.length > 0) {
            setVariants(product.variants);
            setShowVariants(true);
        } else {
            setVariants([{ name: "Default", price: product.price?.toString() || "0", currency: product.currency || "USD", available: true }]);
            setShowVariants(false);
        }
        
        setIsDialogOpen(true);
    };
    
    useEffect(() => {}, [availablePages, isDialogOpen, editProductId]);

    const handleSubmit = async () => {
        if (!productName || !userId) {
            toast.error("Product title is required");
            return;
        }

        setIsSubmitting(true);
        try {
            const { resolvedPageId: currentContextId, teamOwner } = getActiveProductContext();
            const query = teamOwner ? `?team_owner=${teamOwner}` : "";

            const formData = new FormData();
            
            // --- STRICT ID SANITIZATION ---
            // Ensure we only have valid string IDs, no objects, no nulls.
            const cleanMessengerIds = Array.from(selectedFB);
            const cleanWASessions = Array.from(selectedWA);

            setDebugLogText(prev => `${prev}\n[Client] SANITIZED_IDS messenger=${JSON.stringify(cleanMessengerIds)} wa=${JSON.stringify(cleanWASessions)}`);

            // --- TYPE-BASED SEPARATION ---
            // Ensure WA sessions never leak into Messenger IDs and vice versa
            let finalMessengerIds = cleanMessengerIds;
            let finalWASessions = cleanWASessions;
            if (availablePages && availablePages.length > 0) {
                const messengerSet = new Set(availablePages.filter(p => p.type === 'messenger').map(p => String(p.page_id)));
                const waSet = new Set(availablePages.filter(p => p.type === 'whatsapp').map(p => String(p.page_id)));
                
                const waInMessenger = finalMessengerIds.filter(id => waSet.has(id));
                const messengerInWA = finalWASessions.filter(id => messengerSet.has(id));
                
                finalMessengerIds = Array.from(new Set(finalMessengerIds.filter(id => messengerSet.has(id)).concat(messengerInWA)));
                finalWASessions = Array.from(new Set(finalWASessions.filter(id => waSet.has(id)).concat(waInMessenger)));
            } else {
                const isNumeric = (s: string) => /^\d+$/.test(s);
                const onlyMessenger = finalMessengerIds.filter(isNumeric);
                const waFromMessenger = finalMessengerIds.filter(id => !isNumeric(id));
                const onlyWA = finalWASessions.filter(id => !isNumeric(id));
                finalMessengerIds = Array.from(new Set(onlyMessenger));
                finalWASessions = Array.from(new Set([...onlyWA, ...waFromMessenger]));
            }
            
            setDebugLogText(prev => `${prev}\n[Client] TYPE_SEPARATED messenger=${JSON.stringify(finalMessengerIds)} wa=${JSON.stringify(finalWASessions)}`);

            if (cleanMessengerIds.length === 0 && cleanWASessions.length === 0) {
                toast.error("Error: At least one assignment is required. Please select a Facebook Page or WhatsApp Session.");
                setIsSubmitting(false);
                return;
            }
            
            // --- HYBRID METHOD: SEND BOTH METADATA AND INDIVIDUAL FIELDS ---
            const normalizedSkuSchema = productMode === "sku-matrix" ? normalizeAttributeSchemaValue(attributeSchema) : [];
            const expectedSkuCombinationCount = productMode === "sku-matrix" ? countSkuCombinations(normalizedSkuSchema) : 0;
            let finalSkuMatrix = productMode === "sku-matrix" ? skuMatrix : [];

            if (productMode === "sku-matrix") {
                if (normalizedSkuSchema.length === 0 || expectedSkuCombinationCount === 0) {
                    toast.error("SKU Matrix use korte hole attribute ar value dite hobe.");
                    setIsSubmitting(false);
                    return;
                }

                if (skuMatrix.length === 0) {
                    finalSkuMatrix = buildSkuMatrixFromSchema(normalizedSkuSchema, []);
                    setSkuMatrix(finalSkuMatrix);
                } else if (skuMatrix.length < expectedSkuCombinationCount) {
                    const shouldMergeMissing = typeof window === "undefined"
                        ? true
                        : window.confirm(
                            `Current attribute onujayi ${expectedSkuCombinationCount} ta SKU combination howar kotha, kintu ekhono ${skuMatrix.length} ta ache. Missing combination auto-generate kore save korte chan?`
                        );

                    if (!shouldMergeMissing) {
                        setIsSubmitting(false);
                        return;
                    }

                    finalSkuMatrix = buildSkuMatrixFromSchema(normalizedSkuSchema, skuMatrix);
                    setSkuMatrix(finalSkuMatrix);
                }
            }

            const metadata = {
                user_id: String(userId),
                name: String(productName),
                description: String(productDesc || ""),
                keywords: String(productKeywords.join(", ") || ""),
                price: Number(productPrice || 0),
                currency: String(productCurrency || "USD"),
                stock: Number(productStock || 0),
                is_active: true,
                allowed_messenger_ids: finalMessengerIds,
                allowed_wa_sessions: finalWASessions,
                is_combo: !!isCombo,
                combo_items: comboItems || [],
                allow_description: !!allowDescription,
                page_id: currentContextId || null,
                product_mode: productMode,
                attribute_schema: normalizedSkuSchema,
                sku_matrix: finalSkuMatrix,
                variants: productMode === "option-list" && showVariants ? variants : []
            };

            // 1. Append metadata as a single JSON string
            formData.append("metadata", JSON.stringify(metadata));

            // 2. Append individual fields for backward compatibility
            // IMPORTANT: Sending as STRINGIFIED ARRAYS to avoid Multer array parsing issues
            formData.append("user_id", metadata.user_id);
            formData.append("name", metadata.name);
            formData.append("description", metadata.description);
            formData.append("keywords", metadata.keywords);
            formData.append("price", String(metadata.price));
            formData.append("currency", metadata.currency);
            formData.append("stock", String(metadata.stock));
            formData.append("is_active", String(metadata.is_active));
            formData.append("allowed_messenger_ids", JSON.stringify(finalMessengerIds));
            formData.append("allowed_wa_sessions", JSON.stringify(finalWASessions));
            formData.append("is_combo", String(metadata.is_combo));
            formData.append("combo_items", JSON.stringify(metadata.combo_items));
            formData.append("allow_description", String(metadata.allow_description));
            formData.append("product_mode", String(metadata.product_mode));
            formData.append("attribute_schema", JSON.stringify(metadata.attribute_schema));
            formData.append("sku_matrix", JSON.stringify(metadata.sku_matrix));
            formData.append("variants", JSON.stringify(metadata.variants));
            formData.append("page_id", String(metadata.page_id || ""));
            formData.append("existing_additional_images", JSON.stringify(existingAdditionalImages));
            if (!productImage) {
                formData.append("image_url", imagePreview && !imagePreview.startsWith("blob:") ? imagePreview : "");
            }
            if (!productVideo) {
                formData.append("video_url", videoPreview && !videoPreview.startsWith("blob:") ? videoPreview : "");
            }

            // --- FILES LAST (Best practice for Multer) ---
            if (productImage) {
                formData.append("image", productImage);
            }

            if (productVideo) {
                formData.append("video", productVideo);
            }

            if (productImages && productImages.length > 0) {
                productImages.forEach((file) => {
                    formData.append("images", file);
                });
            }

            

            const url = editProductId 
                ? `${BACKEND_URL}/api/products/${editProductId}${query}`
                : `${BACKEND_URL}/api/products${query}`;

            const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;

            const headers: HeadersInit = {};
            if (token) {
                headers.Authorization = `Bearer ${token}`;
            }

            const res = await fetch(url, {
                method: editProductId ? "PUT" : "POST",
                headers,
                body: formData
            });

            if (!res.ok) {
                const err = await res.json();
                recordError(editProductId ? "PUT /api/products" : "POST /api/products", err?.error || `Failed (${res.status})`, res.status);
                throw new Error(err?.error || `Failed to ${editProductId ? 'update' : 'create'} product`);
            }

            toast.success(`Product ${editProductId ? 'updated' : 'saved'} successfully!`);
            setIsDialogOpen(false);
            resetForm();
            
            // Re-fetch with token
            const refreshToken = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
            fetchProducts(userId, searchQuery, refreshToken || undefined);

        } catch (error: any) {
            toast.error(error.message);
            recordError(editProductId ? "PUT /api/products" : "POST /api/products", error.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleWCImport = async () => {
        if (!userId || !wcUrl || !wcKey || !wcSecret) {
            toast.error("Please fill all WooCommerce credentials");
            return;
        }
        
        setIsSubmitting(true);
        try {
            const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;

            const headers: HeadersInit = {
                'Content-Type': 'application/json'
            };
            if (token) {
                headers.Authorization = `Bearer ${token}`;
            }

            const teamOwner = getTeamOwnerForContext();
            const query = teamOwner ? `?team_owner=${teamOwner}` : "";
            
            const res = await fetch(`${BACKEND_URL}/api/products/import-woocommerce${query}`, {
                method: "POST",
                headers,
                body: JSON.stringify({ userId, url: wcUrl, consumerKey: wcKey, consumerSecret: wcSecret })
            });
            
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Import failed");
            
            toast.success(data.message || "Products imported!");
            setIsWCDialogOpen(false);
            const refreshToken = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
            fetchProducts(userId, searchQuery, refreshToken || undefined);
        } catch (error: any) {
            toast.error(error.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (id: number) => {
        if (!userId) return;
        try {
            const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
            const { resolvedPageId: currentId, currentType, teamOwner } = getActiveProductContext();
            const product = products.find(p => p.id === id);
            if (!product) {
                toast.error("Product not found");
                return;
            }
            const messengerIds = parseAssignment(product.allowed_messenger_ids);
            const waSessions = parseAssignment(product.allowed_wa_sessions);
            let newMessenger = messengerIds;
            let newWA = waSessions;
            if (currentType === "messenger" && currentId) {
                newMessenger = messengerIds.filter(pid => pid !== String(currentId));
            } else if (currentType === "whatsapp" && currentId) {
                newWA = waSessions.filter(pid => pid !== String(currentId));
            }
            const combinedEmpty = newMessenger.length === 0 && newWA.length === 0;
            const params = new URLSearchParams();
            params.set("user_id", userId);
            if (teamOwner) params.set("team_owner", teamOwner);
            if (currentId) params.set("page_id", String(currentId));
            if (combinedEmpty) {
                const res = await fetch(`${BACKEND_URL}/api/products/${id}?${params.toString()}`, {
                    method: "DELETE",
                    headers: token ? { Authorization: `Bearer ${token}` } : {}
                });
                const data = await res.json().catch(() => null);
                if (!res.ok) {
                    toast.error(data?.error || "Failed to delete product");
                    return;
                }
                toast.success("Product deleted");
            } else {
                const formData = new FormData();
                formData.append("allowed_messenger_ids", JSON.stringify(newMessenger));
                formData.append("allowed_wa_sessions", JSON.stringify(newWA));
                if (currentId) formData.append("page_id", String(currentId));
                formData.append("user_id", userId);
                const res = await fetch(`${BACKEND_URL}/api/products/${id}?${params.toString()}`, {
                    method: "PUT",
                    headers: token ? { Authorization: `Bearer ${token}` } : {},
                    body: formData
                });
                const data = await res.json().catch(() => null);
                if (!res.ok) {
                    toast.error(data?.error || "Failed to update product");
                    return;
                }
                toast.success("Removed from current page");
            }
            const refreshToken = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
            fetchProducts(userId, searchQuery, refreshToken || undefined);
        } catch (error) {
            toast.error("Error deleting product");
            recordError("DELETE /api/products", String(error));
        }
    };

    const handleToggleDescription = async (product: Product, enabled: boolean) => {
        if (!userId) return;
        try {
            setIsSubmitting(true);
            const token = localStorage.getItem("auth_token");
            const params = new URLSearchParams();
            params.set("user_id", userId);
            const { resolvedPageId, teamOwner } = getActiveProductContext();
            if (teamOwner) params.set("team_owner", teamOwner);
            if (resolvedPageId) params.set("page_id", resolvedPageId);
            const formData = new FormData();
            formData.append("allow_description", String(enabled));
            if (resolvedPageId) formData.append("page_id", resolvedPageId);

            const res = await fetch(`${BACKEND_URL}/api/products/${product.id}?${params.toString()}`, {
                method: "PUT",
                headers: token ? { Authorization: `Bearer ${token}` } : {},
                body: formData
            });

            const data = await res.json().catch(() => null);
            if (!res.ok) {
                toast.error(data?.error || "Failed to update product");
                recordError("PUT /api/products allow_description", data?.error || "Failed to update product", res.status);
                return;
            }

            setProducts((prev) =>
                prev.map((p) => (p.id === product.id ? { ...p, allow_description: enabled } : p))
            );
        } catch (error) {
            toast.error("Error updating product");
            recordError("PUT /api/products allow_description", String(error));
        } finally {
            setIsSubmitting(false);
        }
    };
    
    const handleToggleActive = async (product: Product, enabled: boolean) => {
        if (!userId) return;
        try {
            setIsSubmitting(true);
            const token = localStorage.getItem("auth_token");
            const params = new URLSearchParams();
            params.set("user_id", userId);
            const { resolvedPageId, teamOwner } = getActiveProductContext();
            if (teamOwner) params.set("team_owner", teamOwner);
            if (resolvedPageId) params.set("page_id", resolvedPageId);
            const formData = new FormData();
            formData.append("is_active", String(enabled));
            if (resolvedPageId) formData.append("page_id", resolvedPageId);

            const res = await fetch(`${BACKEND_URL}/api/products/${product.id}?${params.toString()}`, {
                method: "PUT",
                headers: token ? { Authorization: `Bearer ${token}` } : {},
                body: formData
            });

            const data = await res.json().catch(() => null);
            if (!res.ok) {
                toast.error(data?.error || "Failed to update product");
                recordError("PUT /api/products is_active", data?.error || "Failed to update product", res.status);
                return;
            }

            setProducts((prev) =>
                prev.map((p) => (p.id === product.id ? { ...p, is_active: enabled } : p))
            );
        } catch (error) {
            toast.error("Error updating product");
            recordError("PUT /api/products is_active", String(error));
        } finally {
            setIsSubmitting(false);
        }
    };

    const resetForm = () => {
        setEditProductId(null);
        setProductName("");
        setProductDesc("");
        setProductPrice("0");
        setProductStock("0");
        setProductCurrency("USD");
        setIsCustomCurrency(false);
        setProductKeywords([]);
        setKeywordInput("");
        setProductImage(null);
        setImagePreview(null);
        setProductVideo(null);
        setVideoPreview(null);
        setProductImages([]);
        setImagePreviews([]);
        setExistingAdditionalImages([]);
        
        // --- MANUAL SELECTION REQUIRED ---
        // As per user instruction: "add kroar somoi o sekan tekei add korte hobe auto nibe na"
        setSelectedWA(new Set());
        setSelectedFB(new Set());

        setIsCombo(false);
        setComboItems([]);
        setComboItemInput("");
        setProductMode("simple");
        setAttributeSchema([]);
        setSkuMatrix([]);
        setVariants([{ name: "Default", price: "0", currency: "USD", available: true }]);
        setShowVariants(false);
        setAllowDescription(false);
    };

    if (loading) {
        return (
            <div className="flex h-[50vh] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="space-y-6 p-6 pb-24">
            {errorBanner && (
                <div className="rounded-md bg-red-500/15 border border-red-500/30 text-red-400 px-3 py-2 text-sm">
                    {errorBanner}
                </div>
            )}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Products</h1>
                    <p className="text-muted-foreground">
                        Manage products for your agents. Images are auto-optimized and videos up to 16 MB are supported.
                    </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
                    <div className="relative w-full md:w-auto">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search products..."
                            className="pl-8 w-full md:w-[250px]"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                    
                    <Dialog open={isWCDialogOpen} onOpenChange={setIsWCDialogOpen}>
                        <DialogTrigger asChild>
                            <Button variant="outline" className="w-full sm:w-auto bg-[#0f0f0f]/70 border-white/10 hover:bg-[#0f0f0f]/80 rounded-full">
                                <Download className="w-4 h-4 mr-2" />
                                Import WooCommerce
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-sm bg-[#0f0f0f]/90 border border-white/10 backdrop-blur-md rounded-2xl">
                            <DialogHeader>
                                <DialogTitle>Connect WooCommerce</DialogTitle>
                                <DialogDescription>Import products directly from your store.</DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                                <div className="grid gap-2">
                                    <Label>Store URL</Label>
                                    <Input 
                                        placeholder="https://example.com" 
                                        value={wcUrl} 
                                        onChange={(e) => setWcUrl(e.target.value)} 
                                        className="bg-[#101010]/80 border-white/10 focus:border-[#00ff88]/40"
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label>Consumer Key</Label>
                                    <Input 
                                        type="password" 
                                        placeholder="ck_xxxxxxxx" 
                                        value={wcKey} 
                                        onChange={(e) => setWcKey(e.target.value)} 
                                        className="bg-[#101010]/80 border-white/10 focus:border-[#00ff88]/40"
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label>Consumer Secret</Label>
                                    <Input 
                                        type="password" 
                                        placeholder="cs_xxxxxxxx" 
                                        value={wcSecret} 
                                        onChange={(e) => setWcSecret(e.target.value)} 
                                        className="bg-[#101010]/80 border-white/10 focus:border-[#00ff88]/40"
                                    />
                                </div>
                            </div>
                            <DialogFooter>
                            <Button variant="outline" className="border-white/20 rounded-md" onClick={() => setIsWCDialogOpen(false)}>Cancel</Button>
                                <Button onClick={handleWCImport} disabled={isSubmitting} className="bg-[#00ff88] text-black font-bold rounded-md hover:bg-[#00f07f] shadow-[0_10px_30px_rgba(0,255,136,0.25)]">
                                    {isSubmitting && <Loader2 className="w-4 h-4 animate-spin mr-2 text-black" />}
                                    Fetch & Import
                                    <span className="ml-2 inline-flex">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 fill-black" viewBox="0 0 24 24"><path d="M12 4l1.41 1.41L8.83 10H20v2H8.83l4.58 4.59L12 18l-8-8 8-8z"/></svg>
                                    </span>
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                        <DialogTrigger asChild>
                            <Button onClick={resetForm} className="w-full sm:w-auto bg-[#00ff88] text-black font-bold rounded-md hover:bg-[#00f07f] shadow-[0_10px_30px_rgba(0,255,136,0.25)]">
                                <Plus className="w-4 h-4 mr-2" />
                                Add Product
                                <span className="ml-2 inline-flex">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 fill-black" viewBox="0 0 24 24"><path d="M12 4l1.41 1.41L8.83 10H20v2H8.83l4.58 4.59L12 18l-8-8 8-8z"/></svg>
                                </span>
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-[#0f0f0f]/90 border border-white/10 backdrop-blur-md rounded-2xl">
                        <DialogHeader>
                            <DialogTitle>{editProductId ? 'Edit Product' : 'Add New Product'}</DialogTitle>
                            <DialogDescription>
                                {editProductId ? 'Update product details.' : 'Add product details.'}
                            </DialogDescription>
                        </DialogHeader>
                        
                        <div className="grid grid-cols-1 md:grid-cols-[140px_1fr] gap-6 py-4">
                            {/* Left: Media Upload */}
                            <div className="flex flex-col gap-3 items-center">
                                <div 
                                    className="w-[140px] h-[140px] border-2 border-dashed border-white/20 rounded-lg flex items-center justify-center cursor-pointer hover:border-[#00ff88] hover:bg-[#00ff88]/5 transition-colors bg-muted/10 relative overflow-hidden group"
                                    onClick={openImagePicker}
                                >
                                    {imagePreview ? (
                                        <>
                                            <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                <ImageIcon className="text-white w-6 h-6" />
                                            </div>
                                        </>
                                    ) : (
                                        <div className="text-center p-2 text-muted-foreground">
                                            <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                            <span className="text-xs">Upload Image</span>
                                        </div>
                                    )}
                                </div>
                                <input 
                                    type="file" 
                                    accept="image/*" 
                                    multiple 
                                    name="images"
                                    className="hidden" 
                                    ref={fileInputRef}
                                    onChange={handleImageChange}
                                />
                                <Button 
                                    type="button" 
                                    variant="outline" 
                                    size="sm" 
                                    className="w-full border-white/20 rounded-md"
                                    onClick={openImagePicker}
                                >
                                    Add Images
                                    <span className="ml-2 inline-flex">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 fill-current" viewBox="0 0 24 24"><path d="M12 4l1.41 1.41L8.83 10H20v2H8.83l4.58 4.59L12 18l-8-8 8-8z"/></svg>
                                    </span>
                                </Button>
                                <div 
                                    className="w-[140px] h-[140px] border-2 border-dashed border-white/20 rounded-lg flex items-center justify-center cursor-pointer hover:border-[#00ff88] hover:bg-[#00ff88]/5 transition-colors bg-muted/10 relative overflow-hidden group"
                                    onClick={openVideoPicker}
                                >
                                    {videoPreview ? (
                                        <>
                                            <video src={videoPreview} className="w-full h-full object-cover" muted playsInline />
                                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Video className="text-white w-6 h-6" />
                                            </div>
                                        </>
                                    ) : (
                                        <div className="text-center p-2 text-muted-foreground">
                                            <Video className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                            <span className="text-xs">Upload Video</span>
                                        </div>
                                    )}
                                </div>
                                <input
                                    type="file"
                                    accept="video/*"
                                    name="video"
                                    className="hidden"
                                    ref={videoInputRef}
                                    onChange={handleVideoChange}
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="w-full border-white/20 rounded-md"
                                    onClick={openVideoPicker}
                                >
                                    Add Video
                                </Button>
                                <p className="text-[10px] text-center text-muted-foreground">
                                    One video allowed, max 16 MB.
                                </p>
                            </div>

                            {/* Right: Fields */}
                            <div className="space-y-4">
                                <div className="grid gap-2">
                                    <Label htmlFor="title">Title *</Label>
                                    <Input 
                                        id="title" 
                                        placeholder="Enter product title" 
                                        className="bg-[#101010]/80 border-white/10 focus:border-[#00ff88]/40"
                                        value={productName}
                                        onChange={(e) => setProductName(e.target.value)}
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="desc">Description</Label>
                                    <Textarea 
                                        id="desc" 
                                        placeholder="Describe your product..." 
                                        className="h-32 resize-y bg-[#101010]/80 border-white/10 focus:border-[#00ff88]/40"
                                        value={productDesc}
                                        onChange={(e) => setProductDesc(e.target.value)}
                                    />
                                </div>
                                <div className="flex items-center justify-between rounded-md border border-white/10 bg-black/40 px-3 py-2">
                                    <div className="space-y-0.5">
                                        <Label className="text-sm font-medium">Allow Description in Chat</Label>
                                        <p className="text-[10px] text-muted-foreground">Enable to allow this product description to be sent.</p>
                                    </div>
                                    <Switch checked={allowDescription} onCheckedChange={setAllowDescription} className="data-[state=checked]:bg-[#00ff88]" />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="keywords">AI Keywords (Label Text)</Label>
                                    <div className="flex flex-wrap gap-1 rounded-md border border-white/10 bg-[#050505]/80 px-2 py-1 min-h-[42px]">
                                        {productKeywords.map((k, idx) => (
                                            <button
                                                key={idx}
                                                type="button"
                                                className="inline-flex items-center gap-1 rounded-full bg-[#00ff88]/10 border border-[#00ff88]/40 px-2 py-0.5 text-[11px] text-[#00ff88] hover:bg-[#00ff88]/20"
                                                onClick={() => removeKeywordAt(idx)}
                                            >
                                                <span className="max-w-[140px] truncate">{k}</span>
                                                <span className="text-[9px] opacity-80">×</span>
                                            </button>
                                        ))}
                                        <input
                                            id="keywords"
                                            value={keywordInput}
                                            onChange={handleKeywordInputChange}
                                            onKeyDown={handleKeywordKeyDown}
                                            className="flex-1 min-w-[120px] bg-transparent outline-none border-none text-xs text-white placeholder:text-muted-foreground"
                                            placeholder={
                                                productKeywords.length === 0
                                                    ? "Type keyword, press Enter or double space"
                                                    : "Add more..."
                                            }
                                        />
                                    </div>
                                    <span className="text-[10px] text-muted-foreground">
                                        Product er gaye ja brand/line lekha thake segula choto choto keyword hisebe add koro.
                                    </span>
                                </div>

                                <div className="space-y-4 rounded-xl border border-white/5 bg-white/[0.02] p-4">
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-0.5">
                                            <Label className="text-sm font-medium">Is this a Combo?</Label>
                                            <p className="text-[10px] text-muted-foreground">Enable this to add multiple items to this product package.</p>
                                        </div>
                                        <Switch 
                                            checked={isCombo} 
                                            onCheckedChange={setIsCombo}
                                            className="data-[state=checked]:bg-[#00ff88]"
                                        />
                                    </div>

                                    {isCombo && (
                                        <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                                            <div className="grid gap-2">
                                                <Label htmlFor="combo-items" className="text-xs">Combo Sub-Items</Label>
                                                <div className="flex gap-2">
                                                    <Input 
                                                        id="combo-items"
                                                        placeholder="e.g. Rice Cleanser" 
                                                        value={comboItemInput}
                                                        onChange={(e) => setComboItemInput(e.target.value)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') {
                                                                e.preventDefault();
                                                                if (comboItemInput.trim()) {
                                                                    setComboItems([...comboItems, comboItemInput.trim()]);
                                                                    setComboItemInput("");
                                                                }
                                                            }
                                                        }}
                                                        className="bg-[#101010]/80 border-white/10 focus:border-[#00ff88]/40 h-9 text-sm"
                                                    />
                                                    <Button 
                                                        type="button"
                                                        size="sm"
                                                        onClick={() => {
                                                            if (comboItemInput.trim()) {
                                                                setComboItems([...comboItems, comboItemInput.trim()]);
                                                                setComboItemInput("");
                                                            }
                                                        }}
                                                        className="bg-[#00ff88] text-black h-9"
                                                    >
                                                        Add
                                                    </Button>
                                                </div>
                                            </div>
                                            
                                            {comboItems.length > 0 && (
                                                <div className="flex flex-wrap gap-2 pt-1">
                                                    {comboItems.map((item, idx) => (
                                                        <div key={idx} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white group">
                                                            <span>{item}</span>
                                                            <button 
                                                                onClick={() => setComboItems(comboItems.filter((_, i) => i !== idx))}
                                                                className="text-muted-foreground hover:text-red-400 transition-colors"
                                                            >
                                                                <X className="w-3 h-3" />
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                <div className="flex gap-4">
                                    <div className="grid gap-2 flex-1">
                                        <Label htmlFor="price">Price *</Label>
                                        <Input 
                                            id="price" 
                                            type="number" 
                                            className="bg-[#101010]/80 border-white/10 focus:border-[#00ff88]/40"
                                            value={productPrice}
                                            onChange={(e) => setProductPrice(e.target.value)}
                                        />
                                    </div>
                                    <div className="grid gap-2 w-[100px]">
                                        <Label>Currency *</Label>
                                        {isCustomCurrency ? (
                                            <div className="flex gap-1">
                                                <Input 
                                                    value={productCurrency} 
                                                    onChange={(e) => setProductCurrency(e.target.value.toUpperCase())}
                                                    className="uppercase px-2 bg-[#101010]/80 border-white/10 focus:border-[#00ff88]/40"
                                                    maxLength={3}
                                                    placeholder="XXX"
                                                />
                                                <Button variant="ghost" size="icon" className="h-10 w-6 p-0 text-muted-foreground hover:text-destructive" onClick={() => setIsCustomCurrency(false)}>
                                                    <X className="w-4 h-4" />
                                                </Button>
                                            </div>
                                        ) : (
                                            <Select value={productCurrency} onValueChange={(val) => {
                                                if (val === "CUSTOM") {
                                                    setProductCurrency("");
                                                    setIsCustomCurrency(true);
                                                } else {
                                                    setProductCurrency(val);
                                                }
                                            }}>
                                                <SelectTrigger className="bg-[#101010]/80 border-white/10 focus:border-[#00ff88]/40">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="USD">USD</SelectItem>
                                                    <SelectItem value="BDT">BDT</SelectItem>
                                                    <SelectItem value="EUR">EUR</SelectItem>
                                                    <SelectItem value="GBP">GBP</SelectItem>
                                                    <SelectItem value="INR">INR</SelectItem>
                                                    <SelectItem value="PKR">PKR</SelectItem>
                                                    <SelectItem value="CAD">CAD</SelectItem>
                                                    <SelectItem value="AUD">AUD</SelectItem>
                                                    <SelectItem value="AED">AED</SelectItem>
                                                    <SelectItem value="SAR">SAR</SelectItem>
                                                    <SelectItem value="MYR">MYR</SelectItem>
                                                    <SelectItem value="SGD">SGD</SelectItem>
                                                    <SelectItem value="CUSTOM" className="text-muted-foreground italic">Custom...</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        )}
                                    </div>
                                    <div className="grid gap-2 flex-1">
                                        <Label htmlFor="stock">Stock *</Label>
                                        <Input 
                                            id="stock" 
                                            type="number" 
                                            className="bg-[#101010]/80 border-white/10 focus:border-[#00ff88]/40"
                                            value={productStock}
                                            onChange={(e) => setProductStock(e.target.value)}
                                        />
                                    </div>
                                </div>
                                
                                {imagePreviews.length > 0 && (
                                    <div className="space-y-2">
                                        <Label>Selected Images</Label>
                                        <div className="flex gap-2 overflow-x-auto pb-1">
                                            {imagePreviews.map((src, idx) => (
                                                <div key={idx} className="relative group min-w-[72px]">
                                                    <img src={src} alt={`Preview ${idx + 1}`} className="w-[72px] h-[72px] object-cover rounded border border-white/10" />
                                                    <button 
                                                        type="button" 
                                                        className="absolute top-1 right-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100"
                                                        onClick={() => removeImageAt(idx)}
                                                    >
                                                        Remove
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {videoPreview && (
                                    <div className="space-y-2">
                                        <Label>Selected Video</Label>
                                        <div className="relative w-full max-w-[220px] overflow-hidden rounded border border-white/10 bg-black/40">
                                            <video src={videoPreview} controls className="w-full h-auto max-h-[180px] bg-black" />
                                            <button
                                                type="button"
                                                className="absolute top-2 right-2 bg-black/70 text-white text-[10px] px-2 py-1 rounded"
                                                onClick={removeVideo}
                                            >
                                                Remove
                                            </button>
                                        </div>
                                    </div>
                                )}
                                
                                {imagePreviews.length > 0 && (
                                    <div className="pt-2 pb-2">
                                        <Button 
                                            type="button" 
                                            variant="secondary" 
                                            size="sm" 
                                            className="w-full bg-[#00ff88]/10 hover:bg-[#00ff88]/20 text-[#00ff88] border border-[#00ff88]/20 flex items-center justify-center gap-2"
                                            onClick={handleAutoExtractVisuals}
                                        >
                                            ✨ Auto-Extract Visual Details for AI Search
                                        </Button>
                                    </div>
                                )}
                                
                                <div className="space-y-2 pt-2">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <Label>Visible on Pages *</Label>
                                            <p className="text-[10px] text-muted-foreground mt-1">
                                                Select at least one WhatsApp session or Facebook page.
                                            </p>
                                        </div>
                                        <div className="flex gap-2">
                                        <Button 
                                            type="button" 
                                            variant="outline" 
                                            size="sm"
                                            className="h-7 text-xs border-white/10 hover:bg-white/5"
                                            onClick={handleSelectAllPages}
                                        >
                                            Select All
                                        </Button>
                                        <Button 
                                            type="button" 
                                            variant="outline" 
                                            size="sm"
                                            className="h-7 text-xs border-white/10 hover:bg-white/5 text-red-400 hover:text-red-300"
                                            onClick={handleDeselectAllPages}
                                        >
                                            Clear
                                        </Button>
                                        </div>
                                    </div>

                                    {availablePages.length > 5 && (
                                        <div className="relative">
                                            <Search className="absolute left-2 top-2 h-3 w-3 text-muted-foreground" />
                                            <Input 
                                                placeholder="Search pages..." 
                                                value={pageSearch}
                                                onChange={(e) => setPageSearch(e.target.value)}
                                                className="h-8 pl-7 text-xs mb-2"
                                            />
                                        </div>
                                    )}

                                {(() => {
                                  const waPages = filteredPages.filter(p => p.type === 'whatsapp');
                                  const fbPages = filteredPages.filter(p => p.type === 'messenger');

                                  return (
                                    <div className="space-y-3">
                                      <div>
                                        <Label className="text-xs font-semibold text-muted-foreground">WhatsApp Sessions Access</Label>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border p-3 rounded-md max-h-32 overflow-y-auto bg-muted/5 mt-1">
                                          {waPages.length === 0 ? (
                                            <p className="text-xs text-muted-foreground col-span-full text-center">No WhatsApp sessions.</p>
                                          ) : waPages.map(page => {
                                            const pageKeyRaw = String(page.page_id);
                                            const pageKey = pageKeyRaw.trim();
                                            const isSelected = selectedWA.has(pageKey.toLowerCase());
                                            return (
                                              <div 
                                                key={`wa-${page.page_id}`} 
                                                className={cn(
                                                  "flex items-center space-x-2 p-1.5 rounded hover:bg-accent/50 transition-colors border border-transparent",
                                                  isSelected && "bg-[#00ff88]/10 border-[#00ff88]/30 shadow-[0_0_10px_rgba(0,255,136,0.1)]"
                                                )}
                                              >
                                                <Checkbox 
                                                  id={`wa-page-${page.page_id}`}
                                                  checked={isSelected}
                                                  onCheckedChange={(checked) => {
                                                    const key = pageKey.toLowerCase();
                                                    const nextWA = new Set(Array.from(selectedWA));
                                                    const nextFB = new Set(Array.from(selectedFB));
                                                    if (checked) nextWA.add(key); else nextWA.delete(key);
                                                    nextFB.delete(key);
                                                    commitAssignmentSelection(nextFB, nextWA);
                                                  }}
                                                  className={cn(
                                                    "data-[state=checked]:bg-[#00ff88] data-[state=checked]:border-[#00ff88]",
                                                    isSelected && "ring-1 ring-[#00ff88]/40"
                                                  )}
                                                />
                                                <Label 
                                                  htmlFor={`wa-page-${page.page_id}`}
                                                  className={cn(
                                                    "text-sm font-normal cursor-pointer select-none flex-1 truncate",
                                                    isSelected && "text-[#00ff88] font-medium"
                                                  )}
                                                >
                                                  {page.name}
                                                </Label>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                      
                                      <div>
                                        <Label className="text-xs font-semibold text-muted-foreground">Facebook Pages Access</Label>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border p-3 rounded-md max-h-32 overflow-y-auto bg-muted/5 mt-1">
                                          {fbPages.length === 0 ? (
                                            <p className="text-xs text-muted-foreground col-span-full text-center">No Facebook pages.</p>
                                          ) : fbPages.map(page => {
                                            const pageKeyRaw = String(page.page_id);
                                            const pageKey = pageKeyRaw.trim();
                                            const isSelected = selectedFB.has(pageKey.toLowerCase());
                                            return (
                                              <div 
                                                key={`fb-${page.page_id}`} 
                                                className={cn(
                                                  "flex items-center space-x-2 p-1.5 rounded hover:bg-accent/50 transition-colors border border-transparent",
                                                  isSelected && "bg-[#00ff88]/10 border-[#00ff88]/30 shadow-[0_0_10px_rgba(0,255,136,0.1)]"
                                                )}
                                              >
                                                <Checkbox 
                                                  id={`fb-page-${page.page_id}`}
                                                  checked={isSelected}
                                                  onCheckedChange={(checked) => {
                                                    const key = pageKey.toLowerCase();
                                                    const nextFB = new Set(Array.from(selectedFB));
                                                    const nextWA = new Set(Array.from(selectedWA));
                                                    if (checked) nextFB.add(key); else nextFB.delete(key);
                                                    nextWA.delete(key);
                                                    commitAssignmentSelection(nextFB, nextWA);
                                                  }}
                                                  className={cn(
                                                    "data-[state=checked]:bg-[#00ff88] data-[state=checked]:border-[#00ff88]",
                                                    isSelected && "ring-1 ring-[#00ff88]/40"
                                                  )}
                                                />
                                                <Label 
                                                  htmlFor={`fb-page-${page.page_id}`}
                                                  className={cn(
                                                    "text-sm font-normal cursor-pointer select-none flex-1 truncate",
                                                    isSelected && "text-[#00ff88] font-medium"
                                                  )}
                                                >
                                                  {page.name}
                                                </Label>
                                              </div>
                                            );
                                          })}
                                          </div>
                                        </div>
                                    </div>
                                  );
                                })()}
                                </div>
                            </div>
                        </div>

                        <div className="border-t pt-4 space-y-4">
                            <div className="grid gap-2">
                                <Label className="text-sm font-medium">Product Mode</Label>
                                <Select
                                    value={productMode}
                                    onValueChange={(value: "simple" | "option-list" | "sku-matrix") => {
                                        setProductMode(value);
                                        setShowVariants(value === "option-list");
                                        if (value === "simple") {
                                            setAttributeSchema([]);
                                            setSkuMatrix([]);
                                        }
                                        if (value === "sku-matrix" && attributeSchema.length === 0) {
                                            const starter = [
                                                { name: "design", label: "Design", values: [] },
                                                { name: "color", label: "Color", values: [] },
                                                { name: "size", label: "Size", values: [] }
                                            ];
                                            setAttributeSchema(starter);
                                            setSkuMatrix([]);
                                        }
                                    }}
                                >
                                    <SelectTrigger className="bg-[#101010]/80 border-white/10 focus:border-[#00ff88]/40">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="simple">Simple Product</SelectItem>
                                        <SelectItem value="option-list">Option List</SelectItem>
                                        <SelectItem value="sku-matrix">Family + SKU Matrix</SelectItem>
                                    </SelectContent>
                                </Select>
                                <p className="text-[10px] text-muted-foreground">
                                    `Simple` e single price/stock, `Option List` e kichu manual option, ar `SKU Matrix` e design/color/size/item combination manage kora jabe.
                                </p>
                            </div>

                            {productMode === "option-list" && (
                                <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <Label className="text-sm">Variants (Price Options)</Label>
                                            <p className="text-[10px] text-muted-foreground mt-1">
                                                Small/Red/Design 1 er moto alada option dite parben.
                                            </p>
                                        </div>
                                        <Button variant="outline" size="sm" onClick={() => setVariants([...variants, { name: `Option ${variants.length + 1}`, price: productPrice, currency: productCurrency, available: true, image_url: null, video_url: null }])}>
                                            <Plus className="w-3 h-3 mr-1" />
                                            Add Option
                                        </Button>
                                    </div>
                                    <div className="space-y-4">
                                        {variants.map((variant, index) => (
                                            <Card key={index} className="border border-white/10 bg-black/30">
                                                <CardContent className="p-4 space-y-4">
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-3">
                                                            <span className="w-6 h-6 rounded-full bg-[#00ff88]/20 text-[#00ff88] flex items-center justify-center text-xs font-bold">
                                                                {index + 1}
                                                            </span>
                                                            <span className="font-medium text-sm">Variant Option</span>
                                                        </div>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8 text-destructive"
                                                            onClick={() => {
                                                                if (variants.length > 1) {
                                                                    const next = [...variants];
                                                                    next.splice(index, 1);
                                                                    setVariants(next);
                                                                } else {
                                                                    toast.error("কমপক্ষে 1টি option থাকতে হবে");
                                                                }
                                                            }}
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                    </div>

                                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                                        <div className="space-y-2">
                                                            <Label className="text-xs text-muted-foreground">Option Name</Label>
                                                            <Input
                                                                value={variant.name}
                                                                className="h-8 bg-black/40"
                                                                placeholder="যেমন: Small / Red / Design 1"
                                                                onChange={(e) => {
                                                                    const next = [...variants];
                                                                    next[index].name = e.target.value;
                                                                    setVariants(next);
                                                                }}
                                                            />
                                                        </div>
                                                        <div className="space-y-2">
                                                            <Label className="text-xs text-muted-foreground">Price</Label>
                                                            <Input
                                                                type="number"
                                                                value={variant.price}
                                                                className="h-8 bg-black/40"
                                                                placeholder="0"
                                                                onChange={(e) => {
                                                                    const next = [...variants];
                                                                    next[index].price = e.target.value;
                                                                    setVariants(next);
                                                                }}
                                                            />
                                                        </div>
                                                        <div className="space-y-2">
                                                            <Label className="text-xs text-muted-foreground">Currency</Label>
                                                            <Input
                                                                value={variant.currency}
                                                                className="h-8 bg-black/40"
                                                                onChange={(e) => {
                                                                    const next = [...variants];
                                                                    next[index].currency = e.target.value.toUpperCase();
                                                                    setVariants(next);
                                                                }}
                                                            />
                                                        </div>
                                                        <div className="space-y-2">
                                                            <Label className="text-xs text-muted-foreground">Available</Label>
                                                            <div className="h-8 flex items-center">
                                                                <Switch
                                                                    checked={variant.available}
                                                                    onCheckedChange={(checked) => {
                                                                        const next = [...variants];
                                                                        next[index].available = checked;
                                                                        setVariants(next);
                                                                    }}
                                                                    className="data-[state=checked]:bg-[#00ff88]"
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {productMode === "sku-matrix" && (
                                <div className="space-y-4">
                                    {(() => {
                                        const expectedCount = countSkuCombinations(attributeSchema);
                                        const generatedCount = skuMatrix.length;
                                        const hasPendingGeneration = expectedCount > 0 && generatedCount < expectedCount;
                                        return (
                                            <div className={cn(
                                                "rounded-xl border p-3 text-xs",
                                                hasPendingGeneration ? "border-amber-500/30 bg-amber-500/10 text-amber-100" : "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
                                            )}>
                                                <div>Expected combinations: {expectedCount || 0}</div>
                                                <div>Generated combinations: {generatedCount}</div>
                                                <div>
                                                    {hasPendingGeneration
                                                        ? "Attribute update hoyeche. Missing generated SKU gulo niche auto sync hoye jawar kotha, na hole Generate / Merge button e click korun."
                                                        : generatedCount > expectedCount
                                                            ? "Generated row gulo ache, sathe extra manual/custom SKU row o ache."
                                                            : "Current SKU list attribute schema-r sathe sync ache."}
                                                </div>
                                            </div>
                                        );
                                    })()}
                                    <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-4">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <Label className="text-sm font-medium">Attributes</Label>
                                                <p className="text-[10px] text-muted-foreground mt-1">
                                                    Example: Design, Color, Size, Item Count. Values comma, new line, semicolon ba pipe diye alada korte parben.
                                                </p>
                                            </div>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setAttributeSchema((prev) => [...prev, { name: `attribute_${prev.length + 1}`, label: `Attribute ${prev.length + 1}`, values: [] }])}
                                            >
                                                <Plus className="w-3 h-3 mr-1" />
                                                Add Attribute
                                            </Button>
                                        </div>

                                        <div className="space-y-3">
                                            {attributeSchema.map((attribute, index) => (
                                                <div key={`attr-${index}`} className="grid grid-cols-1 md:grid-cols-[1fr_2fr_auto] gap-3 items-end">
                                                    <div className="space-y-2">
                                                        <Label className="text-xs text-muted-foreground">Attribute Label</Label>
                                                        <Input
                                                            value={attribute.label}
                                                            className="bg-black/40"
                                                            placeholder="Design / Color / Size"
                                                            onChange={(e) => {
                                                                const next = [...attributeSchema];
                                                                const label = e.target.value;
                                                                next[index] = {
                                                                    ...next[index],
                                                                    label,
                                                                    name: normalizeAttributeName(label || next[index].name, index)
                                                                };
                                                                setAttributeSchema(next);
                                                            }}
                                                        />
                                                    </div>
                                                    <div className="space-y-2">
                                                        <Label className="text-xs text-muted-foreground">Values</Label>
                                                        <Input
                                                            value={(attribute.values || []).join(", ")}
                                                            className="bg-black/40"
                                                            placeholder="Red, Black, White"
                                                            onChange={(e) => {
                                                                const next = [...attributeSchema];
                                                                next[index] = {
                                                                    ...next[index],
                                                                    values: splitAttributeValues(e.target.value)
                                                                };
                                                                setAttributeSchema(next);
                                                            }}
                                                        />
                                                    </div>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-10 w-10 text-destructive"
                                                        onClick={() => {
                                                            const next = attributeSchema.filter((_, i) => i !== index);
                                                            const normalizedNext = normalizeAttributeSchemaValue(next);
                                                            setAttributeSchema(normalizedNext);
                                                            setSkuMatrix((current) => buildSkuMatrixFromSchema(normalizedNext, current));
                                                        }}
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                </div>
                                            ))}
                                        </div>

                                        <div className="flex flex-wrap gap-2">
                                            <Button
                                                type="button"
                                                variant="outline"
                                                onClick={() => syncSkuMatrixFromSchema(attributeSchema)}
                                            >
                                                Generate / Merge SKU Combinations
                                            </Button>
                                            <span className="text-[10px] text-muted-foreground self-center">
                                                Current sellable row count: {skuMatrix.length}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <Label className="text-sm font-medium">Sellable SKU List</Label>
                                                <p className="text-[10px] text-muted-foreground mt-1">
                                                    Customer exact combination select korle bot ei row theke price/stock answer dibe. Sheet-er moto uneven SKU list hole manual row add korun.
                                                </p>
                                            </div>
                                            <Button type="button" variant="outline" size="sm" onClick={addManualSkuRow}>
                                                <Plus className="w-3 h-3 mr-1" />
                                                Add SKU Row
                                            </Button>
                                        </div>

                                        {skuMatrix.length === 0 ? (
                                            <div className="rounded-xl border border-dashed border-white/10 p-4 text-xs text-muted-foreground">
                                                Ekhono kono sellable SKU row nai. Attribute value dile auto row ashbe, na hole `Add SKU Row` diye manual row add korun.
                                            </div>
                                        ) : (
                                            <div className="space-y-3">
                                                {skuMatrix.map((sku, index) => (
                                                    <Card key={sku.key || `${sku.sku_code}-${index}`} className="border border-white/10 bg-black/30">
                                                        <CardContent className="p-4 space-y-4">
                                                            <div className="flex items-center justify-between">
                                                                <div>
                                                                    <div className="font-medium text-sm">{sku.name || `SKU ${index + 1}`}</div>
                                                                    <div className="text-[10px] text-muted-foreground">
                                                                        {Object.entries(sku.attributes || {}).length > 0
                                                                            ? Object.entries(sku.attributes || {}).map(([key, value]) => `${formatAttributeLabel(key)}: ${value}`).join(" | ")
                                                                            : "Attribute value set korun"}
                                                                    </div>
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <div className="text-xs text-muted-foreground">{sku.sku_code}</div>
                                                                    <Button
                                                                        type="button"
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        className="h-8 w-8 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                                                        onClick={() => {
                                                                            setSkuMatrix((current) => current.filter((_, skuIndex) => skuIndex !== index));
                                                                        }}
                                                                    >
                                                                        <Trash2 className="w-4 h-4" />
                                                                    </Button>
                                                                </div>
                                                            </div>

                                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                                <div className="space-y-2">
                                                                    <Label className="text-xs text-muted-foreground">SKU Name</Label>
                                                                    <Input
                                                                        value={sku.name}
                                                                        className="bg-black/40"
                                                                        onChange={(e) => {
                                                                            const next = [...skuMatrix];
                                                                            next[index] = { ...next[index], name: e.target.value };
                                                                            setSkuMatrix(next);
                                                                        }}
                                                                    />
                                                                </div>
                                                                <div className="space-y-2">
                                                                    <Label className="text-xs text-muted-foreground">SKU Code</Label>
                                                                    <Input
                                                                        value={sku.sku_code}
                                                                        className="bg-black/40"
                                                                        onChange={(e) => {
                                                                            const next = [...skuMatrix];
                                                                            next[index] = { ...next[index], sku_code: e.target.value.toUpperCase() };
                                                                            setSkuMatrix(next);
                                                                        }}
                                                                    />
                                                                </div>
                                                            </div>

                                                            {attributeSchema.length > 0 && (
                                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                                    {normalizeAttributeSchemaValue(attributeSchema).map((attribute) => (
                                                                        <div key={`${sku.key || index}-${attribute.name}`} className="space-y-2">
                                                                            <Label className="text-xs text-muted-foreground">{attribute.label}</Label>
                                                                            <Input
                                                                                value={sku.attributes?.[attribute.name] || ""}
                                                                                className="bg-black/40"
                                                                                placeholder={(attribute.values || []).join(", ") || attribute.label}
                                                                                onChange={(e) => {
                                                                                    const next = [...skuMatrix];
                                                                                    const nextAttributes = {
                                                                                        ...(sku.attributes || {}),
                                                                                        [attribute.name]: e.target.value
                                                                                    };
                                                                                    next[index] = createSkuRecord(nextAttributes, index, sku);
                                                                                    setSkuMatrix(next);
                                                                                }}
                                                                            />
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}

                                                            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                                                <div className="space-y-2">
                                                                    <Label className="text-xs text-muted-foreground">Price</Label>
                                                                    <Input
                                                                        type="number"
                                                                        value={sku.price}
                                                                        className="bg-black/40"
                                                                        onChange={(e) => {
                                                                            const next = [...skuMatrix];
                                                                            next[index] = { ...next[index], price: Number(e.target.value || 0) };
                                                                            setSkuMatrix(next);
                                                                        }}
                                                                    />
                                                                </div>
                                                                <div className="space-y-2">
                                                                    <Label className="text-xs text-muted-foreground">Stock</Label>
                                                                    <Input
                                                                        type="number"
                                                                        value={sku.stock}
                                                                        className="bg-black/40"
                                                                        onChange={(e) => {
                                                                            const next = [...skuMatrix];
                                                                            next[index] = { ...next[index], stock: Number(e.target.value || 0) };
                                                                            setSkuMatrix(next);
                                                                        }}
                                                                    />
                                                                </div>
                                                                <div className="space-y-2">
                                                                    <Label className="text-xs text-muted-foreground">Currency</Label>
                                                                    <Input
                                                                        value={sku.currency}
                                                                        className="bg-black/40"
                                                                        onChange={(e) => {
                                                                            const next = [...skuMatrix];
                                                                            next[index] = { ...next[index], currency: e.target.value.toUpperCase() };
                                                                            setSkuMatrix(next);
                                                                        }}
                                                                    />
                                                                </div>
                                                                <div className="space-y-2">
                                                                    <Label className="text-xs text-muted-foreground">Available</Label>
                                                                    <div className="h-10 flex items-center">
                                                                        <Switch
                                                                            checked={sku.available}
                                                                            onCheckedChange={(checked) => {
                                                                                const next = [...skuMatrix];
                                                                                next[index] = { ...next[index], available: checked };
                                                                                setSkuMatrix(next);
                                                                            }}
                                                                            className="data-[state=checked]:bg-[#00ff88]"
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </CardContent>
                                                    </Card>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        

                        <DialogFooter>
                            <Button variant="outline" className="border-white/20 rounded-md" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                            <Button onClick={handleSubmit} disabled={isSubmitting} className="bg-[#00ff88] text-black font-bold rounded-md hover:bg-[#00f07f] shadow-[0_10px_30px_rgba(0,255,136,0.25)]">
                                {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin text-black" />}
                                Save
                                <span className="ml-2 inline-flex">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 fill-black" viewBox="0 0 24 24"><path d="M12 4l1.41 1.41L8.83 10H20v2H8.83l4.58 4.59L12 18l-8-8 8-8z"/></svg>
                                </span>
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
                </div>
            </div>

            {/* Product Table */}
            <div className="border rounded-md">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[80px]">Image</TableHead>
                            <TableHead>Product Name</TableHead>
                            <TableHead className="hidden md:table-cell">Description</TableHead>
                            <TableHead className="hidden md:table-cell">Desc</TableHead>
                                <TableHead className="hidden md:table-cell">Active</TableHead>
                            <TableHead>Price</TableHead>
                            <TableHead>Stock</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {products.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                                    No products found. Add your first product or import from WooCommerce.
                                </TableCell>
                            </TableRow>
                        ) : (
                            products.map((product) => (
                                <TableRow key={product.id} className="group hover:bg-muted/50">
                                    <TableCell>
                                        <div className="h-12 w-12 rounded-md bg-muted/20 overflow-hidden flex items-center justify-center border">
                                            {product.image_url ? (
                                                <img 
                                                    src={product.image_url} 
                                                    alt={product.name} 
                                                    className="w-full h-full object-cover"
                                                    loading="lazy"
                                                    onError={(e) => {
                                                        (e.target as HTMLImageElement).src = "https://placehold.co/100?text=No+Image";
                                                        (e.target as HTMLImageElement).onerror = null; // Prevent infinite loop
                                                    }}
                                                />
                                            ) : product.video_url ? (
                                                <video
                                                    src={product.video_url}
                                                    className="w-full h-full object-cover"
                                                    muted
                                                    playsInline
                                                />
                                            ) : (
                                                <Package className="h-6 w-6 opacity-20" />
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell className="font-medium">
                                        <div className="flex flex-col gap-1">
                                            <span>{product.name}</span>
                                            <div className="flex flex-wrap gap-1">
                                                {product.video_url ? (
                                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                                                        Video
                                                    </span>
                                                ) : null}
                                                {(() => {
                                                    const messengerIds = parseAssignment(product.allowed_messenger_ids);
                                                    if (messengerIds.length > 0) {
                                                        return (
                                                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                                                                FB
                                                            </span>
                                                        );
                                                    }
                                                    return null;
                                                })()}
                                                {(() => {
                                                    const waSessions = parseAssignment(product.allowed_wa_sessions);
                                                    if (waSessions.length > 0) {
                                                        return (
                                                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                                                                WA
                                                            </span>
                                                        );
                                                    }
                                                    return null;
                                                })()}
                                            </div>
                                            {product.variants && product.variants.length > 0 && (
                                                <span className="text-[10px] text-muted-foreground">
                                                    {product.variants.length} variants
                                                </span>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell className="hidden md:table-cell max-w-[300px]">
                                        <p className="truncate text-muted-foreground text-sm">
                                            {product.description || '-'}
                                        </p>
                                    </TableCell>
                                    <TableCell className="hidden md:table-cell">
                                        <Switch
                                            checked={product.allow_description === true}
                                            onCheckedChange={(v) => handleToggleDescription(product, v)}
                                            className="data-[state=checked]:bg-[#00ff88]"
                                        />
                                    </TableCell>
                                    <TableCell className="hidden md:table-cell">
                                        <Switch
                                            checked={product.is_active === true}
                                            onCheckedChange={(v) => handleToggleActive(product, v)}
                                            className="data-[state=checked]:bg-[#00ff88]"
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <div className="font-medium">
                                            {product.currency || 'BDT'} {product.price || 0}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${product.stock && product.stock > 0 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                                            {product.stock || 0}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleEdit(product)}>
                                                <Edit className="w-4 h-4" />
                                            </Button>
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-8 w-8 text-destructive hover:text-destructive"
                                                onClick={() => {
                                                    setPendingDeleteProduct(product);
                                                    setIsDeleteDialogOpen(true);
                                                }}
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

            <Dialog
                open={isDeleteDialogOpen}
                onOpenChange={(open) => {
                    setIsDeleteDialogOpen(open);
                    if (!open) {
                        setPendingDeleteProduct(null);
                    }
                }}
            >
                <DialogContent className="max-w-sm bg-[#0f0f0f]/90 border border-white/10 backdrop-blur-md rounded-2xl">
                    <DialogHeader>
                        <DialogTitle>Delete product</DialogTitle>
                        <DialogDescription>
                            {pendingDeleteProduct
                                ? `Are you sure you want to delete "${pendingDeleteProduct.name}"? This action cannot be undone.`
                                : "Are you sure you want to delete this product?"}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            className="border-white/20 rounded-md"
                            onClick={() => {
                                setIsDeleteDialogOpen(false);
                                setPendingDeleteProduct(null);
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            variant="destructive"
                            className="rounded-md"
                            onClick={async () => {
                                if (!pendingDeleteProduct) return;
                                await handleDelete(pendingDeleteProduct.id);
                                setIsDeleteDialogOpen(false);
                                setPendingDeleteProduct(null);
                            }}
                            disabled={isSubmitting}
                        >
                            Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
