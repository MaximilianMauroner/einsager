import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { signMacApp } from './macos-signing.mjs';

export const nativeSources = [
  'KeyboardShortcuts', 'KeyboardMonitor', 'NativeStore', 'NativeAudio', 'NativeDelivery',
  'NativeHotKeys', 'NativeTranscription', 'NativeSession', 'NativeStyle', 'NativePill', 'NativeUI', 'NativeApp',
].map(name => `apps/desktop/native/macos/${name}.swift`);

export function compileNative(output, { tests = false, extraSources = [] } = {}) {
  const target = `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos13.0`;
  execFileSync('swiftc', ['-j', '1', '-Osize', '-whole-module-optimization', '-target', target,
    ...(tests ? ['-D', 'NATIVE_TESTS'] : []), ...nativeSources, ...extraSources, '-o', output,
    '-framework', 'AppKit', '-framework', 'Carbon', '-framework', 'AudioToolbox', '-framework', 'AVFoundation'],
  { stdio: 'inherit', timeout: 180_000 });
}

export async function buildNative() {
  await mkdir('target/release', { recursive: true });
  compileNative('target/release/einsager');
}

export async function packageNative() {
  const metadata = JSON.parse(await readFile('package.json', 'utf8'));
  const folder = resolve(`release/einsager-darwin-${process.arch}`);
  const app = `${folder}/einsager.app`;
  await rm(app, { recursive: true, force: true });
  await mkdir(`${app}/Contents/MacOS`, { recursive: true });
  await mkdir(`${app}/Contents/Resources`);
  await copyFile('target/release/einsager', `${app}/Contents/MacOS/einsager`);
  await copyFile('target/release/einsager-transcribe', `${app}/Contents/Resources/einsager-transcribe`);
  await copyFile('assets/icons/einsager-tray.png', `${app}/Contents/Resources/tray.png`);
  await copyFile('LICENSE', `${app}/Contents/Resources/LICENSE`);
  execFileSync('swift', ['-j', '1', 'apps/desktop/scripts/make-app-icon.swift', `${app}/Contents/Resources/einsager.icns`],
    { stdio: 'inherit', timeout: 60_000 });
  await writeFile(`${app}/Contents/Info.plist`, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>einsager</string>
<key>CFBundleIdentifier</key><string>local.max.einsager.desktop</string>
<key>CFBundleName</key><string>einsager</string>
<key>CFBundleDisplayName</key><string>einsager</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${metadata.version}</string>
<key>CFBundleVersion</key><string>${metadata.version}</string>
<key>CFBundleIconFile</key><string>einsager.icns</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>LSUIElement</key><true/>
<key>NSHighResolutionCapable</key><true/>
<key>NSMicrophoneUsageDescription</key><string>Record speech and send it to ChatGPT for transcription using your Codex login.</string>
</dict></plist>`);
  // A production build must never contain the synthetic audio/command entry point.
  const strings = execFileSync('/usr/bin/strings', [`${app}/Contents/MacOS/einsager`], { encoding: 'utf8', timeout: 10_000 });
  if (strings.includes('EINSAGER_NATIVE_TEST_DRIVER')) throw new Error('Test driver found in production app.');
  await signMacApp(app);
  const contents = await readdir(`${app}/Contents`);
  if (contents.includes('Frameworks')) throw new Error('Native macOS app must not bundle Chromium.');
  console.log([folder]);
}
