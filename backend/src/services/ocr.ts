import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export class OcrError extends Error {
  constructor(
    message: string,
    public code: "POPPLER_MISSING" | "RASTERIZE_FAILED" | "TESSERACT_MISSING" | "OCR_FAILED"
  ) {
    super(message);
    this.name = "OcrError";
  }
}

/**
 * Rasterizes every page of a PDF into PNG images using poppler-utils'
 * `pdftoppm` binary. Requires poppler-utils to be installed on the host
 * (see README setup instructions: `apt-get install poppler-utils`).
 */
export async function rasterizePdf(pdfPath: string, outDir: string): Promise<string[]> {
  await fs.promises.mkdir(outDir, { recursive: true });
  const outPrefix = path.join(outDir, "page");

  try {
    // -r 300: 300 DPI gives Tesseract enough resolution for small Bengali
    // conjuncts without producing unreasonably large images.
    await execFileAsync("pdftoppm", ["-r", "300", "-png", pdfPath, outPrefix]);
  } catch (err: any) {
    if (err.code === "ENOENT") {
      throw new OcrError(
        "OCR requires poppler-utils (pdftoppm) to be installed on the server. " +
          "Install it with `apt-get install poppler-utils` (Linux) or `brew install poppler` (macOS).",
        "POPPLER_MISSING"
      );
    }
    throw new OcrError(`Failed to rasterize PDF pages for OCR: ${err.message}`, "RASTERIZE_FAILED");
  }

  const files = (await fs.promises.readdir(outDir))
    .filter((f) => f.startsWith("page") && f.endsWith(".png"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((f) => path.join(outDir, f));

  if (files.length === 0) {
    throw new OcrError("PDF rasterization produced no page images.", "RASTERIZE_FAILED");
  }

  return files;
}

/**
 * Runs Bengali (+ English, for mixed-language documents/numerals) OCR over
 * a set of page images using the system `tesseract` CLI, and concatenates
 * the results with paragraph breaks between pages.
 *
 * We shell out to the real Tesseract binary rather than using a
 * browser/WASM OCR wrapper: those typically fetch their language training
 * data from a public CDN on first use, which is an unnecessary runtime
 * dependency (and an outright failure point in network-restricted
 * environments). Since poppler-utils is already a required system
 * dependency for rasterization, requiring `tesseract-ocr` +
 * `tesseract-ocr-ben` alongside it is a small, predictable addition -
 * see README for the exact install command.
 */
export async function ocrImages(
  imagePaths: string[],
  onProgress?: (pageIndex: number, totalPages: number) => void
): Promise<string> {
  const pageTexts: string[] = [];
  for (let i = 0; i < imagePaths.length; i++) {
    const text = await ocrSingleImage(imagePaths[i]);
    pageTexts.push(text.trim());
    onProgress?.(i + 1, imagePaths.length);
  }
  return pageTexts.join("\n\n");
}

async function ocrSingleImage(imagePath: string): Promise<string> {
  try {
    // "stdout" as the output base tells tesseract to write results to
    // stdout instead of a file.
    const { stdout } = await execFileAsync(
      "tesseract",
      [imagePath, "stdout", "-l", "ben+eng", "--psm", "3"],
      { maxBuffer: 1024 * 1024 * 20, encoding: "utf8" }
    );
    return stdout;
  } catch (err: any) {
    if (err.code === "ENOENT") {
      throw new OcrError(
        "OCR requires the `tesseract` binary and Bengali language data to be installed on the server. " +
          "Install with `apt-get install tesseract-ocr tesseract-ocr-ben` (Linux) or " +
          "`brew install tesseract tesseract-lang` (macOS).",
        "TESSERACT_MISSING"
      );
    }
    const stderr = String(err?.stderr || err?.message || "");
    if (/failed loading language|error opening data file/i.test(stderr)) {
      throw new OcrError(
        "The Bengali OCR language pack (`tesseract-ocr-ben`) is not installed on the server.",
        "TESSERACT_MISSING"
      );
    }
    throw new OcrError(`OCR failed: ${stderr || err.message}`, "OCR_FAILED");
  }
}

export async function cleanupImages(imagePaths: string[]): Promise<void> {
  await Promise.all(imagePaths.map((p) => fs.promises.unlink(p).catch(() => undefined)));
}
