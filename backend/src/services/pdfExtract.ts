import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import type { ParagraphBlock } from "../model/docModel";
import { reconstructParagraphBlocks } from "./pdfLayoutBlocks";

const execFileAsync = promisify(execFile);

export class PdfError extends Error {
  constructor(
    message: string,
    public code:
      | "INVALID_PDF"
      | "PASSWORD_PROTECTED"
      | "EMPTY_PDF"
      | "TOO_LARGE"
      | "UNSUPPORTED_STRUCTURE"
      | "POPPLER_MISSING"
  ) {
    super(message);
    this.name = "PdfError";
  }
}

export interface ExtractedPdf {
  /** Cleaned text, paragraphs separated by blank lines. */
  text: string;
  numPages: number;
  /** True when no meaningful text was found -> likely a scanned/image PDF. */
  isLikelyScanned: boolean;
  /**
   * True when text WAS extracted but looks unreliable (e.g. a font's
   * ToUnicode CMap didn't round-trip complex Bengali conjunct glyphs
   * cleanly, leaving stray control characters mixed into real words).
   * Callers should treat this the same as a scanned PDF and re-derive the
   * text via OCR instead of trusting it.
   */
  isLikelyGarbled: boolean;
}

export interface ExtractedPdfBlocks {
  blocks: ParagraphBlock[];
  numPages: number;
  isLikelyScanned: boolean;
  isLikelyGarbled: boolean;
}

/**
 * Runs `pdftotext -layout` once and returns both the raw layout-preserving
 * text (leading/trailing spaces intact - needed to reconstruct indentation,
 * centering and wrapped lines) and a "tidied" flat version (used for the
 * scanned/garbled heuristics, which only care about character content).
 */
async function runPdfToText(filePath: string): Promise<string> {
  try {
    const result = await execFileAsync(
      "pdftotext",
      ["-enc", "UTF-8", "-eol", "unix", "-layout", filePath, "-"],
      { maxBuffer: 1024 * 1024 * 50, encoding: "utf8" }
    );
    return result.stdout;
  } catch (err: any) {
    const stderr = String(err?.stderr || err?.message || "");
    if (/incorrect password/i.test(stderr)) {
      throw new PdfError(
        "This PDF is password-protected. Please remove the password and try again.",
        "PASSWORD_PROTECTED"
      );
    }
    if (err.code === "ENOENT") {
      throw new PdfError(
        "PDF processing requires poppler-utils (pdftotext) to be installed on the server. " +
          "Install it with `apt-get install poppler-utils` (Linux) or `brew install poppler` (macOS).",
        "POPPLER_MISSING"
      );
    }
    if (/trailer|xref|damaged|corrupt/i.test(stderr)) {
      throw new PdfError(
        "This PDF has an unsupported or corrupted internal structure.",
        "UNSUPPORTED_STRUCTURE"
      );
    }
    throw new PdfError(`Failed to extract text from PDF: ${stderr || err.message}`, "INVALID_PDF");
  }
}

/**
 * Extracts text from a PDF using poppler's `pdftotext`, which handles
 * complex-script (Bengali) glyph reordering and ToUnicode CMaps far more
 * reliably than pure-JS extractors in practice. Poppler is already a
 * required system dependency for the OCR fallback (see services/ocr.ts),
 * so this adds no new install requirement.
 *
 * Requires poppler-utils (`pdftotext`, `pdfinfo`) - see README.
 */
export async function extractPdfText(filePath: string): Promise<ExtractedPdf> {
  await assertLooksLikePdf(filePath);

  const numPages = await getPageCount(filePath);
  if (numPages === 0) {
    throw new PdfError("The PDF has no pages.", "EMPTY_PDF");
  }

  const stdout = await runPdfToText(filePath);
  const cleaned = tidyExtractedText(stdout);
  const meaningfulChars = cleaned.replace(/\s/g, "").length;
  const isLikelyScanned = meaningfulChars < 5;
  const isLikelyGarbled = !isLikelyScanned && looksGarbled(cleaned);

  return { text: cleaned, numPages, isLikelyScanned, isLikelyGarbled };
}

/**
 * Extracts a PDF's content as structured, layout-aware blocks (see
 * pdfLayoutBlocks.ts) rather than flat text. This is what fixes the
 * "gap"/broken-layout problem: wrapped lines are rejoined into real
 * paragraphs instead of being carried through as forced line breaks, and
 * indentation/centering/lists are reconstructed from the page layout
 * instead of being discarded entirely.
 */
export async function extractPdfBlocks(filePath: string): Promise<ExtractedPdfBlocks> {
  await assertLooksLikePdf(filePath);

  const numPages = await getPageCount(filePath);
  if (numPages === 0) {
    throw new PdfError("The PDF has no pages.", "EMPTY_PDF");
  }

  const stdout = await runPdfToText(filePath);
  const cleaned = tidyExtractedText(stdout);
  const meaningfulChars = cleaned.replace(/\s/g, "").length;
  const isLikelyScanned = meaningfulChars < 5;
  const isLikelyGarbled = !isLikelyScanned && looksGarbled(cleaned);

  const blocks = isLikelyScanned || isLikelyGarbled ? [] : reconstructParagraphBlocks(stdout);

  return { blocks, numPages, isLikelyScanned, isLikelyGarbled };
}

async function assertLooksLikePdf(filePath: string): Promise<void> {
  let fd: fs.promises.FileHandle | undefined;
  try {
    fd = await fs.promises.open(filePath, "r");
    const stat = await fd.stat();
    if (stat.size === 0) {
      throw new PdfError("The uploaded file is empty.", "EMPTY_PDF");
    }
    const buf = Buffer.alloc(5);
    await fd.read(buf, 0, 5, 0);
    if (buf.toString("latin1") !== "%PDF-") {
      throw new PdfError("The uploaded file is not a valid PDF.", "INVALID_PDF");
    }
  } catch (err) {
    if (err instanceof PdfError) throw err;
    throw new PdfError("Could not read the uploaded file.", "INVALID_PDF");
  } finally {
    await fd?.close();
  }
}

async function getPageCount(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync("pdfinfo", [filePath], { encoding: "utf8" });
    const match = stdout.match(/^Pages:\s+(\d+)/m);
    return match ? parseInt(match[1], 10) : 0;
  } catch (err: any) {
    if (err.code === "ENOENT") {
      throw new PdfError(
        "PDF processing requires poppler-utils (pdfinfo) to be installed on the server.",
        "POPPLER_MISSING"
      );
    }
    // pdfinfo failing usually means the same structural problem pdftotext
    // will also hit; let the pdftotext call below surface the precise reason.
    return 0;
  }
}

/**
 * Heuristic: real extracted text should be almost entirely printable
 * characters (letters, digits, punctuation, whitespace). A meaningful
 * concentration of C0 control characters mixed into otherwise-Bengali text
 * is the signature of a broken ToUnicode mapping for shaped ligature
 * glyphs, not real content.
 */
function looksGarbled(text: string): boolean {
  const chars = Array.from(text);
  if (chars.length === 0) return false;
  let controlCount = 0;
  for (const ch of chars) {
    const code = ch.codePointAt(0) ?? 0;
    const isBenignWhitespace = code === 9 || code === 10 || code === 13;
    if (code < 32 && !isBenignWhitespace) controlCount++;
  }
  const ratio = controlCount / chars.length;
  return ratio > 0.02; // >2% stray control chars is not normal document text
}

/**
 * Cleans up pdftotext's raw output:
 *  - Collapses form-feed page breaks into paragraph breaks.
 *  - Trims trailing whitespace per line.
 *  - Collapses runs of 3+ blank lines to a single paragraph break.
 */
function tidyExtractedText(raw: string): string {
  return raw
    .replace(/\f/g, "\n\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
