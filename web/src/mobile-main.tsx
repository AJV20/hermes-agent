import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import "./index.css";
import { ProfileProvider } from "./contexts/ProfileProvider";
import { HERMES_BASE_PATH } from "./lib/api";
import { MobileApp } from "./mobile/MobileApp";
import { installMobileZoomGuard } from "./mobile/mobile-zoom";
import { registerHermesPwa } from "./pwa";
import { ThemeProvider } from "./themes";

installMobileZoomGuard();
registerHermesPwa();

createRoot(document.getElementById("root")!).render(
  <BrowserRouter basename={HERMES_BASE_PATH || undefined}>
    <ThemeProvider>
      <ProfileProvider>
        <MobileApp />
      </ProfileProvider>
    </ThemeProvider>
  </BrowserRouter>,
);
