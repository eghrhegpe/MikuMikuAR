# ADR-133: Android MPR 多线程物理缺失——构建门控与架构障碍

- **状态**：✅ 已完成（构建门控 + 架构障碍均已修复）（2026-07-30）
- **日期**：2026-07-18
- **相关**：ADR-099（MPR/COOP/COEP 桌面端）、ADR-017（Android 平台适配）

---

## 问题

Android 构建的 APK 始终无法启用 WASM 多线程物理（MPR），无论 `scene.ts` 的 fallback 逻辑多完备，运行时始终回退到单线程 SPR。

表现为两个层面：

| 层面 | 问题 | 发现时间 |
|------|------|---------|
| **构建门控缺失** | `build-android.ps1` 未设 `VITE_MMD_WASM_MT`，`build-android-so.ps1` 的 `-tags` 不含 `mpr` | 2026-07-18 审计发现 |
| **架构障碍** | Android 使用 `WebViewAssetLoader` 提供主页面，完全绕过 Go 的 `CoopCoepMiddleware` → 主文档永远拿不到 COOP/COEP 响应头 → `crossOriginIsolated` 恒为 `false` → `SharedArrayBuffer` 不可用 | 2026-07-18 审计发现 |

---

## 决策

### 决策一：补齐构建门控（✅ 已执行）

在 `build-android.ps1` 和 `build-android-so.ps1` 中补上 MPR 构建门控，使构建链路与 Windows 一致：

| 脚本 | 改动 | 效果 |
|------|------|------|
| `build-android.ps1:77` | `npx vite build` 前设 `$env:VITE_MMD_WASM_MT = "1"` | 前端 `__MMD_ENABLE_MPR__` = `true`，MPR worker/wasm 编入包 |
| `build-android-so.ps1:67,69` | `-tags` 追加 `mpr`（生产 `production,android,mpr`，调试 `android,debug,mpr`） | Go 端 `mpr_on.go` 被选中，`coopCoepEnabled = true` |

**意义**：构建链路上不再遗漏，APK 确实包含 MPR 所需的所有二进制资源。

**局限**：由于架构障碍未解决，运行时 `crossOriginIsolated` 仍为 `false`，`scene.ts` 的 `useMultiThread` 守卫依然走 else 分支 → SPR 回退。补门控是「表面功夫」——为将来架构修复铺路，不改变当前行为。

### 决策二：架构障碍修复（✅ 已执行 2026-07-30）

架构障碍的根因是 **Android WebView 资源服务路径不经过 Go HTTP 中间件**。

| 环节 | Windows（WebView2） | Android（WebView） |
|------|--------------------|--------------------|
| 主文档服务 | Go `AssetFileServerFS` → `CoopCoepMiddleware` 包裹 → 响应头带 COOP/COEP | Java `WebViewAssetLoader` + `WailsPathHandler` → `shouldInterceptRequest` 返回 `WebResourceResponse` |
| COOP/COEP 注入 | ✅ `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` | ✅ 在 `shouldInterceptRequest` 中对所有 `wails.localhost` 响应统一注入（2026-07-30） |
| 运行时 `crossOriginIsolated` | `true` | `true`（待真机验证） |
| `SharedArrayBuffer` 可用 | ✅ | ✅（待真机验证） |
| WASM 物理模式 | MPR（多线程） | MPR（多线程，待真机验证） |

**修复方案**：方案 A — 在 `MainActivity.java` 的 `shouldInterceptRequest` 中，对所有 `wails.localhost` 响应统一追加 `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` 响应头。

**安全性论证**：所有前端资源均从 `wails.localhost` 同源加载；模型文件经 `readFileBytes` + Blob URL（ADR-017 A0-01 根治后无 http:// 子资源）；模型广场经 Go 代理同源转发。`require-corp` 不会误伤任何现有资源加载路径。

---

## 约束

- **构建门控同轴**：Android 的 `VITE_MMD_WASM_MT` / `mpr` 标签须与 Windows 保持同一语义和默认值（关闭），避免意外行为差异。
- **运行时零回归**：架构障碍未修复前，Android 端物理行为 = SPR = 与 ADR-099 落地前一致。不存在行为退步。
- **MPR 资源打包不可避免**：因 Vite 对动态 `import()` 一律打包为独立 chunk（已确认于 ADR-099），即使 `__MMD_ENABLE_MPR__` 为 `false`，MPR worker/wasm 仍物理存在于 APK 包内。Android APK 包大小增加约 ~1.2MB（未加载 wasm 资源）。当前可接受，后续可通过 alias 桩模块移除（与 ADR-099 后续项一致）。

---

## 验证

- ✅ 构建验证：`npx vite build` 退出码 0，产出含 `workerHelpers-*.js` + 2x `index_bg-*.wasm`（`build-android.ps1` 触发）
- ✅ Go 构建验证：`go build -tags "android,debug,mpr" -buildmode=c-shared` 退出码 0（`build-android-so.ps1` 触发）
- ✅ 架构障碍修复：`MainActivity.java` `shouldInterceptRequest` 对所有 `wails.localhost` 响应注入 COOP/COEP（2026-07-30）
- ⏳ 运行时验证（待真机）：Android WebView 内 `self.crossOriginIsolated === true` → `typeof SharedArrayBuffer !== 'undefined'` → 状态栏/右上角徽标显示 MPR

---

## 涉及的文件

| 文件 | 改动 |
|------|------|
| `scripts/build-android.ps1` | 第 77 行新增 `$env:VITE_MMD_WASM_MT = "1"` |
| `scripts/build-android-so.ps1` | 第 67/69 行 `-tags` 追加 `mpr` |
| `build/android/app/src/main/java/com/wails/app/MainActivity.java` | ✅ 已修复（`shouldInterceptRequest` 注入 COOP/COEP，2026-07-30） |
