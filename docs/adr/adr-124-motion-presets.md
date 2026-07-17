# ADR-124: 多模块协同预设 — 一键启用组合姿态

**日期**: 2026-07-17
> **状态**: 规划中
> **背景**: 用户需要「坐姿」「站姿」「舞蹈准备」等复合姿态，涉及多个模块协同（如 body-posture + riding-model + position-offset 同时启用并设定特定参数值）。当前需手动逐个开关、调参，缺一键应用能力。

---

## 一、问题

### 当前操作路径

```
动作覆盖 → 身体姿态(开关+调 tilt/bend/twist)
         → 骑行模型(开关+调 saddleHeight/pedalAngle)
         → 位置偏移(开关+调 sideShift/vertShift/depthShift)
         → 摇摆运动(开关+调 amplitude/frequency)
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

```ts
interface MotionPreset {
    id: string;
    name: string;
    description?: string;
    /** 各模块的参数快照 */
    modules: {
        [moduleId: string]: {
            enabled: boolean;
            params: Record<string, ParamValue>;
        };
    };
    /** 可选：模型骨骼映射（用于跨模型适配） */
    boneMapping?: Record<string, string>;
}
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

```
用户选预设 → 遍历 preset.modules → 对每个模块：
  setModuleEnabled(modelId, moduleId, preset.modules[moduleId].enabled)
  setModuleParam(modelId, moduleId, paramKey, paramValue)
  createModule(moduleId, modelId)?.enable()  // 触发烘焙
```

### 预设存储

| 位置 | 说明 |
|------|------|
| `ModelInstance.motionPresets?: MotionPreset[]` | 按模型存储（per-model） |
| `localStorage` 或全局预设库 | 跨模型共享（可选） |
| 序列化到 `scene-serialize.ts` | 随场景保存/加载 |

---

## 三、UI 设计

### 入口

在 `motion-override-levels.ts` 的模块列表上方增加「预设」卡片：

```
┌─────────────────────────────────┐
│  预设                            │
│  ┌───────────────────────────┐  │
│  │ 坐姿          ▸ 保存/应用 │  │
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

### 复用现有 schema

预设编辑子页复用 `buildModuleParamLevel(moduleId)` 渲染模块参数，用户调参后保存。

---

## 四、实施分期

| 阶段 | 内容 | 验收 |
|------|------|------|
| **P1** | 定义 `MotionPreset` 类型 + `applyPreset()` 函数 | tsc 通过 |
| **P1** | 预设卡片 UI + 应用/保存/新建/删除 | 交互可用 |
| **P2** | 持久化到 `ModelInstance.motionPresets` + `scene-serialize.ts` | 保存→重载后预设仍在 |
| **P3** | 跨模型骨骼映射（`boneMapping`） | 不同模型间可复用预设 |
| **P3** | 预设导出/导入（JSON 文件） | 可分享给其他用户 |

---

## 五、风险与缓解

| 风险 | 缓解 |
|------|------|
| 预设参数与当前模块状态冲突（用户手动调参后应用预设） | 应用预设时全量覆盖，不尝试合并 |
| 模型缺失预设中的骨骼（如 riding-model 的 `左ひざ` 不存在） | `claimBones` 已自动跳过缺失骨骼 |
| 预设过多导致 UI 列表过长 | 限制 10 个，超出时提示「请删除旧预设」 |