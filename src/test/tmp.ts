import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';

/** A new empty folder under the system temp folder, removed (with everything in it) when the test ends. */
export function tmpdir(t: TestContext, prefix = 'ncdev-test-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* still in use (Windows): the system cleans its temp folder */
    }
  });
  return dir;
}
