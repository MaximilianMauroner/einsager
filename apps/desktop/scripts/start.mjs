import { execFileSync, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { packageNative } from './native-macos.mjs';

const native = process.platform === 'darwin' && !process.argv.includes('--electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const quitNative = () => execFileSync('/usr/bin/osascript', ['-e', `
  try
    if application id "local.max.einsager.desktop" is running then tell application id "local.max.einsager.desktop" to quit
    repeat 100 times
      if not (application id "local.max.einsager.desktop" is running) then return
      delay 0.1
    end repeat
    error "Quit einsager before starting the development build."
  on error message number code
    if code is not -10814 and code is not -1728 then error message number code
  end try
`], { env, timeout: 15_000 });
let command;
let args;
if (native) {
  quitNative();
  await packageNative();
  command = '/usr/bin/open';
  args = ['-W', '-n'];
  if (process.stdout.isTTY && process.stdin.isTTY) {
    const terminal = execFileSync('/usr/bin/tty', { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'], timeout: 5000 }).trim();
    args.push('--stdout', terminal, '--stderr', terminal);
  }
  args.push(resolve(`release/einsager-darwin-${process.arch}/einsager.app`));
} else {
  command = (await import('electron')).default;
  args = ['.'];
}
const child = spawn(command, args, { stdio: 'inherit', env });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (native) quitNative();
  else child.kill(signal);
});
