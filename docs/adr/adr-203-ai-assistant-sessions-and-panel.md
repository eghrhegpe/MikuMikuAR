# ADR-203: AI 助手会话持久化与独立面板

> **状态**: 🟢 已完成（Phase 1 多会话 IndexedDB 持久化 + Phase 2 主窗口内独立面板）
> **日期**: 2026-07-29
> **关联**: ADR-196（内置 AI 诊断助手，本 ADR 覆盖其 P4「状态不持久」限制与 P5「关面板清空会话」决策）、ADR-176（BackendService 双适配器，IndexedDB 统一存储范式）、ADR-093（声明式菜单 Schema，面板挂载）、ADR-075（registerPopupMenu overlay 工厂）

---

## 背景与问题

ADR-196 落地的 AI 诊断助手将对话历史（`_messages`）作为模块级内存变量，并在面板关闭时显式清空（P5 决策「保证下次打开为干净初始态」）。实际使用暴露两个痛点：

1. **退出即丢**：切走设置菜单再回来，整段对话蒸发；用户无法延续之前的诊断/对话思路。
2. **界面受限**：诊断助手是设置菜单下的一个子层卡片，对话框 `max-height: 300px`，长对话/Markdown 渲染施展不开，且与其它设置耦合在同一 overlay。

用户诉求：①对话上下文可持久（关面板不丢、重开恢复）；②AI 助手作为独立界面承载，而非藏在设置菜单深处。

## 决策

### 1. 多会话持久化，统一走 IndexedDB
- 复用 `frontend/src/core/backend/idb.ts`，`STORES` 新增 `'chats'` store（`onupgradeneeded` 自动补建，无需升 `DB_VERSION`）。
- 桌面（WebView2）与网页统一走 IndexedDB（项目已共用 idb.ts），**不新增 Go binding**、**不落 config.json**——避免与 LLM 配置混存、避免 Go 侧序列化对话历史、避免双端存储分叉。
- 会话拆两键存储：`meta:<id>`（元信息 `{id,title,mode,createdAt,updatedAt}`，供列表快速枚举）+ `msgs:<id>`（消息数组，懒加载）。活动会话 id 存 `meta` store 的 `chat:activeId`。
- 封装在新增 `frontend/src/core/ai/chat-store.ts`，所有读操作对损坏/缺失数据降级（返回 undefined/空数组），不向上抛污染 UI。

### 2. 多会话模型（新建/切换/删除/重命名）
- 标题由首条 user 消息前 20 字自动派生（`deriveTitle`），空则回退 `ai.chat.untitled`；支持手动重命名。
- 空会话（无任何消息）不落盘，避免历史列表堆积空条目；`_clearChat` 清空当前会话时删除其磁盘记录。
- 持久化触发点：用户消息发出、每轮 `_finalizeStream` 成功后，经 `DebouncedTimer` 500ms 防抖合并写；关面板 / 切换会话前 `_flushSession()` 同步落盘。
- reasoning 思考过程**不持久化**（仅存正式 content，与 ADR-196 后续「reasoning 不入 `_messages`」一致）。

### 3. 主窗口内独立面板（不开新 WebView 窗口）
- 新增 `frontend/src/menus/assistant-panel.ts`，用 `registerPopupMenu` 注册独立 overlay（`overlayClass: 'sceneOverlay-assistant'`，宽 `min(560px, 92vw)`、`max-height: 85vh`），复用 `settings-diagnostic.ts` 导出的 `renderDiagnosticPanel({ withSessions: true })`。
- **不开新 WebView 窗口**：虽项目已有 Wails 多窗口先例（plaza 预热窗口），但独立窗口需新 Go binding + 跨窗口配置同步 + bundle 加载模式，复杂度高且违反「单一主应用」直觉；主窗口内独立 overlay 以最小代价满足「独立大界面」诉求。
- 设置菜单 `SETTINGS.DIAGNOSTIC` 入口改为 `showAssistant()` 打开独立面板（保留发现性），不再作为设置子层。
- 独立面板顶部含会话历史卡（`buildDiagnosticSchema({ withSessions: true })`）；设置无关的轻量入口不含。

## 覆盖 ADR-196 的既有决策

| ADR-196 条目 | 原决策 | 本 ADR 变更 |
|--------------|--------|-------------|
| P4 已知限制「诊断/闲聊模式状态不持久」 | `_mode`/`_messages` 面板销毁重置 | 会话（含 mode）持久化到 IndexedDB，重开恢复 |
| P5「关面板清空会话」 | dispose 里 `_messages.length = 0` | 移除清空，改为 `_flushSession()` 落盘；内存保留供重开复用 |
| 开放问题 #3「错误缓冲是否持久化」 | Phase 0 不做 | 本 ADR 只持久化对话会话，错误缓冲仍为内存环（不变） |

## 实施记录

- `idb.ts`：`STORES` 追加 `'chats'`。
- 新增 `core/ai/chat-store.ts`：`listSessions/loadSession/saveSession/deleteSession/getActiveId/setActiveId/newSessionId/deriveTitle` + 类型 `ChatSession/ChatSessionFull/ChatMode`。
- `settings-diagnostic.ts`：新增会话状态（`_activeSessionId` 等）+ `_persistSession`（防抖）/`_flushSession`/`_loadActiveSession`/`_createSession`/`_switchSession`/`_deleteSessionAndAdjust`/`_renderSessionList`；接入发送/收尾/清空/关面板；`buildDiagnosticSchema` 加 `withSessions` 选项 + `export`；抽 `renderDiagnosticPanel`/`_disposeDiagnosticPanel` 供两入口复用。
- 新增 `menus/assistant-panel.ts`：独立面板入口 `showAssistant`。
- `settings.ts`：`settingsOnFolderEnter` 拦截 DIAGNOSTIC → 动态 import `showAssistant`。
- `app.css`：`.sceneOverlay-assistant` 布局 + 对话框放宽 + 会话列表样式。
- i18n 5 语言新增 `ai.chat.untitled/newSession/history/rename/delete/deleteConfirm`。
- 测试：`chat-store.test.ts` 8 项（CRUD/排序/标题派生/降级）。
- 验证：`tsc --noEmit` 0 错；前端 238 tests 通过；`npm run build:dev` 通过；`go build ./...` 通过（Go 未改，仅回归）。

## 假设与边界

- 假设 WebView2 IndexedDB 配额足够存对话历史（纯文本，量小）；不做 LRU 淘汰（后续再议）。
- 不做跨设备同步、不做云端存储、不新开 WebView 窗口。
- HUD 快捷入口按钮暂未加（需配套 navLabels/图标/快捷键，作为后续发现性增强）；当前经设置菜单可达独立面板。
