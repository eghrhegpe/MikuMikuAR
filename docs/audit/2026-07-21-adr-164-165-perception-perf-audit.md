# ADR-164 / ADR-165 深度审核报告

**审核范围**：感知层 per-model Phase 2（全员感知 + 三档自动降级）+ 性能基准
**审核日期**：2026-07-21
**审核员**：首席架构师视角

---

## 一、导入图谱

### 1.1 依赖关系确认

| 断言 | 实测结果 | 结论 |
|------|---------|------|
| PerceptionPerfMonitor 定义在 perception-shared.ts | perception-shared.ts:242-347 类定义；perception.ts:31 导入 | ✅ 一致 |
| scene.ts 通过 onModelAdded/onModelRemoved hook 自动激活/注销感知 | scene.ts:430-434 setOnModelLoaded 调用 activatePerception(id)；scene.ts:368-421 modelManager.onRemoveModel 调用 onModelRemoved(id)（→ proc-motion-bridge.ts:281 → onPerceptionModelRemoved） | ✅ 一致（无显式 onModelAdded hook 名，但通过 setOnModelLoaded 实现） |
| perception.perf.test.ts 不导入 perception.ts | 仅导入 @babylonjs/core/math.vector、vitest、../motion-algos/proc-motion-shared、../motion-algos/lipsync | ✅ 一致（避免循环依赖） |

### 1.2 关键依赖链

```
scene.ts → proc-motion-bridge.ts → perception.ts → perception-shared.ts (含 PerceptionPerfMonitor)
                                                       ↑
                              perception-gaze/balance/expression.ts (子模块)
```

perception.ts 通过 `getScene()` from `../env/env-impl` 延迟获取 scene 实例，避免静态循环依赖（perception.ts:15 注释明示）。

---

## 二、状态读写追踪

### 2.1 `_perfMonitor.update()` 调用频率

**实测**：perception.ts:374 observer 每帧调用 `_perfMonitor.update(scene, activeCount)`；perception-shared.ts:285-287 内部按 `_sampleInterval = 30` 采样 fps。

```typescript
// perception-shared.ts:285
if (this._frameCounter % this._sampleInterval !== 0) {
    return;
}
```

✅ 与 ADR-164 §3.2 "每 N 帧采样一次（非每帧）" 一致（N=30）。

### 2.2 三档降级触发逻辑验证

| ADR-164 规则 | 实测代码 | 一致性 |
|-------------|---------|--------|
| 连续 60 帧 fps<45 → 降一档 | `_thresholdDown=45`、`_framesForDown=60`、`_lowStreak += _sampleInterval`（每次采样累加 30，2 次采样=60 触发） | ✅ |
| 连续 120 帧 fps>55 → 升一档 | `_thresholdUp=55`、`_framesForUp=120`、`_highStreak += _sampleInterval`（4 次采样=120 触发） | ✅ |
| 模型数>50 → 强制 low | `_forceLowModelCount=50`；perception-shared.ts:271-276 硬边界优先于 fps | ✅ |
| 模型数≤20 → 强制 high | `_forceHighModelCount=20`；perception-shared.ts:277-282 | ✅（ADR 未明示，但合理推断） |

**滞后规则**：perception-shared.ts:299-301 在 45-55 fps 之间复位 streak（稳定带不累积），避免边缘抖动。✅ 设计正确。

### 2.3 tier 状态持久化（序列化/反序列化）

**序列化**：scene-serialize.ts:480-483

```typescript
tier: getPerceptionPerfTier(),     // 返回当前运行时 tier（'high'/'medium'/'low'）
allEnabled: isAllPerceptionEnabled(),
```

**反序列化**：scene-serialize.ts:928-934

```typescript
if (pAny?.tier) {
    setPerceptionPerfTier(pAny.tier);   // 传入 'high'/'medium'/'low'，被 setManualTier 解释为手动档
}
```

> **🔴 关键缺陷**：序列化保存的是**运行时 tier**（如 'high'），而非用户意图（`_manualTier`，如 'auto'）。反序列化后 `setManualTier('high')` 会将 `_manualTier` 设为 'high'，永久禁用自动降级。详见风险表 P1-1。

### 2.4 手动档与自动降级冲突（开放问题 2）

**实测**：perception-shared.ts:265-268

```typescript
if (this._manualTier !== 'auto') {
    this.tier = this._manualTier;
    return;   // 直接返回，跳过模型数硬边界 + fps 采样
}
```

✅ 与 ADR-164 §九.2 "不强制降级" 一致。

> 但 ADR-164 §九.2 还提到 "仅 warn"，实测代码**无 warn 日志**。用户手动设 high 但帧率持续下降时无任何提示。详见风险表 P3-1。

### 2.5 对象池 per-context 改造（关键缺口）

**ADR-164 §3.6 / §四 改动表**：

| 文件 | 改动 | 优先级 | 注 |
|------|------|--------|----|
| perception-shared.ts | 新增 PerceptionPerfMonitor；**对象池改 per-context** | 中 | 推荐方案 B：per-context 独立池（避免大池浪费） |

**实测代码**（perception-shared.ts:89-94）：

```typescript
const _v3Pool = Array.from({ length: 16 }, () => new Vector3());
const _mPool = Array.from({ length: 16 }, () => new Matrix());
const _qPool = Array.from({ length: 32 }, () => new Quaternion());
let _v3Idx = 0, _mIdx = 0, _qIdx = 0;
```

> **per-context 改造完全未实施**。仍是全局单例池。100 模型场景下池槽循环覆写 ~75 次/帧。详见风险表 P1-2。

### 2.6 `_manualTier` 无 getter 暴露

perception-shared.ts:247 `private _manualTier: PerceptionTier | 'auto' = 'auto';` —— 无 `getManualTier()` 方法，外部无法读取用户意图。这是 §2.3 序列化 bug 的根因。

---

## 三、资源配对验证

### 3.1 `enableAllPerception` / `disableAllPerception` 资源配对

**enableAllPerception**（perception.ts:758-772）：
- 遍历 `modelManager.modelRegistry`
- 对未激活 context：`_resetContextOffsets(ctx)` + `ctx.isActive = true` + `_claimPerceptionBones(id)`
- `_ensureObserverRegistered()`

**disableAllPerception**（perception.ts:775-786）：
- 遍历 `_contexts.values()`
- 跳过焦点 + pinned
- 对其余：`ctx.isActive = false` + `_releasePerceptionBones(ctx.modelId)` + `_resetContextOffsets(ctx)`

✅ 配对正确。但 `_allEnabled = false` 不影响焦点/pinned context（保留）。✅ 符合 ADR-164 §3.3 "全员关闭（仅焦点保留）"。

### 3.2 模型移除时 context 清理

**onPerceptionModelRemoved**（perception.ts:827-835）：

```typescript
if (_focusedContextId === id) {
    deactivatePerception();    // 释放骨骼 + 重置 offsets + ctx.isActive = false + _focusedContextId = null
} else {
    _releasePerceptionBones(id);   // 仅释放骨骼
}
_contexts.delete(id);            // 删除 context
_perceptionOwnedBones.delete(id);
```

✅ context 删除 + 骨骼释放配对正确。

> 但 `_allEnabled` 标志未根据 `modelRegistry.size` 自动调整：若所有模型被移除后 `_allEnabled` 仍为 true，下次 `enableAllPerception()` 调用时不会重新激活任何模型（因 modelRegistry 空）。这是设计选择（非 bug），但语义略含糊。

### 3.3 基准测试资源 dispose

perception.perf.test.ts：
- 无 NullEngine / Scene 实例（用合成 ModelStub）
- 无 afterAll / afterEach 清理
- 全局 `_v3Pool` / `_mPool` / `_qPool` 是模块级常量，不需要 dispose

✅ 无资源泄漏风险。但与 ADR-165 §3.1 "NullEngine + Scene + MmdRuntime + loadPmx" 描述偏离（实测用合成 stub，更轻量但与 ADR 文档不一致）。

---

## 四、心理模拟

### 4.1 100 模型场景自动降级触发

**模拟**：
1. 用户加载 100 模型 → `setOnModelLoaded` 触发 `activatePerception(id)` 100 次
2. 若 `_allEnabled === false`：仅最后一个成为焦点，其余 99 个 context `isActive = false`
3. 若 `_allEnabled === true`：100 个 context 全部 `isActive = true`
4. observer 第一帧：`activeCount = 100`，`_perfMonitor.update(scene, 100)`
5. `_forceLowModelCount = 50`，100 > 50 → `tier = 'low'`，立即降级

✅ 触发正确。但降级前第一帧仍按原 tier 执行（可能是 high），可能瞬时卡顿。建议第一帧前先评估 tier。

### 4.2 tier 切换视觉跳变（开放问题 1）

**ADR-164 §九.1**：

> 建议 0.5s 过渡淡入

**实测**：perception-gaze.ts:123 `if (tier === 'low') return;` —— 直接跳过，无过渡。`_applyGaze` 不存在 alpha 渐入逻辑。

> 开放问题 1 未实施。low→high 切换时，原本无 gaze 的模型突然 gaze 跟随。详见风险表 P3-2。

### 4.3 手动 high + 帧率持续下降

**模拟**：
1. 用户 `setPerceptionPerfTier('high')` → `_manualTier = 'high'`、`tier = 'high'`
2. 加载 100 模型 → `update()` 第一行 `if (this._manualTier !== 'auto') { this.tier = this._manualTier; return; }`
3. tier 保持 'high'，所有 100 模型每帧执行 gaze/balance/expression

✅ 与 ADR-164 §九.2 "不强制降级" 一致。但无 warn 提示，用户不知性能问题。详见风险表 P3-1。

### 4.4 AR 模式全员感知（开放问题 3）

**ADR-164 §九.3**：

> AR 模式下强制 tier=high 且仅焦点激活

**实测**：
- ar-scene.ts:182 仅调用 `activatePerception()`（默认焦点）
- 无 `setPerceptionPerfTier('high')` 调用
- 无 `disableAllPerception()` 调用
- perception-gaze.ts:71 `isARActive()` 仅影响 `_getGazeTarget`（沿相机朝向投射），不影响 tier

> 开放问题 3 未实施。AR 模式下若用户已开 `_allEnabled = true`，仍会激活所有模型。详见风险表 P3-3。

### 4.5 性能基准测试可执行性

**实测**：
- vitest.config.ts:21 `exclude: ["e2e/**", "node_modules/**", "**/*.perf.test.ts"]` ✅ 默认不跑
- vitest.perf.config.ts 存在 ✅ 专用配置
- 运行命令：`npx vitest run --config vitest.perf.config.ts src/__tests__/perception.perf.test.ts` ✅
- 测试文件用合成 ModelStub（不依赖 PMX 资产）✅ 可独立运行
- 单 `test()` 超时 180 秒 ✅ 合理

✅ 基准测试可执行。

### 4.6 PMX 资产路径

**ADR-165 §3.1**：

```typescript
const pmxPath = findPmx('test-assets');
```

**实测**：
- 测试文件未调用 `findPmx`
- 用 `createSyntheticModelStub()` 生成合成骨骼图（~100 骨）
- `text-model/PMX/test.pmx` 存在但未被使用

> 与 ADR-165 §3.1 设计描述偏离，但更轻量、更可重复。建议在 ADR-165 中更新描述。详见风险表 P4-1。

### 4.7 ADR-164 §3.1 阈值是否回填实测值

**ADR-164 §3.1**：

| 档位 | 适用场景 |
|------|---------|
| high | 模型数 ≤ 20，帧率稳定 60fps |
| medium | 模型数 20–50，或帧率 45–60fps |
| low | 模型数 > 50，或帧率 < 45fps |

**ADR-165 §四**：

> 示例推导（假设基准结果）：
> 单模型感知 = 0.3ms
> 线性扩展：N=20 → 6ms, N=50 → 15ms, N=100 → 30ms
> 实际阈值以基准实测为准，本 ADR 完成后回填 ADR-164 §3.1。

**实测代码**（perception-shared.ts:256-257）：

```typescript
private _forceLowModelCount = 50;
private _forceHighModelCount = 20;
```

> **阈值未回填**。ADR-164 §3.1 仍是初始估计值，ADR-165 §四明确说"示例推导（假设基准结果）"，意味着基准未实际运行过。验收标准第 226 行 "基准结果回填 ADR-164 阈值 | ADR-164 §3.1 更新为实测值" 未达成。详见风险表 P2-1。

---

## 五、审核输出报告

**总体结论**：有条件通过

核心降级触发逻辑、API 设计、context 生命周期管理均正确实施，可上线。但存在 **2 个 P1 风险**（序列化保存运行时 tier 导致自动降级失效、对象池 per-context 未实施）、**3 个 P2 风险**（阈值未回填、`_manualTier` 无 getter、`_getActiveContextsByTier` 中 medium 档硬编码 10）、**3 个 P3 风险**（开放问题 1/2/3 未实施）、**2 个 P4 风险**（dead code、ADR 描述偏离）。建议优先修复 P1 后再合并。

### 亮点

- ✅ 降级滞后规则正确（perception-shared.ts:299-301 45-55 fps 稳定带复位 streak，避免边缘抖动）
- ✅ 模型数硬边界优先于 fps（perception-shared.ts:271-282 50/20 边界即时切换，不等采样）
- ✅ 手动档优先级正确（perception-shared.ts:265-268 `_manualTier !== 'auto'` 时直接 return，禁用自动降级）
- ✅ context 生命周期配对完整（enableAllPerception/disableAllPerception/onPerceptionModelRemoved 三处骨骼 claim/release 配对）
- ✅ 基准测试避免循环依赖（perception.perf.test.ts 不导入 perception.ts，复刻热路径）
- ✅ 基准测试可独立运行（合成 ModelStub，无 PMX 依赖）
- ✅ tier 守卫分级正确（low 跳过 gaze/balance/expression；medium gaze 每 2 帧、expression 每 4 帧）
- ✅ 冲突 banner 收敛（motion-gaze-levels.ts:412 仅显示焦点模型冲突）
- ✅ UI tier 显示 + 手动覆盖选项完整（motion-gaze-levels.ts:67-120）
- ✅ 序列化扩展 tier + allEnabled 字段（scene-serialize.ts:264-271）

### 风险表

| 优先级 | 文件 | 观察 | 建议 |
|--------|------|------|------|
| 🔴 **极高 P1** | perception-shared.ts:247 / scene-serialize.ts:481 | `_manualTier` 是 private 无 getter；序列化保存运行时 tier（如 'high'）而非用户意图（'auto'）。反序列化后 `setManualTier('high')` 永久禁用自动降级，即使场景重新加载 100 模型也保持 high 档导致掉帧 | 1. 在 PerceptionPerfMonitor 添加 `getManualTier(): PerceptionTier \| 'auto'` 公开方法；<br>2. scene-serialize.ts:481 改为 `tier: getPerceptionPerfManualTier()`（新增导出）；<br>3. 若 manualTier 为 'auto' 则不写 tier 字段或写 'auto'，反序列化时仅当显式非 'auto' 才调 `setPerceptionPerfTier` |
| 🔴 **极高 P1** | perception-shared.ts:89-94 | 对象池仍是全局单例（`_v3Pool[16]/_mPool[16]/_qPool[32]`），ADR-164 §3.6 §四 明确要求 per-context 改造未实施。100 模型 × 28 池槽消费 = 2800，循环覆写 ~75 次/帧，虽然 `copyFrom` 紧跟 `_q()` 防止数据污染，但与 ADR 设计不符；未来若某子函数保留 `_q()` 引用跨调用则会污染 | 1. 短期：在 ADR-164 §3.6 添加豁免理由（"全局池 + copyFrom 模式在当前调用序列下安全，per-context 推迟到 P2 实测发现实际问题时再实施"）；<br>2. 长期：抽取 `PerceptionPool` 类，`PerceptionContext` 持有独立 `pool: PerceptionPool`，子模块签名改为 `(ctx: PerceptionContext, ...)` 接收池；<br>3. 添加回归测试验证跨 `_q()` 调用引用安全 |
| 🟠 **高 P2** | perception-shared.ts:256-257 | 阈值 `_forceLowModelCount=50`/`_forceHighModelCount=20` 为硬编码常量，ADR-165 §四承诺"实际阈值以基准实测为准，本 ADR 完成后回填 ADR-164 §3.1"，但 ADR-164 §3.1 仍是初始估计值，ADR-165 §四第 186 行明确写"示例推导（假设基准结果）"，基准未实际运行 | 1. 在本地运行 `npx vitest run --config vitest.perf.config.ts src/__tests__/perception.perf.test.ts`，记录 P50/P95 数据；<br>2. 根据实测结果更新 ADR-164 §3.1（标注"实测回填：YYYY-MM-DD，单模型=Xms，N=20=Yms..."）；<br>3. 若实测与估计偏差>20%，调整 `_forceLowModelCount`/`_forceHighModelCount` 常量 |
| 🟠 **高 P2** | perception-shared.ts:247 | `_manualTier` 是 private，外部无法读取用户意图。导致 §2.3 序列化 bug、UI 无法显示"当前是手动还是自动"（motion-gaze-levels.ts:110 注释自承"通过 getPerceptionPerfTier 近似，实际无存储态暴露"） | 1. 添加 `getManualTier(): PerceptionTier \| 'auto'` 公开方法；<br>2. perception.ts 新增 `getPerceptionPerfManualTier()` 导出；<br>3. motion-gaze-levels.ts:110 `select.value = getPerceptionPerfManualTier()`（替代当前硬编码 'auto'） |
| 🟠 **高 P2** | perception.ts:347 | `_getActiveContextsByTier` medium 档硬编码 `others.slice(0, 10)`，与 ADR-164 §3.1 "前 N 个" 不一致（N 未定义）。该值未参数化，无法根据 tier 或硬件性能调整 | 1. 抽取常量 `MEDIUM_MAX_OTHERS = 10` 并在 ADR-164 §3.1 注明；<br>2. 或改为根据 `_perfMonitor.fps` 动态调整（fps>50 时 N=10，fps 45-50 时 N=5） |
| 🟡 **中 P3** | perception-shared.ts:265-268 | ADR-164 §九.2 "用户手动档不强制降级，仅 warn"。实测 `update()` 中 `_manualTier !== 'auto'` 直接 return，无 warn 日志。用户手动 high + 帧率<30 时无任何提示 | 在 `update()` 内手动档分支添加：<br>`if (this._manualTier !== 'auto') {`<br>&nbsp;&nbsp;`if (this.fps < 30 && this.modelCount > 20) {`<br>&nbsp;&nbsp;&nbsp;&nbsp;`logWarn('perception', \`手动档 ${this._manualTier} 但 fps=${this.fps.toFixed(0)} 模型=${this.modelCount}，建议切回 auto\`);`<br>&nbsp;&nbsp;`}`<br>&nbsp;&nbsp;`this.tier = this._manualTier;`<br>&nbsp;&nbsp;`return;`<br>`}` |
| 🟡 **中 P3** | perception-gaze.ts:123-124 / perception-balance.ts:74 / perception-expression.ts:38-39 | ADR-164 §九.1 "tier 切换视觉跳变，建议 0.5s 过渡淡入"。实测 `if (tier === 'low') return;` 直接跳过，无 alpha 渐入。low→high 切换时原本无 gaze 的模型突然 gaze 跟随 | 1. 在 PerceptionContext 添加 `tierTransitionAlpha: number`（0→1 渐入）；<br>2. observer 检测 tier 变化时设 `tierTransitionAlpha = 0`，每帧 `tierTransitionAlpha = Math.min(1, tierTransitionAlpha + dt / 0.5)`；<br>3. `_applyGaze` / `_applyBalanceSway` 等用 `alpha * tierTransitionAlpha` 作为最终振幅乘数 |
| 🟡 **中 P3** | ar-scene.ts:182 | ADR-164 §九.3 "AR 模式下强制 tier=high 且仅焦点激活"。实测 AR 启动仅调 `activatePerception()`，未 `setPerceptionPerfTier('high')`，未 `disableAllPerception()`。若用户已开全员感知，AR 中仍激活所有模型 | 1. ar-scene.ts:175 startARCamera 前保存 `_prevAllEnabled = isAllPerceptionEnabled()` + `_prevManualTier = getPerceptionPerfManualTier()`；<br>2. `disableAllPerception()` + `setPerceptionPerfTier('high')`；<br>3. ar-scene.ts:200 退出 AR 时恢复原状态 |
| 🟡 **中 P3** | motion-gaze-levels.ts:412-416 | ADR-164 §3.7 "pinned 模型的冲突在 pinned 面板独立显示"。实测 `updatePerceptionConflictBanner` 仅显示焦点模型冲突，pinned 模型冲突无独立显示入口 | 1. 在 pinned 模型列表项旁添加冲突徽章；<br>2. 或新增 `updatePinnedConflictBanner(el, modelId)` 函数，在 pinned 面板调用 |
| 🟢 **低 P4** | perception.ts:307-310 | `_applyGaze` 调用未传 `frameCounter` 参数（第 8 个参数）。perception-gaze.ts:124 `if (tier === 'medium' && frameCounter !== undefined && frameCounter % 2 !== 0) return;` 因 `frameCounter===undefined` 而失效（dead code）。外部 perception.ts:300 已用 `frameCounter % 2 === 0` 守卫，行为正确但代码冗余 | 1. 删除 perception-gaze.ts:120,124 的 `frameCounter` 参数和守卫（外部已守卫）；<br>2. 或补传 `frameCounter` 让双重守卫生效（防御性） |
| 🟢 **低 P4** | perception.ts:247-253 | `_applyMicroExpression` 调用未传 `frameCounter`。perception-expression.ts:39 `if (tier === 'medium' && frameCounter !== undefined && frameCounter % 4 !== 0) return;` 失效。外部 perception.ts:244 已用 `frameCounter % 4 === 0` 守卫 | 同上，二选一：删除内层 `frameCounter` 守卫或补传参数 |
| 🟢 **低 P4** | perception.perf.test.ts:57-178 / ADR-165 §3.1 | 测试用合成 ModelStub（~100 骨），ADR-165 §3.1 描述的是 `findPmx('test-assets')` + NullEngine + MmdRuntime + loadPmx。设计与实现偏离 | 在 ADR-165 §3.1 添加注记："实施时改为合成 ModelStub 以避免 PMX 加载开销，结果仅反映算法层耗时，不含 Babylon.js scene graph 开销。真实场景基准需在 wails dev 下用 Performance 面板测量" |

---

## 六、关键结论汇总

### 6.1 必修项（合并前）

| # | 风险 | 严重性 | 修复方案 |
|---|------|--------|---------|
| 1 | **序列化 tier bug（P1-1）**：`_manualTier` 无 getter → 序列化保存运行时 tier → 反序列化后自动降级永久禁用 | 🔴 必须修复，否则用户重启应用后失去自动降级能力 | 见风险表 P1-1 |
| 2 | **对象池 per-context 未实施（P1-2）**：与 ADR-164 §3.6 §四 明确要求不符 | 🔴 要么实施 per-context 池，要么在 ADR 中添加豁免理由，不能 silently 跳过 | 见风险表 P1-2 |

### 6.2 建议修复项（合并后跟进）

| # | 风险 | 严重性 | 修复方案 |
|---|------|--------|---------|
| 3 | 阈值未回填（P2-1） | 🟠 本地运行基准测试，记录实测数据，更新 ADR-164 §3.1 | 见风险表 P2-1 |
| 4 | `_manualTier` getter（P2-2） | 🟠 与 P1-1 同根因，添加 `getManualTier()` 公开方法 | 见风险表 P2-2 |
| 5 | 开放问题 1/2/3 实施（P3-1/2/3） | 🟡 tier 切换过渡淡入、手动档 warn、AR 模式强制 high | 见风险表 P3-1/2/3 |

### 6.3 可选改进项

| # | 风险 | 严重性 | 修复方案 |
|---|------|--------|---------|
| 6 | dead code 清理（P4-1/2） | 🟢 `_applyGaze` / `_applyMicroExpression` 内层 `frameCounter` 守卫失效，删除或补传参数 | 见风险表 P4-1/2 |
| 7 | ADR 文档同步（P4-3） | 🟢 ADR-165 §3.1 描述与实现偏离，添加注记说明合成 stub 方案 | 见风险表 P4-3 |

---

**审核完成。核心功能可用，但 P1 风险需在合并前修复。**