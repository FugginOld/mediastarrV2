import React from "react";
import ReactDOM from "react-dom/client";
import { QueryProvider } from "./app/providers/QueryProvider";
import { ThemeProvider } from "./app/providers/ThemeProvider";
import { App } from "./app/App";
import "./styles/theme-system.css";
import "./styles/base.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryProvider>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </QueryProvider>
  </React.StrictMode>,
);
