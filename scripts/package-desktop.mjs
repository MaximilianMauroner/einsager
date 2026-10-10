import packager from '@electron/packager';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

const helper = resolve('target/release/einsager-transcribe' + (process.platform === 'win32' ? '.exe' : ''));
await access(helper);
console.log(await packager({
  dir: '.', name: 'einsager', out: 'release', overwrite: true,
  platform: process.platform, arch: process.arch,
  extraResource: [helper],
  ignore: [/^\/(target|release|\.git|\.agents|docs|tests|src|assets|scripts)(\/|$)/, /^\/desktop\/(?!dist)/, /\.swift$/],
  appBundleId: 'local.max.einsager.desktop',
  extendInfo: { NSMicrophoneUsageDescription: 'Record speech and send it to ChatGPT for transcription using your Codex login.' },
}));
