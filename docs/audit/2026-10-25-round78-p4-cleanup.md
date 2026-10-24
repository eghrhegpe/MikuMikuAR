# Round-78 审核报告 — P4-3 ratchet 收紧 + #19/#20 登记项清偿

> 日期: 2026-10-25 ｜ 承接 round-77 报告「P4 登记项」与 round-76c #19/#20
> 模式: 主模型直改（#20/P4-3/基线/package.json）+ 子代理 #19（锁文件制）

## 落实内容

| 项 | 文件 | 动作 |
|---|---|---|
| P4-3 | frontend/src/core/action-defs/motion-actions.ts:291,311 | 删 _buildLevel 后冗余非空断言 x2（本地函数声明 L73，! 无对象可收窄）；tsc exit 0 + action-defs 两测试文件 31/31 绿 |
| 基线收紧 | docs/.assertion-baseline.json | check-assertion-baseline.mjs --update: nonNull 123 -> 121（只许降），motion-actions.ts perFile 条目整组出账（原 2 处 nonNull 清零） |
| #20 | scripts/check-cli.smoke.test.mjs L47-53 | 定义路径改动态取自 check-consumers --json 的 definitions[0]（text 输出 includes(firstDef)）；探针符号 FootLandEvent 保留（ADR-238 台账契约） |
| #20 | scripts/check-cli.smoke.test.mjs L64-68 | --json definitions 结构断言「<rel>:<line>」形态（every 正则），删钉死路径 .some(includes('feet-event')) |
| 夹具注册 | package.json test:scripts（L57） | 补挂 scripts/__tests__/check-deadcode-baseline.test.mjs（round-77 R3 新建漏挂）；npm run test:scripts 17 文件 fail 0 |
| #19 | scripts/__tests__/codemod.test.mjs | 补 4 用例：ensureImport 合并（目标已有同名模块 import → 合并命名不新增声明，断言恰 1 条 from './strings'）；namespace import * as helper → 打「命名空间 import 需手动迁移」且目标不重复加；rename 后 grep 字符串残留 → 报「可能包含未更新的字符串引用」；rename 纯标识符 → 「grep 未检出旧名残留」。子代理 170cd2ce 两轮失败（误诊 path.join 造 Windows 绝对路径——实为 toPosix 相对），主模型接手补全 |

## 验证

| 项 | 结果 |
|---|---|
| cd frontend && npm run check（tsc） | exit 0 |
| vitest action-defs.test.ts + action-defs-extra.test.ts | 31/31 绿 |
| node scripts/check-assertion-baseline.mjs | 121/121 exit 0（收紧后复跑） |
| node scripts/check-cli.smoke.test.mjs | exit 0（32/32） |
| npm run test:scripts | 17 文件 fail 0（~12.7s，含新挂 knip 夹具） |
| node scripts/__tests__/codemod.test.mjs | 15/15 pass exit 0（#19 补 4 用例后首跑 2 fail，暴露生产 bug 已修） |

## 状态

- round-76c 风险表 20 项全部归零：#1-#18 于 round-76/77 落地，#19/#20 本轮清偿（#20 顺带去两处稳态硬编码）。
- 断言 ratchet 轨迹：133 →（5dae3abc 收口 10 处）123 →（P4-3 删 2 处冗余）121；perFile 中 motion-actions.ts 条目出账。
- 余登记项（不阻断）：P4-1 supersede.test #12 组合用例复刻判定式（待 scan-files.mjs 加 env 钩子后走生产）；P4-2 check-diff-coverage #8 blob-diff 用例依赖 HEAD 真实文件（生产 git() 钉死 REPO_ROOT，受限 accept）。

## 发现的生产 bug（P2，已修）

- **codemod.mjs:443** move-function 路径 `if (!topStmt.wasRemoved && !topStmt.wasRemoved())` 守卫写反：ts-morph Node 无 wasRemoved 方法，`!undefined` 恒 true → 下一句必调 wasRemoved() 抛 TypeError。**触发面 = 源文件含 import 的 move-function**——既有 fixture 源文件无 import（getStatements() 空循环）故此前 11/11 全绿。由 #19 新增用例首跑 2 fail 暴露。
- 修复：L443 → `if (!topStmt.wasRemoved?.())`（可选链），[fix P2 round78 #19] 注释写明根因与触发面。全仓 grep wasRemoved 仅此 1 处。重跑 codemod.test.mjs 15/15 pass exit 0。