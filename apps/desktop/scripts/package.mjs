import { packager } from '@electron/packager';
import { access, copyFile, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { platformFor } from '../src/main/platform.ts';

const platform = platformFor(process.platform);
const helpers = [platform.helperExecutable, platform.keyboardHelper].filter(name => name !== undefined).map(name => resolve('target/release', name));
await Promise.all(helpers.map(helper => access(helper)));
const metadata = JSON.parse(await readFile('package.json', 'utf8'));
const staging = await mkdtemp(join(tmpdir(), 'einsager-package-'));
try {
  // Both bundles contain their JS dependencies. Runtime needs only Electron and Node.
  await cp('apps/desktop/dist', join(staging, 'apps/desktop/dist'), { recursive: true });
  await copyFile('LICENSE', join(staging, 'LICENSE'));
  await writeFile(join(staging, 'package.json'), JSON.stringify({
    name: metadata.name, version: metadata.version, license: metadata.license, main: metadata.main,
  }));
  console.log(await packager({
    dir: staging, name: 'einsager', out: resolve('release'), overwrite: true,
    platform: process.platform, arch: process.arch, electronVersion: metadata.devDependencies.electron,
    prune: false, extraResource: helpers,
    appBundleId: 'local.max.einsager.desktop',
    extendInfo: { NSMicrophoneUsageDescription: 'Record speech and send it to ChatGPT for transcription using your Codex login.' },
  }));
} finally {
  await rm(staging, { recursive: true, force: true });
}
