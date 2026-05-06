import React, { useState, useEffect } from "react";
import TrayPanel from "./TrayPanel";
import SettingsPanel from "./SettingsPanel";

type View = "tray" | "settings";

export default function App(): React.ReactElement {
  const [view, setView] = useState<View>("tray");

  return view === "settings" ? (
    <SettingsPanel onBack={() => setView("tray")} />
  ) : (
    <TrayPanel onOpenSettings={() => setView("settings")} />
  );
}
