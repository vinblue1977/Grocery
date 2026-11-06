// Keeps the Home Screen app current: page loads always check the server (a cheap 304 when nothing changed) instead of
// trusting iOS's long-lived HTTP cache. Built files have hashed names, so they can be cached forever.
// Offline caching and the write queue arrive later.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request, { cache: 'no-cache' }));
  }
});
