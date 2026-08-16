# ADR-261: 测试环境分流实证修正 — 隐式 DOM 依赖不是表面嗅探能捕捉的

> **状态**: ✅ 已采纳（2026-08-16）
> **日期**: 2026-08-16
> **取代**: ADR-255 §识别方法（细化为"试跑 + 定位行号"）

## 背景

ADR-255 采用**静态 grep 嗅探**方法识别无 DOM 依赖的测试文件：
```bash
rg --files-without-match "<DOM 全局正则>" src --glob "*.test.ts"
```
得到 221 个候选 → 首轮 135 个全绿 → 第二轮源码惰性化解锁 46 个。

后续实证测试暴露了方法的局限性：

| 批次 | 候选 | 通过 | 命中率 |
|------|------|------|--------|
| ADR-255 静态 grep | 221 | 135 | 61% |
| 本 ADR 实测验证 | 24 | 2 | **8%** |

8% 命中率说明：**没有直接 DOM 引用 ≠ 能在 node 下跑**。

## 决策

### 1. 方法论修正：试跑 → 定位行号 → 修根因

静态 grep 只能检测**文件自身**的直接 DOM 引用，无法穿透 import 链。正确流程：

```
候选文件 → 加 @vitest-environment node → 试跑 → 分析失败堆栈 → 
定位具体行号 → 修根因（每文件/通用 setup）→ 验证 → 保留/回退
```

### 2. 通用 setup 兜底（已实施）

在 `frontend/src/__tests__/setup-wails.ts` 添加 node 环境兜底注入：

```typescript
// requestAnimationFrame
if (typeof globalThis.requestAnimationFrame === 'undefined') {
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
        setTimeout(() => cb(0), 0)) as unknown as typeof globalThis.requestAnimationFrame;
}
// localStorage
if (typeof localStorage === 'undefined') {
    const _store: Record<string, string> = {};
    Object.defineProperty(globalThis, 'localStorage', {
        value: { getItem: (k) => _store[k] ?? null, setItem: (k, v) => { _store[k] = v; }, ... },
        writable: true, configurable: true,
    });
}
```

**收益**：一次注入，批量解锁。`env-lighting.test.ts`、`lighting-follow.test.ts` 等文件零额外改动即可切 node。

### 3. 生产代码惰性化（选择性实施）

对测试导入链上的高频阻塞点，在**生产代码**中添加 typeof 守卫：

| 模块 | 改动 | 解锁文件 |
|------|------|---------|
| `load-refresh-registry.ts` | `window` 访问加 `typeof !== 'undefined'` 守卫 | `schema-snapshot.test.ts` |
| `library-actions.ts` | `document` 访问加 typeof 守卫 | 铺路（未解锁） |

**原则**：仅在"单处改动解锁多文件"时改造生产代码，单次解耦 ROI < 10 分钟不采纳。

### 4. 放弃方案

- **全量惰性化菜单模块**（nav-actions、library-core 等）：成本高（每个模块 5-10 处 DOM 操作），只解锁 1-2 个测试文件，ROI 负。
- **Polyfill 浏览器 API**（HTMLCanvasElement、OffscreenCanvas 等）：维护负担重，与项目"零 polyfill"哲学冲突。

## 影响

### 已实施

- `setup-wails.ts`：新增 rAF + localStorage node 兜底（-3 行逻辑，+22 行注入）
- 172 个测试文件切 node 环境（原 159 + 新增 13）
- 3 个源码模块惰性化（dom.ts、ui-fullscreen-overlay.ts、mmar-globals.ts 已实施；load-refresh-registry.ts、library-actions.ts 本次新增）

### 当前状态

- Node 环境：172 文件 / ~2200 用例
- Happy-dom 环境：136 文件 / ~2800 用例（主要为菜单渲染、Babylon.js 真实渲染路径）
- Environment 成本：~60s（172 × 0ms + 136 × 285ms）
- 全量墙钟：~40s（本地 24 核，噪声带 ±2s）

### 未解决

以下文件因菜单渲染层深度 DOM 依赖，仍留在 happy-dom：
- `library-core.test.ts`（105/119 可通过，14 个 buildLevel 用例需 DOM）
- `main.boot-anchor.test.ts`（nav-actions.ts 顶层 document.querySelectorAll）
- `env-ground.test.ts`（env-texture.ts 生产代码 document.createElement）

## 方法论沉淀

**未来新增测试的 node 环境准入检查**：

1. 首选：直接加 `// @vitest-environment node` 试跑
2. 失败 → 分析堆栈定位行号
3. 根因分类：
   - `requestAnimationFrame` / `localStorage` → setup 兜底已覆盖，自动通过
   - `window` / `document` → 检查是否在 `load-refresh-registry.ts` / `library-actions.ts` 等已惰性化模块
   - 其他生产代码 DOM 依赖 → 评估是否值得解耦（单处改动解锁 ≥3 文件才采纳）
4. 测试代码自身 DOM 引用（如 `document.createElement` in mock）→ 使用 node 兼容 helper

## 相关文档

- ADR-255: 测试环境分流原始决策
- ADR-219: 测试并发调优与 isolate 污染治理
- `frontend/src/__tests__/setup-wails.ts`: node 环境兜底注入
