import AdmZip from "adm-zip";
import { DOMParser, XMLSerializer, type Element, type Document } from "@xmldom/xmldom";
import { unicodeToBijoy } from "../converter/unicodeToBijoy";

export interface TextSegment {
  text: string;
  isBengali: boolean;
}

export interface XmlTransformResult {
  xml: string;
  hasModifications: boolean;
  extractedUnicodeText: string;
  extractedBijoyText: string;
}

export interface DocxInPlaceResult {
  buffer: Buffer;
  unicodeText: string;
  bijoyText: string;
  modifiedFiles: string[];
}

const BENGALI_CHAR_PATTERN = /[\u0980-\u09FF\u0964\u0965]/;
const LATIN_CHAR_PATTERN = /[a-zA-Z]/;
const SUTONNY_FONT_NAME = "SutonnyMJ";

/**
 * Checks whether a text segment contains at least one Bengali Unicode character.
 */
export function hasBengaliText(text: string): boolean {
  return BENGALI_CHAR_PATTERN.test(text);
}

/**
 * Segments a text string into contiguous chunks of Bengali and non-Bengali text.
 *
 * Rules:
 * - If the text contains no Bengali characters, it returns as a single non-Bengali segment.
 * - If the text contains Bengali characters and NO Latin/foreign characters, it returns as a single Bengali segment.
 * - If the text contains both Bengali and Latin characters:
 *   - Contiguous Bengali words/characters stay together.
 *   - Contiguous Latin words/characters stay together.
 *   - Whitespace between Bengali words belongs to Bengali.
 *   - Whitespace between Latin words belongs to Latin.
 *   - Neutral characters (spaces, punctuation, digits) at boundaries attach logically so that Latin text retains its font and spacing.
 */
export function segmentRunText(text: string): TextSegment[] {
  if (!text) return [];

  // Fast path 1: No Bengali at all
  if (!BENGALI_CHAR_PATTERN.test(text)) {
    return [{ text, isBengali: false }];
  }

  // Fast path 2: Has Bengali and NO Latin characters
  if (!LATIN_CHAR_PATTERN.test(text)) {
    return [{ text, isBengali: true }];
  }

  // Mixed text: tokenize into words, spaces, numbers, and punctuation
  const tokenRegex = /([a-zA-Z]+(?:['’][a-zA-Z]+)*|[\u0980-\u09FF\u0964\u0965]+|\s+|[^\s\w\u0980-\u09FF\u0964\u0965]+|\d+)/g;
  const tokens = text.match(tokenRegex) || [text];

  const segments: TextSegment[] = [];
  let currentText = "";
  let currentIsBn: boolean | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const isBn = BENGALI_CHAR_PATTERN.test(t);
    const isLat = LATIN_CHAR_PATTERN.test(t);

    if (isBn) {
      if (currentIsBn === true) {
        currentText += t;
      } else {
        if (currentText) segments.push({ text: currentText, isBengali: false });
        currentText = t;
        currentIsBn = true;
      }
    } else if (isLat) {
      if (currentIsBn === false) {
        currentText += t;
      } else {
        if (currentText) segments.push({ text: currentText, isBengali: currentIsBn === true });
        currentText = t;
        currentIsBn = false;
      }
    } else {
      // Neutral token: spaces, punctuation, digits
      let nextType: "bn" | "lat" | null = null;
      for (let j = i + 1; j < tokens.length; j++) {
        if (BENGALI_CHAR_PATTERN.test(tokens[j])) {
          nextType = "bn";
          break;
        } else if (LATIN_CHAR_PATTERN.test(tokens[j])) {
          nextType = "lat";
          break;
        }
      }

      if (currentIsBn === true && nextType === "bn") {
        // Between two Bengali words -> attach to Bengali
        currentText += t;
      } else if (currentIsBn === false && nextType === "lat") {
        // Between two Latin words -> attach to Latin
        currentText += t;
      } else if (currentIsBn === true && nextType === "lat") {
        // Between Bengali and Latin:
        if (/^\s+$/.test(t)) {
          segments.push({ text: currentText, isBengali: true });
          currentText = t;
          currentIsBn = false;
        } else {
          currentText += t;
        }
      } else if (currentIsBn === false && nextType === "bn") {
        // Between Latin and Bengali -> attach to Latin
        currentText += t;
      } else if (currentIsBn === null) {
        // Leading neutrals before any language token
        currentText += t;
        currentIsBn = false;
      } else {
        // Trailing neutrals at end of string
        currentText += t;
      }
    }
  }

  if (currentText) {
    segments.push({ text: currentText, isBengali: currentIsBn === true });
  }

  return segments;
}

/**
 * Sets or updates the font declaration in an OpenXML <w:rPr> to SutonnyMJ.
 * Preserves all other attributes (e.g. w:hint) and sibling run properties.
 */
function applySutonnyFontToRPr(rPr: Element, doc: Document): void {
  // Look for existing <w:rFonts>
  let rFonts: Element | null = null;
  for (let i = 0; i < rPr.childNodes.length; i++) {
    const child = rPr.childNodes[i] as Element;
    if (child.nodeType === 1 && (child.nodeName === "w:rFonts" || child.localName === "rFonts")) {
      rFonts = child;
      break;
    }
  }

  if (!rFonts) {
    rFonts = doc.createElement("w:rFonts");
    // In OpenXML, w:rFonts is conventionally the first element in w:rPr
    if (rPr.firstChild) {
      rPr.insertBefore(rFonts, rPr.firstChild);
    } else {
      rPr.appendChild(rFonts);
    }
  }

  rFonts.setAttribute("w:ascii", SUTONNY_FONT_NAME);
  rFonts.setAttribute("w:hAnsi", SUTONNY_FONT_NAME);
  rFonts.setAttribute("w:cs", SUTONNY_FONT_NAME);
}

/**
 * Transforms all <w:r> run elements in an OpenXML DOM.
 * Only runs containing Bengali characters are transformed.
 * Mixed runs are split into adjacent runs so English text is never assigned SutonnyMJ.
 */
function transformRunElements(doc: Document): {
  hasModifications: boolean;
  extractedUnicodeRuns: string[];
  extractedBijoyRuns: string[];
} {
  let hasModifications = false;
  const extractedUnicodeRuns: string[] = [];
  const extractedBijoyRuns: string[] = [];

  // Find all <w:r> elements
  const runs = doc.getElementsByTagName("w:r");
  // Copy to array because the live NodeList will change when we split runs
  const runList: Element[] = [];
  for (let i = 0; i < runs.length; i++) {
    runList.push(runs[i]);
  }

  for (const runElem of runList) {
    // Find all <w:t> elements inside this run
    const tElements: Element[] = [];
    for (let i = 0; i < runElem.childNodes.length; i++) {
      const child = runElem.childNodes[i] as Element;
      if (child.nodeType === 1 && (child.nodeName === "w:t" || child.localName === "t")) {
        tElements.push(child);
      }
    }

    if (tElements.length === 0) continue;

    // Concatenate all text inside this run to determine if it has Bengali
    const fullText = tElements.map((t) => t.textContent || "").join("");
    if (!fullText) continue;

    if (!hasBengaliText(fullText)) {
      // English-only or non-Bengali: RECORD for preview and LEAVE COMPLETELY UNTOUCHED!
      extractedUnicodeRuns.push(fullText);
      extractedBijoyRuns.push(fullText);
      continue;
    }

    // This run contains Bengali text!
    hasModifications = true;
    extractedUnicodeRuns.push(fullText);

    // Check if the run has non-Bengali characters (Latin letters)
    const segments = segmentRunText(fullText);
    const isPureBengali = segments.length === 1 && segments[0].isBengali;

    // Find or locate <w:rPr>
    let rPr: Element | null = null;
    for (let i = 0; i < runElem.childNodes.length; i++) {
      const child = runElem.childNodes[i] as Element;
      if (child.nodeType === 1 && (child.nodeName === "w:rPr" || child.localName === "rPr")) {
        rPr = child;
        break;
      }
    }

    if (isPureBengali) {
      // Case 1: Pure Bengali run. Convert in place without splitting.
      const converted = unicodeToBijoy(fullText).bijoyText;
      extractedBijoyRuns.push(converted);

      // Ensure <w:rPr> exists and set SutonnyMJ
      if (!rPr) {
        rPr = doc.createElement("w:rPr");
        if (runElem.firstChild) {
          runElem.insertBefore(rPr, runElem.firstChild);
        } else {
          runElem.appendChild(rPr);
        }
      }
      applySutonnyFontToRPr(rPr, doc);

      // Update text in the <w:t> element
      if (tElements.length === 1) {
        const tElem = tElements[0];
        while (tElem.firstChild) tElem.removeChild(tElem.firstChild);
        tElem.appendChild(doc.createTextNode(converted));
        if (/^\s|\s$/.test(converted)) {
          tElem.setAttribute("xml:space", "preserve");
        }
      } else {
        // If multiple <w:t>, set all text in first and remove rest
        const firstT = tElements[0];
        while (firstT.firstChild) firstT.removeChild(firstT.firstChild);
        firstT.appendChild(doc.createTextNode(converted));
        if (/^\s|\s$/.test(converted)) {
          firstT.setAttribute("xml:space", "preserve");
        }
        for (let i = 1; i < tElements.length; i++) {
          runElem.removeChild(tElements[i]);
        }
      }
    } else {
      // Case 2: Mixed Bengali + English run.
      // Must split into adjacent sibling runs:
      // - Bengali segment -> converted text with SutonnyMJ
      // - Non-Bengali segment -> original text with original font
      const parent = runElem.parentNode;
      if (!parent) continue;

      let bijoyFull = "";

      for (const seg of segments) {
        const newRun = doc.createElement("w:r");

        // Clone original <w:rPr> to preserve all formatting (bold, color, size, etc.)
        if (rPr) {
          const clonedRPr = rPr.cloneNode(true) as Element;
          if (seg.isBengali) {
            applySutonnyFontToRPr(clonedRPr, doc);
          }
          newRun.appendChild(clonedRPr);
        } else if (seg.isBengali) {
          const newRPr = doc.createElement("w:rPr");
          applySutonnyFontToRPr(newRPr, doc);
          newRun.appendChild(newRPr);
        }

        const segText = seg.isBengali ? unicodeToBijoy(seg.text).bijoyText : seg.text;
        bijoyFull += segText;

        const newT = doc.createElement("w:t");
        if (/^\s|\s$/.test(segText)) {
          newT.setAttribute("xml:space", "preserve");
        }
        newT.appendChild(doc.createTextNode(segText));
        newRun.appendChild(newT);

        parent.insertBefore(newRun, runElem);
      }

      extractedBijoyRuns.push(bijoyFull);
      parent.removeChild(runElem);
    }
  }

  return { hasModifications, extractedUnicodeRuns, extractedBijoyRuns };
}

/**
 * Extracts clean plain text from paragraphs in an OpenXML document.
 */
function extractParagraphsFromDoc(doc: Document): string[] {
  const paragraphs = doc.getElementsByTagName("w:p");
  const result: string[] = [];

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    const tNodes = p.getElementsByTagName("w:t");
    let pText = "";
    for (let j = 0; j < tNodes.length; j++) {
      pText += tNodes[j].textContent || "";
    }
    if (pText.trim().length > 0) {
      result.push(pText.trim());
    }
  }

  return result;
}

/**
 * Transforms a single OpenXML XML document string (e.g. document.xml, header1.xml).
 */
export function transformXmlContent(xmlContent: string): XmlTransformResult {
  const doc = new DOMParser().parseFromString(xmlContent, "text/xml");

  const originalParagraphs = extractParagraphsFromDoc(doc);
  const { hasModifications } = transformRunElements(doc);

  let transformedParagraphs = originalParagraphs;
  let serialized = xmlContent;

  if (hasModifications) {
    transformedParagraphs = extractParagraphsFromDoc(doc);
    serialized = new XMLSerializer().serializeToString(doc);
  }

  return {
    xml: serialized,
    hasModifications,
    extractedUnicodeText: originalParagraphs.join("\n\n"),
    extractedBijoyText: transformedParagraphs.join("\n\n"),
  };
}

/**
 * Ensures SutonnyMJ is declared in word/fontTable.xml if present.
 */
export function ensureSutonnyInFontTable(fontTableXml: string): string {
  if (fontTableXml.includes(`w:name="${SUTONNY_FONT_NAME}"`) || fontTableXml.includes(`w:name='${SUTONNY_FONT_NAME}'`)) {
    return fontTableXml;
  }

  const doc = new DOMParser().parseFromString(fontTableXml, "text/xml");
  const root = doc.documentElement;
  if (!root) return fontTableXml;

  const fontElem = doc.createElement("w:font");
  fontElem.setAttribute("w:name", SUTONNY_FONT_NAME);

  const charset = doc.createElement("w:charset");
  charset.setAttribute("w:val", "00");
  fontElem.appendChild(charset);

  const family = doc.createElement("w:family");
  family.setAttribute("w:val", "auto");
  fontElem.appendChild(family);

  const pitch = doc.createElement("w:pitch");
  pitch.setAttribute("w:val", "variable");
  fontElem.appendChild(pitch);

  root.appendChild(fontElem);
  return new XMLSerializer().serializeToString(doc);
}

/** Target XML entries in the DOCX package that contain user-visible text */
const TARGET_XML_REGEX = /^word\/(document|header\d*|footer\d*|footnotes\d*|endnotes\d*|comments\d*)\.xml$/i;

/**
 * Performs high-fidelity in-place OpenXML transformation on a .docx file.
 *
 * It unpacks the original zip, modifies only the text nodes containing Bengali characters
 * and the font declaration on those converted runs, declares SutonnyMJ in the font table,
 * and repacks the zip.
 *
 * 100% of all other XML structures, attributes, styles, images, tables, headers, footers,
 * margins, and page settings remain untouched.
 */
export async function transformDocxInPlace(input: Buffer | string): Promise<DocxInPlaceResult> {
  const zip = new AdmZip(input);
  const entries = zip.getEntries();

  const modifiedFiles: string[] = [];
  const unicodeParts: string[] = [];
  const bijoyParts: string[] = [];
  let fontTableEntry: AdmZip.IZipEntry | null = null;

  for (const entry of entries) {
    const name = entry.entryName;

    if (name.toLowerCase() === "word/fonttable.xml") {
      fontTableEntry = entry;
      continue;
    }

    if (TARGET_XML_REGEX.test(name)) {
      const xmlContent = entry.getData().toString("utf8");
      const result = transformXmlContent(xmlContent);

      if (result.hasModifications) {
        zip.updateFile(name, Buffer.from(result.xml, "utf8"));
        modifiedFiles.push(name);
      }

      if (name.toLowerCase() === "word/document.xml") {
        unicodeParts.unshift(result.extractedUnicodeText);
        bijoyParts.unshift(result.extractedBijoyText);
      } else if (result.extractedUnicodeText) {
        unicodeParts.push(result.extractedUnicodeText);
        bijoyParts.push(result.extractedBijoyText);
      }
    }
  }

  // If any modifications were made and fontTable.xml exists, ensure SutonnyMJ is in fontTable
  if (modifiedFiles.length > 0 && fontTableEntry) {
    const rawFontTable = fontTableEntry.getData().toString("utf8");
    const updatedFontTable = ensureSutonnyInFontTable(rawFontTable);
    if (updatedFontTable !== rawFontTable) {
      zip.updateFile(fontTableEntry.entryName, Buffer.from(updatedFontTable, "utf8"));
      modifiedFiles.push(fontTableEntry.entryName);
    }
  }

  const buffer = zip.toBuffer();
  const unicodeText = unicodeParts.filter(Boolean).join("\n\n");
  const bijoyText = bijoyParts.filter(Boolean).join("\n\n");

  return {
    buffer,
    unicodeText,
    bijoyText,
    modifiedFiles,
  };
}
