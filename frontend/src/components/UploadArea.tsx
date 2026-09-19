import { useCallback, useRef, useState } from "react";

const MAX_FILE_SIZE_MB = 20;
const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".doc"];
const ACCEPTED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
];

interface UploadAreaProps {
  onFileSelected: (file: File) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadArea({ onFileSelected }: UploadAreaProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateAndSelect = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
      const isAccepted = ACCEPTED_MIME_TYPES.includes(file.type) || ACCEPTED_EXTENSIONS.includes(ext);
      if (!isAccepted) {
        setValidationError(
          "শুধুমাত্র PDF, DOCX ও DOC ফাইল সমর্থিত। Only .pdf, .docx and .doc files are supported."
        );
        return;
      }
      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        setValidationError(
          `ফাইলটি অনেক বড়। সর্বোচ্চ ${MAX_FILE_SIZE_MB}MB অনুমোদিত। File exceeds the ${MAX_FILE_SIZE_MB}MB limit.`
        );
        return;
      }
      setValidationError(null);
      onFileSelected(file);
    },
    [onFileSelected]
  );

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          validateAndSelect(e.dataTransfer.files?.[0]);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        className={`group cursor-pointer rounded-2xl border-2 border-dashed transition-colors
          ${isDragging ? "border-indigo-500 bg-indigo-50" : "border-slate-300 bg-white hover:border-indigo-400 hover:bg-indigo-50/40"}
          flex flex-col items-center justify-center gap-3 px-8 py-14 text-center`}
      >
        <div
          className={`flex h-14 w-14 items-center justify-center rounded-full transition-colors
            ${isDragging ? "bg-indigo-500" : "bg-indigo-100 group-hover:bg-indigo-500"}`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            className={`h-7 w-7 transition-colors ${isDragging ? "text-white" : "text-indigo-600 group-hover:text-white"}`}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0L7 9m5-5l5 5" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
          </svg>
        </div>
        <div>
          <p className="text-base font-medium text-ink-900">
            PDF, DOCX বা DOC ফাইল টেনে আনুন বা ক্লিক করুন
          </p>
          <p className="mt-1 text-sm text-ink-500">
            Drag & drop your Bengali PDF, DOCX or DOC file here, or click to browse
          </p>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            inputRef.current?.click();
          }}
          className="mt-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700"
        >
          Upload File
        </button>
        <p className="text-xs text-ink-500">Max {MAX_FILE_SIZE_MB}MB · .pdf, .docx, .doc</p>
        <input
          ref={inputRef}
          type="file"
          accept={[...ACCEPTED_MIME_TYPES, ...ACCEPTED_EXTENSIONS].join(",")}
          className="hidden"
          onChange={(e) => validateAndSelect(e.target.files?.[0])}
        />
      </div>
      {validationError && (
        <p className="mt-3 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-700 animate-fade-in">
          {validationError}
        </p>
      )}
    </div>
  );
}

export function SelectedFileCard({
  file,
  onRemove,
  disabled,
}: {
  file: File;
  onRemove: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-card animate-slide-up">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            className="h-5 w-5 text-indigo-600"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6M9 8h1M6 20h12a2 2 0 002-2V7.414a1 1 0 00-.293-.707l-4.414-4.414A1 1 0 0014.586 2H6a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink-900">{file.name}</p>
          <p className="text-xs text-ink-500">{formatFileSize(file.size)}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label="Remove file"
        className="shrink-0 rounded-lg p-2 text-ink-500 transition-colors hover:bg-slate-100 hover:text-ink-900 disabled:opacity-40"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
