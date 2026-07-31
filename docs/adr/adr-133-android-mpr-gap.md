# ADR-133: Android MPR 多线程物理缺失——构建门控与架构障碍

- **状态**：⚠️ 决策二证伪 — Android WebView 平台限制，SPR 单线程为 Android 终态（2026-07-31 真机验证）
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

### 决策二：架构障碍修复（⚠️ 2026-07-31 真机证伪）

架构障碍的根因是 **Android WebView 资源服务路径不经过 Go HTTP 中间件**。

| 环节 | Windows（WebView2） | Android（WebView） |
|------|--------------------|--------------------|
| 主文档服务 | Go `AssetFileServerFS` → `CoopCoepMiddleware` 包裹 → 响应头带 COOP/COEP | Java `WebViewAssetLoader` + `WailsPathHandler` → `shouldInterceptRequest` 返回 `WebResourceResponse` |
| COOP/COEP 注入 | ✅ `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` | ✅ 已在 `shouldInterceptRequest` 注入（代码层面） |
| 运行时 `crossOriginIsolated` | `true` | **`false`（真机实测，注入无效）** |
| `SharedArrayBuffer` 可用 | ✅ | **❌** |
| WASM 物理模式 | MPR（多线程） | **SPR（单线程，强制回退）** |

**当时的修复方案（方案 A）**：在 `MainActivity.java` 的 `shouldInterceptRequest` 中，对所有 `wails.localhost` 响应统一追加 COOP/COEP 响应头。

**✅ 真机验证结果（2026-07-31）——方案 A 的前提假设被证伪**：

| 环境 | 徽标显示 | `crossOriginIsolated` | 结论 |
|------|----------|----------------------|------|
| Windows 桌面（WebView2） | `⚡MPR ×24` 🟢 | true | 正常 |
| 电脑网页版（Chrome + SW 注入） | `⚡MPR ×24` 🟢 | true | 正常 |
| eDog 内开安卓网页版（Chrome） | `⚡MPR ×8` 🟢 | true | 正常 |
| **Android APK（WebView）** | **`⚠ MPR? COI✗` 🟡** | **false** | **注入无效** |

**对照实验铁证**：同一份前端，在 eDog（真 Chrome）里加载安卓网页版即 `MPR×8` 绿，装进 APK（WebView）即 `COI✗` 黄。差别仅在**运行环境从 Chrome 换成 WebView**，证明前端代码/构建门控/注入代码均无误。

**根因**（Chromium issue [40914606](https://issues.chromium.org/issues/40914606)：“SharedArrayBuffer is unavailable in Android WebView because crossOriginIsolated is false”）：`crossOriginIsolated` 是**渲染进程级的浏览上下文状态**，由浏览器在建立顶层文档时根据进程隔离 + Agent Cluster 策略确定。**Android WebView 的多进程隔离模型不完整**，即使在 `shouldInterceptRequest` 把 COOP/COEP 头塞进 `WebResourceResponse`，WebView 也不会据此把上下文提升为跨源隔离——**拦截式响应的这两个头被忽略**。

**结论**：Android 端 MPR 不可达，SPR 单线程为该平台**终态**；`⚠ MPR? COI✗` 琥珀徽标为**预期显示**（非 bug，[scene.ts SPR 兜底]保障不崩窗、物理照跑）。`MainActivity.java` 的注入代码可保留（无害，且为未来 WebView 能力演进预留），但**不得再声称它使 COI 生效**。

---

## 约束

- **构建门控同轴**：Android 的 `VITE_MMD_WASM_MT` / `mpr` 标签须与 Windows 保持同一语义和默认值（关闭），避免意外行为差异。
- **运行时零回归**：架构障碍未修复前，Android 端物理行为 = SPR = 与 ADR-099 落地前一致。不存在行为退步。
- **MPR 资源打包不可避免**：因 Vite 对动态 `import()` 一律打包为独立 chunk（已确认于 ADR-099），即使 `__MMD_ENABLE_MPR__` 为 `false`，MPR worker/wasm 仍物理存在于 APK 包内。Android APK 包大小增加约 ~1.2MB（未加载 wasm 资源）。当前可接受，后续可通过 alias 桩模块移除（与 ADR-099 后续项一致）。

---

## 验证

- ✅ 构建验证：`npx vite build` 退出码 0，产出含 `workerHelpers-*.js` + 2x `index_bg-*.wasm`（`build-android.ps1` 触发）
- ✅ Go 构建验证：`go build -tags "android,debug,mpr" -buildmode=c-shared` 退出码 0（`build-android-so.ps1` 触发）
- ✅ 代码层注入：`MainActivity.java` `shouldInterceptRequest` 对所有 `wails.localhost` 响应注入 COOP/COEP（2026-07-30）
- ❌ **真机运行时验证（2026-07-31）**：Android APK 内 `crossOriginIsolated=false`，徽标显示 `⚠ MPR? COI✗` 琥珀 — 注入无效，方案 A 证伪（见决策二）

---

## 未来出路（Android 多线程物理）

当前路径（WebView + `shouldInterceptRequest` 注入）已证伪。若未来要重提 Android 多线程，可选方向按成本排序：

| 方向 | 思路 | 可行性 | 成本 |
|------|------|--------|------|
| **① 等 WebView 升级** | 关注 Chromium issue 40914606，待 Android System WebView 支持拦截式 COOP/COEP 或提供显式跨源隔离开关 | 不可控，无时间表 | 零（等） |
| **② 内嵌自建 Chromium（GeckoView / Chromium Embedded）** | 抛开系统 WebView，打包完整渲染引擎，自己控制进程隔离策略 | 高（破坏 Wails v3 WebView 模型） | 极高，APK 膨胀 30MB+ |
| **③ 将物理下沉到 Go/原生层** | 不依赖浏览器 SAB，在 Go 侧跑 Bullet 多线程，结果回写前端 | 中（需重构物理桥） | 高，与 babylon-mmd 耦合度低 |
| **④ 接受 SPR 单线程（推荐）** | Android 移动端单人场景物理量有限，SPR 实测流畅；集中优化物理子步频率 | 即开即用 | 零 |

**当前决策**：选④。Android 为移动单人展示场景，SPR 单线程已能支撑；①零成本但不可控，可长期观望。②③ 投产比不划算，除非 Android 成为重度多人/布料密集场景的主战场。

---

## 涉及的文件

| 文件 | 改动 |
|------|------|
| `scripts/build-android.ps1` | 第 77 行新增 `$env:VITE_MMD_WASM_MT = "1"` |
| `scripts/build-android-so.ps1` | 第 67/69 行 `-tags` 追加 `mpr` |
| `build/android/app/src/main/java/com/wails/app/MainActivity.java` | ⚠️ 代码层已注入（`shouldInterceptRequest` 注入 COOP/COEP），但真机无效（WebView 忽略拦截式 COOP/COEP，见决策二） |
