// Temporary folders for the tests. tests/setup.js removes them once the tests of
// the file that made them are done, so a run leaves nothing behind in the system
// temp folder. Removal waits for the whole file rather than each test because
// the migration tests run concurrently and share the file's hooks.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const made = [];

/** A new, empty folder under the system temp folder, removed after this test file. */
export function tempDir(prefix) {
  const path = mkdtempSync(join(tmpdir(), prefix));
  made.push(path);
  return path;
}

/** Remove every folder `tempDir` made so far. A folder another process still holds stays. */
export function removeTempDirs() {
  for (const path of made.splice(0)) {
    try {
      rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // Cleanup is best effort: a folder still in use must not fail the run.
    }
  }
}
