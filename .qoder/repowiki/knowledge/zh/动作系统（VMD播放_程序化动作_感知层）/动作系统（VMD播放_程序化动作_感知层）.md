---
kind: motion_system
name: 动作系统（VMD播放_程序化动作_感知层）
category: motion_system
scope:
    - frontend/src/scene/motion/
    - frontend/src/scene/physics/
    - frontend/src/scene/motion/vmd-layers.ts
    - frontend/src/scene/motion/perception.ts
    - frontend/src/scene/motion/motion-intent.ts
    - frontend/src/scene/motion/proc-motion-bridge.ts
---

## 四层架构

动作系统采用分层混合设计，从底层数据到顶层感知逐层叠加：

```
┌─────────────────────────────────┐
│ 4. 感知层 (Perception)          │ ← 呼吸/眨眼/视线/口型 (always-on)
├─────────────────────────────────┤
│ 3. 程序化层 (Procedural)        │ ← 待机/自动舞蹈/微动作
├─────────────────────────────────┤
│ 2. 意图层 (MotionIntent)        │ ← VMD 优先级仲裁 + 广播
├─────────────────────────────────┤
│ 1. 数据层 (VMD Layers)          │ ← 多 VMD 叠加 + 骨骼过滤
└─────────────────────────────────┘
```

## VMD 数据层（vmd-layers.ts, 728 行）

### 二进制解析

```typescript
// VMD 帧格式：每帧 111 字节
VMD_FRAME_SIZE = 111;  // 骨骼名(15) + 位置(12) + 旋转(16) + 插值(64) + 帧号(4)
```

### Shift-JIS 解码

```typescript
// VMD 文件名/骨骼名使用 Shift-JIS 编码
import { Encoding } from 'encoding-japanese';
function _decodeSjis(bytes: Uint8Array): string {
    return Encoding.convert(bytes, { to: 'UNICODE', from: 'SJIS', type: 'string' });
}
```

### 多 VMD 叠加 + 骨骼过滤（ADR-051）

```typescript
// 支持同时播放多个 VMD，按图层混合
function _filterVmdBones(vmd: VmdData, filter: BoneFilter): VmdData {
    // 二进制层面过滤，不解析整个文件
}
```

## 意图层（motion-intent.ts）

```typescript
// 广播动作意图到所有监听者
let _activeMotion: MotionIntent | null = null;
let _motionGen = 0;  // generation counter 守护竞态

export function broadcastMotion(intent: MotionIntent) {
    const gen = ++_motionGen;
    _activeMotion = intent;
    // 通知所有订阅者，过期 generation 的回调被忽略
}
```

### 兼容性检测

```typescript
function resolveCompatibility(vmd: VmdData): CompatibilityResult {
    // VMD 骨骼命中率 ≥ 50% → 可播放
    // 或标准 MMD 骨骼 ≥ 3 根 → 可播放
    // 否则标记为不兼容
}
```

## 感知层（perception.ts, 349 行）

Always-on 的生命感知系统，独立于 VMD 播放：

| 感知类型 | 实现方式 | 参数 |
|----------|----------|------|
| 呼吸 | 正弦波驱动脊柱微缩放 | 周期 3-4s，振幅 0.3% |
| 眨眼 | 随机间隔 + morph target | 间隔 2-6s，闭合 150ms |
| 视线追踪 | 头部骨骼微旋转 | 目标点 + 阻尼插值 |
| 微表情 | 随机 morph 组合 | 权重 0.1-0.3 |
| 口型同步 | 音频振幅 → 嘴型 morph | FFT 分析 → 5 级映射 |

```typescript
// 感知层作为 scene observer 注册
scene.onBeforeRenderObservable.add(() => {
    if (!_perceptionActive) return;
    updateBreathing(deltaTime);
    updateBlinking(deltaTime);
    updateGaze(deltaTime);
    updateLipSync(audioData);
});
```

## 程序化动作桥接（proc-motion-bridge.ts）

```typescript
// 将程序化动作（待机/微动作）注入骨骼系统
export function applyProceduralMotion(mesh: Mesh, intent: ProceduralIntent) {
    // idle: 重心微移 + 手臂轻摆
    // autoDance: 节拍驱动的全身动作
    // microMotion: 头部/手指随机微动
}
```

## 开发者规则

| 规则 | 说明 |
|------|------|
| 新增 VMD 图层 | 在 `vmd-layers.ts` 添加解析 + 混合逻辑 |
| 新增感知行为 | 在 `perception.ts` 添加 update 函数 + 开关 |
| 动作切换 | 通过 `broadcastMotion()` 统一入口，不直接修改骨骼 |
| 竞态防护 | 使用 `_motionGen` generation counter，不用布尔标志 |
