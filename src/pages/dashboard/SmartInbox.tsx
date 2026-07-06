import React, { useState, useEffect, useCallback } from "react";
import { 
  Search, 
  Filter, 
  MoreVertical, 
  Send, 
  Image as ImageIcon, 
  Mic, 
  Paperclip,
  User as UserIcon,
  Bot,
  ShieldCheck,
  Smartphone,
  ChevronLeft,
  Inbox,
  RefreshCw,
  Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useParams } from "react-router-dom";
import { toast } from "sonner";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "https://api.salesmanchatbot.online";

const SmartInbox = () => {
  const { platform } = useParams();
  const [selectedChat, setSelectedChat] = useState<any>(null);
  const [isMobileListVisible, setIsMobileListVisible] = useState(true);
  const [chats, setChats] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [msgLoading, setMsgLoading] = useState(false);
  const [newMessage, setNewMessage] = useState("");

  const fetchChats = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("auth_token");
      const activeId = platform === 'whatsapp' 
        ? localStorage.getItem("active_wa_session_id") 
        : localStorage.getItem("active_fb_page_id");
      
      if (!activeId) {
        setChats([]);
        return;
      }

      const endpoint = platform === 'whatsapp' 
        ? `/api/whatsapp/conversations/${activeId}` 
        : `/api/messenger/conversations/${activeId}`;
        
      const res = await fetch(`${BACKEND_URL}${endpoint}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setChats(data || []);
      }
    } catch (e) {
      console.error("Failed to fetch chats:", e);
    } finally {
      setLoading(false);
    }
  }, [platform]);

  const scrollRef = React.useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      const scrollContainer = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom();
    }
  }, [messages, scrollToBottom]);

  const fetchMessages = async (chatId: string) => {
    setMsgLoading(true);
    try {
      const token = localStorage.getItem("auth_token");
      const activeId = platform === 'whatsapp' 
        ? localStorage.getItem("active_wa_session_id") 
        : localStorage.getItem("active_fb_page_id");
        
      const endpoint = platform === 'whatsapp' 
        ? `/api/whatsapp/messages/${activeId}/${chatId}` 
        : `/api/messenger/messages/${activeId}/${chatId}`;
        
      const res = await fetch(`${BACKEND_URL}${endpoint}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(data || []);
      }
    } catch (e) {
      console.error("Failed to fetch messages:", e);
    } finally {
      setMsgLoading(false);
    }
  };

  useEffect(() => {
    fetchChats();
  }, [fetchChats]);

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedChat) return;
    try {
      const token = localStorage.getItem("auth_token");
      const endpoint = platform === 'whatsapp' ? '/api/whatsapp/send' : '/api/messenger/send';
      const res = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          to: selectedChat.id || selectedChat.from,
          message: newMessage,
          platform: platform
        })
      });

      if (res.ok) {
        setMessages([...messages, { 
          from: 'me', 
          body: newMessage, 
          timestamp: new Date().toISOString(),
          is_ai: false 
        }]);
        setNewMessage("");
      }
    } catch (e) {
      toast.error("Failed to send message");
    }
  };

  return (
    <div className="flex h-[calc(100vh-64px)] md:h-[calc(100vh-80px)] overflow-hidden bg-[#0a0a0a] md:rounded-3xl border-none md:border md:border-white/5 shadow-2xl">
      {/* Sidebar / Chat List */}
      <div className={cn(
        "w-full md:w-[350px] border-r border-white/5 flex flex-col transition-all duration-300 bg-[#0a0a0a]",
        !isMobileListVisible && "hidden md:flex"
      )}>
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-black text-[#00ff88] uppercase tracking-tighter">Smart Inbox</h1>
            <Button variant="ghost" size="icon" onClick={fetchChats} className="text-white/50 hover:text-[#00ff88]">
              <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" size={16} />
            <Input 
              placeholder="Search conversations..." 
              className="pl-10 bg-white/5 border-white/10 rounded-xl focus:border-[#00ff88]/50 transition-all"
            />
          </div>
        </div>

        <ScrollArea className="flex-1">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2">
              <Loader2 className="animate-spin text-[#00ff88]" />
              <span className="text-xs text-white/30">Syncing chats...</span>
            </div>
          ) : chats.length === 0 ? (
            <div className="text-center py-20 text-white/20 italic text-sm">No conversations found</div>
          ) : (
            chats.map((chat) => (
              <div 
                key={chat.id || chat.from}
                onClick={() => {
                  setSelectedChat(chat);
                  fetchMessages(chat.id || chat.from);
                  setIsMobileListVisible(false);
                }}
                className={cn(
                  "p-4 flex gap-3 cursor-pointer transition-all hover:bg-white/5 border-l-2 border-transparent",
                  selectedChat?.id === (chat.id || chat.from) && "bg-[#00ff88]/5 border-[#00ff88]"
                )}
              >
                <Avatar className="h-12 w-12 border border-white/10">
                  <AvatarImage src={chat.avatar} />
                  <AvatarFallback className="bg-white/5 text-white/50"><UserIcon size={20} /></AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start mb-1">
                    <h3 className="font-bold text-sm text-white truncate">{chat.name || chat.from}</h3>
                    <span className="text-[10px] text-white/30">
                      {chat.timestamp ? new Date(chat.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ""}
                    </span>
                  </div>
                  <p className="text-xs text-white/50 truncate mb-1">
                    {chat.last_message?.includes('bot_image:') ? "📷 Sent an image" : 
                     chat.last_message?.includes('ai_memory') ? "🧠 AI Thinking..." :
                     chat.last_message || chat.body || "No messages"}
                  </p>
                  <div className="flex gap-1">
                    <Badge variant="outline" className="text-[9px] px-1.5 h-4 border-[#00ff88]/30 text-[#00ff88] bg-[#00ff88]/5 uppercase font-bold">
                      {chat.label || "General"}
                    </Badge>
                  </div>
                </div>
                {chat.unread_count > 0 && (
                  <div className="bg-[#00ff88] text-black text-[10px] font-bold h-5 w-5 rounded-full flex items-center justify-center shadow-[0_0_10px_rgba(0,255,136,0.5)]">
                    {chat.unread_count}
                  </div>
                )}
              </div>
            ))
          )}
        </ScrollArea>
      </div>

      {/* Main Chat Area */}
      <div className={cn(
        "flex-1 flex flex-col bg-black/20 relative",
        isMobileListVisible && "hidden md:flex"
      )}>
        {selectedChat ? (
          <>
            {/* Chat Header */}
            <div className="p-4 border-b border-white/5 flex items-center justify-between bg-white/2 backdrop-blur-md">
              <div className="flex items-center gap-3">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="md:hidden text-white/50"
                  onClick={() => setIsMobileListVisible(true)}
                >
                  <ChevronLeft />
                </Button>
                <Avatar className="h-10 w-10 border border-white/10">
                  <AvatarImage src={selectedChat.avatar} />
                  <AvatarFallback className="bg-white/5"><UserIcon size={18} /></AvatarFallback>
                </Avatar>
                <div>
                  <h2 className="font-bold text-sm text-white">{selectedChat.name || selectedChat.from}</h2>
                  <div className="flex items-center gap-1.5 text-[10px] text-[#00ff88]">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#00ff88] animate-pulse" />
                    Real-time Active
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" className="text-white/30 hover:text-white"><ShieldCheck size={18} /></Button>
                <Button variant="ghost" size="icon" className="text-white/30 hover:text-white"><MoreVertical size={18} /></Button>
              </div>
            </div>

            {/* Messages Area */}
            <ScrollArea ref={scrollRef} className="flex-1 p-4">
              {msgLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="animate-spin text-[#00ff88]" />
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {messages
                    .filter(msg => {
                      // Filter out memory messages EXCEPT those containing image URLs
                      const hasImage = msg.body?.match(/https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp)/i);
                      const isBotImageCmd = msg.body?.includes('bot_image:');
                      
                      if (msg.body?.includes('ai_memory') && !hasImage && !isBotImageCmd) return false;
                      return true;
                    })
                    .map((msg, idx) => {
                      // Extract image URL from bot_image:URL or standard URL patterns
                      let imageUrl = "";
                      const botImageMatch = msg.body?.match(/bot_image:\s*(https?:\/\/[^\s]+)/i);
                      if (botImageMatch) {
                        imageUrl = botImageMatch[1].replace(/\]$/, '');
                      } else {
                        const genericMatch = msg.body?.match(/(https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s]*)?)/i);
                        imageUrl = genericMatch ? genericMatch[0].replace(/\]$/, '') : "";
                      }

                      const isBotImage = imageUrl && (msg.body?.includes('bot_image:') || msg.body?.includes('##PRODUCT') || msg.body?.includes('System Memory: User is viewing Image'));
                       
                      const isAnalyzed = msg.body?.includes('Analyzed Image:') || msg.body?.includes('Analyzed Voice:');
                      
                      return (
                        <div 
                          key={idx} 
                          className={cn(
                            "flex gap-3 max-w-[85%] md:max-w-[80%]",
                            (msg.from === 'me' || isBotImage) ? "ml-auto flex-row-reverse" : ""
                          )}
                        >
                          {(msg.from !== 'me' && !isBotImage) && (
                            <Avatar className="h-8 w-8 mt-auto border border-white/10 shrink-0">
                              <AvatarFallback className="bg-white/5 text-[10px]">US</AvatarFallback>
                            </Avatar>
                          )}
                          <div className={cn(
                            "p-3 rounded-2xl text-sm shadow-sm break-words overflow-hidden",
                            (msg.from === 'me' || isBotImage)
                              ? "bg-[#00ff88]/90 text-black font-medium rounded-br-none" 
                              : "bg-white/5 border border-white/10 text-white/90 rounded-bl-none"
                          )}>
                            {isBotImage ? (
                              <div className="space-y-2">
                                <img 
                                  src={imageUrl} 
                                  alt="Product" 
                                  className="max-w-[180px] md:max-w-[220px] h-auto rounded-lg border border-black/10 shadow-sm cursor-pointer hover:opacity-90 transition-opacity" 
                                  onClick={() => window.open(imageUrl, '_blank')} 
                                />
                                {msg.body.includes('bot_image:') ? null : (
                                  msg.body.replace(/\[?System Memory:[^\]]+\]?/g, '').replace(/##PRODUCT[^\n]+/, '').replace(/https?:\/\/[^\s]+/, '').trim() && (
                                    <p className="text-[11px] opacity-70 leading-tight">{msg.body.replace(/\[?System Memory:[^\]]+\]?/g, '').replace(/##PRODUCT[^\n]+/, '').replace(/https?:\/\/[^\s]+/, '').trim()}</p>
                                  )
                                )}
                              </div>
                            ) : isAnalyzed ? (
                              <details className="group cursor-pointer">
                                <summary className="text-xs font-bold text-[#00ff88] flex items-center gap-2 list-none">
                                  <span className="group-open:rotate-90 transition-transform">▶</span>
                                  {msg.body.includes('Analyzed Image:') ? '🖼️ [Analyzed Image]' : '🎤 [Analyzed Voice]'}
                                </summary>
                                <div className="mt-3 pt-3 border-t border-white/10 text-xs opacity-80 leading-relaxed whitespace-pre-wrap">
                                  {msg.body}
                                </div>
                              </details>
                            ) : (
                              <p className="whitespace-pre-wrap">{msg.body}</p>
                            )}
                            <span className={cn(
                              "block text-[9px] mt-1",
                              msg.from === 'me' ? "text-black/40 text-right" : "text-white/20"
                            )}>
                              {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                              {msg.is_ai && " • Sent by AI"}
                            </span>
                          </div>
                          {msg.is_ai && (
                            <div className="mt-auto flex flex-col items-center gap-1 shrink-0">
                              <Bot size={14} className="text-[#00ff88]" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </ScrollArea>

            {/* Input Area */}
            <div className="p-4 border-t border-white/5 bg-white/2">
              <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-2xl p-2 focus-within:border-[#00ff88]/40 transition-all">
                <Button variant="ghost" size="icon" className="text-white/30 hover:text-[#00ff88]"><Paperclip size={18} /></Button>
                <Input 
                  placeholder="Type a message..." 
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                  className="border-none bg-transparent focus-visible:ring-0 text-sm h-10"
                />
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="text-white/30 hover:text-[#00ff88]"><ImageIcon size={18} /></Button>
                  <Button variant="ghost" size="icon" className="text-white/30 hover:text-[#00ff88]"><Mic size={18} /></Button>
                  <Button 
                    size="icon" 
                    onClick={handleSendMessage}
                    className="bg-[#00ff88] hover:bg-[#00ff88]/80 text-black rounded-xl h-10 w-10 shadow-[0_0_15px_rgba(0,255,136,0.3)]"
                  >
                    <Send size={18} />
                  </Button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-4">
            <div className="w-20 h-20 rounded-full bg-[#00ff88]/5 flex items-center justify-center border border-[#00ff88]/20 mb-4 shadow-[0_0_30px_rgba(0,255,136,0.05)]">
              <Inbox size={40} className="text-[#00ff88]" />
            </div>
            <h2 className="text-2xl font-black text-white uppercase tracking-tight">Select a conversation</h2>
            <p className="text-white/40 max-w-[300px]">
              Choose a chat from the left to start managing your customer conversations across all platforms.
            </p>
          </div>
        )}
      </div>

      {/* Right Info Panel */}
      {selectedChat && (
        <div className="hidden lg:flex w-[280px] border-l border-white/5 flex-col p-6 space-y-8 bg-white/2">
          <div className="text-center space-y-3">
             <Avatar className="h-20 w-20 mx-auto border-2 border-[#00ff88]/30 shadow-[0_0_20px_rgba(0,255,136,0.1)]">
                <AvatarImage src={selectedChat.avatar} />
                <AvatarFallback className="text-xl bg-white/5">US</AvatarFallback>
             </Avatar>
             <div>
                <h3 className="font-bold text-white text-lg">{selectedChat.name || selectedChat.from}</h3>
                <p className="text-xs text-white/30">via {platform === 'whatsapp' ? 'WhatsApp Business' : 'Messenger'}</p>
             </div>
          </div>

          <div className="space-y-4">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-[#00ff88]">Management</h4>
            <div className="space-y-3">
               <div className="space-y-2">
                 <label className="text-[10px] text-white/30 uppercase font-bold">Assign Agent</label>
                 <select className="w-full bg-white/5 border border-white/10 rounded-xl text-xs p-2.5 text-white/70 focus:outline-none focus:border-[#00ff88]/50">
                    <option>Admin (You)</option>
                    <option>Sales Agent 1</option>
                    <option>Support Team</option>
                 </select>
               </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SmartInbox;
