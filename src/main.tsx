import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
if (import.meta.env.MODE === "production" && localStorage.getItem("debug") !== "true") {
  const noop = () => {};
  console.log = noop;
  console.info = noop;
  console.warn = noop;
}

createRoot(document.getElementById("root")!).render(<App />);
