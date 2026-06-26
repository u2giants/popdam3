/*
 * POP DAM Helper — Photoshop UXP plugin.
 *
 * Detects when a document is CLOSED in Photoshop and tells the running POP DAM
 * Helper (over its localhost server) so the Helper can offer to check the file
 * back in. Photoshop has a real "close" event; Illustrator does not, which is
 * why this plugin is Photoshop-only.
 *
 * The Helper listens at http://127.0.0.1:47380/editor-event and matches the
 * reported file path against its active checkouts.
 */

const { app, action } = require("photoshop");

const HELPER_URL = "http://127.0.0.1:47380/editor-event";

// Photoshop's "close" event fires as (or just after) the document goes away, so
// we can't reliably read its path from the close descriptor. Keep a live map of
// open documentID → file path, refreshed on every relevant event, and look the
// closed document's path up from it.
const pathById = new Map();

function cacheOpenDocuments() {
  try {
    pathById.clear();
    for (const doc of app.documents) {
      if (doc && doc.path) pathById.set(doc.id, doc.path);
    }
  } catch (e) {
    /* documents not ready yet */
  }
}

async function postEvent(event, path) {
  try {
    await fetch(HELPER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, path }),
    });
    setStatus(true);
  } catch (e) {
    // Helper not running / not reachable — silently ignore; nothing to do here.
    setStatus(false);
  }
}

function setStatus(connected) {
  const el = document.getElementById("status");
  if (!el) return;
  el.textContent = connected ? "Connected to POP DAM Helper." : "POP DAM Helper not detected (is it running?).";
  el.className = connected ? "ok" : "warn";
}

// Keep the path cache fresh as documents open / switch / save.
cacheOpenDocuments();
action.addNotificationListener(
  ["open", "select", "save", "newDocument", "placedLayer"],
  () => cacheOpenDocuments(),
);

// On close, resolve the closed document's path from the cache and notify the Helper.
action.addNotificationListener(["close"], async (_event, descriptor) => {
  const id = descriptor && descriptor.documentID;
  const path = id != null ? pathById.get(id) : undefined;
  if (path) await postEvent("documentClosed", path);
  // Refresh AFTER close so the cache reflects the remaining documents.
  cacheOpenDocuments();
});

// Probe the Helper once on load so the panel shows a useful status.
postEvent("ping", "").catch(() => {});
