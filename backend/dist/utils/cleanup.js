"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeDelete = safeDelete;
const fs_1 = __importDefault(require("fs"));
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
//# sourceMappingURL=cleanup.js.map