import multer from "multer";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

export const TMP_DIR = path.join(__dirname, "..", "..", "tmp");
if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

export type UploadKind = "pdf" | "docx" | "doc";

const EXTENSION_KIND: Record<string, UploadKind> = {
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

export function uploadKindForFile(originalName: string): UploadKind | undefined {
  return EXTENSION_KIND[path.extname(originalName).toLowerCase()];
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, TMP_DIR),
  filename: (_req, file, cb) => {
    const id = uuidv4();
    const ext = path.extname(file.originalname).toLowerCase() || ".pdf";
    cb(null, `${id}${ext}`);
  },
});

function fileFilter(_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  const kind = uploadKindForFile(file.originalname);
  const mimeOk = ACCEPTED_MIME_TYPES.has(file.mimetype);
  if (!kind || !mimeOk) {
    cb(new Error("UNSUPPORTED_FILE_TYPE"));
    return;
  }
  cb(null, true);
}

export const uploadDocument = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: 1,
  },
}).single("file");

// Kept for backward compatibility with any code still referencing the old
// PDF-only field name.
export const uploadPdf = uploadDocument;

export const MAX_FILE_SIZE_MB = MAX_FILE_SIZE_BYTES / (1024 * 1024);
export const ACCEPTED_EXTENSIONS = Object.keys(EXTENSION_KIND);
