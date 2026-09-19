"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACCEPTED_EXTENSIONS = exports.MAX_FILE_SIZE_MB = exports.uploadPdf = exports.uploadDocument = exports.TMP_DIR = void 0;
exports.uploadKindForFile = uploadKindForFile;
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const uuid_1 = require("uuid");
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
exports.TMP_DIR = path_1.default.join(__dirname, "..", "..", "tmp");
if (!fs_1.default.existsSync(exports.TMP_DIR)) {
    fs_1.default.mkdirSync(exports.TMP_DIR, { recursive: true });
}
const EXTENSION_KIND = {
    ".pdf": "pdf",
    ".docx": "docx",
    ".doc": "doc",
};
const ACCEPTED_MIME_TYPES = new Set([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
    "application/msword", // .doc
    // Some browsers/OSes send a generic type for legacy .doc uploads.
    "application/octet-stream",
]);
function uploadKindForFile(originalName) {
    return EXTENSION_KIND[path_1.default.extname(originalName).toLowerCase()];
}
const storage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => cb(null, exports.TMP_DIR),
    filename: (_req, file, cb) => {
        const id = (0, uuid_1.v4)();
        const ext = path_1.default.extname(file.originalname).toLowerCase() || ".pdf";
        cb(null, `${id}${ext}`);
    },
});
function fileFilter(_req, file, cb) {
    const kind = uploadKindForFile(file.originalname);
    const mimeOk = ACCEPTED_MIME_TYPES.has(file.mimetype);
    if (!kind || !mimeOk) {
        cb(new Error("UNSUPPORTED_FILE_TYPE"));
        return;
    }
    cb(null, true);
}
exports.uploadDocument = (0, multer_1.default)({
    storage,
    fileFilter,
    limits: {
        fileSize: MAX_FILE_SIZE_BYTES,
        files: 1,
    },
}).single("file");
// Kept for backward compatibility with any code still referencing the old
// PDF-only field name.
exports.uploadPdf = exports.uploadDocument;
exports.MAX_FILE_SIZE_MB = MAX_FILE_SIZE_BYTES / (1024 * 1024);
exports.ACCEPTED_EXTENSIONS = Object.keys(EXTENSION_KIND);
//# sourceMappingURL=upload.js.map