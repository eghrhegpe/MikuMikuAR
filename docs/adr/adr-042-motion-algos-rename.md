# ADR-042: motion/ → motion-algos/ 目录改名

**日期**：2026-07-05
> **状态**: 已完成

---

## 背景

根级 `motion/`（算法层）与 `scene/motion/`（桥接层）命名冲突，导致 AI 重复放错文件。

## 决策

```
改名：frontend/src/motion/ → frontend/src/motion-algos/
不动：scene/motion/（桥接层）、menus/motion-*.ts（UI 层）
```

三个易混淆目录加层标签：
- `motion-algos/` ← [算法层] 无 Babylon 依赖
- `scene/motion/` ← [桥接层] 调 motion-algos/ 算法
- `menus/motion-*.ts` ← [UI层] 动作菜单面板

**改动量**：14 个文件 import 更新 + 3 处文档同步，`tsc --noEmit` + `vite build` 通过。

## 教训

目录名本身才是最强文档——`motion-algos/` 不需注释就能告诉 AI 该放什么。
