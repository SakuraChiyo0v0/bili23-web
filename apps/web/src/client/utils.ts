import type { TaskStatus } from "./types.js";

export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 100 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export function formatDuration(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return "00:00";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function formatSpeed(bytesPerSecond: number | undefined): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return "—";
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatEta(seconds: number | undefined): string {
  if (seconds === undefined || seconds < 0) return "—";
  if (seconds < 60) return `${Math.ceil(seconds)} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.ceil(seconds % 60);
  return `${minutes} 分 ${rest} 秒`;
}

export function formatTime(unixSeconds: number | undefined): string {
  if (!unixSeconds) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(unixSeconds * 1000));
}

export const STATUS_LABELS: Record<TaskStatus, string> = {
  queued: "等待中",
  parsing: "解析中",
  downloading: "下载中",
  merging: "合并中",
  paused: "已暂停",
  interrupted: "已中断",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

export const STATUS_TONES: Record<TaskStatus, string> = {
  queued: "neutral",
  parsing: "info",
  downloading: "brand",
  merging: "warning",
  paused: "warning",
  interrupted: "warning",
  completed: "success",
  failed: "danger",
  cancelled: "neutral",
};