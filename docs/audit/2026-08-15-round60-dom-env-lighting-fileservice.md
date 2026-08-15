# Round 60 审核报告 — dom / env-lighting / fileservice

> 日期：2026-08-15
> 模式：继续队列第四批，3 个子代理并行审计 + 主模型统一验证提交。
> 范围：`frontend/src/__tests__/dom.test.ts`、`frontend/src/__tests__/env-lighting.test.ts`、`frontend/src/__tests__/fileservice.test.ts` 及其直接关联源码。

## 摘要

- 子代理：3 个，分别审计 1 个测试文件。
- 发现总数：16（P0×0 / P1×1 / P2×4 / P3×10 / P4×1）。
- 实际修复文件：3 个测试 + 4 个源码。
- 验证：`npm run check` ✅；受影响单测 30 文件 / 1855 用例 ✅；全量前端 Vitest 253 文件 / 5835 用例 ✅；`git diff --check` ✅。

## 一、dom.test.ts

### 修复
1. **P2 源码：`addDisposableListener` 保存 `options` 对象引用** — 若调用方修改 `options.capture`，`dispose()` 按错误 capture 移除导致监听泄漏；改为 attach 时快照 `capture` 布尔值。
2. **P2 测试：原 options 用例未验证 dispose 移除路径** — 补 `removeEventListener` 参数断言与 capture 突变回归测试。

### 未收口
- 无。

## 二、env-lighting.test.ts

### 修复
1. **P1 源码：`ENV_PRESET_FIELDS` 白名单未随 schema 扩充** — 补齐 ground/water/atmosphere 后增字段，并用 schema 派生断言锁定完整性。
2. **P2 源码：`transitionLighting` 对非正/非有限 duration 无守卫** — `0/NaN/负数` 时立即应用目标值、清理 observer，避免永不完成和泄漏。
3. **P3 源码：`importCategorizedEnvPreset` malformed v3 fields / v2 tuple 长度缺乏校验** — 拒绝非对象 fields 与长度非 3 的颜色数组。
4. **P3 测试补强** — 白名单完整性、预设派生一致性、地平线/azimuth 边界、全字段往返、异常输入、duration 边界。

### 未收口
- `reflectionMode`、`qualityProfile` 等跨类别共享字段未放入任何分类白名单；需产品/架构决策归属。
- 测试内局部 mock 后续可考虑统一进共享 mock 超集（低优先级）。

## 三、fileservice.test.ts

### 修复
1. **P2 源码：浏览器分支 `readFileBytes` 路径拼接错误** — 非 ASCII 主文件无法命中 IndexedDB；改为浏览器分支读取 `IsolateModelDir` 返回的虚拟目录本身，Android/go 降级分支仍保留文件名拼接。
2. **P2 测试：只覆盖桌面 HTTP 分支** — 新增浏览器/降级/空值抛错/Blob URL/`resolveModelDir`/`revokeFileUrl` 用例。
3. **P3 测试：`as any` 与重复调用** — 改 `vi.mocked(...)`，收敛单次调用。
4. **P3 测试：公开 API 零覆盖** — 补 `encodeFileRef`、`resolveModelDir`、`revokeFileUrl`。
5. **P3 源码：注释与实际行为不符** — 更新浏览器端注释。

### 未收口
- `resolveFileUrl` 在生产代码可能没有直接调用点（仅 re-export + 测试）；是否保留 fallback 或按 ADR-124 收敛/移除需架构决策。

## 验证记录

| 检查 | 命令 | 结果 |
|---|---|---|
| 前端静态检查 | `cd frontend && npm run check` | ✅ |
| 受影响单测 | `npx vitest run src/__tests__/dom.test.ts src/__tests__/env-lighting.test.ts src/__tests__/fileservice.test.ts ...` | ✅ 30 files / 1855 tests |
| 全量前端单测 | `cd frontend && npx vitest run --no-color --reporter=dot` | ✅ 253 files / 5835 tests |
| 空白错误 | `git diff --check` | ✅ |

## 未收口 / 需主模型决策汇总

1. `reflectionMode` / `qualityProfile` 分类归属（water / ground / 跨类别不落预设）。
2. `resolveFileUrl` 是否保留 fallback 或按 ADR-124 收敛/移除。
3. env-lighting 测试内局部 mock 是否统一进共享 mock 超集（可选）。
