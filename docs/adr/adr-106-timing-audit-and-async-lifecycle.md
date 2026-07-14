# ADR-106: 时序审核与异步生命周期规范

**状态**: 规划

**决策者**: Riku（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

**创建日期**: 2026-07-14

---

## 背景

2026-07-14 全项目时序专项审核覆盖 `frontend/src/` 全部 12 个目录、40+ 时序敏感文件，发现以下系统性缺陷：

| 问题域 | 数量 | 严重程度 |
|--------|------|---------|
| 动画过渡死锁风险 | 1 | 🔴 P1 |
| Promise 链隐式契约 | 1 | 🔴 P1 |
| HMR 生命周期泄漏 | 3 | 🟠 P2 |
| 异步浪费（无提前取消检查） | 1 | 🟠 P2 |
| 反查依赖隐含假设 | 1 | 🟠 P2 |
| 清理入口缺失 | 2 | 🟡 P3 |
| 资源浪费 | 1 | 🟢 P4 |

**根因分析：**

1. **HMR 无清理契约** — 模块级 observer、定时器、订阅者在 HMR 重载后无统一清理入口，依赖"运气"不访问已销毁对象
2. **异步链路无取消点** — 起始 `await` 前不检查"是否还有意义"，导致焦点切换后 CPU 浪费
3. **过渡动画安全网不足** — 依赖 CSS transitionend 的 Promise 没有足够余量
4. **fire-and-forget 的回调链** — `onRemoveModel` 中异步清理与同步销毁的时序未显式声明

---

## 决策

### D1: 过渡动画超时安全网规范

**所有 `waitForTransition` 类 Promise 的超时安全网必须 ≥ 2× transition-duration，且 ≥ 500ms。**

```typescript
// ✅ 正确
function waitForTransition(el: HTMLElement, propertyName?: string): Promise<void> {
    return new Promise((resolve) => {
        const dur = parseFloat(getComputedStyle(el).transitionDuration) * 1000 || 0;
        if (dur <= 0) { resolve(); return; }
        const disp = addDisposableListener(el, 'transitionend', (e) => {
            if (propertyName && (e as TransitionEvent).propertyName !== propertyName) return;
            disp.dispose();
            resolve();
        });
        const timeout = Math.max(dur * 2, 500);  // ← 2x + 下限
        setTimeout(resolve, timeout);
    });
}
```

#### 违规检查

- `setTimeout(resolve, dur + <常量>)` 且常量 < 500 → 违规
- `setTimeout(resolve, dur)` 无额外余量 → 违规

### D2: Promise 链的 onRejected 必须显式

**所有 `.then(onFulfilled, onRejected)` 模式中，`onRejected` 必须显式处理拒绝原因，不得依赖函数忽略参数。**

```typescript
// ✅ 正确
private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(
        task,
        (err) => {
            console.warn('[loadManager] 上一个任务失败，继续:', err);
            return task();  // 显式调用，不传 err
        }
    );
    this.queue = result.then(() => {}, () => {});
    return result;
}

// ❌ 错误：隐式依赖 task 忽略参数
this.queue.then(task, task)
```

### D3: 每个模块必须有 HMR 清理函数

**所有注册 observer、定时器、订阅者的模块必须导出 `dispose` 或 `stop` 函数，在 `initScene` 重入时调用。**

#### 需要清理的模块

| 模块 | 清理函数 | 注册内容 |
|------|---------|---------|
| `core/reactivity.ts` | `unsubscribeAll()` | `_subscribers` Set |
| `scene/motion/bone-override.ts` | `stopBoneOverride()` | `onBeforeRenderObservable` |
| `scene/motion/feet-adjustment.ts` | `stopFeetAdjustment()` | `onBeforeRenderObservable` |
| `scene/env/env-bridge.ts` | `_envPersistTimer.cancel()` | `DebouncedTimer` |
| `scene/render/renderer.ts` | `disposeRenderer()` | ✅ 已有 |
| `core/render-loop.ts` | `stopRenderLoop()` | ✅ 已有 |
| `core/events.ts` | `disposeEventHandlers()` | ✅ 已有 |

#### 调用规范

```typescript
// initScene 重入时，在开头调用所有清理函数
export async function initScene(): Promise<void> {
    // 0. 清理旧实例
    _disposePlaybackObservables?.();
    stopBoneOverride();
    stopFeetAdjustment();
    // ... 原有初始化逻辑
}
```

### D4: 异步函数在关键 await 前必须检查"是否还有意义"

**所有通过 `updateProcMotion` → `startProcMotion` 类似链路触发的异步操作，在 `await` 之前必须检查焦点/状态是否已变化。**

```typescript
// ✅ 正确
async function startProcMotion(...) {
    if (procStarting) return;
    procStarting = true;
    const modelIdAtStart = focusedModelId;

    // 生成 VMD buffer ...

    // 在 await 前快速检查
    if (focusedModelId !== modelIdAtStart) {
        procStarting = false;
        return;  // ← 提前返回，不浪费 await
    }

    await loadVMDMotion(buf, ...);
    // ...
}
```

### D5: `deserializeScene` 禁止使用 `focusedModel()` 反查

**所有需要获取刚加载的模型实例的代码，必须使用加载函数返回的 ID 直接查询，不得依赖"焦点模型就是刚加载的模型"这一隐含假设。**

```typescript
// ✅ 正确
const loadedId = await loadPMXFile(resolvedPath, m.kind === 'stage', true);
if (!loadedId) { modelIds.push(null); continue; }
const inst = modelRegistry.get(loadedId);
modelIds.push(inst ? loadedId : null);

// ❌ 错误
await loadPMXFile(resolvedPath, m.kind === 'stage', true);
const inst = focusedModel();  // 隐含假设
```

---

## 受影响文件

### P1 — 必须修复

| 文件 | 行号 | 问题 | 规则 |
|------|------|------|------|
| `core/events.ts` | 89 | `waitForTransition` 安全网 `dur + 50` 余量不足 | D1 |
| `core/load-manager.ts` | 61 | `enqueue` 的 `.then(task, task)` 隐式依赖 | D2 |

### P2 — 建议修复

| 文件 | 行号 | 问题 | 规则 |
|------|------|------|------|
| `scene/motion/proc-motion-bridge.ts` | 103 | `startProcMotion` 在 `await loadVMDMotion` 前无焦点检查 | D4 |
| `core/reactivity.ts` | 36 | `subscribe` 无 HMR 清理导出 | D3 |
| `scene/motion/bone-override.ts` | 260 | `stopBoneOverride()` 已导出（L260），HMR 清理入口具备，P2 已满足（2026-07-14 核验） | D3 |
| `scene/motion/feet-adjustment.ts` | 313 | `stopFeetAdjustment()` 已导出（L313），HMR 清理入口具备，P2 已满足（2026-07-14 核验） | D3 |
| `scene/scene-serialize.ts` | 455 | `deserializeScene` 用 `focusedModel()` 反查模型 | D5 |

### P3 — 规划修复

| 文件 | 行号 | 问题 | 规则 |
|------|------|------|------|
| `scene/env/env-bridge.ts` | 650 | `_envPersistTimer` HMR 时悬挂 | D3 |
| `scene/manager/model-loader.ts` | 102 | `withTimeout` 超时后原始 Promise 不取消 | D4（可选） |

---

## 实施计划

### Phase 1: P1 修复（1 天）

1. `core/events.ts` — `waitForTransition` 安全网提升至 `Math.max(dur * 2, 500)`
2. `core/load-manager.ts` — `enqueue` 的 `.then` 分离 onFulfilled/onRejected

### Phase 2: P2 修复（2 天）

1. `scene/motion/proc-motion-bridge.ts` — `startProcMotion` 在 `await` 前增加焦点检查
2. `core/reactivity.ts` — 导出 `unsubscribeAll()`
3. `scene/motion/bone-override.ts` — 导出 `stopBoneOverride()`
4. `scene/motion/feet-adjustment.ts` — 导出 `stopFeetAdjustment()`
5. `scene/scene-serialize.ts` — `deserializeScene` 改用 `loadPMXFile` 返回的 ID

### Phase 3: 新增 HMR 清理入口（1 天）

1. 在 `initScene` 开头调用所有已注册的 `stop*` 函数
2. 在 `init` 函数开头调用 `unsubscribeAll()`

---

## 验收标准

1. **P1 修复**：`waitForTransition` 安全网 ≥ 500ms，`enqueue` 的 `.then` 显式分离
2. **P2 修复**：所有 5 个修复点通过代码审查
3. **HMR 清理**：`initScene` 重入时不会残留 observer 或定时器
4. **构建通过**：`npm run build` 无错误
5. **E2E 测试通过**：`npm run test:e2e` 无回归

---

## 相关 ADR

- [ADR-105: AbortSignal 传递规范与异步异常处理基线](adr-105-abort-signal-and-async-error-handling.md) — 异步取消与错误处理配套规范
- [ADR-102: main.ts 拆分](adr-102-main-ts-split.md) — `render-loop.ts` 提取与幂等 stop
- [ADR-063: 架构债务偿还](adr-063-architecture-debt-paydown.md) — 历史架构债务清单

---

## 弃用说明

无。

---

*本 ADR 由 2026-07-14 全项目时序审核生成*