# ADR-158 动作系统三连修：playback 守卫 / proc-motion 状态收口 / motion-popup 拆分

> **状态**: 已实施
> **日期**: 2026-07-21
> **关联**: ADR-021（程序化动作）、ADR-051（VMD 图层）

## 背景

动作系统锐评发现三个层级的问题：

1. `playback.ts:165` 渲染循环里 `throw`——初始化时序偏差会炸掉整帧渲染
2. `proc-motion-bridge.ts` 有 8 个模块级 `let`——幽灵状态，dispose 无法一键清零
3. `motion-popup.ts` 1335 行巨兽——动作绑定 + 音乐控制 + 播放控制 + 图层管理 + 入口注册全塞一个文件

## 决策

### P1: playback.ts throw → warn + return

`updatePlaybackUI` 被 `onAnimationTickObservable` 每帧调用，`mmdRuntime` / `seekBar` 为 null 时降级为 `console.warn` + 跳过本帧，不再 throw。

### P2: proc-motion-bridge 状态收口

8 个模块级 `let` 收进 `ProcMotionController` 类私有字段，懒单例 + 导出委托函数（外部 6 个调用方零改动）。`disposeProcMotion()` 一键清零 + 销毁单例。

### P3: motion-popup.ts 拆分

| 文件 | 行数 | 职责 |
|------|------|------|
| `motion-popup.ts` | ~240 | barrel + 路由 + `registerPopupMenu` 入口 |
| `motion-binding-ui.ts` | ~426 | 动作意图/广播 + per-model 绑定面板 + `handleModelAction` |
| `motion-detail-ui.ts` | ~401 | 动作详情页 + 图层管理 + 播放速度 |
| `motion-root-ui.ts` | ~293 | 根菜单构建 + retarget + 外部动作导入 |

barrel re-export 保持 API 兼容，外部调用方零改动。子文件通过 `import { getMotionMenu } from './motion-popup'` 访问菜单（函数级引用，不在模块求值期访问，循环依赖安全）。

## 验证

- tsc 零新增错误
- 1767/1768 单测通过（1 个既有 ui-helpers 失败）
- playback.test.ts 31/31 通过（3 个 `toThrow` 断言改为验证 `console.warn` + DOM 未修改）
