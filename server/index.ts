import "dotenv/config";
import express from "express";
import helmet from "helmet";
import { router } from "./routes.js";
import { setupVite, serveStatic } from "./vite.js";
import * as db from "./db.js";

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

const PORT = Number(process.env.PORT) || 3000;

async function start() {
  // Register API routes FIRST
  app.use(router);
  
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    await setupVite(app);
  }

  // Ensure DB schema is up-to-date
  try {
    const result = await db.initializeDb();
    console.log("DB init:", result.initialized);
  } catch (e: any) {
    console.warn("DB init warning:", e?.message || e);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});

start().catch(console.error);
