import Logo from "@/components/Logo";

export default function BrandingPreview() {
  return (
    <div className="min-h-screen bg-[#020617] flex items-center justify-center">
      <div className="relative flex items-center justify-center">
        <Logo size="lg" accentColor="#00ff88" />
        <div
          className="absolute -inset-10 blur-[60px] rounded-full opacity-30 pointer-events-none"
          style={{ backgroundColor: "#00ff88" }}
        />
      </div>
    </div>
  );
}
