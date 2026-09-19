# Bijoy Converter (PDF / DOCX / DOC → Bijoy)

Upload a Bengali **PDF, DOCX or DOC** file, extract its text *and structure*
(with automatic OCR fallback for scanned PDFs), and convert Unicode Bengali
into **Bijoy ANSI encoding compatible with SutonnyMJ** — a real encoding
conversion (glyph reordering, conjunct/phala/reph mapping), not a font swap.
Preview both forms, copy the Bijoy text, and download it as `.txt` or a
`.docx` that reproduces the original document's paragraph alignment,
indentation, headings, bullet lists and tables, set to the SutonnyMJ font.

```
frontend/   React + TypeScript + Tailwind CSS (Vite)
backend/    Node.js + Express + TypeScript
```

## How it works

```
Upload (.pdf / .docx / .doc)
        │
        ├─ .pdf  ─▶ pdftotext -layout ─┬─ looks scanned/garbled? ─▶ OCR (tesseract, ben+eng)
        │                              └─ looks fine ───────────────▶ reconstruct layout
        ├─ .docx ─▶ parse word/document.xml directly (alignment, indent, headings, lists, tables)
        └─ .doc  ─▶ LibreOffice --headless --convert-to docx  ─▶ (same path as .docx)
        │
        ▼
   Structured document (paragraphs + tables, with alignment/indent/heading/list metadata)
        │
        ▼
   Convert every run of text to Bijoy/SutonnyMJ (structure untouched)
        │
        ▼
   Preview + Download (.txt / .docx that mirrors the original layout)
```

### Why this matters: the "gap" / broken-layout problem

Earlier versions of this pipeline flattened everything to plain text. That
caused two concrete, reproducible bugs that this rewrite fixes:

1. **Forced line breaks.** Plain `pdftotext` (no `-layout`) emits one hard
   newline per *visual* line of the PDF, not per paragraph. A paragraph that
   wrapped across 4 lines in the source PDF was turned into 4 forced Word
   line breaks — regardless of the new document's page width or font. That's
   the ragged, gap-filled layout users were seeing. Fixed by switching to
   `pdftotext -layout` and reconstructing real paragraphs
   (`backend/src/services/pdfLayoutBlocks.ts`): wrapped lines are rejoined
   into flowing paragraphs, using each line's leading/trailing whitespace to
   recover indentation, centered headings, and lists.
2. **Broken bullet glyphs.** Word/LibreOffice encode bullet-list markers
   using Private-Use-Area codepoints (commonly U+F0B7) from the
   Symbol/Wingdings fonts, not a real "•". `pdftotext` extracts that PUA
   codepoint literally, and since SutonnyMJ has no glyph mapped there, it
   rendered as a broken/hollow box in the final document. Now detected and
   converted into a proper list item instead of leaking through as text.

### Why this matters: broken characters inside otherwise-correct paragraphs

A second, independent class of bug affects *any* input format (not just
PDF) once layout is no longer the problem: individual characters that have
no possible representation in a single-byte legacy font. Diagnosed against
a real 900+ paragraph monograph (comparing the original `.docx` against its
previously-converted output) and fixed in
`backend/src/converter/unicodeToBijoy.ts`:

1. **Curly quotes, em/en dashes, ellipsis, non-breaking spaces.** Word's
   autocorrect turns a plain `"`/`-` into `“ ” ‘ ’`/`— –`/`…` as you type.
   These are Unicode codepoints with no possible glyph in SutonnyMJ's
   single-byte character set, and previously passed straight through
   unconverted — guaranteed to render as a broken/fallback character no
   matter what. Fixed by normalizing them to their plain ASCII equivalents
   *before* conversion. Verified correct by round-tripping the converted
   output back through the companion `@codesigntheory/bnbijoy2unicode`
   reverse converter and confirming it matches the original text.
2. **Zero-width joiner/non-joiner (ZWJ/ZWNJ).** Used in Bengali to force an
   "unjoined" conjunct rendering (e.g. "র‌্য" rather than the automatic
   র-ফলা ligature) - found in the test document inside "র‍্যাডিক্যাল". The
   underlying engine has no concept of Unicode joiner controls and was
   actively corrupting output around them (injecting a stray literal `&`).
   Fixed by stripping ZWJ/ZWNJ before conversion, trading a rare
   typographic nuance for guaranteed-correct text.
3. **Decomposed two-part vowel signs.** Bengali `ো` (o-kar) and `ৌ` (au-kar)
   are each *sometimes* stored as two separate combining marks (e.g. e-kar
   + aa-kar) instead of the single precomposed codepoint, depending on the
   editor/source that produced the text. Standard Unicode NFC normalization
   fixes this correctly, but the pipeline never applied it. Root-caused
   against the real document (word "গ্রন্থগুলোতে" was left with a stray
   leftover vowel sign) and fixed by adding `.normalize("NFC")` as the
   first step of every conversion. This is the same category of issue as
   the existing নুক্তা (ড়/ঢ়/য়) handling, for a different character class
   that NFC *can* fix on its own.

Note: a literal ASCII colon (`:`) used as ordinary punctuation was
suspected at one point but is **not** a bug - verified via the reverse
converter that it round-trips correctly as a plain colon.

- **PDF text extraction** uses poppler's `pdftotext -layout` /`pdfinfo`
  rather than a pure-JS PDF parser. In testing, pure-JS extractors (and even
  poppler's own `pdftohtml -xml`, which would otherwise be the obvious way
  to get per-line coordinates) mis-decoded shaped Bengali conjunct glyphs,
  while `pdftotext` extracted them perfectly — see
  `backend/src/services/pdfExtract.ts` for the reasoning and the
  garbled-text heuristic that automatically falls back to OCR if it happens
  on a given PDF's font.
- **DOCX structure extraction** (`backend/src/services/docxExtract.ts`)
  reads `word/document.xml` directly (a `.docx` is just a zip archive) via
  `fast-xml-parser`, rather than converting to plain text first. This reads
  Word's own alignment, indentation, heading style, list, and bold/italic
  information exactly as authored, so a DOCX input round-trips with far
  higher fidelity than layout has to be *guessed* from a PDF.
- **Legacy `.doc` files** are converted to `.docx` with headless LibreOffice
  (`soffice --headless --convert-to docx`) and then flow through the same
  DOCX extractor — there is no reliable, actively-maintained pure-JS parser
  for the old binary OLE `.doc` format that handles Bengali text correctly.
- **OCR** shells out to the real `tesseract` CLI (`ben+eng` language data)
  rather than a WASM wrapper, so it needs no internet access at runtime and
  can't crash the server if a CDN is unreachable. OCR output has no reliable
  column/layout information, so it's rejoined into flowing paragraphs (fixing
  the same forced-line-break problem) but indentation/headings/lists can't be
  reconstructed from it — see Known limitations.
- **Unicode → Bijoy conversion** (`backend/src/converter/unicodeToBijoy.ts`)
  wraps the `@codesigntheory/bnunicode2ansi` engine (reph, ya-phala,
  ra-phala, and dozens of hard-coded যুক্তাক্ষর mappings) with a
  normalization pass for decomposed নুক্তা sequences (ড়/ঢ়/য়) that would
  otherwise leak through unconverted, plus Bengali punctuation handling.
  `convertBlocks()` applies this to every run of text inside the structured
  document without touching alignment/indentation/tables, so layout survives
  conversion untouched. It's covered by 39 automated tests, including
  round-trip verification against an independent reverse converter — run
  `cd backend && npm test`.

## Prerequisites

- **Node.js 18+** and npm
- **poppler-utils** (`pdftotext`, `pdfinfo`, `pdftoppm`) — required for PDF
  text/layout extraction and OCR page rasterization
- **Tesseract OCR** with the Bengali language pack — required for scanned
  PDFs
- **`unzip`** — required to read `.docx` files (almost always preinstalled
  on Linux/macOS)
- **LibreOffice** (`soffice`) — required only for legacy `.doc` uploads

Install the system dependencies:

```bash
# Debian/Ubuntu
sudo apt-get update
sudo apt-get install -y poppler-utils tesseract-ocr tesseract-ocr-ben unzip libreoffice

# macOS (Homebrew)
brew install poppler tesseract tesseract-lang libreoffice
```

**SutonnyMJ font (optional, for the in-browser preview only):** SutonnyMJ is
a commercially-distributed font and is *not* bundled with this app. If it's
installed on your machine, the "Bijoy / SutonnyMJ" preview tab and the
downloaded `.docx` will render as proper Bengali glyphs; without it, the
preview falls back to your system font and looks like mojibake — this is
expected and does **not** mean the conversion failed (check the "Unicode"
tab, or open the `.docx` on a machine that has SutonnyMJ, to confirm). The
`.docx` file always has its font set to `SutonnyMJ` in the document itself,
so it will display correctly for any recipient who has the font, exactly
like any legacy Bijoy document.

## Setup

### 1. Backend

```bash
cd backend
cp .env.example .env      # adjust PORT / CORS_ORIGIN if needed
npm install
npm test                  # run the Unicode→Bijoy conversion test suite
npm run dev                # starts on http://localhost:4000
```

For production:

```bash
npm run build
npm start
```

### 2. Frontend

```bash
cd frontend
cp .env.example .env      # set VITE_API_BASE_URL if the backend isn't on localhost:4000
npm install
npm run dev                # starts on http://localhost:5173
```

For production:

```bash
npm run build              # outputs static files to frontend/dist
npm run preview            # serve the production build locally to check it
```

Deploy `frontend/dist` to any static host (it just needs to reach the
backend's `/api/*` routes over HTTP).

## API

- `POST /api/convert` — multipart `file` field (`.pdf`, `.docx` or `.doc`).
  Streams Server-Sent Events (`event: progress` for each step, then
  `event: done` with the result or `event: error`). Steps: `uploading →
  extracting → ocr (if needed) → converting → creating_document → ready`.
  The `done` payload includes both flattened `unicodeText`/`bijoyText`
  strings (for preview/copy) and a structured `blocks` array (paragraphs +
  tables, with alignment/indentation/heading/list metadata, already
  Bijoy-converted) for layout-faithful export.
- `POST /api/export/docx` — JSON body `{ blocks?, bijoyText?, title? }`.
  `blocks` (from `/api/convert`) is preferred and preserves the original
  layout; `bijoyText` alone is accepted as a fallback and wrapped into plain
  paragraphs. Returns a `.docx` file with the SutonnyMJ font applied to
  every run.
- `GET /api/health` — liveness check.

## Error handling

The backend returns a machine-readable `code` plus a user-friendly message
for: invalid/corrupt files, password-protected PDFs, empty documents,
documents with no Bengali text, files over 20MB, unsupported file types,
missing poppler/tesseract/LibreOffice/unzip binaries, and unexpected
conversion failures. A global `uncaughtException` / `unhandledRejection`
handler keeps a single failed request from crashing the whole server
process.

## Privacy & security

- Uploaded files (and any intermediate files, e.g. a `.doc`→`.docx`
  conversion or OCR page images) are written to a temp directory
  (`backend/tmp`) and deleted immediately after processing, including on
  every error path.
- Uploads are validated by both MIME type and extension, capped at 20MB, and
  rate-limited (30 requests / 15 min / IP) since PDF/OCR/LibreOffice
  processing is CPU-intensive.
- Nothing is persisted to a database; there is none.

## Known limitations

- **PDF layout reconstruction is heuristic, not exact.** Wrapped lines,
  indentation, centered headings and simple bullet lists are recovered from
  `pdftotext -layout`'s column positions, which works well for typical
  single-column documents but is not pixel-perfect. Complex multi-column
  layouts and PDF tables (as opposed to DOCX tables, which are read exactly)
  are not reconstructed and will come through as plain paragraphs.
- **DOCX/DOC structure is read exactly** (alignment, indentation, headings,
  lists via `w:numPr` or common list style names, bold/italic, tables) since
  it's parsed directly from Word's own XML — this is the highest-fidelity
  input path.
- **OCR output has no layout information.** Scanned PDFs are rejoined into
  flowing paragraphs (no forced line breaks) but indentation, headings and
  lists can't be recovered from OCR text alone.
- **OCR accuracy** depends on scan quality; always check the preview before
  downloading a scanned document's conversion.
- **Legacy ANSI encoding is inherently ambiguous with plain ASCII** — Bijoy
  fonts reuse ordinary Latin byte codes to draw Bengali glyphs, which is why
  Bijoy documents must always travel together with the correct font. This
  is a property of the 30-year-old Bijoy encoding itself, not a bug in this
  converter.

## Testing

```bash
cd backend
npm test
```

Verifies all required sample words (আমি বাংলা লিখি।, বাংলাদেশ, শিক্ষা,
প্রযুক্তি, স্বাধীনতা, প্রয়োজন, শ্রদ্ধা, ক্ষুদ্র, ব্যক্তিত্ব, কম্পিউটার,
উন্নয়ন) plus edge cases (ড়/ঢ়/য়, reph+phala combinations, mixed
English/Bengali/numeral text, multi-paragraph input) convert with zero
leftover Unicode characters, and round-trips them back through an
independent reverse converter to cross-check correctness.
#   u n i c o d e _ t o _ b i j o y  
 