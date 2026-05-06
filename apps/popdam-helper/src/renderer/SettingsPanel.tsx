import React, { useState, useEffect } from "react";
import type { LocalConfig, RootMapping } from "../shared/types";

interface Props {
  onBack: () => void;
}

export default function SettingsPanel({ onBack }: Props): React.ReactElement {
  const [config, setConfig] = useState<LocalConfig | null>(null);
  const [synologyUser, setSynologyUser] = useState("");
  const [synologyPass, setSynologyPass] = useState("");
  const [hasCreds, setHasCreds] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.popdam.getConfig().then((res) => {
      if (res.ok && res.data) setConfig(res.data);
    });
    window.popdam.hasSynologyCredentials().then((res) => {
      if (res.ok) setHasCreds(!!res.data);
    });
  }, []);

  async function handleSave(): Promise<void> {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      await window.popdam.saveConfig(config);
      if (synologyUser && synologyPass) {
        await window.popdam.saveSynologyCredentials({
          username: synologyUser,
          password: synologyPass,
        });
        setHasCreds(true);
        setSynologyUser("");
        setSynologyPass("");
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  function updateRoot(index: number, field: keyof RootMapping, value: string): void {
    if (!config) return;
    const mappings = [...config.rootMappings];
    mappings[index] = { ...mappings[index], [field]: value };
    setConfig({ ...config, rootMappings: mappings });
  }

  if (!config) return <div className="content"><div className="empty-state">Loading…</div></div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="titlebar">
        <button onClick={onBack} style={{ padding: "2px 8px", marginRight: 4 }}>←</button>
        <h1>Settings</h1>
      </div>

      <div className="content settings-panel">
        {error && <div className="error-msg">{error}</div>}

        <div className="field">
          <label>DAM URL</label>
          <input
            value={config.damUrl}
            onChange={(e) => setConfig({ ...config, damUrl: e.target.value })}
            placeholder="https://dam.designflow.app"
          />
        </div>

        <div className="field">
          <label>Local Workspace Folder</label>
          <input
            value={config.workspacePath}
            onChange={(e) => setConfig({ ...config, workspacePath: e.target.value })}
            placeholder="C:\POP-DAM-Workspace"
          />
        </div>

        <div className="section-label" style={{ marginBottom: 8 }}>Folder Mappings</div>

        {config.rootMappings.length === 0 && (
          <div className="empty-state" style={{ marginBottom: 10 }}>
            No folder mappings configured. Your IT admin will set these up.
          </div>
        )}

        {config.rootMappings.map((mapping, i) => (
          <div key={mapping.root_id} className="checkout-card" style={{ marginBottom: 8 }}>
            <div className="filename">{mapping.display_name || mapping.root_id}</div>
            <div className="field" style={{ marginBottom: 6, marginTop: 6 }}>
              <label>Local Path</label>
              <input
                value={mapping.local_path}
                onChange={(e) => updateRoot(i, "local_path", e.target.value)}
                placeholder={`e.g. C:\\Users\\Maria\\Seafile\\Design_Hot`}
              />
            </div>
            <div className="meta">
              {mapping.marker_verified ? "✓ Marker verified" : "⚠ Not yet verified"}
            </div>
          </div>
        ))}

        <div className="section-label" style={{ marginBottom: 8 }}>Synology Credentials</div>
        <div className="checkout-card">
          <div className="meta" style={{ marginBottom: 8 }}>
            {hasCreds
              ? "Credentials saved. Enter new values to update."
              : "Required for file check-in uploads to NYC."}
          </div>
          <div className="field" style={{ marginBottom: 6 }}>
            <label>Synology Username</label>
            <input
              value={synologyUser}
              onChange={(e) => setSynologyUser(e.target.value)}
              placeholder={hasCreds ? "(unchanged)" : "DOMAIN\\username"}
              autoComplete="off"
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Synology Password</label>
            <input
              type="password"
              value={synologyPass}
              onChange={(e) => setSynologyPass(e.target.value)}
              placeholder={hasCreds ? "(unchanged)" : "Password"}
              autoComplete="new-password"
            />
          </div>
        </div>
      </div>

      <div className="footer">
        <button onClick={onBack}>Cancel</button>
        <button className="primary" onClick={handleSave} disabled={saving} style={{ flex: 1 }}>
          {saved ? "Saved!" : saving ? "Saving…" : "Save Settings"}
        </button>
      </div>
    </div>
  );
}
