# ADR-097: 资源库浏览与恢复决策汇总（含模型记忆）

> **日期**: 2026-07-13
> **状态**: ✅ 已实施（2026-07-13）
> **汇总范围**：ADR-066 / ADR-090 / ADR-094 / ADR-095 中「本地模型资源库浏览与恢复」相关部分
> **影响面**：`frontend/src/menus/library-core.ts`、`frontend/src/menus/model-detail.ts`、`frontend/src/menus/menu.ts`

## 1. 背景（为什么需要汇总）

资源库「打开模型浏览器时的恢复行为」相关决策原先散布在多条 ADR：

- **ADR-066** 全屏资源库界面（UI 基座，已实施）。
- **ADR-090** 对话框默认目录记忆（文件夹记忆 `LastDirs["browse:pmx"]`，已完成）。
- **ADR-094** 资源库替换模式（替换后自动保持替换状态并回到模型列表，已完成）。
- **ADR-095** 路径归一化与归属判定统一（规划中，Go 侧）。

而本期又新增了**模型记忆（RecentModels 驱动）**与「更换模型接入模型记忆」两项决策。由此产生阅读错位：

- 看旧 ADR（090/094）以为只有「文件夹记忆 / 替换自动返回」，不知道已叠加载**模型记忆**；
- 看新 ADR 又像从零施工，与已落地的 090/094 割裂。

本 ADR 把「打开任一模型浏览器实例时的恢复行为」收敛为**单一事实源**，后续改动以本 ADR 为准。

## 2. 决策：统一恢复架构

打开任一「模型浏览器」实例（`stackRegistry.modelStack`，= `makeModelMenu` 共享单例）时的恢复链路如下：

| 优先级 | 机制 | 来源 | 行为 |
|--------|------|------|------|
| **1** | 模型记忆（RecentModels） | 本期新增 | 按格式过滤 —— pmx 浏览器只取 `recentModels` 中**首个 `format==='pmx'` 且 `isUnderRoot(browseDir, m.dir)` 的 ref**，自动展开到上次模型目录 + 高亮该行（focus 默认，直载延后） |
| **2** | 文件夹记忆回退（LastDirs） | ADR-090 | 模型记忆无命中时，展开到上次浏览文件夹 |
| — | 三路径共用 | ADR-066 UI + ADR-094 替换模式 | 开库 / 更换模型（首次）/ 替换后续接，均经 `prepareModelRestore()` 填充 `pendingAutoExpand` / `pendingFocusModel`，由 `onLevelEnter` 逐层消费 |

### 2.1 三路径共用同一恢复链路

| 路径 | 入口 | 是否调用 `prepareModelRestore` |
|------|------|-------------------------------|
| 开库恢复 | 资源库主菜单 → `models:browse`（`onFolderEnter`） | ✅ `await prepareModelRestore(browseDir, 'pmx')` |
| 更换模型（首次） | `model-detail.ts` 「更换模型」卡片（`model:replace`） | ✅ `push` 前 `await prepareModelRestore(getBrowseDir('pmx'), 'pmx')` |
| 更换模型（替换续接） | `onModelRowClick` 替换分支 | ✅ `push` 前 `await prepareModelRestore(getBrowseDir(browseCategory), browseCategory)` |

写入侧不变：`onModelRowClick` 内 `AddRecentModel(ref)` 对所有 pmx 加载路径生效。

### 2.2 关键实现事实

- `prepareModelRestore(browseDir, category)` 为 **模块级导出函数**（`library-core.ts`），三条路径共用。
- `pendingAutoExpand` / `pendingFocusModel` 由 `makeModelMenu` 闭包局部变量**提升为模块级**（`modelStack` 单例，无并发冲突）。
- **修复（前端 bug）**：`GetLastBrowseDir` 的 TS 绑定返回**单个 `string`**（非元组），前端原 `const [lastDir] = await GetLastBrowseDir('pmx')` 误把字符串当数组解构、取到首字符 `'C'`，导致 `restoreTarget='C'`、恢复永远停在根目录。已改为直接接收字符串（属 ADR-095 路径规范化背景下的前端问题）。

### 2.3 已知限制 / 延后项

- **开库即直载**（打开资源库自动加载上次模型）：按用户拍板**延后**，当前为 focus 高亮模式。接入成本极低 —— 在 `onLevelEnter` 命中 `pendingFocusModel` 处改为 `replaceModel` 直载即可。
- **race（菜单 push 过渡拦截）**：`menu.ts:180` 的 `if (this.transitioning) return` 在深层子目录展开时理论上仍可能静默丢弃 `push`；DEV 下 `[restore] autoExpand push { transitioning }` 日志可诊断。两轮实测（恢复目标在根附近）均未触发，暂不改动。

## 3. 与既有 ADR 的关系

| ADR | 关系 | 现状 |
|-----|------|------|
| ADR-066 全屏资源库界面 | 基础 UI；本 ADR 在其上叠加恢复行为 | ✅ 已实施 |
| ADR-090 对话框默认目录记忆 | 文件夹记忆机制（恢复优先级 2）来源；本 ADR 是其「恢复行为」的上层汇总 | ✅ 已完成 |
| ADR-094 资源库替换模式 | 替换模式自动返回 + 本期接入模型记忆（优先级 1） | ✅ 已完成 |
| ADR-095 路径归一化 | 背景：前端 `GetLastBrowseDir` 解构 `'C'` bug 已修（见 2.2） | 规划（Go 侧） |
| ADR-087 模型广场·浏览器体验 | **不同子系统**（下载广场 web 浏览），非本地资源库，不纳入本汇总 | 规划中 |

## 4. 结论

资源库恢复现在是「**模型记忆优先 + 文件夹记忆回退 + 三路径共用 + 更换模型已接入**」的单一确定行为。后续任何涉及「打开模型浏览器时的恢复/记忆」的改动，以本 ADR 为准；090/094/095 作为其细分机制继续有效，但不再单独承载「恢复行为」的顶层描述。
