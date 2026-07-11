# ADR-085: 脚部地面跟随（Feet Adjustment）

**日期**: 2026-07-11
> **状态**: 部分实现（Phase A 已完成，Phase B/C 待开发）

---

## 背景

模型加载后虽然初始贴地（`model-loader.ts` 调用 `getGroundHeightAt` 放置根节点），但在动画播放过程中，**脚部会穿透地面或悬空**，缺乏实时地面约束。竞品对标（`docs/competitive-analysis.md`）明确标注此功能为 ❌，DanceXR 为 ✅。

用户可感知的痛点：
1. **滑冰效应**：脚部在动画中沿地面滑动，无锚定感
2. **地面穿插**：脚部陷入地面或悬空
3. **坡面不匹配**：在 heightmap 地形上脚部角度不贴合
4. **高跟鞋无适配**：脚部姿态不补偿鞋跟高度

### 现有基础设施

| 能力 | 位置 | 说明 |
|------|------|------|
| 地面高度查询 | `env-impl.ts:getGroundHeightAt(x, z)` | 支持 heightmap 起伏 + 平面 groundLevel |
| 骨骼覆盖 | `bone-override.ts` | 每帧动画后骨骼旋转覆盖，Slerp 混合 |
| PMX 足 IK 骨骼 | `proc-motion-shared.ts` | 已匹配 `左足IK/右足IK` 候选列表 |
| 初始贴地 | `model-loader.ts:277` | 加载时放根节点到地面，但无运行时跟随 |
| Motion Override UI | `motion-override-levels.ts` | 骨骼选择器 + 欧拉角/权重 UI 框架 |

### 缺口

- **无运行时 IK 解算器**：DanceXR 的「两骨骼腿部 IK」流程 — 从髋→膝→踝反算旋转，MikuMikuAR 未实现
- **无地面碰撞检测回调**：每帧检测脚部是否触及地面，无此机制
- **无防滑锁定**：已着地的足部应在 XZ 平面锁定，防止滑冰
- **无跳跃检测**：模型在空中的阈值判断，暂停校正

---

## 功能范围

### Phase A — 核心脚部贴地（P1 核心）

| DanceXR 参数 | 映射（`FeetState` 实字段名） | 说明 |
|---|---|---|
| 强度 (Intensity) | `intensity` | 0=禁用，1=最大，总体开关 |
| 脚底高度 (Sole Height) | `soleHeight` | 脚趾到地面间隙，默认 0，范围 -0.1~0.1 |
| 跳跃高度 (Jump Threshold) | `jumpThreshold` | 脚部 Y 超过此值暂停校正，默认 0.5 |
| 身体平滑度 (Body Smooth) | `bodySmooth` | 身体响应平滑，默认 0.5，范围 0~1 |
| 脚部平滑度 (Foot Smooth) | `footSmooth` | 脚部响应平滑，默认 0.5，范围 0~1 |
| 最大足倾角 (Max Foot Angle) | `maxAngle` | 脚可倾斜的最大角度，默认 30°，范围 0~60 |
| 触及倾角 (Reach Angle) | `reachAngle` | 腿无法触及时的额外趾尖下沉，默认 15°，范围 0~45 |

### Phase B — 防滑与高跟（P1 增强）

| 参数 | 映射 | 说明 |
|---|---|---|
| 防滑开关 | `feetAntiSlipEnabled` | 启用/禁用防滑 |
| 防滑强度 | `feetAntiSlipStrength` | 锁定程度，默认 0.8，范围 0~1 |
| 滑动距离 | `feetAntiSlipDistance` | 释放前允许漂移的远度，默认 0.1 |
| 高跟抬升 | `feetHeelHeight` | 鞋跟高度，默认 0，范围 0~0.2 |
| 脚角偏移 X/Y/Z | `feetAngleOffset` | `[pitch, yaw, roll]` 度，手动旋转偏移 |
| 地面自动对齐旋转 | `feetAutoAlignRotation` | 布尔值，脚部旋转自动匹配地面法线 |

### 不 scope

- **多点接触解算**（DanceXR 2024.10 高级功能）：多个脚趾接触点解算，复杂度过高，留待 Phase C
- **自动弯脚趾**：需要额外骨骼（足趾），大多数 PMX 模型无此骨骼
- **程序化鞋模型**：与配件系统重叠，不在此范围

---

## 技术方案

### 架构

新增 `feet-adjustment.ts` 模块，挂载到 `scene.onBeforeRenderObservable`，**注册顺序在 `bone-override` 之前**（脚部 IK 是自动约束，作为基础；手动 Bone Override 可叠加在脚 IK 结果之上）。

```
VMD 动画解算 → (WASM Bullet 物理) → [Feet Adjustment: 驱动足IK骨骼 + 重解腿 IK] → Bone Override → 渲染
```

> **★ 关键决策（2026-07-11 架构复核）**：MMD 模型**自带腿部 IK**——`左足IK`/`右足IK` 骨骼是 IK 目标，`足`(大腿)→`ひざ`(膝)→`足首`(踝) 是 IK 链，由 babylon-mmd 的 `IkSolver` 在 `MmdRuntimeModel._update()` 内、动画应用**之后同帧解出**。`IkSolver.solve()` 读取 IK 骨骼世界坐标作为目标、旋转链骨骼，并**内部回写** `targetBone`(踝) 与链骨骼的 `worldMatrix`。

> ❌ **否决原始方案**（手动两骨骼余弦定理 IK + 写大腿/小腿旋转）：会被下一帧 VMD 动画（通常含 `左足IK` 关键帧）覆盖，且绕过引擎膝关节约束（`limitAngle`/`rotationConstraint`），与 babylon-mmd 求解器打架。

> ✅ **采用 MMD-native 方案**：直接驱动 IK 目标骨骼的**世界坐标**（`IMmdRuntimeBone.setWorldTranslation`，WASM/JS 通用），再调用该骨骼的 `ikSolver.solve(false)` 重解该腿 IK。复用引擎膝关节约束，零自研运动学，且与动画每帧「覆盖→重解」的既有模式一致（同 `bone-override` 的逐帧后处理范式）。

### 脚部 IK 解算算法（MMD-native）

```
每帧（动画解算后）:
1. 取聚焦/全部已启用脚部调整的模型的 runtime bones
2. 解析左/右 IK 骨骼名（matchBone(BONE_LEG_IK_*_CANDIDATES)，按模型缓存）
3. 对每个脚:
   a. cur = ikBone.getWorldTranslation()        // 当前 IK 目标（动画驱动）世界坐标
   b. groundY = getGroundHeightAt(cur.x, cur.z)  // env-impl.ts 地面高度
   c. if cur.y > jumpThreshold → 跳过（脚在空中，允许踢腿/跳跃）
   d. desiredY = groundY + soleHeight            // 目标脚底高度
   e. [reachAngle] 若 髋→desiredFoot 距离 > 腿长 L1+L2 → desiredY 额外下沉 sin(reachAngle)·过冲量（趾尖补偿）
   f. [maxAngle]   钳制单帧垂直修正量，避免高脚被瞬拉（修正量 ≤ sin(maxAngle)·L）
   g. [footSmooth] 向 desiredY 平滑过渡（着地立即、离地按 footSmooth 软化）
   h. ikBone.setWorldTranslation(cur.x, smoothedY, cur.z)
   i. ikBone.ikSolver.solve(false)              // 重解该腿 IK，内部回写踝+链世界矩阵
```

> **腿长 L1+L2 估算**：从 IK 骨骼沿 `parentBone` 向上回溯至匹配大腿根候选（`左足`/`右足`）的骨骼取世界坐标作为髋 `H`；`L = |H − 踝世界坐标|`（踝 = `ikSolver.targetBone`）。每模型缓存。

> **物理模式交互（已知限制）**：当 WASM 物理开启且腿部刚体处于「物理驱动」模式（非 FollowBone）时，babylon-mmd 的 `canSkipWhenPhysicsEnabled` 为 true → IK 求解被跳过，脚部贴地在该模式下不生效。舞蹈常用 FollowBone 模式（骨骼驱动刚体）不受影响。Phase B 可探讨物理模式下的补偿策略。

### 地面检测

```
每帧:
1. 获取左/右踝关节的世界位置 (footWorldPos)
2. 查询 getGroundHeightAt(footWorldPos.x, footWorldPos.z) → groundY
3. 目标脚部 Y = groundY + feetSoleHeight
4. 如果脚踝 Y > feetJumpThreshold → 跳过校正
5. 否则执行 IK 解算，将脚部拉到目标位置
```

### 防滑实现

```
当脚部接触地面时:
1. 记录接触时的 XZ 位置 (lockedX, lockedZ)
2. 每帧检查脚部相对于锁定位置的偏移
3. 如果偏移 < feetAntiSlipDistance → 强制脚部 XZ 回锁定位
4. 如果偏移 >= feetAntiSlipDistance → 释放锁定，更新锁定位置
5. 防滑强度控制锁定力度: 锁定位置 = lerp(当前脚部XZ, 锁定XZ, strength)
```

### 状态管理

> **★ 决策（2026-07-11 架构复核）**：脚部调整是**按模型**的——UI 入口在模型详情面板、各模型 IK 骨骼名不同、应随模型存档。因此 `FeetState` 挂在 `ModelInstance.feet`（仿 `boneOverrides` 的持久化范式），**非**全局 `EnvState`。

```typescript
// core/types.ts
export type FeetState = {
    enabled: boolean;            // 总开关
    intensity: number;           // 0=禁用, 1=最大（总体强度）
    soleHeight: number;          // 脚底高度（世界单位），默认 0
    jumpThreshold: number;       // 脚踝 Y 超此值暂停校正（跳跃），默认 0.5
    bodySmooth: number;          // 身体响应平滑 0..1，默认 0.5
    footSmooth: number;          // 脚部响应平滑 0..1，默认 0.5
    maxAngle: number;            // 最大足倾角（度），默认 30
    reachAngle: number;          // 触及倾角（度），默认 15
};
// ModelInstance 增加: feet: FeetState
```

### 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `frontend/src/scene/motion/feet-adjustment.ts` | **新增** | 核心模块：两骨骼 IK 解算 + 地面检测 + 防滑 + 高跟鞋 |
| `frontend/src/scene/motion/feet-adjustment.test.ts` | **新增** | 单元测试：IK 解算正确性、防滑逻辑、跳跃检测 |
| `frontend/src/core/types.ts` | 修改 | 新增 `FeetState` 类型 + `ModelInstance.feet` 字段 + 默认值工厂 |
| `frontend/src/scene/scene-serialize.ts` | 修改 | 持久化 `inst.feet`（序列化/恢复，仿 `boneOverrides`） |
| `frontend/src/scene/motion/bone-override.ts` | 修改 | 可选：暴露骨骼写入时机，确保 Feet Adjustment 先于手动 Override |
| `frontend/src/scene/scene.ts` | 修改 | 注册 `feet-adjustment` 观察者 |
| `frontend/src/menus/motion-feet-levels.ts` | **新增** | UI 菜单：脚部贴地参数面板 |
| `frontend/src/menus/motion-menu.ts` | 修改 | 注册脚部调整菜单入口 |
| `frontend/src/core/i18n/locales/zh-CN.ts` | 修改 | 新增 i18n 翻译键 |
| `frontend/src/core/i18n/locales/en.ts` | 修改 | 新增 i18n 翻译键 |
| `frontend/src/core/i18n/locales/ja.ts` | 修改 | 新增 i18n 翻译键 |
| `frontend/src/core/i18n/locales/ko.ts` | 修改 | 新增 i18n 翻译键 |
| `frontend/src/core/i18n/locales/zh-TW.ts` | 修改 | 新增 i18n 翻译键 |

### 菜单结构

```
模型详情面板 → 脚部调整 (新入口)
└─ 脚部贴地 [folder]
   ├─ 强度          [slider 0-1]
   ├─ 脚底高度      [slider -0.1~0.1]
   ├─ 跳跃阈值      [slider 0.1~2]
   ├─ 身体平滑度    [slider 0-1]
   ├─ 脚部平滑度    [slider 0-1]
   ├─ 最大足倾角    [slider 0-60]
   └─ 触及倾角      [slider 0-45]
├─ 防滑 [folder]
   ├─ 启用          [toggle]
   ├─ 防滑强度      [slider 0-1]
   └─ 滑动距离      [slider 0-0.5]
├─ 高跟            [slider 0-0.2]
├─ 脚角偏移 [folder]
   ├─ 旋转 X        [slider -45~45]
   ├─ 旋转 Y        [slider -45~45]
   ├─ 旋转 Z        [slider -45~45]
   └─ 自动对齐地面   [toggle]
```

---

## 依赖 / 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| **babylon-mmd 骨骼写入时机** | ✅ 已解决（2026-07-11） | 采用逐帧后处理范式：动画后 `setWorldTranslation` 驱动 IK 目标 + `ikSolver.solve` 重解，与 `bone-override` 同构；VMD 每帧覆盖 IK 骨骼后被我们重解，渲染帧内生效 |
| **WASM/JS 分裂** | 骨骼回写路径不同 | `setWorldTranslation` / `getWorldTranslationToRef` / `ikSolver` 均为 babylon-mmd 运行时接口（WASM/JS 通用），无需区分 `linkedBone`/`worldMatrix` |
| **性能** | 每帧 IK 重解 + 地面查询 | 单腿 `solve` 迭代 1 次、计算量极低；`getGroundHeightAt` 已缓存；无需优化 |
| **PMX 骨骼命名差异** | 部分模型无标准 IK 骨骼 | `matchBone(BONE_LEG_IK_*_CANDIDATES)` 回退；无 IK 骨骼模型跳过该脚（不报错） |
| **heightmap 地形性能** | 每帧查询 `getHeightAtCoordinates` | 该函数已缓存，性能可接受 |
| **物理模式腿部刚体** | IK 被跳过 → 贴地失效 | 已知限制（FollowBone 模式不受影响）；Phase B 评估物理模式补偿 |

---

## 分期

### Phase A（核心贴地）— 预计 2-3 天
1. 实现 `feet-adjustment.ts`：两骨骼 IK 解算 + 地面检测 + 跳跃检测
2. 实现 `FeetState` 类型 + 默认值
3. 注册到 `scene.ts` 观察者
4. 单元测试覆盖 IK 解算正确性
5. 基础 UI 菜单（强度/脚底高度/跳跃阈值/平滑度/足倾角）

### Phase B（防滑+高跟+偏移）— 预计 1-2 天
1. 防滑逻辑（锁定 XZ + 滑动距离释放）
2. 高跟鞋抬升
3. 脚角偏移
4. 地面自动对齐旋转
5. UI 完整菜单

### Phase C（高级功能）— 待定
- 多点接触解算
- 自动弯脚趾
- 程序化鞋模型（与配件系统联动）

---

## 相关 ADR

- [ADR-061](adr-061-advanced-bone-systems.md) — Bone Override 机制，作为 Feet Adjustment 的骨骼写入通道
- [ADR-083](adr-083-ground-enhancement-expansion.md) — 地面功能扩展（heightmap/坡度/纹理滚动），提供地面高度查询
- [ADR-052](adr-052-ground-mode-enhancement.md) — 地面模式增强，`groundLevel` 参考高度
- [ADR-079](adr-079-perception-layer-expansion.md) — 感知层（呼吸/眨眼/头部跟随），与本 ADR 的「always-on 约束」理念一致
- `docs/competitive-analysis.md` — 脚部地面跟随标注为 ❌