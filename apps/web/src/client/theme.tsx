import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import "./theme.css";

/** 主题偏好：与 config.behavior.theme 一致（system = 跟随系统） */
export type ThemePref = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

/** 当前系统偏好解析（首屏用，避免闪烁） */
export function systemTheme(): ResolvedTheme {
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
}

export function isThemePref(value: unknown): value is ThemePref {
  return value === "light" || value === "dark" || value === "system";
}

interface ThemeValue {
  /** 用户偏好（含 system） */
  pref: ThemePref;
  /** 实际生效主题 */
  resolved: ResolvedTheme;
  setPref: (pref: ThemePref) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

/**
 * 主题 Provider：
 * - 初始按系统偏好渲染默认主题，避免闪烁；
 * - 挂载后从 GET /api/config 读取 config.behavior.theme（未取到/非法保持默认）；
 * - system 时监听 prefers-color-scheme 变化；
 * - 通过 <html data-theme> 与 CSS 变量生效。
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>("system");
  const [resolved, setResolved] = useState<ResolvedTheme>(systemTheme);

  // 挂载后读取持久化主题偏好
  useEffect(() => {
    let alive = true;
    fetch("/api/config")
      .then((res) => (res.ok ? (res.json() as Promise<{ config?: { behavior?: { theme?: unknown } } }>) : null))
      .then((json) => {
        const theme = json?.config?.behavior?.theme;
        if (alive && isThemePref(theme)) setPrefState(theme);
      })
      .catch(() => {
        // 配置读取失败：保持默认（system）
      });
    return () => {
      alive = false;
    };
  }, []);

  // 偏好 → 实际主题（system 跟随媒体查询，监听变化）
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = (): void => {
      setResolved(pref === "system" ? (mq.matches ? "dark" : "light") : pref);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [pref]);

  // 应用到 <html data-theme>
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolved);
  }, [resolved]);

  const setPref = useCallback((next: ThemePref): void => {
    setPrefState(next);
  }, []);

  const value = useMemo<ThemeValue>(() => ({ pref, resolved, setPref }), [pref, resolved, setPref]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme 必须在 <ThemeProvider> 内使用");
  return ctx;
}