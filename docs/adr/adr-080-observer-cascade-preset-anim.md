# ADR-080: 预设动画 observer 级联暴涨——addOnce 自注册陷阱

> **状态**: 已修复（2026-07-10）
> **关联**: ADR-072（WebXR 平面检测）、`frontend/src/scene/env/env-bridge.ts`

---

## 背景

天空预设淡入动画（`presetAnim`）期间，`scene.onBeforeRenderObservable` 的 observer 数量从 7 暴涨到 272074，2 秒后 `compact` 回 7。场景渲染卡顿 2s，触发性能三级降级。

## 根因

### 重现条件

```typescript
const animLoop = () => {
    // ... 淡入计算 ...
    if (t >= 1) return;           // 完成，不续约
    scene.onBeforeRenderObservable.addOnce(animLoop);  // 续约
};

scene.onBeforeRenderObservable.addOnce(animLoop);  // 初始注册
```

`addOnce` 注册的 observer 会在 Babylon.js `Observable.notifyObservers` 内执行，回调结束时自动标记为 `_willBeUnregistered`。但续约的 `addOnce(animLoop)` 在数组末尾 push 了一个新 observer。

### Babylon.js notifyObservers 实现（observable.pure.js §286）

```javascript
for (const obs of this._observers) {   // for…of 遍历可变数组，不缓存长度
    if (obs._willBeUnregistered) continue;
    if (obs.unregisterOnNextCall) {     // addOnce 标记
        this._deferUnregister(obs);     // 标记 _willBeUnregistered，不删除
    }
    obs.callback(eventData, state);     // ← animLoop 在此执行
}
```

关键：`for…of` 在数组 push 后不会终止——`this._observers.length` 增大，迭代继续。

### 级联链路

```
scene.render()
  → onBeforeRenderObservable.notifyObservers()
    → for (obs of _observers)      ← 动态长度
      → obs = animLoop(addOnce)
        → animLoop()
          → 调 setEnvState/setLightState（不动 observer）
          → scene.onBeforeRenderObservable.addOnce(animLoop)
            → _observers.push(newObserver)   ← 数组长度 +1
          → return
      → for 继续迭代 newObserver     ← 级联！
        → animLoop() …… 无限重复直到 t ≥ 1
```

每次 `addOnce` push 1 个新 observer；前一次的执行完只标 null 不 splice，数组长度净增 1。1994ms 内积累 185137 个 null 占位，`notifyObservers` 结束后 `_remove` 异步清除。

### 为什么诊诊断日志没立刻暴露

- `animLoop Δ=0` ✅——setEnvState/setLightState 没注册 observer，诊断正确
- observer 绝对数增长来自 `addOnce` 续约本身，而这个续约在 Δ 测量**之后**执行
- 旧代码路径从未触发持续时间 `duration=2000ms` 的淡入（以前是 instant apply），所以没人踩到

## 修复

### 方案：持久 observer + 显式 remove

```typescript
const animLoop = () => {
    if (_presetAnimId !== myId) {       // 取消
        scene.onBeforeRenderObservable.remove(animObserver);
        return;
    }
    // ... 淡入计算 ...
    if (t >= 1) {
        scene.onBeforeRenderObservable.remove(animObserver);  // 完成，清理
        // ... 结束逻辑 ...
        return;
    }
    // 不再 addOnce 续约——observer 是持久注册的
};

const animObserver = scene.onBeforeRenderObservable.add(animLoop);
```

改动：
1. 初始注册从 `addOnce` → `add`，持 observer 引用
2. 取消路径和完成路径均 `remove(animObserver)`
3. 删掉回调末尾的 `addOnce(animLoop)` 续约

效果：observer 在动画期间稳定为 1 个（持久 observer），`notifyObservers` 的 `for…of` 每次只迭代一次。

### 为什么不改 Babylon.js

Babylon.js `for…of` 遍历可变数组并非 bug——它是一个度设计选择，允许 observer 在回调中注册新 observer 并**在当前轮次被通知**，这对某些场景（如事件冒泡）是必要行为。问题在于我们的 `addOnce` 自注册模式滥用这一特性产生了 O(n²) 级联。

## 验证

修复后 sky preset 淡入日志：

```
observers=7 (t=0.90)
observers=7 (t=0.92)
observers=7 (t=0.96)
observers=7 (t=0.99)
animLoop ended: observers=7→7
```

observer 数全程 7，scene.render 耗时恢复为 ~60ms，无性能降级。

---

## 迁移/兼容

无。`presetAnim` 是全新路径（天空预设淡入），不影响旧行为。

## 对其他模块的参考价值

其他使用 `addOnce` 自注册模式的代码应检查是否存在类似级联风险：

| 模式 | 风险 | 建议 |
|------|------|------|
| `obs.addOnce(fn)`，fn 内 `addOnce(fn)` | ⚠️ 级联 | 改为持久 `add` + 显式 `remove` |
| `obs.addOnce(fn)`，fn 内 `add(fn)` | 无风险（`add` 无 `unregisterOnNextCall`，不会在 `for…of` 内触发 `_deferUnregister`） | 可不改 |
| `obs.add(fn)`，fn 内 `add(fn)` | 无风险（与上同理） | 可不改 |

关键区别在于：**`addOnce` 执行一次后 observer 失效，续约必须注册新 observer → push 数组 → `for…of` 额外迭代一次**。`add` 不存在此问题，因为 observer 不失效，不需要续约。
