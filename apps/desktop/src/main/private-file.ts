import { readFile, rename, writeFile } from 'node:fs/promises';

/** One owner-only file, replaced whole. Writes run in order, and a crash leaves the previous version readable. */
export class PrivateFile {
  private file: string;
  private writing = Promise.resolve();

  constructor(file: string) {
    this.file = file;
  }

  read() { return readFile(this.file, 'utf8'); }

  /** Renames a file that cannot be read, so the next write cannot destroy what it still holds. */
  async keepAside() {
    await rename(this.file, `${this.file}.unreadable-${Date.now()}`);
  }

  write(contents: string) {
    const next = this.writing.catch(() => undefined).then(async () => {
      await writeFile(this.file + '.tmp', contents, { mode: 0o600 });
      await rename(this.file + '.tmp', this.file);
    });
    this.writing = next;
    return next;
  }

  /** Resolves once every write queued so far has finished or failed, for example before quit. Never rejects. */
  settled() { return this.writing.catch(() => undefined); }
}
