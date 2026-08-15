# 审核报告：library-state 测试与生产源码（round24-1）

## 审核范围

| 项 | 文件 | 说明 |
|----|------|------|
| 测试文件 | `frontend/src/__tests__/library-state.test.ts`（66 行，round14 P3 补测） | 5 个用例：clearThumbnailCache ×2、clearRecentMotions ×1、clearExpandedFolders ×2 |
| 被测源码 | `frontend/src/core/library-state.ts`（138 行，ADR-141 拆分产物） | 含 thumbnailCache / setThumbnailUpdateCallback / clearThumbnailCache / addRecentMotion / getRecentMotions / clearRecentMotions / expandedFolders / toggleExpandedFolder / clearExpandedFolders |
| 间接证据 | `frontend/src/core/types.ts:613-617`（RecentMotion 类型）、`frontend/src/core/ui-resource-panel.ts:523`（回调注册点）、`frontend/src/__tests__/config.test.ts:472-545`（同符号既有测试）、`docs/adr/adr-141-state-split.md`、`docs/knowledge/state.md` | 消费者与覆盖核对 |

**总体结论：✅ 通过**（测试 5/5 全绿，源码状态流清晰；含 2 项 P3 观察：clear 函数无生产调用点、回调类型签名不含 null）

## 亮点

- **单一写入点模式贯彻（ADR-141）**：`library-state.ts` 全部可变状态均为 `export let` + 专属 setter（`:10-25`、`:29-32`、`:66-69`、`:81-84`），外部只经 setter 写入，无"幽灵路径"；`_recentMotions`（`:89`）为模块私有，仅 `addRecentMotion`/`clearRecentMotions`/`getRecentMotions` 可触及。
- **防御性拷贝有注释背书**：`getRecentMotions()`（`:99-103`）返回元素级深拷贝，`[audit:P2]` 注释明确解释了"浅拷贝只挡数组级 push/splice，元素级改 name/path 仍污染"的取舍——这是审核手册「状态流清晰」维度的正面样板。
- **原地 mutate 而非换引用**：`setThumbnailCache`（`:44-53`）`clear()` 后逐个 `set()`，`[fix:thumbnail]` 注释说明保证持有 live 引用的面板（createResourcePanel / IntersectionObserver）能感知更新——正确处理了「容器引用共享」这一易错点。
- **回调通知链路完整**：`_thumbnailUpdateCb`（`:39`）由 `ui-resource-panel.ts:523` 真实注册（`notifyThumbnailUpdate`），`setThumbnailCache`（`:52`）与 `clearThumbnailCache`（`:61`）均用 `?.()` 触发，生产链路闭合、非测试专用桩。
- **零运行时依赖、零循环依赖**：仅 `import type` from `./types`（`:6`），`docs/dep-graph.md:40` 中为独立节点。
- **无魔法数值**：上限用命名常量 `MAX_RECENT_MOTIONS = 10`（`:88`）；无静默吞错（`catch{}` 零命中），回调抛错向上传播而非压制。
- **测试环境声明正确**：`@vitest-environment node`（`library-state.test.ts:1`）与模块"无 DOM 依赖"事实匹配，符合项目测试分流实践；`beforeEach` 重置 `thumbnailCache`/`expandedFolders`/回调（`:18-22`），用例间无状态串扰。

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | `frontend/src/core/library-state.ts` | :59 / :109 / :136 | 三个 `clear*` 函数**无任何生产调用点**（grep `frontend/src` 全量：仅自身定义 + 测试文件引用）。注释声称"场景切换或库路径变更时调用，释放旧缩略图内存""文件夹删除时调用，消除幽灵展开状态"，但该场景未接线——函数当前实际消费者只有测试（`clearRecentMotions` 还充当 `config.test.ts:474` 的 test reset hook） | 二选一：① 在场景切换/库路径变更的真实调用点接入，兑现注释承诺；② 若暂缓接入，将注释改为"供测试 reset 与未来接入预留"，避免文档与事实脱节 |
| 🟡 P3 | `frontend/src/core/library-state.ts` | :40-42 | `setThumbnailUpdateCallback(cb: () => void)` 类型签名不接受 `null`，但内部 `_thumbnailUpdateCb` 为 `(() => void) \| null`（`:39`）且所有调用点以 `?.()` 保护——语义上 null 是合法注销值，类型却未表达，迫使测试用 `null as unknown as () => void`（`library-state.test.ts:21`）绕过类型系统 | 签名改为 `cb: (() => void) \| null`，消除测试的类型断言，注销语义落进类型 |
| 🟢 P4 | `frontend/src/__tests__/config.test.ts:539-544` vs `frontend/src/__tests__/library-state.test.ts:52-60` | 两文件 | `clearExpandedFolders empties the set` 与 `clearExpandedFolders 清空已展开文件夹集合` 断言重复（同为 toggle 2 项 → clear → size 0）。round14 补测未先核对既有覆盖 | 保留其一（建议留 `library-state.test.ts` 按被测模块归位），另一处删除或改为互补断言（如幂等性） |
| 🟢 P4 | `frontend/src/__tests__/library-state.test.ts` | :18-22 | `beforeEach` 重置了 thumbnailCache / expandedFolders / 回调，**唯独漏了 `_recentMotions`**。当前用例自包含（先 add 再断言，:43-45）故不炸；但 `config.test.ts:474` 的 recentMotions 用例靠 `beforeEach` 的 `clearRecentMotions()` 免疫，本文件反而没有——未来新增依赖初始空态用例会踩坑 | `beforeEach` 补 `clearRecentMotions()`，与 `config.test.ts` 对齐 |
| 🟢 P4 | `frontend/src/core/library-state.ts` | :36 / :122 | `thumbnailCache` / `expandedFolders` 以 `export const` 直接暴露可变容器，外部可绕过 setter 直接 mutate（测试 `beforeEach` 即 `thumbnailCache.clear()`）；与 `_recentMotions` 私有 + 深拷贝的防御级别不一致。系历史设计（`:45-46` 注释解释了原地 mutate 的必要性），非本轮引入 | 知悉即可；若未来收口，可提供 `clearThumbnailCache`/`clearExpandedFolders` 作为唯一清空入口并推动调用方迁移 |

> 旁注（非本文件、不展开）：`config.test.ts:506` 存在 `(first as any).push(...)` 测试卫生问题，属该文件归属范围，本次仅记录。

## 测试质量评价

- **断言有效性 — 良好**：清空语义为**真实验证**而非形式断言——`expect(thumbnailCache.size).toBe(0)`（:32）、`expect(getRecentMotions()).toEqual([])`（:49，用 `toEqual([])` 而非仅查 length，验证内容真空）、`expandedFolders.size` 归零（:59）；回调触发用 `toHaveBeenCalledTimes(1)` 精确计数（:33），排除了"只调用了但多次"的假绿。
- **边界覆盖 — 良好但有对称性缺口**：✅ 空状态安全两条（无回调不抛错 :36-40、空集合安全 :62-65）；❌ "重复清空幂等性"仅 `expandedFolders` 覆盖（:62-65），`thumbnailCache` / `recentMotions` 未补对应用例——三函数同为 round14 P3 修复，幂等性测试不对称。
- **无跳过测试**：grep `.skip(` / `.todo(` / `.only(` 零命中，5 个用例全部真实执行。
- **可运行性**：实测 `npm run test -- src/__tests__/library-state.test.ts` → 5/5 通过（21ms，v4.1.9），与项目基线一致。
- **总体**：测试有效覆盖了 round14 P3 三个清空函数的核心契约（清空 + 回调 + 空态安全），断言手法扎实；扣分项仅为跨文件重复用例（P4）与 `_recentMotions` 重置缺口（P4，当前无实际影响）。

## 审核员备注

- 依赖分析：`library-state.ts` 上游仅 `types.ts`（type-only），无运行时上游，无循环依赖。
- 资源释放：模块内无 `new` 需 `dispose()` 的对象（Map/Set/数组为值语义容器），无 Observer 泄漏面。
- `npm run check` 未执行：本审核只读不改码，`tsc` 结果不影响结论；如需可在主模型汇总轮补跑。

---

审核日期：2026-08-15
审核员：子代理 round24-library-state
