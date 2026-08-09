import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const fixtures: string[] = [];
const script = join(process.cwd(), "scripts", "verify-mobile-budget.mjs");

afterEach(() => {
  fixtures.splice(0).forEach((fixture) => rmSync(fixture, { force: true, recursive: true }));
});

function writeFixtureFile(root: string, relativePath: string, contents: string): void {
  const path = join(root, relativePath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, contents);
}

describe("mobile build budget verifier", () => {
  it("counts only the initial mobile graph from the Vite manifest", () => {
    const root = mkdtempSync(join(tmpdir(), "hermes-mobile-budget-"));
    fixtures.push(root);
    const manifestPath = join(root, "manifest.json");
    const files = {
      "index.html": "<html></html>",
      "assets/loader.js": "loader",
      "assets/mobile.js": "mobile",
      "assets/react.js": "react",
      "assets/mobile.css": "body{}",
      "assets/desktop.js": "desktop should stay out"
    };
    for (const [path, contents] of Object.entries(files)) writeFixtureFile(root, path, contents);
    writeFileSync(manifestPath, JSON.stringify({
      "index.html": {
        file: "assets/loader.js",
        isEntry: true,
        dynamicImports: ["src/mobile-main.tsx", "src/desktop-main.tsx"]
      },
      "src/mobile-main.tsx": {
        file: "assets/mobile.js",
        imports: ["assets/react.js"],
        css: ["assets/mobile.css"]
      },
      "assets/react.js": { file: "assets/react.js" },
      "src/desktop-main.tsx": { file: "assets/desktop.js" }
    }));

    const output = execFileSync(process.execPath, [script, "--manifest", manifestPath], { encoding: "utf8" });
    const report = JSON.parse(output) as { files: string[]; gzipBytes: number; rawBytes: number; requestCount: number };

    expect(report.files).toEqual([
      "index.html",
      "assets/loader.js",
      "assets/mobile.js",
      "assets/react.js",
      "assets/mobile.css"
    ]);
    expect(report.requestCount).toBe(5);
    expect(report.rawBytes).toBe(Object.values(files).slice(0, 5).join("").length);
    expect(report.gzipBytes).toBeGreaterThan(0);
  });
});
