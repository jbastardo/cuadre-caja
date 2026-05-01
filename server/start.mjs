#!/usr/bin/env node
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const tsxPath = join(__dirname, "..", "node_modules", ".bin", "tsx");
const serverPath = join(__dirname, "..", "server", "index.ts");

const child = spawn(tsxPath, [serverPath], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code) => process.exit(code));
child.on("error", (err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
