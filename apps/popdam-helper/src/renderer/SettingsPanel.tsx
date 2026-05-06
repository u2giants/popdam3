import React, { useState, useEffect } from "react";
import type { LocalConfig, RootMapping } from "../shared/types";

interface Props {
  onBack: () => void;
}

const EMPTY_MAPPING: RootMapping = {
  root_id: "",
  display_name: "",
  local_path: "",
  marker_verified: false,
};

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
        await window.popdam.saveSynologyCredentials({ username: synologyUser, password: synologyPass });
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

  function updateRoot(index: number, field: keyof RootMapping, value: string | boolean): void {
    if (!config) return;
    const mappings = [...config.rootMappings];
    mappings[index] = { ...mappings[index], [field]: value };
    setConfig({ ...config, rootMappings: mappings });
  }

  function addRoot(): void {
    if (!config) return;
    setConfig({ ...config, rootMappings: [...config.rootMappings, { ...EMPTY_MAPPING }] });
  }

  function removeRoot(index: number): void {
    if (!config) return;
    const mappings = config.rootMappings.filter((_, i) => i !== index);
    setConfig({ ...config, rootMappings: mappings });
  }

  async function browseForFolder(index: number): Promise<void> {
    const res = await window.popdam.browseForFolder();
    if (res.ok && res.data) updateRoot(index, "local_path", res.data);
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
          <div style={{ display: "flex", gap: 6 }}>
            <input
              style={{ flex: 1 }}
              value={config.workspacePath}
              onChange={(e) => setConfig({ ...config, workspacePath: e.target.value })}
              placeholder="C:\POP-DAM-Workspace"
            />
            <button
              style={{ whiteSpace: "nowrap" }}
              onClick={async () => {
                const res = await window.popdam.browseForFolder();
                if (res.ok && res.data) setConfig({ ...config, workspacePath: res.data });
              }}
            >
              Browse…
            </button>
          </div>
          <div className="meta" style={{ marginTop: 4 }}>
            Where checked-out files are saved on this computer.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
          <span className="section-label" style={{ flex: 1 }}>NAS Folder Mappings</span>
          <button onClick={addRoot} style={{ padding: "2px 10px", fontSize: 12 }}>+ Add</button>
        </div>

        <div className="meta" style={{ marginBottom: 10 }}>
          Map each NAS root to where it appears on this computer (SMB drive, Synology Drive client,
          Seafile, etc.). The <strong>Root ID</strong> must match what the server expects — ask your
          admin or check the Directory Browser in the web DAM.
        </div>

        {config.rootMappings.length === 0 && (
          <div className="empty-state" style={{ marginBottom: 10 }}>
            No mappings yet. Click <strong>+ Add</strong> to add one.
          </div>
        )}

        {config.rootMappings.map((mapping, i) => (
          <div key={i} className="checkout-card" style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span className="filename">{mapping.display_name || mapping.root_id || `Root ${i + 1}`}</span>
              <button
                onClick={() => removeRoot(i)}
                style={{ padding: "1px 8px", fontSize: 11, opacity: 0.7 }}
              >
                Remove
              </button>
            </div>
            <div className="field" style={{ marginBottom: 4 }}>
              <label>Root ID</label>
              <input
                value={mapping.root_id}
                onChange={(e) => updateRoot(i, "root_id", e.target.value)}
                placeholder="e.g. design_hot"
              />
            </div>
            <div className="field" style={{ marginBottom: 4 }}>
              <label>Display Name</label>
              <input
                value={mapping.display_name}
                onChange={(e) => updateRoot(i, "display_name", e.target.value)}
                placeholder="e.g. Design Hot"
              />
            </div>
            <div className="field" style={{ marginBottom: 4 }}>
              <label>Local Path</label>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  style={{ flex: 1 }}
                  value={mapping.local_path}
                  onChange={(e) => updateRoot(i, "local_path", e.target.value)}
                  placeholder={`e.g. Z:\\design_hot  or  /Volumes/design_hot`}
                />
                <button
                  style={{ whiteSpace: "nowrap" }}
                  onClick={() => browseForFolder(i)}
                >
                  Browse…
                </button>
              </div>
            </div>
            {mapping.local_path && (
              <div className="meta">
                {mapping.marker_verified ? "✓ Marker verified" : "Not yet verified — will check on next browse"}
              </div>
            )}
          </div>
        ))}

        <div className="section-label" style={{ marginBottom: 8 }}>Synology Credentials</div>
        <div className="checkout-card">
          <div className="meta" style={{ marginBottom: 8 }}>
            {hasCreds
              ? "Credentials saved. Enter new values to update."
              : "Required for file check-in uploads."}
          </div>
          <div className="field" style={{ marginBottom: 6 }}>
            <label>Synology Username</label>
            <input
              value={synologyUser}
              onChange={(e) => setSynologyUser(e.target.value)}
              placeholder={hasCreds ? "(unchanged)" : "DOMAIN\\username or just username"}
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
