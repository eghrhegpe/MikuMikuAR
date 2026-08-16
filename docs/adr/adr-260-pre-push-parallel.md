# ADR-260: pre-push 检查并行化

**状态**: ✅ 已采纳
**日期**: 2026-08-18
**议题**: pre-push 钩子串行执行导致 push 等待时间过长

## 背景

pre-push 钩子当前是**串行执行**所有检查：
```
check:status → check:funcmap → ... → lint → vitest → tsc
```

总耗时 = 各检查耗时之和。在混合变更场景下（TS+Go+Docs），push 等待时间可达 10s+。

## 决策

将**独立检查**分组并行执行：

| 组 | 检查项 | 依赖 | 并行理由 |
|----|--------|------|---------|
| A | status/funcmap/docsindex/novelindex/menumap/guide-gap | 无 | 纯 Node.js 脚本，无状态共享 |
| B | tsc/lint:changed | TS 变更时触发 | 两个独立工具，无交叉依赖 |
| C | i18n/check:docs/link:check/check:md-links | 无 | 完全独立，无状态共享 |
| D | bindings | Go 变更时触发 | 独立，可与 A/C 并行 |

**约束**：
- 保持 collect-all 模式（所有检查跑完再报告）
- 保持错误收集逻辑（SUMMARY_CHECKS/SUMMARY_FAILURES）
- 确保输出顺序一致（便于调试）

## 实现

使用 `&` + `wait || true` 在 `set -e` 下安全并发：

```bash
# 并行辅助函数
_parallel_wait() {
  local rc=0
  for _pid in "$@"; do
    wait $_pid || rc=$((rc + 1))
  done
  return $rc
}

# 组 A：文档生成并行
_par_init
_check_status & _pid_a1=$!
_check_funcmap & _pid_a2=$!
...
_parallel_wait $_pid_a1 $_pid_a2 ... || true
_par_merge
_par_cleanup
```

**结果传递**：通过临时文件在子进程间传递 `note_check`/`collect_fail`/`note_fixed` 调用。

## 效果

| 场景 | 优化前 | 优化后 | 提升 |
|------|--------|--------|------|
| 纯 Go 变更 | 4.3s | 4.1s | ~5% |
| 纯文档变更 | ~6s | ~4s | ~33% |
| 混合变更（预估） | ~11s | ~8s | ~30% |

## 风险

1. **竞争条件**：guide-gap 与 menumap 可能读取不同版本的 menu-map.md，最坏情况是误报，重推即可。
2. **amend 操作**：多个并行组同时 amend commit 可能导致冲突，但当前设计确保只有组 A 和 C 并行，bindings（组 D）串行执行。

## 附录

- 修改文件：`.githooks/pre-push`
- 相关 ADR：ADR-258（tsc 类型检查）
