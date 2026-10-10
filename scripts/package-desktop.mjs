import { packager } from '@electron/packager';
import { access, copyFile, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const helper = resolve('target/release/einsager-transcribe' + (process.platform === 'win32' ? '.exe' : ''));
await access(helper);
const metadata = JSON.parse(await readFile('package.json', 'utf8'));
const staging = await mkdtemp(join(tmpdir(), 'einsager-package-'));
try {
  // Both bundles contain their JS dependencies. Runtime needs only Electron and Node.
  await cp('desktop/dist', join(staging, 'desktop/dist'), { recursive: true });
  await copyFile('LICENSE', join(staging, 'LICENSE'));
  await writeFile(join(staging, 'package.json'), JSON.stringify({
    name: metadata.name, version: metadata.version, license: metadata.license, main: metadata.main,
  }));
  console.log(await packager({
    dir: staging, name: 'einsager', out: resolve('release'), overwrite: true,
    platform: process.platform, arch: process.arch, electronVersion: metadata.devDependencies.electron,
    prune: false, extraResource: [helper],
    appBundleId: 'local.max.einsager.desktop',
    extendInfo: { NSMicrophoneUsageDescription: 'Record speech and send it to ChatGPT for transcription using your Codex login.' },
  }));
} finally {
  await rm(staging, { recursive: true, force: true });
}
