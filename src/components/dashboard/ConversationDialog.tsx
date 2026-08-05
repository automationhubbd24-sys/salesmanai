import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { BACKEND_URL } from "@/config";

type Message = {
  from?: string;
  body?: string;
  is_ai?: boolean;
  reply_by?: string | null;
};

type ConversationDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platform: "whatsapp" | "messenger";
  resourceId: string | null;
  senderId: string | null;
  customerName?: string;
};

export function ConversationDialog({
  open,
  onOpenChange,
  platform,
  resourceId,
  senderId,
  customerName,
}: ConversationDialogProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !resourceId || !senderId) return;

    const controller = new AbortController();
    const loadMessages = async () => {
      setLoading(true);
      setError(null);
      setMessages([]);

      try {
        const token = localStorage.getItem("auth_token");
        const response = await fetch(
          `${BACKEND_URL}/api/${platform}/messages/${resourceId}/${senderId}?limit=40`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          },
        );

        if (!response.ok) throw new Error("Failed to load conversation");

        const data = await response.json();
        setMessages(Array.isArray(data) ? data : []);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError((err as Error).message || "Failed to load conversation");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    loadMessages();
    return () => controller.abort();
  }, [open, platform, resourceId, senderId]);

  const title = customerName || senderId || "Conversation";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0">
        <DialogHeader className="border-b px-6 py-4 pr-12">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Customer conversation</DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[60vh] px-6 py-4">
          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-16 w-3/4" />
              <Skeleton className="ml-auto h-16 w-2/3" />
              <Skeleton className="h-12 w-1/2" />
            </div>
          ) : error ? (
            <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm text-destructive">{error}</p>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex min-h-[240px] items-center justify-center text-center text-sm text-muted-foreground">
              No messages found for this conversation.
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((message, index) => {
                const isOutgoing = message.from === "me" || message.reply_by === "admin" || message.reply_by === "bot" || message.is_ai;
                const sender = message.reply_by === "bot" || message.is_ai ? "Bot" : message.reply_by === "admin" ? "Admin" : "Customer";

                return (
                  <div key={`${message.from || "message"}-${index}`} className={`flex ${isOutgoing ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${isOutgoing ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                      <p className="whitespace-pre-wrap break-words">{message.body || "—"}</p>
                      <p className={`mt-1 text-[10px] ${isOutgoing ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{sender}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
