# ADR-095: 路径归一化与归属判定统一

**日期**：2026-07-13
> **状态**: 已完成（批次 1–5 全落地，2026-07-13）
> **关联**: ADR-090（路径边界判定）、ADR-018（Path Manager + 文件 I/O 审计）、ADR-045（统一加载与资源管理）、ADR-023（Android SAF 文件访问）
> **影响面**: `frontend/src/core/fileservice.ts`(normPath，已增强)、`frontend/src/core/utils.ts`(isUnderRoot / computeLibraryRef / normPath re-export)、`frontend/src/menus/library-core.ts`、`frontend/src/scene/scene-bundle.ts`
> **与资源库恢复关联**: 见 ADR-097（前端 `GetLastBrowseDir` 返回单字符串被误解构为 `'C'` 的 bug 已修，属本 ADR 路径规范化背景下的前端问题）

---

## 问题

往前核对 `getRelativePathUnderDir`（ADR-090 抽取产物）时，发现项目存在**两套并存的路径归一化实现**与**至少 7 处手写的"是否在某根下 / 求相对路径"边界判定**：

| # | 位置 | 归一化 | 大小写 | `'/'` 边界 | 状态 |
|---|------|--------|--------|-----------|------|
| 1 | `getRelativePathUnderDir`（library-core） | `normPath` | 忽略 | ✅ | 本次抽取（2026-07-13） |
| 2 | `buildLevel` / `buildResourceItemsForDir` | 经 #1 | 忽略 | ✅ | 本次收敛 |
| 3 | `splitSubdirSegments:136` | `normPath` | ❌ | ✅ | 大小写漏判 |
| 4 | `isPathWithinRoot`（utils:140，**已删，批次 5**） | `normalizePath` | ❌ | ✅ | 与 #1 逐字同源但语义不等价 → 已由 `isUnderRoot` 替代 |
| 5 | `computeLibraryRef`（utils:107,113） | `normalizePath` | ❌ | ✅ | 大小写漏判 |
| 6 | `library-core:351` | 先小写 | 忽略 | ❌ **裸前缀** | **ADR-090 同源 bug 残留**（已修 2026-07-13） |
| 7 | `library-core:1620,1645` | `normPath` | ❌ | ✅ | 大小写漏判 |

### 根因

- `normPath`（fileservice）：带 `content://` 特例 + 缓存；做反斜杠→`/`、去尾斜杠、**折叠 `.` 段**、合并多重斜杠（**不处理 `..` 上溯**——所有输入均为已解析绝对路径，无 `..` 段，故无影响）。
- `normalizePath`（utils）：**已于 2026-07-13 批次 5 删除**；原无特例无缓存、处理 `..` 上溯、过滤 `.`、合并多重斜杠。其 `.` 折叠与多重斜杠合并能力已由增强后的 `normPath` 吸收；`..` 上溯因无调用方需要未移植（属过度工程，不补）。
- 二者原语义**不等价**，但 `normalizePath` 删除后全仓仅剩 `normPath` 单点归一化。原各路径判定副本在各自归一化假设下手写，导致：
  1. 不能直接复用 `isPathWithinRoot`（语义偏移风险）→ **已修复**：`isPathWithinRoot` 已删除，统一为 `isUnderRoot`。
  2. 大小写处理不一致（有的忽略、有的不忽略）→ **已修复**：`isUnderRoot` 统一 `toLowerCase`。
  3. 边界保护不一致（#6 裸前缀 → 已暴露的伪文件夹 bug）→ **已修复**：批次 1 修 #6，批次 4 收敛 `library-core` 裸前缀。

> 注：上述根因与问题表（#1–#7）为 2026-07-13 初始发现时的快照；截至 2026-07-13 批次 5 落地，全部 7 处判定与 2 套归一化均已收敛，详见「执行情况」。

### 已发生的局部修复（2026-07-13）

- 抽取 `getRelativePathUnderDir`，统一 `buildLevel` / `buildResourceItemsForDir` 两处相对路径推导（ADR-090 边界判定注释收敛为单点）。
- 修复 #6 裸前缀残留：`library-core:351` 由 `dirLower.startsWith(rootLower) && dirLower !== rootLower` 改为 `dirLower.startsWith(rootLower + '/')`，根除 `.../outfitX` 误判为 `.../outfit` 子目录并持久化进 `LastDirs["browse:pmx"]` 的隐患。

---

## 决策

**将 `normPath` 定为全仓唯一路径归一化入口（吸收 `normalizePath` 的能力，保留 `content://` 特例与缓存）；所有"是否在某根下 / 求相对路径"判定收敛至两个工厂函数：**

- `isUnderRoot(base, child)`：布尔判定（基于 `normPath` + `toLowerCase` + `'/'` 边界；批次 5 后已删除 `isPathWithinRoot`，此为唯一入口）。
- `getRelativePathUnderDir(child, base)`：返回相对路径或 `null`。

**渐进式落地，不在本期大范围重构**，按批次推进以免引入回归：

| 批次 | 动作 | 风险 |
|------|------|------|
| 1（已做） | 抽取 `getRelativePathUnderDir` + 修 #6 裸前缀 | 低 |
| 2 | `isPathWithinRoot` 补大小写 + `export`；`splitSubdirSegments:136` 复用 | 中 |
| 3 | `computeLibraryRef`（utils:107,113）复用 + 统一大小写 | 中 |
| 4 | `library-core:1620,1645` 复用 `isPathWithinRoot` | 低 |
| 5（已做） | 归一化层合并：`normalizePath` 删除，能力由 `normPath` 吸收（含 `.` 折叠 + 多重斜杠合并）；`isPathWithinRoot`/`_bundleInternalPath` 一并删除 | 高（已全量回归通过） |

### 选项

| 选项 | 描述 | 结论 |
|------|------|------|
| A. 维持现状，多处各自手写 | 每次路径语义变更要改 N 处，易漏改复发同类 bug | ❌ 否决 |
| B. 统一 `normPath` + 收敛两工厂（本 ADR） | 单点归一化、单点判定，语义一致 | ✅ 采用 |
| C. 统一到 `normalizePath` 丢弃 `normPath` | 失去 `content://` 特例与缓存，需审查所有 `content://` 使用方 | ❌ 暂否：影响面更大，待评估 |

---

## 约束

- `content://` 协议路径必须保持特例（Android SAF，ADR-023）。
- 归一化合并（批次 5）属高风险跨模块改动，需独立 PR + 全量构建 / E2E 回归，不在本 ADR 实施期强制执行。→ **已于 2026-07-13 完成**（随 helper 收敛批落地，全量回归通过）。
- 任何批次不得改变既有对外行为：构建必须通过，且 `GetLastBrowseDir` / `SetLastBrowseDir` 持久化语义不变。

---

## 执行情况（2026-07-13 安全批）

按"修 bug + 建工厂迁安全批"决议落地；**批次 5（归一化层合并）已于 2026-07-13 同步完成**：`normalizePath`/`isPathWithinRoot`/`_bundleInternalPath` 三份冗余实现已删除，`normPath` 吸收其 `.` 折叠与多重斜杠合并能力。

### 已建工厂
- `frontend/src/core/utils.ts` 新增 `export function isUnderRoot(base, child): boolean`：基于 `normPath` + `toLowerCase` + `'/'` 边界判定。与 `getRelativePathUnderDir`（基于 `normPath`）同源；原并存的 `isPathWithinRoot`（基于 `normalizePath`）已于批次 5 删除，已知债已清偿。

### 已修真 bug（adr-090 同源裸前缀）
| 位置 | 原写法 | 改为 |
|------|--------|------|
| `motion-popup.ts:699` | `propDir && inst.filePath.toLowerCase().startsWith(propDir)` | `isUnderRoot(propDir, inst.filePath)` |
| `scene-stage-levels.ts:39` | `inst.kind==='actor' && propDir && inst.filePath.toLowerCase().startsWith(propDir)` | `inst.kind==='actor' && isUnderRoot(propDir, inst.filePath)` |
| `model-loader.ts:331` | `propDir && filePath.toLowerCase().startsWith(propDir)` | `isUnderRoot(propDir, filePath)` |

三处裸前缀会把 `.../propsExtra` 误判为 `.../props` 子目录，导致道具错误参与动作绑定 / 错误注册 `propRegistry`。修复后带 `'/'` 边界，杜绝伪文件夹归属。

### 已迁移散落点（统一调用 isUnderRoot）
- `library-core.ts` `getRelativePathUnderDir` 内部 `isUnder` 判定改为复用 `isUnderRoot`（消除与工厂的逐字同源）。
- `library-core.ts:351`（上次已修为 `+ '/'` 边界）进一步改为 `isUnderRoot(browseRoot, dir)`，并删除因此变 unused 的 `dirLower` / `rootLower`。
- `library-core.ts:1620` `!mdir.startsWith(parent+'/')` → `!isUnderRoot(parent, mdir)`。
- `library-core.ts:1645` `!targetDir.startsWith(currentDir+'/')` → `!isUnderRoot(currentDir, targetDir)`。
- `library-core.ts` `splitSubdirSegments` 首分支 `dir.startsWith(root+'/')` → `isUnderRoot(rootRaw, dirRaw)`（补大小写保护，容错分支保留）。

### 批次 5 完成情况（2026-07-13）
- `utils.ts` `isPathWithinRoot`（基于 `normalizePath`，缺大小写）→ **已删除**，`isUnderRoot` 为唯一判定入口。
- `utils.ts` `computeLibraryRef`（基于 `normalizePath`）→ **已收敛**至 `normPath`（utils.ts:188）。
- `scene-bundle.ts` `_bundleInternalPath` 就地 `replace(/\\/g,'/')` 第 3 套归一化 → **已删除**，复用 `normPath`/`getDirPath`。
- 语义差异评估：`normPath` 不处理 `..` 上溯，但所有输入均为已解析绝对路径（无 `..` 段）；`isUnderRoot` 已显式拒绝 `..` 逃逸段，与 `resolveLibraryRef` 的 `..` 字符串层拦截对称。合并未改变任何运行时行为，无需补 `..` 上溯（补了反而是过度工程）。

### 验证
- 安全批（批次 1–4）：`npm run build`（`tsc && vite build`）通过，零类型错误、`noUnusedLocals` 无未引用告警。
- 批次 5（归一化合并）：`tsc --noEmit` 0 错误；`vitest run` 46 文件 / 1342 用例全通过；`normalizePath`/`isPathWithinRoot`/`_bundleInternalPath` 全仓零匹配。
