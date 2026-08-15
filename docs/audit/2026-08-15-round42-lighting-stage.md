# Round-42 舞台灯模块（lighting-stage）审核报告

## 审核范围

| 项 | 内容 |
|----|------|
| 测试文件 | `frontend/src/__tests__/lighting-stage.test.ts`（1024 行，67 用例，ADR-159 舞台灯模块补测） |
| 被测源码 | `frontend/src/scene/render/lighting-stage.ts`（652 行） |
| 关键行号 | `_createStageLight` L43-89、`_updateIndicator` L123-179、`get/set 状态` L193-280、`_disposeStageLightEntry` L283-288、`addStageLight` L298-327、`removeStageLight` L329-346、`loadStageLights` L349-392、`_applyStageLightParams` L455-541、光锥 `_ensureStageCone/_disposeStageCone` L549-615、transform adapter L619-652 |
| 关联源码 | `lighting-state.ts`（共享状态，真实保留）、`lighting.ts`（`_defaultStageLightState` L105-139，仅 mock 该符号）、`lighting-shadow.ts`（`_ensureStageShadow` L59 / `_disposeStageShadow` L100）、`light-cone.ts`、`transform-adapter.ts`（`registerTransformAdapter` L55） |
| 验证结果 | `npm run test -- src/__tests__/lighting-stage.test.ts` → **67 passed / 67，exit 0，316ms** ✅ |

## 总体结论：✅ 通过

生产源码无新增类型逃生（0 处 `as any`/`@ts-ignore`）、资源释放配对完整（灯/指示器/方向线/阴影/光锥在 `_disposeStageLightEntry` 收口）、测试断言有效且边界覆盖全面、无跳过用例、mock 布局聚焦合理；67/67 全绿。无 P1/P2 级风险，仅 P3/P4 级可改进项。

### 与历史审核的关系（round-4 / round-13）

- **round-4（❌ 不通过，`round-4-lighting-props.md`）**：当时 `scene/env/lighting.ts` 1229 行，0 实质测试（P1）、`transitionLighting` 未调度（P1）、`_tweenValue` 用 `addOnce`（P1）、缺 `disposeLighting()`（P2）、建议拆 6 子模块（含 lighting-stage）。**本测试即拆分落地后的收口验证**：舞台灯子模块（现 `scene/render/lighting-stage.ts`）的"0 实质测试"P1 已由本测试（深路径 mock，状态/类型切换/光锥/adapter 侧）与兄弟测试 `src/__tests__/scene/lighting-stage.test.ts`（NullEngine 真实驱动，add/remove/load/dispose 生命周期侧）双轨填补。
- **round-13（⚠️ 有条件通过，`2026-08-06-round13-scene-render-core-ui.md`）**：lighting 整体 4 处 P2（含 `rebakeEnvBrightness` 无防重入钳制——属 `lighting.ts` 主光侧，非本模块）；当时 lighting-stage 生命周期测试已通过。本轮补测覆盖类型切换/gizmo 重附着/光锥/transform adapter 回调等 round-13 未覆盖面，两测试一真一 mock 互补。
- **遗留（不在本测试范围）**：round-13 遗留的 lighting 主光侧 P2（rebake 防复利基准、坐标系契约 P3）与主光过渡/太阳盘/个人灯追光（ADR-168，已有 `lighting-follow.test.ts`）未在本测试覆盖，属其他审核目标。

## 亮点

- **mock 面最小化且聚焦**（测试 L289-324）：Babylon 深路径 7 个模块全 mock（绝不真实例化），`lighting-state` 保留真实（共享状态对象 + `SHADOW_REBUILD_KEYS`/`CONE_UPDATE_KEYS` 真实键集参与判定），`lighting` 仅 mock `_defaultStageLightState`（type-only 导入编译期擦除），其余依赖 `light-cone`/`lighting-shadow`/`transform-adapter`/`transform-pick`/`color-helpers`/`logger` 全部桩化。mock 形状与真实符号签名一致（见 `transform-adapter.ts:28-50` 接口、`lighting-shadow.ts:59/100`、`light-cone.ts:162-249`）。
- **资源释放断言到对象级**：`_createStageLight` 三类型创建/禁用归零（测试 L421-489）、类型切换验证 `oldLight.disposed === true` + 新类型实例 + `disposeStageShadow`/`ensureStageShadow`/`triggerAutoSave` 完整副作用链（L637-646）、`_disposeStageLightEntry` 验证指示器/方向线置空 + 灯 disposed + 阴影/光锥释放（L803-831）。
- **零向量守卫双路径覆盖**：directional 创建时 target===pos fallback 朝下（测试 L475-489，覆盖生产 L78-82），`setStageLightState` 参数应用路径同款守卫（L708-718，覆盖生产 L501-508/L534-536）——两处 fallback 均有测试钉住。
- **边界覆盖全面**：scene null（L493-498）、triggerAutoSave null（L630-635）、skipLightAutoSave（L663-668）、6 盏上限（L851-857，生产 L304-307）、仅剩 1 盏拒绝删除（L865-869）、disabled 不创建光锥/不写 intensity（L736-740、L795-800）、material 被外部清理重建（L510-516）、方向线 instance 复用不新建 Mesh（L518-527，生产 L158-162）、原点 orbit 反算不崩溃（L604-609，生产 L441-442 `Math.max(0.1, len)` 守卫）、旧存档 volumetric→cone 迁移逐字段断言（L907-936，生产 L370-381）。
- **transform adapter 全回调覆盖**（L968-1024）：kinds/capabilities、getNode、gizmoTypes 按类型区分（point 无旋转）、onPositionDragEnd 回写、onRotationDragEnd spot/directional 双向、missing entry 守卫、scale/opacity 透传——与生产 L619-652 逐项对应。
- **生产代码状态流收口**：无模块级可变状态（状态集中于 `lightingState`，符合 ADR-159 P3-B），`_registerStageLight`/`_disposeStageLightEntry` 双收口，`loadStageLights` 与 `disposeLighting` 复用同一释放入口（`lighting.ts:526-531`），`skipLightAutoSave` 统一抑制自动保存。

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | `frontend/src/scene/render/lighting-stage.ts` | L304 | `MAX_STAGE_LIGHTS = 6` 硬编码在函数内，菜单层 `scene-stage-lights.ts:145` 注释同样知悉 6——跨文件魔法数值耦合，上限变更需两处同步 | 提升为 `lighting-state.ts`（或 lighting barrel）命名常量导出，两处引用同一符号 |
| 🟡 P3 | `frontend/src/scene/render/lighting-stage.ts` | L317-318 | 新灯默认排布 `posX = counter*2-2`、`orbitAzimuth = 180+(counter-1)*30` 为无注释魔法公式，与 `_readStageLightState` 的 orbit 反算（L440-443）自洽但无测试钉住"写入公式 ↔ 反算"一致性 | 提取命名常量（如 `STAGE_LIGHT_LAYOUT`），补一条「addStageLight 后 getStageLightState 反算 orbit 与写入公式互逆」的测试 |
| 🟡 P3 | `frontend/src/__tests__/lighting-stage.test.ts` | L212-242 vs `lighting.ts` L105-139 | mock 的 `defaultStageLightState` 是生产默认值的手工复制，存在漂移风险；测试 L611-615 "coneLength 默认值与 _defaultStageLightState 一致"实为 mock 内部自证（`lighting` 已被 mock），并未真正对比生产值 | 加一条契约测试：真实 import `_defaultStageLightState` 与 mock 形状逐字段对比（或注释声明由兄弟 NullEngine 测试兜底）；现有兜底但不显式 |
| 🟢 P4 | `frontend/src/scene/render/lighting-stage.ts` | L63/71/86 | `specular = new Color3(0.3, 0.3, 0.3)` 重复 3 处；L113/156 方向线长度 `(0,-2,0)`/`scaleInPlace(3)` 魔法值 | 提取模块级常量（`LIGHT_SPECULAR`/`DIR_LINE_LENGTH`） |
| 🟢 P4 | `frontend/src/scene/render/lighting-stage.ts` | L627 | `(n as unknown as { position: Vector3 }).position` 双重 cast（round-4 审 props 同款模式已标 P4）；adapter 回调参数类型契约 | 让 `TransformAdapter.onPositionDragEnd` 回调入参携带 position 类型，消除 cast |
| 🟢 P4 | `frontend/src/scene/render/lighting-stage.ts` | L385-390 | `loadStageLights` 对非 `light-N` id（如 'custom-light'）counter 归 0，后续 `addStageLight` 从 light-1 重新编号，极端存档（全自定义 id）下可能 id 重复；测试 L938-946 已钉住 counter=0 行为本身 | 记录为已知设计现状，或 counter 取 `max(0, 既有最大号)` 与自定义 id 无关 |
| 🟢 P4 | `frontend/src/__tests__/lighting-stage.test.ts` | L358 | `registerTransformAdapter.mock.calls[0][0]` 依赖"模块加载时恰好一次注册"隐式契约，未来若其他模块先注册 light kind 会取错 | 改用 `mock.calls.find((c) => (c[0].kinds as string[]).includes('light'))` |
| 🟢 P4 | `frontend/src/__tests__/lighting-stage.test.ts` | L402 等 | `lightingState.scene = {} as never` 及多处 stub `as never` 类型擦除偏宽（测试文件内可接受，有注释说明聚焦单模块未复用 scene-superset 工厂） | 可长期考虑统一 stub 工厂，非阻塞 |

## 测试质量评价

- **断言有效性**：强。67 用例绝大多数为字段级断言（`intensity`/`angle`/`range`/`diffuse.r/g/b`/`direction.y`/`alpha`/`scaling`/`disposed` 标志/`toHaveBeenCalledWith`），非烟雾测试；类型切换验证完整副作用链，光锥用例验证了创建/更新（geometry/transform/uniforms 三分支）/释放/抛错兜底四条路径。
- **mock 合理性**：深路径 mock + 真实 `lighting-state` 的设计意图清晰——共享状态对象与键集（SHADOW/CONE）真实参与判定逻辑，避免 mock 掉被测试逻辑本身；`vi.hoisted` 共享工厂避免 TDZ，符合 `frontend/AGENTS.md` 测试卫生铁律。
- **边界覆盖**：零向量守卫（创建/参数应用双路径）、scene null、triggerAutoSave null、skipLightAutoSave、6 盏上限、仅剩 1 盏拒绝删除、disabled 语义（不创建光锥/不写强度）、material 外部清理重建、原点 orbit 不崩溃、旧存档迁移逐字段——覆盖密度高。
- **跳过/聚焦**：无 `it.skip`/`describe.skip`/`xit`/`.only`（grep 确认）；`@vitest-environment node` 环境声明明确。
- **未覆盖边角（均低风险）**：类型切换时 gizmo 未激活/目标不匹配的负向分支；`_ensureStageCone` 的 entry 不存在分支（L554-557）；`_disposeStageCone` 幂等重复调用；`addStageLight` 默认 name 命名格式；同时设置 orbit+pos 的优先级。建议后续补足，不阻塞本次结论。

---

审核日期：2026-08-15
审核员：子代理 round42-lighting-stage
