# 依赖图解析器：行注释含 `/*` 字样时吞掉后续真 import（假阴性丢边）

> **状态**: ✅ 已修复（2026-10-23，ADR-268）

**日期**: 2026-10-23
**严重程度**: 🟠 P2
**影响范围**: `scripts/_lib/source-graph.mjs`（一切下游：dep-metrics、gen-dep-graph、check-circular、check-layering）
**发现方式**: 开发发现（ADR-265 迁移后 AtomCode 独立评审质疑 scene/ui→bridge-slot 两边不在图中，核实为存量盲区）

## 问题描述

`frontend/src/core/scene-action-bridge.ts`、`ui-action-bridge.ts` 明明 `import { createActionBridge } from './bridge-slot'`，但 `docs/dep-graph.md` 里只有 `e2e-state-bridge → bridge-slot` 一条边。更早在迁移前，`scene-action-bridge → ./types` 这条真边**同样一直不在图中**——即图底数 2003 条边里系统性缺了一批边，且缺失不可见。

## 复现步骤

```powershell
# 任一源文件行注释里写了路径 glob（本仓惯用写法，如「切断 core → scene/* 反向依赖」）：
#   // ... → scene/*
# 其后若有 /* ... */ 块注释或 /** doc */，中间的真 import 行全部消失：
node -e "import('./scripts/_lib/source-graph.mjs').then(m => console.log(m.parseSourceImports('frontend/src/core/scene-action-bridge.ts','frontend/src')))"
# 实际输出 []，期望含 bridge-slot / types 两条边
# 对照组：git show 69426ae9~1 的旧版 scene-action-bridge.ts 同样输出 [] → 盲区先于 ADR-265 存在
```

## 根因分析

`source-graph.mjs:64` 的块注释剥离正则：

```
text.replace(/\/\*[\s\S]*?\*\//g, ...)
```

它先于 import 正则执行且**不区分行注释内部**。行注释 `// ... → scene/*` 结尾的 `/*` 被认作块注释起点，惰性匹配一直吞到文件里下一个真正的 `*/`（通常是某个 `/** doc */` 块或下一个路径 glob 的 `*/`），被跨越的 import 行整行置空 → 边丢失。方向与 P2（2026-08-06 修的反向：块注释里的 import 字样产生**假边/假环**）相反：那次修复引入的是**假阴性**——门禁宁肯漏报的盲区类型，check-circular 靠白名单棘轮也无法暴露（环不存在于图，就永远不报）。

## 修复方案

治本已由并行会话立案：`scripts/_lib/import-scan.mjs`（线性扫描，无 `[\s\S]*?` 跨语句匹配），见 `source-graph.mjs:61-63` 的 [P4 2026-10-23] 注释与 ADR-254 B9；迁移必须做旧 vs 新全量 diff（受 `check:circular --strict` 门禁约束）。本条 buglog 只登记假阴性事实与复现，修复提交以 import-scan 迁移落地为准。

## 教训

1. **注释剥离器的输入是"源码+注释"混合体**：任何 `/*`-触发正则都必须先做行注释/字符串的掩码，否则文档里写路径 glob 这种无害行为会改变图的拓扑。
2. **度量工具的盲区比代码 bug 更隐蔽**：代码 bug 会让程序报错，图漏边只会让台账"更漂亮"——所有基于图的棘轮（Ca/Ce、环数、分层基线）读数在此盲区下均为**下界**，引用时须注明。

## 修复记录（2026-10-23）

`scripts/_lib/source-graph.mjs` 的 `parseSourceImports()` 改为调用 `_lib/import-scan.mjs` 的线性状态机，
块注释剥离正则整体删除。复现用例现在返回
`[{path:"core/bridge-slot.ts"},{path:"core/types.ts"}]`（原 `[]`）。

旧 vs 新全量 diff（362 文件）：`oldEdges=2005 → newEdges=2020`（+16 / −1）。16 条新增边逐条 grep
核实为真实（`scene/scene.ts:599/605/648/660/681`、`core/dev-hooks.ts:50`、`menus/model-detail.ts:250/618` 等）；
唯一移除项是旧实现产生的假自环 `core/fileservice.ts → core/fileservice.ts`。
顺带修掉第二个假阴性：旧 `reDyna` 正则要求 `await import(`，**无 await 的动态 import 全部漏检**，
16 条新增边的主因在此。

暴露的连带问题（265 个「新增环」全部由动态边派生）与处置见 ADR-268。
