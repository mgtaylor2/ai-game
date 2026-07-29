import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

/**
 * Builds Alpine Rush as ONE self-contained HTML file with every script, style and generated texture
 * inlined, so it can be opened straight off the filesystem with no server and no install.
 *
 * Kept separate from `vite.config.ts` because single-file output requires `inlineDynamicImports`,
 * which Rollup only allows with a single entry -- the normal build has two (the kart racer and this).
 *
 *   npm run build:single   ->  dist-single/ski.html
 */
export default defineConfig({
  plugins: [viteSingleFile()],
  // Nothing from public/ belongs here -- those are the kart racer's assets, and copying them would
  // leave stray files next to what is meant to be a single portable HTML file.
  publicDir: false,
  build: {
    outDir: 'dist-single',
    emptyOutDir: true,
    // A local file has no download cost, so favour readable size limits over inlining thresholds.
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    rollupOptions: {
      input: `${root}ski.html`,
      output: { inlineDynamicImports: true },
    },
  },
});
