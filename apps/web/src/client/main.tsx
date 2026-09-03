import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { I18nProvider } from "./i18n.js";
import { ThemeProvider, systemTheme } from "./theme.js";

const container = document.getElementById("root");
if (!container) {
  throw new Error("missing #root element");
}

// 首帧前按系统偏好打上默认主题，避免闪白/闪黑
document.documentElement.setAttribute("data-theme", systemTheme());

createRoot(container).render(
  <I18nProvider>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </I18nProvider>,
);