import React, { useState, useEffect } from 'react';
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

  useEffect(() => {
    const sessionInfoListener = (event: MessageEvent) => {
      if (!event.origin?.endsWith('facebook.com')) return;
      
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data.type === 'WA_EMBEDDED_SIGNUP') {
          if (data.event === 'FINISH') {
            const { phone_number_id, waba_id } = data.data;
            console.log('Embedded Signup Success:', { phone_number_id, waba_id });
            // The actual token exchange happens after FB.login callback
          } else if (data.event === 'ERROR') {
            console.error('Embedded Signup Error:', data.data.error_message);
            toast.error(`Setup Error: ${data.data.error_message}`);
          } else if (data.event === 'CANCEL') {
            console.warn('Embedded Signup Cancelled at step:', data.data.current_step);
          }
        }
      } catch (err) {
        // Not our message
      }
    };

    window.addEventListener('message', sessionInfoListener);
    return () => window.removeEventListener('message', sessionInfoListener);
  }, []);

  const launchWhatsAppSignup = () => {
    const appId = '3741087806186945';
    const configId = '1592300178695434';
    
    // Modern v4 Extras for Coexistence
    const extras = {
      sessionInfoVersion: 3,
      setup: {
        business: {
          name: "Automation Hub BD"
        }
      },
      features: {
        whatsapp_business_app_coexistence: true
      }
    };

    // Construct the direct Meta-hosted onboarding URL
    const signupUrl = `https://business.facebook.com/messaging/whatsapp/onboard/?app_id=${appId}&config_id=${configId}&extras=${encodeURIComponent(JSON.stringify(extras))}`;

    // Open in a popup window
    const width = 600;
    const height = 700;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;

    const popup = window.open(
      signupUrl,
      'WhatsAppSignup',
      `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,status=yes`
    );

    // Set loading state
    setLoading(true);

    // Poll for popup close or success message
    const checkPopup = setInterval(() => {
      if (!popup || popup.closed) {
        clearInterval(checkPopup);
        setLoading(false);
        // Note: The message listener will still handle the 'FINISH' event
      }
    }, 1000);
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
