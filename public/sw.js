// Minimal offline support: everything is fetched network-first and cached as a fallback for when the phone is offline.
const V = 'finn-v1';
const SHELL = ['/', '/styles.css', '/js/app.js', '/js/lib.js', '/js/util.js', '/js/score.js', '/js/network.js', '/js/views/brief.js', '/js/views/dig.js', '/js/views/people.js', '/js/views/sheets.js', '/js/views/ask.js', '/js/views/common.js', '/vendor/preact.mjs', '/vendor/hooks.mjs', '/vendor/htm.mjs', '/icon.svg'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // network-first for everything: always the latest deploy when online, the cached copy when offline
  e.respondWith(
    fetch(e.request)
      .then((r) => { if (r.ok) { const cl = r.clone(); caches.open(V).then((c) => c.put(e.request, cl)); } return r; })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('/'))),
  );
});
