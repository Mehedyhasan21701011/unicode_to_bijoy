import fs from "fs";
import path from "path";

/**
 * Best-effort deletion of a temp file/dir. Never throws - cleanup failures
 * should not surface as user-facing errors.
 */
export async function safeDelete(targetPath: string, isDir = false): Promise<void> {
  try {
    if (isDir) {
      await fs.promises.rm(targetPath, { recursive: true, force: true });
    } else {
      await fs.promises.unlink(targetPath);
    }
  } catch {
    // Ignore - file may already be gone, or never existed.
  }
}

/**
 * Removes temporary files and directories older than maxAgeMs from targetDir.
 */
export async function cleanupOldTempFiles(targetDir: string, maxAgeMs = 3600000): Promise<void> {
  try {
    if (!fs.existsSync(targetDir)) return;
    const entries = await fs.promises.readdir(targetDir, { withFileTypes: true });
    const now = Date.now();

    for (const entry of entries) {
      const fullPath = path.join(targetDir, entry.name);
      try {
        const stats = await fs.promises.stat(fullPath);
        if (now - stats.mtimeMs > maxAgeMs) {
          await safeDelete(fullPath, entry.isDirectory());
        }
      } catch {
        // Ignore single file error
      }
    }
  } catch {
    // Ignore cleanup error
  }
}
