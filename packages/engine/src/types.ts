/** 单个可下载条目（对应桌面版"解析列表"中一个可勾选项：一个分P/一集/一首歌） */
export interface MediaItem {
  /** 稳定标识，形如 video:BVxxx:p1 */
  id: string;
  /** 内容大类（P1 起为 video，其余类型 P2 铺开） */
  type: "video";
  aid: number;
  bvid: string;
  cid: number;
  /** 分P 序号（1 起） */
  page: number;
  /** 分P 标题 */
  title: string;
  /** 视频主标题（合集/分P 时为总标题） */
  groupTitle: string;
  /** 时长（秒） */
  duration: number;
  /** 角标文案，如 "充电专属"；无则空串 */
  badge: string;
  /** 封面 URL */
  cover: string;
  /** 发布时间（Unix 秒） */
  pubtime: number;
  owner: {
    mid: number;
    name: string;
    face: string;
  };
  desc: string;
  /** 可重新打开/复制的地址 */
  url: string;
}
