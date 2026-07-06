import React, { useState } from "react";
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
  Inbox
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const SmartInbox = () => {
  const [selectedChat, setSelectedChat] = useState<any>(null);
  const [isMobileListVisible, setIsMobileListVisible] = useState(true);

  // Fake Data for UI Setup
  const chats = [
    { id: 1, name: "Sakibul Hasan", lastMsg: "Voice Message (0:26)", time: "12:15 PM", unread: 3, avatar: "", label: "problems", platform: "whatsapp" },
    { id: 2, name: "Jubaer Chowdhury", lastMsg: "Order confirmation link please", time: "11:30 AM", unread: 0, avatar: "", label: "users", platform: "messenger" },
    { id: 3, name: "Guardify BD", lastMsg: "Sent an image", time: "昨天", unread: 0, avatar: "", label: "New order", platform: "whatsapp" },
  ];

  return (
    <div className="flex h-[calc(100vh-80px)] overflow-hidden bg-[#0a0a0a] rounded-3xl border border-white/5 shadow-2xl">
      {/* Sidebar / Chat List */}
      <div className={cn(
        "w-full md:w-[350px] border-r border-white/5 flex flex-col transition-all duration-300",
        !isMobileListVisible && "hidden md:flex"
      )}>
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-black text-[#00ff88] uppercase tracking-tighter">Smart Inbox</h1>
            <Button variant="ghost" size="icon" className="text-white/50 hover:text-[#00ff88]">
              <Filter size={18} />
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
          {chats.map((chat) => (
            <div 
              key={chat.id}
              onClick={() => {
                setSelectedChat(chat);
                setIsMobileListVisible(false);
              }}
              className={cn(
                "p-4 flex gap-3 cursor-pointer transition-all hover:bg-white/5 border-l-2 border-transparent",
                selectedChat?.id === chat.id && "bg-[#00ff88]/5 border-[#00ff88]"
              )}
            >
              <Avatar className="h-12 w-12 border border-white/10">
                <AvatarImage src={chat.avatar} />
                <AvatarFallback className="bg-white/5 text-white/50"><UserIcon size={20} /></AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-start mb-1">
                  <h3 className="font-bold text-sm text-white truncate">{chat.name}</h3>
                  <span className="text-[10px] text-white/30">{chat.time}</span>
                </div>
                <p className="text-xs text-white/50 truncate mb-1">{chat.lastMsg}</p>
                <div className="flex gap-1">
                  <Badge variant="outline" className="text-[9px] px-1.5 h-4 border-[#00ff88]/30 text-[#00ff88] bg-[#00ff88]/5 uppercase font-bold">
                    {chat.label}
                  </Badge>
                </div>
              </div>
              {chat.unread > 0 && (
                <div className="bg-[#00ff88] text-black text-[10px] font-bold h-5 w-5 rounded-full flex items-center justify-center shadow-[0_0_10px_rgba(0,255,136,0.5)]">
                  {chat.unread}
                </div>
              )}
            </div>
          ))}
        </ScrollArea>
      </div>

      {/* Main Chat Area */}
      <div className={cn(
        "flex-1 flex flex-col bg-black/20",
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
                  <h2 className="font-bold text-sm text-white">{selectedChat.name}</h2>
                  <div className="flex items-center gap-1.5 text-[10px] text-[#00ff88]">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#00ff88] animate-pulse" />
                    Online
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" className="text-white/30 hover:text-white"><ShieldCheck size={18} /></Button>
                <Button variant="ghost" size="icon" className="text-white/30 hover:text-white"><MoreVertical size={18} /></Button>
              </div>
            </div>

            {/* Messages Area */}
            <ScrollArea className="flex-1 p-4 space-y-4">
              <div className="flex flex-col gap-4">
                {/* Received Message */}
                <div className="flex gap-3 max-w-[80%]">
                  <Avatar className="h-8 w-8 mt-auto border border-white/10">
                    <AvatarFallback className="bg-white/5 text-[10px]">US</AvatarFallback>
                  </Avatar>
                  <div className="bg-white/5 border border-white/10 p-3 rounded-2xl rounded-bl-none text-sm text-white/90">
                    {selectedChat.lastMsg}
                    <span className="block text-[9px] text-white/20 mt-1">11:30 AM</span>
                  </div>
                </div>

                {/* Sent Message (AI or Human) */}
                <div className="flex gap-3 max-w-[80%] ml-auto flex-row-reverse">
                  <div className="bg-[#00ff88] p-3 rounded-2xl rounded-br-none text-sm text-black font-medium shadow-[0_4px_15px_rgba(0,255,136,0.2)]">
                    Sure! Processing your order right now.
                    <span className="block text-[9px] text-black/40 mt-1">11:35 AM • Sent by AI</span>
                  </div>
                  <div className="mt-auto flex flex-col items-center gap-1">
                    <Bot size={14} className="text-[#00ff88]" />
                  </div>
                </div>
              </div>
            </ScrollArea>

            {/* Input Area */}
            <div className="p-4 border-t border-white/5 bg-white/2">
              <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-2xl p-2 focus-within:border-[#00ff88]/40 transition-all">
                <Button variant="ghost" size="icon" className="text-white/30 hover:text-[#00ff88]"><Paperclip size={18} /></Button>
                <Input 
                  placeholder="Type a message..." 
                  className="border-none bg-transparent focus-visible:ring-0 text-sm h-10"
                />
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="text-white/30 hover:text-[#00ff88]"><ImageIcon size={18} /></Button>
                  <Button variant="ghost" size="icon" className="text-white/30 hover:text-[#00ff88]"><Mic size={18} /></Button>
                  <Button size="icon" className="bg-[#00ff88] hover:bg-[#00ff88]/80 text-black rounded-xl h-10 w-10 shadow-[0_0_15px_rgba(0,255,136,0.3)]">
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
            <div className="flex gap-4 mt-4">
              <div className="flex flex-col items-center gap-2 px-6 py-4 bg-white/2 rounded-2xl border border-white/5">
                <span className="text-2xl font-bold text-[#00ff88]">24</span>
                <span className="text-[10px] text-white/30 uppercase font-black">Active Chats</span>
              </div>
              <div className="flex flex-col items-center gap-2 px-6 py-4 bg-white/2 rounded-2xl border border-white/5">
                <span className="text-2xl font-bold text-amber-500">5</span>
                <span className="text-[10px] text-white/30 uppercase font-black">Urgent</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right Info Panel (Optional - For future labels/agent assign) */}
      {selectedChat && (
        <div className="hidden lg:flex w-[280px] border-l border-white/5 flex-col p-6 space-y-8 bg-white/2">
          <div className="text-center space-y-3">
             <Avatar className="h-20 w-20 mx-auto border-2 border-[#00ff88]/30 shadow-[0_0_20px_rgba(0,255,136,0.1)]">
                <AvatarImage src={selectedChat.avatar} />
                <AvatarFallback className="text-xl bg-white/5">US</AvatarFallback>
             </Avatar>
             <div>
                <h3 className="font-bold text-white text-lg">{selectedChat.name}</h3>
                <p className="text-xs text-white/30">via {selectedChat.platform === 'whatsapp' ? 'WhatsApp Business' : 'Messenger'}</p>
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
               <div className="space-y-2">
                 <label className="text-[10px] text-white/30 uppercase font-bold">Priority</label>
                 <div className="flex gap-2">
                    <Badge className="bg-red-500/10 text-red-500 border-red-500/20 cursor-pointer hover:bg-red-500/20">Urgent</Badge>
                    <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/20 cursor-pointer hover:bg-amber-500/20">High</Badge>
                    <Badge className="bg-white/5 text-white/30 border-white/10 cursor-pointer">Normal</Badge>
                 </div>
               </div>
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-[#00ff88]">Platform Status</h4>
            <div className="p-4 bg-black/40 rounded-2xl border border-white/5 space-y-3">
               <div className="flex items-center justify-between">
                  <span className="text-[10px] text-white/50">AI Responder</span>
                  <div className="w-8 h-4 bg-[#00ff88]/20 rounded-full relative">
                    <div className="absolute right-0.5 top-0.5 w-3 h-3 bg-[#00ff88] rounded-full shadow-[0_0_8px_rgba(0,255,136,0.8)]" />
                  </div>
               </div>
               <div className="flex items-center justify-between">
                  <span className="text-[10px] text-white/50">Push Notifications</span>
                  <div className="w-8 h-4 bg-white/10 rounded-full relative">
                    <div className="absolute left-0.5 top-0.5 w-3 h-3 bg-white/30 rounded-full" />
                  </div>
               </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SmartInbox;
