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
import { Lock, Plus, Trash2, Package, Search, Image as ImageIcon, Loader2, ShoppingBag, Download, Edit, X, Check, Save } from "lucide-react";
import { BACKEND_URL } from "@/config";
import { cn } from "@/lib/utils";

// Types
interface Variant {
    name: string;
    price: string;
    currency: string;
    available: boolean;
}

interface Product {
    id: number;
    name: string;
    description: string;
    keywords?: string;
    image_url: string | null;
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
}

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
    const [productImages, setProductImages] = useState<File[]>([]);
    const [imagePreviews, setImagePreviews] = useState<string[]>([]);
    const [existingAdditionalImages, setExistingAdditionalImages] = useState<string[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const openImagePicker = () => {
        if (fileInputRef.current) {
            try { (fileInputRef.current as any).value = null; } catch {}
            fileInputRef.current.click();
        }
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
    const handleSelectAllPages = () => {
        const newFbIds = filteredPages.filter(p => p.type === 'messenger').map(p => normalizeId(p.page_id));
        const newWaIds = filteredPages.filter(p => p.type === 'whatsapp').map(p => normalizeId(p.page_id));
        setSelectedFB(prev => {
            const next = new Set(Array.from(prev));
            newFbIds.forEach(id => next.add(id));
            return next;
        });
        setSelectedWA(prev => {
            const next = new Set(Array.from(prev));
            newWaIds.forEach(id => next.add(id));
            return next;
        });
        if (editProductId) {
            persistAssignments();
        }
    };

    const handleDeselectAllPages = () => {
        const fbIdsToRemove = filteredPages.filter(p => p.type === 'messenger').map(p => normalizeId(p.page_id));
        const waIdsToRemove = filteredPages.filter(p => p.type === 'whatsapp').map(p => normalizeId(p.page_id));
        setSelectedFB(prev => {
            const next = new Set(Array.from(prev));
            fbIdsToRemove.forEach(id => next.delete(id));
            return next;
        });
        setSelectedWA(prev => {
            const next = new Set(Array.from(prev));
            waIdsToRemove.forEach(id => next.delete(id));
            return next;
        });
        if (editProductId) {
            persistAssignments();
        }
    };

    const [isCombo, setIsCombo] = useState(false);
    const [comboItems, setComboItems] = useState<string[]>([]);
    const [comboItemInput, setComboItemInput] = useState("");
    const [allowDescription, setAllowDescription] = useState(false);

    const [variants, setVariants] = useState<Variant[]>([
        { name: "Default", price: "0", currency: "BDT", available: true }
    ]);
    const [showVariants, setShowVariants] = useState(false);
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

    const persistAssignments = async () => {
        if (!userId || !editProductId) return;
        try {
            setIsSubmitting(true);
            const token = localStorage.getItem("auth_token");
            const params = new URLSearchParams();
            params.set("user_id", userId);
            const formData = new FormData();
            formData.append("allowed_messenger_ids", JSON.stringify(Array.from(selectedFB)));
            formData.append("allowed_wa_sessions", JSON.stringify(Array.from(selectedWA)));
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
            setDebugLogText(prev => `${prev}\n[Client] ASSIGNMENTS_UPDATED fb=${JSON.stringify(Array.from(selectedFB))} wa=${JSON.stringify(Array.from(selectedWA))}`);
            const refreshToken = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
            fetchProducts(userId, searchQuery, refreshToken || undefined);
        } catch (error) {
            toast.error("Error updating assignments");
            recordError("PUT /api/products assignments", String(error));
        } finally {
            setIsSubmitting(false);
        }
    };

    const getTeamOwnerForContext = () => {
        if (typeof window === "undefined") return null;
        const teamOwner = localStorage.getItem("active_team_owner");

        // Safety: If I am the team owner, I don't need to send the param
        try {
            const user = JSON.parse(localStorage.getItem("auth_user") || "{}");
            if (user.email && teamOwner === user.email) return null;
        } catch (e) {
            
        }

        const activeWa = localStorage.getItem("active_wa_session_id");
        const activeFb = localStorage.getItem("active_fb_page_id");

        if (pageId && activeWa && pageId === activeWa) {
            const mode = localStorage.getItem("whatsapp_view_mode");
            if (mode === "team") return teamOwner;
            return null;
        }

        if (pageId && activeFb && pageId === activeFb) {
            const mode = localStorage.getItem("messenger_view_mode");
            if (mode === "team") return teamOwner;
            return null;
        }

        return teamOwner || null;
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

            let resolvedPageId: string | null = explicitPageId !== undefined ? explicitPageId : pageId;
            let teamOwner: string | null = null;
            
            if (typeof window !== "undefined") {
                if (resolvedPageId === null) {
                    resolvedPageId = getInitialPageId();
                }
                
                setPageId(resolvedPageId);
                teamOwner = getTeamOwnerForContext();
                if (teamOwner) params.set("team_owner", teamOwner);
            }

            if (!resolvedPageId) {
                setProducts([]);
                return;
            }

            if (resolvedPageId) {
                params.set("page_id", resolvedPageId);
            }

            const url = `${BACKEND_URL}/api/products?${params.toString()}`;

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
            
            // Limit to 10 total images
            const maxNew = 10 - imagePreviews.length;
            if (maxNew <= 0) return;
            const limited = incoming.slice(0, maxNew);
            
            const newProductImages = [...productImages, ...limited];
            setProductImages(newProductImages);
            
            const newFilePreviews = limited.map(f => URL.createObjectURL(f));
            setImagePreviews(prev => [...prev, ...newFilePreviews]);
            
            // Update primary image if none existed
            if (!imagePreview && newFilePreviews.length > 0) {
                setImagePreview(newFilePreviews[0]);
                setProductImage(limited[0]);
            }
        }
    };

    const removeImageAt = (index: number) => {
        const previewToRemove = imagePreviews[index];
        
        // 1. Update Previews
        const newPreviews = imagePreviews.filter((_, i) => i !== index);
        setImagePreviews(newPreviews);
        
        // 2. If it was a new file, remove from productImages
        if (previewToRemove?.startsWith('blob:')) {
            const existingCount = imagePreviews.length - productImages.length;
            const fileIndex = index - existingCount;
            if (fileIndex >= 0) {
                const newFiles = productImages.filter((_, i) => i !== fileIndex);
                setProductImages(newFiles);
                if (previewToRemove === imagePreview) {
                    setImagePreview(newPreviews[0] || null);
                    setProductImage(newFiles[0] || null);
                }
            }
        } else {
            // 3. If it was an existing URL
            if (previewToRemove === imagePreview) {
                setImagePreview(newPreviews[0] || null);
            }
            const newExisting = existingAdditionalImages.filter(url => url !== previewToRemove);
            setExistingAdditionalImages(newExisting);
        }
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
        
        if (product.variants && product.variants.length > 0) {
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
            let currentContextId: string | null = null;
            if (typeof window !== "undefined") {
                currentContextId = getInitialPageId();
            }

            const teamOwner = getTeamOwnerForContext();
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
                variants: showVariants ? variants : [{
                    name: "Standard",
                    price: productPrice,
                    currency: productCurrency,
                    available: parseInt(productStock) > 0
                }]
            };

            // 1. Append metadata as a single JSON string
            formData.append("metadata", JSON.stringify(metadata));

            // 2. Append individual fields for backward compatibility
            // IMPORTANT: Sending as STRINGIFIED ARRAYS to avoid Multer array parsing issues
            formData.append("user_id", metadata.user_id);
            formData.append("name", metadata.name);
            formData.append("description", metadata.description);
            formData.append("allowed_messenger_ids", JSON.stringify(finalMessengerIds));
            formData.append("allowed_wa_sessions", JSON.stringify(finalWASessions));
            formData.append("variants", JSON.stringify(metadata.variants));
            formData.append("page_id", String(metadata.page_id || ""));
            formData.append("existing_additional_images", JSON.stringify(existingAdditionalImages));

            // --- FILES LAST (Best practice for Multer) ---
            if (productImage) {
                formData.append("image", productImage);
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
            const teamOwner = getTeamOwnerForContext();
            const currentId = typeof window !== "undefined" ? getInitialPageId() : null;
            const currentType = (() => {
                if (typeof window === "undefined") return null;
                const wa = localStorage.getItem("active_wa_session_id");
                const fb = localStorage.getItem("active_fb_page_id");
                if (currentId && wa && currentId === wa) return "whatsapp";
                if (currentId && fb && currentId === fb) return "messenger";
                return null;
            })();
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
            const formData = new FormData();
            formData.append("allow_description", String(enabled));

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
            const formData = new FormData();
            formData.append("is_active", String(enabled));

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
                        Manage products for your agents. Images are auto-optimized.
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
                            <Button onClick={resetForm} className="w-full sm:w-auto bg-[#00ff88] text-black font-black rounded-xl hover:bg-[#00f07f] shadow-[0_10px_30px_rgba(0,255,136,0.2)] transition-all hover:-translate-y-0.5 active:translate-y-0">
                                <Plus className="w-5 h-5 mr-2" />
                                Add New Product
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-5xl max-h-[95vh] overflow-hidden flex flex-col bg-[#0a0a0a] border border-white/10 backdrop-blur-2xl rounded-[3rem] p-0 shadow-[0_0_100px_rgba(0,0,0,0.8)]">
                            <DialogHeader className="p-10 pb-6 bg-gradient-to-b from-white/[0.04] to-transparent relative overflow-hidden">
                                {/* Abstract Background Decor */}
                                <div className="absolute top-0 right-0 w-64 h-64 bg-[#00ff88]/5 blur-[100px] rounded-full -mr-32 -mt-32" />
                                
                                <div className="flex items-center gap-6 relative z-10">
                                    <div className="h-16 w-16 rounded-[1.5rem] bg-gradient-to-br from-[#00ff88]/20 to-[#00ff88]/5 flex items-center justify-center border border-[#00ff88]/20 shadow-[0_0_30px_rgba(0,255,136,0.1)]">
                                        <Package className="h-8 w-8 text-[#00ff88]" />
                                    </div>
                                    <div>
                                        <DialogTitle className="text-3xl font-black text-white tracking-tight uppercase">{editProductId ? 'Refine Product' : 'Onboard Product'}</DialogTitle>
                                        <DialogDescription className="text-gray-400 font-bold text-sm mt-1 uppercase tracking-widest opacity-60">
                                            {editProductId ? 'Update your catalog parameters' : 'Register a new asset to your ecosystem'}
                                        </DialogDescription>
                                    </div>
                                </div>
                            </DialogHeader>
                            
                            <div className="flex-1 overflow-y-auto p-10 pt-2 custom-scrollbar">
                                <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-12">
                                    {/* Left Sidebar: Media & Vital Status */}
                                    <div className="space-y-10">
                                        <div className="space-y-5">
                                            <div className="flex items-center justify-between">
                                                <Label className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground/40">Visual Assets</Label>
                                                <span className="text-[9px] font-black text-[#00ff88] bg-[#00ff88]/5 px-2 py-0.5 rounded-full border border-[#00ff88]/10 uppercase">High Fidelity</span>
                                            </div>
                                            
                                            <div 
                                                className="aspect-square w-full border-2 border-dashed border-white/10 rounded-[2.5rem] flex flex-col items-center justify-center cursor-pointer hover:border-[#00ff88]/40 hover:bg-[#00ff88]/5 transition-all duration-500 group relative overflow-hidden bg-black/40 shadow-inner"
                                                onClick={openImagePicker}
                                            >
                                                {imagePreview ? (
                                                    <>
                                                        <img src={imagePreview} alt="Preview" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />
                                                        <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-500 backdrop-blur-sm">
                                                            <div className="h-14 w-14 rounded-full bg-[#00ff88]/20 flex items-center justify-center border border-[#00ff88]/40 mb-3 scale-75 group-hover:scale-100 transition-transform duration-500">
                                                                <ImageIcon className="text-[#00ff88] w-6 h-6" />
                                                            </div>
                                                            <span className="text-[10px] font-black text-white uppercase tracking-[0.2em]">Replace Media</span>
                                                        </div>
                                                    </>
                                                ) : (
                                                    <div className="text-center p-8 space-y-4">
                                                        <div className="h-20 w-20 rounded-[1.5rem] bg-white/[0.03] flex items-center justify-center mx-auto group-hover:scale-110 group-hover:bg-[#00ff88]/10 transition-all duration-500 border border-white/5 group-hover:border-[#00ff88]/20">
                                                            <ImageIcon className="w-10 h-10 text-gray-600 group-hover:text-[#00ff88] transition-colors" />
                                                        </div>
                                                        <div className="space-y-1.5">
                                                            <p className="text-sm font-black text-gray-300 uppercase tracking-widest">Upload</p>
                                                            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-tighter opacity-60">Studio Quality Only</p>
                                                        </div>
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
                                            
                                            {imagePreviews.length > 1 && (
                                                <div className="grid grid-cols-4 gap-3">
                                                    {imagePreviews.slice(1).map((src, idx) => (
                                                        <div key={idx} className="relative aspect-square rounded-2xl overflow-hidden border border-white/5 group shadow-lg">
                                                            <img src={src} alt="" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
                                                            <button 
                                                                onClick={(e) => { e.stopPropagation(); removeImageAt(idx + 1); }}
                                                                className="absolute inset-0 bg-red-500/80 opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center backdrop-blur-[2px]"
                                                            >
                                                                <X className="w-5 h-5 text-white" />
                                                            </button>
                                                        </div>
                                                    ))}
                                                    {imagePreviews.length < 11 && (
                                                        <button 
                                                            onClick={openImagePicker}
                                                            className="aspect-square rounded-2xl border-2 border-dashed border-white/5 flex items-center justify-center hover:bg-white/5 hover:border-white/20 transition-all"
                                                        >
                                                            <Plus className="w-5 h-5 text-gray-600" />
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>

                                        <div className="space-y-6 pt-6 border-t border-white/5">
                                            <Label className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground/40">Operational Status</Label>
                                            <div className="space-y-3">
                                                <div className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-all group">
                                                    <div className="space-y-1">
                                                        <Label className="text-[11px] font-black text-gray-300 uppercase tracking-widest">Discovery</Label>
                                                        <p className="text-[9px] text-gray-500 font-bold uppercase tracking-tighter">Live in system</p>
                                                    </div>
                                                    <Switch checked={true} disabled className="data-[state=checked]:bg-[#00ff88] scale-90 opacity-40" />
                                                </div>
                                                <div className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-all group">
                                                    <div className="space-y-1">
                                                        <Label className="text-[11px] font-black text-gray-300 uppercase tracking-widest">Chat Context</Label>
                                                        <p className="text-[9px] text-gray-500 font-bold uppercase tracking-tighter">AI Knowledge Base</p>
                                                    </div>
                                                    <Switch checked={allowDescription} onCheckedChange={setAllowDescription} className="data-[state=checked]:bg-[#00ff88] scale-90" />
                                                </div>
                                                <div className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-all group">
                                                    <div className="space-y-1">
                                                        <Label className="text-[11px] font-black text-gray-300 uppercase tracking-widest">Multi-Bundle</Label>
                                                        <p className="text-[9px] text-gray-500 font-bold uppercase tracking-tighter">Combo Architecture</p>
                                                    </div>
                                                    <Switch checked={isCombo} onCheckedChange={setIsCombo} className="data-[state=checked]:bg-purple-500 scale-90" />
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Right Side: Primary Configuration */}
                                    <div className="space-y-10">
                                        {/* Identity Section */}
                                        <div className="grid gap-8">
                                            <div className="space-y-6">
                                                <div className="flex items-center gap-4">
                                                    <div className="h-1px flex-1 bg-gradient-to-r from-white/10 to-transparent" />
                                                    <Label className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground/40 shrink-0">Product Intelligence</Label>
                                                </div>
                                                
                                                <div className="grid gap-6">
                                                    <div className="space-y-3">
                                                        <div className="flex justify-between items-end">
                                                            <Label htmlFor="title" className="text-[11px] font-black text-gray-400 uppercase tracking-[0.1em]">Commercial Title *</Label>
                                                            <span className="text-[9px] text-gray-600 font-bold">REQUIRED</span>
                                                        </div>
                                                        <Input 
                                                            id="title" 
                                                            placeholder="ENTER PREMIUM PRODUCT NAME..." 
                                                            className="h-14 bg-white/[0.02] border-white/10 focus:border-[#00ff88]/40 rounded-2xl font-black text-lg uppercase tracking-tight px-6 placeholder:text-white/10"
                                                            value={productName}
                                                            onChange={(e) => setProductName(e.target.value)}
                                                        />
                                                    </div>
                                                    <div className="space-y-3">
                                                        <Label htmlFor="desc" className="text-[11px] font-black text-gray-400 uppercase tracking-[0.1em]">Value Proposition</Label>
                                                        <Textarea 
                                                            id="desc" 
                                                            placeholder="ARTICULATE THE UNIQUE SELLING POINTS..." 
                                                            className="min-h-[160px] bg-white/[0.02] border-white/10 focus:border-[#00ff88]/40 rounded-2xl py-6 px-6 font-bold text-sm leading-relaxed resize-none placeholder:text-white/10"
                                                            value={productDesc}
                                                            onChange={(e) => setProductDesc(e.target.value)}
                                                        />
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Financials Row */}
                                            <div className="space-y-6">
                                                <div className="flex items-center gap-4">
                                                    <div className="h-1px flex-1 bg-gradient-to-r from-white/10 to-transparent" />
                                                    <Label className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground/40 shrink-0">Inventory & Logistics</Label>
                                                </div>
                                                
                                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                                                    <div className="space-y-3">
                                                        <Label className="text-[11px] font-black text-gray-400 uppercase tracking-[0.1em]">Unit Price *</Label>
                                                        <div className="relative group">
                                                            <Input 
                                                                type="number" 
                                                                className="h-14 pl-6 bg-white/[0.02] border-white/10 focus:border-[#00ff88]/40 rounded-2xl font-black text-2xl text-[#00ff88] transition-all"
                                                                value={productPrice}
                                                                onChange={(e) => setProductPrice(e.target.value)}
                                                            />
                                                            <div className="absolute right-6 top-1/2 -translate-y-1/2 text-[10px] font-black text-white/20 group-focus-within:text-[#00ff88]/40 transition-colors uppercase">Amount</div>
                                                        </div>
                                                    </div>
                                                    <div className="space-y-3">
                                                        <Label className="text-[11px] font-black text-gray-400 uppercase tracking-[0.1em]">Currency ISO *</Label>
                                                        <Select value={productCurrency} onValueChange={setProductCurrency}>
                                                            <SelectTrigger className="h-14 bg-white/[0.02] border-white/10 focus:border-[#00ff88]/40 rounded-2xl font-black text-lg">
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent className="bg-[#0f0f0f] border-white/10 rounded-2xl p-2 backdrop-blur-xl">
                                                                {["USD", "BDT", "EUR", "GBP", "INR", "PKR", "AED", "SAR"].map(c => (
                                                                    <SelectItem key={c} value={c} className="font-black py-3 rounded-xl focus:bg-[#00ff88]/10 focus:text-[#00ff88] transition-all">{c}</SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                    <div className="space-y-3">
                                                        <Label className="text-[11px] font-black text-gray-400 uppercase tracking-[0.1em]">Stock Count *</Label>
                                                        <Input 
                                                            type="number" 
                                                            className="h-14 bg-white/[0.02] border-white/10 focus:border-[#00ff88]/40 rounded-2xl font-black text-2xl px-6"
                                                            value={productStock}
                                                            onChange={(e) => setProductStock(e.target.value)}
                                                        />
                                                    </div>
                                                </div>
                                            </div>

                                            {/* AI Tags Section */}
                                            <div className="space-y-6">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-4 flex-1">
                                                        <div className="h-1px flex-1 bg-gradient-to-r from-white/10 to-transparent" />
                                                        <Label className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground/40 shrink-0">Neural Tagging</Label>
                                                    </div>
                                                    <div className="ml-4 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20">
                                                        <span className="text-[9px] font-black text-blue-400 uppercase tracking-widest">Enhanced AI Detection</span>
                                                    </div>
                                                </div>
                                                
                                                <div className="space-y-4">
                                                    <div className="flex flex-wrap gap-3 min-h-[70px] p-4 rounded-3xl border border-white/10 bg-black/40 shadow-inner group-focus-within:border-blue-500/30 transition-all">
                                                        {productKeywords.map((k, idx) => (
                                                            <div key={idx} className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-[11px] font-black text-blue-400 transition-all hover:bg-blue-500/20 hover:scale-105">
                                                                <span>{k}</span>
                                                                <button onClick={() => removeKeywordAt(idx)} className="text-blue-500/40 hover:text-blue-500 transition-colors">
                                                                    <X className="w-4 h-4" />
                                                                </button>
                                                            </div>
                                                        ))}
                                                        <input
                                                            value={keywordInput}
                                                            onChange={handleKeywordInputChange}
                                                            onKeyDown={handleKeywordKeyDown}
                                                            className="flex-1 min-w-[200px] bg-transparent outline-none border-none text-sm text-white placeholder:text-gray-600 font-bold uppercase tracking-widest"
                                                            placeholder="Input neural tags (e.g. LUXURY, SILK)..."
                                                        />
                                                    </div>
                                                    <p className="text-[10px] text-gray-600 font-bold uppercase tracking-widest px-2 italic">Add semantic keywords to optimize AI identification in visual and textual contexts.</p>
                                                </div>
                                            </div>

                                            {/* Combo Architecture - Conditional */}
                                            {isCombo && (
                                                <div className="space-y-6 p-8 rounded-[2.5rem] bg-purple-500/5 border border-purple-500/10 animate-in fade-in zoom-in duration-500">
                                                    <div className="flex items-center gap-4">
                                                        <div className="h-10 w-10 rounded-2xl bg-purple-500/20 flex items-center justify-center border border-purple-500/20">
                                                            <Package className="h-5 w-5 text-purple-400" />
                                                        </div>
                                                        <Label className="text-[11px] font-black uppercase tracking-[0.2em] text-purple-400">Combo Manifest</Label>
                                                    </div>
                                                    
                                                    <div className="flex gap-4">
                                                        <Input 
                                                            placeholder="BUNDLE ITEM NAME..." 
                                                            value={comboItemInput}
                                                            onChange={(e) => setComboItemInput(e.target.value)}
                                                            className="h-14 bg-black/40 border-purple-500/20 focus:border-purple-500/50 rounded-2xl font-bold uppercase tracking-widest px-6"
                                                        />
                                                        <Button 
                                                            onClick={() => { if(comboItemInput.trim()) { setComboItems([...comboItems, comboItemInput.trim()]); setComboItemInput(""); } }} 
                                                            className="bg-purple-600 hover:bg-purple-500 text-white rounded-2xl px-10 font-black text-xs uppercase tracking-widest h-14 transition-all hover:shadow-[0_0_30px_rgba(168,85,247,0.3)]"
                                                        >
                                                            Append
                                                        </Button>
                                                    </div>
                                                    
                                                    <div className="flex flex-wrap gap-3">
                                                        {comboItems.map((item, idx) => (
                                                            <div key={idx} className="px-4 py-2 rounded-2xl bg-purple-500/10 border border-purple-500/20 text-[11px] font-black text-purple-300 flex items-center gap-3 transition-all hover:bg-purple-500/20">
                                                                {item}
                                                                <X className="w-4 h-4 cursor-pointer text-purple-500/40 hover:text-purple-500" onClick={() => setComboItems(comboItems.filter((_, i) => i !== idx))} />
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Platform Deployment */}
                                            <div className="space-y-8">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-4 flex-1">
                                                        <div className="h-1px flex-1 bg-gradient-to-r from-white/10 to-transparent" />
                                                        <Label className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground/40 shrink-0">Omnichannel Deployment</Label>
                                                    </div>
                                                    <div className="flex gap-4 ml-6">
                                                        <button onClick={handleSelectAllPages} className="text-[10px] font-black text-[#00ff88] uppercase tracking-[0.2em] hover:text-[#00ff88]/80 transition-colors">Select All</button>
                                                        <button onClick={handleDeselectAllPages} className="text-[10px] font-black text-red-400/60 uppercase tracking-[0.2em] hover:text-red-400 transition-colors">Clear</button>
                                                    </div>
                                                </div>
                                                
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                                    {/* WhatsApp Deployment */}
                                                    <div className="space-y-4 p-6 rounded-[2rem] bg-emerald-500/[0.03] border border-emerald-500/10 hover:border-emerald-500/20 transition-all">
                                                        <div className="flex items-center gap-3 mb-2">
                                                            <div className="h-8 w-8 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                                                                <svg className="w-4 h-4 text-emerald-500 fill-current" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.353-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.05-.148-.471-1.138-.645-1.556-.17-.41-.344-.354-.471-.354-.121-.002-.26-.002-.399-.002-.14 0-.366.052-.557.26-.191.208-.73.712-.73 1.735 0 1.023.746 2.01 8.49 2.11 1.3 3.476 3.009 3.047 3.476 3.009 3.476 0 .019 0 .019 0 .019.421-.012 1.27-.519 1.449-1.02.18-.5.18-.93.126-1.02-.054-.09-.202-.148-.499-.297zM12 2.03c-5.502 0-9.97 4.468-9.97 9.97 0 1.757.463 3.467 1.343 4.966L2.03 21.97l5.162-1.354c1.441.786 3.063 1.2 4.808 1.2 5.502 0 9.97-4.468 9.97-9.97 0-5.502-4.468-9.97-9.97-9.97z"/></svg>
                                                            </div>
                                                            <span className="text-[11px] font-black text-emerald-500 uppercase tracking-[0.2em]">WhatsApp</span>
                                                        </div>
                                                        <div className="space-y-3 max-h-[160px] overflow-y-auto pr-3 custom-scrollbar">
                                                            {availablePages.filter(p => p.type === 'whatsapp').map(page => (
                                                                <div key={page.page_id} className={cn(
                                                                    "flex items-center justify-between p-4 rounded-2xl border transition-all cursor-pointer group/item",
                                                                    selectedWA.has(normalizeId(page.page_id)) 
                                                                        ? "bg-emerald-500/10 border-emerald-500/30 shadow-[0_0_20px_rgba(16,185,129,0.05)]" 
                                                                        : "bg-white/[0.02] border-white/5 hover:bg-white/[0.04] opacity-40 hover:opacity-100"
                                                                )} onClick={() => {
                                                                    const key = normalizeId(page.page_id);
                                                                    setSelectedWA(prev => { const next = new Set(prev); if(next.has(key)) next.delete(key); else next.add(key); return next; });
                                                                }}>
                                                                    <span className="text-xs font-black text-gray-300 uppercase tracking-widest truncate">{page.name.replace("(WA) ", "")}</span>
                                                                    <div className={cn(
                                                                        "h-5 w-5 rounded-lg border-2 flex items-center justify-center transition-all",
                                                                        selectedWA.has(normalizeId(page.page_id)) ? "bg-emerald-500 border-emerald-500 scale-110" : "border-white/10"
                                                                    )}>
                                                                        {selectedWA.has(normalizeId(page.page_id)) && <Check className="w-3 h-3 text-black stroke-[4px]" />}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    {/* Messenger Deployment */}
                                                    <div className="space-y-4 p-6 rounded-[2rem] bg-blue-500/[0.03] border border-blue-500/10 hover:border-blue-500/20 transition-all">
                                                        <div className="flex items-center gap-3 mb-2">
                                                            <div className="h-8 w-8 rounded-xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                                                                <svg className="w-4 h-4 text-blue-500 fill-current" viewBox="0 0 24 24"><path d="M12 2C6.477 2 2 6.145 2 11.214c0 2.891 1.41 5.474 3.627 7.204V22l3.399-1.865c.935.26 1.929.403 2.974.403 5.523 0 10-4.145 10-9.214S17.523 2 12 2zm1.061 12.445l-2.551-2.722-4.978 2.722 5.474-5.811 2.619 2.722 4.91-2.722-5.474 5.811z"/></svg>
                                                            </div>
                                                            <span className="text-[11px] font-black text-blue-500 uppercase tracking-[0.2em]">Messenger</span>
                                                        </div>
                                                        <div className="space-y-3 max-h-[160px] overflow-y-auto pr-3 custom-scrollbar">
                                                            {availablePages.filter(p => p.type === 'messenger').map(page => (
                                                                <div key={page.page_id} className={cn(
                                                                    "flex items-center justify-between p-4 rounded-2xl border transition-all cursor-pointer group/item",
                                                                    selectedFB.has(normalizeId(page.page_id)) 
                                                                        ? "bg-blue-500/10 border-blue-500/30 shadow-[0_0_20px_rgba(59,130,246,0.05)]" 
                                                                        : "bg-white/[0.02] border-white/5 hover:bg-white/[0.04] opacity-40 hover:opacity-100"
                                                                )} onClick={() => {
                                                                    const key = normalizeId(page.page_id);
                                                                    setSelectedFB(prev => { const next = new Set(prev); if(next.has(key)) next.delete(key); else next.add(key); return next; });
                                                                }}>
                                                                    <span className="text-xs font-black text-gray-300 uppercase tracking-widest truncate">{page.name.replace("(FB) ", "")}</span>
                                                                    <div className={cn(
                                                                        "h-5 w-5 rounded-lg border-2 flex items-center justify-center transition-all",
                                                                        selectedFB.has(normalizeId(page.page_id)) ? "bg-blue-500 border-blue-500 scale-110" : "border-white/10"
                                                                    )}>
                                                                        {selectedFB.has(normalizeId(page.page_id)) && <Check className="w-3 h-3 text-black stroke-[4px]" />}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <DialogFooter className="p-10 bg-gradient-to-t from-white/[0.04] to-transparent border-t border-white/5 gap-6 relative z-10">
                                <Button 
                                    variant="outline" 
                                    className="border-white/10 hover:bg-white/5 rounded-2xl font-black text-xs uppercase tracking-[0.2em] h-14 px-10 transition-all active:scale-95" 
                                    onClick={() => setIsDialogOpen(false)}
                                >
                                    Abort
                                </Button>
                                <Button 
                                    onClick={handleSubmit} 
                                    disabled={isSubmitting} 
                                    className="bg-[#00ff88] text-black font-black rounded-2xl hover:bg-[#00f07f] shadow-[0_10px_40px_rgba(0,255,136,0.25)] h-14 px-12 transition-all hover:-translate-y-1 active:scale-95 text-xs uppercase tracking-[0.2em]"
                                >
                                    {isSubmitting ? (
                                        <Loader2 className="w-6 h-6 animate-spin" />
                                    ) : (
                                        <div className="flex items-center gap-3">
                                            <Save className="w-5 h-5" />
                                            <span>{editProductId ? 'Update Entity' : 'Finalize Onboarding'}</span>
                                        </div>
                                    )}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            {/* Product List - Redesigned to be Professional, Vertical (LOMBA), and Sleek */}
            <div className="space-y-4">
                {products.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-24 bg-black/40 border border-white/5 rounded-3xl backdrop-blur-sm">
                        <div className="h-20 w-20 rounded-full bg-white/5 flex items-center justify-center mb-6 border border-white/10">
                            <ShoppingBag className="h-10 w-10 text-muted-foreground/30" />
                        </div>
                        <p className="text-lg font-bold text-white/40 tracking-widest uppercase">No Records Found</p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-4">
                        {products.map((product) => (
                            <div 
                                key={product.id} 
                                className="group relative flex flex-col md:flex-row items-center gap-6 p-6 bg-[#0c0c0c] border border-white/5 hover:border-white/10 rounded-2xl transition-all duration-300 hover:shadow-[0_10px_40px_rgba(0,0,0,0.5)] overflow-hidden"
                            >
                                {/* Subtle Vertical Accent */}
                                <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#00ff88]/0 group-hover:bg-[#00ff88]/40 transition-all duration-300" />
                                
                                {/* Product Image - Compact and Professional */}
                                <div className="relative h-24 w-24 md:h-28 md:w-28 shrink-0 rounded-xl overflow-hidden border border-white/5 bg-black/40 group-hover:border-white/20 transition-all duration-300 shadow-xl">
                                    {product.image_url ? (
                                        <img
                                            src={product.image_url}
                                            alt={product.name}
                                            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                                            loading="lazy"
                                        />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center bg-white/[0.02]">
                                            <Package className="h-10 w-10 text-white/10" />
                                        </div>
                                    )}
                                    
                                    {/* Small Active Status Dot */}
                                    <div className="absolute top-2 right-2">
                                        <div className={cn(
                                            "h-2 w-2 rounded-full",
                                            product.is_active ? "bg-[#00ff88] shadow-[0_0_8px_#00ff88]" : "bg-red-500 shadow-[0_0_8px_#ef4444]"
                                        )} />
                                    </div>
                                </div>

                                {/* Product Core Information - Horizontal Flow */}
                                <div className="flex-1 flex flex-col md:flex-row items-center justify-between gap-6 w-full">
                                    <div className="flex-1 min-w-0 space-y-1.5 text-center md:text-left">
                                        <div className="flex flex-wrap items-center justify-center md:justify-start gap-3">
                                            <h3 className="text-lg font-black text-white/90 group-hover:text-white transition-colors tracking-tight leading-tight truncate max-w-[300px] uppercase">
                                                {product.name}
                                            </h3>
                                            <div className="flex gap-1.5">
                                                {parseAssignment(product.allowed_messenger_ids).length > 0 && (
                                                    <div className="h-4 w-4 text-blue-500/60" title="Messenger">
                                                        <svg className="fill-current" viewBox="0 0 24 24"><path d="M12 2C6.477 2 2 6.145 2 11.214c0 2.891 1.41 5.474 3.627 7.204V22l3.399-1.865c.935.26 1.929.403 2.974.403 5.523 0 10-4.145 10-9.214S17.523 2 12 2zm1.061 12.445l-2.551-2.722-4.978 2.722 5.474-5.811 2.619 2.722 4.91-2.722-5.474 5.811z"/></svg>
                                                    </div>
                                                )}
                                                {parseAssignment(product.allowed_wa_sessions).length > 0 && (
                                                    <div className="h-4 w-4 text-emerald-500/60" title="WhatsApp">
                                                        <svg className="fill-current" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.353-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.05-.148-.471-1.138-.645-1.556-.17-.41-.344-.354-.471-.354-.121-.002-.26-.002-.399-.002-.14 0-.366.052-.557.26-.191.208-.73.712-.73 1.735 0 1.023.746 2.01 8.49 2.11 1.3 3.476 3.009 3.047 3.476 3.009 3.476 0 .019 0 .019 0 .019.421-.012 1.27-.519 1.449-1.02.18-.5.18-.93.126-1.02-.054-.09-.202-.148-.499-.297zM12 2.03c-5.502 0-9.97 4.468-9.97 9.97 0 1.757.463 3.467 1.343 4.966L2.03 21.97l5.162-1.354c1.441.786 3.063 1.2 4.808 1.2 5.502 0 9.97-4.468 9.97-9.97 0-5.502-4.468-9.97-9.97-9.97z"/></svg>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <p className="text-xs text-gray-500 font-bold uppercase tracking-widest line-clamp-1 opacity-60">
                                            {product.description || "NO DESCRIPTION AVAILABLE"}
                                        </p>
                                    </div>

                                    {/* Middle Section: Stock & Meta */}
                                    <div className="flex items-center gap-8 shrink-0">
                                        <div className="flex flex-col items-center md:items-start">
                                            <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/40 mb-1">Inventory</span>
                                            <span className={cn(
                                                "text-[10px] font-black uppercase tracking-tight px-2 py-0.5 rounded-md border",
                                                product.stock && product.stock > 0 
                                                    ? "text-[#00ff88]/60 bg-[#00ff88]/5 border-[#00ff88]/10" 
                                                    : "text-red-400/60 bg-red-400/5 border-red-500/10"
                                            )}>
                                                {product.stock || 0} Units
                                            </span>
                                        </div>
                                        <div className="flex flex-col items-center md:items-start">
                                            <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/40 mb-1">Pricing</span>
                                            <div className="flex items-baseline gap-1">
                                                <span className="text-[9px] font-black text-white/40 uppercase">{product.currency || 'BDT'}</span>
                                                <span className="text-lg font-black text-white">{Number(product.price).toLocaleString()}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Right Section: Compact Actions */}
                                    <div className="flex items-center gap-4 shrink-0 pl-6 border-l border-white/5">
                                        <div className="flex flex-col items-center gap-2">
                                            <Switch 
                                                checked={product.is_active} 
                                                onCheckedChange={(checked) => handleToggleActive(product, checked)}
                                                className="data-[state=checked]:bg-[#00ff88] scale-75"
                                            />
                                            <span className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/40">Status</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Button 
                                                variant="outline" 
                                                className="h-10 w-10 p-0 border-white/5 hover:bg-white/5 hover:border-white/10 rounded-xl transition-all"
                                                onClick={() => handleEdit(product)}
                                            >
                                                <Edit className="w-4 h-4 text-white/60 group-hover:text-white transition-colors" />
                                            </Button>
                                            <Button 
                                                variant="outline" 
                                                className="h-10 w-10 p-0 border-red-500/5 text-red-500/40 hover:bg-red-500/5 hover:border-red-500/20 rounded-xl transition-all"
                                                onClick={() => {
                                                    setPendingDeleteProduct(product);
                                                    setIsDeleteDialogOpen(true);
                                                }}
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
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
