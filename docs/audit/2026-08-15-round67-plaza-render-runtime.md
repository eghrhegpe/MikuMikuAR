# Round 67 审核报告 — plaza.contract / render-loop / runtime-mode

> 日期：2026-08-15
> 模式：继续队列第十一批，3 个子代理并行审计。

## 摘要

- 精读测试文件：3（`frontend/src/__tests__/plaza.contract.test.ts`、`frontend/src/__tests__/render-loop.test.ts`、`frontend/src/__tests__/runtime-mode.test.ts`）。
- 发现总数：20（P0×0 / P1×1 / P2×8 / P3×8 / P4×3）。
- 实际修改文件：7 个（3 个测试 + 4 个源码）。
- 验证：`npm run check` ✅；定向 9 文件 / 1601 用例 ✅；全量前端 Vitest 253 文件 / 5889 用例 ✅；`git diff --check` ✅。

## 修复

### plaza.contract（子代理）
1. **P1 源码：远程配置更新路径漏掉 `preserveBuiltinRouting`** — 远程合并后同样保护内置站点 `directNavigate`，防止 `bowlroll/github` 等被错误直连。
2. **P2 源码：`normalizeSite` 缺字段/非法 URL/协议/类型校验** — 仅接受 `http/https` 绝对 URL；id/name/url/desc/group/searchUrl/presetSearches/directNavigate 做类型归一。
3. **P2 源码：`openInWindow` 失败复位 `.catch` 不可达** — 改为 `safeCallAsync` 回调内 try/catch，失败先复位 `plazaProxyActive` 再抛出记录。
4. **P2 源码：`renderEmbed` 的 `StartProxy` 异步竞态** — 导航 token 守卫，旧请求返回不覆盖最新导航。
5. **P3 源码：`closePlaza` 对已移出 layer 的 iframe 清理不完整** — 先保存 `plazaIframe` 引用并 `remove()`，再兜底清理层内残留。
6. **P2 测试：`showPlaza` 未 await、全局副作用无清理** — 整体 mock `plaza-download`，await resolve，`afterEach` 复位共享状态。
7. **P3 测试：陈旧/过度 mock** — 移除不再需要的 `scene/scene` 与 `@wailsio/runtime` mock。

### render-loop（子代理）
8. **P2 源码：`calcHardwareScaling` 对 0/负数/NaN/Infinity 无防御** — 非正/非有限入参回退 1。
9. **P2 源码：`maxTextureSize` 负数/NaN 无防御** — 仅有限正数参与钳位。
10. **P4 源码：`applyScaling` 未同步 `_lastMul`** — 记录本次乘数，避免首帧重复 apply。
11. **P3 测试：`safeDispose` mock 陈旧** — 改为真实调用 `dispose()` 并返回 null，补重复 stop 不重复清理断言。
12. **P3 测试：清理断言过弱** — 补 resize 同 handler 移除、timer 清零、observer dispose 调用。
13. **P3 测试：dispose 守卫/帧异常路径缺覆盖** — 补不再 render 与 render 抛错自停。

### runtime-mode（子代理）
14. **P2 源码：`detectRuntimeMode` 读取异常无兜底** — 整体 try/catch 回退 SPR 结构。
15. **P2 源码：`loadPersistedRuntimeMode` 只挡语法不挡结构** — 新增 `isRuntimeMode` 形状/一致性校验，非法值返回 null。
16. **P3 源码：`persistRuntimeMode`/`renderRuntimeBadge` 对非法 mode 无防御** — 复用 `isRuntimeMode` 静默忽略。
17. **P3 测试：`_backendKind` 跨用例污染** — afterEach 清空 backend 后缀。
18. **P3 测试：navigator 缺失/读取异常/undefined 精确断言缺失** — 补齐。
19. **P4 测试：mock 路径注释错误** — 改 `../core/dom`。
20. **P4 测试：helper 的 `coi === undefined` 分支不可达** — 用 `'coi' in opts` 区分未传与显式 undefined。

## 验证记录

| 检查 | 命令 | 结果 |
|---|---|---|
| 前端静态检查 | `cd frontend && npm run check` | ✅ |
| 定向单测 | `npx vitest run src/__tests__/plaza.contract.test.ts src/__tests__/render-loop.test.ts src/__tests__/runtime-mode.test.ts src/__tests__/main.boot-anchor.test.ts src/__tests__/menu/nav-click-dom.test.ts src/__tests__/init.test.ts src/__tests__/scene.test.ts src/__tests__/menu-schema.integrity.test.ts src/__tests__/schema-snapshot.test.ts --no-color` | ✅ 9 files / 1601 tests |
| 全量前端单测 | `cd frontend && npx vitest run --no-color --reporter=dot` | ✅ 253 files / 5889 tests |
| 空白错误 | `git diff --check` | ✅ |

## 未收口 / 需主模型决策

- `normalizeSite` 现在只接受 `http/https` 绝对 URL；若未来需 `app://`/`file://` 自定义协议，需扩展白名单。
- `calcHardwareScaling` 非法输入回退 1 的语义已按“安全兜底”处理；若产品希望 `renderScale=0` 表达“最低分辨率/关闭渲染”，需另行确认。
- `startRenderLoop` 未在入口提前 return disposed scene，仍依赖首帧守卫自停；当前无泄漏，可后续收口。
- `docs/knowledge/runtime-mode.md` 仍描述旧的 desktop/browser 枚举，与实际 MPR/COI/SAB 徽标职责不符，建议后续同步文档。
