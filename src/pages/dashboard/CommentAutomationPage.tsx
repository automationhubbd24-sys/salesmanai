import { useLocation } from "react-router-dom";
import { CommentAutomationSettings } from "@/components/dashboard/CommentAutomationSettings";

export default function CommentAutomationPage() {
  const location = useLocation();
  const platform = location.pathname.includes("/instagram/") ? "instagram" : "messenger";
  const resourceId = platform === "instagram" ? localStorage.getItem("active_ig_account_id") : localStorage.getItem("active_fb_page_id");

  return <main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6"><CommentAutomationSettings platform={platform} resourceId={resourceId} /></main>;
}
