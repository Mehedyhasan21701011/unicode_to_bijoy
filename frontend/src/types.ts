export type ProgressStep =
  | "uploading"
  | "extracting"
  | "ocr"
  | "converting"
  | "creating_document"
  | "ready";

export interface ProgressEvent {
  step: ProgressStep;
  message: string;
}

export interface ConversionResult {
  unicodeText: string;
  bijoyText: string;
  /** Structured, already-Bijoy-converted document (paragraphs/tables with
   * alignment, indentation, headings, lists). Opaque to the frontend -
   * passed straight through to /api/export/docx so the exported file keeps
   * the original layout instead of collapsing to plain paragraphs. */
  blocks: unknown[];
  fullyConverted: boolean;
  unconvertedChars: string[];
  usedOcr: boolean;
  numPages: number;
  bengaliDensity: number;
}

export interface ApiError {
  message: string;
  code: string;
}

export type AppStatus =
  | { kind: "idle" }
  | { kind: "file_selected"; file: File }
  | { kind: "processing"; file: File; step: ProgressStep; stepMessage: string }
  | { kind: "done"; file: File; result: ConversionResult }
  | { kind: "error"; file: File | null; error: ApiError };
