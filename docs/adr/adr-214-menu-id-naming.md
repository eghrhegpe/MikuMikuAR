# ADR-214: Menu ID 命名规范治理

- **状态**: ✅ 已完成（Phase 1/2/3 全部完成）
- **日期**: 2026-07-30
- **相关**: ADR-093（菜单声明式 Schema）、ADR-212（命名 vs 翻译 vs 功能错位审计）
- **源码锚点**: `frontend/src/menus/*.ts`（全部菜单文件）、`frontend/src/core/i18n/locales/en.ts`（i18n key 域）

---

## 一、审计概述

继 ADR-212 完成 `env-*` 域命名治理后，对`frontend/src/menus/` 全量 333 个 Menu ID 进行了命名规范扫描。

### 范围

| 维度 | 量级 |
|------|------|
| 扫描文件 | `frontend/src/menus/*.ts` 全部 |
| 总计 Menu ID | 333 个 |
| 与之交叉的 i18n key | ~500 个 |

---

## 二、发现的问题

### 2.1 零级无分隔符 ID（9 个）

根本问题：`id:` 字符串缺少冒号分隔符，不遵守 `domain:topic` 层级约定。

| 当前 ID | 建议改为 | 所属子系统 |
|---------|---------|-----------|
| `atmosphere` | `env:atmosphere` | 环境预设→大气 |
| `sky` | `env:sky` | 环境预设→天空 |
| `ground` | `env:ground` | 环境预设→地面 |
| `water` | `env:water` | 环境预设→水面 |
| `booth` | `plaza:booth` | 模型广场→Booth |
| `bowlroll` | `plaza:bowlroll` | 模型广场→Bowlroll |
| `mzhouse` | `plaza:mzhouse` | 模型广场→MZhouse |
| `chat` | `diagnostic:chat` | AI 诊断→对话 |
| `config` | `diagnostic:config` | AI 诊断→配置 |

**影响**：开发者无法通过 `grep "env:"` 等 domain 前缀定位这些 ID。新读者看到 `id: 'sky'` 不知道它是环境域 ID 还是某个独立的"天空"概念。

**根因**：这些 ID 很可能是早期手写 ID，在 ADR-093 声明式 Schema 普及前就已存在，后续无人统一审计。

### 2.2 分隔符不统一

`env.groundPresetCyberGrid` 是**唯一一个**使用点号 `.` 而非冒号 `:` 分隔的 Menu ID。

| 特征 | ID |
|------|----|
| 点号分隔 | `env.groundPresetCyberGrid` |
| 驼峰命名 | `CyberGrid` → 应为 `cyber-grid` |
| 无动词：`preset` | `groundPresetCyberGrid` → 应为 `env:ground:preset:cyber-grid` |

### 2.3 驼峰与连字符风格混用（~80 个 ID）

Menu ID 内部有两套并行的 Word 分隔风格：

**风格 A：驼峰 UpperCamelCase / lowerCamelCase**

```
controls:autoCenter          controls:autoCenterHint
controls:camSens              controls:camSensHint
controls:invertY              controls:invertYHint
env:cloud:sectionDetail       env:cloud:sectionLighting
env:ground:edgeFade           env:ground:gridSize
env:ground:lineColor          env:ground:reflectBlend
```

**风格 B：全小写连字符 kebab-case**

```
bone-hierarchy:root
media:shot-thumbRes         ← 但 shot-thumbRes 又混了驼峰
open-with
software-detail
```

**同一系统内两套规则**：`bone-hierarchy` 用连字符，而 `controls:autoCenter` 用驼峰——不存在分层逻辑的理由。

### 2.4 Menu ID 与 i18n key 双命名空间

菜单系统的 ID 与 i18n 翻译 key 各用一套顶层 domain，互不关联。

#### 对照表

| 概念 | Menu ID domain | i18n key domain | 矛盾 |
|------|---------------|----------------|------|
| 设置画质 | `graphics:*` | `settings.graphics.*` | 菜单用 `graphics`，i18n 用 `settings.graphics` |
| 设置外观 | `appearance:*` | `settings.appearance.*` | 同上 |
| 设置控制 | `controls:*` | `settings.perf.*` | 最严重：`controls:autoCenter` 的 i18n key 是 `settings.perf.autoCenterState`——domain 从 `controls` 变为 `perf` |
| 环境地面 | `env:ground:*` | `env.ground*` | 菜单用 `env:`，i18n 用 `env.`——分隔符不同 |
| 物理 | `wasm` / `cloth` | `motion.catSkirt` / `cloth.*` | 菜单用 `wasm`（实现词），i18n 用 `motion`（功能词）|
| 模型广场 | `booth` / `bowlroll` | `plaza.title` / `plaza.*` | 菜单无 `plaza:` 前缀，i18n 有 |

**最突出的断链**：`controls:autoCenter` → 搜 i18n 无果（实际藏在 `settings.perf.autoCenterState`）。开发者必须凭经验知道 `controls` 的 i18n 内容归 `settings.perf`。

#### 根因

ADR-093 声明式菜单 Schema 未强制规定 `id` 字段与 i18n key 的命名空间对齐规则。两套系统各自独立演进：i18n key 以 UI 面板（settings/motion/env）为域，menu ID 以功能分组（controls/appearance/graphics）为域。

---

## 三、治理方案

按影响面分级，分三阶段推进：

### Phase 1 — 零级 ID 补前缀（9 个）

纯机械改动：Menu ID 字符串 + 菜单注册表中所有引用点。零逻辑风险。

| ID | 改为 | 涉及文件 |
|----|------|---------|
| `sky` | `env:sky` | `env-sky-levels.ts` |
| `ground` | `env:ground` | `env-ground-levels.ts` |
| `water` | `env:water` | `env-water-levels.ts` |
| `atmosphere` | `env:atmosphere` | `env-preset-levels.ts` |
| `booth` | `plaza:booth` | 模型广场相关 |
| `bowlroll` | `plaza:bowlroll` | 模型广场相关 |
| `mzhouse` | `plaza:mzhouse` | 模型广场相关 |
| `chat` | `diagnostic:chat` | `diagnostic-chat.ts` |
| `config` | `diagnostic:config` | `diagnostic-config.ts` |

**迁移兼容**：不需 `_migrators`——Menu ID 不持久化，仅运行时使用。只要改源码中声明和引用的字符串即可。

### Phase 2 — 驼峰→连字符统一

建议原则：**所有 Menu ID 强制使用 `[a-z][-a-z0-9]*` 词法**（全小写 + 连字符），禁止大写字母。

**需要改的**：~80 个含大写字母的 ID（详见 §2.3）。

**不改的**：
- `env:cloud:backlight` 等全小写拼接（`backlight`、`edgeFade`、`gridSize`）——当前规则下它们合法（全小写），但建议逐步改为 `back-light`、`edge-fade`、`grid-size` 以降低视觉压字。Phase 2 不强制。

**操作方式**：
1. 在 `AGENTS.md` 或 `docs/terminology.md` 中写入命名公约
2. 新代码 Code Review 拦截驼峰 ID
3. 已有驼峰 ID 走 `codemod rename` 或批量 `SearchReplace` 工具

### Phase 3 — 建立 i18n ↔ Menu ID 映射公约

短期公约（写在 `docs/terminology.md` 中）：

> **Menu ID 的 `domain` 字段必须与对应 i18n key 的第一段保持一致**。
>
> 例如：
> - 若 i18n key 是 `settings.perf.autoCenterState`，Menu ID 应为 `settings:perf:auto-center`（而非 `controls:autoCenter`）
> - 若 i18n key 是 `env.groundColor`，Menu ID 应为 `env:ground:color`（而非 `ground`）

这一条强制执行后，从 `settings:perf:*` 到 `settings.perf.*` 可直接通过简单的分隔符替换（`:`→`.`）完成映射，消除「搜不到」问题。

**例外**：部分 Menu ID 用于 UI 仅分组（无对应 i18n key），允许自定义 domain 但不允许零级 ID。

---

## 四、影响评估

| 阶段 | 改动量 | 运行时风险 | 序列化影响 |
|------|--------|-----------|-----------|
| Phase 1（零级补前缀） | ~15 行（9 个 ID 字符串 + 引用更新） | 零 — 纯字符串改名，与持久化/绑定无关 | 无 |
| Phase 2（驼峰→连字符） | ~80 个 ID × ~2 处（声明+引用）≈ 160 行 | 低 — 纯字符串改名，但单文件改动分散 | 无 |
| Phase 3（映射公约） | 文档改动 ~10 行 + 未来 Code Review | 低 — 仅影响新代码 | 无 |

---

## 五、实施步骤

1. Phase 1：逐文件修改 9 个零级 ID，grep 确认引用点无遗留
2. `npm run check` 验证编译通过
3. Phase 2：在 docs/terminology.md 写入命名公约
4. Phase 2：批量替换驼峰 ID（分批次 PR，按文件分批，避免冲突）
5. Phase 3：在 AGENTS.md 写入 i18n ↔ Menu ID 映射公约

---

## 六、已在 ADR-212 治理中自动修复的

以下 ID 在 ADR-212 的 boolean `*Enabled` 改名中已被连带修正（随 schema 字段名更新而更新）：

- `env:particle:splash` → 对应的 schema 字段已改为 `particleSplashEnabled`，ID 需确认是否同步
- `env:ground:infinite` → 同上（`groundInfiniteEnabled`）
- `env:cloud:cover` / `env:cloud:scale` / ... → `cloudEnabled` 改名后需确认 ID 一致

建议在 Phase 2 中一并验证这些 ID 与 schema 字段名的对应关系。
