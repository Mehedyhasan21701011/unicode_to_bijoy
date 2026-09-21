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

export type Alignment = "left" | "center" | "right" | "justify";

export interface DocRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontSize?: number;
}

/** One indent "step" is this many twips (1/20 pt) - roughly 0.25in. */
export const INDENT_STEP_TWIPS = 360;

export interface ParagraphBlock {
  kind: "paragraph";
  runs: DocRun[];
  alignment?: Alignment;
  /** Base left indent, in indent steps (0 = flush with the margin). */
  indentLevel: number;
  /** Extra indent applied only to the first line, in indent steps. Can be negative (hanging indent). */
  firstLineIndentLevel?: number;
  /** Set when this paragraph is a heading (derived from PDF centering/short-line heuristics, or a real Word heading style). */
  heading?: 1 | 2 | 3;
  listItem?: { ordered: boolean; level: number };
  /** Source paragraph spacing, in twips. */
  spacing?: { before?: number; after?: number; line?: number; lineRule?: "auto" | "exact" | "atLeast" };
  /** True for a deliberate empty paragraph (blank line) that should be preserved as vertical space. */
  isBlank?: boolean;
}

export interface TableCellBlock {
  /** Each inner array is one paragraph's runs; most cells have exactly one. */
  paragraphs: DocRun[][];
}

export interface TableBlock {
  kind: "table";
  rows: TableCellBlock[][];
}

export type DocBlock = ParagraphBlock | TableBlock;

export function isTableBlock(block: DocBlock): block is TableBlock {
  return block.kind === "table";
}

export function isParagraphBlock(block: DocBlock): block is ParagraphBlock {
  return block.kind === "paragraph";
}

/** Merges consecutive runs that share the same formatting into one, so a
 * source document that happens to split identical-styled text into many
 * tiny runs (common in LibreOffice-exported .docx) doesn't carry that
 * fragmentation through to the converted output. */
export function mergeAdjacentRuns(runs: DocRun[]): DocRun[] {
  const merged: DocRun[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && last.bold === run.bold && last.italic === run.italic && last.underline === run.underline) {
      last.text += run.text;
    } else {
      merged.push({ ...run });
    }
  }
  return merged;
}

/** Flattens blocks into plain text (paragraphs separated by blank lines, table cells joined with tabs/newlines) for preview/copy/plain-text export. */
export function flattenBlocksToText(blocks: DocBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (isParagraphBlock(block)) {
      const text = block.runs.map((r) => r.text).join("");
      parts.push(text);
    } else {
      const rows = block.rows.map((row) =>
        row
          .map((cell) => cell.paragraphs.map((p) => p.map((r) => r.text).join("")).join(" "))
          .join("\t")
      );
      parts.push(rows.join("\n"));
    }
  }
  return parts.join("\n\n");
}

/** Returns every run across every block/cell, for conversion or auditing. */
export function* iterateRuns(blocks: DocBlock[]): Generator<DocRun> {
  for (const block of blocks) {
    if (isParagraphBlock(block)) {
      for (const run of block.runs) yield run;
    } else {
      for (const row of block.rows) {
        for (const cell of row) {
          for (const paragraph of cell.paragraphs) {
            for (const run of paragraph) yield run;
          }
        }
      }
    }
  }
}
