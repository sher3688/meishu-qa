// This script restructures the build output for Vercel deployment
//
// Strategy:
// - dist/static/ → frontend static files (served by Vercel via outputDirectory)
// - api/ directory → serverless functions (auto-detected by Vercel)
//
// The build script does NOT overwrite api/handler.js.
// Instead, it copies the server bundle to api/server.mjs for the handler to import.
// Static files and SPA fallback are handled by Vercel's rewrites.

const fs = require("fs");
const path = require("path");

function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

const rootDir = path.resolve(__dirname, "..");
const distDir = path.resolve(rootDir, "dist");
const publicDir = path.resolve(distDir, "public");
const staticDir = path.resolve(distDir, "static");

// 1. Create dist/static/ from vite build output
console.log("[Vercel Build] Creating dist/static/...");
if (fs.existsSync(staticDir)) {
  fs.rmSync(staticDir, { recursive: true });
}
fs.mkdirSync(staticDir, { recursive: true });

if (fs.existsSync(publicDir)) {
  copyDirSync(publicDir, staticDir);
  console.log("[Vercel Build] Copied dist/public → dist/static");
} else {
  console.error("[Vercel Build] ERROR: dist/public not found!");
  process.exit(1);
}

// 2. Copy the ESM server bundle into the api/ directory
// So the handler can import it directly
console.log("[Vercel Build] Preparing server bundle...");
const serverBundle = path.resolve(distDir, "server", "index.mjs");
if (!fs.existsSync(serverBundle)) {
  console.error("[Vercel Build] ERROR: dist/server/index.mjs not found!");
  process.exit(1);
}

const rootApiDir = path.resolve(rootDir, "api");
if (!fs.existsSync(rootApiDir)) {
  fs.mkdirSync(rootApiDir, { recursive: true });
}

// Copy the ESM bundle to api/server.mjs
const serverDest = path.resolve(rootApiDir, "server.mjs");
fs.copyFileSync(serverBundle, serverDest);
console.log("[Vercel Build] Copied server bundle to api/server.mjs");

// NOTE: We do NOT overwrite api/handler.js here.
// The handler.js is committed to git and imports from ./server.mjs.
// This way, local changes to handler.js are preserved.

// 3. Clean up
const oldDirs = ["public", "server", "functions"];
for (const dir of oldDirs) {
  const oldPath = path.resolve(distDir, dir);
  if (fs.existsSync(oldPath)) {
    fs.rmSync(oldPath, { recursive: true });
    console.log(`[Vercel Build] Cleaned up dist/${dir}`);
  }
}

// 4. Summary
console.log("\n[Vercel Build] Output structure:");
console.log("  dist/static/ →", fs.readdirSync(staticDir).join(", "));
console.log("  api/handler.js →", fs.existsSync(path.resolve(rootApiDir, "handler.js")) ? "YES (preserved)" : "NO");
console.log("  api/server.mjs →", fs.existsSync(serverDest) ? "YES" : "NO");

console.log("\n[Vercel Build] Done!");
