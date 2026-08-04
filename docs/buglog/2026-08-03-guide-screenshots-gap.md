# 用户指南 10 页缺失操作截图（README 铁律「能配图必须配图」未达标）

> **状态**: 🟡 搁置

**日期**: 2026-08-03
**严重程度**: 🟠 P2
**影响范围**: `docs/guide/formation.md`、`docs/guide/external-import.md`、`docs/guide/drag-mode.md`、`docs/guide/stage.md`、`docs/guide/fog.md`、`docs/guide/cloud.md`、`docs/guide/shadow.md`、`docs/guide/mirror.md`、`docs/guide/gaze-tracking.md`、`docs/guide/camera-control.md`
**发现方式**: 开发发现（guide 全量审核，2026-08-03）

---

## 问题描述

`docs/guide/README.md` 铁律「**截图优先**：能配图的操作步骤必须配图」——但 `docs/guide/img/` 目录仅 17 张图，覆盖 28 篇指南页约 60%。以下 10 页正文**零截图**（`grep -c "\.png"` 为 0）：

| 页面 | 路由 | 建议截图 |
|------|------|---------|
| `formation.md` | `models:formation` | 队形预设切换后的舞台站位 |
| `external-import.md` | `motion:retarget` | 外部动作导入重定向面板 |
| `drag-mode.md` | `scene:dragMode` | 拖拽模式开启 + 吸附设置面板 |
| `stage.md` | `scene:render:stage` | 舞台加载与多舞台管理 |
| `fog.md` | `env:fog` | 雾参数面板 |
| `cloud.md` | `env:cloud` | 云参数面板 |
| `shadow.md` | `env:shadow` | 阴影设置面板 |
| `mirror.md` | `scene:mirror` | 镜面参数面板 |
| `gaze-tracking.md` | `motion:gaze` | 视线追踪面板 |
| `camera-control.md` | 动作面板 → 相机 | 相机参数面板 |

`docs/package.json` 已有 `prebuild` 门禁：`node scripts/check-screenshots.mjs`（截图缺口仅 warn 不阻断构建）。

## 修复方案

1. 运行应用逐个进入上述面板，按 README 命名规范截图：`img/<page>-<n>.png`（如 `img/mirror-1.png`）
2. 正文 `## 操作步骤` 对应小节插入 `![描述](../guide/img/<page>-<n>.png)`
3. 截图就绪后删除「(截图占位)」文字标注（当前无残留）
4. 建议分轮推进（每轮 3-4 页），每轮验证 `npm run build`（docs）通过

## 教训

VitePress 站点渲染后无图页最显眼；截图是最终用户可读性的核心差距，优先级高于文档措辞优化。截图需运行应用逐面板操作，属人工密集型任务，故登记 🟡 搁置分轮处理。
