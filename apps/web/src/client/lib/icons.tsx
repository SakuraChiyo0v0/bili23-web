import {
  Search, Download, Star, Info, Settings, User, Moon, X, Check, Play, Pause, Folder, ExternalLink, Eye, Sun, ChevronDown, ChevronRight, History,
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
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 20, ...rest }: { name: IconName; size?: number } & LucideProps) {
  const Component = ICONS[name];
  return <Component className="ico" size={size} strokeWidth={1.8} aria-hidden="true" {...rest} />;
}