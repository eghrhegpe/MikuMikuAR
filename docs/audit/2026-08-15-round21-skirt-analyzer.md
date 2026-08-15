# 审核报告：skirt-analyzer 裙摆拓扑分析（analyzeSkirt）

**审核范围：**
- 测试文件：`frontend/src/__tests__/skirt-analyzer.test.ts`（488 行，27 用例，8 个 describe 组）
- 被测源码：`frontend/src/scene/physics/skirt-analyzer.ts` 全量（513 行）：
  - `analyzeSkirt`（156–513）：参数解析/clamp → 输入校验 → 已有裙骨检测 → 包围盒 → edge→triangle 映射 → boundary edge 连通分量（Union-Find，88–132）→ P2a 多底环防误判 → BFS 裙摆区域扩展 → 角度聚类分链 → Y 分层骨节 → 全局最近 2 骨节距离反比权重
  - `SkirtAnalyzerOptions`（55–66）、`SkirtSegment`/`SkirtChain`/`SkirtAnalysisResult`（24–53）、`SKIRT_BONE_PATTERN`（73）、常量（76–82）
- 关联核实：`frontend/src/core/clamp.ts:10-12`（clampInt 语义）、`virtual-skirt.ts:271-284`（唯一消费者，仅消费 `hasExistingSkirtBones`/`totalSegments`）、`docs/adr/adr-084-mesh-to-cloth-virtual-skirt-bones.md:465`（P2a 修复记录）、`docs/knowledge/skirt-analyzer.md`（不变量声明）

**总体结论：⚠️ 有条件通过**

测试 27/27 绿（`npm run test -- src/__tests__/skirt-analyzer.test.ts`，1.66s，Vitest 4.1.9），无跳过用例。合成 mesh 生成器正确且自校验（封闭球 0 boundary edge 反证生成器闭合性），P2a 防穿裤误判测试钉死 ADR-084 修复，权重和/骨节 Y 单调/参数 clamp 断言均指向真实构造不变量。无 P1。1 条 P2：**索引越界值未防御**——`% 3` 守卫只拦残缺数组，拦不住「长度合法但索引值越界」（含 Int32Array 负值转 Uint32 回绕）导致的 NaN 静默污染，与知识卡「杜绝 NaN 污染」声明不符且无测试钉死。3 条 P3（y-threshold 死代码、BFS 区域上限硬编码 0.35、collisionRadius 推算魔法数值）。`npm run check`（tsc 全量）按任务约定跳过——单文件测试已验证，本报告注明。

---

## 亮点

- **P2a 防穿裤误判守卫带回归测试闭环**（skirt-analyzer.ts:285–305 + 测试 160–183）：先收集全部「底部」连通分量（Y 均值 ≤ 阈值且规模达标），≥2 个分离底环（左右腿洞）→ 判定非裙摆安全跳过，直接落实 ADR-084 P2a 修复（adr-084:465）。测试用 `createPantsMesh`（118–148）构造双分离腿柱，并配「单腿应识别/双腿应跳过」对照用例（171–182）验证守卫方向性——是本文件最有价值的回归测试。
- **P3d 全局顶点映射消除链间缝隙**（skirt-analyzer.ts:413–414、460、466–501）：所有骨节跨链收集到 `allSegments`，第 9 步对每个裙摆顶点取全局最近 2 骨节、距离反比归一权重。测试「权重和为 1」（239–256）跨链聚合逐顶点断言 `toBeCloseTo(1.0, 2)`，直接验证构造不变量（每顶点恰映射 2 个骨节、权重归一），非空转断言。
- **残缺网格守卫覆盖多类非法输入**（skirt-analyzer.ts:192–199）：位置/索引长度非 3 倍数、顶点 <3、无三角形四类守卫合一返回空结果，杜绝 NaN 传播；测试 305–362 六条退化用例全覆盖（空输入/顶点不足/无三角形/闭合球/残缺三角形/残缺顶点），闭合球用例（326–332）同时反证 `createSphere` 生成器拓扑闭合性。
- **参数 clamp 双向验证**（skirt-analyzer.ts:171–177 + 测试 366–393）：`chains` 走共享叶子 `@/core/clamp` 的 `clampInt`（core/clamp.ts:10–12，ADR-190/191 收敛成果），测试断言 1→4、100→32、segmentsPerChain 1→4 的上下限双向钳制；`skirtYRatio` 影响裙摆区域大小的用例（395–410）验证阈值语义方向性。
- **纯函数模块、零资源与并发负担**：无 `new` 外部对象/Babylon 依赖（头注释 1–16 声明纯几何），无 Observer/定时器/全局状态，天然并发安全；类型安全达标——全文件 grep `as any`/`@ts-ignore`/`@ts-expect-error` 零命中（`adjacency.get(a)!` 为合法非空断言）。
- **多语言裙骨名检测**（skirt-analyzer.ts:73、202–207 + 测试 260–301）：`/skirt|裾|スカート|sukato/i` 正则一次覆盖英/中/日，三语用例 + 无裙骨对照用例（292–301）验证「命中即跳过、未命中正常分析」双向行为。

---

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟠 P2 | `scene/physics/skirt-analyzer.ts` | 192–199（守卫）、247–258（索引读取）、295/356/380/443/471（越界读点） | **索引越界值未防御，可静默产出 NaN 垃圾链**：`% 3`/长度守卫只拦「残缺数组」，拦不住「长度合法但索引值越界」——如 7 顶点 mesh 中 `indices=[0,1,9999]`，或 `Int32Array` 负值经 184–185 行 `new Uint32Array(...)` 回绕成 0xFFFFFFFF。typed array 越界读返回 `undefined` → 算术得 NaN → hem avgY 为 NaN 的连通分量被 `NaN <= 阈值` 静默过滤（误判「无底部环」），或 OOB 顶点混入 BFS 后污染质心/角度/restPosition，产出含 NaN 的链。`virtual-skirt.ts:282-284` 只按 `totalSegments > 0` 消费，NaN 链会被直接注入物理。**知识卡 `docs/knowledge/skirt-analyzer.md:22` 声称「越界读 / NaN 传播…杜绝 NaN 污染结果」与代码实际能力不符（声明夸大）**；测试 305–362 的退化用例均为长度维度，无索引值越界用例。 | 守卫区（192 行前）增补：`for` 扫描 `idxArr` 取 `maxIndex`，`maxIndex >= vertexCount` 或索引为负即返回 `empty`（O(n) 一次）；可选同时拒绝 positions 含 NaN/Infinity（`Number.isFinite` 扫描，命中返回 `empty`）。同步修知识卡不变量表述，补「索引越界 → 返回空」与「Int32Array 负值」两条回归用例。 |
| 🟡 P3 | `scene/physics/skirt-analyzer.ts` | 50、313、366–368、309/315 | **`method: 'y-threshold'` 为不可达死类型成员**：ADR-084 P2a 修复已将原 y-threshold fallback（收集全部 Y≤阈值 顶点）移除，改为无底部环时 fail-fast 返回空（366–368 注释明言）；但 `SkirtAnalysisResult.method` 联合类型（50）、局部变量类型（313）仍声明 `'y-threshold'`，实际只可能产出 `'boundary-edge'` 或 `'none'`（365 行赋值 + empty）。309 行 `hemAvgY = hemComponent ? skirtYThreshold : Infinity` 与 315 行 `hemAvgY <= skirtYThreshold` 是同源残留（hemComponent 非空时恒真，条件冗余）。公开 API 类型误导消费者分支；已核实当前消费者（virtual-skirt.ts）不读 method 字段，仅测试断言 'boundary-edge'/'none'。 | 从联合类型移除 `'y-threshold'`（或按 ADR-084 恢复该 fallback 并补测试）；同步清理 309/315 冗余条件。若保留扩展空间，加注释说明「y-threshold fallback 已被 P2a 修复移除（ADR-084）」。 |
| 🟡 P3 | `scene/physics/skirt-analyzer.ts` | 341 | **BFS 裙摆区域上限硬编码 0.35**：`hemAvgY + modelHeight * 0.35` 是与 `skirtYRatio` 平行的行为级启发式（决定裙摆区顶点范围/骨节分布），却不可通过 options 配置、无常量名。测试 334–341「极小 mesh」注释依赖该值推演（3 顶点 < MIN_SKIRT_VERTICES），与 0.35 隐式耦合——常量漂移会使测试断言静默失效。 | 提取命名常量（如 `HEM_REGION_RATIO = 0.35`）或并入 options（如 `skirtBfsRatio`），补一条「区域上限随高度变化」的显式断言，解除测试与魔数的隐式耦合。 |
| 🟡 P3 | `scene/physics/skirt-analyzer.ts` | 242 | **collisionRadius 推算魔法数值**：`Math.max(modelWidth * 0.015, 0.01)` 两个硬编码常数决定默认碰撞球半径（测试 426–435 只断言 `> 0`，未钉死推算语义）。 | 提取命名常量并注释物理依据（如 `COLLISION_RADIUS_RATIO = 0.015`、`MIN_COLLISION_RADIUS = 0.01`）；如需稳定契约可断言推算值 = `max(modelWidth*0.015, 0.01)`。 |
| 🟢 P4 | `scene/physics/skirt-analyzer.ts` | 246–258 vs 319–337 | **三角形三边遍历重复两次**：edge→triangle 计数循环与 adjacency 构建循环遍历相同边结构（`[[i0,i1],[i1,i2],[i2,i0]] as const`），大 mesh 下双倍遍历开销，且两处逻辑易漂移。 | 合并为单次遍历：同时维护 `Map<edgeKey, count>` 与 `Map<v, Set<邻接>>`。 |
| 🟢 P4 | `scene/physics/skirt-analyzer.ts` | 342–343 | **BFS 用 `queue.shift()`**：数组头移 O(n)，数千顶点裙摆下 BFS 退化为 O(n²)（一次性分析可接受，但属可免开销）。 | 改用索引指针队列（`head` 游标）O(n)。 |
| 🟢 P4 | `scene/physics/skirt-analyzer.ts` | 177、239、241、357、489 | **魔法数值散布**：`skirtYRatio` clamp 下限 0.1/上限 1.0 内联（177，与 chains/segmentsPerChain 走 clampInt 风格不一致且 interface 未声明范围）；`1e-6`（239/241）与 `0.001`（357 BFS 容差）、`1e-6`（489 距离下限）多 epsilon 字面量无命名。 | 命名常量 + interface 注释声明 skirtYRatio 范围；epsilon 统一为语义常量（如 `Y_EPSILON`/`DIST_EPSILON`）。 |

---

## 测试质量评价

- **断言有效性**：✅ 有效，指向真实构造不变量。「权重和为 1」（239–256）跨链聚合逐顶点断言，验证第 9 步归一构造本身；「骨节 Y 坐标递增」（212–223）验证 Y 分层排序语义；「chains clamp 双向」（366–381）验证 1→4/100→32 上下限；「角度分链」（438–469）用每链质心角差验证聚类方向性。「P2a 防误判」双用例（160–182）是定向回归：单腿（单底环）生成链 vs 裤子（双底环）跳过，断言与 ADR-084 修复语义一一对应。
- **合成 mesh 生成器健壮性**：✅ 优秀。`createOpenBottomCylinder`（19–56）顶盖 fan 封顶（中心边成对出现 → 顶环无 boundary），底部开口产生边界边——经拓扑推演与 27/27 测试互证正确；`createSphere`（59–112）南北极 fan + 中间四边形环，闭合性由「封闭球 boundaryEdgeCount=0」用例（326–332）反证；`createPantsMesh`（118–148）索引 rebase（143–145）与 X 平移正确，构造双分离底环。
- **边界覆盖**：空输入/顶点 <3/无三角形/闭合球/残缺三角形/残缺顶点/极小 mesh/多底环 ✅（305–362）；参数 clamp、skirtYRatio 方向性、collisionRadius 传递 ✅。**缺口**：① 索引值越界与 NaN positions 输入（P2，无用例且当前代码不防御）；② `method:'y-threshold'` 分支无覆盖（P3，代码侧已死）；③ 非流形 mesh（3 面共边，edgeCount≥3）与多孔（hem 之外有第二个开口环但高于阈值）无用例；④ 骨名匹配大小写（正则含 `/i`）无用例；⑤ `skirtYRatio` 越界值（负值/超 1 的 clamp）无用例。
- **隔离与卫生**：✅ `@vitest-environment node` 分流合理（纯函数无 DOM）；无 window mock/无共享状态污染（frontend/AGENTS.md 测试卫生铁律零触及）；无 `it.skip`/`describe.skip`/`xit`。
- **小瑕疵**：「角度分链」断言较弱（仅 `uniqueAngles.size > 1`，438–468）；「极小 mesh」断言依赖对 0.35 常量的隐式推演（334–341，见 P3-3）；「已有裙骨」用例未断言 `boundaryEdgeCount` 等诊断字段的返回形状（260–301，均走 `{...empty}` 分支）。

---

审核日期：2026-08-15
审核员：子代理 round21-skirt-analyzer
