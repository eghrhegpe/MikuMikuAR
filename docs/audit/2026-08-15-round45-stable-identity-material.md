# [stable-identity-material-roundtrip] — 审核结果（round-45 测试 3）

**总体结论：⚠️ 有条件通过**

- 测试文件：`frontend/src/__tests__/scene/stable-identity-material-roundtrip.test.ts`（111 行，ADR-193 材质可见性「服饰开关」跨重载还原回合）
- 被测源码：`frontend/src/scene/manager/material.ts`（1051 行）——重点 `getMatState` :953-1021（序列化）、`applyMatState` :1023-1051（反序列化）、`setMatEnabled` :662-683 / `isMatEnabled` :658-660（可见性状态）、支撑面 `MaterialStateManager` :184-214、`_getMeshesById` :28-30
- 关联调用点：`scene/scene-serialize.ts:461`（落盘 getMatState）、`:913`（恢复 applyMatState，已 try/catch 包裹）、`menus/model-preset.ts:192`（applyMatState，未包裹）
- 验证：`npm run test -- src/__tests__/scene/stable-identity-material-roundtrip.test.ts` → 3/3 通过（36ms，import 1.30s）；`npm run check`（tsc + i18n）exit 0

**与既往审核的关系**：
- round-11 审过 material：per-mat 全量 DEFAULT 覆盖遮蔽 category（P2，后被 `_mergedMatParams` 修复）、`_ensureState` 读路径带写副作用、getMatState 每字段 JSON.stringify 热路径。
- round-24 审过 material-editor：`_applyMaterial` 重构出 `_applySingleMaterial`（约 60 行去重）、`_clampAndAssign` NaN 防护闭环、per-mat Partial 继承、`MaterialStateManager` 集中状态；P3 循环依赖 material↔material-sss、P4 shininess 魔法数 200。
- round-40 审过 model-preset：`setMatParams` 补 `!Number.isFinite(matIndex)` NaN 守卫（material.ts:833）；P4 `JSON.stringify(DEFAULT_MAT_PARAMS)` 每次调用重复序列化（:969）。
- 本测试（round-45）是 ADR-193 稳定身份的**回合测试**：用真实 material.ts 函数跑 serialize→reload→deserialize 闭环，验证稳定 id 下可见性状态不丢；不新增生产代码改动，属「测试反推/锁定既有修复」类。

## 亮点

- **受控 modelRegistry 隔离，零重型 mock 属实**（test:9-21）：`vi.hoisted` + 静态 mock 仅替换 `modelRegistry/uiState/triggerAutoSave` 三个绑定，不 mock 任何 Babylon 模块；import 耗时 1.30s（material-editor.test.ts 因 40+ 行 vi.mock 需 11.7s），实测「零重型 mock」声明成立。
- **真实函数回合，非 mock 复制**（test:23-29, 51-64）：直接 import material.ts 真实 `getMatState/applyMatState/setMatEnabled`，序列化→清空 registry→同 id 重注册→反序列化，全程走生产状态流；`saved!.enabled` 原样回喂 `applyMatState`，断言真实输出而非桩复制。
- **负向对照测试锁定病因**（test:87-110）：第三用例显式演示 pre-fix 孤儿化（旧 id 状态随卸载丢弃 → `getMatState(旧id)` 返回 null → 新 id 默认全开），把「为什么需要稳定 id」固化为回归护栏，比只测正向更有信息量。
- **空态→null 守卫被真实覆盖**（test:106-107 + material.ts:964 + material-sss.ts:199,210）：`getMatState` 空态返回 null 的判定链（三 Map + SSS 状态全空）在负向用例中真实命中，非空断言前置 `not.toBeNull()` 避免误绿。
- **测试卫生达标**（test:36-39）：beforeEach 清理 registry + `_matEnabled`，无跨用例泄漏；`vi.hoisted` 正确规避 mock 工厂 TDZ（符合 frontend/AGENTS.md 铁律）；无 `skip/todo/only`；`isMatEnabled` 的 `?? true` 默认可见语义与「服饰开关」心智一致。

## 风险

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|------|------|------|------|------|
| 🟠 P2 | `frontend/src/scene/manager/material.ts` | `setMatEnabled` :662-666（对照 `setMatParams` :833 已有守卫） | **NaN matIndex 守卫不对称（round-40 修复未同步到本测试核心函数）**：`setMatEnabled` 边界检查 `matIndex < 0 \|\| matIndex >= meshes.length` 对 NaN 恒 false 穿透 → `meshes[NaN].setEnabled(...)` 抛 TypeError。触发链：`applyMatState` :1046 `parseInt(idxStr)` 遇损坏 JSON 键（如手改预设 `"abc": false`）→ NaN → `setMatEnabled(id, NaN, false)` → `current(true) !== enabled(false)` 进入写入 → 崩溃。scene-serialize:919 的 try/catch 兜住恢复路径（降级为 logWarn），但 **model-preset.ts:192 未包裹 → 未捕获异常**；且 `enabled=true` 时因 `current === enabled` 早退静默吞掉 NaN 键（不崩溃也不记录，两条路径行为不一致）。与 round-40 已修的同族缺陷（P3，setMatParams 幽灵 entry）相比，此处失败模式更硬（崩溃） | 对齐 :833-838 既有模式，加 `!Number.isFinite(matIndex)` 守卫 + logWarn 后 return；测试补一条 string-keyed 非法 enabled 键用例（本文件或 material-editor.test.ts） |
| 🟡 P3 | `frontend/src/__tests__/scene/stable-identity-material-roundtrip.test.ts` | :63-64（及 :82-84） | **还原断言只看内部 Map，未验证 mesh 真实副作用**：断言 `isMatEnabled` / `_matEnabled` 与 `applyMatState` 写入的是同一状态源，若回归为「记录 Map 但跳过 `mesh.setEnabled`」，测试仍绿——而 `mesh.setEnabled(false)` 恰是「服饰开关」的可见效果 | 补 `expect(hoisted.registry.get(id)!.meshes[2].setEnabled).toHaveBeenCalledWith(false)`（重载后新实例），与 Map 断言双保险 |
| 🟡 P3 | `frontend/src/__tests__/scene/stable-identity-material-roundtrip.test.ts` | :50, :59 | 注释引用 `scene-serialize.ts:441-451 / 862-872` 已过期：实际调用点为 `:461`（getMatState 落盘）与 `:913`（applyMatState 恢复），行号漂移约 20-50 行 | 改为函数名引用（如「等价于 scene-serialize.ts 的 getMatState 落盘点 / applyMatState 恢复点」），不锁行号 |
| 🟢 P4 | `frontend/src/__tests__/scene/stable-identity-material-roundtrip.test.ts` | :17-21 | `vi.mock('@/core/config')` 静态全量替换，未用 `...(await importOriginal())` 展开，也未复用 state-superset 的 modelRegistry 工厂（frontend/AGENTS.md 点名 god-barrel 卫生规则） | 本次安全：material.ts/material-sss.ts 对 core/config 仅读侧（modelRegistry.get、uiState.materialCategoryMap）与调用侧（triggerAutoSave），无活绑定写读分离风险，「受控 registry」正是测试目的。建议加一行注释声明「静态全替换仅覆盖只读绑定」以免后人误仿 |
| 🟢 P4 | `frontend/src/__tests__/scene/stable-identity-material-roundtrip.test.ts` | 全文件 | 覆盖缺口：无 categories/overrides 回合（model-preset.test.ts:791+ 已覆盖，本测试刻意限定可见性范围，可接受）；无重复回合（save→reload→save→reload）；无 reload 后 mesh 数变化（越界守卫已由 material-editor.test.ts:1134-1139 锁「不抛」）；无 enabled:true 还原（material-editor.test.ts:1115 已测 re-enable 删 entry） | 既有套件已补位，非新增缺口；如需本文件自足可在后续轮补「重复回合」一条 |
| 🟢 P4 | `frontend/src/scene/manager/material.ts` | :969, :498 | 既往轮已标记的残留：`JSON.stringify(DEFAULT_MAT_PARAMS)` 每次调用重复序列化（round-40 P4）；`(200 - p.shininess) / 200` 魔法数 200 与 CLAMP_RULES.shininess[1] 未共享（round-24 P4）；material.ts:15↔material-sss.ts:14 循环依赖（round-24 P3，调用期引用安全） | 非本轮新增；建议在材质系统下次重构时一并处理，本文件无涉及 |

## 测试质量评价

- **断言有效性**：正向用例断言还原后 `isMatEnabled` 为 false 且 `_matEnabled` Map 内容一致；多材质用例全索引扫描（6/6 逐一核对开关态）避免「只查被隐藏项」的偏置；负向用例断言 `getMatState` 返回 null 而非 undefined（锁定空态守卫语义）。有效。
- **mock 合理性**：受控 registry 是 material.ts 按 id 查 meshes 的单一 seam，mock 形状（`{id, meshes: [{setEnabled}]}`）与生产消费面（material.ts:28-30, 671, 930）完全对齐；`vi.hoisted` 用法符合仓库铁律。唯一软肋是未断言 mesh.setEnabled 真实调用（见 P3）。
- **边界覆盖**：部分状态（仅 enabled）✓、空态→null ✓（负向用例）、越界/缺模型早退由既有套件锁定 ✓；缺「重复回合」与「enabled:true 还原」两边界（既有套件已覆盖，非新缺口）。
- **跳过测试**：无（3 个 it 全为真实断言，无 skip/todo/only）。
- **可维护性**：111 行、零重型 mock、node 环境，2.84s 全量跑完（含 import），是仓库内材质相关测试中启动最轻的；注释完整交代了「为什么」（ADR-193 病因）而非仅「是什么」。

---

- 审核日期：2026-08-15
- 审核员：子代理 round45-stable-identity-material
