import { cn } from "@/lib/utils";
import logoImage from "@/assets/logo.png";

interface LogoProps {
  className?: string;
  showText?: boolean;
  animated?: boolean;
  size?: "sm" | "md" | "lg";
  accentColor?: string;
}

const Logo = ({ className, showText = true, animated = true, size = "md", accentColor = "#A855F7" }: LogoProps) => {
  const sizeClasses = {
    sm: "h-12 w-14",
    md: "h-15 w-20",
    lg: "h-24 w-26"
  };

  const textSizeClasses = {
    sm: "text-lg",
    md: "text-2xl",
    lg: "text-3xl"
  };

  const subtextSizeClasses = {
    sm: "text-[8px]",
    md: "text-[12px]",
    lg: "text-sm"
  };

  return (
    <div className={cn("flex items-center gap-4", className)}>
      <div className={cn(
        "relative flex items-center justify-center",
        sizeClasses[size]
      )}>
        {/* Glowing Background Effect */}
        {animated && (
          <div
            className="absolute inset-0 rounded-full blur-[20px] animate-pulse pointer-events-none"
            style={{ backgroundColor: accentColor, opacity: 0.25 }}
          />
        )}
        
        <div className={cn(
          "w-full h-full flex items-center justify-center relative z-10",
          animated && "animate-spin-slow"
        )}>
          <img 
            src={logoImage} 
            alt="SalesmanChatbot Logo" 
            className="object-contain w-full h-full brightness-0 invert opacity-100 scale-125"
          />
        </div>
      </div>
      {showText && (
        <div className="flex flex-col">
          <span className={cn("font-black tracking-tighter text-white uppercase leading-none mb-1", textSizeClasses[size])}>
            SALESMAN<span style={{ color: accentColor }}>CHATBOT</span>
          </span>
          <span className={cn("uppercase tracking-[0.4em] text-slate-400 font-black", subtextSizeClasses[size])}>
            AI Powered Sales
          </span>
        </div>
      )}
    </div>
  );
};

export default Logo;
