import { useState } from "react";

type PreviewMode = "unicode" | "bijoy";

export function PreviewPane({
  unicodeText,
  bijoyText,
  fullyConverted,
  unconvertedChars,
}: {
  unicodeText: string;
  bijoyText: string;
  fullyConverted: boolean;
  unconvertedChars: string[];
}) {
  const [mode, setMode] = useState<PreviewMode>("bijoy");
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(bijoyText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-card animate-slide-up">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setMode("unicode")}
            className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors
              ${mode === "unicode" ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-900"}`}
          >
            Unicode
          </button>
          <button
            type="button"
            onClick={() => setMode("bijoy")}
            className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors
              ${mode === "bijoy" ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-900"}`}
          >
            Bijoy / SutonnyMJ
          </button>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-ink-700 transition-colors hover:bg-slate-50"
        >
          {copied ? (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4 text-green-600">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-4 w-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 4h8a2 2 0 012 2v8a2 2 0 01-2 2h-8a2 2 0 01-2-2v-8a2 2 0 012-2z" />
              </svg>
              Copy Bijoy Text
            </>
          )}
        </button>
      </div>

      {!fullyConverted && (
        <div className="mx-5 mt-4 rounded-lg bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          কিছু অক্ষর রূপান্তর করা যায়নি। Some characters could not be converted
          {unconvertedChars.length > 0 && (
            <>
              {" "}
              (
              {unconvertedChars
                .map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase()}`)
                .join(", ")}
              )
            </>
          )}
          .
        </div>
      )}

      <div className="p-5">
        <pre
          lang="bn"
          spellCheck={false}
          className={`max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-4 text-[15px] leading-relaxed
            ${mode === "bijoy" ? "font-bijoy-preview" : "font-bengali"}`}
        >
          {mode === "bijoy" ? bijoyText : unicodeText}
        </pre>
        {mode === "bijoy" && (
          <p className="mt-2 text-xs text-ink-500">
            এই প্রিভিউ সঠিকভাবে দেখতে আপনার কম্পিউটারে SutonnyMJ ফন্ট ইনস্টল থাকা প্রয়োজন। This preview
            renders correctly only if SutonnyMJ is installed on your device — the downloaded DOCX
            will display correctly for any recipient who also has the font.
          </p>
        )}
      </div>
    </div>
  );
}
