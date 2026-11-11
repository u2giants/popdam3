import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { CURRENT_APP } from "./lib/app-mode";
import { sandboxAutoLogin } from "./lib/sandbox-auto-login";

document.title = `${CURRENT_APP.name} – ${CURRENT_APP.tagline}`;

void sandboxAutoLogin().finally(() => {
  createRoot(document.getElementById("root")!).render(<App />);
});
