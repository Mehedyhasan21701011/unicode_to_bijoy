"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildBijoyDocx = buildBijoyDocx;
const docx_1 = require("docx");
const docModel_1 = require("../model/docModel");
const BIJOY_FONT = "SutonnyMJ";
const BODY_SIZE = 26; // 13pt - a comfortable reading size for Bijoy glyphs
const HEADING_SIZES = { 1: 36, 2: 32, 3: 28 }; // 18/16/14pt
const HEADING_LEVELS = {
    1: docx_1.HeadingLevel.HEADING_1,
    2: docx_1.HeadingLevel.HEADING_2,
    3: docx_1.HeadingLevel.HEADING_3,
};
const ALIGNMENT_MAP = {
    left: docx_1.AlignmentType.LEFT,
    center: docx_1.AlignmentType.CENTER,
    right: docx_1.AlignmentType.RIGHT,
    justify: docx_1.AlignmentType.JUSTIFIED,
};
/**
 * Builds a .docx file that mirrors the structure of the extracted document:
 * paragraph alignment, indentation (including first-line/hanging indent),
 * heading levels, bullet lists and tables are all reproduced, with every
 * run of text explicitly set to the SutonnyMJ font. Word will render the
 * Bijoy ANSI byte sequence correctly as Bengali glyphs as long as
 * SutonnyMJ is installed on the machine opening the document (this is
 * standard behavior for legacy Bijoy documents - the font is not embedded,
 * since SutonnyMJ is commercially distributed and not freely
 * redistributable).
 */
async function buildBijoyDocx(options) {
    const children = [];
    if (options.title) {
        children.push(new docx_1.Paragraph({
            heading: docx_1.HeadingLevel.HEADING_1,
            children: [new docx_1.TextRun({ text: options.title, font: BIJOY_FONT, size: HEADING_SIZES[1] })],
        }));
    }
    for (const block of options.blocks) {
        children.push((0, docModel_1.isParagraphBlock)(block) ? buildParagraph(block) : buildTable(block.rows));
    }
    const doc = new docx_1.Document({
        styles: buildStyles(),
        numbering: {
            config: [
                {
                    reference: "bijoy-bullet-list",
                    levels: [0, 1, 2, 3, 4].map((level) => ({
                        level,
                        format: "bullet",
                        text: "\u2022",
                        alignment: docx_1.AlignmentType.LEFT,
                        style: {
                            paragraph: {
                                indent: { left: (0, docx_1.convertInchesToTwip)(0.25 * (level + 1)), hanging: (0, docx_1.convertInchesToTwip)(0.25) },
                            },
                        },
                    })),
                },
            ],
        },
        sections: [
            {
                properties: {},
                children,
            },
        ],
    });
    return docx_1.Packer.toBuffer(doc);
}
function buildStyles() {
    return {
        default: {
            document: {
                run: { font: BIJOY_FONT },
            },
        },
    };
}
function buildParagraph(block) {
    if (block.isBlank) {
        return new docx_1.Paragraph({ children: [new docx_1.TextRun({ text: "", font: BIJOY_FONT })] });
    }
    const runs = block.runs.map((run) => buildRun(run, block.heading));
    const indentLeft = block.indentLevel > 0 ? block.indentLevel * docModel_1.INDENT_STEP_TWIPS : undefined;
    const firstLine = block.firstLineIndentLevel && block.firstLineIndentLevel !== 0
        ? block.firstLineIndentLevel * docModel_1.INDENT_STEP_TWIPS
        : undefined;
    return new docx_1.Paragraph({
        children: runs,
        heading: block.heading ? HEADING_LEVELS[block.heading] : undefined,
        alignment: block.alignment ? ALIGNMENT_MAP[block.alignment] : undefined,
        indent: indentLeft || firstLine
            ? {
                left: indentLeft,
                firstLine: firstLine && firstLine > 0 ? firstLine : undefined,
                hanging: firstLine && firstLine < 0 ? -firstLine : undefined,
            }
            : undefined,
        numbering: block.listItem
            ? { reference: "bijoy-bullet-list", level: Math.max(0, block.listItem.level - 1) }
            : undefined,
        spacing: { after: 160 },
    });
}
function buildRun(run, heading) {
    return new docx_1.TextRun({
        text: run.text,
        font: BIJOY_FONT,
        size: heading ? HEADING_SIZES[heading] : BODY_SIZE,
        bold: run.bold || undefined,
        italics: run.italic || undefined,
        underline: run.underline ? {} : undefined,
    });
}
function buildTable(rows) {
    return new docx_1.Table({
        width: { size: 100, type: docx_1.WidthType.PERCENTAGE },
        rows: rows.map((row) => new docx_1.TableRow({
            children: row.map((cell) => new docx_1.TableCell({
                children: cell.paragraphs.map((runs) => new docx_1.Paragraph({
                    children: runs.map((r) => buildRun(r)),
                })),
            })),
        })),
    });
}
//# sourceMappingURL=docxBuilder.js.map