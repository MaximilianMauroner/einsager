#!/usr/bin/env node
// Bounded native pilot for einsager issue #10 / PR #11: can the pinned rcodesign 0.29.0 keep one persistent
// signing identity, in the certificate format of apps/desktop/scripts/macos-signing.mjs, without trust changes?
//
// Diagnostic evidence only. It is not a project test, it does not replace the failing macOS signing check, and a
// passing arm is not product acceptance. report.md beside this file gives the sources, predictions, and limits.
//
// Arms:
//   file-key control  A fresh fixture identity in the project's certificate format, given to rcodesign as PEM files
//                     in a new temporary directory. It touches no keychain.
//   keychain          The identity, keychain, and key ACL that the project's ensureMacSigningIdentity creates in a new
//                     temporary directory, selected with --keychain-fingerprint. rcodesign 0.29.0 searches only the
//                     user domain's default keychain, so each rcodesign call makes the fixture keychain the default
//                     and then restores the original. It runs only when --keychain is given, and then only on a
//                     disposable GitHub-hosted runner. Without --keychain the report says it was not requested.
//
// The pilot runs no trust command: it neither reads nor changes certificate trust settings. It never reads the
// production identity, and never prints keychain passwords, private keys, or command arguments that contain them.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { appendFile, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';

const pinned = {
  version: 'apple-codesign 0.29.0',
  // The rcodesign executable in apple-codesign-0.29.0-aarch64-apple-darwin.tar.gz. That archive's SHA-256,
  // d1a532150adaf90048260d76359261aa716abafc45c53c5dc18845029184334a, matches the release's SHA256SUMS.
  binarySha256: '6c4623db45f1d89af439a2ce42fd65798ef56aaaa3e4ced48879be05f750aacb',
};
const app = {
  identifier: 'local.max.einsager.desktop',
  helpers: [['einsager-keys', 'local.max.einsager.keys'], ['einsager-transcribe', 'local.max.einsager.transcribe']],
};
// rcodesign signs Mach-O files in Contents/Resources again while it seals a bundle and names them after their paths,
// so one bundle pass gives the helper identifiers by path.
const helperIdentifiers = app.helpers.flatMap(([file, identifier]) => ['--binary-identifier', `Contents/Resources/${file}:${identifier}`]);
const productionDirectory = join(homedir(), 'Library/Application Support/einsager-signing');
const limits = { toolMs: 30_000, signMs: 90_000, tailChars: 1500 };
const security = '/usr/bin/security';
const codesign = '/usr/bin/codesign';

// Same document as apps/desktop/tests/macos-signing.test.mjs.
const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${app.identifier}</string>
<key>CFBundleExecutable</key><string>einsager</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
`;

/** The explicit designated requirement from `codesign -d -r-`, or undefined when only an implicit one exists. */
export function designatedRequirement(output) {
  return output.split('\n').find(line => line.startsWith('designated => '))?.slice('designated => '.length).trim();
}

/** Public fields of `codesign -dvvv` output. */
export function signatureDetails(output) {
  const field = name => output.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1];
  return {
    identifier: field('Identifier'),
    adhoc: field('Signature') === 'adhoc',
    authorities: [...output.matchAll(/^Authority=(.*)$/gm)].map(match => match[1]),
    teamIdentifier: field('TeamIdentifier'),
    flags: output.match(/^CodeDirectory .*flags=(\S+)/m)?.[1],
  };
}

export const leafRequirement = (identifier, sha1) => `identifier "${identifier}" and certificate leaf = H"${sha1.toLowerCase()}"`;

/** Paths printed by `security default-keychain` and `security list-keychains`. */
export const quotedPaths = output => [...output.matchAll(/^\s*"(.+)"\s*$/gm)].map(match => match[1]);

/** SHA-256 fingerprints printed by `rcodesign keychain-print-certificates`. */
export const listedFingerprints = output => [...output.matchAll(/^SHA-256 fingerprint:\s*([0-9a-f]+)$/gim)].map(match => match[1].toLowerCase());

/**
 * rcodesign 0.29.0 keeps only keychain certificates that carry an Apple code signing extension,
 * OID 1.2.840.113635.100.6.1.*. Looks for that OID's DER encoding with either content length.
 */
export function hasAppleCodeSigningExtension(der) {
  return ['060a', '060b'].some(header => Buffer.from(der).indexOf(Buffer.from(`${header}2a864886f763640601`, 'hex')) !== -1);
}

/** Public certificate fields. `format` holds the fields that two identities in the same format share. */
export function describeCertificate(pem) {
  const certificate = new X509Certificate(pem);
  return {
    sha1: certificate.fingerprint.replaceAll(':', ''),
    sha256: certificate.fingerprint256.replaceAll(':', ''),
    format: {
      subject: certificate.subject,
      selfSigned: certificate.subject === certificate.issuer && certificate.verify(certificate.publicKey),
      ca: certificate.ca,
      extendedKeyUsage: certificate.keyUsage,
      keyBits: certificate.publicKey.asymmetricKeyDetails?.modulusLength,
      appleCodeSigningExtension: hasAppleCodeSigningExtension(certificate.raw),
    },
  };
}

const secrets = new Set();
const redact = text => [...secrets].reduce((result, secret) => result.replaceAll(secret, '<redacted>'), text);
const tail = text => redact(text.trim()).slice(-limits.tailChars);
const digest = (data, algorithm = 'sha256') => createHash(algorithm).update(data).digest('hex');

class Blocked extends Error {}

class StageError extends Error {
  constructor(stage, result) {
    super(`${stage}: ${result.tool} ${result.timedOut ? 'timed out' : `exited ${result.status ?? result.spawnError}`}`);
    this.evidence = { stage, tool: result.tool, status: result.status, timedOut: result.timedOut, spawnError: result.spawnError, stderr: tail(result.stderr) };
  }
}

const errorEvidence = error => error instanceof StageError ? error.evidence : { message: redact(String(error?.message ?? error)) };

// stdin is closed so that no tool can wait for a typed password. Arguments never enter errors or the report:
// security commands carry the fixture keychain password.
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: limits.toolMs, killSignal: 'SIGKILL', ...options });
  return {
    tool: basename(command),
    status: result.status,
    timedOut: result.error?.code === 'ETIMEDOUT',
    spawnError: result.error?.code === 'ETIMEDOUT' ? undefined : result.error?.code,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function must(stage, command, args, options) {
  const result = run(command, args, options);
  if (result.status !== 0) throw new StageError(stage, result);
  return result;
}

// For a tool whose non-zero exit is an observation. No exit status (a timeout or spawn error) is not an observation,
// so it stops the arm as incomplete.
function exited(stage, command, args, options) {
  const result = run(command, args, options);
  if (result.status === null) throw new StageError(stage, result);
  return result;
}

const userDefaultKeychain = () => quotedPaths(must('read default keychain', security, ['default-keychain', '-d', 'user']).stdout)[0];
const userSearchList = () => quotedPaths(must('read keychain search list', security, ['list-keychains', '-d', 'user']).stdout);

async function fileStat(path) {
  const info = await stat(path).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
  return info && { size: info.size, modified: info.mtimeMs, inode: info.ino };
}

/** Read-only view of state the pilot must leave unchanged. It reads no production file content and no trust settings. */
export async function globalState() {
  return {
    defaultKeychain: userDefaultKeychain(),
    searchList: userSearchList(),
    productionIdentity: {
      configuration: await fileStat(join(productionDirectory, 'identity.json')),
      keychain: await fileStat(join(productionDirectory, 'signing.keychain-db')),
    },
  };
}

export function cleanupList() {
  const steps = [];
  return {
    add: (name, step) => steps.push({ name, step }),
    async runAll() {
      const results = [];
      for (const { name, step } of steps.reverse()) {
        try {
          await step();
          results.push({ name, ok: true });
        } catch (error) {
          results.push({ name, ok: false, error: errorEvidence(error) });
        }
      }
      return results;
    },
  };
}

async function preflight(rcodesign) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Blocked('Requires macOS on Apple silicon: rcodesign is pinned to aarch64-apple-darwin.');
  }
  const sha256 = digest(await readFile(rcodesign));
  if (sha256 !== pinned.binarySha256) throw new Blocked(`rcodesign SHA-256 ${sha256} is not the pinned ${pinned.binarySha256}.`);
  const version = must('read rcodesign version', rcodesign, ['--version']).stdout.trim();
  if (version !== pinned.version) throw new Blocked(`rcodesign reports "${version}", not "${pinned.version}".`);
  // rcodesign also merges this file, ./rcodesign.toml, and RCODESIGN_* variables. The pilot runs it from an empty
  // directory without those variables, and refuses a user file that could select another signer.
  if (existsSync(join(homedir(), 'Library/Application Support/rcodesign/rcodesign.toml'))) {
    throw new Blocked('An rcodesign user configuration exists. Move it aside before the pilot.');
  }
  return {
    macOS: must('read macOS version', '/usr/bin/sw_vers', []).stdout.trim().split('\n').map(line => line.replace(/\s+/g, ' ')),
    arch: process.arch,
    runnerImage: [process.env.ImageOS, process.env.ImageVersion].filter(Boolean).join(' ') || undefined,
    node: process.version,
    rcodesign: { version, sha256 },
    disposableRunner: process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted',
  };
}

// Same certificate request as ensureMacSigningIdentity in apps/desktop/scripts/macos-signing.mjs.
export async function pemSigner(directory) {
  await mkdir(directory, { mode: 0o700 });
  const certificate = join(directory, 'certificate.pem');
  const privateKey = join(directory, 'private-key.pem');
  must('create fixture identity', 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '3650',
    '-subj', '/CN=einsager Local Signing/', '-addext', 'basicConstraints=critical,CA:FALSE',
    '-addext', 'keyUsage=critical,digitalSignature', '-addext', 'extendedKeyUsage=critical,codeSigning',
    '-keyout', privateKey, '-out', certificate]);
  const described = describeCertificate(readFileSync(certificate));
  return { certificate: described, sha1: described.sha1, args: ['--pem-file', certificate, '--pem-file', privateKey], around: sign => sign() };
}

// The exit check runs inside signer.around, so a failed or timed-out signing call is the thrown error before a
// keychain swap restores the default. A restore failure after it then goes to restoreFailures and does not replace it.
function rcodesignSign(stage, tool, signer, args) {
  signer.around(() => must(stage, tool.path, ['sign', ...signer.args, '--timestamp-url', 'none', ...args], { timeout: limits.signMs, cwd: tool.cwd, env: tool.env }));
}

// A verifier timeout is not a failed check: exited stops the arm as incomplete.
function verifies(args) {
  const result = exited('verify signature', codesign, ['--verify', ...args]);
  return { pass: result.status === 0, detail: result.status === 0 ? undefined : tail(result.stderr) };
}

/**
 * Signs a fixture app twice with one signer, replacing its executables in between as an update does, then checks
 * Apple's verifier, identifiers, certificate leaf, designated requirements, and rejection of other signers.
 * It records the current step, each inspected signature, and each check in `evidence` as soon as they exist, so an
 * error keeps everything measured before it.
 */
export async function proveContinuity(directory, tool, signer, other, evidence) {
  const signatures = evidence.signatures = {};
  const checks = evidence.checks = [];
  const check = (name, pass, detail) => {
    checks.push(detail === undefined ? { name, pass } : { name, pass, detail });
    return pass;
  };
  const scratch = join(directory, 'extracted-certificates');
  await mkdir(scratch, { recursive: true });
  let extraction = 0;
  const inspect = file => {
    const details = signatureDetails(must('read signature', codesign, ['-dvvv', file]).stderr);
    const requirement = must('read designated requirement', codesign, ['-d', '-r-', file]);
    // Ad-hoc signatures have no certificates, so codesign writes no file.
    const prefix = join(scratch, `${extraction++}-`);
    exited('extract certificates', codesign, ['-d', `--extract-certificates=${prefix}`, file]);
    const leafSha1 = existsSync(`${prefix}0`) ? digest(readFileSync(`${prefix}0`), 'sha1').toUpperCase() : undefined;
    return { ...details, designated: designatedRequirement(`${requirement.stdout}\n${requirement.stderr}`), leafSha1 };
  };

  const bundle = join(directory, 'einsager.app');
  const targets = [[bundle, app.identifier], ...app.helpers.map(([file, identifier]) => [join(bundle, 'Contents/Resources', file), identifier])];
  const executables = [join(bundle, 'Contents/MacOS/einsager'), ...targets.slice(1).map(([file]) => file)];
  await mkdir(join(bundle, 'Contents/MacOS'), { recursive: true });
  await mkdir(join(bundle, 'Contents/Resources'));
  await writeFile(join(bundle, 'Contents/Info.plist'), infoPlist);
  const install = async source => {
    for (const executable of executables) await copyFile(source, executable);
  };
  const signApp = (stage, key) => {
    evidence.step = stage;
    rcodesignSign(stage, tool, signer, [...helperIdentifiers, bundle]);
    const inspected = signatures[key] = [];
    for (const [file, expected] of targets) inspected.push({ file: relative(directory, file), expected, ...inspect(file) });
    return inspected;
  };
  const checkSignatures = (stage, inspected) => {
    for (const signature of inspected) {
      check(`${stage} ${signature.file}: identifier`, signature.identifier === signature.expected, signature.identifier);
      check(`${stage} ${signature.file}: fixture leaf, not ad-hoc`, !signature.adhoc && signature.leafSha1 === signer.sha1,
        signature.adhoc ? 'ad-hoc' : signature.leafSha1 ?? 'no certificate');
      check(`${stage} ${signature.file}: explicit designated requirement pins the fixture certificate`,
        signature.designated?.toLowerCase().includes(`h"${signer.sha1.toLowerCase()}"`) ?? false, signature.designated ?? 'implicit only');
    }
  };
  const verifyApp = (stage, inspected, previous) => {
    evidence.step = `${stage} verification`;
    const deep = verifies(['--deep', '--strict', bundle]);
    check(`${stage}: codesign --verify --deep --strict app`, deep.pass, deep.detail);
    for (const [index, signature] of inspected.entries()) {
      const file = join(directory, signature.file);
      const leaf = verifies(['--strict', `-R=${leafRequirement(signature.expected, signer.sha1)}`, file]);
      check(`${stage} ${signature.file}: satisfies the expected leaf requirement`, leaf.pass, leaf.detail);
      if (!previous) continue;
      check(`${stage} ${signature.file}: designated requirement unchanged`, signature.designated === previous[index].designated, signature.designated);
      const kept = verifies(['--strict', `-R=${previous[index].designated}`, file]);
      check(`${stage} ${signature.file}: satisfies the signature 1 designated requirement`, kept.pass, kept.detail);
    }
  };

  await install('/bin/echo');
  const first = signApp('signature 1', 'first');
  checkSignatures('signature 1', first);
  // Continuity and rejection need a fixture signature with an explicit requirement on every item.
  const unusable = first.find(signature => signature.adhoc || signature.leafSha1 !== signer.sha1 || !signature.designated);
  if (unusable) {
    // rcodesign signs ad-hoc and exits 0 when its certificate source finds no identity.
    const verdict = unusable.adhoc ? 'not-signed-by-fixture: ad-hoc after exit 0'
      : unusable.leafSha1 !== signer.sha1 ? 'not-signed-by-fixture' : 'failed: no explicit designated requirement';
    return { verdict };
  }
  verifyApp('signature 1', first);
  await install('/bin/cat');
  const second = signApp('signature 2', 'second');
  checkSignatures('signature 2', second);
  verifyApp('signature 2', second, first);

  const [helper, helperIdentifier] = targets[1];
  const requirements = { 'signature 1 designated': first[1].designated, 'expected leaf': leafRequirement(helperIdentifier, signer.sha1) };
  const rejected = async (name, sign, expectedSignature) => {
    evidence.step = `rejection: ${name}`;
    const copy = join(directory, `reject-${name.replaceAll(' ', '-')}`, basename(helper));
    await mkdir(dirname(copy));
    await copyFile(helper, copy);
    sign(copy);
    const signature = inspect(copy);
    check(`${name}: same identifier ${helperIdentifier}`, signature.identifier === helperIdentifier, signature.identifier);
    check(`${name}: expected signer`, expectedSignature(signature), signature.adhoc ? 'ad-hoc' : signature.leafSha1);
    const own = verifies(['--strict', copy]);
    check(`${name}: own signature is valid (control)`, own.pass, own.detail);
    for (const [label, requirement] of Object.entries(requirements)) {
      const result = verifies(['--strict', `-R=${requirement}`, copy]);
      check(`${name}: rejected by the ${label} requirement`, !result.pass, result.pass ? 'accepted' : 'rejected');
    }
  };
  await rejected('same-identifier ad-hoc', copy => {
    must('ad-hoc sign', codesign, ['--force', '--sign', '-', '--identifier', helperIdentifier, copy]);
  }, signature => signature.adhoc);
  await rejected('other signer', copy => {
    rcodesignSign('other signer', tool, other, ['--binary-identifier', helperIdentifier, copy]);
  }, signature => !signature.adhoc && signature.leafSha1 === other.sha1 && other.sha1 !== signer.sha1);

  return { verdict: checks.every(entry => entry.pass) ? 'passed' : 'failed' };
}

async function deleteKeychain(keychain) {
  if (!existsSync(keychain)) return;
  must('delete fixture keychain', security, ['delete-keychain', keychain]);
  if (existsSync(keychain)) throw new Error('The fixture keychain file remains after delete-keychain.');
}

// rcodesign 0.29.0 reads only SecKeychainCopyDomainDefault for the user domain. Swap it for one call and restore it
// at once. A restore failure is reported, but the original failure, if any, is kept.
function withDefaultKeychain(keychain, password, restoreFailures, call) {
  const original = userDefaultKeychain();
  if (!original) throw new Error('There is no user default keychain to restore, so the pilot does not change it.');
  must('unlock fixture keychain', security, ['unlock-keychain', '-p', password, keychain]);
  must('make fixture keychain the user default', security, ['default-keychain', '-d', 'user', '-s', keychain]);
  let outcome;
  try {
    outcome = { value: call() };
  } catch (error) {
    outcome = { error };
  }
  try {
    must('restore user default keychain', security, ['default-keychain', '-d', 'user', '-s', original]);
    if (userDefaultKeychain() !== original) throw new Error('The user default keychain differs after restore.');
  } catch (error) {
    restoreFailures.push(errorEvidence(error));
    if (!outcome.error) throw error;
  }
  if (outcome.error) throw outcome.error;
  return outcome.value;
}

/** Records into the same `evidence` as proveContinuity, so an error during the proof keeps the keychain facts too. */
export async function keychainArm(directory, tool, signingModule, other, control, cleanup, before, evidence) {
  cleanup.add('restore user default keychain and search list', () => {
    if (userDefaultKeychain() !== before.defaultKeychain) {
      must('restore user default keychain', security, ['default-keychain', '-d', 'user', '-s', before.defaultKeychain]);
    }
    if (!isDeepStrictEqual(userSearchList(), before.searchList)) {
      must('restore keychain search list', security, ['list-keychains', '-d', 'user', '-s', ...before.searchList]);
    }
  });
  const identityDirectory = join(directory, 'identity');
  const keychain = join(identityDirectory, 'signing.keychain-db');
  cleanup.add('delete keychain-arm fixture keychain', () => deleteKeychain(keychain));

  // The project's own bootstrap gives the exact certificate format, keychain, and key ACL under test.
  evidence.step = 'create fixture identity';
  const { ensureMacSigningIdentity } = await import(pathToFileURL(resolve(signingModule)).href);
  await ensureMacSigningIdentity(identityDirectory);
  const stored = JSON.parse(await readFile(join(identityDirectory, 'identity.json'), 'utf8'));
  secrets.add(stored.password);
  evidence.step = 'read fixture identity';
  const certificate = describeCertificate(must('read fixture certificate', security, ['find-certificate', '-a', '-p', keychain]).stdout);
  Object.assign(evidence, {
    certificate,
    sameFormatAsControl: isDeepStrictEqual(certificate.format, control.certificate.format),
    storedIdentityIsCertificate: stored.identity.toUpperCase() === certificate.sha1,
    identities: {},
  });
  for (const [name, flags] of [['all', []], ['valid', ['-v']]]) {
    const result = exited('find fixture identity', security, ['find-identity', ...flags, '-p', 'codesigning', keychain]);
    evidence.identities[name] = { status: result.status, output: tail(result.stdout) };
  }
  const restoreFailures = evidence.restoreFailures = [];
  const signer = {
    sha1: certificate.sha1,
    // rcodesign rejects --keychain-domain with --keychain-fingerprint; the fingerprint alone searches the user domain.
    args: ['--keychain-fingerprint', certificate.sha256],
    around: call => withDefaultKeychain(keychain, stored.password, restoreFailures, call),
  };
  evidence.step = 'list keychain certificates';
  const listed = signer.around(() => exited('list keychain certificates', tool.path, ['keychain-print-certificates', '--domain', 'user'], { cwd: tool.cwd, env: tool.env }));
  const fingerprints = listedFingerprints(listed.stdout);
  evidence.discovery = { status: listed.status, certificatesListed: fingerprints.length, fixtureListed: fingerprints.includes(certificate.sha256.toLowerCase()) };
  return proveContinuity(join(directory, 'continuity'), tool, signer, other, evidence);
}

/**
 * Runs one requested arm. `proof` is 'complete' when the arm reached a verdict, which may be a negative finding such
 * as an ad-hoc signature. An error, a timeout, or a block leaves it 'incomplete': that is not a finding about signing.
 */
export async function arm(prove) {
  // The arm records its evidence here as it goes, so an error keeps everything measured before it.
  const evidence = {};
  try {
    const { verdict } = await prove(evidence);
    return { proof: 'complete', verdict, ...evidence };
  } catch (error) {
    const timedOut = error instanceof StageError && error.evidence.timedOut;
    return { proof: 'incomplete', verdict: timedOut ? 'timeout' : 'error', ...evidence, error: errorEvidence(error) };
  }
}

const describeError = error => error.message ?? `${error.stage}: ${error.tool} ${error.timedOut ? 'timed out' : `exit ${error.status ?? error.spawnError}`}`;

/**
 * Why the run is not complete evidence. Exit 0 needs an empty list: no stop, every requested arm complete, cleanup
 * done, and the measured host state unchanged. An arm that was not requested is neither complete nor a gap.
 */
export function incompleteReasons(report) {
  const reasons = [];
  if (report.error) reasons.push(`stopped: ${describeError(report.error)}`);
  for (const [name, result] of Object.entries(report.arms ?? {})) {
    if (result.proof !== 'complete' && result.proof !== 'not requested') reasons.push(`${name} arm ${result.proof}: ${result.verdict}`);
  }
  if (!(report.cleanup ?? []).every(step => step.ok)) reasons.push('cleanup failed');
  if (report.unchanged !== true) reasons.push(report.unchanged === false ? 'measured host state changed' : 'host state not measured');
  return reasons;
}

/** The console and job summary. Its first line states the same completeness as the exit status. */
export function summary(report) {
  const incomplete = incompleteReasons(report);
  const lines = [`rcodesign signing pilot (diagnostic, not acceptance): ${incomplete.length ? 'INCOMPLETE evidence, exit 1' : 'complete evidence for the requested arms, exit 0'}`];
  for (const reason of incomplete) lines.push(`- incomplete: ${reason}`);
  for (const [name, result] of Object.entries(report.arms ?? {})) {
    lines.push(`- ${name}: ${result.proof}${result.verdict ? `, verdict ${result.verdict}` : ''}${result.reason ? ` (${result.reason})` : ''}`);
    if (result.error) lines.push(`  error during ${result.step ?? 'setup'}: ${describeError(result.error)}`);
    for (const failed of (result.checks ?? []).filter(entry => !entry.pass).slice(0, 8)) {
      lines.push(`  failed check: ${failed.name}${failed.detail ? `: ${failed.detail.split('\n').at(-1)}` : ''}`);
    }
  }
  lines.push(`- cleanup: ${(report.cleanup ?? []).every(step => step.ok) ? 'complete' : 'FAILED, see report'}`);
  lines.push(`- user default keychain, keychain search list, production identity metadata unchanged: ${report.unchanged ?? 'not measured'}`);
  lines.push('- trust settings: not read; the pilot runs no trust command');
  return lines;
}

async function main() {
  const { values } = parseArgs({ options: {
    rcodesign: { type: 'string' }, 'signing-module': { type: 'string' }, out: { type: 'string' }, keychain: { type: 'boolean' },
  } });
  if (!values.rcodesign || !values['signing-module'] || !values.out) {
    console.error('Usage: macos-signing-pilot.mjs --rcodesign <path> --signing-module <apps/desktop/scripts/macos-signing.mjs> --out <result.json> [--keychain]');
    process.exitCode = 2;
    return;
  }
  const report = { pilot: 'einsager #10/#11 rcodesign 0.29.0 signing pilot', evidenceOnly: true, startedAt: new Date().toISOString() };
  const cleanup = cleanupList();
  try {
    report.preflight = await preflight(values.rcodesign);
    report.before = await globalState();
    const root = await mkdtemp(join(tmpdir(), 'einsager-signing-pilot-'));
    cleanup.add('remove temporary directory', () => rm(root, { recursive: true, force: true }));
    const tool = {
      path: resolve(values.rcodesign),
      cwd: join(root, 'empty'),
      env: Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('RCODESIGN_'))),
    };
    await mkdir(tool.cwd);
    const control = await pemSigner(join(root, 'control-signer'));
    const other = await pemSigner(join(root, 'other-signer'));
    report.arms = {
      fileKeyControl: { certificate: control.certificate, ...await arm(evidence => proveContinuity(join(root, 'file-key'), tool, control, other, evidence)) },
    };
    if (!values.keychain) {
      report.arms.keychain = { proof: 'not requested', reason: 'no --keychain option, so this run has no keychain evidence' };
    } else if (!report.preflight.disposableRunner) {
      report.arms.keychain = { proof: 'incomplete', verdict: 'blocked', reason: 'it changes the user default keychain, so it runs only on a disposable GitHub-hosted runner' };
    } else {
      report.arms.keychain = await arm(evidence => keychainArm(join(root, 'keychain'), tool, values['signing-module'], other, control, cleanup, report.before, evidence));
    }
  } catch (error) {
    report.error = error instanceof Blocked ? { blocked: true, message: error.message } : errorEvidence(error);
  } finally {
    report.cleanup = await cleanup.runAll();
    if (report.before) {
      try {
        report.after = await globalState();
        report.unchanged = isDeepStrictEqual(report.before, report.after);
      } catch (error) {
        report.after = { error: errorEvidence(error) };
      }
    }
  }

  report.incomplete = incompleteReasons(report);
  const text = `${JSON.stringify(report, null, 2)}\n`;
  for (const secret of secrets) assert(!text.includes(secret), 'The report must not contain a fixture secret.');
  await mkdir(dirname(resolve(values.out)), { recursive: true });
  await writeFile(values.out, text);
  const lines = summary(report);
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  // Exit 0 means the requested evidence is complete and the host is as it was. The arm verdicts are the findings, so a
  // complete negative verdict exits 0 and an error, timeout, or block in a requested arm exits 1.
  process.exitCode = report.incomplete.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
