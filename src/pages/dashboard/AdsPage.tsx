import { Lock } from "lucide-react";

export default function AdsPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-4">
      <div className="p-4 rounded-full bg-primary/10">
        <Lock className="h-12 w-12 text-primary" />
      </div>
      <h2 className="text-3xl font-bold">Ads Library Coming Soon</h2>
      <p className="text-muted-foreground max-w-md">
        We are working hard to bring you advanced ad management features. Stay tuned for updates!
      </p>
    </div>
  );
}
