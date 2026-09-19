import { XMLParser } from "fast-xml-parser";
import AdmZip from "adm-zip";
import type { Alignment, DocBlock, DocRun, ParagraphBlock, TableBlock, TableCellBlock } from "../model/docModel";
import { INDENT_STEP_TWIPS, mergeAdjacentRuns } from "../model/docModel";

export class DocxError extends Error {
  constructor(
    message: string,
    public code: "INVALID_DOCX" | "UNZIP_MISSING" | "EMPTY_DOCUMENT"
  ) {
    super(message);
    this.name = "DocxError";
  }
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  preserveOrder: true,
  trimValues: false,
});

/**
 * Extracts word/document.xml from a .docx (which is just a zip archive) and
 * parses it into our structural DocBlock[] model: paragraphs keep their
 * real alignment, indentation, heading style and list level, runs keep
 * bold/italic, and tables are preserved as tables. This reads Word's own
 * layout information directly instead of re-guessing it from plain text,
 * so a DOCX input round-trips with much higher fidelity than a PDF input.
 */
export async function extractDocxBlocks(filePath: string): Promise<DocBlock[]> {
  const xml = await readDocumentXml(filePath);
  const parsed = parser.parse(xml);
  const body = findBody(parsed);
  if (!body) {
    throw new DocxError("Could not find a document body inside this .docx file.", "INVALID_DOCX");
  }

  const blocks: DocBlock[] = [];
  for (const node of body) {
    if (node["w:p"] !== undefined) {
      const block = parseParagraph(node["w:p"]);
      if (block) blocks.push(block);
    } else if (node["w:tbl"] !== undefined) {
      blocks.push(parseTable(node["w:tbl"]));
    }
  }

  if (blocks.length === 0) {
    throw new DocxError("This document appears to have no readable content.", "EMPTY_DOCUMENT");
  }
  return blocks;
}

async function readDocumentXml(filePath: string): Promise<string> {
  try {
    const zip = new AdmZip(filePath);
    const entry = zip.getEntry("word/document.xml");
    if (!entry) {
      throw new DocxError("This .docx file has no word/document.xml part - it may be corrupted.", "INVALID_DOCX");
    }
    const content = entry.getData().toString("utf8");
    if (!content || content.trim().length === 0) {
      throw new DocxError("This .docx file has no word/document.xml part - it may be corrupted.", "INVALID_DOCX");
    }
    return content;
  } catch (err: any) {
    if (err instanceof DocxError) throw err;
    throw new DocxError(
      "Could not read this .docx file - it may be corrupted or password-protected.",
      "INVALID_DOCX"
    );
  }
}

// --- XML tree helpers (preserveOrder:true gives an array-of-tagged-objects tree) ---

type Node = Record<string, any>;

function findBody(parsedRoot: Node[]): Node[] | undefined {
  const documentNode = parsedRoot.find((n) => n["w:document"] !== undefined);
  const documentChildren: Node[] | undefined = documentNode?.["w:document"];
  const bodyEntry = documentChildren?.find((n) => n["w:body"] !== undefined);
  return bodyEntry?.["w:body"];
}

function getAttr(node: Node | undefined, attr: string): string | undefined {
  return node?.[":@"]?.[`@_${attr}`];
}

function findChild(children: Node[] | undefined, tag: string): Node | undefined {
  return children?.find((n) => n[tag] !== undefined);
}

function findChildren(children: Node[] | undefined, tag: string): Node[] {
  return children?.filter((n) => n[tag] !== undefined) ?? [];
}

const HEADING_STYLE_RE = /^(?:Heading|heading)(\d)$/;

function parseParagraph(pChildren: Node[]): ParagraphBlock | undefined {
  const pPr = findChild(pChildren, "w:pPr")?.["w:pPr"] as Node[] | undefined;

  let alignment: Alignment | undefined;
  const jc = findChild(pPr, "w:jc");
  const jcVal = getAttr(jc, "w:val");
  if (jcVal) alignment = mapAlignment(jcVal);

  let indentLevel = 0;
  let firstLineIndentLevel = 0;
  const ind = findChild(pPr, "w:ind");
  if (ind) {
    const left = parseInt(getAttr(ind, "w:left") ?? getAttr(ind, "w:start") ?? "0", 10) || 0;
    const firstLine = parseInt(getAttr(ind, "w:firstLine") ?? "0", 10) || 0;
    const hanging = parseInt(getAttr(ind, "w:hanging") ?? "0", 10) || 0;
    indentLevel = Math.round(left / INDENT_STEP_TWIPS);
    firstLineIndentLevel = Math.round((firstLine - hanging) / INDENT_STEP_TWIPS);
  }

  let heading: 1 | 2 | 3 | undefined;
  const pStyle = findChild(pPr, "w:pStyle");
  const styleVal = getAttr(pStyle, "w:val");
  if (styleVal) {
    if (/^Title$/i.test(styleVal)) heading = 1;
    else {
      const m = styleVal.match(HEADING_STYLE_RE);
      if (m) {
        const level = parseInt(m[1], 10);
        heading = (level <= 3 ? level : 3) as 1 | 2 | 3;
      }
    }
  }

  let listItem: { ordered: boolean; level: number } | undefined;
  const numPr = findChild(pPr, "w:numPr");
  if (numPr) {
    const numPrChildren = numPr["w:numPr"] as Node[];
    const ilvl = findChild(numPrChildren, "w:ilvl");
    const level = ilvl ? parseInt(getAttr(ilvl, "w:val") ?? "0", 10) : 0;
    // We don't resolve numbering.xml to tell bullet vs decimal apart; default
    // to unordered, which is the overwhelmingly common case and safe even
    // if wrong (still a correctly-indented, marked list item).
    listItem = { ordered: false, level: level + 1 };
  } else if (styleVal && /^List\s*(Bullet|Number|Paragraph)/i.test(styleVal)) {
    // Some documents (and python-docx's built-in styles) mark list
    // paragraphs purely via a named style with no explicit w:numPr on the
    // paragraph itself - the numbering is only defined once, on the style.
    // Fall back to recognizing the style name so these don't silently lose
    // their list formatting.
    listItem = { ordered: /Number/i.test(styleVal), level: 1 };
  }

  const runs: DocRun[] = [];
  for (const child of pChildren) {
    if (child["w:r"] !== undefined) {
      const run = parseRun(child["w:r"]);
      if (run) runs.push(run);
    } else if (child["w:hyperlink"] !== undefined) {
      for (const inner of child["w:hyperlink"] as Node[]) {
        if (inner["w:r"] !== undefined) {
          const run = parseRun(inner["w:r"]);
          if (run) runs.push(run);
        }
      }
    }
  }

  if (runs.length === 0) {
    // A genuinely empty paragraph is meaningful vertical space - keep it
    // as a blank paragraph rather than dropping it (which would silently
    // collapse the document's spacing).
    return { kind: "paragraph", runs: [{ text: "" }], indentLevel: 0, isBlank: true };
  }

  return {
    kind: "paragraph",
    runs: mergeAdjacentRuns(runs),
    alignment,
    indentLevel: Math.max(0, indentLevel),
    firstLineIndentLevel: firstLineIndentLevel || undefined,
    heading,
    listItem,
  };
}

function parseRun(rChildren: Node[]): DocRun | undefined {
  const rPr = findChild(rChildren, "w:rPr")?.["w:rPr"] as Node[] | undefined;
  const bold = Boolean(findChild(rPr, "w:b")) && !isFlagOff(rPr, "w:b");
  const italic = Boolean(findChild(rPr, "w:i")) && !isFlagOff(rPr, "w:i");
  const underlineNode = findChild(rPr, "w:u");
  const underlineVal = getAttr(underlineNode, "w:val");
  const underline = Boolean(underlineNode) && underlineVal !== "none";

  let text = "";
  for (const child of rChildren) {
    if (child["w:t"] !== undefined) {
      const tNode = child["w:t"];
      text += extractText(tNode);
    } else if (child["w:tab"] !== undefined) {
      text += "\t";
    } else if (child["w:br"] !== undefined || child["w:cr"] !== undefined) {
      text += "\n";
    }
  }

  if (text.length === 0) return undefined;
  return { text, bold: bold || undefined, italic: italic || undefined, underline: underline || undefined };
}

function extractText(tNode: any): string {
  if (Array.isArray(tNode)) {
    return tNode.map((n) => (typeof n === "object" && "#text" in n ? String(n["#text"]) : "")).join("");
  }
  if (typeof tNode === "string") return tNode;
  return "";
}

function isFlagOff(rPr: Node[] | undefined, tag: string): boolean {
  const node = findChild(rPr, tag);
  if (!node) return false;
  const val = getAttr(node, "w:val");
  return val === "0" || val === "false";
}

function mapAlignment(val: string): Alignment | undefined {
  switch (val) {
    case "center":
      return "center";
    case "right":
    case "end":
      return "right";
    case "both":
    case "distribute":
      return "justify";
    case "left":
    case "start":
      return "left";
    default:
      return undefined;
  }
}

function parseTable(tblChildren: Node[]): TableBlock {
  const rows: TableCellBlock[][] = [];
  for (const child of tblChildren) {
    if (child["w:tr"] === undefined) continue;
    const trChildren = child["w:tr"] as Node[];
    const cells: TableCellBlock[] = [];
    for (const trChild of trChildren) {
      if (trChild["w:tc"] === undefined) continue;
      const tcChildren = trChild["w:tc"] as Node[];
      const paragraphs: DocRun[][] = [];
      for (const tcChild of tcChildren) {
        if (tcChild["w:p"] === undefined) continue;
        const para = parseParagraph(tcChild["w:p"]);
        if (para && para.kind === "paragraph" && !para.isBlank) {
          paragraphs.push(para.runs);
        }
      }
      cells.push({ paragraphs: paragraphs.length > 0 ? paragraphs : [[{ text: "" }]] });
    }
    if (cells.length > 0) rows.push(cells);
  }
  return { kind: "table", rows };
}
