import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Bell, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { BACKEND_URL } from "@/config";

interface OrderNotificationModalProps {
    dbId: number;
    platform: 'messenger' | 'whatsapp';
    trigger?: React.ReactNode;
}

export function OrderNotificationModal({ dbId, platform, trigger }: OrderNotificationModalProps) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    
    const [emailEnabled, setEmailEnabled] = useState(false);
    const [adminEmail, setAdminEmail] = useState("");

    useEffect(() => {
        if (open && dbId) {
            fetchConfig();
        }
    }, [open, dbId]);

    const fetchConfig = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem("auth_token");
            const endpoint = platform === 'messenger' 
                ? `${BACKEND_URL}/api/messenger/config/${dbId}`
                : `${BACKEND_URL}/api/whatsapp/config/${dbId}`;
                
            const res = await fetch(endpoint, {
                headers: { Authorization: `Bearer ${token}` }
            });
            
            if (res.ok) {
                const data = await res.json();
                setEmailEnabled(Boolean(data.order_email_confirmation_enabled));
                setAdminEmail(data.admin_notification_email || "");
            }
        } catch (e) {
            console.warn("Failed to load email config", e);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const token = localStorage.getItem("auth_token");
            const endpoint = platform === 'messenger' 
                ? `${BACKEND_URL}/api/messenger/config/${dbId}`
                : `${BACKEND_URL}/api/whatsapp/config/${dbId}`;

            const res = await fetch(endpoint, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    order_email_confirmation_enabled: emailEnabled,
                    admin_notification_email: adminEmail
                })
            });

            if (!res.ok) throw new Error("Failed to save settings");
            
            toast.success("Notification settings updated");
            setTimeout(() => setOpen(false), 500);
        } catch (e: any) {
            toast.error(e.message || "Failed to save settings");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {trigger || (
                    <Button variant="outline" className="gap-2">
                        <Bell className="w-4 h-4" />
                        NOTIFICATIONS
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[450px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Mail className="w-5 h-5 text-primary" />
                        Order Notifications
                    </DialogTitle>
                </DialogHeader>
                
                {loading ? (
                    <div className="flex justify-center py-8">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                ) : (
                    <div className="grid gap-6 py-4">
                        <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/30">
                            <div className="space-y-0.5">
                                <Label className="text-base">Email Notifications</Label>
                                <p className="text-sm text-muted-foreground">
                                    Receive an email when a new order is placed.
                                </p>
                            </div>
                            <Switch 
                                checked={emailEnabled}
                                onCheckedChange={setEmailEnabled}
                            />
                        </div>

                        {emailEnabled && (
                            <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                                <Label htmlFor="adminEmail">Your Email Address</Label>
                                <Input
                                    id="adminEmail"
                                    placeholder="admin@example.com"
                                    value={adminEmail}
                                    onChange={(e) => setAdminEmail(e.target.value)}
                                />
                                <p className="text-xs text-muted-foreground">
                                    We'll send order details to this email immediately.
                                </p>
                            </div>
                        )}

                        <Button 
                            onClick={handleSave} 
                            disabled={saving} 
                            className="w-full bg-primary hover:bg-primary/90 text-black font-medium"
                        >
                            {saving ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Saving...
                                </>
                            ) : (
                                "Save Changes"
                            )}
                        </Button>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
