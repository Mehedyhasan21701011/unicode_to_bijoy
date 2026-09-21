import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
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

const app = express();

const PORT = process.env.PORT
  ? parseInt(process.env.PORT, 10)
  : 4000;

const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN || "http://localhost:5173").split(",").map((origin) => origin.trim()).filter(Boolean);

app.use(
  cors({
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

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
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

  // Clean up any stale temp files on startup and every 30 minutes
  cleanupOldTempFiles(TMP_DIR).catch(() => {});
  setInterval(() => {
    cleanupOldTempFiles(TMP_DIR).catch(() => {});
  }, 30 * 60 * 1000);
});