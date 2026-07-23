# ADR-145: 多模块协同预设 — 一键启用组合姿态

> **日期**: 2026-07-17
> **状态**: ✅ P1 已实施（类型定义 + applyMotionPreset + UI 卡片 + Go 侧 .mcpreset.json CRUD + 5 语言 i18n）
> **背景**: 用户需要「坐姿」「站姿」「舞蹈准备」等复合姿态，涉及多个模块协同（如 body-posture + riding-model + position-offset 同时启用并设定特定参数值）。当前需手动逐个开关、调参，缺一键应用能力。

---

## 一、问题

### 当前操作路径（示意，模块列表以注册表为准）

```
动作覆盖 → 身体姿态(body-posture: tilt/bend/twist)
         → 骑行模型(riding-model: saddleHeight/pedalAngle/preset)
         → 位置偏移(position-offset: sideShift/vertShift/depthShift)
         → 摇摆运动(sway-motion: amplitude/frequency)
         → 手对称(hand-symmetry: 镜像参数)
         → 手指姿势(finger-pose: 预设/自定义)
```

### 痛点

| 痛点 | 说明 |
|------|------|
| 操作繁琐 | 每次切换场景需手动调 5-10 个参数 |
| 无记忆 | 无法保存/恢复一组满意的姿态组合 |
| 无分享 | 无法将预设导出给其他模型或用户 |
| 模型间不通用 | 不同模型骨骼映射不同，预设需适配 |

---

## 二、方案

### 预设数据结构

类型定义位置：`motion/motion-modules/preset-types.ts`（紧邻 `MotionModuleState` 和 `MotionOverrideModule`）。

`MotionPreset` 是 DTO（数据传输对象），与 `ModelInstance.motionOverrideModules: MotionModuleState[]` 形状不同：

| 结构 | 形状 | 用途 |
|------|------|------|
| `MotionModuleState[]` | `[{ id, enabled, params }]` | 运行时 per-model 状态 |
| `MotionPreset['modules']` | `{ [moduleId]: { enabled, params } }` | 预设序列化 DTO（按 ID 快查） |

转换函数 `motionModuleStateToPresetModules(states)` / `presetModulesToMotionModuleState(modules)` 放在 `preset-types.ts` 中。

```ts
// motion/motion-modules/preset-types.ts
import type { MotionModuleState, ParamValue } from '@/core/types';

export interface MotionPreset {
    id: string;
    name: string;
    description?: string;
    /** 各模块的参数快照（DTO 格式，以 moduleId 为 key 方便快查） */
    modules: {
        [moduleId: string]: {
            enabled: boolean;
            params: Record<string, ParamValue>;
        };
    };
    /** 可选：模型骨骼映射（用于跨模型适配） */
    boneMapping?: Record<string, string>;
}

/** MotionModuleState[] → MotionPreset['modules'] */
export function modulesToPresetMap(
    states: MotionModuleState[]
): MotionPreset['modules'] { /* ... */ }

/** MotionPreset['modules'] → MotionModuleState[] */
export function presetMapToModules(
    map: MotionPreset['modules']
): MotionModuleState[] { /* ... */ }
```

### 示例：坐姿预设

```json
{
    "id": "seated",
    "name": "坐姿",
    "modules": {
        "body-posture": {
            "enabled": true,
            "params": { "tilt": -5, "bend": 15, "twist": 0 }
        },
        "riding-model": {
            "enabled": true,
            "params": { "preset": "bicycle", "saddleHeight": 0.7, "pedalAngle": 180 }
        },
        "position-offset": {
            "enabled": true,
            "params": { "vertShift": -8, "depthShift": 5 }
        }
    }
}
```

### 应用流程

```ts
// 核心函数：applyMotionPreset(modelId, preset)
// 命名加「Motion」前缀，避免与 model-preset.ts 的 applyPresetFromLib 混淆
用户选预设 → 遍历 preset.modules → 对每个模块：
  const mod = preset.modules[moduleId];
  if (!mod) continue;
  setModuleEnabled(modelId, moduleId, mod.enabled);
  for (const [key, value] of Object.entries(mod.params)) {
    setModuleParam(modelId, moduleId, key, value);
  }
  createModule(moduleId, modelId)?.enable();  // 触发烘焙（模块不存在时返回 null 跳过）
```

### 预设存储

| 位置 | 说明 |
|------|------|
| `ModelInstance.motionPresets?: MotionPreset[]` | 按模型存储（per-model），优先级：`per-model > 全局` |
| `localStorage` 或全局预设库 | 跨模型共享（可选），同名时 per-model 覆盖全局 |
| 序列化到 `scene-serialize.ts` | 随场景保存/加载，`motionPresets` 字段加在 `serializeModel` 中 |

---

## 三、UI 设计

### 入口

在 `motion-override-levels.ts` 的 `buildMotionOverrideSchema()` 中，模块列表卡片（`override:modules`）上方增加一张独立「预设」卡片（与 `override:advanced` 同级，而非放在模块列表卡片内部）：

```
┌─────────────────────────────────┐
│  预设                            │
│  ┌───────────────────────────┐  │
│  │ 坐姿          ▸ 应用/保存 │  │
│  │ 站姿          ▸          │  │
│  │ 舞蹈准备      ▸          │  │
│  │ [+ 新建预设]              │  │
│  └───────────────────────────┘  │
├─────────────────────────────────┤
│  身体姿态               ˄  ⋮   │
│  骑行模型               ˄  ⋮   │
│  ...                           │
└─────────────────────────────────┘
```

### 按钮

| 按钮 | 行为 |
|------|------|
| 应用 | 遍历 preset.modules，逐模块 setParam + enable |
| 保存 | 快照当前所有 enabled 模块的参数到 preset |
| 新建 | 清空当前预设，填入当前模块状态 |
| 删除 | 移除该预设 |

### 预设编辑

**简化方案**（P1 P2 阶段）：预设编辑只支持「保存当前全部模块状态」→「完整应用」，不支持分模块编辑。用户如需调整，先应用预设，再通过模块列表微调参数，最后重新保存。

**后续扩展**（P3+）：如需分模块编辑预设，可新增「预设编辑器」子页，左侧列出预设中包含的模块，右侧借用 `buildModuleParamLevel(moduleId)` 渲染单个模块的参数（与现有模块参数子页渲染方式一致）。

---

## 四、实施分期

| 阶段 | 内容 | 验收 |
|------|------|------|
| **P1** | 定义 `MotionPreset` 类型 + `applyMotionPreset()` 函数 | tsc 通过 |
| **P1** | 预设卡片 UI + 应用/保存/新建/删除（保存时检查 ≤10 个，超出提示「请删除旧预设」） | 交互可用 |
| **P2** | 持久化到 `ModelInstance.motionPresets` + `scene-serialize.ts` | 保存→重载后预设仍在 |
| **P2** | `applyMotionPreset` 调用前 pushUndoSnapshot()，使应用预设可撤销回退 | 应用预设后 Ctrl+Z 可恢复 |
| **P3** | 跨模型骨骼映射（`boneMapping`） | 不同模型间可复用预设 |
| **P3** | 预设导出/导入（JSON 文件） | 可分享给其他用户 |

---

## 五、风险与缓解

| 风险 | 缓解 |
|------|------|
| 预设参数与当前模块状态冲突（用户手动调参后应用预设） | 应用预设时全量覆盖，不尝试合并 |
| 模型缺失预设中的骨骼（如 riding-model 的 `左ひざ` 不存在） | `claimBones` 已自动跳过缺失骨骼；`createModule` 返回 `null` 时该模块静默跳过 |
| 预设过多导致 UI 列表过长 | 保存按钮中检查 `motionPresets.length >= 10`，超出时提示「请删除旧预设」 |
| 全局预设与 per-model 预设同名 | per-model 优先级高于全局，同名时 per-model 覆盖全局（全局作为 fallback 只读库） |