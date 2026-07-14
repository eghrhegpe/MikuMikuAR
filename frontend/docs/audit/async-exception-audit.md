# Frontend 代码质量审计报告

## 依赖图

📊 总文件数：`224`
📦 核心模块：43 个
🎬 场景模块：54 个
📋 菜单模块：46 个
💃 运动算法：16 个

Mermaid 文件已生成：`docs/audit/dependency-graph.mmd`

## 并发与异常处理审计

### 统计概览

| 指标 | 数量 | 比例 |
|------|------|------|
| 总 async 函数 | 1256 | 100% |
| 使用 AbortSignal | 8 | 0.6% |
| 有 try/catch 保护 | 0 | 0.0% |
| 未保护的 await 点 | 382 | - |

### 问题详情

| 优先级 | 文件 | 函数/行号 | 问题 |
|--------|------|-----------|------|
| 🟠 P2 | core/fileservice.ts | fetchArrayBuffer:57 | 耗时操作未使用 AbortSignal，无法支持取消操作 |
| 🟠 P2 | menus/library-core.ts | _loadThumbnailsForLevel:513 | 耗时操作未使用 AbortSignal，无法支持取消操作 |
| 🟠 P2 | menus/library-core.ts | reloadConfig:1779 | 耗时操作未使用 AbortSignal，无法支持取消操作 |
| 🟠 P2 | menus/plaza.ts | handlePlazaDownload:303 | 耗时操作未使用 AbortSignal，无法支持取消操作 |
| 🟠 P2 | menus/scene-render-levels.ts | _loadPresetScene:35 | 耗时操作未使用 AbortSignal，无法支持取消操作 |
| 🟠 P2 | menus/scene-render-presets.ts | loadUserPresets:300 | 耗时操作未使用 AbortSignal，无法支持取消操作 |
| 🟠 P2 | menus/settings-shared.ts | preloadAutoImportState:24 | 耗时操作未使用 AbortSignal，无法支持取消操作 |
| 🟠 P2 | menus/settings-shared.ts | preloadDownloadWatchState:47 | 耗时操作未使用 AbortSignal，无法支持取消操作 |
| 🟠 P2 | outfit/audio.ts | loadAudioFile:40 | 耗时操作未使用 AbortSignal，无法支持取消操作 |
| 🟠 P2 | outfit/outfit-overlay.ts | loadOverlay:193 | 耗时操作未使用 AbortSignal，无法支持取消操作 |
| 🟠 P2 | outfit/outfit.ts | loadOutfits:106 | 耗时操作未使用 AbortSignal，无法支持取消操作 |
| 🟠 P2 | scene/env/props.ts | loadProp:38 | 耗时操作未使用 AbortSignal，无法支持取消操作 |
| 🟠 P2 | scene/manager/model-loader.ts | loadPMXFile:231 | 耗时操作未使用 AbortSignal，无法支持取消操作 |
| 🟠 P2 | scene/motion/vmd-loader.ts | loadVMDMotion:56 | 耗时操作未使用 AbortSignal，无法支持取消操作 |
| 🟠 P2 | scene/motion/vmd-loader.ts | loadVMDFromPath:176 | 耗时操作未使用 AbortSignal，无法支持取消操作 |
| 🟠 P2 | scene/motion/vmd-loader.ts | loadCameraVmdFromPath:247 | 耗时操作未使用 AbortSignal，无法支持取消操作 |
| 🟠 P2 | scene/motion/vmd-loader.ts | loadVPDPose:267 | 耗时操作未使用 AbortSignal，无法支持取消操作 |
| 🟠 P2 | scene/scene-bundle.ts | exportSceneBundle:158 | 耗时操作未使用 AbortSignal，无法支持取消操作 |
| 🟡 P3 | core/audio-bus.ts | anonymous@17:17 | async 函数未包裹 try/catch，异常可能未处理 |
| 🟡 P3 | core/audio-bus.ts | anonymous@32:32 | async 函数未包裹 try/catch，异常可能未处理 |
| 🟡 P3 | core/audio-bus.ts | anonymous@40:40 | async 函数未包裹 try/catch，异常可能未处理 |
| 🟡 P3 | core/audio-bus.ts | anonymous@50:50 | async 函数未包裹 try/catch，异常可能未处理 |
| 🟡 P3 | core/audio-bus.ts | anonymous@56:56 | async 函数未包裹 try/catch，异常可能未处理 |
| 🟡 P3 | core/audio-bus.ts | anonymous@60:60 | async 函数未包裹 try/catch，异常可能未处理 |
| 🟡 P3 | core/audio-bus.ts | anonymous@65:65 | async 函数未包裹 try/catch，异常可能未处理 |
| 🟡 P3 | core/audio-bus.ts | anonymous@69:69 | async 函数未包裹 try/catch，异常可能未处理 |
| 🟡 P3 | core/audio-bus.ts | anonymous@73:73 | async 函数未包裹 try/catch，异常可能未处理 |
| 🟡 P3 | core/audio-bus.ts | anonymous@77:77 | async 函数未包裹 try/catch，异常可能未处理 |
| 🟡 P3 | core/audio-bus.ts | anonymous@82:82 | async 函数未包裹 try/catch，异常可能未处理 |
| 🟡 P3 | core/audio-bus.ts | anonymous@99:99 | async 函数未包裹 try/catch，异常可能未处理 |
| 🟡 P3 | core/audio-bus.ts | anonymous@142:142 | async 函数未包裹 try/catch，异常可能未处理 |
| 🟡 P3 | core/color-helpers.ts | anonymous@12:12 | async 函数未包裹 try/catch，异常可能未处理 |
| 🟡 P3 | core/color-helpers.ts | anonymous@19:19 | async 函数未包裹 try/catch，异常可能未处理 |
| 🟡 P3 | core/color-helpers.ts | anonymous@32:32 | async 函数未包裹 try/catch，异常可能未处理 |
| 🟡 P3 | core/color-helpers.ts | anonymous@37:37 | async 函数未包裹 try/catch，异常可能未处理 |
| 🟡 P3 | core/dev-hooks.ts | anonymous@9:9 | async 函数未包裹 try/catch，异常可能未处理 |
| 🟡 P3 | core/dev-hooks.ts | -:15 | await 点未在 try/catch 块内 |
| 🟡 P3 | core/dev-hooks.ts | -:72 | await 点未在 try/catch 块内 |
| 🟡 P3 | core/dev-hooks.ts | -:75 | await 点未在 try/catch 块内 |
| 🟡 P3 | core/dev-hooks.ts | -:98 | await 点未在 try/catch 块内 |
| 🟡 P3 | core/dev-hooks.ts | -:99 | await 点未在 try/catch 块内 |
| 🟡 P3 | core/dev-hooks.ts | -:100 | await 点未在 try/catch 块内 |
| 🟡 P3 | core/dialog.ts | anonymous@35:35 | async 函数未包裹 try/catch，异常可能未处理 |
| 🟡 P3 | core/dialog.ts | anonymous@56:56 | async 函数未包裹 try/catch，异常可能未处理 |
| 🟡 P3 | core/dialog.ts | anonymous@149:149 | async 函数未包裹 try/catch，异常可能未处理 |
| 🟡 P3 | core/dialog.ts | anonymous@236:236 | async 函数未包裹 try/catch，异常可能未处理 |
| 🟡 P3 | core/dialog.ts | anonymous@252:252 | async 函数未包裹 try/catch，异常可能未处理 |
| 🟡 P3 | core/dialog.ts | anonymous@289:289 | async 函数未包裹 try/catch，异常可能未处理 |
| 🟡 P3 | core/dialog.ts | anonymous@322:322 | async 函数未包裹 try/catch，异常可能未处理 |
| 🟡 P3 | core/dialog.ts | -:8 | await 点未在 try/catch 块内 |
| ... | 共 1494 个问题，详见完整报告 |

### 建议

1. **AbortSignal 规范化** — 所有涉及 I/O、网络请求、文件操作的 async 函数应接受 `signal?: AbortSignal` 参数
2. **异常边界** — 顶层 async 函数应转换为错误边界处理，内部函数可依赖调用方处理
3. **并发控制** — 检查 loading 状态标志，防止重复触发相同操作

---
*生成时间：2026-07-14T08:17:11.144Z*