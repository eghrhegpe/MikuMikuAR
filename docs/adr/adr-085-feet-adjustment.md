# ADR-085: 脚部地面跟随（Feet Adjustment）

**日期**: 2026-07-11
> **状态**: Phase A 已完成；Phase B/C 降级搁置（2026-07-19）· 已纳入代码审核 4 项修正（纯文档，无代码变更）
>
> **降级说明（2026-07-19）**：长期挂「部分实现」黄灯。逐项复核后判定 Phase B/C 不立项收尾，正式降级为搁置：
> - **Phase B（防滑 + 高跟 + 脚角偏移）**：核心贴地（Phase A）已覆盖舞蹈/演出场景的主要痛点（穿地/悬空/滑冰）。Phase B 三项均为锦上添花型小参数：
>   - 防滑：MMD 动画自带 IK，水平漂移幅度通常 < 0.1m，肉眼难感知；只在大跨度步行动画上有效，但此类动画占比低。
>   - 高跟鞋抬升：大多数 PMX 模型无独立鞋跟骨骼，需手调 `soleHeight` 即可近似。
>   - 脚角偏移/地面法线对齐：可由用户 Bone Override（ADR-061）手动补偿。
> - **Phase C（多点接触 + 自动弯脚趾 + 程序化鞋）**：依赖额外骨骼（足趾骨），多数 PMX 模型不具备；程序化鞋与配件系统重叠。投资回报比低。
> - **触发条件**：出现以下任一需求时重启 Phase B/C——① 用户主动反馈防滑/高跟痛点；② 引入步行动画扩展包导致滑冰可见；③ 多角色 FBX/带足趾骨骼的模型成为主流输入。
> - **替代方案**：高跟鞋用 `soleHeight` 滑块；脚角微调用 Bone Override；多点接触暂无替代（承认限制）。
> 长期维持黄灯会让 `grep 状态行` 返回一串"部分实现"，掩盖真正需要推进的工作。Phase A 升级为正式「已完成」。

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
   f. [maxAngle]   钳制单帧垂直修正量，避免高脚被瞬拉（修正量 ≤ sin(maxAngle)·(L1+L2)，L1+L2 = 髋→踝全腿长，见下方估算）
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
3. 目标脚部 Y = groundY + soleHeight
4. 如果 (脚踝 Y − groundY) > jumpThreshold → 跳过校正（相对地面高度，避免高地形/高平台上误判抬脚）
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

> **★ 审核补充（hysteresis 死区，Phase B 落地时须实现）**：锁定↔释放临界处（`偏移 ≈ feetAntiSlipDistance`）若仅用单阈值，脚部在阈值附近微小抖动会反复触发「锁定→释放→锁定」，产生可见震颤。应在释放阈值之外增设**滞后死区**：进入锁定的阈值 `dLock` 小于释放阈值 `dRelease`（即 `dLock < feetAntiSlipDistance < dRelease`，典型 `dRelease = dLock × 1.5`），使一旦锁定需偏移明显超过 `dRelease` 才释放、一旦释放需回落到 `dLock` 以内才重新锁定，避免临界抖动。该 hysteresis 状态机与现有每模型 `_cache` 同生命周期管理。

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

// core/state.ts — 默认值工厂（与 UI 滑块默认/范围一致）
export function createDefaultFeetState(): FeetState {
    return {
        enabled: false,
        intensity: 1,           // 默认满强度（开关由 enabled 控制）
        soleHeight: 0,          // 范围 -0.1 ~ 0.1
        jumpThreshold: 0.5,     // 范围 0.1 ~ 2
        bodySmooth: 0.5,        // 范围 0 ~ 1
        footSmooth: 0.5,        // 范围 0 ~ 1
        maxAngle: 30,           // 范围 0 ~ 60（度）
        reachAngle: 15,         // 范围 0 ~ 45（度）
    };
}
```

### 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `frontend/src/scene/motion/feet-adjustment.ts` | **新增** | 核心模块：MMD-native 驱动足IK目标骨骼世界坐标 + `ikSolver.solve(false)` 重解腿 IK（地面检测在 `feet-adjustment-math.ts` 纯函数） |
| `frontend/src/__tests__/feet-adjustment.test.ts` | **新增** | 单元测试：纯函数 `solveFootTarget` 正确性（跳跃跳过/贴地/脚底高度/footSmooth/reachAngle/maxAngle 钳制/intensity 混合/阈值边界） |
| `frontend/src/core/types.ts` | 修改 | 新增 `FeetState` 类型 + `ModelInstance.feet` 字段 + `MmdRuntimeBoneExtended.ikSolver` |
| `frontend/src/core/state.ts` | 修改 | 新增 `createDefaultFeetState()` 工厂 |
| `frontend/src/scene/scene-serialize.ts` | 修改 | 持久化 `inst.feet`（序列化/恢复，仿 `boneOverrides`） |
| `frontend/src/scene/motion/bone-override.ts` | **未修改** | 注册顺序在 `scene.ts` 中保证 Feet Adjustment 先于 Bone Override（dynamic import 顺序），bone-override.ts 本身无需改动 |
| `frontend/src/scene/scene.ts` | 修改 | 注册 `feet-adjustment` 观察者（在 bone-override 之前） |
| `frontend/src/menus/motion-feet-levels.ts` | **新增** | UI 菜单：脚部贴地参数面板 |
| `frontend/src/menus/motion-popup.ts` | 修改 | 注册脚部调整菜单入口（`'motion:feet': buildFeetLevel` + 文件夹项 `lucide:footprints`） |
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

### Phase A（核心贴地）— 已完成
1. 实现 `feet-adjustment.ts`：MMD-native 驱动足IK目标 + `ikSolver.solve` 重解腿 IK + 地面检测 + 跳跃检测
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

---

## 审核发现修正汇总（2026-07-11）

代码审核结论：**有条件通过**。4 项意见均为文档层，无代码变更需求（实现已通过 `npm run check` / `npm run test`(1251) / `npm run build`）。

| 级别 | 位置 | 问题 | 处置 |
|------|------|------|------|
| 🟡 P2 | §解算 f) | `maxAngle` 公式 `sin(maxAngle)·L` 中 `L` 指代不明（单腿长 vs L1+L2） | ✅ 已明确 `L = L1+L2`（髋→踝全腿长），与 §腿长估算 一致；代码 `legLength = |hip − foot|` 即全腿长 |
| 🟡 P3 | §防滑实现 | 锁定↔释放临界切换可能抖动 | ✅ 已补充 hysteresis 死区设计（`dLock < dRelease`，Phase B 落地时实现），状态机与 `_cache` 同生命周期 |
| 🟢 P4 | §文件变更清单 | `feet-adjustment.test.ts` 路径误写为 `scene/motion/`（实际 `__tests__/`，与 ADR-084 一致） | ✅ 已更正路径 + 描述（覆盖 `solveFootTarget` 纯逻辑，不含 Phase B 防滑） |
| 🟢 P4 | §状态管理 | 未给出 `createDefaultFeetState()` 签名 | ✅ 已补工厂签名与默认值（与 UI 滑块默认/范围一致） |

**附带文档一致性修正**（审核未列，但同批核实）：
- §文件变更清单核心模块描述去掉「两骨骼 IK 解算 + 防滑 + 高跟鞋」（采纳 MMD-native；防滑/高跟属 Phase B）
- `bone-override.ts` 标注为「未修改」（注册顺序仅由 `scene.ts` 的 dynamic import 顺序保证）
- 菜单入口文件 `motion-menu.ts` → `motion-popup.ts`（前者不存在）
- §地面检测 旧字段名 `feetSoleHeight`/`feetJumpThreshold` → `soleHeight`/`jumpThreshold`
- §分期 Phase A 描述「两骨骼 IK 解算」→ MMD-native，并标记「已完成」

### 相对阈值修正（2026-07-11，验证期发现）

**问题**：`solveFootTarget` 原以 `footY > jumpThreshold`（IK 骨骼绝对世界 Y）判定抬脚放行。在高地形山坡 / 高平台上，脚落回时 `footY` 与 `groundY` 同为高位（如均 ≈3.0），绝对高度 3.0 > 0.5 → 被误判为「抬脚」跳过 → grounding 在坡顶失效。小地形（groundY≈0.2）因脚落回 < 0.5 碰巧正常，掩盖了 bug。

**修复**：`feet-adjustment-math.ts:48` 改为相对地面高度判定 `footY - groundY > jumpThreshold`。语义正确：仅当脚离地超过阈值才放行抬脚/跳跃；§地面检测 步骤 4 同步改为 `(脚踝 Y − groundY) > jumpThreshold`。

**锁定**：`feet-adjustment.test.ts` 新增 2 例回归（高地形坡顶脚落回应贴地 `skip=false groundY=3.0` / 高地形上脚真正抬起仍 `skip=true footY=5.5`）。全量单测 1253 例全绿（`npm run check` / `npm run test` / `npm run build` 三项通过）。

**附带修复（无关脚部，env-preset 工作遗留）**：`app.contract.test.ts` 期望清单漏列 `SaveEnvPresetAuto`（ADR-087 新增 Go 绑定 `SaveEnvPresetAuto` 已重新生成），补入「函数导出」+「方法 ID」两处清单，恢复契约测试全绿。