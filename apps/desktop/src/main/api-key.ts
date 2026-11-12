import { stat, rm } from 'node:fs/promises';
import { PrivateFile } from './private-file.ts';

interface Encryption {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export function validateApiKey(value: string): string {
  const key = value.trim();
  if (value.length > 4096 || !/^sk-[\x21-\x7e]{7,}$/.test(key)) throw new Error('Enter a valid OpenAI API key.');
  return key;
}

export class ApiKeyStore {
  private readonly file: PrivateFile;
  private readonly path: string;
  private readonly encryption: Encryption;
  constructor(path: string, encryption: Encryption) {
    this.path = path;
    this.encryption = encryption;
    this.file = new PrivateFile(path);
  }

  async hasKey() { return stat(this.path).then(() => true, () => false); }

  private requireEncryption() {
    if (!this.encryption.isEncryptionAvailable() || this.encryption.getSelectedStorageBackend?.() === 'basic_text') {
      throw new Error('Secure key storage is unavailable. Unlock your system key store and restart einsager.');
    }
  }

  async save(value: string) {
    const key = validateApiKey(value);
    this.requireEncryption();
    try { await this.file.write(this.encryption.encryptString(key).toString('base64')); }
    catch { throw new Error('Cannot save the API key in secure storage.'); }
  }

  async read() {
    this.requireEncryption();
    try { return validateApiKey(this.encryption.decryptString(Buffer.from(await this.file.read(), 'base64'))); }
    catch { throw new Error('Cannot read the API key. Add it again in Settings.'); }
  }

  async remove() {
    await this.file.settled();
    try { await rm(this.path, { force: true }); }
    catch { throw new Error('Cannot remove the API key.'); }
  }
}
