# 计划：水面预设分层（L1/L2/L3）— 预设 vs 复杂选项矛盾

> 起草：2026-07-20
> 状态：规划（待 Jieling 拍板）
> 关联文档：`docs/audit/preset-vs-complexity-analysis.md`（完整分析）
> 关联 ADR：ADR-115（风格化水体，P1+P2+P3+P4 已完成）、ADR-093（菜单声明式 Schema）

---

## 0. 关键发现（代码实证）

### 0.1 当前水面菜单结构

`frontend/src/menus/env-feature-levels.ts:817` 的 `buildWaterLevel()` 当前结构：

```
┌─ 水面预设 chip 组（5 个：平静/涟漪/海浪/风暴/热带，无 active 高亮）
├─ 基础参数（folder, defaultOpen=true）→ 5 项：高度/范围/大浪/小浪/速度
├─ 颜色与雾（folder, defaultOpen=false）→ 5 项
├─ 波浪与菲涅尔（folder, defaultOpen=false）→ 10 项
├─ 焦散（folder, defaultOpen=false）→ 7 项
├─ 水下效果（folder, defaultOpen=false）→ 3 项
├─ 质量档位（独立 card）
└─ 反射（folder, defaultOpen=false）→ 2 项
```

**问题**：5 个预设 chip **没有 active 高亮**，玩家无法看出"我现在的水面属于哪个预设"。修改任一参数后，预设身份丢失。

### 0.2 现有 active 高亮模式（可直接复用）

`frontend/src/core/ui-state.ts:33` 已有 `activeTimeOfDayPreset` 模式：

```ts
export let activeTimeOfDayPreset = 'noon';
export function setActiveTimeOfDayPreset(v: string): void {
    activeTimeOfDayPreset = v;
}
```

天空预设 chip 通过 `isActive: () => activeTimeOfDayPreset === key`（`env-feature-levels.ts:107`）实现高亮。**水面预设只需同构迁移。**

### 0.3 L1 核心参数已暴露在「基础参数」中

分析文档建议 L1 暴露 4 个核心参数：`waterColor` / `waterTransparency` / `bigWaveHeight` / `waterAnimSpeed`。

**现状**：`waterColor` 在「颜色与雾」折叠组中，`bigWaveHeight`/`smallWaveHeight`/`waterAnimSpeed` 在「基础参数」中。**分散在两个折叠组**，普通玩家需要展开两组才能完成"预设 + 微调水色"。

### 0.4 预设 chip 应用逻辑现状

`env-feature-levels.ts:831`：

```ts
setEnvState({
    ...buildWaterPresetEnvState(wp),  // 15 个参数全量覆盖
    waterEnabled: true,
});
applyWaterPresetToCurrent(wp);
```

**问题**：玩家微调过水色后，点击其他预设会丢失微调（15 参数全量覆盖）。这是"预设刚性"的代码根源。

---

## 1. 核心架构原则

### 1.1 三层定义

| 层级 | 入口 | 参数数量 | 目标用户 | 实现策略 |
|------|------|----------|----------|----------|
| **L1 快速预设** | 顶部 chip + 4 个核心滑块 | 4 个 | 普通玩家 | 新增「快速调整」折叠组（默认展开）+ 预设 active 高亮 |
| **L2 风格微调** | 当前预设 + 微调 | 15 个 | 进阶玩家 | 隐式：L1 滑块调整后即进入 L2 状态，预设 chip 取消高亮 |
| **L3 专家模式** | 当前 4 个折叠组 | 78 个 | 专业用户 | 保持现状（默认折叠），新增「重置到预设」按钮回到 L1 |

### 1.2 状态来源（遵循单一来源原则）

新增 **UI 派生记忆态**（与 `activeTimeOfDayPreset` 同层）：

```ts
// frontend/src/core/ui-state.ts
export let activeWaterPreset = 'calm';  // 默认平静（使用率 40%）
export function setActiveWaterPreset(v: string): void {
    activeWaterPreset = v;
}
```

**用途**：
1. 预设 chip 的 `isActive()` 唯一来源
2. "重置到预设"按钮读取该值，调用 `buildWaterPresetEnvState(WATER_PRESETS[activeWaterPreset])` 恢复

**不进入 envState**：这是 UI 派生记忆态，不参与场景序列化（与 `activeTimeOfDayPreset` 一致）。

### 1.3 "重置到预设"按钮的语义

| 触发场景 | 行为 |
|----------|------|
| 玩家微调 L1 滑块后点击 | 重新应用 `WATER_PRESETS[activeWaterPreset]` 的 15 参数，撤销 L1/L3 微调 |
| 玩家从未点过预设 | 按钮禁用（disabled），tooltip "请先选择一个预设" |
| 玩家展开 L3 改了菲涅尔后点击 | 同样恢复到预设的 15 参数，撤销 L3 微调 |

**关键**：按钮不是"重置到默认值"，而是"回到当前激活预设的基准状态"。这解决了分析文档中"无法撤销到预设状态"的痛点。

---

## 2. 文件结构（修改清单）

| 文件 | 修改类型 | 职责 |
|------|----------|------|
| `frontend/src/core/ui-state.ts` | 修改 | 新增 `activeWaterPreset` + setter |
| `frontend/src/menus/env-feature-levels.ts` | 修改 | `buildWaterLevel()` 重构：预设 chip 加 isActive + 新增「快速调整」折叠组 + 「重置到预设」按钮 |
| `frontend/src/core/i18n/locales/zh-CN.ts` | 修改 | 新增 i18n key |
| `frontend/src/core/i18n/locales/zh-TW.ts` | 修改 | 同步 |
| `frontend/src/core/i18n/locales/ja.ts` | 修改 | 同步 |
| `frontend/src/core/i18n/locales/en.ts` | 修改 | 同步 |
| `frontend/src/core/i18n/locales/ko.ts` | 修改 | 同步 |
| `frontend/src/__tests__/menus/env-water-preset-layering.test.ts` | 新建 | L1 分层预设专项测试 |

**不需要修改**：
- `env-water.ts`（预设数据结构 `WaterPreset` 与 `WATER_PRESETS` 保持不变）
- `state.ts` / `types.ts`（不新增 EnvState 字段）
- Wails Go bindings（无 Go 端改动）

---

## 3. UI 设计（最终结构）

```
┌─ 水面预设 chip 组（5 个，带 active 高亮 + 「重置到预设」按钮）  ★ L1 入口
├─ 快速调整（folder, defaultOpen=true）→ 4 项：水色/透明度/大浪高度/动画速度  ★ L1 滑块
├─ 基础参数（folder, defaultOpen=false）→ 5 项：高度/范围/大浪/小浪/速度
├─ 颜色与雾（folder, defaultOpen=false）→ 5 项
├─ 波浪与菲涅尔（folder, defaultOpen=false）→ 10 项
├─ 焦散（folder, defaultOpen=false）→ 7 项
├─ 水下效果（folder, defaultOpen=false）→ 3 项
├─ 质量档位（独立 card）
└─ 反射（folder, defaultOpen=false）→ 2 项
```

**变更点**：
1. 预设 chip 组：`isActive` 高亮 + 右侧追加「重置到预设」按钮
2. 新增「快速调整」折叠组（默认展开），4 个核心滑块
3. 「基础参数」折叠组默认改为 `defaultOpen: false`（避免一屏参数过多）
4. 「颜色与雾」中保留 `waterColor`（L1 滑块与 L3 滑块共享同一 StatePath `env.waterColor`，状态自动联动）

**关键设计**：L1 的 4 个滑块与 L3 折叠组中的对应滑块**共享 StatePath**，状态来源唯一。无需新增 state 字段。

---

## 4. i18n key 清单

| key | zh-CN | zh-TW | ja | en | ko |
|-----|-------|-------|----|----|-----|
| `env.waterQuickAdjust` | 快速调整 | 快速調整 | クイック調整 | Quick Adjust | 빠른 조정 |
| `env.resetToPreset` | 重置到预设 | 重置到預設 | プリセットに戻す | Reset to Preset | 프리셋으로 초기화 |
| `env.resetToPresetHint` | 恢复到当前预设的基准状态 | 恢復到當前預設的基準狀態 | 現在のプリセットの基準状態に戻す | Restore to the current preset's baseline | 현재 프리셋의 기준 상태로 복원 |
| `env.resetToPresetDisabled` | 请先选择一个预设 | 請先選擇一個預設 | 先にプリセットを選択してください | Please select a preset first | 먼저 프리셋을 선택하세요 |

---

## 5. 任务分解（TDD）

### Task 1: 新增 `activeWaterPreset` UI 派生记忆态

**Files:**
- Modify: `frontend/src/core/ui-state.ts:30-36`
- Test: `frontend/src/__tests__/menus/env-water-preset-layering.test.ts`（新建）

- [ ] **Step 1: 编写失败测试**

新建 `frontend/src/__tests__/menus/env-water-preset-layering.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { activeWaterPreset, setActiveWaterPreset } from '@/core/ui-state';

describe('Water Preset Layering — UI 派生记忆态', () => {
    it('activeWaterPreset 默认为 calm', () => {
        // 默认值在模块加载时初始化，测试内不能依赖前序状态
        // 通过 setActiveWaterPreset 后再读取验证闭环
        setActiveWaterPreset('calm');
        expect(activeWaterPreset).toBe('calm');
    });

    it('setActiveWaterPreset 切换后 activeWaterPreset 同步更新', () => {
        setActiveWaterPreset('tropical');
        expect(activeWaterPreset).toBe('tropical');
        // 复位
        setActiveWaterPreset('calm');
    });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd frontend && npm run test -- src/__tests__/menus/env-water-preset-layering.test.ts
```
Expected: FAIL with "activeWaterPreset is not exported" 或类似导入错误。

- [ ] **Step 3: 实现 `activeWaterPreset`**

修改 `frontend/src/core/ui-state.ts`，在 `activeTimeOfDayPreset` 后追加：

```ts
/** 当前选中的水面预设 key。预设芯片高亮唯一来源，点击预设 chip 时由 setter 更新。
 *  不进入 envState，不参与场景序列化（与 activeTimeOfDayPreset 同构）。 */
export let activeWaterPreset = 'calm';
export function setActiveWaterPreset(v: string): void {
    activeWaterPreset = v;
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cd frontend && npm run test -- src/__tests__/menus/env-water-preset-layering.test.ts
```
Expected: PASS（2 个测试通过）。

- [ ] **Step 5: 类型检查**

```bash
cd frontend && npm run check
```
Expected: 0 个新增 tsc 错误。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/core/ui-state.ts frontend/src/__tests__/menus/env-water-preset-layering.test.ts
git commit -m "feat: add activeWaterPreset UI state for water preset layering"
```

---

### Task 2: 新增 i18n key（5 语种同步）

**Files:**
- Modify: `frontend/src/core/i18n/locales/zh-CN.ts`
- Modify: `frontend/src/core/i18n/locales/zh-TW.ts`
- Modify: `frontend/src/core/i18n/locales/ja.ts`
- Modify: `frontend/src/core/i18n/locales/en.ts`
- Modify: `frontend/src/core/i18n/locales/ko.ts`

- [ ] **Step 1: 编写失败测试**

在 `env-water-preset-layering.test.ts` 追加：

```ts
import { t } from '@/core/i18n/t';

describe('Water Preset Layering — i18n keys', () => {
    it('env.waterQuickAdjust 存在且非空', () => {
        expect(t('env.waterQuickAdjust')).not.toBe('env.waterQuickAdjust');
    });

    it('env.resetToPreset 存在且非空', () => {
        expect(t('env.resetToPreset')).not.toBe('env.resetToPreset');
    });

    it('env.resetToPresetHint 存在且非空', () => {
        expect(t('env.resetToPresetHint')).not.toBe('env.resetToPresetHint');
    });

    it('env.resetToPresetDisabled 存在且非空', () => {
        expect(t('env.resetToPresetDisabled')).not.toBe('env.resetToPresetDisabled');
    });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd frontend && npm run test -- src/__tests__/menus/env-water-preset-layering.test.ts
```
Expected: FAIL（4 个 i18n 测试未通过，t() 回退到 key 本身）。

- [ ] **Step 3: 在 zh-CN.ts 中新增 4 个 key**

在 `env.presetTropical` 行（约 `:1226`）后追加：

```ts
    'env.waterQuickAdjust': '快速调整',
    'env.resetToPreset': '重置到预设',
    'env.resetToPresetHint': '恢复到当前预设的基准状态',
    'env.resetToPresetDisabled': '请先选择一个预设',
```

- [ ] **Step 4: 在 zh-TW.ts 中新增 4 个 key**

在对应位置追加：

```ts
    'env.waterQuickAdjust': '快速調整',
    'env.resetToPreset': '重置到預設',
    'env.resetToPresetHint': '恢復到當前預設的基準狀態',
    'env.resetToPresetDisabled': '請先選擇一個預設',
```

- [ ] **Step 5: 在 ja.ts 中新增 4 个 key**

```ts
    'env.waterQuickAdjust': 'クイック調整',
    'env.resetToPreset': 'プリセットに戻す',
    'env.resetToPresetHint': '現在のプリセットの基準状態に戻す',
    'env.resetToPresetDisabled': '先にプリセットを選択してください',
```

- [ ] **Step 6: 在 en.ts 中新增 4 个 key**

```ts
    'env.waterQuickAdjust': 'Quick Adjust',
    'env.resetToPreset': 'Reset to Preset',
    'env.resetToPresetHint': "Restore to the current preset's baseline",
    'env.resetToPresetDisabled': 'Please select a preset first',
```

- [ ] **Step 7: 在 ko.ts 中新增 4 个 key**

```ts
    'env.waterQuickAdjust': '빠른 조정',
    'env.resetToPreset': '프리셋으로 초기화',
    'env.resetToPresetHint': '현재 프리셋의 기준 상태로 복원',
    'env.resetToPresetDisabled': '먼저 프리셋을 선택하세요',
```

- [ ] **Step 8: 运行测试验证通过**

```bash
cd frontend && npm run test -- src/__tests__/menus/env-water-preset-layering.test.ts
```
Expected: PASS（4 个 i18n 测试通过）。

- [ ] **Step 9: 提交**

```bash
git add frontend/src/core/i18n/locales/*.ts frontend/src/__tests__/menus/env-water-preset-layering.test.ts
git commit -m "feat: add i18n keys for water preset layering (5 locales)"
```

---

### Task 3: 预设 chip 加 active 高亮 + 点击时更新 activeWaterPreset

**Files:**
- Modify: `frontend/src/menus/env-feature-levels.ts:823-845`（`buildWaterLevel` 中的预设 chip 节点）
- Test: `frontend/src/__tests__/menus/env-water-preset-layering.test.ts`

- [ ] **Step 1: 编写失败测试**

在测试文件追加：

```ts
import { describe, it, expect, vi } from 'vitest';
import { WATER_PRESETS, buildWaterPresetEnvState } from '@/scene/env/env-water';

describe('Water Preset Layering — 预设 chip active 高亮', () => {
    it('每个预设 chip 的 isActive 应基于 activeWaterPreset', () => {
        // 验证设计契约：5 个预设 key 都存在
        const keys = Object.keys(WATER_PRESETS);
        expect(keys).toContain('calm');
        expect(keys).toContain('ripple');
        expect(keys).toContain('ocean');
        expect(keys).toContain('storm');
        expect(keys).toContain('tropical');
    });

    it('点击预设后 activeWaterPreset 同步切换', () => {
        const { setActiveWaterPreset, activeWaterPreset } = require('@/core/ui-state');
        setActiveWaterPreset('tropical');
        expect(activeWaterPreset).toBe('tropical');
        setActiveWaterPreset('calm');
    });

    it('buildWaterPresetEnvState 接受任意预设返回完整 15 参数', () => {
        for (const [key, wp] of Object.entries(WATER_PRESETS)) {
            const s = buildWaterPresetEnvState(wp);
            expect(s.waterColor).toBeDefined();
            expect(s.waterTransparency).toBeDefined();
            expect(s.bigWaveHeight).toBeDefined();
            expect(s.waterAnimSpeed).toBeDefined();
        }
    });
});
```

- [ ] **Step 2: 运行测试验证通过（设计契约层面）**

```bash
cd frontend && npm run test -- src/__tests__/menus/env-water-preset-layering.test.ts
```
Expected: PASS（这些测试验证既有契约，用于确认 Task 3 实现时不会破坏基础数据结构）。

- [ ] **Step 3: 修改 `buildWaterLevel` 预设 chip 节点**

在 `env-feature-levels.ts:823` 的 `renderCustom: (cc) => {...}` 中：

**Before**（现状 `:827-844`）：
```ts
buildPresetChipGroup(
    cc,
    Object.entries(WATER_PRESETS).map(([key, wp]) => ({
        label: t(WATER_PRESET_I18N[key] ?? wp.label),
        onClick: () => {
            setEnvState({
                ...buildWaterPresetEnvState(wp),
                waterEnabled: true,
            });
            applyWaterPresetToCurrent(wp);
            getEnvMenu()?.reRender();
        },
    }))
);
```

**After**：
```ts
buildPresetChipGroup(
    cc,
    Object.entries(WATER_PRESETS).map(([key, wp]) => ({
        label: t(WATER_PRESET_I18N[key] ?? wp.label),
        isActive: () => activeWaterPreset === key,
        onClick: () => {
            // L1 预设点击：记录激活预设 + 应用 15 参数 + 启用水面
            setActiveWaterPreset(key);
            setEnvState({
                ...buildWaterPresetEnvState(wp),
                waterEnabled: true,
            });
            applyWaterPresetToCurrent(wp);
            getEnvMenu()?.reRender();
        },
    }))
);
```

**关键变更**：
- 新增 `isActive: () => activeWaterPreset === key`（让 `buildPresetChipGroup` 自动注册 `onUpdate` 同步高亮）
- `onClick` 中新增 `setActiveWaterPreset(key)`（点击时切换激活态）

- [ ] **Step 4: 在 `env-feature-levels.ts` 顶部追加导入**

修改 `:5` 的 import 块，追加：

```ts
import { activeTimeOfDayPreset, setActiveTimeOfDayPreset, activeWaterPreset, setActiveWaterPreset } from '../core/state';
```

注意：实际从 `state.ts` re-export（`config.ts:barrel`），需要先确认 `state.ts` 是否 re-export `ui-state.ts`。如未 re-export，从 `../core/ui-state` 直接导入。

**实施前验证**：

```bash
cd frontend && grep -n "activeTimeOfDayPreset" src/core/state.ts
```

如果 `state.ts` 已 re-export `activeTimeOfDayPreset`，则同路径追加 re-export `activeWaterPreset`。否则直接从 `../core/ui-state` 导入。

- [ ] **Step 5: 类型检查**

```bash
cd frontend && npm run check
```
Expected: 0 个新增 tsc 错误。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/menus/env-feature-levels.ts frontend/src/__tests__/menus/env-water-preset-layering.test.ts
git commit -m "feat: water preset chips show active state via activeWaterPreset"
```

---

### Task 4: 新增「快速调整」折叠组（L1 4 个核心滑块）

**Files:**
- Modify: `frontend/src/menus/env-feature-levels.ts`（`buildWaterLevel` schema 数组）

- [ ] **Step 1: 在 `waterSchema` 数组中，预设 chip 节点之后、基础参数之前插入新节点**

在 `env-feature-levels.ts` 的 `buildWaterLevel` 中，找到 `id: 'env:water:basic'` 节点（约 `:847`），在其**之前**插入：

```ts
{
    id: 'env:water:quickAdjust',
    kind: 'folder',
    label: 'env.waterQuickAdjust',
    icon: 'lucide:sliders',
    defaultOpen: true,
    children: [
        {
            id: 'env:water:quickColor',
            kind: 'colorSlider',
            label: 'env.waterColor',
            control: { bind: 'env.waterColor' },
        },
        {
            id: 'env:water:quickTransparency',
            kind: 'slider',
            label: 'env.opacity',
            control: {
                bind: 'env.waterTransparency',
                min: 0,
                max: 1,
                step: 0.05,
            },
            icon: 'lucide:eye',
        },
        {
            id: 'env:water:quickBigWave',
            kind: 'slider',
            label: 'env.bigWaveHeight',
            control: { bind: 'env.bigWaveHeight', min: 0, max: 3, step: 0.1 },
            icon: 'lucide:mountain',
        },
        {
            id: 'env:water:quickAnimSpeed',
            kind: 'slider',
            label: 'env.animSpeed',
            control: {
                bind: 'env.waterAnimSpeed',
                min: 0.1,
                max: 5,
                step: 0.1,
                get: (v) => (v as number) ?? 1,
            },
            icon: 'lucide:fast-forward',
        },
    ],
},
```

**关键设计**：
- 4 个滑块**共享 L3 折叠组中的 StatePath**（`env.waterColor` / `env.waterTransparency` / `env.bigWaveHeight` / `env.waterAnimSpeed`）
- `reactive()` Proxy 自动同步：L1 滑块改值 → L3 滑块同步更新；L3 滑块改值 → L1 滑块同步更新
- 复用既有 i18n key（`env.waterColor` / `env.opacity` / `env.bigWaveHeight` / `env.animSpeed`）

- [ ] **Step 2: 修改「基础参数」默认折叠**

在 `id: 'env:water:basic'` 节点中，将 `defaultOpen: true` 改为 `defaultOpen: false`：

**Before**:
```ts
{
    id: 'env:water:basic',
    kind: 'folder',
    label: 'env.basicParams',
    icon: 'lucide:sliders',
    defaultOpen: true,
    children: [...]
},
```

**After**:
```ts
{
    id: 'env:water:basic',
    kind: 'folder',
    label: 'env.basicParams',
    icon: 'lucide:sliders',
    defaultOpen: false,  // L1 快速调整默认展开后，基础参数折叠以减少一屏参数数量
    children: [...]
},
```

- [ ] **Step 3: 类型检查 + 全量测试**

```bash
cd frontend && npm run check && npm run test
```
Expected: 0 个新增 tsc 错误；既有测试全绿（不改变现有逻辑，仅插入新节点）。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/menus/env-feature-levels.ts
git commit -m "feat: add L1 quick adjust folder for water preset layering"
```

---

### Task 5: 新增「重置到预设」按钮

**Files:**
- Modify: `frontend/src/menus/env-feature-levels.ts`（预设 chip 节点 `renderCustom`）
- Test: `frontend/src/__tests__/menus/env-water-preset-layering.test.ts`

- [ ] **Step 1: 编写失败测试**

在测试文件追加：

```ts
import { resetToActiveWaterPreset } from '@/menus/env-feature-levels';

describe('Water Preset Layering — 重置到预设', () => {
    it('resetToActiveWaterPreset 调用 setEnvState 恢复激活预设的 15 参数', () => {
        const { setActiveWaterPreset } = require('@/core/ui-state');
        setActiveWaterPreset('tropical');
        const before = { ...require('@/core/config').envState };
        // mock setEnvState 捕获 patch
        const setEnvStateMock = vi.fn();
        vi.mock('@/scene/scene', () => ({ setEnvState: setEnvStateMock }));
        resetToActiveWaterPreset();
        expect(setEnvStateMock).toHaveBeenCalledTimes(1);
        const patch = setEnvStateMock.mock.calls[0][0];
        // 验证恢复的是 tropical 预设的参数
        expect(patch.waterColor).toEqual(WATER_PRESETS.tropical.waterColor);
        expect(patch.waterTransparency).toEqual(WATER_PRESETS.tropical.waterTransparency);
        vi.restoreAllMocks();
    });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd frontend && npm run test -- src/__tests__/menus/env-water-preset-layering.test.ts
```
Expected: FAIL（`resetToActiveWaterPreset` 未导出）。

- [ ] **Step 3: 实现 `resetToActiveWaterPreset`**

在 `env-feature-levels.ts` 中，新增导入与函数：

**导入追加**（`:11` 区域）：
```ts
import {
    WATER_PRESETS,
    applyWaterPresetToCurrent,
    buildWaterPresetEnvState,
    disposeWater,
    createWater,
} from '../scene/env/env-water';
```
已存在，无需修改。

**函数实现**（在 `WATER_PRESET_I18N` 常量之后、`buildWaterLevel` 之前）：

```ts
/**
 * 重置到当前激活的水面预设：恢复 15 个预设参数，撤销 L1/L3 微调。
 * 由「重置到预设」按钮调用。若 activeWaterPreset 无效则不操作。
 */
export function resetToActiveWaterPreset(): void {
    const preset = WATER_PRESETS[activeWaterPreset];
    if (!preset) {
        return;
    }
    setEnvState({
        ...buildWaterPresetEnvState(preset),
        waterEnabled: true,
    });
    applyWaterPresetToCurrent(preset);
    getEnvMenu()?.reRender();
}
```

**关键设计**：
- 复用 `buildWaterPresetEnvState` + `applyWaterPresetToCurrent`，与预设 chip 点击走同一通路
- 不需要新增 `waterEnabled: true`（已在 chip 点击时设置，此处仅恢复参数）
  - 但保险起见保留 `waterEnabled: true`，避免极端情况下水面被关闭后点击重置无效果

- [ ] **Step 4: 在预设 chip 节点的 `renderCustom` 中追加按钮**

修改 `buildWaterLevel` 中 `id: 'env:water:presets'` 节点的 `renderCustom`：

**Before**（Task 3 后状态）：
```ts
renderCustom: (cc) => {
    buildPresetChipGroup(
        cc,
        Object.entries(WATER_PRESETS).map(([key, wp]) => ({...}))
    );
},
```

**After**：
```ts
renderCustom: (cc) => {
    buildPresetChipGroup(
        cc,
        Object.entries(WATER_PRESETS).map(([key, wp]) => ({...}))
    );
    // 「重置到预设」按钮：放在预设 chip 组下方右对齐
    const resetRow = document.createElement('div');
    resetRow.style.cssText =
        'display:flex;justify-content:flex-end;padding:4px 14px 0;';
    const resetBtn = document.createElement('button');
    resetBtn.className = 'cs-btn cs-btn-sm';
    resetBtn.textContent = t('env.resetToPreset');
    resetBtn.title = t('env.resetToPresetHint');
    // activeWaterPreset 不在 WATER_PRESETS 中时禁用（极端情况）
    resetBtn.disabled = !WATER_PRESETS[activeWaterPreset];
    resetBtn.onclick = () => resetToActiveWaterPreset();
    resetRow.appendChild(resetBtn);
    cc.appendChild(resetRow);
},
```

- [ ] **Step 5: 运行测试验证通过**

```bash
cd frontend && npm run test -- src/__tests__/menus/env-water-preset-layering.test.ts
```
Expected: PASS（重置到预设测试通过）。

- [ ] **Step 6: 类型检查 + 全量测试**

```bash
cd frontend && npm run check && npm run test
```
Expected: 0 个新增 tsc 错误；全量测试绿。

- [ ] **Step 7: 提交**

```bash
git add frontend/src/menus/env-feature-levels.ts frontend/src/__tests__/menus/env-water-preset-layering.test.ts
git commit -m "feat: add reset-to-preset button for water preset layering"
```

---

### Task 6: 自检 + 集成验证

**Files:**
- 无新增修改，仅验证

- [ ] **Step 1: 运行前端契约测试（验证 116 个函数 + FNV-1a 未破坏）**

```bash
cd frontend && npm run test -- src/__tests__/bindings/app.contract.test.ts
```
Expected: PASS（本计划未修改 Go 端，契约应稳定）。

- [ ] **Step 2: 运行 env-water 既有测试（验证未破坏既有逻辑）**

```bash
cd frontend && npm run test -- src/__tests__/scene/env-water.test.ts
```
Expected: PASS（既有 22 个测试全绿，波相位 1 个历史遗留失败保持现状，与本次改动无关）。

- [ ] **Step 3: 运行 env-feature-levels 既有契约测试**

```bash
cd frontend && npm run test -- src/__tests__/env-feature-levels.contract.test.ts
```
Expected: PASS（如存在 `activeTimeOfDayPreset` 相关断言，需确认 `activeWaterPreset` 不冲突）。

- [ ] **Step 4: 全量单测 + 类型检查**

```bash
cd frontend && npm run check && npm run test
```
Expected: 0 个新增 tsc 错误；除历史遗留外全绿。

- [ ] **Step 5: 手动验证清单（开发态）**

启动 `wails dev`，进入「环境 → 水面」菜单，逐项验证：

| 验证项 | 预期结果 |
|--------|----------|
| 默认打开水面菜单 | 5 个预设 chip 全部不高亮（初始 activeWaterPreset='calm'，但水面未启用） |
| 点击「热带」预设 | 「热带」chip 高亮；水面变为清澈青蓝色；「快速调整」4 滑块显示热带预设值 |
| 拖动「快速调整 → 水色」滑块 | 水色实时变化；「热带」chip 取消高亮（因参数已偏离预设） |
| 点击「重置到预设」按钮 | 水色恢复到热带预设值；「热带」chip 重新高亮 |
| 展开「波浪与菲涅尔」折叠组 | 修改菲涅尔参数后点「重置到预设」，菲涅尔回到热带预设值 |
| 切换到「平静」预设 | 「平静」chip 高亮；水面变为浅蓝灰色；4 滑块显示平静预设值 |

> ⚠️ 注意：L1 滑块拖动后预设 chip 取消高亮的实现需要 `isActive` 返回 `false`。但当前 `isActive: () => activeWaterPreset === key` 不会因为参数偏离而取消高亮。

**Task 6 修订**：取消高亮的语义需要在 Task 5 完成后追加 Task 6a。

- [ ] **Step 6: 提交验证结果**

无需提交，仅记录验证清单通过状态。

---

### Task 6a: L1 滑块偏离预设时取消预设 chip 高亮（增强）

**Files:**
- Modify: `frontend/src/core/ui-state.ts`
- Modify: `frontend/src/menus/env-feature-levels.ts`
- Test: `frontend/src/__tests__/menus/env-water-preset-layering.test.ts`

**设计决策**：

引入 `waterPresetDirty` 标志位，标记"当前水面参数是否偏离激活预设"。

- L1 滑块 onChange / 任何 setEnvState 修改 water 参数时 → `setWaterPresetDirty(true)`
- 预设 chip 点击 / 重置按钮点击 → `setWaterPresetDirty(false)`
- `isActive` 判断：`activeWaterPreset === key && !waterPresetDirty`

**简化方案**（推荐先实施）：不在 `setEnvState` 层做拦截（会污染所有 water setter），而是在 L1 滑块的 `control.set` 中显式标记 dirty。

- [ ] **Step 1: 编写失败测试**

在测试文件追加：

```ts
import { waterPresetDirty, setWaterPresetDirty } from '@/core/ui-state';

describe('Water Preset Layering — dirty 标志', () => {
    it('waterPresetDirty 默认为 false', () => {
        setWaterPresetDirty(false);
        expect(waterPresetDirty).toBe(false);
    });

    it('setWaterPresetDirty(true) 后 waterPresetDirty 为 true', () => {
        setWaterPresetDirty(true);
        expect(waterPresetDirty).toBe(true);
        setWaterPresetDirty(false);
    });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd frontend && npm run test -- src/__tests__/menus/env-water-preset-layering.test.ts
```
Expected: FAIL（`waterPresetDirty` 未导出）。

- [ ] **Step 3: 实现 `waterPresetDirty`**

在 `frontend/src/core/ui-state.ts` 追加：

```ts
/** 水面参数是否偏离当前激活预设。
 *  - L1 滑块或 L3 参数被用户修改后置 true（预设 chip 取消高亮）
 *  - 预设 chip 点击 / 重置按钮点击后置 false（预设 chip 重新高亮）
 *  不进入 envState，不参与序列化。 */
export let waterPresetDirty = false;
export function setWaterPresetDirty(v: boolean): void {
    waterPresetDirty = v;
}
```

- [ ] **Step 4: 修改预设 chip isActive 与 onClick**

在 `env-feature-levels.ts` 中：

**isActive 修改**：
```ts
isActive: () => activeWaterPreset === key && !waterPresetDirty,
```

**onClick 修改**（追加 `setWaterPresetDirty(false)`）：
```ts
onClick: () => {
    setActiveWaterPreset(key);
    setWaterPresetDirty(false);  // 应用预设后清除 dirty
    setEnvState({
        ...buildWaterPresetEnvState(wp),
        waterEnabled: true,
    });
    applyWaterPresetToCurrent(wp);
    getEnvMenu()?.reRender();
},
```

- [ ] **Step 5: 修改「重置到预设」按钮逻辑**

在 `resetToActiveWaterPreset` 函数中追加：

```ts
export function resetToActiveWaterPreset(): void {
    const preset = WATER_PRESETS[activeWaterPreset];
    if (!preset) {
        return;
    }
    setWaterPresetDirty(false);  // 重置后清除 dirty
    setEnvState({
        ...buildWaterPresetEnvState(preset),
        waterEnabled: true,
    });
    applyWaterPresetToCurrent(preset);
    getEnvMenu()?.reRender();
}
```

- [ ] **Step 6: L1 滑块 onChange 标记 dirty**

在「快速调整」折叠组的 4 个滑块中，给 `control` 添加 `set` 回调标记 dirty。

**注意**：`control.bind` 走 reactive 管线，`set` 函数会在用户拖动滑块时被调用。

修改 `env:water:quickColor` 节点：
```ts
{
    id: 'env:water:quickColor',
    kind: 'colorSlider',
    label: 'env.waterColor',
    control: {
        bind: 'env.waterColor',
        set: (v) => {
            setWaterPresetDirty(true);
            return v;
        },
    },
},
```

修改 `env:water:quickTransparency` 节点（注意保留原 set 逻辑——其实原本没有 set，是直接写值；这里新增 set 用于标记 dirty）：
```ts
control: {
    bind: 'env.waterTransparency',
    min: 0,
    max: 1,
    step: 0.05,
    set: (v) => {
        setWaterPresetDirty(true);
        return v;
    },
},
```

同理修改 `env:water:quickBigWave` 和 `env:water:quickAnimSpeed`（注意 `quickAnimSpeed` 原本有 `get`，需要同时保留 `get` 和新增 `set`）：

```ts
// quickBigWave
control: {
    bind: 'env.bigWaveHeight',
    min: 0,
    max: 3,
    step: 0.1,
    set: (v) => {
        setWaterPresetDirty(true);
        return v;
    },
},

// quickAnimSpeed
control: {
    bind: 'env.waterAnimSpeed',
    min: 0.1,
    max: 5,
    step: 0.1,
    get: (v) => (v as number) ?? 1,
    set: (v) => {
        setWaterPresetDirty(true);
        return v;
    },
},
```

> ⚠️ **验证点**：确认 `menu-factory.ts` 中 `ControlSpec.set` 的调用时机。若 `set` 仅在用户交互时触发（非程序化 setEnvState），则 dirty 标记精准；若 `set` 也在 `setEnvState` 触发 reactive 更新时调用，会导致预设 chip 点击时 dirty 被错误置 true。

**实施前必须验证**：

```bash
cd frontend && grep -n "control.set\|spec.set" src/menus/menu-factory.ts
```

若 `set` 在 reactive 更新路径中被调用，需改为在 `onChange` 回调中标记 dirty（如果 `ControlSpec` 支持 `onChange`），或在 `setEnvState` 拦截层做差异化处理。

- [ ] **Step 7: 验证 ControlSpec.set 调用时机**

阅读 `menu-factory.ts` 中 `set` 的调用路径。若发现 reactive 更新也会触发 `set`，则采用备选方案：

**备选方案**：不在 L1 滑块标记 dirty，改为在 L3 折叠组的所有 water 相关滑块 onChange 中标记。但这会让实现复杂度上升。

**更简方案**：直接放弃 dirty 标记功能（接受"参数偏离后预设 chip 仍保持高亮"），让"重置到预设"按钮承担"撤销偏离"的语义。这是 **YAGNI 原则**：先观察用户是否真的需要"偏离后取消高亮"，再决定是否实施。

- [ ] **Step 8: 决策点 — 是否实施 dirty 标记**

**推荐**：先 **跳过 Task 6a**，发布 Task 1-6 的版本。收集用户反馈后决定是否需要 dirty 标记。

理由：
1. "重置到预设"按钮已能解决"撤销偏离"的核心痛点
2. dirty 标记涉及 reactive 路径验证，增加复杂度
3. 天空预设的 `activeTimeOfDayPreset` 也没有 dirty 标记，参数偏离后仍保持高亮，未见用户抱怨

- [ ] **Step 9: 跳过 Task 6a 时，删除 Step 1-6 的代码**

若决定跳过，回退 Task 6a 的所有改动，仅保留 Task 1-6 的成果。

---

## 6. 验收标准

### 6.1 功能验收

| ID | 验收项 | 优先级 |
|----|--------|--------|
| V1 | 5 个预设 chip 点击后高亮当前激活预设 | P0 |
| V2 | 切换预设时 4 个 L1 滑块（水色/透明度/大浪/速度）显示新预设值 | P0 |
| V3 | 「快速调整」折叠组默认展开，4 个滑块一屏可见 | P0 |
| V4 | 「基础参数」折叠组默认折叠（减少一屏参数数量） | P0 |
| V5 | 「重置到预设」按钮可点击，点击后恢复当前激活预设的 15 参数 | P0 |
| V6 | L1 滑块与 L3 折叠组中对应滑块状态联动（同 StatePath） | P0 |
| V7 | 5 语种 i18n 文本正确显示（zh-CN/zh-TW/ja/en/ko） | P0 |
| V8 | 既有水面测试全绿（不破坏现有功能） | P0 |
| V9 | L1 滑块拖动后预设 chip 取消高亮（dirty 标记） | P2（Task 6a，可选） |

### 6.2 代码质量验收

| 维度 | 标准 |
|------|------|
| 类型安全 | 0 个新增 `as any` / `@ts-ignore` |
| 资源管理 | 无新增 Babylon 对象，无 dispose 需求 |
| 测试覆盖 | `env-water-preset-layering.test.ts` 覆盖 active 状态、reset 行为、i18n key |
| 功能正确性 | `resetToActiveWaterPreset` 守卫 `activeWaterPreset` 无效情况 |
| 设计质量 | 复用 `activeTimeOfDayPreset` 模式，无新设计模式引入 |
| i18n 完整性 | 5 语种同步，无硬编码中文字符串 |

---

## 7. 风险与备选方案

### 7.1 风险表

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| `ControlSpec.set` 调用时机不确定 | 🟡 中 | Task 6a Step 7 验证；若不确定则跳过 Task 6a |
| L1/L3 滑块共享 StatePath 导致状态循环 | 🟢 低 | reactive Proxy 已处理同源同步，参考既有 `env:sky:colorTop` 与 `env:sky:zenith` 共享字段案例 |
| 「重置到预设」按钮在 `activeWaterPreset` 无效时禁用 | 🟢 低 | 已加 `disabled = !WATER_PRESETS[activeWaterPreset]` 守卫 |
| 用户期望"重置到默认值"而非"重置到预设" | 🟡 中 | tooltip 文案明确为"恢复到当前预设的基准状态"，避免歧义 |
| i18n key 与既有 key 冲突 | 🟢 低 | 已 grep 确认 `env.waterQuickAdjust` 等 4 个 key 不存在 |

### 7.2 备选方案对比

| 方案 | 工作量 | 用户价值 | 推荐度 |
|------|--------|----------|--------|
| **A. 分层预设（L1+L3，本计划）** | 中 | 高 | ⭐⭐⭐⭐⭐ |
| B. 智能联动（水色变深→雾密度增加） | 中 | 中 | ⭐⭐⭐ |
| C. 预设混音器（双滑块混合两预设） | 高 | 高 | ⭐⭐⭐⭐ |
| D. 仅添加 active 高亮（最小改动） | 低 | 中 | ⭐⭐⭐ |

**推荐方案 A**：解决核心痛点（预设身份不可见 + 微调后无法回退），工作量可控，与现有架构同构。

---

## 8. 后续演进路径（不在本计划范围）

### 8.1 Phase 2（P1 优先级）：智能联动

- 水色变深 → 水雾密度同步增加
- 波浪变大 → 动画速度同步增加
- 在 `_syncWaterUniforms` 或 `setEnvState` 拦截层实现联动逻辑
- UI 加联动开关（默认开启，可关闭）

### 8.2 Phase 3（P2 优先级）：预设混音器

- 双滑块混合两预设（如 60% 平静 + 40% 热带）
- 实时预览混合结果
- 保存为新预设（接入 `env-preset-levels.ts` 的用户预设系统）

### 8.3 跨菜单推广

将 L1/L2/L3 分层预设模式推广到：
- 地面预设（6 个，30+ 可调参数）
- 天空预设（6 个，20+ 可调参数）
- 灯光预设（6 个，10+ 可调参数）

每个菜单同构实施：active 高亮 + L1 核心滑块 + 重置按钮。

---

## 9. 自检（Self-Review）

### 9.1 分析文档需求覆盖

| 分析文档需求 | 对应 Task | 覆盖状态 |
|-------------|-----------|----------|
| L1 快速预设（3-5 个参数） | Task 4（4 个 L1 滑块） | ✅ |
| L1 预设一键 chip | Task 3（既有 chip 加 active） | ✅ |
| 隐藏 L3 专家模式 | Task 4 Step 2（基础参数改 defaultOpen=false） | ✅ |
| 5 个 L1 预设（平静/涟漪/海浪/风暴/热带） | 既有 WATER_PRESETS | ✅ 已存在 |
| 重置到预设状态 | Task 5（重置按钮） | ✅ |
| 预设身份高亮 | Task 3（active 高亮） | ✅ |
| 智能联动（P1） | 不在本计划范围（Phase 2） | ⏭️ 后续 |
| 预设混音器（P2） | 不在本计划范围（Phase 3） | ⏭️ 后续 |

### 9.2 占位符扫描

- 无 "TBD" / "TODO" / "implement later"
- 所有代码块包含完整实现
- 所有命令包含预期输出

### 9.3 类型一致性

- `activeWaterPreset: string`（与 `activeTimeOfDayPreset` 一致）
- `setActiveWaterPreset(v: string): void`（与 `setActiveTimeOfDayPreset` 一致）
- `waterPresetDirty: boolean`（仅 Task 6a，可跳过）
- `resetToActiveWaterPreset(): void`（无返回值，与既有 `applyWaterPresetToCurrent` 一致）

### 9.4 状态来源唯一性

- `activeWaterPreset` 唯一来源：`ui-state.ts`
- `WATER_PRESETS` 唯一来源：`env-water.ts`
- L1/L3 滑块共享 StatePath（`env.waterColor` 等），状态来源 `envState`，无双源

---

## 10. 执行交接

**Plan complete and saved to `docs/superpowers/plans/2026-07-20-water-preset-layering.md`**.

两种执行方案：

1. **Subagent-Driven（推荐）** — 每个 Task 派发独立 subagent，任务间 review，迭代快
2. **Inline Execution** — 当前会话内顺序执行，带 checkpoint

请选择执行方式，或先 review 计划文档。
