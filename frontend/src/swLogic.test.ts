import { describe, expect, it } from 'vitest';
import { assetUrls, cacheNames, classify, staleCaches } from '../public/sw-logic.js';

const SCOPE = 'https://user.github.io/Grocery/';

describe('classify', () => {
  it('sends the page through network-first', () => {
    expect(classify(SCOPE, SCOPE, 'GET', 'navigate')).toBe('navigate');
    expect(classify(SCOPE + 'index.html', SCOPE, 'GET', 'same-origin')).toBe('navigate');
    expect(classify(SCOPE + '?join=abc', SCOPE, 'GET', 'navigate')).toBe('navigate');
  });
  it('treats files under assets/ as cache-first and icons/manifest as static', () => {
    expect(classify(SCOPE + 'assets/index-abc.js', SCOPE, 'GET', 'cors')).toBe('asset');
    expect(classify(SCOPE + 'manifest.webmanifest', SCOPE, 'GET', 'cors')).toBe('static');
    expect(classify(SCOPE + 'icon-192.png', SCOPE, 'GET', 'no-cors')).toBe('static');
  });
  it('never touches the API, other origins, other paths or non-GET', () => {
    expect(classify('https://abc.lambda-url.us-east-1.on.aws/sync', SCOPE, 'GET', 'cors')).toBe('ignore');
    expect(classify('https://user.github.io/Other/x.js', SCOPE, 'GET', 'cors')).toBe('ignore');
    expect(classify(SCOPE + 'assets/a.js', SCOPE, 'POST', 'cors')).toBe('ignore');
    expect(classify('not a url', SCOPE, 'GET', 'cors')).toBe('ignore');
  });
});

describe('cache names', () => {
  it('are per build, and only other builds of ours are stale', () => {
    expect(cacheNames('abc')).toEqual({ shell: 'grocery-shell-abc', assets: 'grocery-assets-abc' });
    const all = ['grocery-shell-abc', 'grocery-assets-abc', 'grocery-shell-old', 'grocery-assets-old', 'tennis-shell-1'];
    expect(staleCaches(all, 'abc')).toEqual(['grocery-shell-old', 'grocery-assets-old']);
  });
});

describe('assetUrls', () => {
  const html = `<!doctype html><html><head>
    <link rel="manifest" href="./manifest.webmanifest" />
    <link rel="apple-touch-icon" href="./apple-touch-icon.png" />
    <script type="module" crossorigin src="./assets/index-AbC123.js"></script>
    <link rel="modulepreload" crossorigin href="./assets/vendor-Z.js">
    <link rel="stylesheet" crossorigin href='./assets/index-Q.css'>
    <script>var x = 1;</script>
    <script src="https://cdn.example.com/assets/evil.js"></script>
  </head></html>`;
  it('finds hashed scripts, styles and preloads next to the page and nothing else', () => {
    expect(assetUrls(html, SCOPE + 'index.html')).toEqual([
      SCOPE + 'assets/index-AbC123.js',
      SCOPE + 'assets/vendor-Z.js',
      SCOPE + 'assets/index-Q.css',
    ]);
  });
  it('returns nothing for a page without assets', () => {
    expect(assetUrls('<html></html>', SCOPE + 'index.html')).toEqual([]);
  });
});
