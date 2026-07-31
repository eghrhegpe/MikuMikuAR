# ADR-218: 知识库（docs/knowledge）分层治理 — 痛点与方案

> **状态**: 规划（2026-07-31）
> **日期**: 2026-07-31
> **关联**: ADR-191（神桶去桶化，同一「分层/去重」治理哲学）、docs/knowledge/README.md（知识卡层规范）、scripts/check-doc-drift.mjs（漂移守护）
> **来源**: 知识卡层已膨胀至 231 张平铺卡片，人读不过来；同时 `category` 字段存在占位符漏网（未被脚本校验），`ui_entry` 登记无规范（仅 env-water.md 自发手写「菜单入口」小节）。

**决策者**: Riku（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

**创建日期**: 2026-07-31

---

## 背景

`docs/knowledge/` 是 MikuMikuAR 的「原子化架构知识层」，定位为 **ADR 结论在代码侧的现状快照**——回答「某个子系统现在长啥样、去哪找、改它要守什么不变量」。它由 `scripts/check-doc-drift.mjs` 守护（`source_files` 磁盘存在性 + 全局导出符号索引）。

截至 2026-07-31，知识卡层已有 **231 张平铺 `.md`**。复盘现状样本后，发现三个结构性痛点：

### 痛点 1：职责混层，人读不过来

知识卡层当前同时承载了三类性质截然不同的内容，却用同一份平铺索引呈现：

| 类型 | 例子 | 给人读的价值 | 机器校验价值 |
|------|------|-------------|-------------|
| **A. 架构节点卡** | `env.md`（环境门面）、`core-leaf-modules.md`（7 叶聚合）、`state.md`（全局 Store） | 高：可独立理解、多子系统引用、修改高风险 | 高 |
| **B. 叶子/工具卡** | `color-helpers.md`、`logger.md`、`toast.md`、`dialog.md`、`status-bar.md` | 低：纯函数、单调用方、无架构风险 | 高（drift 覆盖） |
| **C. barrel/聚合卡** | `config-barrel.md`（纯 re-export）、`ui-helpers.md`、`icons-bundle.md` | 极低：本身就是「聚合」该被折叠的对象 | 中 |

结果：人打开 README 索引看到 231 行平铺表格，信号被稀释，**真正需要「改前必读」的架构节点被淹没**。这是「200 张卡片太恐怖了，人不一定看得懂」的根因。

### 痛点 2：`category` 枚举无校验，占位符漏网

README 模板规定 `category` 枚举为 `<rendering|env|motion|ui|core|backend|physics|scene>`，但 `check-doc-drift.mjs` **只校验 `source_files` 是否存在，完全不校验 `category` 取值**。实测存在 `category: <rendering|env|...>` 这类模板占位符未被检出——说明「写卡规范」与「机器守护」之间已有裂隙。

### 痛点 3：UI 入口登记无规范

审核流程要求「预期功能 ~ 实际 UI 入口是否对上」，但卡片模板**没有 `ui_entry` 字段**，也没有标准小节。仅 `env-water.md` 自发手写「菜单入口（去哪找 UI）」小节——这是真实需求，但无规范导致登记散落、不可校验。

---

## 现状盘点（2026-07-31）

- 卡片总数：**231 张**（README 索引分组：env / scene / physics / rendering / motion / ui / core / ai）。
- 立卡判据：**缺失**。README 仅写「何时更新知识卡」，未写「何时**立**卡 / 何种内容**不**立卡」。
- 文件夹分类：**平铺**（无物理子目录），README 用 `category` 字段 + 索引分组作为唯一分类视图——与源码目录结构解耦，正确。
- `ui_entry`：模板无此字段；仅 1 张卡（`env-water.md`）自发登记 UI 入口。

---

## 候选方案

### 方案 A：分层（tier 字段，不删卡）— 推荐

引入 `tier: architecture | leaf` 字段（默认 `architecture`）：

- **architecture 卡（A 类）**：人读主对象，README 索引优先展示，要求含 `invariants` / `use_when` / `## UI 入口` 小节。
- **leaf 卡（B/C 类）**：机器索引对象，README 索引**折叠为分组计数行**（如「叶子模块 / 工具函数（38 张）」），不逐张平铺。

配套治理：
1. README 模板加 `tier` 字段说明 + 「立卡判据」段（`*v` 立 architecture 卡；`*x` 立 leaf 卡或合并进主卡）。
2. `check-doc-drift.mjs` 新增：
   - **检查 8（ERROR）**：`category` 枚举校验（非法值/占位符即报错）。
   - **检查 9（ERROR）**：`tier` 字段校验（仅 `architecture`/`leaf` 两值）。
   - **检查 10（WARN）**：architecture 卡缺失 `## UI 入口` 小节 → 警告（可配置强制范围，如 `ui`/`core`/`env`）。
3. 给现有 231 张**批量标 `tier`**（脚本初判 `invariants`/`use_when` 缺失度 + 人工复核），不删任何文件。

**优点**：人读规模从 231 降到 ~50 架构节点；机器校验零损失；drift 脚本覆盖不变；改动小、可逆。
**缺点**：需一次性给旧卡补 `tier` 元数据（约 231 处 frontmatter 编辑，可用 codemod 批量）。

### 方案 B：物理合并 / 归档 leaf 卡

将 B/C 类卡直接合并进对应主卡（如 `color-helpers` 并入 `core-leaf-modules` 的「其他工具」段），或整体归档到 `docs/knowledge/_archive/`。知识库只保留 ~50 张架构节点。

**优点**：最清爽，人读即终态。
**缺点**：
- 机器检索覆盖下降（drift 脚本的「反向覆盖」检查会报大量未覆盖源文件，INFO 噪声暴增）。
- 合并/归档是破坏性操作，旧卡 `source_files` 聚合后需重写，易引入漂移。
- 与 ADR-191「去桶化」哲学相悖——叶子模块应被**索引**而非被**吞掉**。

### 方案 C：维持现状，仅补 `category` 校验 + `ui_entry` 规范

不动分层，只在脚本加 `category` 枚举校验，模板加 `ui_entry` 字段，解决痛点 2、3，但**不解决痛点 1**（人仍面对 231 张平铺）。

**优点**：改动最小。
**缺点**：核心痛点（人读不过来）未治，知识库继续膨胀后问题更重。

---

## 决策

**采用方案 A（分层），分阶段落地。** 理由：

1. 痛点 1 是根本矛盾——知识库同时服务「人（改前必读）」与「机器（drift 校验）」两类消费者，分层是唯一不牺牲任一方的做法（呼应 ADR-191 的「分层/去重」治理哲学）。
2. 方案 A 可逆、零破坏性，且 `tier` 字段是纯增量元数据，不动 `source_files` 铁律。
3. 痛点 2、3 在方案 A 内一并解决（`category`/`tier` 校验 + `## UI 入口` 小节）。

**立卡判据（写入 README）**：

```
*v 立 architecture 卡：可独立理解、被 ≥2 子系统引用、修改有风险（状态/资源/并发不变量）
*x 不立卡 / 立 leaf 卡：纯工具函数、测试桩、barrel 聚合、单一调用方叶子
   → 合并进主卡或标 tier: leaf
```

**`ui_entry` 登记方式**：采用**正文标准小节 `## UI 入口`**（非 frontmatter 字段）——菜单路径/面板是人类可读多行内容，塞 YAML 会僵化；且复用 `env-water.md` 既有范式，不引入新字段类型。

**UI 入口事实源（2026-07-31 补充）**：菜单层级全景由自动生成的 `docs/knowledge/menu-map.md`（`scripts/gen-menu-map.mjs`，ADR-093 声明式 Schema 静态提取）承担，覆盖 Schema 树 / 导航 items / target 路由。因此：

- architecture 卡的 `## UI 入口` 小节**不重复抄菜单树**，只登记卡内运行时特有入口，或直接引用 `menu-map.md` 对应节，避免双写漂移。
- 检查 10（WARN）语义放宽：architecture 卡**有 `## UI 入口` 小节 或 引用 `menu-map.md`** 即通过。
- `menu-map.md` 局限（`renderCustom`/`custom` 运行时行、命令式 `slideRow` 行无法静态提取）由对应知识卡的 `## UI 入口` 小节补足——**静态归 menu-map，动态归卡**。

---

## 后果

### 正收益
- 人读 README 索引：从 231 张平铺 → ~50 张架构节点 + 各分组 leaf 计数，信号清晰。
- `category` 占位符不再漏网（ERROR 阻断）。
- 审核可核对「预期功能 ~ UI 入口」是否对上（WARN 扫描）。
- drift 脚本覆盖零损失。

### 负收益 / 成本
- 需一次性给 231 张旧卡补 `tier`（codemod 批量 + 人工复核约 30 张边界卡）。
- README 索引渲染需改成分层折叠（脚本生成或手工维护）。

### 风险
- `tier` 标注错误（架构节点误标 leaf → 从人读视图消失）：由 `check-doc-drift.mjs` 检查 10 的 WARN（architecture 卡缺 UI 入口）间接兜底；后续可加「leaf 卡引用数 ≥2 子系统则升级」的 lint 提示。

---

## 落地计划（分阶段）

| 阶段 | 动作 | 产出 |
|------|------|------|
| P1 | README 模板加 `tier` + 「立卡判据」段 + `## UI 入口` 小节规范 | docs/knowledge/README.md 修订 |
| P2 | `check-doc-drift.mjs` 加检查 8/9/10（category/tier 枚举 ERROR，UI 入口 WARN） | scripts/check-doc-drift.mjs 修订 |
| P3 | codemod 批量标 `tier`（按 invariants/use_when 缺失度初判）+ 人工复核边界卡 | 231 张卡 frontmatter 更新 |
| P4 | README 索引改为分层折叠（architecture 优先 + leaf 计数行） | 索引可读性提升 |
| P5 | 运行 `npm run check:docs` 验证，提交 | 守护生效 |

---

## 备选未选

- 方案 B（物理合并/归档）：破坏机器检索覆盖，与 ADR-191 哲学冲突，否决。
- 方案 C（仅补校验）：不治本，否决。
- 物理文件夹分类（按 category 拆目录）：与源码目录结构冲突（如 physics 卡跨 `scene/physics/` 与 `physics/`），引入两套组织，否决——维持平铺 + `category` 字段分组。
