import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function setupVite(app: Express) {
  const { createServer: createViteServer } = await import("vite");
  const clientPath = path.resolve(__dirname, "../client");
  const vite = await createViteServer({
    root: clientPath,
    server: { 
      middlewareMode: true,
      hmr: false,
    },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "../dist/public");
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    console.error("dist/public not found - run npm run build first");
  }
}