# 原版 Bili23-Downloader 实现速查备忘（从源码摘录）

> 供实现期对照的**精确常量/字段/映射**，省去反复翻源码。源码根：`C:\LocalSpace\Projects\Github-Proj\Bili23-Downloader`（v2.15.0）。
> 完整交互规格见 `original-ui-baseline.md`；本文只记录易丢的硬数据。

## 1. URL 识别（url_pattern.py 顺序匹配，命中即停）
| 顺序 | 类型 | 正则/说明 |
|---|---|---|
| 1 | video | `bilibili\.com/video/([a-zA-Z0-9]+)` |
| 2 | bangumi | `bilibili\.com/bangumi/(play\|media)/(ss\d+\|ep\d+\|md\d+)` |
| 3 | cheese | `bilibili\.com/cheese/play/(ss\d+\|ep\d+)` |
| 4 | lesson | `mall\.bilibili\.com/lesson/play` |
| 5 | list | `space\.bilibili\.com/(\d+)/lists` |
| 6 | favlist | `space\.bilibili\.com/(\d+)/favlist` |
| 7 | favlist | `www\.bilibili\.com/list/ml(\d+)` |
| 8 | space | `space\.bilibili\.com/(\d+)` |
| 9 | space | `www\.bilibili\.com/medialist/play/(\d+)` |
| 10 | list | `bilibili\.com/list/(\d+)` |
| 11 | popular | `bilibili\.com/v/popular` |
| 12 | watch_later | `bili23://watch_later`（Web 用导航入口替代） |
| 13 | history | `bili23://history`（同上） |
| 14 | festival | `bilibili\.com/festival` |
| 15 | b23 | `(b23\.tv\|bili2233\.cn)`（先解跳转） |
| 16 | video | 裸 `(?:BV\|bv\|AV\|av)(\w+)` |
| 17 | bangumi | 裸 `(ep\d+\|ss\d+)\|md\d+` |
| 18 | audio | 裸 `(am\d+)\|(au\d+)` |

## 2. TreeItem 属性位（IntFlag，1<<n）
VIDEO=0,BANGUMI=1,CHEESE=2,WEEKLY=3,COLLECTION_LIST=4,SPACE=5,FAVLIST=6,NEED_PARSE=7,
NORMAL=8,PART=9,COLLECTION=10,INTERACTIVE=11,DOWNLOAD_AS_SINGLE=12,WATCH_LATER=13,HISTORY=14,
TREE_NODE=15,AUDIO=16,FAVORITE_WITH_MULTI_PART=17,LESSON=18

- 叶子带 aid/cid/bvid/ep_id/sid…；容器/分组=树节点（TREE_NODE）。
- NEED_PARSE 行（space/favlist 视频行）不可直接当叶子，需再解析或“下载为单视频”。
- 下载为单视频 → 命名强制 `{leaf_title}`。

## 3. 命名规则类型（ConventionType）
NORMAL=11,PART=12,COLLECTION=13,INTERACTIVE_VIDEO=14,BANGUMI=20,CHEESE=30,LESSON=31,FAVORITE=40,
SPACE=50,HISTORY=60,WATCH_LATER=70,WEEKLY=80,AUDIO=90

### 默认规则模板（config DefaultValue.naming_rule_list）
| 类型 | 模板 |
|---|---|
| NORMAL | `{leaf_title}` |
| PART | `{parent_title}/P{p}-{leaf_title}` |
| COLLECTION | `{collection_title}/{section_title}/{parent_title}/{leaf_title}` |
| INTERACTIVE_VIDEO | `{parent_title}/{leaf_title}` |
| BANGUMI | `{season_title}/{episode_title}` |
| CHEESE | `{series_title}/{episode_title}` |
| LESSON | `{series_title}/{episode_title}` |
| FAVORITE | `{favorites_owner_id}_{favorites_owner}/{favorites_name}/{leaf_title}` |
| SPACE | `{space_owner_id}_{space_owner}/{leaf_title}` |
| HISTORY | `{parent_title}/{leaf_title}` |
| WATCH_LATER | `{parent_title}/{leaf_title}` |
| WEEKLY | `{parent_title}/{leaf_title}` |
| AUDIO | `{parent_title}/{uploader} - {leaf_title}` |

## 4. 模板变量全集（FileNameFormatter 取值）
pub_time/pub_ts, create_time/create_ts, fav_time/fav_ts, last_watched_time/last_watched_ts（时间支持 `:{strftime}` 格式）,
number, uploader, uploader_uid, video_quality, audio_quality, video_codec,
aid/bvid/cid/ep_id/season_id, course_id/lesson_id/item_id/section_id,
leaf_title/parent_title/section_title/collection_title, series_title/season_title/episode_title,
season_number/episode_number, p(part_number), favorites_name/favorites_id/favorites_owner/favorites_owner_id,
space_owner/space_owner_id

- 校验：不能以 `/`、`.`、`..` 开头/结尾；路径分段不能含 `<>:"/\|?*` 与控制字符；组件首尾去空格和点；非法字符替换为 `_`。

## 5. 画质/音质/编码 id
- 画质：自动=200；127/126/125/122/120/116/112/100/80/64/32/16（8K→流畅）
- 音质：自动=30300；30251(Hi-Res/flac)、30250(杜比全景声/ec3，杜比 30255 归 30250)、30280(192K/m4a)、30232、30216
- 编码：自动=20；7=AVC、12=HEVC、13=AV1
- 下载 parse：给定 id 不可用则按优先级取第一个可用；仍无则裁剪该项（去掉 DownloadType 位）。
- UI preview 同理生成候选（含 Auto 首项）。

## 6. 下载/任务状态机（原版枚举）
QUEUED=0,PARSING=1,DOWNLOADING=2,PAUSED=3,COMPLETED=4,FFMPEG_QUEUED=5,MERGING=6,CONVERTING=7,
ADDITIONAL_PROCESSING=8,FAILED=100,FFMPEG_FAILED=101,INVALID=1000
- 流转：QUEUED→PARSING→DOWNLOADING⇄PAUSED→FFMPEG_QUEUED→MERGING/CONVERTING→ADDITIONAL→COMPLETED；失败态 FAILED/FFMPEG_FAILED；删除/无效 INVALID。
- 并发：任务并行上限（默认1，1-10）；单任务分片线程（默认4，1-10）；ffmpeg 同时最多 1 个。
- 断点：分片 ChunkState 存 SQLite；interrupted 可续；retry 清断点。
- 卡片文案/按钮映射见 baseline §9.3。

## 7. 下载类型位（DownloadType IntFlag）
VIDEO=1<<0,AUDIO=1<<1,DANMAKU=1<<2,SUBTITLE=1<<3,COVER=1<<4,METADATA=1<<5,CHAPTER=1<<6

## 8. 存储
- 数据目录：桌面 `%APPDATA%/Bili23 Downloader/`；Web 为 `BILI23_DATA_DIR`（容器 /data）。
- task.db：download_task/completed_task，每行 task_id/hash_id/cover_id/title/created_time(completed_time)/data(JSON TaskInfo)。
- history.db：history（最近 100 条）。
- thumbnail.db：cover（webp base64，>75MB 自动清空+VACUUM）。
- 封面异步 16 并发线程池下载，居中裁剪 16:9，转 WEBP 缓存。

## 9. auth
- 登录态 = Cookie 集合（SESSDATA/bili_jct/DedeUserID/DedeUserID__ckMd5/buvid*/b_lsid 等）。
- 扫码轮询状态：86101 等待扫码、86090 等待确认、0 成功、86038 过期。
- Cookie 登录解析支持 `SESSDATA=..;bili_jct=..` 分号格式与 JSON 格式，需校验 4 个关键键。
- Web 后端已有扫码+refresh；短信不做。

## 10. 请求/CDN
- headers：`Referer: https://www.bilibili.com/` + 自定义 UA（config）；cookie 由 client 管理。
- WBI 签名：img_key/sub_key + mixinKeyEncTab + `wts` + 排序 + 过滤 `!'()*` + `w_rid=md5(query+mixin_key)`。
- 下载 URL 探测：过滤 mcdn/pcdn/szbdyd/mountaintoys；替换服务商节点（mallxcodeboss 商城课不替换）；两层（首选+兜底，预算 60%/40% 上限 30s）；单批并发 4；节点连续失败 2 次冷却 180s；HEAD 优先、Range GET 兜底、min_file_size=1024。
- Proxy：禁用/系统/手动(http)；Web 用环境变量/配置。

## 11. 其它易丢点
- av→BV 算法在 parser/video.py 的 aid_to_bvid（XOR_CODE 23442827791579, MAX_AID 1<<51, 表+encode map）。
- 互动视频判定：view.data.rights.is_stein_gate === 1；BFS 从 (cid,edge_id=0)，edgeinfo_v2，visited 按 (cid,edge_id)。
- 活动页/跳转：parseUrl 跟随 redirect_url 最多 3 跳；b23 短链先解跳。
- 解析成功写解析历史（title,url,type）；重复 url 会先删旧再插新并保留 100 条。
- 批量解析只支持 av/BV 链接（原版 BatchParseDialog）。
- 自动解析分页 interval 默认 2s（0.1–15s）；“自动加入下载列表”可勾选。
- 搜索：space/favlist/history/watch_later 支持服务端搜索（keyword/key），关键词写回 URL 后重新解析；其余仅本地筛当前页。
- 下载选项“保存即写全局配置 + 任务创建时快照（OptionsInfo）”；旧任务缺失字段回落全局。
- 默认下载选项：video_quality=200 auto / audio=30300 auto / codec=20 auto；download_video/audio=true、merge=true、keep=false。