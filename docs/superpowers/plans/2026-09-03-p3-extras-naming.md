# Bili23-Downloader → TS Web：P3 附加内容 + 命名规则 + 批量/筛选 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans 逐任务执行。
> 承接 P1（video 闭环）与 P2（类型铺开，已 commit `a21effc`）。P3 只做 §9 的 P3 范围：
> 附加内容（弹幕/字幕/封面/章节/NFO）、命名与目录规则（含编号）、批量/筛选。
> 行为基准 = 桌面版 v2.15.0（本地 `C:\LocalSpace\Projects\Github-Proj\Bili23-Downloader`）。

**Goal（spec §9 P3）:** 产物含所选附加内容，且按命名/目录规则落盘；解析页支持关键词筛选与批量勾选。
**验收口径（P3 出口）:**
1. 下载一个视频并勾选「弹幕 ass + 封面 jpg + NFO」，产物目录出现同主名的 `.ass`/`.jpg`/`.nfo`；
2. 配置 `PART` 规则为 `{parent_title}/P{p:02d} - {leaf_title}`（或默认 `{parent_title}/P{p}-{leaf_title}`）后，
   多 P 视频落盘为 `<标题>/P1-<分P名>.mp4` 这种模式；番剧走 `{season_title}/{episode_title}`；
3. 解析页输入关键词可过滤 space/favlist/历史等结果；全选/反选批量勾选生效；
4. `pnpm check` 全绿；已固化选项不因后续改设置而变化（R-208）；
5. 每个大版本一次 commit + push（本次为 `feat: P3 ...`）。

## 已锁定的上游事实（读上游源文件确认，路径均在桌面仓库 src/ 下）

### 1) 附加内容（Additional，config.py “Additional” 分组）
| 项 | 键（默认） | 类型/取值 | 上游参考 |
| --- | --- | --- | --- |
| 弹幕 | danmaku_type(ASS)、danmaku_style、embed_danmaku(False)、delete_danmaku_after_embed(False)、download_danmaku(False) | XML/ASS/JSON | util/common/data/danmaku.py、parse/additional/danmaku.py、file/danmaku_{xml,ass}.py |
| 字幕 | subtitle_type(ASS)、subtitle_language、subtitle_style、embed_subtitle(False)、delete_subtitle_after_embed(False)、download_subtitle(False) | SRT/LRC/TXT/ASS/JSON | util/common/data/subtitles.py、parse/additional/subtitles.py、file/subtitle_ass.py |
| 封面 | cover_type(JPG)、attach_cover(False)、delete_cover_after_attach(False)、download_cover(False) | JPG/PNG/AVIF/WEBP | parse/additional/cover.py |
| 章节 | embed_chapter(False) | 仅 mkv/mp4 内嵌 | parse/additional/chapter.py |
| 元数据 | metadata_type(NFO)、download_metadata(False) | NFO/JSON（Kodi/Jellyfin/Emby） | parse/additional/metadata.py、file/metadata_nfo.py |

- 附加内容解析顺序（worker.py）：弹幕 → 播放器信息（字幕+章节共用一个 player 接口，只请求一次）→ 封面 → 元数据。
- 只 MKV 原生支持 ASS 字幕轨内嵌（is_embed_available：merge_file_ext=="mkv"），MP4 无法容纳 → embed 仅在 mkv 生效。
- 附加文件名 = 主文件 stem + qualifier + "." + suffix（base.py `_write`）：如 `xxx.zh-Hans.srt`。
- 任务创建时把全局设置固化成选项快照（options.py snapshot()），任务此后读快照不读全局（R-208）。

### 2) 命名与编号（File Naming 分组）
- ConventionType（enum.py）：NORMAL=11 PART=12 COLLECTION=13 INTERACTIVE_VIDEO=14 BANGUMI=20 CHEESE=30 LESSON=31 FAVORITE=40 SPACE=50 HISTORY=60 WATCH_LATER=70 WEEKLY=80 AUDIO=90。
- naming_rule_list（config.py DefaultValue）：13 条默认规则（每条 `{id,name,type,rule,default}`），
  PART=`{parent_title}/P{p}-{leaf_title}`、BANGUMI=`{season_title}/{episode_title}`、CHEESE/LESSON=`{series_title}/{episode_title}`、
  FAVORITE=`{favorites_owner_id}_{favorites_owner}/{favorites_name}/{leaf_title}`、SPACE=`{space_owner_id}_{space_owner}/{leaf_title}`、
  HISTORY/WATCH_LATER/WEEKLY=`{parent_title}/{leaf_title}`、AUDIO=`{parent_title}/{uploader} - {leaf_title}` 等。
  rule 内 `/` 即多级目录（file_name.py `__normalize_path` 清洗空段/首尾，空结果返回 "_"）。
- 变量：naming_convention.py VariableListFactory 按类型给变量集；Python `str.format` 语义，支持 `{var}`、`{var:%Y-%m-%d...}`（datetime strftime）、
  `{number:02d}` 等 format spec；组件级非法字符清洗 `re.sub(r'[<>:"/\\|?*\x00-\x1f]','_')`。
- 编号（task/manager.py `__get_number`，取号+自增在锁内）：
  - CONTINUOUS（默认）：返回全局计数器并自增（config.global_starting_number）；
  - FROM_SPECIFIED：从设置的起始号开始每次自增；
  - USE_PARSE_LIST：用解析列表序号（episode_info["number"]）。
- 文件名在 create 时经 FileNameFormatter 生成 → `task_info.File.name/folder`；附加内容 base_path = download_path/folder。

### 3) Web 侧差异（不引入树模型，沿用 P1/P2 决策）
- 无树模型：每条叶子 MediaItem 需要携带命名所需类型元数据（收藏夹名/主人、season/series 等），由解析器填充，供 FileNameFormatter 映射。
- 解析会话在服务端内存：`USE_PARSE_LIST` 序号 = 本次勾选条目在批量创建时的顺序（1 起）。
- 封面转换/avif：Node 无 Pillow。决策：格式转换统一交给 ffmpeg（jpg/png/webp 内置支持；avif 若镜像 ffmpeg 缺 libavif 则任务报错并提示，默认 JPG 不受影响）。

## 架构决策（P3 范围）
1. **MediaItem 扩展命名元数据（可选字段）**：新增类型化可选字段承接上游 episode 变量中叶子自身无法推导的部分：
   `episodeNumber?/seasonNumber?`（番剧）、`favoritesId?/favoritesName?/favoritesOwner?`（收藏夹）、
   `favtime?/viewtime?`（稍后再看/历史时间）、`collectionTitle?/sectionTitle?/seriesTitle?`（合集/课程）。
   变量映射统一收口在 engine `naming/context.ts`：leaf_title=title、parent_title=groupTitle、p=page、uploader/uploader_uid=owner、video_quality/audio_quality/video_codec=任务解析出的实际档位等。
2. **命名模板引擎（engine `naming/`）**：纯函数 `formatFileName(rule, vars, opts)`：
   Python str.format 子集（`{name}`、strftime 时间格式、`0Nd` 数字补齐）、组件级非法字符清洗、路径归一化；配置模型 = naming_rule_list。
3. **编号服务（engine `naming/numbering.ts`）**：三模式 + 起始值 + 全局计数器（web 落 config.json，进程内串行锁）。
4. **附加内容（engine `extras/`）**：fetcher（弹幕 cid、播放器信息 player/v2、封面原图、章节）+ 生成器（xml/ass/json 弹幕、srt/lrc/txt/ass/json 字幕、nfo/json 元数据、封面格式转换）
   + 内嵌钩子（mkv ass 字幕轨、封面 attach、章节 ffmetadata）——全部走 engine 现有 ffmpeg/command 扩展；输入输出均为纯函数可单测，网络 fetch 用 fixture。
5. **下载管线（web download-manager）**：任务状态增加 `additional`（可选阶段）；merge 完成后 → 附加阶段（生成附加文件到最终目录，嵌入的进 ffmpeg 重封装）→
   按命名规则计算 folder+name 落盘 → 历史。`#placeOutput` 替换为 naming 计算路径（保留 AUTO_RENAME 去重语义）。
6. **设置持久化（web config）**：`data/config.json` 新增 `additional` / `fileNaming` 两组默认（键语义对齐上游），
   任务创建时 snapshot 固化（现有 DownloadOptions 扩充附加与命名快照字段）。P3 只开设置页的「附加内容 + 文件命名」两组；其余设置组 P4。
7. **Web UI**：下载选项面板增加 附加内容开关/格式 与 命名规则选择；新增「设置」页（Additional/File Naming 两组）；
   解析页增加关键词筛选、全选/反选、按类型批量勾选按钮。

## 任务清单

### Task 3.1：MediaItem 命名元数据 + naming 模块地基（engine）
**Files:**
- Modify: `packages/engine/src/types.ts`（新增可选命名元数字段）
- Create: `packages/engine/src/naming/variables.ts`（ConventionType 常量/每类型变量目录含 example+description+type）、`naming/context.ts`（MediaItem+档位→变量 map）、`naming/formatter.ts`（format 子集+清洗+路径归一化）、`naming/numbering.ts`（三模式分配器）
- Test: `packages/engine/tests/naming-formatter.test.ts`、`naming-numbering.test.ts`
**接口:**
- `formatFileName(rule, vars, now?) : string`（清洗/空段处理对齐上游）
- `resolveConventionType(item): ConventionTypeId`（按 item.type + interactive 等）
- `buildNamingVariables(item, qualityInfo, number): Record<string, unknown>`
- `NumberingAllocator`（CONTINUOUS/FROM_SPECIFIED/USE_PARSE_LIST + start + lock）
**验收:** 默认规则对每类型样例输出与上游语义一致（含 `P{p}`、多级目录、datetime 与 0Nd 格式）；非法字符/空段/空结果 "_" 覆盖；TDD 全绿。

### Task 3.2：解析器填充命名元数据（engine parser 小改）
**Files:** Modify: `packages/engine/src/parser/bangumi.ts`（episodeNumber/seasonNumber）、`cheese.ts`/`lesson.ts`（seriesTitle）、`favlist.ts`（favorites* 透传到叶子，含 owner 折叠）、`watch-later.ts`/`history.ts`（viewtime/favtime、parent_title 静态名）、`audio.ts`（歌单 parent_title）
**验收:** 默认规则对各类型样例可得到与上游一致的目录结构（收藏夹含 `{favorites_owner_id}_{favorites_owner}/{favorites_name}` 层级）；原有 parser 测试全绿。

- [x] Task 3.1 已完成：types.ts 命名元数据字段（containerType/containerTitle/partCount/favorites*/season/series/section/collection/episode*/favtime/viewtime/seasonId）；src/naming/{variables,context,formatter,numbering}.ts；DEFAULT_NAMING_RULES 13 条与桌面一致；formatFileName 支持 strftime/0Nd/清洗/多级目录；21 条命名单测绿。engine 全量测试绿。
- [x] Task 3.2 已完成：fetchViewItems 设 partCount；popular→WEEKLY(containerTitle=期数标签)；history/watch_later→固定父标签“历史记录/稍后再看”；space→SPACE；favlist 落到 favoritesId/Name/Owner + favtime；bangumi 设 seasonId/sectionTitle/seriesTitle；audio 单曲 groupTitle 置空（避免默认规则产生重复目录）。parser 全量测试绿。

### Task 3.3：附加内容 fetcher（engine extras）
**Files:** Create: `packages/engine/src/extras/types.ts`、`extras/danmaku-fetch.ts`、`extras/player-info.ts`（player/v2：字幕列表+章节）、`extras/subtitle-fetch.ts`、`extras/cover.ts`、`extras/metadata-fetch.ts`（nfo 需要的季/剧信息，从 item+可复用 season 数据）
- Test: fixture 驱动单测（XML 弹幕解析、字幕 json→列表、错误映射）
**接口:** `fetchDanmaku(ctx,item,format)`、`fetchPlayerInfo(ctx,item)`、`fetchSubtitles(ctx,item,playerInfo)`、`downloadCover(ctx,item)`
**验收:** 各 fetcher 对真实接口冒烟（本地网可重试 412）；格式转换纯函数单测。

### Task 3.4：附加内容生成器 + ffmpeg 内嵌（engine extras/ffmpeg）
**Files:** Create: `packages/engine/src/extras/danmaku-{xml,ass,json}.ts`、`extras/subtitle-{srt,lrc,txt,ass,json}.ts`、`extras/metadata-{nfo,json}.ts`、`extras/convert-cover.ts`；Modify: `packages/engine/src/ffmpeg/command.ts`（ass 轨 mux/封面 attach/章节 ffmetadata 命令）
**验收:** 输入固定 fixture → 输出文件与桌面同后缀/同结构；ass 弹幕/字幕样式键对齐上游 danmaku_style/subtitle_style 默认值；ffmpeg 命令单测。

- [x] Task 3.3/3.4 已完成：engine extras 模块（src/extras/* + ffmpeg command/merge 扩展 + index 导出），8 个测试文件 56 条新增（extras-*），engine 245 测试全绿。上游语义取舍记录：
  1) 弹幕数据源：桌面走 protobuf seg.so 分片；engine 改拉标准 XML 端点 comment.bilibili.com/{cid}.xml（零依赖），解析后同构生成 xml/ass/json（覆盖范围受服务端 XML 上限约束）；
  2) ASS 排版：桌面用 Qt 字体实测宽高，engine 用确定性估算（全角≈字号、半角≈0.5字号、行高≈round(字号×1.2)+4），结构同构、坐标近似；
  3) 弹幕时长按 style.advanced 配置（默认 10/5 与桌面一致）；
  4) Python 浮点/alpha 输出细节已按桌面实际校准（alpha 默认 &H32）；
  5) NFO 季级字段（genres/areas/rating/poster/premiered/newEpStatus）引擎无数据源，MetadataInput 由上层组装，poster 下载与 tvshow.nfo 去重属管线；
  6) 附加文件写入与 embed 后删除等编排属 web 管线（本任务）；文件落盘不在 engine 内。

### Task 3.5：web 配置存储 + download-manager 附加/命名管线
**Files:** Create: `apps/web/src/server/config.ts`（读/写 data/config.json，defaults 含 additional/fileNaming）；Modify: `apps/web/src/server/download-manager.ts`（DownloadOptions 扩充快照、任务状态 additional、`#run` 附加阶段、naming 落盘、allocation）、`routes.ts`（/api/config GET/PUT、/api/download 透传）、`client/types.ts`（DTO 同步）
**验收:** 设置保存重启保留；任务选项固化（R-208）；真实下载一个视频勾选 ass 弹幕 + jpg 封面 + nfo → 三个附加文件与主文件同 stem 同目录；改命名规则后新任务生效旧任务不变。

- [x] Task 3.5 已完成：apps/web/src/server/config.ts（ConfigStore：data/config.json 默认值 additional+fileNaming，deepMerge/校验/持久化）；download-manager 增加命名/编号快照固化（NumberingAllocator + resolveConventionType + formatFileName 落盘）、附加内容管线（gatherExtraInputs→merge embed→writeStandaloneExtras，含弹幕/字幕/封面/章节/NFO/JSON）、getConfig/updateConfig；routes 增加 GET/PUT /api/config。web typecheck+9 单测绿。

### Task 3.6：Web UI（设置页 + 下载选项面板 + 解析页筛选/批量）
**Files:** Modify: `apps/web/src/client/App.tsx`（加设置页导航）、Create `SettingsView.tsx`；Modify `ParseView.tsx`（关键词筛选、全选/反选、选项面板附加内容+命名选择）、`types.ts`
**验收:** 手工冒烟：设置附加默认与命名规则 → 解析页勾选下载 → 产物验证；筛选/全选操作生效。

### Task 3.7：P3 出口回归与提交
- [x] Task 3.7 已完成：`pnpm check` 全仓绿灯（engine 245 + web 9 + typecheck + engine/web build）。
- [x] P3 真网冒烟 PASS（端口 8794，数据目录 `.e2e-data-p3b`）：
  1) NORMAL 规则改为 `{uploader}/{leaf_title}` 后下载 BV1GJ411x7h7：产物 `索尼音乐中国/Never Gonna Give You Up - Rick Astley.mp4`（ffprobe h264+aac 可播）+ 同主名 `.Danmaku.xml`（1128 条弹幕）/`.jpg`（封面）/`.Metadata.nfo`（含 actor/tag/bvid）；
  2) BANGUMI 规则 `{season_title}/{episode_title}` 下载番剧 ss33323（109 话，挑第 57 话 61s）：产物 `雾山五行/雾山五行投币数破千万.mp4` + `.Danmaku.ass`（24 条 Dialogue）/`.png`（PNG 头校验）/`.Metadata.json`（kind=bangumi/seasonId/epId/episodeNumber）；
  3) config GET/PUT（含类型校验补丁 `Object.values(ConventionType).includes(rule.type)`）真网通过；改设置只影响新任务（R-208 快照路径验证）。
- 整版 commit + push：`feat: P3 extras & naming rules & batch/filter`。

## 自检记录（每任务完成后更新）
- P3 不破坏 P1/P2 行为：全量回归（engine+web 测试、build）。
- 附加内容各格式以"生成即同构"为最低标准；弹幕/字幕样式默认值与上游一致即可，不做逐像素 UI 预览。
- 真网冒烟注意 WBI 412：重试直至成功（沿用 P2 风控经验）。
- 明确的 Web 差异/裁剪（记录在案，不伪装 1:1）：
  1) 封面 avif 依赖 ffmpeg libavif；不可用时报明确错误；
  2) USE_PARSE_LIST 序号 = 批量创建顺序（桌面为解析列表行号）；
  3) 设置页 P3 只开放附加/命名两组（P4 全量）。



