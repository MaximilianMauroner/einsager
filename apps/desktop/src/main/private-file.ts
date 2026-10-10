import { readFile, rename, writeFile } from 'node:fs/promises';

/** One owner-only file, replaced whole. Writes run in order, and a crash leaves the previous version readable. */
export class PrivateFile {
  private file: string;
  private writing = Promise.resolve();

  constructor(file: string) {
    this.file = file;
  }

  read() { return readFile(this.file, 'utf8'); }

  write(contents: string) {
    const next = this.writing.catch(() => undefined).then(async () => {
      await writeFile(this.file + '.tmp', contents, { mode: 0o600 });
      await rename(this.file + '.tmp', this.file);
    });
    this.writing = next;
    return next;
  }
}
