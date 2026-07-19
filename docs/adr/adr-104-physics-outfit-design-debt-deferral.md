# ADR-104：物理/换装/音频子系统设计债暂缓登记

> **状态**: 已完成（Claim 11/12 已落地偿付）；Claim 13 正式搁置（2026-07-19）
> **阶段**: 技术债登记 + 即时偿付完成（Claim 11、Claim 12 已落地；Claim 13 搁置登记）
> **分类**: 架构债
> **日期**: 2026-07-14
> **来源**: 代码审查 #2026-07-14（物理/换装/音频子系统）的设计层指控
>
> **状态关闭说明（2026-07-19）**：长期挂「部分实现」黄灯源于 Claim 13 未结。复核后判定 Claim 13 不立项，正式搁置：
> - **Claim 13（`outfit-overlay.ts` 多 skeleton 支持）现状**：FBX 多角色换装场景下，仅首个 skinned mesh 的 skeleton 被重定向，其他 skeleton 不处理。
> - **搁置理由**：
>   1. **触发条件未达到**：当前无多角色 FBX 换装的实际需求，假设"FBX 为单角色"成立。
>   2. **修复成本不低**：需按 `mesh.skeleton` 分组逐个重定向，且要处理多 skeleton 间的资源隔离，非小修。
>   3. **投资回报比低**：为尚未出现的需求提前投入，违反「不为假设性未来需求设计」原则。
> - **重启触发条件**：① 出现多角色 FBX 换装的实际用户需求；② outfit-overlay 重构时顺手补齐。
> - **替代方案**：当前限制可由用户手动拆分 FBX 为单角色文件规避。
>
> 至此 Claim 11/12 已落地、Claim 13 已明确搁置，本 ADR 无未决项，状态升级为「已完成」。

## 背景

代码审查 #2026-07-14 在 `wind-physics.ts`、`outfit.ts`、`outfit-overlay.ts` 中识别出三项「设计层」问题：

1. **wind-physics.ts 的 monkey-patch 脆弱**（Claim 11）：拦截 `MmdWasmRuntime.createMmdModel` 来重试 physics impl 订阅。`babylon-mmd` 无 `onModelLoaded` 事件（已核实其 runtime 仅暴露 `get models()` 与若干动画 Observable），当前 patch 是唯一可行手段，但脆弱——若内部实现变更则静默失效。
2. **outfit.ts 动态 `import('../scene/scene')` 破循环依赖**（Claim 12）：`outfit` ⇄ `scene` 双向依赖，当前用运行时 `await import()` 解耦，增加运行时开销且难以测试。
3. **outfit-overlay.ts 仅处理首个 skeleton**（Claim 13）：FBX 多角色场景下其他 skeleton 不被重定向。当前假设换装 FBX 为单角色，成立。

这三项均非「随手 bug」，而是**主动选择暂缓的设计债**——今时今日不改是为了避免回归，但必须正式登记，以免下轮审查重复指控（本次「审核的审核」已验证：盲从审查会引入回归）。

---

## 决策

1. **立项**：三项合并为一条 ADR，记录为技术债。已即时偿付 Claim 11、Claim 12，故状态为 `部分实现`。
2. **即时偿付 Claim 12**：同一 PR 内落地 `setSceneRef` 注入方案，移除动态 `import` 主路径（保留兜底）。
3. **Claim 11 走方案 A**：删 monkey-patch，改为在模型加载成功后的显式调用点 `retryWindPhysicsSubscription(runtime)`。保留既有的 `Map<runtime, sub>` 多运行时支持（审查 Claim 8 已修）。
4. **Claim 13 仅登记**：设置触发条件「出现多角色 FBX 换装需求时重做」，当前不投入。

---

## 详细处置

### A. `wind-physics.ts` 删 monkey-patch（方案 A，已落地）

**原实现**：`initWindPhysics` 在 `runtime.createMmdModel` 上挂 patch，每次模型加载时重试订阅；`_WindSub` 持有 `origCreateModel`/`patched` 用于 restore。

**改为**（保留多运行时 Map，去除 patch 字段）：

```typescript
// wind-physics.ts
interface _WindSub {
    observer: { remove(): void } | null;
}
const _subs = new Map<IMmdRuntime, _WindSub>();

export function initWindPhysics(runtime: IMmdRuntime): void {
    if (!(runtime instanceof MmdWasmRuntimeClass)) return;
    let sub = _subs.get(runtime);
    if (!sub) { sub = { observer: null }; _subs.set(runtime, sub); }
    _trySubscribe(runtime); // physics impl 可能尚不存在，由 retry 补齐
}

/** 模型加载成功后由 model-loader 显式调用，重试订阅 physics impl */
export function retryWindPhysicsSubscription(runtime?: IMmdRuntime): void {
    if (runtime) { _trySubscribe(runtime); return; }
    for (const rt of _subs.keys()) _trySubscribe(rt);
}
```

**调用点**：`scene/manager/model-loader.ts` 在 `_mmdRuntime.createMmdModel(...)` 成功后调用 `retryWindPhysicsSubscription(_mmdRuntime)`。

**收益**：无 patch，语义清晰，依赖行为由显式调用承载；多运行时场景仍受支持。

### B. `outfit.ts` 注入 scene 引用（已落地）

**原实现**：`await import('../scene/scene')` 运行时加载，取 `mod.scene`。

**改为**：

```typescript
// outfit.ts
let _sceneRef: Scene | null = null;
export function setSceneRef(scene: Scene): void { _sceneRef = scene; }
async function _getScene(): Promise<Scene> {
    if (!_sceneRef) {
        const mod = await import('../scene/scene'); // 兜底：未注入时兼容旧路径
        _sceneRef = mod.scene;
    }
    return _sceneRef;
}
```

**调用点**：`scene.ts` 在 `setMmdRuntime(runtime)` 之后，以 `swallowError(import('../outfit/outfit').then(m => m.setSceneRef(scene)))` 注入。选用动态 import 而非静态 import，彻底规避 `scene → outfit → manager/material` 的潜在静态环（已核实 `manager/material.ts` 不反向依赖 scene/outfit）。

**收益**：破除循环依赖，同步读取，可测试；动态 import 路径保留为兜底，零回归。

### C. `outfit-overlay.ts` 多 skeleton 支持（登记，不实施）

**触发条件**：出现多角色 FBX 换装需求时，按 `mesh.skeleton` 分组逐个重定向（当前仅处理首个 skinned mesh 的 skeleton）。当前无此需求，不投入。

---

## 影响范围

| 文件 | 改动量 | 回归风险 |
|------|--------|----------|
| `physics/wind-physics.ts` | 删除 patch 字段+逻辑 ~20 行；新增 `retryWindPhysicsSubscription` ~12 行 | 低（语义等价，多运行时保留） |
| `outfit/outfit.ts` | `_sceneCache`→`_sceneRef` + `setSceneRef` 导出 ~10 行 | 低（行为等价，兜底保留） |
| `scene/scene.ts` | +3 行注入调用 | 低（复用既有 swallowError(import) 模式） |
| `scene/manager/model-loader.ts` | +1 import + 1 调用 | 低 |

**无破坏性变更**。

---

## 替代方案

| 方案 | 描述 | 被拒原因 |
|------|------|----------|
| 保留 patch + 加 `models.length` 校验 | 改动最小但保留技术债 | 与「删冗余」哲学相悖；本次审查已确认无 `onModelLoaded` 事件，patch 仍是脆弱点 |
| 轮询 `runtime.models.length` | 每帧检查，实时性好 | 引入帧循环开销，杀鸡用牛刀 |
| 三项全登不修 | 纯登记 | Claim 11、12 顺手可修且低风险，不应拖延 |
| scene.ts 静态 import `setSceneRef` | 调用最直接 | 虽已核实无环，但动态 import 更彻底规避 TDZ 风险，与既有模式一致 |

---

## 验证

- `npm run check`：0 类型错误。
- `npm run test`：完整套件通过（含 `wind-physics.test.ts` 反射降级测试、`audio.test.ts` 回归测试）。
- Claim 11 路径：模型加载后 `retryWindPhysicsSubscription` 显式触发，等价于原 patch 的每次 `createMmdModel` 后重试；多运行时场景下各 runtime 独立订阅，无互相覆盖。

---

## 行动计划

1. ✅ 创建 `adr-104-physics-outfit-design-debt-deferral.md`
2. ✅ 同一 PR：落地 Claim 12 + Claim 11 方案 A
3. ✅ Claim 13 在 ADR 中登记触发条件
4. ⏸ PR 审查后合并（按惯例不自动推送）
