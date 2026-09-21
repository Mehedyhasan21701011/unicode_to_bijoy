import { useCallback, useRef, useState } from "react";
import { UploadArea, SelectedFileCard } from "./components/UploadArea";
import { ProgressSteps } from "./components/ProgressSteps";
import { PreviewPane } from "./components/PreviewPane";
import { DownloadBar, ErrorBanner } from "./components/DownloadBar";
import { convertDocument, ApiRequestError } from "./api";
import type { AppStatus, ProgressStep } from "./types";

// How long (ms) to wait for the first SSE event before showing the
// "server is waking up" message. Render free-tier cold starts can take
// 30–60 seconds. We show the notice early (8s) so the user doesn't cancel.
const COLD_START_NOTICE_DELAY_MS = 8_000;

export default function App() {
  const [status, setStatus] = useState<AppStatus>({ kind: "idle" });
  const [everSawOcr, setEverSawOcr] = useState(false);
  // Ref to the cold-start timer so we can cancel it on first SSE event.
  const coldStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    if (coldStartTimerRef.current) {
      clearTimeout(coldStartTimerRef.current);
      coldStartTimerRef.current = null;
    }
    setStatus({ kind: "idle" });
    setEverSawOcr(false);
  }, []);

  const handleFileSelected = useCallback((file: File) => {
    setStatus({ kind: "file_selected", file });
  }, []);

  const handleConvert = useCallback(async (file: File) => {
    setEverSawOcr(false);
    setStatus({ kind: "processing", file, step: "uploading", stepMessage: "Uploading…" });

    // Start the cold-start timer. If we don't get any SSE event within
    // COLD_START_NOTICE_DELAY_MS, flip wakingUp=true so the UI shows a notice.
    let receivedFirstEvent = false;
    coldStartTimerRef.current = setTimeout(() => {
      if (!receivedFirstEvent) {
        setStatus((prev) =>
          prev.kind === "processing"
            ? { ...prev, wakingUp: true }
            : prev
        );
      }
    }, COLD_START_NOTICE_DELAY_MS);

    try {
      const result = await convertDocument(file, (event) => {
        // Cancel the cold-start timer on the first real SSE event.
        if (!receivedFirstEvent) {
          receivedFirstEvent = true;
          if (coldStartTimerRef.current) {
            clearTimeout(coldStartTimerRef.current);
            coldStartTimerRef.current = null;
          }
        }
        if (event.step === "ocr") setEverSawOcr(true);
        setStatus({ kind: "processing", file, step: event.step, stepMessage: event.message });
      });
      setStatus({ kind: "done", file, result });
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setStatus({ kind: "error", file, error: { message: err.message, code: err.code } });
      } else {
        setStatus({
          kind: "error",
          file,
          error: { message: "An unexpected error occurred. Please try again.", code: "UNKNOWN" },
        });
      }
    } finally {
      if (coldStartTimerRef.current) {
        clearTimeout(coldStartTimerRef.current);
        coldStartTimerRef.current = null;
      }
    }
  }, []);


  return (
    <div className="min-h-screen bg-slate-50">
      <Header />
      <main className="mx-auto max-w-2xl px-4 pb-24 pt-10 sm:pt-16">
        <Hero />

        <div className="mt-8 flex flex-col gap-5">
          {status.kind === "idle" && <UploadArea onFileSelected={handleFileSelected} />}

          {status.kind === "file_selected" && (
            <>
              <SelectedFileCard file={status.file} onRemove={reset} />
              <button
                type="button"
                onClick={() => handleConvert(status.file)}
                className="w-full rounded-xl bg-indigo-600 px-5 py-3.5 text-base font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700"
              >
                Convert to Bijoy
              </button>
            </>
          )}

          {status.kind === "processing" && (
            <>
              <SelectedFileCard file={status.file} onRemove={() => {}} disabled />
              <ProgressSteps
                currentStep={status.step as ProgressStep}
                stepMessage={status.stepMessage}
                skipOcr={!everSawOcr && status.step !== "ocr"}
              />
              {status.wakingUp && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <span className="font-semibold">সার্ভার চালু হচ্ছে…</span>
                  {" "}The server is waking up from idle — this can take up to a minute on the free plan.
                  Please wait, your file will process automatically once it's ready.
                </div>
              )}
            </>
          )}

          {status.kind === "error" && (
            <ErrorBanner message={status.error.message} onRetry={reset} />
          )}

          {status.kind === "done" && (
            <>
              <SelectedFileCard file={status.file} onRemove={reset} />
              {status.result.usedOcr && (
                <p className="rounded-lg bg-indigo-50 px-4 py-2.5 text-sm text-indigo-800">
                  এই PDF-এ কোনো এম্বেডেড টেক্সট ছিল না, তাই OCR ব্যবহার করা হয়েছে। This PDF had no
                  reliable embedded text, so Bengali OCR was used to read it — double-check the
                  preview for accuracy.
                </p>
              )}
              <PreviewPane
                unicodeText={status.result.unicodeText}
                bijoyText={status.result.bijoyText}
                fullyConverted={status.result.fullyConverted}
                unconvertedChars={status.result.unconvertedChars}
              />
              <DownloadBar
                bijoyText={status.result.bijoyText}
                blocks={status.result.blocks}
                fileTitle={status.file.name.replace(/\.(pdf|docx|doc)$/i, "")}
              />
              <button
                type="button"
                onClick={reset}
                className="mx-auto text-sm font-medium text-ink-500 transition-colors hover:text-ink-900"
              >
                নতুন ফাইল রূপান্তর করুন · Convert another file
              </button>
            </>
          )}
        </div>

        <PrivacyNote />
      </main>
    </div>
  );
}

function Header() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={1.75} className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h8m-8 4h8m-8 4h5M6 20h12a2 2 0 002-2V7.414a1 1 0 00-.293-.707l-4.414-4.414A1 1 0 0014.586 2H6a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        </div>
        <span className="text-base font-semibold tracking-tight text-ink-900">Bijoy Converter</span>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <div className="text-center">
      <h1 className="font-bengali text-3xl font-semibold text-ink-900 sm:text-4xl">
        Bijoy Converter
      </h1>
      <p className="mt-3 text-base text-ink-500">
        Convert Bengali PDF, DOCX or DOC text from Unicode to Bijoy (SutonnyMJ) format
      </p>
    </div>
  );
}

function PrivacyNote() {
  return (
    <p className="mt-10 text-center text-xs leading-relaxed text-ink-500">
      আপলোড করা ফাইল সাময়িকভাবে প্রসেস করা হয় এবং প্রক্রিয়া শেষে স্থায়ীভাবে মুছে ফেলা হয় — কোনো ফাইল
      সংরক্ষণ করা হয় না।
      <br />
      Your file is processed temporarily and permanently deleted afterward — nothing is stored.
    </p>
  );
}
