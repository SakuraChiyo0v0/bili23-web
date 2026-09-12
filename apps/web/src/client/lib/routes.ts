import { useCallback, useEffect, useState } from "react";

export type RouteId = "parse" | "downloads" | "favorites" | "settings" | "files";

export interface RouteInfo {
  id: RouteId;
  /** 顶栏/文档标题 */
  title: string;
  /** hash 段 */
  hash: string;
}

export const ROUTES: RouteInfo[] = [
  { id: "parse", title: "解析", hash: "#/parse" },
  { id: "downloads", title: "下载", hash: "#/downloads" },
  /**
   * 收藏夹 —— 原版是**浮层**（`FavoriteFlyoutWidget`），这里改成**页面**：
   * 浮层要自己管遮罩/层级/点外面关闭/移动端 sheet，而页面天然有这些，
   * 还能直接分享链接、浏览器前进后退可用（内容与层级仍与原版一致）。
   */
  { id: "favorites", title: "收藏夹", hash: "#/favorites" },
  { id: "settings", title: "设置", hash: "#/settings" },
  /**
   * 产物浏览页 —— 原版没有这一页，它是**「打开下载目录」的 Web 对应物**
   * （原版是打开系统文件管理器，浏览器做不到）。因此它**不进导航栏**：
   * 导航项集合保持原版那 6 项，入口放在下载页工具栏上（原版按钮的位置）。
   */
  { id: "files", title: "产物", hash: "#/files" },
];

export function routeById(id: string): RouteInfo {
  return ROUTES.find((r) => r.id === id) ?? ROUTES[0]!;
}

function currentRoute(): RouteInfo {
  const h = window.location.hash;
  if (!h || h === "#") return ROUTES[0]!;
  const seg = h.replace(/^#\/?/, "").split("/")[0] ?? "";
  return routeById(seg);
}

export function useHashRoute(): [RouteInfo, (id: RouteId) => void] {
  const [route, setRoute] = useState<RouteInfo>(currentRoute);

  useEffect(() => {
    const onHash = () => setRoute(currentRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = useCallback((id: RouteId) => {
    const target = routeById(id);
    if (routeById(target.id).hash === window.location.hash) {
      // hash 相同不触发 hashchange，直接同步一次状态
      setRoute(target);
    } else {
      window.location.hash = target.hash;
    }
  }, []);

  return [route, navigate];
}
