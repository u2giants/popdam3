/* Pop Mockups as an installed app: always the newest version when online (network first, never the HTTP cache);
   the last copy that was opened when offline. Only the page itself is kept, nothing else. */
const CACHE = "pop-mockups-v1";
self.addEventListener("install", e => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET" || r.mode !== "navigate") return;
  // never the browser's cache: a new version shows as soon as the app opens or reloads (8.4)
  e.respondWith(fetch(r.url, {cache: "no-store", credentials: "same-origin"}).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put("./", copy)); }
    return res;
  }).catch(() => caches.open(CACHE).then(c => c.match("./")).then(m => m || Response.error())));
});
