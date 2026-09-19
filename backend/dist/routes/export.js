"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportRouter = void 0;
const express_1 = require("express");
const docxBuilder_1 = require("../services/docxBuilder");
const pdfLayoutBlocks_1 = require("../services/pdfLayoutBlocks");
const docModel_1 = require("../model/docModel");
exports.exportRouter = (0, express_1.Router)();
const MAX_TEXT_LENGTH = 2000000; // guard against abuse; ~2M chars is already a huge document
/**
 * POST /api/export/docx
 * body: { blocks?: DocBlock[], bijoyText?: string, title?: string }
 *
 * `blocks` (the structured, already-Bijoy-converted document produced by
 * /api/convert) is preferred - it reproduces alignment, indentation,
 * headings, lists and tables. `bijoyText` (plain text) is accepted as a
 * fallback for older clients or hand-edited text, and is wrapped into
 * simple left-aligned paragraphs.
 */
exports.exportRouter.post("/export/docx", async (req, res) => {
    try {
        const { blocks, bijoyText, title } = req.body || {};
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