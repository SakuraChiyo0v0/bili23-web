import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles/tokens.css";
import "./styles/global.css";
import { applyTheme, type ThemePreference } from "./lib/theme";
import { loadJSON } from "./lib/storage";
import { THEME_KEY } from "./lib/useUiSettings";
import { initAccent } from "./lib/accent";

// 首屏就应用主题 —— 必须在 React 渲染前同步执行。
// 起因：applyTheme 原先只在 useUiSettings 的 effect 里调用，而它只被设置页/主题开关用到，
// 结果"改了主题、刷新后首屏仍是旧的，要进一次设置页才生效"。
// 这里读的是同一份本地缓存（服务端配置拿到后会再覆盖一次，见 useUiSettings）。
applyTheme(loadJSON<ThemePreference>(THEME_KEY, "system"));
// 强调色同样首屏应用（原版 E21：用户可改的 ThemeColor）
initAccent();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
