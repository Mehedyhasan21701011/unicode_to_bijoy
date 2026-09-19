import type { ParagraphBlock } from "../model/docModel";

/**
 * Reconstructs paragraph structure (wrapped-line joining, indentation,
 * centered-heading detection, list-item grouping) from the whitespace-based
 * layout that `pdftotext -layout` produces.
 *
 * Why this exists: plain `pdftotext` (no -layout) emits one hard newline
 * per *visual* line of the PDF, not per paragraph. The old pipeline treated
 * every one of those as a real line break, so a single justified paragraph
 * that wrapped across 4 lines in the source PDF came out as 4 forced line
 * breaks in the generated Word document - regardless of the new document's
 * page width or font. That is the "gap"/ragged-layout/broken-structure
 * behavior users were seeing: Word would show a short line, then a large
 * blank run to the margin, then the next forced line.
 *
 * `-layout` mode still emits one line per visual line, but it ALSO
 * preserves each line's leading/trailing whitespace as literal spaces
 * (matching the line's actual on-page indentation and column position).
 * We use that signal to decide, line by line, whether a line continues the
 * previous line's paragraph (it ran almost to the page edge, so it wrapped)
 * or starts something new (a heading, a list item, an indented new
 * paragraph) - rather than relying only on blank lines, which many
 * documents don't insert between a heading and the paragraph that follows.
 */

interface RawLine {
  leading: number;
  trimmed: string;
  /** leading + visual length of the trimmed text; used to detect lines that run to the page edge (i.e. wrapped). */
  endColumn: number;
  /** True when the line started with a Word/LibreOffice bullet glyph (see BULLET_CHAR_REGEX). */
  bullet: boolean;
}

const DEFAULT_SPACES_PER_LEVEL = 6;
/** A line whose content reaches at least this fraction of the page's widest line is considered "full" (wrapped, not a deliberate short line). */
const FULL_LINE_RATIO = 0.72;
/** How close (in columns) a continuation line's indent must be to the body margin to count as "just wrapped" rather than a fresh indent. */
const CONTINUATION_TOLERANCE = 2;

/**
 * Word/LibreOffice render bullet-list markers using the Symbol/Wingdings
 * fonts' Private Use Area codepoints (commonly U+F0B7 for a round bullet),
 * not a real "•" (U+2022). `pdftotext` extracts that PUA codepoint
 * literally. Since SutonnyMJ (or any normal font) has no glyph mapped
 * there, leaving it in the text makes Word render a hollow/notdef box in
 * its place - one concrete, reproducible cause of the "gap"/broken-glyph
 * look users hit on documents with bulleted lists. We detect and strip it
 * here and re-render lists with a real bullet character in docxBuilder.
 */
const BULLET_CHAR_REGEX = /^[\uF000-\uF0FF]/;

type Segment = { lines: RawLine[]; wrapped: boolean };

function toRawLine(rawLine: string): RawLine {
  const bulletMatch = rawLine.match(BULLET_CHAR_REGEX);
  const bullet = Boolean(bulletMatch);
  const line = bullet ? rawLine.slice(bulletMatch![0].length) : rawLine;
  const leadingMatch = line.match(/^[ \t]*/);
  const leading = leadingMatch ? leadingMatch[0].length : 0;
  const trimmed = line.replace(/[ \t]+$/g, "").slice(leading);
  return { leading, trimmed, endColumn: leading + visualLength(trimmed), bullet };
}

/** Approximate visual width: counts base characters, not combining marks, so Bengali matras don't inflate column estimates. */
function visualLength(text: string): number {
  const combining = /[\u0300-\u036F\u0951-\u0954\u09BC\u09BE-\u09CC\u09D7\u09E2\u09E3]/;
  let count = 0;
  for (const ch of text) {
    if (!combining.test(ch)) count++;
  }
  return count;
}

/**
 * Lightweight fallback for plain text sources with no reliable column/layout
 * information (OCR output). Unlike `reconstructParagraphBlocks`, this can't
 * detect indentation, centering or lists - but it still fixes the main
 * "gap" defect by joining each paragraph's wrapped lines into one flowing
 * paragraph instead of preserving OCR's per-visual-line hard breaks.
 */
export function blocksFromPlainText(text: string): ParagraphBlock[] {
  const paragraphs = text
    .replace(/\f/g, "\n\n")
    .split(/\n{2,}/)
    .map((p) => p.split("\n").map((l) => l.trim()).filter(Boolean).join(" ").trim())
    .filter((p) => p.length > 0);

  return paragraphs.map((text) => ({
    kind: "paragraph" as const,
    runs: [{ text }],
    indentLevel: 0,
  }));
}

export function reconstructParagraphBlocks(layoutText: string): ParagraphBlock[] {
  // Form feeds mark page boundaries; treat them like a paragraph break.
  const normalized = layoutText.replace(/\f/g, "\n\n");
  const rawLines = normalized.split("\n").map(toRawLine);
  const nonBlank = rawLines.filter((l) => l.trimmed.length > 0);
  if (nonBlank.length === 0) return [];

  const pageWidth = nonBlank.reduce((max, l) => Math.max(max, l.endColumn), 0) || 1;
  const bodyMargin = mode(nonBlank.map((l) => l.leading)) ?? 0;

  const isCentered = (line: RawLine): boolean => {
    if (line.leading <= bodyMargin + 3) return false;
    const rightGap = pageWidth - line.endColumn;
    const tolerance = Math.max(4, pageWidth * 0.15);
    return Math.abs(line.leading - rightGap) <= tolerance;
  };

  // --- Pass 1: sequential scan merging wrapped continuation lines ---
  const segments: Segment[] = [];
  let buffer: RawLine[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    segments.push({ lines: buffer, wrapped: buffer.length > 1 });
    buffer = [];
  };

  for (const line of rawLines) {
    if (line.trimmed.length === 0) {
      flush();
      continue;
    }
    if (buffer.length === 0) {
      buffer = [line];
      continue;
    }
    const prev = buffer[buffer.length - 1];
    const prevRanFull = prev.endColumn >= pageWidth * FULL_LINE_RATIO;
    const atBodyMargin = Math.abs(line.leading - bodyMargin) <= CONTINUATION_TOLERANCE;
    const continues = prevRanFull && atBodyMargin && !isCentered(line) && !line.bullet && !prev.bullet;
    if (continues) {
      buffer.push(line);
    } else {
      flush();
      buffer = [line];
    }
  }
  flush();

  // --- Pass 2: turn segments into ParagraphBlocks, grouping consecutive
  // short single-line segments that share an indent level into list items ---
  const blocks: ParagraphBlock[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.wrapped) {
      const text = seg.lines.map((l) => l.trimmed).join(" ").replace(/\s+/g, " ").trim();
      const bodyIndentLine = seg.lines[seg.lines.length - 1].leading;
      const firstLineLevel = indentLevelFor(seg.lines[0].leading, bodyMargin);
      const bodyLevel = indentLevelFor(bodyIndentLine, bodyMargin);
      blocks.push({
        kind: "paragraph",
        runs: [{ text }],
        alignment: "justify",
        indentLevel: bodyLevel,
        firstLineIndentLevel: firstLineLevel > bodyLevel ? firstLineLevel - bodyLevel : 0,
      });
      continue;
    }

    const line = seg.lines[0];
    const centered = !line.bullet && isCentered(line);
    const level = indentLevelFor(line.leading, bodyMargin);

    // An explicit bullet glyph is the most reliable list signal. Failing
    // that, group consecutive short single-line segments that share a
    // similar (non-body-margin) indent into a list.
    let isListItem = line.bullet;
    if (!isListItem && !centered && level > 0) {
      const prevSeg = i > 0 ? segments[i - 1] : undefined;
      const nextSeg = i < segments.length - 1 ? segments[i + 1] : undefined;
      const prevMatches =
        prevSeg && !prevSeg.wrapped && !isCentered(prevSeg.lines[0]) && closeIndent(prevSeg.lines[0].leading, line.leading);
      const nextMatches =
        nextSeg && !nextSeg.wrapped && !isCentered(nextSeg.lines[0]) && closeIndent(nextSeg.lines[0].leading, line.leading);
      isListItem = Boolean(prevMatches || nextMatches);
    }

    const block: ParagraphBlock = {
      kind: "paragraph",
      runs: [{ text: line.trimmed }],
      indentLevel: isListItem || centered ? 0 : level,
      alignment: centered ? "center" : "left",
    };
    if (centered) {
      block.heading = 1;
    } else if (isListItem) {
      block.listItem = { ordered: false, level: Math.max(1, level || 1) };
    }
    blocks.push(block);
  }

  return blocks;
}

function indentLevelFor(leading: number, bodyMargin: number): number {
  const delta = leading - bodyMargin;
  if (delta <= 1) return 0;
  return Math.min(4, Math.ceil(delta / DEFAULT_SPACES_PER_LEVEL));
}

function closeIndent(a: number, b: number): boolean {
  return Math.abs(a - b) <= 2;
}

function mode(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0];
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}
