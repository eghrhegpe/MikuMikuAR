# ADR-079 Phase 3: Lip-sync 架构归位迁移计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 lipsync-bridge.ts 的实时口型同步逻辑迁入 perception.ts 统一 observer 调度，整合 LipSyncState 与 PerceptionState，删除 lipsync-bridge.ts 旧调用点，实现「感知层完全统一」的架构目标。

**Architecture:** 在 `perception.ts` 新增 `_applyLipSync(mmdModel, time, enabled)` 函数，复用现有 `getProcBeatDetector()` 音频管道 + `amplitudeToWeight` 映射算法 + `_lastMorphNameSet` 缓存优化。LipSyncState 字段合并入 PerceptionState（保持独立 setter）。旧 `lipsync-bridge.ts` 的 `updateLipSync` 调用点从 `playback.ts` tickHandler 移除，`initLipSync` 注入点保留但改为空壳或删除。`scene-serialize.ts` 扩展序列化迁移。

**Tech Stack:** TypeScript, Babylon.js, babylon-mmd, Web Audio API, Vitest

---

## 前置知识（调研已确认的事实）

### 已有基础设施（Phase 3 直接复用，不新建）

1. **AudioContext 管道**：`beat-detector.ts` 已实现完整的 AnalyserNode + getByteFrequencyData + getLevel(startBin, endBin)，通过 `getProcBeatDetector()` 单例获取
2. **口型 morph 命名**：`lipsync.ts` 的 `LIP_MORPH_CANDIDATES` + `MOUTH_MORPHS` + `findLipMorph` / `findAllLipMorphs`
3. **振幅映射算法**：`lipsync.ts` 的 `amplitudeToWeight(amplitude, sensitivity, intensity)` 纯函数
4. **实时桥接逻辑**：`lipsync-bridge.ts` 的 `updateLipSync()` 已含低通滤波、音源切换重置、静音指数衰减（ADR-038 成果）
5. **morph 写入模式**：perception.ts 的 `_applyMicroExpression` 已建立「morphTargetManager + getMorphTargetByName + influence」模板

### 当前调用链（迁移后需拆解）

```
scene.ts:99   import { updateLipSync, initLipSync } from './motion/lipsync-bridge'
scene.ts:220  initLipSync(modelManager)              ← 注入 ModelManager
scene.ts:241  tickHandler 注册 updateLipSync           ← 每帧调用点
playback.ts:79  updateLipSync()                       ← 实际触发点
```

迁移后：`updateLipSync` 逻辑进入 perception.ts observer，`playback.ts` 的 `updateLipSync()` 调用删除。

### 关键风险与约束

1. **AudioContext 单例**：`createMediaElementSource` 只能调一次，必须复用 `getProcBeatDetector()`，不能新建 AudioContext
2. **morph 写入竞争**：lipsync 的 `smile` 候选（にこり/笑い）与 `_applyMicroExpression` 的 happy 候选（にっこり/笑み）命名空间重叠——需确认顺序：微表情先写，lipsync 后写（同帧后者覆盖），或 lipsync 的 smile 用独立候选
3. **状态机完整性**：音源切换重置（#10）+ 静音指数衰减（#12）必须完整搬运，不能丢
4. **morph 缓存**：`_lastMorphNameSet` 按 modelId 缓存消除 O(M) 扫描，必须保留
5. **modelManager 注入**：perception.ts 已有 modelManager 引用（通过 `modelManager.get`），不需 `initLipSync` 注入

---

## 文件结构

| 文件 | 职责 | 操作 |
|------|------|------|
| `frontend/src/scene/motion/perception.ts` | 感知层核心 | 修改：新增 `_applyLipSync` + 扩展 `PerceptionState` + setter |
| `frontend/src/__tests__/perception.test.ts` | 感知层测试 | 修改：新增 lip-sync 测试 |
| `frontend/src/scene/motion/lipsync-bridge.ts` | 旧 lipsync 桥接 | 修改：`updateLipSync` 改为空壳或删除，保留 state getter/setter 兼容期 |
| `frontend/src/scene/motion/playback.ts` | 播放 tickHandler | 修改：移除 `updateLipSync()` 调用 |
| `frontend/src/scene/scene.ts` | 场景初始化 | 修改：移除 `initLipSync` 调用（perception 已有 modelManager） |
| `frontend/src/scene/scene-serialize.ts` | 场景序列化 | 修改：扩展 lip-sync 字段迁移 |
| `frontend/src/menus/motion-gaze-levels.ts` | Gaze/感知 UI | 修改：新增 lip-sync 开关 + 灵敏度/强度滑块 |
| `frontend/src/core/i18n/locales/{zh-CN,en,ja,ko,zh-TW}.ts` | i18n | 修改：新增翻译键 |
| `docs/adr/adr-079-perception-layer-expansion.md` | ADR | 修改：Phase 3 完成记录 |

---

## Task 1: 扩展 PerceptionState 加入 lip-sync 字段

**Files:**
- Modify: `frontend/src/scene/motion/perception.ts`
- Test: `frontend/src/__tests__/perception.test.ts`

- [ ] **Step 1: 写失败测试**

在 `frontend/src/__tests__/perception.test.ts` 末尾新增：

```typescript
// =====================================================================
// Lip-sync 状态
// =====================================================================

describe('lipSync state', () => {
    it('默认 lipSyncEnabled 为 false（需用户主动开启）', () => {
        const sut = makeSut();
        const state = sut.getPerceptionState();
        expect(state.lipSyncEnabled).toBe(false);
    });

    it('默认 sensitivity=0.2, intensity=0.8, multiMorphEnabled=false', () => {
        const sut = makeSut();
        const state = sut.getPerceptionState();
        expect(state.lipSyncSensitivity).toBe(0.2);
        expect(state.lipSyncIntensity).toBe(0.8);
        expect(state.lipSyncMultiMorphEnabled).toBe(false);
    });

    it('setLipSyncEnabled 可开启 lip-sync', () => {
        const sut = makeSut();
        sut.setLipSyncEnabled(true);
        expect(sut.getPerceptionState().lipSyncEnabled).toBe(true);
    });

    it('setLipSyncSensitivity 钳制 0..1', () => {
        const sut = makeSut();
        sut.setLipSyncSensitivity(1.5);
        expect(sut.getPerceptionState().lipSyncSensitivity).toBe(1);
        sut.setLipSyncSensitivity(-0.5);
        expect(sut.getPerceptionState().lipSyncSensitivity).toBe(0);
    });

    it('setLipSyncIntensity 钳制 0..1', () => {
        const sut = makeSut();
        sut.setLipSyncIntensity(2.0);
        expect(sut.getPerceptionState().lipSyncIntensity).toBe(1);
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/__tests__/perception.test.ts`
Expected: FAIL — `state.lipSyncEnabled` is undefined

- [ ] **Step 3: 扩展 PerceptionState 接口与默认值**

在 `frontend/src/scene/motion/perception.ts` 修改 `PerceptionState` 接口（紧邻 `balanceSwayEnabled` 之后）：

```typescript
export interface PerceptionState {
    breathEnabled: boolean;
    blinkEnabled: boolean;
    headTrackingEnabled: boolean;
    eyeTrackingEnabled: boolean;
    microExpressionEnabled: boolean;
    emotion: Emotion;
    balanceSwayEnabled: boolean;
    // Lip-sync（从 lipsync-bridge.ts 迁入）
    lipSyncEnabled: boolean;
    lipSyncSensitivity: number;  // 0..1，振幅阈值
    lipSyncIntensity: number;    // 0..1，最大张嘴幅度
    lipSyncMultiMorphEnabled: boolean;  // 驱动多口型 morph
}
```

`DEFAULT_PERCEPTION_STATE` 新增（注意 `lipSyncEnabled` 默认 `false`，与 `DEFAULT_LIPSYNC_STATE.enabled` 一致）：

```typescript
const DEFAULT_PERCEPTION_STATE: PerceptionState = {
    breathEnabled: true,
    blinkEnabled: true,
    headTrackingEnabled: true,
    eyeTrackingEnabled: true,
    microExpressionEnabled: true,
    emotion: 'neutral',
    balanceSwayEnabled: true,
    lipSyncEnabled: false,
    lipSyncSensitivity: 0.2,
    lipSyncIntensity: 0.8,
    lipSyncMultiMorphEnabled: false,
};
```

新增独立 setter（紧邻 `setBalanceSwayEnabled` 之后）：

```typescript
/** 设置 lip-sync 开关 */
export function setLipSyncEnabled(enabled: boolean): void {
    perceptionState = { ...perceptionState, lipSyncEnabled: enabled };
    triggerAutoSave();
}

/** 设置 lip-sync 灵敏度（钳制 0..1） */
export function setLipSyncSensitivity(v: number): void {
    perceptionState = { ...perceptionState, lipSyncSensitivity: Math.max(0, Math.min(1, v)) };
    triggerAutoSave();
}

/** 设置 lip-sync 强度（钳制 0..1） */
export function setLipSyncIntensity(v: number): void {
    perceptionState = { ...perceptionState, lipSyncIntensity: Math.max(0, Math.min(1, v)) };
    triggerAutoSave();
}

/** 设置多口型 morph 开关 */
export function setLipSyncMultiMorphEnabled(v: boolean): void {
    perceptionState = { ...perceptionState, lipSyncMultiMorphEnabled: v };
    triggerAutoSave();
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/__tests__/perception.test.ts`
Expected: PASS

- [ ] **Step 5: 类型检查 + 提交**

Run: `cd frontend && npm run check`
Expected: PASS

```bash
git add frontend/src/scene/motion/perception.ts frontend/src/__tests__/perception.test.ts
git commit -m "feat(perception): 扩展 PerceptionState 加入 lip-sync 字段"
```

---

## Task 2: 实现 _applyLipSync 实时叠加

**Files:**
- Modify: `frontend/src/scene/motion/perception.ts`（新增函数 + 注册到 observer）
- Test: `frontend/src/__tests__/perception.test.ts`

**设计说明**：
- 从 `getProcBeatDetector()` 取音频能量（复用现有管道）
- 从 `lipsync.ts` 导入 `findLipMorph` / `findAllLipMorphs` / `amplitudeToWeight`
- morph 写入用 perception.ts 已有的 `morphTargetManager` 模式（与 `_applyMicroExpression` 一致）
- 完整搬运 lipsync-bridge.ts 的状态机：音源切换重置 + 静音指数衰减 + 低通滤波 + morph 缓存
- 关闭时复位 morph influence 到 0（防残留，与 `_applyMicroExpression` 同款）
- observer 注册在重心微动之后、gaze 之前（step 5）

**morph 写入方式差异**：lipsync-bridge 用 `setModelMorphWeight(modelId, name, weight)`（通过 modelManager 间接写入），perception.ts 用 `morphTargetManager.getMorphTargetByName(name).influence = weight`（直接写入）。迁移时改用 perception.ts 的直接写入方式，因为 perception.ts 已有 mmdModel 引用。

- [ ] **Step 1: grep 确认导入路径**

```bash
cd frontend && rg -n "getProcBeatDetector" src/scene/motion/proc-motion-bridge.ts
cd frontend && rg -n "isAudioPlaying|getAudioPath" src/outfit/audio.ts
cd frontend && rg -n "findLipMorph|findAllLipMorphs|amplitudeToWeight" src/motion-algos/lipsync.ts
```

确认 `getProcBeatDetector` 从 `./proc-motion-bridge` 导入，`isAudioPlaying`/`getAudioPath` 从 `@/outfit/audio` 导入，lip-sync 函数从 `@/motion-algos/lipsync` 导入。

- [ ] **Step 2: 写失败测试**

在 `frontend/src/__tests__/perception.test.ts` 新增（参考 `_applyMicroExpression` 测试的 mock 模式）：

```typescript
// =====================================================================
// _applyLipSync 实时叠加（通过 observer 回调触发）
// =====================================================================

describe('_applyLipSync', () => {
    beforeEach(() => {
        vi.spyOn(performance, 'now').mockReturnValue(0);
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('lipSyncEnabled=false 时不写入任何 morph', () => {
        const sut = makeSut();
        const mockMorphManager = makeMockMorphManager(['あ']);
        const mmdModel = makeMockModelWithMorphManager(mockMorphManager);
        mockState.modelManager.get.mockReturnValue({ mmdModel });
        sut.setLipSyncEnabled(false);
        sut.activatePerception('m1');
        triggerLastObserver();
        expect(mockMorphManager.getInfluence('あ')).toBe(0);
    });

    it('开启且音频播放时写入 あ morph', () => {
        const sut = makeSut();
        const mockMorphManager = makeMockMorphManager(['あ']);
        const mmdModel = makeMockModelWithMorphManager(mockMorphManager);
        mockState.modelManager.get.mockReturnValue({ mmdModel });
        // mock 音频播放 + BeatDetector
        vi.mock('@/outfit/audio', () => ({
            isAudioPlaying: vi.fn(() => true),
            getAudioPath: vi.fn(() => '/test/audio.mp3'),
        }));
        vi.mock('./proc-motion-bridge', () => ({
            getProcBeatDetector: vi.fn(() => ({
                getLevel: vi.fn(() => 0.5),
            })),
        }));
        sut.setLipSyncEnabled(true);
        sut.activatePerception('m1');
        triggerLastObserver();
        // あ morph 应被写入（amplitudeToWeight(0.5, 0.2, 0.8) > 0）
        expect(mockMorphManager.getInfluence('あ')).toBeGreaterThan(0);
    });

    it('morph 不存在时静默跳过', () => {
        const sut = makeSut();
        const mockMorphManager = makeMockMorphManager([]);
        const mmdModel = makeMockModelWithMorphManager(mockMorphManager);
        mockState.modelManager.get.mockReturnValue({ mmdModel });
        sut.setLipSyncEnabled(true);
        sut.activatePerception('m1');
        expect(() => triggerLastObserver()).not.toThrow();
    });

    it('关闭后 morph influence 归零（防残留）', () => {
        const sut = makeSut();
        const mockMorphManager = makeMockMorphManager(['あ']);
        const mmdModel = makeMockModelWithMorphManager(mockMorphManager);
        mockState.modelManager.get.mockReturnValue({ mmdModel });
        // mock 音频
        vi.mock('@/outfit/audio', () => ({
            isAudioPlaying: vi.fn(() => true),
            getAudioPath: vi.fn(() => '/test/audio.mp3'),
        }));
        vi.mock('./proc-motion-bridge', () => ({
            getProcBeatDetector: vi.fn(() => ({
                getLevel: vi.fn(() => 0.5),
            })),
        }));
        sut.setLipSyncEnabled(true);
        sut.activatePerception('m1');
        triggerLastObserver();
        expect(mockMorphManager.getInfluence('あ')).toBeGreaterThan(0);
        // 关闭
        sut.setLipSyncEnabled(false);
        triggerLastObserver();
        expect(mockMorphManager.getInfluence('あ')).toBe(0);
    });
});
```

**注意**：mock 路径需根据实际 vi.mock 的模块解析调整。先读 perception.test.ts 现有 vi.mock 结构确认路径格式。若 vi.mock 动态导入与 perception.ts 的静态导入冲突，改用 `vi.spyOn` 方式 mock `getProcBeatDetector` 和 `isAudioPlaying`。

- [ ] **Step 3: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/__tests__/perception.test.ts`
Expected: FAIL

- [ ] **Step 4: 实现 _applyLipSync**

在 `frontend/src/scene/motion/perception.ts` 新增导入（顶部）：

```typescript
import { getProcBeatDetector } from './proc-motion-bridge';
import { isAudioPlaying, getAudioPath } from '@/outfit/audio';
import { findLipMorph, findAllLipMorphs, amplitudeToWeight } from '@/motion-algos/lipsync';
```

新增函数（紧邻 `_applyBalanceSway` 之后）：

```typescript
// ── Lip-sync（口型同步，从 lipsync-bridge.ts 迁移） ──

/** 人声频段范围（与 lipsync-bridge.ts 一致） */
const VOICE_BIN_START = 10;
const VOICE_BIN_END = 50;
const HIGH_BIN_START = 25;
const HIGH_BIN_END = 50;

/** lip-sync 状态机（从 lipsync-bridge.ts 搬运） */
let _lipSyncMorphName: string | null = null;
let _lipSyncMorphSet: { open: string | null; close: string | null; pucker: string | null; smile: string | null } | null = null;
let _lastLipSyncModelId: string | null = null;
let _lastLipSyncMorphNames: string[] = [];
let _lastLipSyncMorphNameSet = new Set<string>();
let _smoothLow = 0;
let _smoothHigh = 0;
let _lastLipSyncAudioPath = '';
let _lastLipSyncFocusedId: string | null = null;

function _applyLipSync(mmdModel: any, time: number, enabled: boolean): void {
    const morphManager = mmdModel.mesh?.morphTargetManager;
    if (!morphManager) return;

    // 关闭时复位 morph influence（防残留冻结）
    if (!enabled) {
        if (_lipSyncMorphName) {
            const old = morphManager.getMorphTargetByName?.(_lipSyncMorphName);
            if (old) old.influence = 0;
        }
        if (_lipSyncMorphSet?.smile) {
            const oldSmile = morphManager.getMorphTargetByName?.(_lipSyncMorphSet.smile);
            if (oldSmile) oldSmile.influence = 0;
        }
        _lipSyncMorphName = null;
        _lipSyncMorphSet = null;
        _smoothLow = 0;
        _smoothHigh = 0;
        return;
    }

    // #10: 音源切换 → 立即重置状态
    if (getAudioPath() !== _lastLipSyncAudioPath) {
        _lipSyncMorphName = null;
        _lipSyncMorphSet = null;
        _smoothLow = 0;
        _smoothHigh = 0;
        _lastLipSyncAudioPath = getAudioPath();
    }

    // #12: 音频停止时指数衰减
    if (!isAudioPlaying()) {
        _smoothLow *= 0.85;
        _smoothHigh *= 0.85;
        if (_smoothLow < 0.005 && _smoothHigh < 0.005) {
            _smoothLow = 0;
            _smoothHigh = 0;
            if (_lipSyncMorphName) {
                const morph = morphManager.getMorphTargetByName?.(_lipSyncMorphName);
                if (morph) morph.influence = 0;
            }
            return;
        }
    }

    // morph 名缓存：仅 modelId 变化时重建（消除每帧 O(M) 扫描）
    const modelId = perceptionModelId;
    if (modelId !== _lastLipSyncModelId) {
        _lastLipSyncModelId = modelId;
        const morphNames = morphManager.getMorphTargetNames?.() || [];
        _lastLipSyncMorphNames = morphNames;
        _lastLipSyncMorphNameSet = new Set(morphNames);
        _lipSyncMorphName = null;
        _lipSyncMorphSet = null;
    }

    // 查找口型 morph（仅首次或 modelId 变化时）
    if (!_lipSyncMorphName || !_lastLipSyncMorphNameSet.has(_lipSyncMorphName)) {
        _lipSyncMorphName = findLipMorph(_lastLipSyncMorphNames);
        _lipSyncMorphSet = findAllLipMorphs(_lastLipSyncMorphNames);
    }
    if (!_lipSyncMorphName) return;

    // 从 BeatDetector 取频段能量
    const beatDetector = getProcBeatDetector();
    const lowLevel = beatDetector ? beatDetector.getLevel(VOICE_BIN_START, VOICE_BIN_END) : 0;
    const highLevel = beatDetector ? beatDetector.getLevel(HIGH_BIN_START, HIGH_BIN_END) : 0;

    // 低通滤波（音频播放时才平滑，衰减期保留衰减值）
    if (isAudioPlaying()) {
        _smoothLow = _smoothLow * 0.7 + lowLevel * 0.3;
        _smoothHigh = _smoothHigh * 0.7 + highLevel * 0.3;
    }

    // open morph（あ）
    const openWeight = amplitudeToWeight(
        _smoothLow,
        perceptionState.lipSyncSensitivity,
        perceptionState.lipSyncIntensity
    );
    const openMorph = morphManager.getMorphTargetByName?.(_lipSyncMorphName);
    if (openMorph) openMorph.influence = openWeight;

    // 多口型 morph
    if (perceptionState.lipSyncMultiMorphEnabled && _lipSyncMorphSet) {
        // close（与 open 反比）
        if (_lipSyncMorphSet.close) {
            const closeWeight = amplitudeToWeight(
                1 - _smoothLow,
                perceptionState.lipSyncSensitivity,
                perceptionState.lipSyncIntensity
            );
            const closeMorph = morphManager.getMorphTargetByName?.(_lipSyncMorphSet.close);
            if (closeMorph) closeMorph.influence = closeWeight;
        }
        // pucker（高频驱动，模拟「う」）
        if (_lipSyncMorphSet.pucker) {
            const puckerWeight = amplitudeToWeight(
                _smoothHigh * 0.8,
                perceptionState.lipSyncSensitivity,
                perceptionState.lipSyncIntensity
            );
            const puckerMorph = morphManager.getMorphTargetByName?.(_lipSyncMorphSet.pucker);
            if (puckerMorph) puckerMorph.influence = puckerWeight;
        }
    }

    // smile（高频能量大时轻微微笑）
    if (_lipSyncMorphSet?.smile) {
        const smileWeight = Math.max(0, openWeight * 0.3 - 0.1);
        const smileMorph = morphManager.getMorphTargetByName?.(_lipSyncMorphSet.smile);
        if (smileMorph) smileMorph.influence = smileWeight;
    }
}
```

- [ ] **Step 5: 注册到 perception observer**

在 observer 回调内，重心微动之后、gaze 之前新增：

```typescript
        // 5. Lip-sync（无条件调用，内部处理关闭复位）
        _applyLipSync(mmdModel, time, perceptionState.lipSyncEnabled);

        // 6. 头部跟随 + 眼部跟随（gaze）
```

（原 gaze 的注释序号从 5 改为 6）

- [ ] **Step 6: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/__tests__/perception.test.ts`
Expected: PASS

- [ ] **Step 7: 类型检查**

Run: `cd frontend && npm run check`
Expected: PASS

- [ ] **Step 8: 提交**

```bash
git add frontend/src/scene/motion/perception.ts frontend/src/__tests__/perception.test.ts
git commit -m "feat(perception): 实现 _applyLipSync 实时口型同步叠加"
```

---

## Task 3: 移除 lipsync-bridge 旧调用点

**Files:**
- Modify: `frontend/src/scene/motion/playback.ts`（移除 `updateLipSync()` 调用）
- Modify: `frontend/src/scene/scene.ts`（移除 `initLipSync` 调用 + import）
- Modify: `frontend/src/scene/motion/lipsync-bridge.ts`（`updateLipSync` 改为空壳，保留 state getter/setter 兼容期）

- [ ] **Step 1: 移除 playback.ts 的 updateLipSync 调用**

读 `frontend/src/scene/motion/playback.ts:59-79`，确认 `updateLipSync` 是 tickHandler 的参数。从 tickHandler 注册处（scene.ts:241）和 playback.ts 的调用处移除 `updateLipSync`。

**注意**：playback.ts 的 tickHandler 接受 `updateLipSync: () => void` 参数——迁移后这个参数不再需要。需同步修改 scene.ts 的 tickHandler 注册（移除 `updateLipSync` 参数）和 playback.ts 的类型签名 + 调用。

- [ ] **Step 2: 移除 scene.ts 的 initLipSync 调用**

在 `frontend/src/scene/scene.ts`：
- 移除 `import { updateLipSync, initLipSync } from './motion/lipsync-bridge';`（L99）
- 移除 `initLipSync(modelManager);`（L220）
- 从 tickHandler 注册移除 `updateLipSync`（L241）

- [ ] **Step 3: lipsync-bridge.ts 的 updateLipSync 改为空壳**

```typescript
/**
 * @deprecated 已迁入 perception.ts 的 _applyLipSync。
 * 保留空壳避免外部引用断裂，实际逻辑已由 perception observer 调度。
 */
export function updateLipSync(): void {
    // no-op: 逻辑已迁入 perception.ts
}
```

保留 `setLipSyncEnabled` / `getLipSyncState` / `setLipSyncState` 等 state getter/setter（兼容期，Task 4 序列化迁移后可清理）。

- [ ] **Step 4: 运行测试 + 类型检查**

Run: `cd frontend && npx vitest run src/__tests__/lipsync-bridge.test.ts`
Expected: 部分测试可能失败（updateLipSync 现在是 no-op）——需更新测试断言

Run: `cd frontend && npm run check`
Expected: PASS

- [ ] **Step 5: 更新 lipsync-bridge.test.ts**

将 `updateLipSync` 相关测试改为验证 no-op 行为（调用不抛异常），或删除已不适用的测试。保留 state getter/setter 测试。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/scene/motion/playback.ts frontend/src/scene/scene.ts frontend/src/scene/motion/lipsync-bridge.ts frontend/src/__tests__/lipsync-bridge.test.ts
git commit -m "refactor(lipsync): 移除旧调用点，updateLipSync 改为空壳（已迁入感知层）"
```

---

## Task 4: 序列化扩展与旧存档迁移

**Files:**
- Modify: `frontend/src/scene/scene-serialize.ts`
- Modify: `frontend/src/__tests__/perception.test.ts`

- [ ] **Step 1: 写失败测试**

在 `frontend/src/__tests__/perception.test.ts` 新增：

```typescript
describe('scene-serialize lipSync migration', () => {
    it('旧存档 lipSync.enabled=true 时映射为 lipSyncEnabled=true', () => {
        const old = { lipSync: { enabled: true, sensitivity: 0.3, intensity: 0.9, multiMorphEnabled: true } };
        const migrated = migrateLipSyncFromOldState(old);
        expect(migrated.lipSyncEnabled).toBe(true);
        expect(migrated.lipSyncSensitivity).toBe(0.3);
        expect(migrated.lipSyncIntensity).toBe(0.9);
        expect(migrated.lipSyncMultiMorphEnabled).toBe(true);
    });

    it('旧存档无 lipSync 字段时使用默认值', () => {
        const migrated = migrateLipSyncFromOldState({});
        expect(migrated.lipSyncEnabled).toBe(false);
        expect(migrated.lipSyncSensitivity).toBe(0.2);
        expect(migrated.lipSyncIntensity).toBe(0.8);
        expect(migrated.lipSyncMultiMorphEnabled).toBe(false);
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/__tests__/perception.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 migrateLipSyncFromOldState**

在 `frontend/src/scene/scene-serialize.ts` 新增导出函数：

```typescript
/** 从旧 lipSync state 迁移为 PerceptionState 的 lip-sync 字段 */
export function migrateLipSyncFromOldState(
    old: { lipSync?: { enabled?: boolean; sensitivity?: number; intensity?: number; multiMorphEnabled?: boolean } }
): { lipSyncEnabled: boolean; lipSyncSensitivity: number; lipSyncIntensity: number; lipSyncMultiMorphEnabled: boolean } {
    const l = old.lipSync;
    if (!l) {
        return { lipSyncEnabled: false, lipSyncSensitivity: 0.2, lipSyncIntensity: 0.8, lipSyncMultiMorphEnabled: false };
    }
    return {
        lipSyncEnabled: l.enabled ?? false,
        lipSyncSensitivity: l.sensitivity ?? 0.2,
        lipSyncIntensity: l.intensity ?? 0.8,
        lipSyncMultiMorphEnabled: l.multiMorphEnabled ?? false,
    };
}
```

在 `migratePerceptionFromProcMotion` 中合并调用（追加 lip-sync 字段）：

```typescript
export function migratePerceptionFromProcMotion(
    old: Partial<ProcMotionState>
): Partial<PerceptionState> {
    // ... 现有字段 ...
    const lipSync = migrateLipSyncFromOldState(old as any);
    return {
        // ... 现有字段 ...
        lipSyncEnabled: lipSync.lipSyncEnabled,
        lipSyncSensitivity: lipSync.lipSyncSensitivity,
        lipSyncIntensity: lipSync.lipSyncIntensity,
        lipSyncMultiMorphEnabled: lipSync.lipSyncMultiMorphEnabled,
    };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/__tests__/perception.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add frontend/src/scene/scene-serialize.ts frontend/src/__tests__/perception.test.ts
git commit -m "feat(serialize): lip-sync 字段迁移 + 旧存档 lipSync state 映射"
```

---

## Task 5: UI 接入

**Files:**
- Modify: `frontend/src/menus/motion-gaze-levels.ts`
- Modify: `frontend/src/core/i18n/locales/{zh-CN,en,ja,ko,zh-TW}.ts`

- [ ] **Step 1: 添加 i18n 翻译键**

5 个 locale 文件新增：

| 键 | zh-CN | en | ja | ko | zh-TW |
|---|---|---|---|---|---|
| `motion.lipSync` | 口型同步 | Lip Sync | リップシンク | 립싱크 | 口型同步 |
| `motion.lipSyncSensitivity` | 灵敏度 | Sensitivity | 感度 | 감도 | 靈敏度 |
| `motion.lipSyncIntensity` | 强度 | Intensity | 強度 | 강도 | 強度 |
| `motion.lipSyncMultiMorph` | 多口型 | Multi-Morph | 多モーフ | 다중 모프 | 多口型 |

- [ ] **Step 2: 在 motion-gaze-levels.ts 新增开关 + 滑块**

导入 `setLipSyncEnabled` / `setLipSyncSensitivity` / `setLipSyncIntensity` / `setLipSyncMultiMorphEnabled`，在重心微动区块之后新增：

```typescript
// Lip-sync（口型同步）
addToggleRow(c, t('motion.lipSync'), getPerceptionState().lipSyncEnabled, (v) => {
    setLipSyncEnabled(v);
    activatePerception();
    getMotionMenu()?.updateControls();
});
if (getPerceptionState().lipSyncEnabled) {
    addSliderRow(c, t('motion.lipSyncSensitivity'), 0, 1, 0.01, getPerceptionState().lipSyncSensitivity, (v) => {
        setLipSyncSensitivity(v);
        getMotionMenu()?.updateControls();
    });
    addSliderRow(c, t('motion.lipSyncIntensity'), 0, 1, 0.01, getPerceptionState().lipSyncIntensity, (v) => {
        setLipSyncIntensity(v);
        getMotionMenu()?.updateControls();
    });
    addToggleRow(c, t('motion.lipSyncMultiMorph'), getPerceptionState().lipSyncMultiMorphEnabled, (v) => {
        setLipSyncMultiMorphEnabled(v);
        getMotionMenu()?.updateControls();
    });
}
```

**注意**：先 grep 确认 `addSliderRow` 的签名和用法。

- [ ] **Step 3: 类型检查 + 全量测试**

Run: `cd frontend && npm run check`
Run: `cd frontend && npm run test`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add frontend/src/menus/motion-gaze-levels.ts frontend/src/core/i18n/locales/
git commit -m "feat(ui): motion-gaze-levels 新增 lip-sync 开关与滑块"
```

---

## Task 6: 更新 ADR-079 状态

**Files:**
- Modify: `docs/adr/adr-079-perception-layer-expansion.md`

- [ ] **Step 1: 更新状态行**

```markdown
> **状态**: Phase 1-3 已实施（2026-07-10）
```

- [ ] **Step 2: 新增 Phase 3 实施记录**

```markdown
### Phase 3: Lip-sync 架构归位（2026-07-10）

- ✅ `PerceptionState` 扩展 lip-sync 4 字段（`lipSyncEnabled` / `lipSyncSensitivity` / `lipSyncIntensity` / `lipSyncMultiMorphEnabled`）
- ✅ `_applyLipSync` 实时叠加实现——复用 `getProcBeatDetector()` 音频管道 + `amplitudeToWeight` 映射 + 完整搬运 ADR-038 状态机（音源切换重置 + 静音指数衰减 + 低通滤波 + morph 缓存）
- ✅ `lipsync-bridge.ts` 的 `updateLipSync` 改为空壳（@deprecated），移除 playback.ts + scene.ts 旧调用点
- ✅ 序列化扩展 + `migrateLipSyncFromOldState`（旧 `lipSync` state → PerceptionState 字段）
- ✅ UI 接入：motion-gaze-levels 新增 lip-sync 开关 + 灵敏度/强度滑块 + 多口型开关
- ✅ i18n 5 语言同步
```

- [ ] **Step 3: 提交**

```bash
git add docs/adr/adr-079-perception-layer-expansion.md
git commit -m "docs(adr-079): Phase 3 lip-sync 架构归位完成"
```

---

## 验收标准

- [ ] `npm run check` 通过
- [ ] `npm run test` 通过（无新增失败）
- [ ] `npm run build` 通过
- [ ] lip-sync 在 enabled=false 时 morph influence 归零
- [ ] lip-sync 在 enabled=true 且音频播放时写入 あ morph
- [ ] 音源切换时状态重置（#10）
- [ ] 音频停止时指数衰减（#12）
- [ ] 旧存档 `lipSync` state 正确迁移为 PerceptionState 字段
- [ ] `playback.ts` 不再调用 `updateLipSync`
- [ ] `scene.ts` 不再调用 `initLipSync`
- [ ] UI 可切换 lip-sync 开关 + 调节灵敏度/强度
