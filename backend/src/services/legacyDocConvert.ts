import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export class LegacyDocError extends Error {
  constructor(
    message: string,
    public code: "LIBREOFFICE_MISSING" | "CONVERSION_FAILED"
  ) {
    super(message);
    this.name = "LegacyDocError";
  }
}

/**
 * Converts a legacy .doc (or .rtf/.odt) file to .docx using headless
 * LibreOffice, so it can be read by the same structural DOCX extractor
 * used for native .docx uploads. This is the standard, reliable way to
 * read old binary Word formats - there is no maintained pure-JS parser for
 * the legacy OLE-based .doc format that handles Bengali text reliably.
 *
 * Requires the `soffice` (LibreOffice) binary - see README.
 */
export async function convertLegacyDocToDocx(inputPath: string, outDir: string): Promise<string> {
  await fs.promises.mkdir(outDir, { recursive: true });

  try {
    await execFileAsync(
      "soffice",
      ["--headless", "--norestore", "--convert-to", "docx:MS Word 2007 XML", "--outdir", outDir, inputPath],
      { timeout: 60_000, maxBuffer: 1024 * 1024 * 20 }
    );
  } catch (err: any) {
    if (err.code === "ENOENT") {
      throw new LegacyDocError(
        "Converting .doc files requires LibreOffice (`soffice`) to be installed on the server. " +
          "Install it with `apt-get install libreoffice` (Linux) or `brew install --cask libreoffice` (macOS).",
        "LIBREOFFICE_MISSING"
      );
    }
    throw new LegacyDocError(`Could not convert this .doc file: ${err.message}`, "CONVERSION_FAILED");
  }

  const baseName = path.basename(inputPath, path.extname(inputPath));
  const outputPath = path.join(outDir, `${baseName}.docx`);

  const exists = await fs.promises
    .access(outputPath, fs.constants.F_OK)
    .then(() => true)
    .catch(() => false);
  if (!exists) {
    throw new LegacyDocError(
      "LibreOffice did not produce a .docx file - the .doc file may be corrupted or password-protected.",
      "CONVERSION_FAILED"
    );
  }

  return outputPath;
}
