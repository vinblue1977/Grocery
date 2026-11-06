import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import preact from '@preact/preset-vite';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/** Stamps public/sw.js in the build output with an id of this build, so each deploy gets its own caches. */
function swBuildId(): Plugin {
  let outDir = 'dist';
  return {
    name: 'sw-build-id',
    apply: 'build',
    configResolved: (config) => {
      outDir = config.build.outDir;
    },
    closeBundle() {
      // Every emitted file counts (also the icons, manifest and sw-logic.js copied from public/), so a change to any of
      // them gets new cache names instead of being served stale from the old cache.
      const hash = createHash('sha256');
      for (const rel of readdirSync(outDir, { recursive: true }).map(String).sort()) {
        const path = join(outDir, rel);
        if (rel !== 'sw.js' && statSync(path).isFile()) hash.update(rel).update(readFileSync(path));
      }
      const file = join(outDir, 'sw.js');
      writeFileSync(file, readFileSync(file, 'utf8').replace('__BUILD_ID__', hash.digest('hex').slice(0, 12)));
    },
  };
}

// base './' lets the same build work under GitHub Pages' /Grocery/ path.
export default defineConfig({
  base: './',
  plugins: [preact(), swBuildId()],
  test: { environment: 'jsdom', coverage: { enabled: false } },
});
