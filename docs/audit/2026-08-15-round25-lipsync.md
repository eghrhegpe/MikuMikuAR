# round-25 lipsync 纯算法层审核报告

## 审核范围

| 项 | 内容 |
|----|------|
| 测试文件 | `frontend/src/__tests__/lipsync.test.ts`（234 行，42 用例） |
| 被测源码 | `frontend/src/motion-algos/lipsync.ts`（96 行：`DEFAULT_LIPSYNC_STATE` L17-22 / `findLipMorph` L31-39 / `findAllLipMorphs` L61-69 / `amplitudeToWeight` L77-95） |
| 依赖模块 | `frontend/src/core/clamp.ts`（仅 `clamp01`，零依赖叶子，ADR-190/191 合规） |
| 验证方式 | `cd frontend && npm run test -- src/__tests__/lipsync.test.ts` → **42/42 通过**（47ms）；`npm run check`（全项目 tsc）未执行——本轮零代码改动，类型基线不受影响，按任务允许跳过 |

**历史关系**：round-6 审过 lipsync.ts（旧路径 `scene/motion/lipsync.ts`，90 行）✅；round-12 审过 lipsync-bridge ✅；round-15 审过 `motion-algos/lipsync.ts`（含多口型扩展后 96 行）✅。本文件自 round-6 后已从 scene/motion 迁至 motion-algos 纯算法层，并新增 `findAllLipMorphs` / `LipSyncMorphSet` / `multiMorphEnabled` 多口型扩展。**遗留问题**：round-15 指出的知识卡滞后（lipsync-bridge.md 未提及 `multiMorphEnabled` / `findAllLipMorphs` / `LipSyncMorphSet`）经本次 grep 核实**仍存在**，见风险表 P4#4。

## 总体结论：✅ 通过

纯函数模块，类型安全零逃生，异常守卫完备，测试 42 例全绿且断言可独立推导验证。无 P1/P2 风险；1 项 P3（同文件列表重复）+ 3 项 P4（低危观察/文档滞后）。

## 亮点

- **显式数值守卫杜绝 NaN 传播**：`amplitudeToWeight` L83 对三个参数统一守卫（amplitude NaN / sensitivity NaN / intensity 非有限 → 返回 0），配合 `clamp01` 保证 morph 权重永远落在 `[0, intensity]`，不污染渲染层（lipsync.ts:83-95）。
- **sensitivity=1 死区边界显式处理**：`range <= 0` 时仅振幅满（`>= 1.0`）才张嘴，避免「口型常开」病态，且测试同步锁定该边界（lipsync.ts:90-93 ↔ lipsync.test.ts:167-170）。
- **候选列表按优先级降序单一定义**：`LIP_MORPH_CANDIDATES`（L26）与 `MOUTH_MORPHS`（L44-49）以「あ→ア→A→a→口→mouth→open」顺序编码 MMD 模型命名惯例，`findLipMorph` / `findAllLipMorphs` 复用同一优先级语义，精确匹配 + `Set` 去重语义清晰。
- **消费端集成一致且不重复扫描**：`perception-lipsync.ts:155-158` 将查找结果缓存于 per-model runtime，仅在首次或 morph 名失效时重算，避免每帧 O(M) 扫描；`amplitudeToWeight(1 - smoothLow)` 反相驱动 close 的语义与 `amplitude < sensitivity → 0` 守卫自洽（负值天然归 0）。
- **测试断言全部可手工推导**：如 `lipsync.test.ts:180-184` 附完整推导注释（`(0.65-0.3)/0.7=0.5`），非自证式 mock，回归价值高。

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | frontend/src/motion-algos/lipsync.ts | L26 与 L45 | `LIP_MORPH_CANDIDATES` 与 `MOUTH_MORPHS.open` 是同一 7 项列表的重复定义（`['あ','ア','A','a','口','mouth','open']`），未来调整 open 候选名需同步改两处，存在漂移风险 | 令 `const LIP_MORPH_CANDIDATES = MOUTH_MORPHS.open` 单源复用，或将 `findLipMorph` 委托 `findAllLipMorphs(morphNames).open` |
| 🟢 P4 | frontend/src/motion-algos/lipsync.ts | L77-95 | 守卫仅覆盖显式 NaN / 非有限 intensity；若调用方传入类型违约值（undefined/字符串，`clamp01(NaN)` 会返回 NaN 而非 0）或 `intensity<0`（产生负权重），无兜底。当前全部调用方（perception-lipsync、UI state 校验链）传合法数值，风险低 | 可选加 `typeof x === 'number'` 守卫或对 intensity 钳制到 `[0,1]`；亦可视为调用方契约不作处理 |
| 🟢 P4 | frontend/src/__tests__/lipsync.test.ts | L219-233 | `DEFAULT_LIPSYNC_STATE` 精确默认值（sensitivity=0.2、intensity=0.8）只用范围断言，误改成 0.9/0.5 测试仍绿；`lipsync-bridge.test.ts:197` 的 `toEqual` 只锁「桥与算法一致」不锁「具体数值」 | 增补精确值断言，或在注释中显式声明「默认值允许调参、不锁定」以澄清意图 |
| 🟢 P4 | docs/knowledge/lipsync-bridge.md（round-15 遗留） | — | 知识卡未提及 `multiMorphEnabled` / `findAllLipMorphs` / `LipSyncMorphSet`，round-15 已指出、本次 grep 确认至今未补 | 更新知识卡补充多口型扩展符号与 `LipSyncMorphSet` 类型说明 |

## 测试质量评价

**结构**：4 个 describe（findLipMorph ×9 / findAllLipMorphs ×12 / amplitudeToWeight ×18 / DEFAULT_LIPSYNC_STATE ×3），共 42 用例，`@vitest-environment node`（纯函数环境正确），**零 `.skip` / `.todo` / `.only`**，无 mock 依赖。

**断言有效性**：
- morph 匹配优先级经逐级验证（あ→ア→A→a→口→mouth→open 每级单独断言，如 lipsync.test.ts:11-37），`findAllLipMorphs` 四音素分类、日文优先于拉丁（L65-71）、`にこり`/`笑い` 微笑别名（L89-97）均真实验证。
- 振幅映射全部为可独立推导的精确数学断言（`toBeCloseTo` 3 位小数），如 L151/155/164/183，非镜像实现的自证式测试。

**边界覆盖**（相当完整）：空列表、无关 morph（含 `'笑い2'` 拒绝 `'笑い'` 的精确匹配断言，L108）、大小写、混合日/拉丁、部分匹配、负振幅、振幅超界钳制、sensitivity=0/1/`>1`、intensity=0、NaN 三参数全组合、`±Infinity` 振幅、`Infinity` intensity——覆盖了源码全部守卫分支（含 `range<=0` 死区分支）。

**缺口（均低危，不影响结论）**：重复 morph 名（`['あ','あ']`，Set 语义下平凡正确，测试价值低）；`intensity>1` / `intensity<0` / `sensitivity<0` 属未定义行为且无测试（文档声明 0..1，调用方已约束）。

---

审核日期：2026-08-15
审核员：子代理 round25-lipsync
