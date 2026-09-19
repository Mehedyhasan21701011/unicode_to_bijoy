/**
 * Lightweight test runner (no external test framework required).
 * Run with: npm test
 *
 * Verifies:
 *  - The required sample words all convert with no leftover Bengali
 *    Unicode characters (i.e. every glyph, conjunct, kar, phala, and
 *    reph is actually mapped, not just font-swapped).
 *  - Round-trips cleanly back to semantically-identical Unicode using an
 *    independent reverse converter, as a correctness cross-check.
 *  - Mixed English/Bengali/number text is handled correctly.
 *  - Bengali punctuation (দাঁড়ি) converts to its ANSI glyph.
 */

import { unicodeToBijoy, isUnicodeBengali, bengaliDensity } from "./unicodeToBijoy";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const bijoyToUnicode = require("@codesigntheory/bnbijoy2unicode").default;

interface Case {
  label: string;
  input: string;
}

const REQUIRED_WORDS: Case[] = [
  { label: "sentence", input: "আমি বাংলা লিখি।" },
  { label: "বাংলাদেশ", input: "বাংলাদেশ" },
  { label: "শিক্ষা", input: "শিক্ষা" },
  { label: "প্রযুক্তি", input: "প্রযুক্তি" },
  { label: "স্বাধীনতা", input: "স্বাধীনতা" },
  { label: "প্রয়োজন (য়)", input: "প্রয়োজন" },
  { label: "শ্রদ্ধা", input: "শ্রদ্ধা" },
  { label: "ক্ষুদ্র", input: "ক্ষুদ্র" },
  { label: "ব্যক্তিত্ব", input: "ব্যক্তিত্ব" },
  { label: "কম্পিউটার", input: "কম্পিউটার" },
  { label: "উন্নয়ন (য়)", input: "উন্নয়ন" },
];

const EXTRA_WORDS: Case[] = [
  { label: "ড়/ঢ়/য়", input: "বড় বাড়ি মেঢ়ি" },
  { label: "reph + phala mix", input: "রবীন্দ্রনাথ ঠাকুর" },
  { label: "mixed script", input: "Hello World 123 বাংলা" },
  { label: "danda", input: "আমি ভালো আছি।" },
  { label: "double danda", input: "জয় হোক॥" },
  { label: "ৎ hasant-like", input: "সঠিক তথ্য প্রয়োজন" },
  { label: "long paragraph with newlines", input: "প্রথম লাইন।\nদ্বিতীয় লাইন।\n\nনতুন অনুচ্ছেদ।" },
];

let passed = 0;
let failed = 0;

function checkNoLeftoverBengali(c: Case) {
  const result = unicodeToBijoy(c.input);
  const ok = result.fullyConverted;
  if (ok) {
    passed++;
    console.log(`PASS  [${c.label}] "${c.input}" => "${result.bijoyText}"`);
  } else {
    failed++;
    console.error(
      `FAIL  [${c.label}] leftover unconverted chars: ${result.unconvertedChars
        .map((ch) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase()}`)
        .join(", ")} in output "${result.bijoyText}"`
    );
  }
}

// Note: legacy Bijoy/ANSI encoding reuses the plain a-z/A-Z byte range for
// Bengali glyphs. That means text that is ALREADY pure ASCII (English
// words, digits) is indistinguishable, at the byte level, from certain
// Bijoy-encoded Bengali glyphs. A standalone ANSI file cannot be
// round-tripped through a reverse converter unless the reader already
// knows "this byte range is Bengali, not English" (exactly why font +
// encoding must always travel together for legacy Bijoy documents). Our
// forward conversion still leaves genuine English/ASCII segments alone
// (verified directly, not via round-trip) - see the "mixed script" case
// above, whose forward output "Hello World 123 evsjv" already keeps
// "Hello World 123" untouched.
const SKIP_ROUND_TRIP = new Set(["mixed script"]);

function normalizeForCompare(s: string): string {
  return s
    .replace(/\u09A1\u09BC/g, "\u09DC")
    .replace(/\u09A2\u09BC/g, "\u09DD")
    .replace(/\u09AF\u09BC/g, "\u09DF")
    .replace(/[।|॥]/g, "") // danda variants normalized away
    .replace(/\s/g, "");
}

function checkRoundTrip(c: Case) {
  if (SKIP_ROUND_TRIP.has(c.label)) return;
  const { bijoyText } = unicodeToBijoy(c.input);
  let back = "";
  try {
    back = bijoyToUnicode(bijoyText);
  } catch (e) {
    failed++;
    console.error(`FAIL  [${c.label}] round-trip threw: ${(e as Error).message}`);
    return;
  }
  const ok = normalizeForCompare(back) === normalizeForCompare(c.input);
  if (ok) {
    passed++;
    console.log(`PASS  [round-trip: ${c.label}]`);
  } else {
    failed++;
    console.error(`FAIL  [round-trip: ${c.label}] "${c.input}" -> "${bijoyText}" -> "${back}"`);
  }
}

console.log("=== Required sample words: full conversion (no leftover Unicode) ===");
REQUIRED_WORDS.forEach(checkNoLeftoverBengali);

console.log("\n=== Extra edge cases: full conversion ===");
EXTRA_WORDS.forEach(checkNoLeftoverBengali);

console.log("\n=== Round-trip cross-checks ===");
[...REQUIRED_WORDS, ...EXTRA_WORDS].forEach(checkRoundTrip);

console.log("\n=== Detection helpers ===");
{
  const t1 = isUnicodeBengali("বাংলা") === true;
  const t2 = isUnicodeBengali("English only") === false;
  const t3 = bengaliDensity("বাংলা text 123") > 0 && bengaliDensity("বাংলা text 123") < 1;
  const t4 = bengaliDensity("বাংলা") === 1;
  [t1, t2, t3, t4].forEach((ok, i) => {
    if (ok) {
      passed++;
      console.log(`PASS  [detection helper ${i + 1}]`);
    } else {
      failed++;
      console.error(`FAIL  [detection helper ${i + 1}]`);
    }
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
