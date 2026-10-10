import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const page = (name: string) => fileURLToPath(new URL(`src/renderer/${name}.html`, import.meta.url));

export default defineConfig({
  root: 'apps/desktop/src/renderer',
  base: './',
  build: {
    outDir: '../../dist/renderer', emptyOutDir: true,
    rolldownOptions: { input: { index: page('index'), panel: page('panel') } },
  },
});
