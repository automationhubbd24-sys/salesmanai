import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { BACKEND_URL } from "@/config";

declare global {
  interface Window {
    FB: any;
  }
}

export default function WhatsAppOfficialIntegration() {
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [wabaInfo, setWabaInfo] = useState<any>(null);

  const launchWhatsAppSignup = () => {
    setLoading(true);
    
    // Using the Embedded Signup v4 standard
    window.FB.login((response: any) => {
      if (response.authResponse) {
        const code = response.authResponse.code;
        handleSignupCompletion(code);
      } else {
        setLoading(false);
        toast.error("Facebook login failed or was cancelled.");
      }
    }, {
      config_id: '1592300178695434', 
      response_type: 'code',
      override_default_response_type: true,
      extras: {
        sessionInfoVersion: 3,
        version: 'v4',
        setup: {
          business: {
            name: "Automation Hub BD"
          }
        }
      }
    });
  };

  const handleSignupCompletion = async (code: string) => {
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`${BACKEND_URL}/api/whatsapp/official/signup-complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ code })
      });

      const data = await res.json();
      if (data.success) {
        setConnected(true);
        setWabaInfo(data.data);
        toast.success("Official WhatsApp connected successfully!");
      } else {
        throw new Error(data.error || "Failed to connect official WhatsApp");
      }
    } catch (error: any) {
      console.error("Signup error:", error);
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {connected ? (
        <div className="space-y-4">
          <div className="bg-green-500/10 border border-green-500/20 p-4 rounded-lg flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5" />
            <div>
              <p className="font-medium text-green-500">Official Connection Active</p>
              <p className="text-sm text-muted-foreground">Your chatbot is now using the official Meta Cloud API.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="p-3 bg-white/5 rounded-md">
              <p className="text-muted-foreground text-xs">WABA ID</p>
              <p className="font-mono">{wabaInfo?.wabaId || '********'}</p>
            </div>
            <div className="p-3 bg-white/5 rounded-md">
              <p className="text-muted-foreground text-xs">Phone ID</p>
              <p className="font-mono">{wabaInfo?.phoneNumberId || '********'}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Button 
            onClick={launchWhatsAppSignup} 
            disabled={loading}
            className="w-full bg-[#1877F2] hover:bg-[#166fe5] text-white font-semibold py-6"
          >
            {loading ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <img src="https://www.facebook.com/favicon.ico" className="w-5 h-5 mr-2 invert" alt="FB" />
            )}
            Connect with Facebook
          </Button>
          <p className="text-[10px] text-center text-muted-foreground uppercase tracking-widest">
            Powered by Meta Embedded Signup
          </p>
        </div>
      )}
    </div>
  );
}
