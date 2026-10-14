import { readFile, rename, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * Pauses between attempts to replace a file that Windows reports as in use. They total under 1.3 seconds,
 * so a lasting failure is still reported and holds later writes and quitting only briefly.
 */
const IN_USE_PAUSES_MS = [10, 20, 40, 80, 160, 320, 640];

type Replace = (from: string, to: string) => Promise<void>;

/**
 * Windows can reject replacing a file for a moment with EPERM or EBUSY while the file is in use.
 * Tries again a few times, then reports the last error. The previous file stays whole until a replacement succeeds.
 */
export function retryWhileInUse(replace: Replace): Replace {
  return async (from, to) => {
    for (const pause of IN_USE_PAUSES_MS) {
      try { return await replace(from, to); }
      catch (error) { if (!inUse(error)) throw error; }
      await sleep(pause);
    }
    return replace(from, to);
  };
}

function inUse(error: unknown) {
  return error instanceof Error && 'code' in error && (error.code === 'EPERM' || error.code === 'EBUSY');
}

/** One owner-only file, replaced whole. Writes run in order, and a crash leaves the previous version readable. */
export class PrivateFile {
  private file: string;
  private replace: Replace;
  private writing = Promise.resolve();

  /** `replace` moves the finished temporary file over the file. */
  constructor(file: string, replace: Replace = process.platform === 'win32' ? retryWhileInUse(rename) : rename) {
    this.file = file;
    this.replace = replace;
  }

  read() { return readFile(this.file, 'utf8'); }

  /** Renames a file that cannot be read, so the next write cannot destroy what it still holds. */
  async keepAside() {
    await rename(this.file, `${this.file}.unreadable-${Date.now()}`);
  }

  write(contents: string) {
    const next = this.writing.catch(() => undefined).then(async () => {
      await writeFile(this.file + '.tmp', contents, { mode: 0o600 });
      await this.replace(this.file + '.tmp', this.file);
    });
    this.writing = next;
    return next;
  }

  /** Resolves once every write queued so far has finished or failed, for example before quit. Never rejects. */
  settled() { return this.writing.catch(() => undefined); }
}
