# ADR-165: 感知层性能基准 — 为 ADR-164 全员感知降级提供阈值依据

> **状态**: 已完成（2026-07-21）
> **关联**: ADR-056（WASM 图层混合热路径基准）、ADR-079（感知层扩展）、ADR-164（全员感知 + 性能降级）
> **来源**: ADR-164 §二前置条件 — 降级阈值需基准数据支撑
> **日期**: 2026-07-21

---

## 一、问题陈述

### 1.1 背景

ADR-164 计划实施全员感知 + 三档自动降级（high/medium/low），但降级阈值（模型数、fps）目前是**经验估计**：

| 档位 | 触发条件（估计） | 依据 |
|------|----------------|------|
| high | 模型 ≤ 20，fps > 55 | 粗略估计 |
| medium | 模型 20–50，fps 45–55 | 粗略估计 |
| low | 模型 > 50，fps < 45 | 粗略估计 |

**问题**：无实测数据，可能：
- 高估感知层成本 → 降级过早，用户看不到全员感知效果
- 低估感知层成本 → 降级不及时，100 模型场景掉帧

### 1.2 目标

建立感知层性能基准，测量：
- 单模型感知层单帧耗时（baseline）
- N 模型（1/10/20/50/100）的帧时间曲线
- 各感知项（breath/blink/gaze/balance/expression/lipsync）的耗时占比
- 对象池 GC 压力
- WASM vs JS 路径性能差异

**为 ADR-164 提供实测阈值**，并建立持续性能回归监控。

---

## 二、现有基础设施

### 2.1 性能监控（运行时）

[performance.ts](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/render/performance.ts) 已有：
- FPS 采样（30 帧滑动窗口）
- 自动降级机制（DegradeLevel 0–3）
- 渲染桥接（engine.getFps）

**但**：仅监控渲染层（光照/反射/后处理），**不覆盖感知层**。

### 2.2 性能基准测试（headless）

[wasm-layers-blender.perf.test.ts](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/__tests__/wasm-layers-blender.perf.test.ts) 已有成熟模式：
- NullEngine + 真实 PMX 骨骼图
- 复刻热路径（`_writeMatToBuffer` / `_propagateChildrenWasm`）
- vitest `exclude: '**/*.perf.test.ts'`（默认不跑，手动执行）
- 运行命令：`npx vitest run src/__tests__/wasm-layers-blender.perf.test.ts`

**本 ADR 复用该模式**，建立 `perception.perf.test.ts`。

---

## 三、设计方案

### 3.1 基准测试文件

**文件**：`frontend/src/__tests__/perception.perf.test.ts`

**结构**（复刻 wasm-layers-blender.perf.test.ts 模式）：

```typescript
// 1. 加载真实 PMX（复刻 findPmx）
const pmxPath = findPmx('test-assets');
const scene = new Scene(new NullEngine());
const mmdRuntime = new MmdRuntime(scene);
const mmdModel = await loadPmx(pmxPath);  // 单模型加载

// 2. 复刻感知层热路径（不导入 perception.ts，避免循环依赖）
//    - _applyBreathing: matchBone + Quaternion.RotationAxis + Slerp
//    - _applyBlinking: morphManager.getTargetByName + influence
//    - _applyGaze: _clampHeadGazeTarget + Slerp + updateWorldMatrix
//    - _applyBalanceSway: 6 骨骼增量叠加
//    - _applyMicroExpression: morph influence 脉冲

// 3. 测量维度
test('单模型感知层单帧耗时', () => {
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
        _applyBreathing(model, time + i * 0.016);
        _applyBlinking(model, time + i * 0.016);
        _applyGaze(model, cam, dt);
        _applyBalanceSway(model, time + i * 0.016, true, 2.0, 1.0);
        _applyMicroExpression(model, time + i * 0.016, true, 'neutral');
    }
    const elapsed = performance.now() - t0;
    const perFrame = elapsed / 1000;
    expect(perFrame).toBeLessThan(0.5);  // 单模型 < 0.5ms
});

test('N 模型帧时间曲线', () => {
    for (const n of [1, 10, 20, 50, 100]) {
        const models = Array.from({ length: n }, () => cloneModel(mmdModel));
        const t0 = performance.now();
        for (let i = 0; i < 100; i++) {
            for (const m of models) {
                _applyAllPerception(m, time + i * 0.016);
            }
        }
        const perFrame = (performance.now() - t0) / 100;
        console.log(`N=${n}: ${perFrame.toFixed(3)}ms/frame`);
    }
});

test('各感知项耗时占比', () => {
    const items = ['breath', 'blink', 'gaze', 'balance', 'expression'];
    for (const item of items) {
        const t0 = performance.now();
        for (let i = 0; i < 10000; i++) {
            applyItem(item, model, time + i * 0.016);
        }
        console.log(`${item}: ${(performance.now() - t0).toFixed(2)}ms / 10000 frames`);
    }
});
```

### 3.2 测量矩阵

| 维度 | 测量项 | 目的 |
|------|--------|------|
| **单模型 baseline** | 6 项感知 × 1 模型 × 1000 帧 | 建立基准耗时 |
| **N 模型扩展性** | 1/10/20/50/100 模型 × 100 帧 | 找到线性/超线性拐点 |
| **各感知项占比** | 6 项分别测量 × 10000 帧 | 识别耗时大头，优化方向 |
| **WASM vs JS** | 两种 runtime 各 1000 帧 | 评估 WASM 加速收益 |
| **对象池 GC** | N 模型 × 1000 帧 + `--expose-gc` + `gc()` | 评估 GC 压力 |
| **claimBones 开销** | activate 时 claimBones × N 模型 | 评估 ADR-163 的 activate 成本 |

### 3.3 输出格式

```typescript
// 控制台输出（供 ADR-164 人工分析）
console.log('=== Perception Performance Benchmark ===');
console.log(`Single model: ${perFrame.toFixed(3)}ms/frame`);
console.log(`N=10:  ${n10.toFixed(3)}ms/frame`);
console.log(`N=20:  ${n20.toFixed(3)}ms/frame`);
console.log(`N=50:  ${n50.toFixed(3)}ms/frame`);
console.log(`N=100: ${n100.toFixed(3)}ms/frame`);
console.log('--- Per-item breakdown ---');
console.log(`breath:     ${breath.toFixed(3)}ms`);
console.log(`blink:      ${blink.toFixed(3)}ms`);
console.log(`gaze:       ${gaze.toFixed(3)}ms`);
console.log(`balance:    ${balance.toFixed(3)}ms`);
console.log(`expression: ${expression.toFixed(3)}ms`);
console.log(`lipsync:    ${lipsync.toFixed(3)}ms`);
```

### 3.4 阈值断言（软断言，不阻塞 CI）

```typescript
// 软断言：超出阈值时 console.warn 但不 fail（避免 CI 机器性能波动导致误报）
test('单模型感知层 < 1ms/frame', () => {
    // ...
    if (perFrame > 1.0) {
        console.warn(`⚠ 单模型感知层耗时 ${perFrame.toFixed(3)}ms 超过 1ms 阈值`);
    }
});

test('100 模型感知层 < 16.67ms/frame（60fps 预算）', () => {
    // ...
    if (perFrame > 16.67) {
        console.warn(`⚠ 100 模型感知层耗时 ${perFrame.toFixed(3)}ms 超过 60fps 预算`);
    }
});
```

---

## 四、ADR-164 阈值推导

基于基准结果，**实测推导** ADR-164 的降级阈值：

| ADR-164 档位 | 实测阈值推导 | 依据 |
|--------------|-------------|------|
| high | 单模型 < 0.5ms 且 N=20 < 10ms | 留 6ms 给渲染 |
| medium | N=50 < 15ms | 接近 60fps 预算 |
| low | N=100 > 16.67ms | 已突破 60fps |

**示例推导**（假设基准结果）：
- 单模型感知 = 0.3ms
- 线性扩展：N=20 → 6ms, N=50 → 15ms, N=100 → 30ms
- 推导：high ≤ 20 模型（6ms < 10ms 预算），medium ≤ 50 模型（15ms 接近预算），low > 50

**实际阈值以基准实测为准**，本 ADR 完成后回填 ADR-164 §3.1。

---

## 五、改动范围

| 文件 | 改动 | 风险 |
|------|------|------|
| 新增 `frontend/src/__tests__/perception.perf.test.ts` | 基准测试主体 | 🟢 低（默认不跑） |
| [vitest.config.ts](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/vitest.config.ts) | 确认 `exclude: '**/*.perf.test.ts'` 已覆盖 | 🟢 低 |
| 新增 `frontend/test-assets/` 或复用现有 | PMX 测试资产 | 🟡 低（需确认资产位置） |

---

## 六、实施计划

| 阶段 | 内容 |
|------|------|
| **Phase 1** | 复刻感知层热路径到测试文件（不导入 perception.ts，避免循环依赖） |
| **Phase 2** | 实现单模型 baseline + N 模型扩展性测试 |
| **Phase 3** | 实现各感知项占比 + WASM vs JS 对比 |
| **Phase 4** | 运行基准，记录结果，回填 ADR-164 阈值 |
| **Phase 5** | 文档化运行命令 + 结果解读指南 |

---

## 七、验收标准

| 标准 | 验证方法 |
|------|---------|
| `perception.perf.test.ts` 可独立运行 | `npx vitest run src/__tests__/perception.perf.test.ts` |
| 默认 test 套件不包含 perf 测试 | `npm run test` 不触发 perf 测试 |
| 输出单模型 baseline | 控制台打印耗时 |
| 输出 N 模型曲线（1/10/20/50/100） | 控制台打印 5 个数据点 |
| 输出各感知项占比 | 控制台打印 6 项耗时 |
| 基准结果回填 ADR-164 阈值 | ADR-164 §3.1 更新为实测值 |

---

## 八、与 ADR-056 基准的关系

| 项 | ADR-056 | ADR-165（本） |
|----|---------|--------------|
| 测量对象 | WASM 图层混合 | 感知层 6 项 |
| 热路径 | `_applyLayersBlending` | `_applyBreathing` 等 |
| 复刻模式 | NullEngine + 真实 PMX | 同 |
| 运行方式 | 手动 `npx vitest run` | 同 |
| CI 阻塞 | 不阻塞 | 不阻塞 |

**复用**：ADR-165 复用 ADR-056 的 PMX 加载、NullEngine、`findPmx` 等基础设施。

---

## 九、开放问题

1. **测试资产位置**：复用 ADR-056 的 PMX 资产路径，还是新建 `test-assets/`？建议复用。
2. **WASM 路径基准**：ADR-056 已说明 node headless 下 WASM 加载不可靠，本基准可能仅测 JS 路径。WASM 路径需在真机环境另行测量。
3. **持续监控**：是否需要将基准结果写入文件供 CI 对比？建议初期手动运行，后续按需自动化。
4. **多骨骼模型差异**：不同 PMX 骨骼数差异大（500 vs 2000），基准应记录骨骼数。建议选 2-3 个代表性 PMX（低/中/高骨骼数）。
5. **GC 测量精度**：`--expose-gc` + `gc()` 仅强制 GC，不反映真实 GC 时机。建议用 `performance.memory`（Chrome）或 `--heap-prof` 辅助。
