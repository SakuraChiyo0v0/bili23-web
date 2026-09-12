/**
 * 浏览器侧的一次性引导状态（"这个浏览器有没有看过某个教学气泡"）。
 *
 * 原版把这类记账存在配置里（`config.py:485` 的 `auto_parse_teaching_tip_shown_`）。
 * Web 端不放服务端配置：它跟"下载行为"无关，只跟"当前这个浏览器有没有看过"有关，
 * 放进服务端配置反而会在多端之间串味（手机上看过 → 电脑上就不提示了）。
 */
export const LOCAL_FLAG_AUTO_PARSE_TIP = "bili23.teaching.autoParse";

export function getLocalFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    // 隐私模式等场景下 localStorage 可能不可用：当作"没看过"，只是会重复提示
    return false;
  }
}

export function setLocalFlag(key: string): void {
  try {
    localStorage.setItem(key, "1");
  } catch {
    // 写不进去就算了，下次再提示一遍
  }
}
