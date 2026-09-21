"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const convert_1 = require("./routes/convert");
const export_1 = require("./routes/export");
const cleanup_1 = require("./utils/cleanup");
const upload_1 = require("./middleware/upload");
dotenv_1.default.config();
process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err);
});
process.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection:", reason);
});
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
// Cached result from the startup check so /api/health doesn't re-probe on
// every request (probing soffice is slow).
let cachedBinaryStatuses = null;
async function checkBinary(binary, args) {
    try {
        const { stdout, stderr } = await execFileAsync(binary, args, {
            timeout: 10000,
            encoding: "utf8",
        });
        const version = (stdout || stderr).split("\n")[0].trim().slice(0, 120);
        return { binary, ok: true, version };
    }
    catch (err) {
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
async function checkAllBinaries() {
    const checks = [
        { binary: "pdftotext", args: ["-v"] },
        { binary: "pdfinfo", args: ["-v"] },
        { binary: "pdftoppm", args: ["-v"] },
        { binary: "tesseract", args: ["--version"] },
        { binary: "soffice", args: ["--version"] },
    ];
    return Promise.all(checks.map((c) => checkBinary(c.binary, c.args)));
}
async function runBinaryHealthCheck() {
    console.log("[startup] Checking required system binaries...");
    const statuses = await checkAllBinaries();
    cachedBinaryStatuses = statuses;
    let allOk = true;
    for (const s of statuses) {
        if (s.ok) {
            console.log(`[startup]   ✓ ${s.binary}: ${s.version ?? "ok"}`);
        }
        else {
            allOk = false;
            console.error(`[startup]   ✗ ${s.binary}: MISSING — ${s.error}`);
        }
    }
    if (!allOk) {
        console.error("[startup] ⚠️  One or more required system binaries are missing. " +
            "PDF uploads, .doc uploads, and OCR will FAIL with ENOENT errors " +
            "until these binaries are installed. " +
            "If deploying on Render, switch the service Language to 'Docker' " +
            "and ensure the Dockerfile installs poppler-utils, tesseract-ocr, " +
            "tesseract-ocr-ben, libreoffice-writer, and unzip.");
    }
    else {
        console.log("[startup] ✓ All required system binaries are present.");
    }
}
// ---------------------------------------------------------------------------
const app = (0, express_1.default)();
const PORT = process.env.PORT
    ? parseInt(process.env.PORT, 10)
    : 4000;
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        if (!origin || ALLOWED_ORIGINS.includes(origin)) {
            callback(null, true);
            return;
        }
        const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(?::\d+)?$/i.test(origin);
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
}));
app.use(express_1.default.json({ limit: "10mb" }));
const apiLimiter = (0, express_rate_limit_1.default)({
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
    const binariesOk = cachedBinaryStatuses === null
        ? null // check hasn't finished yet (very early request)
        : cachedBinaryStatuses.every((s) => s.ok);
    res.json({
        status: "ok",
        binariesOk,
        binaries: cachedBinaryStatuses,
    });
});
app.use("/api", convert_1.convertRouter);
app.use("/api", export_1.exportRouter);
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
    (0, cleanup_1.cleanupOldTempFiles)(upload_1.TMP_DIR).catch(() => { });
    setInterval(() => {
        (0, cleanup_1.cleanupOldTempFiles)(upload_1.TMP_DIR).catch(() => { });
    }, 30 * 60 * 1000);
});
//# sourceMappingURL=index.js.map