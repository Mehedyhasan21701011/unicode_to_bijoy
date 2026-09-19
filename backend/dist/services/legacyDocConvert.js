"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LegacyDocError = void 0;
exports.convertLegacyDocToDocx = convertLegacyDocToDocx;
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const util_1 = require("util");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
class LegacyDocError extends Error {
    constructor(message, code) {
        super(message);
        this.code = code;
        this.name = "LegacyDocError";
    }
}
exports.LegacyDocError = LegacyDocError;
/**
 * Converts a legacy .doc (or .rtf/.odt) file to .docx using headless
 * LibreOffice, so it can be read by the same structural DOCX extractor
 * used for native .docx uploads. This is the standard, reliable way to
 * read old binary Word formats - there is no maintained pure-JS parser for
 * the legacy OLE-based .doc format that handles Bengali text reliably.
 *
 * Requires the `soffice` (LibreOffice) binary - see README.
 */
async function convertLegacyDocToDocx(inputPath, outDir) {
    await fs_1.default.promises.mkdir(outDir, { recursive: true });
    try {
        await execFileAsync("soffice", ["--headless", "--norestore", "--convert-to", "docx:MS Word 2007 XML", "--outdir", outDir, inputPath], { timeout: 60000, maxBuffer: 1024 * 1024 * 20 });
    }
    catch (err) {
        if (err.code === "ENOENT") {
            throw new LegacyDocError("Converting .doc files requires LibreOffice (`soffice`) to be installed on the server. " +
                "Install it with `apt-get install libreoffice` (Linux) or `brew install --cask libreoffice` (macOS).", "LIBREOFFICE_MISSING");
        }
        throw new LegacyDocError(`Could not convert this .doc file: ${err.message}`, "CONVERSION_FAILED");
    }
    const baseName = path_1.default.basename(inputPath, path_1.default.extname(inputPath));
    const outputPath = path_1.default.join(outDir, `${baseName}.docx`);
    const exists = await fs_1.default.promises
        .access(outputPath, fs_1.default.constants.F_OK)
        .then(() => true)
        .catch(() => false);
    if (!exists) {
        throw new LegacyDocError("LibreOffice did not produce a .docx file - the .doc file may be corrupted or password-protected.", "CONVERSION_FAILED");
    }
    return outputPath;
}
//# sourceMappingURL=legacyDocConvert.js.map