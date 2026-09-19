import { Router, Request, Response } from "express";
import path from "path";
import { uploadDocument, MAX_FILE_SIZE_MB, uploadKindForFile } from "../middleware/upload";
import { extractPdfBlocks, PdfError } from "../services/pdfExtract";
import { blocksFromPlainText } from "../services/pdfLayoutBlocks";
import { rasterizePdf, ocrImages, cleanupImages, OcrError } from "../services/ocr";
import { extractDocxBlocks, DocxError } from "../services/docxExtract";
import { convertLegacyDocToDocx, LegacyDocError } from "../services/legacyDocConvert";
import { convertBlocks, isUnicodeBengali, bengaliDensity } from "../converter/unicodeToBijoy";
import { flattenBlocksToText, type DocBlock } from "../model/docModel";
import { safeDelete } from "../utils/cleanup";

export const convertRouter = Router();

type ProgressStep =
  | "uploading"
  | "extracting"
  | "ocr"
  | "converting"
  | "creating_document"
  | "ready";

function sseWrite(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  // Flush immediately if compression/buffering middleware is present.
  (res as any).flush?.();
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
convertRouter.post("/convert", (req: Request, res: Response) => {
  uploadDocument(req, res, async (multerErr: any) => {
    // --- SSE headers must be set before any error handling below, so
    // every failure path (including upload failures) is reported the same
    // consistent way to the client. ---
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    let tempFilePath: string | undefined;
    let ocrOutDir: string | undefined;
    let legacyConvertDir: string | undefined;

    const fail = async (message: string, code: string) => {
      sseWrite(res, "error", { message, code });
      res.end();
      if (tempFilePath) await safeDelete(tempFilePath);
      if (ocrOutDir) await safeDelete(ocrOutDir, true);
      if (legacyConvertDir) await safeDelete(legacyConvertDir, true);
    };

    try {
      if (multerErr) {
        if (multerErr.code === "LIMIT_FILE_SIZE") {
          return fail(
            `The file is too large. Maximum allowed size is ${MAX_FILE_SIZE_MB}MB.`,
            "TOO_LARGE"
          );
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
      const kind = uploadKindForFile(req.file.originalname);
      sseWrite(res, "progress", { step: "uploading" as ProgressStep, message: "File uploaded" });

      let blocks: DocBlock[] = [];
      let numPages = 1;
      let usedOcr = false;

      if (kind === "pdf") {
        sseWrite(res, "progress", { step: "extracting" as ProgressStep, message: "Extracting text and layout from PDF" });
        const extracted = await extractPdfBlocks(tempFilePath);
        numPages = extracted.numPages;
        blocks = extracted.blocks;

        // --- OCR fallback for scanned/image-based PDFs, or PDFs whose
        // embedded font has a broken ToUnicode mapping for shaped Bengali
        // conjuncts (common with some Bengali OpenType fonts) ---
        if (extracted.isLikelyScanned || extracted.isLikelyGarbled) {
          usedOcr = true;
          sseWrite(res, "progress", {
            step: "ocr" as ProgressStep,
            message: extracted.isLikelyScanned
              ? "No embedded text found — running Bengali OCR on scanned pages"
              : "Embedded text looks unreliable — re-reading pages with Bengali OCR",
          });

          ocrOutDir = path.join(path.dirname(tempFilePath), `ocr_${path.basename(tempFilePath, path.extname(tempFilePath))}`);
          const images = await rasterizePdf(tempFilePath, ocrOutDir);

          const ocrText = await ocrImages(images, (pageIndex, totalPages) => {
            sseWrite(res, "progress", {
              step: "ocr" as ProgressStep,
              message: `OCR: page ${pageIndex} of ${totalPages}`,
            });
          });
          blocks = blocksFromPlainText(ocrText);

          await cleanupImages(images);
          await safeDelete(ocrOutDir, true);
          ocrOutDir = undefined;
        }
      } else if (kind === "docx") {
        sseWrite(res, "progress", { step: "extracting" as ProgressStep, message: "Reading document structure" });
        blocks = await extractDocxBlocks(tempFilePath);
      } else if (kind === "doc") {
        sseWrite(res, "progress", { step: "extracting" as ProgressStep, message: "Converting legacy .doc file" });
        legacyConvertDir = path.join(path.dirname(tempFilePath), `doc_${path.basename(tempFilePath, path.extname(tempFilePath))}`);
        const convertedPath = await convertLegacyDocToDocx(tempFilePath, legacyConvertDir);
        blocks = await extractDocxBlocks(convertedPath);
        await safeDelete(legacyConvertDir, true);
        legacyConvertDir = undefined;
      } else {
        return fail("Only .pdf, .docx and .doc files are supported.", "UNSUPPORTED_FILE_TYPE");
      }

      const unicodeText = flattenBlocksToText(blocks);

      if (!unicodeText || unicodeText.replace(/\s/g, "").length === 0) {
        return fail(
          usedOcr
            ? "OCR could not detect any readable text in this document."
            : "No text could be extracted from this document.",
          "EMPTY_DOCUMENT"
        );
      }

      if (!isUnicodeBengali(unicodeText)) {
        return fail(
          "No Bengali text was detected in this document. Please upload a Bengali-language document.",
          "NO_BENGALI_DETECTED"
        );
      }

      // --- Convert to Bijoy ---
      sseWrite(res, "progress", {
        step: "converting" as ProgressStep,
        message: "Converting Unicode Bengali to Bijoy (SutonnyMJ) encoding",
      });
      const conversion = convertBlocks(blocks);

      sseWrite(res, "progress", { step: "creating_document" as ProgressStep, message: "Preparing preview" });

      sseWrite(res, "progress", { step: "ready" as ProgressStep, message: "Done" });
      sseWrite(res, "done", {
        unicodeText,
        bijoyText: flattenBlocksToText(conversion.blocks),
        blocks: conversion.blocks,
        fullyConverted: conversion.fullyConverted,
        unconvertedChars: conversion.unconvertedChars,
        usedOcr,
        numPages,
        bengaliDensity: bengaliDensity(unicodeText),
      });
      res.end();
    } catch (err) {
      if (err instanceof PdfError || err instanceof OcrError || err instanceof DocxError || err instanceof LegacyDocError) {
        return fail(err.message, err.code);
      }
      console.error("Unexpected conversion error:", err);
      return fail("An unexpected error occurred while processing the document.", "INTERNAL_ERROR");
    } finally {
      if (tempFilePath) await safeDelete(tempFilePath);
      if (ocrOutDir) await safeDelete(ocrOutDir, true);
      if (legacyConvertDir) await safeDelete(legacyConvertDir, true);
    }
  });
});
