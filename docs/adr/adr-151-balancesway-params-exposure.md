# ADR-151: balanceSway 独立参数暴露 — 补齐感知层 UI 可调性

> **状态**: 规划（待实施）
> **关联**: ADR-079（感知层扩展）、ADR-116（感知层滑块功能）、ADR-150（gaze delta）
> **来源**: 2026-07-20 感知层审核 P0 修复后，balanceSway folder 无参数可调
> **日期**: 2026-07-21

---

## 一、问题陈述

### 1.1 现状

ADR-079 Phase 2 接入 balanceSway 时仅暴露 `balanceSwayEnabled` 开关，参数（周期 / 振幅）仍是硬编码常量：

| 文件 | 行号 | 硬编码 |
|------|------|--------|
| [perception-balance.ts:17](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/motion/perception-balance.ts#L17) | 17 | `BALANCE_SWAY_PERIOD = 2.0` |
| [perception-balance.ts:19-27](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/motion/perception-balance.ts#L19-L27) | 19-27 | `SWAY_AMP` 对象（6 字段） |
| [motion-gaze-levels.ts:222-230](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/menus/motion-gaze-levels.ts#L222-L230) | 222-230 | `balanceSway` folder 无 children |

### 1.2 与其他感知模块的对称性

| 模块 | 开关 | 频率/周期 | 幅度 |
|------|------|----------|------|
| 呼吸 | `breathEnabled` | `breathFrequency` | `breathAmplitude` |
| 眨眼 | `blinkEnabled` | `blinkFrequency` | `blinkAmplitude` |
| 微表情 | `microExpressionEnabled` | （内部 `MICRO_EXPR_PERIOD`） | （内部 `MICRO_EXPR_PEAK`） |
| 重心微动 | `balanceSwayEnabled` | ❌ 硬编码 | ❌ 硬编码 |

balanceSway 是唯一"只有开关、无参数"的感知模块，违反 ADR-116 §决策关键约束 5「可配置」。

---

## 二、设计方案

### 2.1 核心决策：全局参数 + 每骨骼乘数（保留硬编码比例）

**不暴露**：每骨骼独立的 6 个振幅（center_rz/rx/bobY + upper2_rx + waist_rz + allParent_rx/rz）—— 避免 UI 过载。

**暴露**：2 个全局参数控制整体表现。

```typescript
// 新增 PerceptionState 字段
balanceSwayPeriod: number;     // 全局周期（秒），0.5–5.0，默认 2.0
balanceSwayAmplitude: number;  // 全局振幅乘数，0–2.0，默认 1.0
```

**效果**：
- `balanceSwayPeriod` 调整整体速度（快/慢摆）
- `balanceSwayAmplitude` 作为 `SWAY_AMP` 各字段的乘数（保持各骨骼相对比例不变）
- `balanceSwayAmplitude = 0` → 关闭效果（与 `balanceSwayEnabled = false` 等价）
- `balanceSwayAmplitude = 2.0` → 振幅翻倍

### 2.2 改动范围（5 文件）

#### 2.2.1 perception-shared.ts — 接口扩展

```typescript
export interface PerceptionState {
    // ... 既有字段
    balanceSwayEnabled: boolean;
    // 新增：balanceSway 参数（[doc:adr-151]）
    balanceSwayPeriod: number;     // 0.5–5.0s，默认 2.0
    balanceSwayAmplitude: number;  // 0–2.0，默认 1.0
}

export const DEFAULT_PERCEPTION_STATE: PerceptionState = {
    // ... 既有默认值
    balanceSwayEnabled: true,
    balanceSwayPeriod: 2.0,
    balanceSwayAmplitude: 1.0,
};
```

#### 2.2.2 perception-balance.ts — 读取 state 参数

```typescript
export function _applyBalanceSway(
    mmdModel: MmdModelLike,
    time: number,
    enabled: boolean,
    period: number,      // 新增参数
    amplitude: number,  // 新增参数
): void {
    // 原 const phase = ((time % BALANCE_SWAY_PERIOD) / BALANCE_SWAY_PERIOD) * Math.PI * 2;
    const phase = ((time % period) / period) * Math.PI * 2;
    
    // 原 const rz = Math.sin(slowPhase) * SWAY_AMP.center_rz;
    const rz = Math.sin(slowPhase) * SWAY_AMP.center_rz * amplitude;
    // ... 6 处振幅乘 amplitude
}
```

#### 2.2.3 perception.ts — 新增 2 个 setter

```typescript
/** 设置重心微动周期（秒，钳制 0.5–5.0） */
export function setBalanceSwayPeriod(v: number): void {
    perceptionState = { ...perceptionState, balanceSwayPeriod: Math.max(0.5, Math.min(5.0, v)) };
    triggerAutoSave();
}

/** 设置重心微动幅度（0–2.0，钳制） */
export function setBalanceSwayAmplitude(v: number): void {
    perceptionState = { ...perceptionState, balanceSwayAmplitude: Math.max(0, Math.min(2, v)) };
    triggerAutoSave();
}

// observer 调用处传入参数
_applyBalanceSway(
    mmdModel,
    time,
    perceptionState.balanceSwayEnabled,
    perceptionState.balanceSwayPeriod,      // 新增
    perceptionState.balanceSwayAmplitude,   // 新增
);
```

#### 2.2.4 motion-gaze-levels.ts — balanceSway folder 加 2 个滑块

```typescript
{
    id: 'perception:balanceSway',
    kind: 'folder',
    label: 'motion.balanceSway',
    icon: 'lucide:move-3d',
    headerToggle: { bind: 'perception.balanceSwayEnabled', onChange: withActivate },
    children: [
        {
            id: 'perception:balanceSwayPeriod',
            kind: 'slider',
            label: 'motion.balanceSwayPeriod',
            bind: 'perception.balanceSwayPeriod',
            min: 0.5, max: 5.0, step: 0.1,
        },
        {
            id: 'perception:balanceSwayAmplitude',
            kind: 'slider',
            label: 'motion.balanceSwayAmplitude',
            bind: 'perception.balanceSwayAmplitude',
            min: 0, max: 2.0, step: 0.05,
        },
    ],
},
```

#### 2.2.5 i18n — 5 语种补充

```json
"motion.balanceSwayPeriod": "周期 / Period / 周期 / 주기 / 周期"
"motion.balanceSwayAmplitude": "幅度 / Amplitude / 振幅 / 진폭 / 振幅"
```

### 2.3 序列化与迁移

- **序列化**：`PerceptionState` 已整体走 [scene-serialize.ts:457](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/scene-serialize.ts#L457)，新字段自动包含，**0 改动**
- **迁移**：旧存档无 `balanceSwayPeriod/Amplitude` 字段，`setPerceptionState` 用 `?? DEFAULT` 兜底，**0 改动**
- **测试 mock**：`lipsync-bridge.test.ts` 的 `defaultPerception` mock 需加 2 字段

---

## 三、测试策略

### 3.1 新增测试（3 项）

```typescript
describe('balanceSway 参数', () => {
    it('默认周期 2.0s，默认幅度 1.0', () => {
        const s = sut.getPerceptionState();
        expect(s.balanceSwayPeriod).toBe(2.0);
        expect(s.balanceSwayAmplitude).toBe(1.0);
    });

    it('setBalanceSwayPeriod 钳制 0.5–5.0', () => {
        sut.setBalanceSwayPeriod(10);
        expect(sut.getPerceptionState().balanceSwayPeriod).toBe(5.0);
        sut.setBalanceSwayPeriod(0.1);
        expect(sut.getPerceptionState().balanceSwayPeriod).toBe(0.5);
    });

    it('setBalanceSwayAmplitude 钳制 0–2.0', () => {
        sut.setBalanceSwayAmplitude(5);
        expect(sut.getPerceptionState().balanceSwayAmplitude).toBe(2.0);
        sut.setBalanceSwayAmplitude(-1);
        expect(sut.getPerceptionState().balanceSwayAmplitude).toBe(0);
    });
});
```

### 3.2 现有测试

- `lipsync-bridge.test.ts` 的 `defaultPerception` mock 需加 2 字段
- 其他测试无影响

---

## 四、风险评估

| 风险 | 级别 | 缓解措施 |
|------|------|---------|
| `amplitude=0` 时仍执行计算（浪费） | 🟢 低 | 可在 `_applyBalanceSway` 内 early return |
| 旧存档无新字段 | 🟢 低 | `?? DEFAULT` 兜底（现有模式） |
| UI 滑块范围语义 | 🟢 低 | 周期 0.5–5s（语义清晰），幅度 0–2（0=关闭，1=默认，2=翻倍） |

---

## 五、验收标准

| 标准 | 验证方法 |
|------|---------|
| balanceSway folder 展开 2 个滑块 | UI 检查 |
| 周期滑块从 2.0 调到 1.0，摆动速度翻倍 | 实测 |
| 幅度滑块从 1.0 调到 0，摆动停止 | 实测 |
| 幅度调到 2.0，摆幅明显增大 | 实测 |
| 旧存档加载后使用默认值 | 加载旧场景，验证无 NaN |
| 3 项新测试通过 | `npm run test -- perception.test.ts` |

---

## 六、实施计划

| 阶段 | 内容 |
|------|------|
| **Phase 1** | perception-shared.ts 加 2 字段 + 默认值 |
| **Phase 2** | perception-balance.ts 读参数替代硬编码 |
| **Phase 3** | perception.ts 加 2 setter + observer 传参 |
| **Phase 4** | motion-gaze-levels.ts 加 2 滑块 + i18n 5 语种 |
| **Phase 5** | 测试 + 验证 |

---

## 七、开放问题

1. **是否暴露每骨骼独立振幅？** 当前方案不暴露（避免 UI 过载）。若用户反馈需要精细控制，可后续在「高级」折叠组中加 6 个滑块。
2. **`amplitude=0` 时是否关闭 `balanceSwayEnabled`？** 不自动关闭，保持开关与参数正交。
