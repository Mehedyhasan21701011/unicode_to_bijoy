"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
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
const app = (0, express_1.default)();
const PORT = process.env.PORT
    ? parseInt(process.env.PORT, 10)
    : 4000;
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN || "http://localhost:5173").split(",").map((origin) => origin.trim()).filter(Boolean);
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
app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
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
    // Clean up any stale temp files on startup and every 30 minutes
    (0, cleanup_1.cleanupOldTempFiles)(upload_1.TMP_DIR).catch(() => { });
    setInterval(() => {
        (0, cleanup_1.cleanupOldTempFiles)(upload_1.TMP_DIR).catch(() => { });
    }, 30 * 60 * 1000);
});
//# sourceMappingURL=index.js.map