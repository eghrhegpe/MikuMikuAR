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
2. **输出交错**：组 A 与组 C 同时运行时输出行可能交错，但摘要（`finalize_results`）统一排序，不影响可读性。

## 演进

### Phase 2（2026-08-18）：组 A ∥ 组 C 真正并行

**背景**：初期实现中组 A 和组 C 是串行的（A 跑完→C 跑），但 A 和 C 完全独立、无状态共享。

**改动**：将组 A 和组 C 的 `_par_init`→`fork`→`_parallel_wait`→`_par_merge` 流程合并，两组同时启动：

```
之前: A(1.3s) → [串行0s] → C(1.3s) = 4.1s
现在: A(1.3s) ∥ C(1.3s) → merge = 3.3s（-18%）
```

**实现细节**：
- 使用独立 `_PAR_DIR_A` / `_PAR_DIR_C` 避免文件冲突
- 新增 `_par_merge_dir()` 函数，接受目录参数分别 merge
- `ALL_PIDS` 变量收集两组所有子进程 pid，统一 `_parallel_wait`

### Phase 3（2026-08-18）：输出降噪

**改动**：移除 4 条跳过头行（lint/tsc/test/deadcode 的 `[pre-push] xxx（跳过）`），跳过项只出现在摘要中。

**效果**：输出从 35 行降至 31 行，性能不变。

### 风险移除

Phase 2 同时移除了 pre-push 中的 `git commit --amend`（见 ADR-259 演进），**"多个并行组同时 amend commit" 风险已不存在**。

## 效果（更新）

| 场景 | 优化前 | 优化后 | 提升 |
|------|--------|--------|------|
| 纯文档变更（warm） | 4.1s | 3.3s | ~20% |
| 纯文档变更（cold） | 6.2s | 5.0s | ~19% |
| 输出行数 | 35 | 31 | ~11% |

## 附录

- 修改文件：`.githooks/pre-push`
- 相关 ADR：ADR-258（tsc 类型检查）、ADR-259（缓存机制）
