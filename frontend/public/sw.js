// Placeholder worker: offline caching and the write queue arrive with the sync feature.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
