import { useCallback, useEffect, useState } from "react";

export type RouteId = "parse" | "downloads" | "settings";

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
  { id: "settings", title: "设置", hash: "#/settings" },
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
