"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeDelete = safeDelete;
exports.cleanupOldTempFiles = cleanupOldTempFiles;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
/**
 * Best-effort deletion of a temp file/dir. Never throws - cleanup failures
 * should not surface as user-facing errors.
 */
async function safeDelete(targetPath, isDir = false) {
    try {
        if (isDir) {
            await fs_1.default.promises.rm(targetPath, { recursive: true, force: true });
        }
        else {
            await fs_1.default.promises.unlink(targetPath);
        }
    }
    catch {
        // Ignore - file may already be gone, or never existed.
    }
}
/**
 * Removes temporary files and directories older than maxAgeMs from targetDir.
 */
async function cleanupOldTempFiles(targetDir, maxAgeMs = 3600000) {
    try {
        if (!fs_1.default.existsSync(targetDir))
            return;
        const entries = await fs_1.default.promises.readdir(targetDir, { withFileTypes: true });
        const now = Date.now();
        for (const entry of entries) {
            const fullPath = path_1.default.join(targetDir, entry.name);
            try {
                const stats = await fs_1.default.promises.stat(fullPath);
                if (now - stats.mtimeMs > maxAgeMs) {
                    await safeDelete(fullPath, entry.isDirectory());
                }
            }
            catch {
                // Ignore single file error
            }
        }
    }
    catch {
        // Ignore cleanup error
    }
}
//# sourceMappingURL=cleanup.js.map