import { Router, Request, Response } from "express";
import path from "path";
import fs from "fs";
import { buildBijoyDocx } from "../services/docxBuilder";
import { blocksFromPlainText } from "../services/pdfLayoutBlocks";
import { flattenBlocksToText, type DocBlock } from "../model/docModel";
import { TMP_DIR } from "../middleware/upload";

export const exportRouter = Router();

const MAX_TEXT_LENGTH = 2_000_000; // guard against abuse; ~2M chars is already a huge document

/**
 * POST /api/export/docx
 * body: { blocks?: DocBlock[], bijoyText?: string, title?: string }
 *
 * If `blocks` contains a high-fidelity document token ({ __kind: "hifi_doc", id }),
 * the exact in-place transformed OpenXML DOCX is streamed with 100% formatting preserved.
 * Otherwise, `blocks` is built via docxBuilder, or `bijoyText` is wrapped into paragraphs.
 */
exportRouter.post("/export/docx", async (req: Request, res: Response) => {
  try {
    const { blocks, bijoyText, title } = req.body || {};

    // 1. High-fidelity converted document
    if (Array.isArray(blocks) && blocks.length > 0 && (blocks[0] as any)?.__kind === "hifi_doc") {
      const docId = (blocks[0] as any).id;
      if (typeof docId === "string" && /^[\w-]+$/.test(docId)) {
        const hifiPath = path.join(TMP_DIR, `hifi_${docId}.docx`);
        if (fs.existsSync(hifiPath)) {
          const buffer = await fs.promises.readFile(hifiPath);
          res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          );
          const safeTitle =
            typeof title === "string" && title.trim().length > 0
              ? title.trim().replace(/[\\/:*?"<>|]/g, "_").slice(0, 100)
              : "bijoy-converted";
          res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.docx"`);
          res.send(buffer);
          return;
        }
      }
    }

    let docBlocks: DocBlock[] | undefined;

    if (Array.isArray(blocks) && blocks.length > 0) {
      if (!isValidBlockArray(blocks)) {
        return res.status(400).json({ message: "Malformed document structure.", code: "INVALID_BLOCKS" });
      }
      docBlocks = blocks as DocBlock[];
    } else if (typeof bijoyText === "string" && bijoyText.trim().length > 0) {
      docBlocks = blocksFromPlainText(bijoyText);
    }

    if (!docBlocks || docBlocks.length === 0) {
      return res.status(400).json({ message: "blocks or bijoyText is required.", code: "MISSING_TEXT" });
    }

    const totalLength = flattenBlocksToText(docBlocks).length;
    if (totalLength > MAX_TEXT_LENGTH) {
      return res.status(400).json({ message: "Document is too long to export.", code: "TOO_LARGE" });
    }

    const buffer = await buildBijoyDocx({
      blocks: docBlocks,
      title: typeof title === "string" ? title.slice(0, 200) : undefined,
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader("Content-Disposition", 'attachment; filename="bijoy-converted.docx"');
    res.send(buffer);
  } catch (err) {
    console.error("DOCX export error:", err);
    res.status(500).json({ message: "Failed to generate the DOCX file.", code: "DOCX_EXPORT_FAILED" });
  }
});

function isValidBlockArray(value: unknown[]): boolean {
  return value.every((block) => {
    if (!block || typeof block !== "object") return false;
    const b = block as Record<string, unknown>;
    if (b.kind === "paragraph") return Array.isArray(b.runs);
    if (b.kind === "table") return Array.isArray(b.rows);
    return false;
  });
}
