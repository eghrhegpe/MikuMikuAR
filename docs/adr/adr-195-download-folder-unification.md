# ADR-195: 下载文件夹统一修订（三平台系统下载目录 + 消除"二扫"）

> **状态**: 已立项 · 规划中（设计文档，待代码落地与单测）
> **日期**: 2026-07-27（初版）
> **关联**: ADR-181（下载管理面板，本 ADR 修订其定位与行为）、ADR-180 / ADR-183（网页 FSA 根目录授权）、ADR-176（BackendService 双实现 + 绞杀者模式）、ADR-182（纹理命名空间化）、ADR-057 / ADR-058（Shift-JIS 文件名兜底）
> **来源**: 用户复现①「下载管理面板扫描导入全部往场景里塞」②「暂存目录语义迷惑（暂存=会被清，实际保留原地）」③「根目录扫描逻辑混乱，该扫的不扫、二扫 UI 不一致」④「安卓/网页都应请求系统下载文件夹，而非自建暂存」。
> **编号说明**: 本修订最初误编号为 ADR-184，但 `adr-184-web-zip-encoding-and-bomb-guard.md`（ZIP 编码/炸弹防护）已占用该号；后顺延至 194 时与同期落地的 `adr-194-wind-physics-fix.md`（已完成）撞号，依「已完成文档保留稳定编号、规划中文档零成本顺延」原则，最终定号为 **195**。

**决策者**: Riku（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

**创建日期**: 2026-07-27

---

## 背景

ADR-181 的动机成立：取代脆弱的 `watchDir` fsnotify 机制，提供统一下载摄入入口。但其落地存在**命名误导、行为错配、键空间分裂（"二扫"）**三处结构性问题，用户实测后指出。

### 问题 1 — 命名全线误导（"下载"与"暂存"语义错配）

| 当前文案 | 实际行为 | 矛盾点 |
|---------|---------|--------|
| 菜单 `settings.downloads` = 「下载」 | 不下载，扫本地目录 | 「下载」暗示网络获取，实为本地扫描 |
| 面板「暂存目录」 | 倒入源目录，文件**保留原地**只加标记 | 「暂存」= 临时/会被清，实际长期保留 |
| 面板「已处理文件」 | 仅一个"清理已处理记录"按钮 | 名承诺"列表"，实无列表 |

### 问题 2 — 行为错配：批量摄入耦合"加载到场景"

`settings-downloads.ts` 主循环对每个文件调用 `importFileByPath`（`library-actions.ts`，契约为单文件交互式导入：拖放/点击），其内部 `loadManager.load({ kind: 'actor' })` 把模型**加载为活动模型进场景**。

- 后果①：N 个 PMX 被**串行加载进场景、互相替换**，最终仅最后一个在屏；前 N-1 个是浪费的加载/卸载抖动，潜在 dispose 竞态。
- 后果②：裸 `.pmx/.vmd` 经此路径**只进场景、不写资源库**（`loadManager` 不注册库），与 ADR-181「写入资源库」本意背离；可能闪一下即被覆盖，库里根本没它。仅 `.zip` 走 `ImportZip` 才真写库（但仍额外把主 PMX `loadManager.load` 进场景）。

### 问题 3 — "二扫"：两套互不连通的键空间与去重

项目存在两套扫描/入库管线，各自为政：

| 维度 | 管线 A：模型库（`ScanModelDir` / `_listModels`） | 管线 B：下载面板（`runDownloadManager`） |
|------|-----------------------------------------------|----------------------------------------|
| 扫哪 | 用户选的 resource-root（FSA 句柄 / 磁盘扫描） | 用户选的"暂存目录"（`_stagingFsaIdbKey` / 桌面 `SelectDir`） |
| 写哪 | `entry:` / `dir:` 键（列表可读） | `dl:file:` 旁路键 + `imported:<hash>` 标记（列表**读不到**） |
| 去重 | 基于 `entry:` 存在性 | 基于 `imported:<hash>` / `.imported.json`（独立账本） |
| 入库 | 写库 → 模型库可见 | 裸 pmx 走 `importFileByPath` → 进**场景**（不写库） |

`_listModels`（`browser-adapter.ts:390`）**只列 `entry:` 前缀**。下载面板写入的 `dl:file:` / `imported:` 账本对模型库完全不可见 —— 这就是用户所述「该扫的不扫、扫了 UI 二扫逻辑又不一样」的根因。

### 问题 4 — 平台来源定位缺失，且安卓能力误判

- **桌面**：`pathmgr_desktop.go:44` `DownloadsDir()` 直接返回系统 `~/Downloads`，桌面有 FS 权，**本可直接用**，却让用户"选择暂存目录"是多此一举。
- **网页**：已有 FSA 授权机制（ADR-180/183 的 `getFsaAuthState` / `restoreFsaRootHandle` / `reauthorizeFsaRoot`），下载面板却**另持一套 `_stagingFsaIdbKey`**，与模型库授权不互通。
- **安卓**：`localStaging: !isAndroidPlatform()` 恒为 `false`，UI 显示死提示"Android：需 SAF 授权（待实现）"。但实测安卓**已有** `MANAGE_EXTERNAL_STORAGE` 权限（AndroidManifest 已声明）+ Go 侧标准 `os` 文件 IO（`fileaccess_android.go:35/42/49`），可直读 `/sdcard/Download`——**无需新建 SAF**（推翻早期"必须 SAF"的过重判断）。`pathmgr_android.go` 的 `DownloadsDir()` 仅返回 `""`，是未接路径，非缺授权。

---

## 决策

### 决策 1 — 命名正名（纯 i18n，零逻辑风险）

| 现文案（key） | 改为 | 理由 |
|--------------|------|------|
| `settings.downloads` | **下载文件夹**（保留「下载」心智，用户确认对多数用户好理解） | 不下载但词易理解；面板语义对齐"系统下载文件夹" |
| `downloads.stagingDir` | **下载文件夹** | "暂存"误导（见问题 1） |
| `downloads.pickStagingDir` | **选择下载文件夹** | 同上 |
| `downloads.manageImported` | **导入记录** | 该区块仅"清理"按钮，现名承诺未兑现的列表 |
| 新增 `downloads.supportedHint` | "支持 PMX / VMD / 音频 / ZIP，将递归扫描子目录" | 解决"扫啥不知道"（问题 3 用户痛点） |
| 扫描前预览 | 弹"将导入 N 个文件"清单（按扩展名分组） | 解决盲扫 |

### 决策 2 — 三平台下载文件夹定位（差异化复用既有能力）

| 平台 | 下载文件夹来源 | 授权机制 | 工作量 |
|------|--------------|---------|--------|
| 桌面 | 系统 `~/Downloads`（`pathmgr_desktop.go:44` `DownloadsDir()`） | 无需授权（桌面有 FS 权） | **零**（直接读，移除"选暂存目录"强制步骤，保留"改用其他目录"可选） |
| 网页 | 系统 Downloads（用户 FSA 选一次 + 句柄持久化） | **复用 ADR-180/183**：`getFsaAuthState` / `restoreFsaRootHandle` / `reauthorizeFsaRoot`；下载面板**不再单独持有 `_stagingFsaIdbKey`**，与模型库共用 FSA 授权 | **复用** |
| 安卓 | `/sdcard/Download` | **复用 shared 模式**（`MANAGE_EXTERNAL_STORAGE` 已声明）+ 标准 `os.ReadDir` 直读；`pathmgr_android.go` 新增 `DownloadDir()` 返回 `/sdcard/Download` | **低**（加路径定位 + 前端绑定，无需 SAF） |

**安卓代价（诚实说明）**：下载面板依赖 shared 模式开启（`SetStorageMode("shared")` + 权限已授予）。private 模式下 `/sdcard/Download` 不可达，UI 需提示"需开启共享存储模式"或引导切换。

### 决策 3 — 消除"二扫"：合并键空间，复用模型库入库逻辑

下载面板扫描到的文件，**不再写 `dl:file:` 旁路 + `imported:<hash>` 独立账本**，改为直接复用模型库的入库函数与键空间：

- **网页**：裸 `.pmx/.vmd` → 复用 `_writeModelFile`（`browser-adapter.ts:467`，写 `file:`+`entry:` 键，**不加载场景**）；`.zip` → 复用 `ImportZip`（写 `dir:`/`outfit:` 键）。删除 `_stagingFsaIdbKey` + `dl:file:` 写入。
- **桌面 / 安卓**：扫描下载文件夹后，将文件**复制到库的扫描根（resource-root）**，由现有的 `ScanModelDir` / 磁盘扫描统一发现。删除 `.imported.json` 独立账本。
- **去重统一**：以 `entry:` 键存在性（网页）或 resource-root 内文件已存在（桌面/安卓）为唯一判据，删除 `imported:<hash>` / `.imported.json` 第二套账本。

结果：下载文件夹的内容**直接进模型库列表可见**，与"手动导入"行为完全一致，且只有一套扫描、一套键空间、一套去重。

### 决策 4 — 行为解耦：批量摄入只入库、不加载到场景

- **删除** `settings-downloads.ts` 中对 `importFileByPath` 的全部调用（`:203` 网页裸文件 / `:260` 桌面 zip 主 PMX / `:263` 桌面裸文件）。
- 批量摄入语义 = **注册进资源库**（写 `entry:`/`dir:` 键或复制进 resource-root），**不** `loadManager.load` 进场景。用户从模型库点选再加载。
- `importFileByPath` 单文件拖放/点击导入行为**保持不变**（仍加载进场景，符合其交互契约）。

### 决策 5 — 倒入源语义（移动 / 复制 / 原地注册）— 待议会拍板

下载文件夹是"倒入源"，库是"目的地"。文件如何从源到目的地，三选项：

- **A（推荐）：复制到库根**——网页写 `entry:`/`dir:` 键（已是复制语义）；桌面/安卓复制到 resource-root。源文件保留在下载文件夹。库立即可见，零破坏，双份空间占用可接受（模型文件通常不大）。
- **B：移动到库根**——源文件移出下载文件夹，释放空间；但破坏用户下载目录，且中断其他下载工具对该文件的引用。
- **C：原地注册（仅网页可行）**——网页写 `entry:` 键指向原 `file:` 字节（不复制）；桌面/安卓需让库扫描包含下载文件夹（又引入"二扫"风险，不推荐）。

> 默认落 A。B/C 待用户确认是否采用。

---

## 影响面与验证

| 改动文件 | 内容 |
|---------|------|
| `frontend/src/menus/settings-downloads.ts` | 删除全部 `importFileByPath` 调用（`:203/:260/:263`）；裸文件改调 `_writeModelFile` / 复制逻辑；删 `dl:file:` 写入（`:194`）；删 `imported:<hash>` 账本（`:104/:289`）；接入三平台下载文件夹来源（决策 2）；扫描前预览（决策 1） |
| `frontend/src/core/backend/browser-adapter.ts` | `_writeModelFile`（`:467`）提升为公开 `ingestModelFile`（供下载面板复用，已写 `entry:` 不加载场景）；删 `_stagingFsaIdbKey` 独立授权，改读 ADR-180/183 FSA 句柄；`ImportZip` 保留（写库不加载场景） |
| `frontend/src/core/backend/go-adapter.ts` | 桌面/安卓路径：扫 `DownloadsDir()` / `pathmgr_android.DownloadDir()`；复制进 resource-root；删 `.imported.json` 账本；`localStaging` 改为安卓 shared 模式下可用 |
| `internal/app/pathmgr_android.go` | 新增 `DownloadDir() string { return "/sdcard/Download" }`（shared 模式下经 `MANAGE_EXTERNAL_STORAGE` 可访问） |
| `frontend/src/core/i18n/locales/*` | 决策 1 正名键（`downloads.stagingDir`→下载文件夹 等）+ 新增 `downloads.supportedHint` |
| `docs/adr/adr-181-download-manager-panel.md` | §决策 第 3 步补"批量摄入仅入库、不加载到场景"；命名澄清 |

**验证计划**：
- 网页：`browser-adapter.test.ts` 扩展（ingestModelFile 入库后 `_listModels` 可见、不触发 loadManager）。
- 桌面/安卓：新增复制进 resource-root + `ScanModelDir` 发现的集成用例（Go 侧 `fileaccess_android_test.go` / `pathmgr_android_test.go`）。
- 契约：`app.contract.test.ts` 确认绑定数稳定（142 methods，新增 `DownloadDir` / `SelectDownloadDir` 按需）。
- `npm run check:docs`（ADR 索引同步 + 架构树完整性）通过；`npm run check:funcmap` 函数签名无漂移。

---

## 遗留 / 注意

- **安卓 shared 模式依赖**：下载面板在安卓仅在 shared 模式可用（private 模式不可达 `/sdcard/Download`）。UI 需明确提示，不在文档范围外强行降级。
- **倒入源语义默认 A（复制）**：若用户改选 B（移动），需额外处理"下载中文件被移动"的竞态（下载工具持有句柄）。
- **历史 `dl:file:` / `imported:` 残留数据**：迁移时旧键可保留（无害，库不读），或加一次性清理；不阻塞本 ADR 落地。
- **与 ADR-181 关系**：本 ADR 是 ADR-181 的**定位与行为修订**，非推翻；ADR-181 的"取代 watchDir、统一摄入入口"动机与架构保留。
- **扫描前预览 UX**：决策 1 的"N 个文件"清单需从递归扫描结果聚合，不增加 O(n) 之外的开销（扫描本就 O(n)）。
