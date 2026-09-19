import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import { convertRouter } from "./routes/convert";
import { exportRouter } from "./routes/export";

dotenv.config();

// Defense in depth: a single request's unexpected failure should never
// take down the whole server process. Route handlers already catch and
// report their own errors; these are a last-resort safety net.
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: "10mb" }));

// Basic abuse protection: PDF/OCR processing is CPU-intensive.
const apiLimiter = rateLimit({
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

app.use("/api", convertRouter);
app.use("/api", exportRouter);

// Fallback JSON 404 for unknown API routes.
app.use("/api", (_req, res) => {
  res.status(404).json({ message: "Not found", code: "NOT_FOUND" });
});

app.listen(PORT, () => {
  console.log(`PDF to Bijoy backend listening on http://localhost:${PORT}`);
  console.log(`CORS origin allowed: ${CORS_ORIGIN}`);
});
