# ADR-157: 设置界面信息架构重组 — 10 分类 → 7 分类

**日期**: 2026-07-21
> **状态**: 实施中 — Phase 1（IA 重组 + 缺陷修复）落地，搜索/color picker 留待 Phase 3

---

## 背景

设置菜单自 ADR-093 schema 化以来，子页面按"开发者拆文件"的思路增长到 10 个平级分类（外观/库/性能/渲染/路径/截图/音频/快捷键/软件/关于），积累出三类结构性问题：

| 问题 | 表现 |
|------|------|
| **分类语义重叠** | "性能"与"渲染"强耦合（渲染页 10 个开关仅在 custom 模式下有意义，用户需跨两个页面操作）；相机灵敏度/Y 轴反转被塞进"性能" |
| **功能错位** | 设置导入/导出/重置藏在"关于"；快捷键只读列表在"关于"重复展示（可编辑版在"快捷键"页）；"路径"页 555 行混入下载监听 + 缓存管理 |
| **代码缺陷** | 快捷键重绑 `querySelector('.slide-label')` 命中错误行；缓存统计 MutationObserver 监听 `documentElement` 全树；设置导入 `Object.assign(uiState, parsed)` 零校验；6+ 处裸中文未走 i18n |

## 决策

### 1. 信息架构：按用户心智模型重组为 7 分类

每个分类只回答用户的一个问题：

| 新分类 | 回答的问题 | 合并来源 |
|--------|-----------|---------|
| **外观** | 界面长什么样？ | 外观（原样保留） |
| **画面** | 3D 场景画质/帧率？ | 性能 + 渲染 |
| **操控** | 我怎么控制它？ | 性能(相机部分) + 快捷键 |
| **资源** | 文件在哪？ | 模型库 + 路径(路径/监听部分) |
| **媒体** | 声音和截图 | 音频 + 截图 |
| **系统** | 维护和工具 | 路径(缓存部分) + 软件 + 关于(设置管理) |
| **关于** | 这是什么版本？ | 关于（瘦身：版本/链接/更新） |

### 2. "画面"页内部流：预设 → 参数 → 效果 → 物理

```
画面
├─ 卡片1 · 性能预设      auto/quality/balanced/performance/custom
├─ 卡片2 · 帧率与画质    FPS 上限、垂直同步、渲染缩放
├─ 卡片3 · 渲染效果      阴影/bloom/fxaa/dof/… 10 开关（非 custom 时提示由预设托管）
└─ 卡片4 · 物理与HUD     默认物理、FPS 时钟、运行时徽标
```

消除"选 custom 后还得退回上级再进渲染页"的断层。

### 3. 文件结构：页面模块即分类

| 新文件 | 职责 |
|--------|------|
| `settings-graphics.ts` | 画面（合并 performance + rendering） |
| `settings-controls.ts` | 操控（相机 + 快捷键重绑） |
| `settings-resources.ts` | 资源（存储/库/路径覆盖/下载监听） |
| `settings-media.ts` | 媒体（音频 + 音效 + 截图） |
| `settings-system.ts` | 系统（缓存 + 软件 + 设置管理） |

删除：`settings-performance.ts`、`settings-rendering.ts`、`settings-shortcuts.ts`、`settings-audio.ts`、`settings-screenshot.ts`、`settings-paths.ts`、`settings-library.ts`、`settings-software.ts`。
保留：`settings.ts`（路由）、`settings-targets.ts`（常量）、`settings-shared.ts`（共享工具）、`settings-appearance.ts`、`settings-about.ts`（瘦身）、`settings-language.ts`。

软件详情页（`SOFTWARE_DETAIL_PREFIX` 动态路由）逻辑不变，仅列表入口移入"系统"。

### 4. 随迁缺陷修复（Phase 1 内）

| 缺陷 | 修法 |
|------|------|
| 快捷键重绑选择器命中错误行 | 从 `slideRow` 返回的 row 元素精确定位 `.slide-label`/`.slide-sublabel` |
| 缓存统计 MutationObserver 监听全树 | 改为 `renderCustom` 返回 dispose 函数，由 `renderMenu` 级联释放（ADR-093 已支持） |
| 设置导入零校验 | 白名单 `pick(parsed, KNOWN_UI_KEYS)` + 数值 clamp |
| `handleSettingsAction` 假 PopupRow 套娃 | 资源页内直接调用动作函数 |
| 裸中文（'UI 尺寸'/'动效'/FONT_MAP/截图标题等） | 全部过 `t()`，补齐 5 语言 i18n key |

## 后果

**正面**：
- 根级 10 → 7，每类语义正交，操作路径深度 ≤3 层
- 画面设置单页闭环，无需跨页
- 删除 ~8 个文件，页面模块与分类一一对应，新增设置项归属明确

**负面/代价**：
- 一次性迁移 ~2500 行，需构建 + 单测验证无回归
- 旧 i18n key（`settings.performance` 等根级标签）被新 key 取代，需同步 5 个语言包

**不做（留待后续）**：
- 设置搜索（Phase 3，schema 已具备遍历条件）
- 主题色 color picker（Phase 3）
- 外观"恢复默认"加确认弹窗（Phase 3 防呆批次）

## 验证

- `cd frontend && npm run build` 通过
- `cd frontend && npm run test` 单测通过
- 手动核对 7 个分类控件渲染与交互无回归
