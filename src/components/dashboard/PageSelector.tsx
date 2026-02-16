import { useMessenger } from "@/context/MessengerContext";
import { useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Facebook, PlusCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";

export function PageSelector() {
  const context = useMessenger();
  const navigate = useNavigate();

  if (!context) return null;

  const { pages, currentPage, setCurrentPage } = context;

  const handleValueChange = (value: string) => {
    if (value === "add_new") {
      navigate("/dashboard/messenger/integration");
      return;
    }
    const selected = pages.find((p) => p.page_id === value);
    if (selected) {
      setCurrentPage(selected);
      
      // Auto-connect DB logic
      if (selected.db_id) {
          localStorage.setItem("active_fb_db_id", selected.db_id.toString());
          localStorage.setItem("active_fb_page_id", selected.page_id);
          window.dispatchEvent(new Event("db-connection-changed"));
      }
    }
  };

  // Sync LocalStorage when currentPage changes
  useEffect(() => {
    if (currentPage) {
        localStorage.setItem("active_fb_page_id", currentPage.page_id);
        if (currentPage.db_id) {
            localStorage.setItem("active_fb_db_id", currentPage.db_id.toString());
            window.dispatchEvent(new Event("db-connection-changed"));
        }
    }
  }, [currentPage]);

  if (pages.length === 0) {
    return (
       <div 
         className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
         onClick={() => navigate("/dashboard/messenger/integration")}
       >
         <PlusCircle size={16} />
         <span>Connect Page</span>
       </div>
    );
  }

  return (
    <div className="px-2 mb-4">
      <label className="text-xs font-medium text-muted-foreground mb-1.5 block px-1">
        Active Page
      </label>
      <Select
        value={currentPage?.page_id || ""}
        onValueChange={handleValueChange}
      >
        <SelectTrigger className="w-full bg-sidebar-accent border-sidebar-border text-sidebar-foreground h-9">
          <div className="flex items-center gap-2 overflow-hidden">
            <Facebook size={14} className="shrink-0 text-blue-500" />
            <SelectValue placeholder="Select a page" />
          </div>
        </SelectTrigger>
        <SelectContent>
          {pages.map((page) => (
            <SelectItem key={page.page_id} value={page.page_id}>
              {page.name}
            </SelectItem>
          ))}
          <SelectItem value="add_new" className="text-primary font-medium">
            <div className="flex items-center gap-2">
              <PlusCircle size={14} />
              <span>Connect New</span>
            </div>
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
