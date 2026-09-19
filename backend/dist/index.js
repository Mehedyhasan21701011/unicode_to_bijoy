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
dotenv_1.default.config();
// Defense in depth: a single request's unexpected failure should never
// take down the whole server process. Route handlers already catch and
// report their own errors; these are a last-resort safety net.
process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err);
});
process.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection:", reason);
});
const app = (0, express_1.default)();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";
app.use((0, cors_1.default)({ origin: CORS_ORIGIN }));
app.use(express_1.default.json({ limit: "10mb" }));
// Basic abuse protection: PDF/OCR processing is CPU-intensive.
const apiLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
});
app.use("/api", apiLimiter);
app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
});
app.use("/api", convert_1.convertRouter);
app.use("/api", export_1.exportRouter);
// Fallback JSON 404 for unknown API routes.
app.use("/api", (_req, res) => {
    res.status(404).json({ message: "Not found", code: "NOT_FOUND" });
});
app.listen(PORT, () => {
    console.log(`PDF to Bijoy backend listening on http://localhost:${PORT}`);
    console.log(`CORS origin allowed: ${CORS_ORIGIN}`);
});
//# sourceMappingURL=index.js.map