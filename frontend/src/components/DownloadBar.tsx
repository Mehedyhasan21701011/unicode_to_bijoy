import { useState } from "react";
import { downloadDocx, downloadTxt, ApiRequestError } from "../api";

export function DownloadBar({
  bijoyText,
  fileTitle,
  blocks,
}: {
  bijoyText: string;
  fileTitle: string;
  blocks?: unknown[];
}) {
  const [isExportingDocx, setIsExportingDocx] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleDocx = async () => {
    setExportError(null);
    setIsExportingDocx(true);
    try {
      await downloadDocx(bijoyText, fileTitle, blocks);
    } catch (err) {
      setExportError(err instanceof ApiRequestError ? err.message : "Failed to create the DOCX file.");
    } finally {
      setIsExportingDocx(false);
    }
  };

  return (
    <div className="animate-slide-up">
      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={handleDocx}
          disabled={isExportingDocx}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isExportingDocx ? (
            <>
              <Spinner /> তৈরি হচ্ছে...
            </>
          ) : (
            <>
              <DocIcon /> Download DOCX
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() => downloadTxt(bijoyText, fileTitle)}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-ink-900 transition-colors hover:bg-slate-50"
        >
          <TxtIcon /> Download TXT
        </button>
      </div>
      {exportError && (
        <p className="mt-3 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-700">{exportError}</p>
      )}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-red-100 bg-red-50 p-6 text-center shadow-card animate-slide-up">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-6 w-6 text-red-600">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
      </div>
      <p className="text-sm font-medium text-red-800">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50"
      >
        আবার চেষ্টা করুন · Try again
      </button>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-4 w-4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 20h12a2 2 0 002-2V7.414a1 1 0 00-.293-.707l-4.414-4.414A1 1 0 0014.586 2H6a2 2 0 00-2 2v14a2 2 0 002 2z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6m-6 3h4" />
    </svg>
  );
}

function TxtIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-4 w-4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 12l-4-4m4 4l4-4M4 20h16" />
    </svg>
  );
}
