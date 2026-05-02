import "dotenv/config";

console.log("=== SERVER STARTING ===");
console.log("Node version:", process.version);
console.log("NODE_ENV:", process.env.NODE_ENV);
console.log("PORT:", process.env.PORT);
console.log("DATABASE_URL set:", !!process.env.DATABASE_URL);
console.log("CWD:", process.cwd());

async function main() {
  let express: any;
  let helmet: any;

  try {
    const mod = await import("express");
    express = mod.default;
    console.log("express: loaded");
  } catch (e: any) { console.error("express: FAILED -", e.message); process.exit(1); }

  try {
    helmet = (await import("helmet")).default;
    console.log("helmet: loaded");
  } catch (e: any) { console.error("helmet: FAILED -", e.message); process.exit(1); }

  const { router } = await import("./routes.js");
  console.log("routes: loaded");

  const { setupVite, serveStatic } = await import("./vite.js");
  console.log("vite module: loaded");

  const db = await import("./db.js");
  console.log("db: loaded");

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

  app.use((req: any, res: any, next: any) => {
    res.removeHeader("X-Powered-By");
    res.removeHeader("X-Generator");
    next();
  });

  app.use(express.json());

  const PORT = Number(process.env.PORT) || 8080;

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

main().catch(err => {
  console.error("FATAL: Server failed to start:", err);
  process.exit(1);
});