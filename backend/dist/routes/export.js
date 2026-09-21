"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportRouter = void 0;
const express_1 = require("express");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const docxBuilder_1 = require("../services/docxBuilder");
const pdfLayoutBlocks_1 = require("../services/pdfLayoutBlocks");
const docModel_1 = require("../model/docModel");
const upload_1 = require("../middleware/upload");
exports.exportRouter = (0, express_1.Router)();
const MAX_TEXT_LENGTH = 2000000; // guard against abuse; ~2M chars is already a huge document
/**
 * POST /api/export/docx
 * body: { blocks?: DocBlock[], bijoyText?: string, title?: string }
 *
 * If `blocks` contains a high-fidelity document token ({ __kind: "hifi_doc", id }),
 * the exact in-place transformed OpenXML DOCX is streamed with 100% formatting preserved.
 * Otherwise, `blocks` is built via docxBuilder, or `bijoyText` is wrapped into paragraphs.
 */
exports.exportRouter.post("/export/docx", async (req, res) => {
    try {
        const { blocks, bijoyText, title } = req.body || {};
        // 1. High-fidelity converted document
        if (Array.isArray(blocks) && blocks.length > 0 && blocks[0]?.__kind === "hifi_doc") {
            const docId = blocks[0].id;
            if (typeof docId === "string" && /^[\w-]+$/.test(docId)) {
                const hifiPath = path_1.default.join(upload_1.TMP_DIR, `hifi_${docId}.docx`);
                if (fs_1.default.existsSync(hifiPath)) {
                    const buffer = await fs_1.default.promises.readFile(hifiPath);
                    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
                    const safeTitle = typeof title === "string" && title.trim().length > 0
                        ? title.trim().replace(/[\\/:*?"<>|]/g, "_").slice(0, 100)
                        : "bijoy-converted";
                    res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.docx"`);
                    res.send(buffer);
                    return;
                }
            }
        }
        let docBlocks;
        if (Array.isArray(blocks) && blocks.length > 0) {
            if (!isValidBlockArray(blocks)) {
                return res.status(400).json({ message: "Malformed document structure.", code: "INVALID_BLOCKS" });
            }
            docBlocks = blocks;
        }
        else if (typeof bijoyText === "string" && bijoyText.trim().length > 0) {
            docBlocks = (0, pdfLayoutBlocks_1.blocksFromPlainText)(bijoyText);
        }
        if (!docBlocks || docBlocks.length === 0) {
            return res.status(400).json({ message: "blocks or bijoyText is required.", code: "MISSING_TEXT" });
        }
        const totalLength = (0, docModel_1.flattenBlocksToText)(docBlocks).length;
        if (totalLength > MAX_TEXT_LENGTH) {
            return res.status(400).json({ message: "Document is too long to export.", code: "TOO_LARGE" });
        }
        const buffer = await (0, docxBuilder_1.buildBijoyDocx)({
            blocks: docBlocks,
            title: typeof title === "string" ? title.slice(0, 200) : undefined,
        });
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        res.setHeader("Content-Disposition", 'attachment; filename="bijoy-converted.docx"');
        res.send(buffer);
    }
    catch (err) {
        console.error("DOCX export error:", err);
        res.status(500).json({ message: "Failed to generate the DOCX file.", code: "DOCX_EXPORT_FAILED" });
    }
});
function isValidBlockArray(value) {
    return value.every((block) => {
        if (!block || typeof block !== "object")
            return false;
        const b = block;
        if (b.kind === "paragraph")
            return Array.isArray(b.runs);
        if (b.kind === "table")
            return Array.isArray(b.rows);
        return false;
    });
}
//# sourceMappingURL=export.js.map