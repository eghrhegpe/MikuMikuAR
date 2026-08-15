# Round 58 审核报告 — ar-camera / app.functions.contract / camera-mode-guard

> 日期：2026-08-15
> 模式：继续队列第二批，3 个子代理并行审计 + 主模型统一验证提交。
> 范围：`frontend/src/__tests__/ar-camera.test.ts`、`frontend/src/__tests__/bindings/app.functions.contract.test.ts`、`frontend/src/__tests__/camera-mode-guard.test.ts` 及其直接关联源码。

## 摘要

- 子代理：3 个，分别审计 1 个测试文件。
- 发现总数：22（P0×0 / P1×5 / P2×9 / P3×7 / P4×1）。
- 实际修复文件：3 个测试 + 5 个源码。
- 验证：`npm run check` ✅；受影响前端单测 209/209 ✅；`go test ./internal/...` ✅。

## 一、ar-camera.test.ts

### 修复
1. **P1 源码：`video.play()` await 后未复检代数** — `startARCamera` 在 stop 后可能重新激活“幽灵 AR”；已在 play resolve 后再次校验 `myGen !== _arGen`，失效则停流、清空 `srcObject`、复位状态。
2. **P2 测试：补“play 挂起期间 stop”竞态用例**。
3. **P2 测试：模块级单例状态隔离** — 每用例 `vi.resetModules()` + 动态 import，避免 `_mirrorOverridden` 等跨用例污染。
4. **P2 测试/源码：资源释放断言加强** — 真实 track.stop、getUserMedia 次数/约束、旧流释放、失败后 `_starting` 复位可重试。
5. **P2 源码：`captureARScreenshot` 激活路径重复编码主 canvas** — 改为仅激活/合成路径编码一次，并补调用次数/参数断言。
6. **P2 源码/测试：Android 权限迟到回调** — 引入 `settled` 统一收口，超时/抛错分支补测试。
7. **P3 源码：删除无注册 API 的死代码 `_listeners` / `_notifyARModeChange`**。
8. **P3 源码：`makeStream()` stop mock 稳定性**。

### 未收口
- **`_facing` 失败语义（P3）**：当前启动失败前就提交 `_facing`；是否改为“仅成功后提交”需产品确认。

## 二、bindings/app.functions.contract.test.ts

### 修复
1. **P1 测试：原“导出 ≥100”与 22 个高风险目标脱节** — 改为 `HIGH_RISK_FUNCTIONS` 显式清单并断言 `typeof === 'function'`；删除重复的底部存在性检查。
2. **P1 源码：`GetModelMeta` 只回填 Comment，`NameJp/NameEn` 恒空** — 已补全字段。
3. **P1 源码：`GetCacheStats.TotalBytes` 漏算 `ServeBytes`** — 已加入总占用。
4. **P1 源码：`mergeUIState` 漏合并 `Ktx2Transcode` / `ShowFpsClock` / `ShowRuntimeBadge`** — 已补齐。

### 未收口
- **`mergeUIState` 合法零值/partial bool 覆盖（P2）**：`volume=0`、`fpsLimit=0` 等零值无法持久化，部分 bool 更新会重置未提交字段；需要 presence mask / 指针字段 / 全量载荷方案决策。
- **`SaveSceneFile` / `SaveModelPreset` 非原子写（P2）**：建议 tmp+rename 原子写，待确认后实施。
- **`BundleScene` 资产展开范围与重名（P3）**：可能递归扫整个父目录且 basename fallback 重名，需单独设计。
- **本文件只锁类型签名**：method ID 由 `app.contract.test.ts` 覆盖，建议文件头注明覆盖边界。

## 三、camera-mode-guard.test.ts

### 修复
1. **P2 源码：`core/types.ts` 的 `CameraMode` 漏掉 `'beatcut'`** — 已补全，并更新注释指向 `camera-state.ts`。
2. **P3 测试：编译期锁定两处 CameraMode 双写一致** — 新增 `SameUnion` 类型断言，漂移时 `npm run check` 直接失败。
3. **P3 测试：非字符串运行时输入容错** — `undefined` / `null` / `42` 均返回 `false`。

### 未收口
- **P4 维护性：与 `camera-state.test.ts` guard 用例重复** — 是否合并/精简由主模型决定。

## 验证记录

| 检查 | 命令 | 结果 |
|---|---|---|
| 前端静态检查 | `cd frontend && npm run check` | ✅ |
| 受影响前端单测 | `npx vitest run src/__tests__/ar-camera.test.ts src/__tests__/camera-mode-guard.test.ts src/__tests__/camera-state.test.ts src/__tests__/camera.adr100.guards.test.ts src/__tests__/camera.test.ts src/__tests__/bindings/app.functions.contract.test.ts src/__tests__/bindings/app.contract.test.ts` | ✅ 209/209 |
| Go 测试 | `go test ./internal/...` | ✅ |

## 未收口 / 需主模型决策汇总

1. AR `_facing` 是否仅成功后提交。
2. `mergeUIState` 合法零值与 partial bool 覆盖的解决方案。
3. `SaveSceneFile` / `SaveModelPreset` 原子写。
4. `BundleScene` 资产路径/范围与重名。
5. `camera-mode-guard` 与 `camera-state` guard 用例重复是否合并。
6. `bindings/app.functions.contract.test.ts` 文件头补充“method ID 由 app.contract.test.ts 覆盖”的说明（可选）。
