# round-43 perception-multi-model — 骨骼认领/冲突 banner + 多模型激活/隔离集成审计

## 审核范围

- **测试文件**：`frontend/src/__tests__/perception/perception-multi-model.int.test.ts`（276 行，11 用例）
- **被测源码**：
  - `frontend/src/scene/motion/perception.ts`（820 行）— `_claimPerceptionBones`:167-205、`_releasePerceptionBones`:208-223、`_reclaimPerceptionBones`:226-229、`_onBoneOverrideRelease`:95-103、`activatePerception`:316-377（含 `_allEnabled` 非焦点激活分支 :330-337）、`deactivatePerception`:396-421、`pinPerception`:627-645、`enableAllPerception/disableAllPerception`:697-752、`get/setPerceptionStateFor`:682-690
  - `frontend/src/scene/motion/bone-override-store.ts`（435 行）— `claimBones`:178-235（优先级仲裁 :197-226）、`releaseBones`:237-263（release 监听器 :258-261）、`getOwnedBones`:265-267、`add/removeReleaseListener`:310-316、`disposeModel`:320-335
  - `frontend/src/menus/motion-gaze-levels.ts`（525 行）— `updatePerceptionConflictBanner`:436-467、`renderPerceptionConflictBanners`:474-499
  - 关联：`motion-modules/registry.ts`（`claimBones` thin facade :265-268、`getModuleConflicts`:291-301、`releaseOwnedBones`:331-333）、`perception-observer.ts`（帧级 bake 门控消费 `_perceptionOwnedBones` :57-166）、`perception-gaze.ts:424/429/436/441`（claimed 门控）、`perception-breathing.ts:43`（claimed 门控）、`proc-motion-shared.ts:159-213`（候选常量）
- **与既往审核关系**：round-8 审 perception 拆分（✅，`round-8-perception-split.md`）；round-15 审 perception 全量（✅，`2026-08-07-round15-motion-pipeline-perception-proc.md`，含 reclaim listener 设计亮点与 deactivate 对称清理 P4 fix）；round-41 审 perception morph（`2026-08-15-round41-perception-morph.md`）；round-42 审 perception 状态生命周期（`2026-08-15-round42-perception-state.md`）。**本测试是骨骼认领（ADR-163）+ 多模型激活/隔离（ADR-164/166）的集成层**，与 round-41（morph）、round-42（状态 setter/迁移）互补：round-42 报告明确指出「observer run 回调帧级逻辑属 performance/multi-model 测试域」，本文件正是该域的补测。
- **运行验证**：`cd frontend && npm run test -- src/__tests__/perception/perception-multi-model.int.test.ts` → **11/11 通过**（3.2s，基线全绿）。`npm run check`（全量 tsc）未执行（与测试无关、耗时较长，跳过并在本报告注明）。

## 总体结论

⚠️ **有条件通过**（0 个 P1 / 2 个 P2 / 4 个 P3 / 6 个 P4）。

测试整体扎实：11 用例全部真实断言 store 认领/释放/抢占/自动 reclaim 链路与 banner 渲染，无跳过用例，mock 隔离模式（vi.hoisted + vi.resetModules + 共享工厂）成熟。但发现 2 个 P2 属于**本次被测特性的核心语义缺口**，且现有测试恰好未覆盖：

1. **抢占（claim）侧不失效感知层 bake 门控缓存** —— `_perceptionOwnedBones` 仅在 activate/pin/reclaim 时重建，另一模块 `claimBones` 抢占后该缓存仍含被抢占骨骼 → 帧级 `claimed.includes()` 门控（perception-gaze.ts:424/436）继续放行 → perception（管线 stage ⑥）在 bone-override（stage ⑤）之后全量覆写被抢占的 頭/首 旋转，运行时优先级语义反转（用户模块反而输给感知层）。ADR-166 P2-1 只修了 release 侧（reclaim 监听器），claim 侧无等价机制。
2. **冲突 banner 必然显示感知层内部子模块冲突** —— gaze.head(92) 与 breath(93) 在 `首/頭/head/Head` 重叠、breath(93) 与 balance.upper(95) 在 `上半身2` 重叠 → 每次激活都向 store 记录内部冲突卡；`updatePerceptionConflictBanner`（motion-gaze-levels.ts:451-457）无内部冲突过滤 → 生产环境启用感知层后 banner 恒显示「⚠ perception.breath: 首←perception.gaze.head…」，ADR-163「感知层 vs 模块层冲突可视化」意图被自身噪音稀释，测试 d)#2「无冲突时隐藏」分支在生产不可达。

## 亮点

- **reclaim 递归防护双保险**（perception.ts:95-103 + :208-223）：`_onBoneOverrideRelease` 先按 `moduleId.startsWith('perception.')` 短路自身释放；`_releasePerceptionBones` 又先行 `_perceptionOwnedBones.delete(modelId)` 再循环释放——两层守卫杜绝 release 事件回流触发无限递归（round-15 亮点延续，测试 ADR-166#3 端到端实证）。
- **reclaim 监听器防重复订阅 + 对称清理**（perception.ts:309-312 / :403-405）：`_reclaimListenerAdded` 标志保证全局仅注册一次，deactivate 无 pinned 时随 observer 一并 remove + 复位（round-15 P4 fix 落地处）。
- **场景级参数单例 + context 共享引用**（perception.ts:74/:148-150）：`_setFocusedState` 用 `Object.assign` 原地更新而非替换引用，避免已存在 context 捕获旧对象导致参数不生效——ADRD-166 测试 1/2 精确锚定「最后一次写入对所有模型一致」语义。
- **BoneOverrideStore 优先级仲裁实现清晰**（bone-override-store.ts:178-235）：与 registry 语义对齐（数值小者胜，:195-196 注释了迁移映射动机），抢占清落败方所有权+槽位并记录双视角冲突卡（M4），`_recordConflict` 去重（:397-405）；`clearSlot` 带 expectedModuleId 越权守卫（:157-174）。
- **多模型焦点切换链路完整**（perception.ts:345-371）：pinned 保留 observer、旧焦点非 pinned 释放骨骼+重置 offsets、`_resetGazeState` 清跨帧缓存防跳跃——ADR-166 P2-3 测试验证焦点+pinned 同屏 banner 归属前缀。
- **测试侧隔离模式成熟**：vi.hoisted mockState/mockPipeline + 共享工厂（perception-mocks.ts:1-18 文档化 resetModules 脱节陷阱）；`getBoneOverrideStoreForTest`（perception-mocks.ts:230-233）经与 sut 同一次模块求值取 store 单例，保证「测试手写 claim 与生产 claim 落在同一实例」；beforeEach `disposeModel('m1'/'m2')` 兜底清残留冲突（:86-91）。

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟠 P2 | perception.ts | `_perceptionOwnedBones` :81 / :301 传入 observer | **抢占（claim）侧不失效 bake 门控缓存**：store 是所有权权威（claimBones 抢占即更新 ownerByBone），但感知层帧级门控读的是 `_perceptionOwnedBones`（仅 activate/pin/reclaim 时重建）。模块经 registry.claimBones→store.claimBones 抢占 頭/首 后缓存仍含该骨 → gaze 继续在 stage ⑥（晚于 bone-override ⑤）全量覆写头部旋转，用户模块（priority 1）反而输给感知层（92）——与 ADR-163「感知层被动让位」语义反转。release 侧有 reclaim 监听器，claim 侧无等价机制。测试 b) 只断言 store 层所有权，未断言帧级门控。 | ① 为 store 增加 claim 事件监听（与 release 对称），感知层收到抢占通知后同步 `_perceptionOwnedBones`；② 或帧级门控改查 `store.getOwnedBones(modelId, moduleId)` 而非缓存 Map（一源化）；③ 补「抢占后 observer 不再写该骨」回归用例 |
| 🟠 P2 | motion-gaze-levels.ts / bone-override-store.ts | banner 模块循环 :451-457 / 冲突记录 :197-226 | **banner 恒显感知层内部子模块冲突**：候选常量重叠（HEAD_BONE_CANDIDATES 含 `首`，BONE_NECK_CANDIDATES 亦含 `首`；BONE_UPPER_CANDIDATES 含 `上半身2`，BONE_UPPER2_CANDIDATES 亦含）→ 每次 `_claimPerceptionBones` 激活必然记录 breath←gaze.head（92<93）×4 与 balance.upper←breath（93<95）×1 冲突卡（测试运行 stderr 可见 warn 实证）；banner 无内部过滤 → 生产启用感知层即显示「⚠ perception.breath: 首←perception.gaze.head…」，「无冲突时隐藏」分支（:458-461）不可达，ADR-163 冲突可视化被噪音稀释 | ① `updatePerceptionConflictBanner` 过滤 winner 亦为 `perception.*` 的冲突卡（或 `getModuleConflicts` 增加 `excludeInternal` 参数）；② 顺带消除每次激活的仲裁 warn 噪音；③ 补「正常激活 + 无外部模块 → banner 隐藏」用例（现 d)#2 因未激活感知层而漏测此生产常态） |
| 🟡 P3 | 测试文件 | ADR-164 用例 :206-223 | **断言弱**：`getPerceptionStateFor(modelId)` 忽略参数恒返回场景级单例（perception.ts:682-684），且 `DEFAULT_PERCEPTION_STATE.breathEnabled=true`（perception-shared.ts:48）→ `expect(...breathEnabled).toBe(true)` 在 m2 完全未激活时也恒真，未验证「新模型加载自动激活」 | 改用 `__testOnlyGetContext('m2')?.isActive === true` 或断言 `getOwnedBones('m2', 'perception.gaze.head').size > 0`，使用例真正钉死非焦点激活分支（:330-337） |
| 🟡 P3 | perception.ts | `_claimPerceptionBones` :172-204 | **优先级魔法数值 + 三方不一致**：生产用裸字面量 92/91/93/94/95/96（无命名常量、无注释说明 91-96 区间含义）；ADR-163 §2.1 文档声明感知层 P3=100；本测试 banner 用例直接以 100 模拟感知层（:144/:168/:187/:191）→ 文档/代码/测试三方漂移，若未来模块注册 97-99 优先级，实际仲裁与文档/测试模拟行为不一致 | 抽取 `PERCEPTION_PRIORITY_*` 命名常量或统一为 ADR 文档值 100；同步更新 ADR-163 表格与测试模拟值，保证三方一致 |
| 🟡 P3 | perception.ts / motion-gaze-levels.ts | :212-219 vs :442-449 vs :172-204 | **6 个 perception 模块 id 三处重复**：`_releasePerceptionBones` 列表、banner 模块列表、`_claimPerceptionBones` 各一份；新增感知子模块需同步三处，漏改即漂移（release 漏放骨或 banner 漏显） | 提取共享常量 `PERCEPTION_MODULE_IDS`（含各子模块候选+优先级），三处统一引用 |
| 🟡 P3 | perception.ts | `_onBoneOverrideRelease` :95-103 / `enableAllPerception` :707-712 | **reclaim 触发粒度粗 + 判定不对称**：① 任意模块 release（即使未涉及感知候选骨）都触发整组释放+重认领（引擎槽 clear/set churn，多模块频繁释放时感知覆盖闪烁）；② `enableAllPerception` else 分支仅检查 `gaze.head` owned 是否为空决定 reclaim，eye/breath/balance 被夺不触发 | ① 监听器内先求交集（被释放骨骼 ∩ 感知候选）非空才 reclaim；② reclaim 判定改为检查全部 6 个子模块 ownedBones 或直接比较 store 权威视图 |
| 🟢 P4 | perception.ts | :666-671 vs :400-406 | unpin 末位活跃注销 observer 时不清理 reclaim listener（round-42 P4#4 遗留确认，本轮重新核实仍存在）；因 `_onBoneOverrideRelease` 有 `_perceptionOwnedBones.has` 守卫，泄漏仅为惰性监听器、无功能后果 | 与 deactivate 对称：observer 置空时一并 `removeReleaseListener` + `_reclaimListenerAdded=false` |
| 🟢 P4 | perception.ts | :323-327 | `activatePerception` 只查 `inst?.mmdModel` 未查 `mesh.isDisposed()`（observer :286 与 enableAllPerception :700 均查）——对已 dispose 模型激活会照样认领骨骼，防御性缺口 | 补 `inst.mmdModel.mesh?.isDisposed()` 守卫并 warn |
| 🟢 P4 | 测试文件 | :141/:157/:165/:180 | 用例标题过时与命名：第一个 d) 用例标题仍为「仅焦点模型显示」（ADR-166 已泛化为任意模型均显示，测试断言已按新语义但标题残留旧语义）；4 个 d) 用例共用同一前缀；3 个纯同步用例挂 5000ms 超时（多余） | 标题去 ADR-163 旧语义、按 ADR-166 重命名（如 d1/d2/d3/d4），去掉多余超时 |
| 🟢 P4 | 测试文件 | :9（+ perception-mocks.ts:29） | `mockState.modelManager.modelRegistry` 为 hoisted 共享 Map，`setupPerceptionTest` 不清理 → ADR-164 用例注册的 m1/m2 泄漏至后续用例；当前后续用例不迭代 registry 故无影响，属跨用例耦合隐患 | setup 内 `modelRegistry.clear()` 或按用例显式清理 |
| 🟢 P4 | 测试文件 | :141-155 | banner 文本断言依赖 `document.createElement('div')` + 真实 DOM（happy-dom 环境），但未断言 banner 完整文本格式（`t('motion.perceptionDegraded')` 前缀与行数），对 i18n key 变更不敏感 | 可补 `toContain` 前缀 key 或快照，防文案回归 |

## 测试质量评价

- **断言有效性**：11 用例中 9 个为强断言——a) 4 个子模块 ownedBones > 0、b) 抢占前后 `has('頭')` 翻转（:114-121）、c) 释放后 3 组归零、d) 冲突文本含 moduleId/骨骼名/抢占方 + display 状态、P2-3 焦点+pinned 双 banner 归属前缀、ADR-166#1/#2 场景级单例「最后写生效」三视角（m1/m2/全局）、#3 端到端 reclaim（claim→release→自动回抢）。弱断言仅 ADR-164#8（见 P3-1）。
- **mock 合理性**：18 个 vi.mock 全部经共享工厂构造（perception-mocks.ts），mockState/mockPipeline 用 vi.hoisted 规避 resetModules 新实例脱节（文件头 :1-18 完整文档化该陷阱）；`getBoneOverrideStoreForTest` 保证与 sut 同实例求值（:230-233）；beforeEach 的 `disposeModel` 清理是防御性冗余（resetModules 已重建 store），无害。
- **边界覆盖**：优先级抢占（b，1<92）、重复认领后释放（c）、banner 有/无冲突两态、非焦点 pinned 冲突（P2-3）、全员模式非焦点激活（#8）、非感知模块释放自动 reclaim（#3）、场景级参数共享（#1/#2）。**盲区**：① 抢占后帧级 bake 门控（P2-1，测试只验 store 层）② 正常激活下的 banner 内部冲突噪音（P2-2，d)#2 未先激活感知层）③ 多模型快速切换竞争（未覆盖，round-42 已覆盖焦点切换 observer 保留）④ 重复认领幂等（同模块二次 claimBones）⑤ 模型 dispose 后 activate 守卫。
- **无跳过用例**：grep `it.skip/describe.skip/xit/todo/.only` 零命中。
- **类型安全**：生产代码 0 处新增 `as any`/`@ts-ignore`（`as Record<string, unknown>` 为受限转型）；测试 mock 用 `any`（Map<string, any> 等）属 mock 形状常规用法，可接受。

---

审核日期：2026-08-15
审核员：子代理 round43-perception-multi-model
