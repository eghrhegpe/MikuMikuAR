# ADR-015: 材质编辑器 UI 重构 + 逐材质开关

**日期**：2026-06-27
> **状态**: 已完成 — buildMatRootLevel/ListLevel/BatchLevel 三级面板 + _matEnabled 开关

---

## 背景

材质编辑器有两层结构：分类批量调参（4 分类 × 4 滑块）和逐材质覆盖调参（每个材质 4 滑块）。底层 API（`_catState` / `_matState` / `_applyAll`）在 `material-editor.test.ts` 有 39 个测试锁住，且 `_applyAll` 叠加顺序（分类 → 单材质）有 5 个 regression test。问题集中在 UI 层的布局混乱和语义不清晰。

同时，用户需要材质级别的显示/隐藏开关功能，控制模型局部可见性。

## 决策

### 决策 A：入口拆分（P1）

将 `buildMatCatLevel`（单函数三层职责）拆为三个独立函数：

| 层级 | 函数 | 职责 |
|------|------|------|
| 根菜单 | `buildMatRootLevel` | 4 行 slideRow：按部位批量 / 逐材质调参 / 重置所有单独调整 / 重置全部材质参数 |
| 批量子菜单 | `buildMatBatchLevel` | 仅 4 张分类卡片 + 滑块面板，**移除材质列表 + 折叠按钮 + 底部重置** |
| 逐材质子菜单 | `buildMatListLevel` | 纯材质平铺列表，点击行进入 `buildPerMatLevel`，搜索友好 |

重置按钮提到根菜单，符合 MenuStack 模式（参考设置页结构）。

### 决策 B：叠加语义可视化（P2）

- 批量页顶部：`⚠ N 个材质有单独覆盖（分类调整不影响已覆盖材质）`
- 单材质页顶部：`覆盖分类设置，分类调整仍生效于其他材质`

不改底层数据模型，仅文案提示。

### 决策 C：入口改名（P3）

模型详情中 `"材质列表"` → `"材质调节"`，避免「列表」低估功能。

### 决策 D：命名与 CSS 统一（P4）

- `buildMatCatLevel` → `buildMatBatchLevel`
- 批量滑块容器加 `.mat-cat-slider` 类，背景 `var(--card-bg)`
- 单材质滑块容器加 `.mat-mat-slider` 类，背景 `var(--white-04)` + 1px 边框

### 决策 E：逐材质开关

新增 `_matEnabled` 状态映射（`Map<模型ID, Map<材质索引, boolean>>`），默认全部启用。

- 开关操作调用 `mesh.setEnabled(bool)`（Babylon.js 原生）
- UI：材质列表 `.mat-swatch`（左侧色块圆）点击切换，禁用态显示虚线空心圆 + 行透明度 0.55
- `removeModel` 清理 `_matEnabled`
- `triggerAutoSave` 在每次开关操作时触发

## 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| 分类滑块无材质列表参考 | 中 | 用户可在根菜单进入「逐材质调参」查看列表 |
| 开关材质与参数覆盖叠加 | 低 | 开关独享 `_matEnabled` 状态，与 `_catState`/`_matState` 正交 |
| 测试覆盖 | 无 | `material-editor.test.ts` 39 tests 锁底层 API，UI 重构不涉及；`_matEnabled` 新增 cleanup |

## 实现文件

| 文件 | 改动 |
|------|------|
| `frontend/src/scene/scene.ts` | 新增 `_matEnabled` / `isMatEnabled` / `setMatEnabled`；更新 `removeModel` cleanup |
| `frontend/src/menus/model-detail.ts` | 新增 `buildMatRootLevel` / `buildMatListLevel`；重命名 `buildMatBatchLevel`；更新 `buildPerMatLevel` 叠加提示 |
| `frontend/src/menus/library-core.ts` | 更新 import `buildMatCatLevel` → `buildMatRootLevel` |
| `app.css` | 新增 `.mat-cat-slider` / `.mat-mat-slider` / `.mat-swatch-disabled` |
| `material-editor.test.ts` | 新增 `_matEnabled.clear()` cleanup |
| `model-preset.test.ts` | 新增 `_matEnabled.clear()` cleanup |
