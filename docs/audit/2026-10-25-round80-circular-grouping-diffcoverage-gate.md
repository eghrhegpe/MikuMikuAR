# round80：守卫层登记 P1 落地（circular 模块分组 / diff-coverage 真阻断）

> 审核日：2026-10-25｜轮次：round-80｜范围：守卫层登记项清偿
> 承接：round-79 报告（docs/audit/2026-10-25-round79-gate-scripts-p1.md）登记 2 项 P1，用户已授权处理（"着做守卫层登记的 2 项 P1（circular 分组 / diff-coverage 阻断）"）。

## 一、P1-① check-circular 模块分组（潜在风险，非活 bug）

### 发现（round79 S3 登记）
`scripts/check-circular.mjs` L65-80 `getModule()`：`if(parts.length===1) return 'core';` 把 src 根目录单层文件折叠进 core。src 根实际只有 `frontend/src/config.ts`（另有 2 个 .d.ts 被 EXCLUDE_FILES 排除），config.ts 正文仅一条 type-only re-export：`export type { EnvState } from './core/types';`。

S3 原报告推断"剔除根文件后代表环 551→139"，本次实测为**过度归因**：那是把整个 core 节点（含 539 个代表环的真实紧耦合）拿掉的推算，不是 config.ts 单个根文件的贡献。

### 实证（probe_circ.mjs，已删）
用 production 同源口径 `scanSourceGraph(SRC_DIR,{scope,includeDynamic:false}) + buildModuleGraph + detectCycles + representativeCycles + dedupeCycles` 对比 OLD(`'core'`) vs NEW(`'src-root'`)：
- 两者代表环**均为 551**，白名单外 0；
- config.ts 在两个版本里都是 **0 边孤立节点**（类型边被 source-graph 丢弃、无人 import 它，core 的 143 个 Ca 里 config 从未算入边）。

→ **结论：当前无假环，P1 属潜在风险而非活 bug**。修复价值在于堵住未来：一旦 config.ts 出现运行时 import 边，它会把无关边静默并进 core 图、膨胀 core↔menus 假环。

### 修复
1. `scripts/check-circular.mjs` L75：`if (parts.length === 1) return 'src-root';`（附 round80 P1 注释：根文件不折叠进 core，core 是真实紧耦合模块）；getModule JSDoc L62-67 补说明。
2. `scripts/_lib/circular.test.mjs` L130-132：模块图断言 `['core']` → `['src-root']`、`moduleGraph.get('src-root')`；L190 `getModule('utils.ts')` → `'src-root'`（均附 round80 P1 注）。

### 验证
- `node --test scripts/_lib/circular.test.mjs`：**25/25 绿**（183ms）。
- `node scripts/check-circular.mjs --strict --json`：modules **14→15**（新增 src-root）、repCycles **551**、known **551**、new **0**、exit **0**。
- `npm run check:layering`：✅ 通过（R1 0 条，R2/R3 13 条 / 基线 13）。
- 白名单无需 `--update-allowlist`：白名单 key 用 `cycleSetKey`（节点集合），config.ts 无环，改分组不改变任何环的集合。

### 副作用：dep-metrics 台账需重生成
`node scripts/dep-metrics.mjs --check` → ❌ 未同步。用 `diff <(node scripts/dep-metrics.mjs) docs/dep-metrics.md` 核实**仅以下差异**（用户 WIP 未污染口径）：
- 模块数 14 → 15；
- 模块耦合矩阵新增空的 `src-root` 行列（对角线 ·，全空）；
- core 的 Ca 143 → 142（config.ts 迁出 core）；
- 新增 `src-root` 行：Ca=1 / Ce=0 / I=— / 代表环 0；
- 文件数 377、边 1822、代表环 551 均不变。

→ 属分组口径修正的预期结果，提交时由 pre-commit 钩子自动重生成 `docs/dep-metrics.md`（边/环数不变，仅登记新模块）。`getModule` 消费者：check-circular.mjs L86/L94、dep-metrics.mjs L111、scripts/_lib/circular.test.mjs。

## 二、P1-② test:diff-coverage 阻断政策（门禁形同虚设，已修）

### 发现
- `frontend/package.json` L33 `test:diff-coverage` = `node ../scripts/check-diff-coverage.mjs`。
- `scripts/check-diff-coverage.mjs` 头注释 L6-14 声明**双模式契约**：阻断模式（pre-push 不加 `--suggest`，低于阈值 exit 1 拦 push，git 失败 exit 2 终止）+ 非阻断建议模式（prepare-commit-msg 的 `hooks/coverage-hint.mjs` 用 `--suggest --staged`，恒 exit 0）。判断依据仅看是否带 `--suggest`。退出码：0=达标 / 1=有未达标文件 / 2=配置或 git 失败。
- `.githooks/pre-push` L572-616 调用链：`npx vitest run --changed $CHANGED_BASE --coverage --coverage.clean=false --coverage.thresholds.*=0` 成功后才跑 diff-coverage；日志无"Test Files"（0 测试命中）则整块跳过（L612-616）。
- **根因**：L588 文案写"仅建议不阻断"；L609-610 用 `note_check "⏭️ diff-coverage（历史遗留，建议记录到 ADR-254）"` —— 非零退出被吞成一条 ⏭️ 注释，门禁形同虚设。脚本头已声明阻断，钩子却只 note。

### 修复（.githooks/pre-push 两处）
1. L588 echo 文案：`（新代码保护: 变更行 ≥60%，仅建议不阻断）` → `（新代码保护: 变更行 ≥60%，失败阻断推送）`。
2. L609-610：`note_check "⏭️ diff-coverage（历史遗留，建议记录到 ADR-254）"` → `collect_fail "diff-coverage 失败: 本次变更源码的变更行覆盖率不足 60%（补测试后重推；确为历史遗留债请记录到 ADR-254 而非 --no-verify 绕过）"`，并附 round80 P1-② 注释。

### 决策依据
- 用户已明说"阻断"，故直接 collect_fail 真阻断（不再询问建议/阻断二选一）。
- 对 exit 1（覆盖率不足）与 exit 2（配置/git 失败）统一 collect_fail = **fail-closed**；脚本头本就声明 exit 2 应终止。
- 逃生阀 `git push --no-verify` 仍在（pre-push L5 有说明，不推荐）。

### 验证
- `bash -n .githooks/pre-push`：✅ 语法通过（collect_fail 为钩子既有摘要累积函数，非新增机制）。
- 建议模式不受影响：prepare-commit-msg 的 coverage-hint.mjs 仍走 `--suggest --staged`（恒 exit 0），提交提示不变。

## 三、验证汇总

| 门禁 | 结果 |
|------|------|
| `node --test scripts/_lib/circular.test.mjs` | ✅ 25/25 |
| `node scripts/check-circular.mjs --strict --json` | ✅ modules=15 / repCycles=551 / known=551 / new=0 / exit 0 |
| `npm run check:layering` | ✅ R1 0 条，R2/R3 13 条 |
| `bash -n .githooks/pre-push` | ✅ 语法通过 |
| `node scripts/dep-metrics.mjs --check` | ⏳ 待 pre-commit 重生成台账（预期：模块数 15） |

## 四、状态段
- round-79 报告登记的 2 项 P1 全部落地：P1-① 改模块分组为 src-root（潜在风险堵口，实测无假环）；P1-② diff-coverage 由 note_check 改为 collect_fail 真阻断（fail-closed）。
- 未修登记维持：round79 P1-② 政策决策项、P4-1（supersede #12 复刻判定式，待 scan-files.mjs 加 env 钩子）/ P4-2（check-diff-coverage #8 blob-diff 依赖 HEAD 真实文件）——不阻断。
- 提交后 pre-commit 将同步重生成 `docs/dep-metrics.md`（模块数 14→15）与 `docs/function-map.md`（config.ts 归属变动）。
