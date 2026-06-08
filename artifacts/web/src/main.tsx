import { createRoot } from "react-dom/client";
import { setBaseUrl } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";
// Initialize i18n (loads translations, restores the saved language, and
// syncs <html dir/lang>) before the app renders.
import "./i18n";

// Wire the generated API client to the right origin.
// - In dev (Vite proxy mounted at /api), leave baseUrl unset so requests
//   stay same-origin and hit the proxy.
// - In production / Docker, VITE_API_BASE points at the API host.
const apiBase = import.meta.env.VITE_API_BASE;
if (apiBase) setBaseUrl(apiBase);

createRoot(document.getElementById("root")!).render(<App />);
