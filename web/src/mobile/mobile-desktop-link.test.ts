import { describe, expect, it } from "vitest";

import { desktopDocumentHref } from "./mobile-desktop-link";

describe("desktopDocumentHref", () => {
  it("preserves desktop destinations at the dashboard root", () => {
    expect(desktopDocumentHref("/files", "")).toBe("/files");
  });

  it("prefixes desktop destinations with the normalized dashboard base path", () => {
    expect(desktopDocumentHref("/system", "hermes///")).toBe("/hermes/system");
  });
});
