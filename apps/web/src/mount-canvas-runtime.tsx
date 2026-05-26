import React from "react";
import { createRoot } from "react-dom/client";
import "tldraw/tldraw.css";
import "./styles.css";
import { App as CanvasApp } from "./features/canvas/CanvasApp";
import { LanguageProvider } from "./i18n";

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <LanguageProvider>
      <CanvasApp />
    </LanguageProvider>
  </React.StrictMode>
);
