"use strict";
/**
 * Unicode Bengali -> Bijoy ANSI (SutonnyMJ-compatible) converter.
 *
 * This performs an actual encoding conversion (glyph reordering, phala/reph
 * handling, conjunct mapping) rather than a naive character substitution or
 * a simple font swap.
 *
 * Engine: @codesigntheory/bnunicode2ansi (MIT licensed), which implements the
 * classical Avro/Bijoy-style regex-based reordering algorithm:
 *   - iKar/eKar/oKar are moved BEFORE the consonant cluster they visually
 *     precede on screen (matching how legacy ANSI fonts draw glyphs).
 *   - Reph (র্ at the start of a cluster) is deferred and appended as "©"
 *     after the cluster it attaches to.
 *   - Ya-phala (্য), Ra-phala (্র) and dozens of hard-coded conjunct
 *     (যুক্তাক্ষর) ligatures are mapped to their single/compound glyph
 *     codes used by SutonnyMJ/Bijoy fonts.
 *
 * We wrap that engine with:
 *   1. Pre-normalization: some PDF/OCR text represents nukta letters
 *      (ড়, ঢ়, য়) in *decomposed* form (base consonant + U+09BC nukta).
 *      Unicode's own NFC normalization does NOT recompose these (Bengali
 *      nukta letters are on the Composition Exclusion list), so we do it
 *      ourselves. Without this step the nukta is left behind as a stray,
 *      un-mapped Unicode character in the output.
 *   2. Danda / punctuation normalization (। -> |, and Bengali-specific
 *      quote/space edge cases) that the upstream engine's matching regex
 *      does not include.
 *   3. Typographic-punctuation normalization: Word's autocorrect commonly
 *      turns a plain quote/hyphen into a curly quote (“ ” ‘ ’), an em/en
 *      dash (— –), or an ellipsis (…) - and inserts non-breaking spaces
 *      (U+00A0). SutonnyMJ (like every legacy Bijoy font) only defines
 *      glyphs for the single-byte 0x00-0xFF range, so these Unicode
 *      codepoints have literally no possible glyph and always render as a
 *      broken/fallback-font character. We normalize them to their plain
 *      ASCII equivalents, which the engine already passes through
 *      correctly (verified by round-tripping through the companion
 *      @codesigntheory/bnbijoy2unicode reverse converter).
 *   4. Zero-width joiner/non-joiner (ZWJ/ZWNJ, U+200D/U+200C) stripping.
 *      Bengali sometimes uses ZWNJ to force an "unjoined" conjunct
 *      rendering, but the underlying engine has no concept of Unicode
 *      joiner controls (legacy Bijoy typists produced that effect with an
 *      entirely different keystroke, not a joiner character) and mishandles
 *      them, injecting a stray literal "&" into the output. Stripping them
 *      trades a rare, subtle typographic nuance for guaranteed correctness.
 *   5. Whitespace/paragraph-preserving line-by-line conversion, so blank
 *      lines and paragraph breaks from the source PDF survive conversion.
 *   6. A post-conversion audit that flags any leftover Bengali Unicode
 *      codepoints (U+0980-U+09FF) that the engine failed to map, so callers
 *      can surface a "partial conversion" warning instead of silently
 *      shipping broken output. This check is intentionally scoped to the
 *      Bengali block only: the engine's own correct output legitimately
 *      contains codepoints above U+00FF (e.g. U+2021 "‡"), because it
 *      represents SutonnyMJ's high-byte (0x80-0x9F) glyphs using their
 *      Windows-1252 Unicode equivalents - so a broader "anything above
 *      U+00FF is suspicious" check can't distinguish real engine output
 *      from a genuinely leaked-through bad character. That's why step 3
 *      normalizes known-problematic typographic punctuation *before*
 *      conversion instead of trying to catch it after the fact.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isUnicodeBengali = isUnicodeBengali;
exports.bengaliDensity = bengaliDensity;
exports.unicodeToBijoy = unicodeToBijoy;
exports.convertBlocks = convertBlocks;
const bnunicode2ansi_1 = require("@codesigntheory/bnunicode2ansi");
const docModel_1 = require("../model/docModel");
// Bengali Unicode block: U+0980 - U+09FF
const BENGALI_BLOCK_REGEX = /[\u0980-\u09FF]/;
const BENGALI_BLOCK_GLOBAL_REGEX = /[\u0980-\u09FF]/g;
/**
 * Recompose decomposed nukta sequences into their precomposed Bengali
 * codepoints. This must run before the main conversion engine.
 */
function normalizeNukta(text) {
    return text
        .replace(/\u09A1\u09BC/g, "\u09DC") // ড + ় -> ড়
        .replace(/\u09A2\u09BC/g, "\u09DD") // ঢ + ় -> ঢ়
        .replace(/\u09AF\u09BC/g, "\u09DF"); // য + ় -> য়
}
/**
 * Normalize punctuation/whitespace quirks before running the conjunct
 * engine.
 */
function normalizePunctuation(text) {
    return (text
        // Bengali sentence-ending "danda" -> ASCII pipe glyph used by legacy fonts
        .replace(/।/g, "|")
        // Double danda (used at end of verses) -> double pipe
        .replace(/॥/g, "||")
        // Curly/typographic quotes -> straight ASCII quotes. Confirmed via the
        // companion bnbijoy2unicode reverse converter that a plain ASCII quote
        // round-trips correctly; a curly quote (U+2018/2019/201C/201D) has no
        // possible glyph in a single-byte legacy font and always breaks.
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2018\u2019]/g, "'")
        // Em dash / en dash -> plain hyphen (same reasoning: no single-byte glyph exists).
        .replace(/[\u2013\u2014]/g, "-")
        // Ellipsis character -> three literal dots.
        .replace(/\u2026/g, "...")
        // Non-breaking space -> normal space.
        .replace(/\u00A0/g, " ")
        // Zero-width joiner/non-joiner: the engine has no concept of Unicode
        // joiner controls and mishandles them (produces stray characters), so
        // strip them rather than let them corrupt the surrounding conjunct.
        .replace(/[\u200C\u200D]/g, "")
        // Strip zero-width space / BOM noise.
        .replace(/[\u200B\uFEFF]/g, ""));
}
/**
 * Detects whether a string contains Unicode Bengali script characters.
 */
function isUnicodeBengali(text) {
    return BENGALI_BLOCK_REGEX.test(text);
}
/**
 * Returns the fraction (0-1) of non-whitespace characters in the text that
 * fall inside the Bengali Unicode block. Useful for deciding whether a PDF
 * is "meaningfully" Bengali vs. just containing a stray Bengali character.
 */
function bengaliDensity(text) {
    const stripped = text.replace(/\s/g, "");
    if (stripped.length === 0)
        return 0;
    const bengaliChars = stripped.match(BENGALI_BLOCK_GLOBAL_REGEX);
    return (bengaliChars ? bengaliChars.length : 0) / stripped.length;
}
/**
 * Converts a single line/segment of Unicode Bengali text to Bijoy ANSI.
 * Non-Bengali text (English words, numbers already in ASCII, punctuation)
 * passes through untouched, exactly as legacy Bijoy documents mix scripts.
 */
function convertSegment(segment) {
    // Standard Unicode NFC normalization first: some sources (older editors,
    // copy-paste chains, certain OCR output) store two-part vowel signs like
    // "ো" (O-kar) or "ৌ" (AU-kar) in their decomposed form (e-kar + aa-kar,
    // or e-kar + vocalic-l-like sign) instead of the single precomposed
    // codepoint. NFC recomposes these correctly. This must run before the
    // nukta step below, which handles a *different* class of Bengali
    // sequences that Unicode's own Composition Exclusion list prevents NFC
    // from recomposing.
    const nfc = segment.normalize("NFC");
    const normalized = normalizePunctuation(normalizeNukta(nfc));
    return (0, bnunicode2ansi_1.bnUnicode2ANSI)(normalized);
}
/**
 * Converts Unicode Bengali text (potentially multi-paragraph) into Bijoy
 * ANSI text compatible with the SutonnyMJ font, preserving paragraph and
 * line breaks exactly as they appear in the input.
 */
function unicodeToBijoy(text) {
    // Split preserving the exact newline structure so paragraph breaks survive.
    const lines = text.split("\n");
    const convertedLines = lines.map((line) => convertSegment(line));
    const bijoyText = convertedLines.join("\n");
    const leftover = bijoyText.match(BENGALI_BLOCK_GLOBAL_REGEX);
    const unconvertedChars = leftover ? Array.from(new Set(leftover)) : [];
    return {
        bijoyText,
        fullyConverted: unconvertedChars.length === 0,
        unconvertedChars,
    };
}
/**
 * Converts every run of text inside a structured document (paragraphs and
 * table cells) to Bijoy ANSI, leaving every other property (alignment,
 * indentation, heading level, bold/italic, table shape) untouched. This is
 * what preserves layout end-to-end: the structure is built once during
 * extraction and only the text inside it is ever rewritten.
 */
function convertBlocks(blocks) {
    const unconvertedChars = new Set();
    const convertRun = (run) => {
        const bijoyText = run.text
            .split("\n")
            .map((line) => convertSegment(line))
            .join("\n");
        const leftover = bijoyText.match(BENGALI_BLOCK_GLOBAL_REGEX);
        if (leftover)
            leftover.forEach((c) => unconvertedChars.add(c));
        return { ...run, text: bijoyText };
    };
    const convertedBlocks = blocks.map((block) => {
        if ((0, docModel_1.isTableBlock)(block)) {
            return {
                kind: "table",
                rows: block.rows.map((row) => row.map((cell) => ({
                    paragraphs: cell.paragraphs.map((runs) => runs.map(convertRun)),
                }))),
            };
        }
        return { ...block, runs: block.runs.map(convertRun) };
    });
    return {
        blocks: convertedBlocks,
        fullyConverted: unconvertedChars.size === 0,
        unconvertedChars: Array.from(unconvertedChars),
    };
}
//# sourceMappingURL=unicodeToBijoy.js.map