# ADR-255: 测试环境分流：@vitest-environment node 削减每文件 happy-dom 成本 — isolate=true 下 happy-dom 每文件重建是墙钟大头；无 DOM 依赖测试文件切 node 环境，环境累加 255s → ~90-105s

> **状态**: ✅ 已采纳（2026-08-10）
> **日期**: 2026-08-10

## 背景

ADR-219 收口时判定全量 55.95s 的墙钟由「每 worker 固定成本（环境搭建 + 重模块导入）」主导，
worker 数/池类型均非杠杆，isolate=false 结构性不可修。该结论把环境成本视为**不可削减的固定税**。

本 ADR 用逐项计时推翻了其中一半：**环境成本不是「每 worker 一次」，而是 isolate=true 下
「每文件重建」**——vitest 4 的 `file.environmentLoad` 是逐文件累加（`sum(files, f => f.environmentLoad)`），
单文件实测 happy-dom 环境搭建 **~285ms**（node 环境 ~0ms），308 个文件累计 ≈ 88~255s，
是墙钟第二大构成（仅次于重文件 import）。

而 import 成本同样被高估为「所有文件平均」：实测**只有真加载 babylon 运行时的文件**才付
~1.8s（预构建 `@babylonjs_core.js` 9.2MB 单文件执行 ~470ms 为下限）；mock 掉 babylon-mmd
或类型 import 被 esbuild 剥离的文件只要 ~37ms。

## 决策

1. **environment 分流**：给「无 DOM 依赖」的测试文件加文件头注释
   `// @vitest-environment node`，使其跑 node 环境（环境成本 ~0ms）；
   依赖 `window`/`document`/canvas 渲染的保持默认 happy-dom。
   首批 181 个文件加注释（含 2 个被 exclude 的 perf 文件，实际运行 179 node +
   129 happy = 308）；后续提交增删测试文件后，以
   `rg -l "@vitest-environment node" src --glob "*.test.ts" | wc -l` 为准。
2. **识别方法**：`rg --files-without-match "<DOM 全局正则>" src --glob "*.test.ts"`
   得到 221 个候选 → 全量试跑 → 回滚失败的 → 首轮 135 个全绿。
3. **第二轮：源码可测性修复解锁 46 个**。回滚文件中 46 个的失败根因是
   import 链上 3 个模块的顶层 DOM 副作用，逐一惰性化后解锁：
   - `src/core/dom.ts`：22 个 `document.getElementById` 顶层引用改
     `_doc?.` 惰性兜底（node 下为 null，保持属性可写，test helpers 注入照常）；
   - `src/core/ui-fullscreen-overlay.ts`：顶层 CSS 注入块加
     `typeof document !== 'undefined'` 守卫；
   - `src/core/mmar-globals.ts`：`window.__mmar` 挂载目标改为
     `window ?? globalThis`（node 下挂 globalThis，语义无影响）。
   剩余 40 个为真渲染路径（babylon `OffscreenCanvas`/canvas 纹理）或真 DOM 交互，
   无法切 node，留在 happy-dom。
4. **新增测试约定**：纯逻辑测试（不触碰 window/document/localStorage 等 DOM 全局）
   首行标注 `// @vitest-environment node`；依赖 DOM 的保持默认，无需标注。

## 备选方案

- **environmentMatchGlobs 集中配置**：221 个精确路径的 glob 列表冗长难维护，
  且「文件是否安全切 node」的判断就近可见更利于后续新增测试照抄。弃。
- **全局 environment: 'node' + 反向给 DOM 文件标 happy-dom**：需要 DOM 的文件
  （88 个直接引用 + 更多间接依赖）逐个标注工作量更大且易漏。弃。
- **修复失败文件的间接 DOM 依赖**：第二轮已执行（3 个模块惰性化解锁 46 个，
  见决策 3）；剩余 40 个是真渲染路径（`OffscreenCanvas`/canvas 纹理）或真 DOM
  交互，惰性化无法覆盖，需浏览器 API polyfill（伪 DOM），不采纳。
- **isolate=false / 合并测试文件**：ADR-219 已判死 / 反模式，未再评估。

## 影响

- `frontend/vitest.config.ts`：更新瓶颈描述注释，引用本 ADR。
- 181 个测试文件：新增首行 `// @vitest-environment node` 注释（git 可审查）。
- 3 个源码模块惰性化（dom.ts / ui-fullscreen-overlay.ts / mmar-globals.ts），
  happy-dom/浏览器语义与原先一致（全量 4995 用例验证），node 下可安全加载。
- 全量墙钟：**55.95s → ~40s（-29%）**；environment 累加 **255s → ~90-105s**
  （cold/hot cache 波动）。本地 24 核下墙钟已入调度噪声带（import 成本占主导），
  CI（2 核 runner）预期收益更大——环境成本是每文件串行付的，worker 排队越长收益越明显。
- 剩余 40 个 happy-dom 文件为真渲染/真 DOM 路径（babylon `OffscreenCanvas`、
  canvas 纹理、DOM 交互），切 node 需 polyfill 浏览器 API（伪 DOM），不采纳。
- 不触及 ADR-219 决策：maxWorkers=12、isolate=true、预构建三件套均保留。

## 相关文档

> ADR-219 测试并发调优与 isolate 污染治理
