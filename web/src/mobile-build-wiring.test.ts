import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("mobile build budget wiring", () => {
  it("uses literal dynamic imports so Vite emits both application entries", () => {
    const main = readFileSync(join(process.cwd(), "src", "main.tsx"), "utf8");

    expect(main).toContain('import("./mobile-main")');
    expect(main).toContain('import("./desktop-main")');
    expect(main).not.toContain("import(entry)");
  });

  it("lazy-loads the chat route so Home does not pay for the full composer and markdown graph", () => {
    const mobileApp = readFileSync(join(process.cwd(), "src", "mobile", "MobileApp.tsx"), "utf8");

    expect(mobileApp).toContain("lazy(() => import('./chat/ChatScreen')")
    expect(mobileApp).not.toContain("import { ChatScreen } from './chat/ChatScreen'")
    expect(mobileApp).toContain('<Suspense')
  });

  it("emits a Vite manifest and exposes the verifier as an npm script", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const viteConfig = readFileSync(join(process.cwd(), "vite.config.ts"), "utf8");

    expect(packageJson.scripts["verify:mobile-budget"]).toBe("node scripts/verify-mobile-budget.mjs");
    expect(viteConfig).toMatch(/manifest:\s*true/);
  });
});
