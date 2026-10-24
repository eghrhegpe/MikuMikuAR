# Round-79b 审核报告 — codemod.mjs 同类问题深挖 + scan-files / source-graph 审计

> 日期: 2026-10-25 ｜ 模式: 只读子代理审核（未改任何生产文件，未跑全量测试/check/pre-push）
> 范围: scripts/codemod.mjs（653 行，续 round-78 L443 已修之处继续审整文件）、
>        scripts/_lib/scan-files.mjs、scripts/_lib/source-graph.mjs 及其消费端（check-circular.mjs / dep-metrics.mjs / check-layering.mjs）
> 验证手段: 只读源码 + 单文件 node fixture 复现（临时目录，已删）

## 总体结论

round-78 修掉的 L443 `wasRemoved` 守卫写反只是 codemod.mjs **同族缺陷中最浅的一个**：同一批「守卫是打印而非阻断」「先改文件后校验」「收集口径漏类」的旧债在本文件里还有 3 处，其中最重的是 **move-function 的 namespace import 迁移路径——守卫形同虚设，会真实地把两个源文件改坏并退出 1**（已用 fixture 复现，见 R1）。rename-function 的 grep 残留判定也存在可复现的假阴性/假阳性（R3）。诊断门禁 `assertNoNewDiags` 在 `project.saveSync()` **之后** 才运行，是上述「改坏即失败」的共同根因，属于 P1（R2）。scan-files.mjs 的 getRoot 钉死是测试可注入性缺口（P4-1，附最小改法，需同步处理 SRC_DIR 常量化这个连带问题）。source-graph.mjs 本体过滤口径与消费端一致、环检测无漏环无误报；唯一不一致在 check-circular.mjs 的 `findImportLine` 用正则复扫——它仍在匹配**动态 import 边**，而图本身已按 ADR-268 `includeDynamic:false` 排除，构成 `--diff` 归因的「自相矛盾」。

## 亮点

1. **退出码语义基本一致且 fail-closed**：`--strict`/`--update-allowlist`/`--diff --strict`/reviewBy 到期都正确 exit 1；白名单「只减不增」护栏（check-circular.mjs:402-416）防静默吸收回归，是真正的 fail-closed 设计。
2. **L443 守卫修复是「可选链 + 注释触发面」的范本**（codemod.mjs:443-446 `if (!topStmt.wasRemoved?.())`），注释里写清了触发面，后续维护不会再次踩空。
3. **round-78 补的 4 个 codemod 用例确实有杀伤力**（ensureImport 合并 / namespace 告警 / grep 残留 / grep 无残留），直接暴露了 L443 缺陷；本报告 R1/R3 的复现都建立在它的 fixture 方法（CODEMOD_FRONTEND + spawn CLI）之上，该方法可靠。
4. **source-graph.mjs 的类型边口径已收敛**（import-scan + isTypeOnlyBody，剔除 `import type` 与类型位置动态 import），并留有 buglog 链接（source-graph.mjs:60-69）说明旧正则「注释吞边」根因；import-scan.mjs 状态机为线性扫描，无回溯分支。
5. **check-circular.mjs detectCycles 不漏环**：Johnson 简化版 DFS（每个环以字典序最小节点为起点、只访问 `> start` 节点）保证每个环恰好报一次，钻石结构不丢（check-circular.mjs:121-140），并有 2026-08-06 P1 注释记录旧 DFS 后向边算法漏报的历史教训。

## 风险表

| 级别 | 文件:行号 | 问题 | 建议修复 |
|---|---|---|---|
| **P1** | scripts/codemod.mjs:510-521（+500-507） | **fail-open 与部分写入**：`assertNoNewDiags`（L521）在 `project.saveSync()`（L520）**之后**运行，一旦类型校验失败只 `exit 1`，但**两个源文件已在磁盘上被改坏**。R1 复现显示 `math.ts` 只剩一条 `export { calc } from './util'`、`util.ts` 挂着引用未定义 `helper` 的函数体——「失败」留下不可用的中间态。 | 把 `project.saveSync()` 移到 `assertNoNewDiags` 之后：`assertNoNewDiags('move-function', baseline); project.saveSync();`。校验失败时所有 SourceFile 只在内存中、磁盘零改动，用户可安全重跑。rename-function（L336-338）与 add-param（L581-582）同型，一并调整。 |
| **P1** | scripts/codemod.mjs:494-507（namespace 守卫） | **守卫是打印而非阻断**：`if (ui.namespace) { console.log('需手动迁移'); continue; }` 只是跳过 ensureImport，然后**函数体照常写入目标文件**（L510）。目标文件若已有同名 namespace import 则侥幸通过；若没有则 `helper` 未定义，类型门禁在保存后才发现，exit 1 + 源文件已损坏（同 R1）。这是 L443 的同类病：`if` 里没 `return/exit`，守卫名存实亡。 | 在 L495 循环内改为：`if (ui.namespace) { const destHas = destSf.getImportDeclarations().some(i => i.getModuleSpecifierValue() === ui.moduleSpecifier && i.getNamespaceImport()?.getText() === ui.namespace); if (!destHas) { console.error('❌ 函数体引用命名空间 import，目标文件无同名命名空间导入，无法自动迁移，请手动处理: ' + ui.moduleSpecifier); process.exit(1); } continue; }`——前置阻断，不做任何修改。 |
| **P2** | scripts/__tests__/codemod.test.mjs:279-296 | **测试固化了错误的期望**：namespace 用例的 fixture（util.ts 已 `import * as helper`）恰好让「跳过 ensureImport」也能通过类型检查，于是断言 `r.code === 0`，把「命名空间跳过但恰好不报错」当成正确行为，反而掩盖了 R1 的破坏路径。 | 改为**双用例**：(a) 目标已有同 namespace import → 断言 exit 0 + 恰 1 条 import（保留现有断言）；(b) 目标**无** namespace import → 断言 exit 1 + stderr 含「无法自动迁移」+ **断言磁盘未改动**（`src/math.ts` 仍含 `function calc`、`src/util.ts` 无 `calc`）。第 (b) 条能同时锁住 R1 与 R2。 |
| **P2** | scripts/codemod.mjs:347-349（grep 残留过滤） | **残留判定用整行子串**：`hits.filter(h => h.includes(oldName) && !h.includes(newName))`。`h` 是 `相对路径:行号: 内容` 的整行字符串，于是 (a) 同一行里既含新名又含旧名残留 → 整行被丢 → **假阴性**（新名是旧名超集时必现）；(b) `padding`/`road` 等含 `add` 的无关标识符/注释/字符串 → 整行被报 → **假阳性噪声**。grepString（L111-143）也是整行 `regex.test(lines[i])`。 | 逐行改成**逐匹配 token 判定**：对每个匹配位置，先断言该 token 不是新名的标识符片段（用词边界 `/[A-Za-z0-9_$]/` 检查），再收集残留位置；只有**整行所有命中都被新名覆盖**时才视为「已更新」。同时把 grepString 的 `regex.test` 保留为文件级粗筛，行级判定改为 `matchAll` + token 级过滤。 |
| **P3** | scripts/codemod.mjs:344-363 与 496-507 | **告警不改变退出码**：rename-function 检出 grep 残留只打印 `⚠️` 后继续 exit 0（L350-357）；move-function 命名空间「需手动迁移」同样 exit 0（L497）。与文件头「退出码：1 / 0（含失败码）」以及「有告警 1」的语义不一致；用户靠 `$LASTEXITCODE` 判断时会漏过需要人工接续的场景。 | 二选一并写进文件头：要么统一「诊断性告警 exit 1、纯提示 exit 0」，要么把 grep 残留/命名空间未迁移提升为**前置阻断**（建议后者，见 R1 改法），告警自然消失；避免「改了东西却返回 0」的模糊状态。 |
| **P3** | scripts/_lib/scan-files.mjs:34-35（连带 SRC_DIR） | **env 钩子只加到 getRoot 不够**：本模块在加载期就把 `ROOT`/`SRC_DIR` 固化为常量，消费端（check-circular.mjs:41、dep-metrics.mjs:34、check-layering.mjs:37-44）多在**自身加载期** `path.join(ROOT, ...)` 派生 SRC_DIR，因此**在 import 之后设 env 无效**。 | 见下方「P4-1 env 钩子最小改法」：把 `getRoot()` 改为每次读 env，并**同步把 SRC_DIR 常量改为函数或惰性 getter**，消费端改用函数；测试侧用 `await import(url + '?t=' + Date.now())` 重载，避免污染真实环境。 |
| **P2** | scripts/check-circular.mjs:304-328（findImportLine） | **与 ADR-268 图口径自相矛盾 + 复用已知致命正则**：`reDyna`（L314）仍在匹配 `await import('…')`，但本图已在 L391 `includeDynamic:false` 排除动态边。`--diff` 归因时可能把一条**根本不在环路径上**的动态 import 当成「新增边」，制造假「新增环」归因；同时 L311 的 `reFrom` 正是 source-graph.mjs:60-63 buglog 记录的**指数回溯**正则（`[^'"]` 与 `/\*[\s\S]*?\*/` 共享起始字符 `/`），在含注释+含 `from` 语句的源文件上可能卡死。 | (a) 删掉 `reDyna`，并删除 L311/L313 中 `(?:\/\/[^\n]*\n)*` 这种易回溯的前缀，改为复用 `_lib/import-scan.mjs` 的 `scanImportSpecs` 逐条定位行号（`index` 字段已提供语句起始偏移），彻底废弃自造正则；(b) 至少给 `reFrom` 加上回溯上限或改用 `scanImportSpecs`，避免重蹈「注释吞边/卡死」覆辙。 |

### 已核实**不是问题**的点（避免误报）

- **source-graph 与消费端 EXCLUDE 口径一致**：`EXCLUDE_DIRS`（source-graph.mjs:7）与 `EXCLUDE_FILES`（:8）由 `walkSourceFiles`（:22-30）统一施加，check-circular.mjs / dep-metrics.mjs 都走 `scanSourceGraph` 这一入口，测试文件（`__tests__`/`__mocks__`/`*.test/spec`）被一致剔除；`wailsjs`/`bindings`/`dist` 也一致剔除（check-circular.mjs buildModuleGraph L87 的 `module === 'test'` 是冗余防御，不影响口径）。
- **check-layering.mjs 的 skipFile `\.(d|test|spec)\.tsx?$` 少排 `.gen.ts`**，但全仓 `.gen.ts` 文件为 0（glob 实测），且 check-layering 不消费 source-graph，无实际影响——若将来出现 `.gen` 文件会与 `gen-doc-drift` 门禁冲突，列为观察项。
- **detectCycles 无漏环/无误报**：模块图节点少（~20），指数 DFS 可接受；`dep > start` 剪枝与「最小节点为起点」自洽，自环（单文件自导入）已在 buildModuleGraph L97 剔除，不产生噪声。
- **ensureImport（L296-323）合并逻辑正确**：默认+命名合并、去重、同 moduleSpecifier 单声明；namespace 因调用方已过滤而不会被误加。
- **L464-485 import 清理分支**：named/default 三种分支边界完整，`setDefaultImport(undefined)` 只在 `namedBindings.length > 0` 分支内触发，不会造出 `from 'x'` 无绑定语法；side-effect import（无绑定）不会被 `resolveFunctionImports` 收录，因此不会被误删。

## P4-1 env 钩子最小改法（具体到行）

**现状**：`scripts/_lib/scan-files.mjs:25-27`

```js
/** 仓库根目录。 */
export function getRoot() {
  return path.resolve(__dirname, '..', '..');
}
```

`__dirname` 由 L22 的 `fileURLToPath(import.meta.url)` 派生，等于把仓库根钉死到模块所在层级。仿照 codemod.mjs:46-49（`CODEMOD_FRONTEND`）与 check-assertion-baseline.mjs:41-46（`ASSERTION_SRC` / `ASSERTION_BASELINE`）的模式，最小改法：

**改法 A（推荐，4 行内）** — 在 L25-27 之间插入：

```js
export function getRoot() {
  // 测试钩子：SCAN_ROOT 指向 fixture 仓库根（真实运行不设该变量，不受影响）
  return process.env.SCAN_ROOT
    ? path.resolve(process.env.SCAN_ROOT)
    : path.resolve(__dirname, '..', '..');
}
```

**连带改法 B（必须一并做）** — L30-35 现在写的是：

```js
export function getSrcDir() {
  return path.join(getRoot(), 'frontend', 'src');
}
export const ROOT = getRoot();      // L34
export const SRC_DIR = getSrcDir(); // L35
```

`ROOT`/`SRC_DIR` 在**加载期**固化，仅改 A 不足以让消费端（check-circular.mjs:41 `const SRC_DIR = path.join(ROOT, 'frontend', 'src')`、dep-metrics.mjs:34、check-layering.mjs:37-44 的 `REPO_ROOT`/`SRC_ROOT`）在**它们自己加载后**再响应 env。最小改法：

- 把 L34 `export const ROOT = getRoot();` 保留不动（向后兼容，但标注 deprecated），**新增** `export function getRepoRoot() { return getRoot(); }`；把 L35 改为 `export function getSrcDirNow() { return path.join(getRoot(), 'frontend', 'src'); }`（惰性，每次取实时值）。
- 消费端把 `const SRC_DIR = path.join(ROOT, 'frontend', 'src')` 改为 `getSrcDirNow()` 或在函数体内 `path.join(getRoot(), 'frontend', 'src')`。
- 测试侧（`scripts/__tests__/supersede.test.mjs` #12）：`process.env.SCAN_ROOT = fixtureDir; await import('../_lib/scan-files.mjs?cachebust=' + Date.now());`，跑完 `delete process.env.SCAN_ROOT`——必须**在 import 之前**设置，且要用动态 import + 查询参数破缓存，才能绕过 ESM 单例。

**改法 A 与 B 的取舍**：A 单独生效范围窄（仅 `getRoot()` 直调方），B 是让全链路可注入的关键；两步合计约 8 行改动，不引入依赖，不动消费端行为（真实运行时 env 未设，行为与现在完全一致）。若只想为 P4-1 登记项开一条缝、不想动消费端，可退化为**只改 A**，并在 P4-1 测试里直接以 `SCAN_ROOT` + 动态重载验证 `getSrcDir()`；消费端的硬编码路径留作后续收口。

## 未覆盖 / 遗留

- codemod.mjs 的 `ensureImport` 与 `resolveFunctionImports` 对**别名 import**（`import { a as b }`）只取 `ni.getName()`（原名），若函数体用的是别名会漏匹配——本次未做 fixture 验证，建议列入下一轮。
- `findExportDecl`（codemod.mjs:71-108）对同名跨文件导出只取第一个匹配，重复符号场景未验证。
