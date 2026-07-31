# Web 构建告警审计：Rollup 动态/静态导入并存（dynamic-import warnings）

**日期**：2026-07-31
**范围**：`frontend/` web 入口生产构建（`vite.web.config.ts`）
**触发**：GitHub Actions `Web — GitHub Pages Deploy` 构建日志刷出多条 `(!) X is dynamically imported by A but also statically imported by B, ... dynamic import will not move module into another chunk`
**结论**：告警**全部无害**（`(!)` 级提示，非 error，CI 成功）；本轮安全消除 2 个目标模块，其余 29 条按架构约定保留。

---

## 1. 告警含义

Rollup/Vite 在代码分割阶段发现：某模块 `X` 同时被
- **动态导入**：`await import('X')`（意图：拆成独立懒加载 chunk）
- **静态导入**：`import ... from 'X'`（意图：加载即需要）

只要存在**任意一处静态导入**，`X` 就必须进主 chunk（静态依赖无法延迟）。此时另一处的 `import()` **失效降级**——不报错、运行时正常，但拿不到分包收益。故本质是**分包优化提示**，而非缺陷。

刷屏原因：告警**按"被动态导入的目标模块"逐个输出**，一个模块一条。初次构建 31 条 = 31 个这样的目标模块。

> 相关：另有一类 `Export X reexported through barrel while both are dependencies of each other`（chunk 级循环告警），已由 `render-context` 依赖倒置根治（见 `development_practice_specification`「循环依赖根治」），本文档不涉及，当前 circular 告警为 **0**。

---

## 2. 分类方法论（审查员视角）

对每个目标模块 `X` 及其动态导入方 `M`，判据**不是**"X 重不重 / 跨不跨平台"，而是以下两问：

1. **改静态会否成环？** 检查 `X`（直接或间接）是否 import 回 `M` 所在模块。若会 → 保留 `import()`。
2. **是否违反既有架构不变量？** 若 `M` 文件头声明了"零依赖叶子/无静态内部耦合"等契约（如 `mmar-globals.ts`），则其 `import()` 是**刻意维持叶子属性**的设计，不可改。

据此分三类：

| 类 | 定义 | 处置 |
|----|------|------|
| **A 无收益冗余** | 目标是底层叶子或全局基础设施；`M` 常已静态引 `X`；改静态不成环、不违约 | 改回静态，消除告警 |
| **B 刻意设计** | `import()` 用于断环 / 维持叶子契约 / 传参 / dev-only 路径 | **保留**，动了会引环或破坏架构 |
| **C 需逐个验证** | 证据不足，需单独查成环与动机 | 暂缓，性价比低时接受现状 |

---

## 3. 本轮已修复（A 类，2 个目标模块）

| 目标模块 | 动态导入点 | 修复 | 成环验证 |
|---------|-----------|------|---------|
| `core/dom.ts` | `load-refresh-registry.ts:59` | 改顶部静态 `import`；顺带消除原 `.then()` 挂监听器的"事件先于监听触发"竞态 | `dom` 仅依赖 `i18n/t`、不反向依赖 → 零风险 |
| `core/wails-bindings.ts` | `library-core.ts`、`settings-shared.ts`（×2）、`events.ts`、`motion-pose-levels.ts` | 5 处改静态；前两文件本已静态引 wails-bindings，属**纯冗余** | `wails-bindings → backend` 链不 import 上述任一文件 → 零风险 |

**验证**：di 告警 **31 → 29**；circular **0**；`tsc` **0 error**；web 构建成功；单测 **115/115**（含 mock `wails-bindings` 的 `library-core.subdir-file.test.ts` 20 项）。

---

## 4. 保留项（B 类，重点说明为何不动）

| 目标模块 | 保留理由 |
|---------|---------|
| `core/mmd-adapter.ts` `core/runtime-stub.ts` `core/backend/browser-adapter.ts` `core/gpu-capabilities.ts` | 均被 `mmar-globals.ts` 等叶子动态引用；`mmar-globals.ts` 文件头明确声明「**轻量叶子模块：无静态内部模块耦合**」，其 5 处 `import()` 是刻意维持叶子属性的设计契约，改静态即违约 |
| `scene/manager/model-loader.ts` `scene/motion/vmd-loader.ts` `scene/motion/proc-motion-bridge.ts` `scene/scene.ts` | 由 `load-manager` / `mmar-globals` 反向动态引用，**改静态会立刻重新引入 core↔scene 循环**（正是此前 `render-context` 依赖倒置刚拔掉的那类环） |
| `scene/scene.ts` 的 dispose/HMR 块（`bone-override` `feet-adjustment` `footstep` `audio-bus` `env-persist` `env`） | 位于 `_reinitSceneForHMR`（dev-only HMR 重入路径），刻意不纳入 `scene.ts` 静态图 |
| `menus/motion-popup.ts` `menus/motion-procmotion-levels.ts` `menus/motion-cloth-levels.ts` | 按钮点击/模型卸载时的延迟加载或 fire-and-forget，含参数传递，属合理懒加载 |

---

## 5. 剩余全量清单（29 条，供后续甄别）

以下为当前构建仍报告的被动态导入目标模块。除第 4 节明确保留者外，其余归 C 类，如需继续收口须逐个验证成环与动机：

```
core/backend/browser-adapter.ts   core/gpu-capabilities.ts        core/mmd-adapter.ts
core/runtime-stub.ts              library/library-path.ts         menus/library-core.ts
menus/library-setup.ts            menus/model-detail.ts           menus/model-preset.ts
menus/motion-cloth-levels.ts      menus/motion-popup.ts           menus/motion-procmotion-levels.ts
menus/scene-menu.ts               outfit/audio.ts                 outfit/outfit.ts
scene/camera/camera.ts            scene/env/_bridge/env-persist.ts scene/env/env.ts
scene/manager/model-loader.ts     scene/manager/model-ops.ts      scene/motion/bone-override.ts
scene/motion/motion-intent.ts     scene/motion/motion-modules/registry.ts
scene/motion/perception.ts        scene/motion/playback.ts        scene/motion/proc-motion-bridge.ts
scene/motion/vmd-layers.ts        scene/motion/vmd-loader.ts      scene/scene.ts
```

---

## 6. 复现与验证命令

```powershell
# 必须清缓存，否则 node_modules/.vite 陈旧缓存会残留假告警
cd frontend
Remove-Item -Recurse -Force node_modules/.vite -ErrorAction SilentlyContinue
$env:VITE_MMD_WASM_MT='1'
npx vite build --config vite.web.config.ts 2>&1 |
  Select-String -Pattern "is dynamically imported by" | Measure-Object

# 环境前置：babylon-mmd 须与 lockfile 一致（当前 1.3.0 fork）；
# 本地漂移会致 mmdModelLoader 解析失败，先 npm ci 对齐
```

---

## 7. 建议

- **默认接受现状**：29 条全部无害，CI 绿。不为"清零"而蛮改 B 类，否则重新引环得不偿失。
- **若继续收口**：只挑目标为纯叶子、`M` 无叶子契约、改静态不成环的 C 类逐个处理，每次改完清缓存重跑本文件第 6 节命令并验证 circular 仍为 0。
