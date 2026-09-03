# bili23-web 前端：开工前状态与交接（2026-09-04）

> 本文用于**上下文压缩/会话切换后快速恢复**。新会话请先读本文，再按需读：
> `docs/original-ui-baseline.md`（原版 UI/交互 1:1 基准）→ `docs/frontend-structure-plan.md`（前端结构与实现方案）→ 本文。
> 本文记录：目标、已完成沉淀、已确认决策、Mock 验收结论、仓库现状、待定决策、里程碑、工作约定与证据。

---

## 0. TL;DR（给新会话 30 秒恢复）

- 项目：把桌面版 Bili23-Downloader（PySide6/Fluent，v2.15.0）1:1 复刻成 TypeScript Web 服务，部署 NAS，浏览器使用。
- 后端：`apps/web`（Hono REST/SSE）已是纯后端可用状态；前端目前**尚未在 main 上实现**。
- 近期已做（未提交）：深读原版 → 写 UI 基线 → 写前端方案 → 做单文件 Mock → **用户验收通过**。
- 结论：可以开始正式前端实现（建议 P0 骨架起步），但开工前有三个技术决策待用户拍板（§7）。
- 关键文件位置与内容摘要见 §1、§2；仓库当前未提交改动见 §5。

---

## 1. 项目地图（路径速查）

| 对象 | 位置 | 说明 |
|---|---|---|
| 本地仓库 | `C:\LocalSpace\Projects\My-Proj\NAS-PROJECTS\bili23-web` | monorepo（pnpm workspace） |
| 远程 | `https://github.com/SakuraChiyo0v0/bili23-web.git` | GitHub；身份 `SakuraChiyo0v0` / `3296299414@qq.com` |
| 默认分支 | `main`（纯后端） | 当前所在分支 |
| 旧前端备份分支 | `backup/frontend-20260904` | **已废弃**，不参考、不复用、不移植 |
| 原版桌面源码 | `C:\LocalSpace\Projects\Github-Proj\Bili23-Downloader` | GitHub `ScottSloan/Bili23-Downloader`，main ≈ v2.15.0（commit `d32eecde`） |
| 原版远程 | `git@github.com:ScottSloan/Bili23-Downloader.git` | 行为基准（参照不复制代码） |

### 文档（docs/，全部未提交）
| 文件 | 性质 | 摘要 |
|---|---|---|
| `HANDOVER.md` | 原有交接（已小改） | 后端结构/部署/坑；§12 待办已更新为“按新文档重建前端” |
| `original-ui-baseline.md` | **新增·UI 基准**（799 行） | 从原版 PyQt 读出的 1:1 复刻基准：17 章（含 §15 决策、§17 移动端） |
| `frontend-structure-plan.md` | **新增·结构方案**（375 行） | 技术选型、目录、页面/弹窗设计、后端协作清单、里程碑 P0–P6、开放问题 |
| `frontend-kickoff-state.md` | **本文** | 当前状态与恢复指南 |

### Mock（纯前端，已验收）
| 对象 | 说明 |
|---|---|
| `mock/index.html` | 单文件纯前端骨架演示（无后端、无依赖，约 79KB） |
| `mock/shot-desktop.png` | 桌面 1440×900 截图 |
| `mock/shot-mobile.png` | 手机 390×844 截图 |

---

## 2. 已完成工作（这几轮会话做了什么）

### 2.1 通读既有交接
- 通读 `HANDOVER.md`：项目定位、纯后端阶段、旧前端备份分支、推送需无代理、Git 身份、node:sqlite 需 Node22+ 等。

### 2.2 深读原版 PyQt 客户端（为 1:1 复刻）
精读了 `C:\LocalSpace\Projects\Github-Proj\Bili23-Downloader` v2.15.0 的关键源码，覆盖：
- **主窗口/导航**：`gui/interface/main_window.py`（MSFluentWindow、懒加载、启动检查、关闭行为）。
- **三大页面**：`parse.py`（解析工作台全交互）、`download.py`（双列表）、`setting.py`（9 组设置）。
- **组件体系**：`gui/component/`（树/列表/卡片/设置卡/基础弹窗）、`widget/`（pager/search/segment/combobox…）。
- **弹窗全集**：`gui/dialog/`（下载选项三页、登录、设置子弹窗、misc、main_window）。
- **业务层**：parser 树模型、episode 展开、媒体预览、下载任务状态机、ffmpeg 合并、命名规则、CDN 选路、请求层、auth、SQLite 存储、启动流程。
- 成果已全部落进 `original-ui-baseline.md`，不必在此复述。

### 2.3 确认产品决策并落文档（baseline §15）
用户确认（原话归纳）：
1. **结构一致 1:1；Web 可加更多动效、可改配色** —— 信息架构/交互语义必须对齐，视觉可 Web 化。
2. **不需要短信登录** —— 登录只做扫码 + Cookie。
3. **分页/自动解析分页等交互需要保留**。
4. **桌面专属能力按映射/裁剪表执行**（baseline §14）。
5. **“使用协议”保留在 Web 端**（首次接受后继续，状态写配置）。

### 2.4 移动端响应式需求（baseline §17）
用户要求适配手机端、响应式。baseline §17 已写逐页面策略（底部 TabBar、树两列、Sheet 化弹窗、无 hover 依赖等）。

### 2.5 写前端结构方案
`frontend-structure-plan.md`：现状盘点（含后端 API 差距）、技术栈建议、目录结构、设计 token、页面/弹窗设计、动效、移动端落地清单、后端协作清单、P0–P6、开放问题。

### 2.6 确认旧前端废弃
用户明确：**老前端都废弃了**。已把 `HANDOVER.md` 与 `frontend-structure-plan.md` 里“可参考旧前端”表述全部改为“废弃、不参考、不复用、不移植”。

### 2.7 制作并验收单文件 Mock
`mock/index.html`：桌面侧栏/移动底栏 + 解析树（三态勾选、全选反选）+ 下载任务（双页签、模拟进度）+ 设置页 + 下载选项弹窗 + 登录 + 关于 + 主题切换；自带演示数据；打开即见效果。

### 2.8 Mock 验收结论（重要）
- **用户：可以，终于基本达到想法；整体效果不错，质量符合预期；可以开始。**
- 少量样式细节问题存在，但用户表示后期可针对性调整，**不影响进入正式实现**。

---

## 3. 验收过的 Mock 长什么样（供实现对齐）

- 桌面：左侧导航（解析/下载/收藏夹/关于/头像/设置），右内容区。
- 移动(<980px)：顶栏 + 底部 TabBar（解析/下载/我的/设置）。
- 解析页：输入框 + 解析(下拉批量) + 工具条 + 树（合集→章节→叶子，badge/时长/时间列）+ 底部下载。
- 下载页：下载中/已完成页签；任务卡（封面色块/标题/质量/大小/进度/状态/操作）；全部开始/暂停/清空。
- 设置页：6 组卡片（界面/下载/解析交互/附加内容/命名/高级）。
- 弹窗：登录（扫码模拟+Cookie）、关于、下载选项（媒体/附加/下载三页 + 底部“即将下载”chips）、命名规则、重复下载。
- 主题：浅/深、强调色、减弱动画。
- 技术手感：无组件库、CSS 变量设计 token、圆角卡片风（与 Fluent 近，非 B 站官网）。
---

## 4. 仓库现状与后端能力（新会话必读）

### 4.1 工作区状态
- 当前分支 `main`，**未提交改动**：
  - 修改：`docs/HANDOVER.md`
  - 新增：`docs/original-ui-baseline.md`、`docs/frontend-structure-plan.md`、`docs/frontend-kickoff-state.md`、`mock/`（index.html + 两张截图）
- 最近后端提交：`b6c6efa refactor(web): 清理前端依赖与静态托管配置并更新交接文档`（main 为纯后端）。

### 4.2 工具链
- Node v24.18.0、pnpm 11.15.1（workspace 单仓）。
- `apps/web`：Hono REST/SSE；脚本 dev:server/typecheck/test/build/start；Docker 部署见 deploy/。
- `packages/engine`：纯 TS 下载引擎。

### 4.3 后端 API（前端对接对象）
- `POST /api/parse`（解析）、`GET /api/media/:itemId`（媒体候选）
- `POST /api/download`、任务 `GET /api/tasks`、`GET /api/tasks/:id/events`（SSE）、`cancel/pause/resume/retry/delete`
- `GET/PUT /api/config`、`GET /api/files`、`GET /api/files/raw`
- `GET/POST/DELETE /api/auth`、`POST /api/auth/qr`、`POST /api/auth/qr/poll`
- 后端 `TaskStatus = queued|parsing|downloading|merging|paused|interrupted|completed|failed|cancelled`
- `DownloadOptions` 已覆盖：videoQualityId/codec/audioQualityId/container/downloadVideo/downloadAudio/mergeVideoAudio/keepOriginalFiles(+type)/优先级数组/extras(附加内容快照)/naming(命名+编号快照)

### 4.4 关键差距（前端实现会碰到，见 plan §10）
1. 解析“树”结构与**容器行再解析**语义是否已由 parse API 表达。
2. 任务状态比原版少 `CONVERTING/ADDITIONAL_PROCESSING/FFMPEG_QUEUED`（多 `interrupted/cancelled`）——需前端映射或后端补 phase。
3. SSE 事件协议/字段（进度、文件级、日志、完成移入历史）需约定。
4. 封面字段/缩略图；命名规则 CRUD；autoSelect/列设置；扫码二维码数据源；文件浏览呈现。
> 建议 P0 骨架阶段先不阻塞，联调时逐项核对；或先做一次“后端接口差距核对”。

---

## 5. 技术选型建议（plan §3，待拍板）

| 项 | 建议 | 理由 |
|---|---|---|
| 框架 | React 18 + TypeScript + Vite | 与既有生态/旧前端同栈、NAS 静态托管简单、自绘易控 |
| 路由 | hash 路由（`#/parse`…） | 静态托管无服务端 rewrite；移动返回键可用 history |
| 样式 | CSS 变量设计 token + CSS Modules/手写 | 贴 Mock/原版观感；重组件库反而难控 |
| 状态 | zustand（或 Context） | 轻量，任务/配置/登录跨页共享 |
| UI 库 | 不引入重型组件库 | 大量自绘（树、卡片、Sheet） |

> 仍开放：①任务状态机后端补 or 前端映射；②配色主题是否沿用 Mock；③是否 Tailwind 混用。

---

## 6. 里程碑（plan §11，开工顺序建议）

- **P0 工程骨架**：Vite+React 接入 apps/web；hash 路由；桌面侧栏/移动底栏布局；主题 token；Toast；使用协议。
- **P1 解析主链路**：输入→parse→树（三态勾选）→批量建任务→下载页。
- **P2 下载/任务页**：双页签 + SSE + 暂停/继续/重试/删除 + 排序 + 批量。
- **P3 下载选项弹窗**：三页 + 媒体预览 + 预览条 + 手机 Sheet。
- **P4 设置页全量**：全部分组 + 命名规则编辑器 + CDN/代理/UA/样式弹窗。
- **P5 登录/收藏夹/关于/协议**：扫码+Cookie、用户卡、收藏夹 Flyout。
- **P6 细节打磨 + 移动端**：misc 弹窗、暗色、动效、触控、性能。

> 每期可独立验收。桌面优先，移动端并行降级。

---

## 7. 开工前待用户拍板的决策

1. **本次是否提交“沉淀成果”**（文档 + mock），以及提交信息；提交需用户明确授权（见 §9 边界）。
2. **任务状态机**：后端补 phase 字段（推荐）还是前端先做文案映射。
3. **技术栈是否按 §5 拍板**（React18+Vite+手写 CSS+hash 路由；默认不复用旧前端）。
4. **P0 是否立即开工**，还是先做“后端接口差距核对”再开工。

---

## 8. 下一步（若用户说“开工”）

1. 先提交当前文档 + mock（授权后）。
2. 拍板 §7 决策。
3. 搭 P0：在 `apps/web` 下新建前端（Vite/React），布局结构对齐 Mock 与 plan §6。
4. 用 Mock 作为视觉与交互参考，逐步替换为真实组件与 API。

---

## 9. 工作约定（重要，务必遵守）

### 9.1 Git/平台
- 仓库 GitHub；身份 `SakuraChiyo0v0` / `3296299414@qq.com`。
- **推送前用无代理**：`git -c http.proxy= -c https.proxy= push origin main`。
- 提交/推送/创建 PR/合并/发布/部署是**独立权限**，用户未明确授权不得执行。

### 9.2 用户偏好（来自历史记忆）
- 最小必要改动；改用户可观察行为前先确认。
- 只做明确要求范围；发现相邻问题只报告不顺手修。
- 面向人类决策写文档（结论先行、术语解释、前后对照、可验证）。
- 中文交流（本项目与用户均为中文）。
- 用户强调：宁可少做不要假功能；原版能做的都要做。

### 9.3 验证要求
- 改后端/前端后跑 `pnpm check`（typecheck+test+build）。
- 改动前可先读原版/文档；UI 改动建议用 mock 或浏览器验证。
- 完成即汇报：改了哪些文件、验证结果、范围是否一致、未处理风险。

---

## 10. 上下文压缩后，第一件事建议

1. 读本文件 §0–§7；
2. 查看 `git status`（应仍是 §4.1 的未提交集合）；
3. 问用户是否提交沉淀 + 拍板 §7；
4. 不要直接开始写正式前端代码，除非用户说“开工/开始 P0”。
