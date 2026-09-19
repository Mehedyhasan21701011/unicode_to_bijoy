"use strict";
/**
 * A format-agnostic structural representation of a document: paragraphs
 * (with alignment, indentation, heading/list metadata) and tables.
 *
 * Every input path (PDF layout-reconstruction, DOCX XML parsing, OCR) is
 * responsible for producing an array of these blocks. The Bijoy converter
 * then rewrites the text of every run in place, and the DOCX builder turns
 * the (converted) blocks back into a real .docx that mirrors the original
 * structure - instead of the old approach of collapsing everything into
 * plain text and losing indentation, alignment, headings, lists and tables.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.INDENT_STEP_TWIPS = void 0;
exports.isTableBlock = isTableBlock;
exports.isParagraphBlock = isParagraphBlock;
exports.mergeAdjacentRuns = mergeAdjacentRuns;
exports.flattenBlocksToText = flattenBlocksToText;
exports.iterateRuns = iterateRuns;
/** One indent "step" is this many twips (1/20 pt) - roughly 0.25in. */
exports.INDENT_STEP_TWIPS = 360;
function isTableBlock(block) {
    return block.kind === "table";
}
function isParagraphBlock(block) {
    return block.kind === "paragraph";
}
/** Merges consecutive runs that share the same formatting into one, so a
 * source document that happens to split identical-styled text into many
 * tiny runs (common in LibreOffice-exported .docx) doesn't carry that
 * fragmentation through to the converted output. */
function mergeAdjacentRuns(runs) {
    const merged = [];
    for (const run of runs) {
        const last = merged[merged.length - 1];
        if (last && last.bold === run.bold && last.italic === run.italic && last.underline === run.underline) {
            last.text += run.text;
        }
        else {
            merged.push({ ...run });
        }
    }
    return merged;
}
/** Flattens blocks into plain text (paragraphs separated by blank lines, table cells joined with tabs/newlines) for preview/copy/plain-text export. */
function flattenBlocksToText(blocks) {
    const parts = [];
    for (const block of blocks) {
        if (isParagraphBlock(block)) {
            const text = block.runs.map((r) => r.text).join("");
            parts.push(text);
        }
        else {
            const rows = block.rows.map((row) => row
                .map((cell) => cell.paragraphs.map((p) => p.map((r) => r.text).join("")).join(" "))
                .join("\t"));
            parts.push(rows.join("\n"));
        }
    }
    return parts.join("\n\n");
}
/** Returns every run across every block/cell, for conversion or auditing. */
function* iterateRuns(blocks) {
    for (const block of blocks) {
        if (isParagraphBlock(block)) {
            for (const run of block.runs)
                yield run;
        }
        else {
            for (const row of block.rows) {
                for (const cell of row) {
                    for (const paragraph of cell.paragraphs) {
                        for (const run of paragraph)
                            yield run;
                    }
                }
            }
        }
    }
}
//# sourceMappingURL=docModel.js.map