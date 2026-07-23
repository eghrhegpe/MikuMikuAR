# ADR-136: 缩略图流式加载 AbortSignal 协作式取消

- **状态**：✅ 已完成（P2.2 落地；`tsc` 零错误 + 单测 5/5 + 关联回归 118/118 + `build` 通过）
- **日期**：2026-07-19
- **相关**：ADR-105（AbortSignal 传递规范与异步异常处理基线）、ADR-135（LibrarySessionStore，P2.2 来源）、ADR-096（加载竞态 `AbortSignal.any`）、`unification-triage-2026-07-19.md`（并发取消缺失主题）

## 背景与问题

资源库缩略图通过 `loadThumbnailsStreaming`（`library-core.ts`）逐张流式拉取：`GetThumbnail`（Wails binding）× 4 路并发 worker，每加载一张写缓存并 `notifyThumbnailUpdate()`。

`unification-triage-2026-07-19.md` 的「并发取消缺失」主题指出：全库仅 `model-loader.ts:256-269` 一处真正采用 `AbortSignal`，而 `library-actions.ts`（含缩略图路径）的异步操作基本不接收 `signal`。具体隐患：

1. **请求堆积**：用户在文件夹间快速来回切（或反复开关弹窗），每次进入都触发一次新批次。旧批次的 `GetThumbnail` 仍在进行，多个批次叠加 → 慢盘/大库下数十个 in-flight 请求并行，CPU 与 Go 侧压力无谓上升。
2. **过期写入**：旧批次拉回的缩略图，用户早已看不到对应面板，仍被写入缓存并触发 `notifyThumbnailUpdate()`，造成缓存抖动与无效重绘。
3. **无取消出口**：函数签名不接受 `AbortSignal`，调用方（弹窗关闭/重渲染）无法表达「别再加载了」。

## 决策

给 `loadThumbnailsStreaming` / `loadThumbnailsForLevel` 增加 `signal?: AbortSignal` 参数，并采用**协作式取消**：

- `GetThumbnail` 是 Wails binding，Go 侧无法真正中止请求。因此取消只在 JS 编排层生效：abort 后不再派发新 worker、丢弃已拉取但未写入的过期结果。
- 复用 `model-loader.ts` 已验证的范式：模块级「当前批次」`AbortController` + `AbortSignal.any` 合并外部 `signal`。每次新调用 abort 上一批次，天然解决「快速切换文件夹」的堆积问题，调用方**无需自行管理控制器**即可获得取消能力。
- 导出 `abortThumbnailStreaming()`，供弹窗生命周期（如 `showModelPopup` 重开）显式取消残留批次。

**不在本 ADR 范围**：

- per-popup 控制器（消除跨弹窗干扰）。全局单例在「model 弹窗内导航」会顺带 abort 「motion 弹窗」正在流的 VMD 缩略图——因缩略图有缓存、重建即重拉，影响可忽略；如需零干扰归后续 ADR。
- `GetThumbnail` binding 本身的真中止（Wails 基础设施能力，不在前端范围）。

## 方案

### 1. `library-core.ts` — `loadThumbnailsStreaming`

```ts
// [adr-136] 当前批次控制器：每次新调用 abort 上一批次
let _thumbAbortController: AbortController | null = null;

export async function loadThumbnailsStreaming(
    keys: string[],
    signal?: AbortSignal
): Promise<void> {
    if (keys.length === 0) return;
    if (_thumbAbortController) _thumbAbortController.abort();   // 取消上一批次
    const internalCtrl = new AbortController();
    _thumbAbortController = internalCtrl;
    // 合并外部 signal 与内部控制器：任一 abort 即生效（AbortSignal.any，非 ?? 回退）
    const effectiveSignal = signal
        ? AbortSignal.any([signal, internalCtrl.signal])
        : internalCtrl.signal;
    let index = 0;
    const workers = Array.from(
        { length: Math.min(THUMB_STREAM_CONCURRENCY, keys.length) },
        async () => {
            while (index < keys.length) {
                if (effectiveSignal.aborted) break;            // 协作式停止派发
                const key = keys[index++];
                if (thumbnailCache.has(key)) continue;
                try {
                    const data = await GetThumbnail(key);
                    if (effectiveSignal.aborted) continue;      // 丢弃过期结果
                    if (data) {
                        thumbnailCache.set(key, data);
                        notifyThumbnailUpdate();
                    }
                } catch (err) {
                    logWarn('library-core', `GetThumbnail failed for ${key}:`, err);
                }
            }
        }
    );
    try {
        await Promise.all(workers);
    } finally {
        // 批次自然结束时清引用；若已被外部/新批次取代则不动（防误清新批次）
        if (_thumbAbortController === internalCtrl) _thumbAbortController = null;
    }
}

/** [adr-136] 取消当前缩略图流式批次（弹窗关闭/重开时调用）。 */
export function abortThumbnailStreaming(): void {
    if (_thumbAbortController) {
        _thumbAbortController.abort();
        _thumbAbortController = null;
    }
}
```

### 2. `library-actions.ts` — `loadThumbnailsForLevel` 透传

```ts
export async function loadThumbnailsForLevel(
    level: PopupLevel,
    signal?: AbortSignal
): Promise<void> {
    // ...
    await loadThumbnailsStreaming(keys, signal);   // [adr-136] 透传外部取消信号
}
```

`signal` 为可选参数，现有调用方（菜单 level 构建）无需改动即向后兼容；后续消费方（如带弹窗生命周期控制器的场景）可逐步传入。

### 3. `library-browse.ts` — 弹窗重开取消钩子

```ts
import { ..., abortThumbnailStreaming } from './library-core';
// showModelPopup():
librarySessionStore.reset();
abortThumbnailStreaming();   // [adr-136] 取消上一次会话残留的缩略图流式批次
```

`showModelPopup` 在重开弹窗、重建菜单 level 之前调用，此处取消上一次会话残留批次，覆盖「重开即取消」这一最常见堆积场景。

## 影响与风险

| 项 | 说明 | 缓解 |
|----|------|------|
| 行为兼容 | 纯新增可选 `signal` 参数 + 内部批次控制器；无 `signal` 时行为与旧版逐张加载完全一致 | 既有 `library-core.test.ts` 106 用例作回归保护 |
| 跨弹窗干扰 | 模块级单例：model 弹窗导航会 abort motion 弹窗在流的 VMD 缩略图 | 缩略图有缓存、重建即重拉，影响可忽略；零干扰归后续 ADR |
| 弹窗关闭后再不重开 | 该边缘情形下在飞批次跑完（无害，仅浪费几次 `GetThumbnail`） | `showModelPopup` 钩子覆盖「重开即取消」；如需彻底，可在 `closeAllOverlays` 加钩子（blast radius 过大，本 ADR 不做） |
| `AbortSignal.any` 运行时 | 生产代码已用于 `model-loader.ts`，目标浏览器/Node 测试运行时均支持 | 单测直接覆盖 `AbortSignal.any` 合并路径 |
| 测试覆盖 | 新增 `library-thumbnail-streaming.test.ts` | 5 个确定性用例：空 keys、已 abort 立即返回、无 signal 向后兼容、中途 abort 丢弃过期结果、`abortThumbnailStreaming` 取消在飞批次 |

## 验收标准

- [ ] `loadThumbnailsStreaming(keys, signal?)` 接受 `AbortSignal`，协作式取消生效
- [ ] `abortThumbnailStreaming()` 导出且可取消当前批次
- [ ] `loadThumbnailsForLevel` 透传 `signal`
- [ ] `showModelPopup` 调用 `abortThumbnailStreaming()`
- [ ] `npm run check` 零新增 tsc 错误
- [ ] `npm run test -- library-thumbnail-streaming` 全绿
- [ ] `npm run build` 通过

## 后续

- per-popup 控制器（消除跨弹窗干扰）：将 `_thumbAbortController` 升级为每个弹窗/面板实例持有的控制器，由生命周期 owner 在关闭时 abort。
- 消费方接入：菜单 level 构建、`openResourceFullscreen` 面板 dispose 等可传入各自生命周期的 `signal`，实现更细粒度取消。
