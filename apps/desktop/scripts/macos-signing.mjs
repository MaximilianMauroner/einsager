import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const defaultDirectory = join(homedir(), 'Library/Application Support/einsager-signing');

// Do not include command arguments in errors: security commands contain the keychain password.
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) throw new Error(`${basename(command)} failed: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${basename(command)} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

async function localIdentity(directory) {
  const configuration = join(directory, 'identity.json');
  const keychain = join(directory, 'signing.keychain-db');
  const text = await readFile(configuration, 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (text === undefined) return;
  const identity = JSON.parse(text);
  if (!/^[A-F0-9]{40}$/i.test(identity.identity) || typeof identity.password !== 'string') {
    throw new Error(`Invalid signing identity in ${configuration}. Restore it rather than create a new identity.`);
  }
  await access(keychain);
  return { identity: identity.identity, password: identity.password, keychain };
}

/** Creates a machine-local certificate once. Keeping its private key preserves permissions across builds. */
export async function ensureMacSigningIdentity(directory = defaultDirectory) {
  if (process.platform !== 'darwin') throw new Error('Local macOS installation requires macOS.');
  if (await localIdentity(directory)) return;
  const configuration = join(directory, 'identity.json');
  const keychain = join(directory, 'signing.keychain-db');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporary = await mkdtemp(join(tmpdir(), 'einsager-signing-'));
  const password = randomBytes(32).toString('hex');
  let created = false;
  try {
    const certificate = join(temporary, 'certificate.pem');
    const privateKey = join(temporary, 'private-key.pem');
    run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '3650',
      '-subj', '/CN=einsager Local Signing/', '-addext', 'basicConstraints=critical,CA:FALSE',
      '-addext', 'keyUsage=critical,digitalSignature', '-addext', 'extendedKeyUsage=critical,codeSigning',
      '-keyout', privateKey, '-out', certificate]);
    const identity = run('openssl', ['x509', '-in', certificate, '-noout', '-fingerprint', '-sha1'])
      .trim().split('=').at(-1).replaceAll(':', '');
    run('/usr/bin/security', ['create-keychain', '-p', password, keychain]);
    created = true;
    await chmod(keychain, 0o600);
    run('/usr/bin/security', ['unlock-keychain', '-p', password, keychain]);
    run('/usr/bin/security', ['import', certificate, '-k', keychain]);
    run('/usr/bin/security', ['import', privateKey, '-k', keychain, '-T', '/usr/bin/codesign']);
    run('/usr/bin/security', ['set-key-partition-list', '-S', 'apple-tool:,codesign:', '-s', '-k', password, keychain]);
    await writeFile(configuration, JSON.stringify({ identity, password }), { mode: 0o600 });
  } catch (error) {
    if (created) run('/usr/bin/security', ['delete-keychain', keychain]);
    throw error;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/** Public builds stay ad-hoc signed. Local builds reuse the certificate created by install:macos. */
export async function signMacApp(app, directory = defaultDirectory) {
  const identity = await localIdentity(directory);
  if (!identity) {
    run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app]);
    return;
  }
  run('/usr/bin/security', ['unlock-keychain', '-p', identity.password, identity.keychain]);
  const signing = ['--force', '--sign', identity.identity, '--keychain', identity.keychain, '--timestamp=none'];
  // These executables are resources, so --deep does not sign them as nested code.
  for (const [executable, identifier] of [['einsager-keys', 'local.max.einsager.keys'], ['einsager-transcribe', 'local.max.einsager.transcribe']]) {
    const file = join(app, 'Contents/Resources', executable);
    if (await access(file).then(() => true, () => false)) {
      run('/usr/bin/codesign', [...signing, '--identifier', identifier, file]);
    }
  }
  run('/usr/bin/codesign', [...signing, '--deep', app]);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  console.log('Signed with the persistent local einsager identity.');
}
