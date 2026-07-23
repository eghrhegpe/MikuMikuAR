---
kind: shortcut_app
name: 应用快捷键定义
category: core
scope:
  - frontend/src/core/**
source_files:
  - frontend/src/core/shortcut-app.ts
adr:
  - ADR-102
---

## 系统概览
应用级快捷键定义层（从 `events.ts` 拆分），纯定义层：注册快捷键绑定到 `ShortcutRegistry`，不涉及 DOM 事件绑定。覆盖导航弹窗切换、相机模式切换、播放控制、全局关闭、截图、撤销/重做等操作。

## 核心职责
- `shortcut-app.ts` — 应用快捷键注册与绑定。

## 对外 API（节选）
- `registerAppShortcuts()` — 注册全部应用快捷键到 ShortcutRegistry。

## 已注册快捷键
| ID | 默认键 | 功能 |
|----|--------|------|
| toggle:model | Ctrl+1 | 模型库弹窗 |
| toggle:motion | Ctrl+2 | 动作面板弹窗 |
| toggle:scene | Ctrl+3 | 场景弹窗 |
| toggle:env | Ctrl+4 | 环境弹窗 |
| toggle:settings | Ctrl+5 | 设置弹窗 |
| camera:ar | Ctrl+6 | 切换 AR 相机 |
| toggle:plaza | Ctrl+7 | 模型广场弹窗 |
| playback:toggle | Space | 播放/暂停 |
| global:close | Escape | 关闭弹窗 |
| playback:seek-back | ← | 后退 5 秒 |
| playback:seek-forward | → | 前进 5 秒 |
| screenshot:current | Ctrl+F6 | 截图当前模型 |
| motion:undo | Ctrl+Z | 撤销模块参数 |
| motion:redo | Ctrl+Shift+Z | 重做模块参数 |

## 与其他子系统关系
- 依赖 `shortcut-registry` 的 `registerShortcuts` 注册快捷键。
- 依赖 `events.ts` 的 `navActions` / `navLabels` 导航映射。
- 依赖 `scene/motion/motion-modules/motion-history` 的撤销/重做。