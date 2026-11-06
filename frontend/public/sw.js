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

async function cacheFirst(event, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(event.request);
  if (hit) return hit;
  const response = await fetch(event.request);
  // Save it in the background; still inside respondWith, so the event is alive and waitUntil is allowed.
  if (response.ok) event.waitUntil(cache.put(event.request, response.clone()));
  return response;
}

// A redirected response can't be served to a navigation, and an error page must never replace the saved app.
const usable = (response) => response.ok && !response.redirected;

async function networkFirst(event) {
  const cache = await caches.open(names.shell);
  const request = fetch(event.request, { cache: 'no-cache' });
  // waitUntil only works while the event is alive, so register the background save NOW, not after the timeout has
  // already answered the page (calling it then throws and the saved page would never refresh).
  event.waitUntil(request.then((response) => (usable(response) ? cache.put(INDEX, response.clone()) : undefined)).catch(() => undefined));
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS);
  });
  try {
    const winner = await Promise.race([request, timeout]);
    if (winner && usable(winner)) return winner;
  } catch {
    // Offline or the server is unreachable: use the saved copy below.
  } finally {
    clearTimeout(timer);
  }
  return (await cache.match(INDEX)) ?? request; // nothing saved yet: keep waiting for the network
}

self.addEventListener('fetch', (event) => {
  const kind = self.SwLogic.classify(event.request.url, SCOPE, event.request.method, event.request.mode);
  if (kind === 'ignore') return;
  if (kind === 'navigate') event.respondWith(networkFirst(event));
  else event.respondWith(cacheFirst(event, kind === 'asset' ? names.assets : names.shell));
});
