// vite.config.ts runs in Node, but @types/node isn't a dependency; declare just the few functions the build plugin uses.
declare module 'node:crypto' {
  export function createHash(algorithm: string): { update(data: string | Uint8Array): ReturnType<typeof createHash>; digest(encoding: 'hex'): string };
}
declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array;
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function writeFileSync(path: string, data: string): void;
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
}
