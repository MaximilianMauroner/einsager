import { build } from 'esbuild';
import { build as buildRenderer } from 'vite';
import { copyFile } from 'node:fs/promises';

await build({
  entryPoints: { main: 'apps/desktop/src/main/index.ts', preload: 'apps/desktop/src/preload.ts' },
  outdir: 'apps/desktop/dist', outExtension: { '.js': '.cjs' },
  bundle: true, platform: 'node', format: 'cjs', external: ['electron'],
  sourcemap: true,
});
await buildRenderer({ configFile: 'apps/desktop/vite.config.ts' });
await copyFile('assets/icons/einsager-tray.png', 'apps/desktop/dist/tray.png');
