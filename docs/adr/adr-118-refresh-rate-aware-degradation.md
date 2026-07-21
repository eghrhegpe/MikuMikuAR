# ADR-118: 刷新率感知的自动降级阈值

> **状态**: ✅ 已完成（Phase 1 刷新率相对阈值 + Phase 2 运行时峰值校准全量落地）
> **背景**: 自动降级系统（`performance.ts` 的 `DEGRADE_THRESHOLDS` / `RECOVERY_THRESHOLDS`）使用**绝对 FPS 阈值**（28/20/14 降级、32/24/18 恢复），隐含假设基线为 60Hz。在 90/120/144Hz 高刷设备上，绝对阈值严重失准：120Hz 下 45fps 已明显卡顿（仅 37% 刷新率），但因 45 > 28 不触发降级，用户以为"没降级=没问题"，实际在掉帧。该问题由 ADR-DPR 修复（高 DPI 渲染清晰度修复）**直接激化**——修复后渲染缓冲区放大 9×，GPU 开始干真活，FPS 可能下滑，高刷设备的阈值失准从"理论"变"现实"。
> **关联**: 高 DPI 渲染清晰化修复（同轮 `render-loop.ts` 的 `calcHardwareScaling` + DPR 纳入）、[ADR-100](adr-100-camera-control-behavior-dual-axis.md)（性能相关收尾）

---

## 一、问题边界

### 1.1 现状清点

| 项 | 事实 | 来源 |
|----|------|------|
| 降级阈值语义 | 绝对 FPS 值，写死 | `performance.ts` `DEGRADE_THRESHOLDS` |
| 隐含基线 | 60Hz（阈值按 60Hz 体感校准） | 注释"原 25/18/12，收紧提前干预" |
| 高刷设备行为 | 120Hz 下 45fps 不降级（45 > 28） | 逻辑推导 |
| DPR 修复耦合 | 渲染像素量 ×9 → GPU 负载上升 → FPS 更易掉 | 同轮 `calcHardwareScaling` |
| 刷新率读取能力 | WebView2(Chromium) / Android System WebView(Chromium) 均支持 `screen.refreshRate` | Wails v3 运行环境 |

### 1.2 痛点

- **体感错配**：降级应基于"FPS 相对刷新率的比值"，而非绝对 FPS。120Hz 下 45fps ≈ 60Hz 下 22fps 的体感，但当前系统按 60Hz 标尺判定为"正常"。
- **沉默降级缺失**：高刷手机修完模糊后，若 FPS 掉到 40~55 区间，既看不清（已修）又卡（未降级），且无任何反馈，用户无法判断设备是否在挣扎。
- **阈值无理论依据**：28/20/14 是经验值，未声明"相对刷新率 47%/33%/23%"的语义。一旦设备刷新率偏移，整条标定线失效。

### 1.3 与 DPR 修复的耦合边界

- ADR-DPR 修复（清晰度）与本文（降级阈值）是**同一根因的两个切面**：根因都是"渲染系统假设 60Hz + 低 DPI"。
- 两者解耦实现：DPR 修复改 `render-loop.ts` / `settings-*`；本文改 `performance.ts` 阈值定义。互不侵入。

---

## 二、方案设计

### 2.1 核心原则：阈值随刷新率缩放

将现有阈值乘以缩放因子 `RSCALE = detectRefreshRate() / 60`：

- `RSCALE = 1.0` @60Hz → **行为与历史完全一致（零回归）**
- `RSCALE = 2.0` @120Hz → 阈值翻倍，正确校准高刷
- `RSCALE = 1.5` @90Hz / `2.4` @144Hz → 线性适配

### 2.2 Phase 1 实现（已落地）

`performance.ts` 阈值定义段改为：

```typescript
function detectRefreshRate(): number {
    const r = (window.screen as unknown as { refreshRate?: number }).refreshRate;
    return typeof r === 'number' && r > 0 ? r : 60; // 不支持时回落 60
}
function clampRate(v: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, v));
}
const REF_RATE = clampRate(detectRefreshRate(), 30, 240); // 钳位异常值
const RSCALE = REF_RATE / 60;

const DEGRADE_THRESHOLDS: Record<DegradeLevel, number> = {
    0: Infinity,
    1: 28 * RSCALE, // 60Hz→28；120Hz→56
    2: 20 * RSCALE, // 60Hz→20；120Hz→40
    3: 14 * RSCALE, // 60Hz→14；120Hz→28
};
const RECOVERY_THRESHOLDS: Record<DegradeLevel, number> = {
    0: Infinity,
    1: 32 * RSCALE, // 60Hz→32；120Hz→64
    2: 24 * RSCALE, // 60Hz→24；120Hz→48
    3: 18 * RSCALE, // 60Hz→18；120Hz→36
};
```

### 2.3 缩放后阈值对照

| 刷新率 | RSCALE | 降级触发 (L1/L2/L3) | 恢复 (L1/L2/L3) | 验证 |
|--------|--------|--------------------|----------------|------|
| 60Hz | 1.0 | 28 / 20 / 14 | 32 / 24 / 18 | 与现状**完全一致** |
| 90Hz | 1.5 | 42 / 30 / 21 | 48 / 36 / 27 | 45fps 触发 L1 ✓ |
| 120Hz | 2.0 | 56 / 40 / 28 | 64 / 48 / 36 | 45fps 触发 L1 ✓ |
| 144Hz | 2.4 | 67 / 48 / 34 | 77 / 58 / 43 | 50fps 触发 L1 ✓ |

### 2.4 健壮性边界（Phase 1 已处理）

| 风险 | 处理 |
|------|------|
| `screen.refreshRate` 不支持（Firefox/Safari/部分 WebView 返回 0/undefined） | 回落 **60**，行为等同现状，不回归 |
| 读取异常值（如 1000Hz） | `clampRate(30, 240)` 钳位，防阈值爆炸 |
| 运行时刷新率变化（外接显示器） | 当前 Phase 1 在模块加载时定一次；后续可在 `render-loop.ts` resize DPR 检测处一并重算 `RSCALE`（见 Phase 2 扩展点） |

---

## 三、决策对比

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **A. 刷新率相对阈值（本 ADR Phase 1）** | 阈值 × `refRate/60` | 60Hz 零回归；高刷正确校准；实现 ~15 行 | 仅依赖 `screen.refreshRate`（已验证 Chromium 可用）；不反映 GPU 实际降频 |
| B. 运行时峰值校准 | 观测启动后滚动 maxFPS 作参考 | 不依赖 API；自适应散热降频 | 需区分预热/稳态；易把首帧卡顿误当天花板；复杂度高 |
| C. 维持绝对阈值 | 不动 | 零改动 | 高刷设备体感错配，DPR 修复后问题恶化 |

**选 A 为 Phase 1**：最小代价消除最普遍的失准（高刷面板普遍如实上报 `screen.refreshRate`）。B 作为 Phase 2 独立项，与 A 不互斥（可 `reference = max(refRate, observedCeiling)`）。

---

## 四、风险与边界

| 风险 | 等级 | 缓解 |
|------|------|------|
| `screen.refreshRate` 在个别 WebView 返回 0 | 低 | 回落 60，等同原行为 |
| 阈值非整数（如 56.0）影响比较 | 无 | `avgFps` 本就是浮点，比较语义不变 |
| 高刷设备降级后 oscillate | 低 | 沿用现有 3s 降级 / 2s 恢复冷却 + 500ms 评估间隔，已防抖 |
| 缩放后阈值过高致永不降级 | 低 | clamp(30,240) 上限防御；240Hz→阈值 112/80/56 仍合理 |

### 边界

- 本 ADR **仅调整阈值标定**，不改降级级别对应的质量配置（`LEVEL_CONFIGS` 不变）。
- 本 ADR **不改变**冷却/滞回机制（仍由 `_degradeCooldownMs` / `_recoveryCooldownMs` 守门）。
- 本 ADR **不涉及** `quality` / `custom` 模式下的人工配置（那些模式早返，不走阈值）。

---

## 五、实施路标

### Phase 1: 刷新率相对阈值 ✅ 已完成

- [x] `detectRefreshRate()` + `clampRate()` 辅助函数
- [x] `REF_RATE` / `RSCALE` 模块级常量（加载时定一次）
- [x] `DEGRADE_THRESHOLDS` / `RECOVERY_THRESHOLDS` 改为 ×RSCALE
- [x] `npm run build` + `npm run test`（1498 全绿）验证零回归
- [x] 提交：`fix: 自动降级阈值改为刷新率相对标定（120Hz 适配，60Hz 零回归）`

### Phase 2: 运行时峰值校准 ✅ 已完成

- [x] 新增 `observedCeiling`：启动后 ~3s 稳定期滚动 maxFPS
- [x] `reference = max(detectRefreshRate() || 60, observedCeiling)`
- [x] 阈值改用 `reference/60` 缩放
- [x] 区分"预热期"与"稳态"，避免首帧卡顿污染天花板
- [x] 在 `render-loop.ts` resize DPR 检测处一并重算（覆盖外接显示器刷新率变化）
- [x] 验证：`npm run check && npm run test` 全绿

---

## 六、相关 ADR

- 高 DPI 渲染清晰化修复（同轮 `render-loop.ts` `calcHardwareScaling`）— 根因同源，本文为其衍生
- [ADR-100](adr-100-camera-control-behavior-dual-axis.md) — 性能相关收尾
- [ADR-106](adr-106-timing-audit-and-async-lifecycle.md) — 异步生命周期规范（降级快照恢复链路依赖）
