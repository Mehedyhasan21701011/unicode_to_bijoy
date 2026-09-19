import fs from "fs";

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
