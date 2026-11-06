import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import preact from '@preact/preset-vite';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/** Stamps public/sw.js in the build output with an id of this build, so each deploy gets its own caches. */
function swBuildId(): Plugin {
  let outDir = 'dist';
  const names: string[] = [];
  return {
    name: 'sw-build-id',
    apply: 'build',
    configResolved: (config) => {
      outDir = config.build.outDir;
    },
    generateBundle(_options, bundle) {
      names.push(...Object.keys(bundle));
    },
    closeBundle() {
      const file = join(outDir, 'sw.js');
      const hash = createHash('sha256').update(names.sort().join('\n')).update(readFileSync(join(outDir, 'index.html')));
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
