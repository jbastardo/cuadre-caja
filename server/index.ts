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
}));

app.use(express.json());

const PORT = Number(process.env.PORT) || 8080;

app.use(router);

if (process.env.NODE_ENV === "production") {
  serveStatic(app);
} else {
  setupVite(app);
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT}`);
});

db.initializeDb().then(result => {
  console.log("DB initialized:", result.initialized);
}).catch(err => {
  console.warn("DB init warning:", err?.message || err);
});