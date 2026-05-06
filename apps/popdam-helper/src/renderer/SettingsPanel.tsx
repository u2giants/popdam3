import React, { useState, useEffect } from "react";
import type { LocalConfig, RootMapping, ValidationResult } from "../shared/types";

interface ServerRoot {
  root_id: string;
  display_name: string;
  server_path: string;
}

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

  const [serverRoots, setServerRoots] = useState<ServerRoot[] | null>(null);
  const [rootsFetching, setRootsFetching] = useState(false);
  const [rootsFetchError, setRootsFetchError] = useState<string | null>(null);
  // local_path per root_id, edited independently of config
  const [localPaths, setLocalPaths] = useState<Record<string, string>>({});
  // validation result per root_id
  type RootValidState =
    | { status: "idle" }
    | { status: "validating" }
    | { status: "ok" }
    | { status: "corrected"; from: string; to: string }
    | { status: "error"; message: string };
  const [rootValidStates, setRootValidStates] = useState<Record<string, RootValidState>>({});

  async function fetchRoots(): Promise<void> {
    setRootsFetching(true);
    setRootsFetchError(null);
    try {
      const res = await window.popdam.fetchServerRoots();
      if (res.ok && res.data) {
        setServerRoots(res.data);
      } else {
        setRootsFetchError(res.error ?? "Could not load folder list from server.");
      }
    } catch (e) {
      setRootsFetchError(String(e));
    } finally {
      setRootsFetching(false);
    }
  }

  useEffect(() => {
    window.popdam.getConfig().then((res) => {
      if (res.ok && res.data) {
        setConfig(res.data);
        const paths: Record<string, string> = {};
        for (const m of res.data.rootMappings) paths[m.root_id] = m.local_path;
        setLocalPaths(paths);
        if (res.data.damUrl) fetchRoots();
      }
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
      // Build rootMappings: use server roots when available (authoritative list),
      // otherwise keep existing saved mappings (e.g. if server was unreachable).
      let rootMappings: RootMapping[];
      const roots = serverRoots ?? config.rootMappings.map(m => ({
        root_id: m.root_id,
        display_name: m.display_name,
        server_path: "",
      }));
      rootMappings = roots.map((r) => {
        const newPath = localPaths[r.root_id] ?? "";
        const prev = config.rootMappings.find(m => m.root_id === r.root_id);
        const pathChanged = prev?.local_path !== newPath;
        const vState = rootValidStates[r.root_id];
        const markerVerified = (vState?.status === "ok" || vState?.status === "corrected")
          ? true
          : pathChanged ? false : (prev?.marker_verified ?? false);
        return {
          root_id: r.root_id,
          display_name: r.display_name,
          local_path: newPath,
          marker_verified: markerVerified,
        };
      });

      await window.popdam.saveConfig({ ...config, rootMappings });

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

  async function browseForRoot(rootId: string): Promise<void> {
    const res = await window.popdam.browseForFolder();
    if (!res.ok || !res.data) return;
    const chosen = res.data;

    setRootValidStates(prev => ({ ...prev, [rootId]: { status: "validating" } }));
    setLocalPaths(prev => ({ ...prev, [rootId]: chosen }));

    const vRes = await window.popdam.validateRoot(chosen, rootId);
    if (!vRes.ok || !vRes.data) {
      setRootValidStates(prev => ({ ...prev, [rootId]: { status: "error", message: "Validation failed — try again." } }));
      return;
    }

    const v: ValidationResult = vRes.data;
    if (v.ok) {
      setRootValidStates(prev => ({ ...prev, [rootId]: { status: "ok" } }));
    } else if (v.reason === "too_deep" || v.reason === "too_shallow") {
      // Auto-correct to the right folder level — no user decision needed
      setLocalPaths(prev => ({ ...prev, [rootId]: v.suggestedPath }));
      setRootValidStates(prev => ({ ...prev, [rootId]: { status: "corrected", from: chosen, to: v.suggestedPath } }));
    } else {
      setRootValidStates(prev => ({ ...prev, [rootId]: { status: "error", message: v.message } }));
    }
  }

  async function revalidateRoot(rootId: string, path: string): Promise<void> {
    if (!path) return;
    setRootValidStates(prev => ({ ...prev, [rootId]: { status: "validating" } }));
    const vRes = await window.popdam.validateRoot(path, rootId);
    if (!vRes.ok || !vRes.data) {
      setRootValidStates(prev => ({ ...prev, [rootId]: { status: "error", message: "Validation failed — try again." } }));
      return;
    }
    const v: ValidationResult = vRes.data;
    if (v.ok) {
      setRootValidStates(prev => ({ ...prev, [rootId]: { status: "ok" } }));
    } else if (v.reason === "too_deep" || v.reason === "too_shallow") {
      setLocalPaths(prev => ({ ...prev, [rootId]: v.suggestedPath }));
      setRootValidStates(prev => ({ ...prev, [rootId]: { status: "corrected", from: path, to: v.suggestedPath } }));
    } else {
      setRootValidStates(prev => ({ ...prev, [rootId]: { status: "error", message: v.message } }));
    }
  }

  // Prefer server roots; fall back to whatever is already saved locally.
  const displayRoots: Array<{ root_id: string; display_name: string }> =
    serverRoots ??
    (config?.rootMappings.map(m => ({ root_id: m.root_id, display_name: m.display_name })) ?? []);

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

        <div className="section-label" style={{ marginBottom: 8 }}>Your NAS Folders</div>

        {!config.damUrl && (
          <div className="meta" style={{ marginBottom: 10 }}>
            Enter your DAM URL above to load your folder list.
          </div>
        )}

        {config.damUrl && rootsFetching && (
          <div className="meta" style={{ marginBottom: 10 }}>Loading folder list…</div>
        )}

        {config.damUrl && rootsFetchError && !rootsFetching && (
          <div style={{ marginBottom: 10 }}>
            <div className="meta" style={{ color: "var(--color-error, #c00)", marginBottom: 4 }}>
              {rootsFetchError}
            </div>
            <button style={{ padding: "2px 10px", fontSize: 12 }} onClick={fetchRoots}>
              Retry
            </button>
          </div>
        )}

        {config.damUrl && !rootsFetching && !rootsFetchError && displayRoots.length === 0 && (
          <div className="empty-state" style={{ marginBottom: 10 }}>
            No folders have been configured on the server yet.
          </div>
        )}

        {displayRoots.map((root) => {
          const localPath = localPaths[root.root_id] ?? "";
          const vState = rootValidStates[root.root_id] ?? { status: "idle" };
          return (
            <div key={root.root_id} className="checkout-card" style={{ marginBottom: 8 }}>
              <div className="filename" style={{ marginBottom: 6 }}>
                {root.display_name || root.root_id}
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Local folder on this computer</label>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    style={{ flex: 1 }}
                    value={localPath}
                    onChange={(e) => {
                      setLocalPaths(prev => ({ ...prev, [root.root_id]: e.target.value }));
                      setRootValidStates(prev => ({ ...prev, [root.root_id]: { status: "idle" } }));
                    }}
                    placeholder={`e.g. Z:\\${root.root_id}  or  /Volumes/${root.root_id}`}
                  />
                  <button style={{ whiteSpace: "nowrap" }} onClick={() => browseForRoot(root.root_id)}>
                    Browse…
                  </button>
                </div>
              </div>
              {localPath && vState.status === "idle" && (
                <div className="meta" style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 8 }}>
                  <span>Not yet verified</span>
                  <button style={{ padding: "1px 8px", fontSize: 11 }} onClick={() => revalidateRoot(root.root_id, localPath)}>
                    Verify
                  </button>
                </div>
              )}
              {vState.status === "validating" && (
                <div className="meta" style={{ marginTop: 4 }}>Checking folder…</div>
              )}
              {vState.status === "ok" && (
                <div className="meta" style={{ marginTop: 4, color: "var(--color-success, #0a0)" }}>✓ Correct folder confirmed</div>
              )}
              {vState.status === "corrected" && (
                <div className="meta" style={{ marginTop: 4, color: "var(--color-success, #0a0)" }}>
                  ✓ Folder level corrected automatically
                </div>
              )}
              {vState.status === "error" && (
                <div className="meta" style={{ marginTop: 4, color: "var(--color-error, #c00)" }}>
                  {vState.message}
                </div>
              )}
            </div>
          );
        })}

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
