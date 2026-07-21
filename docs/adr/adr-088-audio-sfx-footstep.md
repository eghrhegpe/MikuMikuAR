# ADR-088：音效系统 — 脚步声与 SFX 总线

> **状态**: Phase A + Phase B 已完成；Phase C（音乐增强）搁置（2026-07-19）
>
> **状态核对说明（2026-07-19）**：原状态行写「Phase B 待开发」，但代码核查发现 Phase B 实际早已落地——`footstep.ts:1` 文件头注释直接写「Phase A + B」，且以下 Phase B 子项均已实现：
> - ✅ **B1 地面材质 → 音色映射**：`resolveGroundSfxKind()` + `SYNTH_CFG` 5 类（concrete/grass/wood/water/default），见 `footstep.ts:34-75`。
> - ✅ **B2 左右声像**：`audio-bus.ts:135-144` 实现 `StereoPannerNode` 串联链，`footstep.ts:145-148` 按落点相对相机 X 偏移计算 pan。
> - ✅ **B3 音高随机化 + 多采样变体**：`VARIANT_COUNT=3` 不同种子合成 + `detune = ±80 音分`，见 `footstep.ts:22, 142`。
> - ✅ **B4 独立降级检测**：`footstep-detect-fallback.ts` 已落地，`footstep.ts:154-156` 在脚部跟随未开时启动 fallback。
>
> 长期挂黄灯属状态行未同步，并非真有未做工作。本次正式关闭 Phase A/B。
>
> **Phase C（音乐增强：播放列表 / crossfade / 循环模式）搁置理由**：
> - 既有单曲目播放器 + VMD 同步（`outfit/audio.ts`）已满足舞蹈演绎核心需求。
> - 播放列表与曲库管理偏「资产运营」而非「音频引擎」，无核心技术挑战，价值密度低。
> - 触发条件：用户明确反馈单曲不够用、需要 crossfade 转场时再启。
> **日期**: 2026-07-11
> **关联**: ADR-085（脚部地面跟随，提供落地事件数据源）

---

## 1. 背景与现状

用户希望为软件补齐"声音"体验：脚步声、音乐播放、交互音效。核查代码后，现状**与直觉不同**——音乐播放其实已存在，真正缺失的是"短促音效"这一类。必须先厘清边界，避免重复造轮子。

### 1.1 已实现（既有，不重做）

| 能力 | 位置 | 说明 |
|------|------|------|
| **音乐播放器** | `outfit/audio.ts` | 单曲目 `HTMLAudioElement`，支持 MP3/WAV/OGG；`playAudio`/`loadAudioFile`/`pauseAudio`/`stopAudio`/`seekAudio` |
| **音乐 ↔ 动画同步** | `outfit/audio.ts:176` `syncAudioPlayback` | 与 VMD 时间轴对齐，含 `audioOffset` 全局偏移、漂移纠正（阈值 0.1s） |
| **BPM 节拍检测** | `motion-algos/beat-detector.ts` | 基于 `AudioContext` + `AnalyserNode`，驱动 BPM 量化 |
| **音频设置菜单** | `menus/settings-audio.ts` | 默认音量、静音、音频偏移、BPM 量化、自动加载同目录音乐 |
| **音量持久化** | `uiState` 持久化（ADR-103）(`volume`/`audioOffset`) | 全局设置存储（原 `SettingsStore` 已移除） |

### 1.2 未实现（本 ADR 目标）

| 缺口 | 影响 |
|------|------|
| **脚步声** | 角色行走/落地无声音反馈，沉浸感缺失 |
| **SFX 总线** | 现有音乐用单个 `HTMLAudioElement`，无法承载"短促、可叠加、低延迟、多发"的音效（脚步声一次可能双脚交替、快速连发） |
| **地面材质 → 音色映射** | 不同地面（草地/木板/水面/石地）应有不同脚步音色 |
| **音效开关与独立音量** | SFX 音量应独立于音乐音量（互不干扰） |

---

## 2. 决策

分三层，**互相解耦**、可独立开关：

1. **SFX 总线（基础设施）**：新建 `core/audio-bus.ts`，基于共享 `AudioContext` + 主 `GainNode`，提供低延迟、多发（polyphonic）短音效播放。这是脚步声与未来所有交互音效的共同底座。
2. **脚步声（业务）**：新建 `scene/motion/footstep.ts`，消费 ADR-085 脚部跟随的**落地事件**，经 SFX 总线发声；音色按地面材质选择。
3. **音乐增强（可选，Phase C）**：在既有音乐播放器上增补播放列表 / 淡入淡出 / 循环模式（非必须，视需求）。

### 2.1 为什么脚步声不复用现有音乐播放器

| 维度 | 音乐播放器（HTMLAudioElement） | 脚步声（需 Web Audio） |
|------|------|------|
| 时长 | 长曲目（分钟级），流式 | 短音效（<300ms），预解码 |
| 并发 | 单曲目 | 多发（双脚交替、连续步伐叠加） |
| 延迟 | 可接受 | 必须低延迟（落地瞬间触发） |
| 控制 | 进度/seek | 触发即弃、音高/音量随机化 |

结论：两者是不同的音频范式。脚步声必须走 Web Audio `AudioBufferSourceNode`（一次性、可叠加），不能塞进 `HTMLAudioElement`。

---

## 3. 架构设计

### 3.1 SFX 总线 — `core/audio-bus.ts`（新增）

```ts
// 共享 AudioContext（惰性创建，首个用户手势后 resume 以绕过自动播放策略）
export function getAudioContext(): AudioContext;
// SFX 主增益（独立于音乐音量）
export function getSfxMasterGain(): GainNode;
export function setSfxVolume(v: number): void;   // 0..1，写 uiState 持久化（ADR-103）('sfxVolume')
export function getSfxVolume(): number;
export function setSfxEnabled(on: boolean): void; // 写 uiState 持久化（ADR-103）('sfxEnabled')
export function getSfxEnabled(): boolean;

// 采样缓存：url -> 已解码 AudioBuffer（避免重复 fetch/decode）
export async function loadSfxBuffer(url: string): Promise<AudioBuffer>;

// 播放一次短音效（多发安全；每次 new BufferSource，播完自动 GC）
export interface PlaySfxOptions {
    volume?: number;      // 相对音量 0..1（叠加于 master）
    rate?: number;        // playbackRate（音高/速度），默认 1
    detune?: number;      // 音分偏移（随机化用），默认 0
}
export function playSfx(buffer: AudioBuffer, opts?: PlaySfxOptions): void;

// 释放（dispose 时关闭 context、清缓存）
export function disposeAudioBus(): void;
```

**要点**：
- **单一 `AudioContext`**：SFX 总线与 beat-detector 应共享同一 context，避免多 context 资源浪费。落地后需评估 beat-detector 是否迁移到复用 `getAudioContext()`（Phase A 先不动 beat-detector，仅新建独立 context；Phase B 再考虑合流）。
- **自动播放策略**：浏览器/WebView2 要求首个用户手势后才能 `resume()`。总线在首次 `playSfx` 前检测 `context.state === 'suspended'` 并尝试 resume。
- **音量独立**：`sfxVolume`/`sfxEnabled` 独立于音乐 `volume`，互不影响。

### 3.2 落地事件 — 复用 ADR-085 脚部跟随

脚步声的触发源是"脚落地的瞬间"。ADR-085 的 `feet-adjustment.ts` 每帧已算出每只脚的 `footY`、`groundY`、`grounded`（是否贴地），但目前未对外暴露。

**方案**：在 `feet-adjustment.ts` 增加一个可选的落地事件回调，检测 `grounded` 的**上升沿**（上一帧离地 → 本帧贴地）：

```ts
// 落地事件：脚从空中接触地面的瞬间
export interface FootLandEvent {
    modelId: string;
    foot: 'L' | 'R';
    groundY: number;
    impactSpeed: number;   // 落地垂直速度（|Δ footY / Δt|），用于音量映射
    worldX: number;
    worldZ: number;        // 落点世界坐标（供地面材质采样）
}
export function setOnFootLand(cb: ((e: FootLandEvent) => void) | null): void;
```

**检测逻辑**（在 `_adjustFoot` 内，纯状态转换，可单测）：
- 维护每脚上一帧 `wasGrounded` 与上一帧 `footY`。
- 当 `!wasGrounded && grounded` → 触发 `onFootLand`，`impactSpeed = |footY_prev − footY| / dt`。
- 加**去抖**：同一只脚两次落地间隔 < `MIN_STEP_INTERVAL`（如 120ms）忽略，防抖动误触发。

**优点**：脚步声与脚部跟随天然对齐——脚真正贴地才响，抬脚/跳跃（`skip=true`）不响。纯数学的落地判定可抽到 `motion-algos/` 单测。

> ⚠️ **依赖约束**：`feet-adjustment` 需开启才有落地事件。若用户未开脚部跟随，脚步声需**独立的落地检测降级路径**（仅监听脚 IK 骨骼世界 Y 相对 groundY 的上升沿，不依赖 IK 重解）。Phase A 先绑定 feet-adjustment；Phase B 补降级路径。

### 3.3 地面材质 → 音色映射

```ts
// footstep.ts 内
type GroundSfxKind = 'concrete' | 'grass' | 'wood' | 'water' | 'default';
// 依据 envState.groundType / envState.groundStyle / groundTexture 推断音色类别
function resolveGroundSfxKind(): GroundSfxKind;
```

- `groundType === 'terrain'`（原 `heightmap`）→ `concrete`（默认硬地）
- `groundType === 'flat'` + `groundStyle` 为 `solid`/`grid`/`checker` → `default`（中性）
- `groundType === 'flat'` + `groundStyle === 'texture'` → 按 `groundTexture` 文件名关键字（grass/wood/...）推断，兜底 `default`
- 水面（`planarReflectBlend > 0` 或水体激活）→ `water`（溅水声）

> 注：地面模式分类已在 ADR-089 拆分为 `groundType`(flat|terrain) + `groundStyle`(solid|grid|checker|texture) 两轴，本节的"原 `groundMode`"表述作废。详见 §10。

每类音色对应 1–N 个采样（多采样随机选 + 音高随机化，避免机械重复感）。采样文件放 `frontend/public/audio/footsteps/<kind>/*.ogg`（或 Web Audio 程序化合成，见 §6 权衡）。

### 3.4 脚步声控制器 — `scene/motion/footstep.ts`（新增）

```ts
export function startFootstep(scene: Scene): void;  // 注册 setOnFootLand 回调
export function stopFootstep(): void;

// 落地 → 选音色 → 取 buffer → playSfx（音量随 impactSpeed 映射，音高随机化）
```

- **音量映射**：`vol = clamp(impactSpeed / REF_SPEED, 0.2, 1) * footstepVolume`（轻踩轻响、重踏重响）。
- **音高随机化**：`detune = random(-80, +80)` 音分，避免每步同音。
- **左右声像**（可选 Phase B）：按落点相对相机的 X 偏移设 `StereoPannerNode`。

### 3.5 状态管理

脚步声/SFX 是**全局播放器配置**（非 per-model），归 `uiState` 持久化（ADR-103）+ `EnvState`：

| 字段 | 存储 | 默认 | 说明 |
|------|------|------|------|
| `sfxEnabled` | uiState（ADR-103） | `true` | SFX 总线总开关 |
| `sfxVolume` | uiState（ADR-103） | `0.7` | SFX 主音量（独立于音乐） |
| `footstepEnabled` | uiState（ADR-103） | `false` | 脚步声开关（默认关，避免意外发声） |
| `footstepVolume` | uiState（ADR-103） | `0.8` | 脚步声相对音量 |

> 与 ADR-085 `FeetState`（per-model）不同：脚步声是听觉全局配置，一套即可。

---

## 4. 文件变更清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `frontend/src/core/audio-bus.ts` | **新增** | SFX 总线：共享 AudioContext + 主增益 + 采样缓存 + `playSfx` 多发 |
| `frontend/src/motion-algos/footstep-detect.ts` | **新增** | 纯落地判定（grounded 上升沿 + 去抖 + impactSpeed），无 Babylon 依赖，可单测 |
| `frontend/src/scene/motion/footstep.ts` | **新增** | 脚步声控制器：消费落地事件 → 选音色 → `playSfx` |
| `frontend/src/scene/motion/feet-adjustment.ts` | 修改 | 增 `setOnFootLand` 回调 + 落地上升沿检测（调用 `footstep-detect`） |
| `frontend/src/menus/settings-audio.ts` | 修改 | 增 SFX 总音量/开关 + 脚步声开关/音量卡片 |
| `frontend/src/scene/scene.ts` | 修改 | 注册 `startFootstep`（在 `startFeetAdjustment` 之后） |
| `frontend/src/__tests__/footstep-detect.test.ts` | **新增** | 落地判定单测（上升沿、去抖、impactSpeed、抬脚不触发） |
| `frontend/src/core/i18n/locales/*.ts` | 修改 | 5 语种新增 `settings.sfx.*` / `settings.footstep.*` 键 |
| `frontend/public/audio/footsteps/` | **新增** | 各材质脚步采样（或改用程序化合成，见 §6） |

---

## 5. 分期

### Phase A — 脚步声核心（最小可用）
1. `core/audio-bus.ts`：SFX 总线（AudioContext + master gain + playSfx + 采样缓存）。
2. `motion-algos/footstep-detect.ts` + 单测：落地上升沿 + 去抖。
3. `feet-adjustment.ts`：`setOnFootLand` 回调接入。
4. `scene/motion/footstep.ts`：默认音色（单一采样/合成），落地发声。
5. `settings-audio.ts`：脚步声开关 + 音量。
6. `scene.ts` 注册。
→ **验收**：地形上行走，落地有声、抬脚无声、音量随力度变化。

### Phase B — 材质音色 + 体验打磨
1. 地面材质 → 音色映射（concrete/grass/wood/water/default）。
2. 音高随机化 + 多采样随机。
3. 左右声像（StereoPannerNode）。
4. feet-adjustment 未开时的**独立落地降级检测**。

### Phase C — 音乐增强（可选）
1. 播放列表 / 上一首下一首。
2. 曲目切换淡入淡出（crossfade）。
3. 循环模式（单曲/列表/随机）。
> 现有单曲目播放已满足基本需求，本阶段按需推进。

---

## 6. 风险与权衡

| 项 | 权衡 |
|----|------|
| **采样文件 vs 程序化合成** | ① 采样：真实感好，但需引入音频资源（体积、版权）。② Web Audio 程序化合成（噪声脉冲 + 包络 + 滤波）：零资源、可调，但真实感弱。**建议 Phase A 用程序化合成**（快速验证链路、无资源依赖），Phase B 视效果决定是否引入采样。 |
| **AudioContext 自动播放策略** | WebView2/浏览器需用户手势后 resume。总线首次播放前检测并 resume；若仍 suspended，静默跳过（不报错）。 |
| **多 AudioContext** | 与 beat-detector 各建 context 有资源浪费。Phase A 容忍；Phase B 评估合流到单一 `getAudioContext()`。 |
| **落地事件依赖 feet-adjustment** | 未开脚部跟随则无事件。Phase A 明确此依赖；Phase B 补降级路径。 |
| **物理模式** | ADR-085 已知：物理驱动腿时 IK 重解被跳过，`grounded` 可能不更新 → 脚步声可能失效。沿用该已知限制，Phase B 评估独立检测。 |
| **性能** | `playSfx` 每次 new BufferSource，高频连发（如快速舞步）可能积压。加最小间隔去抖（120ms/脚）+ 采样缓存复用 buffer。 |

---

## 7. i18n 键（5 语种）

```
settings.sfx.title / settings.sfx.volume / settings.sfx.enabled
settings.footstep.title / settings.footstep.enabled / settings.footstep.volume
```

---

## 8. 决策确认（架构师已定，2026-07-11）

1. **音源策略**：✅ **程序化合成**（零资源、快速验证链路）。`footstep.ts:synthFootstep` 用噪声脉冲 + 低频 thump + 衰减包络 + 一阶低通，按地面材质微调音色；buffer 按 kind 缓存复用。
2. **音乐增强（Phase C）**：本轮**不做**，沿用既有单曲目播放器。
3. **默认开关**：✅ 脚步声默认关闭（`footstepEnabled: false`），用户主动开启；SFX 总线默认开（`sfxEnabled: true`，`sfxVolume: 0.7`）。

---

## 9. 实现记录（Phase A）

### 9.1 文件落地

| 文件 | 类型 | 说明 |
|------|------|------|
| `core/audio-bus.ts` | 新增 | SFX 总线：共享 AudioContext + 主增益 + `playSfx`（多发 BufferSource）+ 采样/合成缓存；`sfxEnabled`/`sfxVolume`/`footstepEnabled`/`footstepVolume` 读写 |
| `motion-algos/footstep-detect.ts` | 新增 | 纯落地判定（grounded 上升沿 + 去抖 `minInterval=120ms` + `impactSpeed` 估算），无 Babylon 依赖 |
| `scene/motion/footstep.ts` | 新增 | 脚步声控制器：消费落地事件 → 程序化合成 → `playSfx`（音量随 `impactSpeed` 归一、±80 音分随机）|
| `scene/motion/feet-adjustment.ts` | 修改 | 增 `FootLandEvent` + `setOnFootLand`；`_adjustFoot` 每帧计算 `grounded` 上升沿并触发回调（去抖在 detect 内）|
| `scene/scene.ts` | 修改 | 注册 `startFootstep`（在 `startFeetAdjustment` 之后）|
| `menus/settings-audio.ts` | 修改 | 增 SFX 总开关/音量 + 脚步声开关/音量卡片（5 语种 i18n）|
| `lib/settings-store.ts` | 修改 | 增 `sfxEnabled`/`sfxVolume`/`footstepEnabled`/`footstepVolume` 键与默认值 |
| `__tests__/footstep-detect.test.ts` | 新增 | 7 例纯逻辑单测（上升沿/持续贴地/抬脚/去抖/边界/impactSpeed）|

### 9.2 已知约束（Phase A 范围）

- **依赖脚部跟随**：脚步声的落地事件由 ADR-085 `feet-adjustment` 产生，**必须开启脚部贴地**才有声音。未开脚部跟随时无落地事件（Phase B 补独立降级检测）。
- **物理模式**：ADR-085 已知，物理驱动腿时 IK 重解被跳过 → `grounded` 不更新 → 脚步声失效。
- **平地无落差**：见 ADR-085——平地 `groundY=0` 且动画脚本就在 0 附近，落地事件仍触发（脚每步落回 0），只是视觉落差小。

### 9.3 连带修复（正交但阻塞编译）

`env-impl.ts:getTiltedPlaneHeight` 误用 `Vector3.TransformCoordinatesToRef(0,0,0,world,point)`（该签名仅 3 参），改为 `TransformCoordinatesFromFloatsToRef`（5 参）。此函数正是此前分析的「**其他地面模式（grid/checker/texture/solid）倾斜后脚步跟随失效**」的根因修复——倾斜平面现在能正确返回高度，脚部跟随与脚步声在倾斜非 heightmap 地面亦可生效。

### 9.4 验证

| 维度 | 命令 | 结果 |
|------|------|------|
| 类型检查 | `npm run check` | ✅ exit 0 |
| 单元测试 | `npm run test` | ✅ 43 文件 / **1260** 用例全绿（含新 7 例）|
| 生产构建 | `npm run build` | ✅ exit 0 |

---

## 10. 修订注记（地面模式拆分后，2026-07-12）

> 关联 **ADR-089**（地面模式分类重构：`groundMode` → `groundType` + `groundStyle`）。

### 10.1 对 Phase A 的影响：零回归

地面模式分类重构（ADR-089）将单枚举 `groundMode` 拆分为几何类型 `groundType`(`flat`|`terrain`) 与外观样式 `groundStyle`(`solid`|`grid`|`checker`|`texture`) 两轴。`resolveGroundSfxKind()` 已随之迁移，音色映射语义**逐条等价、零行为回归**：

| 旧 `groundMode` | 旧音色 | 新两轴 | 新音色 |
|----------------|--------|--------|--------|
| `heightmap` | `concrete` | `groundType==='terrain'` | `concrete` |
| `texture` | grass/wood/default | `flat`+`texture` | grass/wood/default |
| `solid` | `default` | `flat`+`solid` | `default` |
| `grid` | `default` | `flat`+`grid` | `default` |
| `checker` | `default` | `flat`+`checker` | `default` |
| 水面激活 | `water` | 同（`planarReflectBlend>0`/水体） | `water` |

`SYNTH_CFG` 的 5 项音色配置（concrete/grass/wood/water/default）完整保留，未删减。

### 10.2 审核发现与处置（ADR-088 Phase A 审核，2026-07-11）

| 项 | 结论 | 处置 |
|----|------|------|
| 🟡 P3 `FEET_DEBUG = true` | `feet-adjustment.ts` 诊断日志每 60/90 帧 `console.log`，生产环境刷屏风险 | ✅ **已改为 `false`**（feet-adjustment.ts:62，2026-07-12） |
| 🟢 P4 dispose 链缺失 | `disposeRenderer()` 未调用 `stopFootstep`/`stopFeetAdjustment`/`disposeAudioBus`；当前 Wails 刷新场景全灭无影响，但 Phase B 引入热重载会累积缓存 | ⏸️ 保持开放，建议 Phase B 顺手在 `disposeRenderer()` 末尾接入调用链 |
| 类型安全 | `webkitAudioContext`、`linkedBone` 转型均有业务理由（Safari polyfill / babylon-mmd 内部脏标记） | ✅ 不受影响 |
| 数据流无幽灵路径 | `_cache`(feet-adjustment)、`_synthCache`(footstep) 生命周期受控，拆分未触碰 | ✅ 不受影响 |

### 10.3 文档措辞同步

§3.3「地面材质 → 音色映射」已据两轴方案改写，原 `groundMode` 表述作废。Phase B 预告（§5）中"地面材质 → 音色映射"同理按两轴理解；降级路径（§3.2 末、§5-B.4）为独立新增文件，与本次拆分正交。
