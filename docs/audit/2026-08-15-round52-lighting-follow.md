# Round52 审核报告 — lighting-follow（个人灯跟随 + fix P2 u_cameraPos 补测）

**审核日期：** 2026-08-15
**审核员：** 子代理 round52-lighting-follow（本报告为第 52 轮第 2 个测试，共 3 个）

## 审核范围

| 项 | 内容 |
|----|------|
| 测试文件 | `frontend/src/__tests__/lighting-follow.test.ts`（652 行，27 用例，8 个 describe） |
| 被测源码 | `frontend/src/scene/render/lighting-follow.ts`（574 行，全文件） |
| fix P2 变更行 | `lighting-follow.ts:384-393` — `tickPersonalLights` 中个人灯锥每帧同步相机位置 `u_cameraPos`（提交 28200cc5，2026-08-07，+7 行，未附测试） |
| 关联依赖 | `lighting.ts:189-197`（舞台锥 u_cameraPos 同步 observer）、`light-cone.ts:48,59,123`（u_cameraPos shader uniform，Fresnel 辉光 `viewDir = normalize(u_cameraPos - vWorldPos)`） |
| 验证方式 | `cd frontend && npm run test -- src/__tests__/lighting-follow.test.ts` → **27/27 通过（70ms）**；`npm run check`（tsc 全量）按任务说明跳过，本文件类型健康度以逐行阅读为准 |

## 与历史审核轮次的关系

- **round-4 审 lighting**、**round-13 审 lighting（✅）**、**round-42 审 lighting-stage（✅，提交 ae3bfc30）** —— 均为前序轮次，聚焦 lighting.ts 主光管理/舞台灯。
- 本测试是 **lighting-follow（个人灯跟随系统）的补测**：round-4/13 审 lighting 时发现 onBeforeRender observer 仅遍历 stageCones、个人灯锥 Fresnel 永远用默认 (0,0,0) 相机位置 → 该缺陷在 **28200cc5（2026-08-07）以 fix P2 修复**，但修复提交未附测试（coverage-hint 提示 lighting-follow.ts 覆盖率 0.0%）。
- 测试文件经 782daabe（创建）/ d2d68607 / 27b9d31a 三轮迭代补全至当前 652 行，**对 fix P2 变更行做正面+反面双重覆盖**，并顺带覆盖个人灯全功能面（attach/tick/state/detach/serialize/default/gizmo/stage-follow）。

## 总体结论

✅ **通过**

fix P2 变更行实现正确（与 lighting.ts:189-197 舞台锥同步模式对齐、null 安全、无性能隐患），补测 27 用例全绿且断言有效——变更行行为被真实验证（含值断言与假分支覆盖），无跳过测试、无逃生舱、无静默吞错。

## 亮点

| # | 亮点 | 位置 |
|---|------|------|
| 1 | **fix P2 变更行双分支覆盖**：有 activeCamera 时断言 `setVector3('u_cameraPos', {x:3,y:4,z:5})` 值正确；显式置空 `activeCamera` 断言不抛错、不写入——正面+反面均实测 | `lighting-follow.test.ts:114-148` |
| 2 | **NullEngine + 真实 Scene 范式**：真实 `Scene`/`SpotLight`/`FreeCamera` 上断言真实属性（intensity/position/direction/range），比纯桩断言有效；`scene.dispose()` 统一释放真实对象，用例干净 | `lighting-follow.test.ts:99-112, 119` |
| 3 | **vi.hoisted 可变 mock** 切换 gizmo 拖拽态（拖拽跳过 tick → 结束恢复跟随），符合 frontend/AGENTS.md 测试卫生铁律（工厂只引用 hoisted 绑定） | `lighting-follow.test.ts:22-26, 229-251` |
| 4 | **副本隔离契约全覆盖**：getPersonalLightState / getAllPersonalLights / getPersonalLightDefault 三处均验证"修改返回值不影响内部状态"，防外部误改绕过 setPersonalLightState 同步 | `lighting-follow.test.ts:340-362, 586-591, 640-651` |
| 5 | **边界覆盖全面**：enabled=false 跳过、gizmo 拖拽跳过、模型移除 continue、cone=null 不抛、多灯 disposeAll 清空、腰骨 worldMatrix 基准点（列主序矩阵构造）、LerpToRef 平滑收敛（两次 tick 断言 0.15 比例不瞬移） | `lighting-follow.test.ts:212-301, 364-400` |
| 6 | **数值断言严谨**：浮点用 `toBeCloseTo(…, 5)`；lerp 断言不仅验结果还验"小于 100 未瞬移"（防老 bug 复发） | `lighting-follow.test.ts:265-287` |
| 7 | **源码修复处注释到位**：fix P2 变更行注释说明根因（observer 仅遍历 stageCones）、影响（Fresnel 恒指向原点）、对齐策略（与舞台锥一致），后续维护者可读 | `lighting-follow.ts:384-387` |
| 8 | **资源生命周期完备**：attach 建 light/indicator/shadowGen/cone，detach 全部释放（`disposeLightCone` + `safeDispose` 三连）；`_ensurePersonalShadow`/`_ensurePersonalCone` 重建前先 dispose 旧资源；`disposeLighting` 释放全部 observer 句柄（含 P1-fix 的 stageFollowTickHandle） | `lighting-follow.ts:295-308, 234-261, 397-440`；`lighting.ts:520-546` |

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | lighting-follow.ts | 188-194 / 325-331 / 524-531 | 腰骨候选匹配逻辑（`WAIST_CANDIDATES.find(...)`）在 attachPersonalLight、setPersonalLightState、tickStageLightFollow 三处重复 | 提取 `_resolveWaistBone(model, boneName)` helper，三处调用统一 |
| 🟡 P3 | lighting-follow.ts | 196-200 / 285-289 / 370-374 | 目标位置公式 `basePos + (offsetX, height, offsetZ)` 重复 3 次，未来加字段（如 offsetY）需同步改 3 处 | 提取 `_computeTargetPos(model, entry)` 复用 |
| 🟡 P3 | lighting-follow.ts | 353 | 个人灯平滑系数硬编码 `const smoothing = 0.15`，而舞台灯追光用状态字段 `ft.smoothing`——个人灯不可配置，两处平滑语义同源但数值来源不一致 | 将 smoothing 并入 PersonalLightSettings（默认 0.15），tick 从 entry.settings 读取 |
| 🟢 P4 | lighting-follow.test.ts | 1-9 | 文件头注释引用 "scene/lighting-follow.test.ts" 路径不存在（git 历史确认测试自创建即在 `src/__tests__/` 下） | 更正注释为实际路径，或改为描述性说明 |
| 🟢 P4 | lighting-follow.test.ts | 42-44 | `vi.mock('@/scene/physics/physics-bridge')` 为冗余 mock：当前源码链（lighting.ts 及其子模块）已无人 import `getBoneWorldPosition`（源码 158 行注释证实已改用 TransformCoordinatesToRef），系历史遗留 | 删除该 mock，减少误导 |
| 🟢 P4 | lighting-follow.test.ts | 20 | mockCone 形状 `{ material: { setVector3 } }` 与真实 `LightConeEntry`（mesh/material/geoLength/geoAngle）非超集；未来变更行新增 `entry.cone.mesh` 等访问会静默 undefined | mock 形状补全 LightConeEntry 字段（mesh: null 等）保持超集一致 |
| 🟢 P4 | lighting-follow.test.ts | 139 | `(lightingState.scene as Scene).activeCamera = null` 用类型断言表达"必非空"（测试内断言，非生产 any 逃生，可接受） | 可改为 `expect(lightingState.scene).not.toBeNull()` 前置守卫后赋值，消除断言 |
| 🟢 P4 | lighting-follow.ts | 486 | `(node as unknown as { position: Vector3 }).position` double-cast 收窄 Babylon Node → TransformNode 契约（非 any 逃生） | 若 transform-adapter 提供泛型节点回调可消除，否则保留并加一行注释说明契约来源 |

## 测试质量评价

**整体：良好（B+）**，作为 fix P2 补测达标，且超出单点覆盖。

- **断言有效性（强）**：fix P2 变更行的核心行为——相机位置写入个人灯锥 material——被 `toHaveBeenCalledWith('u_cameraPos', expect.objectContaining({x,y,z}))` 真实验证，参数值来自真实 FreeCamera 的 (3,4,5)，非桩死值；`objectContaining` 用于 Vector3 实例（带方法/原型）是正确选择。lerp 用例用两帧 0.15 收敛数学期望验证平滑契约，防"瞬移"复发。舞台灯用例验证 moveWithTarget 不飞走（老 bug 回归防线）。
- **mock 合理性（良）**：整模块 mock light-cone 避免了 NullEngine 下 ShaderMaterial 编译复杂度，聚焦被测变更行——合理取舍；transformMocks 用 vi.hoisted 满足 vi.mock 工厂 hoist 约束。瑕疵为 physics-bridge 冗余 mock 与 mockCone 非超集形状（均 P4）。
- **环境与清理（优）**：happy-dom（localStorage 真实可用）+ 每用例 detach/unregisterModel + afterEach disposeLighting/scene.dispose/engine.dispose，无跨用例状态残留；`vi.clearAllMocks()` 在 beforeEach 保证 mockCone 调用记录不串。
- **边界覆盖（优）**：无相机 / 灯锥缺失 / 模型移除 / gizmo 拖拽 / disabled 五个跳过分支全覆盖；多灯仅在 disposeAll 用例覆盖，u_cameraPos 多灯写入未逐灯断言（同一循环逻辑，缺口极小，P4）。
- **无跳过**：grep 确认无 `.skip/.todo/.only/xit`。

## 审核依据

- 生产实现：`lighting-follow.ts` 全文件逐行阅读；`lighting.ts:160-212`（initLighting 注册链）、`lighting.ts:520-546`（disposeLighting 释放链）、`light-cone.ts:40-186`（shader/材质/创建）、`mmd-adapter.ts:412-414`（onBoneMatricesUpdated 时序契约）。
- 变更溯源：`git show 28200cc5` 确认 fix P2 为 +7 行纯增量（`if (entry.cone)` 块内 u_cameraPos 同步 + 根因注释），未附测试；coverage-hint 记录 lighting-follow.ts 覆盖率 0.0% 为补测动机。
- 测试执行：27/27 通过（70ms，Duration 1.03s），无 flaky 迹象。

---

*审核日期：2026-08-15 · 审核员：子代理 round52-lighting-follow*
