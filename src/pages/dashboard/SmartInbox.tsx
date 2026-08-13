import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  ChevronLeft,
  Inbox,
  Loader2,
  Image as ImageIcon,
  MessageCircle,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Smartphone,
  Instagram,
  Tag,
  User as UserIcon,
  X
} from "lucide-react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { BACKEND_URL } from "@/config";
import { cn } from "@/lib/utils";

const CHAT_POLL_INTERVAL_MS = 30000;
const MESSAGE_POLL_INTERVAL_MS = 12000;
const CHAT_LIMIT = 60;
const MESSAGE_LIMIT = 40;

type LabelKey = "agent" | "human" | "order" | "human_transfer";
type FilterKey = "all" | LabelKey;
type PlatformKey = "whatsapp" | "messenger" | "instagram";

type Conversation = {
  id: string;
  from: string;
  name: string | null;
  display_name?: string | null;
  contact?: string | null;
  body: string;
  timestamp: number | null;
  reply_by: string | null;
  primary_label: "agent" | "human" | null;
  primary_label_title: string | null;
  active_labels: LabelKey[];
  active_label_titles: string[];
  has_order: boolean;
  order_status: string | null;
  order_selected: boolean;
  human_transfer_selected: boolean;
  manual_label_overrides?: {
    order?: boolean | null;
    human_transfer?: boolean | null;
  };
};

type MessageItem = {
  from: string;
  body: string;
  timestamp: number | string | null;
  is_ai: boolean;
  reply_by?: string | null;
};

const LABEL_META: Record<LabelKey, { title: string; className: string }> = {
  agent: {
    title: "Agent",
    className: "border-[#00ff88]/30 bg-[#00ff88]/10 text-[#8effc4]"
  },
  human: {
    title: "Human",
    className: "border-sky-400/30 bg-sky-400/10 text-sky-200"
  },
  order: {
    title: "Order",
    className: "border-amber-400/30 bg-amber-400/10 text-amber-200"
  },
  human_transfer: {
    title: "Human Transfer",
    className: "border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-200"
  }
};

const FILTER_OPTIONS: { key: FilterKey; title: string }[] = [
  { key: "all", title: "All" },
  { key: "agent", title: "Agent" },
  { key: "human", title: "Human" },
  { key: "order", title: "Order" },
  { key: "human_transfer", title: "Human Transfer" }
];

const getActiveResourceId = (platform?: string | null) => {
  if (platform === "whatsapp") return localStorage.getItem("active_wa_session_id");
  if (platform === "instagram") return localStorage.getItem("active_ig_account_id");
  return localStorage.getItem("active_fb_page_id");
};

const getPlatformTitle = (platform?: string | null) =>
  platform === "whatsapp" ? "WhatsApp" : platform === "instagram" ? "Instagram" : "Messenger";

const getPlatformTheme = (platform: PlatformKey) => {
  if (platform === "whatsapp") {
    return {
      accent: "#25D366",
      accentSoft: "rgba(37,211,102,0.14)",
      accentBorder: "rgba(37,211,102,0.32)",
      bubbleOut: "from-[#d9fdd3] to-[#b7f3cc]",
      icon: Smartphone,
      title: "WhatsApp Business"
    };
  }

  if (platform === "instagram") {
    return {
      accent: "#E4405F",
      accentSoft: "rgba(228,64,95,0.14)",
      accentBorder: "rgba(228,64,95,0.34)",
      bubbleOut: "from-[#E4405F] to-[#833AB4]",
      icon: Instagram,
      title: "Instagram Business"
    };
  }

  return {
    accent: "#0084ff",
    accentSoft: "rgba(0,132,255,0.14)",
    accentBorder: "rgba(0,132,255,0.34)",
    bubbleOut: "from-[#0084ff] to-[#0069d9]",
    icon: MessageCircle,
    title: "Messenger Business"
  };
};

const normalizeTimestamp = (value: number | string | null | undefined) => {
  if (value === null || value === undefined || value === "") return null;

  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : NaN;

  if (Number.isFinite(numericValue)) {
    return numericValue;
  }

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
};

const formatClock = (value: number | string | null | undefined) => {
  const timestamp = normalizeTimestamp(value);
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const formatListTime = (value: number | string | null | undefined) => {
  const timestamp = normalizeTimestamp(value);
  if (!timestamp) return "";

  const date = new Date(timestamp);
  const now = new Date();
  const isSameDay = date.toDateString() === now.toDateString();

  if (isSameDay) {
    return formatClock(timestamp);
  }

  return date.toLocaleDateString([], { month: "short", day: "numeric" });
};

const getMessagePreview = (body?: string) => {
  if (!body) return "No messages yet";

  if (body.includes("bot_image:")) return "Sent an image";
  if (body.includes("Analyzed Image:")) return "Analyzed image";
  if (body.includes("Analyzed Voice:")) return "Analyzed voice";
  if (/\[Audio URLs?\]:\s*https?:\/\//i.test(body)) return "Sent an audio message";
  if (body.toLowerCase().includes("system memory") || body.includes("ai_memory")) return "System update";

  return body;
};

const extractMediaImageUrl = (body?: string) => {
  if (!body) return "";

  const labeledMatch = body.match(/\[Image URLs?\]:\s*(https?:\/\/[^\s\]\)]+)/i);
  if (labeledMatch?.[1]) return labeledMatch[1];

  const extensionMatch = body.match(/(https?:\/\/[^\s\]\)]+\.(?:jpg|jpeg|png|gif|webp|bmp)(?:\?[^\s\]\)]*)?)/i);
  if (extensionMatch?.[1]) return extensionMatch[1];

  return "";
};

const cleanMediaMessageText = (body: string) =>
  body
    .replace(/\[?System Memory:[^\]]+\]?/g, "")
    .replace(/##PRODUCT[^\n]+/g, "")
    .replace(/\[Image URLs?\]:\s*https?:\/\/[^\s\]\)]+/gi, "")
    .replace(/https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp|bmp)(?:\?[^\s]+)?/gi, "")
    .trim();

const shouldHideMessage = (message: MessageItem) => {
  const body = message.body || "";
  const lowerBody = body.toLowerCase();
  const hasImage = Boolean(extractMediaImageUrl(body));
  const isBotImage = body.includes("bot_image:");
  const isInternalNoise =
    lowerBody.includes("system memory") ||
    body.includes("ai_memory") ||
    body.includes("[SYSTEM ERROR]") ||
    lowerBody.includes("conversation locked") ||
    lowerBody.includes("too many failures");
  return isInternalNoise && !hasImage && !isBotImage;
};

const isValidContactName = (value: unknown) => {
  if (typeof value !== "string") return false;
  const name = value.trim().replace(/\s+/g, " ");
  return Boolean(name) &&
    !["unknown", "unknown user", "customer", "whatsapp user", "messenger user", "null", "undefined"].includes(name.toLowerCase()) &&
    !/^\d+$/.test(name);
};

const getDisplayName = (chat: Conversation | null) => {
  if (!chat) return "";
  const name = [chat.display_name, chat.contact, chat.name].find(isValidContactName);
  return name || chat.from;
};

const SmartInbox = () => {
  const location = useLocation();
  const pathPlatform = location.pathname.split("/")[2];
  const platform: PlatformKey = pathPlatform === "whatsapp" ? "whatsapp" : pathPlatform === "instagram" ? "instagram" : "messenger";
  const platformTheme = useMemo(() => getPlatformTheme(platform), [platform]);
  const senderId = useMemo(() => new URLSearchParams(location.search).get("sender_id"), [location.search]);
  const PlatformIcon = platformTheme.icon;
  const [selectedChat, setSelectedChat] = useState<Conversation | null>(null);
  const [isMobileListVisible, setIsMobileListVisible] = useState(true);
  const [chats, setChats] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshingChats, setRefreshingChats] = useState(false);
  const [msgLoading, setMsgLoading] = useState(false);
  const [refreshingMessages, setRefreshingMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [selectedImagePreview, setSelectedImagePreview] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [labelUpdating, setLabelUpdating] = useState<Record<string, boolean>>({});

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatsAbortRef = useRef<AbortController | null>(null);
  const messagesAbortRef = useRef<AbortController | null>(null);
  const olderMessagesAbortRef = useRef<AbortController | null>(null);
  const skipNextScrollRef = useRef(false);
  const chatsSignatureRef = useRef("");
  const messagesSignatureRef = useRef("");
  const selectedSenderIdRef = useRef<string | null>(null);
  const [activeResourceId, setActiveResourceId] = useState<string | null>(() => getActiveResourceId(platform));
  const hasActiveResource = Boolean(activeResourceId);

  const syncActiveResourceId = useCallback(() => {
    setActiveResourceId((prev) => {
      const next = getActiveResourceId(platform);
      return prev === next ? prev : next;
    });
  }, [platform]);

  const scrollToBottom = useCallback(() => {
    const viewport = scrollRef.current?.querySelector("[data-radix-scroll-area-viewport]") as HTMLDivElement | null;
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, []);

  const upsertConversationLocally = useCallback((nextConversation: Conversation) => {
    setChats((prev) =>
      prev
        .map((item) => (item.id === nextConversation.id ? nextConversation : item))
        .sort((a, b) => (normalizeTimestamp(b.timestamp) || 0) - (normalizeTimestamp(a.timestamp) || 0))
    );
    setSelectedChat((prev) => (prev?.id === nextConversation.id ? nextConversation : prev));
  }, []);

  const fetchChats = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;

    if (!hasActiveResource || !platform) {
      chatsAbortRef.current?.abort();
      setChats([]);
      setSelectedChat(null);
      setLoading(false);
      setRefreshingChats(false);
      return;
    }

    if (silent) {
      setRefreshingChats(true);
    } else {
      setLoading(true);
    }

    chatsAbortRef.current?.abort();
    const controller = new AbortController();
    chatsAbortRef.current = controller;

    try {
      const token = localStorage.getItem("auth_token");
      const endpoint =
        platform === "whatsapp"
          ? `/api/whatsapp/conversations/${activeResourceId}?limit=${CHAT_LIMIT}`
          : platform === "instagram"
            ? `/api/instagram/conversations/${activeResourceId}?limit=${CHAT_LIMIT}`
            : `/api/messenger/conversations/${activeResourceId}?limit=${CHAT_LIMIT}`;

      const response = await fetch(`${BACKEND_URL}${endpoint}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error("Failed to load conversations");
      }

      const data = (await response.json()) as Conversation[];
      const lightweightData = (data || []).map((chat) => ({
        ...chat,
        body: getMessagePreview(chat.body)
      }));
      const signature = JSON.stringify(lightweightData);

      if (signature !== chatsSignatureRef.current) {
        chatsSignatureRef.current = signature;
        setChats(lightweightData);
        setSelectedChat((prev) => {
          if (!prev) return null;
          return lightweightData.find((item) => item.id === prev.id) || null;
        });
      }

    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        if (!silent) {
          toast.error("Conversation list load korte parini");
        }
      }
    } finally {
      if (silent) {
        setRefreshingChats(false);
      } else {
        setLoading(false);
      }
    }
  }, [activeResourceId, hasActiveResource, platform]);

  const fetchMessages = useCallback(
    async (chatId: string, options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;

      if (!hasActiveResource || !platform || !chatId) {
        setMessages([]);
        setMsgLoading(false);
        setRefreshingMessages(false);
        return;
      }

      if (silent) {
        setRefreshingMessages(true);
      } else {
        setMsgLoading(true);
      }

      messagesAbortRef.current?.abort();
      const controller = new AbortController();
      messagesAbortRef.current = controller;

      try {
        const token = localStorage.getItem("auth_token");
        const endpoint =
          platform === "whatsapp"
            ? `/api/whatsapp/messages/${activeResourceId}/${chatId}?limit=${MESSAGE_LIMIT}`
            : platform === "instagram"
              ? `/api/instagram/messages/${activeResourceId}/${chatId}?limit=${MESSAGE_LIMIT}`
              : `/api/messenger/messages/${activeResourceId}/${chatId}?limit=${MESSAGE_LIMIT}`;

        const response = await fetch(`${BACKEND_URL}${endpoint}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error("Failed to load messages");
        }

        const data = (await response.json()) as MessageItem[];
        const signature = JSON.stringify(data);

        if (signature !== messagesSignatureRef.current) {
          messagesSignatureRef.current = signature;
          setMessages((prev) => {
            const nextData = data || [];
            if (!silent) return nextData;

            const merged = new Map<string, MessageItem>();
            [...prev, ...nextData].forEach((item) => {
              merged.set(`${normalizeTimestamp(item.timestamp)}:${item.from}:${item.body}`, item);
            });

            return Array.from(merged.values()).sort(
              (a, b) => (normalizeTimestamp(a.timestamp) || 0) - (normalizeTimestamp(b.timestamp) || 0)
            );
          });
        }
        setHasOlderMessages((data || []).length === MESSAGE_LIMIT);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          if (!silent) {
            toast.error("Message history load korte parini");
          }
        }
      } finally {
        if (silent) {
          setRefreshingMessages(false);
        } else {
          setMsgLoading(false);
        }
      }
    },
    [activeResourceId, hasActiveResource, platform]
  );

  const loadOlderMessages = useCallback(async () => {
    if (!selectedChat?.id || !activeResourceId || !platform || loadingOlderMessages || !hasOlderMessages) return;

    olderMessagesAbortRef.current?.abort();
    const controller = new AbortController();
    olderMessagesAbortRef.current = controller;
    setLoadingOlderMessages(true);

    try {
      const token = localStorage.getItem("auth_token");
      const endpoint =
        platform === "whatsapp"
          ? `/api/whatsapp/messages/${activeResourceId}/${selectedChat.id}?limit=${MESSAGE_LIMIT}&offset=${messages.length}`
          : platform === "instagram"
            ? `/api/instagram/messages/${activeResourceId}/${selectedChat.id}?limit=${MESSAGE_LIMIT}&offset=${messages.length}`
            : `/api/messenger/messages/${activeResourceId}/${selectedChat.id}?limit=${MESSAGE_LIMIT}&offset=${messages.length}`;

      const response = await fetch(`${BACKEND_URL}${endpoint}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error("Failed to load older messages");
      }

      const olderData = (await response.json()) as MessageItem[];
      setHasOlderMessages(olderData.length === MESSAGE_LIMIT);
      if (olderData.length) {
        skipNextScrollRef.current = true;
        setMessages((prev) => {
          const seen = new Set(prev.map((item) => `${normalizeTimestamp(item.timestamp)}:${item.from}:${item.body}`));
          const nextOlder = olderData.filter((item) => !seen.has(`${normalizeTimestamp(item.timestamp)}:${item.from}:${item.body}`));
          return [...nextOlder, ...prev];
        });
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        toast.error("Older messages load korte parini");
      }
    } finally {
      setLoadingOlderMessages(false);
    }
  }, [activeResourceId, hasOlderMessages, loadingOlderMessages, messages.length, platform, selectedChat?.id]);

  useEffect(() => {
    syncActiveResourceId();
  }, [syncActiveResourceId]);

  useEffect(() => {
    const handleResourceChange = () => syncActiveResourceId();

    window.addEventListener("db-connection-changed", handleResourceChange);
    window.addEventListener("storage", handleResourceChange);
    return () => {
      window.removeEventListener("db-connection-changed", handleResourceChange);
      window.removeEventListener("storage", handleResourceChange);
    };
  }, [syncActiveResourceId]);

  useEffect(() => {
    selectedSenderIdRef.current = null;
  }, [senderId]);

  useEffect(() => {
    if (!senderId || selectedSenderIdRef.current === senderId) return;

    const targetChat = chats.find((chat) => chat.id === senderId);
    if (targetChat) {
      selectedSenderIdRef.current = senderId;
      setSelectedChat(targetChat);
      setIsMobileListVisible(false);
    }
  }, [chats, senderId]);

  useEffect(() => {
    chatsAbortRef.current?.abort();
    messagesAbortRef.current?.abort();
    olderMessagesAbortRef.current?.abort();
    setSelectedChat(null);
    setMessages([]);
    setHasOlderMessages(false);
    setSelectedImage(null);
    setSelectedImagePreview((preview) => {
      if (preview) URL.revokeObjectURL(preview);
      return null;
    });
    setChats([]);
    setIsMobileListVisible(true);
    chatsSignatureRef.current = "";
    messagesSignatureRef.current = "";
  }, [platform, activeResourceId]);

  useEffect(() => {
    fetchChats();
  }, [fetchChats]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        fetchChats({ silent: true });
      }
    };

    const interval = window.setInterval(() => {
      if (!document.hidden) {
        fetchChats({ silent: true });
      }
    }, CHAT_POLL_INTERVAL_MS);

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.clearInterval(interval);
      chatsAbortRef.current?.abort();
    };
  }, [fetchChats]);

  useEffect(() => {
    if (!selectedChat?.id) return undefined;

    fetchMessages(selectedChat.id);

    const interval = window.setInterval(() => {
      if (!document.hidden) {
        fetchMessages(selectedChat.id, { silent: true });
      }
    }, MESSAGE_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
      messagesAbortRef.current?.abort();
    };
  }, [fetchMessages, selectedChat?.id]);

  useEffect(() => {
    if (!messages.length) return;
    if (skipNextScrollRef.current) {
      skipNextScrollRef.current = false;
      return;
    }
    const frameId = window.requestAnimationFrame(scrollToBottom);
    return () => window.cancelAnimationFrame(frameId);
  }, [messages.length, scrollToBottom]);

  const filteredChats = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    return chats.filter((chat) => {
      const matchesFilter =
        activeFilter === "all" ? true : chat.active_labels.includes(activeFilter as LabelKey);

      if (!matchesFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      const haystack = [
        getDisplayName(chat),
        chat.from,
        chat.body,
        ...chat.active_label_titles
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [activeFilter, chats, searchTerm]);

  const counts = useMemo(() => {
    return FILTER_OPTIONS.reduce<Record<FilterKey, number>>(
      (acc, item) => {
        acc[item.key] =
          item.key === "all"
            ? chats.length
            : chats.filter((chat) => chat.active_labels.includes(item.key as LabelKey)).length;
        return acc;
      },
      { all: 0, agent: 0, human: 0, order: 0, human_transfer: 0 }
    );
  }, [chats]);

  const handleSelectChat = useCallback((chat: Conversation) => {
    setSelectedChat(chat);
    setIsMobileListVisible(false);
  }, []);

  const handleToggleLabel = useCallback(
    async (labelKey: "order" | "human_transfer", active: boolean) => {
      if (!selectedChat || !activeResourceId || !platform) return;

      const mutationKey = `${selectedChat.id}:${labelKey}`;
      const endpoint =
        platform === "whatsapp"
          ? `/api/whatsapp/conversations/${activeResourceId}/${selectedChat.id}/labels`
          : platform === "instagram"
            ? `/api/instagram/conversations/${activeResourceId}/${selectedChat.id}/labels`
            : `/api/messenger/conversations/${activeResourceId}/${selectedChat.id}/labels`;

      const optimisticConversation: Conversation = {
        ...selectedChat,
        order_selected: labelKey === "order" ? active : selectedChat.order_selected,
        human_transfer_selected:
          labelKey === "human_transfer" ? active : selectedChat.human_transfer_selected,
        active_labels: (() => {
          const nextLabels = new Set<LabelKey>(selectedChat.active_labels);
          if (active) {
            nextLabels.add(labelKey);
          } else {
            nextLabels.delete(labelKey);
          }
          return Array.from(nextLabels);
        })(),
        active_label_titles: (() => {
          const nextLabels = new Set(
            selectedChat.active_label_titles.filter((item) => item !== LABEL_META[labelKey].title)
          );
          if (active) {
            nextLabels.add(LABEL_META[labelKey].title);
          }
          return Array.from(nextLabels);
        })()
      };

      upsertConversationLocally(optimisticConversation);
      setLabelUpdating((prev) => ({ ...prev, [mutationKey]: true }));

      try {
        const token = localStorage.getItem("auth_token");
        const response = await fetch(`${BACKEND_URL}${endpoint}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ labelKey, active })
        });

        if (!response.ok) {
          throw new Error("Label update failed");
        }

        const data = await response.json();
        if (data?.conversation) {
          upsertConversationLocally(data.conversation as Conversation);
        } else {
          fetchChats({ silent: true });
        }
      } catch (error) {
        toast.error("Label update korte parini");
        fetchChats({ silent: true });
      } finally {
        setLabelUpdating((prev) => ({ ...prev, [mutationKey]: false }));
      }
    },
    [activeResourceId, fetchChats, platform, selectedChat, upsertConversationLocally]
  );

  const clearSelectedImage = useCallback(() => {
    setSelectedImage(null);
    setSelectedImagePreview((preview) => {
      if (preview) URL.revokeObjectURL(preview);
      return null;
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleImageSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("শুধু image file select করা যাবে");
      return;
    }
    if (file.size > 16 * 1024 * 1024) {
      toast.error("Image size 16MB এর কম হতে হবে");
      return;
    }
    setSelectedImagePreview((preview) => {
      if (preview) URL.revokeObjectURL(preview);
      return URL.createObjectURL(file);
    });
    setSelectedImage(file);
  }, []);

  const handleSendMessage = useCallback(async () => {
    if (!selectedChat || !activeResourceId || !platform || sending) {
      return;
    }

    const messageText = newMessage.trim();
    if (!messageText && !selectedImage) return;

    const optimisticBody = selectedImagePreview
      ? `[Image Message]\n[Image URL]: ${selectedImagePreview}${messageText ? `\n${messageText}` : ""}`
      : messageText;
    const optimisticMessage: MessageItem = {
      from: "me",
      body: optimisticBody,
      timestamp: Date.now(),
      reply_by: "admin",
      is_ai: false
    };

    setSending(true);
    setNewMessage("");
    setMessages((prev) => [...prev, optimisticMessage]);

    try {
      const token = localStorage.getItem("auth_token");
      const endpoint = platform === "whatsapp" ? "/api/whatsapp/send" : platform === "instagram" ? "/api/instagram/send" : "/api/messenger/send";
      const formData = new FormData();
      formData.append(platform === "whatsapp" ? "sessionName" : platform === "instagram" ? "accountId" : "pageId", activeResourceId);
      formData.append("to", selectedChat.id);
      formData.append("message", messageText);
      if (selectedImage) formData.append("image", selectedImage);

      clearSelectedImage();

      const response = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: formData
      });

      if (!response.ok) {
        throw new Error("Send failed");
      }

      const data = await response.json().catch(() => null);
      const deliveredBody = data?.message?.body || optimisticBody;
      const timestamp = Date.now();
      const updatedConversation: Conversation = {
        ...selectedChat,
        body: deliveredBody,
        timestamp,
        reply_by: "admin",
        primary_label: "human",
        primary_label_title: "Human",
        active_labels: Array.from(new Set<LabelKey>([
          "human",
          ...(selectedChat.order_selected ? ["order" as const] : []),
          ...(selectedChat.human_transfer_selected ? ["human_transfer" as const] : [])
        ])),
        active_label_titles: Array.from(new Set([
          "Human",
          ...(selectedChat.order_selected ? ["Order"] : []),
          ...(selectedChat.human_transfer_selected ? ["Human Transfer"] : [])
        ]))
      };

      upsertConversationLocally(updatedConversation);
      fetchMessages(selectedChat.id, { silent: true });
      fetchChats({ silent: true });
    } catch (error) {
      toast.error("Message পাঠাতে পারিনি");
      setNewMessage(messageText);
      fetchMessages(selectedChat.id, { silent: true });
    } finally {
      setSending(false);
    }
  }, [
    activeResourceId,
    clearSelectedImage,
    fetchChats,
    fetchMessages,
    newMessage,
    platform,
    selectedChat,
    selectedImage,
    selectedImagePreview,
    sending,
    upsertConversationLocally
  ]);

  const emptyStateTitle = hasActiveResource ? "Select a conversation" : "Select active account";
  const emptyStateDescription = hasActiveResource
    ? "Left list theke ekta chat select korlei full inbox, labels, ar recent messages dekhte parben."
    : `Smart Inbox use korar age ekta active ${getPlatformTitle(platform)} account select korun.`;

  const visibleMessages = useMemo(
    () => messages.filter((message) => !shouldHideMessage(message)),
    [messages]
  );
  const renderedMessages = visibleMessages.slice(-MESSAGE_LIMIT);

  return (
    <div className="fixed inset-0 z-50 flex h-[100dvh] min-w-0 max-w-full overflow-hidden border-0 bg-[radial-gradient(circle_at_top_left,rgba(37,211,102,0.08),transparent_32%),linear-gradient(135deg,#050810,#081020)] shadow-2xl sm:relative sm:z-auto sm:h-[calc(100dvh-70px)] md:h-[calc(100vh-80px)] md:rounded-[2rem] md:border md:border-white/8">
      {/* Conversation List */}
      <div
        className={cn(
          "w-full min-w-0 shrink-0 overflow-hidden sm:w-[clamp(300px,34vw,390px)] border-r border-white/5 flex flex-col bg-gradient-to-b from-[#070a12] to-[#050810]",
          !isMobileListVisible && "hidden sm:flex"
        )}
      >
        {/* Header */}
        <div className="border-b border-white/5 p-3.5 sm:p-5 md:p-6 space-y-3.5 sm:space-y-5 bg-gradient-to-b from-white/[0.02] to-transparent">
          {/* Premium Header */}
          <div className="flex min-w-0 items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div
                className="h-9 w-9 sm:h-11 sm:w-11 rounded-2xl flex items-center justify-center shadow-[0_0_25px_rgba(0,0,0,0.28)] ring-1 ring-white/10"
                style={{ background: `linear-gradient(135deg, ${platformTheme.accent}, ${platform === "whatsapp" ? "#128C7E" : platform === "instagram" ? "#833AB4" : "#005bd8"})` }}
              >
                <PlatformIcon size={22} className="text-white" />
              </div>
              <div className="min-w-0 overflow-hidden">
                <h1 className="truncate text-lg sm:text-xl md:text-2xl font-black tracking-tight text-white">
                  Smart Inbox
                </h1>
                <p className="text-xs text-white/45 mt-0.5">
                  {platformTheme.title} conversations
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => fetchChats({ silent: true })}
              className="h-9 w-9 sm:h-11 sm:w-11 rounded-2xl border border-white/10 bg-white/[0.02] text-white/50 hover:text-[#00ff88] hover:bg-[#00ff88]/10 hover:border-[#00ff88]/30 transition-all duration-300"
            >
              <RefreshCw size={18} className={cn("transition-transform", refreshingChats && "animate-spin")} />
            </Button>
          </div>

          {/* Search Input */}
          <div className="relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 group-hover:text-[#00ff88]/70 transition-colors" size={19} />
            <Input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search conversations or contacts..."
              className="pl-11 sm:pl-12 h-10 sm:h-12 rounded-2xl border border-white/10 bg-white/[0.03] focus-visible:ring-[#00ff88]/50 focus-visible:border-[#00ff88]/40 placeholder:text-white/35 transition-all duration-300 text-sm"
            />
          </div>

          {/* Filter Pills */}
          <div className="flex max-w-full gap-2 overflow-x-auto overscroll-x-contain pb-2 -mx-1 px-1">
            {FILTER_OPTIONS.map((filter) => (
              <button
                key={filter.key}
                type="button"
                onClick={() => setActiveFilter(filter.key)}
                className={cn(
                  "shrink-0 rounded-2xl border px-3 sm:px-4 py-2 sm:py-2.5 text-[11px] sm:text-xs font-bold transition-all duration-300 flex items-center gap-2",
                  activeFilter === filter.key
                    ? "border-[#00ff88]/40 bg-gradient-to-r from-[#00ff88]/20 to-[#00ff88]/10 text-[#97ffca] shadow-[0_0_20px_rgba(0,255,136,0.15)]"
                    : "border-white/10 bg-white/[0.02] text-white/60 hover:text-white hover:bg-white/[0.05] hover:border-white/20"
                )}
              >
                {filter.title}
                <span className="h-5 min-w-5 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-black">
                  {counts[filter.key]}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Conversation List */}
        <ScrollArea className="min-w-0 flex-1 overflow-hidden">
          {loading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="rounded-2xl border border-white/5 bg-white/[0.02] p-4 animate-pulse">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-12 w-12 rounded-full bg-white/10" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-28 bg-white/10" />
                      <Skeleton className="h-3 w-48 bg-white/10" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : filteredChats.length === 0 ? (
            <div className="flex h-full min-h-[360px] flex-col items-center justify-center px-8 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white/[0.03] border border-white/5">
                <Inbox className="text-white/20" size={32} />
              </div>
              <h3 className="text-lg font-semibold text-white">
                {searchTerm ? "No results found" : "No conversations yet"}
              </h3>
              <p className="mt-2 text-sm text-white/40 max-w-[260px]">
                {searchTerm 
                  ? "Try adjusting your search or filters to find what you're looking for."
                  : "Start messaging with your customers to see conversations here."}
              </p>
            </div>
          ) : (
            <div className="min-w-0 overflow-hidden p-2 sm:p-3 md:p-3.5 space-y-2 sm:space-y-2.5">
              {filteredChats.map((chat) => {
                const isActive = selectedChat?.id === chat.id;
                return (
                  <button
                    key={chat.id}
                    type="button"
                    onClick={() => handleSelectChat(chat)}
                    className={cn(
                      "w-full max-w-full overflow-hidden rounded-2xl border p-3 sm:p-4 text-left transition-all duration-300 group",
                      isActive
                        ? "border-[#00ff88]/45 bg-gradient-to-r from-[#00ff88]/18 via-[#00ff88]/10 to-sky-500/10 shadow-[inset_4px_0_0_rgba(0,255,136,0.75),0_0_30px_rgba(0,255,136,0.14)]"
                        : "border-white/5 bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/10"
                    )}
                  >
                    <div className="flex min-w-0 items-start gap-2.5 sm:gap-3">
                      <Avatar className={cn(
                        "h-10 w-10 shrink-0 sm:h-12 sm:w-12 border transition-all duration-300",
                        isActive ? "border-[#00ff88]/30" : "border-white/10 group-hover:border-white/20"
                      )}>
                        <AvatarImage src={undefined} />
                        <AvatarFallback className={cn(
                          "bg-gradient-to-br from-white/10 to-white/5 text-white/60",
                          isActive && "from-[#00ff88]/20 to-[#00ff88]/10"
                        )}>
                          {getDisplayName(chat).substring(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>

                      <div className="w-0 min-w-0 max-w-full flex-1 overflow-hidden">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1 overflow-hidden">
                            <div className="truncate text-sm sm:text-base font-bold text-white">
                              {getDisplayName(chat)}
                            </div>
                            <div className="mt-0.5 truncate text-[10px] sm:text-[11px] text-white/40">
                              {chat.from}
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1.5">
                            <div className="text-[10px] sm:text-[11px] text-white/40 font-medium">
                              {formatListTime(chat.timestamp)}
                            </div>
                            <span
                              className="hidden sm:inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wide"
                              style={{ borderColor: platformTheme.accentBorder, background: platformTheme.accentSoft, color: platform === "whatsapp" ? "#9fffc4" : "#9dccff" }}
                            >
                              <PlatformIcon size={10} />
                              {getPlatformTitle(platform)}
                            </span>
                          </div>
                        </div>

                        <p className="mt-1.5 sm:mt-2 max-w-full overflow-hidden break-words [overflow-wrap:anywhere] text-sm leading-relaxed text-white/65 line-clamp-2">
                          {getMessagePreview(chat.body)}
                        </p>

                        <div className="mt-2.5 sm:mt-3 flex items-center justify-between gap-2">
                          <div className="flex min-w-0 flex-wrap gap-1.5">
                            {chat.active_labels.length > 0 ? (
                              chat.active_labels.slice(0, 3).map((label) => (
                                <Badge
                                  key={`${chat.id}-${label}`}
                                  variant="outline"
                                  className={cn("rounded-full px-2.5 sm:px-3 py-0.5 sm:py-1 text-[9px] sm:text-[10px] font-black border-opacity-70 shadow-sm", LABEL_META[label].className)}
                                >
                                  <Tag size={10} className="mr-1" />
                                  {LABEL_META[label].title}
                                </Badge>
                              ))
                            ) : (
                              <Badge
                                variant="outline"
                                className="rounded-full border-white/10 bg-white/[0.03] px-2.5 sm:px-3 py-0.5 sm:py-1 text-[9px] sm:text-[10px] text-white/45"
                              >
                                New
                              </Badge>
                            )}
                          </div>
                          {chat.active_labels.length > 3 && (
                            <span className="shrink-0 rounded-full bg-white/8 px-2 py-1 text-[9px] font-bold text-white/45">
                              +{chat.active_labels.length - 3}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Chat Area */}
      <div className={cn("relative flex min-w-0 max-w-full flex-1 flex-col overflow-hidden bg-[#050810]", isMobileListVisible && "hidden sm:flex")}>
        {selectedChat ? (
          <>
            {/* Chat Header */}
            <div className="border-b border-white/5 bg-gradient-to-b from-white/[0.02] to-transparent px-4 sm:px-5 py-3.5 sm:py-4 md:px-6">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="sm:hidden text-white/50 hover:text-white hover:bg-white/10"
                    onClick={() => setIsMobileListVisible(true)}
                  >
                    <ChevronLeft size={20} className="sm:w-5.5 sm:h-5.5" />
                  </Button>

                  <div className="relative">
                    <Avatar className="h-10 w-10 sm:h-12 sm:w-12 border border-white/10 shadow-lg">
                      <AvatarFallback className="bg-gradient-to-br from-white/10 to-white/5 text-white/60">
                        {getDisplayName(selectedChat).substring(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span
                      className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-[#050810] text-white shadow-md"
                      style={{ background: platformTheme.accent }}
                    >
                      <PlatformIcon size={11} />
                    </span>
                  </div>

                  <div className="min-w-0">
                    <div className="truncate text-sm sm:text-base font-bold text-white">
                      {getDisplayName(selectedChat)}
                    </div>
                    <div className="mt-0.5 sm:mt-1 flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-[11px] text-white/45">
                      <span className="inline-flex items-center gap-1 sm:gap-1.5">
                        <span className="h-1.5 w-1.5 sm:h-2 sm:w-2 rounded-full bg-[#00ff88] animate-pulse" />
                        {selectedChat.reply_by === "bot"
                          ? "Last reply by Agent"
                          : selectedChat.reply_by === "admin"
                            ? "Last reply by Admin"
                            : "Waiting for your reply"}
                      </span>
                      <span className="text-white/20">•</span>
                      <span>{platformTheme.title}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => fetchMessages(selectedChat.id, { silent: true })}
                    className="text-white/40 hover:text-[#00ff88] hover:bg-[#00ff88]/10 transition-all duration-300"
                  >
                    <RefreshCw size={16} className={cn("sm:w-4.5 sm:h-4.5 transition-transform", refreshingMessages && "animate-spin")} />
                  </Button>
                  <Button variant="ghost" size="icon" className="text-white/35 hover:text-white hover:bg-white/10 transition-all duration-300">
                    <ShieldCheck size={16} className="sm:w-4.5 sm:h-4.5" />
                  </Button>
                </div>
              </div>

              <div className="mt-3.5 hidden gap-1.5 overflow-x-auto pb-1 sm:flex sm:gap-2">
                {selectedChat.active_labels.length > 0 ? (
                  selectedChat.active_labels.map((label) => (
                    <Badge
                      key={`header-${label}`}
                      variant="outline"
                      className={cn("rounded-full px-3 py-1.5 text-[10px] font-black border-opacity-70 whitespace-nowrap shadow-sm", LABEL_META[label].className)}
                    >
                      <Tag size={10} className="mr-1" />
                      {LABEL_META[label].title}
                    </Badge>
                  ))
                ) : (
                  <Badge
                    variant="outline"
                    className="rounded-full border-white/10 bg-white/[0.03] px-3 py-1.5 text-[10px] text-white/45 whitespace-nowrap"
                  >
                    New Conversation
                  </Badge>
                )}
              </div>
            </div>

            {/* Mobile Label Controls */}
            <div className="border-b border-white/5 px-3 py-2.5 md:hidden" style={{ background: `linear-gradient(90deg, ${platformTheme.accentSoft}, transparent)` }}>
              <div className="flex gap-2 overflow-x-auto pb-1">
                <button
                  type="button"
                  disabled={labelUpdating[`${selectedChat.id}:order`]}
                  onClick={() => handleToggleLabel("order", !selectedChat.order_selected)}
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-2 text-[11px] font-black transition-all",
                    selectedChat.order_selected ? "border-amber-400/40 bg-amber-400/15 text-amber-100" : "border-white/10 bg-white/[0.03] text-white/55"
                  )}
                >
                  Order {selectedChat.order_selected ? "On" : "Off"}
                </button>
                <button
                  type="button"
                  disabled={labelUpdating[`${selectedChat.id}:human_transfer`]}
                  onClick={() => handleToggleLabel("human_transfer", !selectedChat.human_transfer_selected)}
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-2 text-[11px] font-black transition-all",
                    selectedChat.human_transfer_selected ? "border-fuchsia-400/40 bg-fuchsia-400/15 text-fuchsia-100" : "border-white/10 bg-white/[0.03] text-white/55"
                  )}
                >
                  Human {selectedChat.human_transfer_selected ? "On" : "Off"}
                </button>
              </div>
            </div>

            {/* Messages */}
            <ScrollArea ref={scrollRef} className="relative min-w-0 max-w-full flex-1 overflow-hidden bg-gradient-to-b from-transparent to-black/10">
              {msgLoading ? (
                <div className="space-y-2.5 p-2.5 sm:p-4 md:p-5">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <div key={index} className={cn("flex", index % 2 === 0 ? "justify-start" : "justify-end")}>
                      <Skeleton className="h-20 w-[65%] md:w-[55%] rounded-3xl bg-white/8 animate-pulse" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="min-w-0 overflow-hidden space-y-3 p-3 sm:p-4 md:p-6">
                  {hasOlderMessages && visibleMessages.length > 0 && (
                    <div className="pb-1 text-center">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={loadOlderMessages}
                        disabled={loadingOlderMessages}
                        className="h-9 rounded-full border border-white/10 bg-white/[0.03] px-4 text-xs text-white/55 hover:bg-white/[0.06] hover:text-white"
                      >
                        {loadingOlderMessages ? "Loading older..." : "Load older messages"}
                      </Button>
                    </div>
                  )}

                  {visibleMessages.length === 0 && (
                    <div className="flex min-h-[320px] items-center justify-center text-center">
                      <div className="max-w-[280px] rounded-3xl border border-white/10 bg-[#202c33]/70 px-6 py-5 shadow-lg backdrop-blur-sm">
                        <h3 className="text-sm font-bold text-white">No messages yet</h3>
                        <p className="mt-2 text-xs leading-relaxed text-white/50">
                          Saved messages for this conversation will appear here after they sync.
                        </p>
                      </div>
                    </div>
                  )}

                  {renderedMessages.map((message, index) => {
                    const body = message.body || "";
                    const imageUrl = extractMediaImageUrl(body);
                    const hasMediaImage = Boolean(imageUrl);
                    const lowerBody = body.toLowerCase();
                    const isBotImage =
                      hasMediaImage &&
                      (message.reply_by === "bot" ||
                        body.includes("bot_image:") ||
                        body.includes("##PRODUCT") ||
                        lowerBody.includes("system memory: user is viewing image") ||
                        lowerBody.includes("sent images to user"));
                    const isAnalysisMessage = /\[Analyzed Images?\]|\[Analyzed Image\s*\d*\]|Analyzed Image:|Analyzed Voice:/i.test(body);
                    const isTranscriptMessage = /^\[Transcript\]:/i.test(body.trim());
                    const isOutgoing = message.from === "me" || message.reply_by === "admin" || isBotImage;
                    const isBot = message.reply_by === "bot" || isBotImage;

                    return (
                      <div
                        key={`${normalizeTimestamp(message.timestamp) || index}-${index}`}
                        className={cn("flex w-full min-w-0 max-w-full overflow-hidden gap-3 items-end animate-in fade-in slide-in-from-bottom-2 duration-500", isOutgoing ? "justify-end" : "justify-start")}
                      >
                        {!isOutgoing && (
                          <Avatar className="hidden sm:flex h-9 w-9 border border-white/10 shrink-0">
                            <AvatarFallback className="bg-white/5 text-[11px] text-white/60 font-bold">
                              {getDisplayName(selectedChat).substring(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                        )}

                        <div
                          className={cn(
                            "min-w-0 max-w-[min(86%,320px)] overflow-hidden rounded-[1.25rem] px-3 py-2.5 text-sm sm:max-w-[min(78%,420px)] sm:px-3.5 sm:py-3 md:max-w-[min(70%,560px)] lg:max-w-[min(58%,620px)] shadow-lg transition-all duration-200 hover:shadow-xl", 
                            isOutgoing
                              ? isBot
                                ? platform === "whatsapp"
                                  ? "rounded-br-md bg-gradient-to-br from-[#d9fdd3] to-[#b7f3cc] text-slate-950 shadow-[0_4px_20px_rgba(0,168,132,0.22)]"
                                  : "rounded-br-md bg-gradient-to-br from-[#0084ff] to-[#0069d9] text-white shadow-[0_4px_20px_rgba(0,132,255,0.24)]"
                                : "rounded-br-md border border-sky-300/20 bg-gradient-to-br from-[#0b8bdc] to-[#0566b3] text-white shadow-[0_4px_20px_rgba(0,132,255,0.18)]"
                              : "rounded-bl-md border border-white/10 bg-gradient-to-br from-[#202c33] to-[#17212b] text-white/95 shadow-[0_4px_20px_rgba(0,0,0,0.28)]"
                          )}
                        >
                          {hasMediaImage && !isAnalysisMessage ? (
                            <div className="space-y-3">
                              <img
                                src={imageUrl}
                                alt="Conversation media"
                                loading="lazy"
                                decoding="async"
                                className="w-full max-w-[170px] sm:max-w-[240px] max-h-[220px] rounded-2xl border border-black/10 object-cover cursor-pointer"
                                onClick={() => window.open(imageUrl, "_blank")}
                                onError={(event) => {
                                  (event.currentTarget as HTMLImageElement).style.display = "none";
                                }}
                              />
                              {cleanMediaMessageText(body) && (
                                <p className={cn("text-xs leading-relaxed", isBot ? "text-black/70" : "text-white/70")}>
                                  {cleanMediaMessageText(body)}
                                </p>
                              )}
                            </div>
                          ) : isAnalysisMessage || isTranscriptMessage ? (
                            <details className="group max-w-[min(78vw,220px)] sm:max-w-[360px]">
                              <summary className={cn("cursor-pointer list-none rounded-2xl border px-3 py-2 text-xs font-black transition-colors", isBot ? "border-black/10 bg-black/5 text-black/80" : "border-white/10 bg-white/[0.04] text-[#8effc4]")}>
                                <span className="flex items-center justify-between gap-3">
                                  <span>{isTranscriptMessage ? "Voice transcript" : body.toLowerCase().includes("voice") ? "Voice analysis" : "Image analysis"}</span>
                                  <span className="text-[10px] opacity-60 group-open:hidden">Expand</span>
                                  <span className="hidden text-[10px] opacity-60 group-open:inline">Collapse</span>
                                </span>
                              </summary>
                              <p className={cn("mt-3 max-h-[320px] overflow-y-auto whitespace-pre-wrap rounded-2xl p-3 text-xs leading-relaxed", isBot ? "bg-black/5 text-black/75" : "bg-black/20 text-white/75")}>
                                {body
                                  .replace(/\[Analyzed Images?\]:?\s*/i, "")
                                  .replace(/\[Analyzed Image\s*\d*\]:?\s*/i, "")
                                  .replace(/\[Analyzed Voice\]:?\s*/i, "")
                                  .replace(/^\[Transcript\]:\s*/i, "")
                                  .replace(/Analyzed Image:\s*/i, "")
                                  .replace(/Analyzed Voice:\s*/i, "")
                                  .trim()}
                              </p>
                            </details>
                          ) : (
                            <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-relaxed text-[14px]">
                              {body}
                            </p>
                          )}

                          <div
                            className={cn(
                              "mt-2.5 flex items-center gap-2 text-[10px]",
                              isOutgoing ? (isBot ? "justify-end text-black/55" : "justify-end text-sky-100/70") : "text-white/40"
                            )}
                          >
                            <span className="font-medium">{formatClock(message.timestamp)}</span>
                            <span className="opacity-50">•</span>
                            <span className="font-bold">
                              {isBot ? "Agent" : message.reply_by === "admin" ? "Admin" : "Customer"}
                            </span>
                          </div>
                        </div>

                        {isBot && (
                          <div className="shrink-0 text-[#00ff88] mb-1">
                            <Bot size={16} className="drop-shadow-[0_0_8px_rgba(0,255,136,0.5)]" />
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {!msgLoading && visibleMessages.length >= MESSAGE_LIMIT && (
                    <div className="pt-4 text-center">
                      <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-[11px] text-white/40">
                        <div className="h-1.5 w-1.5 rounded-full bg-[#00ff88]/50" />
                        Showing recent {MESSAGE_LIMIT} messages
                      </div>
                    </div>
                  )}
                </div>
              )}
            </ScrollArea>

            {/* Input Area */}
            <div className="border-t border-white/5 bg-gradient-to-t from-black/40 to-transparent px-2.5 py-2.5 pb-[calc(env(safe-area-inset-bottom)+0.625rem)] sm:px-3 sm:py-3.5 md:px-6 md:py-4">
              {selectedImagePreview && (
                <div className="mb-2 flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.04] p-2 backdrop-blur-sm">
                  <img src={selectedImagePreview} alt="Selected upload" className="h-12 w-12 sm:h-16 sm:w-16 rounded-xl object-cover" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-xs font-black text-white">
                      <ImageIcon size={14} />
                      Image ready to send
                    </div>
                    <p className="mt-1 truncate text-[11px] text-white/45">{selectedImage?.name}</p>
                  </div>
                  <Button size="icon" variant="ghost" onClick={clearSelectedImage} className="h-9 w-9 rounded-full text-white/60 hover:bg-white/10 hover:text-white">
                    <X size={16} />
                  </Button>
                </div>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
              <div className="flex min-w-0 max-w-full items-end gap-2 overflow-hidden rounded-[1.35rem] border border-white/10 bg-white/[0.03] p-2 backdrop-blur-sm sm:gap-2.5 sm:rounded-[1.5rem] sm:p-2.5">
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sending}
                  className="h-10 w-10 sm:h-12 sm:w-12 shrink-0 rounded-2xl text-white/60 hover:bg-white/10 hover:text-white"
                >
                  <Paperclip size={19} />
                </Button>
                <Input
                  value={newMessage}
                  onChange={(event) => setNewMessage(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  placeholder="Type message or attach image..."
                  className="h-10 min-w-0 flex-1 sm:h-12 border-none bg-transparent text-sm text-white placeholder:text-white/30 focus-visible:ring-0 resize-none"
                />
                <Button
                  size="icon"
                  onClick={handleSendMessage}
                  disabled={(!newMessage.trim() && !selectedImage) || sending}
                  className="h-10 w-10 sm:h-12 sm:w-12 shrink-0 rounded-2xl text-black transition-all duration-300 hover:scale-105 active:scale-95 disabled:hover:scale-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: `linear-gradient(135deg, ${platformTheme.accent}, ${platform === "whatsapp" ? "#128C7E" : platform === "instagram" ? "#833AB4" : "#005bd8"})` }}
                >
                  {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={19} className="text-white" />}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
            <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full border border-[#00ff88]/20 bg-gradient-to-br from-[#00ff88]/10 to-[#00ff88]/3">
              <Inbox size={44} className="text-[#00ff88] drop-shadow-[0_0_20px_rgba(0,255,136,0.3)]" />
            </div>
            <h2 className="text-2xl md:text-3xl font-black tracking-tight text-white">
              {emptyStateTitle}
            </h2>
            <p className="mt-4 max-w-[420px] text-sm md:text-base leading-relaxed text-white/50">
              {emptyStateDescription}
            </p>
          </div>
        )}
      </div>

      {/* Desktop Right Panel */}
      {selectedChat && (
        <div className="relative z-10 hidden min-w-0 shrink-0 w-[clamp(240px,22vw,320px)] overflow-hidden border-l border-white/5 bg-gradient-to-b from-[#070a14] to-[#050812] lg:flex lg:flex-col">
          {/* Profile Header */}
          <div className="min-w-0 overflow-hidden border-b border-white/5 p-4 xl:p-5 bg-gradient-to-b from-white/[0.02] to-transparent">
            <div className="flex min-w-0 max-w-full flex-col items-center overflow-hidden text-center">
              <div className="relative">
                <Avatar className="h-16 w-16 xl:h-20 xl:w-20 border-2 shadow-[0_0_30px_rgba(0,0,0,0.25)]" style={{ borderColor: platformTheme.accentBorder }}>
                  <AvatarFallback className="bg-gradient-to-br from-white/10 to-white/5 text-white/70">
                    {getDisplayName(selectedChat).substring(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="absolute bottom-0 right-0 flex h-6 w-6 items-center justify-center rounded-full border-2 border-[#070a14] text-white shadow-lg" style={{ background: platformTheme.accent }}>
                  <PlatformIcon size={13} />
                </span>
              </div>
              <h3 className="mt-5 max-w-full overflow-hidden break-words [overflow-wrap:anywhere] text-xl font-black text-white line-clamp-2">
                {getDisplayName(selectedChat)}
              </h3>
              <p className="mt-1.5 max-w-full overflow-hidden break-words [overflow-wrap:anywhere] text-sm font-medium text-white/50 line-clamp-2">
                {selectedChat.from}
              </p>
              <div
                className="mt-3 inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-[11px] font-black shadow-sm"
                style={{ borderColor: platformTheme.accentBorder, background: platformTheme.accentSoft, color: platform === "whatsapp" ? "#9fffc4" : "#9dccff" }}
              >
                <PlatformIcon size={14} />
                {platformTheme.title}
              </div>
            </div>
          </div>

          {/* Panel Content */}
          <div className="min-w-0 space-y-5 overflow-x-hidden overflow-y-auto p-4 xl:p-5">
            {/* Active Labels */}
            <div className="space-y-4">
              <div className="text-[11px] font-black uppercase tracking-[0.25em] text-[#8effc4] flex items-center gap-3">
                <div className="h-0.5 w-6 bg-gradient-to-r from-[#00ff88] to-[#00ff88]/30 rounded-full" />
                Active Labels
                <div className="h-0.5 flex-1 bg-gradient-to-r from-[#00ff88]/30 to-transparent rounded-full" />
              </div>
              <div className="flex flex-wrap gap-2.5">
                {selectedChat.active_labels.length > 0 ? (
                  selectedChat.active_labels.map((label) => (
                    <Badge
                      key={`panel-${label}`}
                      variant="outline"
                      className={cn("rounded-full px-4 py-2 text-[10px] font-black border-opacity-60 shadow-sm", LABEL_META[label].className)}
                    >
                      {LABEL_META[label].title}
                    </Badge>
                  ))
                ) : (
                  <Badge
                    variant="outline"
                    className="rounded-full border-white/10 bg-white/[0.04] px-4 py-2 text-[10px] text-white/50 font-bold"
                  >
                    New Conversation
                  </Badge>
                )}
              </div>
            </div>

            {/* Label Controls */}
            <div className="space-y-4">
              <div className="text-[11px] font-black uppercase tracking-[0.25em] text-[#8effc4] flex items-center gap-3">
                <div className="h-0.5 w-6 bg-gradient-to-r from-[#00ff88] to-[#00ff88]/30 rounded-full" />
                Label Controls
                <div className="h-0.5 flex-1 bg-gradient-to-r from-[#00ff88]/30 to-transparent rounded-full" />
              </div>

              <div className="rounded-2xl border border-white/7 bg-gradient-to-br from-white/[0.05] to-white/[0.02] p-4 hover:from-white/[0.07] hover:to-white/[0.03] transition-all duration-300 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-base font-black text-white flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.4)]"></div>
                      Order
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-white/50">
                      Add this conversation to your order follow-up queue.
                    </p>
                  </div>
                  <Switch
                    checked={selectedChat.order_selected}
                    disabled={labelUpdating[`${selectedChat.id}:order`]}
                    onCheckedChange={(checked) => handleToggleLabel("order", checked)}
                  />
                </div>
                {selectedChat.order_status && (
                  <div className="mt-4 flex items-center gap-2.5 text-[11px] text-amber-200/90 bg-gradient-to-r from-amber-500/15 to-amber-500/5 px-3.5 py-2.5 rounded-xl border border-amber-500/25">
                    <div className="h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]" />
                    Order status: {selectedChat.order_status}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-white/7 bg-gradient-to-br from-white/[0.05] to-white/[0.02] p-4 hover:from-white/[0.07] hover:to-white/[0.03] transition-all duration-300 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-base font-black text-white flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-fuchsia-400 shadow-[0_0_8px_rgba(244,114,182,0.4)]"></div>
                      Human Transfer
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-white/50">
                      Mark for human follow-up when you need to personally reply.
                    </p>
                  </div>
                  <Switch
                    checked={selectedChat.human_transfer_selected}
                    disabled={labelUpdating[`${selectedChat.id}:human_transfer`]}
                    onCheckedChange={(checked) => handleToggleLabel("human_transfer", checked)}
                  />
                </div>
              </div>
            </div>

            {/* Info Card */}
            <div className="rounded-2xl border border-white/7 bg-gradient-to-br from-[#00ff88]/8 to-white/[0.015] p-5.5 text-xs leading-relaxed text-white/50 shadow-sm">
              <div className="font-black text-white/85 text-sm mb-4 flex items-center gap-2.5">
                <Bot size={16} className="text-[#8effc4]" />
                Smart Rules
              </div>
              <div className="space-y-2.5">
                <p className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[#8effc4]/60 shrink-0" />
                  Last reply by bot → Agent label
                </p>
                <p className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-sky-400/60 shrink-0" />
                  Last reply by admin → Human label
                </p>
                <p className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-white/40 shrink-0" />
                  Toggle labels manually as needed
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SmartInbox;
