# 审核报告：config.test.ts（format + library-state 组合测试）（round51-1）

## 审核范围

| 项 | 文件 | 说明 |
|----|------|------|
| 测试文件 | `frontend/src/__tests__/config.test.ts`（545 行，89 用例，0 跳过） | 直接 import 6 个生产叶子模块 + 2 个库路径包装函数，不经过 barrel |
| 被测源码（主） | `frontend/src/core/format.ts`（55 行） | `formatTime`（:8-16）/ `formatError`（:22-55） |
| 被测源码（主） | `frontend/src/core/library-state.ts`（138 行） | `addRecentMotion`/`getRecentMotions`/`clearRecentMotions`/`toggleExpandedFolder`/`clearExpandedFolders`/`expandedFolders`/`setLibraryRoot` 等 |
| 被测源码（次，同文件顺带覆盖） | `frontend/src/core/path.ts`（108 行）、`image.ts`（76 行）、`escape-html.ts`（12 行）、`library-path.ts`（96 行） | normPath/getBaseName/getDirPath/isUnderRoot/isStageLike/computeLibraryRef/resolveLibraryRef/toBase64/thumbDataUrl/escapeHtml |

### 与既往审核的关系

- **round-15**（2026-08-07 `round15-core-tools-config-i18n.md`）审过 core/config barrel（18 模块含 format，format.ts 判定 ✅，:84-86 确认 formatTime 非有限数兜底 / formatError 递归 + try/catch 不静默吞错）。本测试的 format 部分与 round-15 结论一致，无新增风险。
- **round-24**（2026-08-15 `round24-library-state.md`）审过 library-state（clear* 无生产调用点 P3、回调签名 null 缺失 P3、两项 P4 测试卫生）。本测试的 library-state 部分与 round-24 结论一致，**2 项 P3 本轮 grep 实测确认仍开放**（`clearRecentMotions`/`clearExpandedFolders`/`clearThumbnailCache` 在 `frontend/src` 全量仅剩定义 + 测试引用，零生产调用点）。
- 本测试是 **format + library-state 组合测试**：format 部分为 round-15 barrel 审核的叶子级验证；library-state 部分为 round-24 单测的互补覆盖（recentMotions 增删改查 + 上限 + 防御拷贝，均非 round-24 的 clear* 专属范围）；另顺带覆盖 path/image/escape-html/library-path，形成对 round-15 审核面的补充验证。

**总体结论：✅ 通过**（89/89 全绿，13ms 实测；生产源码健康，无 P1/P2；3 项 P3 中 2 项为 round-24 遗留确认，1 项为既有重复断言，均非本轮新增代码缺陷）

## 亮点

- **纯函数 + 防御边界双全（format.ts）**：`formatTime` 对 NaN/±Infinity 统一返回 `'00:00.00'`（:9-11），分钟数不设上限（3661→`61:01.00`，:6 注释文档化设计意图）；`formatError` 用 `Number.isFinite` + `Math.max(3, maxLen)` 钳制极端参数（:24），`limit - 3` 截断保证省略号语义，测试对 0/3/4/-5 四个极限 maxLen 均有断言（config.test.ts:168-174）。
- **结构类型判断 + 依赖纪律（format.ts:30-37）**：`LibraryLoadError` 识别只按 `name` 字段做 structural 判断、不 import 类型，注释明确说明"避免本叶模块 → load-manager 依赖"——ADR-191 去桶化纪律在 format 层贯彻，且递归 `formatError(e.cause, ...)` 为前缀预留 30 字符空间，异常链路不静默吞错（:49-54 try/catch 兜底 `String()` 失败并返回有意义文本）。
- **单一写入点模式（library-state.ts，ADR-141）**：全部可变状态为 `export let` + 专属 setter（:10-13/:17-20/:23-25/:30-32/:67-69/:82-84），模块私有 `_recentMotions`（:89）仅经 `addRecentMotion`/`clearRecentMotions`/`getRecentMotions` 可触及，`getRecentMotions` 返回元素级深拷贝（:99-103，`[audit:P2]` 注释解释浅拷贝不够的取舍），`MAX_RECENT_MOTIONS = 10` 命名常量（:88）——无魔法数值。
- **测试断言有效性 — 真实而非形式**：防御拷贝用例（config.test.ts:502-510）先 mutate 返回值再重读，真实验证外部改动不影响内部状态；去重置顶用例（:492-500）同时断言 path 置顶 + name 更新 + 长度收缩；时间格式全部精确字符串断言。
- **测试直接引叶子不引 barrel（config.test.ts:3-23）**：6 个生产模块全部 `../core/xxx` 直接导入，符合 ADR-191 纪律，无 god barrel 拖拽；文件内状态隔离良好——computeLibraryRef/resolveLibraryRef 两个 describe 均 `beforeEach` 重置 `setLibraryRoot`（:306-308/:353-355），recentMotions 重置 `clearRecentMotions()`（:473-475），用例间无串扰。

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | `frontend/src/core/library-state.ts` | :59 / :109 / :136 | 三个 `clear*` 函数**仍无任何生产调用点**（本轮 grep `frontend/src` 全量：仅自身定义 + `config.test.ts`/`library-state.test.ts` 测试引用）。round-24 已记录此 P3，代码未变，仍开放。注释声称"场景切换或库路径变更时调用""文件夹删除时调用"但未接线 | 二选一：① 在场景切换/库路径变更的真实调用点接入；② 注释改为"供测试 reset 与未来接入预留"，避免文档与事实脱节（同 round-24 建议） |
| 🟡 P3 | `frontend/src/core/library-state.ts` | :40-42 | `setThumbnailUpdateCallback(cb: () => void)` 签名不接受 `null`，但内部 `_thumbnailUpdateCb` 为 `(() => void) \| null`（:39）且调用点均 `?.()` 保护——round-24 已记录，仍开放 | 签名改 `cb: (() => void) \| null`，注销语义落进类型，消除测试类型断言 |
| 🟡 P3 | `frontend/src/__tests__/config.test.ts` | :539-544 | `clearExpandedFolders empties the set` 与 `library-state.test.ts:52-60` 断言重复（round-24 已记录 P4，本轮确认仍存在） | 保留 `library-state.test.ts` 按被测模块归位，本处删除或改为互补断言（如幂等性） |
| 🟢 P4 | `frontend/src/core/format.ts` | :40 / :44 / :47 / :51 | 截断模式 `slice(0, limit - 3) + '...'` 在 4 个分支重复（LibraryLoadError/Error/string/String），同文件内重复但改截断语义需同步 4 处；`3`（省略号长）与 `30`（前缀预留，:37）为魔法数值 | 提取 `truncate(s, limit)` 私有工具 + 命名常量 `ELLIPSIS_LEN = 3`/`PREFIX_BUDGET = 30` |
| 🟢 P4 | `frontend/src/core/format.ts` | :30-35 | `LibraryLoadError` 仅按 `name` 结构判断，若对象缺 `loadId`/`phase` 字段则输出 `[undefined/undefined] xxx`——实际构造点（load-manager，ADR-135）总是带字段故无实害，但结构性判断存在此理论缺口，测试未覆盖 | 补缺省值（如 `e.loadId ?? '?'`）或增加缺字段用例固化行为 |
| 🟢 P4 | `frontend/src/core/format.ts` | :12-14 | 负数输入产生无意义输出（`formatTime(-1)` → `"-1:-1.00"`）；测试仅断言"不抛错 + 返回非空字符串"（config.test.ts:64-69），契约未定义 | 若业务不可能出现负时长，在注释中明确"负数未定义"；或钳到 0 并补断言 |
| 🟢 P4 | `frontend/src/__tests__/config.test.ts` | :527 | `beforeEach` 直接 `expandedFolders.clear()` mutate 导出容器，绕过被测函数 `clearExpandedFolders()`（:136）——与 library-state.ts:3"单一写入点"规约精神相悖（测试虽豁免，但顺手调用被测函数可兼验证其幂等） | 改用 `clearExpandedFolders()` |
| 🟢 P4 | `frontend/src/__tests__/config.test.ts` | :506 | `(first as any).push(...)` 测试卫生问题（round-24 旁注已记录，本轮确认仍存在）；生产代码 `as any`/`@ts-ignore` 零命中 | 用 `(first as RecentMotion[]).push(...)` 或 `first.push(...)` 消除断言 |

> 无 🔴 P1 / 🟠 P2。P3 均非本轮引入的新缺陷：2 项为 round-24 遗留确认，1 项为 round-24 已记录断言重复。

## 测试质量评价

- **断言有效性 — 优秀**：89 个用例全部为精确字符串/结构/长度断言（`toBe('01:30.00')`、`toBeNull()`、`toHaveLength` 等价式），无 `toBeTruthy` 形式断言；防御拷贝（:502-510）与去重置顶（:492-500）是"真实验证"而非"走一遍"。
- **边界覆盖 — 全面**：时间格式 9 例（0/秒分进位 60·3600/分数百分秒 12.345·59.999/大值 59999/亚秒 0.5·0.05/NaN·±Infinity/负数）；错误格式 16 例（null/undefined/Error/短字符串/长字符串/数字/布尔/toString 抛错对象/默认 120/恰在 maxLen/极限 maxLen 0·3·4·-5/LibraryLoadError 前缀·嵌套 Error·长输出截断·null cause·非 LLE 对象走 String）；库状态 8 例（增/去重/置顶更新/防御拷贝/上限 10/数组性/展开折叠往返/清空）；路径安全 30+ 例（`..` 逃逸/反斜杠绝对路径绕过/伪文件夹 MMD≠MMDS/大小写不敏感/空 root/content:// URI）。**唯一缺口**：LibraryLoadError 缺 loadId/phase 字段用例（P4，理论缺口），以及负时长仅"不抛错"弱断言（P4）。
- **无跳过测试**：grep `.skip(`/`.todo(`/`.only(`/`xit(` 零命中，89 用例全部真实执行。
- **可运行性**：实测 `npm run test -- src/__tests__/config.test.ts` → **89/89 通过（13ms）**，与项目基线一致；`npm run check` 因只读审核未改码跳过，不影响结论（可在主模型汇总轮补跑）。
- **总体**：作为 format + library-state 组合测试，断言手法扎实、边界覆盖远超"冒烟"级别，与 round-15/round-24 单测互补无重叠冲突（唯一重复的 clearExpandedFolders 用例已列 P3/P4）；扣分项集中在 formatError 截断重复（P4）与既有测试卫生遗留（P4）。

## 审核员备注

- 依赖分析：format.ts 零 import；library-state.ts 仅 `import type` from `./types`（:6）；path/image/escape-html 零依赖；library-path.ts 依赖 `@/core/state`（barrel，`export * from './library-state'`，state.ts:16）→ live 绑定成立，测试 `setLibraryRoot` 与 library-path 读取同一变量（config.test.ts 依赖此活绑定，实测通过）。无循环依赖。
- 资源释放：本范围内无 `new` 需 `dispose()` 对象（Map/Set/数组为值语义容器），无 Observer 泄漏面。
- 状态流：`setLibraryRoot` 在 computeLibraryRef/resolveLibraryRef 两个 describe 间由 beforeEach 重置，无跨 describe 泄漏；vitest 默认 isolate 下无跨文件泄漏。

---

审核日期：2026-08-15
审核员：子代理 round51-config
