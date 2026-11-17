/* Pop Mockups as an installed app: always the newest version when online (network first);
   the last copy that was opened when offline. Only the page itself is kept, nothing else. */
const CACHE = "pop-mockups-v1";
self.addEventListener("install", e => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET" || r.mode !== "navigate") return;
  e.respondWith(fetch(r).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put("./", copy)); }
    return res;
  }).catch(() => caches.open(CACHE).then(c => c.match("./")).then(m => m || Response.error())));
});
