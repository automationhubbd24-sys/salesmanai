import { useState, useEffect, useRef } from "react";
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
import { Lock, Plus, Trash2, Package, Search, Image as ImageIcon, Loader2, ShoppingBag, Download, Edit, X } from "lucide-react";
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
    const getInitialPageId = () => {
        const wa = localStorage.getItem('active_wa_session_id');
        if (wa) return wa;
        const fb = localStorage.getItem('active_fb_page_id');
        return fb || null;
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
            const merged = [...productImages, ...incoming].slice(0, 10);
            setProductImages(merged);
            const previews = merged.map(f => URL.createObjectURL(f));
            setImagePreviews(previews);
            // Primary image (first one) for backend
            setProductImage(merged[0] || null);
            setImagePreview(previews[0] || null);
        }
    };

    const removeImageAt = (index: number) => {
        const newFiles = [...productImages];
        const newPreviews = [...imagePreviews];
        newFiles.splice(index, 1);
        newPreviews.splice(index, 1);
        setProductImages(newFiles);
        setImagePreviews(newPreviews);
        // Adjust primary
        setProductImage(newFiles[0] || null);
        setImagePreview(newPreviews[0] || null);
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
        setImagePreviews(product.image_url ? [product.image_url] : []);
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
                            {/* Left: Image Upload */}
                            <div className="flex flex-col gap-2 items-center">
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
                                                    setSelectedWA(prev => {
                                                      const next = new Set(Array.from(prev));
                                                      if (checked) next.add(key); else next.delete(key);
                                                      return next;
                                                    });
                                                    setSelectedFB(prev => {
                                                      const next = new Set(Array.from(prev));
                                                      next.delete(key);
                                                      return next;
                                                    });
                                                    if (editProductId) {
                                                        persistAssignments();
                                                    }
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
                                                    setSelectedFB(prev => {
                                                      const next = new Set(Array.from(prev));
                                                      if (checked) next.add(key); else next.delete(key);
                                                      return next;
                                                    });
                                                    setSelectedWA(prev => {
                                                      const next = new Set(Array.from(prev));
                                                      next.delete(key);
                                                      return next;
                                                    });
                                                    if (editProductId) {
                                                        persistAssignments();
                                                    }
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

                        {/* Advanced / Variants Toggle */}
                        <div className="border-t pt-4">
                            <div className="flex items-center justify-between mb-4">
                                <Label className="text-muted-foreground">Advanced: Variable Product</Label>
                                <Switch checked={showVariants} onCheckedChange={setShowVariants} />
                            </div>
                            
                            {showVariants && (
                                <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                                    <div className="flex items-center justify-between">
                                        <Label>Variants (Price Options)</Label>
                                        <Button variant="outline" size="sm" onClick={() => setVariants([...variants, { name: `Option ${variants.length + 1}`, price: productPrice, currency: productCurrency, available: true }])}>
                                            <Plus className="w-3 h-3 mr-1" />
                                            Add Option
                                        </Button>
                                    </div>
                                    <div className="border rounded-md overflow-hidden">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead className="w-[40px] text-center">#</TableHead>
                                                    <TableHead>Price</TableHead>
                                                    <TableHead className="w-[80px]">Stock</TableHead>
                                                    <TableHead className="w-[50px]"></TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {variants.map((variant, index) => (
                                                    <TableRow key={index}>
                                                        <TableCell className="text-center text-muted-foreground text-sm">
                                                            {index + 1}
                                                        </TableCell>
                                                        <TableCell>
                                                            <Input 
                                                                type="number" 
                                                                value={variant.price} 
                                                                className="h-8"
                                                                onChange={(e) => {
                                                                    const newV = [...variants];
                                                                    newV[index].price = e.target.value;
                                                                    setVariants(newV);
                                                                }}
                                                            />
                                                        </TableCell>
                                                        <TableCell>
                                                            <Switch 
                                                                checked={variant.available} 
                                                                onCheckedChange={(c) => {
                                                                    const newV = [...variants];
                                                                    newV[index].available = c;
                                                                    setVariants(newV);
                                                                }}
                                                            />
                                                        </TableCell>
                                                        <TableCell>
                                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => {
                                                                const newV = [...variants];
                                                                newV.splice(index, 1);
                                                                setVariants(newV);
                                                            }}>
                                                                <Trash2 className="w-4 h-4" />
                                                            </Button>
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="border-t pt-4 space-y-2">
                            <div className="flex items-center justify-between">
                                <Label className="text-destructive">Error Monitor</Label>
                                <div className="flex items-center gap-2">
                                    <Input value={errorFilter} onChange={(e) => setErrorFilter(e.target.value)} placeholder="Filter..." className="h-8 w-[200px]" />
                                    <Button variant="outline" size="sm" onClick={() => setErrorOpen(v => !v)}>{errorOpen ? "Hide" : "Show"}</Button>
                                    <Button variant="outline" size="sm" onClick={() => setErrorItems([])}>Clear</Button>
                                </div>
                            </div>
                            {errorBanner && (
                                <div className="rounded-md bg-red-500/15 border border-red-500/30 text-red-400 px-3 py-2 text-sm">
                                    {errorBanner}
                                </div>
                            )}
                            {errorOpen && (
                                <div className="border rounded-md bg-muted/10 p-2 max-h-40 overflow-auto text-xs font-mono">
                                    {errorItems.filter(e => !errorFilter || `${e.source} ${e.message}`.toLowerCase().includes(errorFilter.toLowerCase())).map((e, i) => (
                                        <div key={`err-${i}`} className="whitespace-pre-wrap">
                                            [{new Date(e.time).toLocaleTimeString()}] {e.source}{e.status ? ` [${e.status}]` : ""}: {e.message}
                                        </div>
                                    ))}
                                    {errorItems.length === 0 && <div className="opacity-60">No errors</div>}
                                </div>
                            )}
                        </div>

                        <div className="border-t pt-4 space-y-2">
                            <div className="flex items-center justify-between">
                                <Label className="text-muted-foreground">Debug Logs</Label>
                                <div className="flex items-center gap-2">
                                    <Input value={debugLogFilter} onChange={(e) => setDebugLogFilter(e.target.value)} placeholder="Filter..." className="h-8 w-[200px]" />
                                    <Button variant="outline" size="sm" onClick={() => setDebugLogOpen((v) => !v)}>
                                        {debugLogOpen ? "Hide" : "Show"}
                                    </Button>
                                    <Button variant="outline" size="sm" onClick={() => { if (logFileInputRef.current) (logFileInputRef.current as any).click(); }}>
                                        Attach Log
                                    </Button>
                                    <input ref={logFileInputRef} type="file" accept=".txt" className="hidden" onChange={handleLogFileChange} />
                                    <Button variant="outline" size="sm" onClick={() => setDebugLogText("")}>
                                        Clear
                                    </Button>
                                </div>
                            </div>
                            {debugLogOpen && (
                                <div className="border rounded-md bg-muted/10 p-2 max-h-48 overflow-auto text-xs font-mono">
                                    {debugLogText.split(/\r?\n/).filter(l => !debugLogFilter || l.toLowerCase().includes(debugLogFilter.toLowerCase())).map((l, i) => (
                                        <div key={`log-${i}`} className="whitespace-pre-wrap">{l}</div>
                                    ))}
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
                                            ) : (
                                                <Package className="h-6 w-6 opacity-20" />
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell className="font-medium">
                                        <div className="flex flex-col gap-1">
                                            <span>{product.name}</span>
                                            <div className="flex flex-wrap gap-1">
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
