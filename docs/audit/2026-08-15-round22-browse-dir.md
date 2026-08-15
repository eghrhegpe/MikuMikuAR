# browse-dir 模块 — 审核结果（round-22 / web-library-empty bugfix 回归测试）

## 一、审核范围

| 项 | 内容 |
|----|------|
| 测试文件 | `frontend/src/__tests__/browse-dir.test.ts`（102 行，14 用例，无跳过） |
| 被测源码 | `frontend/src/core/library-path.ts` — `getBrowseDir` :76-92（配套 `CATEGORY_KEY` :44-54、`CATEGORY_DIR` :56-66、`registerUiAction` :94-96） |
| 间接涉及 | `frontend/src/core/state.ts` :14-17（barrel re-export）→ 实际实现在 `core/library-state.ts`：`setLibraryRoot` :10-13、`setOverridePaths` :22-25 |
| 依赖叶 | `core/path.ts` `normPath` :15-38（归一化依赖）；`core/ui-action-bridge.ts`（零依赖叶子，无环） |
| 修复落点对照 | `core/backend/browser-adapter.ts` :756-789、:1133-1137（扫描侧虚拟子目录映射——web-library-empty 根因修复处）；`internal/app/app.go` `GetPath` :918-940（Go 端对应逻辑） |
| **边界说明** | 测试从 barrel `@/core/state` 导入 setter，实际写入点在 ADR-141 拆分后的 `library-state.ts`，与 `getBrowseDir` 读取的是同一活绑定，隔离无问题。 |

**验证结果**：`npx vitest run src/__tests__/browse-dir.test.ts` → 14/14 通过（35ms）；`npm run check`（tsc + i18n）→ exit 0 全绿。

## 二、总体结论

✅ **通过**

- **生产代码健康**：无 P1/P2。`getBrowseDir` 为纯函数（无 IO/异常路径），0 处 `as any`/`@ts-ignore`（仅一处 `overridePaths as Record<string,string>` 类型收窄，非逃生）；web:// 无特判分支（历史上 `3745ab62` 曾加特判、`0d6462d6` 已撤销），拼接语义单一；状态经单一写入点 setter（ADR-141），活绑定读取无幽灵路径；无循环依赖（library-path → ui-action-bridge 单向）。
- **测试有效**：14 用例全部断言真实生产函数（无 mock、无自证式测试），桌面拼接/web:// 拼接/override 优先级/归一化契约四组行为均落到具体拼接串；`beforeEach` 双 setter 重置，状态隔离干净。
- **P3 建议（不阻断）**：① 测试头注释（:2-4）描述的是已被 0d6462d6 撤销的第一阶段修复语义，与 :31-37 断言矛盾，易误导维护者重引入 web:// 特判；② 类别→目录名约定三处重复（TS CATEGORY_DIR / Go catDef / browser-adapter _CATEGORY_BY_EXT）且无交叉校验；③ 未知类别双端行为分歧（TS `root/category` vs Go `root`）被测试显式锁定，属既定但需人工维护的漂移面。均为文档/维护性层面，不影响当前正确性。

## 三、亮点

- **整体归一化契约 + 回归锁定**：`getBrowseDir` 对**拼接结果整体** `normPath(normPath(libraryRoot) + '/' + subdir)`（`library-path.ts:91`），而非仅 root 段——未知类别 fallback 携带的反斜杠/尾斜杠/`.`段全部归一化；`:88-101` 三个用例（`MD\dress_extra` / `extra/` / `a/./b`）精确锁定该契约，是最近审计轮（e1e798cb / da223493）反推源码的直接成果，且断言全部通过。
- **web:// 无特判、修复收敛到扫描侧**：`library-path.ts:86-87` 注释明确「网页端扫描已将文件映射到虚拟子目录（web://selected-dir/PMX 等），无需特殊处理」——根因修复落在 browser-adapter 扁平目录→虚拟子目录映射（`browser-adapter.ts:762-765, 779-789, 1135-1137`），`getBrowseDir` 保持单一「root/子目录」语义，消除双路径规则，符合「通用化、统一」的项目偏好。
- **优先级模型简洁且全分支被锁**：`overridePaths[category] > libraryRoot/subdir > ''`（`library-path.ts:78-84`）；测试 :25-29（override 优先）、:39-43（web:// 下 override 优先）、:71-77（override 尾斜杠/反斜杠归一化）、:79-83（空 override 回落）四组用例把优先级各分支全部钉死。
- **类别映射全覆盖 + 大小写敏感对齐**：8 个类别（pmx/vmd/audio/stage/prop/md_dress/environment/setting）在 :31-37 与 :51-57 全部断言，含大小写敏感的 `MD-dress`；与 Go 端 `catDef`（app.go:923-932）逐键对齐。
- **测试用真实模块、零 mock**（:5-7）：直接 import 生产 `getBrowseDir` 与真实 state setter，无 vi.mock、无全局污染；`beforeEach` 双 setter 重置（:10-13）后 `getBrowseDir` 仅读这两个全局 → 隔离完备。
- **状态流清晰**：`libraryRoot`/`overridePaths` 经 ADR-141 拆至 `library-state.ts`，单一写入点 `setLibraryRoot`（:11）/`setOverridePaths`（:23），`state.ts` barrel（:14-17）保持外部 import 路径零变化；`library-path.ts:5` 活绑定读取，写入点仅 library-setup / scene-bundle 两处配置入口，无幽灵路径。

## 四、风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🔴 P1 | — | — | 无 | 无 |
| 🟠 P2 | — | — | 无 | 无 |
| 🟡 P3 | frontend/src/__tests__/browse-dir.test.ts | :2-4 vs :31-37 | 头注释描述的是**第一阶段修复**（3745ab62：web:// 扁平根「不应拼接子目录」）的语义，与 :31 用例名「同样拼接标准子目录（扫描已映射到虚拟子目录）」及断言（`web://selected-dir/PMX`）直接矛盾。该特判已于 0d6462d6 撤销，注释是历史残留——维护者若按注释「修复」代码重加 web:// 特判，会让扫描 dir（`web://selected-dir/PMX`）重新不在 browseDir 之下，**原 bug 复现**。 | 重写头注释为当前不变式：扫描侧把扁平文件映射到虚拟子目录（`web://selected-dir/<subdir>`），故 getBrowseDir 统一拼接子目录；注明「web:// 特判已于 0d6462d6 撤销，勿重引入」。 |
| 🟡 P3 | frontend/src/core/library-path.ts :57-66 / internal/app/app.go :898-907,923-932 / frontend/src/core/backend/browser-adapter.ts :768-789 | 类别→目录名约定**三处重复**（TS `CATEGORY_DIR`、Go `catDef`、browser-adapter `_CATEGORY_BY_DIR`/`_CATEGORY_BY_EXT` subdir），无共享源、无交叉校验测试。新增类别时任一端漏改即静默漂移（如大小写 `MD-dress` 已靠注释约定）。 | 低成本方案：新增契约测试断言 TS `CATEGORY_DIR` 键集与 Go `catDef` 键集一致（可读 Go 源码字符串或注释维护对照表）；或抽单源常量（Go 侧生成 TS？工程量大，先测试兜底即可）。 |
| 🟡 P3 | frontend/src/core/library-path.ts :87 / internal/app/app.go :939 / browse-dir.test.ts :45-49 | 未知类别双端行为分歧：TS 回落 `root/category`，Go `GetPath` 返回 `root`。测试 :45 显式「锁定 TS 语义」并注明差异——有测试保护是好事，但分歧本身是双实现漂移面，typo 类别在两端得到不同目录。 | 保持测试锁定（已是最优防护），建议在注释中补一句分歧缘由（TS 侧下游 buildLevel 依赖子目录形态），或后续对齐 Go 侧语义时先改测试。 |
| 🟢 P4 | frontend/src/core/library-path.ts | :44-54 | `CATEGORY_KEY` 是**纯恒等映射**（8 键全部映射到自身），`CATEGORY_KEY[category] ?? category` 恒等于 `category`——冗余维护面（加类别需同步 3 张表）。 | 若为未来「override 键名 ≠ category 名」预留，加注释说明意图；否则删除并用 `overridePaths[category]` 直取。 |
| 🟢 P4 | frontend/src/core/library-path.ts | :87-91 + core/path.ts:15-38 | category 含 `..` 段时 normPath **不折叠**（`..` 折叠是有意为之，isUnderRoot 对 `..` 直接拒绝），`getBrowseDir('..')` 返回 `D:/MikuMikuAR/..`；契约注释「统一经 normPath 归一化」未覆盖 `..`。非穿越漏洞（消费者仅用于目录匹配/展示），但契约表述不严谨且无测试锁定。 | 在 :87-91 注释补充「`..` 段不折叠、由下游 isUnderRoot 拒绝」；可选补一条 `..` 行为测试（断言现状或显式拒绝）。 |
| 🟢 P4 | frontend/src/__tests__/browse-dir.test.ts | 全文件 | 未覆盖边界：① 空 category `getBrowseDir('')` 返回 libraryRoot 本身（subdir 回落为空串）；② override 已设但 libraryRoot 为空（override 分支先于 root 检查，返回 override）——两处行为均可从代码推出但无断言。 | 补两条低成本用例钉死边界，防止未来重构改变分支顺序。 |
| 🟢 P4 | frontend/src/core/library-path.ts | :94-96 | 模块加载副作用 `registerUiAction('getBrowseDir', …)`：为取纯函数而 import 本模块会顺带注册 UI action（adr-238 既定设计，bridge 为无环叶子，无实际危害），但纯逻辑模块与注册耦合。 | 保持现状即可（已文档化）；若未来拆分可在模块头注明。 |

## 五、测试质量评价

- **有效性**：两主分支真实验证——桌面拼接（:19-23）与 web:// 拼接（:31-37）都断言到**具体拼接串**而非仅形状；web:// 用例断言 4 个类别（pmx/vmd/audio/stage）证明是通用拼接而非特判。override 优先级（:25-29 / :39-43）、归一化契约（:88-101）均走真实生产代码路径，无 mock、无自证式断言。✅
- **边界覆盖**：空 root（:15-17）、尾斜杠 root（:59-63）、反斜杠 root（:65-69）、override 尾斜杠/反斜杠（:71-77）、空 override 回落（:79-83）、未知类别变体含分隔符（:45-49 / :51-57 / :88-101）——覆盖充分；缺口仅空 category、`..` 段、override+空 root 三处 P4 级边界。✅
- **隔离**：`beforeEach` 重置 `setLibraryRoot('')` + `setOverridePaths({})`（:10-13），`getBrowseDir` 仅读这两个全局 → 用例间零泄漏；无 window/DOM 依赖，`@vitest-environment node` 环境标注恰当。✅
- **跳过**：无 `it.skip` / `describe.skip` / `xit`，14 用例全量执行。✅
- **覆盖分工（注意）**：本文件只锁 `getBrowseDir` **契约侧**；web-library-empty 的根因修复在扫描侧（扁平→虚拟子目录映射），该侧由 `backend.fsa.test.ts:92-99`（断言 `web://selected-dir/PMX/...` 扫描 dir）独立覆盖——完整修复被两文件合围，分工正确。但若仅运行本文件，扫描侧回归**不会变红**，评审/补测时须记住这对搭档。⚠️（分工正确，仅提示）
- **可执行性**：单文件 35ms、node 环境、秒级完成、无脆弱环境依赖。✅

## 六、附注

- **修复演进链**：`3745ab62`（web:// 特判返回 root）→ `0d6462d6`（扫描侧映射虚拟子目录 + 撤销特判）→ `e1e798cb` / `da223493`（拼接结果整体 normPath 契约）→ `e2e4462a`（ADR-242 收编 core 层、直连 `@/core/state`）。当前实现与测试均为第三阶段语义，与源码注释、测试断言三者一致（除头注释历史残留，见 P3-①）。
- `library-state.ts:16` `setResourceRoot` 双写 `libraryRoot`（源码自标 `[audit:P2]`，历史兼容命名）——非本测试引入，不影响 `getBrowseDir` 契约，建议后续统一命名时处理。
- 知识卡 `docs/knowledge/core-utils.md:66` invariant「通过 @/core/config barrel 聚合导出」与 ADR-242 后 `library-path` 直连 `@/core/state` 的现状存在文档漂移（文档层，本次未改动，仅记录）。
- 审核日期：2026-08-15
- 审核员：子代理 round22-browse-dir
