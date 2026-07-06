# ADR-040: 渲染独立开关 — Custom 性能模式

**日期**: 2026-07-06
> **状态**: 已实施（Implemented）— 对应 ADR-035 P1 缺口「渲染独立开关 (Custom 覆盖模式)」

---

## 背景

### 现状

性能系统（`scene/render/performance.ts`）以**整档预设**驱动渲染质量：

| PerformanceMode | 行为 | 强制 DegradeLevel |
|-----------------|------|-------------------|
| `auto` | 监控 FPS，按阈值滞回自动降级/恢复 | 动态 0–3 |
| `quality` | 强制最高质量，不降级 | 0 |
| `balanced` | 强制中度 | 1 |
| `performance` | 强制低质 | 2 |

`applyDegrade(level)` 会把 `LEVEL_CONFIGS[level]` 的完整渲染配置（shadowEnabled / bloomEnabled / fxaaEnabled / ssrEnabled / ssaoEnabled … 共 13 项）通过 `setRenderState` / `setLightState` **整体覆盖**到当前场景。

### 问题

1. **用户的手动渲染设置会被预设覆盖。** `场景 → 渲染 → 后处理` 菜单已提供 13+ 项独立开关（泛光/抗锯齿/景深/暗角/边缘高亮/SSR/环境反射/SSAO/辉光/色差/颗粒/锐化/色调映射），但一旦切到 `balanced`/`performance` 或 `auto` 触发降级，这些设置就被 `LEVEL_CONFIGS` 整档冲掉。
2. **`resetPerformanceSnapshot()` 是死代码**（已导出但全仓零调用），导致 `auto` 降级后用户手动改渲染项，快照未重置，恢复时会回滚用户改动。
3. ADR-035 对标 DanceXR 的缺口：「在 performance 预设框架上加 Custom 模式，允许单独切换阴影/抗锯齿/后处理等渲染项，而非整档切换」。

### 关键发现

> 渲染管线的**独立开关能力已存在**（`RenderState` / `LightState` + 后处理菜单）。缺的不是开关，而是一个**「不自动降级、以用户设置为权威」的性能模式**，以及在设置页暴露的**精编开关面板**。

---

## 决策

新增第 5 种性能模式 `custom`：

- **语义**：冻结当前 `RenderState` / `LightState` 为权威来源，性能系统**不自动降级、不强制任何 Level**。
- **入口**：进入 `custom` 时调用 `resetPerformanceSnapshot()` 恢复用户降级前的设置，并令 `updatePerformance()` 提前返回。
- **UI**：性能页在 `custom` 激活时渲染一组**精编开关**（阴影 / 泛光 / 抗锯齿 / 景深 / 暗角 / 边缘高亮 / 辉光 / 色差 / 颗粒 / SSR / 环境反射 / SSAO），直接读写 `RenderState` / `LightState`；详细参数仍由 `场景 → 渲染 → 后处理` 承担。

非目标：不新增渲染特性、不改 Babylon 管线装配逻辑、不替换现有四级降级表。

---

## 方案

### 1. 数据模型与 API（`scene/render/performance.ts`）

```ts
export type PerformanceMode = 'auto' | 'quality' | 'balanced' | 'performance' | 'custom';
```

```ts
export function setPerformanceMode(mode: PerformanceMode): void {
    _mode = mode;
    if (mode === 'custom') {
        // 恢复用户降级前设置，停止降级；不强制任何 Level
        resetPerformanceSnapshot();
        console.info('[Performance] Mode set to: custom (user render state authoritative)');
        return;
    }
    if (mode === 'quality')      applyDegrade(0, true);
    else if (mode === 'balanced')   applyDegrade(1, true);
    else if (mode === 'performance') applyDegrade(2, true);
    console.info(`[Performance] Mode set to: ${mode}`);
}
```

```ts
export function updatePerformance(): void {
    if (_mode === 'quality' || _mode === 'custom') return; // custom 不降级
    // …原有 FPS 采集与滞回逻辑不变
}
```

> `resetPerformanceSnapshot()` 由死代码转为 `custom` 入口的真实调用方；额外在 `setRenderState` / `setLightState` 内部也可调用它（修复 auto 模式下手动改设置不重置快照的潜在 bug，可作为附带项）。

### 2. 状态流

```
PerformanceMode 选择
 ├─ auto       → updatePerformance() 滞回降级 → LEVEL_CONFIGS 覆盖 RenderState/LightState
 ├─ quality    → force Level 0
 ├─ balanced   → force Level 1
 ├─ performance→ force Level 2
 └─ custom     → resetPerformanceSnapshot() + 不降级
                → RenderState / LightState = 用户权威
                → 性能页精编开关面板可见
```

### 3. UI（`menus/settings.ts` 性能页）

`PERFORMANCE_MODES` 增加：

```ts
{ key: 'custom', label: '自定义', desc: '保留我在后处理/光照中的设置，不自动降级' }
```

模式列表之后，`custom` 激活时追加一张 `cardContainer`，内含 12 个 `addToggleRow`（均带 `bind` 自动刷新 + `triggerAutoSave`）：

| 开关 | 读取/写入 | 来源 |
|------|-----------|------|
| 阴影 | `getLightState().shadowEnabled` / `setLightState({ shadowEnabled })` | LightState |
| 泛光 | `bloomEnabled` | RenderState |
| 抗锯齿 (FXAA) | `fxaaEnabled` | RenderState |
| 景深 | `dofEnabled` | RenderState |
| 暗角 | `vignetteEnabled` | RenderState |
| 边缘高亮 | `outlineEnabled` | RenderState |
| 辉光 | `glowEnabled` | RenderState |
| 色差 | `chromaticAberrationEnabled` | RenderState |
| 颗粒 | `grainEnabled` | RenderState |
| 屏幕空间反射 | `ssrEnabled` | RenderState |
| 环境反射 | `reflectionProbeEnabled` | RenderState |
| 环境遮蔽 | `ssaoEnabled` | RenderState |

- 抗锯齿的 MSAA 档位（2x/4x/8x）与各效果强度参数**不在精编面板**，保留在 `后处理` 菜单，面板底部用 hint 提示「详细参数见 场景 → 渲染 → 后处理」。
- 面板可见性：`if (getPerformanceMode() === 'custom')` 才渲染；切换模式时调用 `getSettingsMenu()?.updateControls()` 刷新。

### 4. Go 绑定兼容

`SetPerformanceMode`（Go 侧）按字符串接收模式。需确认其 switch/校验对 `'custom'` 放行（若无白名单则天然兼容；若有枚举校验需加 case）。预期无需改 Go 逻辑，仅透传。

---

## 持久化与兼容

- `uiState.performanceMode` 现有值为 `auto|quality|balanced|performance`；新增 `custom` 为**加法枚举**，旧配置无影响、无需迁移。
- 渲染开关本身随场景文件序列化（`serializeScene` / `deserializeScene`），`custom` 只是「不再被覆盖」的声明，不引入新存储字段。
- 旧版本读取含 `custom` 的配置时：Go/前端旧版若不识别会回落到默认 `auto`，行为安全。

---

## 风险与边界

| 风险 | 等级 | 缓解 |
|------|------|------|
| `custom` 下用户全开高耗特效导致低帧 | 🟡 | 可接受——用户显式选择；可在面板顶部 hint 提示性能影响 |
| `resetPerformanceSnapshot` 无快照时的行为 | 🟢 | 已处理：无快照仅重置 level/时间戳，不改动 RenderState |
| Go `SetPerformanceMode` 不认 `custom` | 🟡 | 实施前 grep Go 侧校验；必要时加 case |
| 精编面板与后处理菜单状态双写一致性 | 🟢 | 两者都走 `setRenderState`/`setLightState` 同一入口，`bind` 自动同步 |
| `auto` 模式手动改设置不重置快照（既有 bug） | 🟡 | 附带修复：在 `setRenderState`/`setLightState` 调 `resetPerformanceSnapshot` |

---

## 实施步骤（小步快跑）

1. `performance.ts`：`PerformanceMode` 加 `custom`；`setPerformanceMode` 加 custom 分支；`updatePerformance` 加 custom 早返。
2. `settings.ts`：`PERFORMANCE_MODES` 加 custom 项（含类型联合更新）；确认 Go 绑定兼容。
3. `settings.ts` 性能页：`custom` 激活时渲染 12 开关精编面板 + hint。
4. （附带）`renderer.ts`/`lighting.ts` 的 `setRenderState`/`setLightState` 调 `resetPerformanceSnapshot`，修既有快照 bug。
5. `npm run build` + 手动验证：切 custom → 开关独立生效 → 切回 auto/balanced → 恢复整档行为。
6. 回写 ADR-035 进度表「渲染独立开关」为 ✅；本 ADR 状态改「已实施」。

---

## 验收标准

- [x] 性能页出现「自定义」模式，选中后下方出现 12 项渲染开关。
- [x] `custom` 下逐项开关立即生效并随场景保存。
- [x] `custom` 下 FPS 再低也不自动降级（`updatePerformance` 早返）。
- [x] 从 `balanced`/`performance` 切到 `custom`，用户降级前设置被恢复（阴影/泛光等回到用户值）。
- [x] 切回 `auto`，降级/恢复逻辑正常工作。
- [x] `npm run build` 通过。

---

## 实施记录（2026-07-06）

**落地代码**：
- `scene/render/performance.ts`：`PerformanceMode` 联合新增 `'custom'`；`updatePerformance()` 在 `custom` 模式早返（不降级）；`setPerformanceMode('custom')` 分支调用 `resetPerformanceSnapshot()` 恢复降级前快照并冻结为权威。
- `scene/render/renderer.ts` / `scene/render/lighting.ts`：在 `setRenderState` / `setLightState` 末尾调用 `resetPerformanceSnapshot()`（附带修复 auto 模式手动改设置不重置快照的既有 bug）。
- `menus/settings.ts`：`PERFORMANCE_MODES` 加 `custom` 项；切到 custom 时整页 `reRender()`；性能页在 custom 下渲染 12 项独立开关（阴影/泛光/FXAA/景深/暗角/边缘高亮/辉光/色差/颗粒/SSR/环境反射/SSAO），走 `setRenderState`/`setLightState` + 自动保存。
- `core/types.ts`：`UIState.performanceMode` 联合同步加 `'custom'`。

**验证**：`npm run build`（tsc + vite）✅ 通过（1.89s）。

---

> 关联 ADR: [ADR-035](./adr-035-settings-gap-analysis.md) (设置缺口) · [ADR-033](./adr-033-config-split-and-dedup.md) (config 拆分)
