import { describe, expect, it } from "vitest";

import { isMobileEntryPath, normalizeEntryBasePath } from "./entry-path";

describe("isMobileEntryPath", () => {
  it("selects the mobile entry for /mobile and nested paths", () => {
    expect(isMobileEntryPath("/mobile", "")).toBe(true);
    expect(isMobileEntryPath("/mobile/chat/session-1", "")).toBe(true);
  });

  it("keeps lookalike paths in the desktop entry", () => {
    expect(isMobileEntryPath("/mobilex", "")).toBe(false);
    expect(isMobileEntryPath("/mobile-preview", "")).toBe(false);
  });

  it("matches only paths beneath the normalized dashboard base path", () => {
    expect(normalizeEntryBasePath("hermes///")).toBe("/hermes");
    expect(isMobileEntryPath("/hermes/mobile", "/hermes/")).toBe(true);
    expect(isMobileEntryPath("/hermes/mobile/chats", "/hermes/")).toBe(true);
    expect(isMobileEntryPath("/mobile", "/hermes/")).toBe(false);
    expect(isMobileEntryPath("/hermes/mobilex", "/hermes/")).toBe(false);
  });
});
