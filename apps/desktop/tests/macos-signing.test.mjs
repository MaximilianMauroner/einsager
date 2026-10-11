import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('local app and helper updates retain their certificate identity and reject other signers',
  { skip: process.platform !== 'darwin' }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'einsager-signing-test-'));
    const signingDirectory = join(directory, 'signing');
    const keychain = join(signingDirectory, 'signing.keychain-db');
    const module = new URL('../scripts/macos-signing.mjs', import.meta.url).href;
    try {
      const script = join(directory, 'test.mjs');
      await writeFile(script, `
        import { ensureMacSigningIdentity, signMacApp } from ${JSON.stringify(module)};
        if (process.argv[4] !== '--adhoc') await ensureMacSigningIdentity(process.argv[3]);
        await signMacApp(process.argv[2], process.argv[3]);
      `);
      const app = join(directory, 'einsager.app');
      await mkdir(join(app, 'Contents/MacOS'), { recursive: true });
      await mkdir(join(app, 'Contents/Resources'));
      await writeFile(join(app, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0"><dict>
        <key>CFBundleIdentifier</key><string>local.max.einsager.desktop</string>
        <key>CFBundleExecutable</key><string>einsager</string>
        <key>CFBundlePackageType</key><string>APPL</string>
        </dict></plist>`);
      const executables = ['Contents/MacOS/einsager', 'Contents/Resources/einsager-keys', 'Contents/Resources/einsager-transcribe']
        .map(file => join(app, file));
      for (const executable of executables) await copyFile('/bin/echo', executable);
      // CI cannot find the stored identity (issue #10). On failure, list what the test keychain offers: all and valid
      // code signing identities, and its certificates' public attributes, which tell a missing key pairing from discovery.
      const keychainEvidence = () => [['find-identity', '-p', 'codesigning'], ['find-identity', '-v', '-p', 'codesigning'], ['find-certificate', '-a', '-Z']]
        .map(args => {
          const result = spawnSync('/usr/bin/security', [...args, keychain], { encoding: 'utf8' });
          return `security ${args.join(' ')} <test keychain> (exit ${result.status}):\n${result.stdout}${result.stderr}`;
        }).join('\n');
      const sign = () => {
        try {
          execFileSync(process.execPath, [script, app, signingDirectory]);
        } catch (error) {
          console.error(keychainEvidence());
          throw error;
        }
      };
      const requirement = file => {
        const displayed = spawnSync('/usr/bin/codesign', ['-dr', '-', file], { encoding: 'utf8' });
        assert.equal(displayed.status, 0, displayed.stderr);
        const line = `${displayed.stdout}\n${displayed.stderr}`.split('\n').find(line => line.startsWith('designated => '));
        assert.ok(line, 'A signed executable must have a designated requirement.');
        return line.slice('designated => '.length);
      };
      execFileSync(process.execPath, [script, app, signingDirectory, '--adhoc']);
      execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
      sign();
      const configuration = join(signingDirectory, 'identity.json');
      const firstIdentity = await readFile(configuration, 'utf8');
      const files = [app, ...executables.slice(1)];
      const requirements = files.map(requirement);
      for (const executable of executables) await copyFile('/bin/cat', executable);
      sign();
      assert.equal(await readFile(configuration, 'utf8'), firstIdentity, 'A second install must reuse the private key.');
      assert.deepEqual(files.map(requirement), requirements);
      for (const [index, file] of files.entries()) {
        execFileSync('/usr/bin/codesign', ['--verify', '--strict', `-R=${requirements[index]}`, file]);
      }
      const helper = executables[1];
      execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', helper]);
      const otherSigner = spawnSync('/usr/bin/codesign', ['--verify', `-R=${requirements[1]}`, helper]);
      assert.notEqual(otherSigner.status, 0, 'Sharing the identifier alone must not match the approved identity.');
    } finally {
      // The test uses its own keychain and never adds system certificate trust or touches the app's signer.
      spawnSync('/usr/bin/security', ['delete-keychain', keychain]);
      await rm(directory, { recursive: true, force: true });
    }
  });
