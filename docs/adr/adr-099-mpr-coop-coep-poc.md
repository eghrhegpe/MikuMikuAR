# ADR-099: babylon-mmd 未利用 API 接入 · Item 4 MPR 多线程 WASM 物理（Go 端 COOP/COEP 注入 POC）

**日期**：2026-07-13
> **状态**: 实施中（Go 端 COOP/COEP 注入已提交 `c2a0734`；前端 `MmdWasmInstanceTypeMPR` 切换已落地并通过构建验证；待真机 WebView2 验证 `crossOriginIsolated` + `SharedArrayBuffer`）
> **关联**: `docs/research/babylon-mmd-api-analysis.md`（未利用 API 调研，本项来源）、ADR-098（同批 babylon-mmd 接入批次一，已提交 `b604f15`）、ADR-056（Motion Layers / WASM 物理基础）
> **影响面**: `internal/app/zipextract.go`、`main.go`、`internal/app/coep_middleware_test.go`（Go 半侧）；`frontend/src/scene/scene.ts` + `vite-env.d.ts` + `vite.config.ts`（前端侧已落地）

---

## 问题

`docs/research/babylon-mmd-api-analysis.md` 调研出 5 个 babylon-mmd 已提供、项目未利用的高价值 API。按风险递增分批推进，**Item 4 为 `MmdWasmInstanceTypeMPR`（多线程 WASM 物理）**，当前 `scene.ts` 仍用单线程的 `MmdWasmInstanceTypeSPR`。

| # | API | 现状问题 |
|---|-----|---------|
| 4 | `MmdWasmInstanceTypeMPR` | 多线程物理实例，可并行解算刚体/约束，性能显著优于 SPR；但依赖 `SharedArrayBuffer`，要求顶层文档跨源隔离（`COOP: same-origin` + `COEP: require-corp`），项目当前两响应头均未注入 |

### 根因

1. **跨源隔离缺失**：`SharedArrayBuffer` 在浏览器中可用性的硬性前提是响应头带 `Cross-Origin-Opener-Policy: same-origin` 与 `Cross-Origin-Embedder-Policy: require-corp`。项目（Wails v3 + WebView2）从未注入，故 SAB 不可用，MPR 无法启用。
2. **research 原 POC 路径不完整**：调研报告 §八/§五 P0 仅写「在 `basenameFallbackFS` 注入 COOP/COEP」，但实际前端主页面由 Wails 的 `application.AssetFileServerFS(assets)`（`main.go:32`，embed `frontend/dist`）服务，而 `basenameFallbackFS` / `StartFileServer` 仅服务**运行期**模型/贴图目录（且当前无调用方，属预留接口）。`SharedArrayBuffer` 要求**顶层文档**跨源隔离，仅给资产文件服务器加头无效——必须包住 `AssetFileServerFS`。
3. **前端切换被构建阻断（根因已修正）**：引入 `MmdWasmInstanceTypeMPR` → 拉入 `babylon-mmd/.../wasm/mpr/index.js` → 其 `workerHelpers.js` 含 `new Worker(new URL('./workerHelpers.js', import.meta.url), { type: 'module' })` 且内部有动态 `import('../../..')`，强制该 worker 包产出 **>1 chunk**。Vite 默认 `worker.format = 'iife'`（`config.worker.format`，Vite 6 为**顶层 `worker` 选项**，`build.worker` 被忽略），而 Rollup `validateOptionsForMultiChunkOutput` 对 `iife` + 多 chunk 直接抛 `INVALID_OPTION` → `npm run build` 失败（`tsc`/`check` 不报，仅 build 暴露）。**原 ADR 草稿称「workerHelpers.js 硬写 iife」为误判**——实际是 Vite 默认 iife + 多 chunk 冲突，报错文案被 Vite 改写为 `worker.format`。修复：顶层 `worker: { format: 'es' }`（与 `type:'module'` 一致），主包仍 `iife`。

---

## 决策

**Go 端先落地 COOP/COEP 注入 POC（默认关、零回归），前端 MPR 切换暂缓至 Vite 构建配置解决 IIFE worker 限制后再接。两端以同一 `VITE_MMD_WASM_MT` 环境变量同轴门控。**

| 落点 | 手法 |
|------|------|
| `internal/app/zipextract.go` | 新增 `CoopCoepMiddleware`（紧邻既有 `corsMiddleware` 同构），注入 `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` |
| `main.go` | 用 `CoopCoepMiddleware(...)` 包住 `application.AssetFileServerFS(assets)`——**顶层文档跨源隔离的关键落点** |
| `internal/app/zipextract.go` | `StartFileServer` 内 `basenameFallbackFS(...)` 同步包裹（对称防护；跨源子资源借既有 `corsMiddleware` 的 `Access-Control-Allow-Origin: *` 满足 COEP 要求） |
| `frontend/src/scene/scene.ts` + `vite-env.d.ts` + `vite.config.ts` | **已落地**：顶层 `worker: { format: 'es' }` 绕开 IIFE 限制；`scene.ts` 用 `define` 注入的构建期常量 `__MMD_ENABLE_MPR__` 门控 `await import('babylon-mmd/.../multiPhysicsRelease')` 动态切换 `MPR`/`SPR` |

### 选项

| 选项 | 描述 | 结论 |
|------|------|------|
| A. 仅注入文件服务器头（research 原路径） | 不包顶层文档 → SAB 仍不可用，MPR 仍无法启用 | ❌ 否决（不完整） |
| B. Go 端注入 + 前端立即切 MPR | 性能收益最快，但前端 build 直失败，破坏绿色构建 | ❌ 否决（引入回归） |
| C. Go 端注入 POC（默认关、零回归）+ 前端暂缓 | Go 半侧就绪、可真机验证 SAB；前端等构建问题解决再接，全程不破坏现有行为 | ✅ 采用 |

---

## 约束

- **默认关 = 零回归**：`VITE_MMD_WASM_MT` 未定义时，中间件为 no-op 直通，响应头与现状 100% 一致；仅在显式定义该变量时注入双头。
- **跨源子资源合规**：COEP `require-corp` 要求子资源带 CORP/CORS。运行期模型/贴图经 `corsMiddleware` 已返回 `Access-Control-Allow-Origin: *`，满足 COEP 对跨源子资源的要求，故文件服务器无需额外改头。
- **中间件不可删**：即便默认关，`CoopCoepMiddleware` 是 SAB 启用的前置闸门；删除即丧失后续 MPR 接入能力。
- **前端切换已解决**：Vite IIFE worker 限制已通过顶层 `worker: { format: 'es' }` 解除；`MmdWasmInstanceTypeMPR` 改用**动态 import + 构建期 `define` 门控**（`__MMD_ENABLE_MPR__`），默认构建走 SPR、`VITE_MMD_WASM_MT=1` 构建走 MPR，两种构建均通过。
- **真机验证缺口**：注入头后需在 WebView2 实测 `self.crossOriginIsolated === true` 与 `typeof SharedArrayBuffer !== 'undefined'`，Go 端编译/单测通过不等于运行时 SAB 已可用。

---

## 执行情况（2026-07-13）

### Go 半侧（已提交 `c2a0734`）
- `internal/app/zipextract.go`：新增 `CoopCoepMiddleware`，结构同 `corsMiddleware`（闭包式 `http.HandlerFunc`），读取 `os.Getenv("VITE_MMD_WASM_MT")` 门控；`StartFileServer` 内 `handler := corsMiddleware(basenameFallbackFS(...))` 改为 `CoopCoepMiddleware(corsMiddleware(basenameFallbackFS(...)))`。
- `main.go`：`Assets.Handler` 由 `application.AssetFileServerFS(assets)` 改为 `CoopCoepMiddleware(application.AssetFileServerFS(assets))`。
- `internal/app/coep_middleware_test.go`：新增单测，`flag 关 → 无头直通`、`flag 开 → 双头注入`，2/2 PASS。

### 前端半侧（2026-07-13 已落地）
- `vite.config.ts`：新增顶层 `worker: { format: 'es' }`（Vite 6 顶层选项，非 `build.worker`），解决 MPR worker 多 chunk + iife 冲突；新增 `define: { __MMD_ENABLE_MPR__: process.env.VITE_MMD_WASM_MT ? 'true' : 'false' }` 注入构建期开关。
- `scene.ts`：`const useMultiThread = __MMD_ENABLE_MPR__;` 门控 `await import('babylon-mmd/esm/Runtime/Optimized/InstanceType/multiPhysicsRelease')` 动态切换 `MmdWasmInstanceTypeMPR` / `MmdWasmInstanceTypeSPR`（默认 SPR，零回归）。
- `vite-env.d.ts`：`declare const __MMD_ENABLE_MPR__: boolean;`（全局常量类型声明）+ `ImportMetaEnv.VITE_MMD_WASM_MT` 文档声明。
- **构建验证**：默认构建（无 flag）329 模块通过、SPR 路径；`VITE_MMD_WASM_MT=1` 构建 329 模块通过、`workerHelpers-*.js` + 2× `index_bg-*.wasm` 产出、MPR 路径。两端同轴门控一致。
- **重要修正（Vite 行为）**：Vite 对动态 `import()` **一律打包为独立 chunk**，与运行时/构建期门控无关。故 MPR worker/wasm **始终存在于 dist**（默认构建亦含），仅运行时未实例化故不加载。桌面 app 本地文件、无网络开销，运行时内存不受影响，可接受；若需默认构建磁盘零 MPR，须改用 alias 桩模块（见后续）。

### 过程发现（非本项引入，已标记交用户定夺）
| 异常 | 位置 | 说明 |
|------|------|------|
| 陈旧破坏性测试 | `internal/app/proxy_test.go:300` | 引用 `a.OpenPlazaWindow("")`，但全仓库无该定义（随他人「发git」改动进 `main`）。阻断整个 `internal/app` 测试包编译。为验证本中间件，曾临时注释该 2 行 → 跑通 → **精确还原**（对他人代码零净改动）。**已修复（2026-07-13）**：`OpenPlazaWindow` 为 ADR-075 重构前的旧名，真实方法为 `NavigatePlazaWindow(targetURL string) error`（`plaza_window.go:60`）；测试空参调用在 `NewApp` 未预创建 `plazaWin` 时返回 error，语义与断言吻合，故精确重命名为 `NavigatePlazaWindow`。`go test ./internal/app/` 全绿。 |
| 工作区非我改动 | 发 git 提交后新写入 | i18n×5、`utils.ts`、`scene-render-levels.ts`、`vmd-loader.ts`、`env.ts`、`mirror-debug.ts`、`checksum`、`tmp-jscpd/`（copy-paste 检测器跑过）。来源/意图不明，按 scope 铁律**未并入本提交**。 |

---

## 验证

- `go build ./...`：退出码 0 ✅（中间件编译正确，`os` 已导入）
- `go test ./internal/app/ -run CoopCoepMiddleware -v`：2/2 PASS ✅（临时解阻塞 `proxy_test.go` 后）
- `npm run check`（`tsc --noEmit`）：退出码 0 ✅（前端 MPR 门控 + define 常量类型正确）
- `npm run build`（默认，无 flag）：退出码 0 ✅（329 模块，SPR 路径；MPR worker/wasm 在磁盘未加载）
- `VITE_MMD_WASM_MT=1 npm run build`：退出码 0 ✅（329 模块，`workerHelpers-*.js` + 2× `index_bg-*.wasm` 产出，MPR 路径）

---

## 后续（未落地项 · 待排期）

| 项 | 内容 | 阻塞 / 前置 |
|----|------|------------|
| 真机 SAB 验证 | WebView2 实测 `crossOriginIsolated === true` + `typeof SharedArrayBuffer !== 'undefined'`，并确认 MPR 物理实际并行解算 | 需 `VITE_MMD_WASM_MT=1` 构建 + 同 flag 启动 App（Go 注入双头） |
| 默认构建磁盘零 MPR（可选） | 若要求默认 dist 不含 MPR worker/wasm，改用 `resolve.alias` 将 `multiPhysicsRelease` 别名到空桩模块（flag 关时），彻底避免打包 | 当前 Vite 动态 import 必打包，默认构建含 ~1.2MB 未加载 wasm；桌面 app 可接受，低优先级 |
| 修正 research POC 路径 | `docs/research/babylon-mmd-api-analysis.md` 原「仅 basenameFallbackFS 注入」改为「包住 AssetFileServerFS（顶层文档）」 | 文档同步 |
| 两项异常处置 | `proxy_test.go:300` 陈旧测试修复（**已完成**：重命名 `OpenPlazaWindow`→`NavigatePlazaWindow`）/ 工作区非我改动提交或搁置 | 用户指示 |
| 同源调研剩余 | `StreamAudioPlayer`（Item 3，收益低暂缓）、`AnimationRetargeter` + `HumanoidMmd`（Item 5，复用 ADR-061 骨骼映射） | 视需求排期 |
