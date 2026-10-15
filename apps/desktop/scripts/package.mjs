import { packager } from '@electron/packager';
import { execFileSync } from 'node:child_process';
import { access, copyFile, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { platformFor } from '../src/main/platform.ts';
import { signMacApp } from './macos-signing.mjs';
import { packageNative } from './native-macos.mjs';

if (process.platform === 'darwin' && !process.argv.includes('--electron')) {
  await packageNative();
} else {

const platform = platformFor(process.platform);
const helpers = [platform.helperExecutable, platform.keyboardHelper].filter(name => name !== undefined).map(name => resolve('target/release', name));
await Promise.all(helpers.map(helper => access(helper)));
const metadata = JSON.parse(await readFile('package.json', 'utf8'));
const staging = await mkdtemp(join(tmpdir(), 'einsager-package-'));
// The packager copies everything in this folder into the app, so the icon stays beside it.
const source = join(staging, 'app');
try {
  // Both bundles contain their JS dependencies. Runtime needs only Electron and Node.
  await cp('apps/desktop/dist', join(source, 'apps/desktop/dist'), { recursive: true });
  await copyFile('LICENSE', join(source, 'LICENSE'));
  await writeFile(join(source, 'package.json'), JSON.stringify({
    name: metadata.name, version: metadata.version, license: metadata.license, main: metadata.main,
  }));
  // macOS shows this icon in Finder, alerts, and the Privacy & Security lists.
  const icon = process.platform === 'darwin' ? join(staging, 'einsager.icns') : undefined;
  if (icon) execFileSync('swift', ['-j', '1', 'apps/desktop/scripts/make-app-icon.swift', icon], { stdio: 'inherit' });
  const outputs = await packager({
    dir: source, name: 'einsager', out: resolve('release', process.platform === 'darwin' ? 'electron' : '.'), overwrite: true,
    platform: process.platform, arch: process.arch, electronVersion: metadata.devDependencies.electron,
    prune: false, extraResource: helpers, icon,
    appBundleId: 'local.max.einsager.desktop',
    extendInfo: { NSMicrophoneUsageDescription: 'Record speech and send it to ChatGPT for transcription using your Codex login.' },
  });
  // Packaging edits Info.plist, so the finished bundle needs a fresh signature.
  if (process.platform === 'darwin') {
    await signMacApp(join(outputs[0], 'einsager.app'));
  }
  console.log(outputs);
} finally {
  await rm(staging, { recursive: true, force: true });
}
}
