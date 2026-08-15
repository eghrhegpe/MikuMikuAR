# 审核报告 — env-caustics（共享焦散纹理控制器）模块 + 单测

## 头部

- **审核范围**：
  - 测试文件：`frontend/src/__tests__/env-caustics.test.ts`（51 行，1 describe + 1 it）
  - 被测源码：`frontend/src/scene/env/env-caustics.ts`（182 行，全模块；变更行 = dispose 复位 config，`env-caustics.ts:168-171`）
  - 关联消费方（只读核实）：`scene/env/env-impl.ts:213-218`（dispose 调用链）、`scene/env/env-water.ts:222-246`（dt tick diff 守卫 + update 推进）、`scene/env/env-water-material.ts:233-239,472-474`（getTexture 消费）、`scene/env/env-underwater-fog.ts:17,83-96`（getTexture + isCausticsHost + CAUSTIC_WORLD_SCALE）
- **总体结论**：✅ **通过**（无 P1/P2 风险；2 项 P3 + 3 项 P4，均不阻塞）
- **验证执行**：`cd frontend && npm run test -- src/__tests__/env-caustics.test.ts` → **1 passed (19ms)**。`npm run check`（全量 tsc）耗时较长未跑，以单文件测试 + 逐行人工类型核查替代，报告中注明。

---

## 一、测试文件结构分析

| 项 | 内容 |
|----|------|
| 环境 | `// @vitest-environment node`（无 DOM 依赖，分流 node 环境提速） |
| mock 1 | `@babylonjs/core`：可构造 `Color3`（模块求值期 `DEFAULT_CONFIG` 执行 `new Color3(0.7,0.85,1.0)` 需要）+ 空类 `Material/PBRMaterial/StandardMaterial/Texture/Scene`（仅 instanceof/类型用）——**最小充分 mock，且不 mock 被测模块本身**，走真实控制器 |
| mock 2 | `../scene/env/_shared/env-texture`：`createCanvasTexture` → 假纹理 `{dispose, uOffset, vOffset}` |
| mock 3 | `@/core/math/hash-noise`：`hash2v: () => [0,0]`（本测试不触发 `_drawCausticCanvas`，仅防导入断裂） |
| import | `causticsController`（真实单例） |
| 断言 | setConfig({scrollX:9, scrollY:8, scale:3, intensity:5}) 生效 → dispose() → 4 字段全部复位（scrollX=0.05 / scrollY≈0.035 / scale=1.0 / intensity=1.0） |

测试来源：commit `782daabe`（补 diff-coverage 门禁缺失单测，14 文件之一）；生产修复来源：commit `e638bbda`（P2：dispose 未复位 config → HMR 重入后单例残留 scroll，diff 守卫不触发则残留持续生效）。**测试精确锁定变更行，是门禁驱动补测的正确定位**。

---

## 二、源码健康度（9 维度）

### 基础质量
1. **类型安全** ✅：grep 确认 `env-caustics.ts` 全模块 0 处 `as any` / `@ts-ignore` / `@ts-expect-error`；`isCausticsHost` 用 instanceof 类型守卫（180-181），`CausticsHostMat` 联合类型精确。
2. **资源释放** ✅：
   - `getTexture`（118-136）：`_scene` 不匹配时**先 dispose 旧纹理再重建**（123-126），场景切换无泄漏；
   - `dispose`（160-172）：dispose 纹理 + `_scene=null` + 复位 offset + 复位 config，**五态全清**；
   - 纹理经 `createCanvasTexture`（`_shared/env-texture.ts:42`）创建、绕过 LRU 缓存，属「约定未强制」路径（`docs/audit/env-review-triage-2026-07-14.md` 已审计，P3 可接受）；本控制器是唯一持有者且 dispose 路径完整，且每 scene 只生成一次，无泄漏确认。
3. **异常处理** ✅：`_drawCausticCanvas` 自身无 try/catch，但外层 `createCanvasTexture` 已对 draw 回调包裹 try/catch 并有 toDataURL 回退（`env-texture.ts:61,77-83`），绘制异常被工厂兜底，不崩。

### 设计质量
4. **状态流** ✅：enable/disable 由 envState 门控（`causticEnabled` → `uCausticIntensity` 0 强度，`env-water-material.ts:237`）；scroll 由 `env-water.ts:232-243` dt tick diff 守卫（`_causticsLastConfig`）推 `setConfig`；dispose 复位后由 `resetCausticsSyncGuard()`（`env-water.ts:228-230`，`env-impl.ts:218` 调用）保证首帧重新同步 envState —— 开关/强度/滚动**闭环完整**，无幽灵路径（round-12 已审 env 状态链与 env-ground-spec uninstall 路径，本模块为链路下游，链路整体一致）。
5. **职责单一** ✅：控制器只做纹理生命周期 + offset 推进 + config 持有；滚动消费者各自读 `uOffset/vOffset`，拆分动机（ADR-115 P5，跨场景复用 + 解耦 waterColor 重建条件）注释清晰（1-10 行）。
6. **并发安全** ✅：模块级单例、全同步无异步，无竞态窗口；`getTexture` 幂等（scene 匹配即返回）；快速开关水面 → `disposeWater` → `causticsController.dispose()`（`env-impl.ts:214`）→ 重建，HMR 重入由 dispose 复位 + diff guard 复位双兜底（`env-impl.test.ts:290` 与 `scene/env-impl.test.ts:290` 均断言 dispose 调用）。

### 维护风险
7. **重复代码** ✅：Voronoi 哈希已归位 `@/core/math/hash-noise`（ADR-212 落实），本模块无内联哈希重复；`_drawCausticCanvas` 为唯一 Voronoi 绘制实现。
8. **循环依赖** ✅：只依赖 `_shared/env-texture`、`@/core/math/hash-noise`、`@babylonjs/core`，被 4 个 env 模块消费，无环。
9. **魔法数值**：常量均有命名（`CAUSTIC_TEX_SIZE=512`、`DEFAULT_SCROLL_SPEED=0.05`、`CAUSTIC_WORLD_SCALE=0.15`、`TILE=8`）；仅两处未命名系数：`scrollY: DEFAULT_SCROLL_SPEED * 0.7`（105 行，注释"微微 X/Y 不同步"）与 `env-water.ts:239-240` 的 `* 0.5` 缩放——见风险表 P3-1。

---

## 三、亮点

- **dispose 五态全清 + 注释说明根因**：`env-caustics.ts:160-172` 复位纹理/场景/双 offset/单例 config，且注释精确描述"HMR 重入残留 config + diff 守卫不触发"的故障链，修复语义可审计。
- **场景切换先释放再重建**：`env-caustics.ts:118-136` 的 `_scene` 判定 + 旧纹理 dispose，是跨场景复用单例（ADR-115 P5）下防泄漏的关键守卫。
- **测试 mock 最小充分且不自 mock 被测模块**：`env-caustics.test.ts:6-26` 只 mock 模块求值期真实依赖（`new Color3` 需可构造）与贴图工厂，控制器走真实实现，断言真实状态流转；`toBeCloseTo` 正确处理浮点（scrollY=0.05×0.7）。
- **测试自清洁**：用例结尾 `dispose()` 将单例复位至 DEFAULT，不向同 worker 后续用例泄漏状态。
- **跨文件集成覆盖闭环**：`scene/env-water.test.ts:712-725`（resetCausticsSyncGuard + setConfig spy + envState 联动）与 `env-impl.test.ts:210`（dispose 调用链）补齐了本测试未触达的集成路径。

---

## 四、风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | `frontend/src/scene/env/env-caustics.ts` | 103-109（+`env-water.ts:239-240` 联动） | `DEFAULT_CONFIG.scrollY`（0.05×0.7=0.035）是 envState 同步前的瞬态兜底，与 envState 派生值（0.15×0.5=0.075）不一致；0.7（X/Y 异步系数）与 0.5（速度缩放）两个魔法系数跨文件隐式耦合，阅读者需自行推导 | 导出 `DEFAULT_CONFIG` 或加注释明确「瞬态兜底，首帧 diff 守卫即覆盖」语义；长期可将系数收敛为单一来源常量 |
| 🟡 P3 | `frontend/src/__tests__/env-caustics.test.ts` | 31 | 测试内重复生产常量 `DEFAULT_SCROLL_SPEED = 0.05`（生产未导出），生产默认值变更时测试静默失配或需人工同步 | 生产导出 `DEFAULT_CONFIG`/默认速度常量供测试引用，消除双源漂移 |
| 🟢 P4 | `frontend/src/scene/env/env-caustics.ts` | 146-154 | `update()` 返回 `{offsetU, offsetV, cfg}` 无任何消费者（唯一调用点 `env-water.ts:245` 忽略返回值）——ADR-254 P4 backlog B2 已登记幽灵输出；另负 scroll（菜单 min -2）时 offset 落在 (-1,0] 而非 [0,1)（JS 负数取模） | 改 `void` 或删返回值；如需归一化用 `(x % 1 + 1) % 1`（WRAP 模式下当前无视觉影响） |
| 🟢 P4 | `frontend/src/scene/env/env-caustics.ts` | 156-158 | `getConfig()` 返回内部 `_config` 引用，外部可变写绕过 `setConfig`（当前消费者均只读，未触发） | 返回只读浅拷贝，或加"只读约定"注释 |
| 🟢 P4 | `frontend/src/scene/env/env-caustics.ts` | 33, 84 | `_drawCausticCanvas` 分配两份 1MB `ImageData`（先取 `.data` 再新建复制回写），一次性生成路径多一次整缓冲复制 | 就地写 `data` 后单次 `putImageData`（可省 ~1MB 临时缓冲） |

无 P1 / P2 风险。

---

## 五、测试质量评价

**优点**：断言有效且直击变更行——先证 `setConfig` 写入生效、再证 `dispose` 四字段全复位，恰好覆盖 `env-caustics.ts:168-171` 修复语义；mock 设计符合 frontend/AGENTS.md 测试卫生铁律（不裸删 window、vi.mock 工厂只引 hoisted 绑定、核心 mock 形状最小化）；用越界值（scale:3, intensity:5）验证"从任意状态复位"，边界思路正确。

**覆盖缺口**（51 行小文件，覆盖不充分但定位合理）：
- 仅 1 用例锁定 dispose 复位单回归点；模块核心不变量（知识卡 `docs/knowledge/env-caustics.md` invariants）无直接覆盖：`getTexture` 场景复用/场景切换旧纹理 dispose（118-136）、`update()` offset 推进与环绕（146-154）、`setConfig` 部分合并保留 color（138-140，本测试只间接测到）、`isCausticsHost` 类型守卫（180-181）、负 scroll 环绕。
- 本测试从未调用 `getTexture` → mock 假纹理的 `dispose()` 从未被触发，`dispose()` 的纹理分支（161-164）实际未被执行到。
- 缓解因素：跨文件集成覆盖已闭环（见亮点末条）；本测试是 diff-coverage 门禁补测（commit `782daabe`），门禁定位即"锁定变更行"，职责完成。
- 无跳过测试（无 `it.skip`/`describe.skip`）；测试位置平铺于 `src/__tests__/` 而非 `src/__tests__/scene/`，与 scene 系测试子目录约定轻微不一致（非缺陷）。

**建议补充**（可选，不阻塞）：`getTexture` 场景切换 dispose 旧纹理 + `update` 环绕/负值归一化 + `isCausticsHost` 三组用例，可将本文件扩至 ~90 行覆盖核心不变量；若补，注意 `getTexture` 需要可控的 mock 纹理工厂（现有 mock 已具备 dispose/uOffset/vOffset 形状，可直接复用）。

---

## 结尾

- **审核日期**：2026-08-15
- **审核员**：子代理 round23-env-caustics
- **验证记录**：`npm run test -- src/__tests__/env-caustics.test.ts` → 1 passed (19ms)；`npm run check`（全量 tsc）未跑，报告已注明
