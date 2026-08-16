# ADR-259: pre-push 检查缓存机制 — 基于文件哈希的缓存，避免重复计算

> **状态**: 🔄 部分采纳（2026-08-17）
> **日期**: 2026-08-17

## 背景

pre-push 门禁每次 push 都重新运行所有检查，即使文件未变更，造成时间浪费：

```
commit A → tsc (3s) + lint (2s) + vitest (20s) = ~25s
commit B (仅改 docs/) → 仍跑 tsc + lint + vitest = ~25s（浪费）
```

预估日常开发中 **60-70%** 的提交可跳过部分检查：
- 纯 docs/ 提交：跳过 tsc、lint、vitest
- 纯 go/ 提交：跳过 tsc、vitest
- 纯 .github/ 配置：快速放行

## 决策

**选择方案 A + 文件哈希缓存**（最小改动、复用现有基础）

### 缓存策略

| 检查 | 缓存键 | 缓存值 | 失效条件 |
|------|--------|--------|----------|
| tsc | tsconfig.json + frontend/src/**/*.ts 哈希 | 退出码 + 错误信息 | TS 文件变更 |
| lint | 变更 TS/JS 文件列表哈希 | lint 结果 | 文件变更 |
| vitest | CHANGED_BASE + 变更文件哈希 | 测试结果 | 测试或源码变更 |

### 缓存位置

```
~/.cache/mikimikuar/pre-push/
  <hash> → { result: "pass", timestamp: 1234567890 }
```

### 有效期

- TTL: 24 小时
- 显式清除: `npm run check:cache`

## 技术实现

### 1. `scripts/domain-map.mjs` 扩展

新增缓存工具函数：
- `cacheKey(domain, files)` → MD5 hash
- `cachePath(key)` → 缓存文件路径
- `readCache(key)` → 读取缓存（含过期检查）
- `writeCache(key, result)` → 写入缓存
- `clearCache()` → 清除所有缓存

CLI 新增模式：
```bash
node scripts/domain-map.mjs --cache-key <domain> <files>   # 生成缓存键
node scripts/domain-map.mjs --cache-path <key>             # 获取缓存路径
node scripts/domain-map.mjs --cache-clear                  # 清除缓存
```

### 2. `.githooks/pre-push` 修改

新增工具函数：
- `cache_lookup(domain, files)` → 输出 "hit" 或 "miss"
- `cache_write(domain, files, result)` → 写入缓存

集成到三个检查点：
- lint: 同文件组合命中则跳过
- tsc: tsconfig + 所有 TS 文件哈希命中则跳过
- vitest: 测试范围命中则跳过

**仅缓存成功结果**，失败不缓存以便重试。

## 约束

1. 不破坏现有流程（fail-safe）
2. 缓存失败不影响检查执行
3. 仅缓存 pass 结果，fail 不缓存
4. 24h TTL 自动清理过期缓存

## 影响

### 修改文件

- `scripts/domain-map.mjs` — 新增缓存支持（向后兼容）
- `.githooks/pre-push` — 集成缓存逻辑
- `package.json` — 新增 `check:cache` 脚本

### 需要同步修改

无。缓存是透明优化，不改变检查逻辑。

## 预期收益

| 场景 | 原耗时 | 缓存命中 | 节省时间 |
|------|--------|---------|---------|
| 纯 docs/ 提交 | ~70s | 全部命中 | ~70s |
| 纯 go/ 提交 | ~35s | 全部命中 | ~35s |
| 纯 frontend/ 提交 | ~70s | 部分命中 | ~20-50s |
| mixed 提交 | ~70s | 低命中率 | ~5-10s |

**平均节省**: ~40s per push（原 70s → 新 30s）

## 备选方案

| 方案 | 优点 | 缺点 |
|------|------|------|
| 方案 A（已选）+ 哈希 | 最小改动，复用 domain-map | 缓存键较粗 |
| 方案 B：文件内容哈希 | 更精细 | 需要读取所有文件内容，可能比检查本身更慢 |
| 方案 C：检查范围标记 | 最简单 | 无法区分同范围的不同提交 |

## 相关文档

- [ADR-258](./adr-258-pre-push-门禁分层与改动面分流.md) — pre-push 门禁分层设计
- `scripts/domain-map.mjs` — 领域分类 + 缓存工具
- `.githooks/pre-push` — 门禁实现
