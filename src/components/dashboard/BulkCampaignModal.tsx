import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Send, Image as ImageIcon, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import axios from 'axios';
import { BACKEND_URL } from "@/config";

interface BulkCampaignModalProps {
    pageId: string;
    platform: 'messenger' | 'whatsapp';
    trigger?: React.ReactNode;
}

export function BulkCampaignModal({ pageId, platform, trigger }: BulkCampaignModalProps) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState("");
    const [imageUrl, setImageUrl] = useState("");
    const [excludeBuyers, setExcludeBuyers] = useState(true);
    const [campaignId, setCampaignId] = useState<number | null>(null);

    const handleStartCampaign = async () => {
        if (!message.trim()) {
            toast.error("Please enter a message");
            return;
        }

        setLoading(true);
        try {
            const token = localStorage.getItem('auth_token');
            const response = await axios.post(`${BACKEND_URL}/api/marketing/campaign/start`, {
                page_id: pageId,
                platform,
                message,
                image_url: imageUrl,
                exclude_buyers: excludeBuyers
            }, {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (response.data.success) {
                setCampaignId(response.data.campaignId);
                toast.success(`Campaign started! Target: ${response.data.total} recipients.`);
                // We don't close the modal immediately so they can see the status if we add it
                setTimeout(() => setOpen(false), 2000);
            }
        } catch (error: any) {
            toast.error(error.response?.data?.error || "Failed to start campaign");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {trigger || (
                    <Button variant="default" className="gap-2 bg-primary hover:bg-primary/90 text-black border-none shadow-md">
                        <Send className="w-4 h-4" />
                        SEND BULK MESSAGE
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Send className="w-5 h-5 text-primary" />
                        Send Bulk Message ({platform === 'messenger' ? 'Messenger' : 'WhatsApp'})
                    </DialogTitle>
                </DialogHeader>
                
                <div className="grid gap-6 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="message">Your Message</Label>
                        <Textarea
                            id="message"
                            placeholder="Write your marketing message here..."
                            className="min-h-[120px]"
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            AI will automatically rewrite this message for each recipient to avoid spam detection.
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="imageUrl" className="flex items-center gap-2">
                            <ImageIcon className="w-4 h-4" />
                            Image URL (Optional)
                        </Label>
                        <Input
                            id="imageUrl"
                            placeholder="https://example.com/image.jpg"
                            value={imageUrl}
                            onChange={(e) => setImageUrl(e.target.value)}
                        />
                    </div>

                    <div className="flex flex-col gap-3 p-3 bg-muted/50 rounded-lg border border-dashed">
                        <div className="flex items-center space-x-2">
                            <Checkbox 
                                id="today-only" 
                                checked={true} 
                                disabled 
                            />
                            <Label htmlFor="today-only" className="text-sm font-medium">
                                Target Today's Contacts Only (Recommended)
                            </Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <Checkbox 
                                id="exclude-buyers" 
                                checked={excludeBuyers}
                                onCheckedChange={(checked) => setExcludeBuyers(!!checked)}
                            />
                            <Label htmlFor="exclude-buyers" className="text-sm font-medium">
                                Exclude users who already purchased
                            </Label>
                        </div>
                    </div>

                    {campaignId && (
                        <div className="flex items-center gap-2 p-3 bg-green-50 text-green-700 rounded-md border border-green-200">
                            <CheckCircle2 className="w-5 h-5" />
                            <span className="text-sm font-medium">Campaign is running in background!</span>
                        </div>
                    )}

                    <Button 
                        onClick={handleStartCampaign} 
                        disabled={loading || !message.trim()} 
                        className="w-full h-12 text-lg bg-primary hover:bg-primary/90 text-black"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                Starting...
                            </>
                        ) : (
                            <>
                                <Send className="mr-2 h-5 w-5" />
                                Start Campaign
                            </>
                        )}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
