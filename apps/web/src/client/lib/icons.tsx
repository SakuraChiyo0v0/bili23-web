import {
  Search, Download, Star, Info, Settings, User, Moon, X, Check, Play, Pause, Folder, ExternalLink, Eye, Sun, ChevronDown, ChevronRight, ChevronLeft, History,
  Heart, Clock, RotateCcw, ClipboardPaste, ListChecks, SlidersHorizontal,
  type LucideProps,
} from "lucide-react";

/** lucide 标准 SVG 图标映射（24×24 outline，尺寸随 props 控制） */
const ICONS = {
  search: Search,
  download: Download,
  star: Star,
  info: Info,
  gear: Settings,
  user: User,
  moon: Moon,
  x: X,
  check: Check,
  play: Play,
  pause: Pause,
  folder: Folder,
  external: ExternalLink,
  eye: Eye,
  history: History,
  sun: Sun,
  chevD: ChevronDown,
  chevR: ChevronRight,
  // 收藏夹浮层的五项分类（对齐原版图标语义：收藏夹=星、订阅=文件夹、追番=心、稍后再看=时钟、历史=历史）
  heart: Heart,
  clock: Clock,
  careL: ChevronLeft,
  careR: ChevronRight,
  // 任务卡主按钮（原版 getButtonIcon：完成→文件夹、失败→重试、排队/暂停→播放、其余→暂停）
  retry: RotateCcw,
  // 解析页工具条（原版：粘贴并解析 / 批量选择 / 下载选项）
  paste: ClipboardPaste,
  batch: ListChecks,
  options: SlidersHorizontal,
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 20, ...rest }: { name: IconName; size?: number } & LucideProps) {
  const Component = ICONS[name];
  return <Component className="ico" size={size} strokeWidth={1.8} aria-hidden="true" {...rest} />;
}