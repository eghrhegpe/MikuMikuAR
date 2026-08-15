# [SSS PBR 材质本体] — 第 32 轮审核结果

**审核范围：**
- 测试文件：`frontend/src/__tests__/scene/sss-pbr-material.test.ts`（236 行，15 用例，无 skip）
- 被测源码：`frontend/src/scene/manager/sss-pbr-material.ts`（238 行，全模块）
  - 构造器 L37-43 / `isSssEnabled` L47-57 / `sssPower` L62-73 / `sssColor` L78-88 / `sssDistance` L93-104 / `sssDiffusion` L109-119 / `sssDiffusionProfile` L124-131 / `sssMinThickness` L136-150 / `sssMaxThickness` L153-167 / `_syncSubSurface` L176-203 / `dispose` L213-216 / `clone` L220-237
- 上游依赖核验：ADR-188（PBR 材质系统）、ADR-242（顶层分层公理，附带发现 P2）、ADR-245（Babylon 9.x 插件访问规范，本模块为落地文件之一）、知识卡 `docs/knowledge/sss-pbr-material.md`（tier: architecture，invariants 与实现一致）

**与 round-21 的关系与分工：**
- round-21 审 `material-sss.ts`（SSS **参数状态管理层**：`SssParams` 缓存/钳制/序列化/按分类 apply——「参数怎么存、怎么到材质」）；本模块是 **PBR 材质本体层**（`SssPBRMaterial` 包装类：setter → `PBRSubSurfaceConfiguration` 属性同步——「单个材质怎么表现 SSS」）。两层构成上下游，但**当前互不消费**：`material-sss.ts:6/136` 仅注释引用本类，`applySssToMaterial`（L139-181）实际直写 `mat.subSurface` 绕过包装层；本类生产零实例（见 P2）。round-21 报告的测试缺口①「材质侧传播断言在 scene/sss-pbr-material.test.ts 覆盖」——本次确认已覆盖（测试 L165-206），且 clone/失败路径比 round-21 评估时更完整（本文件含 3 处 `[fix P1/P2/P4]` 修复注释，均有用例锚定）。

**总体结论：** ⚠️ 有条件通过 —— 无 P1；1 项 P2（生产零消费/未接线，ADR-242 已跟踪），2 项 P3（双钳制区间不一致、同步契约断言子集），8 项 P4。测试 15/15 通过，`npm run check`（tsc + i18n parity）exit 0 全绿，项目基线无回归。

---

## 亮点

- **单一写入路径，无幽灵路径（状态流清晰）**：全部 6 个 SSS setter 与 clone 后同步统一收敛到 `_syncSubSurface()`（L176-203）→ `markDirty()`；`_sssEnabled/_sssPower/_sssColor/_sssDistance/_sssDiffusion` 私有字段写入点仅限各自 setter 与 clone（L228-235），grep 可全模块验证无旁路。
- **防御性输入治理到位**：`[fix P4]` NaN 守卫（L67/L98/L141/L158）拒绝 NaN/Infinity 污染 shader uniform；`[fix P1]` 构造器直读公开只读 `subSurface`（L42，ADR-245 落地），弃用 plugins 桥接；`equals` 相等短路（L82/L113）避免无谓 markDirty 重编译。
- **资源所有权正确**：`dispose`（L213-216）只置空本地引用、不 dispose 配置对象——`PBRSubSurfaceConfiguration` 归 `PBRBaseMaterial` 所有（构造时自动创建），`super.dispose` 统一释放，无二次释放/泄漏；clone 中 `_sssColor.clone()`/`_sssDiffusion.clone()`（L230/232）保证克隆体与源不共享 Color3 引用。
- **clone 修复有测试锚定（测试工程最佳实践）**：测试 L50-59 注释显式记录 mock 陷阱——mock 的 clone 必须是**原型方法**而非实例字段，否则实例字段遮蔽 `SssPBRMaterial.prototype.clone` 造成假绿；clone 用例（L209-224）断言 `toBeInstanceOf(SssPBRMaterial)` + 底层 subSurface 已同步，能抓住 `setPrototypeOf` 恢复（L224-227）的任何回归。
- **失败路径有测试**：无 subSurface 时 setter 静默跳过不抛错（测试 L188-196，锚定 ADR-245「失败可见性」契约——包装层状态仍更新，config 同步静默跳过），NaN 拒绝且不覆盖已有值（L198-205）。

---

## 风险

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|------|------|------|------|------|
| 🟠 P2 | `frontend/src/scene/manager/sss-pbr-material.ts` | L26（全模块） | **生产零消费（未接线特性）**：全仓 grep `SssPBRMaterial` 仅本模块、测试与 `material-sss.ts` 注释；PMX 加载走 babylon-mmd `PBRMaterialBuilder` 构建普通 `PBRMaterial`（material-proxy-resolver.ts:34），`applySssToMaterial` 也直写 `mat.subSurface` 绕过包装层。类功能完整且被 15 用例锚定，但接线前存在**双状态源隐患**：若未来 PMX 路径挂载本类，material-sss 直写 config 会让包装层私有字段与 config 脱同步，后续任一 setter 覆盖配置。ADR-242 附带发现 P2（L83）已判定「未接线特性、保留待接线」，非新发现，但截至本轮仍未接线。 | 按 ADR-242 决议（L106）：Phase 2 收编时二选一——(a) 接线：PBRMaterialBuilder 产出 `SssPBRMaterial`，`applySssToMaterial` 对 `instanceof SssPBRMaterial` 走 setter（消除双状态源）；(b) 降级：确定只走 config 直写则删类或改纯函数。落地时补「包装层与 material-sss 同时操作同一材质不脱同步」的集成测试。 |
| 🟡 P3 | `sss-pbr-material.ts:70` ↔ `material-sss.ts:86` | 钳制边界 | **sssPower 钳制区间双标**：本类钳 `[0,2]`（`Math.max(0.0, Math.min(2.0, value))`），material-sss 走 `clamp01` 钳 `[0,1]`，两处注释均写「0.1~1.5 常用」。UI 写入（model-material.ts:197 → setMatSssParams）与包装层 setter 对同一语义参数允许不同上限；接线后会出现「UI 设 1.2 截为 1.0、直调 setter 却可到 2.0」的漂移。 | 统一钳制源：上限收敛为一处常量（`[0,1]` 或 `[0,2]`），或本类复用 `@/core/clamp` 叶子并在 material-sss 侧引用同一常量；补「两处输入 1.5 结果一致」的契约测试。 |
| 🟡 P3 | `frontend/src/__tests__/scene/sss-pbr-material.test.ts` | L165-206 | **同步契约只断言子集**：`_syncSubSurface` 共写 8 个字段（L183-202），传播用例只断言 6 个字段，`useThicknessAsDepth`、`scatteringDiffusionProfile` 未断言；mock 配置对象为普通对象，未来 `_syncSubSurface` 若漏写这两字段，测试仍全绿。 | 传播用例补断言 `useThicknessAsDepth=true`（启用时）与散射剖面字段；或将传播断言改为 8 字段全量快照比对。 |
| 🟢 P4 | `sss-pbr-material.ts` | L227 | 类型逃生 `as unknown as SssPBRMaterial`（`setPrototypeOf` 返回 any 所致）。非 `as any`/`@ts-ignore`，满足 playbook「0 处新增 as any/@ts-ignore」，但仍是类型断言。 | 可接受取舍（现有注释已说明业务理由）；若想再收紧可封装 `cloneWithProto` 小工具。 |
| 🟢 P4 | `sss-pbr-material.ts` | L127-131 | `sssDiffusionProfile` setter 无相等短路、无克隆：重复赋值同一对象反复 `_syncSubSurface`+`markDirty`；引用共享使外部改色绕过 setter 影响 config 且不触发重编译，与 `sssColor`/`sssDiffusion` 克隆语义不一致。 | 对齐其他 setter：`if (this._sssDiffusionProfile === value) return;` 并按需克隆。 |
| 🟢 P4 | `sss-pbr-material.ts` | L139-167 | `sssMin/MaxThickness` 无测试覆盖（round-21 已注，本文件仍未补）；setter 不保证 `min < max` 关系（min 设 0.9、max 设 0.5 可进入无效状态）；`Math.max(0.001, value)` 魔法值。 | 补厚度 setter 测试 + min<max 约束（或文档明示 Babylon 侧容错）；0.001 提为命名常量。 |
| 🟢 P4 | `sss-pbr-material.ts` | L28-32/L70/L101 | 魔法数值：默认 `sssPower=0.0`/`sssDistance=0.5`/白色 Color3、钳制边界 `[0,2]`/`[0,1]` 均内联无常量名，与 material-sss 的 `DEFAULT_SSS_PARAMS`（0/0.5/白，当前一致）重复但无共享。 | 提取 SSS 默认参数/边界常量，或直接复用 `DEFAULT_SSS_PARAMS`（需处理两模块钳制区间不一致问题，见 P3）。 |
| 🟢 P4 | `sss-pbr-material.ts` | L183-187 | `isTranslucencyEnabled = _sssEnabled && _sssPower > 0` 与 `translucencyIntensity = _sssEnabled ? _sssPower : 0` 耦合「开关+强度」：`_sssEnabled=true` 且 `_sssPower=0`（默认值）时启用开关为 false；测试只覆盖 power>0 的启用路径，未覆盖此分支。 | 若语义为「开=仅使能、强度独立」，补 0 强度分支测试与文档；否则拆开两个布尔。 |
| 🟢 P4 | `frontend/src/__tests__/scene/sss-pbr-material.test.ts` | L167/177/189 | 测试侧 3 处 `as any`：L189 访问私有 `_subSurface` 必须逃生；L167/177 若安装版 d.ts 已含公开 `readonly subSurface`（ADR-245 引 pbrBaseMaterial.pure.d.ts:787）则 `mat.subSurface` 可直接取，逃生可省。与同域 material-sss.state.test.ts 的 `@ts-nocheck` 风格不一致。 | L167/177 尝试去掉 `as any` 直取 `mat.subSurface`；若 d.ts 确缺类型则保留并注释理由。 |
| 🟢 P4 | `frontend/src/__tests__/scene/sss-pbr-material.test.ts` | L23-34 ↔ L70-81 | mock 中 `PBRSubSurfaceConfiguration` 形状重复定义两处（`makeSubSurface` 与 `mockImplementation`），字段增删需同步两处，易漂移。 | 提取单一共享工厂函数（如 `makeSubSurface()`）两处调用。 |
| 🟢 P4 | `frontend/src/__tests__/scene/sss-pbr-material.test.ts` | L227-235 | dispose 幂等用例只验证包装层不抛错（`super.dispose` 为 vi.fn no-op），未验证真实 Babylon `Material.dispose` 二次调用行为——「幂等」结论依赖 Babylon 内部实现，mock 下为弱断言。 | 注明断言边界（包装层幂等，基类行为由 Babylon 保证），或对真实 PBRMaterial 做一次集成级验证。 |
| 🟢 P4 | `frontend/src/__tests__/scene/sss-pbr-material.test.ts` | — | 覆盖缺口：`sssDistance` NaN、Infinity（非 NaN）、`sssColor` 相等短路 no-op、`isSssEnabled=false` 复位路径（config 归零）、`markDirty` 被调用的断言、clone 携带 `cloneTexturesOnlyOnce/rootUrl` 参数、`dispose(forceExhaustive)` 均未覆盖。 | 按价值补：`isSssEnabled=false` 复位 + `markDirty` 调用断言最有价值（锚定状态流副作用与重编译触发）。 |

---

## 测试质量评价

- **有效性与断言真实性**：15 用例全绿（56ms，无 skip/it.skip）。传播用例（L165-206）断言真实触达 mock 配置对象的字段（`isTranslucencyEnabled`/`translucencyIntensity`/`tintColor`/`tintColorAtDistance`/`diffusionDistance`），证明 SSS 参数**不是**只改包装层私有字段——这正是 round-11/ADR-245 的假绿教训，本测试已根治。
- **mock 工程细节**：四层 mock（Scene/Engine/PBRMaterial/PBRSubSurfaceConfiguration）+ `vi.hoisted` 正确规避 vi.mock 工厂 TDZ；`MockPBR.clone` 为原型方法并附修复注释（L50-59），是防「实例字段遮蔽真实 clone」的教科书级处理；`mockScene` 单例在各用例间无状态交叉（`clearAllMocks` 重置）。mock 形状与 `_syncSubSurface` 实际写入的 8 字段对齐。
- **边界覆盖**：NaN 拒绝（L198-205，含「已有值不被 NaN 覆盖」）、无 subSurface 静默跳过（L188-196）、双端钳制（L116-135）、克隆后底层同步（L209-224）——非法输入与失败路径均有锚定，优于同域多数测试。
- **覆盖缺口**：见风险表 P4 行——以 `isSssEnabled=false` 复位、厚度 setter、`markDirty` 断言为主；传播断言未覆盖 `useThicknessAsDepth`/`scatteringDiffusionProfile`（P3）。
- **验证记录**：`npm run test -- src/__tests__/scene/sss-pbr-material.test.ts` → 15/15 通过（Duration 1.65s，tests 56ms）；`npm run check`（tsc + i18n parity）→ exit 0 全绿。项目基线无回归。

---

审核日期：2026-08-15
审核员：子代理 round32-sss-pbr-material
