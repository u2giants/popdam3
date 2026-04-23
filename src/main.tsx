import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { CURRENT_APP } from "./lib/app-mode";

document.title = `${CURRENT_APP.name} – ${CURRENT_APP.tagline}`;

createRoot(document.getElementById("root")!).render(<App />);
