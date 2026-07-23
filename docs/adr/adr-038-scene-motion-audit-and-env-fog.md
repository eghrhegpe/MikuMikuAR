# ADR-038: 动作系统审计修复 + 雾系统增强 + 颜色滑块拖拽

> **日期**: 2026-07-05
> **状态**: 已完成

---

## 背景

本会话完成四项改进：scene/motion 代码审计及修复、桥接层测试覆盖、颜色滑块拖拽支持、雾系统模式增强。

---

## 1. Scene/Motion 审计修复

### 审计范围

`frontend/src/scene/motion/` 四个核心文件：`playback.ts`、`vmd-loader.ts`、`lipsync-bridge.ts`、`proc-motion-bridge.ts`。

审计发现 20 项问题，按严重度排序，两轮修复全部完成。

### 第一轮（6 项修复）

| # | 文件 | 问题 | 修复 |
|---|------|------|------|
| #1 | playback.ts:96-113 | `autoLoop` 在 async then() 闭包中未快照，用户切换后状态漂移 | 闭包内 `const loop = autoLoop` 快照 |
| #8 | playback.ts | `updatePlaybackUI` 用 `mmdRuntime.animationDuration`（全局）与 auto-loop 所用 `focModel.animationDuration`（局部）不一致 | `_getDuration(mmdRuntime, _manager)` 统一获取 |
| #13 | playback.ts | `pauseHandler` 控制流嵌套难追踪，dispose 中 4 个重复 try/catch | 抽取 `_safeRemoveCallback<T>` 工具函数 |
| #6+#7 | lipsync-bridge.ts | `morphs.map` 每帧分配数组 + `morphs.some` O(M) 线性扫描 | `Set.has()` O(1) + morphNames 缓存，仅在 modelId 变化时重建 |
| #9 | proc-motion-bridge.ts | `setProcMotionEyeTrackingEnabled` / `setProcMotionHeadTrackingEnabled` 复制粘贴 | 抽取 `_setGazeTrackingSetting(field, value)` 共用函数 |
| #2+#16 | vmd-loader.ts + procedural-motion.ts | `'IdleMotion'/'AutoDance'` 魔法字符串散落 3 处；`_tryLoadCompanionAudio` 5 个串行 HEAD 请求 | 导出常量 `PROC_VMD_NAME_IDLE` / `PROC_VMD_NAME_AUTODANCE`；`Promise.any` 并行探针 |

### 第二轮（9 项修复）

| # | 文件 | 修复 |
|---|------|------|
| #10+#12 | lipsync-bridge.ts | 音源切换时清空 LipSync 状态；`!isAudioPlaying()` 时 morph 改为指数衰减 `*= 0.85`，低于 0.005 才重置 |
| #4+#17 | proc-motion-bridge.ts | `_regeneratePending` 标志排队（procStarting=true 时延迟触发）；5 个 setter 加类型/范围校验 |
| #3 | vmd-loader.ts | `_companionAudioCache: Set<string>` 避免重复加载同名伴音 |
| #15+#19 | playback.ts | `_disposed` 守卫防 double dispose；`seekAnimation` 加 `.catch` 防 `_loopPending` 卡死 |
| **misc** | playback.test.ts | `initPlaybackObservables` 开头 `_disposed = false` 修复 test isolation |

### 桥接层测试

**决策**：为桥接层（lipsync-bridge + proc-motion-bridge）编写 vitest 测试，采用 `vi.hoisted` + `vi.mock` + `vi.resetModules()` + `dynamic import` 模式，避免全局状态污染。

**实现**：
- `lipsync-bridge.test.ts` — 40 tests：set/get state、clamp 验证、updateLipSync 早期返回、启用过渡
- `proc-motion-bridge.test.ts` — 71 tests：所有 setter/getter、参数校验（bone category/boolean/interp override）、regenerate 守卫、stopProcMotion 清理

**验证**：957 tests passed（+111 净增），27 test files ✅

---

## 2. 颜色滑块拖拽支持

### 问题

`addColorSliderRow`（`ui-advanced-rows.ts`）只有 `click` 事件处理器，缺少 `mousedown`/`mousemove`/`mouseup` 拖拽支持。用户拖动滑块时无响应，只能点按定位。

此外，`.cs-bar` CSS 缺 `flex: 1`，导致在 flex 容器中坍缩为 0 宽（`.cs-fill` 基于父 0 宽 → 填充不可见 → 仅剩 2px thumb 竖线）。该 bug 与 drag 缺失叠加，使颜色滑块完全不可调。

### 决策

1. **CSS**：`.cs-bar` 加 `flex: 1`，确保其在 flex 行中正常扩展
2. **事件**：替换 `click` → `mousedown` + `mousemove` + `mouseup`
   - `mousedown`：立即设值（保持 click 等价行为）+ 注册拖拽监听
   - `mousemove`：连续更新值
   - `mouseup`：cleanup；`!didDrag` 分支对纯点击回落设值

### 验证

`npm run test`: 958 passed ✅ | `npm run build` ✅

---

## 3. 环境雾系统增强

### 问题

雾密度滑条范围 0~1，但 Babylon.js FOGMODE_EXP2 的密度有效范围仅为 0.003~0.05。用户反馈 0.1 即过浓（10 单位处仅剩 14% 原色），且无模式切换选项。

### 决策

新增三种雾模式，用户可通过选择器切换：

| 模式 | Babylon 常量 | 公式 | 参数 | 适用场景 |
|------|-------------|------|------|---------|
| EXP | `FOGMODE_EXP` | `e^(-d·distance)` | density | 柔和雾效 |
| EXP2 | `FOGMODE_EXP2` | `e^(-d·distance)²` | density | 默认，物理感浓雾 |
| LINEAR | `FOGMODE_LINEAR` | `(end-d)/(end-start)` | start/end | 清晰起止点控制 |

### 类型层

- `types.ts`：`EnvState` 新增 `fogMode: 'exp'|'exp2'|'linear'`、`fogStart: number`、`fogEnd: number`
- `state.ts`：默认 `fogMode: 'exp2'`、`fogStart: 10`、`fogEnd: 100`
- `app.go` + `models.ts`（bindings）：同步新增字段

### 应用层

- `env-impl.ts` `applyFog()`：switch 三模式 + default（console.warn + 回落 exp2）

### 桥接层

- `env-bridge.ts` `fogKeys` 添加 `fogMode/fogStart/fogEnd`

### 菜单层

- `env-feature-levels.ts`：雾区域改 `addModeSlider` 三模式选择器 + density/start/end 条件可见性（`onUpdate` 控制 `display`）

### 关联修复：_applyEnvStateFacade 子系统守卫

**问题**：`_applyEnvStateFacade` 无条件调用 `applySky`，每次 fogColor 拖拽都触发渐变纹理重建（canvas + data URL + new Texture）。

**决策**：`_applyEnvStateFacade` 新增 `partial?: Partial<EnvState>` 参数 + 按子系统分组守卫。`setEnvState` 传 `partial`，`_timeOfDayTick` 无 partial 时全触发。

六大子系统：

| 子系统 | Keys | 条件 |
|--------|------|------|
| Sky | skyMode, skyColorTop/Mid/Bot, skyTexture, skyRotationY/Speed, skyBrightness, starsEnabled, envIntensity | 有变更才调用 `applySky` |
| Ground | groundVisible, groundMode, groundColor, groundAlpha, groundTexture, groundTextureEnabled/Scale | 有变更才调用 `applyGround` |
| Fog | fogEnabled, fogColor, fogDensity, fogMode, fogStart, fogEnd | 有变更才调用 `applyFog` |
| Water | waterEnabled/Level/Color/Transparency/WaveHeight/Size/AnimSpeed + fresnel/caustic/foam/underwater 等 18 个 | 有变更才调用 water 函数 |
| Particle | particleEnabled/Type/EmitRate/Size/Speed/Splash/CustomTexture | 有变更才调用粒子函数 |
| Cloud | cloudsEnabled, cloudCover/Scale/Height/Thickness/Visibility/Gap | 有变更才调用 cloud 函数 |

### 边际审计

对全部改动做边际审计，发现并修复 2 项：
1. `applyFog` switch 无 `default` → 加 console.warn + 回落 exp2
2. `loadCameraVmdFromPath` 无 `isLoadingVmd` 卫兵 → 加 guard + finally 清理

### 验证

`npm run test`: 958 passed ✅ | `npm run build`: exit 0 ✅ | `tsc --noEmit`: clean ✅

---

## 关联代码

| 文件 | 改动 |
|------|------|
| scene/motion/playback.ts | autoLoop 快照、duration 统一、dispose guard、_safeRemoveCallback |
| scene/motion/lipsync-bridge.ts | morph Set 缓存、音源切换重置、指数衰减 |
| scene/motion/proc-motion-bridge.ts | gaze 共用 setter、regenerate 排队、setter 校验 |
| scene/motion/vmd-loader.ts | 魔法常量替换、companion audio 缓存+并行探针、loading spinner、isLoadingVmd 卫兵 |
| motion-algos/procedural-motion.ts | PROC_VMD_NAME_IDLE/PROC_VMD_NAME_AUTODANCE 导出常量 |
| __tests__/lipsync-bridge.test.ts | 新增桥接层测试 (40 tests) |
| __tests__/proc-motion-bridge.test.ts | 新增桥接层测试 (71 tests) |
| core/ui-advanced-rows.ts | addColorSliderRow mousedown/mousemove/mouseup 拖拽 |
| app.css | .cs-bar flex: 1 |
| core/types.ts | EnvState fogMode/fogStart/fogEnd |
| core/state.ts | fogMode/fogStart/fogEnd 默认值 |
| scene/env/env-impl.ts | applyFog 3 模式 + switch default |
| scene/env/env-bridge.ts | _applyEnvStateFacade 子系统守卫 + fogKeys |
| menus/env-feature-levels.ts | 雾模式选择器 + 条件参数可见性 |
| internal/app/app.go | FogMode/FogStart/FogEnd 字段 |
| bindings/mikumikuar/internal/app/models.ts | 绑定层同步 |

