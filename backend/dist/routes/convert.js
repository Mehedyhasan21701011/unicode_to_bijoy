"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertRouter = void 0;
const express_1 = require("express");
const path_1 = __importDefault(require("path"));
const upload_1 = require("../middleware/upload");
const pdfExtract_1 = require("../services/pdfExtract");
const pdfLayoutBlocks_1 = require("../services/pdfLayoutBlocks");
const ocr_1 = require("../services/ocr");
const docxExtract_1 = require("../services/docxExtract");
const legacyDocConvert_1 = require("../services/legacyDocConvert");
const unicodeToBijoy_1 = require("../converter/unicodeToBijoy");
const docModel_1 = require("../model/docModel");
const cleanup_1 = require("../utils/cleanup");
exports.convertRouter = (0, express_1.Router)();
function sseWrite(res, event, data) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    // Flush immediately if compression/buffering middleware is present.
    res.flush?.();
}
/**
 * POST /api/convert
 * multipart/form-data field: "file" (.pdf, .docx or .doc)
 *
 * Streams Server-Sent Events so the client can render:
 *   Uploading -> Extracting Text -> OCR (if needed) -> Converting to Bijoy
 *   -> Creating Document -> Ready
 * and terminates with either a "done" event (full result, including the
 * structured `blocks` used to build a layout-faithful .docx) or an "error"
 * event.
 */
exports.convertRouter.post("/convert", (req, res) => {
    (0, upload_1.uploadDocument)(req, res, async (multerErr) => {
        // --- SSE headers must be set before any error handling below, so
        // every failure path (including upload failures) is reported the same
        // consistent way to the client. ---
        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
        });
        let tempFilePath;
        let ocrOutDir;
        let legacyConvertDir;
        const fail = async (message, code) => {
            sseWrite(res, "error", { message, code });
            res.end();
            if (tempFilePath)
                await (0, cleanup_1.safeDelete)(tempFilePath);
            if (ocrOutDir)
                await (0, cleanup_1.safeDelete)(ocrOutDir, true);
            if (legacyConvertDir)
                await (0, cleanup_1.safeDelete)(legacyConvertDir, true);
        };
        try {
            if (multerErr) {
                if (multerErr.code === "LIMIT_FILE_SIZE") {
                    return fail(`The file is too large. Maximum allowed size is ${upload_1.MAX_FILE_SIZE_MB}MB.`, "TOO_LARGE");
                }
                if (multerErr.message === "UNSUPPORTED_FILE_TYPE") {
                    return fail("Only .pdf, .docx and .doc files are supported.", "UNSUPPORTED_FILE_TYPE");
                }
                return fail("Upload failed. Please try again.", "UPLOAD_FAILED");
            }
            if (!req.file) {
                return fail("No file was uploaded.", "NO_FILE");
            }
            tempFilePath = req.file.path;
            const kind = (0, upload_1.uploadKindForFile)(req.file.originalname);
            sseWrite(res, "progress", { step: "uploading", message: "File uploaded" });
            let blocks = [];
            let numPages = 1;
            let usedOcr = false;
            if (kind === "pdf") {
                sseWrite(res, "progress", { step: "extracting", message: "Extracting text and layout from PDF" });
                const extracted = await (0, pdfExtract_1.extractPdfBlocks)(tempFilePath);
                numPages = extracted.numPages;
                blocks = extracted.blocks;
                // --- OCR fallback for scanned/image-based PDFs, or PDFs whose
                // embedded font has a broken ToUnicode mapping for shaped Bengali
                // conjuncts (common with some Bengali OpenType fonts) ---
                if (extracted.isLikelyScanned || extracted.isLikelyGarbled) {
                    usedOcr = true;
                    sseWrite(res, "progress", {
                        step: "ocr",
                        message: extracted.isLikelyScanned
                            ? "No embedded text found — running Bengali OCR on scanned pages"
                            : "Embedded text looks unreliable — re-reading pages with Bengali OCR",
                    });
                    ocrOutDir = path_1.default.join(path_1.default.dirname(tempFilePath), `ocr_${path_1.default.basename(tempFilePath, path_1.default.extname(tempFilePath))}`);
                    const images = await (0, ocr_1.rasterizePdf)(tempFilePath, ocrOutDir);
                    const ocrText = await (0, ocr_1.ocrImages)(images, (pageIndex, totalPages) => {
                        sseWrite(res, "progress", {
                            step: "ocr",
                            message: `OCR: page ${pageIndex} of ${totalPages}`,
                        });
                    });
                    blocks = (0, pdfLayoutBlocks_1.blocksFromPlainText)(ocrText);
                    await (0, ocr_1.cleanupImages)(images);
                    await (0, cleanup_1.safeDelete)(ocrOutDir, true);
                    ocrOutDir = undefined;
                }
            }
            else if (kind === "docx") {
                sseWrite(res, "progress", { step: "extracting", message: "Reading document structure" });
                blocks = await (0, docxExtract_1.extractDocxBlocks)(tempFilePath);
            }
            else if (kind === "doc") {
                sseWrite(res, "progress", { step: "extracting", message: "Converting legacy .doc file" });
                legacyConvertDir = path_1.default.join(path_1.default.dirname(tempFilePath), `doc_${path_1.default.basename(tempFilePath, path_1.default.extname(tempFilePath))}`);
                const convertedPath = await (0, legacyDocConvert_1.convertLegacyDocToDocx)(tempFilePath, legacyConvertDir);
                blocks = await (0, docxExtract_1.extractDocxBlocks)(convertedPath);
                await (0, cleanup_1.safeDelete)(legacyConvertDir, true);
                legacyConvertDir = undefined;
            }
            else {
                return fail("Only .pdf, .docx and .doc files are supported.", "UNSUPPORTED_FILE_TYPE");
            }
            const unicodeText = (0, docModel_1.flattenBlocksToText)(blocks);
            if (!unicodeText || unicodeText.replace(/\s/g, "").length === 0) {
                return fail(usedOcr
                    ? "OCR could not detect any readable text in this document."
                    : "No text could be extracted from this document.", "EMPTY_DOCUMENT");
            }
            if (!(0, unicodeToBijoy_1.isUnicodeBengali)(unicodeText)) {
                return fail("No Bengali text was detected in this document. Please upload a Bengali-language document.", "NO_BENGALI_DETECTED");
            }
            // --- Convert to Bijoy ---
            sseWrite(res, "progress", {
                step: "converting",
                message: "Converting Unicode Bengali to Bijoy (SutonnyMJ) encoding",
            });
            const conversion = (0, unicodeToBijoy_1.convertBlocks)(blocks);
            sseWrite(res, "progress", { step: "creating_document", message: "Preparing preview" });
            sseWrite(res, "progress", { step: "ready", message: "Done" });
            sseWrite(res, "done", {
                unicodeText,
                bijoyText: (0, docModel_1.flattenBlocksToText)(conversion.blocks),
                blocks: conversion.blocks,
                fullyConverted: conversion.fullyConverted,
                unconvertedChars: conversion.unconvertedChars,
                usedOcr,
                numPages,
                bengaliDensity: (0, unicodeToBijoy_1.bengaliDensity)(unicodeText),
            });
            res.end();
        }
        catch (err) {
            if (err instanceof pdfExtract_1.PdfError || err instanceof ocr_1.OcrError || err instanceof docxExtract_1.DocxError || err instanceof legacyDocConvert_1.LegacyDocError) {
                return fail(err.message, err.code);
            }
            console.error("Unexpected conversion error:", err);
            return fail("An unexpected error occurred while processing the document.", "INTERNAL_ERROR");
        }
        finally {
            if (tempFilePath)
                await (0, cleanup_1.safeDelete)(tempFilePath);
            if (ocrOutDir)
                await (0, cleanup_1.safeDelete)(ocrOutDir, true);
            if (legacyConvertDir)
                await (0, cleanup_1.safeDelete)(legacyConvertDir, true);
        }
    });
});
//# sourceMappingURL=convert.js.map