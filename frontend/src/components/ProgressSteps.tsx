import type { ProgressStep } from "../types";

const STEPS: { key: ProgressStep; label: string; labelBn: string }[] = [
  { key: "uploading", label: "Uploading", labelBn: "আপলোড হচ্ছে" },
  { key: "extracting", label: "Extracting Text", labelBn: "টেক্সট বের করা হচ্ছে" },
  { key: "ocr", label: "OCR", labelBn: "ওসিআর" },
  { key: "converting", label: "Converting to Bijoy", labelBn: "বিজয়-এ রূপান্তর" },
  { key: "creating_document", label: "Preparing Preview", labelBn: "প্রিভিউ তৈরি হচ্ছে" },
  { key: "ready", label: "Ready", labelBn: "প্রস্তুত" },
];

export function ProgressSteps({
  currentStep,
  stepMessage,
  skipOcr,
}: {
  currentStep: ProgressStep;
  stepMessage: string;
  /** Hide the OCR step visually when the current PDF didn't need it. */
  skipOcr: boolean;
}) {
  const visibleSteps = skipOcr ? STEPS.filter((s) => s.key !== "ocr") : STEPS;
  const currentIndex = visibleSteps.findIndex((s) => s.key === currentStep);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card animate-slide-up">
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {visibleSteps.map((step, idx) => {
          const state = idx < currentIndex ? "done" : idx === currentIndex ? "active" : "pending";
          return (
            <div key={step.key} className="flex items-center gap-2 shrink-0">
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-colors
                    ${state === "done" ? "bg-indigo-600 text-white" : ""}
                    ${state === "active" ? "bg-indigo-600 text-white animate-pulse" : ""}
                    ${state === "pending" ? "bg-slate-100 text-ink-500" : ""}`}
                >
                  {state === "done" ? (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    idx + 1
                  )}
                </div>
                <span className={`whitespace-nowrap text-[11px] font-medium ${state === "pending" ? "text-ink-500" : "text-ink-900"}`}>
                  {step.label}
                </span>
              </div>
              {idx < visibleSteps.length - 1 && (
                <div className={`h-0.5 w-6 shrink-0 rounded ${idx < currentIndex ? "bg-indigo-600" : "bg-slate-200"}`} />
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-sm text-ink-700">{stepMessage}</p>
    </div>
  );
}
