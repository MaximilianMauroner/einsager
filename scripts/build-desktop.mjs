import { build } from 'esbuild';
import { build as buildRenderer } from 'vite';
import { copyFile } from 'node:fs/promises';

await build({
  entryPoints: ['desktop/main.ts', 'desktop/preload.ts'],
  outdir: 'desktop/dist', outExtension: { '.js': '.cjs' },
  bundle: true, platform: 'node', format: 'cjs', external: ['electron'],
  sourcemap: true,
});
await buildRenderer({ configFile: 'desktop/vite.config.ts' });
await copyFile('assets/icons/einsager-tray.png', 'desktop/dist/tray.png');
