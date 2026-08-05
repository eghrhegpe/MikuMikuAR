# 验证记录 — `library-core.ts` 模块（子代理审核流水线实跑）

> 目的：验证复刻自 ysm-model-manager 的「大模块审核子代理流水线」（docs/audit/subagent-review-playbook.md）在 MikuMikuAR 基建上的可行性，重点验证「子代理与主模型思维链不互通」能否被流水线消化。
> 验证日期：2026-08-05

---

## 1. 验证目标

- 模块：`frontend/src/menus/library-core.ts`（1020 行，menus 域核心，本轮未改动——冷审查）
- 知识卡单元：`docs/knowledge/library-core.md`
- 验证命题：**子代理思维链对主模型不可见的前提下，流水线仍能产出可信、可独立核实的审查结论。**

## 2. Phase 0 / Phase 1 执行记录

**Phase 0 — 知识库诊断**
```
npm run check:docs
  ✅ 知识卡 symbols 与源码导出一致（扫描 246 张卡）
  ✅ 知识卡未覆盖源文件：0 个
  ❌ function-map.md 未同步 → npm run gen:funcmap 修复 ✅
git status: 4 个他人改动（env-terrain/package.json/diagnose.mjs，与本审核无关，只读不动）
```
结论：知识库可信，进入扇出。

**Phase 1 — 发散种子（buglog 反模式锚，替代隔壁 ai-mistake-tracker）**
```
docs/buglog 近期反模式：
  共享资源生命周期（shared-toon-disposed-on-model-remove，P2）
  条件渲染/入口环境差异失效（web-entry-btnMainAction-not-rendered，P3 未修复）
  预期行为日志刷屏、缺生产门控（babymmd-binding-warning-noise）
  模块加载依赖副作用、tree-shaking 摇掉注册模块（2026-08-05 v1.9.1 按钮修复根因）
  半截文件/部分清理（异步中断后状态残留）
```

## 3. 子代理结论摘要（结构化报告，主模型未读其思维链）

- **总体结论**：有条件通过。核心路径实现严谨、单测齐备；两处 UI 面板 observer/panel 未 dispose 泄漏，需修复后放行。
- **亮点**：缩略图流式加载 AbortSignal.any 协作取消 + 批次身份校验（:305）；ensureModelMeta LoadingGuard 去重 + finally 必放锁（:211-233）；buildPopupRows 每次重渲染实时重算（:847）。
- **风险**：P3×2（renderGridMode :714 panel 未 dispose；全屏 onSelect :657 未 dispose currentPanel）+ P4×5（:718 裸 as；:216 并发覆盖；:992/1009 import 副作用；:615 RAF 无取消；:52 as 无注释）。
- **知识卡漂移**：4 处（职责描述过时、fileservice/idb 未导入、RAF 位置不符、ADR-136/238 缺标）。

## 4. 主模型独立复核（Phase 3 verify，不依赖子代理思维链）

| # | 子代理结论 | 主模型独立核实（命令/源码） | 事实层 | 价值层 |
|---|---|---|---|---|
| 1 | P3 renderGridMode :714 panel 泄漏 | `createResourcePanel` 返回含 `dispose()` 的 handle（ui-resource-panel.ts:202-217 释放 IntersectionObserver/MutationObserver/virtualGrid），:714 返回值被丢弃，`renderCustom` 返回 void | ✅ 证实 | ✅ 真缺陷（违背组件自身 dispose 契约） |
| 2 | P3 onSelect :657 未 dispose currentPanel | onSelect 仅 `closeFullscreen()`；onBack 才 `currentPanel = safeDispose(currentPanel)` | ✅ 证实 | ✅ 真缺陷（每次全屏选中模型泄漏一个 panel） |
| 3 | P4 :718 裸 as 绕过校验 | `item.data as LibraryModel \| undefined` 确认；同文件 :623 有 `resourceItemAsModel` 带形状校验 | ✅ 证实 | ✅ 两条取回路径不一致 |
| 4 | P4 :216 ensureModelMeta 并发覆盖 | `new Map(modelMetaCache)` 快照 + 分片整体 `setModelMetaCache(merged)`；guard 只拦同 key | ✅ 证实 | ✅ 不相交并发后写覆盖（缓存回退，非崩溃） |
| 5 | P4 :992/1009 import 副作用 | `stackRegistry.buildLevel=` + `registerUiAction('buildBrowseLevel')` 模块级执行 | ✅ 现象存在 | ⚠️ **价值存疑**：library-core 导出被 nav-actions 等广泛消费，有充分加载锚点，不会触发 v1.9.1 类摇树。降级观察项 |
| 6 | P4 :615 RAF 无取消 | `requestAnimationFrame(renderBatch)` 无 generation 标记 | ✅ 现象存在 | ⚠️ 影响面未量化（列表 >100 项才触发），暂列观察 |
| 7 | P4 :52 as UIState 无注释 | — | ⚪ 未复核 | 低风险接受 |
| 8 | 知识卡漂移 ×4 | fileservice/idb 未导入（grep 空）；RAF 实际在 renderItemsWithRAF（:482）；源码 `[adr-136]`×3 + `[doc:adr-238]` 卡片缺标 | ✅ 全部证实 | — |
| 9 | 幽灵路径 resourceViewMode | 写入方 2 处可枚举（library-core:442 内部切换 + library-setup:140 启动恢复），语义单一 | ✅ 共享为真 | ⚠️ 「幽灵路径」标签偏重 |

**复核方法**：主模型仅用 `Grep`/`Read` 直接读源码，未读取子代理任何中间推理。
**结论**：9 项结论 7 项现象真实（命中率 78%），其中 2 个 P3 泄漏为真缺陷；2 项「现象证实但价值性存疑」（印证了「存在性 ≠ 价值性」——子代理判定 P2 级别缺陷时，主模型必须做价值层复核）。

## 5. 结论

- **流水线可行**：Phase 0 诊断 → Phase 1 buglog 反模式锚 → Phase 2 限定上下文扇出 → Phase 3 双层 verify，四阶段闭环在 MikuMikuAR 基建上成立。
- **「思维链不互通」被消化**：子代理在隔离上下文仅凭 source_files + 知识卡 + rubric 产出 9 项结论，7 项经主模型独立读源码证实——结构化输出契约 + 独立 verify 的设计意图成立。
- **本仓增强点生效**：价值层复核抓到了子代理 2 项「现象真但判断弱」的结论（import 副作用 P4、幽灵路径标签），避免误报进入修复队列。
- **附带产出**：`library-core.ts` 真实技术债（renderGridMode/onSelect 两处 panel 泄漏 P3、ensureModelMeta 并发覆盖 P4、知识卡 4 处漂移），建议另起一轮按特性 scope 处理，不并入本次方法论验证。
