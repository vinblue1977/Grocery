/* global importScripts */
// Keeps the Home Screen app current and lets it open offline (read-only; the list itself is cached by the page).
// - Hashed files under assets/ never change, so they are cache-first.
// - The page (index.html) is network-first with a short timeout, so a new deploy shows up at once but a bad connection
//   or airplane mode falls back to the last copy.
// - Anything cross-origin (the API) or not a GET is left entirely to the browser.
importScripts('./sw-logic.js');

const BUILD_ID = '__BUILD_ID__'; // replaced at build time (vite.config.ts); stays a valid constant when run unbuilt
const NETWORK_TIMEOUT_MS = 3000;
const names = self.SwLogic.cacheNames(BUILD_ID);
const SCOPE = self.registration.scope;
const INDEX = new URL('./index.html', SCOPE).href;
const SHELL_FILES = ['./manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

async function precache() {
  const [shell, assets] = await Promise.all([caches.open(names.shell), caches.open(names.assets)]);
  const page = await fetch(INDEX, { cache: 'reload' });
  if (!page.ok) throw new Error('index.html unavailable');
  const html = await page.clone().text();
  await shell.put(INDEX, page);
  await Promise.all([
    ...SHELL_FILES.map((file) => shell.add(new Request(new URL(file, SCOPE), { cache: 'reload' }))),
    ...self.SwLogic.assetUrls(html, INDEX).map((url) => assets.add(new Request(url, { cache: 'reload' }))),
  ]);
}

self.addEventListener('install', (event) => {
  // A failed precache fails the install, so the previous worker (and its caches) stays in charge.
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const stale = self.SwLogic.staleCaches(await caches.keys(), BUILD_ID);
      await Promise.all(stale.map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function networkFirst(event) {
  const cache = await caches.open(names.shell);
  const fresh = fetch(event.request, { cache: 'no-cache' }).then((response) => {
    // A redirected response can't be served to a navigation, so only cache clean 200s.
    if (response.ok && !response.redirected) event.waitUntil(cache.put(INDEX, response.clone()));
    return response;
  });
  fresh.catch(() => undefined); // if the timeout wins and the fetch later fails, don't leave an unhandled rejection
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS));
  try {
    const winner = await Promise.race([fresh, timeout]);
    if (winner) return winner;
  } catch {
    // Offline or the server is unreachable: use the saved copy below.
  }
  return (await cache.match(INDEX)) ?? fresh; // nothing saved yet: keep waiting for the network
}

self.addEventListener('fetch', (event) => {
  const kind = self.SwLogic.classify(event.request.url, SCOPE, event.request.method, event.request.mode);
  if (kind === 'ignore') return;
  if (kind === 'navigate') event.respondWith(networkFirst(event));
  else event.respondWith(cacheFirst(event.request, kind === 'asset' ? names.assets : names.shell));
});
