# ADR-168: 动态追光：舞台灯跟随角色/骨骼

> **状态**: 已实现（Phase A-D 完成，E 远期搁置）
> **日期**: 2026-07-22（立项）→ 2026-07-23（Phase A-D 落地）
> **关联**: ADR-152（真实光锥）、ADR-159（lighting 拆分）、ADR-167（场景动作库/多角色）

## 1. 问题陈述

当前舞台灯（`StageLightState`）采用**纯静态世界坐标**定位：

- `posX/Y/Z` — 灯的绝对位置
- `targetX/Y/Z` — 光束瞄准的绝对坐标（默认原点）
- `orbit*` — 绕**世界原点**公转

**缺陷**：

| 场景 | 表现 |
|------|------|
| 单角色偏移到 (2, 0, 3) | 灯还照 (0,0,0)，角色半身在暗区 |
| 多角色分散站位 | 无法同时兼顾，只有一盏灯"恰好"照到某角色 |
| VMD 动作幅度大（跳跃/位移） | 角色跑出光锥范围，舞台效果崩塌 |
| 相机 VMD 运镜 | 镜头切到角色侧面，灯光角度不配合，平面感 |

**根因**：灯光系统没有「目标绑定」概念——不感知角色存在，不追踪骨骼位置，不随时间更新。

## 2. 设计目标

| # | 目标 | 验收标准 |
|---|------|---------|
| G1 | 灯光可绑定到角色（模型根节点）或指定骨骼 | SpotLight 的 target 逐帧跟随绑定目标 |
| G2 | 多灯可分别绑定不同角色 | 2 角色 + 2 灯 → 各照各的 |
| G3 | 未绑定时行为不变（向后兼容） | 旧场景文件加载后灯光表现一致 |
| G4 | 跟随有平滑延迟（非硬切） | 快速移动时光束有 0.1-0.3s 的追踪惯性 |
| G5 | 支持「偏移量」微调 | 绑定后仍可 offset 调整瞄准点（如瞄头不瞄脚） |
| G6 | 性能：N 灯 × M 角色 无显著帧率影响 | 8 灯 × 4 角色 < 0.1ms/帧 |

## 3. 方案设计

### 3.1 状态扩展

```typescript
// lighting.ts — StageLightState 新增字段
interface StageLightState {
    // ... 现有字段 ...

    /** 跟随目标（null = 静态模式，向后兼容） */
    followTarget: FollowTarget | null;
}

interface FollowTarget {
    /** 绑定的模型 ID（modelRegistry key） */
    modelId: string;
    /** 骨骼名（null = 模型根节点 / 重心） */
    boneName: string | null;
    /** 相对骨骼的局部偏移（世界单位） */
    offset: [number, number, number];
    /** 追踪平滑系数（0-1，越大越快；0 = 瞬移） */
    smoothing: number; // default 0.15
    /** 灯自身是否也跟随移动（true = 灯位置相对目标保持轨道；false = 只转 target） */
    moveWithTarget: boolean; // default false
}
```

### 3.2 逐帧更新管线

在渲染循环（`onAfterAnimationsObservable`）中注册 **追光 tick**（骨骼动画求值后再更新灯位置，避免延迟一帧）：

```typescript
function _tickFollowLights(): void {
    for (const [id, entry] of lightingState.stageLights) {
        const ft = entry.state.followTarget;
        if (!ft) continue;

        const model = lightingState.modelRegistry?.get(ft.modelId);
        if (!model) continue; // 模型已卸载 → 灯回退静态

        // 1. 求目标世界坐标
        const worldPos = _resolveFollowWorldPos(model, ft);

        // 2. 平滑插值 target
        const current = lightingState.tmpTarget;
        current.copyFrom(entry.light instanceof SpotLight
            ? entry.light.position.add(entry.light.direction.scale(entry.state.orbitDistance))
            : new Vector3(entry.state.targetX, entry.state.targetY, entry.state.targetZ));
        Vector3.LerpToRef(current, worldPos, ft.smoothing, lightingState.tmpTarget);

        // 3. 写回
        entry.state.targetX = lightingState.tmpTarget.x;
        entry.state.targetY = lightingState.tmpTarget.y;
        entry.state.targetZ = lightingState.tmpTarget.z;
        _applyTargetToLight(entry);

        // 4. moveWithTarget：灯位置 = 目标 + 轨道偏移
        if (ft.moveWithTarget) {
            _applyOrbitRelativeTo(entry, lightingState.tmpTarget);
        }
    }
}
```

### 3.3 目标解析策略

| `boneName` | 解析方式 |
|------------|---------|
| `null` | 模型根 mesh 的 `getAbsolutePosition()` + Y 偏移（重心 ≈ 模型高度 × 0.5） |
| `'頭'` / `'center'` 等 | `skeleton.bones.find(name)` → `getAbsolutePosition()` |
| 自定义 | 同上，找不到时 fallback 到根节点 + `logWarn` |

### 3.4 UI 交互

在灯光编辑卡片（`scene-stage-lights.ts`）新增「跟随目标」区块：

```
[跟随目标]  ○ 无（静态）  ○ 角色 1  ○ 角色 2  ...
[骨骼]      [下拉：根节点 / 頭 / 上半身 / ...]
[偏移 Y]    [滑块 -2 ~ 5]
[平滑度]    [滑块 0.01 ~ 0.5]
[灯随动]    [开关]
```

### 3.5 序列化兼容

- `followTarget: null` 时序列化省略该字段 → 旧文件无此字段 → 反序列化默认 `null` → 静态模式。
- 加载时若 `modelId` 对应的模型不存在（场景部分加载），灯保持静态直到模型注册后自动绑定。

### 3.6 性能考量

| 措施 | 说明 |
|------|------|
| 仅遍历 `followTarget !== null` 的灯 | 静态灯零开销 |
| 复用 `lightingState.tmpTarget` / `tmpDir` | 零 GC 分配 |
| 骨骼查找缓存 | `Map<modelId+boneName, Bone>` 缓存，模型卸载时清除 |
| 频率可降 | 若帧率敏感，可隔帧更新（每 2 帧 tick 一次） |

## 4. 备选方案（已否决）

| 方案 | 否决理由 |
|------|---------|
| Babylon `light.parent = mesh` | 灯成为 mesh 子节点后无法独立控制 target 方向；多灯共享 parent 时无法分别瞄准 |
| 每帧硬设 target（无平滑） | 60fps 下 VMD 动作本身已平滑，但用户手动移动模型时会"弹跳"；且无法表达"灯光师手动追踪"的惯性手感 |
| 全局自动追光（所有灯自动照最近角色） | 剥夺用户控制权；多灯场景下行为不可预测 |

## 5. 实施分期

| Phase | 内容 | 估时 |
|-------|------|------|
| **A — 核心追踪** | `FollowTarget` 类型 + `_tickFollowLights` + 根节点跟随 + 序列化 | 2-3h |
| **B — 骨骼绑定** | 骨骼选择 UI + 骨骼缓存 + offset | 1-2h |
| **C — 灯随动** | `moveWithTarget` + 轨道相对计算 | 1h |
| **D — 多灯编排** | 预设中保存 followTarget + 预设切换时平滑过渡追踪目标 | 1h |
| **E — 智能补光（远期）** | 无绑定灯自动填充暗区 / 根据相机角度微调光锥朝向 | 待评估 |

## 6. 风险

| 风险 | 缓解 |
|------|------|
| 模型卸载后灯"失焦" | 检测 modelRegistry 无对应 key → 回退静态 + toast 提示 |
| 骨骼名跨模型不一致（中日英） | 提供 boneName 模糊匹配 + 用户手选覆盖 |
| 高频 tick 与 VMD 求值竞争 | 追光 tick 注册在 `onAfterAnimationsObservable`（骨骼更新后） |
| 光锥/阴影跟随延迟 | 光锥 transform 已在 `coneUpdateHandle` 每帧同步；阴影 ShadowGenerator 自动跟随 light.position |

## 7. 验收清单

- [x] 单角色绑定后，播放位移动作 VMD，光锥始终覆盖角色（个人灯 + 舞台灯追光双路径）
- [x] 双角色 + 双灯分别绑定，互不干扰（个人灯独立 `_entries` Map；舞台灯各自 `followTarget`）
- [x] 旧场景文件（无 followTarget / personalLight）加载后灯光表现不变（默认 null / 默认值）
- [x] 模型卸载后灯回退静态，无报错（`detachPersonalLight` + `modelRegistry.get` 守卫）
- [ ] 8 灯 × 4 角色场景帧率无明显下降（< 0.1ms 追光开销）— 待性能基准测试
- [x] 预设切换时个人灯参数平滑过渡（intensity/color 300ms tween）

## 8. 实现记录（2026-07-23）

### 8.1 双路径架构

实际实现采用**个人灯 + 舞台灯追光**双路径，而非 ADR 原始设计的单一 `followTarget` 方案：

| 路径 | 文件 | 职责 |
|------|------|------|
| **个人灯**（Personal Light） | `lighting-follow.ts` | 每个 actor 自动获得一盏 SpotLight，跟随腰骨/根节点；用户可调亮度/颜色/锥角/高度/光锥/跟随骨骼 |
| **舞台灯追光**（Stage Light Follow） | `lighting-follow.ts` → `tickStageLightFollow()` | 已有舞台灯通过 `followTarget` 字段绑定角色/骨骼，target 逐帧平滑追踪 |

### 8.2 已完成 Phase

| Phase | 状态 | 说明 |
|-------|------|------|
| A — 核心追踪 | ✅ | 个人灯逐帧 tick（`onAfterAnimationsObservable`）+ 平滑插值 + 骨骼解析 |
| B — 骨骼绑定 | ✅ | 个人灯菜单骨骼下拉（`model-detail.ts`）+ 舞台灯跟随目标卡片（`scene-stage-lights.ts`） |
| C — 灯随动 | ✅ | 个人灯天然随动；舞台灯 `moveWithTarget` 开关 |
| D — 多灯编排 | ✅ | 4 个内置预设各配 `personalLight` 联动参数；`applyLightingPresetFromEnv` 末尾 tween 过渡 |
| E — 智能补光 | ❌ 搁置 | 远期，不在本轮范围 |

### 8.3 序列化

- **个人灯**：`SceneFile.models[].personalLight`（差异落盘，仅存与 `DEFAULT_PERSONAL_LIGHT` 不同的字段）
- **舞台灯追光**：`StageLightState.followTarget` 随 `stageLights[]` 整体序列化（null 时省略）
- 反序列化 Phase 2 中调用 `restorePersonalLights()` 恢复个人灯参数

### 8.4 测试覆盖

`src/__tests__/scene/lighting-follow.test.ts`（8 tests）：
- DEFAULT_PERSONAL_LIGHT 默认值完整性（含 boneName）
- StageLightState.followTarget 向后兼容（默认 null）
- getAllPersonalLights / restorePersonalLights 边界
- tickStageLightFollow 无 followTarget / ghost model 静默跳过

### 8.5 已知限制

| 项目 | 说明 |
|------|------|
| 性能基准 | 8灯×4角色 < 0.1ms 尚未实测 |
| 骨骼缓存 | 当前每帧 `WAIST_CANDIDATES.find()`，未做 `Map<modelId+boneName, Bone>` 缓存 |
| 舞台灯 offset UI | `followTarget.offset` 暂无独立滑块，需通过代码设置 |
