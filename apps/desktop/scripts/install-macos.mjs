import { execFileSync } from 'node:child_process';
import { access, mkdtemp, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ensureMacSigningIdentity } from './macos-signing.mjs';

await ensureMacSigningIdentity();
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const run = (command, args) => execFileSync(command, args, { stdio: 'inherit', env });
run('pnpm', ['build']);
run('pnpm', ['package']);

const source = resolve(`release/einsager-darwin-${process.arch}/einsager.app`);
const destination = '/Applications/einsager.app';
const staging = await mkdtemp('/Applications/.einsager-install-');
const stagedApp = join(staging, 'einsager.app');
// The old copy has no .app extension, so macOS cannot register a backup under the app's ID.
const previous = join(staging, 'previous');
let replaced = false;
try {
  run('/usr/bin/ditto', [source, stagedApp]);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', stagedApp]);
  // Electron quits asynchronously. Launching before it exits loses the new instance to its app lock.
  run('/usr/bin/osascript', ['-e', `
    if application id "local.max.einsager.desktop" is running then tell application id "local.max.einsager.desktop" to quit
    repeat 100 times
      if not (application id "local.max.einsager.desktop" is running) then return
      delay 0.1
    end repeat
    error "einsager did not quit. Quit it and run install:macos again."
  `]);
  const installed = await access(destination).then(() => true, error => {
    if (error.code !== 'ENOENT') throw error;
    return false;
  });
  if (installed) await rename(destination, previous);
  try {
    await rename(stagedApp, destination);
  } catch (error) {
    if (installed) await rename(previous, destination);
    throw error;
  }
  replaced = true;
  run('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', destination]);
  run('/usr/bin/open', [destination]);
  console.log(`Installed and opened ${destination}.`);
} finally {
  // If rollback failed, retain the previous copy for recovery.
  if (replaced || !await access(previous).then(() => true, () => false)) {
    await rm(staging, { recursive: true, force: true });
  }
}
