import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const serverDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(serverDir, "..");
const vercelEntry = readFileSync(resolve(serverDir, "vercel.ts"), "utf8");
const appSource = readFileSync(resolve(serverDir, "app.ts"), "utf8");
const packageJson = readFileSync(resolve(projectDir, "package.json"), "utf8");
const vercelImports = vercelEntry
  .split("\n")
  .filter(line => !line.trim().startsWith("//"))
  .join("\n");
const appImports = appSource
  .split("\n")
  .filter(line => line.trim().startsWith("import"))
  .join("\n");

describe("Vercel serverless entry", () => {
  it("builds from the API-only entry without Vite or Rollup imports", () => {
    expect(vercelEntry).toContain('export { createApp } from "./app"');
    expect(vercelImports).not.toMatch(/vite|rollup/i);
    expect(appImports).not.toMatch(/vite|rollup/i);
    expect(packageJson).toContain("esbuild server/vercel.ts");
  });
});
