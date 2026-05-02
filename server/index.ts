import "dotenv/config";
import express from "express";
import helmet from "helmet";
import { router } from "./routes.js";
import { setupVite, serveStatic } from "./vite.js";
import * as db from "./db.js";

console.log("=== SERVER STARTING ===");
console.log("NODE_ENV:", process.env.NODE_ENV);
console.log("PORT:", process.env.PORT);
console.log("DATABASE_URL set:", !!process.env.DATABASE_URL);

const app = express();

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
}));

app.use((req, res, next) => {
  res.removeHeader("X-Powered-By");
  res.removeHeader("X-Generator");
  next();
});

app.use(express.json());

const PORT = Number(process.env.PORT) || 8080;

async function start() {
  console.log("Registering routes...");
  app.use(router);
  console.log("Routes registered.");

  if (process.env.NODE_ENV === "production") {
    console.log("Serving static files...");
    serveStatic(app);
  } else {
    console.log("Setting up Vite...");
    await setupVite(app);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on port ${PORT}`);
  });

  console.log("Initializing DB...");
  try {
    const result = await db.initializeDb();
    console.log("DB init:", result.initialized);
  } catch (e: any) {
    console.warn("DB init warning:", e?.message || e);
  }
}

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

console.log("Calling start()...");
start().catch(err => {
  console.error("FATAL: start() failed:", err);
  process.exit(1);
});