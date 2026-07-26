# ADR-179: 更新安装拉起（按平台分级）

> **状态**: 实施中（阶段 1 已落地：含安卓优先完整拉起 DownloadApk+installApk 全链路；阶段 2 桌面下载器 DownloadAndRunInstaller 待排期）
> **日期**: 2026-07-25
> **关联**: ADR-157（关于页瘦身：仅版本/链接/更新）、ADR-176（前端 Backend 适配器双实现）、ADR-177（Web Loader 与主应用统一路径）、ADR-178（能力矩阵宿主键）、ADR-017（安卓适配，platform 探测范式）
> **前置**: ADR-176/177 已落地（`BackendService` 双适配器 + 能力缓存）；`CheckForUpdate` 契约现状（`internal/app/update.go`）
> **审核记录**: 2026-07-26 首轮审核 — 有条件通过（4 P2 + 3 P3）；同日落实 P2-1/2/3 + P3-1/2，P2-4 撤回（`_p()` 已代理路由）

## 背景

关于页（`settings-about.ts:99–183`）已有完整「更新」卡片：自动检查开关 `SetUIAutoUpdate` + 手动「检查更新」`CheckForUpdate` + 有新版时显示「去下载」链接。但核查结论显示：**当前两端都只做到「检查 + 跳转到 GitHub 释放页」，没有任何自动下载或拉起安装逻辑**。

事实核查：

| 位置 | 现状 |
|------|------|
| `internal/app/update.go:33–47` | `CheckForUpdate` 只查 `releases/latest`，返回 **release 页面 URL（`html_url`）**，非 asset 直链；无下载、无安装 |
| 桌面 / 安卓端 | 共用同一份 `update.go`，`CheckForUpdate` 两端逻辑完全一致（同一 Go `App` 方法） |
| `frontend/src/core/backend/browser-adapter.ts:760–763` | Web 端直接 stub `available:false`（Web 无安装概念，正确） |
| `build/android/app/src/main/java/com/wails/app/WailsBridge.java:527` | 安卓原生仅有 `Intent.ACTION_VIEW` 打开 URL，**无 apk 安装 Intent**（`setDataAndType(..., application/vnd.android.package-archive)` 缺失） |
| `internal/app/*` | 无任何 release asset 解析 / 文件下载代码（`io.Copy` 仅服务于代理、场景、zip 提取） |

核心缺口：`UpdateCheckResult` 不携带可下载的安装包直链，前端只能在「有更新」时把用户引流到 release 页面手动下载；平台侧的「下载 + 拉起安装」完全是空白能力。

## 决策

对关于页更新体验做**按平台分级**增强，原则为「扩展契约、不推翻现状」：

1. **保留**「检查 + 跳转链接」作为兜底基线（ADR-157 已确定的正确形态）。
2. **安卓端优先做完整拉起**：自动下载 apk + 拉起系统安装器（`ACTION_VIEW` + `application/vnd.android.package-archive`），无 UAC 怪圈，用户点一次「未知来源」授权即可。
3. **桌面端只做「自动下载 + 提示运行」**：下载安装包到临时目录后提示用户运行，**绝不静默安装**（避免 UAC 失控、保留退出权与回滚路径）。
4. **Web 端保持 stub**：永不提示更新、无安装概念。
5. 扩展 `CheckForUpdate` 的返回结构（加 `downloadUrl`/`assetName`），前端按 `downloadUrl` 是否存在切换「下载并安装」/「去下载页」；**不新增破坏性变更**，139 个契约函数不受影响（除非阶段 1 决定新增 `DownloadAndInstall` 绑定，见下）。

## 精确改法（待批准）

### ① `internal/app/update.go` —— `UpdateCheckResult` 扩展 + asset 解析

结构体末尾追加（保留原 `URL` 作为兜底去下载页）：

```go
type UpdateCheckResult struct {
    Current   string `json:"current"`
    Latest    string `json:"latest"`
    Available bool   `json:"available"`
    URL       string `json:"url"`       // 既有：release 页面（兜底）
    // [doc:adr-179] 新增：asset 直链，供前端拉起安装
    DownloadURL string `json:"downloadUrl"` // 安装包直链（空 = 无拉起能力，回退 URL）
    AssetName   string `json:"assetName"`   // 文件名，如 MikuMikuAR-setup.exe / MikuMikuAR.apk
    Size        int64  `json:"size"`         // 字节，前端显示进度
    CheckedAt int64  `json:"checkedAt"`
    Error string `json:"error,omitempty"`
}
```

`CheckForUpdate` / `latestGitHubRelease` 扩展：解析 `release.assets[]`，按运行时平台选直链——

- 桌面（`runtime.GOOS`）：按 `GOOS/GOARCH` 匹配 asset（如 `MikuMikuAR-setup.exe`、`MikuMikuAR-darwin-arm64.dmg`、`MikuMikuAR-linux.AppImage`）。
- 安卓（`isAndroidPlatform()` 或 `runtime.GOOS == "android"`）：匹配 `*.apk`。
- 无匹配 `downloadUrl` 置空，前端自动回退到 `URL`。

新增两个后端方法（均属新绑定，需走契约）：

```go
// DownloadAndRunInstaller：桌面端下载安装包到 temp 并拉起安装向导（不静默装）。
func (a *App) DownloadAndRunInstaller() (*InstallResult, error)
// DownloadApk：安卓端下载 apk 到应用私有目录，返回本地路径（供 WailsBridge 拉起安装）。
func (a *App) DownloadApk() (*InstallResult, error)
```

下载统一经 `http.Client` + `io.Copy` 到 `os.TempDir()`（桌面）/ `app private dir`（安卓）；**带 SHA256 校验**（release asset 若提供 `digest` 则比对，否则仅大小校验），失败回退到 `URL`。

### ② `build/android/app/src/main/java/com/wails/app/WailsBridge.java` —— 新增 `installApk`

在既有 `ACTION_VIEW` 开 URL 旁（527 行）扩展：

```java
// [doc:adr-179] 拉起 apk 安装器
public void installApk(String path) {
    File f = new File(path);
    Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", f);
    Intent intent = new Intent(Intent.ACTION_VIEW);
    intent.setDataAndType(uri, "application/vnd.android.package-archive");
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
    ctx.startActivity(intent); // 未知来源授权失败 → 捕获并回退到 release 链接
}
```

需补：`AndroidManifest.xml` 的 `REQUEST_INSTALL_PACKAGES` 权限 + `fileprovider` 路径配置（若尚未声明）。

### ③ `frontend/src/core/backend/*.ts` —— 绑定分发

- `wails-bindings.ts`：导出 `DownloadAndRunInstaller` / `DownloadApk`（新增 `_p(...)` 条目）。
- `go-adapter.ts`：实现对应方法（直转 Go 绑定）；安卓宿主走 `DownloadApk`，桌面宿主走 `DownloadAndRunInstaller`。
- `browser-adapter.ts:760`：`CheckForUpdate` 的 `UpdateCheckResult` 补 `downloadUrl:''` / `assetName:''` 字段（始终空 → 回退链接），`DownloadAndRunInstaller`/`DownloadApk` 抛 `NotSupported` 或 no-op。

### ④ `frontend/src/menus/settings-about.ts` + `frontend/src/core/init.ts` —— UI 切换

- 更新卡片（:141–180）的 `CheckForUpdate` 回调：若 `r.downloadUrl` 非空，将「去下载」链接替换为「下载并安装」按钮，点击调 `DownloadAndRunInstaller()`（桌面）/ `DownloadApk()`（安卓，经 `isAndroidPlatform()` 选），并叠加下载进度态。
- `init.ts:204` 启动 toast（`showUpdateToast`）同理：有 `downloadUrl` 时按钮文案为「下载并安装」，否则「去下载页」。
- 下载中禁用按钮、失败捕获后回退显示 `r.url` 链接。

## 迁移计划

- **阶段 1（本 ADR 范围，安卓优先）**：`update.go` 扩 `UpdateCheckResult` + asset 解析；安卓 `DownloadApk` + `WailsBridge.installApk` + 权限/config；前端按 `downloadUrl` 切换按钮。桌面 `downloadUrl` 暂留空（回退链接），`DownloadAndRunInstaller` 可同阶段占位。
- **阶段 2（后续，可独立提交）**：桌面 `DownloadAndRunInstaller` 落地（下载 + `exec.Command` 拉起安装向导，UAC 由系统弹）；`update.go` 补全桌面平台 asset 命名约定。
- **阶段 3（收口）**：下载进度/校验/失败回退打磨；`docs/targets.md` 增补「更新安装」四端行为矩阵；契约测试补 `DownloadAndRunInstaller`/`DownloadApk` 的 FNV-1a method ID（若阶段 1 已新增绑定）。

> 阶段 1 若选择「先只加 `downloadUrl` 字段、暂不新增 `DownloadAndInstall` 绑定」（即下载动作仍由前端 fetch + 平台桥完成），则 **139 契约函数不受影响**，落地更轻；是否新增 Go 绑定由实施时按安卓桥范式（ADR-017）裁决。

## 风险与边界

| 等级 | 项 | 缓解 |
|------|----|------|
| 🟠 P2 | 桌面静默安装致 UAC 失控 / 回滚困难 | 决策硬约束：桌面**只下载 + 提示运行**，绝不静默装；安装器由用户点击触发 |
| 🟠 P2 | 下载中断 / 校验失败 | SHA256 校验 + 大小守卫；失败一律回退 `r.url` 链接，不阻塞 |
| 🟡 P3 | 安卓未知来源授权被拒 | `installApk` 捕获异常 → 前端回退「去下载页」+ 提示手动开启 |
| 🟡 P3 | asset 平台/架构匹配错（多 apk / 多安装包） | asset 命名约定 + 匹配单测；无匹配则 `downloadUrl` 空 |
| 🟢 P4 | Web 端误触发 | `browser-adapter` stub 恒 `available:false` + `downloadUrl:''`，前端不显示按钮 |
| ⚪ 架构红线 | 不推翻 `CheckForUpdate` 契约 | 仅扩展返回字段；Web 保持 stub；139 函数仅在新增加载绑定时才需同步 |

## 测试

- `app.contract.test.ts`：若阶段 1 新增 `DownloadAndRunInstaller`/`DownloadApk` 绑定，则补 FNV-1a method ID（当前 139 → +2 函数）；若仅扩字段则不触碰。
- `update.go` 单测：`latestGitHubRelease` 解析 assets 按平台选直链；无匹配时 `downloadUrl` 空。
- `backend.test.ts`：go-adapter / browser-adapter 的 `CheckForUpdate` 返回含新字段断言（browser 恒空）。
- E2E：安卓应用「检查更新 → 下载并安装」拉起系统安装器；桌面「检查更新 → 下载并提示运行」；Web 永远不提示。
