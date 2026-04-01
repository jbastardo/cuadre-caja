import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function setupVite(app: Express) {
  const clientPath = path.resolve(__dirname, "../client");
  console.log("Vite client path:", clientPath);
  console.log("index.html exists:", fs.existsSync(path.join(clientPath, "index.html")));
  
  const vite = await createViteServer({
    root: clientPath,
    server: { 
      middlewareMode: true,
      hmr: false,
    },
    appType: "spa",
  });
  
  console.log("Vite server created");
  
  // Register vite middleware - it will handle non-API routes
  app.use(vite.middlewares);
  
  console.log("Vite middleware registered");
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "../dist/public");
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    console.warn("Warning: dist/public not found. Run 'npm run build' first.");
  }
}
