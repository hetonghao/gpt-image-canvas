import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App as CanvasApp } from "./features/canvas/CanvasApp";
import { LanguageProvider } from "./i18n";
import { installHostCredentialsMessageBridge } from "./shared/api/host-token";

installHostCredentialsMessageBridge();

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <LanguageProvider>
      <CanvasApp />
    </LanguageProvider>
  </React.StrictMode>
);
