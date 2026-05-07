import React, { useState, useEffect, useCallback } from "react";
import type { CheckoutRecord } from "../shared/types";

declare global {
  interface Window {
    popdam: import("../preload/index").PopDamAPI;
  }
}

interface Props {
  onOpenSettings: () => void;
}

interface CheckoutState {
  checkouts: CheckoutRecord[];
  uploadJobs: { checkoutId: string; status: string; retryCount: number }[];
}

function statusLabel(status: CheckoutRecord["status"]): string {
  switch (status) {
    case "active":          return "Checked out";
    case "checkin_queued":  return "Queuing check-in…";
    case "uploading":       return "Uploading…";
    case "verifying":       return "Verifying…";
    case "error":           return "Error";
    case "conflict":        return "Conflict!";
    default:                return status;
  }
}

function statusBadgeClass(status: CheckoutRecord["status"]): string {
  if (status === "error" || status === "conflict") return "badge error";
  if (status === "uploading" || status === "verifying") return "badge uploading";
  if (status === "checkin_queued") return "badge queued";
  return "badge active";
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function TrayPanel({ onOpenSettings }: Props): React.ReactElement {
  const [state, setState] = useState<CheckoutState>({ checkouts: [], uploadJobs: [] });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authState, setAuthState] = useState<{ loggedIn: boolean; email: string | null }>({ loggedIn: true, email: null });

  const refresh = useCallback(async () => {
    const res = await window.popdam.getCheckouts();
    if (res.ok && res.data) {
      setState(res.data as CheckoutState);
    }
    const auth = await window.popdam.getAuthState();
    setAuthState({
      loggedIn: !!auth.data?.loggedIn,
      email: auth.data?.email ?? null,
    });
  }, []);

  useEffect(() => {
    refresh();
    const unsubCheckouts = window.popdam.onCheckoutsChanged(refresh);
    const unsubAuth = window.popdam.onAuthChanged(refresh);
    return () => { unsubCheckouts(); unsubAuth(); };
  }, [refresh]);

  async function handleCheckin(id: string): Promise<void> {
    setBusyId(id);
    setError(null);
    const res = await window.popdam.checkin(id);
    if (!res.ok) setError(res.error ?? "Check-in failed");
    setBusyId(null);
  }

  async function handleDiscard(id: string): Promise<void> {
    if (!confirm("Discard this checkout? Your local edits will remain but the file will be unlocked.")) return;
    setBusyId(id);
    const res = await window.popdam.discard(id);
    if (!res.ok) setError(res.error ?? "Discard failed");
    setBusyId(null);
  }

  const activeCheckouts = state.checkouts.filter(
    (c) => !["complete", "discarded"].includes(c.status),
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Title bar */}
      <div className="titlebar">
        <span className={`status-dot ${authState.loggedIn ? "" : "offline"}`} />
        <h1>POP DAM Helper</h1>
      </div>

      <div className="content">
        {error && (
          <div className="error-msg">
            {error}
            <button
              style={{ marginTop: 6, display: "block" }}
              onClick={() => setError(null)}
            >
              Dismiss
            </button>
          </div>
        )}

        {!authState.loggedIn && (
          <div className="checkout-card" style={{ marginBottom: 12 }}>
            <div className="meta" style={{ marginBottom: 8 }}>
              Sign in to sync your checked-out files with the DAM.
            </div>
            <button
              className="primary"
              style={{ width: "100%" }}
              onClick={() => window.popdam.signIn().catch(() => {})}
            >
              Sign in with Google
            </button>
          </div>
        )}

        <div className="section-label">Checked Out Files</div>

        {activeCheckouts.length === 0 ? (
          <div className="empty-state">No files checked out.</div>
        ) : (
          activeCheckouts.map((co) => {
            const uploadJob = state.uploadJobs.find((j) => j.checkoutId === co.id);
            const isUploading = co.status === "uploading" || co.status === "verifying";
            const isBusy = busyId === co.id;

            return (
              <div key={co.id} className="checkout-card">
                <div className="filename">{co.filename}</div>
                <div className="meta" title={co.relativePath}>
                  {co.relativePath.split(/[/\\]/).slice(0, -1).join(" / ")}
                </div>
                <span className={statusBadgeClass(co.status)}>
                  {statusLabel(co.status)}
                </span>
                <div className="meta" style={{ marginBottom: 6 }}>
                  Checked out {relativeTime(co.checkedOutAt)}
                </div>

                {isUploading && co.uploadProgress !== null && (
                  <div className="progress-bar">
                    <div className="fill" style={{ width: `${co.uploadProgress}%` }} />
                  </div>
                )}

                {co.errorMessage && (
                  <div className="error-msg" style={{ fontSize: 11, marginBottom: 6 }}>
                    {co.errorMessage}
                  </div>
                )}

                <div className="actions">
                  <button
                    onClick={() => window.popdam.openFile(co.id)}
                    disabled={isBusy || isUploading}
                  >
                    Open
                  </button>
                  <button
                    onClick={() => window.popdam.revealFile(co.id)}
                    disabled={isBusy}
                  >
                    Reveal
                  </button>
                  <button
                    className="primary"
                    onClick={() => handleCheckin(co.id)}
                    disabled={isBusy || isUploading}
                  >
                    {isBusy && co.status === "checkin_queued" ? "Preparing…" : "Check In"}
                  </button>
                  <button
                    className="danger"
                    onClick={() => handleDiscard(co.id)}
                    disabled={isBusy || isUploading}
                  >
                    Discard
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="footer">
        <button onClick={() => window.popdam.openDam()} style={{ flex: 1 }}>
          Open DAM
        </button>
        <button onClick={onOpenSettings}>Settings</button>
        {authState.loggedIn ? (
          <button
            title={authState.email ?? "Sign out"}
            onClick={() => window.popdam.logout().then(refresh)}
          >
            Sign Out
          </button>
        ) : null}
      </div>
    </div>
  );
}
