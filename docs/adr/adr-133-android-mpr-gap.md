# ADR-133 Android MPR 多线程物理缺失——构建门控与架构障碍

- **状态**：部分落地（构建门控已补）、架构障碍延期
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

### 决策二：架构障碍延期（📋 待排期）

架构障碍的根因是 **Android WebView 资源服务路径不经过 Go HTTP 中间件**。

| 环节 | Windows（WebView2） | Android（WebView） |
|------|--------------------|--------------------|
| 主文档服务 | Go `AssetFileServerFS` → `CoopCoepMiddleware` 包裹 → 响应头带 COOP/COEP | Java `WebViewAssetLoader` + `WailsPathHandler` → `shouldInterceptRequest` 返回 `WebResourceResponse`（仅硬编码 `Access-Control-Allow-Origin`、`Cache-Control`、`Content-Type`） |
| COOP/COEP 注入 | ✅ `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` | ❌ 缺失 |
| 运行时 `crossOriginIsolated` | `true` | `false` |
| `SharedArrayBuffer` 可用 | ✅ | ❌ |
| WASM 物理模式 | MPR（多线程） | SPR（单线程，自动回退） |

**架构障碍的修复路径**（按侵入性升序排）：

| 方案 | 描述 | 难度 | 风险 |
|------|------|------|------|
| A. 在 `shouldInterceptRequest` 中注入 COOP/COEP 头 | 在 `MainActivity.java` 的 `shouldInterceptRequest` 方法中，拦截主文档请求并附加 COOP/COEP 响应头 | 中 | 较低；需确认 Android WebView 认可的 COOP/COEP 生效版本（Android 12+ 开始支持） |
| B. `WebViewAssetLoader.PathHandler` 代理模型文件（ADR-017 §六推荐方案）| 将模型文件从 HTTP 中转改为 `https://wails.localhost/models/...` PathHandler，搭配方案 A 可同时解决 mixed content 技术债（A0-01） | 中高 | 需改动 Java→JNI→Go 透传路径；已知 WailsPathHandler 当前仅代理静态资源 |
| C. 在 Go HTTP 侧改为全量代理 | 让 Go 端作为中间人接管所有 Android 资源请求，抛弃 `WebViewAssetLoader` | 高 | 严重侵入 Wails 框架逻辑，不推荐 |

**当前状态**：无排期。ADR-099 仅规划了桌面端的 MPR，Android 侧投入产出比目前不满足立项条件。

---

## 约束

- **构建门控同轴**：Android 的 `VITE_MMD_WASM_MT` / `mpr` 标签须与 Windows 保持同一语义和默认值（关闭），避免意外行为差异。
- **运行时零回归**：架构障碍未修复前，Android 端物理行为 = SPR = 与 ADR-099 落地前一致。不存在行为退步。
- **MPR 资源打包不可避免**：因 Vite 对动态 `import()` 一律打包为独立 chunk（已确认于 ADR-099），即使 `__MMD_ENABLE_MPR__` 为 `false`，MPR worker/wasm 仍物理存在于 APK 包内。Android APK 包大小增加约 ~1.2MB（未加载 wasm 资源）。当前可接受，后续可通过 alias 桩模块移除（与 ADR-099 后续项一致）。

---

## 验证

- ✅ 构建验证：`npx vite build` 退出码 0，产出含 `workerHelpers-*.js` + 2x `index_bg-*.wasm`（`build-android.ps1` 触发）
- ✅ Go 构建验证：`go build -tags "android,debug,mpr" -buildmode=c-shared` 退出码 0（`build-android-so.ps1` 触发）
- ⏳ 运行时验证（待架构障碍修复后）：Android WebView 内 `self.crossOriginIsolated === true` → `typeof SharedArrayBuffer !== 'undefined'` → 状态栏/右上角徽标显示 MPR
- 🔴 架构障碍阻断：当前 Android 端运行时 `crossOriginIsolated` 恒为 `false`，MPR 无法激活

---

## 涉及的文件

| 文件 | 改动 |
|------|------|
| `scripts/build-android.ps1` | 第 77 行新增 `$env:VITE_MMD_WASM_MT = "1"` |
| `scripts/build-android-so.ps1` | 第 67/69 行 `-tags` 追加 `mpr` |
| `build/android/app/src/main/java/com/wails/app/MainActivity.java` | 🔜 待修复（`shouldInterceptRequest` 注入 COOP/COEP） |
