import { Navigate, useParams } from "react-router-dom";
import SessionManager from "@/pages/dashboard/whatsapp/SessionManager";
import MessengerIntegrationPage from "@/pages/dashboard/messenger/MessengerIntegrationPage";

export default function IntegrationPage() {
  const { platform } = useParams();

  if (platform === "messenger") {
    return <MessengerIntegrationPage />;
  }

  if (!platform || platform === "whatsapp") {
    return <SessionManager />;
  }

  return <Navigate to="/dashboard" replace />;
}
