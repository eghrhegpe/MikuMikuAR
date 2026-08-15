# 第 27 轮审核报告 — color-helpers（round-16 guardNum 修复后首次专项核验）

> **日期**: 2026-08-15
> **审核员**: 子代理 round27-color-helpers
> **审核范围**:
> - 测试文件: `frontend/src/__tests__/color-helpers.test.ts`（120 行，ADR-101，21 用例）
> - 被测源码: `frontend/src/core/color-helpers.ts`（43 行，4 导出：`col3FromTriple` :15-17 / `hexToRgb` :22-32 / `rgbToString` :35-37 / `rgbString` :40-42）
> - 关联: `frontend/src/core/guards.ts`（guardNum，round-16 收敛目标）；ADR-101（P3 新增 rgbString）；round-16 报告 `docs/audit/2026-08-15-round16-guards.md`
> **总体结论**: ✅ 通过（P1×0 / P2×0 / P3×2 / P4×4；round-16 修复本身正确，但存在一处测试缺口需在后续轮次补齐）

---

## 执行摘要

| 项 | 结果 |
|----|------|
| 测试运行 | `npm run test -- src/__tests__/color-helpers.test.ts` → **21/21 通过**（47ms，vitest 4.1.9） |
| 类型检查 | `npm run check`（tsc --noEmit + i18n 一致性）→ **通过（exit 0）** |
| 跳过测试 | 无（无 `it.skip`/`describe.skip`/`xit`） |
| 类型安全 | color-helpers.ts 0 处 `as any`/`@ts-ignore` |
| 资源释放 | 纯函数模块，无 `new` 资源对象（`new Color3` 由 Babylon 托管，非本模块持有生命周期） |
| 循环依赖 | 仅依赖 `@babylonjs/core` 与叶模块 `./guards`，无环 |

---

## 🔬 round-16 修复核验（本审核重点）

> 任务要求核实：round-16 把 color-helpers 本地私有 `guardNum`（`!Number.isNaN` 语义）收敛到 `core/guards.ts`（`Number.isFinite` 语义）后，是否引入行为差异或测试缺口。结论：**修复正确，行为差异符合预期且更安全，但存在一处测试缺口**。

### 1. 行为差异（已核实，git diff d4deea76）

修复前后语义对比（`color-helpers.ts:9` 改 import `./guards`，`guards.ts:5-6` 用 `Number.isFinite`）：

| 输入 | 修复前（本地版） | 修复后（guards.ts） | 差异 |
|------|------------------|---------------------|------|
| 正常有限数字 / 0 / 负数 | 透传 | 透传 | 无 |
| undefined（索引缺失）/ NaN / 非 number | → 0 | → 0 | 无 |
| **+Infinity / -Infinity** | **透传** | **→ 0** | ⚠️ 唯一差异 |

对两个入口的实际影响：
- `col3FromTriple`（:15-17）：修复前 `new Color3(Infinity, ...)` 会把 Infinity 灌入 Babylon 数学类型（下游矩阵/插值运算可产生 NaN）；修复后 → 0。**这是本次修复的真实收益**，与 round-16 报告判断一致。
- `rgbString`（:40-42）：修复前 Infinity 通道经 `Math.round(Infinity)=Infinity → Math.min(255, Infinity)=255` 实际输出 `255`（并非非法 CSS 串）；修复后输出 `0`。即 rgbString 存在**可观察的行为差异**（Infinity 通道 255→0）。0 语义更一致（与 NaN 走同一回退），但 round-16 注释"污染 CSS rgb 串"的说法对 rgbString 并不完全成立——clamp 顺序天然兜住了 Infinity；真正被污染的只有 Color3。**无生产影响**（颜色分量来自 hex 解析/配置，现实中不会为 Infinity），无需回退，仅记录此精度问题。

### 2. 测试缺口（🟡 P3，需后续补齐）

`color-helpers.test.ts` 对 NaN 有覆盖（:37-42 col3FromTriple、:116-118 rgbString），但 **±Infinity 在 col3FromTriple 与 rgbString 两条路径上均无任何用例**。关键问题：NaN 用例在修复前（`!Number.isNaN`）与修复后（`Number.isFinite`）实现下**都通过**——即现有测试**无法区分新旧实现**，若未来有人把 guardNum 改回 `!Number.isNaN` 语义（或内联本地版），本测试套件不会报红。±Infinity 仅在 guardNum 单元层有测（`guards.test.ts:38-44`），color-helpers 集成层（即修复真正落地的两个调用点）缺回归护栏。

---

## ✅ 亮点

- **收敛正确且带决策注释**（`color-helpers.ts:7-9` + `guards.ts:5-6`）: `typeof === 'number'` 收窄 + `Number.isFinite` 拦截，一次调用同时处理 undefined/NaN/±Infinity/非数字，返回类型收窄为 `number`，无 `as` 断言；修复处注释写明 round-16 动机，防后人"优化"回 `!Number.isNaN`。
- **clamp8 运算顺序正确**（`color-helpers.ts:41`）: `Math.max(0, Math.min(255, Math.round(guardNum(v) * 255)))` — 先 round 后 clamp，负半舍入与越界都收敛到 [0,255]；即使输入是超大有限数（1e308×255 溢出为 Infinity），`Math.min(255, Infinity)=255` 仍不泄漏非法值到 CSS 串。
- **hexToRgb 正则锚定完整**（`color-helpers.ts:19`）: `^#?([a-f\d]{2})…$` + `/i`，`#` 可选但位置受控，前后锚定杜绝子串误匹配（如 `'xff0000x'` 不会通过）；非法输入回退主题默认色有行为契约。
- **测试断言真实有效**（`color-helpers.test.ts`）: 浮点用 `toBeCloseTo`（:11-13）、整数用 `toBe`、对象用 `toEqual`、字符串精确匹配，无 vi.mock、无 mock 自证；round 语义用注释锁定（:95 `Math.round(127.5)=128`），并用 2 的幂次精确值规避浮点误差（:100 注释）。
- **测试覆盖 4 导出函数全绿**（21/21）: col3FromTriple 5 用例（含缺失索引/空数组/负值/NaN）、hexToRgb 5 用例（含无 # /非法/空串/黑白端点）、rgbToString 1、rgbString 10 用例（round/clamp/负值/超界/混合/NaN），hexToRgb 正则两分支（命中/回退）均被覆盖。

---

## 风险

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | frontend/src/__tests__/color-helpers.test.ts | 37-42、116-118 | **round-16 修复的核心行为（±Infinity → 0）无测试覆盖**：现有 NaN 用例在 `!Number.isNaN` 与 `Number.isFinite` 两种实现下均通过，无法作为回归护栏；若 guardNum 语义回退，本测试套件不会报红 | 补两用例：`col3FromTriple([Infinity, -Infinity, 0.5])` 断言 → `(0, 0, 0.5)`；`rgbString(new Color3(Infinity, 0.5, -Infinity))` 断言 → `rgb(0, 128, 0)`（锁死修复后的 255→0 语义） |
| 🟡 P3 | frontend/src/core/color-helpers.ts:25 + frontend/src/menus/settings-appearance.ts:100/121/140/172/353/364、settings-shared.ts:132、browser-adapter.ts:355 | 主题默认色魔法数值跨 ≥4 文件散落 | 同一语义常量两副面孔：color-helpers 写死 `{r:74,g:108,b:247}`，其余文件写死 `'#4a6cf7'`（0x4a/0x6c/0xf7 = 74/108/247）。若默认主题色变更，需同步 ≥4 处且 hex↔rgb 换算必须手工一致，有漂移风险（本审核任务点名的"默认色魔法数值"维度） | 在 color-helpers.ts 导出命名常量（如 `DEFAULT_ACCENT_RGB = { r: 74, g: 108, b: 247 }` + `DEFAULT_ACCENT_HEX = '#4a6cf7'`），hexToRgb 回退与 settings-appearance 复位逻辑引用同一常量（颜色模块是叶，不违反分层） |
| 🟢 P4 | frontend/src/core/color-helpers.ts:13 | JSDoc 仍写"索引缺失或 NaN 时回退 0"，未提及 ±Infinity；round-16 后 Infinity 也回退 0，文档滞后于行为 | 更新注释为"索引缺失 / NaN / ±Infinity 时回退 0" |
| 🟢 P4 | frontend/src/scene/env/env-ground.ts:911、994 | 两处内联 `Math.round(line.r * 255)` rgba 字符串构造，与 rgbString 的 255 缩放模式重复（含 alpha 分量故无法直接替换） | 可选：新增 `rgbaString(c, alpha)` 到 color-helpers 统一；非阻断（重复仅 2 处且带 alpha 语义） |
| 🟢 P4 | frontend/src/__tests__/color-helpers.test.ts:45-69 | hexToRgb 边界未测：大写 hex（`#FF0000`，正则含 `/i` 但未验证）、3 位短 hex（`#fff`，当前设计不支持，无用例锁定契约）、带空白输入 | 补 1-2 用例（大写通过 + `#fff` 回退），把"只支持 6 位"的设计意图固化为测试 |
| 🟢 P4 | frontend/src/core/color-helpers.ts:41 | 255 缩放为魔法数值（`* 255`），round 语义已由测试注释锁定（test:94-102），风险低 | 可命名常量（如 `BYTE_MAX`）提升可读性；非阻断 |

---

## 测试质量评价

**总体**: 良好（21/21 通过，断言有效，无 mock 自证，无跳过用例）。

- **断言有效性**: ✅ 全部 21 个用例直接断言真实返回值。col3FromTriple 用 `toBeCloseTo` 验证浮点透传（:11-13）、`toBe` 验证精确 0 回退（:19-20）；hexToRgb 用 `toEqual` 验证对象结构（:47-49）；rgbString 用字符串精确匹配锁定 round/clamp 语义（:79-117）。NaN 用例（:37-42、:116-118）与注释（:95、:100）形成"用例+文档"双锁，round 行为不是靠直觉而是靠数学推演验证——这正是本模块最容易踩浮点坑的地方，处理得当。
- **边界覆盖**: ✅ 强。非法 hex（:57-58）、空串（:66-68）、无 #（:52-54）、缺失索引（:16-21）、空数组（:23-28）、负值透传（:30-35）、负值/超界/混合 clamp（:104-114）、NaN（:37-42、:116-118）均覆盖；clamp 边界 0/1（:90-92 与 :108-110）被锁死。
- **主要缺口**: ❗ ±Infinity 未覆盖（见风险 P3-1）——这是 round-16 修复的动机行为，且是唯一能区分新旧 guardNum 实现的输入。guardNum 单元层虽有测（guards.test.ts:38-44），但 color-helpers 两个调用点的集成行为无护栏，属"修复已落地、回归测试未跟上"。
- **次要缺口**: hexToRgb 大写/短 hex/空白（P4-3）；rgbString 超大有限值（1e308，实际会安全 clamp 到 255，缺测不影响结论）。
- **跳过测试**: 无。
- **源码→测试映射完整性**: 4 个导出函数全部被测；col3FromTriple 三分支（正常/缺失/NaN）、hexToRgb 两分支（命中/回退）、rgbString 全路径均有覆盖。除 Infinity 外，行/分支覆盖完整。

---

## 附：审核过程记录

- 审核手册已读（`docs/audit-playbook.md`，9 维度 + 报告模板）。
- 测试文件已读（120 行），import 链: `vitest` + `@babylonjs/core/Maths/math.color` + `../core/color-helpers`（4 导出）。
- 源码已读（43 行），上游依赖: `./guards`（叶，无环）、`@babylonjs/core`。
- 符号核实优先级: 源码 > ADR-101（已读，rgbString 为 P3 新增，状态已完成）> 知识卡 `docs/knowledge/color-helpers.md`（一致）> function-map（未单独查，源码为权威）。
- 修复核验: `git show d4deea76 -- frontend/src/core/color-helpers.ts` 确认 round-16 改动仅为"删本地 guardNum + import guards"，无其他行为变更；round-16 报告已读交叉印证。
- 消费者核查: grep 命中 18 处（col3FromTriple 9 生产模块、hexToRgb 3、rgbString 2、rgbToString 2），未发现依赖 Infinity 透传语义的调用点。
- 收敛核查: `parseInt(…,16)` 全仓仅 color-helpers.ts 3 处（唯一 hex 解析入口）；`Math.round(*255)` 残留仅 env-ground.ts:911/994（含 alpha，见 P4-2）。
- 类型检查: `npm run check` 通过（exit 0，tsc --noEmit 无错误；脚本尾部 i18n bundle 一致性检查亦全绿）。

---

> 审核日期: 2026-08-15
> 审核员: 子代理 round27-color-helpers
