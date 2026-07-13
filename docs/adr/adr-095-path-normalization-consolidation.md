# ADR-095: 路径归一化与归属判定统一

**日期**：2026-07-13
> **状态**: 规划
> **关联**: ADR-090（路径边界判定）、ADR-018（Path Manager + 文件 I/O 审计）、ADR-045（统一加载与资源管理）、ADR-023（Android SAF 文件访问）
> **影响面**: `frontend/src/core/fileservice.ts`(normPath)、`frontend/src/core/utils.ts`(normalizePath / isPathWithinRoot / computeLibraryRef)、`frontend/src/menus/library-core.ts`、`frontend/src/scene/scene-bundle.ts`
> **与资源库恢复关联**: 见 ADR-097（前端 `GetLastBrowseDir` 返回单字符串被误解构为 `'C'` 的 bug 已修，属本 ADR 路径规范化背景下的前端问题）

---

## 问题

往前核对 `getRelativePathUnderDir`（ADR-090 抽取产物）时，发现项目存在**两套并存的路径归一化实现**与**至少 7 处手写的"是否在某根下 / 求相对路径"边界判定**：

| # | 位置 | 归一化 | 大小写 | `'/'` 边界 | 状态 |
|---|------|--------|--------|-----------|------|
| 1 | `getRelativePathUnderDir`（library-core） | `normPath` | 忽略 | ✅ | 本次抽取（2026-07-13） |
| 2 | `buildLevel` / `buildResourceItemsForDir` | 经 #1 | 忽略 | ✅ | 本次收敛 |
| 3 | `splitSubdirSegments:136` | `normPath` | ❌ | ✅ | 大小写漏判 |
| 4 | `isPathWithinRoot`（utils:140） | `normalizePath` | ❌ | ✅ | 与 #1 逐字同源但语义不等价 |
| 5 | `computeLibraryRef`（utils:107,113） | `normalizePath` | ❌ | ✅ | 大小写漏判 |
| 6 | `library-core:351` | 先小写 | 忽略 | ❌ **裸前缀** | **ADR-090 同源 bug 残留**（已修 2026-07-13） |
| 7 | `library-core:1620,1645` | `normPath` | ❌ | ✅ | 大小写漏判 |

### 根因

- `normPath`（fileservice）：带 `content://` 特例 + 缓存；仅做反斜杠→`/`、去尾斜杠；**不处理 `..`/`.`/多重斜杠**。
- `normalizePath`（utils）：无特例无缓存；**处理 `..` 上溯、过滤 `.`、合并多重斜杠**。
- 二者语义**不等价**。所有路径判定副本在各自归一化假设下手写，导致：
  1. 不能直接复用 `isPathWithinRoot`（语义偏移风险）；
  2. 大小写处理不一致（有的忽略、有的不忽略）；
  3. 边界保护不一致（#6 裸前缀 → 已暴露的伪文件夹 bug）。

### 已发生的局部修复（2026-07-13）

- 抽取 `getRelativePathUnderDir`，统一 `buildLevel` / `buildResourceItemsForDir` 两处相对路径推导（ADR-090 边界判定注释收敛为单点）。
- 修复 #6 裸前缀残留：`library-core:351` 由 `dirLower.startsWith(rootLower) && dirLower !== rootLower` 改为 `dirLower.startsWith(rootLower + '/')`，根除 `.../outfitX` 误判为 `.../outfit` 子目录并持久化进 `LastDirs["browse:pmx"]` 的隐患。

---

## 决策

**将 `normPath` 定为全仓唯一路径归一化入口（吸收 `normalizePath` 的能力，保留 `content://` 特例与缓存）；所有"是否在某根下 / 求相对路径"判定收敛至两个工厂函数：**

- `isPathWithinRoot(base, child)`：布尔判定（补大小写忽略 + `export` 后供跨模块复用）。
- `getRelativePathUnderDir(child, base)`：返回相对路径或 `null`。

**渐进式落地，不在本期大范围重构**，按批次推进以免引入回归：

| 批次 | 动作 | 风险 |
|------|------|------|
| 1（已做） | 抽取 `getRelativePathUnderDir` + 修 #6 裸前缀 | 低 |
| 2 | `isPathWithinRoot` 补大小写 + `export`；`splitSubdirSegments:136` 复用 | 中 |
| 3 | `computeLibraryRef`（utils:107,113）复用 + 统一大小写 | 中 |
| 4 | `library-core:1620,1645` 复用 `isPathWithinRoot` | 低 |
| 5 | 归一化层合并：`normalizePath` 吸收进 `normPath` 或反之，删除另一份 | 高（需全量回归） |

### 选项

| 选项 | 描述 | 结论 |
|------|------|------|
| A. 维持现状，多处各自手写 | 每次路径语义变更要改 N 处，易漏改复发同类 bug | ❌ 否决 |
| B. 统一 `normPath` + 收敛两工厂（本 ADR） | 单点归一化、单点判定，语义一致 | ✅ 采用 |
| C. 统一到 `normalizePath` 丢弃 `normPath` | 失去 `content://` 特例与缓存，需审查所有 `content://` 使用方 | ❌ 暂否：影响面更大，待评估 |

---

## 约束

- `content://` 协议路径必须保持特例（Android SAF，ADR-023）。
- 归一化合并（批次 5）属高风险跨模块改动，需独立 PR + 全量构建 / E2E 回归，不在本 ADR 实施期强制执行。
- 任何批次不得改变既有对外行为：构建必须通过，且 `GetLastBrowseDir` / `SetLastBrowseDir` 持久化语义不变。

---

## 执行情况（2026-07-13 安全批）

按"修 bug + 建工厂迁安全批"决议落地，**不动归一化层**（批次 5 仍待独立 PR）。

### 已建工厂
- `frontend/src/core/utils.ts` 新增 `export function isUnderRoot(base, child): boolean`：基于 `normPath` + `toLowerCase` + `'/'` 边界判定。注释明确：与 `getRelativePathUnderDir`（基于 `normPath`）同源；与 `isPathWithinRoot`（基于 `normalizePath`）并存属已知债，待批次 5 收敛。

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

### 留待批次 5（归一化合并）
- `utils.ts` `isPathWithinRoot`（基于 `normalizePath`，缺大小写）→ 重写复用 `isUnderRoot`。
- `utils.ts` `computeLibraryRef`（基于 `normalizePath`）→ 收敛至同一工厂（必要时补多根 `resolveRefUnderRoots`）。
- `scene-bundle.ts` `_bundleInternalPath` 就地 `replace(/\\/g,'/')` 第 3 套归一化 → 删除，复用工厂。

### 验证
`npm run build`（`tsc && vite build`）通过，零类型错误、`noUnusedLocals` 无未引用告警。
