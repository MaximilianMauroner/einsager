import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ApiKeyStore, validateApiKey } from '../src/main/api-key.ts';

const fakeEncryption = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'test-secure-backend',
  encryptString: (value: string) => Buffer.from(value.split('').reverse().join('')),
  decryptString: (value: Buffer) => value.toString().split('').reverse().join(''),
};

test('only encrypted data reaches the private file and removal leaves no stored key', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'einsager-key-test-'));
  const path = join(directory, 'key.enc');
  const store = new ApiKeyStore(path, fakeEncryption);
  try {
    assert.equal(await store.hasKey(), false);
    await store.save(' sk-test-only-key\n');
    assert.equal(await store.hasKey(), true);
    assert.equal((await readFile(path, 'utf8')).includes('sk-test-only-key'), false);
    if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal(await store.read(), 'sk-test-only-key');
    await store.remove();
    assert.equal(await store.hasKey(), false);
    await assert.rejects(store.read(), { message: 'Cannot read the API key. Add it again in Settings.' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('insecure Linux fallback and unavailable system storage refuse to save keys', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'einsager-key-test-'));
  try {
    for (const encryption of [
      { ...fakeEncryption, getSelectedStorageBackend: () => 'basic_text' },
      { ...fakeEncryption, isEncryptionAvailable: () => false },
    ]) {
      const store = new ApiKeyStore(join(directory, 'key.enc'), encryption);
      await assert.rejects(store.save('sk-test-only-key'), /Secure key storage is unavailable/);
      assert.equal(await store.hasKey(), false);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('validation and encryption errors never expose the entered key', async () => {
  const key = 'sk-do-not-expose';
  for (const invalid of ['', 'wrong', 'sk-short', `${key}\r\nX-Header: secret`, `sk-${'a'.repeat(4096)}`]) {
    assert.throws(() => validateApiKey(invalid), { message: 'Enter a valid OpenAI API key.' });
  }
  const store = new ApiKeyStore('/unused', { ...fakeEncryption, encryptString: () => { throw new Error(key); } });
  await assert.rejects(store.save(key), { message: 'Cannot save the API key in secure storage.' });
});
