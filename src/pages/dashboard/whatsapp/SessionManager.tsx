import { useWhatsApp } from "@/context/WhatsAppContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { WorkspaceSwitcher } from "@/components/dashboard/WorkspaceSwitcher";
import WhatsAppOfficialIntegration from "@/components/dashboard/whatsapp/WhatsAppOfficialIntegration";
import {
  RefreshCw,
  Smartphone,
} from "lucide-react";

export default function SessionManager() {
  const { sessions, refreshSessions, loading } = useWhatsApp();

  const officialSessions = sessions.filter(
    (session) => session.provider_type === "official" || session.name.startsWith("official_")
  );

  const scrollToConnectCard = () => {
    document.getElementById("whatsapp-connect-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="space-y-6 animate-fade-in -m-4 md:-m-6 lg:-m-6 p-4 md:p-6 lg:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <WorkspaceSwitcher platform="whatsapp" />
        </div>

        <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
          <Button variant="outline" onClick={() => refreshSessions()} className="w-full sm:w-auto border-white/10 bg-[#121212]">
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button onClick={scrollToConnectCard} className="w-full sm:w-auto bg-primary text-black hover:bg-primary/90">
            <Smartphone className="mr-2 h-4 w-4" />
            {officialSessions.length > 0 ? "Connect Another Number" : "Connect WhatsApp"}
          </Button>
        </div>
      </div>

      <Card id="whatsapp-connect-card" className="bg-[#121212] border-white/5">
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-white">Connect WhatsApp</CardTitle>
              <CardDescription className="mt-1 text-slate-400">
                Facebook-style official onboarding, reconnect, and disconnect management in one place.
              </CardDescription>
            </div>
            <Badge className="bg-primary/15 text-primary hover:bg-primary/15 border-primary/20">Official</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-4 md:p-5">
            <WhatsAppOfficialIntegration />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
