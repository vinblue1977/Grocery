declare module '*/sw-logic.js' {
  export function cacheNames(buildId: string): { shell: string; assets: string };
  export function staleCaches(allNames: string[], buildId: string): string[];
  export function classify(requestUrl: string, scopeUrl: string, method: string, mode: string): 'ignore' | 'navigate' | 'asset' | 'static';
  export function assetUrls(html: string, baseUrl: string): string[];
}
