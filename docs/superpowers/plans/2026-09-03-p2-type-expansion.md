# Bili23-Downloader → TS Web：P2 类型铺开实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans 逐任务执行。
> 本计划承接 P1（投稿视频闭环已交付：parse→media→download→ffmpeg→history）。P2 只做"类型铺开"，不动 P1 已验证的下载/合并/存储闭环，除非模型扩展必须触碰。

**Goal（spec §9 P2）:** 番剧/课程/音乐/空间/收藏夹/每周必看/稍后再看/历史/互动 各类型"解析+下载"冒烟通过。
**验收口径（每类型）:** `POST /api/parse` 返回该容器下可勾选条目（分P/分集/歌曲）→ 选一条发起下载 → 走 P1 既有闭环 → 产物文件生成可播/可听；`pnpm check` 全绿；类型级解析失败须映射为明确业务错误（登录缺失→LOGIN_REQUIRED 等），不得抛裸异常。

## 已锁定的实现事实（读上游 parse_worker.py / episode/* / parser/* 确认）

| 内容大类 | episode 列表数据源（解析） | playurl 端点（下载取流） | 响应字段 | 下载形态 |
| --- | --- | --- | --- | --- |
| video（含互动） | x/web-interface/view（P1 已有） | x/player/wbi/playurl（wbi，fnval 4048） | data | DASH/MP4 → 合并 |
| bangumi（番剧） | pgc/view/web/season（ss/ep→season） | pgc/player/web/playurl（明文，fnval 143312） | result | DASH/MP4 → 合并 |
| cheese（课堂课程） | pugv/view/web/season（ep/ss） | pugv/player/web/playurl（明文，fnval 16，avid+cid+ep_id） | result | DASH → 合并 |
| lesson（商城课程） | mall 课程详情/目录 API | mall 播放详情 POST（course_id/lesson_id/item_id/section_id）→ 单 mp4 直链 | data | 单文件（无合并），包装成 durl 形态 |
| audio（音乐） | audio/music-service-c/web/song（au→sid）+ 歌单/UP 主页歌曲列表 | audio/music-service-c/web/url?sid&privilege=2&quality=2 → m4a | data（format 补 "m4a"） | 单文件 m4a（无合并） |
| space（UP 主页） | x/space/wbi/arc/search（mid+pn+ps，分页） | 命中条目为投稿 video → www 端点 | data | 同 video |
| favlist（收藏夹） | 收藏夹目录 + x/v3/fav/resource/list（media_id+pn） | 命中条目为投稿 video → www 端点 | data | 同 video |
| popular（每周必看） | x/web-interface/popular/series/one?number=N | 命中条目为投稿 video → www 端点 | data | 同 video |
| watch_later（稍后再看） | x/v2/history/toview（需登录） | 命中条目为投稿 video → www 端点 | data | 同 video |
| history（观看历史） | x/v2/history?pn（需登录） | 命中条目为投稿 video → www 端点 | data | 同 video |
| list（合集/视频列表） | 投稿合集页 API（P1 多P 已覆盖单视频；合集=多视频串） | 同 video | data | 同 video |

> 需登录类型（watch_later/history）：匿名调用返回业务错误码 → 映射 LOGIN_REQUIRED。冒烟以"错误映射正确 + 提供 cookie 后可解析"为准；无登录态时该类型出口验收按错误映射冒烟计。

## 架构决策（P2 范围）

1. **模型扩展（最小侵入）**：`MediaItem` 增加可选 `epId`/`sid`/`auId`/`courseId`/`lessonId`/`itemId`/`sectionId`（按类型），`type` 扩为 `"video"|"bangumi"|"cheese"|"lesson"|"audio"|"space"|"favlist"|"popular"|"watch_later"|"history"`。下载/合并/存储只依赖 `{bvid,cid,aid} + flavor`，audio/lesson 走"单文件"分支。
2. **取流分发**：把 P1 的 `fetchVideoMediaInfo` 重构为按 `item.type` 选 endpoint flavor 的 `fetchPlayMediaInfo`（www=wbi 签名；pgc/pugv=明文+对应 fnval；lesson/audio=各自直链）→ 归一化为 P1 的 `VideoMediaInfo` 结构；resolver/downloader 不动。
3. **下载计划分发**：`runDownloadPlan` 增加 audio/lesson "单文件直链"形态（无 ffmpeg 合并、ext=m4a/mp4），video 系沿用现有 merge 路径。
4. **去重哈希**：audio/lesson 无 bvid 时以 `{type, sid|course_id..., }` 稳定键参与 calcHashId（桌面 hash_id.py 语义：稳定 JSON + md5）。
5. 分组标题/角标沿用 P1 的 `groupTitle/badge` 字段，不引入树模型。
6. 命名/目录规则、批量筛选属 P3，本计划不展开（但 MediaItem 元数据预留相关_titles 等字段可选）。

## 任务清单

### Task 2.1：模型与取流分发重构（地基）
**Files:**
- Modify: `packages/engine/src/types.ts`（type union + 可选字段）、`media/video-info.ts`（flavor 参数化或新 dispatcher）、`media/wbi-keys.ts`（沿用）
- Create: `packages/engine/src/media/info-flavor.ts`（www/pgc/pugv/lesson/audio 端点与归一化）
- Test: `packages/engine/tests/media-flavor.test.ts`（fixture：各端点参数/响应归一化/错误映射）
**Interfaces:**
- Produces: `fetchPlayMediaInfo(ctx, item, opts?) : Promise<VideoMediaInfo>`（按 type 自动选 flavor；audio/lesson 归一化为 durl 单分片）
**验收:** P1 全部测试保持绿（重构不回归）；新增 flavor 单测绿。
- [x] Task 2.1 已完成：MediaItem.type 扩为 ItemKind 五元并新增 epId/auId/sid/courseId/lessonId/itemId/sectionId/interactive 可选字段；video-info.ts 抽出 normalizePlayPayload / isLoginApiError / assertPlayOk；新增 media/flavor.ts（flavorOf + fetchPlayMediaInfo：www=wbi fnval4048，pgc=明文 fnval143312，pugv=明文 fnval16）；download-manager 改走 fetchPlayMediaInfo + #hashOf 条件键。7 个 flavor 单测 + pnpm check 全绿（engine 101 / web 9）

### Task 2.2：bangumi（番剧）
**Files:**
- Create: `packages/engine/src/parser/bangumi.ts`（ss/ep/md 解析→ season 元信息 + episodes 扁平 items）
- Modify: `packages/engine/src/parser/index.ts`（注册 bangumi）
- Test: `packages/engine/tests/parser-bangumi.test.ts`（fixture 分节/预告过滤/无 bvid 章节剔除 等桌面语义）
**验收:** 真实 ss 链接解析出正片分集；选一集下载→合并→产物可播；`GET /api/parse` 冒烟。
- [x] Task 2.2 已完成：parser/bangumi.ts（ep/ss 直查，md 经 pgc/review/user 换 season_id；正片+分节平铺、剔除无 bvid/cid 章节、预告不影响序号、show_title 优先、时长 ms→s）；parser/index 注册。6 单测绿 + 真网冒烟 PASS：ss33323 雾山五行 109 条 → 最短 11s 分集 pgc DASH 下载 538KB → ffmpeg 合并 → ffprobe h264+aac → downloads/雾山五行/*.mp4

### Task 2.3：cheese（课堂课程）
**Files:**
- Create: `packages/engine/src/parser/cheese.ts`；`parser/index.ts` 注册
- Test: `packages/engine/tests/parser-cheese.test.ts`
**验收:** 真实课程 ep/ss 解析出课节 → 一节课下载合并冒烟（如遇需登录，按错误映射冒烟）。

- [x] Task 2.3 已完成：parser/cheese.ts（ep/ss→pugv/view/web/season/v2，sections 平铺，label/status→badge）已实现并注册；4 单测绿；真网解析 ss18693 得 62 课节、5 节"全集试看"。
  **真网下载冒烟 PASS**：ep647161「01 课程介绍」(209s) DASH 19.4MB → ffmpeg 合并 → ffprobe h264+aac → .e2e-data-p2cheese/downloads/Three.js入门到高阶教程（技术+美术 ）/01 课程介绍.mp4。
  **期间修复回归**：pugv 端点 DASH 流字段为 snake_case（base_url/backup_url/mime_type），而 media/video-info.ts 的 normalizePlayPayload 只读 camelCase（www/pgc 用），导致 pugv baseUrl 全空、下载选流失败。已按上游 download/parse/query_worker.py 语义（baseUrl/base_url/backupUrl/backup_url/url 均兼容）修复 toStreamRef 并新增 snake_case 归一化单测；parser-video.test 的"未实现类型"占位断言由 cheese 改为 festival（P2 全程不注册）。engine 106 测试全绿。

### Task 2.4：audio（音乐）＋ lesson（商城课程）
**Files:**
- Create: `packages/engine/src/parser/audio.ts`、`src/parser/lesson.ts`；`download/task.ts` 单文件分支；`store/hash.ts` 无 bvid 键
- Test: `packages/engine/tests/parser-audio.test.ts`、`parser-lesson.test.ts`
**验收:** au 链接解析出歌曲列表→一首 m4a 下载可听；lesson 视上游数据可达性（可能需登录）降级为错误映射冒烟。

- [x] Task 2.4 已完成：AudioParser（au→song/info 单曲、am→menu/info 标题+of-menu 列表；sid 以 statistic.sid 为准）、LessonParser（courseId/lessonId/itemId；无 SESSDATA 前置 LOGIN_REQUIRED 不发请求；h5/detail 章节平铺、过滤无 sectionId/无 videoTime、badge hasWatchRight/couldPreview/付费、lessonId 小节级优先、videoTime ms→s）；fetchPlayMediaInfo 补 audio/lesson 真实实现（audio url?sid 30280 m4a、lesson POST play/detail videoUrl mp4，`singleFileExt` 标记单文件直链）；download-manager 合并阶段识别 singleFileExt 跳过 ffmpeg；新增 6+6 parser 单测 + 5 flavor 单测。
  **真网冒烟 PASS（.e2e-data-p2audio，端口 8792）**：au13526 unravel parse→1 条→单文件 m4a 5.8MB 下载→ffprobe aac 可听；am26241 歌单 parse→12 条（groupTitle=歌单名）；lesson 匿名 parse→HTTP 401 LOGIN_REQUIRED（不发请求，对齐桌面）。engine 123 测试全绿。（登录态 lesson 下载需 SESSDATA，web 层 cookie 配置属后续任务）

### Task 2.5：space（UP 主页）
**Files:**
- Create: `packages/engine/src/parser/space.ts`（mid → 视频列表，pn 分页）；`parser/index.ts` 注册
- Test: `packages/engine/tests/parser-space.test.ts`
**验收:** 真实 space 链接解析出 UP 投稿列表 → 选一条下载冒烟。

- [x] Task 2.5 已完成：parser/space.ts（mid 从 URL path 提取、keyword 从 query 提取；arc/search WBI 签名 + anti-spider 字段照抄桌面 space.py；ps=40、pn 可配；card?mid 取 UP 名并按 mid 进程内缓存）；ideo.ts 抽出共用 etchViewItems（view 按分P 展开，VideoParser 与 space/favlist 复用）；sync/map-limit.ts 并发窗口；parser/index.ts 注册 space。9 条单测（分类/平铺/角标/缓存/keyword/空列表/pn/错误映射/dispatch）绿；engine 147 测试全绿。
  **真网冒烟 PASS（.e2e-data-p2space，端口 8793）**：space.bilibili.com/2（碧诗）→ 51 条分P 叶子（约 1s）→ 选最短 11s 条目 → /api/media（DASH 480P/360P）→ 下载 715KB → ffmpeg 合并 → ffprobe h264+aac mp4。
  **期间新增前置 infra（P2 依赖，桌面已有而本项目缺失）**：pi/session.ts nsureAnonymousSession = 桌面 CookieManager.init_cookie_info 的 TS 移植（spi→buvid3/4、_uuid/b_lsid/b_nut、buvid_fp=murmur3_x64_128(UA,31) 已用 Python 生成向量对拍、GenWebTicket bili_ticket=HMAC-SHA256），Web 端 DownloadManager 首次解析前 await 引导（15 条单测）。仍缺 ExClimbWuzhi 激活（桌面异步、失败仅提示，未移植）；实测该 IP 上 arc/search 仍会间歇 412（属 B 站风控，cookie 只能降低概率无法消除），smoke 重试 2 次内通过。


**Task 2.5/2.6 关键决策（Web 扁平模型 x 桌面树模型）**：
桌面把 space/favlist 每行做成"外层容器行"：无 cid、标记 NEED_PARSE_BIT，勾选下载时由 ReparseWorker 二次解析该 bvid 再展开全部分P。
Web 已锁定"不引入树模型"，且 P1 闭环要求每条 MediaItem 自带 cid（/api/media 与下载都走 fetchPlayMediaInfo）。因此 space/favlist 解析时，对列表页每条投稿**并发调 view（x/web-interface/view）把该视频全部分P 平铺成叶子条目**（每条带 aid/bvid/cid/page/title/groupTitle/duration），角标与时长沿用桌面语义；单条 view 失败（已删除/私有等）跳过该行。解析一次最多多发 N 个 view 请求（N<=40，并发 4）。
差异记录：桌面先显示"视频行"再按需展开，Web 直接平铺为"分P 叶子"，这是"不引入树模型"决策下的等价映射（勾选叶子即下载单个分P/单集）。

### Task 2.6：favlist（收藏夹）＋ popular（每周必看）
**Files:**
- Create: `packages/engine/src/parser/favlist.ts`、`src/parser/popular.ts`；注册
- Test: `packages/engine/tests/parser-favlist.test.ts`、`parser-popular.test.ts`
**验收:** ml 链接/收藏夹与 popular 周榜真实解析 → 条目下载冒烟。

- [x] Task 2.6 已完成：parser/favlist.ts（fid=/ml 取 media_id、keyword 透传、x/v3/fav/resource/list 明文 ps=40 order=mtime、视频行经 expand 平铺分P、ogv/无 bvid 行跳过并记录）、parser/popular.ts（num 参数必填、wbi 签名 series/one、行自带 cid 直接映射叶子不发 view）；parser/expand.ts 抽出容器行→分P 共用展开（space 重构复用）；均已注册/导出。新增 7(favlist)+5(popular) 单测；engine 159 测试全绿。
  **真网冒烟 PASS（端口 8793）**：
  - popular：/v/popular/weekly?num=1 → 8 条（标题"第1期(0329更新)"）→ 选 29s 条 → DASH 2.6MB → ffmpeg → h264+aac。
  - favlist：space.bilibili.com/1315106040/favlist?fid=1579464940（默认收藏夹，10 条含多P 合集/失效视频）→ 163 条分P 叶子（失效行自动跳过）→ 选 81s 页 → DASH 1.2MB → ffmpeg → h264+aac。
  **说明**：匿名访问下 x/v3/fav/folder/created/list-all 对绝大多数 UP 返回空（需登录可见），本项目 favlist 冒烟用了一个可公开访问的收藏夹；桌面同样依赖登录可见性，非代码缺口。

### Task 2.7：watch_later / history（需登录类型）
**Files:**
- Create: `packages/engine/src/parser/watch-later.ts`、`src/parser/history.ts`；注册
- Test: `packages/engine/tests/parser-login-types.test.ts`
**验收:** 匿名调用返回 LOGIN_REQUIRED 映射冒烟；带 cookie fixture 正常解析。

- [x] Task 2.7 已完成：parser/guard.ts requireLogin（无 SESSDATA 前置抛 LOGIN_REQUIRED，不发请求，对齐桌面 check_login）；parser/watch-later.ts（bili23://watch_later，toview/web WBI 签名 ps=20，key 参数搜索；archive 行并发 view 平铺、bangumi 行收窄为单集番剧叶子并记录）；parser/history.ts（bili23://history，history/search 明文 GET business=archive ps=20，archive 行平铺）；接口 -101 映射 LOGIN_REQUIRED；均已注册/导出。新增 7 条单测（匿名拦截不发请求/带 SESSDATA 解析/搜索词/会话失效映射/dispatch）；engine 166 测试全绿。
  **真网冒烟 PASS**：引擎直连与 HTTP API（端口 8793）匿名调用 ili23://watch_later、ili23://history 均返回 401 LOGIN_REQUIRED（不发任何 B 站请求）；带 cookie 解析以 mock fixture 单测覆盖（本机无登录态 cookie 可实测，web 层 cookie 配置属后续）。

### Task 2.8：互动视频子类
**Files:**
- Modify: `packages/engine/src/parser/video.ts`（识别互动标记，attribute 预留）＋ `types.ts` 可选 `interactive` 标记
- Test: `packages/engine/tests/parser-video.test.ts` 增补
**验收:** 真实互动 BV 与普通视频一致完成下载（无额外取流差异）。

- [x] Task 2.8 已完成：parser/video.ts ViewResponse 增加 ights.is_stein_gate，检测到互动视频时叶子打 interactive:true（MediaItem.interactive 已预留）；取流形态不变（www flavor，桌面需用户确认后才探查全图节点，P2 仅做标记+常规下载，全图下载不在范围）。parser-video.test 增补 2 条（互动标记/普通无标记）；engine 168 测试全绿。
  **真网冒烟 PASS（端口 8793）**：BV1UE411y7Wy（你被困在2019年10月25日，互动多结局）view is_stein_gate=1 → 引擎解析叶子 interactive=true → HTTP 下载根节点（29s，DASH 3.2MB）→ ffmpeg → h264+aac。

### Task 2.9：web 层类型透传 + P2 出口回归
**Files:**
- Modify: `apps/web/src/client/types.ts`（type union 透传）、`server/routes.ts`/`download-manager.ts`（若有模型字段引用需同步）
- 回归: `pnpm check` 全绿；`apps/web/scripts/e2e-smoke.mjs` 扩展 P2 类型各一条解析冒烟
**验收:** P2 全部任务勾选；各类型解析+下载冒烟记录于本计划；整版 commit + push（信息 `feat: P2 ...`）。

---

## 自检记录
- P2 出口可观察：每类型"解析出可勾选项 → 下载出文件"。匿名不可达类型以明确错误映射冒烟，不伪造成功。
- 模型扩展不得破坏 P1 的 downloader/ffmpeg/store 行为；P1 测试全绿是回归闸门。
- 命名/目录规则（P3）不在本计划范围。
