import { build } from 'esbuild';
import { build as buildRenderer } from 'vite';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { platformFor } from '../src/main/platform.ts';

// macOS: Electron cannot see Fn or key releases, so a small Swift helper handles shortcuts.
const keyboardHelper = platformFor(process.platform).keyboardHelper;
if (keyboardHelper) {
  const sources = ['apps/desktop/native/macos/KeyboardShortcuts.swift', 'apps/desktop/native/macos/KeyboardHelper.swift'];
  const output = `target/release/${keyboardHelper}`;
  const built = await stat(output).then(file => file.mtimeMs, () => 0);
  const changed = await Promise.all(sources.map(async source => (await stat(source)).mtimeMs > built));
  if (changed.includes(true)) {
    await mkdir('target/release', { recursive: true });
    // Without a target, swiftc builds for the macOS version of the build machine.
    // Electron needs macOS 12 or later, so the helper starts on the same systems.
    const target = `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos12.0`;
    execFileSync('swiftc', ['-j', '1', '-target', target, ...sources, '-o', output,
      '-framework', 'AppKit', '-framework', 'Carbon'], { stdio: 'inherit' });
  }
}

await build({
  entryPoints: {
    main: 'apps/desktop/src/main/index.ts', preload: 'apps/desktop/src/preload.ts',
    'panel-preload': 'apps/desktop/src/panel-preload.ts',
  },
  outdir: 'apps/desktop/dist', outExtension: { '.js': '.cjs' },
  bundle: true, platform: 'node', format: 'cjs', external: ['electron'],
  sourcemap: true,
});
await buildRenderer({ configFile: 'apps/desktop/vite.config.ts' });
await copyFile('assets/icons/einsager-tray.png', 'apps/desktop/dist/tray.png');
