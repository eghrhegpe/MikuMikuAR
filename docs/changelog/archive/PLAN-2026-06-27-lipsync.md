# LipSync 实时振幅驱动 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 MikuMikuAR 添加实时音频振幅驱动的 LipSync 功能——每帧读取音频能量，映射到焦点模型的「あ」口型 morph，实现模型随音乐/语音开合嘴巴。

**Architecture:** 新增 `lipsync.ts` 模块封装状态与纯函数（振幅→权重映射、morph 名检测）；扩展 `BeatDetector` 暴露 `getLevel()` 取频段能量；`scene.ts` 在动画 tick 中调用 Lipsync 更新器并通过现有 `setModelMorphWeight` 写入 morph；状态序列化到 `SceneFile.lipSync`；UI 入口在场景菜单「程序化动作」子菜单下新增「LipSync」子级。

**Tech Stack:** TypeScript, Babylon.js (MmdMorphController), Web Audio API (AnalyserNode), Vitest

**关键约束:**
- 不与 procedural motion 冲突：procedural motion 只控制「まばたき」morph（VMD 帧），LipSync 只控制「あ」morph（实时直写），两者作用 morph 不同，互不覆盖。
- 与用户 VMD 共存：若用户 VMD 含「あ」morph 轨，VMD 帧会覆盖直写值——用户应在此情况下关闭 LipSync（UI 提示）。
- 仅作用于焦点模型，焦点切换时自动重新检测 morph 名。

---

## 文件结构

| 文件 | 责任 | 创建/修改 |
|------|------|----------|
| `frontend/src/lipsync.ts` | Lipsync 状态类型 + 纯函数（`amplitudeToWeight`、`findLipMorph`、`DEFAULT_LIPSYNC_STATE`） | 创建 |
| `frontend/src/__tests__/lipsync.test.ts` | 纯函数单元测试 | 创建 |
| `frontend/src/beat-detector.ts` | 新增 `static getLevel(freqData, start, end)` + 实例 `getLevel(start, end)` | 修改 |
| `frontend/src/__tests__/beat-detector.test.ts` | 新增 `getLevel` 静态方法测试 | 修改 |
| `frontend/src/scene.ts` | Lipsync 状态、tick 集成、setters/getters、`SceneFile.lipSync` 序列化 | 修改 |
| `frontend/src/scene-menu.ts` | `buildLipSyncLevel()` 子菜单 + action 路由 | 修改 |
| `docs/reusables.md` | 索引新增函数 | 修改 |
| `docs/status.md` | 标记 LipSync 已完成 | 修改 |

---

## Task 1: BeatDetector.getLevel — 暴露频段能量

**Files:**
- Modify: `frontend/src/beat-detector.ts`
- Test: `frontend/src/__tests__/beat-detector.test.ts`

`BeatDetector` 内部已有 `freqData: Uint8Array`（由 `update()` 每帧刷新），但目前只暴露 BPM/beat 相位。LipSync 需要读取频段能量（人声频段 ~430Hz..2.2kHz）。新增静态纯函数 + 实例方法，沿用现有 `detectBeatsFromEnergies` 的「静态纯逻辑 + 实例包装」模式。

- [ ] **Step 1: 写失败测试**

在 `beat-detector.test.ts` 末尾追加：

```typescript
describe("BeatDetector.getLevel (static)", () => {
    it("returns 0 for empty data", () => {
        expect(BeatDetector.getLevel(new Uint8Array(0))).toBe(0);
    });

    it("computes average of full range (0..1 normalized)", () => {
        const data = new Uint8Array([0, 128, 255]);
        // (0+128+255)/3/255 ≈ 0.502
        expect(BeatDetector.getLevel(data)).toBeCloseTo(0.502, 2);
    });

    it("respects bin range", () => {
        const data = new Uint8Array([0, 0, 255, 255]);
        expect(BeatDetector.getLevel(data, 2, 4)).toBeCloseTo(1, 2);
        expect(BeatDetector.getLevel(data, 0, 2)).toBe(0);
    });

    it("clamps end to data length", () => {
        const data = new Uint8Array([100, 200]);
        expect(BeatDetector.getLevel(data, 0, 99)).toBeCloseTo((100 + 200) / 2 / 255, 2);
    });

    it("returns 0 when end <= start", () => {
        const data = new Uint8Array([100, 200]);
        expect(BeatDetector.getLevel(data, 2, 2)).toBe(0);
        expect(BeatDetector.getLevel(data, 3, 1)).toBe(0);
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/__tests__/beat-detector.test.ts 2>&1`
Expected: FAIL — `BeatDetector.getLevel is not a function`

- [ ] **Step 3: 实现静态 + 实例方法**

在 `beat-detector.ts` 的 `BeatDetector` 类内（紧跟 `static bpmFromIntervals` 之后，类闭合 `}` 之前）插入：

```typescript
    /** 纯逻辑：从频谱数据计算指定频段平均能量 (0..1)。
     *  @param freqData Uint8Array 频谱数据（0..255，由 AnalyserNode.getByteFrequencyData 填充）
     *  @param startBin 起始 bin（含），默认 0
     *  @param endBin 结束 bin（不含），默认到数据末尾 */
    static getLevel(freqData: Uint8Array, startBin = 0, endBin?: number): number {
        if (freqData.length === 0) return 0;
        const start = Math.max(0, startBin);
        const end = Math.min(endBin ?? freqData.length, freqData.length);
        if (end <= start) return 0;
        let sum = 0;
        for (let i = start; i < end; i++) sum += freqData[i];
        return sum / (end - start) / 255;
    }
```

在实例方法区（紧跟 `getBeatPhase()` 之后）插入：

```typescript
    /** 当前帧指定频段的平均能量 (0..1)。须在 update() 之后调用。
     *  无 analyser 时返回 0。 */
    getLevel(startBin = 0, endBin?: number): number {
        if (!this.analyser) return 0;
        return BeatDetector.getLevel(this.freqData, startBin, endBin);
    }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/__tests__/beat-detector.test.ts 2>&1`
Expected: PASS — 全部用例（含原有 10 + 新增 5 = 15）

- [ ] **Step 5: 提交**

```bash
cd . && git add frontend/src/beat-detector.ts frontend/src/__tests__/beat-detector.test.ts && git commit -m "feat(beat): expose getLevel() for frequency-band energy

新增 BeatDetector.getLevel(freqData, start, end) 静态纯函数 + 实例包装，
供 LipSync 读取人声频段能量。沿用 detectBeatsFromEnergies 的静态+实例模式。"
```

---

## Task 2: lipsync.ts — 状态 + 纯函数

**Files:**
- Create: `frontend/src/lipsync.ts`
- Test: `frontend/src/__tests__/lipsync.test.ts`

封装 LipSync 状态类型、`findLipMorph`（morph 名检测）、`amplitudeToWeight`（振幅→权重映射）。两个纯函数均独立可测，不依赖 Babylon.js 或 Web Audio。

- [ ] **Step 1: 写失败测试**

创建 `frontend/src/__tests__/lipsync.test.ts`：

```typescript
import { describe, it, expect } from "vitest";
import { DEFAULT_LIPSYNC_STATE, findLipMorph, amplitudeToWeight } from "../lipsync";

describe("findLipMorph", () => {
    it("prefers あ first", () => {
        expect(findLipMorph(["まばたき", "あ", "A"])).toBe("あ");
    });

    it("falls back to A when no あ", () => {
        expect(findLipMorph(["まばたき", "A"])).toBe("A");
    });

    it("falls back to mouth/open", () => {
        expect(findLipMorph(["mouth"])).toBe("mouth");
        expect(findLipMorph(["open"])).toBe("open");
    });

    it("returns null when no candidate matches", () => {
        expect(findLipMorph(["まばたき", "笑い"])).toBeNull();
    });

    it("returns null for empty list", () => {
        expect(findLipMorph([])).toBeNull();
    });
});

describe("amplitudeToWeight", () => {
    it("returns 0 below sensitivity threshold", () => {
        expect(amplitudeToWeight(0.1, 0.2, 0.8)).toBe(0);
        expect(amplitudeToWeight(0.19, 0.2, 0.8)).toBe(0);
    });

    it("returns 0 at exactly threshold (strict less-than)", () => {
        expect(amplitudeToWeight(0.2, 0.2, 0.8)).toBe(0);
    });

    it("maps linearly above threshold", () => {
        // sensitivity=0.2, intensity=0.8, range=0.8
        // amp=0.6 → (0.6-0.2)/0.8 = 0.5 → 0.5*0.8 = 0.4
        expect(amplitudeToWeight(0.6, 0.2, 0.8)).toBeCloseTo(0.4, 3);
    });

    it("scales by intensity at full amplitude", () => {
        expect(amplitudeToWeight(1.0, 0.2, 0.5)).toBeCloseTo(0.5, 3);
        expect(amplitudeToWeight(1.0, 0.2, 1.0)).toBeCloseTo(1.0, 3);
    });

    it("clamps amplitude > 1 to intensity", () => {
        expect(amplitudeToWeight(1.5, 0.2, 0.8)).toBeCloseTo(0.8, 3);
    });

    it("handles sensitivity=0 (full range)", () => {
        expect(amplitudeToWeight(0.5, 0, 1.0)).toBeCloseTo(0.5, 3);
    });

    it("handles sensitivity=1 (deadband edge)", () => {
        // range = 0 → amp >= 1 returns intensity; amp < 1 returns 0
        expect(amplitudeToWeight(0.9, 1, 0.8)).toBe(0);
        expect(amplitudeToWeight(1.0, 1, 0.8)).toBeCloseTo(0.8, 3);
    });
});

describe("DEFAULT_LIPSYNC_STATE", () => {
    it("starts disabled", () => {
        expect(DEFAULT_LIPSYNC_STATE.enabled).toBe(false);
    });

    it("has sensible defaults", () => {
        expect(DEFAULT_LIPSYNC_STATE.sensitivity).toBeGreaterThan(0);
        expect(DEFAULT_LIPSYNC_STATE.sensitivity).toBeLessThan(1);
        expect(DEFAULT_LIPSYNC_STATE.intensity).toBeGreaterThan(0);
        expect(DEFAULT_LIPSYNC_STATE.intensity).toBeLessThanOrEqual(1);
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/__tests__/lipsync.test.ts 2>&1`
Expected: FAIL — `Failed to resolve import "../lipsync"`

- [ ] **Step 3: 创建 lipsync.ts**

创建 `frontend/src/lipsync.ts`：

```typescript
// lipsync.ts — 实时振幅驱动 LipSync
// [doc:architecture] LipSync 子系统 — 振幅→口型 morph
//
// 每帧从 BeatDetector.getLevel 取人声频段能量 → amplitudeToWeight 映射 →
// setModelMorphWeight 直写焦点模型的「あ」morph。
// 与 procedural motion 不冲突：前者只控「まばたき」(VMD 帧)，本模块只控「あ」(实时直写)。

export interface LipSyncState {
    enabled: boolean;
    sensitivity: number;  // 0..1，振幅阈值（低于此值视为静音，越大越不敏感）
    intensity: number;    // 0..1，最大张嘴幅度
}

export const DEFAULT_LIPSYNC_STATE: LipSyncState = {
    enabled: false,
    sensitivity: 0.2,
    intensity: 0.8,
};

/** 标准 MMD 口型 morph 候选名（按优先级降序）。
 *  绝大多数 MMD 模型使用「あ」；少数使用片假名「ア」或拉丁字母。 */
const LIP_MORPH_CANDIDATES = ["あ", "ア", "A", "a", "口", "mouth", "open"];

/** 在模型 morph 列表中查找口型 morph，返回首个匹配名。
 *  @param morphNames 模型可用 morph 名集合
 *  @returns 匹配的 morph 名；无匹配返回 null */
export function findLipMorph(morphNames: string[]): string | null {
    const set = new Set(morphNames);
    for (const name of LIP_MORPH_CANDIDATES) {
        if (set.has(name)) return name;
    }
    return null;
}

/** 振幅 → morph 权重映射。
 *  低于 sensitivity 阈值 → 0；否则线性映射到 0..intensity。
 *  @param amplitude 0..1 音频能量（可 >1，会被钳制）
 *  @param sensitivity 0..1 阈值（< 阈值视为静音）
 *  @param intensity 0..1 最大张嘴幅度
 *  @returns 0..intensity 的 morph 权重 */
export function amplitudeToWeight(amplitude: number, sensitivity: number, intensity: number): number {
    if (amplitude < sensitivity) return 0;
    const range = 1 - sensitivity;
    if (range <= 0) return intensity;  // sensitivity=1 边界：amp>=1 时给满
    const t = Math.max(0, Math.min(1, (amplitude - sensitivity) / range));
    return t * intensity;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/__tests__/lipsync.test.ts 2>&1`
Expected: PASS — 全部 15 用例

- [ ] **Step 5: 提交**

```bash
cd . && git add frontend/src/lipsync.ts frontend/src/__tests__/lipsync.test.ts && git commit -m "feat(lipsync): add pure state + amplitude→weight mapping module

新增 lipsync.ts：LipSyncState 类型、DEFAULT_LIPSYNC_STATE、findLipMorph、
amplitudeToWeight。纯函数无 Babylon.js / Web Audio 依赖，15 单元测试覆盖。"
```

---

## Task 3: scene.ts — LipSync 运行时集成

**Files:**
- Modify: `frontend/src/scene.ts`

在 `scene.ts` 中新增 `lipSyncState` 模块状态、`updateLipSync()` 每帧更新器、4 个 setter/getter，并挂到 `onAnimationTickObservable`。

- [ ] **Step 1: 添加 import**

在 `scene.ts` 顶部 procedural-motion import 块之后（约第 70 行 `} from "./procedural-motion";` 之后）新增：

```typescript
import { LipSyncState as LipSyncStateType, DEFAULT_LIPSYNC_STATE, findLipMorph, amplitudeToWeight } from "./lipsync";
```

> 注意：用 `LipSyncStateType` 别名避免与下方 `SceneFile` 内字段类型冲突，导出时统一用 `LipSyncState` 名。

- [ ] **Step 2: 添加 LipSync 状态块**

在 `scene.ts` 程序化动作状态块之后（约第 369 行 `let procModelId: string | null = null;` 之后）新增：

```typescript
// ======== LipSync State ========
let lipSyncState: LipSyncStateType = { ...DEFAULT_LIPSYNC_STATE };
let lipSyncMorphName: string | null = null;  // 缓存焦点模型的口型 morph 名

/** 人声频段 bin 范围（@ fftSize=256, 44100Hz：每 bin ~172Hz）。
 *  10..50 ≈ 430Hz..2.2kHz，覆盖人声基频与谐波。 */
const VOICE_BIN_START = 10;
const VOICE_BIN_END = 50;

export function setLipSyncEnabled(on: boolean): void {
    lipSyncState.enabled = on;
    if (!on) resetLipMorph();
    triggerAutoSave();
}

export function setLipSyncSensitivity(v: number): void {
    lipSyncState.sensitivity = Math.max(0, Math.min(1, v));
    triggerAutoSave();
}

export function setLipSyncIntensity(v: number): void {
    lipSyncState.intensity = Math.max(0, Math.min(1, v));
    triggerAutoSave();
}

export function getLipSyncState(): LipSyncStateType {
    return { ...lipSyncState };
}

/** 重置焦点模型的口型 morph 为 0（关闭 Lipsync 或静音时调用）。 */
function resetLipMorph(): void {
    if (lipSyncMorphName && focusedModelId) {
        setModelMorphWeight(focusedModelId, lipSyncMorphName, 0);
    }
}

/** 每帧更新 LipSync。由 runtime.onAnimationTickObservable 调用。
 *  - 关闭 → 直接返回
 *  - 无音频播放 → 重置 morph 为 0
 *  - 焦点模型无口型 morph → 跳过
 *  - 正常 → 读 BeatDetector 人声频段能量 → amplitudeToWeight → setModelMorphWeight */
function updateLipSync(): void {
    if (!lipSyncState.enabled) return;
    if (!isAudioPlaying()) { resetLipMorph(); return; }
    const modelId = focusedModelId;
    if (!modelId) { lipSyncMorphName = null; return; }
    const inst = modelRegistry.get(modelId);
    if (!inst?.mmdModel?.morph) { lipSyncMorphName = null; return; }

    // 焦点切换或模型加载后重新检测 morph 名
    const morphs = inst.mmdModel.morph.morphs;
    if (!lipSyncMorphName || !morphs.some(m => m.name === lipSyncMorphName)) {
        lipSyncMorphName = findLipMorph(morphs.map(m => m.name));
    }
    if (!lipSyncMorphName) return;

    const level = procBeatDetector ? procBeatDetector.getLevel(VOICE_BIN_START, VOICE_BIN_END) : 0;
    const weight = amplitudeToWeight(level, lipSyncState.sensitivity, lipSyncState.intensity);
    setModelMorphWeight(modelId, lipSyncMorphName, weight);
}
```

- [ ] **Step 3: 挂到动画 tick**

在 `scene.ts` 的 `runtime.onAnimationTickObservable.add(() => { ... })` 回调中，紧跟 `updateProcMotion();` 之后新增 `updateLipSync();`。

定位（约第 478-485 行）：
```typescript
    runtime.onAnimationTickObservable.add(() => {
        updatePlaybackUI();
        const foc = focusedModel();
        const dur = foc?.animationDuration ?? runtime.animationDuration;
        syncAudioPlayback(runtime.currentTime, isPlaying, dur);
        animateCameraVmd(runtime.currentTime * 30);
        updateProcMotion();
        updateLipSync();  // ← 新增此行
    });
```

- [ ] **Step 4: 在文件顶部 export 类型别名**

在 `scene.ts` 已有 `export` 集中区（与 `export { ... } from ...` 同区或类型导出区）新增：

```typescript
export type LipSyncState = LipSyncStateType;
```

> 这样 `scene-menu.ts` 与 `SceneFile` 可统一从 `scene.ts` 导入 `LipSyncState`。

- [ ] **Step 5: 构建验证**

Run: `cd frontend && npx vite build 2>&1`
Expected: 构建成功，无 TS 错误。

- [ ] **Step 6: 跑全量测试确认无回归**

Run: `cd frontend && npx vitest run 2>&1`
Expected: 全部测试 PASS（原有 160 + 新增 20 = 180）。

- [ ] **Step 7: 提交**

```bash
cd . && git add frontend/src/scene.ts && git commit -m "feat(lipsync): integrate real-time amplitude-driven lip sync into scene tick

scene.ts 新增 lipSyncState、updateLipSync()、3 个 setter + 1 个 getter，
挂到 onAnimationTickObservable。每帧读 BeatDetector 人声频段能量 →
amplitudeToWeight → setModelMorphWeight 直写焦点模型「あ」morph。
关闭或静音时自动重置 morph 为 0。"
```

---

## Task 4: scene.ts — SceneFile 序列化

**Files:**
- Modify: `frontend/src/scene.ts`

把 `lipSyncState` 加入 `SceneFile` 持久化，与 `procMotion` 同模式（默认值合并 + 反序列化恢复）。

- [ ] **Step 1: 扩展 SceneFile 接口**

在 `scene.ts` 的 `export interface SceneFile { ... }` 内，紧跟 `procMotion?: ProcMotionState;` 之后（约第 939 行）新增：

```typescript
    /** Procedural motion state (Idle/Auto Dance). */
    procMotion?: ProcMotionState;
    /** LipSync state (real-time amplitude-driven). */
    lipSync?: LipSyncStateType;
```

- [ ] **Step 2: 序列化**

在 `serializeScene()` 的 return 对象内，紧跟 `procMotion: { ...procState },` 之后（约第 982 行）新增：

```typescript
        procMotion: { ...procState },
        lipSync: { ...lipSyncState },
```

- [ ] **Step 3: 反序列化**

在 `deserializeScene()` 内，紧跟 procMotion 恢复块之后（约第 1047 行 `regenerateProcMotion();` 与闭合 `}` 之后）新增：

```typescript
    // Restore procedural motion state
    if (data.procMotion) {
        procState = { ...DEFAULT_PROC_STATE, ...data.procMotion as Partial<ProcMotionState> };
        regenerateProcMotion();
    }

    // Restore LipSync state
    if (data.lipSync) {
        lipSyncState = { ...DEFAULT_LIPSYNC_STATE, ...data.lipSync as Partial<LipSyncStateType> };
    } else {
        lipSyncState = { ...DEFAULT_LIPSYNC_STATE };
    }
```

- [ ] **Step 4: 构建验证**

Run: `cd frontend && npx vite build 2>&1`
Expected: 构建成功。

- [ ] **Step 5: 跑全量测试**

Run: `cd frontend && npx vitest run 2>&1`
Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
cd . && git add frontend/src/scene.ts && git commit -m "feat(lipsync): persist LipSync state in SceneFile

SceneFile 新增 lipSync 字段，serialize/deserialize 同 procMotion 模式：
默认值合并 + 反序列化恢复。无 lipSync 字段的旧场景默认 disabled。"
```

---

## Task 5: scene-menu.ts — UI 入口

**Files:**
- Modify: `frontend/src/scene-menu.ts`

在「程序化动作」子菜单新增「LipSync」folder 入口，点击进入 `buildLipSyncLevel()` 子级：启用 toggle + 灵敏度滑块 + 强度滑块。

- [ ] **Step 1: 扩展 scene.ts 导入**

在 `scene-menu.ts` 第 24 行的 import 语句中，把 Lipsync 相关函数加入现有导入列表：

```typescript
import { focusModel, setGravityStrength, getGravityStrength, setProcMotionMode, setProcMotionIntensity, setProcMotionSpeed, setProcMotionAutoSwitch, getProcMotionState, regenerateProcMotion, applyEnvPreset, setEnvAutoLink, getEnvAutoLink, setEnvSunAngle, getEnvSunAngle, redoEnvAutoLink, getLipSyncState, setLipSyncEnabled, setLipSyncSensitivity, setLipSyncIntensity } from "./scene";
```

- [ ] **Step 2: 在 buildProcMotionLevel 加 folder 入口**

在 `buildProcMotionLevel()` 的 `items` 数组末尾追加一项（紧跟「自动切换」之后）：

```typescript
function buildProcMotionLevel(): PopupLevel {
    const st = getProcMotionState();
    const lipSt = getLipSyncState();
    const modeLabel: Record<string, string> = {
        off: "关闭", idle: "待机呼吸", autodance: "自动舞蹈",
    };
    return {
        label: "程序化动作",
        dir: "",
        items: [
            { kind: "folder", label: "模式", icon: "wind", target: "procmotion:mode", sublabel: modeLabel[st.mode] },
            { kind: "action", label: "自动切换", icon: "repeat", target: "procmotion:autoswitch", sublabel: st.autoSwitch ? "开" : "关" },
            { kind: "folder", label: "LipSync", icon: "mic", target: "lipsync:menu", sublabel: lipSt.enabled ? "开" : "关" },
        ],
        renderCustom: (container) => {
            container.style.padding = "8px 6px";
            addSliderRow(container, "动作强度", st.intensity, 0, 1, 0.05, (v) => {
                setProcMotionIntensity(v);
                regenerateProcMotion();
            }, "lucide:activity");
            addSliderRow(container, "速度", st.speed, 0.5, 2, 0.05, (v) => {
                setProcMotionSpeed(v);
                regenerateProcMotion();
            }, "lucide:fast-forward");
        },
    };
}
```

- [ ] **Step 3: 新增 buildLipSyncLevel 函数**

在 `buildProcMotionModeLevel()` 函数定义之后（约第 121 行闭合 `}` 之后）新增：

```typescript
function buildLipSyncLevel(): PopupLevel {
    const st = getLipSyncState();
    return {
        label: "LipSync",
        dir: "",
        items: [
            { kind: "action", label: "启用", icon: st.enabled ? "check" : "circle", target: "lipsync:toggle", sublabel: st.enabled ? "开" : "关" },
        ],
        renderCustom: (container) => {
            container.style.padding = "8px 6px";
            // 灵敏度：UI 上「越大越灵敏」= sensitivity 越小，故反转显示
            addSliderRow(container, "灵敏度", 1 - st.sensitivity, 0, 1, 0.05, (v) => {
                setLipSyncSensitivity(1 - v);
            }, "lucide:volume-2");
            addSliderRow(container, "强度", st.intensity, 0, 1, 0.05, (v) => {
                setLipSyncIntensity(v);
            }, "lucide:activity");
        },
    };
}
```

- [ ] **Step 4: 在 handleRowAction 加路由**

在 `scene-menu.ts` 的 `handleRowAction`（或等效 action 分发函数）内，紧跟最后一个 `procmotion:mode` 处理块之后（约第 1343 行 `}` 之后）新增：

```typescript
    // LipSync actions
    if (row.target === "lipsync:menu") {
        sceneStack?.push(buildLipSyncLevel());
        return;
    }
    if (row.target === "lipsync:toggle") {
        const cur = getLipSyncState();
        setLipSyncEnabled(!cur.enabled);
        sceneStack?.reRender();
        return;
    }
```

- [ ] **Step 5: 构建验证**

Run: `cd frontend && npx vite build 2>&1`
Expected: 构建成功。

- [ ] **Step 6: 提交**

```bash
cd . && git add frontend/src/scene-menu.ts && git commit -m "feat(lipsync): add LipSync submenu under procedural motion

场景菜单「程序化动作」子菜单新增「LipSync」入口，子级含启用 toggle +
灵敏度滑块（UI 反转：越大越灵敏）+ 强度滑块。沿用 SlideMenu folder/action 模式。"
```

---

## Task 6: 文档更新

**Files:**
- Modify: `docs/reusables.md`
- Modify: `docs/status.md`

按 AGENTS.md「新增函数被第二个调用方使用时 → 记入此表」规则，把 Lipsync 模块加入 `reusables.md`，并在 `status.md` 标记完成。

- [ ] **Step 1: reusables.md — 新增 LipSync 子系统小节**

在 `docs/reusables.md` 的「程序化动作子系统（新增）」小节之后（紧跟 `### audio.ts 新增` 表格之后，约第 343 行）新增：

```markdown
### LipSync 子系统（`lipsync.ts`）

| 函数/类型 | 签名 | 用途 |
|----------|------|------|
| `LipSyncState` | `{ enabled, sensitivity, intensity }` | LipSync 状态类型 |
| `DEFAULT_LIPSYNC_STATE` | `LipSyncState` | 默认状态（disabled, sensitivity=0.2, intensity=0.8） |
| `findLipMorph` | `(morphNames: string[]) => string \| null` | 在模型 morph 列表中查找口型 morph（优先级：あ→ア→A→a→口→mouth→open） |
| `amplitudeToWeight` | `(amp, sensitivity, intensity) => number` | 振幅→morph 权重映射，低于阈值返回 0，否则线性映射到 0..intensity |

### beat-detector.ts 新增

| 函数 | 签名 | 用途 |
|------|------|------|
| `BeatDetector.getLevel` (static) | `(freqData: Uint8Array, startBin?, endBin?) => number` | 纯逻辑：频段平均能量 0..1 |
| `BeatDetector.getLevel` (instance) | `(startBin?, endBin?) => number` | 当前帧频段能量，须在 update() 后调用 |

### scene.ts LipSync 控制 API

| 函数 | 签名 | 用途 |
|------|------|------|
| `setLipSyncEnabled` | `(on: boolean) => void` | 开关 LipSync，关闭时重置 morph |
| `setLipSyncSensitivity` | `(v: number) => void` | 设置灵敏度阈值 0..1 |
| `setLipSyncIntensity` | `(v: number) => void` | 设置最大张嘴幅度 0..1 |
| `getLipSyncState` | `() => LipSyncState` | 获取当前状态副本 |
```

- [ ] **Step 2: reusables.md — 关键类型表追加**

在 `docs/reusables.md` 的「### 关键类型」表格末尾追加一行：

```markdown
| `LipSyncState` | `lipsync.ts` | `enabled, sensitivity, intensity` | LipSync 状态，序列化到 `SceneFile.lipSync` |
```

- [ ] **Step 3: status.md — 标记 LipSync 完成**

在 `docs/status.md` 第 263 行将：

```markdown
- [ ] LipSync / 音乐节拍检测
```

改为：

```markdown
- [x] LipSync（实时振幅驱动「あ」morph）— Web Audio 人声频段能量 → amplitudeToWeight → setModelMorphWeight
```

- [ ] **Step 4: status.md — 已实现列表新增条目**

在 `docs/status.md` 的「**体验增强功能（Phase 5）**」之后或「**播放列表（Phase 7）**」之后，新增一个 Phase 8 子项区块（若已有 Phase 8 区块则追加）：

```markdown
**LipSync（实时振幅驱动）**
- [x] `lipsync.ts` 纯函数模块（findLipMorph / amplitudeToWeight / LipSyncState）
- [x] `BeatDetector.getLevel` 暴露频段能量
- [x] `scene.ts` 动画 tick 集成 + setter/getter + SceneFile 序列化
- [x] 场景菜单「程序化动作 → LipSync」子菜单（启用 + 灵敏度 + 强度）
```

- [ ] **Step 5: 提交**

```bash
cd . && git add docs/reusables.md docs/status.md && git commit -m "docs(lipsync): index new functions and mark feature complete

reusables.md 新增 LipSync 子系统 + BeatDetector.getLevel + scene.ts 控制 API；
status.md 标记 LipSync 已完成（实时振幅驱动「あ」morph）。"
```

---

## Self-Review 检查清单

实施完成后，对照本表逐项确认：

- [ ] **Task 1**: `BeatDetector.getLevel` 静态 + 实例方法均存在；`beat-detector.test.ts` 新增 5 用例 PASS。
- [ ] **Task 2**: `lipsync.ts` 导出 `LipSyncState` / `DEFAULT_LIPSYNC_STATE` / `findLipMorph` / `amplitudeToWeight`；15 单元测试 PASS。
- [ ] **Task 3**: `scene.ts` 新增 `lipSyncState` / `updateLipSync` / 3 setter / 1 getter；`onAnimationTickObservable` 回调含 `updateLipSync()` 调用；`export type LipSyncState` 已导出；vite build 通过；全量 vitest PASS。
- [ ] **Task 4**: `SceneFile.lipSync` 字段已加；`serializeScene` 写入；`deserializeScene` 默认值合并恢复；vite build 通过。
- [ ] **Task 5**: `scene-menu.ts` import 含 4 个 Lipsync 函数；`buildProcMotionLevel` items 含 LipSync folder；`buildLipSyncLevel` 函数定义；`handleRowAction` 含 `lipsync:menu` + `lipsync:toggle` 路由；vite build 通过。
- [ ] **Task 6**: `reusables.md` 含 3 个新小节 + 关键类型表追加；`status.md` 第 263 行改为 `[x]`。
- [ ] **类型一致性**: `LipSyncStateType`（lipsync.ts 内部名）→ `scene.ts` 导出为 `LipSyncState` → `scene-menu.ts` / `SceneFile` 使用 `LipSyncState`，命名链一致。
- [ ] **无 placeholder**: 所有步骤含完整代码块，无 TBD/TODO/「类似 Task N」。
