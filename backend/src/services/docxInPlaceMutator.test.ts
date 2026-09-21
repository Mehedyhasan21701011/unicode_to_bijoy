import AdmZip from "adm-zip";
import { transformDocxInPlace, segmentRunText, ensureSutonnyInFontTable } from "./docxInPlaceMutator";

const BASE_CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const BASE_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

function createDocxZip(files: Record<string, string | Buffer>): Buffer {
  const zip = new AdmZip();
  zip.addFile("[Content_Types].xml", Buffer.from(BASE_CONTENT_TYPES, "utf8"));
  zip.addFile("_rels/.rels", Buffer.from(BASE_RELS, "utf8"));

  for (const [name, content] of Object.entries(files)) {
    if (Buffer.isBuffer(content)) {
      zip.addFile(name, content);
    } else {
      zip.addFile(name, Buffer.from(content, "utf8"));
    }
  }

  return zip.toBuffer();
}

function wrapInDocumentXml(bodyContent: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    ${bodyContent}
  </w:body>
</w:document>`;
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    passed++;
    console.log(`PASS: ${testName}`);
  } else {
    failed++;
    console.error(`FAIL: ${testName} ${detail ? `- ${detail}` : ""}`);
  }
}

async function runTests() {
  console.log("=== Running High-Fidelity DOCX In-Place Mutator Test Suite ===\n");

  // -------------------------------------------------------------
  // Test 1: Bengali-only paragraph
  // -------------------------------------------------------------
  {
    const xml = wrapInDocumentXml(
      `<w:p><w:r><w:t>আমি বাংলা লিখি।</w:t></w:r></w:p>`
    );
    const docx = createDocxZip({ "word/document.xml": xml });
    const result = await transformDocxInPlace(docx);
    const outZip = new AdmZip(result.buffer);
    const outDocXml = outZip.readAsText("word/document.xml");

    assert(
      outDocXml.includes("Avwg evsjv wjwL|") && outDocXml.includes('w:ascii="SutonnyMJ"'),
      "1. Bengali-only paragraph converts text to Bijoy and sets SutonnyMJ"
    );
  }

  // -------------------------------------------------------------
  // Test 2: English-only paragraph
  // -------------------------------------------------------------
  {
    const xml = wrapInDocumentXml(
      `<w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri"/></w:rPr><w:t>This is pure English text.</w:t></w:r></w:p>`
    );
    const docx = createDocxZip({ "word/document.xml": xml });
    const result = await transformDocxInPlace(docx);
    const outZip = new AdmZip(result.buffer);
    const outDocXml = outZip.readAsText("word/document.xml");

    assert(
      outDocXml.includes("This is pure English text.") &&
        !outDocXml.includes("SutonnyMJ") &&
        outDocXml.includes('w:ascii="Calibri"'),
      "2. English-only paragraph retains original font and text without SutonnyMJ"
    );
  }

  // -------------------------------------------------------------
  // Test 3: Mixed Bengali + English paragraph
  // -------------------------------------------------------------
  {
    const xml = wrapInDocumentXml(
      `<w:p><w:r><w:rPr><w:b/><w:rFonts w:ascii="Calibri"/></w:rPr><w:t>Hello বাংলা World 123</w:t></w:r></w:p>`
    );
    const docx = createDocxZip({ "word/document.xml": xml });
    const result = await transformDocxInPlace(docx);
    const outZip = new AdmZip(result.buffer);
    const outDocXml = outZip.readAsText("word/document.xml");

    const hasEnglishHello = outDocXml.includes("Hello ");
    const hasConvertedBangla = outDocXml.includes("evsjv");
    const hasEnglishWorld = outDocXml.includes("World 123");
    const hasSutonny = outDocXml.includes('w:ascii="SutonnyMJ"');
    const hasCalibri = outDocXml.includes('w:ascii="Calibri"');

    assert(
      hasEnglishHello && hasConvertedBangla && hasEnglishWorld && hasSutonny && hasCalibri,
      "3. Mixed Bengali + English splits into adjacent runs with appropriate fonts and preserved bold"
    );
  }

  // -------------------------------------------------------------
  // Test 4: Bold Bengali
  // -------------------------------------------------------------
  {
    const xml = wrapInDocumentXml(
      `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>বাংলাদেশ</w:t></w:r></w:p>`
    );
    const docx = createDocxZip({ "word/document.xml": xml });
    const result = await transformDocxInPlace(docx);
    const outZip = new AdmZip(result.buffer);
    const outDocXml = outZip.readAsText("word/document.xml");

    assert(
      outDocXml.includes("evsjv‡`k") && outDocXml.includes("<w:b/>") && outDocXml.includes("SutonnyMJ"),
      "4. Bold Bengali preserves <w:b/> tag and converts to SutonnyMJ"
    );
  }

  // -------------------------------------------------------------
  // Test 5: Italic Bengali
  // -------------------------------------------------------------
  {
    const xml = wrapInDocumentXml(
      `<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>শিক্ষা</w:t></w:r></w:p>`
    );
    const docx = createDocxZip({ "word/document.xml": xml });
    const result = await transformDocxInPlace(docx);
    const outZip = new AdmZip(result.buffer);
    const outDocXml = outZip.readAsText("word/document.xml");

    assert(
      outDocXml.includes("wk¶v") && outDocXml.includes("<w:i/>") && outDocXml.includes("SutonnyMJ"),
      "5. Italic Bengali preserves <w:i/> tag and converts to SutonnyMJ"
    );
  }

  // -------------------------------------------------------------
  // Test 6: Bengali with color
  // -------------------------------------------------------------
  {
    const xml = wrapInDocumentXml(
      `<w:p><w:r><w:rPr><w:color w:val="0070C0"/></w:rPr><w:t>নীল লেখা</w:t></w:r></w:p>`
    );
    const docx = createDocxZip({ "word/document.xml": xml });
    const result = await transformDocxInPlace(docx);
    const outZip = new AdmZip(result.buffer);
    const outDocXml = outZip.readAsText("word/document.xml");

    assert(
      outDocXml.includes('w:val="0070C0"') && outDocXml.includes("SutonnyMJ"),
      "6. Bengali with color preserves exact hex color tag and converts to SutonnyMJ"
    );
  }

  // -------------------------------------------------------------
  // Test 7: Bengali with different font size
  // -------------------------------------------------------------
  {
    const xml = wrapInDocumentXml(
      `<w:p><w:r><w:rPr><w:sz w:val="48"/><w:szCs w:val="48"/></w:rPr><w:t>বড় শিরোনাম</w:t></w:r></w:p>`
    );
    const docx = createDocxZip({ "word/document.xml": xml });
    const result = await transformDocxInPlace(docx);
    const outZip = new AdmZip(result.buffer);
    const outDocXml = outZip.readAsText("word/document.xml");

    assert(
      outDocXml.includes('w:sz w:val="48"') && outDocXml.includes("SutonnyMJ"),
      "7. Bengali with font size preserves 24pt (48 half-pt) sz tag and converts to SutonnyMJ"
    );
  }

  // -------------------------------------------------------------
  // Test 8: Bullet list
  // -------------------------------------------------------------
  {
    const xml = wrapInDocumentXml(
      `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>প্রথম পয়েন্ট</w:t></w:r></w:p>`
    );
    const docx = createDocxZip({ "word/document.xml": xml });
    const result = await transformDocxInPlace(docx);
    const outZip = new AdmZip(result.buffer);
    const outDocXml = outZip.readAsText("word/document.xml");

    assert(
      outDocXml.includes('w:numId w:val="1"') &&
        outDocXml.includes('w:ilvl w:val="0"') &&
        outDocXml.includes("SutonnyMJ"),
      "8. Bullet list retains full <w:numPr> structure intact with converted text"
    );
  }

  // -------------------------------------------------------------
  // Test 9: Numbered list
  // -------------------------------------------------------------
  {
    const xml = wrapInDocumentXml(
      `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>প্রথম ধাপ</w:t></w:r></w:p>`
    );
    const docx = createDocxZip({ "word/document.xml": xml });
    const result = await transformDocxInPlace(docx);
    const outZip = new AdmZip(result.buffer);
    const outDocXml = outZip.readAsText("word/document.xml");

    assert(
      outDocXml.includes('w:numId w:val="2"') && outDocXml.includes("SutonnyMJ"),
      "9. Numbered list retains <w:numPr> numId=2 intact without flattening to bullets"
    );
  }

  // -------------------------------------------------------------
  // Test 10: Multilevel list
  // -------------------------------------------------------------
  {
    const xml = wrapInDocumentXml(
      `<w:p><w:pPr><w:numPr><w:ilvl w:val="2"/><w:numId w:val="5"/></w:numPr><w:ind w:left="1440"/></w:pPr><w:r><w:t>উপ-শিরোনাম</w:t></w:r></w:p>`
    );
    const docx = createDocxZip({ "word/document.xml": xml });
    const result = await transformDocxInPlace(docx);
    const outZip = new AdmZip(result.buffer);
    const outDocXml = outZip.readAsText("word/document.xml");

    assert(
      outDocXml.includes('w:ilvl w:val="2"') &&
        outDocXml.includes('w:left="1440"') &&
        outDocXml.includes("SutonnyMJ"),
      "10. Multilevel list preserves level 2 and exact 1440 twips indentation"
    );
  }

  // -------------------------------------------------------------
  // Test 11: Table with borders
  // -------------------------------------------------------------
  {
    const xml = wrapInDocumentXml(
      `<w:tbl>
        <w:tblPr>
          <w:tblBorders>
            <w:top w:val="single" w:sz="8" w:space="0" w:color="FF0000"/>
            <w:left w:val="single" w:sz="8" w:space="0" w:color="FF0000"/>
          </w:tblBorders>
        </w:tblPr>
        <w:tr>
          <w:tc><w:p><w:r><w:t>টেবিল সেল ১</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>Cell 2</w:t></w:r></w:p></w:tc>
        </w:tr>
      </w:tbl>`
    );
    const docx = createDocxZip({ "word/document.xml": xml });
    const result = await transformDocxInPlace(docx);
    const outZip = new AdmZip(result.buffer);
    const outDocXml = outZip.readAsText("word/document.xml");

    assert(
      outDocXml.includes('w:tblBorders') &&
        outDocXml.includes('w:color="FF0000"') &&
        outDocXml.includes("Cell 2") &&
        outDocXml.includes("SutonnyMJ"),
      "11. Table with borders preserves custom tblBorders and converts cell text"
    );
  }

  // -------------------------------------------------------------
  // Test 12: Table with merged cells
  // -------------------------------------------------------------
  {
    const xml = wrapInDocumentXml(
      `<w:tbl>
        <w:tr>
          <w:tc>
            <w:tcPr>
              <w:gridSpan w:val="2"/>
              <w:vMerge w:val="restart"/>
            </w:tcPr>
            <w:p><w:r><w:t>মার্জ করা সেল</w:t></w:r></w:p>
          </w:tc>
        </w:tr>
      </w:tbl>`
    );
    const docx = createDocxZip({ "word/document.xml": xml });
    const result = await transformDocxInPlace(docx);
    const outZip = new AdmZip(result.buffer);
    const outDocXml = outZip.readAsText("word/document.xml");

    assert(
      outDocXml.includes('w:gridSpan w:val="2"') &&
        outDocXml.includes('w:vMerge w:val="restart"') &&
        outDocXml.includes("SutonnyMJ"),
      "12. Table with merged cells preserves gridSpan and vMerge intact"
    );
  }

  // -------------------------------------------------------------
  // Test 13: Header/footer
  // -------------------------------------------------------------
  {
    const docXml = wrapInDocumentXml(`<w:p><w:r><w:t>বডি টেক্সট</w:t></w:r></w:p>`);
    const headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p><w:r><w:t>হেডার বাংলা লেখা</w:t></w:r></w:p>
</w:hdr>`;
    const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p><w:r><w:t>ফুটার বাংলা লেখা</w:t></w:r></w:p>
</w:ftr>`;

    const docx = createDocxZip({
      "word/document.xml": docXml,
      "word/header1.xml": headerXml,
      "word/footer1.xml": footerXml,
    });
    const result = await transformDocxInPlace(docx);
    const outZip = new AdmZip(result.buffer);

    const outHeader = outZip.readAsText("word/header1.xml");
    const outFooter = outZip.readAsText("word/footer1.xml");

    assert(
      outHeader.includes("SutonnyMJ") &&
        outFooter.includes("SutonnyMJ") &&
        result.modifiedFiles.includes("word/header1.xml") &&
        result.modifiedFiles.includes("word/footer1.xml"),
      "13. Header and footer files are both transformed with SutonnyMJ"
    );
  }

  // -------------------------------------------------------------
  // Test 14: Page number field
  // -------------------------------------------------------------
  {
    const xml = wrapInDocumentXml(
      `<w:p>
        <w:r><w:t>পৃষ্ঠা </w:t></w:r>
        <w:fldSimple w:instr="PAGE"/>
        <w:r><w:t> এর </w:t></w:r>
        <w:fldSimple w:instr="NUMPAGES"/>
      </w:p>`
    );
    const docx = createDocxZip({ "word/document.xml": xml });
    const result = await transformDocxInPlace(docx);
    const outZip = new AdmZip(result.buffer);
    const outDocXml = outZip.readAsText("word/document.xml");

    assert(
      outDocXml.includes('w:fldSimple w:instr="PAGE"') &&
        outDocXml.includes('w:fldSimple w:instr="NUMPAGES"') &&
        outDocXml.includes("SutonnyMJ"),
      "14. Page number fields <w:fldSimple> are preserved 100% untouched"
    );
  }

  // -------------------------------------------------------------
  // Test 15: A4 page with custom margins
  // -------------------------------------------------------------
  {
    const xml = wrapInDocumentXml(
      `<w:p><w:r><w:t>এ৪ পৃষ্ঠা</w:t></w:r></w:p>
      <w:sectPr>
        <w:pgSz w:w="11906" w:h="16838"/>
        <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
      </w:sectPr>`
    );
    const docx = createDocxZip({ "word/document.xml": xml });
    const result = await transformDocxInPlace(docx);
    const outZip = new AdmZip(result.buffer);
    const outDocXml = outZip.readAsText("word/document.xml");

    assert(
      outDocXml.includes('w:w="11906"') &&
        outDocXml.includes('w:h="16838"') &&
        outDocXml.includes('w:top="1440"') &&
        outDocXml.includes('w:left="1440"'),
      "15. A4 dimensions (11906x16838) and custom 1-inch margins are preserved"
    );
  }

  // -------------------------------------------------------------
  // Test 16: Landscape page
  // -------------------------------------------------------------
  {
    const xml = wrapInDocumentXml(
      `<w:p><w:r><w:t>ল্যান্ডস্কেপ পৃষ্ঠা</w:t></w:r></w:p>
      <w:sectPr>
        <w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>
      </w:sectPr>`
    );
    const docx = createDocxZip({ "word/document.xml": xml });
    const result = await transformDocxInPlace(docx);
    const outZip = new AdmZip(result.buffer);
    const outDocXml = outZip.readAsText("word/document.xml");

    assert(
      outDocXml.includes('w:orient="landscape"') && outDocXml.includes('w:w="16838"'),
      "16. Landscape orientation and swapped page dimensions are preserved"
    );
  }

  // -------------------------------------------------------------
  // Test 17: Image-containing document
  // -------------------------------------------------------------
  {
    const dummyImageBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const xml = wrapInDocumentXml(
      `<w:p>
        <w:r><w:t>ছবি নিচে আছে</w:t></w:r>
        <w:r>
          <w:drawing>
            <wp:inline>
              <a:graphic>
                <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                  <pic:pic>
                    <pic:blipFill>
                      <a:blip r:embed="rId10"/>
                    </pic:blipFill>
                  </pic:pic>
                </a:graphicData>
              </a:graphic>
            </wp:inline>
          </w:drawing>
        </w:r>
      </w:p>`
    );
    const docx = createDocxZip({
      "word/document.xml": xml,
      "word/media/image1.png": dummyImageBuffer,
    });
    const result = await transformDocxInPlace(docx);
    const outZip = new AdmZip(result.buffer);
    const outDocXml = outZip.readAsText("word/document.xml");
    const outImage = outZip.readFile("word/media/image1.png");

    assert(
      outDocXml.includes("<w:drawing>") &&
        outDocXml.includes('r:embed="rId10"') &&
        outImage !== null &&
        outImage.equals(dummyImageBuffer),
      "17. Image drawing XML and binary file in word/media are 100% preserved"
    );
  }

  // -------------------------------------------------------------
  // Test 18: Hyperlink-containing document
  // -------------------------------------------------------------
  {
    const xml = wrapInDocumentXml(
      `<w:p>
        <w:hyperlink r:id="rId5" w:history="1">
          <w:r><w:t>ওয়েবসাইটে যান</w:t></w:r>
        </w:hyperlink>
      </w:p>`
    );
    const docx = createDocxZip({ "word/document.xml": xml });
    const result = await transformDocxInPlace(docx);
    const outZip = new AdmZip(result.buffer);
    const outDocXml = outZip.readAsText("word/document.xml");

    assert(
      outDocXml.includes('<w:hyperlink r:id="rId5" w:history="1">') &&
        outDocXml.includes("SutonnyMJ"),
      "18. Hyperlink wrapper <w:hyperlink> with target rId5 is 100% preserved"
    );
  }

  // -------------------------------------------------------------
  // Test 19: Multiple sections
  // -------------------------------------------------------------
  {
    const xml = wrapInDocumentXml(
      `<w:p>
        <w:pPr>
          <w:sectPr>
            <w:type w:val="nextPage"/>
            <w:pgSz w:w="12240" w:h="15840"/>
          </w:sectPr>
        </w:pPr>
        <w:r><w:t>প্রথম সেকশন</w:t></w:r>
      </w:p>
      <w:p><w:r><w:t>দ্বিতীয় সেকশন</w:t></w:r></w:p>
      <w:sectPr>
        <w:type w:val="continuous"/>
        <w:cols w:num="2" w:space="720"/>
      </w:sectPr>`
    );
    const docx = createDocxZip({ "word/document.xml": xml });
    const result = await transformDocxInPlace(docx);
    const outZip = new AdmZip(result.buffer);
    const outDocXml = outZip.readAsText("word/document.xml");

    assert(
      outDocXml.includes('w:type w:val="nextPage"') &&
        outDocXml.includes('w:cols w:num="2"') &&
        outDocXml.includes("SutonnyMJ"),
      "19. Multiple sections and 2-column layout definitions are preserved"
    );
  }

  // -------------------------------------------------------------
  // Test 20: Bengali text inside header/footer/table/footnotes
  // -------------------------------------------------------------
  {
    const docXml = wrapInDocumentXml(
      `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>টেবিলের ভেতরের বাংলা</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`
    );
    const footnotesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:footnote w:id="1"><w:p><w:r><w:t>পাদটীকা বাংলা</w:t></w:r></w:p></w:footnote>
</w:footnotes>`;

    const docx = createDocxZip({
      "word/document.xml": docXml,
      "word/footnotes.xml": footnotesXml,
    });
    const result = await transformDocxInPlace(docx);
    const outZip = new AdmZip(result.buffer);

    const outDoc = outZip.readAsText("word/document.xml");
    const outFootnotes = outZip.readAsText("word/footnotes.xml");

    assert(
      outDoc.includes("SutonnyMJ") && outFootnotes.includes("SutonnyMJ"),
      "20. Bengali text inside tables and footnotes are both transformed with SutonnyMJ"
    );
  }

  // -------------------------------------------------------------
  // Test 21: Regression Test - English-only DOCX has NO SutonnyMJ
  // -------------------------------------------------------------
  {
    const xml = wrapInDocumentXml(
      `<w:p><w:r><w:t>This document contains only English text, numbers 12345, and symbols.</w:t></w:r></w:p>`
    );
    const docx = createDocxZip({ "word/document.xml": xml });
    const result = await transformDocxInPlace(docx);
    const outZip = new AdmZip(result.buffer);
    const outDocXml = outZip.readAsText("word/document.xml");

    assert(
      result.modifiedFiles.length === 0 && !outDocXml.includes("SutonnyMJ"),
      "21. REGRESSION: English-only DOCX does not add SutonnyMJ anywhere"
    );
  }

  // -------------------------------------------------------------
  // Test 22: Font Table handling
  // -------------------------------------------------------------
  {
    const docXml = wrapInDocumentXml(`<w:p><w:r><w:t>বাংলা লেখা</w:t></w:r></w:p>`);
    const fontTableXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:font w:name="Calibri"><w:charset w:val="00"/></w:font>
</w:fonts>`;

    const docx = createDocxZip({
      "word/document.xml": docXml,
      "word/fontTable.xml": fontTableXml,
    });
    const result = await transformDocxInPlace(docx);
    const outZip = new AdmZip(result.buffer);
    const outFontTable = outZip.readAsText("word/fontTable.xml");

    assert(
      outFontTable.includes('w:name="SutonnyMJ"') && outFontTable.includes('w:name="Calibri"'),
      "22. Font table registers SutonnyMJ while preserving existing fonts"
    );
  }

  console.log(`\n========================================`);
  console.log(`Summary: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test runner threw uncaught exception:", err);
  process.exit(1);
});
