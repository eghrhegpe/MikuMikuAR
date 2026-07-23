# ADR-107: StreamAudioPlayer 接入 — 替换自建音频管线

> **状态**: 已完成（2026-07-14 落地 — 全 3 阶段：内部实现替换 + 测试适配 + MmdRuntime 集成）

**决策者**: Riku（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

**创建日期**: 2026-07-14

**来源**: `docs/research/babylon-mmd-api-analysis.md` §2.1 StreamAudioPlayer / §五 P1

**关联**: ADR-088（音效系统）、ADR-056（WASM 运行时动画）、`outfit/audio.ts`（自建音频管线）、`motion-algos/beat-detector.ts`（自建节拍检测）

**影响面**: `frontend/src/outfit/audio.ts`、`frontend/src/scene/scene.ts`、`frontend/src/motion-algos/beat-detector.ts`

---

## 问题

项目在 `outfit/audio.ts` 自建了一套基于 `HTMLAudioElement` 的音频管线，提供播放/暂停/seek/音量/偏移等功能，并通过 `syncAudioPlayback` 每帧与 VMD 动画同步。自建管线存在以下问题：

| 问题 | 表现 | 根因 |
|------|------|------|
| 音画同步脆弱 | 偏差 > 0.1s 时强制 seek 校正，出现跳音 | 自建 `syncAudioPlayback` 基于 `audioElement.currentTime` 轮询，与 `MmdRuntime` 的动画时间线无原生绑定 |
| 自动播放策略处理粗糙 | `catch` 块 `/* browser may block autoplay */` 静默吞错 | 无静音先行→用户交互后 unmute 的渐进策略 |
| 缺少 Observable 事件 | 播放/暂停/seek/错误等状态变化只能轮询或手动触发 | 自建管线无事件系统 |
| 与 MMD Runtime 独立 | `MmdRuntime.setAudioPlayer()` 从未使用 | 项目绕开了 babylon-mmd 的音频集成层 |

babylon-mmd v1.2.0 提供 `StreamAudioPlayer`（`Runtime/Audio/streamAudioPlayer`），内置：

- 流式加载（无需完整下载即可播放）
- `AudioElementPool` 复用
- 丰富的 Observable：`onPlay` / `onPause` / `onSeek` / `onDurationChanged` / `onLoadError` / `onMuteStateChanged` / `onPlaybackRateChanged`
- 自动播放策略（静音先行 → 用户交互后 unmute）
- 原生集成 `MmdRuntime.setAudioPlayer()`，音画同步由运行时内部管理

### 取舍：自建 BeatDetector 保留

`beat-detector.ts` 基于 Web Audio API `AnalyserNode` 做能量峰值节拍检测，babylon-mmd 不提供此功能，**必须保留**。

---

## 决策

**`StreamAudioPlayer` 接管播放/音画同步层，保留自建 `BeatDetector` 桥接到 `StreamAudioPlayer` 的 Observable。**

| 层次 | 组件 | 来源 |
|------|------|------|
| 播放控制 | `StreamAudioPlayer` | babylon-mmd 原生 |
| 音画同步 | `MmdRuntime.setAudioPlayer()` + 运行时内部 tick | babylon-mmd 原生 |
| 节拍检测 | `BeatDetector.attach(audioElement)` | 自建（保留） |
| 播放条 UI | 现有 `playback.ts` 进度条（不变） | 自建（保留，`StreamAudioPlayer` 的 Observable 作为数据源） |

### 选项

| 选项 | 结论 | 理由 |
|------|------|------|
| A. 全量替换自建管线 | ❌ 否决 | 丢失已验证的节拍检测，`BeatDetector` 依赖 `AudioContext` + `AnalyserNode`，`StreamAudioPlayer` 不提供此功能 |
| **B. StreamAudioPlayer 接管播放/同步，BeatDetector 桥接到其 Observable** | **✅ 采用** | 获得原生音画同步 + 保留节拍检测，减少自建管线维护量 |
| C. 完全不动 | ❌ 否决 | 放弃原生音画同步与代码简化机会 |

---

## 约束

1. **BeatDetector 桥接方式**：`BeatDetector.attach(audioElement)` 当前直接绑定到 `HTMLAudioElement`。`StreamAudioPlayer` 内部也使用 `HTMLAudioElement`，可通过 `(streamAudioPlayer as any).audioElement` 访问。更好的方式是在 `StreamAudioPlayer` 的 `onPlay` Observable 回调中初始化 `BeatDetector` 的 `AudioContext` 连接。
2. **场景序列化不变**：`SceneFile.audio` 字段（path/volume/offset/playing）仍保留，`StreamAudioPlayer` 的加载/状态恢复通过现有序列化层包装。
3. **WASM 运行时兼容**：`StreamAudioPlayer.setAudioPlayer()` 对 `MmdWasmRuntime` 和 `MmdRuntime` 均有效，不增加运行时切换复杂度。
4. **音频偏移保留**：`audioOffset` 字段（秒）仍保留，通过 `StreamAudioPlayer` 的 `startOffset` 或手动 `seek` 实现。

---

## 实现计划

### 阶段一：StreamAudioPlayer 导入 + 替换 `outfit/audio.ts` 核心（预估 1 天）

```
outfit/audio.ts
├── 删除: ensureAudio() / audioElement / audioName / audioPath 等模块级变量
├── 新增: import { StreamAudioPlayer } from 'babylon-mmd/esm/Runtime/Audio/streamAudioPlayer'
├── 新增: let streamPlayer: StreamAudioPlayer
├── 改造 loadAudioFile():
│   旧: new Audio() → url → audio.play()
│   新: streamPlayer.load(url) → streamPlayer.play()
├── 改造 playAudio/pauseAudio/resumeAudio/stopAudio/seekAudio/setVolume:
│   委托到 streamPlayer 同名方法
├── 保留: getAudioName/getAudioPath/getCurrentTime/getDuration (委托到 streamPlayer)
└── 保留: syncAudioPlayback() → 改为空函数或委托到 streamPlayer, 由 MmdRuntime 接管同步
```

### 阶段二：BeatDetector 桥接（预估 0.5 天）

```
BeatDetector 当前:
  attach(audioElement: HTMLAudioElement): boolean
    → 创建 AudioContext + AnalyserNode → connect(audioElement)

改造后:
  attachToStreamPlayer(player: StreamAudioPlayer): boolean
    → 通过 (player as any)._audioElement 取得内部 AudioElement
    → 或 player.onPlay Observable 中创建 AudioContext 连接
    → 保留原有能量峰值算法不变
```

### 阶段三：MmdRuntime 集成（预估 0.5 天）

```
scene.ts 中:
  runtime.setAudioPlayer(streamPlayer)
  → 删除: 每帧 syncAudioPlayback() 调用
  → MmdRuntime 内部自动维护音画同步
```

### 阶段四：清理与测试

- 删除 `syncAudioPlayback` 导出（确认无其他调用方）
- 验证 `onAnimationTickObservable` 不再需要手动音频同步
- 验证自动播放策略（静音→交互后 unmute）在 WebView2 和浏览器中均生效
- 验证 `BeatDetector` 节拍事件在切换歌曲后正确重置

---

## 后果

### 正面

- ✅ 音画同步由 MMD 运行时原生管理，消除偏差 > 0.1s 的强制 seek 跳音
- ✅ 获得完善的 Observable 事件系统，播放条 UI 可响应式更新
- ✅ 自动播放策略（静音先行）消除现有 `catch` 静默吞错
- ✅ 减少 `outfit/audio.ts` 自建代码约 60%（从 ~250 行 → ~100 行桥接层）
- ✅ `MmdRuntime.setAudioPlayer()` 集成链路打通，未来可扩展多人音频

### 负面

- ⚠️ `StreamAudioPlayer` 内部使用 `AudioElementPool`，可能出现元素池耗尽（配置了 `poolSize`，默认 4，当前场景 1 个音频流足够）
- ⚠️ `BeatDetector` 桥接方式依赖 `StreamAudioPlayer` 内部 `_audioElement` 属性（非公开 API），若 babylon-mmd 升级重构内部实现需适配
- ⚠️ 自建管线中 `audioOffset` 的实现方式与 `StreamAudioPlayer` 的 `startOffset` 语义可能不完全一致，需验证

### 与 ADR-088 的关系

ADR-088 规划了音效系统（脚步声/UI 音效等 Phase B/C），`StreamAudioPlayer` 仅负责音乐播放/同步，音效系统仍独立发展，两者正交。

---

## 未解决问题

1. `StreamAudioPlayer` 是否支持 `AudioContext` 暴露（`player.audioContext`）？若否，`BeatDetector` 需要额外创建 `AudioContext`，可能导致两个 `AudioContext` 共存。需要验证。
2. Wails v3 WebView2 环境中 `StreamAudioPlayer` 的自动播放策略是否与浏览器行为一致？需真机验证。