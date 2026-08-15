# Round 47 — 统一平面反射引擎互斥测试审核（planar-reflection）

> **审核对象**：`frontend/src/__tests__/scene/planar-reflection.test.ts`（201 行，9 用例）
> **被测源码**：`frontend/src/scene/env/planar-reflection.ts`（337 行，PlanarReflection 统一引擎 + 模块级互斥协调器）
> **关联消费方**：`env-ground.ts:634-734`（ground 面，mirrorTexture 模式）、`env-water-reflect.ts:1-91`（water 面，screenSpace 模式）、`env-impl.ts:197-234`（dispose 编排）
> **审核日期**：2026-08-15　**审核员**：子代理 round47-planar-reflection

## 0. 与前序审计的关系（按任务要求核实）

| 前序审计 | 结论 | 与本测试/源码的关系 |
|---------|------|--------------------|
| round-9-mirror-reflection.md（2026-07-12） | ⚠️ 有条件通过，判「互斥策略正确」 | 其「互斥守卫 ✅」判定被 ground-logical-audit 修正；其 P2（水面 BFC 恢复缺失、renderList 每帧重建）已被统一引擎吸收（BFC 存取 + renderList 脏标记，planar-reflection.ts:116-119/234-249） |
| ground-reflection-logical-audit.md（2026-07-12） | C1 🟠「互斥守卫死代码」（applyGround 先清零 `planarReflectBlend` 再读守卫 → 守卫恒假） | **C1 已修**：落地记录（:178）改为无条件 `disableWaterReflection()`，且 ADR-092 将仲裁整体重构为 `requestExclusive/releaseExclusive + _mutexDisabled` 显式协调器，**根除「读已清零状态」类死守卫**。新引擎中的 `_mutexDisabled` 守卫（planar-reflection.ts:149-151）是**活代码**（见 §3），但**未被本测试锁住**（见 §5） |
| ADP-151 / ADR-151（反射系统统一） | ✅ `getPlanarQualityOverride` 已接入 | 本引擎 `getQuality` 回调（env-ground.ts:641-659 / env-water-reflect.ts:24-42）消费 ADR-151 的 reflectionMode 全局覆盖（none→强关、planar→拔高到 low）；本测试用纯桩配置绕过该链路，未覆盖 ADR-151 分支 |
| ADR-092（统一平面反射引擎） | ✅ 已采纳 | 本引擎即 ADR-092 §2.2 的落地；测试文件头注释即声明 ADR-092 |

**遗留结论**：C1 死代码已修；新互斥守卫为活代码但缺回归锁——「互斥守卫类缺陷」未形成测试闭环（详见 §5 与风险表 R1）。

## 1. 总体结论

**⚠️ 有条件通过**

- 生产源码健康度良好：C1 已修、互斥仲裁结构清晰（模块级单写协调器）、资源释放完整、无 `as any`/`@ts-ignore`；测试 9/9 通过（实测 `npm run test -- src/__tests__/scene/planar-reflection.test.ts`，25ms 全绿）。
- 条件：① 互斥守卫（`_mutexDisabled` 阻断重建）无任何测试锁定——守卫被删 9 用例全绿；② mirrorTexture（地面）分支在本测试文件中零覆盖（9 用例全走默认 screenSpace）；③ 一处设计意图与实现不符（水面 onDisable 注释声称「blend=0 保留 RT」，实际 blend=0 即销毁 RT）。
- 风险分布：P1 0 项、P2 0 项、P3 4 项、P4 6 项。

## 2. 亮点

- **互斥仲裁单写点**：`_activeEngine` + `requestExclusive/releaseExclusive`（planar-reflection.ts:70-109）集中裁决「水面 vs 地面」，表面实例只通过 `create()/disable()` 触发，无散落状态写入；`_mutexDisabled` 标志防止败者自我复活造成抖动（:149-151），该设计根除旧 env-impl「读已清零状态」类死守卫（C1）。
- **资源生命周期闭环**：`disable()` 依次 移出 `customRenderTargets` → `mount(null)` 清材质引用 → `setBlend(0)` 清零强度 → **先恢复 BFC 再 dispose RT**（:311-319，P3-fix 防材质残留单面）→ 释放镜像相机；`bfcMap.clear()` 兜底（:323）。
- **可恢复互斥可测性**：`resetReflectionSurfaces()`（:82-85）显式暴露测试重置入口，beforeEach 调用保证用例间协调器状态隔离（test:62）——互斥协调器是模块级单例，无此重置测试将互相污染。
- **渲染健壮性**：`rt.render()` 包 try/catch + logWarn（:205-209，对应 D1 修复）；水面入水跳过（:187-192）、镜像相机矩阵冻结复用 env-type-helpers 集中类型逃生（:196-199，FrozenCamera 单一断言点）。
- **测试用真实 Babylon 实例**：NullEngine + 真 Scene + 真 FreeCamera（test:57-68），未 vi.mock 被测模块——互斥协调器、RT 创建/dispose 均为真实路径；`registerReflectionSurface` 的 onReleased 用闭包重放 update 模拟「关地即开水」（test:98-99/118-119），恢复路径被 spy 断言锁住（test:131-142）。

## 3. 关于「C1 死代码是否已修」的判定（核实结论）

1. **旧 C1（读已清零状态）已修**：ADR-092 重构后仲裁不读任何 envState 字段，`requestExclusive/releaseExclusive` 以显式标志驱动（:87-109），旧守卫模式（`if (envState.planarReflectBlend > 0)`）已不存在。ground-logical-audit 落地记录 :178 亦确认。
2. **新守卫是活代码**：`update()` 中 `!this.rt && this._mutexDisabled → return`（:149-151）在生产中可达——当水面被地面抢占后，用户再改任一水面参数（waterLevel/预设等）触发 `_setupMirrorRT → waterReflection.update`（env-water.ts:88/139），守卫拦截使水面保持关闭；无守卫则水面立即重建 RT 并反抢地面，形成逐帧抖动。**结论：非死代码，且是防抖动的必要逻辑。**

## 4. 测试质量评价

### 4.1 断言有效性
- **互斥语义基本验证为真**：双向断言（A 活跃时 B 关、B 活跃时 A 关，test:102-109/126-128）直接打在协调器行为上；恢复用例用 spy 锁「releaseExclusive → onReleased → 败者 update 重建」链路（test:131-140），**隐含锁住了 `_mutexDisabled` 的清零**（若未清零，恢复后的 A.update 会被守卫拦截，isEnabled 保持 false，用例失败）。
- **缺陷：守卫的阻断行为无锁**（R1）。所有用例只断言仲裁结果，从不「在败者被标记后再次驱动其 update()」。守卫（:149-151）若被删除，9 个用例全部仍然通过——C1 类「互斥守卫失效」没有回归护栏。
- **「setBlend 写入 reflectionTexture.level」断言 tautology**（test:166-191）：`mockReflectionTex.level` 由 spy 自己写入（test:174-177），断言的是 spy 的副作用而非引擎行为；真正断言引擎的只有 `setBlendSpy toHaveBeenCalledWith(0.6)`（前两个用例已覆盖）。

### 4.2 mock 合理性
- 合理：真实 NullEngine/Scene/FreeCamera + 注入式配置回调；未 mock 被测模块（对比 water-preset-repro.test.ts:51 对 PlanarReflection 的整类 mock，本测试走真实路径，价值更高）。
- 瑕疵：`makeState` 以 `as EnvState` 部分桩（test:20-29），EnvState 为 schema 映射全必填类型，缺字段被断言掩盖——schema 增字段不暴露；`makeConfig` 桩中 `getMirrorCameraMatrix: () => null` 使镜像矩阵冻结路径（:193-200）从未执行。

### 4.3 边界覆盖
- 已覆盖：quality=off 禁用、blend=0 禁用、互斥切换、可恢复互斥、重复 update 稳定性（test:144-146）、blend 透传与变化、dispose 后 isEnabled=false。
- 未覆盖（本文件职责内缺口）：① 守卫阻断行为（R1）；② mirrorTexture（地面）模式整分支——mirrorPlane 刷新、refreshRate、mipmap、自动渲染路径 0 覆盖；③ `skipWhenUnderwater` 入水跳过（:187-192）；④ FRAME_SKIP 帧门控（:171-174）；⑤ renderList 脏标记（mesh 数/面高变化重 populate，:162-168）；⑥ BFC 存取（:234-249）；⑦ 重复 disable 幂等、dispose 后 dispose、抢占后败者 RT 是否真正销毁（仅断言 isEnabled，未断言 `scene.customRenderTargets` 无残留 RT）。
- 跳过测试：无 `.skip/.todo`。

### 4.4 实测
`cd frontend && npm run test -- src/__tests__/scene/planar-reflection.test.ts` → **9 passed (9)，25ms**，基线全绿。

## 5. 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|---------|
| 🟠 P2 | — | — | 无（P2 及以上未发现） | — |
| 🟡 P3 | frontend/src/__tests__/scene/planar-reflection.test.ts | 92-147（互斥/恢复用例） | 互斥守卫 `_mutexDisabled` 阻断重建的行为（planar-reflection.ts:149-151）无任何测试锁定：守卫被删 9 用例全绿，C1 类「互斥守卫失效」无回归护栏 | 补用例：B 抢占后调 `refA.update(state, scene)`，断言 `isEnabled` 仍为 false 且 `scene.customRenderTargets` 未新增 RT；再补「A/B 交替 update 无抖动」用例 |
| 🟡 P3 | frontend/src/scene/env/planar-reflection.ts | 87-109 + 139-152 | 互斥协调存在重入：`B.update→create→requestExclusive→A.disable→releaseExclusive→B.onReleased→B.update`（嵌套）；偷取路径同帧 update 执行两次（frameCount 双增、setBlend 双写、screenSpace 可能双 render）。当前幂等无碍，但无重入守卫，异常路径下 `_activeEngine` 可能中途置空 | 加 `_updating` 重入标志或在协调器回调前断言状态；至少注释说明重入合法 |
| 🟡 P3 | frontend/src/scene/env/planar-reflection.ts | 251-255 vs 171-173 | mirrorTexture 模式 `rt.refreshRate = skip+1` 仅在 create() 设置；quality high→low 变化不重建 RT 时 refreshRate 仍为 1（每帧），帧跳过意图失效（screenSpace 每帧重算 skip 无此问题）；分辨率同样不随 quality 变化 | update() 中检测 quality 变化时同步 `rt.refreshRate`（或记录 `lastQuality`） |
| 🟡 P3 | frontend/src/scene/env/env-water-reflect.ts | 79-82（onDisable 注释） | 注释声明「blend=0 时保留 RT 不销毁、仅 quality=off 才销毁」，但引擎 `disable()` 无参数、blend=0 即走 `shouldEnable=false → disable()` 销毁 RT（planar-reflection.ts:143-146）。设计意图与实现不符：blend 滑杆拖到 0 再回正会重建 2048 RT（卡顿/闪烁） | 二选一：引擎增加「轻停用」（保留 RT 仅卸载材质）路径，或修正注释使意图与实现一致 |
| 🟡 P3 | frontend/src/scene/env/planar-reflection.ts | 96-109 + 334-336 | `dispose()` → `releaseExclusive` → 对方 `onReleased` 复活（在拆毁/重初始化期间于垂死 scene 上重建 RT 并 push customRenderTargets）。全量 teardown 下自愈（随后另一面 dispose 再清），但存在瞬态浪费与垂死 scene 上渲染的隐患 | 提供协调器级 teardown（生产版 `resetReflectionSurfaces` 或 shutdown 标志），或在文档注明「两 surface 必须同批 dispose」 |
| 🟢 P4 | frontend/src/scene/env/planar-reflection.ts | 311-318 vs 242-249 | disable() 内联 BFC 恢复与 create() 的 `bfcRestore` 逻辑重复（同模式两处实现） | 抽取共用 `restoreBfc(rt)` 复用 |
| 🟢 P4 | frontend/src/scene/env/planar-reflection.ts | 90 | `(_activeEngine as PlanarReflection & { _mutexDisabled: boolean })` 断言冗余——字段已在类上公开声明（:123） | 删除交集断言，直接访问 |
| 🟢 P4 | frontend/src/scene/env/planar-reflection.ts | 208 | catch 路径 logWarn 未节流：screenSpace 每帧 render，若 renderList 中 mesh 被 dispose 等持续性异常，每帧刷日志，与 ADR-248 热路径节流精神不符 | 帧节流或仅首次告警（如 `% 60`） |
| 🟢 P4 | frontend/src/scene/env/planar-reflection.ts | 154-156, 228 | 创建失败静默 return（注释「理论上不会」）；`?? 256` 兜底分辨率魔法值 | 失败时一次性 logWarn；将 256 提为常量并注释来源 |
| 🟢 P4 | frontend/src/__tests__/scene/planar-reflection.test.ts | 20-29, 181-183 | 测试侧 `as any` 4 处（`mockMat as any`/`rt: any`）；`as EnvState` 部分桩掩盖 schema 新增字段 | 用 `Partial<EnvState>` + 默认值填充工厂；`as any` 处改最小化类型桩 |

## 6. 代码健康度 9 维度速查

| 维度 | 结论 |
|------|------|
| 类型安全 | ✅ 生产 0 处 `as any`/`@ts-ignore`；仅 2 处类型逃生（:90 冗余断言、:196 FrozenCamera 集中封装） |
| 资源释放 | ✅ RT/相机/observables/BFC Map 全部 dispose 配对；customRenderTargets 移除、材质引用置空、BFC 先恢复后 dispose |
| 异常处理 | ✅ render 有 try/catch；⚠️ 创建失败静默、catch 日志未节流（P4） |
| 状态流 | ✅ 互斥仲裁单写点（协调器）；isEnabled 单源；⚠️ 重入路径无守卫（P3） |
| 职责单一 | ✅ 引擎（RT/BFC/脏标记/帧跳过）+ 配置回调（表面差异）分离清晰 |
| 并发安全 | ⚠️ 无异步，但 onReleased 重入无防抖（P3）；偷取路径同帧双 update |
| 重复代码 | 🟢 BFC 恢复两处重复（P4）；两模式 observable 注册模式重复（可hoist） |
| 循环依赖 | ✅ 叶子模块，仅依赖 _shared/core；env-ground/env-water 单向依赖引擎 |
| 魔法数值 | 🟢 FRAME_SKIP 已常量；兜底 256 未常量（P4）；maxZ=5000 有注释 |

## 7. 审核结论

**⚠️ 有条件通过**。生产引擎健康度良好、C1 死代码已修且新互斥守卫为活代码；测试 9/9 全绿、互斥/恢复主链路断言有效。放行条件：① 补「守卫阻断」用例锁定互斥守卫行为（C1 类回归护栏）；② 补 mirrorTexture 分支或至少注明覆盖缺口；③ 修正 env-water-reflect onDisable 注释与引擎行为的不一致。建议 2 周内处理 4 项 P3，P4 随重构顺手清理。

---
*审核日期：2026-08-15　审核员：子代理 round47-planar-reflection*
