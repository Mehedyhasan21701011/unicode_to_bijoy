import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import { execFile } from "child_process";
import { promisify } from "util";
import { convertRouter } from "./routes/convert";
import { exportRouter } from "./routes/export";
import { cleanupOldTempFiles } from "./utils/cleanup";
import { TMP_DIR } from "./middleware/upload";

dotenv.config();

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Binary health check
// ---------------------------------------------------------------------------
// Checks that all required system binaries are present and logs a loud,
// actionable error if any are missing. This surfaces the class of "ENOENT
// because poppler/tesseract/soffice isn't installed" failures at startup
// time rather than silently failing on the first real upload.
//
// Required binaries:
//   pdftotext  — poppler-utils: PDF text/layout extraction
//   pdfinfo    — poppler-utils: PDF page count
//   pdftoppm   — poppler-utils: PDF rasterization for OCR
//   tesseract  — tesseract-ocr: OCR engine
//   soffice    — libreoffice-writer: .doc → .docx conversion
//
// On Render's Docker service these are installed via the Dockerfile.
// On Render's native Node runtime they are NOT available — switch to Docker.
// ---------------------------------------------------------------------------

interface BinaryStatus {
  binary: string;
  ok: boolean;
  version?: string;
  error?: string;
}

// Cached result from the startup check so /api/health doesn't re-probe on
// every request (probing soffice is slow).
let cachedBinaryStatuses: BinaryStatus[] | null = null;

async function checkBinary(
  binary: string,
  args: string[]
): Promise<BinaryStatus> {
  try {
    const { stdout, stderr } = await execFileAsync(binary, args, {
      timeout: 10_000,
      encoding: "utf8",
    });
    const version = (stdout || stderr).split("\n")[0].trim().slice(0, 120);
    return { binary, ok: true, version };
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return {
        binary,
        ok: false,
        error: `Not found (ENOENT). Is it installed? On Render: use the Docker service type and install via apt-get in the Dockerfile.`,
      };
    }
    // Some binaries (e.g. soffice --version) exit with non-zero but still
    // print a version string — treat that as present.
    const output = (err.stdout || err.stderr || err.message || "").split("\n")[0].trim();
    if (output) {
      return { binary, ok: true, version: output.slice(0, 120) };
    }
    return { binary, ok: false, error: String(err.message || err).slice(0, 200) };
  }
}

async function checkAllBinaries(): Promise<BinaryStatus[]> {
  const checks: Array<{ binary: string; args: string[] }> = [
    { binary: "pdftotext", args: ["-v"] },
    { binary: "pdfinfo",   args: ["-v"] },
    { binary: "pdftoppm",  args: ["-v"] },
    { binary: "tesseract", args: ["--version"] },
    { binary: "soffice",   args: ["--version"] },
  ];

  return Promise.all(checks.map((c) => checkBinary(c.binary, c.args)));
}

async function runBinaryHealthCheck(): Promise<void> {
  console.log("[startup] Checking required system binaries...");
  const statuses = await checkAllBinaries();
  cachedBinaryStatuses = statuses;

  let allOk = true;
  for (const s of statuses) {
    if (s.ok) {
      console.log(`[startup]   ✓ ${s.binary}: ${s.version ?? "ok"}`);
    } else {
      allOk = false;
      console.error(
        `[startup]   ✗ ${s.binary}: MISSING — ${s.error}`
      );
    }
  }

  if (!allOk) {
    console.error(
      "[startup] ⚠️  One or more required system binaries are missing. " +
        "PDF uploads, .doc uploads, and OCR will FAIL with ENOENT errors " +
        "until these binaries are installed. " +
        "If deploying on Render, switch the service Language to 'Docker' " +
        "and ensure the Dockerfile installs poppler-utils, tesseract-ocr, " +
        "tesseract-ocr-ben, libreoffice-writer, and unzip."
    );
  } else {
    console.log("[startup] ✓ All required system binaries are present.");
  }
}

// ---------------------------------------------------------------------------

const app = express();

const PORT = process.env.PORT
  ? parseInt(process.env.PORT, 10)
  : 4000;

const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
        return;
      }

      const isLocalhost =
        /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(?::\d+)?$/i.test(
          origin
        );
      const isVercelPreview = /\.vercel\.app$/i.test(origin);

      if (isLocalhost || isVercelPreview) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin not allowed by CORS: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json({ limit: "10mb" }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many requests. Please try again later.",
    code: "RATE_LIMITED",
  },
});

app.use("/api", apiLimiter);

/**
 * GET /api/health
 *
 * Returns { status: "ok" } when the server is up.
 *
 * Also includes a `binaries` field with the cached startup check results,
 * so the overall health of the runtime environment is visible from a single
 * HTTP request (useful for Render's health-check URL and debugging).
 *
 * The `status` field is always "ok" as long as the Node process is running —
 * a missing binary is a degraded state, not a total failure, because DOCX
 * uploads (which need no system binaries) still work fine. Use
 * `binariesOk: false` in the response to detect degraded mode.
 */
app.get("/api/health", (_req, res) => {
  const binariesOk =
    cachedBinaryStatuses === null
      ? null // check hasn't finished yet (very early request)
      : cachedBinaryStatuses.every((s) => s.ok);

  res.json({
    status: "ok",
    binariesOk,
    binaries: cachedBinaryStatuses,
  });
});

app.use("/api", convertRouter);
app.use("/api", exportRouter);

app.use("/api", (_req, res) => {
  res.status(404).json({
    message: "Not found",
    code: "NOT_FOUND",
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`PDF to Bijoy backend listening on port ${PORT}`);
  console.log(`CORS origins allowed: ${ALLOWED_ORIGINS.join(", ")}`);

  // Binary health check — runs once at startup, caches results.
  runBinaryHealthCheck().catch((err) => {
    console.error("[startup] Binary health check itself threw:", err);
  });

  // Clean up any stale temp files on startup and every 30 minutes
  cleanupOldTempFiles(TMP_DIR).catch(() => {});
  setInterval(() => {
    cleanupOldTempFiles(TMP_DIR).catch(() => {});
  }, 30 * 60 * 1000);
});