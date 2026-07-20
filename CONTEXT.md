# CONTEXT.md — 模型加载领域术语表

## 加载管线

- **LoadManager** — 统一加载调度器。负责串行队列、优先级插队、trace 记录、kind 分发。
- **load()** — 用户触发加载入口。带队列、UI（loading/cancel/retry）。
- **restore()** — 系统触发加载入口（场景反序列化）。同队列、high 优先级插队、无 UI。
- **loadPMXFile()** — 纯解析层，不对外暴露。不参与队列或 trace。
- **Priority Bypass** — restore 任务插入队首但不 abort 正在执行的任务的调度策略。

## 加载任务

- **ResourceKind** — 资源类型（actor / stage / prop / vmd / audio / camera-vmd / light），决定 dispacth 行为。
- **LoadRequest** — 统一加载请求（kind + path + modelId + libraryPath + innerPath）。
- **LoadPhase** — 加载阶段标签（parse / register / apply / refresh），用于 trace 和错误定位。

## 替换（Replace）

- **Replace Transaction** — 模型替换的原子操作。在单条 Promise 链内完成：加载新模型 → 继承旧状态 → 销毁旧模型 → UI 导航。
- **State Snapshot** — 替换前从旧模型提取的可继承状态集合，作为事务开始时的快照。
- **VMD Inherit** — 替换后自动在新模型播放同一 VMD 文件的子步骤。折叠进 Replace Transaction，不走调度器。
- **VMD Inherit Failure** — VMD 继承任何失败均不阻断 replace。格式：静默回退 idle。

## 相机

- **Bone Lock** — 轨道相机（ArcRotateCamera）将 target 锁定到指定骨骼的世界位置的行为。
- **Orbit** — 自由环绕模式。无骨骼锁定时，相机围绕模型中心自由旋转/缩放/平移。

## 队列

- **Single Load Queue** — 唯一的加载任务串行队列，load() 和 restore() 共享。
- **Task Continuity** — restore 内部 N 个任务抱团执行，不被用户后续 load 插断。
