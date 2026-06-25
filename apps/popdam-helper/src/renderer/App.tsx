import React, { useState, useEffect } from "react";
import TrayPanel from "./TrayPanel";
import SettingsPanel from "./SettingsPanel";

type View = "tray" | "settings";

export default function App(): React.ReactElement {
  const [view, setView] = useState<View>("tray");
  // Section to scroll to when Settings is opened programmatically (e.g. main
  // asks us to open the Synology credentials field after a failed check-in).
  const [focusSection, setFocusSection] = useState<string | undefined>(undefined);

  useEffect(() => {
    return window.popdam.onOpenSettings((section) => {
      setFocusSection(section);
      setView("settings");
    });
  }, []);

  return view === "settings" ? (
    <SettingsPanel
      onBack={() => { setView("tray"); setFocusSection(undefined); }}
      focusSection={focusSection}
    />
  ) : (
    <TrayPanel onOpenSettings={() => setView("settings")} />
  );
}
