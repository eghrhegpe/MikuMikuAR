# Round 57 审核报告 — web-download-panel / web-fsa-auth / web-resources

> 日期：2026-08-15
> 模式：继续队列首批 3 个剩余 E2E 文件，子代理并行审计 + 主模型统一验证提交。
> 范围：`frontend/e2e/web-download-panel.spec.ts`、`frontend/e2e/web-fsa-auth.spec.ts`、`frontend/e2e/web-resources.spec.ts` 及其直接关联源码。

## 摘要

- 子代理：3 个，分别审计 1 个 E2E 文件。
- 发现总数：18（P0×0 / P1×3 / P2×8 / P3×6 / P4×1）。
- 实际修复文件：3 个 E2E + 3 个源码。
- 验证：`npm run check` ✅；相关单测 38/38 ✅；3 个 E2E 13/13 ✅。

## 一、web-download-panel.spec.ts

### 修复
1. **P1 假绿**：原“打开后不崩溃”只断言 overlay visible，未证明进入下载面板。改为断言 `downloads:folder / downloads:scan / downloads:manage` 真实卡片，并监听 `pageerror`。
2. **P2 稳定性假绿**：模型库/设置开关循环补 `pageerror` 收集并在结尾断言为空。
3. **P2 locale 脆弱**：设置面板标题断言从中文文案改为 `[data-menu-id="settings-menu"] .slide-title`。
4. **P3 文件头失实**：注释改为实际覆盖的“设置→下载文件夹”路径。
5. **P2 源码去重时机**：`frontend/src/menus/settings-downloads.ts` 网页批量导入原先在 `ingestModelFiles` / `ImportZip` 成功前就写入 `_ingestedStems`，失败后同会话重试会被静默跳过。改为成功落库后再标记去重。

## 二、web-fsa-auth.spec.ts

### 修复
1. **P1 locale 硬编码**：弹窗标题断言改为五语正则。
2. **P2 IDB 丢写竞态**：取消后 reload 前用 `expect.poll` 等待 `fsaAuthPromptDismissed === true` 落库。
3. **P2 刷新后假绿**：等待 initLibrary 真正执行（状态栏 📦 提示）后再断言“不再弹窗”。
4. **P2 跨导航 flaky**：新增本地 `gotoWebEntryWithoutOverlayGuards`，复用 SW 接管/init 等待但不安装会隐藏引导弹窗的 overlay 守卫。
5. **P3 源码 ADR-183 缺口**：新增 `resetFsaAuthPromptDismissed()`，并在 `selectResourceRoot` 成功设置根目录后清除“跳过引导”记忆。

## 三、web-resources.spec.ts

### 修复
1. **P1 SW 接管绕过 Playwright route**：同源 fixture fetch 被 Service Worker 接管导致 404；改为跨源 `127.0.0.1:4175/fixtures/*` 并补 CORS 头，route 稳定命中。
2. **P2 假契约 key**：VMD/ZIP 的 IndexedDB key 从 `file:sample-vmd` / `file:sample-zip` 对齐到生产键 `file:sample`。
3. **P3 IDB 写竞态**：写操作等待 `tx.oncomplete`，不再只等 `put` request success。
4. **P3 字节比对过弱**：从首尾字节改为全字节比对。
5. **P3 DB 版本脆弱**：显式 `indexedDB.open(..., 2)` 并补建 `models` store，同时 `db.close()`。

## 验证记录

| 检查 | 命令 | 结果 |
|---|---|---|
| 前端静态检查 | `cd frontend && npm run check` | ✅ |
| 相关单测 | `npx vitest run src/__tests__/menus/download-manager.test.ts src/core/backend/browser-adapter.fsa-auth.test.ts src/__tests__/main.boot-anchor.test.ts` | ✅ 38/38 |
| E2E | `cd frontend; $env:RUN_WEB_E2E='1'; npm run test:e2e -- web-download-panel.spec.ts web-fsa-auth.spec.ts web-resources.spec.ts --reporter=line --workers=1` | ✅ 13/13 |

## 未收口 / 需主模型决策

1. **PMX/VMD/ZIP 同 stem 共用 `file:<stem>` 键（P2 源码风险）**
   - `sample.pmx`、`sample.vmd`、`sample.zip` 的生产键均为 `file:sample`，同时导入同 stem 不同资源可能相互覆盖。
   - 涉及 `drop-import.ts` / `idb.ts` / `browser-adapter.ts` 及数据兼容，改动面较大；建议单独立项做扩展名感知键空间 + 旧键迁移。
2. **`resetFsaAuthPromptDismissed` 缺直接单测**
   - 本次受文件锁限制未补 `browser-adapter.fsa-auth.test.ts` 用例；建议后续补。
3. **web-fsa-auth 导入/重扫仍为弱断言**
   - 只验证元素可见，未覆盖点击/副作用；headless 下避免原生 picker/扫描副作用，可后续补行为级用例。
4. **web-resources 仍只测裸 IndexedDB**
   - 未驱动生产 `readFileBytes` / `saveModel` / `ExtractZip`；如需要更深集成，可考虑暴露 `window.__testBackend`。
