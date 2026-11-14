import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/fonts.css";
import "@design/tokens/tokens.css";
import "./styles/global.css";
import { initSettings } from "@/lib/settings";
import { App } from "./app/App";

void initSettings();

if (!import.meta.env.DEV) {
  // No browser context menu in the shipped app (NIMI has its own right-click menu).
  document.addEventListener("contextmenu", (event) => event.preventDefault());
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
