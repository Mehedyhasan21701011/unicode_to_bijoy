import {
  AlignmentType,
  convertInchesToTwip,
  Document,
  HeadingLevel,
  IStylesOptions,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import {
  DocBlock,
  DocRun,
  INDENT_STEP_TWIPS,
  ParagraphBlock,
  TableCellBlock,
  isParagraphBlock,
} from "../model/docModel";

const BIJOY_FONT = "SutonnyMJ";
const BODY_SIZE = 26; // 13pt - a comfortable reading size for Bijoy glyphs
const HEADING_SIZES: Record<1 | 2 | 3, number> = { 1: 36, 2: 32, 3: 28 }; // 18/16/14pt
const HEADING_LEVELS: Record<1 | 2 | 3, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
};

const ALIGNMENT_MAP: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

export interface DocxOptions {
  title?: string;
  blocks: DocBlock[];
}

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
export async function buildBijoyDocx(options: DocxOptions): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];

  if (options.title) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: options.title, font: BIJOY_FONT, size: HEADING_SIZES[1] })],
      })
    );
  }

  for (const block of options.blocks) {
    children.push(isParagraphBlock(block) ? buildParagraph(block) : buildTable(block.rows));
  }

  const doc = new Document({
    styles: buildStyles(),
    numbering: {
      config: [
        {
          reference: "bijoy-bullet-list",
          levels: [0, 1, 2, 3, 4].map((level) => ({
            level,
            format: "bullet" as const,
            text: "\u2022",
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: { left: convertInchesToTwip(0.25 * (level + 1)), hanging: convertInchesToTwip(0.25) },
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

  return Packer.toBuffer(doc);
}

function buildStyles(): IStylesOptions {
  return {
    default: {
      document: {
        run: { font: BIJOY_FONT },
      },
    },
  };
}

function buildParagraph(block: ParagraphBlock): Paragraph {
  if (block.isBlank) {
    return new Paragraph({ children: [new TextRun({ text: "", font: BIJOY_FONT })] });
  }

  const runs = block.runs.map((run) => buildRun(run, block.heading));
  const indentLeft = block.indentLevel > 0 ? block.indentLevel * INDENT_STEP_TWIPS : undefined;
  const firstLine =
    block.firstLineIndentLevel && block.firstLineIndentLevel !== 0
      ? block.firstLineIndentLevel * INDENT_STEP_TWIPS
      : undefined;

  return new Paragraph({
    children: runs,
    heading: block.heading ? HEADING_LEVELS[block.heading] : undefined,
    alignment: block.alignment ? ALIGNMENT_MAP[block.alignment] : undefined,
    indent:
      indentLeft || firstLine
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

function buildRun(run: DocRun, heading?: 1 | 2 | 3): TextRun {
  return new TextRun({
    text: run.text,
    font: BIJOY_FONT,
    size: heading ? HEADING_SIZES[heading] : BODY_SIZE,
    bold: run.bold || undefined,
    italics: run.italic || undefined,
    underline: run.underline ? {} : undefined,
  });
}

function buildTable(rows: TableCellBlock[][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(
      (row) =>
        new TableRow({
          children: row.map(
            (cell) =>
              new TableCell({
                children: cell.paragraphs.map(
                  (runs) =>
                    new Paragraph({
                      children: runs.map((r) => buildRun(r)),
                    })
                ),
              })
          ),
        })
    ),
  });
}
