import { isMobileEntryPath } from "./entry-path";

const isMobile = isMobileEntryPath(
  window.location.pathname,
  window.__HERMES_BASE_PATH__,
);

void (isMobile ? import("./mobile-main") : import("./desktop-main"));
