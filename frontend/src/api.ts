import type { ConversionResult, ProgressEvent, ApiError } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

export class ApiRequestError extends Error {
  code: string;
  constructor(err: ApiError) {
    super(err.message);
    this.code = err.code;
  }
}

/**
 * Uploads a document (PDF, DOCX or DOC) and streams Server-Sent Events
 * describing conversion progress. Resolves with the final ConversionResult,
 * or rejects with an ApiRequestError carrying a user-friendly message +
 * machine-readable code.
 */
export async function convertDocument(
  file: File,
  onProgress: (event: ProgressEvent) => void
): Promise<ConversionResult> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_BASE}/api/convert`, {
    method: "POST",
    body: formData,
  });

  if (!response.body) {
    throw new ApiRequestError({ message: "No response from server.", code: "NO_RESPONSE" });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE messages are separated by a blank line.
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      const lines = rawEvent.split("\n");
      let eventName = "message";
      let data = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) eventName = line.slice(7).trim();
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      if (!data) continue;

      const parsed = JSON.parse(data);
      if (eventName === "progress") {
        onProgress(parsed as ProgressEvent);
      } else if (eventName === "done") {
        return parsed as ConversionResult;
      } else if (eventName === "error") {
        throw new ApiRequestError(parsed as ApiError);
      }
    }
  }

  throw new ApiRequestError({
    message: "Connection to the server was interrupted before conversion finished.",
    code: "STREAM_INTERRUPTED",
  });
}

/**
 * Requests a .docx file (SutonnyMJ-fonted Bijoy text) from the backend and
 * triggers a browser download. Passing `blocks` (the structured document
 * returned by /api/convert) preserves alignment, indentation, headings,
 * lists and tables; falling back to `bijoyText` alone would flatten the
 * document to plain paragraphs.
 */
export async function downloadDocx(
  bijoyText: string,
  title: string,
  blocks?: unknown[]
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/export/docx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks, bijoyText, title }),
  });

  if (!response.ok) {
    let message = "Failed to generate the DOCX file.";
    try {
      const body = await response.json();
      if (body?.message) message = body.message;
    } catch {
      // ignore parse failure, use default message
    }
    throw new ApiRequestError({ message, code: "DOCX_EXPORT_FAILED" });
  }

  const blob = await response.blob();
  triggerDownload(blob, "bijoy-converted.docx");
}

/**
 * Downloads the Bijoy text as a plain .txt file. Done entirely client-side
 * since no server processing is needed for a raw text export.
 */
export function downloadTxt(bijoyText: string): void {
  const blob = new Blob([bijoyText], { type: "text/plain;charset=utf-8" });
  triggerDownload(blob, "bijoy-converted.txt");
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
