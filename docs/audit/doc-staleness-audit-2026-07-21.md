# 历史文档陈旧度审计 — 2026-07-21

> 范围：遍历 `docs/`（ADR、audit、research、releases、superpowers/plans）及根目录 README / AGENTS.md。
> 方法：先建立"当前事实基线"，再对 4 类信号定向扫描（失效链接、已移除功能、版本错配、历史路径残留）。
> 判定原则：历史 ADR 中描述**当时**文件/版本属合理记录，**不**算缺陷；只有当文档把已删除/已移除/已过期内容当作**当前**状态呈现时才记为过时。

## 事实基线（审计当天，2026-07-21）

| 项 | 当前真实状态 | 来源 |
|----|--------------|------|
| Babylon.js | `^9.16.1`（实际解析 9.16.1） | `frontend/package.json` |
| Wails | `v3.0.0-alpha2.105`（v3） | `go.mod` |
| ADR 最大编号 | 159 | `docs/adr/` 目录 |
| `menus/env-feature-levels.ts` | **已删除**（2026-07-20，ADR-148 阶段 1） | `git ls-files` 无输出 |
| `menus/plaza.ts` | **已删除**（2026-07-20，ADR-148 阶段 2） | `git ls-files` 无输出 |
| `SettingsStore` | **已移除**（ADR-103 已完成，设置统一归入 `uiState` 持久化） | 源码无 `SettingsStore` 符号 |

---

## 发现汇总（按严重度）

| # | 文件:行 | 类别 | 严重度 | 问题 |
|---|---------|------|--------|------|
| 1 | `docs/adr/adr-114-ground-reflection-enhancement.md:469` | 失效链接 | 🔴 P1 | `file:///` 链接指向已删除的 `env-feature-levels.ts` |
| 2 | `docs/adr/adr-148-overload-file-split.md:37-38` | 失效链接 | 🔴 P1 | 循环依赖分析中的 `file:///` 链接指向已删除的 `env-feature-levels.ts` |
| 3 | `docs/adr/adr-088-audio-sfx-footstep.md`（34/77-79/163/167-170） | 已移除功能 | 🟠 P2 | 音效设置仍描述为存入 `SettingsStore`，但该存储已被 ADR-103 移除 |
| 4 | `AGENTS.md:40` | 版本错配 | 🟠 P2 | 技术栈表写 `Babylon.js 9.14.0`，实际 9.16.1 |
| 5 | `README.md:9` / `README.en.md:10` | 版本错配 | 🟠 P2 | 徽章固定 `Babylon.js-9.14`，实际 9.16.1 |
| 6 | `adr-032:14` / `adr-060:15` / `adr-113:119,449` / `adr-114:534` / `research/ue5-ground-reflection-analysis.md:143` | 版本错配 | 🟡 P3 | 把 `9.14.0` 当作"当前版本"写入技术规范 |
| 7 | `.workbuddy/USER.md`（技术栈基线） | 版本错配 | 🟡 P3 | 写 `Babylon.js 9.14.0` + `ADR 编号 已达 106`，实际 9.16.1 / 159 |
| 8 | 13 个历史 ADR 引用 `menus/env-feature-levels.ts`；9 个引用 `menus/plaza.ts` | 历史路径残留 | 🟢 P4 | 描述当时文件状态，属合理历史记录，**建议保留** |

---

## 详细发现与更新建议

### 🔴 P1-1 — `adr-114-ground-reflection-enhancement.md:469` 失效链接
- **原文**：`在 [env-feature-levels.ts:250 buildGroundLevel()](file:///.../menus/env-feature-levels.ts#L250) 内新增/调整以下 folder：`
- **问题**：`menus/env-feature-levels.ts` 已于 2026-07-20 删除（ADR-148 阶段 1，拆为 `env-*-levels.ts`）。链接目标不存在 → 点击即 404/空文件。
- **建议**：`buildGroundLevel` 现位于 `menus/env-ground-levels.ts`，链接改为 `file:///.../menus/env-ground-levels.ts#L<新行号>` 并校正行号；或去掉死链、改为纯文本引用「`env-ground-levels.ts` 的 `buildGroundLevel()`」。

### 🔴 P1-2 — `adr-148-overload-file-split.md:37-38` 失效链接
- **原文**：`[env-feature-levels.ts:37-38](file:///.../menus/env-feature-levels.ts#L37-L38)` 与 `[env-menu.ts:26,38](file:///.../menus/env-menu.ts#L26)` 用于说明拆分前的循环依赖。
- **问题**：`env-feature-levels.ts` 已删除，两条链接均失效。
- **建议**：本 ADR 自身即记录该拆分的"收口"文档，建议在两条链接后加标注「（pre-split 路径，已于阶段 1 删除）」，并将循环依赖现状改写为 post-split 路径（`env-*-levels.ts` + `env-menu-state.ts`），与本 ADR 其余"已完成"叙述一致。

### 🟠 P2-3 — `adr-088-audio-sfx-footstep.md` 引用已移除的 `SettingsStore`
- **原文**（节选）：
  - L34：`音量持久化 | SettingsStore (volume/audioOffset) | 全局设置存储`
  - L77-79：`export function setSfxVolume(v)` `// 写 SettingsStore('sfxVolume')`；`setSfxEnabled` `// 写 SettingsStore('sfxEnabled')`
  - L163/L167-170：`脚步声/SFX 是全局播放器配置，归 SettingsStore + EnvState`；`sfxEnabled/sfxVolume/footstepEnabled/footstepVolume` 的"存储"列均填 `SettingsStore`
- **问题**：ADR-103（✅ 已完成）**移除了 `SettingsStore`**，音频等 9 个设置统一走 `uiState` 持久化链路。源码 `grep "class SettingsStore|export.*SettingsStore|const SettingsStore"` 无结果——存储后端已不存在。adr-088 把已移除的机制当作**当前**架构描述，且全篇未交叉引用 ADR-103。
- **建议**：
  1. 将上述"存储: SettingsStore"统一改为「`uiState` 持久化（ADR-103）」；
  2. L77-79 的 `// 写 SettingsStore(...)` 注释改为「`// 经 uiState 持久化`」；
  3. 在「3.5 状态管理」小节开头加一行交叉引用：「音频设置持久化见 ADR-103（SettingsStore 已移除，统一 uiState）」。
  - 注：adr-103 自身作为迁移记录保留 `SettingsStore` 措辞属合理，无需改动。

### 🟠 P2-4 — `AGENTS.md:40` 技术栈版本过期
- **原文**：`| 3D | Babylon.js 9.14.0 + babylon-mmd (fork) |`
- **问题**：实际 `package.json` 为 `@babylonjs/core ^9.16.1`。9.14.0 已落后两个 minor。
- **建议**：改为 `Babylon.js 9.16.x + babylon-mmd (fork)`（或 `^9.16.1`），避免固化到具体旧版本。

### 🟠 P2-5 — README 徽章固定旧版本
- **原文**：`README.md:9` 与 `README.en.md:10`：`[![Babylon.js](https://img.shields.io/badge/Babylon.js-9.14-AD1F23?logo=babylondotjs)]`
- **问题**：徽章写死 `9.14`，实际 9.16.1；对外展示版本偏低。
- **建议**：徽章改为 `Babylon.js-9.16`（或移除版本硬编码，仅保留 logo）。

### 🟡 P3-6 — 多个 ADR / research 把 `9.14.0` 当"当前版本"
- **位置**：
  - `adr-032-cloud-rendering-investigation.md:14`：`Babylon.js 9.x（当前版本 9.14.0）`
  - `adr-060-e2e-testing-strategy.md:15`：`前端框架 … Babylon.js 9.14.0 + babylon-mmd`
  - `adr-113-horizon-volumetric-clouds.md:119,449`：`Babylon 9.14.0 无内置体积云`
  - `adr-114-ground-reflection-enhancement.md:534`：`Babylon 9.14.0 有 SSRRenderingPipeline`
  - `research/ue5-ground-reflection-analysis.md:143`：`Babylon.js 9.14.0 无硬件 RT 支持`
- **问题**：9.14.0 不再是当前版本（现 9.16.1）。其中**能力结论**（无内置体积云、SSR 存在、无硬件 RT）大概率在 9.16.1 仍成立，但版本引脚过期，读者可能误判"当前"。
- **建议**：将硬引脚改为软表述——`Babylon.js 9.x（撰写时 9.14.0，现 9.16.1）` 或直接 `Babylon.js 9.x`；若需以"当前"论证，请重新核对该能力在 9.16.1 是否仍成立。release notes（v1.3.x 写 9.14.0、v1.5.3 写升级至 9.17.0）属发版快照，不在此列。

### 🟡 P3-7 — 身份配置 `USER.md` 基线过期
- **位置**：`.workbuddy/USER.md` 技术栈基线表：`Babylon.js | 9.14.0 | 非 v9.13.0`；`ADR 编号 | 已达 106`。
- **问题**：实际 Babylon 9.16.1、ADR 最大编号 159。该基线会影响代理后续会话的"已知事实"。
- **建议**：更新为 `Babylon.js | 9.16.x`（或 9.16.1）、`ADR 编号 | 已达 159`。注意：此文件为代理身份配置，非项目历史文档，是否更新由用户决定。

### 🟢 P4-8 — 历史 ADR 中的旧文件路径引用（建议保留）
- **规模**：13 个文件引用 `menus/env-feature-levels.ts`；9 个文件引用 `menus/plaza.ts`（含 adr-026/038/052/083/089/114/115/132/134/143 等；adr-075/078/087/105/143/146 等）。
- **判定**：这些都是各 ADR **决策当时**的文件状态描述，属合法历史记录。改写会破坏"决策溯源"。
- **建议**：**不改动**。仅当某文档把这些路径作为**当前查找指针**（lookup）呈现时才需更新——该情形已在 ADR-148 文档任务中处理（`function-map.md` / `architecture.md` / `menu-how-to.md` / `status.md` 的 4 处 `plaza.ts` 指针已重映射）。

---

## 不在本次范围的信号（已核验，非缺陷）
- `Wails v2` 表述：仅出现在 adr-011（v2→v3 迁移决策）、adr-060（明确警示"不要用 v2 端口 34115"）、research（v3 迁移指南）等**历史/对比**语境，且项目实际为 v3，无误导。
- `file:///` 链接中指向 `perception.ts` / `material.ts` / `outfit.ts` / `scene-serialize.ts` / `renderer.ts` / `menu.ts` / `main.ts` / `state.ts` / `perception-*-*.ts` 等——目标文件均**仍存在**（已逐一 `ls` 核验），链接有效。
- release notes 中的版本号：发版快照，合理历史。

## 建议处置顺序
1. 🔴 P1-1 / P1-2：修正 2 处死链（adr-114、adr-148）。
2. 🟠 P2-3：adr-088 的 `SettingsStore` → `uiState`（ADR-103）交叉引用。
3. 🟠 P2-4 / P2-5：AGENTS.md 与 README 徽章版本对齐 9.16.x。
4. 🟡 P3-6 / P3-7：软化 ADR/research 中的版本引脚；视情况更新 USER.md 基线。
5. 🟢 P4-8：历史 ADR 旧路径引用保留不动。

---

## 修复执行记录（2026-07-21 第二轮）

> 用户确认执行（"zhixing"=执行）后，按 P1→P4 顺序实际落地全部 P1/P2/P3 修复。

| 项 | 文件 | 改动 |
|----|------|------|
| P1-1 | `docs/adr/adr-114-ground-reflection-enhancement.md:9,469` | 失效 `file:///...env-feature-levels.ts` 死链 → `env-ground-levels.ts:26`；关联列表指针同步 |
| P1-2 | `docs/adr/adr-148-overload-file-split.md:37-38` | 循环依赖分析死链 → 改指 post-split 等效引用（`env-menu.ts:19-27` / `env-preset-levels.ts:34` / `env-menu-state.ts:13`），并标注"该文件已于阶段 1 删除" |
| P2-3 | `docs/adr/adr-088-audio-sfx-footstep.md:34,77,79,163,167-170` | `SettingsStore` → `uiState 持久化（ADR-103）`（5 处，含表格 4 行 + 接口注释 + 状态管理段） |
| P2-4 | `AGENTS.md:40` | `Babylon.js 9.14.0` → `9.16.x` |
| P2-5 | `README.md` / `README.en.md` / `README.ja.md` / `README.ko.md` / `README.zh-TW.md`（徽章行） | `Babylon.js-9.14-` → `Babylon.js-9.16-` |
| P3-6 | `adr-032:14` / `adr-060:15` / `adr-113:119,449` / `research/ue5-ground-reflection-analysis.md:143` / `adr-114:534` | 把"当前版本 9.14.0"硬断言软化为"9.x（撰写时 9.14.0）"，保留技术结论 |
| P3-7 | `~/.workbuddy/USER.md:38-39`（身份基线，仓库外） | `Babylon.js 9.14.0`→`9.16.1`、`ADR 编号 已达 106`→`已达 159` |

**核验结论**：修复后 `grep "当前版本 9.14.0"` 仅在本文（审计记录本身）出现；`SettingsStore` 在 adr-088 仅剩"原已移除"说明性引用；5 语 README 徽章与 AGENTS.md 均指向 9.16.x。P4-8 历史路径引用按原则保留未动。

---

## 2026-07-23 复核（ADR 159 → 175）

> 上一轮（07-21）事实基线已部分过期，本轮重新核对并处置。

### 事实基线（2026-07-23）

| 项 | 当前真实状态 | 来源 |
|----|--------------|------|
| Babylon.js | `^9.16.1` | `frontend/package.json`（未变） |
| Wails | `v3` | `go.mod`（未变） |
| ADR 最大编号 | **175** | `docs/adr/` 目录 |
| `SettingsStore` | 已移除（ADR-103） | 源码无符号（未变） |

### 本轮处置

1. **`docs/status.md` / `docs/architecture.md` 已刷新至 ADR-175**：ADR-166~175 索引补全、目录树补 10 个新模块、§20 近期子系统对照表、快照日期 → 07-23。
2. **`.workbuddy/USER.md` 基线 ADR 编号 159 → 175**（07-21 审计 P3-7 记录「→159」已被本轮 supersede 为 175；Babylon 版本此前已为 9.16.1）。
3. **版本引脚复核**：全仓仅剩 release notes 历史快照、`research`/历史 ADR 的「撰写时 9.14.0」软化表述、及 `adr-084` 对 babylon-mmd fork `v9.14.0` 的时戳性审计——均无"当前版本"硬断言，符合原则，不改动。
4. **`function-map.md` 漏登缺口（新发现，🟠 P2）**：ADR-166~175 引入的 8 个模块共约 40+ 对外导出符号未入表（quality-profile / env-context / env-reflection / env-wetness / bone-override-store / motion-pipeline / perception-observer / scene-drag-levels）。该文档已自标注"部分过时"，本轮在文末追加「近期新增模块（ADR-166~175）」补充表（增量、不改动既有行）。

### 不在范围 / 已核验非缺陷

- `Wails v2` 表述仍仅出现在历史/对比语境（adr-011/060、research），无误导。
- `SettingsStore` 在 `status.md` / `grand-blueprint.md` 中均为"已移除"语境，属正确记录。
- `menus/plaza.ts` / `menus/env-feature-levels.ts` 历史路径引用：13+9 处历史 ADR，按原则保留不动。
- `CONTEXT.md`（领域术语表）、5 语 `README` 徽章（已指 9.16）无新增漂移。
