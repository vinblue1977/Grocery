/* global module */
// Pure helpers for sw.js, kept free of service-worker globals so Vitest can test them (src/swLogic.test.ts).
// Loaded in the worker with importScripts and in tests as a CommonJS module.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SwLogic = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const PREFIX = 'grocery-';

  /** Names of the two caches for one build: the page shell and the immutable hashed assets. */
  function cacheNames(buildId) {
    return { shell: PREFIX + 'shell-' + buildId, assets: PREFIX + 'assets-' + buildId };
  }

  /** Our caches that belong to some other build (to delete on activate); other apps' caches are left alone. */
  function staleCaches(allNames, buildId) {
    const keep = cacheNames(buildId);
    return allNames.filter((n) => n.startsWith(PREFIX) && n !== keep.shell && n !== keep.assets);
  }

  /**
   * What the worker should do with a request: 'ignore' (let the browser handle it: the API, other origins, non-GET),
   * 'navigate' (the page itself: network first), 'asset' (hashed build file: cache first) or 'static' (icons, manifest).
   */
  function classify(requestUrl, scopeUrl, method, mode) {
    if (method !== 'GET') return 'ignore';
    let url, scope;
    try {
      url = new URL(requestUrl);
      scope = new URL(scopeUrl);
    } catch {
      return 'ignore';
    }
    if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return 'ignore';
    const rel = url.pathname.slice(scope.pathname.length);
    if (mode === 'navigate' || rel === '' || rel === 'index.html') return 'navigate';
    if (rel.startsWith('assets/')) return 'asset';
    return 'static';
  }

  /** The hashed script/style/preload files an index.html refers to, as absolute same-origin URLs. */
  function assetUrls(html, baseUrl) {
    const found = new Set();
    const base = new URL(baseUrl);
    const dir = base.pathname.slice(0, base.pathname.lastIndexOf('/') + 1);
    for (const match of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
      const attr = /\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(match[0]);
      const value = attr && (attr[1] ?? attr[2]);
      if (!value) continue;
      if (match[1].toLowerCase() === 'link' && !/\brel\s*=\s*["']?(stylesheet|modulepreload)/i.test(match[0])) continue;
      try {
        const url = new URL(value, base);
        if (url.origin === base.origin && url.pathname.startsWith(dir + 'assets/')) found.add(url.href);
      } catch {
        // Not a usable URL: skip it.
      }
    }
    return [...found];
  }

  return { cacheNames, staleCaches, classify, assetUrls };
});
